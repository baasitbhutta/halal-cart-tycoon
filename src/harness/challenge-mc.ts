/**
 * challenge-mc — Monte Carlo + Markov analysis of challenge winnability.
 *
 * For every challenge in a theme pack, plays the scenario end-to-end with
 * each harness strategy (cart pinned to the scenario's spot, start cash and
 * deadline from the def) and scores the run with the game's own
 * evalChallenge. Answers: is each scenario possible, with which play styles,
 * and how often?
 *
 * Markov side: (satisfaction, popularity) band chains via metrics.ts, plus
 * a satisfaction-band chain for the satisfaction-goal scenario that yields
 * a model-based P(reach the goal band within the deadline) to cross-check
 * the brute-force win rate.
 *
 * Usage: node dist/src/harness/challenge-mc.js [--seeds 200] [--theme <path> ...]
 */
import { resolve } from "node:path";
import { loadTheme, type Theme } from "../theme-node.js";
import { TUNING } from "../tuning.js";
import {
  applyDayResult,
  newGame,
  overnight,
  rollMorning,
  simulateDay,
} from "../sim/day.js";
import { evalChallenge, type ChallengeDef } from "../sim/challenges.js";
import type { GameState } from "../sim/types.js";
import { STRATEGIES } from "./strategies.js";
import { markovAnalysis, type DayState } from "./metrics.js";

const seeds = (() => {
  const i = process.argv.indexOf("--seeds");
  return i >= 0 ? parseInt(process.argv[i + 1], 10) : 200;
})();
const themePaths = (() => {
  const out: string[] = [];
  process.argv.forEach((a, i) => {
    if (a === "--theme") out.push(process.argv[i + 1]);
  });
  return out.length
    ? out.map((p) => resolve(p))
    : [resolve("data/halal-cart.json"), resolve("data/taco-stand.json")];
})();

export interface RunOutcome {
  won: boolean;
  winDay: number | null;
  broke: boolean;
  finalCash: number;
  served: number;
  maxSatisfaction: number;
  seq: DayState[];
  satSeries: number[];
}

export function runChallenge(
  theme: Theme,
  def: ChallengeDef,
  strategyId: string,
  r: number,
): RunOutcome {
  const strategy = STRATEGIES[strategyId];
  let state: GameState = newGame(theme, TUNING, def.startLocationId);
  state.cash = def.startCash;
  state.challengeId = def.id;
  state.challengeStatus = "active";
  const seq: DayState[] = [];
  const satSeries: number[] = [];
  let broke = false;
  let winDay: number | null = null;
  for (let d = 1; d <= def.days; d++) {
    const seed = r * 100003 + (d - 1) * 7919 + 17;
    const morning = rollMorning(theme, TUNING, seed);
    const plan = strategy.plan(theme, TUNING, state, d - 1, {
      forecast: morning.forecast,
      headline: morning.headline,
    });
    plan.locationId = def.startLocationId; // the scenario pins the spot
    const res = simulateDay(theme, TUNING, state, plan, seed);
    state = applyDayResult(state, plan, res, [def], theme.products.find((p) => p.flagship)?.id);
    state = overnight(theme, TUNING, state).state;
    seq.push({ satisfaction: res.satisfaction, popularity: res.popularity });
    satSeries.push(res.satisfaction);
    if (res.cashAfter < 0) broke = true;
    // evalChallenge's convention: state.day = last day already played.
    if (evalChallenge({ ...state, day: d }, [def]) === "won") {
      winDay = d;
      break;
    }
  }
  return {
    won: winDay !== null,
    winDay,
    broke,
    finalCash: Math.round(state.cash * 100) / 100,
    served: state.lifetimeServed ?? 0,
    maxSatisfaction: Math.max(0, ...Object.values(state.satisfaction)),
    seq,
    satSeries,
  };
}

/** Satisfaction bands for the goal chain: [<60, 60-74, 75-84, >=85(goal)]. */
const satBand = (v: number) => (v < 60 ? 0 : v < 75 ? 1 : v < 85 ? 2 : 3);

