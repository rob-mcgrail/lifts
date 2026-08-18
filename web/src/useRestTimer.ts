import { useCallback, useEffect, useRef, useState } from "react";

/** Where a rest has got to. */
export type RestPhase = "resting" | "ready" | "done";

export type RestMarks = { ready: number; end: number };

export const VOICES = ["rhodes", "bell", "marimba", "beep"] as const;
export type Voice = (typeof VOICES)[number];

export const VOICE_LABEL: Record<Voice, string> = {
  rhodes: "Rhodes — FM electric piano, plays a chord",
  bell: "Bell — soft, long decay",
  marimba: "Marimba — warm and short",
  beep: "Beep — plain and sharp",
};

type Partial_ = [mult: number, amp: number];

/** Rhodes is excluded: it's FM, not additive, and takes a different path below. */
type SimpleVoice = Exclude<Voice, "rhodes">;

const VOICE_SPEC: Record<SimpleVoice, { partials: Partial_[]; decay: number; attack: number; cutoff: number }> = {
  // Inharmonic partials are what make a bell sound like a bell rather than a
  // sine with a slow release.
  bell: { partials: [[1, 1], [2.76, 0.28], [5.4, 0.1]], decay: 1.5, attack: 0.006, cutoff: 4200 },
  marimba: { partials: [[1, 1], [4, 0.22], [10, 0.05]], decay: 0.5, attack: 0.004, cutoff: 3200 },
  beep: { partials: [[1, 1]], decay: 0.22, attack: 0.002, cutoff: 8000 },
};

/**
 * One struck note. The soft attack matters more than the timbre: ramping the
 * gain from zero over a few milliseconds is the difference between a note and
 * a click, and a hard `setValueAtTime` start is most of why a naive Web Audio
 * beep sounds unpleasant.
 */
function strike(ctx: AudioContext, at: number, freq: number, voice: SimpleVoice, level = 0.26) {
  const spec = VOICE_SPEC[voice];
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = spec.cutoff;
  filter.connect(ctx.destination);

  for (const [mult, amp] of spec.partials) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * mult;
    osc.connect(gain);
    gain.connect(filter);
    // Partials decay faster than the fundamental, as they do on a real bar.
    const decay = spec.decay / (1 + (mult - 1) * 0.35);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(level * amp, at + spec.attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.start(at);
    osc.stop(at + decay + 0.05);
  }
}

/**
 * A genuinely silent WAV of real length, for the background keep-alive.
 *
 * This is built at runtime rather than inlined as a base64 literal because the
 * literal that used to be here declared a `data` chunk of **zero bytes**. Set
 * `loop = true` on a media element with no duration and the browser restarts it
 * as fast as it can cycle — an unbounded loop inside the media pipeline that
 * pegged a core for as long as a rest was running. A silent file only works as
 * a keep-alive if it actually has samples to play.
 */
function silentWavUrl(seconds = 1): string {
  const rate = 8000;
  const samples = rate * seconds;
  const size = 44 + samples * 2;
  const view = new DataView(new ArrayBuffer(size));
  const ascii = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, size - 8, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM header length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true); // byte rate
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, samples * 2, true); // the part that was zero
  // Samples are already zero — an ArrayBuffer starts cleared.

  return URL.createObjectURL(new Blob([view.buffer], { type: "audio/wav" }));
}

const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/**
 * FM electric piano, roughly the DX7 recipe a Rhodes patch is built on:
 *
 *   carrier      sine at the note
 *   modulator    sine at 1:1, deep at the attack and decaying fast — this is
 *                the "bark", and it's what stops it being a plain sine
 *   tine         sine at ~14:1 with a very short decay, for the hammer strike
 *
 * Both modulators feed the carrier's *frequency*, which is the whole trick:
 * the timbre is bright at the attack and mellows as the modulation index falls.
 */
