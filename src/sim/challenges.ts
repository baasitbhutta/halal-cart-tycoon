/**
 * Challenge scenarios + career ranks (M3).
 *
 * Challenges are time-boxed careers with a starting spot/cash and one goal.
 * Ranks are lifetime-earnings titles — the long-arc street cred ladder.
 */
import type { GameState } from "./types.js";

export type ChallengeGoal =
  | { kind: "cash"; atLeast: number }
  | { kind: "serve"; customers: number }
  | { kind: "satisfaction"; atLeast: number };

export interface ChallengeDef {
  id: string;
  name: string;
  emoji: string;
  blurb: string;
  days: number; // deadline: win on or before this day
  startCash: number;
  startLocationId: string;
  goal: ChallengeGoal;
}

export const CHALLENGES: ChallengeDef[] = [
  {
    id: "quick_flip",
    name: "Quick Flip",
    emoji: "🏃",
    blurb: "Turn $200 into $500 in 16 days from the side street. Pure hustle.",
    days: 16,
    startCash: 200,
    startLocationId: "midtown_side",
    goal: { kind: "cash", atLeast: 500 },
  },
  {
    id: "campus_crush",
    name: "Campus Crush",
    emoji: "🎓",
    blurb: "Columbia students are broke but loyal. Serve 160 of them in 21 days.",
    days: 21,
    startCash: 250,
    startLocationId: "columbia",
    goal: { kind: "serve", customers: 160 },
  },
  {
    id: "five_star",
    name: "Five-Star Cart",
    emoji: "⭐",
    blurb: "Make them love you: reach 85% satisfaction at any spot within 21 days.",
    days: 21,
    startCash: 200,
    startLocationId: "midtown_side",
    goal: { kind: "satisfaction", atLeast: 85 },
  },
  {
    id: "big_time",
    name: "Big Time",
    emoji: "🗽",
    blurb: "Times Square rent eats the unprepared. Start with $600, end with $2,000 in 21 days.",
    days: 21,
    startCash: 600,
    startLocationId: "times_square",
    goal: { kind: "cash", atLeast: 2000 },
  },
];

export function challengeById(id: string | undefined): ChallengeDef | null {
  return CHALLENGES.find((c) => c.id === id) ?? null;
}

/** Human-readable goal line for HUD/results. */
export function goalText(def: ChallengeDef): string {
  const g = def.goal;
  if (g.kind === "cash") return `Reach $${g.atLeast.toLocaleString()} cash`;
  if (g.kind === "serve") return `Serve ${g.customers} customers`;
  return `Reach ${g.atLeast}% satisfaction`;
}

/** Current progress toward the goal (0..1, capped). */
export function goalProgress(def: ChallengeDef, state: GameState): number {
  const g = def.goal;
  let cur = 0;
  let target = 1;
  if (g.kind === "cash") {
    cur = state.cash;
    target = g.atLeast;
  } else if (g.kind === "serve") {
    cur = state.lifetimeServed ?? 0;
    target = g.customers;
  } else {
    cur = Math.max(0, ...Object.values(state.satisfaction));
    target = g.atLeast;
  }
  return Math.max(0, Math.min(1, cur / target));
}

/**
 * Evaluate the run, given a state whose `day` is the LAST day already
 * played (the convention inside applyDayResult, which runs before the
 * overnight day-increment). A goal met wins immediately; reaching the
 * deadline day without it loses. Free-play careers (no challengeId) are
 * always "active".
 */
export function evalChallenge(state: GameState): "active" | "won" | "lost" {
  const def = challengeById(state.challengeId);
  if (!def) return "active";
  if (goalProgress(def, state) >= 1) return "won";
  const daysPlayed = state.day;
  if (daysPlayed >= def.days) return "lost";
  return "active";
}

// ---------- ranks ----------

export interface RankDef {
  at: number; // lifetime earnings threshold ($)
  name: string;
  emoji: string;
}

export const RANKS: RankDef[] = [
  { at: 0, name: "New Kid on the Block", emoji: "🧒" },
  { at: 750, name: "Sidewalk Slinger", emoji: "🌯" },
  { at: 2500, name: "Corner Fixture", emoji: "📍" },
  { at: 6000, name: "Lunch Rush Legend", emoji: "⚡" },
  { at: 12000, name: "White Sauce Royalty", emoji: "👑" },
  { at: 25000, name: "Cart Empire", emoji: "🏙️" },
];

export function rankFor(lifetimeEarnings: number): RankDef {
  let cur = RANKS[0];
  for (const r of RANKS) if (lifetimeEarnings >= r.at) cur = r;
  return cur;
}

/** Next rank after the current one, if any. */
export function nextRank(lifetimeEarnings: number): RankDef | null {
  return RANKS.find((r) => lifetimeEarnings < r.at) ?? null;
}
