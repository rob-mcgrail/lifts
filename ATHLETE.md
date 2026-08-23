# The lifter — context for agents planning sessions

`API.md` tells you how to drive this app. This document tells you **who you are
planning for**, and it exists because none of it is recoverable from the data.
The database holds barely any history; the training history is years long. An
agent that plans from the log alone will plan for the wrong person.

Captured 2026-08-24 from conversation. Keep it current — see the last section.

---

## The one thing to understand first

**The log is not the training history.**

This app is new. It contains a couple of completed sessions. He has been lifting
on and off for years, and has been running the currently queued maintenance
block regularly — treat every weight in the queue as a load he hits routinely,
not as an untested plan.

Do not infer detraining, inconsistency, or a beginner state from a short log.

---

## Who he is

| | |
|---|---|
| Age | 44 |
| Sex | Male |
| Height | 5'9" (~175cm) |
| Bodyweight | ~83kg (2026-08) |

Bodyweight trajectory:

- **~75kg** as a skinny teenager
- **~92kg** mid-2025 — heaviest
- **~83kg** now, down ~9kg over roughly six months

His PBs were set *during* this period, not before it — see Current numbers.

That loss came from a deliberate diet change at the **start of 2026**: protein
and creatine daily, large sauerkraut-heavy sandwiches, consistently good family
dinners, and — the big two — stopping scotch four nights a week and stopping
McDonald's on every car trip. Nourishing dinners were already a habit; the wins
were removing the alcohol and the drive-through.

He is **happy with his bodyweight** for his age. There is "a little bit of
weight to lose and a little bit of strength to gain", but neither is urgent.
Body composition is no longer the driving goal — see Goals.

---

## Training history, and the failure mode that matters

The single most important thing in this document.

1. **StrongLifts 5×5, on and off for years.** Enjoyed it.
2. **A repeated pattern:** linear progression works, the weights get heavy, he
   stops feeling safe under them, and he lapses — *for up to a year at a time.*
   Not a deload. A full stop.
3. **~6 months of StrongLifts** in the current stretch.
4. **A few months of a classic intermediate weekly-cycling programme** (Madcow-
   shaped — ramping sets rotating across the week).
5. Started to **feel slammed and unsure of his ability to handle max weights
   safely**, training alone in a garage.
6. **Self-prescribed a maintenance holding pattern** rather than quitting — about
   a month as of 2026-08. This is the currently queued block.

**The failure mode is the load spiral, not motivation.** Progression marches him
toward loads he does not trust, and the exit is a year off. Step 6 is the first
time he interrupted the loop instead of completing it, and it worked.

So: **a plan that ends in loads he is afraid of has failed, however good the
programming is.** Cap the load. Do not quietly reintroduce linear progression
toward a 1–3RM.

The corollary: the maintenance block succeeded as a rescue but is **boring, and
gives him no pump**. Left running it becomes a second route to the same lapse.
Don't queue another indefinite hold without a reason.

---

## Current numbers

### The stored bests are real, and they are recent

`SEED_BESTS` are his **post-cleanup PBs** — set during 2026, after the diet
change, on the StrongLifts and Madcow-shaped run that preceded the maintenance
block. When he calls the squat baseline an "old" max he means *a few months ago*,
not the drinking era. They were achieved somewhere between 92kg and his current
83kg.

So they are **genuine, recent, and roughly comparable to today's bodyweight.**
Treat them as a real peak he backed off from, not as inflated history.

**Decided 2026-08-24: leave the bests alone.** Do not suggest re-baselining
them, and do not `PUT /api/bests/:slug` without being asked.

That decision is the right one, and it reframes the PB system usefully: these
are not unreachable numbers set by someone else, they are **targets he has
already proved he can hit.** He will train below them for a while — the
maintenance block is well under his peak and the proposed rep-range block starts
lower still — so expect the golden pig to stay quiet for some weeks. When it
does fire it will mean something real.

In the meantime his sense of progress has to come from the **rep progression**,
not from PBs: reps visibly climbing week to week at a load he isn't afraid of.
Keep that legible, and don't let a block stall silently.

| Movement | Stored best | e1RM | × bw (83kg) | Source |
|---|---|---|---|---|
| Deadlift | 5 × 160kg | 186.7 | 2.25× | PB, 2026 (pre-maintenance) |
| Squat | 3 × 135kg | 148.5 | 1.79× | PB, 2026 (pre-maintenance) |
| Incline bench | 3 × 86.5kg | 95.2 | 1.15× | PB, 2026 (pre-maintenance) |
| Barbell row | 3 × 86.5kg | 95.2 | 1.15× | PB, 2026 (pre-maintenance) |
| Bench | 3 × 85.5kg | 94.1 | 1.13× | PB, 2026 (pre-maintenance) |
| Pause squat | 5 × 110kg | 128.3 | 1.55× | **logged 2026-08-22** |
| OHP | 5 × 52.5kg | 61.3 | 0.74× | PB, 2026 (pre-maintenance) |

