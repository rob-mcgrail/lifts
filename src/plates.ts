// Plate maths. The only "programme" logic left in the app — everything about
// what to lift and when is planned into the session queue instead.

export type PlateStock = { weight: number; perSide: number };
export type Loadout = { bar: number; plates: PlateStock[] };
export type PlateSolution = { perSide: number[]; achievable: number; shortfall: number };

/**
 * The bar and plates in the gym. Hardcoded on purpose — it changes about once a
 * year, and a settings screen for it is more UI than it's worth. Edit here.
 * `perSide` is how many of that plate go on ONE side, which is how you actually
 * count them at the rack. Max loadable with this set is 175kg.
 */
export const LOADOUT: Loadout = {
  bar: 20,
  plates: [
    { weight: 20, perSide: 1 },
    { weight: 10, perSide: 4 },
    { weight: 5, perSide: 2 },
    { weight: 2.5, perSide: 1 },
    { weight: 1.25, perSide: 2 },
    { weight: 1, perSide: 1 },
    { weight: 0.75, perSide: 1 },
    { weight: 0.5, perSide: 1 },
    { weight: 0.25, perSide: 1 },
  ],
};

/** Smallest total weight step the loadout can express (two of the smallest plate). */
export function minIncrement(loadout: Loadout = LOADOUT): number {
  const usable = loadout.plates.filter((p) => p.weight > 0 && p.perSide >= 1);
  if (usable.length === 0) return 0;
  return Math.min(...usable.map((p) => p.weight)) * 2;
}

// Greedy fill is wrong once plate counts are finite: it can take a large plate,
// strand the remainder, and report a shortfall a different combination would
// have covered. So solve exactly — build the set of per-side loads reachable
// from the plates actually owned, then answer every query by lookup. Integer
// hundredths of a kg throughout, to keep it off floating point.

const SCALE = 100;
type Table = { reachable: Uint8Array; from: Int32Array; max: number; plates: PlateStock[] };

const tableCache = new Map<string, Table>();

function buildTable(plates: PlateStock[]): Table {
  const usable = plates
    .filter((p) => p.weight > 0 && p.perSide >= 1)
    .map((p) => ({ units: Math.round(p.weight * SCALE), pairs: p.perSide, weight: p.weight }))
    .sort((a, b) => b.units - a.units);

  const max = usable.reduce((sum, p) => sum + p.units * p.pairs, 0);
  const reachable = new Uint8Array(max + 1);
  const from = new Int32Array(max + 1).fill(-1);
  reachable[0] = 1;

  // Bounded-knapsack reachability: `used` tracks how many of the current plate
  // it took to reach each sum, which caps usage at the pairs actually owned.
  usable.forEach((p, i) => {
    const used = new Int32Array(max + 1);
    for (let u = p.units; u <= max; u++) {
      if (reachable[u]) continue;
      const prev = u - p.units;
      if (reachable[prev] && used[prev]! < p.pairs) {
        reachable[u] = 1;
        from[u] = i;
        used[u] = used[prev]! + 1;
      }
    }
  });

  return { reachable, from, max, plates: usable.map((p) => ({ weight: p.weight, perSide: p.pairs })) };
}

function tableFor(plates: PlateStock[]): Table {
  const key = JSON.stringify(plates.map((p) => [p.weight, p.perSide]));
  let t = tableCache.get(key);
  if (!t) {
    t = buildTable(plates);
    tableCache.set(key, t);
  }
  return t;
}

/**
 * Heaviest loading at or below `weight` the bar and plates can make, with the
 * per-side breakdown. `shortfall` is what it falls short by — what you want to
 * see at the rack when a target isn't reachable.
 */
export function platesFor(weight: number, loadout: Loadout = LOADOUT): PlateSolution {
  const { bar, plates } = loadout;
  if (weight <= bar) return { perSide: [], achievable: bar, shortfall: 0 };

  const t = tableFor(plates);
  const wantPerSide = Math.round(((weight - bar) / 2) * SCALE);
  let u = Math.min(wantPerSide, t.max);
  while (u > 0 && !t.reachable[u]) u--;

  const perSide: number[] = [];
  let cur = u;
  while (cur > 0) {
    const i = t.from[cur]!;
    if (i < 0) break;
    const p = t.plates[i]!;
    perSide.push(p.weight);
    cur -= Math.round(p.weight * SCALE);
  }
  perSide.sort((a, b) => b - a);

  const achievable = Math.round((bar + (u / SCALE) * 2) * 100) / 100;
  return { perSide, achievable, shortfall: Math.round((weight - achievable) * 100) / 100 };
}

/** Nearest weight at or below `weight` the loadout can actually make. */
export function roundToLoadable(weight: number, loadout: Loadout = LOADOUT): number {
  return platesFor(weight, loadout).achievable;
}

/** Epley 1RM estimate — for progress charts, never for programming. */
export function estimateOneRepMax(weight: number, reps: number): number {
  if (reps <= 0) return 0;
  if (reps === 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 100) / 100;
}
