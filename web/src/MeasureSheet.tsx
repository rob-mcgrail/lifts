import { useEffect, useState } from "react";
import { api, relDate, type Measurement } from "./api";

/**
 * Log bodyweight and belly circumference. Same shape as `WalkSheet`: a sheet off
 * Today, a tap to open and a tap to save.
 *
 * Last week's numbers are placeholders, not values. Prefilling them would make
 * "save" without typing record last week again as if it were today — the one
 * mistake a weekly log can't afford, because it reads as a flat week.
 *
 * Belly is three tape readings, averaged here before saving. A tape round the
 * middle moves a centimetre depending on breath and where it sits, and the
 * average is steadier week to week than any one pull. Only the average is
 * stored — the API takes one `belly_cm`, and the readings are a way of getting
 * a better one, not data in their own right.
 */
export function MeasureSheet({ onClose }: { onClose: () => void }) {
  const [last, setLast] = useState<Measurement | null>(null);
  const [weight, setWeight] = useState("");
  const [belly, setBelly] = useState(["", "", ""]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.measurements(1).then((m) => setLast(m[0] ?? null)).catch(() => {});
  }, []);

  const parse = (v: string) => (v.trim() === "" ? undefined : Number(v));
  const bad = (n: number | undefined) => n !== undefined && (!Number.isFinite(n) || n <= 0);
  const kg = parse(weight);
  const readings = belly.map(parse);
  const taken = readings.filter((n): n is number => n !== undefined);
  // All three or none: averaging two readings and calling it three would make
  // weeks quietly incomparable.
  const bellyIncomplete = taken.length > 0 && taken.length < 3;
  const cm = taken.length === 3 ? Math.round((taken.reduce((a, b) => a + b, 0) / 3) * 10) / 10 : undefined;
  const canSave =
    !saving && !bad(kg) && !readings.some(bad) && !bellyIncomplete && (kg !== undefined || cm !== undefined);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      await api.logMeasurement({ bodyweight_kg: kg, belly_cm: cm });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="sheet-scrim" onClick={() => !saving && onClose()}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 4px" }}>Weigh in</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          {last ? `Last taken ${relDate(last.measured_at)}.` : "First one."} Either number on its own is fine.
        </p>

        <label className="field">
          <span style={{ minWidth: 80 }}>Bodyweight</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            placeholder={last?.bodyweight_kg != null ? String(last.bodyweight_kg) : ""}
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
          />
          <span>kg</span>
        </label>

        {/* Readings get their own row: three values around 100cm don't fit
            beside a label at phone width. */}
        <div className="muted small" style={{ marginBottom: 6 }}>Belly · three readings, cm</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginBottom: 16 }} className="field">
          {belly.map((v, i) => (
            <input
              key={i}
              type="number"
              inputMode="decimal"
              step="0.5"
              min="0"
              aria-label={`Belly reading ${i + 1}`}
              placeholder={i === 0 && last?.belly_cm != null ? String(last.belly_cm) : ""}
              value={v}
              onChange={(e) => setBelly(belly.map((b, j) => (j === i ? e.target.value : b)))}
              style={{ minWidth: 0, textAlign: "center" }}
            />
          ))}
        </div>
        <p className="muted small" style={{ marginTop: -8 }}>
          {cm !== undefined
            ? <>Average <b>{cm}cm</b> — that's what gets saved.</>
            : bellyIncomplete
              ? "Three readings, or leave all three empty."
              : "Three tape readings, averaged."}
        </p>

        {err && <p className="err">{err}</p>}

        <button className="btn" onClick={save} disabled={!canSave}>
          {saving ? "Saving…" : "Save"}
        </button>
        <button className="btn ghost" onClick={onClose} disabled={saving} style={{ marginTop: 8 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
