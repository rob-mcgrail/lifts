import { useCallback, useEffect, useState } from "react";
import { api, fmtWeight, plateLabel, sessionLabel, type Loadout, type PlannedExercise, type Session } from "../api";
import { Screen } from "./Screen";

const BLANK: PlannedExercise = { exercise: "", weight: 20, sets: 5, reps: 5 };

export default function Queue() {
  const [queue, setQueue] = useState<Session[] | null>(null);
  const [loadout, setLoadout] = useState<Loadout | null>(null);
  const [known, setKnown] = useState<{ slug: string; name: string }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<PlannedExercise[]>([{ ...BLANK }]);
  const [name, setName] = useState("");

  const load = useCallback(() => {
    api.queue().then(setQueue).catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    api.loadout().then(setLoadout).catch(() => {});
    api.exercises().then(setKnown).catch(() => {});
  }, [load]);

  async function save() {
    const exercises = draft.filter((d) => d.exercise.trim());
    if (!exercises.length) return setErr("Add at least one exercise");
    try {
      await api.plan({ name: name.trim() || undefined, exercises });
      setAdding(false);
      setDraft([{ ...BLANK }]);
      setName("");
      setErr(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function remove(id: number) {
    await api.remove(id).catch((e: Error) => setErr(e.message));
    load();
  }

  function patch(i: number, p: Partial<PlannedExercise>) {
    setDraft((d) => d.map((row, j) => (j === i ? { ...row, ...p } : row)));
  }

  if (!queue) return <Screen title="Queue"><p className="empty">Loading…</p></Screen>;

  return (
    <Screen title="Queue" sub={loadout ? `bar ${loadout.bar}kg · max ${loadout.max_loadable}kg` : undefined}>
      {err && <p className="err">{err}</p>}

      {queue.length === 0 && !adding && (
        <p className="empty">
          Nothing queued.
          <br />
          <span className="small">Sessions run in this order. Add one below or have the model plan them.</span>
        </p>
      )}

      {queue.map((s, i) => (
        <div key={s.id} className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <div>
              <h2>{sessionLabel(s)}</h2>
              <div className="muted small">{i === 0 ? "Up next" : `#${i + 1} in queue`}</div>
            </div>
            <button className="btn danger" style={{ width: "auto", padding: "8px 14px", minHeight: 0 }} onClick={() => remove(s.id)}>
              Remove
            </button>
          </div>
          {s.plan_note && <p className="muted small" style={{ marginTop: 0 }}>{s.plan_note}</p>}
          <table>
            <tbody>
              {s.exercises.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td className="muted small">{e.target_sets}×{e.target_reps}</td>
                  <td className="num">{fmtWeight(e.target_weight)}kg</td>
                  <td className={`num small ${e.plates && e.plates.shortfall > 0 ? "plates short" : "muted"}`}>
                    {plateLabel(e.plates)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {adding ? (
        <div className="card">
          <label>Session name (optional)</label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="Heavy lower" />

          {draft.map((row, i) => (
            <div key={i} style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 10 }}>
              <label>Exercise</label>
              <input
                type="text"
                list="known-exercises"
                value={row.exercise}
                onChange={(e) => patch(i, { exercise: e.target.value })}
                placeholder="squat"
              />
              <div style={{ display: "flex", gap: 10 }}>
                <div style={{ flex: 1 }}>
                  <label>Weight</label>
                  <input
                    type="number"
                    step={loadout?.min_increment ?? 0.5}
                    value={row.weight}
                    onChange={(e) => patch(i, { weight: Number(e.target.value) })}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Sets</label>
                  <input type="number" value={row.sets} onChange={(e) => patch(i, { sets: Number(e.target.value) })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label>Reps</label>
                  <input type="number" value={row.reps} onChange={(e) => patch(i, { reps: Number(e.target.value) })} />
                </div>
              </div>
            </div>
          ))}

          <datalist id="known-exercises">
            {known.map((k) => (
              <option key={k.slug} value={k.slug}>{k.name}</option>
            ))}
          </datalist>

          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <button className="btn ghost" onClick={() => setDraft((d) => [...d, { ...BLANK }])}>Add exercise</button>
            <button className="btn" onClick={save}>Queue it</button>
          </div>
          <button className="btn danger" style={{ marginTop: 10 }} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button className="btn ghost" onClick={() => setAdding(true)}>Plan a session</button>
      )}
      <div style={{ height: 20 }} />
    </Screen>
  );
}
