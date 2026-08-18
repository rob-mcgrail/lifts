import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Session, type SessionState } from "./api";

export type SyncState = "synced" | "pending" | "offline" | "error";

const KEY = (id: number) => `lifts.session.${id}`;
const DEBOUNCE_MS = 900;
const HEARTBEAT_MS = 15_000;

type Stored = { session: Session; dirtyAt: number; fingerprint: string };

/**
 * Identifies the *server-side* session a cached copy belongs to, not just its
 * id. Ids are reused whenever the database is rebuilt or restored, and a cache
 * keyed on id alone will happily flush one session's sets over an unrelated
 * session that happens to have inherited the number. `created_at` is assigned
 * server-side at insert and never changes, so id + created_at pins it.
 */
function fingerprint(s: Session): string {
  return `${s.id}:${s.created_at}`;
}

function load(id: number): Stored | null {
  try {
    const raw = localStorage.getItem(KEY(id));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    return parsed?.session && parsed.fingerprint ? parsed : null;
  } catch {
    return null;
  }
}

function save(id: number, session: Session, dirtyAt: number) {
  try {
    localStorage.setItem(
      KEY(id),
      JSON.stringify({ session, dirtyAt, fingerprint: fingerprint(session) } satisfies Stored),
    );
  } catch {
    /* storage full or blocked — the in-memory copy still works for this session */
  }
}

function drop(id: number) {
  try {
    localStorage.removeItem(KEY(id));
  } catch {
    /* ignore */
  }
}

/** The state the server needs. Sent whole, every time, so it's idempotent. */
function payload(s: Session): SessionState {
  return {
    status: s.status === "planned" ? "active" : s.status,
    notes: s.notes ?? undefined,
    exercises: s.exercises.map((e) => ({
      id: e.id,
      target_weight: e.target_weight,
      sets: e.sets.map((x) => ({ id: x.id, reps: x.reps })),
    })),
  };
}

/**
 * Owns the state of a live session on the client.
 *
 * Every tap lands in local state instantly and is written to localStorage, so
 * the phone is the source of truth for the session you're in the middle of.
 * The whole session state is then pushed to the server on a debounce, on a
 * heartbeat, when the tab comes back, and when the network returns. Because the
 * push is total state rather than a delta, a failed request needs no queue and
 * no replay — the next successful push simply carries everything.
 */
export function useLiveSession(id: number) {
  const [session, setSession] = useState<Session | null>(() => load(id)?.session ?? null);
  const [sync, setSync] = useState<SyncState>("synced");
  const [error, setError] = useState<string | null>(null);

  const dirtyRef = useRef(false);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionRef = useRef<Session | null>(session);
  sessionRef.current = session;

  const flush = useCallback(async () => {
    const current = sessionRef.current;
    if (!current || !dirtyRef.current || inFlightRef.current) return;
    if (!navigator.onLine) {
      setSync("offline");
      return;
    }

    inFlightRef.current = true;
    // Cleared before the request, not after: an edit made while this one is in
    // flight must leave the flag set so it gets pushed by the next flush.
    dirtyRef.current = false;

    try {
      await api.syncState(current.id, payload(current));
      setSync(dirtyRef.current ? "pending" : "synced");
      setError(null);
    } catch (e) {
      dirtyRef.current = true; // nothing was persisted — try again
      setSync(navigator.onLine ? "error" : "offline");
      setError((e as Error).message);
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  /** Apply a local change immediately, then schedule a push. */
  const mutate = useCallback(
    (fn: (s: Session) => Session) => {
      setSession((prev) => {
        if (!prev) return prev;
        const next = fn(prev);
        dirtyRef.current = true;
        save(next.id, next, Date.now());
        return next;
      });
      setSync("pending");
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), DEBOUNCE_MS);
    },
    [flush],
  );

  // Initial load.
  //
  // Local state wins over the server's copy — it is by definition newer and may
  // hold sets that were never pushed. But it only wins once we've confirmed it
  // describes the *same* session: a cache left behind by a rebuilt or restored
  // database can carry the same id as a completely different session, and
  // flushing it would overwrite real history. So the cache is shown immediately
  // (offline has to work) but is not allowed to push until it's been matched
  // against the server, and is discarded outright if it doesn't match.
  useEffect(() => {
    let cancelled = false;
    const cached = load(id);
    if (cached) setSession(cached.session);

    api
      .session(id)
      .then((fresh) => {
        if (cancelled) return;
        if (!cached) {
          setSession(fresh);
          save(id, fresh, 0);
          return;
        }
        if (cached.fingerprint === fingerprint(fresh)) {
          // Same session — the local copy is ahead, so push what it holds.
          dirtyRef.current = true;
          void flush();
        } else {
          // Same id, different session. The cache is from another database
          // generation and must not reach the server.
          drop(id);
          setSession(fresh);
          save(id, fresh, 0);
          setError(null);
        }
      })
      .catch((e: Error) => {
        if (cancelled) return;
        if (cached) {
          // Can't validate while offline. The overwhelmingly likely case is that
          // the cache is genuine and mid-session, so let it sync when we're back.
          dirtyRef.current = true;
        } else {
          setError(e.message);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [id, flush]);

  // Heartbeat, plus the moments most likely to follow a dead patch of wifi.
  useEffect(() => {
    const beat = setInterval(() => void flush(), HEARTBEAT_MS);
    const onOnline = () => void flush();
    const onVisible = () => document.visibilityState === "visible" && void flush();
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", () => setSync("offline"));
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(beat);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [flush]);

  // Last-gasp push when the page goes away — beacons survive unload.
  useEffect(() => {
    const onHide = () => {
      const current = sessionRef.current;
      if (!current || !dirtyRef.current) return;
      navigator.sendBeacon?.(
        `/api/sessions/${current.id}/state`,
        new Blob([JSON.stringify(payload(current))], { type: "application/json" }),
      );
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  /** Finish: push synchronously so the queue and history are correct before we
   *  leave the screen, but never block on it — local state already says done. */
  const finish = useCallback(async () => {
    mutate((s) => ({ ...s, status: "done" }));
    await new Promise((r) => setTimeout(r, 0));
    dirtyRef.current = true;
    await flush();
    drop(id);
  }, [flush, id, mutate]);

  return { session, sync, error, mutate, flush, finish };
}
