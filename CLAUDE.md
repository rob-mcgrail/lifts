# CLAUDE.md

Notes for Claude Code working in this repo. Keep this current.

## What this is

A personal lifting tracker. Phone-first web app, run on the home server, used in
a garage with bad wifi. Same shape as StrongLifts, with one deliberate
difference: **there is no programme engine.**

## The central design decision: no progression logic

Most lifting apps encode a programme — linear progression, +2.5kg on success,
deload 10% after three misses. This one doesn't, and shouldn't grow one.

Instead, sessions are **queued ahead with explicit weights, sets and reps**. What
the next weight should be is a planning decision, made when a session is queued —
by hand on the Queue tab, or by a model with access to the history. The app's job
is to execute the queued session, record what actually happened, and keep the
queue in order.

Consequences worth remembering before "helpfully" adding things back:

- There are no `increment`, `deload_pct` or `fail_limit` columns. Don't add them.
- Nothing is computed at finish time. Finishing a session marks it done, nothing
  more. It never changes a future weight.
- `exercises` is a bare catalogue (slug, name, kind). New movements are created
  on demand by `ensureExercise` when a plan references an unknown slug, so
  planning is never blocked on registering an exercise first.

## Layout

Follows the same conventions as `~/workspace/roadmaps`.

```
src/            server — Hono + bun:sqlite
  index.ts        routes + Bun.serve wiring
  db.ts           schema (idempotent CREATE/ALTER) and every query
  plates.ts       plate maths + hardcoded gym loadout (pure, no DB)
web/            client — React 19 + react-router-dom, own tsconfig
  index.html      SPA entry
  src/pages/      one file per screen
  src/api.ts      typed fetch client
  src/useLiveSession.ts   local-first session state
  src/useRestTimer.ts     rest timer + wake lock
data/           SQLite lives here (gitignored, bind-mounted in compose)
tests/          bun test
```

Dev bundles the SPA live via Bun.serve's HTML route (HMR). Production serves a
prebuilt `dist/web` through Hono. See "Serving" below — the two paths differ for
a real reason.

## Local-first session state

The phone owns the session you're in the middle of. `useLiveSession` holds it in
React state, mirrors it to localStorage on every change, and pushes the **total
state** of the session to `PUT /api/sessions/:id/state` on a debounce, on a
15s heartbeat, on `visibilitychange`, on `online`, and via `sendBeacon` on
pagehide.

Total state rather than per-tap deltas is the whole trick, and it's why there is
no write queue in here:

- The endpoint is idempotent — applying the same body twice lands in the same
  place. `completed_at` uses `COALESCE`, so a resend never bumps the clock.
- A failed request needs no replay logic. The next successful push carries
  whatever is current, because we always send *current* state, not a snapshot
  from when a retry was enqueued.
- Ordering and coalescing problems don't exist.

`applySessionState` only touches rows that actually belong to the session, so a
stale or malformed payload can't reach into another session's history.

**Local state wins on load — but only after it's been identified.** A cached copy
is stamped with a fingerprint of `id:created_at`, and is only allowed to push
once that matches the server's copy of the same id. Ids are reused whenever the
database is rebuilt or restored from backup, and a cache keyed on id alone will
cheerfully flush one session's sets over an unrelated session that inherited the
number — this actually happened during development and silently rewrote a
completed session's weights. On mismatch the cache is dropped and the server copy
adopted. When the validating fetch fails (offline), the cache is trusted, since
mid-session-with-no-signal is overwhelmingly the likelier explanation.

Defence in depth on the server: `applySessionState` refuses any change to a
session that is already `done`. Finished sessions are history and are not
rewritable through the sync path.

Never make a tap await the network. Bad wifi is the normal case, not the edge
case.

## Plates

`src/plates.ts` holds the gym's actual bar and plates as a hardcoded `LOADOUT`,
with `perSide` counts (how many go on one side — how you count them at the rack).
Current set tops out at 135kg and can express every 0.5kg step from 20kg up.

The solver is exact, not greedy. Greedy fill is wrong with finite plate counts:
it takes a large plate, strands the remainder, and reports a shortfall a
different combination would have covered. So it builds the full reachable set of
per-side loads via bounded-knapsack reachability, in integer hundredths of a kg,
cached per loadout. `tests/plates.test.ts` asserts every solution only uses
plates actually owned and that the breakdown sums to the weight it claims.

Only `kind === "barbell"` movements get a plate breakdown. A 24kg dumbbell press
is not "20kg bar + 2kg a side", and showing a loading for it would be actively
misleading. Non-barbell movements get `plates: null`.

