/**
 * simulateDay — the whole game day as a pure function.
 *
 * (theme, tuning, state, plan, seed) -> DayResult. Deterministic: same
 * inputs, same outputs. All randomness from mulberry32(seed).
 */
import { mulberry32, pickWeighted, poissonish } from "../rng.js";
import { evalChallenge, type ChallengeDef } from "./challenges.js";
import type { Headline, Product, Theme } from "../theme.js";
import { flagships, getLocation, getSupply } from "../theme.js";
import type { Tuning } from "../tuning.js";
import type {
  DayPlan,
  DayResult,
  GameState,
  Ledger,
  Lot,
  OvernightResult,
  SpoilageLine,
  TickSummary,
  WeatherInfo,
} from "./types.js";
import {
  appealFactor,
  baseWillingness,
  cents,
  clamp,
  componentQtys,
  consume,
  getThemeRefs,
  promoMult,
  recipeScore,
  rushAt,
  stockOnHand,
} from "./economy.js";

interface QueuedCustomer {
  typeId: string;
  waitedMin: number;
  patienceMin: number;
}

/** Everything the player knows at the start of the day: the forecast (which
 *  may be wrong) and the morning headline. Pure function of seed — the
 *  harness (and the M1 UI) can roll this BEFORE the player plans, which is
 *  what makes "buy to the forecast" a real skill. */
export interface MorningInfo {
  headline: Headline | null;
  actual: WeatherInfo;
  forecast: WeatherInfo;
  forecastWrong: boolean;
}

export function rollMorning(theme: Theme, tuning: Tuning, seed: number): MorningInfo {
  const rng = mulberry32(seed);
  const headline = theme.headlines.length
    ? theme.headlines[Math.floor(rng() * theme.headlines.length)]
    : null;
  const { actual, forecast, forecastWrong } = rollWeather(tuning, rng, headline?.effects.tempOverrideF);
  return { headline, actual, forecast, forecastWrong };
}

function cloneInventory(inv: Record<string, Lot[]>): Record<string, Lot[]> {
  const out: Record<string, Lot[]> = {};
  for (const [k, lots] of Object.entries(inv)) {
    out[k] = lots.map((l) => ({ ...l }));
    if (!out[k].length) delete out[k];
  }
  return out;
}

function rollWeather(
  tuning: Tuning,
  rng: () => number,
  tempOverrideF?: number,
): { actual: WeatherInfo; forecast: WeatherInfo; forecastWrong: boolean } {
  const weights: Record<string, number> = {};
  for (const c of tuning.weather.conditions) weights[c.id] = c.weight;

  let actualId: string;
  if (tempOverrideF !== undefined) {
    // A headline forces the temperature: pick the condition whose range fits it.
    actualId =
      tuning.weather.conditions.find((c) => tempOverrideF >= c.tempF[0] && tempOverrideF <= c.tempF[1])?.id ??
      [...tuning.weather.conditions]
        .sort(
          (a, b) =>
            Math.min(Math.abs(tempOverrideF - a.tempF[0]), Math.abs(tempOverrideF - a.tempF[1])) -
            Math.min(Math.abs(tempOverrideF - b.tempF[0]), Math.abs(tempOverrideF - b.tempF[1])),
        )[0].id;
  } else {
    actualId = pickWeighted(rng, weights);
  }
  const cond = tuning.weather.conditions.find((c) => c.id === actualId)!;
  let tempF = cond.tempF[0] + rng() * (cond.tempF[1] - cond.tempF[0]);
  if (tempOverrideF !== undefined) tempF = tempOverrideF;
  const actual: WeatherInfo = { conditionId: actualId, tempF: Math.round(tempF) };

  let forecast = actual;
  let forecastWrong = false;
  if (rng() < tuning.weather.forecastWrongChance) {
    // A wrong forecast is usually CLOSE to reality (a few degrees off), not
    // 180° wrong — weight candidates by inverse temperature distance from
    // actual. This keeps the forecast gamble frequent but mild: mis-buys
    // sting instead of catastrophizing (cf. tycoon retune notes).
    const others = tuning.weather.conditions.filter((c) => c.id !== actualId);
    const proxWeights: Record<string, number> = {};
    for (const c of others) {
      const mid = (c.tempF[0] + c.tempF[1]) / 2;
      proxWeights[c.id] = 1 / (1 + Math.abs(mid - tempF) / 10);
    }
    const fId = pickWeighted(rng, proxWeights);
    const fc = tuning.weather.conditions.find((c) => c.id === fId)!;
    const fTemp = fc.tempF[0] + rng() * (fc.tempF[1] - fc.tempF[0]);
    forecast = { conditionId: fId, tempF: Math.round(fTemp) };
    forecastWrong = true;
  }
  return { actual, forecast, forecastWrong };
}

