/**
 * Named play-styles for the Monte Carlo framework: the "selected" side of
 * the selected-vs-unselected randomness comparison.
 *
 * Each strategy is a function (theme, tuning, state, dayIdx) -> DayPlan. It
 * may read state (cash, inventory, popularity, satisfaction) so it can be
 * reactive — e.g. restock perishables, skip buying when broke. Strategies
 * are analysis fixtures, not game code: they never touch the sim.
 *
 * THE ONE RULE of this file: no strategy plans from the sim's internal
 * math (tuning tables, the appeal formula, willingness multipliers).
 * Every strategy plans from what a player can know — the morning
 * forecast/headline and its own results history. An earlier "sensible"
 * fixture broke this rule (formula-sized buys, table-derived price
 * bands) and was removed 2026-10-22: it measured the designer's
 * intentions, not play. All lines are now ablations of the learner.
 */
import { planPurchases } from "../sim/economy.js";
import type { MorningInfo } from "../sim/day.js";
import type { Theme } from "../theme-node.js";
import type { Tuning } from "../tuning.js";
import type { DayPlan, GameState } from "../sim/types.js";

export interface Strategy {
  id: string;
  name: string;
  blurb: string;
  /**
   * The strategy sees what the player sees in the morning: the forecast
   * (which may be wrong) and the headline — never the actual weather.
   * Buying to the forecast is the core skill; the 40%-wrong gamble is real.
   */
  plan: (
    theme: Theme,
    tuning: Tuning,
    state: GameState,
    dayIdx: number,
    morning: Pick<MorningInfo, "forecast" | "headline">,
  ) => DayPlan;
}

/**
 * Recipe profiles are built from the ACTIVE pack's axes — strategies must
 * never hardcode one pack's ids (M4 thesis: harness included). In every
 * pack the axes are [mild sauce, hot sauce, meat, rice] in file order.
 */
function recipeFor(theme: Theme, mild: number, hot: number): Record<string, number> {
  const sauces = theme.recipeAxes.filter((a) => a.id !== "meat" && a.id !== "rice");
  return { [sauces[0].id]: mild, [sauces[1].id]: hot, meat: 3, rice: 3 };
}
const balancedRecipe = (theme: Theme) => recipeFor(theme, 4, 2);
const sloppyRecipe = (theme: Theme) => recipeFor(theme, 1, 5); // drowned in hot sauce

/**
 * Servings → flagship-protein bundles. The player's OWN recipe arithmetic
 * (per-platter quantities are shown in the game) — fair knowledge for any
 * strategy.
 */
function bundlesForServings(
  theme: Theme,
  tuning: Tuning,
  recipe: Record<string, number>,
  servings: number,
): number {
  const meatMult = tuning.recipe.sliderBase + tuning.recipe.sliderStep * ((recipe.meat ?? 3) - 3);
  const flagship = theme.products.find((p) => p.flagship)!;
  const meatComp = flagship.components.find((c) => c.scaledBy === "meat")!;
  const proteinLb = servings * meatComp.qty * meatMult;
  const bundle = theme.supplies.find((s) => s.id === meatComp.supplyId)!.bundles[0];
  return Math.max(1, Math.ceil(proteinLb / bundle.qty));
}

function basePlan(
  theme: Theme,
  tuning: Tuning,
  state: GameState,
  dayIdx: number,
  morning: Pick<MorningInfo, "forecast" | "headline">,
  opts: {
    price: number;
    recipe: Record<string, number>;
    promo: number;
    /** Only spend promo if cash is at/above this (a real player doesn't
     *  advertise when they can barely afford chicken). */
    promoReserve: number;
    /** Chicken bundles to buy; may depend on state (buy to expected demand). */
    chickenBundles:
      | number
      | ((
          theme: Theme,
          tuning: Tuning,
          state: GameState,
          dayIdx: number,
          morning: Pick<MorningInfo, "forecast" | "headline">,
        ) => number);
  },
): DayPlan {
  const ship = theme.products.find((p) => p.flagship)!;
  const chicken =
    typeof opts.chickenBundles === "function"
      ? opts.chickenBundles(theme, tuning, state, dayIdx, morning)
      : opts.chickenBundles;
  // planPurchases keeps a $25 cash buffer so a rained-out day can't trap the
  // cart at $0 with no chicken (see economy.ts).
  const purchases = planPurchases(theme, state.cash, state.inventory, chicken, 25);
  // price every main off the strategy's anchor price, scaled by the item's
  // willingness multiplier and rounded to the nearest $0.50
  const prices: Record<string, number> = { drink: 2.0 };
  for (const p of theme.products) {
    if (!p.flagship) continue;
    prices[p.id] = Math.max(4, Math.round(opts.price * (p.refPriceMult ?? 1) * 2) / 2);
  }
  return {
    locationId: theme.locations[0].id,
    purchases,
    recipe: { ...opts.recipe },
    prices,
    promoSpend: state.cash >= opts.promoReserve ? opts.promo : 0,
    crew: [],
    buyUpgrades: [],
  };
}

