import { Database } from "bun:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";

const DB_PATH = process.env.DATABASE_PATH || "./data/lifts.sqlite";
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.run("PRAGMA journal_mode = WAL");
db.run("PRAGMA foreign_keys = ON");
db.run("PRAGMA busy_timeout = 5000");
db.run("PRAGMA synchronous = NORMAL");

export { db };

// --- Schema ---
//
// There is no programme engine. A session is planned ahead with explicit
// weights, sets and reps — by hand or by the model — and the app's job is to
// execute it, record what actually happened, and keep the queue in order.

// Just a catalogue of movements. No progression config: deciding what the next
// weight should be is a planning decision, made when a session is queued.
db.run(`CREATE TABLE IF NOT EXISTS exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'barbell',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
)`);

// status: planned → active → done. `position` orders the planned queue; it is
// meaningless once a session is done, where started_at is the ordering.
db.run(`CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'planned',
  position REAL NOT NULL DEFAULT 0,
  plan_note TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  finished_at TEXT
)`);

db.run(`CREATE TABLE IF NOT EXISTS session_exercises (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  exercise_id INTEGER NOT NULL REFERENCES exercises(id),
  position INTEGER NOT NULL,
  target_weight REAL NOT NULL,
  target_sets INTEGER NOT NULL,
  target_reps INTEGER NOT NULL,
  note TEXT
)`);

// reps NULL = not attempted yet. 0 is a real, logged failure.
db.run(`CREATE TABLE IF NOT EXISTS sets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_exercise_id INTEGER NOT NULL REFERENCES session_exercises(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  reps INTEGER,
  weight REAL,
  completed_at TEXT,
  UNIQUE(session_exercise_id, idx)
)`);

db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status, position)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_sessions_finished ON sessions(finished_at DESC)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_session_exercises_session ON session_exercises(session_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_sets_session_exercise ON sets(session_exercise_id)`);

// --- Types ---

export type Exercise = { id: number; slug: string; name: string; kind: string; archived: number };

export type SessionSetRow = {
  id: number;
  idx: number;
  reps: number | null;
  weight: number | null;
  completed_at: string | null;
};

export type SessionExerciseDetail = {
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
  sets: SessionSetRow[];
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
  exercises: SessionExerciseDetail[];
};

export type PlannedExerciseInput = {
  exercise: string; // slug, created on demand
  name?: string;
  kind?: string; // barbell | dumbbell | machine | bodyweight — drives plate maths
  weight: number;
  sets: number;
  reps: number;
  note?: string;
};

// --- Exercises ---

const DEFAULT_EXERCISES: [string, string][] = [
  ["squat", "Squat"],
  ["bench", "Bench Press"],
  ["row", "Barbell Row"],
  ["ohp", "Overhead Press"],
  ["deadlift", "Deadlift"],
];

export function seedExercises(): void {
  const n = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM exercises`).get()?.n ?? 0;
  if (n > 0) return;
  for (const [slug, name] of DEFAULT_EXERCISES) {
    db.run(`INSERT INTO exercises (slug, name) VALUES (?, ?)`, [slug, name]);
  }
}

export function listExercises(): Exercise[] {
  return db.query<Exercise, []>(`SELECT * FROM exercises WHERE archived = 0 ORDER BY name`).all();
}

export const EXERCISE_KINDS = ["barbell", "dumbbell", "machine", "bodyweight", "other"] as const;

/** Look up by slug, creating the movement if it's new — planning shouldn't be
 *  blocked on registering an exercise first. `kind` only ever upgrades an
 *  existing row from the default, so a later plan can correct a guess. */
export function ensureExercise(slug: string, name?: string, kind?: string): Exercise {
  const clean = slug.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const wanted = kind && (EXERCISE_KINDS as readonly string[]).includes(kind) ? kind : undefined;

  const existing = db.query<Exercise, [string]>(`SELECT * FROM exercises WHERE slug = ?`).get(clean);
  if (existing) {
    if (wanted && wanted !== existing.kind) {
      db.run(`UPDATE exercises SET kind = ? WHERE id = ?`, [wanted, existing.id]);
      return { ...existing, kind: wanted };
    }
    return existing;
  }

  const label = name?.trim() || clean.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  db.run(`INSERT INTO exercises (slug, name, kind) VALUES (?, ?, ?)`, [clean, label, wanted ?? "barbell"]);
  return db.query<Exercise, [string]>(`SELECT * FROM exercises WHERE slug = ?`).get(clean)!;
}

// --- Sessions ---

