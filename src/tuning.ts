/**
 * TUNING — every formula constant in the game lives here.
 *
 * Rules:
 *  - No magic numbers anywhere else in the codebase. If the sim needs a
 *    number, it comes from this file (or the theme pack for thematic data).
 *  - Every constant is named, commented, and carries units.
 *  - Tags: [TUNE] = starting guess, calibrate via harness sweeps (see §14 of
 *    DESIGN.md). [LOCK] = structural, unlikely to change.
 *
 * Override path: harness sweep / ?tuning= URL param deep-merges a partial
 * object over these defaults.
 */

export interface RushKeyframe {
  hour: number; // 24h clock, decimal (12.5 = 12:30)
  v: number; // demand multiplier at this time
}

export interface WeatherCondition {
  id: string;
  weight: number; // relative probability of this condition
  tempF: [number, number]; // uniform range for actual temp
  demand_mult: number; // multiplier on customer arrivals
  willingness_mult: number; // multiplier on what customers will pay
}

export interface Tuning {
  day: {
    openHour: number; // cart opens (24h)
    closeHour: number; // cart closes (24h)
    tickMinutes: number; // simulation granularity
  };
  /** Intraday demand shape. [TUNE] The flagship's signature mechanic. */
  rushCurve: RushKeyframe[];
  weather: {
    conditions: WeatherCondition[];
    /** P(morning forecast differs from actual day weather). [TUNE] */
    forecastWrongChance: number; // 0..1
  };
  demand: {
    /** Demand multiplier at 0 appeal (unknown + disliked). [TUNE] */
    baseAppealFactor: number;
    /** Additional demand multiplier at 100 appeal. [TUNE]
     *  effective factor = base + weight * appeal, where
     *  appeal = popularityShare*(popularity/100) + (1-popularityShare)*(satisfaction/100) */
    appealWeight: number;
    /** 0..1 — how much of "appeal" is popularity vs satisfaction. [TUNE] */
    popularityShare: number;
    /** Max customers who'll stand in line. [TUNE] */
    queueCap: number;
  };
  pricing: {
    /** Per-customer willingness jitter: willingness *= (1 - j/2 + j*rng). [TUNE] */
    willingnessJitter: number; // 0..1
    /** Probability a served flagship buyer also buys the side item. [TUNE] */
    sideItemAttachProb: number; // 0..1
  };
  service: {
    /** Minutes to serve one customer, base. [TUNE] */
    serveMinutes: number;
  };
  satisfaction: {
    recipeWeight: number; // 0..1, primary driver per original
    priceWeight: number; // 0..1
    servedWeight: number; // 0..1 (weights should sum to 1)
    /** Flat points off the day's satisfaction if a stockout occurred. [TUNE] */
    stockoutPenalty: number; // points (0..100 scale)
    /** 0..1 — how much today's score moves the running average. [TUNE] */
    smoothing: number;
  };
  popularity: {
    /** Starting popularity at a new location. [TUNE] */
    start: number; // 0..100
    /** Points/day of organic growth, scaled by (1 - pop/100). [TUNE] */
    dailyGrowth: number;
    /** Points per promo dollar, scaled by (1 - pop/100). [TUNE] */
    promoPerDollar: number;
    /** Satisfaction below this decays popularity. [TUNE] */
    lowSatisfactionThreshold: number; // 0..100
    /** Points/day of decay when satisfaction is terrible. [TUNE] */
    lowSatisfactionDecay: number;
  };
  promo: {
    /** demand multiplier = 1 + scale * ln(1 + spend/steepness). [TUNE] */
    responseScale: number;
    responseSteepness: number; // dollars; first $ matter most
  };
  recipe: {
    /** Slider 1..5 -> component multiplier: mult = base + step*(v-3). [TUNE] */
    sliderBase: number;
    sliderStep: number;
  };
  startingCash: number; // dollars [TUNE]
}

