/**
 * Morning planning screen: forecast + headline, tabbed planning
 * (Supplies / Recipe / Menu & Price / Crew / Upgrades / Spot), OPEN CART.
 */
import type { Game } from "../game.js";
import type { DayPlan, Purchase } from "../../../src/sim/types.js";
import { componentQtys, stockOnHand } from "../../../src/sim/economy.js";
import { challengeById, goalProgress, goalText, nextRank, rankFor } from "../../../src/sim/challenges.js";
import { el, esc, money, condIcon, condLabel } from "../format.js";
import { saveGame, type SlotId } from "../save.js";

/** Trim to at most 2 decimals, no trailing zeros. */
function fmtQty(q: number): string {
  return String(Math.round(q * 100) / 100);
}

/** Per-item ingredient quantities at the plan's current recipe. */
function itemNeeds(game: Game, plan: DayPlan, productId: string): Map<string, number> {
  const prod = game.theme.products.find((p) => p.id === productId)!;
  return new Map(componentQtys(game.tuning, prod, plan.recipe).map((c) => [c.supplyId, c.qty]));
}

/** Short unit name for a product: "platter" / "gyro" / "drink" etc. */
function unitName(game: Game, productId: string): string {
  const p = game.theme.products.find((x) => x.id === productId)!;
  const low = p.name.toLowerCase();
  if (p.sideItem) return "drink";
  if (low.includes("gyro")) return "gyro";
  if (low.includes("falafel")) return "falafel";
  return "platter";
}

type TabId = "supplies" | "recipe" | "menu" | "crew" | "upgrades" | "spot";
const TABS: [TabId, string][] = [
  ["supplies", "🛒 Supplies"],
  ["recipe", "🧪 Recipe"],
  ["menu", "💲 Menu & Price"],
  ["crew", "🧑‍🍳 Crew"],
  ["upgrades", "🔧 Upgrades"],
  ["spot", "📍 Spot"],
];

