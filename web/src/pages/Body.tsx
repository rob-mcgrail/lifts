import { useEffect, useState } from "react";
import { api, fmtWeight, type Measurement } from "../api";

/**
 * Bodyweight and belly over time. Rendered inside Progress rather than as its
 * own tab: it's one more thing you look back on, and the nav is for things you
 * do. There is no goal line — the app records, it doesn't set targets.
 */
export function BodyView() {
  const [rows, setRows] = useState<Measurement[] | null>(null);

  const load = () => api.measurements().then(setRows).catch(() => setRows([]));
  useEffect(() => {
    load();
  }, []);

  async function remove(m: Measurement) {
    if (!confirm(`Delete the ${m.measured_at.slice(0, 10)} measurement?`)) return;
    await api.deleteMeasurement(m.id).catch(() => {});
    load();
  }

  if (!rows) return <p className="empty">Loading…</p>;
  if (rows.length === 0) {
    return (
      <p className="empty">
        Nothing logged yet.
        <br />
        <span className="small">Weigh in from the Today tab.</span>
      </p>
    );
  }

  // The API answers newest first; charts read left to right.
  const asc = [...rows].reverse();
  const series = (key: "bodyweight_kg" | "belly_cm") =>
    asc.filter((m) => m[key] !== null).map((m) => ({ date: m.measured_at, value: m[key]! }));

  return (
    <>
      <TrendChart label="Bodyweight" unit="kg" points={series("bodyweight_kg")} />
      <TrendChart label="Belly" unit="cm" points={series("belly_cm")} />
      <div className="card">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th className="num">Weight</th>
              <th className="num">Belly</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((m) => (
              <tr key={m.id}>
                <td>{m.measured_at.slice(0, 10)}</td>
                <td className="num">{m.bodyweight_kg === null ? "—" : `${fmtWeight(m.bodyweight_kg)}kg`}</td>
                <td className="num">{m.belly_cm === null ? "—" : `${fmtWeight(m.belly_cm)}cm`}</td>
                <td className="num">
                  <button
                    onClick={() => remove(m)}
                    aria-label="Delete"
                    style={{ background: "none", border: "none", color: "var(--muted)", font: "inherit", cursor: "pointer" }}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

type TrendPoint = { date: string; value: number };

/**
 * One measurement over time. X is real time rather than entry index: weigh-ins
 * are roughly weekly with gaps, and evenly spaced points would draw a missed
 * month as one steep week.
 */
function TrendChart({ label, unit, points }: { label: string; unit: string; points: TrendPoint[] }) {
  if (points.length === 0) return null;
  const W = 320;
  const H = 140;
  const PAD = 24;

  const t = (p: TrendPoint) => new Date(p.date.replace(" ", "T") + "Z").getTime();
  const t0 = t(points[0]!);
  const tSpan = t(points[points.length - 1]!) - t0 || 1;
  const values = points.map((p) => p.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // Pad a flat series so a run of identical weigh-ins draws mid-chart, not on the axis.
  const lo = max === min ? min - 1 : min;
  const span = max === min ? 2 : max - min;

  const x = (p: TrendPoint) => (points.length === 1 ? W / 2 : PAD + ((t(p) - t0) / tSpan) * (W - PAD * 2));
  const y = (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const delta = last.value - first.value;

  return (
    <div className="card">
      <div className="row" style={{ marginBottom: 6 }}>
        <div className="muted small">{label}</div>
        <div className="small">
          <b>{fmtWeight(last.value)}{unit}</b>
          {points.length > 1 && (
            <span className="muted">
              {" "}· {delta > 0 ? "+" : ""}{fmtWeight(Math.round(delta * 10) / 10)}{unit} since {first.date.slice(0, 10)}
            </span>
          )}
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label={`${label} over time`}>
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--line)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={i} cx={x(p)} cy={y(p.value)} r="3.5" fill="var(--accent)" />
        ))}
        <text x={PAD} y={14} fill="var(--muted)" fontSize="11">{fmtWeight(max)}{unit}</text>
        <text x={PAD} y={H - 6} fill="var(--muted)" fontSize="11">{fmtWeight(min)}{unit}</text>
      </svg>
    </div>
  );
}