## Serving

Production and development take different paths on purpose:

- **Dev** — Bun.serve's HTML route bundles `web/index.html` on the fly with HMR.
  Convenient, but Bun owns the response before any middleware sees it, so it
  cannot be compressed.
- **Prod** — the SPA is prebuilt in the Dockerfile (`bun build … --minify
  --production --public-path=/`) and served through Hono with `compress()`.

That matters more than it sounds: uncompressed dev is ~1.6MB over the wire;
prod gzipped is ~83KB. On garage wifi that is the difference between usable and
not.

`--public-path=/` is required. Without it Bun emits `./index-<hash>.js`, which a
deep link like `/workout/2` resolves to `/workout/index-<hash>.js` and 404s.

Content-hashed bundles get `immutable` caching; `index.html` is always
`no-cache`, or a deploy wouldn't be picked up.

## Running it

Dependencies are installed **in the container**, never on the host — see
`.claude/unrestricted-bash-policy.md`. To refresh the lockfile:

```bash
docker run --rm -v "$PWD":/app -v "$HOME/.cloudflare/cert.pem":/tmp/cloudflare.pem:ro \
  -w /app oven/bun:alpine \
  sh -c 'cat /tmp/cloudflare.pem >> /etc/ssl/certs/ca-certificates.crt && bun install'
```

The Cloudflare WARP cert is required for any network access during a build —
without it every package manifest fails with `SELF_SIGNED_CERT_IN_CHAIN`. The
Dockerfile takes it as a build secret; `CLOUDFLARE_CERT` points at it.

```bash
dcup                # docker compose up (dev, HMR, port 4760)
NODE_ENV=production dcup
dcrw bun test       # run tests in the container
```

`bun test` on the host is fine (it's not a package-manager install) as long as
the test doesn't need `node_modules` — `tests/plates.test.ts` imports only
`src/plates.ts` and runs standalone.

## API

The HTTP API is the real interface — the web app is one client of it, and a
model or CLI is another. Keep it complete enough to drive the whole app.

**`API.md` is the agent-facing guide** to this surface. It is the document an
agent reads before driving the API with curl, and it documents behaviour, not
just routes (loadable-weight rules, the lifecycle, what not to write to). When
you change an endpoint or a constraint, update `API.md` in the same change —
a stale guide is worse than none, because an agent will act on it.

### Read endpoints answer in JSON or markdown

`?format=md` (or `Accept: text/markdown`) renders any read endpoint as markdown
tables; JSON stays the default so the web app is unaffected. Renderers live in
`src/markdown.ts` and are presentation only — no reads, no logic.

This exists because agents drive this API over curl, and a nested session tree
costs a lot of tokens to say very little. Any new read endpoint should get a
renderer. Watch out for one trap: `.filter(Boolean)` over the section array
strips the deliberate empty strings that separate a heading from its table, and
markdown needs that blank line — use the `join()` helper, which only drops
`null`.

| Method | Path | Notes |
|---|---|---|
| GET | `/api/health` | |
| GET | `/api/loadout` | bar, plates, min increment, max loadable |
| GET | `/api/exercises` | |
| GET | `/api/today` | active session, else next queued |
| GET | `/api/queue` | planned sessions in order |
| GET | `/api/history?limit=` | completed sessions, with volume |
| GET | `/api/log?exercise=&from=&to=&limit=` | flat set-level log — the analysis view |
| GET | `/api/sessions/:id` | |
| POST | `/api/sessions` | queue a session with explicit weights |
| PATCH | `/api/sessions/:id` | edit a **planned** session only (409 once started) |
| POST | `/api/sessions/:id/start` | |
| PUT | `/api/sessions/:id/state` | idempotent total-state sync |
| POST | `/api/sessions/:id/finish` | |
| DELETE | `/api/sessions/:id` | |
| PATCH | `/api/sets/:id` | single-set write (the app uses state sync instead) |
| GET | `/api/progress/:slug` | per-movement history + Epley e1RM |
| GET | `/api/context` | everything a planner needs in one call |

`GET /api/context` exists specifically so a model can read loadout, exercises,
queue, recent work and history in a single request before planning.

A started session can't be edited via `PATCH /api/sessions/:id`. History is a
record of what happened, not a draft.

## Not built yet

- The embedded chat / agent surface. `GET /api/context` and `POST /api/sessions`
  are the two endpoints it needs; the shape is deliberately ready for it.
- A service worker. Immutable bundle caching means a reload mostly works from
  cache, but the app shell isn't genuinely offline yet.
- Auth. Currently open on the LAN.