export function simulateDay(
  theme: Theme,
  tuning: Tuning,
  state: GameState,
  planIn: DayPlan,
  seed: number,
): DayResult {
  const rng = mulberry32(seed);
  const refs = getThemeRefs(theme);
  const notes: string[] = [];

  // ---- plan with defaults filled in ----
  const plan: DayPlan = {
    locationId: planIn.locationId,
    purchases: planIn.purchases ?? [],
    recipe: { ...Object.fromEntries(theme.recipeAxes.map((a) => [a.id, a.default])), ...(planIn.recipe ?? {}) },
    prices: { ...Object.fromEntries(theme.products.map((p) => [p.id, p.defaultPrice])), ...(planIn.prices ?? {}) },
    promoSpend: planIn.promoSpend ?? 0,
    crew: planIn.crew ?? [],
    buyUpgrades: planIn.buyUpgrades ?? [],
  };

  const location = getLocation(theme, plan.locationId);
  const mains = flagships(theme);
  const mainsById: Record<string, Product> = Object.fromEntries(mains.map((p) => [p.id, p]));
  const sideItems = theme.products.filter((p) => p.sideItem);

  // ---- morning: purchases, upgrades, crew ----
  let cash = state.cash;
  const inventory = cloneInventory(state.inventory);
  let purchaseCost = 0;

  const cartTier = theme.cartTiers[state.cartTier] ?? theme.cartTiers[0];
  let storageMult = cartTier.storageMult;
  for (const upId of state.upgrades) {
    const up = theme.upgrades.find((u) => u.id === upId);
    if (up?.storageMult) storageMult *= up.storageMult;
  }

  for (const pur of plan.purchases) {
    const supply = getSupply(theme, pur.supplyId);
    const bundle = supply.bundles[pur.bundleIndex];
    if (!bundle) {
      notes.push(`unknown bundle ${pur.bundleIndex} for ${pur.supplyId}, skipped`);
      continue;
    }
    const cap = supply.storageCap * storageMult;
    const room = Math.max(0, cap - stockOnHand(inventory[pur.supplyId]));
    const maxByRoom = Math.floor(room / bundle.qty);
    const maxByCash = Math.floor(cash / bundle.price);
    const n = Math.max(0, Math.min(pur.count, maxByRoom, maxByCash));
    if (n < pur.count) notes.push(`could only buy ${n}/${pur.count}x ${supply.name} (cash/storage)`);
    if (n > 0) {
      const cost = n * bundle.price;
      cash -= cost;
      purchaseCost += cost;
      const lot: Lot = { qty: n * bundle.qty, ageDays: 0, unitCost: bundle.price / bundle.qty };
      inventory[pur.supplyId] = [...(inventory[pur.supplyId] ?? []), lot];
    }
  }

  let upgradeCosts = 0;
  const upgrades = [...state.upgrades];
  let popularityBoost = 0;
  for (const upId of plan.buyUpgrades) {
    if (upgrades.includes(upId)) continue;
    const up = theme.upgrades.find((u) => u.id === upId);
    if (!up) {
      notes.push(`unknown upgrade ${upId}, skipped`);
      continue;
    }
    if (cash < up.cost) {
      notes.push(`can't afford ${up.name} ($${up.cost})`);
      continue;
    }
    cash -= up.cost;
    upgradeCosts += up.cost;
    upgrades.push(upId);
    if (up.popularityBoost) popularityBoost += up.popularityBoost;
    notes.push(`bought ${up.name}`);
  }

  // effective service stats
  let serveTime = tuning.service.serveMinutes;
  let patienceBonus = 0;
  for (const upId of upgrades) {
    const up = theme.upgrades.find((u) => u.id === upId);
    if (up?.serveMult) serveTime *= up.serveMult;
    if (up?.patienceAddMin) patienceBonus += up.patienceAddMin;
  }
  let wages = 0;
  for (const roleId of plan.crew) {
    const role = theme.crew.find((c) => c.id === roleId);
    if (!role) {
      notes.push(`unknown crew ${roleId}, skipped`);
      continue;
    }
    wages += role.wage;
    if (role.serveMult) serveTime *= role.serveMult;
    if (role.patienceAddMin) patienceBonus += role.patienceAddMin;
  }

  // ---- promo budget: can't spend what you don't have ----
  // (the original warned "Not enough money for the advertising amount you
  // set!"). Capping here — before demand/popularity are computed — keeps the
  // books consistent and puts a soft floor under cash: promo can never drive
  // you negative, so there's no broke-and-bleeding death spiral.
  const promo = Math.max(0, cents(Math.min(plan.promoSpend, cash)));
  if (promo < plan.promoSpend) {
    notes.push(`couldn't afford $${plan.promoSpend.toFixed(2)} promo, spent $${promo.toFixed(2)} instead`);
  }

  // ---- weather + headline ----
  // Rolled on its own RNG stream (rollMorning), so the harness/UI can roll
  // the identical morning info ahead of planning. The intraday sim below
  // uses a fresh stream from the same seed — deterministic either way.
  const { headline, actual, forecast, forecastWrong } = rollMorning(theme, tuning, seed);
  if (forecastWrong) notes.push(`forecast was wrong (said ${forecast.conditionId}, actually ${actual.conditionId})`);
  if (headline) notes.push(`headline: "${headline.text}"`);

  const weatherCond = tuning.weather.conditions.find((c) => c.id === actual.conditionId)!;
  const demandMult = (headline?.effects.demandMult ?? 1) * weatherCond.demand_mult * promoMult(tuning, promo);

  // ---- popularity & satisfaction baseline for today ----
  // Demand runs on "appeal": customers come if they know you (popularity)
  // AND like you (satisfaction) — the original's own definition.
  const startPop = state.popularity[plan.locationId] ?? tuning.popularity.start + location.popularityBonus;
  const pop = clamp(startPop + popularityBoost, 0, 100);
  const startSat = state.satisfaction[plan.locationId] ?? 50;
  const popFactor = appealFactor(tuning, pop, startSat);

  // ---- tick simulation ----
  const queue: QueuedCustomer[] = [];
  let visitors = 0;
  let served = 0;
  let missedPrice = 0;
  let missedWait = 0;
  let stockouts = 0;
  let stockoutFlag = false;
  let revenue = 0;
  let stockUsed = 0;
  const itemsSold: Record<string, number> = {};
  const recipeScores: number[] = [];
  const priceFairness: number[] = [];

  const mix = location.customerMix;
  const tickMin = tuning.day.tickMinutes;
  const ticks: TickSummary[] = [];

  for (let h = tuning.day.openHour; h < tuning.day.closeHour; h += tickMin / 60) {
    const t0 = { served, missedPrice, missedWait, stockouts, revenue, visitors };
    const mu =
      location.footTrafficPerHour *
      (tickMin / 60) *
      rushAt(tuning, h) *
      demandMult *
      popFactor;
    const arrivals = poissonish(rng, mu);

    for (let i = 0; i < arrivals; i++) {
      visitors++;
      const typeId = pickWeighted(rng, mix);
      const type = refs.customerType(typeId);
      const patience = type.patienceMin + patienceBonus;
      const estWait = queue.length * serveTime;
      if (queue.length >= tuning.demand.queueCap || estWait > patience) {
        missedWait++;
        continue;
      }
      queue.push({ typeId, waitedMin: 0, patienceMin: patience });
    }

    // serve
    const capacity = Math.max(1, Math.floor(tickMin / serveTime));
    let servedThisTick = 0;
    while (servedThisTick < capacity && queue.length > 0) {
      const c = queue.shift()!;
      servedThisTick++;
      const type = refs.customerType(c.typeId);
      // customer picks a main from the menu, weighted by type preference
      const pw: Record<string, number> = {};
      for (const m of mains) pw[m.id] = m.typePref?.[type.id] ?? 1;
      const prod = mainsById[pickWeighted(rng, pw)];
      const jitter = 1 - tuning.pricing.willingnessJitter / 2 + tuning.pricing.willingnessJitter * rng();
      const willingness =
        baseWillingness(type, weatherCond.willingness_mult, headline?.effects.payMult ?? 1) *
        (prod.refPriceMult ?? 1) *
        jitter;
      const price = plan.prices[prod.id] ?? prod.defaultPrice;

      if (price > willingness) {
        missedPrice++;
        continue;
      }
      const needs = componentQtys(tuning, prod, plan.recipe);
      const res = consume(inventory, needs);
      if (!res.ok) {
        stockouts++;
        stockoutFlag = true;
        continue;
      }
      // sold!
      served++;
      revenue += price;
      itemsSold[prod.id] = (itemsSold[prod.id] ?? 0) + 1;
      stockUsed += res.taken.reduce((s, t) => s + t.cost, 0);
      recipeScores.push(recipeScore(plan.recipe, type));
      const typeRef = type.refPrice * (prod.refPriceMult ?? 1);
      priceFairness.push(clamp(1 - Math.max(0, price - typeRef) / typeRef, 0, 1));

      // side items (drinks)
      for (const side of sideItems) {
        if (rng() >= tuning.pricing.sideItemAttachProb) continue;
        const sidePrice = plan.prices[side.id] ?? side.defaultPrice;
        if (sidePrice > willingness * 0.5) continue;
        const sideNeeds = componentQtys(tuning, side, plan.recipe);
        const sr = consume(inventory, sideNeeds);
        if (!sr.ok) continue;
        revenue += sidePrice;
        itemsSold[side.id] = (itemsSold[side.id] ?? 0) + 1;
        stockUsed += sr.taken.reduce((s, t) => s + t.cost, 0);
      }
    }

    // the rest keep waiting (or bail)
    for (let i = queue.length - 1; i >= 0; i--) {
      queue[i].waitedMin += tickMin;
      if (queue[i].waitedMin > queue[i].patienceMin) {
        queue.splice(i, 1);
        missedWait++;
      }
    }

    ticks.push({
      t: Math.round(h * 100) / 100,
      arrivals: visitors - t0.visitors,
      served: served - t0.served,
      revenue: cents(revenue - t0.revenue),
      queueEnd: queue.length,
      missedPrice: missedPrice - t0.missedPrice,
      missedWait: missedWait - t0.missedWait,
      stockouts: stockouts - t0.stockouts,
    });
  }

  // ---- satisfaction ----
  const recipeAvg = recipeScores.length ? recipeScores.reduce((a, b) => a + b, 0) / recipeScores.length : 0;
  const priceFairAvg = priceFairness.length ? priceFairness.reduce((a, b) => a + b, 0) / priceFairness.length : 1;
  const servedRatio = served / Math.max(1, served + missedWait + stockouts);
  let daySat =
    100 *
      (tuning.satisfaction.recipeWeight * recipeAvg +
        tuning.satisfaction.priceWeight * priceFairAvg +
        tuning.satisfaction.servedWeight * servedRatio) -
    (stockoutFlag ? tuning.satisfaction.stockoutPenalty : 0);
  daySat = clamp(daySat, 0, 100);
  const oldSat = state.satisfaction[plan.locationId] ?? 50;
  const satisfaction = served > 0 ? oldSat + tuning.satisfaction.smoothing * (daySat - oldSat) : oldSat;

  // ---- popularity ----
  let popularity =
    pop +
    (tuning.popularity.dailyGrowth +
      tuning.popularity.promoPerDollar * promo +
      (headline?.effects.popularityAdd ?? 0)) *
      (1 - pop / 100);
  if (satisfaction < tuning.popularity.lowSatisfactionThreshold) {
    popularity -= tuning.popularity.lowSatisfactionDecay;
    notes.push("terrible satisfaction is hurting your reputation");
  }
  popularity = clamp(popularity, 0, 100);

  // ---- ledger ----
  const rent = location.rent;
  const grossProfit = revenue - stockUsed;
  const totalExpense = rent + promo + wages + upgradeCosts;
  const earnings = grossProfit - totalExpense;
  const ledger: Ledger = {
    revenue: cents(revenue),
    stockUsed: cents(stockUsed),
    stockLost: 0,
    grossProfit: cents(grossProfit),
    marginPct: revenue > 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0,
    rent: cents(rent),
    promo: cents(promo),
    wages: cents(wages),
    upgradeCosts: cents(upgradeCosts),
    totalExpense: cents(totalExpense),
    earnings: cents(earnings),
  };

  cash = cash + revenue - rent - promo - wages;

  return {
    day: state.day,
    seed,
    locationId: plan.locationId,
    forecast,
    actual,
    headlineId: headline?.id ?? null,
    headlineText: headline?.text ?? null,
    visitors,
    served,
    missedPrice,
    missedWait,
    stockouts,
    itemsSold,
    ledger,
    purchaseCost: cents(purchaseCost),
    satisfaction: Math.round(satisfaction * 10) / 10,
    daySatisfaction: Math.round(daySat * 10) / 10,
    recipeScoreAvg: Math.round(recipeAvg * 1000) / 1000,
    popularity: Math.round(popularity * 10) / 10,
    inventoryAfter: inventory,
    upgradesAfter: upgrades,
    cashAfter: cents(cash),
    notes,
    ticks,
  };
}