// ---------------------------------------------------------------------------
// The REGULAR: a realistic player model. It plans from ONLY what a human
// player can know — the morning forecast/headline and its own results
// history (visitors, served, stockouts, price balks, the weather that
// actually happened). It never reads the tuning tables, the appeal formula
// or the willingness multipliers — and it is the harness's calibration
// line: balance verdicts anchor here, and every other strategy below is
// a one-change ablation of it.
// ---------------------------------------------------------------------------

/**
 * Expected buyers today, learned from the cart's own track record:
 * - demand proxy per past day = served + stockouts (people who tried to buy)
 * - weather factors learned from its OWN days (rainy days really were
 *   thinner), shrunk toward 1.0 while the evidence is thin
 * - recency-weighted (last 10 days, 0.85 decay), buys mean + 0.5σ of its
 *   own observed spread — a cautious regular; with <4 days of evidence it
 *   pads σ, because a new player knows days swing even if they can't yet
 *   say by how much
 * Cold start (no history): cold = true and the plan falls back to a
 * starter buy.
 */
function learnedDemand(
  state: GameState,
  forecastConditionId: string,
): { servings: number; cold: boolean } {
  const obs = (state.history ?? []).filter((h) => h.served !== undefined);
  if (!obs.length) return { servings: 0, cold: true };
  const tried = (h: (typeof obs)[number]) => (h.served ?? 0) + (h.stockouts ?? 0);
  const overall = obs.reduce((s, h) => s + tried(h), 0) / obs.length;
  const factor = (cond: string | undefined): number => {
    if (!cond || overall <= 0) return 1;
    const mine = obs.filter((h) => h.conditionId === cond);
    if (!mine.length) return 1;
    const m = mine.reduce((s, h) => s + tried(h), 0) / mine.length;
    const w = mine.length / (mine.length + 3); // shrink toward 1 on thin evidence
    return 1 + (m / overall - 1) * w;
  };
  const recent = obs.slice(-10);
  let wsum = 0;
  let mean = 0;
  let sq = 0;
  recent.forEach((h, i) => {
    const w = Math.pow(0.85, recent.length - 1 - i);
    const d = tried(h) / factor(h.conditionId);
    wsum += w;
    mean += w * d;
    sq += w * d * d;
  });
  mean /= wsum;
  let sd = Math.sqrt(Math.max(0, sq / wsum - mean * mean));
  if (recent.length < 4) sd = Math.max(sd, 0.35 * mean);
  return { servings: (mean + 0.5 * sd) * factor(forecastConditionId), cold: false };
}

function learnedBundles(
  theme: Theme,
  tuning: Tuning,
  state: GameState,
  recipe: Record<string, number>,
  morning: Pick<MorningInfo, "forecast" | "headline">,
): number {
  const est = learnedDemand(state, morning.forecast.conditionId);
  if (est.cold) return 2; // first shop: a couple of bundles — learn from today
  return bundlesForServings(theme, tuning, recipe, est.servings);
}

/**
 * Price by feedback, not by table: start at the menu's listed default,
 * then walk $0.50 at a time off yesterday's results — a quarter of
 * visitors balking means too dear; selling out with almost no balks means
 * money was left on the table. It lags reality (a run of rainy-day balks
 * walks the price down over days, not instantly) — that lag is the point.
 */
