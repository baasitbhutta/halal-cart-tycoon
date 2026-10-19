/**
 * Lemonade Stand 1973/1979 benchmark — the genre's origin story, implemented
 * faithfully from the original Applesoft BASIC source (Bob Jamison, MECC 1973;
 * Apple II port by Charlie Kellner, Feb 1979), recovered from the open-source
 * REALbasic port (codenautics.com; original source embedded as a project note).
 *
 * Why this matters: it is the same genre as our game, fully measurable, with
 * REAL stakes (bankruptcy exists). It tells us what "classic tycoon volatility"
 * looks like numerically — the calibration target this benchmark exists for.
 *
 * Faithful mechanics (all money in integer cents, as in the original):
 * - Start: $2.00 assets. Open-ended (no day limit); the run ends at bankruptcy.
 * - Cost per glass: days 1-2: 2c ("mother gave free sugar"), days 3-6: 4c,
 *   day 7+: 5c. You cannot spend more than you have (validated at input).
 * - Weather roll: r<0.6 sunny, r<0.8 cloudy, else hot (sunny forced on days 1-2).
 *   Cloudy: J = 30+floor(rng*5)*10 % "chance of light rain" shown; demand x(1-J/100).
 *   At results time, cloudy days have a FLAT 25% thunderstorm chance -> 0 sales
 *   (the shown J% only scales demand; the storm is a separate surprise roll).
 * - Hot: demand x2 ("heat wave").
 * - Street event (sunny, day>2): 25% chance "street department working".
 *   Then 50/50: crew buys ALL your lemonade at your price (jackpot), or
 *   demand x0.1 ("no traffic"). See RND_QUIRK below.
 * - Demand: price<=10c: N1 = (10-p)/10*24 + 30; price>10c: N1 = 3000/p^2.
 *   Ad benefit V = 1 - exp(-0.5*signs); N2 = floor(R1 * N1 * (1+V)).
 *   sold = min(N2, glasses) — or ALL glasses on jackpot, or 0 on storm.
 * - profit = sold*price - glasses*cost - signs*15c; assets += profit (floored at 0).
 * - Bankruptcy: assets <= cost of one glass -> "YOU DON'T HAVE ENOUGH MONEY
 *   LEFT TO STAY IN BUSINESS YOU'RE BANKRUPT!"
 *
 * RND_QUIRK (documented, not replicated): the 1979 listing's street-crew branch
 * reads `IF RND(-1) < .5 THEN ...`. In Applesoft BASIC a negative RND argument
 * RESEEDS the generator, so RND(-1) returns the same constant every call —
 * on real 1979 hardware this branch was deterministic (always jackpot or always
 * dead-day), not 50/50. But the author's own variable notes say "R2: set to 2
 * half the time when street department is working", Raymond Chen's formula
 * extraction says "50% chance", and the open-source port implements 50/50.
 * We implement the evident authorial INTENT (50/50). The quirk changes only the
 * tail (jackpot frequency), not the core volatility story.
 *
 * Ad-formula note: the original code computes V = 1 - 1*exp(-0.5*signs)
 * (C2=1, C9=0.5). Chen's article writes it as 1 - 0.5*exp(-signs). We use the
 * original source (C2=1, C9=0.5).
 *
 * Metrics reuse the EXACT definitions in src/harness/metrics.ts (distStats,
 * recoveryStats, decisionDominance) so the numbers are directly comparable
 * with our cart and the turnip benchmark.
 *
 * Sources:
 * - Raymond Chen, "Summertime, and the lemonade is easy", The Old New Thing,
 *   2017-06-21: https://devblogs.microsoft.com/oldnewthing/20170621-00/?p=96436/
 * - Original Applesoft BASIC source via codenautics.com REALbasic port
 *   (http://www.codenautics.com/lemonade/, source: strout.net)
 *
 * Usage: node dist/src/harness/benchmarks/lemonade1973.js [--seeds 200] [--days 30]
 */
import { mulberry32 } from "../../rng.js";
import { decisionDominance, distStats, recoveryStats } from "../metrics.js";

type Rng = () => number;

