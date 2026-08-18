# Lifts API — guide for agents

You are talking to a personal lifting tracker over HTTP. This document is written
for an agent driving it with `curl`: planning upcoming workouts, reading past
ones, and analysing them.

```bash
LIFTS=https://lifts.office-computer-online-worldwide.org   # production
LIFTS=http://localhost:4760                                # local dev
```

> **Authentication is not implemented yet.** Until it is, treat this as an open
> endpoint on a public domain and do not put anything in it you wouldn't publish.
> When auth lands, this section will describe how to present a credential.

---

## The one thing to understand first

**This app has no programme engine, and adding one is not the goal.**

Most lifting apps encode progression rules — add 2.5kg on success, deload 10%
after three misses. This one deliberately does not. There are no increment,
deload or fail-limit settings anywhere, and finishing a workout changes nothing
about future weights.

Instead, **sessions are queued ahead with explicit weights, sets and reps**.
Deciding what the next weight should be is *your job*, done when you queue the
session. The app executes what you queued and records what actually happened.

So the loop is:

1. Read the current state — what's been lifted, what's queued, what the bar can
   physically hold.
2. Decide what the next sessions should be.
3. `POST` them onto the queue with exact weights.
4. The human trains. The app records it.
5. Read the results back and repeat.

---

## JSON or markdown

Every **read** endpoint answers in either format. JSON is the default. Ask for
markdown when you want to read the result yourself — it is far fewer tokens than
a nested session tree and needs no parsing.

```bash
curl -s "$LIFTS/api/today?format=md"                      # markdown
curl -s -H 'Accept: text/markdown' "$LIFTS/api/today"     # same thing
curl -s "$LIFTS/api/today"                                # JSON (default)
```

`?format=json` forces JSON even when an `Accept` header asks otherwise.

Write endpoints always take and return JSON.

---

## Start here: `GET /api/context`

One call returns everything needed to plan: the physical loadout, the exercise
catalogue, the current queue, recent work per movement, and recent history.
Read this before planning anything.

```bash
curl -s "$LIFTS/api/context?format=md"
```

If you only need part of it, the pieces are also available separately
(`/api/loadout`, `/api/exercises`, `/api/queue`, `/api/history`).

---

## Planning constraints — read before you propose weights

### Weights must be physically loadable

The gym has a fixed bar and a fixed set of plates. `GET /api/loadout` tells you
exactly what can be made:

```bash
curl -s "$LIFTS/api/loadout?format=md"
```

```
# Loadout

Bar 20kg. Smallest total step 0.5kg. Max loadable 175kg.

| Plate  | Per side | Pair adds |
| ------ | -------- | --------- |
| 20kg   | 1        | 40kg      |
| 10kg   | 4        | 20kg      |
| 5kg    | 2        | 10kg      |
| 2.5kg  | 1        | 5kg       |
| 1.25kg | 2        | 2.5kg     |
| 1kg    | 1        | 2kg       |
| 0.75kg | 1        | 1.5kg     |
| 0.5kg  | 1        | 1kg       |
| 0.25kg | 1        | 0.5kg     |
```

Three rules follow:

- **Stay at or below `max_loadable`** (currently 175kg). Above it the bar simply
  cannot be loaded.
- **Use whole multiples of `min_increment`** (currently 0.5kg). The plate set
  goes down to 0.25kg per side, so 0.5kg total steps are available — you are not
  restricted to 2.5kg jumps. Small jumps on pressing movements are the main tool
  against stalling.
- **A weight that isn't loadable is not rejected** — it's accepted and flagged.
  The response shows the nearest loading below it and how far short it falls:

  ```
  | 2 | Overhead Press | ohp | 5×5 | 41.25kg | 5 + 2.5 + 1.25 + 1 + 0.75 (0.25kg short) |
  ```

  Treat any `short` as a mistake on your part and pick a reachable weight.

### Barbell vs everything else

Set `kind` on each exercise. Only `barbell` movements get a plate breakdown —
a 24kg dumbbell is not "a 20kg bar plus 2kg a side", and showing a loading for
one would be misleading.

