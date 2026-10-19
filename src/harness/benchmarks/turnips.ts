/**
 * Turnip benchmark — the stalk market of Animal Crossing: New Horizons,
 * reimplemented from Ninji's datamine (via /u/Edricus's "Breaking Down The
 * Stalk Market", v1.2.1) for one purpose: to benchmark OUR cozy-balance
 * metrics against the most famous stochastic cozy economy ever shipped.
 *
 * Model: each week Daisy Mae sells turnips Sunday at a buy price of 90-110
 * bells (uniform integer). The island then generates 12 sell prices
 * (Mon AM .. Sat PM) from one of 4 patterns, chosen by a Markov chain on
 * last week's pattern. A sell strategy picks one of the 12 windows;
 * unsold turnips rot Sunday (total loss of stake).
 *
 * Metrics are the SAME definitions as src/harness/metrics.ts:
 * distStats (mean/std/CV/p10/%loss) and decisionDominance
 * (|mean(A) - mean(B)| / std(A)).
 *
 * Usage: node dist/src/harness/benchmarks/turnips.js [--seeds 200] [--weeks 30]
 *
 * Sources:
 * - Ninji's datamined C++ (gist), documented by /u/Edricus:
 *   "Breaking Down The Stalk Market" v1.2.1
 * - Pattern-of-patterns transition matrix confirmed by mcpower.github.io/turnips
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { mulberry32 } from "../../rng.js";
import { decisionDominance, distStats } from "../metrics.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..", ".."); // dist/src/harness/benchmarks -> repo root

type Rng = () => number;

// ---------------------------------------------------------------------------
// The datamined algorithm
// ---------------------------------------------------------------------------

/** Pattern ids: 0 Random (fluctuating), 1 Large Spike, 2 Decreasing, 3 Small Spike. */
type Pattern = 0 | 1 | 2 | 3;
const PATTERN_NAMES = ["Random", "LargeSpike", "Decreasing", "SmallSpike"] as const;

/** P(next | last): rows = last week's pattern, cols = this week's. */
const PATTERN_MATRIX: number[][] = [
  [0.2, 0.3, 0.15, 0.35], // last: Random
  [0.5, 0.05, 0.2, 0.25], // last: LargeSpike
  [0.25, 0.45, 0.05, 0.25], // last: Decreasing
  [0.45, 0.25, 0.15, 0.15], // last: SmallSpike
];

function randInt(rng: Rng, lo: number, hi: number): number {
  return lo + Math.floor(rng() * (hi - lo + 1));
}
function uniform(rng: Rng, lo: number, hi: number): number {
  return lo + rng() * (hi - lo);
}

/** Pick next week's pattern from the Markov transition matrix. */
function pickPattern(rng: Rng, last: Pattern | null): Pattern {
  if (last === null) return 3; // first week ever: forced Small Spike
  const row = PATTERN_MATRIX[last];
  let r = rng();
  for (let p = 0; p < 4; p++) {
    r -= row[p];
    if (r <= 0) return p as Pattern;
  }
  return 3;
}

/** A decreasing run: initial rate in [iLo,iHi], dropping [dLo,dHi] per slot. */
function decreasingRun(
  rng: Rng,
  base: number,
  slots: number,
  iLo: number,
  iHi: number,
  dLo: number,
  dHi: number,
): number[] {
  let rate = uniform(rng, iLo, iHi);
  const out: number[] = [];
  for (let i = 0; i < slots; i++) {
    out.push(Math.ceil(rate * base));
    rate -= uniform(rng, dLo, dHi);
  }
  return out;
}

const incSlot = (rng: Rng, base: number) => Math.ceil(uniform(rng, 0.9, 1.4) * base);

