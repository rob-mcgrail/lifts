import { Hono } from "hono";
import { compress } from "hono/compress";
import { serveStatic } from "hono/bun";
import { existsSync } from "fs";
import indexHtml from "../web/index.html";
import * as db from "./db";
import * as md from "./markdown";
import { LOADOUT, estimateOneRepMax, minIncrement, platesFor, roundToLoadable } from "./plates";

type Ctx = Parameters<Parameters<typeof app.get>[1]>[0];

/**
 * Read endpoints answer in JSON or markdown. Agents driving this over curl want
 * tables — far fewer tokens than a nested session tree, and readable without
 * parsing. Opt in with `?format=md` or `Accept: text/markdown`; JSON stays the
 * default so the web app is unaffected.
 */
function wantsMarkdown(c: Ctx): boolean {
  const q = c.req.query("format");
  if (q === "md" || q === "markdown") return true;
  if (q === "json") return false;
  return (c.req.header("Accept") ?? "").includes("text/markdown");
}

function respond<T>(c: Ctx, data: T, render: (d: T) => string) {
  if (!wantsMarkdown(c)) return c.json(data);
  return c.text(render(data), 200, { "Content-Type": "text/markdown; charset=utf-8" });
}

const app = new Hono();

// Nothing here is big, but the SPA bundle is — and this gets used on gym wifi.
// Uncompressed it is ~1.6MB in dev / 460KB in prod; gzipped, 136KB.
app.use("*", compress());

app.onError((err, c) => {
  console.error(`[error] ${c.req.method} ${c.req.path}`, err);
  return c.json({ error: "Internal server error" }, 500);
});

db.seedExercises();

// --- helpers ---

/**
 * Attach the plate breakdown and the resolved rest marks, so no client ever
 * repeats this. Plates: only barbell movements get one — a 24kg dumbbell press
 * is not "20kg bar + 2kg a side", and showing a loading for it would be
 * actively misleading at the rack.
 *
 * Rest resolves exercise → session → global setting, per mark independently, so
 * a session can lengthen `rest_end` without also having to restate `rest_ready`.
 * The raw nullable columns stay on the response next to the resolved `rest`,
 * so a caller can still tell an override from an inherited value.
 */
function decorate(
  s: db.Session,
  opts: { withPrevious?: boolean } = {},
): db.Session & {
  exercises: (db.SessionExerciseDetail & {
    plates: ReturnType<typeof platesFor> | null;
    rest: { ready: number; end: number };
    previous: { date: string; reps: (number | null)[] } | null;
  })[];
} {
  const global = db.getSettings();
  const ready = (e: db.SessionExerciseDetail) => e.rest_ready ?? s.rest_ready ?? Number(global.rest_ready);
  const end = (e: db.SessionExerciseDetail) => e.rest_end ?? s.rest_end ?? Number(global.rest_end);

  // Only looked up where it's actually shown, and only for the movements that
  // use it. History decorates fifty sessions at a time and has no use for it.
  const previous = opts.withPrevious
    ? db.previousCounts([...new Set(s.exercises.filter((e) => e.kind === "bodyweight").map((e) => e.slug))])
    : {};

  return {
    ...s,
    exercises: s.exercises.map((e) => ({
      ...e,
      plates: e.kind === "barbell" ? platesFor(e.target_weight) : null,
      rest: { ready: ready(e), end: end(e) },
      previous: previous[e.slug] ?? null,
    })),
  };
}

function intParam(c: { req: { param: (k: string) => string } }, key: string): number | null {
  const n = Number(c.req.param(key));
  return Number.isInteger(n) && n > 0 ? n : null;
}

type ParsedRest = { ok: true; ready?: number; end?: number } | { ok: false; error: string };

/**
 * Rest overrides, validated the same way wherever they appear — on a session or
 * on one exercise. Omitted means inherit; a supplied pair must be ordered, or
 * the timer would hit both marks at once.
 */
function parseRest(src: Record<string, unknown>, where: string): ParsedRest {
  const out: { ready?: number; end?: number } = {};
  for (const [key, field] of [
    ["rest_ready", "ready"],
    ["rest_end", "end"],
  ] as const) {
    const raw = src[key];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 5 || n > 3600) {
      return { ok: false, error: `${where}.${key} must be a whole number of seconds, 5-3600` };
    }
    out[field] = n;
  }
  if (out.ready !== undefined && out.end !== undefined && out.ready >= out.end) {
    return { ok: false, error: `${where}.rest_ready must be less than ${where}.rest_end` };
  }
  return { ok: true, ...out };
}

type ParsedExercises = { ok: true; value: db.PlannedExerciseInput[] } | { ok: false; error: string };