Valid kinds: `barbell` (default), `dumbbell`, `machine`, `bodyweight`, `other`.

You only need to send `kind` the first time a movement appears; it's remembered.
Sending it again with a different value corrects the stored value.

### Unknown exercises are created automatically

Reference any slug you like. If it doesn't exist it is created, using `name` as
the display label (or a title-cased version of the slug if you omit it). You
never need to register a movement before planning it.

---

## Queueing sessions

```bash
curl -s -X POST "$LIFTS/api/sessions" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Lower A",
    "plan_note": "Squat back 5kg — knee was grumbling last week.",
    "exercises": [
      { "exercise": "squat",    "weight": 82.5, "sets": 5, "reps": 5 },
      { "exercise": "deadlift", "weight": 105,  "sets": 1, "reps": 5 },
      { "exercise": "db-row",   "name": "Dumbbell Row", "kind": "dumbbell",
        "weight": 30, "sets": 3, "reps": 10, "note": "each side" }
    ]
  }'
```

| Field | Required | Notes |
|---|---|---|
| `name` | no | Shown as the session title. Falls back to the movement names. |
| `plan_note` | no | Free text shown to the human before they start. **Use this** — it's how you explain a decision. |
| `position` | no | Queue position. Defaults to the end. |
| `exercises[].exercise` | **yes** | Slug. Created on demand. |
| `exercises[].name` | no | Display name, used only when creating. |
| `exercises[].kind` | no | Defaults to `barbell`. |
| `exercises[].weight` | **yes** | Number ≥ 0. |
| `exercises[].sets` | **yes** | Integer 1–20. |
| `exercises[].reps` | **yes** | Integer 1–100. Target reps per set. |
| `exercises[].note` | no | Per-movement cue. |
| `exercises[].rest_ready` | no | Rest override for this lift. See below. |
| `exercises[].rest_end` | no | Rest override for this lift. See below. |
| `rest_ready` | no | Rest override for the whole session. |
| `rest_end` | no | Rest override for the whole session. |

Sessions run in queue order. Queue several at once to lay out a week or a block.

`plan_note` is worth using properly. The human sees it on the Today screen before
they lift, and it is the only channel you have to explain *why* a weight changed.

### Rest timers

A rest has **two marks**, not one deadline:

| Mark | Default | What happens |
|---|---|---|
| `rest_ready` | 90s | One tone, the clock turns green. The set is recoverable from — go whenever you like. |
| `rest_end` | 180s | Three tones, the timer ends. You should be back under the bar. |

Both are whole seconds, 5–3600, measured from the moment a set is logged, and
`rest_ready` must be **less than** `rest_end` or the request is rejected.

They resolve through **three levels**, each mark independently:

```
exercise override  →  session override  →  global setting
```

So a session can lengthen `rest_end` without restating `rest_ready`, and a
single lift inside it can override either again. `null` at any level means
"inherit"; only set a value where you actually want to depart from the default.

```bash
# Global defaults
curl -s "$LIFTS/api/settings?format=md"
curl -s -X PATCH "$LIFTS/api/settings" \
  -H 'Content-Type: application/json' \
  -d '{"rest_ready": 120, "rest_end": 240}'
```

Set them per session and per lift when planning — a heavy triple and a set of
ten have no business waiting the same amount of time:

```bash
curl -s -X POST "$LIFTS/api/sessions" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Day 2",
    "rest_ready": 150, "rest_end": 300,
    "exercises": [
      { "exercise": "deadlift", "weight": 150, "sets": 3, "reps": 5,
        "rest_ready": 180, "rest_end": 360 },
      { "exercise": "ohp", "weight": 50, "sets": 3, "reps": 5 },
      { "exercise": "ohp", "weight": 30, "sets": 2, "reps": 10,
        "rest_ready": 60, "rest_end": 120, "note": "back-off" }
    ]
  }'
```

In that session the deadlift rests 180/360, the working OHP inherits the
session's 150/300, and the back-off set drops to 60/120.

