/**
 * Named play-styles for the Monte Carlo framework: the "selected" side of
 * the selected-vs-unselected randomness comparison.
 *
 * Each strategy is a function (theme, tuning, state, dayIdx) -> DayPlan. It
 * may read state (cash, inventory, popularity, satisfaction) so it can be
 * reactive — e.g. restock perishables, skip buying when broke. Strategies
 * are analysis fixtures, not game code: they never touch the sim.
 */
import { appealFactor, planPurchases, rushAt } from "../sim/economy.js";
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

const SENSIBLE_RECIPE = { white_sauce: 4, hot_sauce: 2, meat: 3, rice: 3 };
const SLOPPY_RECIPE = { white_sauce: 1, hot_sauce: 5, meat: 3, rice: 3 }; // drowned in hot sauce

/**
 * Chicken bundles sized to the FORECAST day's expected demand, with headroom
 * — "buy to the forecast." Uses the same appeal factor the sim uses for
 * arrivals, so this is the skilled play the game is designed to reward (cf.
 * the 2002 guide: "maximum profitability comes from exactly matching your
 * supply with the demand curve"). Trusting a wrong forecast burns you —
 * that's the gamble, and it's readable.
 */
function chickenToDemand(
  theme: Theme,
  tuning: Tuning,
  state: GameState,
  recipe: Record<string, number>,
  morning: Pick<MorningInfo, "forecast" | "headline">,
): number {
  const loc = theme.locations[0];
  const pop = state.popularity[loc.id] ?? tuning.popularity.start;
  const sat = state.satisfaction[loc.id] ?? 50;
  const hours = tuning.day.closeHour - tuning.day.openHour;
  // average rush multiplier over the day (trapezoid over the keyframes;
  // rushAt is piecewise-linear so this is exact)
  const kf = tuning.rushCurve;
  let area = 0;
  for (let i = 1; i < kf.length; i++) {
    area += ((rushAt(tuning, kf[i - 1].hour) + rushAt(tuning, kf[i].hour)) / 2) * (kf[i].hour - kf[i - 1].hour);
  }
  const avgRush = area / Math.max(1e-9, hours);
  const forecastCond = tuning.weather.conditions.find((c) => c.id === morning.forecast.conditionId);
  const forecastMult = forecastCond?.demand_mult ?? 1;
  const headlineMult = morning.headline?.effects.demandMult ?? 1;
  // Not every arrival buys: students never pay flagship prices, some balk at
  // the price or the line. Measured conversion ≈ 0.51.
  // Then buy to the newsvendor 80th percentile (not the mean): underage
  // (lost $6.50 margin) costs 4× overage (wasted $1.60 chicken), so the
  // optimal buy is mean + ~0.84σ ≈ 1.35× mean for this demand CV.
  const CONVERSION = 0.55;
  const NEWSVENDOR = 1.35;
  const expectedSales =
    loc.footTrafficPerHour *
    hours *
    avgRush *
    forecastMult *
    headlineMult *
    appealFactor(tuning, pop, sat) *
    CONVERSION;
  const buyFor = expectedSales * NEWSVENDOR;
  const meatMult = tuning.recipe.sliderBase + tuning.recipe.sliderStep * ((recipe.meat ?? 3) - 3);
  const chickenLb = buyFor * 0.5 * meatMult; // 0.5 lb per platter at meat=3
  const bundle = theme.supplies.find((s) => s.id === "chicken_lb")!.bundles[0];
  return Math.max(1, Math.ceil(chickenLb / bundle.qty));
}

/**
 * Price to the forecast — the other half of skilled play. Willingness
 * collapses on cold days (office 10×0.8=8 < $9.50), so a rigid $9.50 bleeds
 * every cold day; a reactive player discounts the bad days and premiums the
 * hot ones. These bands come straight from the willingness math
 * (refPrice × condition willingness_mult, leaving headroom for jitter).
 */