function parseExercises(raw: unknown): ParsedExercises {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "exercises must be a non-empty array" };
  const out: db.PlannedExerciseInput[] = [];
  for (const [i, item] of raw.entries()) {
    const e = item as Record<string, unknown>;
    const slug = typeof e.exercise === "string" ? e.exercise.trim() : "";
    if (!slug) return { ok: false, error: `exercises[${i}].exercise is required` };
    const weight = Number(e.weight);
    const sets = Number(e.sets);
    const reps = Number(e.reps);
    if (!Number.isFinite(weight) || weight < 0) return { ok: false, error: `exercises[${i}].weight must be >= 0` };
    if (!Number.isInteger(sets) || sets < 1 || sets > 20) return { ok: false, error: `exercises[${i}].sets must be 1-20` };
    if (!Number.isInteger(reps) || reps < 1 || reps > 100) return { ok: false, error: `exercises[${i}].reps must be 1-100` };
    const kind = typeof e.kind === "string" ? e.kind : undefined;
    if (kind && !(db.EXERCISE_KINDS as readonly string[]).includes(kind)) {
      return { ok: false, error: `exercises[${i}].kind must be one of ${db.EXERCISE_KINDS.join(", ")}` };
    }

    const rest = parseRest(e, `exercises[${i}]`);
    if (!rest.ok) return { ok: false, error: rest.error };

    out.push({
      exercise: slug,
      name: typeof e.name === "string" ? e.name : undefined,
      kind,
      weight,
      sets,
      reps,
      note: typeof e.note === "string" ? e.note : undefined,
      rest_ready: rest.ready,
      rest_end: rest.end,
    });
  }
  return { ok: true, value: out };
}

// --- health & loadout ---

app.get("/api/health", (c) => c.json({ ok: true, service: "lifts" }));

// The physical constraints, so a planner can propose weights that exist.
const loadoutPayload = () => ({
  bar: LOADOUT.bar,
  plates: LOADOUT.plates,
  min_increment: minIncrement(),
  max_loadable: roundToLoadable(10_000),
});

app.get("/api/loadout", (c) => respond(c, loadoutPayload(), md.loadout));

app.get("/api/exercises", (c) => respond(c, db.listExercises(), md.exercises));

// --- settings ---

app.get("/api/settings", (c) => respond(c, db.getSettings(), md.settings));

app.patch("/api/settings", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const allowed = Object.keys(db.SETTING_DEFAULTS);

  for (const [k, v] of Object.entries(body)) {
    if (!allowed.includes(k)) return c.json({ error: `unknown setting: ${k}` }, 400);
    if ((db.DURATION_SETTINGS as readonly string[]).includes(k)) {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 5 || n > 3600) {
        return c.json({ error: `${k} must be a whole number of seconds, 5-3600` }, 400);
      }
    } else if (k === "rest_voice") {
      if (!(db.REST_VOICES as readonly string[]).includes(String(v))) {
        return c.json({ error: `rest_voice must be one of ${db.REST_VOICES.join(", ")}` }, 400);
      }
    }
  }

  const merged = { ...db.getSettings(), ...Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)])) };
  // The ready mark has to come first, or the timer would fire both tones at once.
  if (Number(merged.rest_ready) >= Number(merged.rest_end)) {
    return c.json({ error: "rest_ready must be less than rest_end" }, 400);
  }

  for (const [k, v] of Object.entries(body)) db.setSetting(k, String(v));
  return c.json(db.getSettings());
});

// --- today ---

// The one screen that matters: whatever you should be doing right now.
app.get("/api/today", (c) => {
  const active = db.activeSession();
  if (active) return respond(c, { state: "in_progress" as const, session: decorate(active, { withPrevious: true }) }, md.today);

  const next = db.nextPlanned();
  if (!next) return respond(c, { state: "empty" as const, queued: 0 }, md.today);

  return respond(
    c,
    {
      state: "ready" as const,
      session: decorate(next, { withPrevious: true }),
      queued: db.listQueue().length,
      last: db.listHistory(1)[0] ?? null,
    },
    md.today,
  );
});

// --- queue & sessions ---

app.get("/api/queue", (c) => respond(c, db.listQueue().map((s) => decorate(s, { withPrevious: true })), md.queue));

app.get("/api/history", (c) => {
  const limit = Math.min(Number(c.req.query("limit")) || 50, 500);
  const data = db.listHistory(limit).map((s) => ({ ...decorate(s), volume: s.volume }));
  return respond(c, data, md.history);
});

/**
 * Every logged set, flat — one row per set. The analysis view: filter by
 * movement or date range and it drops straight into a table or dataframe.
 */
app.get("/api/log", (c) => {
  const data = db.loggedSets({
    exercise: c.req.query("exercise") || undefined,
    from: c.req.query("from") || undefined,
    to: c.req.query("to") || undefined,
    limit: Number(c.req.query("limit")) || undefined,
  });
  return respond(c, data, md.log);
});

