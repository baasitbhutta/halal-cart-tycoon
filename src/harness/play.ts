/**
 * play — run one or more days from the CLI and print the results ledger,
 * in the spirit of the original's "Day's Results" screen.
 *
 * Usage:
 *   node dist/harness/play.js [--theme data/halal-cart.json] [--plan plan.json]
 *     [--days 10] [--seed 42] [--quiet]
 *
 * plan.json is a partial DayPlan (merged over defaults).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadTheme } from "../theme-node.js";
import { TUNING, mergeTuning } from "../tuning.js";
import type { DayPlan } from "../sim/types.js";
import { applyDayResult, defaultPlan, newGame, overnight, simulateDay } from "../sim/day.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

function arg(name: string, def?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return def;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

export function runDays(
  themePath: string,
  planPartial: Partial<DayPlan>,
  days: number,
  seedBase: number,
  quiet: boolean,
  tuningOver: unknown,
) {
  const theme = loadTheme(themePath);
  const tuning = mergeTuning(TUNING, tuningOver ?? {});
  const base = defaultPlan(theme);
  const plan: DayPlan = {
    ...base,
    ...planPartial,
    recipe: { ...base.recipe, ...(planPartial.recipe ?? {}) },
    prices: { ...base.prices, ...(planPartial.prices ?? {}) },
  };

  let state = newGame(theme, tuning);
  const out: string[] = [];
  for (let d = 0; d < days; d++) {
    const seed = seedBase + d * 7919;
    const r = simulateDay(theme, tuning, state, plan, seed);
    state = applyDayResult(state, plan, r, [], theme.products.find((p) => p.flagship)?.id);
    const { state: next, spoiled } = overnight(theme, tuning, state);
    state = next;

    if (!quiet) {
      out.push(`── Day ${r.day} ──────────────────────────────────`);
      out.push(`Forecast: ${r.forecast.conditionId} ${r.forecast.tempF}°F | Actual: ${r.actual.conditionId} ${r.actual.tempF}°F`);
      if (r.headlineText) out.push(`News: ${r.headlineText}`);
      out.push(
        `Visitors: ${r.visitors}  Served: ${r.served}  Missed (price): ${r.missedPrice}  Missed (wait): ${r.missedWait}  Stockouts: ${r.stockouts}`,
      );
      const L = r.ledger;
      out.push(`Revenue: $${L.revenue.toFixed(2)} (${Object.entries(r.itemsSold).map(([k, v]) => `${v}x ${k}`).join(", ")})`);
      out.push(`Stock used: $${L.stockUsed.toFixed(2)}  Gross profit: $${L.grossProfit.toFixed(2)} (${L.marginPct}%)`);
      out.push(`Rent: $${L.rent.toFixed(2)}  Promo: $${L.promo.toFixed(2)}  Wages: $${L.wages.toFixed(2)}`);
      out.push(`EARNINGS: $${L.earnings.toFixed(2)}   Cash: $${r.cashAfter.toFixed(2)}`);
      out.push(`Satisfaction: ${r.satisfaction}% (day: ${r.daySatisfaction}%)  Popularity: ${r.popularity}%`);
      if (spoiled.length) {
        out.push(`Overnight spoilage: ${spoiled.map((s) => `${s.qty}${s.unit} ${s.supplyName} ($${s.value.toFixed(2)})`).join(", ")}`);
      }
      for (const n of r.notes) out.push(`  · ${n}`);
    }
  }
  if (!quiet) console.log(out.join("\n"));
  return state;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const themePath = resolve(repoRoot, arg("theme", "data/halal-cart.json")!);
  const planPath = arg("plan");
  const planPartial = planPath ? (JSON.parse(readFileSync(resolve(planPath), "utf8")) as Partial<DayPlan>) : {};
  const days = parseInt(arg("days", "1")!, 10);
  const seed = parseInt(arg("seed", "42")!, 10);
  runDays(themePath, planPartial, days, seed, flag("quiet"), undefined);
}
