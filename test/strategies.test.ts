import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadTheme } from "../src/theme-node.js";
import { TUNING } from "../src/tuning.js";
import { newGame } from "../src/sim/day.js";
import type { DayPlan, DaySummary, GameState } from "../src/sim/types.js";
import { getStrategy } from "../src/harness/strategies.js";

const here = dirname(fileURLToPath(import.meta.url));
const theme = loadTheme(resolve(here, "..", "..", "data", "halal-cart.json"));
const regular = getStrategy("regular");
const flagship = theme.products.find((p) => p.flagship)!;

const morning = (conditionId: string) =>
  ({ forecast: { conditionId, tempF: 68 }, headline: null }) as any;

function withHistory(entries: Partial<DaySummary>[]): GameState {
  const s = newGame(theme, TUNING);
  s.cash = 500;
  s.history = entries.map((e, i) => ({
    day: i + 1,
    visitors: 30,
    revenue: 0,
    earnings: 0,
    satisfaction: 60,
    tempF: 68,
    locationId: theme.locations[0].id,
    conditionId: "nice",
    served: 0,
    stockouts: 0,
    missedPrice: 0,
    price: flagship.defaultPrice,
    ...e,
  }));
  return s;
}

/** Total perishable bundles a plan buys (the learner's demand decision). */
function perishableBundles(plan: DayPlan): number {
  const perishable = new Set(
    theme.supplies.filter((s) => s.shelfLifeDays < 30).map((s) => s.id),
  );
  return plan.purchases
    .filter((p) => perishable.has(p.supplyId))
    .reduce((sum, p) => sum + p.count, 0);
}

test("regular: cold start buys a starter shop and charges the listed default", () => {
  const state = newGame(theme, TUNING);
  const plan = regular.plan(theme, TUNING, state, 1, morning("nice"));
  assert.ok(perishableBundles(plan) >= 2, "starter buy");
  assert.equal(plan.prices[flagship.id], flagship.defaultPrice);
});

test("regular: learns demand UP from its own stocked-out days", () => {
  const cold = regular.plan(theme, TUNING, newGame(theme, TUNING), 1, morning("nice"));
  const busy = withHistory(
    Array.from({ length: 8 }, () => ({ conditionId: "nice", served: 20, stockouts: 6 })),
  );
  const learned = regular.plan(theme, TUNING, busy, 9, morning("nice"));
  assert.ok(
    perishableBundles(learned) > perishableBundles(cold),
    `learned ${perishableBundles(learned)} > cold ${perishableBundles(cold)}`,
  );
});

test("regular: learns rainy days are thinner from its own history", () => {
  const mixed = withHistory([
    ...Array.from({ length: 6 }, () => ({ conditionId: "nice", served: 24, stockouts: 0 })),
    ...Array.from({ length: 6 }, () => ({ conditionId: "rainy", served: 8, stockouts: 0 })),
  ]);
  const niceDay = regular.plan(theme, TUNING, mixed, 13, morning("nice"));
  const rainyDay = regular.plan(theme, TUNING, mixed, 13, morning("rainy"));
  assert.ok(
    perishableBundles(rainyDay) < perishableBundles(niceDay),
    `rainy ${perishableBundles(rainyDay)} < nice ${perishableBundles(niceDay)}`,
  );
});

test("regular: price walks off yesterday's balks and stockouts", () => {
  const balky = withHistory([
    { visitors: 30, missedPrice: 12, stockouts: 0, price: flagship.defaultPrice },
  ]);
  const p1 = regular.plan(theme, TUNING, balky, 2, morning("nice"));
  assert.equal(p1.prices[flagship.id], flagship.defaultPrice - 0.5);

  const soldOut = withHistory([
    { visitors: 30, missedPrice: 0, stockouts: 5, price: flagship.defaultPrice },
  ]);
  const p2 = regular.plan(theme, TUNING, soldOut, 2, morning("nice"));
  assert.equal(p2.prices[flagship.id], flagship.defaultPrice + 0.5);
});
