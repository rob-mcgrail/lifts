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
# Which commit is actually serving. Written only after a deploy comes up
# healthy, so a run that dies halfway leaves it stale and the next run knows
# there is still work to do.
DEPLOY_STAMP="data/.deployed"
STOP_TIMEOUT=30
KEEP_BACKUPS=5
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
    # An empty pull is NOT reason enough to stop. If a previous run pulled and
    # then failed, the commit is checked out but was never deployed, and bailing
    # here would leave it stuck — re-running would keep saying "up to date"
    # while the old build carried on serving. So only stop when what's running
    # is genuinely this commit: the deploy stamp matches and it's healthy.
    if [ "$(cat "$DEPLOY_STAMP" 2>/dev/null)" = "$AFTER" ] \
       && curl -fsS -m 3 "http://localhost:${PORT}/api/health" >/dev/null 2>&1; then
      say "Nothing to do"
      echo "  $AFTER is deployed and healthy"
      echo "  (use ./update.sh --no-pull to rebuild and restart anyway)"
      exit 0
    fi
    echo "  but $AFTER is not deployed yet — continuing"
  else
    echo "  $BEFORE → $AFTER"
    git --no-pager log --oneline "$BEFORE..$AFTER" | sed 's/^/    /'
  fi
fi

# ---------------------------------------------------------------- backup
# After the pull (so a no-op update does nothing at all) but before anything
# that stops or replaces the container, and taken against the still-running one
# — so if the rest of this goes wrong there's a consistent copy from before it
# started.
if [ "$DO_BACKUP" = 1 ] && compose ps --status running --quiet web >/dev/null 2>&1 \
   && [ -n "$(compose ps --status running --quiet web 2>/dev/null)" ]; then
  say "Backing up the database"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  # VACUUM INTO is the only safe way to copy a live WAL database — plain cp can
  # capture a torn state where the -wal holds committed data the .sqlite doesn't.
  # Both the copy and the pruning happen INSIDE the container. The files are
  # written by the container's user, so on a bind mount the host user often
  # doesn't own them and a host-side rm fails with permission denied. The
  # process that created them can always delete them.
  if compose exec -T web bun -e "
      import { Database } from 'bun:sqlite';
      import { mkdirSync, readdirSync, unlinkSync } from 'fs';
      const dir = '/app/data/backups';
      mkdirSync(dir, { recursive: true });

      const db = new Database(process.env.DATABASE_PATH || '/app/data/lifts.sqlite', { readonly: true });
      db.run(\`VACUUM INTO '\${dir}/lifts-${STAMP}.sqlite'\`);
      console.log('  ✓ data/backups/lifts-${STAMP}.sqlite');

      // Names are lifts-YYYYMMDD-HHMMSS.sqlite, so lexical sort is chronological.
      const kept = readdirSync(dir).filter((f) => /^lifts-.*\.sqlite$/.test(f)).sort().reverse();
      for (const f of kept.slice(${KEEP_BACKUPS})) {
        try { unlinkSync(\`\${dir}/\${f}\`); console.log('  · pruned ' + f); }
        catch (e) { console.log('  ! could not prune ' + f + ': ' + e.message); }
      }
    "; then
    :
  else
    warn "backup failed — continuing anyway (there may be no database yet)"
  fi
else
  [ "$DO_BACKUP" = 1 ] && echo "  (nothing running to back up)"
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

    # Count sessions, not `"id":` fields — exercises and sets carry ids too, so
    # the obvious grep reports a number several times too large.
    # `|| true` matters: grep exits 1 on an empty queue, and under
    # `set -o pipefail` that would fail the whole script after a good deploy.
    QUEUED=$(curl -fsS -m 5 "http://localhost:${PORT}/api/queue" 2>/dev/null \
      | grep -o '"status":"planned"' | wc -l | tr -d ' ' || true)
    echo "  ✓ ${QUEUED:-0} session(s) queued"

    git rev-parse --short HEAD > "$DEPLOY_STAMP" 2>/dev/null || true
    say "Done"
    exit 0
  fi
  sleep 1
done

die "did not come up healthy within 45s — check: docker compose logs --tail=50 web"
