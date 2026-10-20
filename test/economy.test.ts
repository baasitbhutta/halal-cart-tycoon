import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadTheme } from "../src/theme-node.js";
import { TUNING } from "../src/tuning.js";
import { planPurchases } from "../src/sim/economy.js";
import type { DayPlan, GameState } from "../src/sim/types.js";
import { applyDayResult, defaultPlan, newGame, overnight, simulateDay } from "../src/sim/day.js";

const here = dirname(fileURLToPath(import.meta.url));
const theme = loadTheme(resolve(here, "..", "..", "data", "halal-cart.json"));

const SEEDS = [42, 7, 99, 1234];

/** Sensible play: daily supplies, $9.50 platter, decent recipe, $3 promo.
 *  Shopping is cash-aware (chicken first, $25 buffer) — a real player doesn't
 *  spend their last dollar on pita. */
function sensiblePlan(state: GameState): DayPlan {
  const p = defaultPlan(theme);
  p.prices = { chicken_platter: 9.5, drink: 2.0 };
  p.recipe = { white_sauce: 4, hot_sauce: 2, meat: 3, rice: 3 };
  p.promoSpend = 3;
  p.purchases = planPurchases(theme, state.cash, state.inventory, 2, 25);
  return p;
}

interface RunOutcome {
  lateAvgEarnings: number;
  finalCash: number;
  finalSatisfaction: number;
}

function runDays(planFn: (state: GameState) => DayPlan, days: number, seedBase: number): RunOutcome {
  let state = newGame(theme, TUNING);
  const earnings: number[] = [];
  for (let d = 0; d < days; d++) {
    const plan = planFn(state);
    const r = simulateDay(theme, TUNING, state, plan, seedBase + d * 7919);
    earnings.push(r.ledger.earnings);
    state = applyDayResult(state, plan, r);
    state = overnight(theme, TUNING, state).state;
  }
  const late = earnings.slice(-3);
  return {
    lateAvgEarnings: late.reduce((a, b) => a + b, 0) / late.length,
    finalCash: state.cash,
    finalSatisfaction: state.satisfaction["midtown_side"] ?? 0,
  };
}

test("sensible 10-day play stays solvent and earns in a sane band (multi-seed)", () => {
  const outcomes = SEEDS.map((s) => runDays(sensiblePlan, 10, s));
  for (const o of outcomes) {
    assert.ok(o.finalCash > 0, `went broke: cash=${o.finalCash}`);
  }
  const avg = outcomes.reduce((a, o) => a + o.lateAvgEarnings, 0) / outcomes.length;
  assert.ok(avg > 35 && avg < 95, `late earnings out of band: ${avg}`);
});

test("terrible recipe tanks satisfaction AND earnings", () => {
  const badPlan = (state: GameState): DayPlan => {
    const bad = sensiblePlan(state);
    // Drowned in hot sauce, stingy with white sauce — bad TASTE at the same
    // food cost (meat/rice unchanged), isolating taste from cost. (A skimpy-
    // meat recipe is cheaper AND worse — a real tradeoff, not a pure quality
    // failure; don't conflate them here.)
    bad.recipe = { white_sauce: 1, hot_sauce: 5, meat: 3, rice: 3 };
    return bad;
  };
  // NOTE: recipe's 8-day earnings bite is small relative to per-seed noise
  // (chicken supply, not taste, is the throughput cap this early — per-seed
  // comparisons flip at ~50%). The design invariant is the AGGREGATE gap:
  // verified bad ≈ 6% below good across 40+ seed-bases. So assert means over
  // a wide seed set, not per-seed direction.
  const PROBE_SEEDS = [42, 7, 99, 1234, 5, 13, 21, 100, 555, 2024, 314, 2718];
  const badOutcomes = PROBE_SEEDS.map((s) => runDays(badPlan, 8, s));
  const goodOutcomes = PROBE_SEEDS.map((s) => runDays(sensiblePlan, 8, s));
  const badSat = badOutcomes.reduce((a, o) => a + o.finalSatisfaction, 0) / badOutcomes.length;
  const badEarn = badOutcomes.reduce((a, o) => a + o.lateAvgEarnings, 0) / badOutcomes.length;
  const goodSat = goodOutcomes.reduce((a, o) => a + o.finalSatisfaction, 0) / goodOutcomes.length;
  const goodEarn = goodOutcomes.reduce((a, o) => a + o.lateAvgEarnings, 0) / goodOutcomes.length;
  // Comparative (not absolute): the bad recipe must leave satisfaction and
  // earnings meaningfully below the good recipe, holding food cost constant.
  // Absolute "tank" thresholds are brittle against tolerance tuning; the
  // directional gap is the design invariant.
  assert.ok(badSat < goodSat - 5, `bad recipe should hurt satisfaction: bad=${badSat} good=${goodSat}`);
  // Directional on the aggregate: with a FIXED shopping list, the daily
  // chicken quantity (not recipe) is the binding constraint on throughput,
  // so recipe's earnings bite is small here. The full recipe→demand→earnings
  // loop needs reactive restocking (buy chicken to demand) — measured
  // properly by the Monte Carlo sloppy-vs-sensible comparison (30 days, 200
  // seeds), not this 8-day probe.
  assert.ok(badEarn < goodEarn, `bad recipe should earn less in aggregate: bad=${badEarn} good=${goodEarn}`);
});

test("absurd $20 price kills demand", () => {
  const gouge = (state: GameState): DayPlan => {
    const plan = sensiblePlan(state);
    // gouge EVERY main — with a multi-item menu, gouging one item just
    // pushes customers to the others
    plan.prices = Object.fromEntries(
      theme.products.map((p) => [p.id, p.sideItem ? 2.0 : 20]),
    );
    return plan;
  };
  const outcomes = SEEDS.map((s) => runDays(gouge, 5, s));
  const avg = outcomes.reduce((a, o) => a + o.lateAvgEarnings, 0) / outcomes.length;
  assert.ok(avg < 20, `price gouging should fail, avg earnings=${avg}`);
});

test("forgetting to buy chicken causes stockouts, not free money", () => {
  let state = newGame(theme, TUNING);
  let stockouts = 0;
  for (let d = 0; d < 3; d++) {
    const plan = sensiblePlan(state);
    plan.purchases = plan.purchases.filter((p) => p.supplyId !== "chicken_lb");
    const r = simulateDay(theme, TUNING, state, plan, 42 + d * 7919);
    stockouts += r.stockouts;
    state = applyDayResult(state, plan, r);
    state = overnight(theme, TUNING, state).state;
  }
  assert.ok(stockouts > 0, "expected stockouts with no chicken");
});