app.get("/api/sessions/:id", (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const s = db.getSession(id);
  if (!s) return c.json({ error: "Not found" }, 404);
  const decorated = decorate(s, { withPrevious: true });
  return respond(c, decorated, (d) => (d.status === "planned" ? md.plannedSession(d) : md.loggedSession(d)));
});

// Queue a session with explicit weights. This is the endpoint a planner drives.
app.post("/api/sessions", async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const parsed = parseExercises(body.exercises);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);

  const rest = parseRest(body, "session");
  if (!rest.ok) return c.json({ error: rest.error }, 400);

  const session = db.planSession({
    name: typeof body.name === "string" ? body.name : undefined,
    plan_note: typeof body.plan_note === "string" ? body.plan_note : undefined,
    position: typeof body.position === "number" ? body.position : undefined,
    rest_ready: rest.ready,
    rest_end: rest.end,
    exercises: parsed.value,
  });
  return c.json(decorate(session), 201);
});

app.patch("/api/sessions/:id", async (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  let exercises: db.PlannedExerciseInput[] | undefined;
  if (body.exercises !== undefined) {
    const parsed = parseExercises(body.exercises);
    if (!parsed.ok) return c.json({ error: parsed.error }, 400);
    exercises = parsed.value;
  }

  const current = db.getSession(id);
  if (!current) return c.json({ error: "Not found" }, 404);
  if (current.status !== "planned") return c.json({ error: "Only planned sessions can be edited" }, 409);

  const rest = parseRest(body, "session");
  if (!rest.ok) return c.json({ error: rest.error }, 400);

  const updated = db.updatePlannedSession(id, {
    name: typeof body.name === "string" ? body.name : undefined,
    plan_note: typeof body.plan_note === "string" ? body.plan_note : undefined,
    position: typeof body.position === "number" ? body.position : undefined,
    // Explicit null clears an override back to inheriting; undefined leaves it.
    rest_ready: body.rest_ready === null ? null : rest.ready,
    rest_end: body.rest_end === null ? null : rest.end,
    exercises,
  });
  return c.json(decorate(updated!));
});

app.post("/api/sessions/:id/start", (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const existing = db.activeSession();
  if (existing && existing.id !== id) {
    return c.json({ error: "A session is already in progress", session_id: existing.id }, 409);
  }
  const s = db.startSession(id);
  if (!s) return c.json({ error: "Not found" }, 404);
  return c.json(decorate(s));
});

/** Back to the queue, unstarted and unlogged. Only an active session. */
app.post("/api/sessions/:id/reset", (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const current = db.getSession(id);
  if (!current) return c.json({ error: "Not found" }, 404);
  if (current.status === "done") return c.json({ error: "A finished session is history — it can't be reset" }, 409);
  if (current.status === "planned") return c.json(decorate(current));

  return c.json(decorate(db.resetSession(id)!));
});

app.post("/api/sessions/:id/finish", (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const s = db.finishSession(id);
  if (!s) return c.json({ error: "Not found" }, 404);
  return c.json(decorate(s));
});

app.patch("/api/sessions/:id/notes", async (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  db.setSessionNotes(id, String(body.notes ?? ""));
  return c.json({ ok: true });
});

app.delete("/api/sessions/:id", (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  db.deleteSession(id);
  return c.json({ ok: true });
});

/**
 * Total-state sync for a live session. The client owns the state of the session
 * it is running and pushes the whole thing here; this endpoint is idempotent, so
 * a flaky connection just means the next successful push carries everything.
 */
app.put("/api/sessions/:id/state", async (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return c.json({ error: "Body must be JSON" }, 400);

  const status = body.status;
  if (status !== undefined && status !== "active" && status !== "done") {
    return c.json({ error: "status must be active or done" }, 400);
  }

  const exercises: { id: number; target_weight?: number; sets?: { id: number; reps: number | null }[] }[] = [];
  if (body.exercises !== undefined) {
    if (!Array.isArray(body.exercises)) return c.json({ error: "exercises must be an array" }, 400);
    for (const raw of body.exercises) {
      const e = raw as Record<string, unknown>;
      if (!Number.isInteger(e.id)) return c.json({ error: "exercise id must be an integer" }, 400);
      const sets: { id: number; reps: number | null }[] = [];
      if (Array.isArray(e.sets)) {
        for (const rawSet of e.sets) {
          const st = rawSet as Record<string, unknown>;
          if (!Number.isInteger(st.id)) return c.json({ error: "set id must be an integer" }, 400);
          const reps = st.reps;
          if (reps !== null && (!Number.isInteger(reps) || (reps as number) < 0 || (reps as number) > 100)) {
            return c.json({ error: "reps must be an integer 0-100, or null" }, 400);
          }
          sets.push({ id: st.id as number, reps: reps as number | null });
        }
      }
      exercises.push({
        id: e.id as number,
        target_weight: typeof e.target_weight === "number" ? e.target_weight : undefined,
        sets,
      });
    }
  }

  const updated = db.applySessionState(id, {
    notes: typeof body.notes === "string" ? body.notes : undefined,
    status: status as "active" | "done" | undefined,
    exercises,
  });
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(decorate(updated));
});

