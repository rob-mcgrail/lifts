// Markdown renderings of every read endpoint.
//
// This exists for agents driving the API over curl. JSON is the right wire
// format for the web app, but an agent reading a session tree pays for a lot of
// braces and repeated keys to learn very little. A markdown table says the same
// thing in a fraction of the tokens and needs no parsing to reason about.
//
// Every renderer here is presentation only — no reads, no business logic.

import type { LoggedSet, Session, SessionExerciseDetail } from "./db";
import type { PlateSolution } from "./plates";

type Cell = string | number | null | undefined;

export function table(headers: string[], rows: Cell[][]): string {
  if (rows.length === 0) return "_(none)_";
  const esc = (c: Cell) => String(c ?? "").replace(/\|/g, "\\|");
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => esc(r[i]).length)));
  const pad = (s: string, w: number) => s + " ".repeat(Math.max(0, w - s.length));

  const head = `| ${headers.map((h, i) => pad(h, widths[i]!)).join(" | ")} |`;
  const rule = `| ${widths.map((w) => "-".repeat(w)).join(" | ")} |`;
  const body = rows.map((r) => `| ${r.map((c, i) => pad(esc(c), widths[i]!)).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

export const kg = (n: number): string => `${Number.isInteger(n) ? n : Math.round(n * 100) / 100}kg`;

const day = (iso: string | null): string => (iso ? iso.slice(0, 10) : "—");

const plateCell = (p: PlateSolution | null | undefined): string => {
  if (!p) return "—";
  const base = p.perSide.length ? p.perSide.join(" + ") : "empty bar";
  return p.shortfall > 0 ? `${base} (${kg(p.shortfall)} short)` : base;
};

type Decorated = SessionExerciseDetail & { plates?: PlateSolution | null };
type DecoratedSession = Omit<Session, "exercises"> & { exercises: Decorated[] };

const repsCell = (e: Decorated): string => e.sets.map((s) => (s.reps === null ? "·" : s.reps)).join(" ");

const hit = (e: Decorated): boolean =>
  e.sets.length > 0 && e.sets.every((s) => s.reps !== null && s.reps >= e.target_reps);

const result = (e: Decorated): string => {
  if (e.sets.every((s) => s.reps === null)) return "not started";
  if (e.sets.some((s) => s.reps === null)) return "partial";
  return hit(e) ? "hit" : "missed";
};

/** A planned session — targets only, no results yet. */
export function plannedSession(s: DecoratedSession): string {
  const rows = s.exercises.map((e, i) => [
    i + 1,
    e.name,
    e.slug,
    `${e.target_sets}×${e.target_reps}`,
    kg(e.target_weight),
    plateCell(e.plates),
    e.note ?? "",
  ]);
  // `null` marks a section that isn't present; empty strings are deliberate
  // blank lines, and markdown needs them before a table.
  return join([
    `## Session ${s.id}${s.name ? ` — ${s.name}` : ""} (${s.status})`,
    s.plan_note ? `\n> ${s.plan_note}` : null,
    "",
    table(["#", "Exercise", "Slug", "Target", "Weight", "Per side", "Note"], rows),
  ]);
}

const join = (parts: (string | null)[]): string => parts.filter((p) => p !== null).join("\n");

/** A session with results — what was actually lifted. */
export function loggedSession(s: DecoratedSession): string {
  const rows = s.exercises.map((e, i) => [
    i + 1,
    e.name,
    kg(e.target_weight),
    `${e.target_sets}×${e.target_reps}`,
    repsCell(e),
    result(e),
  ]);
  const when = s.finished_at ?? s.started_at;
  return join([
    `## Session ${s.id}${s.name ? ` — ${s.name}` : ""} (${s.status}${when ? `, ${day(when)}` : ""})`,
    s.plan_note ? `\n> ${s.plan_note}` : null,
    "",
    table(["#", "Exercise", "Weight", "Target", "Reps", "Result"], rows),
    s.notes ? `\nNotes: ${s.notes}` : null,
  ]);
}

export function today(data: Record<string, unknown>): string {
  const state = data.state as string;
  if (state === "empty") return "# Today\n\nNothing queued.";
  if (state === "in_progress") {
    return `# Today — in progress\n\n${loggedSession(data.session as DecoratedSession)}`;
  }
  const s = data.session as DecoratedSession;
  const extra = (data.queued as number) - 1;
  return join([
    "# Today — ready to start",
    "",
    plannedSession(s),
    extra > 0 ? `\n${extra} further session${extra === 1 ? "" : "s"} queued.` : null,
  ]);
}

export function queue(sessions: DecoratedSession[]): string {
  if (sessions.length === 0) return "# Queue\n\nNothing queued.";
  const parts = sessions.map((s, i) => `${plannedSession(s)}\n\n_Position ${i + 1} of ${sessions.length}._`);
  return `# Queue (${sessions.length})\n\n${parts.join("\n\n")}`;
}