export function getSession(id: number): Session | null {
  const s = db
    .query<Omit<Session, "exercises">, [number]>(
      `SELECT id, name, status, position, plan_note, notes, created_at, started_at, finished_at
         FROM sessions WHERE id = ?`,
    )
    .get(id);
  if (!s) return null;

  const exercises = db
    .query<Omit<SessionExerciseDetail, "sets">, [number]>(
      `SELECT se.id, se.exercise_id, e.slug, e.name, e.kind, se.position,
              se.target_weight, se.target_sets, se.target_reps, se.note
         FROM session_exercises se JOIN exercises e ON e.id = se.exercise_id
        WHERE se.session_id = ? ORDER BY se.position`,
    )
    .all(id);

  const setQ = db.query<SessionSetRow, [number]>(
    `SELECT id, idx, reps, weight, completed_at FROM sets WHERE session_exercise_id = ? ORDER BY idx`,
  );
  return { ...s, exercises: exercises.map((e) => ({ ...e, sets: setQ.all(e.id) })) };
}

/** Queue a session. Appended to the end of the planned queue unless positioned. */
export function planSession(input: {
  name?: string;
  plan_note?: string;
  position?: number;
  exercises: PlannedExerciseInput[];
}): Session {
  const id = db.transaction(() => {
    const tail =
      db.query<{ p: number | null }, []>(`SELECT MAX(position) AS p FROM sessions WHERE status = 'planned'`).get()
        ?.p ?? 0;
    const position = input.position ?? tail + 1;

    db.run(`INSERT INTO sessions (name, plan_note, position, status) VALUES (?, ?, ?, 'planned')`, [
      input.name ?? "",
      input.plan_note ?? null,
      position,
    ]);
    const sid = db.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`).get()!.id;

    input.exercises.forEach((ex, i) => {
      const e = ensureExercise(ex.exercise, ex.name, ex.kind);
      db.run(
        `INSERT INTO session_exercises (session_id, exercise_id, position, target_weight, target_sets, target_reps, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [sid, e.id, i + 1, ex.weight, ex.sets, ex.reps, ex.note ?? null],
      );
      const seId = db.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`).get()!.id;
      for (let k = 1; k <= ex.sets; k++) {
        db.run(`INSERT INTO sets (session_exercise_id, idx) VALUES (?, ?)`, [seId, k]);
      }
    });
    return sid;
  })();
  return getSession(id)!;
}

/** Replace a planned session's contents. Refuses once a session has started —
 *  history is a record of what happened, not a draft. */
export function updatePlannedSession(
  id: number,
  patch: { name?: string; plan_note?: string; position?: number; exercises?: PlannedExerciseInput[] },
): Session | null {
  const current = getSession(id);
  if (!current) return null;
  if (current.status !== "planned") return current;

  db.transaction(() => {
    if (patch.name !== undefined) db.run(`UPDATE sessions SET name = ? WHERE id = ?`, [patch.name, id]);
    if (patch.plan_note !== undefined) db.run(`UPDATE sessions SET plan_note = ? WHERE id = ?`, [patch.plan_note, id]);
    if (patch.position !== undefined) db.run(`UPDATE sessions SET position = ? WHERE id = ?`, [patch.position, id]);

    if (patch.exercises) {
      db.run(`DELETE FROM session_exercises WHERE session_id = ?`, [id]);
      patch.exercises.forEach((ex, i) => {
        const e = ensureExercise(ex.exercise, ex.name, ex.kind);
        db.run(
          `INSERT INTO session_exercises (session_id, exercise_id, position, target_weight, target_sets, target_reps, note)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, e.id, i + 1, ex.weight, ex.sets, ex.reps, ex.note ?? null],
        );
        const seId = db.query<{ id: number }, []>(`SELECT last_insert_rowid() AS id`).get()!.id;
        for (let k = 1; k <= ex.sets; k++) {
          db.run(`INSERT INTO sets (session_exercise_id, idx) VALUES (?, ?)`, [seId, k]);
        }
      });
    }
  })();
  return getSession(id);
}

export function listQueue(): Session[] {
  const ids = db
    .query<{ id: number }, []>(`SELECT id FROM sessions WHERE status = 'planned' ORDER BY position, id`)
    .all();
  return ids.map((r) => getSession(r.id)!);
}

export function activeSession(): Session | null {
  const row = db.query<{ id: number }, []>(`SELECT id FROM sessions WHERE status = 'active' ORDER BY started_at DESC LIMIT 1`).get();
  return row ? getSession(row.id) : null;
}