/** Generate the 12 sell prices (Mon AM .. Sat PM) for a week. */
function genWeek(rng: Rng, base: number, pattern: Pattern): number[] {
  switch (pattern) {
    case 0: {
      // Random: inc1 / dec1 / inc2 / dec2 / inc3, lengths sum to 12.
      const inc1 = randInt(rng, 0, 6);
      const dec1 = rng() < 0.5 ? 2 : 3;
      const tempLen = 7 - inc1;
      const inc3 = randInt(rng, 0, tempLen - 1);
      const inc2 = tempLen - inc3;
      const dec2 = 5 - dec1;
      const out: number[] = [];
      for (let i = 0; i < inc1; i++) out.push(incSlot(rng, base));
      out.push(...decreasingRun(rng, base, dec1, 0.6, 0.8, 0.04, 0.1));
      for (let i = 0; i < inc2; i++) out.push(incSlot(rng, base));
      out.push(...decreasingRun(rng, base, dec2, 0.6, 0.8, 0.04, 0.1));
      for (let i = 0; i < inc3; i++) out.push(incSlot(rng, base));
      return out;
    }
    case 1: {
      // Large Spike: steady decrease, 3-slot sharp rise, 2-slot fall, tail.
      const decLen = randInt(rng, 2, 8) - 1; // 1..7
      const tailLen = 12 - decLen - 5; // 0..6
      const out = decreasingRun(rng, base, decLen, 0.85, 0.9, 0.03, 0.05);
      out.push(Math.ceil(uniform(rng, 0.9, 1.4) * base));
      out.push(Math.ceil(uniform(rng, 1.4, 2.0) * base));
      out.push(Math.ceil(uniform(rng, 2.0, 6.0) * base));
      out.push(Math.ceil(uniform(rng, 1.4, 2.0) * base));
      out.push(Math.ceil(uniform(rng, 0.9, 1.4) * base));
      for (let i = 0; i < tailLen; i++) out.push(Math.ceil(uniform(rng, 0.4, 0.9) * base));
      return out;
    }
    case 2: {
      // Decreasing: 12 slots of steady decay.
      return decreasingRun(rng, base, 12, 0.85, 0.9, 0.03, 0.05);
    }
    case 3: {
      // Small Spike: decay, 5-slot rise peaking on its 4th slot, decay.
      const dec1 = randInt(rng, 0, 7);
      const dec2 = 12 - dec1 - 5;
      const maxRate = uniform(rng, 1.4, 2.0);
      const out = decreasingRun(rng, base, dec1, 0.4, 0.9, 0.03, 0.05);
      out.push(incSlot(rng, base));
      out.push(incSlot(rng, base));
      out.push(Math.ceil(uniform(rng, 1.4, maxRate) * base) - 1);
      out.push(Math.ceil(maxRate * base)); // guaranteed peak
      out.push(Math.ceil(uniform(rng, 1.4, maxRate) * base) - 1);
      out.push(...decreasingRun(rng, base, dec2, 0.4, 0.9, 0.03, 0.05));
      return out;
    }
  }
}

export interface TurnipWeek {
  buyPrice: number;
  pattern: Pattern;
  prices: number[]; // 12 sell windows
}

/** One full week: Sunday buy price + pattern + 12 prices. */
export function simulateTurnipWeek(rng: Rng, lastPattern: Pattern | null): { week: TurnipWeek; pattern: Pattern } {
  const pattern = pickPattern(rng, lastPattern);
  const buyPrice = randInt(rng, 90, 110);
  return { week: { buyPrice, pattern, prices: genWeek(rng, buyPrice, pattern) }, pattern };
}

// ---------------------------------------------------------------------------
// Sell strategies — the "selected" side (player decisions)
// ---------------------------------------------------------------------------

export interface SellStrategy {
  id: string;
  name: string;
  blurb: string;
  /** Return the window index (0..11) to sell at. */
  sellAt: (week: TurnipWeek) => number;
}

export const SELL_STRATEGIES: Record<string, SellStrategy> = {
  oracle: {
    id: "oracle",
    name: "Oracle (sell at weekly max)",
    blurb: "Unachievable upper bound: knows the whole week in advance.",
    sellAt: (w) => w.prices.indexOf(Math.max(...w.prices)),
  },
  firstSpike: {
    id: "firstSpike",
    name: "First spike (sell at first price > buy)",
    blurb: "The realistic good strategy: take the first profit, else Sat PM.",
    sellAt: (w) => {
      const i = w.prices.findIndex((p) => p > w.buyPrice);
      return i >= 0 ? i : 11;
    },
  },
  panic: {
    id: "panic",
    name: "Panic (sell Monday PM no matter what)",
    blurb: "The bad decision: sells at window 1 regardless of price.",
    sellAt: () => 1,
  },
};

