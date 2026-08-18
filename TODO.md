# TODO

Ordered. The top one is next.

---

## 1. Bodyweight exercises — count-up sets

Pull-ups, dips, push-ups, hanging leg raises. These don't have a target you fall
short of; you do as many as you can and record the number. The current set
circle is the wrong interaction for them.

**Interaction.** Tap increments: tap tap tap → 3. That's the opposite of the
loaded-barbell circle, which starts at target and steps *down*, because missing
reps is the common case there. For bodyweight there's nothing to miss.

- Tap → +1
- Long press → back to cleared (undo a miscount, since you can't tap downwards)
- No plate view, no "can't load" warning — `kind: "bodyweight"` already
  suppresses plate maths server-side

**Show last time's count before the set.** The point is to beat it, or match it,
and you will not remember what you did a week ago. Before any set is logged the
circle should show the count from the most recent completed session containing
that movement, greyed, as a ghost target.

Resolve this **server-side**, the way plates and rest marks already are, so no
client repeats it. Add a `previous` field per exercise in `decorate()`:

```json
{ "slug": "pullup",
  "previous": { "date": "2026-08-11", "reps": [8, 7, 5] } }
```

`db.exerciseHistory(slug)` already returns exactly this shape — take the last
entry from a completed session. Watch the N+1: `decorate()` runs per session and
`listHistory` decorates many, so a naive per-exercise lookup will hammer SQLite.
One query keyed by exercise for the whole payload, or a small per-request cache.

**Planning.** A bodyweight exercise still needs `sets`, but `reps` is a
suggestion rather than a target and `weight` is 0 (or added weight, for a dip
belt — worth deciding: is `weight` on a bodyweight movement *added* load or
total? Added is more useful and matches how people talk, but it makes volume
maths wrong unless bodyweight is known). Document whichever way it lands in
`API.md`.

**Open question.** Should a bodyweight set with a ghost target colour itself
green/red against last time's count? Probably — beating last time is the whole
signal — but it needs to not look like a failed barbell set.

---

## 2. Reordering the queue from the phone

You can delete a queued session but not move it. Fine while the model does the
planning, annoying the first time you want to swap tomorrow for the day after.
Drag is fiddly on mobile; up/down arrows are probably enough. The `position`
column and `PATCH /api/sessions/:id` already support it.

## 3. Correcting a finished session from the UI

`PATCH /api/sets/:id` exists and works on completed sessions deliberately, but
there's no way to reach it from the phone. Today a mis-logged set has to be
fixed with curl. History would need an edit affordance — and it should feel
deliberate, not like ordinary logging.

## 4. `DELETE /api/sessions/:id` returns 200 for ids that don't exist

`db.deleteSession` fires the DELETE and reports success regardless, so a script
looping over ids happily reports deleting sessions that were never there. Should
404 on a missing id. Harmless, but it makes any tooling built on it lie about
what it did.

## 5. Service worker

Bundle caching is `immutable`, so a reload mostly works from cache, but the app
shell isn't genuinely offline. Worth doing before relying on it in a basement
gym with no signal at all. Session state already survives offline; this is only
about the app *loading*.

## 6. Web manifest

Now that it's on HTTPS, home-screen install is worth having: fullscreen, no
browser chrome, and notifications behave better for the rest timer.

## 7. Offsite backups

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
