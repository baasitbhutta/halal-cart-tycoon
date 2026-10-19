/** Day's Results: the full ledger, 2002 style. */
import type { Game } from "../game.js";
import type { DayPlan, DayResult } from "../../../src/sim/types.js";
import { el, esc, money } from "../format.js";

function verdict(e: number): string {
  if (e >= 40) return "🔥 What a day! The cart was on fire.";
  if (e >= 15) return "😎 Solid hustle. The regulars are noticing.";
  if (e >= 0) return "🙂 Slow day, but the cart survives. Tomorrow's another lunch rush.";
  return "🌧️ Rough one. Losing days happen — reckless play goes broke, smart play bounces back.";
}

export function showResults(game: Game, plan: DayPlan, result: DayResult): void {
  const root = game.root;
  const L = result.ledger;
  game.mountHudTitle(`day ${result.day} — results`);

  const head = el("div", "panel center");
  head.innerHTML = `<h2>📊 Day ${result.day} Results</h2><div>${verdict(L.earnings)}</div>`;
  root.appendChild(head);

  const ledger = el("div", "panel");
  const sold = Object.entries(result.itemsSold)
    .map(([id, n]) => {
      const p = game.theme.products.find((x) => x.id === id);
      return `${n} × ${esc(p?.name ?? id)}`;
    })
    .join(", ");
  ledger.innerHTML = `
    <table class="ledger">
      <tr><td>Revenue</td><td>${esc(sold)} — ${money(L.revenue)}</td></tr>
      <tr><td>Stock used</td><td>${money(L.stockUsed)}</td></tr>
      <tr><td>Stock lost</td><td>${money(L.stockLost)}</td></tr>
      <tr><td>Gross profit</td><td>${money(L.grossProfit)}</td></tr>
      <tr><td>Gross margin</td><td>${L.marginPct}%</td></tr>
      <tr><td>Rent</td><td>${money(L.rent)}</td></tr>
      <tr><td>Promo</td><td>${money(L.promo)}</td></tr>
      <tr><td>Wages</td><td>${money(L.wages)}</td></tr>
      ${L.upgradeCosts > 0 ? `<tr><td>Upgrades</td><td>${money(L.upgradeCosts)}</td></tr>` : ""}
      <tr><td>Total expense</td><td>${money(L.totalExpense)}</td></tr>
      <tr class="total"><td>Earnings</td><td class="${L.earnings < 0 ? "neg" : "pos"}">${money(L.earnings)}</td></tr>
    </table>`;
  root.appendChild(ledger);

  const flow = el("div", "panel");
  flow.innerHTML = `<h3>🚶 Customer flow</h3>
    <div class="row"><div class="grow">Visitors</div><b>${result.visitors}</b></div>
    <div class="row"><div class="grow">Served</div><b>${result.served}</b></div>
    <div class="row"><div class="grow">Missed — price too high</div><b>${result.missedPrice}</b></div>
    <div class="row"><div class="grow">Missed — line too long</div><b>${result.missedWait}</b></div>
    <div class="row"><div class="grow">Stockouts</div><b>${result.stockouts}</b></div>`;
  const sat = el("div", "panel-inset");
  sat.innerHTML = `<div>😊 Satisfaction: <b>${result.satisfaction}%</b> <span class="dim">(today: ${result.daySatisfaction}%)</span></div>
    <div class="bar"><div style="width:${result.satisfaction}%"></div></div>
    <div>📣 Popularity: <b>${result.popularity}%</b></div>
    <div class="bar"><div style="width:${result.popularity}%"></div></div>`;
  flow.appendChild(sat);
  root.appendChild(flow);

  if (result.notes.length) {
    const notes = el("div", "panel");
    notes.innerHTML = `<h3>📝 Notes</h3>` + result.notes.map((n) => `<div class="dim">• ${esc(n)}</div>`).join("");
    root.appendChild(notes);
  }

  const btns = el("div", "btn-row");
  const next = el("button", "btn-gold", "🌅 Next day") as HTMLButtonElement;
  next.style.fontSize = "1.2rem";
  next.addEventListener("click", () => game.advanceDay(plan, result));
  const menu = el("button", "btn-gold btn-small", "📋 Menu");
  menu.addEventListener("click", () => game.showMenu());
  btns.append(next, menu);
  root.appendChild(btns);
}
