/**
 * montecarlo — the tycoon-balance comparison framework.
 *
 * For each (tuning preset x strategy): run N seeds x D days of simulateDay,
 * then measure volatility, recovery, decision-dominance
 * (selected vs unselected randomness), and the Markov recovery structure.
 *
 * Usage:
 *   node dist/harness/montecarlo.js [--presets standard,volatile,flat]
 *     [--strategies regular,greedy,sloppy,cheapskate]
 *     [--seeds 200] [--days 30] [--theme data/halal-cart.json] [--out reports]
 *
 * Raw per-day results -> <out>/mc-<preset>-<strategy>.json (gitignored).
 * Summary (table + PASS/FAIL) -> <out>/montecarlo-summary.json (committed).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadTheme, type Theme } from "../theme-node.js";
import { TUNING, mergeTuning, type Tuning } from "../tuning.js";
import type { DayPlan, GameState } from "../sim/types.js";
import { applyDayResult, newGame, overnight, rollMorning, simulateDay } from "../sim/day.js";
import { STRATEGIES, getStrategy } from "./strategies.js";
import {
  GOOD_STATES,
  decisionDominance,
  distStats,
  markovAnalysis,
  recoveryStats,
  stateLabel,
  type DayState,
  type DistStats,
  type MarkovResult,
  type RecoveryStats,
} from "./metrics.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

// ---------------------------------------------------------------------------
// Tycoon-frame balance targets (benchmarks/TYCOON_BENCHMARKS.md §5).
// Calibrated against 1973 Lemonade Stand (CV 1.25, 24.4% red days) rather
// than the cozy frame: cheerful capitalism with real sting. Dominance > 1
// stays as a design invariant — decisions must beat luck.
// ---------------------------------------------------------------------------
const TARGETS = {
  cvLow: 0.9, // daily earnings CV band: 1973 = 1.25; below 0.9 is over-sheltered
  cvHigh: 1.3,
  p10OverMeanAbove: -0.5, // p10/mean >= -0.5: losing days sting, don't dominate
  meanRecoveryDaysBelow: 3,
  maxRecoveryDays: 10, // worst bad-day recovery (1973 max was 18d — punishing)
  decisionDominanceAbove: 1.0, // decisions move the needle more than luck
  bankruptcyRateBelow: 0.05, // <5% of runs: backstop exists, rarely the experience
};

interface DayRecord {
  day: number;
  earnings: number;
  revenue: number;
  satisfaction: number;
  popularity: number;
  cash: number; // end-of-day, pre-overnight
  missedPrice: number;
  missedWait: number;
  spoilage: number; // dollars lost overnight after this day
}

interface ComboResult {
  preset: string;
  strategy: string;
  seeds: number;
  days: number;
  runs: { seed: number; days: DayRecord[] }[];
  earnings: DistStats; // over all days x seeds
  recovery: RecoveryStats;
  markov: MarkovResult;
  bankruptRuns: number;
}

function runCombo(
  theme: Theme,
  tuning: Tuning,
  presetName: string,
  strategyId: string,
  seeds: number,
  days: number,
): ComboResult {
  const strategy = getStrategy(strategyId);
  const runs: { seed: number; days: DayRecord[] }[] = [];
  let bankruptRuns = 0;

  for (let r = 0; r < seeds; r++) {
    let state: GameState = newGame(theme, tuning);
    const dayRecords: DayRecord[] = [];
    let broke = false;
    for (let d = 0; d < days; d++) {
      const seed = r * 100003 + d * 7919 + 17;
      // Morning first, like the real game loop: the player (strategy) sees
      // the forecast + headline BEFORE planning purchases. rollMorning is a
      // pure function of seed, so this matches what simulateDay rolls.
      const morning = rollMorning(theme, tuning, seed);
      const plan: DayPlan = strategy.plan(theme, tuning, state, d, {
        forecast: morning.forecast,
        headline: morning.headline,
      });
      const res = simulateDay(theme, tuning, state, plan, seed);
      state = applyDayResult(state, plan, res, [], theme.products.find((p) => p.flagship)?.id);
      const night = overnight(theme, tuning, state);
      const spoilage = night.spoiled.reduce((s, l) => s + l.value, 0);
      state = night.state;
      if (state.cash < 0 || res.cashAfter < 0) broke = true;
      // Earnings here = TRUE economic profit: operating earnings minus the
      // value of stock that spoiled overnight (cf. the original's "Stock
      // lost ($)" ledger line, MECH_SPEC.md §1). Overbuying perishables is
      // only punished here — without this, waste is free and reckless
      // strategies look artificially viable. This is the metric we balance
      // against; the in-game results ledger (M1) should surface the
      // stock-lost line the same way.
      const economicEarnings = Math.round((res.ledger.earnings - spoilage) * 100) / 100;
      dayRecords.push({
        day: res.day,
        earnings: economicEarnings,
        revenue: res.ledger.revenue,
        satisfaction: res.satisfaction,
        popularity: res.popularity,
        cash: res.cashAfter,
        missedPrice: res.missedPrice,
        missedWait: res.missedWait,
        spoilage,
      });
    }
    if (broke) bankruptRuns++;
    runs.push({ seed: r, days: dayRecords });
  }

  const allEarnings = runs.flatMap((run) => run.days.map((d) => d.earnings));
  const earningsByRun = runs.map((run) => run.days.map((d) => d.earnings));
  const stateSequences: DayState[][] = runs.map((run) =>
    run.days.map((d) => ({ satisfaction: d.satisfaction, popularity: d.popularity })),
  );

  return {
    preset: presetName,
    strategy: strategyId,
    seeds,
    days,
    runs,
    earnings: distStats(allEarnings),
    recovery: recoveryStats(earningsByRun),
    markov: markovAnalysis(stateSequences),
    bankruptRuns,
  };
}

interface PresetVerdict {
  preset: string;
  mean: number;
  cv: number;
  p10: number;
  meanRecoveryDays: number;
  maxRecoveryDays: number;
  markovWorstRecovery: number | null;
  decisionDominance: number;
  pctLossDays: number;
  bankruptRuns: number;
  seeds: number;
  pass: Record<string, boolean>;
  allPass: boolean;
}

// Verdicts anchor on the REGULAR line — the realistic learner — since
// 2026-10-22. They previously anchored on a formula-following "sensible"
// fixture that planned from the sim's own math; it was removed as
// unrealistic, so the targets now judge the game by honest play.
function verdictFor(preset: string, combos: Map<string, ComboResult>): PresetVerdict {
  const line = combos.get("regular")!;
  const greedy = combos.get("greedy");
  const dom = greedy
    ? decisionDominance(line.earnings.mean, greedy.earnings.mean, line.earnings.std)
    : NaN;
  const p10OverMean = line.earnings.mean > 0 ? line.earnings.p10 / line.earnings.mean : NaN;
  const pass = {
    cv: line.earnings.cv >= TARGETS.cvLow && line.earnings.cv <= TARGETS.cvHigh,
    p10: p10OverMean >= TARGETS.p10OverMeanAbove,
    recovery:
      line.recovery.meanRecoveryDays <= TARGETS.meanRecoveryDaysBelow &&
      line.recovery.maxRecoveryDays <= TARGETS.maxRecoveryDays,
    dominance: dom > TARGETS.decisionDominanceAbove,
    bankruptcy: line.bankruptRuns / line.seeds < TARGETS.bankruptcyRateBelow,
  };
  return {
    preset,
    mean: line.earnings.mean,
    cv: line.earnings.cv,
    p10: line.earnings.p10,
    meanRecoveryDays: line.recovery.meanRecoveryDays,
    maxRecoveryDays: line.recovery.maxRecoveryDays,
    markovWorstRecovery: line.markov.worstRecoveryDays,
    decisionDominance: dom,
    pctLossDays: line.earnings.pctNegative,
    bankruptRuns: line.bankruptRuns,
    seeds: line.seeds,
    pass,
    allPass: Object.values(pass).every(Boolean),
  };
}

const f2 = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "n/a");
const f1 = (n: number) => (Number.isFinite(n) ? n.toFixed(1) : "n/a");

function printReport(
  presets: string[],
  combos: Map<string, Map<string, ComboResult>>,
  verdicts: PresetVerdict[],
) {
  console.log("\n=== Monte Carlo tycoon-balance report ===");
  console.log(
    `targets: CV in [${TARGETS.cvLow},${TARGETS.cvHigh}] | p10/mean>=${TARGETS.p10OverMeanAbove} | ` +
      `meanRec<=${TARGETS.meanRecoveryDaysBelow}d & maxRec<=${TARGETS.maxRecoveryDays}d | ` +
      `dominance>${TARGETS.decisionDominanceAbove} | bankruptcy<${TARGETS.bankruptcyRateBelow * 100}%`,
  );

  // Per-strategy mean earnings (shows decisions matter)
  console.log("\n-- mean daily earnings by strategy --");
  const stratIds = [...combos.get(presets[0])!.keys()];
  console.log("preset".padEnd(10) + stratIds.map((s) => s.padStart(12)).join(""));
  for (const p of presets) {
    console.log(
      p.padEnd(10) +
        stratIds.map((s) => f2(combos.get(p)!.get(s)!.earnings.mean).padStart(12)).join(""),
    );
  }

  // Comparison table (regular strategy — the calibration line)
  console.log("\n-- preset comparison (regular strategy) --");
  const head =
    "preset".padEnd(10) +
    "mean".padStart(8) +
    "CV".padStart(7) +
    "p10".padStart(8) +
    "meanRec".padStart(9) +
    "maxRec".padStart(8) +
    "markovRec".padStart(10) +
    "domin.".padStart(8) +
    "%loss".padStart(7) +
    "bnkrpt".padStart(8);
  console.log(head);
  console.log("-".repeat(head.length));
  for (const v of verdicts) {
    console.log(
      v.preset.padEnd(10) +
        f2(v.mean).padStart(8) +
        f2(v.cv).padStart(7) +
        f2(v.p10).padStart(8) +
        f1(v.meanRecoveryDays).padStart(9) +
        String(v.maxRecoveryDays).padStart(8) +
        (v.markovWorstRecovery === null ? "never-bad".padStart(10) : f1(v.markovWorstRecovery).padStart(10)) +
        f2(v.decisionDominance).padStart(8) +
        f1(v.pctLossDays).padStart(7) +
        String(v.bankruptRuns).padStart(8),
    );
  }

  // PASS/FAIL
  console.log("\n-- balance targets --");
  for (const v of verdicts) {
    const mark = (ok: boolean) => (ok ? "PASS" : "FAIL");
    console.log(
      `${v.preset}: ${v.allPass ? "ALL PASS" : "has failures"} ` +
        `[cv ${mark(v.pass.cv)}] [p10 ${mark(v.pass.p10)}] ` +
        `[recovery ${mark(v.pass.recovery)}] [dominance ${mark(v.pass.dominance)}] ` +
        `[bankruptcy ${mark(v.pass.bankruptcy)}]`,
    );
  }

  // Markov detail for the regular line
  console.log("\n-- Markov recovery (regular): expected days from each state to high satisfaction --");
  for (const p of presets) {
    const m = combos.get(p)!.get("regular")!.markov;
    const cells: string[] = [];
    for (let i = 0; i < 9; i++) {
      const h = m.hittingTime[i];
      cells.push(`${stateLabel(i)}=${h === null ? (GOOD_STATES.includes(i) ? "0" : "unobs") : f1(h)}`);
    }
    console.log(`  ${p}: ${cells.join("  ")}`);
    const top = m.stationary
      .map((p2, i) => [p2, i] as const)
      .sort((a, b) => b[0] - a[0])
      .slice(0, 3)
      .map(([p2, i]) => `${stateLabel(i)} ${(p2 * 100).toFixed(0)}%`)
      .join(", ");
    console.log(`    stationary-ish top states: ${top} (${m.totalTransitions} transitions)`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const presetNames = (arg("presets", "standard,volatile,flat") ?? "").split(",").filter(Boolean);
  const strategyIds = (arg("strategies", Object.keys(STRATEGIES).join(",")) ?? "").split(",").filter(Boolean);
  const seeds = parseInt(arg("seeds", "200")!, 10);
  const days = parseInt(arg("days", "30")!, 10);
  const themePath = resolve(repoRoot, arg("theme", "data/halal-cart.json")!);
  const outDir = resolve(repoRoot, arg("out", "reports")!);
  mkdirSync(outDir, { recursive: true });

  const theme = loadTheme(themePath);
  const t0 = Date.now();
  const combos = new Map<string, Map<string, ComboResult>>();
  for (const preset of presetNames) {
    const presetPath = resolve(repoRoot, "tuning", "presets", `${preset}.json`);
    const over = JSON.parse(readFileSync(presetPath, "utf8")) as unknown;
    const tuning = mergeTuning(TUNING, over);
    const byStrategy = new Map<string, ComboResult>();
    for (const sid of strategyIds) {
      const combo = runCombo(theme, tuning, preset, sid, seeds, days);
      byStrategy.set(sid, combo);
      // raw results: gitignored, for deep dives
      const raw = {
        preset,
        strategy: sid,
        seeds,
        days,
        tuning,
        runs: combo.runs,
      };
      writeFileSync(resolve(outDir, `mc-${preset}-${sid}.json`), JSON.stringify(raw));
      console.log(`done ${preset}/${sid}: ${seeds}x${days} days`);
    }
    combos.set(preset, byStrategy);
  }

  const verdicts = presetNames.map((p) => verdictFor(p, combos.get(p)!));
  printReport(presetNames, combos, verdicts);

  const summary = {
    generatedAt: new Date().toISOString(),
    seeds,
    days,
    targets: TARGETS,
    verdicts: verdicts.map((v) => ({ ...v })),
    strategyMeans: Object.fromEntries(
      presetNames.map((p) => [
        p,
        Object.fromEntries([...combos.get(p)!.entries()].map(([s, c]) => [s, +c.earnings.mean.toFixed(2)])),
      ]),
    ),
  };
  writeFileSync(resolve(outDir, "montecarlo-summary.json"), JSON.stringify(summary, null, 2));
  console.log(`\nsummary -> ${resolve(outDir, "montecarlo-summary.json")} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

export { runCombo, verdictFor, TARGETS };