function rhodesNote(ctx: AudioContext, out: AudioNode, at: number, freq: number, level: number, decay: number) {
  const carrier = ctx.createOscillator();
  carrier.type = "sine";
  carrier.frequency.value = freq;

  // Two-stage decay, the way a real tine behaves: a quick drop off the strike,
  // then a long quiet tail. A single exponential to silence either cuts the
  // ring short or leaves the attack sounding soft.
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0, at);
  amp.gain.linearRampToValueAtTime(level, at + 0.006);
  amp.gain.exponentialRampToValueAtTime(level * 0.32, at + Math.min(0.7, decay * 0.18));
  amp.gain.exponentialRampToValueAtTime(0.0001, at + decay);
  carrier.connect(amp);
  amp.connect(out);

  // 1:1 modulator — index falls from deep to almost nothing over ~300ms.
  const mod = ctx.createOscillator();
  mod.type = "sine";
  mod.frequency.value = freq;
  const modIndex = ctx.createGain();
  modIndex.gain.setValueAtTime(freq * 2.4, at);
  modIndex.gain.exponentialRampToValueAtTime(freq * 0.04, at + 0.32);
  mod.connect(modIndex);
  modIndex.connect(carrier.frequency);

  // The tine. Short, bright, and the reason it reads as a Rhodes and not an organ.
  const tine = ctx.createOscillator();
  tine.type = "sine";
  tine.frequency.value = freq * 14;
  const tineIndex = ctx.createGain();
  tineIndex.gain.setValueAtTime(freq * 1.1, at);
  tineIndex.gain.exponentialRampToValueAtTime(freq * 0.001, at + 0.08);
  tine.connect(tineIndex);
  tineIndex.connect(carrier.frequency);

  const stopAt = at + decay + 0.1;
  for (const o of [carrier, mod, tine]) {
    o.start(at);
    o.stop(stopAt);
  }
}

/**
 * Rolled, like a hand rather than a trigger. `roll` is the gap between note
 * starts — big enough to hear as an arpeggio, small enough to still land as one
 * chord. Lower notes come in slightly stronger, as they would under a hand.
 */
function rhodesChord(
  ctx: AudioContext,
  out: AudioNode,
  at: number,
  notes: number[],
  level: number,
  decay: number,
  roll = 0.08,
) {
  notes.forEach((n, i) => {
    // Each successive note a touch quieter, so the roll has a direction.
    const voiceLevel = level * (1 - i * 0.06);
    rhodesNote(ctx, out, at + i * roll, midi(n), voiceLevel, decay);
  });
}

// Cmaj9 with no root — lush and unresolved, which is the right feeling for
// "you may go whenever you like".
const READY_CHORD = [52, 55, 59, 62, 67];

// A ii–V–I. Three events, as before, but they go somewhere: the resolution is
// what says the rest is over, rather than volume.
const END_CHORDS = [
  [50, 57, 60, 65], // Dm9
  [43, 59, 65, 69], // G13
  [48, 55, 64, 71], // Cmaj7
];

export function playCue(ctx: AudioContext, which: "ready" | "end", voice: Voice) {
  const t = ctx.currentTime + 0.02;

  if (voice === "rhodes") {
    // A bus so overlapping notes don't clip — with a long ring and a slow roll
    // the whole chord is sounding at once for several seconds — plus the top
    // taken off, which is most of what makes it sound like an instrument.
    const bus = ctx.createGain();
    bus.gain.value = 0.42;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 5200;
    bus.connect(tone);
    tone.connect(ctx.destination);

    if (which === "ready") {
      // Slow roll and a long tail: this one is permission, not an alert, so it
      // gets to unfold and ring out.
      rhodesChord(ctx, bus, t, READY_CHORD, 0.3, 5.5, 0.11);
    } else {
      // The ii–V–I moves, so its chords are tighter — a slow roll on each would
      // smear the progression. The resolution still gets a long ring.
      END_CHORDS.forEach((chord, i) =>
        rhodesChord(ctx, bus, t + i * 0.34, chord, 0.28, i === 2 ? 5.5 : 1.1, 0.035),
      );
    }
    return;
  }

  if (which === "ready") {
    strike(ctx, t, 587.33, voice); // D5
    return;
  }
  const gap = voice === "beep" ? 0.2 : 0.26;
  [587.33, 739.99, 880.0].forEach((f, i) => strike(ctx, t + i * gap, f, voice, 0.24));
}

/**
 * Rest timer with two marks rather than one deadline.
 *
 *   0 → ready    counting down. You are still recovering.
 *   ready        one tone, clock goes green and starts counting up.
 *   ready → end  green. Go whenever you like.
 *   end          three tones, timer ends.
 *
 * Elapsed time is always derived from a wall-clock timestamp rather than
 * accumulated ticks, so a throttled or suspended tab reports the truth when it
 * wakes rather than however far its interval happened to get.
 *
 * Staying alive with the screen off is the hard part on the web, and there are
 * two defences because neither is sufficient alone: a Wake Lock holds the screen
 * while the tab is foregrounded, and a silent looping audio element keeps the
 * page from being frozen when it isn't.
 */
