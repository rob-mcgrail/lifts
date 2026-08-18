import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fmtWeight, sessionLabel, type Session, type SessionExercise } from "../api";
import { useLiveSession, type SyncState } from "../useLiveSession";
import { fmtClock, useRestTimer } from "../useRestTimer";
import { Screen } from "./Screen";

/**
 * Tap cycle for a set: untouched → target reps → target-1 → … → 0 → untouched.
 * One thumb, no keyboard, no modal — you've just put the bar down.
 */
function nextReps(current: number | null, target: number): number | null {
  if (current === null) return target;
  if (current <= 0) return null;
  return current - 1;
}

const REST_HIT = 90;
const REST_MISS = 300;

export default function Workout() {
  const { id } = useParams();
  const sessionId = Number(id);
  const { session, sync, error, mutate, finish } = useLiveSession(sessionId);
  const [done, setDone] = useState(false);
  // The exercise whose plate loading is being held open, if any.
  const [held, setHeld] = useState<SessionExercise | null>(null);
  const timer = useRestTimer();
  const nav = useNavigate();

  // Every one of these is a local edit. Nothing here awaits the network.
  function tap(exId: number, setId: number, current: number | null, target: number) {
    const reps = nextReps(current, target);
    mutate((s) => ({
      ...s,
      exercises: s.exercises.map((e) =>
        e.id !== exId ? e : { ...e, sets: e.sets.map((x) => (x.id === setId ? { ...x, reps } : x)) },
      ),
    }));
    if (reps === null) timer.stop();
    else timer.start(reps < target ? REST_MISS : REST_HIT);
  }

  async function onFinish() {
    timer.stop();
    setDone(true); // local state is authoritative; the push happens behind this
    await finish();
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

  return (
    <>
      <Screen title={sessionLabel(session)}>
        <SyncDot state={sync} />

        {session.exercises.map((e) => (
          <div key={e.id} className="card">
            <div className="row">
              <div>
                <h2>{e.name}</h2>
                <div className="muted small">
                  {e.target_sets}×{e.target_reps}
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
                  <div className="weight">
                    {fmtWeight(e.target_weight)}<span>kg</span>
                  </div>
                  {e.plates && e.plates.shortfall > 0 && (
                    <div className="plates short">can't load · {fmtWeight(e.plates.shortfall)}kg short</div>
                  )}
                </button>
              </div>
            </div>

            <div className="sets">
              {e.sets.map((s) => (
                <button
                  key={s.id}
                  className={`set${s.reps === null ? "" : s.reps >= e.target_reps ? " done" : " partial"}`}
                  onClick={() => tap(e.id, s.id, s.reps, e.target_reps)}
                >
                  {s.reps === null ? e.target_reps : s.reps}
                </button>
              ))}
            </div>
          </div>
        ))}

        <button className="btn" onClick={onFinish}>
          {allLogged ? "Finish session" : "Finish early"}
        </button>
        <div style={{ height: 100 }} />
      </Screen>

      {held?.plates && <PlateOverlay exercise={held} />}

      {timer.running && (
        <div className={`rest${timer.remaining <= 0 ? " over" : ""}`}>
          <div className="rest-inner">
            <div>
              <div className="rest-time">{fmtClock(timer.remaining)}</div>
              <div className="muted small">{timer.remaining <= 0 ? "Rest over" : "Resting"}</div>
            </div>
            <button
              className="btn ghost"
              style={{ width: "auto", padding: "12px 18px", minHeight: 0 }}
              onClick={timer.stop}
            >
              Skip
            </button>
          </div>
          <div className="rest-bar">
            <i style={{ width: `${Math.max(0, Math.min(100, (timer.remaining / timer.duration) * 100))}%` }} />
          </div>
        </div>
      )}
    </>
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
