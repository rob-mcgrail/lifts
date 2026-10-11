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
      <BodyChart weight={series("bodyweight_kg")} belly={series("belly_cm")} />
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

const W = 320;
const H = 160;
const PAD = 30;

const time = (p: TrendPoint) => new Date(p.date.replace(" ", "T") + "Z").getTime();

/**
 * Bodyweight and belly on one chart, so you can see whether they move together.
 *
 * Two units, so two axes — kg labelled on the left, cm on the right — with
 * equal spans (see below), so slopes are comparable. The point is to see
 * whether they move together, which overlaying shows and side-by-side charts
 * don't.
 *
 * X is real time rather than entry index: weigh-ins are roughly weekly with
 * gaps, and evenly spaced points would draw a missed month as one steep week.
 * Both lines share the time axis, so a week with only one number still lines up.
 */
function BodyChart({ weight, belly }: { weight: TrendPoint[]; belly: TrendPoint[] }) {
  const all = [...weight, ...belly];
  if (all.length === 0) return null;
  const t0 = Math.min(...all.map(time));
  const tSpan = Math.max(...all.map(time)) - t0;
  const x = (p: TrendPoint) => (tSpan === 0 ? W / 2 : PAD + ((time(p) - t0) / tSpan) * (W - PAD * 2));

  // Fixed frames rather than ones fitted to the data, so a line's height means
  // something: where you are within your realistic range, not just which way
  // this month went. Bodyweight 75–95kg (75 as a teenager, 92 at his heaviest);
  // belly 90–110cm. Both span 20, so 1kg and 1cm draw the same slope. A frame
  // only grows if a reading lands outside it, and then both grow together so
  // the slopes stay comparable.
  const WEIGHT = { lo: 75, hi: 95 };
  const BELLY = { lo: 90, hi: 110 };
  const overshoot = (points: TrendPoint[], f: { lo: number; hi: number }) => {
    const values = points.map((p) => p.value);
    return values.length ? Math.max(0, f.lo - Math.min(...values), Math.max(...values) - f.hi) : 0;
  };
  const grow = Math.ceil(Math.max(overshoot(weight, WEIGHT), overshoot(belly, BELLY)));
  const scale = (f: { lo: number; hi: number }) => {
    const lo = f.lo - grow;
    const span = f.hi - f.lo + grow * 2;
    return { lo, hi: lo + span, y: (v: number) => H - PAD - ((v - lo) / span) * (H - PAD * 2) };
  };

  const series = [
    { label: "Bodyweight", unit: "kg", colour: "var(--accent)", points: weight, side: "left" as const, frame: WEIGHT },
    { label: "Belly", unit: "cm", colour: "var(--belly)", points: belly, side: "right" as const, frame: BELLY },
  ].filter((s) => s.points.length > 0);

  return (
    <div className="card">
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, marginBottom: 6 }}>
        {series.map((s) => {
          const first = s.points[0]!;
          const last = s.points[s.points.length - 1]!;
          const delta = Math.round((last.value - first.value) * 10) / 10;
          return (
            <div key={s.label} className="small" style={{ textAlign: s.side }}>
              <div className="muted">
                <span style={{ color: s.colour }}>●</span> {s.label}
              </div>
              <b>{fmtWeight(last.value)}{s.unit}</b>
              {s.points.length > 1 && (
                <span className="muted"> · {delta > 0 ? "+" : ""}{fmtWeight(delta)}{s.unit}</span>
              )}
            </div>
          );
        })}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Bodyweight and belly over time">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--line)" />
        {series.map((s) => {
          const { lo, hi, y } = scale(s.frame);
          const line = s.points.map((p, i) => `${i === 0 ? "M" : "L"}${x(p).toFixed(1)},${y(p.value).toFixed(1)}`).join(" ");
          const tx = s.side === "left" ? 2 : W - 2;
          const anchor = s.side === "left" ? "start" : "end";
          return (
            <g key={s.label}>
              <path d={line} fill="none" stroke={s.colour} strokeWidth="2" strokeLinejoin="round" />
              {s.points.map((p, i) => (
                <circle key={i} cx={x(p)} cy={y(p.value)} r="3.5" fill={s.colour} />
              ))}
              <text x={tx} y={14} fill={s.colour} fontSize="11" textAnchor={anchor}>{fmtWeight(Math.round(hi * 10) / 10)}{s.unit}</text>
              <text x={tx} y={H - 6} fill={s.colour} fontSize="11" textAnchor={anchor}>{fmtWeight(Math.round(lo * 10) / 10)}{s.unit}</text>
            </g>
          );
        })}
      </svg>
      <div className="muted small">
        {(() => {
          const ts = all.map(time);
          const d = (n: number) => new Date(n).toISOString().slice(0, 10);
          return `${d(Math.min(...ts))} → ${d(Math.max(...ts))}`;
        })()}
      </div>
    </div>
  );
}