function learnedPrice(theme: Theme, state: GameState): number {
  const flagship = theme.products.find((p) => p.flagship)!;
  const obs = (state.history ?? []).filter((h) => h.price !== undefined);
  const last = obs[obs.length - 1];
  if (!last) return flagship.defaultPrice;
  let price = last.price ?? flagship.defaultPrice;
  const balk = (last.missedPrice ?? 0) / Math.max(1, last.visitors);
  if (balk >= 0.25) price -= 0.5;
  else if ((last.stockouts ?? 0) > 0 && balk <= 0.05) price += 0.5;
  return Math.min(13, Math.max(5, Math.round(price * 2) / 2));
}

/**
 * The learner's plan, parameterizable by one-change overrides: every
 * strategy below is this plan with exactly one dimension bent, so a
 * metric gap between two lines names its cause.
 */
function learnerPlan(
  theme: Theme,
  tuning: Tuning,
  state: GameState,
  dayIdx: number,
  morning: Pick<MorningInfo, "forecast" | "headline">,
  opts: {
    recipe: Record<string, number>;
    price?: number;
    promo?: number;
    promoReserve?: number;
    chickenBundles?:
      | number
      | ((
          theme: Theme,
          tuning: Tuning,
          state: GameState,
          dayIdx: number,
          morning: Pick<MorningInfo, "forecast" | "headline">,
        ) => number);
  },
): DayPlan {
  // Don't advertise a rained-out day: promo is demand multiplication,
  // and multiplying ~zero demand is burning money.
  const badDay =
    morning.forecast.conditionId === "rainy" || morning.forecast.conditionId === "cold";
  return basePlan(theme, tuning, state, dayIdx, morning, {
    price: opts.price ?? learnedPrice(theme, state),
    recipe: opts.recipe,
    promo: opts.promo ?? (badDay ? 1 : 4),
    promoReserve: opts.promoReserve ?? 40,
    chickenBundles:
      opts.chickenBundles ??
      ((th, tu, st, _d, mo) => learnedBundles(th, tu, st, opts.recipe, mo)),
  });
}

export const STRATEGIES: Record<string, Strategy> = {
  regular: {
    id: "regular",
    name: "Regular (learns)",
    blurb:
      "The calibration line. A realistic player: demand learned from its own results history only (no game math), price walked by yesterday's balks/stockouts, balanced recipe, promo skipped on washout forecasts.",
    plan: (theme, tuning, state, dayIdx, morning) =>
      learnerPlan(theme, tuning, state, dayIdx, morning, { recipe: balancedRecipe(theme) }),
  },
  greedy: {
    id: "greedy",
    name: "Greedy",
    blurb: "$18 platter (absurd gouging), $8 promo, fixed 2x chicken regardless of demand. Tests price punishment AND waste.",
    plan: (theme, tuning, state, dayIdx, morning) =>
      basePlan(theme, tuning, state, dayIdx, morning, {
        price: 18,
        recipe: balancedRecipe(theme),
        promo: 8,
        promoReserve: 40,
        chickenBundles: 2, // dumb money: doesn't read the room, eats the spoilage
      }),
  },
  sloppy: {
    id: "sloppy",
    name: "Sloppy",
    blurb: "The regular with a drowned-in-hot-sauce recipe — the one-change ablation that tests whether recipe is load-bearing.",
    plan: (theme, tuning, state, dayIdx, morning) =>
      learnerPlan(theme, tuning, state, dayIdx, morning, { recipe: sloppyRecipe(theme) }),
  },
  cheapskate: {
    id: "cheapskate",
    name: "Cheapskate",
    blurb: "$7 flat platter, $1 promo, shops every 2nd day (learned amounts). Tests the price floor + spoilage pressure against the regular line.",
    plan: (theme, tuning, state, dayIdx, morning) =>
      learnerPlan(theme, tuning, state, dayIdx, morning, {
        recipe: balancedRecipe(theme),
        price: 7,
        promo: 1,
        promoReserve: 30,
        chickenBundles: (th, tu, st, d, mo) =>
          d % 2 === 0 ? learnedBundles(th, tu, st, balancedRecipe(th), mo) : 0, // off days = stockouts
      }),
  },
};

export function getStrategy(id: string): Strategy {
  const s = STRATEGIES[id];
  if (!s) throw new Error(`unknown strategy: ${id} (have: ${Object.keys(STRATEGIES).join(", ")})`);
  return s;
}