export const START_ASSETS_CENTS = 200;
export const SIGN_COST_CENTS = 15;
export const MAX_PRICE_CENTS = 100;

export type Weather73 = "sunny" | "cloudy" | "hot";
export type StreetEvent = "none" | "jackpot" | "dead";

export interface L73Plan {
  glasses: number; // 0..1000, integer
  signs: number; // 0..50, integer
  priceCents: number; // 0..100, integer
}

export interface L73Day {
  day: number;
  weather: Weather73;
  rainChancePct: number; // shown on cloudy days
  storm: boolean; // thunderstorm voided the day
  streetEvent: StreetEvent;
  costPerGlass: number; // cents
  demand: number; // N2 before min() with glasses
  sold: number;
  incomeCents: number;
  expensesCents: number;
  profitCents: number;
  assetsCents: number; // after applying profit, floored at 0
  bankrupt: boolean;
}

export function costPerGlass(day: number): number {
  if (day <= 2) return 2;
  if (day <= 6) return 4;
  return 5;
}

/** Nominal demand N1 for a price in cents (original lines 1190-1220). */
export function nominalDemand(priceCents: number): number {
  if (priceCents <= 10) return ((10 - priceCents) / 10) * 0.8 * 30 + 30;
  return (100 * 30) / (priceCents * priceCents);
}

/** Ad benefit V = 1 - exp(-0.5 * signs) (original lines 1230-1232, C2=1, C9=0.5). */
export function adBenefit(signs: number): number {
  return 1 - Math.exp(-0.5 * signs);
}

/**
 * One faithful day of 1973 Lemonade Stand.
 * `day` is 1-indexed. The plan is clamped to what the player can afford,
 * mirroring the original's input validation ("THINK AGAIN!!! YOU HAVE ONLY...").
 */
export function simulateDay1973(
  assetsCents: number,
  plan: L73Plan,
  day: number,
  rng: Rng,
): L73Day {
  const cost = costPerGlass(day);

  // --- weather (original lines 410-470) ---
  let weather: Weather73;
  const r = rng();
  if (r < 0.6) weather = "sunny";
  else if (r < 0.8) weather = "cloudy";
  else weather = day < 3 ? "sunny" : "hot";

  let r1 = 1; // weather factor
  let rainChancePct = 0;
  let storm = false;
  let streetEvent: StreetEvent = "none";

  if (weather === "cloudy") {
    rainChancePct = 30 + Math.floor(rng() * 5) * 10;
    r1 = 1 - rainChancePct / 100;
    // thunderstorm: flat 25%, resolved at results time (original line 1120).
    // Same distribution resolved here; the player never sees it coming either way.
    storm = rng() < 0.25;
  } else if (weather === "hot") {
    r1 = 2;
  } else {
    // sunny, day > 2: street department event (original lines 2040, 2210-2250)
    if (day > 2 && rng() < 0.25) {
      // Authorial intent is 50/50 (see RND_QUIRK above).
      if (rng() < 0.5) streetEvent = "jackpot";
      else {
        streetEvent = "dead";
        r1 = 0.1;
      }
    }
  }

  // --- input validation: clamp to affordable (original lines 910, 970) ---
  let glasses = Math.max(0, Math.min(1000, Math.floor(plan.glasses)));
  let signs = Math.max(0, Math.min(50, Math.floor(plan.signs)));
  const priceCents = Math.max(0, Math.min(100, Math.floor(plan.priceCents)));
  const maxGlasses = Math.floor(assetsCents / cost);
  if (glasses > maxGlasses) glasses = maxGlasses;
  const cashAfterGlasses = assetsCents - glasses * cost;
  const maxSigns = Math.floor(cashAfterGlasses / SIGN_COST_CENTS);
  if (signs > maxSigns) signs = maxSigns;

  // --- demand (original lines 1190-1260) ---
  const n1 = nominalDemand(priceCents);
  const v = adBenefit(signs);
  const demand = Math.floor(r1 * n1 * (1 + v));

  let sold: number;
  if (storm) sold = 0;
  else if (streetEvent === "jackpot") sold = glasses; // original line 1187 -> 1260
  else sold = Math.min(demand, glasses);

  const incomeCents = sold * priceCents;
  const expensesCents = glasses * cost + signs * SIGN_COST_CENTS;
  const profitCents = incomeCents - expensesCents;

  // --- assets (original lines 1186, 1290-1380) ---
  let assets = assetsCents + profitCents;
  if (assets < 0) assets = 0;
  const bankrupt = assets <= cost; // "can't afford a single glass"

  return {
    day,
    weather,
    rainChancePct,
    storm,
    streetEvent,
    costPerGlass: cost,
    demand,
    sold,
    incomeCents,
    expensesCents,
    profitCents,
    assetsCents: assets,
    bankrupt,
  };
}

