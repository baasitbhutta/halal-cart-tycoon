/**
 * Challenge scenarios + career ranks (M3).
 *
 * Challenge DEFINITIONS live in the theme packs (theme.challenges) — each
 * pack carries its own scenario set with its own locations and copy; this
 * module holds the types and the theme-agnostic goal/eval logic.
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

export function challengeById(
  id: string | undefined,
  defs: ChallengeDef[],
): ChallengeDef | null {
  return defs.find((c) => c.id === id) ?? null;
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
export function evalChallenge(
  state: GameState,
  defs: ChallengeDef[],
): "active" | "won" | "lost" {
  const def = challengeById(state.challengeId, defs);
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
