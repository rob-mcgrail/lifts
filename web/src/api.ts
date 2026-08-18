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
  sets: SetRow[];
  plates: Plates | null;
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
  remove: (id: number) => req<{ ok: true }>(`/sessions/${id}`, { method: "DELETE" }),

  /**
   * Push the whole state of a live session. Idempotent, so a retry just carries
   * whatever is current — this is the only write the workout screen makes, and
   * it replaces the per-set and per-exercise endpoints the app used to call.
   */
  syncState: (id: number, state: SessionState) =>
    req<Session>(`/sessions/${id}/state`, { method: "PUT", body: JSON.stringify(state) }),

  settings: () => req<Record<string, string>>("/settings"),

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
