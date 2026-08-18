import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtWeight, plateLabel, relDate, sessionLabel, type Today as TodayData } from "../api";
import { Screen } from "./Screen";

export default function Today() {
  const [data, setData] = useState<TodayData | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    api.today().then(setData).catch((e: Error) => setErr(e.message));
  }, []);

  // An in-progress session always wins — you walked away mid-workout, go back.
  useEffect(() => {
    if (data?.state === "in_progress") nav(`/workout/${data.session.id}`, { replace: true });
  }, [data, nav]);

  async function start(id: number) {
    setBusy(true);
    try {
      await api.start(id);
      nav(`/workout/${id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  if (err) return <Screen title="Today"><p className="err">{err}</p></Screen>;
  if (!data) return <Screen title="Today"><p className="empty">Loading…</p></Screen>;
  if (data.state === "in_progress") return <Screen title="Today"><p className="empty">Resuming…</p></Screen>;

  if (data.state === "empty") {
    return (
      <Screen title="Today">
        <p className="empty">
          Nothing queued.
          <br />
          <span className="small">Plan a session on the Queue tab, or have the model add one.</span>
        </p>
      </Screen>
    );
  }

  const s = data.session;
  return (
    <Screen
      title={sessionLabel(s)}
      sub={data.last?.finished_at ? `Last ${relDate(data.last.finished_at)}` : "First session"}
    >
      {s.plan_note && <div className="card small muted">{s.plan_note}</div>}

      {s.exercises.map((e) => (
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
              <div className="weight">
                {fmtWeight(e.target_weight)}<span>kg</span>
              </div>
              {e.plates && (
                <div className={`plates${e.plates.shortfall > 0 ? " short" : ""}`}>
                  {plateLabel(e.plates)}
                  {e.plates.shortfall > 0 && ` · ${fmtWeight(e.plates.shortfall)}kg short`}
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      <button className="btn" onClick={() => start(s.id)} disabled={busy}>
        {busy ? "Starting…" : "Start session"}
      </button>
      {data.queued > 1 && <p className="muted small" style={{ textAlign: "center" }}>{data.queued - 1} more queued</p>}
      <div style={{ height: 20 }} />
    </Screen>
  );
}
