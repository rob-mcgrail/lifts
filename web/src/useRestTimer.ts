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

/**
 * Best-effort notification. Never throws.
 *
 * `new Notification()` is an **illegal constructor on Android Chrome** — it
 * requires ServiceWorkerRegistration.showNotification() instead, and throws a
 * TypeError if you call it directly. Thrown from inside the timer's effect that
 * took React's whole tree down with it: the screen went black mid-session and
 * only a reload brought it back. There is no service worker yet, so on Android
 * this simply does nothing, which is the correct outcome — the tone, the
 * vibration and the colour change are all still there.
 */
function notify(title: string, body: string) {
  try {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    new Notification(title, { body, tag: "lifts-rest" });
  } catch {
    /* Android Chrome, or notifications disabled at the OS level */
  }
}

function requestNotifications() {
  try {
    if ("Notification" in window && Notification.permission === "default") {
      void Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }
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

/**
 * How far the whole rest is transposed, in semitones. Rolled once when a rest
 * starts and reused for both cues, so the ready chord and the ii–V–I that
 * follows it are in the same key — randomising per cue would have them
 * disagree, which sounds like a mistake rather than variety.
 *
 * Range is deliberately narrow. Rhodes gets muddy low and brittle high, and the
 * point is a bit of colour between sessions, not a different instrument.
 */
export function randomKey(): number {
  return Math.floor(Math.random() * 10) - 4; // -4..+5 semitones
}

const NOTE_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "A♭", "A", "B♭", "B"];
export const keyName = (transpose: number) => NOTE_NAMES[(((transpose % 12) + 12) % 12)]!;

export function playCue(ctx: AudioContext, which: "ready" | "end", voice: Voice, transpose = 0) {
  const t = ctx.currentTime + 0.02;
  const shift = Math.pow(2, transpose / 12);

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

    // Transposition is applied in semitones, so the voicing stays intact.
    const up = (chord: number[]) => chord.map((n) => n + transpose);

    if (which === "ready") {
      // Slow roll and a long tail: this one is permission, not an alert, so it
      // gets to unfold and ring out.
      rhodesChord(ctx, bus, t, up(READY_CHORD), 0.3, 5.5, 0.11);
    } else {
      // The ii–V–I moves, so its chords are tighter — a slow roll on each would
      // smear the progression. The resolution still gets a long ring.
      END_CHORDS.forEach((chord, i) =>
        rhodesChord(ctx, bus, t + i * 0.34, up(chord), 0.28, i === 2 ? 5.5 : 1.1, 0.035),
      );
    }
    return;
  }

  if (which === "ready") {
    strike(ctx, t, 587.33 * shift, voice); // D5, transposed
    return;
  }
  const gap = voice === "beep" ? 0.2 : 0.26;
  [587.33, 739.99, 880.0].forEach((f, i) => strike(ctx, t + i * gap, f * shift, voice, 0.24));
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
/**
 * A rest survives a reload. It's wall-clock anyway, so all that's needed is the
 * moment it started and the marks it was running to — and losing ninety seconds
 * of rest because the tab reloaded is exactly the sort of thing that makes you
 * stop trusting the app mid-session.
 */
const REST_KEY = "lifts.rest";

type StoredRest = { startedAt: number; marks: RestMarks; key: number; fired: RestPhase[] };

function persist(startedAt: number, marks: RestMarks, fired: RestPhase[]) {
  try {
    localStorage.setItem(REST_KEY, JSON.stringify({ startedAt, marks, key: 0, fired } satisfies StoredRest));
  } catch {
    /* ignore */
  }
}

function forget() {
  try {
    localStorage.removeItem(REST_KEY);
  } catch {
    /* ignore */
  }
}

function loadRest(): StoredRest | null {
  try {
    const raw = localStorage.getItem(REST_KEY);
    if (!raw) return null;
    const r = JSON.parse(raw) as StoredRest;
    // Only resume something still running; a finished rest is just noise.
    if (typeof r?.startedAt !== "number" || !r.marks) return null;
    if ((Date.now() - r.startedAt) / 1000 >= r.marks.end) {
      localStorage.removeItem(REST_KEY);
      return null;
    }
    return r;
  } catch {
    return null;
  }
}

export function useRestTimer(marks: RestMarks, voice: Voice = "rhodes") {
  const stored = useRef<StoredRest | null>(loadRest());
  const [startedAt, setStartedAt] = useState<number | null>(stored.current?.startedAt ?? null);
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef<Set<RestPhase>>(new Set());
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  // The key this rest is in. Rolled at start() so both cues agree.
  const keyRef = useRef(0);

  // A resumed rest keeps the marks it was started with, not whatever exercise
  // happens to be rendering now.
  const marksRef = useRef(stored.current?.marks ?? marks);
  marksRef.current = stored.current?.marks ?? marks;

  // Don't re-fire a cue that already sounded before the reload.
  if (stored.current) firedRef.current = new Set(stored.current.fired);

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
        playCue(ctx, which, voice, keyRef.current);
      } catch {
        /* no audio available — the vibration and the colour still land */
      }
    },
    [voice],
  );

  const start = useCallback(() => {
    stored.current = null;
    firedRef.current = new Set();
    keyRef.current = randomKey();
    const at = Date.now();
    persist(at, marksRef.current, []);
    setStartedAt(at);
    setNow(Date.now());
    void acquireKeepAwake();
    // Warm the audio context on the gesture that started the rest, so the tone
    // can fire later without a user interaction to unlock it.
    try {
      void (ctxRef.current ??= new AudioContext()).resume();
    } catch {
      /* ignore */
    }
    void requestNotifications();
  }, [acquireKeepAwake]);

  const stop = useCallback(() => {
    stored.current = null;
    forget();
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
      notify("Ready", "Rest is up whenever you are.");
    }

    if (elapsed >= end && !fired.has("done")) {
      fired.add("done");
      tone("end");
      navigator.vibrate?.([180, 120, 180, 120, 180]);
      notify("Back under the bar", "Next set.");
      releaseKeepAwake();
      stored.current = null;
      forget();
      setStartedAt(null);
    } else if (startedAt !== null) {
      persist(startedAt, marksRef.current, [...fired]);
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
