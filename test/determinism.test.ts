import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadTheme } from "../src/theme-node.js";
import { TUNING } from "../src/tuning.js";
import { applyDayResult, defaultPlan, newGame, overnight, simulateDay } from "../src/sim/day.js";

const here = dirname(fileURLToPath(import.meta.url));
const theme = loadTheme(resolve(here, "..", "..", "data", "halal-cart.json"));

test("same seed + plan => identical DayResult", () => {
  const plan = defaultPlan(theme);
  const s1 = newGame(theme, TUNING);
  const s2 = newGame(theme, TUNING);
  const r1 = simulateDay(theme, TUNING, s1, plan, 12345);
  const r2 = simulateDay(theme, TUNING, s2, plan, 12345);
  assert.equal(JSON.stringify(r1), JSON.stringify(r2));
});

test("different seeds => (almost surely) different results", () => {
  const plan = defaultPlan(theme);
  const r1 = simulateDay(theme, TUNING, newGame(theme, TUNING), plan, 1);
  const r2 = simulateDay(theme, TUNING, newGame(theme, TUNING), plan, 2);
  assert.notEqual(JSON.stringify(r1), JSON.stringify(r2));
});

test("multi-day run is deterministic end to end", () => {
  const run = (seedBase: number) => {
    const plan = defaultPlan(theme);
    let state = newGame(theme, TUNING);
    for (let d = 0; d < 5; d++) {
      const r = simulateDay(theme, TUNING, state, plan, seedBase + d);
      state = applyDayResult(state, plan, r);
      state = overnight(theme, TUNING, state).state;
    }
    return state;
  };
  assert.equal(JSON.stringify(run(7)), JSON.stringify(run(7)));
});
