import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadTheme } from "../src/theme-node.js";
import { TUNING } from "../src/tuning.js";
import { newGame, applyDayResult, simulateDay } from "../src/sim/day.js";
import {
  challengeById,
  evalChallenge,
  goalProgress,
  rankFor,
  nextRank,
} from "../src/sim/challenges.js";

const here = dirname(fileURLToPath(import.meta.url));
const theme = loadTheme(resolve(here, "..", "..", "data", "halal-cart.json"));
const defs = theme.challenges!;

const baseState = () => {
  const s = newGame(theme, TUNING);
  s.challengeId = "quick_flip";
  s.challengeStatus = "active";
  return s;
};

test("cash goal: active mid-run, won when reached, lost at deadline", () => {
  const def = challengeById("quick_flip", defs)!;
  const g = def.goal as { kind: string; atLeast: number };
  const mid = baseState();
  mid.day = 5;
  mid.cash = g.atLeast - 100;
  assert.equal(evalChallenge(mid, defs), "active");
  const win = baseState();
  win.day = 3;
  win.cash = g.atLeast + 100;
  assert.equal(evalChallenge(win, defs), "won");
  const late = baseState();
  late.day = def.days; // deadline day played without meeting the goal
  late.cash = g.atLeast - 100;
  assert.equal(evalChallenge(late, defs), "lost");
});

test("serve goal counts lifetime customers", () => {
  const def = challengeById("campus_crush", defs)!;
  const s = baseState();
  s.challengeId = "campus_crush";
  s.day = 10;
  const target = (def.goal as { customers: number }).customers;
  s.lifetimeServed = Math.floor(target * 0.625);
  assert.equal(evalChallenge(s, defs), "active");
  assert.ok(goalProgress(def, s) > 0.6 && goalProgress(def, s) < 0.7);
  s.lifetimeServed = target;
  assert.equal(evalChallenge(s, defs), "won");
});

test("satisfaction goal uses the best location", () => {
  const s = baseState();
  s.challengeId = "five_star";
  s.day = 4;
  s.satisfaction = { midtown_side: 60, fidi: 87 };
  assert.equal(evalChallenge(s, defs), "won");
});

test("free play careers stay active forever", () => {
  const s = newGame(theme, TUNING);
  s.day = 999;
  s.cash = -500;
  assert.equal(evalChallenge(s, defs), "active");
});

test("applyDayResult accumulates lifetime totals and flips challenge status", () => {
  const s = baseState();
  s.day = challengeById("quick_flip", defs)!.days; // last day of the challenge
  s.cash = 495;
  const plan = {
    locationId: "midtown_side",
    purchases: [],
    recipe: {},
    prices: {},
    promoSpend: 0,
    crew: [],
    buyUpgrades: [],
  };
  const r = simulateDay(theme, TUNING, s, plan, 777);
  const next = applyDayResult(s, plan, r, defs);
  assert.equal(next.lifetimeServed, (s.lifetimeServed ?? 0) + r.served);
  assert.equal(
    next.lifetimeEarnings,
    (s.lifetimeEarnings ?? 0) + r.ledger.earnings,
  );
  // if the day pushed cash over the $500 goal, status should be won
  const won = next.cash >= 500;
  assert.equal(next.challengeStatus, won ? "won" : "lost");
});

test("ranks: thresholds and progression", () => {
  assert.equal(rankFor(0).name, "New Kid on the Block");
  assert.equal(rankFor(749).name, "New Kid on the Block");
  assert.equal(rankFor(750).name, "Sidewalk Slinger");
  assert.equal(rankFor(100000).name, "Cart Empire");
  assert.equal(nextRank(0)?.at, 750);
  assert.equal(nextRank(100000), null);
});

test("four challenges are all winnable in principle (defs sane)", () => {
  assert.equal(defs.length, 4);
  for (const c of defs) {
    assert.ok(c.days > 0 && c.days <= 31);
    assert.ok(c.startCash > 0);
    assert.ok(theme.locations.some((l) => l.id === c.startLocationId));
  }
});

test("taco pack carries the same scenarios, mirrored by ladder position", () => {
  const taco = loadTheme(resolve(here, "..", "..", "data", "taco-stand.json"));
  const tdefs = taco.challenges!;
  assert.equal(tdefs.length, defs.length);
  const hIdx = new Map(theme.locations.map((l, i) => [l.id, i]));
  const tIdx = new Map(taco.locations.map((l, i) => [l.id, i]));
  for (let i = 0; i < defs.length; i++) {
    assert.equal(tdefs[i].id, defs[i].id);
    assert.equal(tdefs[i].days, defs[i].days);
    assert.equal(tdefs[i].startCash, defs[i].startCash);
    assert.deepEqual(tdefs[i].goal, defs[i].goal);
    assert.equal(tIdx.get(tdefs[i].startLocationId), hIdx.get(defs[i].startLocationId));
    // and the taco scenarios actually evaluate
    const st = newGame(taco, TUNING);
    st.challengeId = tdefs[i].id;
    st.day = 1;
    assert.equal(evalChallenge(st, tdefs), "active");
  }
});
