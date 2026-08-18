# TODO

Ordered. The top one is next.

---

## 1. Reordering the queue from the phone

You can delete a queued session but not move it. Fine while the model does the
planning, annoying the first time you want to swap tomorrow for the day after.
Drag is fiddly on mobile; up/down arrows are probably enough. The `position`
column and `PATCH /api/sessions/:id` already support it.

## 2. Correcting a finished session from the UI

`PATCH /api/sets/:id` exists and works on completed sessions deliberately, but
there's no way to reach it from the phone. Today a mis-logged set has to be
fixed with curl. History would need an edit affordance — and it should feel
deliberate, not like ordinary logging.

## 3. `DELETE /api/sessions/:id` returns 200 for ids that don't exist

`db.deleteSession` fires the DELETE and reports success regardless, so a script
looping over ids happily reports deleting sessions that were never there. Should
404 on a missing id. Harmless, but it makes any tooling built on it lie about
what it did.

## 4. Service worker

Bundle caching is `immutable`, so a reload mostly works from cache, but the app
shell isn't genuinely offline. Worth doing before relying on it in a basement
gym with no signal at all. Session state already survives offline; this is only
about the app *loading*.

## 5. Web manifest

Now that it's on HTTPS, home-screen install is worth having: fullscreen, no
browser chrome, and notifications behave better for the rest timer.

## 6. Offsite backups

`update.sh` keeps the last 5 in `data/backups/` on the box. That covers a bad
deploy; it does not cover losing the box. Nothing yet copies them off it.

---

## Decisions, not gaps

Don't "fix" these — they're deliberate, and a future session should know that.

- **No authentication.** Every endpoint is open on a public domain, including
  writes and `DELETE /api/sessions/:id`. Considered and accepted.
- **No programme engine.** No progression rules, no deloads, no auto-increment.
  Sessions are queued ahead with explicit weights by a model reading the
  history. See `CLAUDE.md`.
- **No settings page and no planning form in the app.** Configuration and
  planning belong to the API. A cut-down form on a phone is only ever a worse
  version of it.
- **Plates are hardcoded** in `src/plates.ts`. They change about once a year.
- **Bodyweight sets count up, barbell sets count down.** Not an inconsistency: a
  loaded bar has a target you fall short of, a set of pull-ups doesn't. See
  `CountButton` vs `SetButton`.
- **Adding a set needs the network.** A new row needs an id, and the state sync
  only ever updates rows it can already see. Logging into an existing set stays
  fully offline, which is the part that has to work in a garage.