// --- sets ---

// reps: null clears back to un-attempted; 0 is a logged failure.
// weight: optional per-set override, for when you change the bar mid-exercise.
app.patch("/api/sets/:id", async (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;

  const raw = body.reps;
  if (raw !== null && (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 100)) {
    return c.json({ error: "reps must be an integer 0-100, or null" }, 400);
  }
  let weight: number | null | undefined;
  if (body.weight !== undefined) {
    if (body.weight === null) weight = null;
    else if (typeof body.weight === "number" && body.weight >= 0) weight = body.weight;
    else return c.json({ error: "weight must be a number >= 0, or null" }, 400);
  }

  const updated = db.logSet(id, raw as number | null, weight);
  if (!updated) return c.json({ error: "Not found" }, 404);
  return c.json(updated);
});

/**
 * Append a set to an exercise mid-session — the (+) on a bodyweight movement.
 * Returns just the new row; the client appends it to what it already holds
 * rather than reloading and losing anything it hasn't pushed yet.
 */
app.post("/api/session-exercises/:id/sets", (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const row = db.addSet(id);
  if (!row) return c.json({ error: "No such exercise, or its session is already finished" }, 404);
  return c.json(row, 201);
});

/** Change the working weight for one exercise mid-session. */
app.patch("/api/session-exercises/:id/weight", async (c) => {
  const id = intParam(c, "id");
  if (id === null) return c.json({ error: "Bad id" }, 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const weight = Number(body.weight);
  if (!Number.isFinite(weight) || weight < 0) return c.json({ error: "weight must be >= 0" }, 400);
  db.setExerciseWeight(id, weight);
  const kind = db.sessionExerciseKind(id);
  return c.json({ ok: true, weight, plates: kind === "barbell" ? platesFor(weight) : null });
});

// --- progress ---

app.get("/api/progress/:slug", (c) => {
  const slug = c.req.param("slug");
  const data = db
    .exerciseHistory(slug)
    .map((h) => ({ ...h, est_1rm: estimateOneRepMax(h.weight, Math.max(0, ...h.reps.map((r) => r ?? 0))) }));
  return respond(c, data, (d) => md.progress(slug, d));
});

/** Everything a planner needs in one call: what's queued, what you've been
 *  lifting lately, and what the bar can physically be loaded to. */
app.get("/api/context", (c) =>
  respond(
    c,
    {
      loadout: loadoutPayload(),
      exercises: db.listExercises(),
      queue: db.listQueue().map(decorate),
      recent: db.recentPerExercise(5),
      history: db.listHistory(10).map((s) => ({ ...decorate(s), volume: s.volume })),
    },
    md.context,
  ),
);

// ============================================================
// Server
// ============================================================

const port = Number(process.env.PORT) || 3000;
const isProd = process.env.NODE_ENV === "production";
const DIST = "./dist/web";

// In production the SPA is prebuilt at image build time and served through Hono,
// so it goes out minified, compressed and cacheable. Bun's HTML route can't do
// that — it owns the response before any middleware sees it — but it does give
// HMR, which is what you want in dev. So: dev bundles live, prod serves dist.
if (isProd) {
  if (!existsSync(`${DIST}/index.html`)) {
    console.warn(`[warn] ${DIST}/index.html missing — run: bun build ./web/index.html --outdir=${DIST} --minify --production`);
  }
  // Any real file under dist wins; serveStatic falls through to the next
  // handler when there isn't one. Bundle filenames are content-hashed, so they
  // can be cached hard — index.html never is, or a deploy wouldn't be picked up.
  app.use(
    "*",
    serveStatic({
      root: DIST,
      onFound: (path, c) => {
        if (/-[a-z0-9]{8,}\.(js|css)$/i.test(path)) {
          c.header("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );
  // Anything left is a client-side route — hand back the shell.
  app.get("*", (c) => {
    c.header("Cache-Control", "no-cache");
    return c.html(Bun.file(`${DIST}/index.html`).text());
  });
}

export { app };

// Only start the server when this module is the entry point — tests import the
// Hono `app` directly and don't want a real listener.
if (import.meta.main) {
  Bun.serve({
    port,
    development: !isProd,
    routes: isProd
      ? { "/*": (req) => app.fetch(req) }
      : { "/api/*": (req) => app.fetch(req), "/*": indexHtml },
  });
  console.log(`Lifts listening on http://localhost:${port} (${isProd ? "production" : "development"})`);
}
