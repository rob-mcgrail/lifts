import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Rest timer that survives a locked screen as well as the web allows.
 *
 * Two defences, because neither is sufficient alone:
 *  - a Wake Lock keeps the screen alive while the tab is foregrounded;
 *  - a silent looping audio element keeps the page from being frozen when it
 *    isn't, which is what lets the countdown keep running in the background.
 * Elapsed time is always derived from a wall-clock timestamp rather than
 * accumulated ticks, so even if we do get throttled the number stays truthful.
 */
export function useRestTimer() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [duration, setDuration] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const firedRef = useRef(false);
  const wakeRef = useRef<WakeLockSentinel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (endsAt === null) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [endsAt]);

  const releaseKeepAwake = useCallback(() => {
    wakeRef.current?.release().catch(() => {});
    wakeRef.current = null;
    audioRef.current?.pause();
  }, []);

  const acquireKeepAwake = useCallback(async () => {
    try {
      if ("wakeLock" in navigator) {
        wakeRef.current = await navigator.wakeLock.request("screen");
      }
    } catch {
      /* denied or unsupported — the audio keep-alive still applies */
    }
    try {
      if (!audioRef.current) {
        // 0.05s of silence, looped. Enough to count as playing media.
        const a = new Audio(
          "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=",
        );
        a.loop = true;
        a.volume = 0.001;
        audioRef.current = a;
      }
      await audioRef.current.play();
    } catch {
      /* autoplay blocked until a gesture — start() is always gesture-driven */
    }
  }, []);

  const start = useCallback(
    (seconds: number) => {
      firedRef.current = false;
      setDuration(seconds);
      setEndsAt(Date.now() + seconds * 1000);
      setNow(Date.now());
      void acquireKeepAwake();
      if ("Notification" in window && Notification.permission === "default") {
        void Notification.requestPermission();
      }
    },
    [acquireKeepAwake],
  );

  const stop = useCallback(() => {
    setEndsAt(null);
    setDuration(0);
    releaseKeepAwake();
  }, [releaseKeepAwake]);

  const remaining = endsAt === null ? 0 : Math.round((endsAt - now) / 1000);

  // Fire once when it runs out; keep counting up afterwards so you can see how
  // long you actually rested rather than the timer just vanishing.
  useEffect(() => {
    if (endsAt === null || firedRef.current || remaining > 0) return;
    firedRef.current = true;
    releaseKeepAwake();
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    } catch {
      /* no audio context available */
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Rest over", { body: "Next set.", tag: "lifts-rest" });
    }
  }, [endsAt, remaining, releaseKeepAwake]);

  // Re-acquire the wake lock when the tab comes back to the foreground —
  // the browser drops it on hide and does not restore it.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible" && endsAt !== null && remaining > 0) {
        void acquireKeepAwake();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [endsAt, remaining, acquireKeepAwake]);

  useEffect(() => releaseKeepAwake, [releaseKeepAwake]);

  return { running: endsAt !== null, remaining, duration, start, stop };
}

export function fmtClock(seconds: number): string {
  const s = Math.abs(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${seconds < 0 ? "+" : ""}${m}:${String(r).padStart(2, "0")}`;
}