Deadlift is his standout lift. Squat and bench lag it. Pause squat is the only
best actually set in the app.

### Loads he hits routinely (the maintenance block)

Trust these ahead of the baselines.

| Movement | Working set |
|---|---|
| Squat | 3×5 @ 120kg |
| Deadlift | 3×5 @ 150kg |
| Bench | 3×5 @ 80kg, back-off 2×10 @ 50kg |
| Pause squat | 3×5 @ 110kg |
| Barbell row | 3×5 @ 70kg, 2×5 @ 80kg |
| OHP | 3×5 @ 50kg, back-off 2×10 @ 30kg |
| Pull-up | 3 sets bodyweight, 3–4 reps |

### The most informative data point in the log

His **only** miss is the OHP back-off, `2×10 @ 30kg` — he got 7 and 8. The
`3×5 @ 50kg` above it was clean.

He presses 50kg for 5 comfortably and cannot press 30kg for 10. That is years of
5×5 with no exposure to the 8–12 range. It is his largest untrained capacity and
therefore the cheapest progress available — and it happens to be the rep range
that produces the pump he is asking for.

### Pause squats — why they exist

A previous agent's suggestion, to rebuild confidence in the squat pattern at
heavier loads. They are not a preference of his. If the load problem is solved
another way, their reason for existing goes with it. See Niggles — deep loaded
flexion is a plausible knee aggravator.

---

## Niggles

His words: **"all minor."** Nothing here is diagnosed, none of it stops him
training, and none of the below is medical advice. Recorded because it shapes
exercise selection.

| Complaint | Frequency | Programming implication |
|---|---|---|
| **Lower back pain** | Sometimes | The lumbar load is `3×5 @ 150` deadlift plus `80kg` bent-over rows. Keep deadlift volume modest and don't chase deadlift reps. Prefer chest-supported or lighter higher-rep rows for volume. **RDLs are a qualified suggestion only** — introduce light and high-rep, or prefer a knee-flexion hamstring movement instead. |
| **One knee, occasionally** | Sometimes | Moderate loads at higher reps are generally kinder than heavy low-rep. Warm-up sets matter. Watch pause squats specifically — holding load in deep flexion is the plausible aggravator. |
| **Shin pain** | Sometimes | Most likely walking volume, which makes it **the limiter on rebuilding the walking habit**, not a lifting issue. Ramp walking volume gradually. Incline treadmill at a lower speed is lower-impact than fast flat walking, so the recommended reintroduction is also the shin-friendly one. Worth checking how old his shoes are. |

---

## Goals, in his words

1. **"I want to feel my pump again."** He misses it from the progressive-overload
   programmes and does not get it from maintenance. Treat this as a real
   programming requirement, not vanity — it is his main adherence lever. It
   requires 8–15 reps, shorter rests and real proximity to failure. 3×5 at 90%+
   cannot produce it.
2. **"I want to make good use of my lifting time because it's an imposition."**
   Sessions must be time-efficient — target ~45 minutes. Supersetting antagonist
   pairs is the rare change that shortens the session *and* improves the pump.
3. **Get walking again.** He believes the walks were key to his weight
   management and is nervous without them because he is "not always perfect"
   with calories. This is about insurance, not calorie arithmetic.
4. Strength: some more would be welcome, but it is not the point any more.

---

## Constraints

**Equipment** — home garage with a **proper cage**. Bar 20kg, max loadable
175kg, every 0.5kg step reachable; the exact plate loadout is in `src/plates.ts`
and `GET /api/loadout`. A treadmill. Places to walk nearby.

**Trains alone, but with a full cage** — he can bail a rep safely. Read this
carefully before drawing the obvious conclusion: **he had the cage the entire
time, and still stopped trusting himself under max weights.** Safety equipment
is not the answer to the load spiral, and "he has a cage, so he can be pushed
heavier" is exactly the wrong inference. The anxiety is about the loads
themselves, not about being pinned under one.

**Schedule** — three sessions a week is the established shape. Kids' school
timetables are the binding constraint on everything, and they move.

**Walking, and why it stopped** — he and his wife were doing **3 × 6km brisk
walks a week**, stopped because of school scheduling. Diagnosis: he does not
have a walking problem, he has a **65-minute-block problem**. Those blocks no
longer exist on weekdays, so trying to reschedule the same walk is why it hasn't
come back. Break it into pieces that fit instead:

- 15–20 min incline treadmill immediately after lifting — already changed,
  already committed, near-zero scheduling cost. Highest-adherence option.
- Walk the school run, or park further out. The constraint becomes the habit.
- Keep **one** real 6km with his wife at the weekend. That walk was never only
  exercise, and the weekend still has a long block.

Prefer a **daily step floor** over three scheduled events. Three appointments is
a fragile system that school timetables have already broken once; a floor is
better insurance on imperfect-calorie days, which is what he actually wants.

---

## Programming principles that follow