/** Fold a DayResult back into GameState (pre-overnight). */
export function applyDayResult(
  state: GameState,
  plan: DayPlan,
  result: DayResult,
  challengeDefs: ChallengeDef[] = [],
): GameState {
  const next: GameState = {
    ...state,
    locationId: result.locationId,
    cash: result.cashAfter,
    popularity: { ...state.popularity, [result.locationId]: result.popularity },
    satisfaction: { ...state.satisfaction, [result.locationId]: result.satisfaction },
    inventory: result.inventoryAfter,
    upgrades: result.upgradesAfter,
    crew: plan.crew,
    lifetimeEarnings: (state.lifetimeEarnings ?? 0) + result.ledger.earnings,
    lifetimeServed: (state.lifetimeServed ?? 0) + result.served,
    history: [
      ...state.history,
      {
        day: result.day,
        visitors: result.visitors,
        revenue: result.ledger.revenue,
        earnings: result.ledger.earnings,
        satisfaction: result.satisfaction,
        tempF: result.actual.tempF,
      },
    ],
  };
  if (next.challengeId && next.challengeStatus === "active") {
    next.challengeStatus = evalChallenge(next, challengeDefs);
  }
  return next;
}

/**
 * Overnight: age every lot by one day; lots at/past shelf life spoil.
 * Reports what was lost, like the original's "29 ice cubes melted."
 */
