/**
 * Animated day view: plays back the sim's per-tick telemetry.
 * Clock 10:00→16:00, rush-curve chart, queue dots, ticking counters,
 * reaction bubbles (clickable for hints). 1x / 4x / Skip.
 */
import type { Game } from "../game.js";
import type { DayPlan, DayResult } from "../../../src/sim/types.js";
import { rushAt } from "../../../src/sim/economy.js";
import { clock, el, esc, money } from "../format.js";

const CUST_FACES = ["🧑", "👩", "🧔", "👵", "👦", "🧕", "👨‍💼", "👱‍♀️"];

const COMPLAINTS: Record<string, string[]> = {
  price: ["Too pricey!", "$9.50?! Nah.", "My wallet says no.", "Not at that price!"],
  wait: ["This line's too long!", "Ain't nobody got time…", "I'm outta here.", "Too slow!"],
  stockout: ["Sold out?!", "No chicken left?!"],
};

const HINTS: Record<string, string> = {
  price: "💡 Customers balk at the price. Lower it — or move somewhere tourists pay more.",
  wait: "💡 The line is bleeding customers. Hire the Expeditor, or buy the POS Register.",
  stockout: "💡 Ran out mid-rush. Buy more in the morning — chicken spoils overnight, so buy fresh daily.",
};

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function showDay(game: Game, plan: DayPlan, result: DayResult): void {
  const root = game.root;
  const ticks = result.ticks;
  game.mountHudTitle(`day ${result.day} — open!`);

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

  // scene
  const scene = el("div", "day-scene");
  const awning = el("div", "cart-awning");
  const stand = el("div", "cart-stand", "🌯");
  const lane = el("div", "queue-lane");
  scene.append(awning, stand, lane);
  root.appendChild(scene);

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
  const mkSpeed = (label: string, s: number | "skip") => {
    const b = el("button", "btn-gold btn-small", label) as HTMLButtonElement;
    b.addEventListener("click", () => {
      if (s === "skip") skipped = true;
      else {
        speed = s;
        for (const x of speeds.children) x.classList.remove("active");
        b.classList.add("active");
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

  (async () => {
    let visitors = 0;
    let served = 0;
    let revenue = 0;
    const queueFaces: string[] = [];

    for (let i = 0; i < ticks.length; i++) {
      if (skipped) break;
      const t = ticks[i];
      clockEl.textContent = clock(t.t);
      bars.forEach((b, j) => {
        b.classList.toggle("now", j === i);
        b.classList.toggle("past", j < i);
      });

      visitors += t.arrivals;
      served += t.served;
      revenue += t.revenue;

      // queue dots: grow with arrivals, shrink with served
      for (let k = 0; k < t.arrivals; k++) queueFaces.push(pick(CUST_FACES));
      queueFaces.splice(0, Math.min(queueFaces.length, t.served + t.missedPrice + t.missedWait + t.stockouts));
      renderQueue(lane, queueFaces, t.queueEnd);

      cVis.querySelector(".v")!.textContent = String(visitors);
      cSrv.querySelector(".v")!.textContent = String(served);
      cRev.querySelector(".v")!.textContent = money(revenue).replace(".00", "");

      // reaction bubbles for unhappy customers
      const events: [string, number][] = [
        ["price", t.missedPrice],
        ["wait", t.missedWait],
        ["stockout", t.stockouts],
      ];
      for (const [cause, n] of events) {
        for (let k = 0; k < Math.min(n, 2); k++) {
          spawnBubble(scene, hintBar, cause);
        }
      }

      await sleep(450 / speed);
    }

    clockEl.textContent = "🌙 Closed";
    await sleep(600);
    game.finishDay(plan, result);
  })();
}

function renderQueue(lane: HTMLElement, faces: string[], queueEnd: number): void {
  // Show a representative sample; the number label carries the truth.
  lane.innerHTML = "";
  const shown = faces.slice(-24);
  for (const f of shown) {
    lane.appendChild(el("div", "cust", f));
  }
  if (queueEnd > shown.length) {
    lane.appendChild(el("div", "cust", `+${queueEnd - shown.length}`));
  }
}

function spawnBubble(scene: HTMLElement, hintBar: HTMLElement, cause: string): void {
  const b = el("div", "bubble", esc(pick(COMPLAINTS[cause] ?? ["Hmm!"])));
  b.style.left = `${8 + Math.random() * 70}%`;
  b.style.bottom = `${120 + Math.random() * 60}px`;
  b.addEventListener("click", () => {
    hintBar.textContent = HINTS[cause] ?? "";
  });
  scene.appendChild(b);
  setTimeout(() => b.remove(), 2700);
}
