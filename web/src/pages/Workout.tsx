import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api, fmtWeight, sessionLabel, type Session, type SessionExercise } from "../api";
import { useLiveSession, type SyncState } from "../useLiveSession";
import { useLongPress } from "../useLongPress";
import { fmtClock, useRestTimer, VOICES, type Voice } from "../useRestTimer";
import { Screen } from "./Screen";

/**
 * Tap cycle for a set: untouched → target reps → target-1 → … → 0 → untouched.
 * One thumb, no keyboard, no modal — you've just put the bar down.
 *
 * Tapping only ever goes down, because missing reps is the common case and
 * wants to be one tap away. Going *above* target is a long press (see
 * SetButton) — rarer, and worth making deliberate so it can't happen by
 * accident while you're stabbing at the screen between sets.
 */
function nextReps(current: number | null, target: number): number | null {
  if (current === null) return target;
  if (current <= 0) return null;
  return current - 1;
}

const LONG_PRESS_MS = 350;
const REPEAT_MS = 260;
const MAX_REPS = 100;

const FALLBACK_MARKS = { ready: 90, end: 180 };

export default function Workout() {
  const { id } = useParams();
  const sessionId = Number(id);
  const { session, sync, error, mutate, finish, abandon } = useLiveSession(sessionId);
  const [done, setDone] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  // The exercise whose plate loading is being held open, if any.
  const [held, setHeld] = useState<SessionExercise | null>(null);
  // Rest marks for the set most recently logged — a heavy single and a set of
  // ten shouldn't get the same rest, so this follows whichever lift you tapped.
  const [marks, setMarks] = useState(FALLBACK_MARKS);
  const [voice, setVoice] = useState<Voice>("rhodes");
  const timer = useRestTimer(marks, voice);
  const nav = useNavigate();

  // Rest durations ride along on the session; only the tone is global.
  useEffect(() => {
    api
      .settings()
      .then((s) => VOICES.includes(s.rest_voice as Voice) && setVoice(s.rest_voice as Voice))
      .catch(() => {});
  }, []);

  // Every one of these is a local edit. Nothing here awaits the network.
  const setReps = useCallback(
    (setId: number, reps: number | null) => {
      mutate((s) => ({
        ...s,
        exercises: s.exercises.map((e) => ({
          ...e,
          sets: e.sets.map((x) => (x.id === setId ? { ...x, reps } : x)),
        })),
      }));
    },
    [mutate],
  );

  /**
   * The rest belongs to the set that started it. Every press on *that* set is
   * ignored — adding a rep, taking one off, clearing it and putting it back —
   * because it's all bookkeeping about a set you already finished, and you've
   * been resting the whole time. Winding the clock back to zero because you
   * corrected a number is the wrong answer.
   *
   * A press on a *different* set is a new set finished, so it starts a fresh
   * rest. Clearing never starts one.
   *
   * The owning set is remembered after the rest ends too, so fixing a count
   * once the timer has stopped doesn't start a phantom rest.
   */
  const restingSet = useRef<number | null>(null);

  const restAfter = useCallback(
    (ex: SessionExercise, setId: number, after: number | null) => {
      if (after === null) return;
      if (restingSet.current === setId) return;
      restingSet.current = setId;
      setMarks(ex.rest ?? FALLBACK_MARKS);
      timer.start();
    },
    [timer],
  );

  const [addingTo, setAddingTo] = useState<number | null>(null);

  /**
   * Append a set. The only thing on this screen that needs the network — a new
   * row needs a real id before it can be synced into. The returned row is merged
   * into local state rather than reloading the session, which would throw away
   * anything not yet pushed.
   */
  async function addSetTo(sessionExerciseId: number) {
    setAddingTo(sessionExerciseId);
    try {
      const row = await api.addSet(sessionExerciseId);
      mutate((sess) => ({
        ...sess,
        exercises: sess.exercises.map((e) =>
          e.id === sessionExerciseId ? { ...e, sets: [...e.sets, row] } : e,
        ),
      }));
    } catch (e) {
      setResetError(`Couldn't add a set — ${(e as Error).message}`);
    } finally {
      setAddingTo(null);
    }
  }

  async function onFinish() {
    timer.stop();
    setDone(true); // local state is authoritative; the push happens behind this
    await finish();
  }

  /**
   * Put the session back in the queue, unstarted. This one *does* await the
   * server before leaving, unlike finishing: the local cache has to be dropped
   * in step with the reset, and if the request failed we'd otherwise navigate
   * away having cleared the phone's copy of a session the server still thinks
   * is live.
   */
  async function onReset() {
    setResetting(true);
    timer.stop();
    try {
      await api.reset(sessionId);
      abandon(); // drop the local copy only once the server has agreed
      nav("/", { replace: true });
    } catch (e) {
      setResetting(false);
      setConfirmReset(false);
      setResetError((e as Error).message);
    }
  }

  if (!session) {
    return (
      <Screen title="Workout">
        {error ? <p className="err">{error}</p> : <p className="empty">Loading…</p>}
      </Screen>
    );
  }

  if (done) {
    return (
      <Screen title="Done" sub={sessionLabel(session)}>
        <div className="card">
          <p style={{ margin: 0 }}>Session logged.</p>
          <p className="muted small" style={{ marginBottom: 0 }}>
            {sync === "synced" ? "Synced." : "Saved on this phone — it'll sync when there's signal."}
          </p>
        </div>
        <button className="btn" onClick={() => nav("/", { replace: true })}>Done</button>
      </Screen>
    );
  }

  const allLogged = session.exercises.every((e) => e.sets.every((s) => s.reps !== null));

  const loggedCount = session.exercises.reduce(
    (n, e) => n + e.sets.filter((s) => s.reps !== null).length,
    0,
  );

  return (
    <>
      <Screen title={sessionLabel(session)} onTitleHold={() => setConfirmReset(true)}>
        <SyncDot state={sync} />
        {resetError && <p className="err">{resetError}</p>}

        {session.exercises.map((e) => (
          <div key={e.id} className="card">
            <div className="row">
              <div>
                <h2>{e.name}</h2>
                <div className="muted small">
                  {e.kind === "bodyweight"
                    ? `${e.target_sets} sets`
                    : `${e.target_sets}×${e.target_reps}`}
                  {e.previous && <> · last {e.previous.reps.map((r) => r ?? "–").join(" ")}</>}
                  {e.note && <> · {e.note}</>}
                </div>
              </div>
              {/* Press and hold the weight to see the loading; release to
                  dismiss. Hold rather than tap because a tap is what you do a
                  hundred times a session on the set circles, and it must never
                  edit the weight — a mis-tap there with the phone in one hand
                  would silently rewrite the plan. */}
              <div style={{ textAlign: "right" }}>
                <button
                  className="weight-btn"
                  onPointerDown={() => e.plates && setHeld(e)}
                  onPointerUp={() => setHeld(null)}
                  onPointerLeave={() => setHeld(null)}
                  onPointerCancel={() => setHeld(null)}
                  onContextMenu={(ev) => ev.preventDefault()}
                  style={{ cursor: e.plates ? "pointer" : "default" }}
                >
                  {e.kind === "bodyweight" && e.target_weight === 0 ? (
                    <div className="muted small">bodyweight</div>
                  ) : (
                    <div className="weight">
                      {e.kind === "bodyweight" && "+"}
                      {fmtWeight(e.target_weight)}<span>kg</span>
                    </div>
                  )}
                  {e.plates && e.plates.shortfall > 0 && (
                    <div className="plates short">can't load · {fmtWeight(e.plates.shortfall)}kg short</div>
                  )}
                </button>
              </div>
            </div>

            <div className="sets">
              {e.sets.map((s, i) =>
                e.kind === "bodyweight" ? (
                  <CountButton
                    key={s.id}
                    reps={s.reps}
                    ghost={e.previous?.reps[i] ?? e.target_reps ?? null}
                    onSet={(reps) => setReps(s.id, reps)}
                    onSettled={(reps) => restAfter(e, s.id, reps)}
                  />
                ) : (
                  <SetButton
                    key={s.id}
                    reps={s.reps}
                    target={e.target_reps}
                    onSet={(reps) => setReps(s.id, reps)}
                    onSettled={(reps) => restAfter(e, s.id, reps)}
                  />
                ),
              )}
              {/* The planned count on a bodyweight movement is a recommendation,
                  not a contract — if you have another set in you, take it. */}
              {e.kind === "bodyweight" && (
                <button
                  className="set add"
                  onClick={() => addSetTo(e.id)}
                  disabled={addingTo === e.id}
                  aria-label={`Add a set to ${e.name}`}
                >
                  +
                </button>
              )}
            </div>
          </div>
        ))}

        <button className="btn" onClick={onFinish}>
          {allLogged ? "Finish session" : "Finish early"}
        </button>
        <div style={{ height: 100 }} />
      </Screen>

      {held?.plates && <PlateOverlay exercise={held} />}

      {confirmReset && (
        <div className="sheet-scrim" onClick={() => !resetting && setConfirmReset(false)}>
          <div className="sheet" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ margin: 0 }}>Not lifting yet?</h2>
            <p className="muted small">
              Puts this session back at the top of the queue, unstarted, so you can
              start it later.
              {loggedCount > 0 && (
                <>
                  {" "}
                  <span style={{ color: "var(--warn)" }}>
                    {loggedCount} logged {loggedCount === 1 ? "set" : "sets"} will be cleared
                  </span>{" "}
                  — if you actually lifted, use Finish early instead.
                </>
              )}
            </p>
            <button className="btn danger" onClick={onReset} disabled={resetting}>
              {resetting ? "Putting it back…" : "Back in the queue"}
            </button>
            <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setConfirmReset(false)} disabled={resetting}>
              Keep going
            </button>
          </div>
        </div>
      )}

      {timer.running && (
        <div className={`rest ${timer.phase}`}>
          <div className="rest-inner">
            <div>
              <div className="rest-time">
                {timer.phase === "ready" && "+"}
                {fmtClock(timer.display)}
              </div>
              <div className="muted small">
                {timer.phase === "ready"
                  ? `Ready · ${fmtClock(timer.marks.end - timer.elapsed)} until you're late`
                  : "Resting"}
              </div>
            </div>
            <button
              className="btn ghost"
              style={{ width: "auto", padding: "12px 18px", minHeight: 0 }}
              onClick={timer.stop}
            >
              Skip
            </button>
          </div>
          {/* One bar across the whole rest, with a notch at the ready mark, so
              both marks are visible at once rather than the bar resetting. */}
          <div className="rest-bar">
            <i style={{ width: `${Math.min(100, (timer.elapsed / timer.marks.end) * 100)}%` }} />
            <u style={{ left: `${(timer.marks.ready / timer.marks.end) * 100}%` }} />
          </div>
        </div>
      )}
    </>
  );
}