function satisfactionHitting(series: number[][], days: number) {
  const counts = Array.from({ length: 4 }, () => Array(4).fill(0));
  const start = Array(4).fill(0);
  for (const s of series) {
    if (!s.length) continue;
    start[satBand(s[0])]++;
    for (let i = 0; i + 1 < s.length; i++) counts[satBand(s[i])][satBand(s[i + 1])]++;
  }
  const P = counts.map((row, i) => {
    const sum = row.reduce((a, b) => a + b, 0);
    return sum > 0 ? row.map((c) => c / sum) : row.map((_, j) => (i === j ? 1 : 0));
  });
  const startDist = start.map((c) => c / Math.max(1, start.reduce((a, b) => a + b, 0)));
  // DP over transient bands 0..2; band 3 is the absorbing goal.
  let hit = startDist[3];
  let q = [startDist[0], startDist[1], startDist[2]];
  const curve: number[] = [hit];
  for (let step = 1; step < days; step++) {
    let add = 0;
    const nq = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      add += q[i] * P[i][3];
      for (let j = 0; j < 3; j++) nq[j] += q[i] * P[i][j];
    }
    hit += add;
    q = nq;
    curve.push(hit);
  }
  return { P, startDist, hitByDeadline: hit, curve };
}

const pct = (x: number) => `${Math.round(x * 100)}%`;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

if (import.meta.url === `file://${process.argv[1]}`) {
for (const themePath of themePaths) {
  const theme = loadTheme(themePath);
  const defs = theme.challenges ?? [];
  console.log(`\n══ ${theme.name} (${theme.id}) — ${defs.length} challenges × ${seeds} seeds ══`);
  for (const def of defs) {
    console.log(`\n── ${def.emoji} ${def.name} — start $${def.startCash} @ ${def.startLocationId}, ${def.days} days, goal ${JSON.stringify(def.goal)}`);
    for (const strategyId of Object.keys(STRATEGIES)) {
      const runs: RunOutcome[] = [];
      for (let r = 0; r < seeds; r++) runs.push(runChallenge(theme, def, strategyId, r));
      const wins = runs.filter((x) => x.won);
      const winRate = wins.length / runs.length;
      const medWinDay = wins.length ? median(wins.map((x) => x.winDay!)) : NaN;
      const brokeRate = runs.filter((x) => x.broke).length / runs.length;
      const medCash = median(runs.map((x) => x.finalCash));
      const medServed = median(runs.map((x) => x.served));
      const medMaxSat = median(runs.map((x) => x.maxSatisfaction));
      console.log(
        `   ${strategyId.padEnd(11)} win ${pct(winRate).padStart(4)}` +
          (wins.length ? `  median win day ${medWinDay}` : "  never won") +
          `  broke ${pct(brokeRate)}  median end: $${medCash} · served ${medServed} · maxSat ${medMaxSat}%`,
      );
      if (strategyId === "regular") {
        const mk = markovAnalysis(runs.map((x) => x.seq));
        const goodMass = mk.stationary.reduce(
          (s, p, i) => (i >= 6 ? s + p : s),
          0,
        );
        console.log(
          `   ↳ Markov (regular): stationary P(satisfaction high) ${pct(goodMass)}, worst recovery from a bad state ${mk.worstRecoveryDays ?? "—"}d, ${mk.totalTransitions} transitions`,
        );
        if (def.goal.kind === "satisfaction") {
          const h = satisfactionHitting(
            runs.map((x) => x.satSeries),
            def.days,
          );
          console.log(
            `   ↳ Markov satisfaction chain: start bands ${h.startDist.map(pct).join("/")} [<60/60-74/75-84/≥85], P(reach ≥85 within ${def.days}d) = ${pct(h.hitByDeadline)} (brute-force MC win rate ${pct(winRate)})`,
          );
          console.log(
            `     transition rows: ${h.P.map((row) => "[" + row.map((p) => p.toFixed(2)).join(", ") + "]").join(" ")}`,
          );
        }
      }
    }
  }
}
}
