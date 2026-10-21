/**
 * Animated day view: plays back the sim's per-tick telemetry on an
 * isometric street scene (M2). Clock 10:00→16:00, rush-curve chart,
 * ticking counters, reaction bubbles (clickable for hints). 1x / 4x / Skip.
 *
 * ?shot=<hour> (debug): jumps playback to that hour and pauses — used for
 * visual screenshots of the scene.
 */
import type { Game } from "../game.js";
import type { DayPlan, DayResult } from "../../../src/sim/types.js";
import { rushAt } from "../../../src/sim/economy.js";
import { IsoScene, ISO_W, type ComplaintCause } from "./iso.js";
import { clock, el, esc, money } from "../format.js";

const COMPLAINT_TEMPLATES: Record<string, string[]> = {
  price: ["Too pricey!", "__PRICE__?! Nah.", "My wallet says no.", "Not at that price!"],
  wait: ["This line's too long!", "Ain't nobody got time…", "I'm outta here.", "Too slow!"],
  stockout: ["Sold out?!", "No chicken left?!"],
};

const HINTS: Record<string, string> = {
  price: "💡 Customers balk at the price. Lower it — or move somewhere tourists pay more.",
  wait: "💡 The line is bleeding customers. Hire the Expeditor, or buy the POS Register.",
  stockout: "💡 Ran out mid-rush. Buy more in the morning — chicken spoils overnight, so buy fresh daily.",
};