/**
 * One set circle.
 *
 *   tap        step down through the reps — 5 → 4 → 3 … → 0 → cleared
 *   hold       step *up*, repeating while held, for a set that beat its target
 *
 * The asymmetry is deliberate. Missing reps is the ordinary case and should
 * cost one tap; exceeding target is rarer, and a long press means it can't
 * happen by accident. A press that turns into a hold does not also fire the
 * tap, or every added rep would be preceded by a phantom decrement.
 */
function SetButton({
  reps,
  target,
  onSet,
  onSettled,
}: {
  reps: number | null;
  target: number;
  onSet: (reps: number | null) => void;
  onSettled: (reps: number | null) => void;
}) {
  const heldRef = useRef(false);
  const startTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const repeatTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Held in a ref as well as state: the repeat fires from a timer that closed
  // over the old prop, so it needs somewhere current to read from.
  const liveRef = useRef(reps);
  liveRef.current = reps;

  const clearTimers = useCallback(() => {
    if (startTimer.current) clearTimeout(startTimer.current);
    if (repeatTimer.current) clearInterval(repeatTimer.current);
    startTimer.current = null;
    repeatTimer.current = null;
  }, []);

  // A repeat driven by an interval only stops when a pointerup arrives, and a
  // pointerup is not guaranteed — a scroll steals it, the browser drops it, a
  // synthetic event never sends one. Left running it re-renders, writes
  // localStorage and PUTs to the server several times a second, forever. So:
  // stop on any pointer release anywhere, and on unmount, regardless of where
  // the event lands.
  useEffect(() => {
    const stop = () => clearTimers();
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener("blur", stop);
    return () => {
      clearTimers();
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener("blur", stop);
    };
  }, [clearTimers]);

  function bump() {
    const current = liveRef.current ?? target;
    if (current >= MAX_REPS) {
      clearTimers(); // nothing left to add — don't keep firing writes at the cap
      return;
    }
    const next = current + 1;
    liveRef.current = next;
    onSet(next);
  }

  function down(e: React.PointerEvent<HTMLButtonElement>) {
    heldRef.current = false;
    // Capture the pointer so the release comes back to this element even if the
    // finger drifts off it mid-hold.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    startTimer.current = setTimeout(() => {
      heldRef.current = true;
      navigator.vibrate?.(30); // confirm the hold engaged — you can't see it under a thumb
      bump();
      repeatTimer.current = setInterval(bump, REPEAT_MS);
    }, LONG_PRESS_MS);
  }

  function up() {
    const wasHeld = heldRef.current;
    clearTimers();
    if (wasHeld) {
      onSettled(liveRef.current);
      return;
    }
    const next = nextReps(liveRef.current, target);
    liveRef.current = next;
    onSet(next);
    onSettled(next);
  }

  return (
    <button
      className={`set${reps === null ? "" : reps > target ? " over" : reps === target ? " done" : " partial"}`}
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={clearTimers}
      onContextMenu={(e) => e.preventDefault()}
    >
      {reps === null ? target : reps}
    </button>
  );
}