export function showPlanning(game: Game): void {
  const state = game.state!;
  const morning = game.morning!;
  const theme = game.theme;
  const root = game.root;
  const plan = game.draftPlan();

  // ---- HUD ----
  const hud = game.mountHudTitle(`day ${state.day}`);
  const cashEl = el("span", "cash", money(state.cash));
  hud.appendChild(cashEl);
  const rank = rankFor(state.lifetimeEarnings ?? 0);
  const next = nextRank(state.lifetimeEarnings ?? 0);
  hud.appendChild(
    el("span", "dim", ` · ${rank.emoji} ${esc(rank.name)}${next ? ` · next rank at ${money(next.at)} lifetime` : " · top rank!"}`),
  );

  // ---- challenge banner ----
  const chalDef = challengeById(state.challengeId);
  if (chalDef && state.challengeStatus === "active") {
    const daysLeft = chalDef.days - (state.day - 1);
    const pct = Math.round(goalProgress(chalDef, state) * 100);
    const banner = el("div", "panel center");
    banner.innerHTML = `<div class="name">${chalDef.emoji} ${esc(chalDef.name)} — ${esc(goalText(chalDef))}</div>
      <div class="sub">Progress ${pct}% · ${daysLeft} day${daysLeft === 1 ? "" : "s"} left</div>`;
    root.appendChild(banner);
  }

  const title = el("div", "panel center");
  title.innerHTML = `<h2>🌅 Morning planning — Day ${state.day}</h2>
    <div class="dim plan-loc"></div>`;
  root.appendChild(title);
  const locLine = title.querySelector(".plan-loc")!;
  // The header names TODAY'S spot (the plan), not yesterday's (the state) —
  // and it updates live when the player picks a new spot in the Spot tab.
  const refreshLocLine = () => {
    const loc = theme.locations.find((l) => l.id === plan.locationId);
    locLine.textContent =
      (loc?.name ?? "") + (plan.locationId !== state.locationId ? " · moving today" : "");
  };

  refreshLocLine();

  // ---- overnight spoilage banner ----
  if (game.spoilage.length) {
    const b = el("div", "banner", "🌙 <b>Overnight:</b> " + game.spoilage.map((s) => `${s.qty} ${s.unit} ${esc(s.supplyName)} spoiled (${money(s.value)})`).join(", "));
    root.appendChild(b);
  }

  // ---- forecast + headline ----
  const wx = el("div", "panel");
  const f = morning.forecast;
  wx.innerHTML = `<div class="row"><div class="grow">
      <span class="big-emoji">${condIcon(f.conditionId)}</span>
      <b>${Math.round(f.tempF)}°F</b> — ${condLabel(f.conditionId)}
      <div class="dim">(the morning forecast has been wrong before…)</div>
    </div></div>`;
  if (morning.headline) {
    wx.appendChild(el("div", "headline", `📰 ${esc(morning.headline.text)}`));
  }
  root.appendChild(wx);

  // ---- tabs ----
  const tabBar = el("div", "tabs");
  const tabBody = el("div", "panel");
  root.appendChild(tabBar);
  root.appendChild(tabBody);
  let active: TabId = "supplies";

  const refreshFooter = () => {
    refreshLocLine();
    const pc = purchaseCost();
    const uc = upgradeCost();
    const total = pc + uc + plan.promoSpend;
    const loc = theme.locations.find((l) => l.id === plan.locationId)!;
    const afterShopping = state.cash - Math.min(total, state.cash);
    // honest cash walk: purchases+upgrades+promo go out in the morning, rent
    // goes out with the day — don't show a "cash after" that pretends rent
    // doesn't exist (the evening ledger's earnings are P&L, not cash flow).
    spendEl.innerHTML =
      `🛒 ${money(pc)} &nbsp; 🔧 ${money(uc)} &nbsp; 📣 ${money(plan.promoSpend)}<br/>` +
      `<b>Morning spend: ${money(total)}</b> · <span class="dim">cash after shopping: ${money(afterShopping)}</span><br/>` +
      `<span class="dim">${money(loc.rent)} rent goes out with the day → projected end-of-day ${money(afterShopping - loc.rent)}</span>`;
  };

  const renderTab = () => {
    for (const b of tabBar.children) b.classList.toggle("active", (b as HTMLElement).dataset.tab === active);
    tabBody.innerHTML = "";
    if (active === "supplies") renderSupplies(game, plan, tabBody, refreshFooter);
    else if (active === "recipe") renderRecipe(game, plan, tabBody);
    else if (active === "menu") renderMenu(game, plan, tabBody, refreshFooter);
    else if (active === "crew") renderCrew(game, plan, tabBody);
    else if (active === "upgrades") renderUpgrades(game, plan, tabBody, refreshFooter, renderTab);
    else renderSpot(game, plan, tabBody, () => { renderTab(); refreshFooter(); });
  };

  for (const [id, label] of TABS) {
    const b = el("button", "tab" + (id === active ? " active" : ""), label);
    b.dataset.tab = id;
    b.addEventListener("click", () => {
      active = id;
      renderTab();
    });
    tabBar.appendChild(b);
  }

  // ---- footer ----
  const footer = el("div", "panel center");
  const spendEl = el("div", "", "");
  footer.appendChild(spendEl);
  const openBtn = el("button", "btn-gold", "🔥 OPEN CART");
  openBtn.style.fontSize = "1.3rem";
  openBtn.addEventListener("click", () => game.openCart(plan));
  footer.appendChild(openBtn);

  const saveRow = el("div", "btn-row");
  (["1", "2", "3"] as SlotId[]).forEach((s) => {
    const b = el("button", "btn-gold btn-small", `💾 Slot ${s}`);
    b.addEventListener("click", () => {
      game.saveTo(s);
      b.textContent = `✅ Slot ${s}`;
      setTimeout(() => (b.textContent = `💾 Slot ${s}`), 1200);
    });
    saveRow.appendChild(b);
  });
  const menuBtn = el("button", "btn-gold btn-small", "📋 Menu");
  menuBtn.addEventListener("click", () => game.showMenu());
  saveRow.appendChild(menuBtn);
  footer.appendChild(saveRow);
  root.appendChild(footer);

  const purchaseCost = () =>
    plan.purchases.reduce((sum, p) => {
      const s = theme.supplies.find((x) => x.id === p.supplyId)!;
      return sum + p.count * s.bundles[p.bundleIndex].price;
    }, 0);
  const upgradeCost = () =>
    plan.buyUpgrades.reduce((sum, id) => sum + (theme.upgrades.find((u) => u.id === id)?.cost ?? 0), 0);

  renderTab();
  refreshFooter();
}

// ---------- tabs ----------

function storageMultOf(game: Game): number {
  const theme = game.theme;
  const state = game.state!;
  let m = theme.cartTiers[state.cartTier]?.storageMult ?? 1;
  for (const id of state.upgrades) {
    const u = theme.upgrades.find((x) => x.id === id);
    if (u?.storageMult) m *= u.storageMult;
  }
  return m;
}