export function useRestTimer(marks: RestMarks, voice: Voice = "rhodes") {
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef<Set<RestPhase>>(new Set());
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const marksRef = useRef(marks);
  marksRef.current = marks;

  // Tick once per second, scheduled to land just after `elapsed` actually rolls
  // over. A fixed 250ms interval re-rendered the whole workout tree four times
  // a second to update a display that only ever changes once — and drifted, so
  // the number could visibly stall or skip.
  useEffect(() => {
    if (startedAt === null) return;
    let id: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      const intoSecond = (Date.now() - startedAt) % 1000;
      id = setTimeout(tick, 1000 - intoSecond + 15);
    };
    tick();
    return () => clearTimeout(id);
  }, [startedAt]);

  const releaseKeepAwake = useCallback(() => {
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    audioRef.current?.pause();
  }, []);

  // The keep-alive element holds an object URL; drop both on unmount so a long
  // session doesn't accumulate them.
  useEffect(
    () => () => {
      const a = audioRef.current;
      if (!a) return;
      a.pause();
      URL.revokeObjectURL(a.src);
      audioRef.current = null;
    },
    [],
  );

  const acquireKeepAwake = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) wakeRef.current = await navigator.wakeLock.request("screen");
    } catch {
      /* denied or unsupported — the audio keep-alive still applies */
    }
    try {
      if (!audioRef.current) {
        const a = new Audio(silentWavUrl(1));
        a.loop = true;
        a.volume = 0.001;
        audioRef.current = a;
      }
      await audioRef.current.play();
    } catch {
      /* autoplay blocked until a gesture — start() is always gesture-driven */
    }
  }, []);

  const tone = useCallback(
    (which: "ready" | "end") => {
      try {
        const ctx = (ctxRef.current ??= new AudioContext());
        void ctx.resume();
        playCue(ctx, which, voice);
      } catch {
        /* no audio available — the vibration and the colour still land */
      }
    },
    [voice],
  );

  const start = useCallback(() => {
    firedRef.current = new Set();
    setStartedAt(Date.now());
    setNow(Date.now());
    void acquireKeepAwake();
    // Warm the audio context on the gesture that started the rest, so the tone
    // can fire later without a user interaction to unlock it.
    try {
      void (ctxRef.current ??= new AudioContext()).resume();
    } catch {
      /* ignore */
    }
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, [acquireKeepAwake]);

  const stop = useCallback(() => {
    setStartedAt(null);
    releaseKeepAwake();
  }, [releaseKeepAwake]);

  const elapsed = startedAt === null ? 0 : Math.round((now - startedAt) / 1000);
  const phase: RestPhase =
    startedAt === null || elapsed < marks.ready ? "resting" : elapsed < marks.end ? "ready" : "done";

  // Before the ready mark the clock counts down to it; after, it counts up from
  // it — so the number always answers "how far am I from being ready".
  const display = startedAt === null ? 0 : elapsed < marks.ready ? marks.ready - elapsed : elapsed - marks.ready;

  useEffect(() => {
    if (startedAt === null) return;
    const { ready, end } = marksRef.current;
    const fired = firedRef.current;

    if (elapsed >= ready && !fired.has("ready")) {
      fired.add("ready");
      tone("ready");
      navigator.vibrate?.(180);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Ready", { body: "Rest is up whenever you are.", tag: "lifts-rest" });
      }
    }

    if (elapsed >= end && !fired.has("done")) {
      fired.add("done");
      tone("end");
      navigator.vibrate?.([180, 120, 180, 120, 180]);
      if ("Notification" in window && Notification.permission === "granted") {
        new Notification("Back under the bar", { body: "Next set.", tag: "lifts-rest" });
      }
      releaseKeepAwake();
      setStartedAt(null);
    }
  }, [startedAt, elapsed, tone, releaseKeepAwake]);

  // The browser drops the wake lock on hide and does not restore it.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && startedAt !== null) void acquireKeepAwake();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [startedAt, acquireKeepAwake]);

  useEffect(() => releaseKeepAwake, [releaseKeepAwake]);

  return {
    running: startedAt !== null,
    phase,
    display,
    elapsed,
    marks,
    start,
    stop,
  };
}

export function fmtClock(seconds: number): string {
  const s = Math.max(0, Math.abs(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
