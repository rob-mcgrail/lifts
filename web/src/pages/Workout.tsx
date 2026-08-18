import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { fmtWeight, plateLabel, sessionLabel, type Session } from "../api";
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
  const [editing, setEditing] = useState<number | null>(null);
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

  function changeWeight(exId: number, weight: number) {
    setEditing(null);
    if (!Number.isFinite(weight) || weight < 0) return;
    mutate((s) => ({
      ...s,
      exercises: s.exercises.map((e) => (e.id !== exId ? e : { ...e, target_weight: weight })),
    }));
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
      <Screen title={sessionLabel(session)} sub={`Session ${session.id}`}>
        <SyncBadge state={sync} />

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
              <div style={{ textAlign: "right" }}>
                {editing === e.id ? (
                  <input
                    type="number"
                    step="0.5"
                    autoFocus
                    defaultValue={e.target_weight}
                    style={{ width: 110, textAlign: "right" }}
                    onBlur={(ev) => changeWeight(e.id, Number(ev.currentTarget.value))}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter") changeWeight(e.id, Number(ev.currentTarget.value));
                      if (ev.key === "Escape") setEditing(null);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => setEditing(e.id)}
                    style={{ background: "none", border: "none", padding: 0, color: "inherit", cursor: "pointer" }}
                  >
                    <div className="weight">
                      {fmtWeight(e.target_weight)}<span>kg</span>
                    </div>
                    {e.plates && (
                      <div className={`plates${e.plates.shortfall > 0 ? " short" : ""}`}>{plateLabel(e.plates)}</div>
                    )}
                  </button>
                )}
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

/** Deliberately quiet. Nothing here is an error you need to act on — the phone
 *  holds the session either way, so this is status, not a warning. */
function SyncBadge({ state }: { state: SyncState }) {
  if (state === "synced") return null;
  const label =
    state === "pending" ? "Saving…" : state === "offline" ? "Offline — saved on this phone" : "Retrying sync…";
  return (
    <div className="muted small" style={{ textAlign: "center", marginBottom: 10 }}>
      {label}
    </div>
  );
}

export type { Session };
