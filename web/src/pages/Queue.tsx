import { useCallback, useEffect, useState } from "react";
import { api, fmtWeight, sessionLabel, type Loadout, type Session } from "../api";
import { Screen } from "./Screen";

/**
 * Read-only view of what's coming, plus the ability to drop something.
 *
 * There is deliberately no "plan a session" form here. Planning is done through
 * the API — by hand or, more usually, by a model that has read the history —
 * and a cut-down form on a phone would only ever be a worse version of that.
 */
export default function Queue() {
  const [queue, setQueue] = useState<Session[] | null>(null);
  const [loadout, setLoadout] = useState<Loadout | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.queue().then(setQueue).catch((e: Error) => setErr(e.message));
  }, []);

  useEffect(() => {
    load();
    api.loadout().then(setLoadout).catch(() => {});
  }, [load]);

  async function remove(id: number) {
    await api.remove(id).catch((e: Error) => setErr(e.message));
    load();
  }

  if (!queue) return <Screen title="Queue"><p className="empty">Loading…</p></Screen>;

  return (
    <Screen title="Queue" sub={loadout ? `bar ${loadout.bar}kg · max ${loadout.max_loadable}kg` : undefined}>
      {err && <p className="err">{err}</p>}

      {queue.length === 0 && (
        <p className="empty">
          Nothing queued.
          <br />
          <span className="small">Sessions run in this order. Ask the model to plan some.</span>
        </p>
      )}

      {queue.map((s, i) => (
        <div key={s.id} className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <div>
              <h2>{sessionLabel(s)}</h2>
              <div className="muted small">{i === 0 ? "Up next" : `#${i + 1} in queue`}</div>
            </div>
            <button
              className="btn danger"
              style={{ width: "auto", padding: "8px 14px", minHeight: 0 }}
              onClick={() => remove(s.id)}
            >
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
                  {/* The loading belongs at the rack, not in a planning list.
                      Only an unloadable weight is worth the space here, because
                      it means the plan itself is wrong. */}
                  <td className="num small plates short">
                    {e.plates && e.plates.shortfall > 0 ? `${fmtWeight(e.plates.shortfall)}kg short` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <div style={{ height: 20 }} />
    </Screen>
  );
}
