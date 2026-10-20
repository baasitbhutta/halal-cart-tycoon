/**
 * Headless smoke test for the M1 web UI (dev-only, not part of npm test).
 * Bundles web/src/main.ts with esbuild, runs it in jsdom, and plays a full
 * day: menu -> planning (click every tab) -> OPEN CART -> skip day ->
 * results -> next day. Fails loudly on any exception or missing screen.
 *
 * Usage: npm run build:web && node scripts/smoke-web.mjs
 */
import { readFileSync } from "node:fs";
import { buildSync } from "esbuild";
import { JSDOM } from "jsdom";

const APP = new URL("..", import.meta.url).pathname.replace(/\/$/, "");

// 1. bundle the web app
buildSync({
  entryPoints: [`${APP}/web/src/main.ts`],
  bundle: true,
  format: "esm",
  platform: "browser",
  outfile: "/tmp/smoke-web/app.mjs",
  logLevel: "silent",
});

// 2. jsdom environment
const themeJson = JSON.parse(readFileSync(`${APP}/data/halal-cart.json`, "utf8"));
const dom = new JSDOM(`<!doctype html><html><body><div id="app"></div></body></html>`, {
  url: "http://localhost/?seed=42",
});
const { window } = dom;
for (const k of ["document", "location", "localStorage", "history"]) {
  try {
    globalThis[k] = window[k];
  } catch {
    /* read-only global (navigator) — jsdom window covers it via `window.` */
  }
}
globalThis.window = window;
globalThis.fetch = async () => ({ ok: true, json: async () => themeJson });
globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
// jsdom ships no canvas 2d implementation; stub a no-op context so the
// isometric scene constructs and runs its logic without touching pixels.
// (Real rendering is QA'd in a live browser, not here.)
{
  const noop = new Proxy(
    {},
    {
      get: (_t, p) => (p === Symbol.toPrimitive ? () => 0 : (..._a) => noop),
      set: () => true,
    },
  );
  window.HTMLCanvasElement.prototype.getContext = () => noop;
}

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`SMOKE FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (sel) => document.querySelector(sel);
const qa = (sel) => [...document.querySelectorAll(sel)];
const clickText = (text) => {
  const b = qa("button").find((x) => x.textContent.includes(text));
  assert(b, `button "${text}" exists`);
  b.click();
};

// 3. boot
await import("/tmp/smoke-web/app.mjs");
await sleep(300);
assert(q("#app h1")?.textContent.includes("HALAL CART"), "menu screen renders");

// 4. new career -> planning
clickText("New career");
await sleep(300);
assert(document.body.textContent.includes("Morning planning"), "planning screen renders");

// 4b. price input regression: on 'input' the field must NOT be rewritten
// (an earlier build re-assigned the value on every keystroke, eating the
// decimal point mid-type: "10.5" became "105"). Typing "10.50" then firing
// input must leave "10.50" in place; normalization happens on 'change'.
clickText("Menu & Price");
await sleep(150);
{
  const inp = document.querySelector('input[aria-label="Price for Chicken Over Rice"]');
  assert(inp, "chicken price input exists");
  inp.focus();
  inp.value = "10.50";
  inp.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert(inp.value === "10.50", `price field untouched while typing (got "${inp.value}")`);
  inp.dispatchEvent(new window.Event("change", { bubbles: true }));
  assert(inp.value === "10.5", `price normalized on blur (got "${inp.value}")`);
  inp.value = "9.5";
  inp.dispatchEvent(new window.Event("input", { bubbles: true }));
  inp.dispatchEvent(new window.Event("change", { bubbles: true }));
}
assert(document.body.textContent.includes("°F"), "forecast renders");
assert(q(".tabs"), "tabs render");

// 5. click every tab
for (const label of ["Recipe", "Menu & Price", "Crew", "Upgrades", "Spot"]) {
  clickText(label);
  await sleep(100);
}
assert(document.body.textContent.includes("Times Square"), "spot tab shows new locations");
clickText("Supplies");
await sleep(100);

// 6. buy something: first + button in supplies
const plus = qa(".stepper button").find((b) => b.textContent === "+");
assert(plus, "supply stepper exists");
plus.click();
plus.click();

// 7. open cart -> day view
clickText("OPEN CART");
await sleep(500);
assert(document.body.textContent.includes("Lunch rush"), "day view renders");
assert(q(".iso-canvas"), "day scene renders");

// 8. skip -> results
clickText("Skip");
await sleep(1500);
assert(document.body.textContent.includes("Results"), "results screen renders");
assert(document.body.textContent.includes("Earnings"), "ledger renders");

// 9. next day -> planning day 2
clickText("Next day");
await sleep(300);
assert(document.body.textContent.includes("Day 2"), "advanced to day 2");
assert(document.body.textContent.includes("Overnight") || document.body.textContent.includes("Morning planning"), "day 2 planning");

// 10. save slots wrote to localStorage
assert(window.localStorage.getItem("hct.save.auto"), "autosave exists");

// 11. tuning panel: toggle, tweak a value, copy-link path
const toggle = document.getElementById("tuning-toggle");
assert(toggle, "tuning toggle exists");
toggle.click();
await sleep(200);
assert(document.getElementById("tuning-panel").classList.contains("open"), "tuning panel opens");
const firstNum = document.querySelector('#tuning-panel input[type="number"]');
assert(firstNum, "tuning panel has numeric controls");
firstNum.value = "7";
firstNum.dispatchEvent(new window.Event("change", { bubbles: true }));
await sleep(200);
assert(document.body.textContent.includes("Morning planning"), "planning re-renders after retune");

// 12. slot save from planning screen
const slotBtn = qa("button").find((x) => x.textContent.includes("Slot 1"));
assert(slotBtn, "slot save button exists");
slotBtn.click();
await sleep(100);
assert(window.localStorage.getItem("hct.save.1"), "slot 1 save exists");

console.log("\nSMOKE PASS: full loop menu -> planning -> day -> results -> day 2");
process.exit(0);