export function overnight(theme: Theme, tuning: Tuning, state: GameState): OvernightResult {
  void tuning;
  const spoiled: SpoilageLine[] = [];
  const inventory: Record<string, Lot[]> = {};
  for (const supply of theme.supplies) {
    const lots = (state.inventory[supply.id] ?? []).map((l) => ({ ...l, ageDays: l.ageDays + 1 }));
    const kept: Lot[] = [];
    for (const lot of lots) {
      if (lot.ageDays >= supply.shelfLifeDays) {
        const existing = spoiled.find((s) => s.supplyId === supply.id);
        const value = cents(lot.qty * lot.unitCost);
        if (existing) {
          existing.qty = cents(existing.qty + lot.qty);
          existing.value = cents(existing.value + value);
        } else {
          spoiled.push({ supplyId: supply.id, supplyName: supply.name, qty: cents(lot.qty), unit: supply.unit, value });
        }
      } else {
        kept.push(lot);
      }
    }
    if (kept.length) inventory[supply.id] = kept;
  }
  return { state: { ...state, day: state.day + 1, inventory }, spoiled };
}

/** Fresh career state. */
export function newGame(theme: Theme, tuning: Tuning, locationId?: string): GameState {
  const loc = locationId ?? theme.locations[0].id;
  const location = getLocation(theme, loc);
  return {
    version: 1,
    day: 1,
    cash: tuning.startingCash,
    locationId: loc,
    popularity: { [loc]: tuning.popularity.start + location.popularityBonus },
    satisfaction: { [loc]: 50 },
    inventory: {},
    upgrades: [],
    crew: [],
    cartTier: 0,
    history: [],
    lifetimeEarnings: 0,
    lifetimeServed: 0,
  };
}

/** A sensible default plan (used by harness/tests; UI will build its own). */
export function defaultPlan(theme: Theme): DayPlan {
  return {
    locationId: theme.locations[0].id,
    // Sensible daily shopping: one small bundle of each supply per day, two of
    // chicken (the flagship's perishable core — it spoils overnight, so this
    // is "buy fresh daily" with headroom for good-demand days; the waste is
    // priced into the balance, see README).
    purchases: theme.supplies.map((s) => ({
      supplyId: s.id,
      bundleIndex: 0,
      count: s.shelfLifeDays <= 1 ? 2 : 1,
    })),
    recipe: Object.fromEntries(theme.recipeAxes.map((a) => [a.id, a.default])),
    prices: Object.fromEntries(theme.products.map((p) => [p.id, p.defaultPrice])),
    promoSpend: 3,
    crew: [],
    buyUpgrades: [],
  };
}