// ---------------------------------------------------------------------------
// Strategies — the "selected" side (player decisions)
// ---------------------------------------------------------------------------

export interface L73Strategy {
  id: string;
  name: string;
  blurb: string;
  /**
   * What the player knows at decision time: the weather forecast type
   * (sunny/cloudy/hot), the shown rain chance on cloudy days, whether the
   * street department was announced (but NOT jackpot-vs-dead), the day,
   * and current assets. The storm is always a surprise.
   */
  plan: (info: {
    day: number;
    weather: Weather73;
    rainChancePct: number;
    streetAnnounced: boolean;
    assetsCents: number;
  }) => L73Plan;
}

/** Price by weather; production matched to expected demand. */
function expectedDemand(priceCents: number, signs: number, r1: number): number {
  return Math.floor(r1 * nominalDemand(priceCents) * (1 + adBenefit(signs)));
}

export const L73_STRATEGIES: Record<string, L73Strategy> = {
  sensible: {
    id: "sensible",
    name: "Sensible (price by weather, produce to expected demand)",
    blurb: "The competent player: reads the forecast, matches production to demand.",
    plan: ({ weather, rainChancePct }) => {
      const priceCents = weather === "hot" ? 12 : weather === "sunny" ? 10 : 6;
      const signs = 5;
      const r1 = weather === "hot" ? 2 : weather === "sunny" ? 1 : 1 - rainChancePct / 100;
      return {
        glasses: expectedDemand(priceCents, signs, r1),
        signs,
        priceCents,
      };
    },
  },
  greedy: {
    id: "greedy",
    name: "Jackpot gambler ($1.00 price, max batch, no ads)",
    blurb:
      "Raymond Chen's childhood strategy: max price, tons of lemonade, " +
      "gambling on the street crew buying it all. Near-zero normal demand.",
    plan: ({ assetsCents, day }) => ({
      glasses: Math.min(1000, Math.floor(assetsCents / costPerGlass(day))),
      signs: 0,
      priceCents: 100,
    }),
  },
  sloppy: {
    id: "sloppy",
    name: "Sloppy (flat 25c, 2x overproduction, 20 signs)",
    blurb: "The careless player: overproduces, overspends on ads, ignores weather.",
    plan: ({ weather, rainChancePct }) => {
      const r1 = weather === "hot" ? 2 : weather === "sunny" ? 1 : 1 - rainChancePct / 100;
      return {
        glasses: 2 * expectedDemand(25, 20, r1),
        signs: 20,
        priceCents: 25,
      };
    },
  },
  sharpshooter: {
    id: "sharpshooter",
    name: "Sharpshooter (bets 10% of bankroll at $1.00, no ads)",
    blurb:
      "The SMART version of Chen's jackpot strategy: same $1.00 price and " +
      "street-crew gamble, but sized to survive (Kelly-optimal is ~2.6%; " +
      "10% is aggressive). Tests whether the game's true optimal play is " +
      "high-volatility positive-EV gambling.",
    plan: ({ assetsCents, day }) => {
      const cost = costPerGlass(day);
      const stake = Math.floor(assetsCents * 0.1);
      // Always bet at least 1 glass when solvent: the original's minimum bet
      // is a single glass, and floor() would otherwise sideline tiny bankrolls.
      const glasses = Math.max(1, Math.floor(stake / cost));
      return {
        glasses: Math.min(1000, glasses),
        signs: 0,
        priceCents: 100,
      };
    },
  },
};

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

