import { useEffect, useState } from "react";
import { api, fmtWeight } from "../api";
import { Screen } from "./Screen";

type Point = { date: string; weight: number; target_reps: number; reps: (number | null)[]; est_1rm: number };

type Best = {
  slug: string;
  name: string;
  weight: number;
  reps: number;
  e1rm: number;
  date: string | null;
  source: string;
};

export default function Progress() {
  const [exercises, setExercises] = useState<{ slug: string; name: string }[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [data, setData] = useState<Point[] | null>(null);
  const [bests, setBests] = useState<Best[]>([]);

  useEffect(() => {
    api.exercises().then((list) => {
      setExercises(list);
      if (list.length) setSlug((s) => s ?? list[0]!.slug);
    });
    api.bests().then(setBests).catch(() => {});
  }, []);

  const best = bests.find((b) => b.slug === slug);

  useEffect(() => {
    if (!slug) return;
    setData(null);
    api.progress(slug).then(setData).catch(() => setData([]));
  }, [slug]);

  return (
    <Screen title="Progress">
      <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 12 }}>
        {exercises.map((e) => (
          <button
            key={e.slug}
            className={`pill${slug === e.slug ? " up" : ""}`}
            style={{ cursor: "pointer", background: "none" }}
            onClick={() => setSlug(e.slug)}
          >
            {e.name}
          </button>
        ))}
      </div>

      {best && (
        <div className="card row">
          <div>
            <div className="muted small">Personal best</div>
            <div className="weight" style={{ fontSize: 24 }}>
              {best.reps} × {fmtWeight(best.weight)}<span>kg</span>
            </div>
          </div>
          <div style={{ textAlign: "right" }}>
            {/* The comparison the pig is based on: every set is scored by its
                estimated one-rep max, so a heavy single and a light set of ten
                are directly comparable. */}
            <div className="pb-e1rm">
              <span className="pb">🐷</span> {fmtWeight(best.e1rm)}kg
            </div>
            <div className="muted small">
              e1RM · {best.source === "baseline" ? "before lifts" : (best.date ?? "").slice(0, 10)}
            </div>
          </div>
        </div>
      )}

      {!data ? (
        <p className="empty">Loading…</p>
      ) : data.length === 0 ? (
        <p className="empty">No completed sessions for this movement yet.</p>
      ) : (
        <>
          <Chart points={data} />
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="num">Weight</th>
                  <th className="num">Reps</th>
                  <th className="num">e1RM</th>
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((p, i) => (
                  <tr key={i}>
                    <td>{p.date.slice(0, 10)}</td>
                    <td className="num">{fmtWeight(p.weight)}kg</td>
                    <td className="num" style={{ letterSpacing: "0.06em" }}>
                      {p.reps.map((r) => (r === null ? "–" : r)).join(" ")}
                    </td>
                    <td className="num muted">{fmtWeight(p.est_1rm)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div style={{ height: 20 }} />
    </Screen>
  );
}

/** Working weight over time. Inline SVG — a chart library is not worth 40kb here. */
function Chart({ points }: { points: Point[] }) {
  const W = 320;
  const H = 140;
  const PAD = 24;
  const weights = points.map((p) => p.weight);
  const min = Math.min(...weights);
  const max = Math.max(...weights);
  const span = max - min || 1;

  const x = (i: number) => PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2);
  const y = (w: number) => H - PAD - ((w - min) / span) * (H - PAD * 2);

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.weight).toFixed(1)}`).join(" ");
  const hit = (p: Point) => p.reps.every((r) => r !== null && r >= p.target_reps);

  return (
    <div className="card">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Working weight over time">
        <line x1={PAD} y1={H - PAD} x2={W - PAD} y2={H - PAD} stroke="var(--line)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle
            key={i}
            cx={x(i)}
            cy={y(p.weight)}
            r="3.5"
            fill={hit(p) ? "var(--accent)" : "var(--fail)"}
          />
        ))}
        <text x={PAD} y={14} fill="var(--muted)" fontSize="11">{fmtWeight(max)}kg</text>
        <text x={PAD} y={H - 6} fill="var(--muted)" fontSize="11">{fmtWeight(min)}kg</text>
      </svg>
      <div className="muted small">Green = all sets hit · red = missed reps</div>
    </div>
  );
}