Every read that returns exercises includes a resolved `rest` object alongside
the raw nullable columns, so you can tell an override from an inherited value
without recomputing the chain yourself:

```json
{ "rest_ready": 180, "rest_end": 360, "rest": { "ready": 180, "end": 360 } }
{ "rest_ready": null, "rest_end": null, "rest": { "ready": 150, "end": 300 } }
```

To clear an override back to inheriting, `PATCH` the session with an explicit
`null`.

### Editing and removing

```bash
curl -s -X PATCH "$LIFTS/api/sessions/7" \
  -H 'Content-Type: application/json' \
  -d '{"exercises":[{"exercise":"squat","weight":80,"sets":5,"reps":5}]}'

curl -s -X DELETE "$LIFTS/api/sessions/7"
```

`PATCH` replaces the exercise list wholesale when `exercises` is supplied.

**Only `planned` sessions can be edited.** Once a session has been started, `PATCH`
returns `409`. Once finished, it cannot be modified at all — not by `PATCH`, and
not by the sync endpoint. History is a record of what happened, not a draft.

---

## Reading what happened

### Recent sessions

```bash
curl -s "$LIFTS/api/history?limit=20&format=md"
```

One row per movement per session:

```
# History (2 sessions, 2,168kg total volume)

| Date       | ID | Session | Exercise    | Weight | Target | Reps      | Result  |
| ---------- | -- | ------- | ----------- | ------ | ------ | --------- | ------- |
| 2026-08-18 | 2  | Upper B | Bench Press | 60kg   | 5×5    | · · 5 5 5 | partial |
| 2026-08-18 | 1  | Lower A | Squat       | 80kg   | 5×5    | 5 5 5 5 5 | hit     |
```

Reading the `Reps` column: each number is one set. `·` means the set was never
attempted. `Result` is `hit` (every set met target), `missed` (all sets logged,
at least one short), `partial` (some sets never attempted), or `not started`.

### One movement over time

```bash
curl -s "$LIFTS/api/progress/squat?format=md"
```

Includes an Epley e1RM estimate per session. **e1RM is for trend-watching only —
never plan directly off it.**

### Set-level log — the analysis view

```bash
curl -s "$LIFTS/api/log?format=md"
curl -s "$LIFTS/api/log?exercise=bench&from=2026-06-01&limit=200"
```

One row per logged set — flat, no nesting, drops straight into a table or
dataframe:

```
| Date       | Session | Exercise | Set | Weight | Target | Reps | Result | Volume |
| ---------- | ------- | -------- | --- | ------ | ------ | ---- | ------ | ------ |
| 2026-08-18 | 1       | squat    | 1   | 80kg   | 5      | 5    | hit    | 400    |
```

Filters: `exercise` (slug), `from` / `to` (`YYYY-MM-DD`), `limit` (default 1000,
max 10000). Only completed sessions and actually-logged sets appear.

This is the endpoint to reach for when doing real analysis — volume trends,
stall detection, set-position fatigue, anything per-set.

---

## Full endpoint list

Reads accept `?format=md`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness. |
| GET | `/api/context` | Everything needed to plan, in one call. |
| GET | `/api/loadout` | Bar, plates, min increment, max loadable. |
| GET | `/api/exercises` | Movement catalogue. |
| GET | `/api/settings` | Global rest defaults. |
| PATCH | `/api/settings` | Change them. |
| GET | `/api/today` | Active session, else next queued. |
| GET | `/api/queue` | Planned sessions, in order. |
| GET | `/api/history?limit=` | Completed sessions with volume. |
| GET | `/api/log?exercise=&from=&to=&limit=` | Flat set-level log. |
| GET | `/api/progress/:slug` | One movement over time, with e1RM. |
| GET | `/api/sessions/:id` | One session. |
| POST | `/api/sessions` | Queue a session. |
| PATCH | `/api/sessions/:id` | Edit a **planned** session. |
| DELETE | `/api/sessions/:id` | Remove a session. |
| POST | `/api/sessions/:id/start` | Mark active. |
| POST | `/api/sessions/:id/reset` | Active → planned. Clears every logged set. |
| POST | `/api/sessions/:id/finish` | Mark done. |
| PATCH | `/api/sessions/:id/notes` | Set the human's session notes. |
| PUT | `/api/sessions/:id/state` | Idempotent total-state sync. The app's only session write. |
| PATCH | `/api/sets/:id` | Correct one mis-logged set. |
| PATCH | `/api/session-exercises/:id/weight` | Correct one movement's weight. |