export const TUNING: Tuning = {
  day: { openHour: 10, closeHour: 16, tickMinutes: 15 }, // [LOCK]

  rushCurve: [
    { hour: 10, v: 0.25 }, // dead morning
    { hour: 11, v: 0.55 }, // warming up
    { hour: 12, v: 1.0 }, // LUNCH RUSH
    { hour: 13.5, v: 1.0 }, // LUNCH RUSH
    { hour: 14.5, v: 0.6 }, // taper
    { hour: 16, v: 0.3 }, // winding down
  ], // [TUNE]

  weather: {
    conditions: [
      { id: "hot_sunny", weight: 25, tempF: [85, 98], demand_mult: 1.3, willingness_mult: 1.1 },
      { id: "nice", weight: 35, tempF: [70, 84], demand_mult: 1.1, willingness_mult: 1.0 },
      { id: "cloudy", weight: 20, tempF: [60, 75], demand_mult: 1.0, willingness_mult: 1.0 },
      { id: "rainy", weight: 12, tempF: [55, 70], demand_mult: 0.65, willingness_mult: 0.9 },
      { id: "cold", weight: 8, tempF: [35, 55], demand_mult: 0.55, willingness_mult: 0.85 },
    ], // [TUNE] retuned 2026-10-19 (tycoon frame, round 2): 0.5–1.4 spread.
    // The 0.35–1.5 spread made wrong-forecast mismatches catastrophic (-$65
    // days); 2.8x max mismatch keeps the gamble readable without ruin.
    forecastWrongChance: 0.28, // [TUNE] retuned 2026-10-19: push red-day rate into the 15-25% band
  },

  demand: {
    baseAppealFactor: 0.12, // [TUNE]
    appealWeight: 0.5, // [TUNE]
    popularityShare: 0.65, // [TUNE]
    queueCap: 12, // [TUNE] people
  },

  pricing: {
    willingnessJitter: 0.3, // [TUNE]
    sideItemAttachProb: 0.3, // [TUNE]
  },

  service: {
    serveMinutes: 1.5, // [TUNE] minutes per customer
  },

  satisfaction: {
    recipeWeight: 0.75, // [TUNE] — recipe is the primary driver, per the original
    priceWeight: 0.125, // [TUNE]
    servedWeight: 0.125, // [TUNE]
    stockoutPenalty: 15, // [TUNE] points
    smoothing: 0.3, // [TUNE]
  },

  popularity: {
    start: 10, // [TUNE]
    dailyGrowth: 1.5, // [TUNE] points/day at 0 popularity
    promoPerDollar: 0.35, // [TUNE]
    lowSatisfactionThreshold: 30, // [TUNE]
    lowSatisfactionDecay: 1.5, // [TUNE] points/day
  },

  promo: {
    responseScale: 0.35, // [TUNE]
    responseSteepness: 3.0, // [TUNE] dollars
  },

  recipe: {
    sliderBase: 1.0, // [TUNE] multiplier at slider=3
    sliderStep: 0.2, // [TUNE] per slider notch (1->0.6, 5->1.4)
  },

  startingCash: 200, // [TUNE] dollars
};

/** Deep-merge a partial tuning object over defaults (for sweeps / URL overrides). */
export function mergeTuning(base: Tuning, over: unknown): Tuning {
  if (over === null || typeof over !== "object" || Array.isArray(over)) return base;
  const b = base as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...b };
  for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
    const bv = b[k];
    if (v !== null && typeof v === "object" && !Array.isArray(v) && bv !== null && typeof bv === "object" && !Array.isArray(bv)) {
      out[k] = mergeTuning(bv as unknown as Tuning, v);
    } else {
      out[k] = v;
    }
  }
  return out as unknown as Tuning;
}

/** Set a tuning value by dot path, e.g. "popularity.dailyGrowth". Used by sweep. */
export function setTuningPath(tuning: Tuning, path: string, value: unknown): Tuning {
  const clone = JSON.parse(JSON.stringify(tuning)) as Tuning;
  const parts = path.split(".");
  let cur: Record<string, unknown> = clone as unknown as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const next = cur[p];
    if (next === null || typeof next !== "object") throw new Error(`bad tuning path: ${path}`);
    cur[p] = Array.isArray(next) ? [...(next as unknown[])] : { ...(next as Record<string, unknown>) };
    cur = cur[p] as Record<string, unknown>;
  }
  const last = parts[parts.length - 1];
  // coerce numeric strings
  const num = typeof value === "string" && value !== "" && !isNaN(Number(value)) ? Number(value) : value;
  cur[last] = num;
  return clone;
}