function renderSupplies(game: Game, plan: DayPlan, body: HTMLElement, refresh: () => void): void {
  const theme = game.theme;
  const state = game.state!;
  const mult = storageMultOf(game);
  body.appendChild(el("div", "dim", "Chicken and lamb spoil overnight — buy fresh daily. Rice keeps 2 days, sauces keep for weeks."));

  // servings summary: each main's count is set by ITS bottleneck ingredient
  const capEl = el("div", "panel-inset");
  const renderCap = () => {
    const mains = theme.products.filter((p) => p.flagship);
    const parts: string[] = [];
    for (const prod of mains) {
      const needs = itemNeeds(game, plan, prod.id);
      let best = Infinity;
      let bottleneck = "";
      for (const s of theme.supplies) {
        const per = needs.get(s.id);
        if (per == null || per <= 0) continue;
        const planned = plan.purchases
          .filter((p) => p.supplyId === s.id)
          .reduce((sum, p) => sum + p.count * s.bundles[p.bundleIndex].qty, 0);
        const total = stockOnHand(state.inventory[s.id]) + planned;
        const n = Math.floor(total / per);
        if (n < best) {
          best = n;
          bottleneck = s.name.toLowerCase();
        }
      }
      parts.push(
        `${best === Infinity ? 0 : best} ${esc(prod.name.toLowerCase())}` +
          (bottleneck ? ` <span class="dim">(limited by ${esc(bottleneck)})</span>` : ""),
      );
    }
    capEl.innerHTML = `<div class="name">🥘 You can make</div><div class="sub">${parts.join("<br/>")}</div>`;
  };
  renderCap();
  body.appendChild(capEl);

  const counts = new Map<string, number>();
  for (const p of plan.purchases) counts.set(`${p.supplyId}:${p.bundleIndex}`, p.count);
  const sync = () => {
    const arr: Purchase[] = [];
    for (const [k, c] of counts) {
      if (c <= 0) continue;
      const [supplyId, bi] = k.split(":");
      arr.push({ supplyId, bundleIndex: Number(bi), count: c });
    }
    plan.purchases = arr;
    renderCap();
    refresh();
  };

  for (const s of theme.supplies) {
    const onHand = stockOnHand(state.inventory[s.id]);
    const cap = Math.floor(s.storageCap * mult);
    const sec = el("div", "panel-inset");
    sec.innerHTML = `<div class="name">📦 ${esc(s.name)} <span class="dim">— on hand: ${fmtQty(onHand)} ${s.unit} · storage cap ${cap} ${s.unit} (can't buy past this)</span></div>`;
    s.bundles.forEach((b, bi) => {
      const key = `${s.id}:${bi}`;
      const row = el("div", "row");
      // ≈ how many servings this bundle makes at the current recipe
      let makes = "";
      for (const prod of theme.products) {
        const comp = componentQtys(game.tuning, prod, plan.recipe).find((c) => c.supplyId === s.id);
        if (comp && comp.qty > 0) {
          const n = Math.floor(b.qty / comp.qty);
          makes = ` · <span class="dim">≈ ${n} ${unitName(game, prod.id)}s</span>`;
          break;
        }
      }
      row.innerHTML = `<div class="grow"><span class="sub">${b.qty} ${s.unit} — ${money(b.price)} <span class="dim">(${(b.price / b.qty).toFixed(3)}/${s.unit})</span>${makes}</span></div>`;
      const st = el("div", "stepper");
      const minus = el("button", "", "−") as HTMLButtonElement;
      const val = el("span", "val", String(counts.get(key) ?? 0));
      const plus = el("button", "", "+") as HTMLButtonElement;
      const set = (n: number) => {
        counts.set(key, Math.max(0, Math.min(9, n)));
        val.textContent = String(counts.get(key));
        sync();
      };
      minus.addEventListener("click", () => set((counts.get(key) ?? 0) - 1));
      plus.addEventListener("click", () => set((counts.get(key) ?? 0) + 1));
      st.append(minus, val, plus);
      row.appendChild(st);
      sec.appendChild(row);
    });
    body.appendChild(sec);
  }
}