export interface L73Run {
  profits: number[]; // daily profit in DOLLARS (post-bankruptcy days = 0)
  bankruptDay: number | null; // 1-indexed day of bankruptcy, if any
  finalAssetsCents: number;
}

export function runL73(
  strategy: L73Strategy,
  days: number,
  seed: number,
): L73Run {
  const rng = mulberry32(seed);
  let assets = START_ASSETS_CENTS;
  const profits: number[] = [];
  let bankruptDay: number | null = null;

  for (let day = 1; day <= days; day++) {
    if (bankruptDay !== null) {
      profits.push(0);
      continue;
    }
    // Roll the day's weather/events first and show the strategy only the
    // PUBLIC information (forecast, rain chance, street announcement) —
    // exactly what the original shows before decisions. The storm outcome
    // and jackpot-vs-dead branch stay hidden, as in the original.
    const info = forecast1973(day, rng);
    const plan = strategy.plan({
      day,
      weather: info.weather,
      rainChancePct: info.rainChancePct,
      streetAnnounced: info.streetAnnounced,
      assetsCents: assets,
    });
    const d = simulateDay1973WithForecast(assets, plan, day, info);
    profits.push(d.profitCents / 100);
    assets = d.assetsCents;
    if (d.bankrupt) bankruptDay = day;
  }
  return { profits, bankruptDay, finalAssetsCents: assets };
}

interface Forecast73 {
  weather: Weather73;
  rainChancePct: number;
  storm: boolean;
  streetEvent: StreetEvent;
  streetAnnounced: boolean;
}

/** The public + hidden rolls for a day, matching simulateDay1973's logic. Exported for testing/debugging. */
export function forecast1973(day: number, rng: Rng): Forecast73 {
  const r = rng();
  let weather: Weather73;
  if (r < 0.6) weather = "sunny";
  else if (r < 0.8) weather = "cloudy";
  else weather = day < 3 ? "sunny" : "hot";

  let rainChancePct = 0;
  let storm = false;
  let streetEvent: StreetEvent = "none";
  let streetAnnounced = false;

  if (weather === "cloudy") {
    rainChancePct = 30 + Math.floor(rng() * 5) * 10;
    storm = rng() < 0.25;
  } else if (weather === "sunny" && day > 2 && rng() < 0.25) {
    streetAnnounced = true;
    streetEvent = rng() < 0.5 ? "jackpot" : "dead";
  }
  return { weather, rainChancePct, storm, streetEvent, streetAnnounced };
}

/** simulateDay1973, but taking a pre-rolled forecast so strategies can't peek. */
export function simulateDay1973WithForecast(
  assetsCents: number,
  plan: L73Plan,
  day: number,
  f: Forecast73,
): L73Day {
  const cost = costPerGlass(day);
  let r1 = 1;
  if (f.weather === "cloudy") r1 = 1 - f.rainChancePct / 100;
  else if (f.weather === "hot") r1 = 2;
  if (f.streetEvent === "dead") r1 = 0.1;

  let glasses = Math.max(0, Math.min(1000, Math.floor(plan.glasses)));
  let signs = Math.max(0, Math.min(50, Math.floor(plan.signs)));
  const priceCents = Math.max(0, Math.min(100, Math.floor(plan.priceCents)));
  const maxGlasses = Math.floor(assetsCents / cost);
  if (glasses > maxGlasses) glasses = maxGlasses;
  const maxSigns = Math.floor((assetsCents - glasses * cost) / SIGN_COST_CENTS);
  if (signs > maxSigns) signs = maxSigns;

  const n1 = nominalDemand(priceCents);
  const v = adBenefit(signs);
  const demand = Math.floor(r1 * n1 * (1 + v));

  let sold: number;
  if (f.storm) sold = 0;
  else if (f.streetEvent === "jackpot") sold = glasses;
  else sold = Math.min(demand, glasses);

  const incomeCents = sold * priceCents;
  const expensesCents = glasses * cost + signs * SIGN_COST_CENTS;
  const profitCents = incomeCents - expensesCents;

  let assets = assetsCents + profitCents;
  if (assets < 0) assets = 0;
  const bankrupt = assets <= cost;

  return {
    day,
    weather: f.weather,
    rainChancePct: f.rainChancePct,
    storm: f.storm,
    streetEvent: f.streetEvent,
    costPerGlass: cost,
    demand,
    sold,
    incomeCents,
    expensesCents,
    profitCents,
    assetsCents: assets,
    bankrupt,
  };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): { seeds: number; days: number; strategies: string[] } {
  const out = { seeds: 200, days: 30, strategies: Object.keys(L73_STRATEGIES) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--seeds") out.seeds = parseInt(argv[++i], 10);
    else if (argv[i] === "--days") out.days = parseInt(argv[++i], 10);
    else if (argv[i] === "--strategies") out.strategies = argv[++i].split(",");
  }
  return out;
}

