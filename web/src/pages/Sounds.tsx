import { useRef, useState } from "react";
import { keyName, playCue, randomKey, VOICES, VOICE_LABEL, type Voice } from "../useRestTimer";
import { Screen } from "./Screen";

/**
 * Scratch page for auditioning the rest cues. Not in the nav — visit /sounds
 * directly. It exists because the alternative is waiting ninety seconds in a
 * garage to find out whether a sound is any good.
 */
export default function Sounds() {
  const [voice, setVoice] = useState<Voice>("rhodes");
  // Held rather than re-rolled per press, so the two cues can be heard in the
  // same key — which is how they'll actually arrive during a rest.
  const [key, setKey] = useState(() => randomKey());
  const ctxRef = useRef<AudioContext | null>(null);

  function play(which: "ready" | "end") {
    try {
      // Created lazily on a real click, so it's never blocked by autoplay policy.
      const ctx = (ctxRef.current ??= new AudioContext());
      void ctx.resume();
      playCue(ctx, which, voice, key);
    } catch {
      /* no audio on this device */
    }
  }

  return (
    <Screen title="Sounds" sub="scratch page">
      <div className="card" style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: 12 }}>
        {VOICES.map((v) => (
          <button
            key={v}
            className={`pill${voice === v ? " up" : ""}`}
            style={{ cursor: "pointer", background: "none" }}
            onClick={() => setVoice(v)}
          >
            {v}
          </button>
        ))}
      </div>

      <p className="muted small" style={{ marginTop: 0 }}>{VOICE_LABEL[voice]}</p>

      <div className="row" style={{ marginBottom: 12 }}>
        <span className="muted small">
          Key of <strong style={{ color: "var(--text)" }}>{keyName(key)}</strong>
        </span>
        <button
          className="btn ghost"
          style={{ width: "auto", padding: "8px 14px", minHeight: 0 }}
          onClick={() => setKey(randomKey())}
        >
          New key
        </button>
      </div>

      <button className="btn" style={{ marginBottom: 12 }} onClick={() => play("ready")}>
        Early sound — ready
      </button>
      <button className="btn ghost" onClick={() => play("end")}>
        Late sound — time's up
      </button>

      <p className="muted small" style={{ marginTop: 20 }}>
        The early cue fires at <code>rest_ready</code> and turns the clock green.
        The late cue fires at <code>rest_end</code> and stops the timer. Each rest
        picks its own key at random, and both cues share it.
      </p>
      <div style={{ height: 20 }} />
    </Screen>
  );
}