function renderRecipe(game: Game, plan: DayPlan, body: HTMLElement): void {
  const theme = game.theme;
  body.appendChild(el("div", "dim", "The sauce balance <i>is</i> the recipe. Office workers love extra white sauce; students want heat; tourists like it mild."));

  // live per-item readout: what one serving of each main actually consumes
  const needsEl = el("div", "panel-inset");
  const renderNeeds = () => {
    const rows: string[] = [];
    for (const prod of theme.products.filter((p) => p.flagship)) {
      const needs = itemNeeds(game, plan, prod.id);
      const parts: string[] = [];
      for (const s of theme.supplies) {
        const q = needs.get(s.id);
        if (q != null && q > 0) parts.push(`${fmtQty(q)} ${s.unit} ${esc(s.name.toLowerCase())}`);
      }
      rows.push(`<div class="sub">${prod.emoji ?? "🍽️"} <b>${esc(prod.name)}</b> — ${parts.join(" · ")}</div>`);
    }
    needsEl.innerHTML = `<div class="name">🍱 Per serving</div>${rows.join("")}`;
  };
  renderNeeds();
  body.appendChild(needsEl);

  for (const a of theme.recipeAxes) {
    const wrap = el("div", "panel-inset");
    const label = el("div", "name", `${esc(a.name)}: <span class="val" style="color:var(--gold-1)">${plan.recipe[a.id] ?? a.default}</span>`);
    const slider = document.createElement("input") as HTMLInputElement;
    slider.type = "range";
    slider.min = String(a.min);
    slider.max = String(a.max);
    slider.step = "1";
    slider.value = String(plan.recipe[a.id] ?? a.default);
    slider.setAttribute("aria-label", a.name);
    slider.addEventListener("input", () => {
      plan.recipe[a.id] = Number(slider.value);
      label.querySelector(".val")!.textContent = slider.value;
      renderNeeds();
    });
    wrap.append(label, slider, el("div", "sub dim", "1 = less &nbsp;·&nbsp; 3 = classic &nbsp;·&nbsp; 5 = extra"), el("div", "sub dim", esc(a.blurb)));
    body.appendChild(wrap);
  }
}

function renderMenu(game: Game, plan: DayPlan, body: HTMLElement, refresh: () => void): void {
  const theme = game.theme;
  for (const p of theme.products) {
    const row = el("div", "row");
    row.innerHTML = `<div class="grow"><span class="name">${esc(p.emoji ?? (p.sideItem ? "🥤" : "🍗"))} ${esc(p.name)}</span></div>`;
    const inp = document.createElement("input") as HTMLInputElement;
    inp.type = "number";
    inp.min = "0";
    inp.step = "0.5";
    inp.value = String(plan.prices[p.id] ?? p.defaultPrice);
    inp.setAttribute("aria-label", `Price for ${p.name}`);
    // 'input' updates the model live (mobile: tapping OPEN CART straight
    // from the keyboard can skip blur, so 'change' may never fire) — but it
    // must NEVER rewrite the field mid-typing, or "10.5" becomes "105"
    // (the decimal point gets eaten). Normalization happens on blur.
    inp.addEventListener("input", () => {
      const n = Number(inp.value);
      if (inp.value.trim() !== "" && Number.isFinite(n)) plan.prices[p.id] = Math.max(0, n);
    });
    inp.addEventListener("change", () => {
      plan.prices[p.id] = Math.max(0, Number(inp.value) || 0);
      inp.value = String(plan.prices[p.id]);
    });
    row.appendChild(inp);
    body.appendChild(row);
  }
  const promo = el("div", "panel-inset");
  promo.innerHTML = `<div class="name">📣 Daily promo</div><div class="dim">Flyers + social. Strongest when you're new in town; diminishing returns past ~$5. Set once — it recurs every morning until you change it.</div>`;
  const row = el("div", "row");
  const st = el("div", "stepper");
  const minus = el("button", "", "−") as HTMLButtonElement;
  const val = el("span", "val", `$${plan.promoSpend}`);
  const plus = el("button", "", "+") as HTMLButtonElement;
  const set = (n: number) => {
    plan.promoSpend = Math.max(0, Math.min(30, n));
    val.textContent = `$${plan.promoSpend}`;
    refresh();
  };
  minus.addEventListener("click", () => set(plan.promoSpend - 1));
  plus.addEventListener("click", () => set(plan.promoSpend + 1));
  st.append(minus, val, plus);
  row.appendChild(st);
  promo.appendChild(row);
  body.appendChild(promo);
}