function main(): void {
  const { seeds, days, strategies } = parseArgs(process.argv.slice(2));
  console.log("=== Lemonade Stand 1973 benchmark (faithful reimplementation) ===");
  console.log(`seeds=${seeds} days=${days} strategies=${strategies.join(",")}`);
  console.log("daily metric = profit in dollars (post-bankruptcy days count as $0)\n");

  const byStrategy: Record<string, { runProfits: number[][]; bankrupt: number }> = {};
  for (const id of strategies) {
    const s = L73_STRATEGIES[id];
    if (!s) {
      console.error(`unknown strategy: ${id}`);
      process.exit(1);
    }
    const runProfits: number[][] = [];
    let bankrupt = 0;
    for (let seed = 0; seed < seeds; seed++) {
      const run = runL73(s, days, 1000 + seed);
      runProfits.push(run.profits);
      if (run.bankruptDay !== null) bankrupt++;
    }
    byStrategy[id] = { runProfits, bankrupt };
  }

  // Per-strategy table (flatten all daily profits across runs)
  console.log("strategy                 mean     std      CV    p10    p50    p90  %loss  %bnkrpt");
  console.log("--------------------------------------------------------------------------------");
  const stats: Record<string, ReturnType<typeof distStats>> = {};
  for (const id of strategies) {
    const { runProfits, bankrupt } = byStrategy[id];
    const flat = runProfits.flat();
    const st = distStats(flat);
    stats[id] = st;
    const pctBnkrpt = (100 * bankrupt) / seeds;
    console.log(
      `${id.padEnd(24)} ${st.mean.toFixed(2).padStart(7)} ${st.std.toFixed(2).padStart(7)} ` +
        `${st.cv.toFixed(2).padStart(6)} ${st.p10.toFixed(2).padStart(6)} ${st.p50.toFixed(2).padStart(6)} ` +
        `${st.p90.toFixed(2).padStart(6)} ${st.pctNegative.toFixed(1).padStart(6)} ${pctBnkrpt.toFixed(1).padStart(7)}`,
    );
  }

  // Decision dominance: sensible vs greedy (and vs sloppy)
  if (stats.sensible && stats.greedy) {
    console.log(
      `\ndecision dominance |mean(sensible)-mean(greedy)|/std(sensible) = ` +
        `${decisionDominance(stats.sensible.mean, stats.greedy.mean, stats.sensible.std).toFixed(2)}`,
    );
  }
  if (stats.sensible && stats.sloppy) {
    console.log(
      `decision dominance |mean(sensible)-mean(sloppy)|/std(sensible) = ` +
        `${decisionDominance(stats.sensible.mean, stats.sloppy.mean, stats.sensible.std).toFixed(2)}`,
    );
  }

  // Recovery stats per strategy
  console.log("\n-- recovery (bad day = profit < 50% of trailing 7-day mean) --");
  for (const id of strategies) {
    const r = recoveryStats(byStrategy[id].runProfits);
    console.log(
      `${id.padEnd(12)} badDays=${r.badDays} meanRec=${r.meanRecoveryDays.toFixed(1)}d ` +
        `maxRec=${r.maxRecoveryDays}d unrecovered=${r.unrecovered}`,
    );
  }
}

const isMain = process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "");
if (isMain) main();
