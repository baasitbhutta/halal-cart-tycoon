/** Day's Results: the full ledger, 2002 style. */
import type { Game } from "../game.js";
import type { DayPlan, DayResult } from "../../../src/sim/types.js";
import { el, esc, money } from "../format.js";
import { challengeById, evalChallenge, goalProgress, goalText, rankFor } from "../../../src/sim/challenges.js";

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
  sat.innerHTML = `<div>😊 Satisfaction: <b>${result.satisfaction}%</b> <span class="dim">(rolling average — today's service: ${result.daySatisfaction}%)</span></div>
    <div class="bar"><div style="width:${result.satisfaction}%"></div></div>
    <div>📣 Popularity: <b>${result.popularity}%</b></div>
    <div class="bar"><div style="width:${result.popularity}%"></div></div>`;
  flow.appendChild(sat);
  root.appendChild(flow);

  // ---- shutout-day coaching: a zero-sale day should teach, not just sting
  if (result.served === 0) {
    const tip = el("div", "panel center");
    const loc = game.theme.locations.find((l) => l.id === result.locationId);
    if (result.missedPrice >= Math.max(result.missedWait, result.stockouts, 1)) {
      const wref = loc
        ? Object.entries(loc.customerMix).reduce((s, [tid, w]) => {
            const t = game.theme.customerTypes.find((x) => x.id === tid);
            return s + w * (t?.refPrice ?? 10);
          }, 0)
        : 10;
      const sug = Math.max(4, Math.round(wref * 0.95 * 2) / 2);
      tip.innerHTML = `<div class="name">💡 Nobody bought — every customer balked at the price.</div>
        <div class="sub dim">This spot's crowd pays around <b>$${sug.toFixed(2)}</b>. Price at or below that tomorrow and watch the line move.</div>`;
    } else if (result.stockouts >= Math.max(result.missedWait, 1)) {
      tip.innerHTML = `<div class="name">💡 Sold out before the rush.</div>
        <div class="sub dim">Customers came and found nothing to buy. Stock up in the morning — the 🛒 Supplies tab shows how many servings each bundle makes.</div>`;
    } else {
      tip.innerHTML = `<div class="name">💡 The line was too slow — customers walked away.</div>
        <div class="sub dim">Serve time is the bottleneck. Crew and the POS upgrade cut it down; on brutal days, price up a touch to trim demand.</div>`;
    }
    root.appendChild(tip);
  }

  if (result.notes.length) {
    const notes = el("div", "panel");
    notes.innerHTML = `<h3>📝 Notes</h3>` + result.notes.map((n) => `<div class="dim">• ${esc(n)}</div>`).join("");
    root.appendChild(notes);
  }

  // ---- rank-up + challenge outcome ----
  const st = game.state!;
  const afterState = {
    ...st,
    day: st.day, // evalChallenge counts state.day as the last day played
    cash: result.cashAfter,
    lifetimeEarnings: (st.lifetimeEarnings ?? 0) + L.earnings,
    lifetimeServed: (st.lifetimeServed ?? 0) + result.served,
    satisfaction: { ...st.satisfaction, [result.locationId]: result.satisfaction },
  };
  const rankBefore = rankFor(st.lifetimeEarnings ?? 0);
  const rankAfter = rankFor(afterState.lifetimeEarnings);
  if (rankAfter.at > rankBefore.at) {
    const up = el("div", "panel center");
    up.innerHTML = `<div class="name">🎉 Rank up! ${rankAfter.emoji} ${esc(rankAfter.name)}</div>
      <div class="sub dim">Lifetime earnings crossed ${money(rankAfter.at)}. The streets know your cart now.</div>`;
    root.appendChild(up);
  }
  const chalDef = challengeById(st.challengeId, game.theme.challenges ?? []);
  if (chalDef) {
    const outcome = evalChallenge(afterState, game.theme.challenges ?? []);
    const pct = Math.round(goalProgress(chalDef, afterState) * 100);
    const cp = el("div", "panel center");
    if (outcome === "won") {
      cp.innerHTML = `<div class="name">${chalDef.emoji} Challenge complete: ${esc(chalDef.name)}!</div>
        <div class="sub dim">Goal smashed — ${esc(goalText(chalDef))}. Keep playing this career as free play, or take on another challenge from the menu.</div>`;
    } else if (outcome === "lost") {
      cp.innerHTML = `<div class="name">💀 Challenge failed: ${esc(chalDef.name)}</div>
        <div class="sub dim">The deadline passed at ${pct}% of the goal (${esc(goalText(chalDef))}). Retry from the menu, or keep this cart rolling in free play.</div>`;
    } else {
      const daysLeft = chalDef.days - st.day;
      cp.innerHTML = `<div class="name">${chalDef.emoji} ${esc(chalDef.name)} — ${esc(goalText(chalDef))}</div>
        <div class="sub dim">Progress ${pct}% · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left</div>`;
    }
    root.appendChild(cp);
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