function effectText(o: { serveMult?: number; patienceAddMin?: number; popularityBoost?: number; storageMult?: number }): string {
  const parts: string[] = [];
  if (o.serveMult && o.serveMult < 1) parts.push(`${Math.round((1 - o.serveMult) * 100)}% faster serving`);
  if (o.patienceAddMin) parts.push(`+${o.patienceAddMin} min line patience`);
  if (o.popularityBoost) parts.push(`+${o.popularityBoost} popularity`);
  if (o.storageMult && o.storageMult > 1) parts.push(`${o.storageMult}× storage`);
  return parts.join(" · ") || "—";
}

function renderCrew(game: Game, plan: DayPlan, body: HTMLElement): void {
  const theme = game.theme;
  body.appendChild(el("div", "dim", "Hired fresh each morning. Wages come out of today's earnings."));
  for (const c of theme.crew) {
    const row = el("label", "check-row");
    const box = document.createElement("input") as HTMLInputElement;
    box.type = "checkbox";
    box.checked = plan.crew.includes(c.id);
    box.addEventListener("change", () => {
      plan.crew = box.checked ? [...plan.crew, c.id] : plan.crew.filter((x) => x !== c.id);
    });
    const info = el("div", "grow", `<span class="name">${esc(c.name)}</span> — ${money(c.wage)}/day<br/>
      <span class="sub" style="color:var(--gold-1)">${esc(effectText(c))}</span><br/>
      <span class="sub">${esc(c.blurb)}</span>`);
    row.append(box, info);
    body.appendChild(row);
  }
}

function renderUpgrades(game: Game, plan: DayPlan, body: HTMLElement, refresh: () => void, rerender: () => void): void {
  const theme = game.theme;
  const state = game.state!;
  body.appendChild(el("div", "dim", "One-time purchases. Bought this morning, working by lunch."));
  for (const u of theme.upgrades) {
    const owned = state.upgrades.includes(u.id);
    const queued = plan.buyUpgrades.includes(u.id);
    const row = el("div", "row");
    row.innerHTML = `<div class="grow"><span class="name">🔧 ${esc(u.name)}</span> — ${money(u.cost)}<br/>
      <span class="sub" style="color:var(--gold-1)">${esc(effectText(u))}</span><br/>
      <span class="sub">${esc(u.blurb)}</span></div>`;
    if (owned) {
      row.appendChild(el("span", "pos", "✅ Owned"));
    } else {
      const b = el("button", "btn-gold btn-small", queued ? "✅ In cart" : "Buy") as HTMLButtonElement;
      b.addEventListener("click", () => {
        if (queued) plan.buyUpgrades = plan.buyUpgrades.filter((x) => x !== u.id);
        else plan.buyUpgrades.push(u.id);
        refresh();
        rerender();
      });
      row.appendChild(b);
    }
    body.appendChild(row);
  }
}

function trafficWord(v: number): string {
  if (v < 4) return "Quiet";
  if (v < 7) return "Steady";
  if (v < 10) return "Busy";
  return "Slammed";
}

function renderSpot(game: Game, plan: DayPlan, body: HTMLElement, rerender: () => void): void {
  const theme = game.theme;
  const state = game.state!;
  for (const l of theme.locations) {
    const mix = Object.entries(l.customerMix)
      .map(([tid, w]) => {
        const t = theme.customerTypes.find((x) => x.id === tid);
        return `${t?.name ?? tid} ${Math.round(w * 100)}%`;
      })
      .join(" · ");
    const pop = Math.round(state.popularity[l.id] ?? game.tuning.popularity.start + l.popularityBonus);
    const card = el("div", "panel-inset");
    card.innerHTML = `<div class="name">📍 ${esc(l.name)}</div>
      <div class="sub">Rent ${money(l.rent)}/day · Foot traffic: ${trafficWord(l.footTrafficPerHour)} · Popularity ${pop}%</div>
      <div class="sub dim">${esc(mix)}</div>`;
    const row = el("div", "row");
    if (l.id === plan.locationId) {
      row.appendChild(el("span", "pos", "✅ Current spot"));
    } else {
      const b = el("button", "btn-gold btn-small", `Move here (${money(l.rent)}/day)`) as HTMLButtonElement;
      b.addEventListener("click", () => {
        plan.locationId = l.id;
        rerender();
      });
      row.appendChild(b);
    }
    card.appendChild(row);
    body.appendChild(card);
  }
  body.appendChild(el("div", "dim center", "10 spots across the city — move up the ladder as your fame (and bankroll) grow."));
}
