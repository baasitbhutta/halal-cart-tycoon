/**
 * sweep — the balance workhorse. Vary one tuning param (or plan field) across
 * values, run N seeded multi-day games per value, print a P&L table.
 *
 * Usage:
 *   node dist/harness/sweep.js --param tuning.popularity.dailyGrowth
 *     --values 1,2.5,4 --days 10 --seeds 5 [--plan plan.json] [--tparam ...]
 *
 * --param may address tuning.* (dot path into tuning.ts) or plan.* (dot path
 * into the DayPlan, e.g. plan.prices.chicken_platter).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadTheme } from "../theme-node.js";
import { TUNING, mergeTuning, setTuningPath, type Tuning } from "../tuning.js";
import type { DayPlan } from "../sim/types.js";
import { applyDayResult, defaultPlan, newGame, overnight, simulateDay } from "../sim/day.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}

function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    cur = cur[parts[i]] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  const num = typeof value === "string" && value !== "" && !isNaN(Number(value)) ? Number(value) : value;
  cur[last] = num;
}

interface RunStats {
  value: string;
  avgEarnings: number; // mean daily earnings across all days/seeds
  avgLateEarnings: number; // mean earnings over last 3 days
  avgSatisfaction: number;
  avgMissed: number; // missed (price+wait) per day
  solventPct: number; // % of runs never going negative cash
  avgServed: number;
}

function runSweep(
  themePath: string,
  planPartial: Partial<DayPlan>,
  param: string,
  values: string[],
  days: number,
  seeds: number,
): RunStats[] {
  const theme = loadTheme(themePath);
  const base = defaultPlan(theme);
  const basePlan: DayPlan = {
    ...base,
    ...planPartial,
    recipe: { ...base.recipe, ...(planPartial.recipe ?? {}) },
    prices: { ...base.prices, ...(planPartial.prices ?? {}) },
  };

  const rows: RunStats[] = [];
  for (const v of values) {
    let earnSum = 0;
    let lateEarnSum = 0;
    let satSum = 0;
    let missedSum = 0;
    let servedSum = 0;
    let dayCount = 0;
    let lateCount = 0;
    let solvent = 0;

    for (let s = 0; s < seeds; s++) {
      let tuning: Tuning = mergeTuning(TUNING, {});
      const plan: DayPlan = JSON.parse(JSON.stringify(basePlan)) as DayPlan;
      if (param.startsWith("tuning.")) {
        tuning = setTuningPath(tuning, param.slice("tuning.".length), v);
      } else if (param.startsWith("plan.")) {
        setPath(plan as unknown as Record<string, unknown>, param.slice("plan.".length), v);
      } else {
        throw new Error("--param must start with tuning. or plan.");
      }

      let state = newGame(theme, tuning);
      let broke = false;
      for (let d = 0; d < days; d++) {
        const r = simulateDay(theme, tuning, state, plan, 1000 + s * 7919 + d * 131);
        state = applyDayResult(state, plan, r);
        state = overnight(theme, tuning, state).state;
        if (state.cash < 0) broke = true;
        earnSum += r.ledger.earnings;
        servedSum += r.served;
        missedSum += r.missedPrice + r.missedWait;
        satSum += r.satisfaction;
        dayCount++;
        if (d >= days - 3) {
          lateEarnSum += r.ledger.earnings;
          lateCount++;
        }
      }
      if (!broke) solvent++;
    }

    rows.push({
      value: v,
      avgEarnings: earnSum / dayCount,
      avgLateEarnings: lateEarnSum / lateCount,
      avgSatisfaction: satSum / dayCount,
      avgMissed: missedSum / dayCount,
      solventPct: (solvent / seeds) * 100,
      avgServed: servedSum / dayCount,
    });
  }
  return rows;
}

function printTable(rows: RunStats[], param: string) {
  const f = (n: number, d = 1) => n.toFixed(d).padStart(8);
  console.log(`\nparam: ${param}`);
  console.log(
    "value".padEnd(10) +
      "earn/day".padStart(10) +
      "late-earn".padStart(10) +
      "served/d".padStart(10) +
      "missed/d".padStart(10) +
      "satis%".padStart(8) +
      "solvent%".padStart(9),
  );
  console.log("-".repeat(77));
  for (const r of rows) {
    console.log(
      String(r.value).padEnd(10) +
        f(r.avgEarnings, 2).padStart(10) +
        f(r.avgLateEarnings, 2).padStart(10) +
        f(r.avgServed).padStart(10) +
        f(r.avgMissed).padStart(10) +
        f(r.avgSatisfaction).padStart(8) +
        f(r.solventPct, 0).padStart(9),
    );
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const themePath = resolve(repoRoot, arg("theme", "data/halal-cart.json")!);
  const planPath = arg("plan");
  const planPartial = planPath ? (JSON.parse(readFileSync(resolve(planPath), "utf8")) as Partial<DayPlan>) : {};
  const param = arg("param");
  if (!param) {
    console.error("--param tuning.<path>|plan.<path> is required");
    process.exit(1);
  }
  const values = (arg("values") ?? "").split(",").filter(Boolean);
  const days = parseInt(arg("days", "10")!, 10);
  const seeds = parseInt(arg("seeds", "5")!, 10);
  const rows = runSweep(themePath, planPartial, param, values, days, seeds);
  printTable(rows, param);
}

export { runSweep };