function pick<T>(arr: T[], rng: () => number): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function showDay(game: Game, plan: DayPlan, result: DayResult, jumpToHour?: number): void {
  const root = game.root;
  // &fakequeue=N (debug): synthesize a queue wave for visual QA of the
  // isometric line — the real sim's queues drain every tick (see iso.ts).
  const fq = new URLSearchParams(window.location.search).get("fakequeue");
  let ticks = result.ticks;
  if (fq) {
    const N = Math.max(1, Math.min(12, parseInt(fq) || 8));
    ticks = result.ticks.map((t, i) => {
      const q = i < 12 ? Math.min(N, i) : Math.max(0, N - (i - 12));
      const pq = i === 0 ? 0 : i - 1 < 12 ? Math.min(N, i - 1) : Math.max(0, N - (i - 13));
      const arrivals = i < 12 ? 2 : 0;
      const served = Math.max(0, pq + arrivals - q);
      return { ...t, arrivals, served, revenue: served * 9.5, queueEnd: q, missedPrice: 0, missedWait: 0, stockouts: 0 };
    });
  }
  game.mountHudTitle(`day ${result.day} — open!`);

  // deterministic visual rng, independent of sim rng
  let vs = result.seed >>> 0 || 1;
  const vrng = () => {
    vs = (Math.imul(vs ^ (vs >>> 15), 1 | vs) + 0x6d2b79f5) | 0;
    let t = Math.imul(vs ^ (vs >>> 15), 1 | vs);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const clockEl = el("div", "clock", clock(game.tuning.day.openHour));
  root.appendChild(clockEl);

  // rush curve chart
  const chart = el("div", "rush-chart");
  const bars: HTMLElement[] = [];
  for (const t of ticks) {
    const b = el("div", "tick");
    b.style.height = `${Math.max(6, rushAt(game.tuning, t.t) * 100)}%`;
    b.title = clock(t.t);
    bars.push(b);
    chart.appendChild(b);
  }
  const chartPanel = el("div", "panel");
  chartPanel.appendChild(el("div", "dim center", "🌊 Lunch rush — 12:00–1:30 is the storm"));
  chartPanel.appendChild(chart);
  root.appendChild(chartPanel);

  // isometric scene
  const sceneWrap = el("div", "iso-wrap");
  const canvas = document.createElement("canvas");
  canvas.className = "iso-canvas";
  sceneWrap.appendChild(canvas);
  root.appendChild(sceneWrap);

  const scene = new IsoScene(canvas, game.theme.scene);
  scene.beginDay(result.seed);
  scene.start();

  const hintBar = el("div", "hint-bar", "Tap a 💬 bubble for a hint");
  root.appendChild(hintBar);

  // counters
  const counters = el("div", "counters");
  const cVis = el("div", "counter", `<div class="v">0</div><div class="l">visitors</div>`);
  const cSrv = el("div", "counter", `<div class="v">0</div><div class="l">served</div>`);
  const cRev = el("div", "counter", `<div class="v">$0</div><div class="l">revenue</div>`);
  counters.append(cVis, cSrv, cRev);
  root.appendChild(counters);

  // speed controls
  const speeds = el("div", "btn-row");
  let speed = 1;
  let skipped = false;
  let resume: (() => void) | null = null;
  const mkSpeed = (label: string, s: number | "skip") => {
    const b = el("button", "btn-gold btn-small", label) as HTMLButtonElement;
    b.addEventListener("click", () => {
      if (s === "skip") skipped = true;
      else {
        speed = s;
        for (const x of speeds.children) x.classList.remove("active");
        b.classList.add("active");
      }
      if (resume) {
        const r = resume;
        resume = null;
        r();
      }
    });
    return b;
  };
  const b1 = mkSpeed("1×", 1);
  const b4 = mkSpeed("4×", 4);
  const bSkip = mkSpeed("⏭ Skip", "skip");
  speeds.append(b1, b4, bSkip);
  root.appendChild(speeds);

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const scaleX = () => canvas.clientWidth / ISO_W;

  // live bubble anchors — new bubbles get nudged sideways if they'd land
  // right on top of a recent one
  const activeBubbles: { x: number; t: number }[] = [];

  function spawnBubbleAt(lx: number, ly: number, cause: ComplaintCause): void {
    const k = scaleX();
    // price complaints name a price from THIS menu (the refused item isn't
    // in the tick summary, so: exact price if all mains share one, else a
    // generic swing at the menu's prices)
    const mains = game.theme.products.filter((p) => p.flagship);
    const prices = mains.map((p) => plan.prices[p.id] ?? p.defaultPrice);
    const priceLabel =
      prices.every((v) => v === prices[0])
        ? money(prices[0]).replace(".00", "")
        : "These prices";
    const templates = (COMPLAINT_TEMPLATES[cause] ?? ["Hmm!"]).map((s) =>
      s.replace("__PRICE__", priceLabel),
    );
    const b = el("div", "bubble", esc(pick(templates, vrng)));
    const now = performance.now();
    for (let i = activeBubbles.length - 1; i >= 0; i--) {
      if (now - activeBubbles[i].t > 2700) activeBubbles.splice(i, 1);
    }
    let bx = lx * k;
    for (const a of activeBubbles) {
      if (Math.abs(a.x - bx) < 110) bx += bx < a.x ? -70 : 70;
    }
    bx = Math.max(4, Math.min(bx, canvas.clientWidth - 150));
    activeBubbles.push({ x: bx, t: now });
    b.style.left = `${bx}px`;
    b.style.top = `${ly * k}px`;
    b.addEventListener("click", () => {
      hintBar.textContent = HINTS[cause] ?? "";
    });
    sceneWrap.appendChild(b);
    setTimeout(() => b.remove(), 2700);
  }

  const jumpIdx =
    jumpToHour != null ? ticks.findIndex((t) => t.t >= jumpToHour) : -1;

  (async () => {
    let visitors = 0;
    let served = 0;
    let revenue = 0;

    for (let i = 0; i < ticks.length; i++) {
      if (skipped) break;
      const t = ticks[i];
      const jumping = jumpIdx >= 0 && i < jumpIdx;

      clockEl.textContent = clock(t.t);
      bars.forEach((b, j) => {
        b.classList.toggle("now", j === i);
        b.classList.toggle("past", j < i);
      });

      visitors += t.arrivals;
      served += t.served;
      revenue += t.revenue;

      scene.setHour(t.t);
      scene.applyTick(t, (x, y, cause) => {
        if (!jumping) spawnBubbleAt(x, y, cause);
      });

      cVis.querySelector(".v")!.textContent = String(visitors);
      cSrv.querySelector(".v")!.textContent = String(served);
      cRev.querySelector(".v")!.textContent = money(revenue).replace(".00", "");

      if (jumpIdx >= 0 && i === jumpIdx) {
        // screenshot mode: freeze here until the player resumes
        hintBar.textContent = "⏸ paused for screenshot — press 1× to resume";
        await new Promise<void>((r) => {
          resume = r;
        });
      }

      if (!jumping) await sleep(450 / speed);
    }

    scene.stop();
    clockEl.textContent = "🌙 Closed";
    await sleep(600);
    game.finishDay(plan, result);
  })();
}
