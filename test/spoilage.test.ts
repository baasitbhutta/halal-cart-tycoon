import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadTheme } from "../src/theme-node.js";
import { TUNING } from "../src/tuning.js";
import { newGame, overnight } from "../src/sim/day.js";
import { stockOnHand } from "../src/sim/economy.js";

const here = dirname(fileURLToPath(import.meta.url));
const theme = loadTheme(resolve(here, "..", "..", "data", "halal-cart.json"));

function stateWithChicken() {
  const s = newGame(theme, TUNING);
  s.inventory = {
    chicken_lb: [{ qty: 10, ageDays: 0, unitCost: 2.4 }],
    rice_lb: [{ qty: 10, ageDays: 0, unitCost: 0.8 }],
    container_each: [{ qty: 100, ageDays: 0, unitCost: 0.08 }],
  };
  return s;
}

test("chicken (1-day shelf life) spoils overnight", () => {
  const { state: next, spoiled } = overnight(theme, TUNING, stateWithChicken());
  assert.equal(stockOnHand(next.inventory["chicken_lb"]), 0);
  assert.ok(spoiled.some((s) => s.supplyId === "chicken_lb" && s.qty === 10));
});

test("rice (2-day shelf life) survives one night, spoils after two", () => {
  const { state: d2 } = overnight(theme, TUNING, stateWithChicken());
  assert.equal(stockOnHand(d2.inventory["rice_lb"]), 10);
  const { state: d3, spoiled } = overnight(theme, TUNING, d2);
  assert.equal(stockOnHand(d3.inventory["rice_lb"]), 0);
  assert.ok(spoiled.some((s) => s.supplyId === "rice_lb"));
});

test("containers never spoil", () => {
  let s = stateWithChicken();
  for (let i = 0; i < 5; i++) s = overnight(theme, TUNING, s).state;
  assert.equal(stockOnHand(s.inventory["container_each"]), 100);
});

test("FIFO: oldest lots spoil first, newer lots keep their age", () => {
  const s = newGame(theme, TUNING);
  s.inventory = {
    rice_lb: [
      { qty: 5, ageDays: 1, unitCost: 0.8 },
      { qty: 5, ageDays: 0, unitCost: 0.8 },
    ],
  };
  const { state: next } = overnight(theme, TUNING, s);
  // old lot (age 1->2) spoils; new lot (age 0->1) survives
  assert.equal(stockOnHand(next.inventory["rice_lb"]), 5);
  assert.equal(next.inventory["rice_lb"][0].ageDays, 1);
});