### Session lifecycle

```
planned  ──start──▶  active  ──finish──▶  done
   ▲                   │                    │
   └─────reset─────────┘               immutable
 editable
```

`reset` is for opening a session and then not lifting after all. It puts an
active session back in the queue at its original position, unstarted, and
**clears every logged set** — it is not a way to abandon a session part-way
through. It refuses a session that is already `done`.

`GET /api/today` returns `{"state": ...}` — one of `ready` (something queued),
`in_progress` (a session is active), or `empty` (nothing queued). If it returns
`empty`, the human has nothing to train. That's your cue to plan.

### Endpoints you probably shouldn't touch

`PUT /api/sessions/:id/state` is how the phone records a live workout: it pushes
the whole state of the session it's running, and it's the only write the app
makes during a session. Don't drive it — recording what was lifted is the
human's job, and inventing set data corrupts the record you're meant to be
analysing.

`PATCH /api/sets/:id` and `PATCH /api/session-exercises/:id/weight` are single,
deliberate corrections — one mis-logged set, one wrong weight. The app no longer
uses either. Reach for them only when the human asks you to fix something
specific, never to record a workout.

Note the asymmetry: the state sync refuses to touch a session that is already
`done`, so a stale phone can't rewrite history, while the two correction
endpoints will. That's intentional — fixing a genuine logging error afterwards
is legitimate, but it has to be a deliberate act rather than a side effect of
a sync.

---

## Worked example

Plan next week from what actually happened.

```bash
# 1. What's the current picture?
curl -s "$LIFTS/api/context?format=md"

# 2. Has bench stalled? Look at the last several sessions.
curl -s "$LIFTS/api/progress/bench?format=md"

# 3. Is it the last sets failing, or all of them? (fatigue vs. too heavy)
curl -s "$LIFTS/api/log?exercise=bench&limit=40&format=md"

# 4. Queue accordingly — small jump because the plates allow it.
curl -s -X POST "$LIFTS/api/sessions" \
  -H 'Content-Type: application/json' \
  -d '{
    "name": "Upper B",
    "plan_note": "Bench +1kg not +2.5 — last two sessions only sets 4 and 5 dropped, which reads as fatigue rather than the weight being too heavy.",
    "exercises": [
      { "exercise": "bench", "weight": 61, "sets": 5, "reps": 5 },
      { "exercise": "ohp",   "weight": 41, "sets": 5, "reps": 5 }
    ]
  }'

# 5. Confirm it landed and is loadable — no "short" warnings.
curl -s "$LIFTS/api/queue?format=md"
```

Note step 5. Always read the queue back after planning. It's the cheapest way to
catch a weight the bar can't actually be loaded to.

---

## Judgement notes

- **Explain yourself in `plan_note`.** A weight that changed without explanation
  is indistinguishable from a bug, and the human is the one who has to trust it.
- **Small jumps are available and usually correct.** The 0.5kg floor exists
  precisely so pressing movements don't have to take 2.5kg steps.
- **Distinguish a miss from a stall.** One bad session is noise — sleep, food, a
  cold gym. Look at several before dropping weight. `/api/log` shows *which* sets
  failed, which usually tells you whether it's fatigue or load.
- **`missed` doesn't always mean "too heavy".** Check whether the earlier sets
  were fine; failing only the last set or two is a different problem from failing
  the first.
- **Don't invent history.** If you need to know something the data doesn't
  contain, ask rather than assume.