function priceForForecast(conditionId: string, payMult: number = 1): number {
  let base: number;
  switch (conditionId) {
    case "hot_sunny":
      base = 10.5; // office 11.5×jitter mostly clears; tourists always do
      break;
    case "nice":
    case "cloudy":
      base = 9.5; // the standard price
      break;
    case "rainy":
      base = 8.0; // office 9×jitter needs room
      break;
    case "cold":
      base = 7.5; // office 8×jitter, tourists 9.2×jitter — discount or die
      break;
    default:
      base = 9.5;
  }
  // Headlines move willingness too (tiktok_slam ×0.75, tax_refund ×1.25):
  // scale the price band so a viral slam doesn't price you out of your own
  // lunch rush. Round to the nearest $0.50 — carts don't do $7.13.
  return Math.max(5, Math.round((base * payMult) * 2) / 2);
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
  return {
    locationId: theme.locations[0].id,
    purchases,
    recipe: { ...opts.recipe },
    prices: { [ship.id]: opts.price, drink: 2.0 },
    promoSpend: state.cash >= opts.promoReserve ? opts.promo : 0,
    crew: [],
    buyUpgrades: [],
  };
}

export const STRATEGIES: Record<string, Strategy> = {
  sensible: {
    id: "sensible",
    name: "Sensible",
    blurb: "Forecast-reactive price ($7.50-$10.50) and promo, balanced recipe, chicken bought to forecast.",
    plan: (theme, tuning, state, dayIdx, morning) => {
      // Don't advertise a rained-out day: promo is demand multiplication,
      // and multiplying ~zero demand is burning money.
      const badDay =
        morning.forecast.conditionId === "rainy" || morning.forecast.conditionId === "cold";
      return basePlan(theme, tuning, state, dayIdx, morning, {
        price: priceForForecast(morning.forecast.conditionId, morning.headline?.effects.payMult ?? 1),
        recipe: SENSIBLE_RECIPE,
        promo: badDay ? 1 : 4,
        promoReserve: 40,
        chickenBundles: (th, tu, st, _d, mo) => chickenToDemand(th, tu, st, SENSIBLE_RECIPE, mo),
      });
    },
  },
  greedy: {
    id: "greedy",
    name: "Greedy",
    blurb: "$18 platter (absurd gouging), $8 promo, fixed 2x chicken regardless of demand. Tests price punishment AND waste.",
    plan: (theme, tuning, state, dayIdx, morning) =>
      basePlan(theme, tuning, state, dayIdx, morning, {
        price: 18,
        recipe: SENSIBLE_RECIPE,
        promo: 8,
        promoReserve: 40,
        chickenBundles: 2, // dumb money: doesn't read the room, eats the spoilage
      }),
  },
  sloppy: {
    id: "sloppy",
    name: "Sloppy",
    blurb: "Drowned in hot sauce, forecast-reactive price, chicken to forecast. Tests recipe load-bearing.",
    plan: (theme, tuning, state, dayIdx, morning) =>
      basePlan(theme, tuning, state, dayIdx, morning, {
        price: priceForForecast(morning.forecast.conditionId, morning.headline?.effects.payMult ?? 1),
        recipe: SLOPPY_RECIPE,
        promo: 4,
        promoReserve: 40,
        chickenBundles: (th, tu, st, _d, mo) => chickenToDemand(th, tu, st, SLOPPY_RECIPE, mo),
      }),
  },
  cheapskate: {
    id: "cheapskate",
    name: "Cheapskate",
    blurb: "$7 platter, $1 promo, buys chicken every 2nd day. Tests spoilage pressure.",
    plan: (theme, tuning, state, dayIdx, morning) =>
      basePlan(theme, tuning, state, dayIdx, morning, {
        price: 7,
        recipe: SENSIBLE_RECIPE,
        promo: 1,
        promoReserve: 30,
        chickenBundles: (th, tu, st, d, mo) =>
          d % 2 === 0 ? chickenToDemand(th, tu, st, SENSIBLE_RECIPE, mo) : 0, // shops every 2nd day: off days = stockouts
      }),
  },
};

export function getStrategy(id: string): Strategy {
  const s = STRATEGIES[id];
  if (!s) throw new Error(`unknown strategy: ${id} (have: ${Object.keys(STRATEGIES).join(", ")})`);
  return s;
}
