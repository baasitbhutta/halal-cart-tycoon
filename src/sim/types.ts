/**
 * Core sim types. GameState is the persistent save; DayPlan is the player's
 * morning decisions; DayResult is everything that happened.
 *
 * All sim functions are pure: (theme, tuning, state, plan, seed) -> result.
 * No I/O, no Date.now(), no hidden state.
 */

/** One FIFO inventory lot: bought together, ages together. */
export interface Lot {
  qty: number;
  ageDays: number;
  unitCost: number; // dollars per unit (for COGS)
}

export interface DaySummary {
  day: number;
  visitors: number;
  revenue: number;
  earnings: number;
  satisfaction: number;
  tempF: number;
  /**
   * What the player saw on that day's results screen — the legitimate
   * memory a learning player (human or harness "regular") may plan from.
   * Optional: careers saved before these fields existed simply lack them.
   */
  locationId?: string;
  /** The day's ACTUAL weather condition id (revealed during the day). */
  conditionId?: string;
  served?: number;
  /** Customers lost to empty stock / sold-out items. */
  stockouts?: number;
  /** Visitors who looked at the price and walked. */
  missedPrice?: number;
  /** The flagship's price that day — the menu anchor a player remembers
   *  charging. (Best-seller fallback when the caller passes no flagship.) */
  price?: number;
}

export interface GameState {
  version: 1;
  day: number; // next day to play (1-based)
  cash: number; // dollars
  locationId: string;
  popularity: Record<string, number>; // locationId -> 0..100
  satisfaction: Record<string, number>; // locationId -> 0..100
  inventory: Record<string, Lot[]>; // supplyId -> lots (oldest first)
  upgrades: string[]; // owned upgrade ids
  crew: string[]; // hired crew role ids (re-chosen each morning via plan)
  cartTier: number; // index into theme.cartTiers
  history: DaySummary[];
  /** Career totals (added in M3; backfilled on load for older saves). */
  lifetimeEarnings: number;
  lifetimeServed: number;
  /** Active challenge run, if this career was started from one. */
  challengeId?: string;
  challengeStatus?: "active" | "won" | "lost";
}

export interface Purchase {
  supplyId: string;
  bundleIndex: number;
  count: number;
}

export interface DayPlan {
  locationId: string;
  purchases: Purchase[];
  recipe: Record<string, number>; // axisId -> slider value
  prices: Record<string, number>; // productId -> dollars
  promoSpend: number; // dollars
  crew: string[]; // role ids hired for today
  buyUpgrades: string[]; // upgrade ids to purchase this morning
}

export interface Ledger {
  revenue: number;
  stockUsed: number; // COGS of what was sold
  stockLost: number; // intraday waste (0 in M0; spoilage reported separately)
  grossProfit: number;
  marginPct: number;
  rent: number;
  promo: number;
  wages: number;
  upgradeCosts: number;
  totalExpense: number;
  earnings: number; // grossProfit - rent - promo - wages - upgradeCosts
}

export interface WeatherInfo {
  conditionId: string;
  tempF: number;
}

export interface SpoilageLine {
  supplyId: string;
  supplyName: string;
  qty: number;
  unit: string;
  value: number; // dollars lost
}

export interface DayResult {
  day: number;
  seed: number;
  locationId: string;
  forecast: WeatherInfo;
  actual: WeatherInfo;
  headlineId: string | null;
  headlineText: string | null;
  // customer flow
  visitors: number;
  served: number;
  missedPrice: number;
  missedWait: number;
  stockouts: number;
  itemsSold: Record<string, number>; // productId -> count
  // money
  ledger: Ledger;
  purchaseCost: number; // spent this morning on supplies
  // quality
  satisfaction: number; // location satisfaction AFTER update
  daySatisfaction: number; // today's raw score (0..100)
  recipeScoreAvg: number; // 0..1 across served customers
  popularity: number; // location popularity AFTER update
  // state deltas
  inventoryAfter: Record<string, Lot[]>;
  upgradesAfter: string[];
  cashAfter: number; // cash after day (before overnight)
  notes: string[];
  ticks: TickSummary[]; // per-tick playback log for the day view
}

export interface OvernightResult {
  state: GameState;
  spoiled: SpoilageLine[];
}

/** Per-tick telemetry for the animated day view. Recorded, not simulated —
 *  the UI just plays it back. */
export interface TickSummary {
  t: number; // decimal hour, e.g. 12.25
  arrivals: number;
  served: number;
  revenue: number; // dollars earned this tick
  queueEnd: number; // customers still waiting at tick end
  missedPrice: number;
  missedWait: number;
  stockouts: number;
}