export function nextPlanned(): Session | null {
  const row = db
    .query<{ id: number }, []>(`SELECT id FROM sessions WHERE status = 'planned' ORDER BY position, id LIMIT 1`)
    .get();
  return row ? getSession(row.id) : null;
}

export function startSession(id: number): Session | null {
  const s = getSession(id);
  if (!s || s.status !== "planned") return s;
  db.run(`UPDATE sessions SET status = 'active', started_at = datetime('now') WHERE id = ?`, [id]);
  return getSession(id);
}

export function finishSession(id: number): Session | null {
  const s = getSession(id);
  if (!s || s.status === "done") return s;
  db.run(
    `UPDATE sessions SET status = 'done', finished_at = datetime('now'),
        started_at = COALESCE(started_at, datetime('now')) WHERE id = ?`,
    [id],
  );
  return getSession(id);
}

export function deleteSession(id: number): void {
  db.run(`DELETE FROM sessions WHERE id = ?`, [id]);
}

export function setSessionNotes(id: number, notes: string): void {
  db.run(`UPDATE sessions SET notes = ? WHERE id = ?`, [notes, id]);
}

export function listHistory(limit = 50): (Session & { volume: number })[] {
  const ids = db
    .query<{ id: number }, [number]>(
      `SELECT id FROM sessions WHERE status = 'done' ORDER BY finished_at DESC LIMIT ?`,
    )
    .all(limit);
  return ids.map(({ id }) => {
    const s = getSession(id)!;
    const volume = s.exercises.reduce(
      (sum, e) => sum + e.sets.reduce((v, st) => v + (st.reps ?? 0) * (st.weight ?? e.target_weight), 0),
      0,
    );
    return { ...s, volume: Math.round(volume) };
  });
}

// --- Sets ---

/** Log a set. `weight` overrides the planned target for that set only, so a
 *  mid-session change is recorded as what you actually lifted. */
export function logSet(setId: number, reps: number | null, weight?: number | null): SessionSetRow | null {
  db.run(
    `UPDATE sets SET reps = ?, completed_at = CASE WHEN ? IS NULL THEN NULL ELSE datetime('now') END WHERE id = ?`,
    [reps, reps, setId],
  );
  if (weight !== undefined) db.run(`UPDATE sets SET weight = ? WHERE id = ?`, [weight, setId]);
  return (
    db.query<SessionSetRow, [number]>(`SELECT id, idx, reps, weight, completed_at FROM sets WHERE id = ?`).get(setId) ??
    null
  );
}

/** The movement kind behind a session_exercise row — decides plate maths. */
export function sessionExerciseKind(sessionExerciseId: number): string | null {
  return (
    db
      .query<{ kind: string }, [number]>(
        `SELECT e.kind FROM session_exercises se JOIN exercises e ON e.id = se.exercise_id WHERE se.id = ?`,
      )
      .get(sessionExerciseId)?.kind ?? null
  );
}

/** Change the planned weight for a whole exercise mid-session. */
export function setExerciseWeight(sessionExerciseId: number, weight: number): void {
  db.run(`UPDATE session_exercises SET target_weight = ? WHERE id = ?`, [weight, sessionExerciseId]);
}

/**
 * Replace the recorded state of a session wholesale. Idempotent by construction:
 * the client sends the total state of the session it is holding, so applying the
 * same body twice lands in the same place, and a retry after a dropped request
 * carries whatever is current rather than a stale delta.
 *
 * Only rows that actually belong to the session are touched, so a malformed or
 * stale payload can't reach into another session's history.
 */
export function applySessionState(
  id: number,
  state: {
    notes?: string;
    status?: "active" | "done";
    exercises?: { id: number; target_weight?: number; sets?: { id: number; reps: number | null }[] }[];
  },
): Session | null {
  const session = getSession(id);
  if (!session) return null;
  // A finished session is history, and history is not rewritable by a sync
  // push. Without this a stale client cache can silently overwrite a completed
  // session's weights and reps — edit a finished session deliberately, via its
  // own endpoints, or not at all.
  if (session.status === "done") return session;

  const ownExercises = new Map(session.exercises.map((e) => [e.id, e]));

  db.transaction(() => {
    if (state.notes !== undefined) db.run(`UPDATE sessions SET notes = ? WHERE id = ?`, [state.notes, id]);

    for (const ex of state.exercises ?? []) {
      const own = ownExercises.get(ex.id);
      if (!own) continue;

      if (typeof ex.target_weight === "number" && ex.target_weight >= 0) {
        db.run(`UPDATE session_exercises SET target_weight = ? WHERE id = ?`, [ex.target_weight, ex.id]);
      }

      const ownSets = new Set(own.sets.map((s) => s.id));
      for (const st of ex.sets ?? []) {
        if (!ownSets.has(st.id)) continue;
        // COALESCE keeps the original completion time, so re-sending the same
        // state doesn't keep bumping the clock.
        db.run(
          `UPDATE sets
              SET reps = ?,
                  completed_at = CASE WHEN ? IS NULL THEN NULL ELSE COALESCE(completed_at, datetime('now')) END
            WHERE id = ?`,
          [st.reps, st.reps, st.id],
        );
      }
    }

    if (state.status === "done" && session.status !== "done") {
      db.run(
        `UPDATE sessions SET status = 'done', finished_at = datetime('now'),
            started_at = COALESCE(started_at, datetime('now')) WHERE id = ?`,
        [id],
      );
    } else if (state.status === "active" && session.status === "planned") {
      db.run(`UPDATE sessions SET status = 'active', started_at = datetime('now') WHERE id = ?`, [id]);
    }
  })();

  return getSession(id);
}