/** History as one row per exercise — flat enough to scan or diff across weeks. */
export function history(sessions: (DecoratedSession & { volume: number })[]): string {
  if (sessions.length === 0) return "# History\n\nNo completed sessions.";
  const rows: Cell[][] = [];
  for (const s of sessions) {
    for (const e of s.exercises) {
      rows.push([
        day(s.finished_at ?? s.started_at),
        s.id,
        s.name || "—",
        e.name,
        kg(e.target_weight),
        `${e.target_sets}×${e.target_reps}`,
        repsCell(e),
        result(e),
      ]);
    }
  }
  const total = sessions.reduce((n, s) => n + s.volume, 0);
  return [
    `# History (${sessions.length} sessions, ${total.toLocaleString()}kg total volume)`,
    "",
    table(["Date", "ID", "Session", "Exercise", "Weight", "Target", "Reps", "Result"], rows),
  ].join("\n");
}

export function progress(
  slug: string,
  points: { date: string; weight: number; target_reps: number; reps: (number | null)[]; est_1rm: number }[],
): string {
  if (points.length === 0) return `# Progress — ${slug}\n\nNo completed sessions for this movement.`;
  const rows = points.map((p) => [
    day(p.date),
    kg(p.weight),
    p.target_reps,
    p.reps.map((r) => (r === null ? "·" : r)).join(" "),
    Math.max(0, ...p.reps.map((r) => r ?? 0)),
    kg(p.est_1rm),
  ]);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const delta = last.weight - first.weight;
  return [
    `# Progress — ${slug} (${points.length} sessions)`,
    "",
    `${kg(first.weight)} → ${kg(last.weight)} (${delta >= 0 ? "+" : ""}${kg(delta)}) since ${day(first.date)}.`,
    "",
    table(["Date", "Weight", "Target", "Reps", "Best", "e1RM"], rows),
  ].join("\n");
}

/** Flat set-level log — the analysis view. */
export function log(sets: LoggedSet[]): string {
  if (sets.length === 0) return "# Log\n\nNo logged sets.";
  const rows = sets.map((s) => [
    day(s.date),
    s.session_id,
    s.exercise,
    s.set_idx,
    kg(s.weight),
    s.target_reps,
    s.reps,
    s.reps !== null && s.reps >= s.target_reps ? "hit" : "miss",
    Math.round((s.reps ?? 0) * s.weight),
  ]);
  return [
    `# Log (${sets.length} sets)`,
    "",
    table(["Date", "Session", "Exercise", "Set", "Weight", "Target", "Reps", "Result", "Volume"], rows),
  ].join("\n");
}

export function exercises(list: { slug: string; name: string; kind: string }[]): string {
  return [
    `# Exercises (${list.length})`,
    "",
    table(["Slug", "Name", "Kind"], list.map((e) => [e.slug, e.name, e.kind])),
  ].join("\n");
}

export function loadout(l: {
  bar: number;
  plates: { weight: number; perSide: number }[];
  min_increment: number;
  max_loadable: number;
}): string {
  return [
    "# Loadout",
    "",
    `Bar ${kg(l.bar)}. Smallest total step ${kg(l.min_increment)}. Max loadable ${kg(l.max_loadable)}.`,
    "",
    table(
      ["Plate", "Per side", "Pair adds"],
      l.plates.map((p) => [kg(p.weight), p.perSide, kg(p.weight * 2)]),
    ),
    "",
    "_Any weight that is a whole multiple of the smallest step, up to max loadable, can be made._",
  ].join("\n");
}

/** Everything a planner needs, in one document. */
export function context(data: {
  loadout: Parameters<typeof loadout>[0];
  exercises: { slug: string; name: string; kind: string }[];
  queue: DecoratedSession[];
  recent: Record<string, { date: string; weight: number; reps: (number | null)[] }[]>;
  history: (DecoratedSession & { volume: number })[];
}): string {
  const recentRows: Cell[][] = [];
  for (const [slug, entries] of Object.entries(data.recent)) {
    for (const r of entries) {
      recentRows.push([day(r.date), slug, kg(r.weight), r.reps.map((x) => (x === null ? "·" : x)).join(" ")]);
    }
  }
  recentRows.sort((a, b) => String(b[0]).localeCompare(String(a[0])));

  return [
    "# Training context",
    "",
    loadout(data.loadout),
    "",
    exercises(data.exercises),
    "",
    queue(data.queue),
    "",
    "# Recent work per movement",
    "",
    table(["Date", "Exercise", "Weight", "Reps"], recentRows),
    "",
    history(data.history),
  ].join("\n");
}
