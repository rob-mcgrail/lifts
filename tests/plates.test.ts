import { expect, test } from "bun:test";
import { LOADOUT, minIncrement, platesFor, roundToLoadable } from "../src/plates";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

test("empty bar", () => {
  expect(platesFor(20)).toEqual({ perSide: [], achievable: 20, shortfall: 0 });
  expect(platesFor(15).achievable).toBe(20);
});

test("max loadable is bar + both sides fully loaded", () => {
  const perSide = LOADOUT.plates.reduce((s, p) => s + p.weight * p.perSide, 0);
  expect(perSide).toBe(57.5);
  const max = LOADOUT.bar + perSide * 2;
  expect(max).toBe(135);
  expect(roundToLoadable(200)).toBe(135);
  expect(platesFor(200).shortfall).toBe(65);
});

test("every solution is actually loadable from the plates owned", () => {
  const stock = new Map(LOADOUT.plates.map((p) => [p.weight, p.perSide]));
  for (let w = 20; w <= 135; w += 0.25) {
    const s = platesFor(w);
    const used = new Map<number, number>();
    for (const p of s.perSide) used.set(p, (used.get(p) ?? 0) + 1);
    for (const [weight, n] of used) {
      expect(stock.has(weight)).toBe(true);
      expect(n).toBeLessThanOrEqual(stock.get(weight)!);
    }
    // The breakdown must add up to the weight it claims.
    expect(Math.round((LOADOUT.bar + sum(s.perSide) * 2) * 100) / 100).toBe(s.achievable);
    expect(s.achievable).toBeLessThanOrEqual(w);
  }
});

test("known loadings", () => {
  expect(platesFor(100).achievable).toBe(100);
  expect(sum(platesFor(100).perSide)).toBe(40);
  expect(platesFor(60).achievable).toBe(60);
  expect(platesFor(62.5).achievable).toBe(62.5);
  expect(platesFor(61).achievable).toBe(61);
  expect(platesFor(60.5).achievable).toBe(60.5);
});

test("0.5kg is the smallest total step, and every 0.5 step up to max is reachable", () => {
  expect(minIncrement()).toBe(0.5);
  for (let w = 20; w <= 135; w += 0.5) {
    expect(platesFor(w).shortfall).toBe(0);
  }
});
