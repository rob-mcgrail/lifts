import { useEffect, useState } from "react";
import { api, fmtWeight, relDate, sessionLabel, type Session } from "../api";
import { Screen } from "./Screen";

/**
 * Fourteen days at a glance — last week on top, this week below, a dot per day
 * and green where something was logged.
 *
 * Weeks start Monday, and everything here is computed in **local** time. The
 * server stores UTC, so a Sunday-evening session in NZ is stored as Monday and
 * would land in the wrong week if the date string were sliced rather than
 * converted.
 */
const DAY_MS = 86_400_000;
const DAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];

function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Monday of the week containing `d`, at local midnight. */
function mondayOf(d: Date): Date {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (m.getDay() + 6) % 7; // getDay: 0 = Sunday
  m.setDate(m.getDate() - shift);
  return m;
}

function TwoWeeks({ sessions }: { sessions: Session[] }) {
  const trained = new Set(
    sessions
      .map((s) => s.finished_at ?? s.started_at)
      .filter((iso): iso is string => Boolean(iso))
      // SQLite hands back "YYYY-MM-DD HH:MM:SS" in UTC; make it explicit before
      // converting, or the browser parses it as local and shifts every date.
      .map((iso) => localDayKey(new Date(iso.replace(" ", "T") + "Z"))),
  );

  const today = new Date();
  const todayKey = localDayKey(today);
  const thisMonday = mondayOf(today);
  const lastMonday = new Date(thisMonday.getTime() - 7 * DAY_MS);

  const week = (start: Date) =>
    Array.from({ length: 7 }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const key = localDayKey(d);
      return { key, trained: trained.has(key), today: key === todayKey, ahead: d.getTime() > today.getTime() };
    });

  return (
    <div className="card weeks">
      <div className="week-labels">
        {DAY_LETTERS.map((l, i) => (
          <span key={i}>{l}</span>
        ))}
      </div>
      {[lastMonday, thisMonday].map((start, w) => (
        <div className="week" key={w}>
          {week(start).map((d) => (
            <i
              key={d.key}
              className={`day${d.trained ? " on" : ""}${d.today ? " now" : ""}${d.ahead ? " ahead" : ""}`}
              title={d.key + (d.trained ? " — trained" : "")}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function History() {
  const [sessions, setSessions] = useState<(Session & { volume: number })[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.history().then(setSessions).catch((e: Error) => setErr(e.message));
  }, []);

  if (err) return <Screen title="History"><p className="err">{err}</p></Screen>;
  if (!sessions) return <Screen title="History"><p className="empty">Loading…</p></Screen>;

  if (!sessions.length) {
    return (
      <Screen title="History">
        <TwoWeeks sessions={[]} />
        <p className="empty">No completed sessions yet.</p>
      </Screen>
    );
  }

  return (
    <Screen title="History" sub={`${sessions.length} sessions`}>
      <TwoWeeks sessions={sessions} />
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
                  {/* An unloaded bodyweight movement isn't "0kg" — that reads
                      like a data error rather than a set of pull-ups. */}
                  <td className="num muted">
                    {e.kind === "bodyweight" && e.target_weight === 0
                      ? "bw"
                      : `${e.kind === "bodyweight" ? "+" : ""}${fmtWeight(e.target_weight)}kg`}
                  </td>
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