// --- Progress ---

export function exerciseHistory(slug: string): {
  session_id: number;
  date: string;
  weight: number;
  target_reps: number;
  reps: (number | null)[];
}[] {
  const rows = db
    .query<{ session_id: number; date: string; weight: number; target_reps: number; se_id: number }, [string]>(
      `SELECT s.id AS session_id, COALESCE(s.finished_at, s.started_at) AS date,
              se.target_weight AS weight, se.target_reps, se.id AS se_id
         FROM session_exercises se
         JOIN sessions s ON s.id = se.session_id
         JOIN exercises e ON e.id = se.exercise_id
        WHERE e.slug = ? AND s.status = 'done'
        ORDER BY date ASC`,
    )
    .all(slug);
  const setQ = db.query<{ reps: number | null }, [number]>(
    `SELECT reps FROM sets WHERE session_exercise_id = ? ORDER BY idx`,
  );
  return rows.map((r) => ({
    session_id: r.session_id,
    date: r.date,
    weight: r.weight,
    target_reps: r.target_reps,
    reps: setQ.all(r.se_id).map((x) => x.reps),
  }));
}

export type LoggedSet = {
  date: string;
  session_id: number;
  session_name: string;
  exercise: string;
  exercise_name: string;
  kind: string;
  set_idx: number;
  weight: number;
  target_reps: number;
  reps: number | null;
};

/**
 * Every logged set, flat and filterable — one row per set rather than a nested
 * session tree. This is the shape you want for analysis: it joins straight into
 * a table, a CSV or a dataframe without walking anything.
 */
export function loggedSets(opts: { exercise?: string; from?: string; to?: string; limit?: number } = {}): LoggedSet[] {
  const where: string[] = ["s.status = 'done'", "st.reps IS NOT NULL"];
  const params: (string | number)[] = [];
  if (opts.exercise) {
    where.push("e.slug = ?");
    params.push(opts.exercise);
  }
  if (opts.from) {
    where.push("COALESCE(s.finished_at, s.started_at) >= ?");
    params.push(opts.from);
  }
  if (opts.to) {
    where.push("COALESCE(s.finished_at, s.started_at) <= ?");
    params.push(opts.to);
  }
  params.push(Math.min(opts.limit ?? 1000, 10_000));

  return db
    .query<LoggedSet, (string | number)[]>(
      `SELECT COALESCE(s.finished_at, s.started_at) AS date,
              s.id AS session_id, s.name AS session_name,
              e.slug AS exercise, e.name AS exercise_name, e.kind,
              st.idx AS set_idx,
              COALESCE(st.weight, se.target_weight) AS weight,
              se.target_reps, st.reps
         FROM sets st
         JOIN session_exercises se ON se.id = st.session_exercise_id
         JOIN sessions s ON s.id = se.session_id
         JOIN exercises e ON e.id = se.exercise_id
        WHERE ${where.join(" AND ")}
        ORDER BY date DESC, se.position, st.idx
        LIMIT ?`,
    )
    .all(...params);
}

/** Most recent completed work per movement — the context the planner needs. */
export function recentPerExercise(limit = 5): Record<string, { date: string; weight: number; reps: (number | null)[] }[]> {
  const out: Record<string, { date: string; weight: number; reps: (number | null)[] }[]> = {};
  for (const ex of listExercises()) {
    const h = exerciseHistory(ex.slug);
    if (h.length) out[ex.slug] = h.slice(-limit).map((r) => ({ date: r.date, weight: r.weight, reps: r.reps }));
  }
  return out;
}
