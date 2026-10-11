import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

// Same arrangement as tests/walks.test.ts: db.ts opens DATABASE_PATH at import
// time, so the env is set first and the module imported dynamically.
const dir = mkdtempSync(join(tmpdir(), "lifts-measurements-"));
process.env.DATABASE_PATH = join(dir, "test.sqlite");

let db: typeof import("../src/db");

beforeAll(async () => {
  db = await import("../src/db");
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("body measurements", () => {
  test("either number may be recorded on its own", () => {
    const w = db.logMeasurement({ bodyweight_kg: 83.4 });
    expect(w.bodyweight_kg).toBe(83.4);
    expect(w.belly_cm).toBeNull();
    const b = db.logMeasurement({ belly_cm: 91 });
    expect(b.bodyweight_kg).toBeNull();
    expect(b.measured_at).not.toBeNull();
  });

  test("backfilled entries sort by when they were taken, not when typed in", () => {
    const old = db.logMeasurement({ bodyweight_kg: 85, measured_at: "2026-08-01 07:00:00" });
    const list = db.listMeasurements();
    expect(list[list.length - 1]!.id).toBe(old.id);
    expect(db.listMeasurements({ from: "2026-07-31", to: "2026-08-02" }).map((m) => m.id)).toEqual([old.id]);
  });

  test("a PATCH only touches what it names, and delete reports honestly", () => {
    const m = db.logMeasurement({ bodyweight_kg: 82, belly_cm: 90 });
    const u = db.updateMeasurement(m.id, { belly_cm: 89.5 })!;
    expect(u.belly_cm).toBe(89.5);
    expect(u.bodyweight_kg).toBe(82);
    expect(db.deleteMeasurement(m.id)).toBe(true);
    expect(db.deleteMeasurement(m.id)).toBe(false);
    expect(db.updateMeasurement(m.id, { belly_cm: 1 })).toBeNull();
  });

  test("a measurement is not a set and never reaches lifting history", () => {
    db.logMeasurement({ bodyweight_kg: 83 });
    expect(db.listHistory(50)).toHaveLength(0);
  });
});