1. **Cap the load.** Never march him toward weights he won't trust alone. This
   is the whole ballgame — see the failure mode.
2. **Progress reps before load.** Double progression in roughly 6–12: add reps to
   the top of the range, then the smallest useful jump and back to the bottom.
   Progress lands every session while the bar stays in a confident zone.
3. **Program for the pump deliberately.** 8–15 reps, shorter rests, supersets.
4. **Keep sessions ~45 minutes.** Superset antagonists (bench/row, OHP/pull-up).
5. **Exploit the 8–12 range** — his biggest untrained capacity, per the OHP miss.
6. **Respect the niggles in exercise selection**, per the table above.
7. **Don't add a progression engine to the app.** Planning is the agent's job,
   done at queue time. See `CLAUDE.md`.

### The direction agreed on 2026-08-24

Move off maintenance to double progression in the 6–12 range with a hard load
ceiling. Indicative starting loads, all loadable on his plates:

| Movement | From | To | Rationale |
|---|---|---|---|
| Squat | 3×5 @ 120 | 4×8 @ 100–105 | Never a grinder; more total work than 3×5 @ 120 |
| Bench | 3×5 @ 80 | 3×8 @ 67.5 | |
| OHP | 3×5 @ 50 | 3×8 @ 40 | Worst rep range, biggest available win |
| Row | 3×5 @ 70 | 3×10 @ 57.5 | Also reduces lumbar load vs 80kg bent-over |
| Deadlift | 3×5 @ 150 | 3×5 @ 140 | Best lift; keep low-rep, low volume for the back |

The squat drop from 120 to 105 is the emotional cost of the plan and he was told
so plainly. It buys the entire rep range. He has accepted it.

**Squat frequency.** He wants to squat often and should. But three sessions of
`4×8` is 12 hard squat sets a week, up from 3–5 — too big a jump at 44 with an
occasionally grumpy knee. So: squat every session at three *different*
intensities, 3 sets each (9 a week), rather than the same top set three times.

### What is actually queued (2026-08-24)

Three weeks, sessions 10–18, replacing the maintenance block. Reps climb one per
set per week; every weight holds. Each session carries a 20-minute treadmill walk
at 8% as its last item.

| | A | B | C |
|---|---|---|---|
| Squat | 3×8–10 @ 100 | 3×8–10 @ 85 (easy) | 3×6–8 @ 105 |
| Push | Bench 3×8–10 @ 67.5 | OHP 3×8–10 @ 40 | Incline 3×8–10 @ 60 |
| Pull | Row 3×10–12 @ 57.5 | — | Row 3×10–12 @ 57.5 |
| Hinge | — | Deadlift 3×5 @ 140 | — |
| | Pull-ups ×3 | Pull-ups ×3 | Pull-ups ×3 |

Deadlift **holds at 140 for the whole block** — his best lift, and the main
spinal load next to a back that sometimes complains. It doesn't need to grow.

Rest marks are part of the prescription, not decoration: 45/90 on everything
supersetted (bench⟷row, OHP⟷pull-ups), 120/240 on deadlift, the 90/180 global on
squats. The short rests are where the pump comes from and most of where the
45-minute session comes from.

**OHP goes up in 1kg steps, not 2.5.** The loadout reaches every 0.5kg, and a
6% jump on a 40kg press is the single most common reason a novice press stalls.

Pause squats are **not** in this block. Their job was confidence at heavy loads,
which 105×6 solves differently, and holding load in deep flexion is the least
kind thing available to a grumpy knee.

No RDLs in week one either — floated before the back niggle was known. Revisit
at 3×12 @ 65 on day C if three squat days plus 140kg deadlifts stay quiet for a
fortnight.

---

## Decisions and open questions

### Answered 2026-08-24

- **Squat setup — a proper cage.** Does *not* license heavier loading; see the
  note under Constraints.
- **He accepts the load drop.** Agreed up front rather than discovered in week
  two.
- **Squat frequency — he thinks squats are good to do a lot.** So squat in most
  or all sessions rather than once a week. Ramp into it (see below) instead of
  tripling the weekly set count on day one.
- **Personal bests — leave them as they are.** Settled; don't reopen it.

### Still open

1. **Whether the post-lift treadmill walk actually happens.** It's queued as an
   item in all nine sessions on the theory that it costs nothing to schedule —
   already changed, already in the garage. Unproven. Check the walk dots on
   History after week one rather than asking him whether he intends to.
2. **Where the non-lifting walks come from.** Three lifting days gives at most
   three walks; the school run and a weekend 6km with his wife were the plan, and
   neither is in the app's hands. Standalone logging exists for exactly this.

## Keeping this current

Update this file when any of it changes — bodyweight trend, a niggle getting
worse or going away, a goal shifting, an open question answered, or the failure
mode showing up again. A stale athlete profile is worse than none, because an
agent will plan a block on it.

Numbers that live in the database (bests, logged sets, the queue) do **not**
belong here. Read those with `GET /api/context`. This file is for what the
database cannot tell you.
