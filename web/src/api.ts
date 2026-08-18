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
  exercises: SessionExercise[];
};

export type Today =
  | { state: "in_progress"; session: Session }
  | { state: "ready"; session: Session; queued: number; last: Session | null }
  | { state: "empty"; queued: 0 };

export type PlannedExercise = {
  exercise: string;
  name?: string;
  kind?: string;
  weight: number;
  sets: number;
  reps: number;
  note?: string;
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

  plan: (body: { name?: string; plan_note?: string; exercises: PlannedExercise[] }) =>
    req<Session>("/sessions", { method: "POST", body: JSON.stringify(body) }),
  updatePlan: (id: number, body: Record<string, unknown>) =>
    req<Session>(`/sessions/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  start: (id: number) => req<Session>(`/sessions/${id}/start`, { method: "POST" }),
  finish: (id: number) => req<Session>(`/sessions/${id}/finish`, { method: "POST" }),
  remove: (id: number) => req<{ ok: true }>(`/sessions/${id}`, { method: "DELETE" }),
  setNotes: (id: number, notes: string) =>
    req<{ ok: true }>(`/sessions/${id}/notes`, { method: "PATCH", body: JSON.stringify({ notes }) }),

  logSet: (setId: number, reps: number | null, weight?: number) =>
    req<SetRow>(`/sets/${setId}`, {
      method: "PATCH",
      body: JSON.stringify(weight === undefined ? { reps } : { reps, weight }),
    }),
  setExerciseWeight: (sessionExerciseId: number, weight: number) =>
    req<{ ok: true; weight: number; plates: Plates | null }>(`/session-exercises/${sessionExerciseId}/weight`, {
      method: "PATCH",
      body: JSON.stringify({ weight }),
    }),

  progress: (slug: string) =>
    req<{ session_id: number; date: string; weight: number; target_reps: number; reps: (number | null)[]; est_1rm: number }[]>(
      `/progress/${slug}`,
    ),
};

/** "20 + 10 + 2.5" — what to actually hang on the bar, per side. Null for
 *  anything that isn't a barbell, where a loading would be meaningless. */
export function plateLabel(p: Plates | null): string {
  if (!p) return "";
  return p.perSide.length === 0 ? "empty bar" : p.perSide.join(" + ");
}

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