/** Weekly profit per turnip for a strategy. */
export function weeklyProfit(week: TurnipWeek, strategy: SellStrategy): number {
  return week.prices[strategy.sellAt(week)] - week.buyPrice;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

interface OurCozyNumbers {
  mean: number;
  cv: number;
  p10: number;
  decisionDominance: number;
  pctLossDays: number;
}

function loadOurCozy(): OurCozyNumbers | null {
  try {
    const p = resolve(repoRoot, "reports", "montecarlo-summary.json");
    if (!existsSync(p)) return null;
    const d = JSON.parse(readFileSync(p, "utf8"));
    const v = d.verdicts?.[0];
    if (!v) return null;
    return {
      mean: v.mean,
      cv: v.cv,
      p10: v.p10,
      decisionDominance: v.decisionDominance,
      pctLossDays: v.pctLossDays,
    };
  } catch {
    return null;
  }
}

function main(): void {
  const seeds = parseInt(arg("seeds", "200")!, 10);
  const weeks = parseInt(arg("weeks", "30")!, 10);
  const strategyIds = (arg("strategies", "oracle,firstSpike,panic") || "").split(",").filter(Boolean);

  console.log("=== Turnip benchmark (ACNH stalk market, Ninji datamine) ===");
  console.log(`seeds=${seeds} weeks=${weeks} (weekly horizon; profit per turnip in bells)`);

  // Pattern frequencies + per-pattern oracle profit, for flavor.
  const patternCounts = [0, 0, 0, 0];
  const oracleByPattern: number[][] = [[], [], [], []];

  const profitsByStrategy: Record<string, number[]> = {};
  for (const id of strategyIds) profitsByStrategy[id] = [];

  for (let s = 0; s < seeds; s++) {
    const rng = mulberry32(1000 + s);
    let last: Pattern | null = null;
    for (let w = 0; w < weeks; w++) {
      const { week, pattern } = simulateTurnipWeek(rng, last);
      last = pattern;
      patternCounts[pattern]++;
      oracleByPattern[pattern].push(weeklyProfit(week, SELL_STRATEGIES.oracle));
      for (const id of strategyIds) {
        profitsByStrategy[id].push(weeklyProfit(week, SELL_STRATEGIES[id]));
      }
    }
  }
  const totalWeeks = seeds * weeks;
  console.log(
    `pattern mix: ${PATTERN_NAMES.map((n, i) => `${n}=${((100 * patternCounts[i]) / totalWeeks).toFixed(1)}%`).join(" ")}`,
  );
  console.log(
    `oracle mean profit by pattern (bells/turnip): ${PATTERN_NAMES.map(
      (n, i) => `${n}=${(oracleByPattern[i].reduce((a, b) => a + b, 0) / oracleByPattern[i].length).toFixed(1)}`,
    ).join(" ")}`,
  );
  console.log("");

  const stats: Record<string, ReturnType<typeof distStats>> = {};
  console.log("strategy                 mean     std      CV    p10  p50  p90  %loss-wks");
  console.log("--------------------------------------------------------------------------------");
  for (const id of strategyIds) {
    const st = distStats(profitsByStrategy[id]);
    stats[id] = st;
    console.log(
      `${id.padEnd(22)} ${st.mean.toFixed(2).padStart(8)} ${st.std.toFixed(2).padStart(8)} ` +
        `${st.cv.toFixed(2).padStart(6)} ${st.p10.toFixed(0).padStart(5)} ${st.p50.toFixed(0).padStart(5)} ` +
        `${st.p90.toFixed(0).padStart(5)} ${st.pctNegative.toFixed(1).padStart(9)}`,
    );
  }

  // Decision dominance, same definition as our framework:
  // |mean(good) - mean(bad)| / std(good), with firstSpike as the "sensible" analog.
  if (stats.firstSpike && stats.panic) {
    const dom = decisionDominance(stats.firstSpike.mean, stats.panic.mean, stats.firstSpike.std);
    console.log(`\ndecision dominance |mean(firstSpike)-mean(panic)|/std(firstSpike) = ${dom.toFixed(2)}`);
  }
  if (stats.oracle && stats.panic) {
    const dom = decisionDominance(stats.oracle.mean, stats.panic.mean, stats.oracle.std);
    console.log(`decision dominance |mean(oracle)-mean(panic)|/std(oracle)       = ${dom.toFixed(2)}`);
  }

  // Side-by-side with our cozy preset (unitless metrics; horizons differ).
  const ours = loadOurCozy();
  if (ours && stats.firstSpike) {
    const t = stats.firstSpike;
    console.log("\n--- vs our cart (cozy preset, sensible strategy; horizons: turnips=weekly, cart=daily) ---");
    console.log("metric              turnips(firstSpike)   cart(cozy/sensible)");
    console.log("------------------------------------------------------------------");
    const row = (name: string, a: string, b: string) =>
      console.log(`${name.padEnd(20)} ${a.padStart(18)} ${b.padStart(20)}`);
    row("CV (unitless)", t.cv.toFixed(2), ours.cv.toFixed(2));
    row("p10 / mean", (t.p10 / t.mean).toFixed(2), (ours.p10 / ours.mean).toFixed(2));
    row("dominance", decisionDominance(t.mean, stats.panic?.mean ?? 0, t.std).toFixed(2), ours.decisionDominance.toFixed(2));
    row("% loss periods", t.pctNegative.toFixed(1) + "%", ours.pctLossDays.toFixed(1) + "%");
  }
}

main();
