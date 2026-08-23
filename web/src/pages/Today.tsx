import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api, fmtWeight, relDate, sessionLabel, type Today as TodayData, type WalkSummary } from "../api";
import { WalkSheet } from "../WalkSheet";
import { Screen } from "./Screen";

export default function Today() {
  const [data, setData] = useState<TodayData | null>(null);
  const [walks, setWalks] = useState<WalkSummary | null>(null);
  const [sheet, setSheet] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();

  const loadWalks = useCallback(() => {
    // Walking is a side panel on this screen, not the point of it. If the
    // request fails the session still has to be startable, so this never
    // becomes a page error.
    api
      .walks(1)
      .then((r) => setWalks(r.summary))
      .catch(() => {});
  }, []);

  useEffect(() => {
    api.today().then(setData).catch((e: Error) => setErr(e.message));
    loadWalks();
  }, [loadWalks]);

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

  /**
   * Logging a walk and starting a session are two different things, and the UI
   * says so. A walk is never queued, never planned here, and doesn't touch the
   * session in front of you — so it's a secondary button, always available,
   * including on a day with nothing queued at all. That last part is the point:
   * most walks happen on days you aren't lifting.
   */
  const walkControls = (
    <>
      {walks && (
        <div className="card walk-stat">
          <b>
            {walks.last_7_days.walks} {walks.last_7_days.walks === 1 ? "walk" : "walks"}
          </b>
          <span>
            {walks.last_7_days.minutes > 0 && <>{walks.last_7_days.minutes} min · </>}
            last 7 days
          </span>
        </div>
      )}
      <button className="btn walk" onClick={() => setSheet(true)}>
        Log a walk
      </button>
    </>
  );

  const sheetEl = sheet && (
    <WalkSheet
      onClose={() => setSheet(false)}
      onLogged={loadWalks}
    />
  );

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
        {walkControls}
        <div style={{ height: 20 }} />
        {sheetEl}
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
            {/* No plate breakdown here — this screen is a preview of what's
                coming, not something you read at the rack. It only earns its
                space once the session has started. The exception is a weight
                the bar can't actually be loaded to, which you want to know
                about before you walk over to it. */}
            <div style={{ textAlign: "right" }}>
              <div className="weight">
                {fmtWeight(e.target_weight)}<span>kg</span>
              </div>
              {e.plates && e.plates.shortfall > 0 && (
                <div className="plates short">
                  can't load · {fmtWeight(e.plates.shortfall)}kg short
                </div>
              )}
            </div>
          </div>
        </div>
      ))}

      {/* A walk planned as part of the session is previewed with the lifts,
          because that's what it is — an item in the session, not a separate
          errand. Logging one from here would be the wrong move: you tick it off
          inside the workout, like every other item. */}
      {s.walks.map((w) => (
        <div key={w.id} className="card walk">
          <div className="row">
            <div>
              <h2>{w.surface === "treadmill" ? "Treadmill walk" : "Walk"}</h2>
              <div className="muted small">
                {w.note ?? "after the lifting"}
              </div>
            </div>
            <div style={{ textAlign: "right" }} className="muted small">
              {w.target_minutes !== null && <div>{w.target_minutes} min</div>}
              {w.target_km !== null && <div>{w.target_km}km</div>}
              {w.incline_pct !== null && w.incline_pct > 0 && <div>{w.incline_pct}% incline</div>}
            </div>
          </div>
        </div>
      ))}

      <button className="btn" onClick={() => start(s.id)} disabled={busy}>
        {busy ? "Starting…" : "Start session"}
      </button>
      {data.queued > 1 && <p className="muted small" style={{ textAlign: "center" }}>{data.queued - 1} more queued</p>}

      {walkControls}
      <div style={{ height: 20 }} />
      {sheetEl}
    </Screen>
  );
}
