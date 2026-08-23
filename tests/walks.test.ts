import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// db.ts opens its database at import time from DATABASE_PATH, so the env has to
// be set before the module is pulled in — hence the dynamic import. Everything
// db.ts needs is a Bun built-in (bun:sqlite, fs, path), so this runs on the
// host without node_modules, same as tests/plates.test.ts.
const dir = mkdtempSync(join(tmpdir(), "lifts-walks-"));
process.env.DATABASE_PATH = join(dir, "test.sqlite");

let db: typeof import("../src/db");

beforeAll(async () => {
  db = await import("../src/db");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

const oneLift = [{ exercise: "squat", weight: 100, sets: 3, reps: 5 }];

describe("standalone walks", () => {
  test("a logged walk is complete the moment it is recorded", () => {
    const w = db.logWalk({ minutes: 45, km: 6, surface: "outdoor" });
    expect(w.session_id).toBeNull();
    expect(w.minutes).toBe(45);
    expect(w.km).toBe(6);
    // You log a walk because it happened, so it is never in a planned state.
    expect(w.performed_at).not.toBeNull();
    // The plan columns stay empty — a standalone walk had no target.
    expect(w.target_minutes).toBeNull();
    expect(w.target_km).toBeNull();

    expect(db.listWalks().some((x) => x.id === w.id)).toBe(true);
  });

  test("performed_at can be backfilled for a walk logged late", () => {
    const w = db.logWalk({ minutes: 30, performed_at: "2026-08-01 07:30:00" });
    expect(w.performed_at).toBe("2026-08-01 07:30:00");
    // ...and the range filter finds it by that date, not by when it was typed in.
    const found = db.listWalks({ from: "2026-07-31", to: "2026-08-02" });
    expect(found.map((x) => x.id)).toContain(w.id);
  });

  test("a walk can be edited and deleted", () => {
    const w = db.logWalk({ minutes: 20 });
    expect(db.updateWalk(w.id, { minutes: 25, note: "hilly" })?.minutes).toBe(25);
    expect(db.getWalk(w.id)?.note).toBe("hilly");
    expect(db.deleteWalk(w.id)).toBe(true);
    expect(db.getWalk(w.id)).toBeNull();
    // Deleting something that isn't there reports honestly rather than lying.
    expect(db.deleteWalk(w.id)).toBe(false);
  });
});

describe("walks inside a session", () => {
  test("a planned session walk is an item to do, not yet a walk that happened", () => {
    const s = db.planSession({
      name: "Day 1",
      exercises: oneLift,
      walks: [{ surface: "treadmill", minutes: 20, incline_pct: 8 }],
    });

    expect(s.walks).toHaveLength(1);
    const w = s.walks[0]!;
    expect(w.session_id).toBe(s.id);
    expect(w.target_minutes).toBe(20);
    expect(w.incline_pct).toBe(8);
    // Not done yet: no actuals, no timestamp.
    expect(w.performed_at).toBeNull();
    expect(w.minutes).toBeNull();

    // ...and so it is not part of the walking record yet.
    expect(db.listWalks().some((x) => x.id === w.id)).toBe(false);
  });

  test("the state sync ticks it off, and re-sending doesn't move the clock", () => {
    const s = db.planSession({ exercises: oneLift, walks: [{ minutes: 20 }] });
    db.startSession(s.id);
    const walkId = s.walks[0]!.id;

    db.applySessionState(s.id, { walks: [{ id: walkId, minutes: 22, done: true }] });
    const done = db.getWalk(walkId)!;
    expect(done.minutes).toBe(22);
    expect(done.performed_at).not.toBeNull();
    // Now it counts as a walk that happened.
    expect(db.listWalks().some((x) => x.id === walkId)).toBe(true);

    // Backdate it, then push the same state again. COALESCE must leave the
    // original time alone — the sync fires repeatedly on a heartbeat, and a
    // walk must not appear to happen again on every push.
    db.db.run(`UPDATE walks SET performed_at = '2026-01-01 00:00:00' WHERE id = ?`, [walkId]);
    db.applySessionState(s.id, { walks: [{ id: walkId, minutes: 22, done: true }] });
    expect(db.getWalk(walkId)!.performed_at).toBe("2026-01-01 00:00:00");
  });

  test("un-ticking a walk clears it back to planned", () => {
    const s = db.planSession({ exercises: oneLift, walks: [{ minutes: 15 }] });
    db.startSession(s.id);
    const walkId = s.walks[0]!.id;

    db.applySessionState(s.id, { walks: [{ id: walkId, done: true }] });
    expect(db.getWalk(walkId)!.performed_at).not.toBeNull();

    db.applySessionState(s.id, { walks: [{ id: walkId, done: false }] });
    expect(db.getWalk(walkId)!.performed_at).toBeNull();
  });

  test("a sync cannot reach a walk belonging to another session", () => {
    const a = db.planSession({ exercises: oneLift, walks: [{ minutes: 20 }] });
    const b = db.planSession({ exercises: oneLift, walks: [{ minutes: 20 }] });
    db.startSession(a.id);

    // Session A claims session B's walk. The session_id guard must refuse it.
    db.applySessionState(a.id, { walks: [{ id: b.walks[0]!.id, minutes: 99, done: true }] });
    const untouched = db.getWalk(b.walks[0]!.id)!;
    expect(untouched.performed_at).toBeNull();
    expect(untouched.minutes).toBeNull();
  });

  test("a sync cannot reach a standalone walk either", () => {
    const standalone = db.logWalk({ minutes: 40 });
    const s = db.planSession({ exercises: oneLift });
    db.startSession(s.id);

    db.applySessionState(s.id, { walks: [{ id: standalone.id, minutes: 1, done: true }] });
    expect(db.getWalk(standalone.id)!.minutes).toBe(40);
  });

  test("a finished session refuses walk changes, like it refuses set changes", () => {
    const s = db.planSession({ exercises: oneLift, walks: [{ minutes: 20 }] });
    db.startSession(s.id);
    const walkId = s.walks[0]!.id;
    db.finishSession(s.id);

    db.applySessionState(s.id, { walks: [{ id: walkId, minutes: 99, done: true }] });
    expect(db.getWalk(walkId)!.minutes).toBeNull();
  });

  test("resetting a session puts its walk back to un-done", () => {
    const s = db.planSession({ exercises: oneLift, walks: [{ minutes: 20 }] });
    db.startSession(s.id);
    const walkId = s.walks[0]!.id;
    db.applySessionState(s.id, { walks: [{ id: walkId, minutes: 20, done: true }] });

    db.resetSession(s.id);
    const w = db.getWalk(walkId)!;
    expect(w.performed_at).toBeNull();
    expect(w.minutes).toBeNull();
    // The plan survives — a reset un-does the session, it doesn't re-plan it.
    expect(w.target_minutes).toBe(20);
  });

  test("re-planning replaces the session's walks and leaves standalone ones alone", () => {
    const standalone = db.logWalk({ minutes: 33 });
    const s = db.planSession({ exercises: oneLift, walks: [{ minutes: 20 }] });

    const updated = db.updatePlannedSession(s.id, { walks: [{ minutes: 35, surface: "outdoor" }] })!;
    expect(updated.walks).toHaveLength(1);
    expect(updated.walks[0]!.target_minutes).toBe(35);
    expect(db.getWalk(standalone.id)).not.toBeNull();
  });

  test("deleting a session takes its walks with it, but not standalone ones", () => {
    const standalone = db.logWalk({ minutes: 21 });
    const s = db.planSession({ exercises: oneLift, walks: [{ minutes: 20 }] });
    const walkId = s.walks[0]!.id;

    db.deleteSession(s.id);
    expect(db.getWalk(walkId)).toBeNull();
    expect(db.getWalk(standalone.id)).not.toBeNull();
  });
});

describe("walks stay out of the lifting maths", () => {
  test("a walk contributes no sets and no volume", () => {
    const s = db.planSession({
      name: "Volume check",
      exercises: [{ exercise: "bench", weight: 80, sets: 1, reps: 5 }],
      walks: [{ minutes: 30, km: 3 }],
    });
    db.startSession(s.id);

    const setId = db.getSession(s.id)!.exercises[0]!.sets[0]!.id;
    db.applySessionState(s.id, {
      exercises: [{ id: s.exercises[0]!.id, sets: [{ id: setId, reps: 5 }] }],
      walks: [{ id: s.walks[0]!.id, minutes: 30, done: true }],
    });
    db.finishSession(s.id);

    const logged = db.listHistory(50).find((h) => h.id === s.id)!;
    // 80kg × 5 and nothing else. A 30-minute walk is not 30kg of anything.
    expect(logged.volume).toBe(400);
    expect(logged.exercises).toHaveLength(1);
  });

  test("a walk never becomes a personal best", () => {
    const before = db.listBests().length;
    db.logWalk({ minutes: 60, km: 8 });
    // pbState derives from logged sets; a walk has none, so it cannot appear.
    expect(db.listBests().length).toBe(before);
  });
});

describe("walkSummary", () => {
  test("totals count only walks that happened", () => {
    db.planSession({ exercises: oneLift, walks: [{ minutes: 999 }] });
    const summary = db.walkSummary();
    // The planned 999-minute walk must not inflate anything.
    expect(summary.last_7_days.minutes).toBeLessThan(999);
    expect(summary.recent.every((w) => w.performed_at !== null)).toBe(true);
    expect(summary.last_28_days.walks).toBeGreaterThanOrEqual(summary.last_7_days.walks);
  });
});
