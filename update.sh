#!/usr/bin/env bash
#
# Pull, rebuild and restart lifts. Run it from anywhere — it operates on the
# repo it lives in, not the current working directory.
#
#   ./update.sh              # normal update
#   ./update.sh --no-pull    # rebuild and restart what's already checked out
#   ./update.sh --no-backup  # skip the pre-update database copy
#
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")"

PORT="${HOST_PORT:-4760}"
STOP_TIMEOUT=30
KEEP_BACKUPS=20
DO_PULL=1
DO_BACKUP=1

for arg in "$@"; do
  case "$arg" in
    --no-pull) DO_PULL=0 ;;
    --no-backup) DO_BACKUP=0 ;;
    -h|--help) sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
warn() { printf '\033[33m  ! %s\033[0m\n' "$*"; }
die() { printf '\033[31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# On a machine behind Cloudflare WARP the build needs the WARP cert as a secret,
# or every package fetch dies with SELF_SIGNED_CERT_IN_CHAIN. Machines that
# aren't behind WARP — the server included — have no such cert and don't need
# one, so point the secret at /dev/null and let the Dockerfile's `if [ -f ... ]`
# skip it. Exporting a path that doesn't exist makes compose fail outright, so
# only set this when the file is really there.
CERT_PATH="${CLOUDFLARE_CERT:-$HOME/.cloudflare/cert.pem}"
if [ -f "$CERT_PATH" ]; then
  export CLOUDFLARE_CERT="$CERT_PATH"
else
  export CLOUDFLARE_CERT=/dev/null
fi

# Mirrors the _compose helper in .shell-init.sh: inject secrets from 1Password
# when there's a .env.secrets to read, otherwise plain compose.
compose() {
  if [ -f .env.secrets ] && command -v op >/dev/null 2>&1; then
    op run --no-masking --env-file=.env.secrets -- \
      docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"
  else
    docker compose -f docker-compose.yml -f docker-compose.prod.yml "$@"
  fi
}

command -v docker >/dev/null 2>&1 || die "docker not found"
[ -f docker-compose.yml ] || die "no docker-compose.yml here — is this the lifts repo?"

# ---------------------------------------------------------------- backup
# Do this first and against the *running* container, so if anything later goes
# wrong there's a consistent copy from before it started.
if [ "$DO_BACKUP" = 1 ] && compose ps --status running --quiet web >/dev/null 2>&1 \
   && [ -n "$(compose ps --status running --quiet web 2>/dev/null)" ]; then
  say "Backing up the database"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  # VACUUM INTO is the only safe way to copy a live WAL database — plain cp can
  # capture a torn state where the -wal holds committed data the .sqlite doesn't.
  if compose exec -T web bun -e "
      import { Database } from 'bun:sqlite';
      import { mkdirSync } from 'fs';
      mkdirSync('/app/data/backups', { recursive: true });
      const db = new Database(process.env.DATABASE_PATH || '/app/data/lifts.sqlite', { readonly: true });
      db.run(\"VACUUM INTO '/app/data/backups/lifts-${STAMP}.sqlite'\");
      console.log('  ✓ data/backups/lifts-${STAMP}.sqlite');
    " 2>/dev/null; then
    ls -1t data/backups/lifts-*.sqlite 2>/dev/null | tail -n +$((KEEP_BACKUPS + 1)) | xargs -r rm -f
  else
    warn "backup failed — continuing anyway (there may be no database yet)"
  fi
else
  [ "$DO_BACKUP" = 1 ] && echo "  (nothing running to back up)"
fi

# ------------------------------------------------------------------ pull
if [ "$DO_PULL" = 1 ]; then
  say "Pulling"
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
    warn "working tree has local changes:"
    git status --short | sed 's/^/    /'
    warn "pulling anyway with --ff-only; it will abort rather than merge over them"
  fi
  BEFORE="$(git rev-parse --short HEAD)"
  git pull --ff-only
  AFTER="$(git rev-parse --short HEAD)"
  if [ "$BEFORE" = "$AFTER" ]; then
    echo "  already up to date at $AFTER"
  else
    echo "  $BEFORE → $AFTER"
    git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'
  fi
fi

# ----------------------------------------------------------------- build
# Build before stopping anything: the build is the slow part, and the old
# container keeps serving throughout it.
say "Building"
compose build

# --------------------------------------------------------- stop and start
say "Restarting"
# --timeout gives Bun a chance to exit cleanly and SQLite a chance to checkpoint
# its WAL, rather than being killed mid-write.
compose down --timeout "$STOP_TIMEOUT"
compose up -d

# ------------------------------------------------------------ health check
say "Waiting for health"
for i in $(seq 1 45); do
  if curl -fsS -m 3 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
    printf '  ✓ healthy after %ss\n' "$i"

    MODE=$(curl -fsS -m 5 "http://localhost:${PORT}/" 2>/dev/null \
      | grep -q 'data-bun-dev-server-script' && echo development || echo production)
    if [ "$MODE" = development ]; then
      warn "serving in DEVELOPMENT mode — bundle goes out uncompressed (~20x the bytes)"
    else
      echo "  ✓ production mode"
    fi

    # `|| true` matters: grep exits 1 when the queue is empty, and under
    # `set -o pipefail` that would fail the whole script after a good deploy.
    QUEUED=$(curl -fsS -m 5 "http://localhost:${PORT}/api/queue" 2>/dev/null \
      | grep -o '"id":' | wc -l | tr -d ' ' || true)
    echo "  ✓ ${QUEUED:-0} session(s) queued"
    say "Done"
    exit 0
  fi
  sleep 1
done

die "did not come up healthy within 45s — check: docker compose logs --tail=50 web"
