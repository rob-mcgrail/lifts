export type Plates = { perSide: number[]; achievable: number; shortfall: number };

export type SetRow = {
  id: number;
  idx: number;
  reps: number | null;
  weight: number | null;
  completed_at: string | null;
};

export type SessionExercise = {
  id: number;
  exercise_id: number;
  slug: string;
  name: string;
  kind: string;
  position: number;
  target_weight: number;
  target_sets: number;
  target_reps: number;
  note: string | null;
  rest_ready: number | null;
  rest_end: number | null;
  /** Resolved by the server: exercise override, else session, else global. */
  rest: { ready: number; end: number };
  /** What you managed last time. Only populated for bodyweight movements, and
   *  only on the screens that show it. */
  previous: { date: string; reps: (number | null)[] } | null;
  /** This row's best set beat every earlier one, and the baseline. */
  pb: boolean;
  sets: SetRow[];
  plates: Plates | null;
};

/**
 * A walk. Either standalone — the daily walk, logged from Today — or an item
 * planned inside a session and ticked off during it.
 *
 * `target_*` is the plan, the bare fields are what happened, and
 * `performed_at === null` means it hasn't been done yet.
 */
export type Walk = {
  id: number;
  session_id: number | null;
  position: number;
  surface: string;
  target_minutes: number | null;
  target_km: number | null;
  incline_pct: number | null;
  minutes: number | null;
  km: number | null;
  note: string | null;
  performed_at: string | null;
  created_at: string;
};

export type WalkSummary = {
  last_7_days: { walks: number; minutes: number; km: number };
  last_28_days: { walks: number; minutes: number; km: number };
  recent: Walk[];
};

export type SessionStatus = "planned" | "active" | "done";

export type Session = {
  id: number;
  name: string;
  status: SessionStatus;
  position: number;
  plan_note: string | null;
  notes: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  rest_ready: number | null;
  rest_end: number | null;
  exercises: SessionExercise[];
  walks: Walk[];
};

export type Today =
  | { state: "in_progress"; session: Session }
  | { state: "ready"; session: Session; queued: number; last: Session | null }
  | { state: "empty"; queued: 0 };

/** The total-state payload a live session pushes. See useLiveSession. */
export type SessionState = {
  status: SessionStatus;
  notes?: string;
  exercises: { id: number; target_weight: number; sets: { id: number; reps: number | null }[] }[];
  /** A walk in a session is ticked off mid-workout, so it rides the same push. */
  walks: { id: number; minutes: number | null; km: number | null; done: boolean }[];
};

export type Loadout = {
  bar: number;
  plates: { weight: number; perSide: number }[];
  min_increment: number;
  max_loadable: number;
};

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  today: () => req<Today>("/today"),
  loadout: () => req<Loadout>("/loadout"),
  exercises: () => req<{ id: number; slug: string; name: string }[]>("/exercises"),

  queue: () => req<Session[]>("/queue"),
  history: (limit = 50) => req<(Session & { volume: number })[]>(`/history?limit=${limit}`),
  session: (id: number) => req<Session>(`/sessions/${id}`),

  start: (id: number) => req<Session>(`/sessions/${id}/start`, { method: "POST" }),
  reset: (id: number) => req<Session>(`/sessions/${id}/reset`, { method: "POST" }),

  /** Append a set mid-session. Needs the network — a new row needs an id, and
   *  the state sync only ever updates rows it can already see. */
  addSet: (sessionExerciseId: number) =>
    req<SetRow>(`/session-exercises/${sessionExerciseId}/sets`, { method: "POST" }),
  remove: (id: number) => req<{ ok: true }>(`/sessions/${id}`, { method: "DELETE" }),

  /**
   * Push the whole state of a live session. Idempotent, so a retry just carries
   * whatever is current — this is the only write the workout screen makes, and
   * it replaces the per-set and per-exercise endpoints the app used to call.
   */
  syncState: (id: number, state: SessionState) =>
    req<Session>(`/sessions/${id}/state`, { method: "PUT", body: JSON.stringify(state) }),

  walks: (limit = 60) => req<{ summary: WalkSummary; walks: Walk[] }>(`/walks?limit=${limit}`),

  /** Log a walk that already happened. Not a session, and never becomes one. */
  logWalk: (w: { minutes?: number; km?: number; surface?: string; incline_pct?: number; note?: string }) =>
    req<Walk>("/walks", { method: "POST", body: JSON.stringify(w) }),

  deleteWalk: (id: number) => req<{ ok: true }>(`/walks/${id}`, { method: "DELETE" }),

  settings: () => req<Record<string, string>>("/settings"),
  bests: () =>
    req<{ slug: string; name: string; weight: number; reps: number; e1rm: number; date: string | null; source: string }[]>(
      "/bests",
    ),

  progress: (slug: string) =>
    req<{ session_id: number; date: string; weight: number; target_reps: number; reps: (number | null)[]; est_1rm: number }[]>(
      `/progress/${slug}`,
    ),
};

export function fmtWeight(w: number): string {
  return Number.isInteger(w) ? String(w) : String(Math.round(w * 100) / 100);
}

export function relDate(iso: string | null): string {
  if (!iso) return "";
  const then = new Date(iso.replace(" ", "T") + "Z").getTime();
  const days = Math.floor((Date.now() - then) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  return `${Math.floor(days / 7)} weeks ago`;
}

export function sessionLabel(s: Session): string {
  if (s.name) return s.name;
  const names = s.exercises.map((e) => e.name.split(" ")[0]);
  return names.length ? names.join(" · ") : "Session";
}
