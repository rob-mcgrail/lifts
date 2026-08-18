import { useEffect, useState } from "react";
import { api, fmtWeight, relDate, sessionLabel, type Session } from "../api";
import { Screen } from "./Screen";

export default function History() {
  const [sessions, setSessions] = useState<(Session & { volume: number })[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.history().then(setSessions).catch((e: Error) => setErr(e.message));
  }, []);

  if (err) return <Screen title="History"><p className="err">{err}</p></Screen>;
  if (!sessions) return <Screen title="History"><p className="empty">Loading…</p></Screen>;
  if (!sessions.length) return <Screen title="History"><p className="empty">No completed sessions yet.</p></Screen>;

  return (
    <Screen title="History" sub={`${sessions.length} sessions`}>
      {sessions.map((s) => (
        <div key={s.id} className="card">
          <div className="row" style={{ marginBottom: 8 }}>
            <div>
              <h2>{sessionLabel(s)}</h2>
              <div className="muted small">{relDate(s.finished_at)}</div>
            </div>
            <span className="pill">{s.volume.toLocaleString()} kg</span>
          </div>
          <table>
            <tbody>
              {s.exercises.map((e) => (
                <tr key={e.id}>
                  <td>{e.name}</td>
                  <td className="num">{fmtWeight(e.target_weight)}kg</td>
                  <td className="num" style={{ letterSpacing: "0.06em" }}>
                    {e.sets.map((x) => (x.reps === null ? "–" : x.reps)).join(" ")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {s.notes && <p className="muted small" style={{ marginBottom: 0 }}>{s.notes}</p>}
        </div>
      ))}
      <div style={{ height: 20 }} />
    </Screen>
  );
}