/**
 * A bodyweight set: tap up to the number you managed.
 *
 * The opposite of SetButton, and deliberately so. A loaded barbell has a target
 * you either hit or fall short of, so its circle starts at target and steps
 * down. A set of pull-ups has no target to miss — you do as many as you can and
 * record it — so this starts empty and counts up.
 *
 * Before anything is logged it shows what you managed last time in this slot,
 * greyed, falling back to the planned count when there's no history. That's the
 * number you're chasing, and it's the one thing you certainly won't remember.
 */
function CountButton({
  reps,
  ghost,
  onSet,
  onSettled,
}: {
  reps: number | null;
  ghost: number | null;
  onSet: (reps: number | null) => void;
  onSettled: (reps: number | null) => void;
}) {
  const liveRef = useRef(reps);
  liveRef.current = reps;

  // Long press clears, because you can't tap downwards past zero and a miscount
  // otherwise means cycling all the way round.
  const hold = useLongPress(() => {
    liveRef.current = null;
    onSet(null);
    onSettled(null);
  });

  function tap() {
    if (hold.wasLongPress()) return;
    const next = Math.min(MAX_REPS, (liveRef.current ?? 0) + 1);
    liveRef.current = next;
    onSet(next);
    onSettled(next);
  }

  // Beating or matching last time is worth celebrating; coming in under it is
  // not a failure. A bodyweight set has no target to miss — history and
  // /api/log both say "logged" rather than hit/miss — so colouring it red like
  // a failed barbell set would contradict what the rest of the app says.
  const state =
    reps === null ? "" : ghost === null || reps >= ghost ? (reps > (ghost ?? 0) ? " over" : " done") : " logged";

  return (
    <button
      className={`set count${state}`}
      onPointerDown={hold.onPointerDown}
      onPointerUp={(e) => {
        hold.onPointerUp(e as unknown as PointerEvent);
        tap();
      }}
      onPointerCancel={hold.onPointerCancel}
      onContextMenu={hold.onContextMenu}
    >
      {reps === null ? <span className="ghost">{ghost ?? "–"}</span> : reps}
    </button>
  );
}

