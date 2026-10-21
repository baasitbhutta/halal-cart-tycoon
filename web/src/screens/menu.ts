/** Main menu: new career, continue, challenges, save slots, how to play. */
import type { Game } from "../game.js";
import { el, esc, money0 } from "../format.js";
import { THEME_CHOICES, switchTheme } from "../themes.js";
import { clearSlot, loadGame, slotSummary, type SlotId } from "../save.js";
import { CHALLENGES } from "../../../src/sim/challenges.js";

/**
 * Two-step confirm for destructive menu actions: first tap arms the button
 * ("⚠️ Tap again to confirm"), second tap within 3s fires. Native confirm()
 * dialogs get suppressed in some embedded/headless browsers (dead button)
 * and are clunky on mobile — this works everywhere.
 */
export function armConfirm(btn: HTMLButtonElement, armedText: string, action: () => void): void {
  const orig = btn.textContent ?? "";
  let armed = false;
  let timer: number | undefined;
  btn.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      btn.textContent = armedText;
      timer = window.setTimeout(() => {
        armed = false;
        btn.textContent = orig;
      }, 3000);
      return;
    }
    if (timer) window.clearTimeout(timer);
    action();
  });
}

export function showMenu(game: Game): void {
  const root = game.root;
  game.mountHudTitle("main menu");

  const hero = el("div", "panel center");
  hero.innerHTML = `
    <div class="big-emoji">${game.theme.emoji ?? "🍽️"}</div>
    <h1>${esc(game.theme.name.toUpperCase())}</h1>
    <div class="dim">${esc(game.theme.tagline)}</div>`;
  root.appendChild(hero);

  const actions = el("div", "panel");
  actions.appendChild(el("h2", "", "📋 Main menu"));

  const btns = el("div", "btn-row");
  const newBtn = el("button", "btn-gold", "🆕 New career") as HTMLButtonElement;
  if (game.state || loadGame(game.theme.id, "auto")) {
    armConfirm(newBtn, "⚠️ Tap again to restart", () => game.newCareer());
  } else {
    newBtn.addEventListener("click", () => game.newCareer());
  }
  btns.appendChild(newBtn);

  const auto = loadGame(game.theme.id, "auto");
  if (auto) {
    const cont = el("button", "btn-gold", `▶ Continue — Day ${auto.state.day}, ${money0(auto.state.cash)}`);
    cont.addEventListener("click", () => game.loadFrom("auto"));
    btns.appendChild(cont);
  }
  actions.appendChild(btns);

  // challenges — scenario starts are halal-pack locations, so the section
  // only appears when this theme contains them all; other packs get a note
  const chalFitsTheme = CHALLENGES.every((c) =>
    game.theme.locations.some((l) => l.id === c.startLocationId),
  );
  if (chalFitsTheme) {
    const chal = el("div", "panel");
    chal.appendChild(el("h2", "", "🏆 Challenges"));
    chal.appendChild(el("div", "dim", "Time-boxed careers with a goal. Win one, flex on your group chat."));
    for (const c of CHALLENGES) {
      const row = el("div", "row");
      row.innerHTML = `<div class="grow"><span class="name">${c.emoji} ${esc(c.name)} <span class="dim">— ${c.days} days</span></span><br/><span class="sub">${esc(c.blurb)}</span></div>`;
      const b = el("button", "btn-gold btn-small", "Start") as HTMLButtonElement;
      if (game.state || loadGame(game.theme.id, "auto")) {
        armConfirm(b, "⚠️ Tap again", () => game.startChallenge(c));
      } else {
        b.addEventListener("click", () => game.startChallenge(c));
      }
      row.appendChild(b);
      chal.appendChild(row);
    }
    root.appendChild(chal);
  } else {
    const note = el("div", "panel center");
    note.innerHTML = `<div class="dim">🏆 Challenge scenarios are coming to this theme pack soon — free play and career ranks are fully live.</div>`;
    root.appendChild(note);
  }

  // theme picker — each pack is its own game on the same engine
  const picker = el("div", "panel");
  picker.appendChild(el("h2", "", "🎮 Theme packs"));
  const prow = el("div", "btn-row");
  for (const t of THEME_CHOICES) {
    const b = el("button", "btn-gold", `${t.emoji} ${t.name}`);
    if (t.id === game.theme.id) {
      b.setAttribute("disabled", "true");
      b.textContent = `✔ ${t.emoji} ${t.name}`;
    } else {
      b.addEventListener("click", () => switchTheme(t.id));
    }
    prow.appendChild(b);
  }
  picker.appendChild(prow);
  root.appendChild(picker);

  // save slots
  actions.appendChild(el("h3", "", "💾 Save slots"));
  (["1", "2", "3"] as SlotId[]).forEach((slot) => {
    const row = el("div", "row");
    const sum = slotSummary(game.theme.id, slot);
    row.appendChild(el("div", "grow", `<span class="name">Slot ${slot}</span><br/><span class="sub">${sum ?? "empty"}</span>`));
    if (sum) {
      const load = el("button", "btn-gold btn-small", "Load");
      load.addEventListener("click", () => game.loadFrom(slot));
      const del = el("button", "btn-gold btn-small", "🗑") as HTMLButtonElement;
      del.title = "Delete slot";
      armConfirm(del, "⚠️", () => {
        clearSlot(game.theme.id, slot);
        game.goto("menu");
      });
      row.append(load, del);
    } else {
      row.appendChild(el("span", "dim", "—"));
    }
    actions.appendChild(row);
  });
  root.appendChild(actions);

  const help = el("div", "panel");
  help.innerHTML = `
    <h2>❓ How to play</h2>
    <div class="sub" style="font-size:.95rem; line-height:1.6">
    Each morning: check the <b>forecast</b> (it can be wrong — the weatherman
    gambles too), read the <b>headline</b>, buy fresh <b>chicken</b> (it spoils
    overnight!), set your <b>sauce ratios</b>, price the platter, then
    <b>open the cart</b>.<br/><br/>
    The <b>lunch rush</b> hits 12:00–1:30. Serve fast, keep the line moving,
    don't run out of chicken. Losing days happen — reckless play goes broke.
    The math is always fair.<br/><br/>
    <span class="dim">🎛️ Press <b>\`</b> anywhere for the tuning panel. Every number is adjustable.</span>
    </div>`;
  root.appendChild(help);
}
