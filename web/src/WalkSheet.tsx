import { useState } from "react";
import { api } from "./api";

/**
 * Log a walk that already happened.
 *
 * A sheet rather than a screen, because this is the one thing on Today that
 * isn't "start the session" — it should cost a tap to open and a tap to save,
 * and put you straight back where you were.
 *
 * Minutes are chips rather than a number field on purpose. Typing into a phone
 * one-handed after a walk is exactly the friction that stops a habit coming
 * back, and the durations that actually happen are few enough to list. Distance
 * stays a field: it's the optional half, and the weekend walk is the only one
 * measured that way.
 */
const MINUTES = [15, 20, 30, 45, 60];

export function WalkSheet({ onClose }: { onClose: () => void }) {
  const [surface, setSurface] = useState<"outdoor" | "treadmill">("outdoor");
  const [minutes, setMinutes] = useState<number | null>(30);
  const [km, setKm] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const distance = km.trim() === "" ? undefined : Number(km);
  const badDistance = distance !== undefined && (!Number.isFinite(distance) || distance <= 0);
  // The server needs one or the other; there's no such thing as a walk of no
  // duration and no distance.
  const canSave = !saving && !badDistance && (minutes !== null || distance !== undefined);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setErr(null);
    try {
      await api.logWalk({ surface, minutes: minutes ?? undefined, km: distance });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setSaving(false);
    }
  }

  return (
    <div className="sheet-scrim" onClick={() => !saving && onClose()}>
      <div className="sheet" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ margin: "0 0 4px" }}>Log a walk</h2>
        <p className="muted small" style={{ marginTop: 0 }}>
          Something you've already done. It isn't a session and won't touch the queue.
        </p>

        <div className="chips">
          {(["outdoor", "treadmill"] as const).map((sf) => (
            <button
              key={sf}
              className={`chip${surface === sf ? " on" : ""}`}
              onClick={() => setSurface(sf)}
              aria-pressed={surface === sf}
            >
              {sf === "outdoor" ? "Outdoor" : "Treadmill"}
            </button>
          ))}
        </div>

        <div className="chips">
          {MINUTES.map((m) => (
            <button
              key={m}
              className={`chip${minutes === m ? " on" : ""}`}
              // Tapping the selected duration clears it, for a walk you only
              // know the distance of.
              onClick={() => setMinutes(minutes === m ? null : m)}
              aria-pressed={minutes === m}
            >
              {m} min
            </button>
          ))}
        </div>

        <label className="field">
          <span>Distance</span>
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            min="0"
            placeholder="optional"
            value={km}
            onChange={(e) => setKm(e.target.value)}
          />
          <span>km</span>
        </label>

        {err && <p className="err">{err}</p>}
        {badDistance && <p className="err">Distance must be a number of kilometres.</p>}

        <button className="btn" onClick={save} disabled={!canSave}>
          {saving ? "Saving…" : "Log it"}
        </button>
        <button className="btn ghost" onClick={onClose} disabled={saving} style={{ marginTop: 8 }}>
          Cancel
        </button>
      </div>
    </div>
  );
}