/**
 * Competition plate colours, so the loading is recognisable at a glance rather
 * than read as a list of numbers. The micro plates have no standard colour and
 * are drawn as steel.
 */
const PLATE_COLOUR: Record<number, string> = {
  25: "#e2483d",
  20: "#3b6fd4",
  15: "#e8c33c",
  10: "#3fa65c",
  5: "#e8eaed",
  2.5: "#e2483d",
};
const STEEL = "#8d95a3";

const plateColour = (w: number): string => PLATE_COLOUR[w] ?? STEEL;

/** Plate height scaled by weight — the big ones really are much bigger, and the
 *  silhouette is most of what makes this readable in a glance. */
function plateHeight(w: number): number {
  if (w >= 20) return 100;
  if (w >= 15) return 92;
  if (w >= 10) return 84;
  if (w >= 5) return 68;
  if (w >= 2.5) return 52;
  if (w >= 1.25) return 42;
  return 34;
}

/**
 * Held-open view of how to load the bar. Full-screen because this is read at
 * arm's length with a bar in front of you, and the whole point of holding it
 * open is that you're not going to be squinting at a caption.
 */
function PlateOverlay({ exercise }: { exercise: SessionExercise }) {
  const p = exercise.plates!;
  const perSideTotal = p.perSide.reduce((a, b) => a + b, 0);
  const bar = Math.round((p.achievable - perSideTotal * 2) * 100) / 100;

  return (
    <div className="plate-overlay">
      <div className="plate-overlay-inner">
        <div className="po-head">
          <div className="po-name">{exercise.name}</div>
          <div className="po-weight">
            {fmtWeight(p.achievable)}<span>kg</span>
          </div>
          <div className="po-sum">
            {fmtWeight(bar)}kg bar + {fmtWeight(perSideTotal)}kg per side
          </div>
        </div>

        {/* One side of the bar, loaded inside-out — the order you actually put
            them on. Mirroring both sides would look more like a barbell but
            makes you count twice to get a per-side number. */}
        <div className="po-bar">
          <div className="po-sleeve" />
          {p.perSide.map((w, i) => (
            <div
              key={i}
              className="po-plate"
              style={{
                height: `${plateHeight(w)}%`,
                background: plateColour(w),
                color: w === 5 ? "#11151a" : "#fff",
              }}
            >
              <span>{fmtWeight(w)}</span>
            </div>
          ))}
          <div className="po-collar" />
        </div>

        <div className="po-foot">
          {p.shortfall > 0 ? (
            <span className="po-short">
              {fmtWeight(exercise.target_weight)}kg asked for — {fmtWeight(p.shortfall)}kg short of what these plates make
            </span>
          ) : (
            <span>per side · heaviest on first, collar last</span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A dot in the corner, and nothing more.
 *
 * The old text badge said "Saving…" on every single tap, which moved the page
 * and told you nothing. This is fixed-position, so it can never shift layout,
 * and it's always present — a green dot is a useful thing to be able to glance
 * at, where an element that appears and disappears is just movement.
 *
 * green  synced        server has everything
 * yellow pending       local edits not pushed yet
 * orange offline       no connection; held on the phone
 * red    error         server reachable but refusing
 *
 * None of these are urgent. Every state above green still means the session is
 * safe in localStorage — the dot is for reassurance, not action.
 */
const SYNC_LABEL: Record<SyncState, string> = {
  synced: "Synced",
  pending: "Saving…",
  offline: "Offline — saved on this phone",
  error: "Sync failing — saved on this phone",
};

function SyncDot({ state }: { state: SyncState }) {
  return <span className={`sync-dot ${state}`} role="status" aria-label={SYNC_LABEL[state]} title={SYNC_LABEL[state]} />;
}

export type { Session };
