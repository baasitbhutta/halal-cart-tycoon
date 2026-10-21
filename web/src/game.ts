/**
 * Game controller: owns theme, tuning (+overrides), state, seeds, and the
 * screen state machine (menu -> planning -> day -> results).
 *
 * The UI is a thin layer: every number comes from simulateDay/overnight.
 * No game logic here — just wiring.
 */
import type { Theme } from "../../src/theme.js";
import type { Tuning } from "../../src/tuning.js";
import { TUNING, mergeTuning } from "../../src/tuning.js";
import type { DayPlan, DayResult, GameState, SpoilageLine } from "../../src/sim/types.js";
import type { ChallengeDef } from "../../src/sim/challenges.js";
import {
  applyDayResult,
  defaultPlan,
  newGame,
  overnight,
  rollMorning,
  simulateDay,
  type MorningInfo,
} from "../../src/sim/day.js";
import { buildTuningLink, decodeTuning, encodeTuning, parseUrlParams, setOverridePath } from "../../src/tuning-url.js";
import { loadGame, saveGame, type SaveData, type SlotId } from "./save.js";
import { showMenu } from "./screens/menu.js";
import { showPlanning } from "./screens/planning.js";
import { showDay } from "./screens/day.js";
import { showResults } from "./screens/results.js";
import { TuningPanel } from "./tuning-panel.js";
import { el } from "./format.js";

export type ScreenName = "menu" | "planning" | "day" | "results";

export class Game {
  theme: Theme;
  tuning: Tuning;
  tuningOverrides: Record<string, unknown>;
  shotHour: number | null = null; // ?shot=<hour> debug: jump day playback & pause
  state: GameState | null = null;
  nextSeed = 1;
  morning: MorningInfo | null = null;
  prevPlan: DayPlan | null = null;
  spoilage: SpoilageLine[] = [];
  screen: ScreenName = "menu";
  root: HTMLElement;
  panel: TuningPanel;

  constructor(theme: Theme, root: HTMLElement) {
    this.theme = theme;
    this.root = root;
    const { tuning, seed } = parseUrlParams(window.location.search);
    const shot = new URLSearchParams(window.location.search).get("shot");
    this.shotHour = shot != null && shot !== "" && !isNaN(Number(shot)) ? Number(shot) : null;
    this.tuningOverrides =
      tuning && typeof tuning === "object" && !Array.isArray(tuning)
        ? (tuning as Record<string, unknown>)
        : {};
    this.tuning = mergeTuning(TUNING, this.tuningOverrides);
    this.nextSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
    this.panel = new TuningPanel(this);
  }

  // ---------- screens ----------

  goto(screen: ScreenName): void {
    this.screen = screen;
    this.root.innerHTML = "";
    if (screen === "menu") showMenu(this);
    else if (screen === "planning") showPlanning(this);
  }

  /**
   * ?shot= debug: open a maxed-out Times Square rush (boosted foot traffic,
   * shot-only) so the frozen frame shows a real lunch-rush queue.
   * Screenshot tool only — the real game balance is untouched.
   */
  shotDay(): void {
    this.newCareer();
    const ts = [...this.theme.locations].sort((a, b) => b.footTrafficPerHour - a.footTrafficPerHour)[0];
    ts.footTrafficPerHour = 40; // shot-only crowd boost
    this.state!.locationId = ts.id;
    this.state!.popularity[ts.id] = 100;
    this.state!.satisfaction[ts.id] = 95;
    const plan = this.draftPlan();
    plan.locationId = ts.id;
    // stock every supply in the active pack (theme-generic: bundle 0 x3)
    plan.purchases = this.theme.supplies.map((s) => ({
      supplyId: s.id,
      bundleIndex: 0,
      count: 3,
    }));
    plan.promoSpend = 6;
    this.openCart(plan);
  }

  showMenu(): void {
    this.state = null;
    this.goto("menu");
  }

  // ---------- career flow ----------

  newCareer(): void {
    this.state = newGame(this.theme, this.tuning);
    this.prevPlan = null;
    this.spoilage = [];
    this.autosave();
    this.morning = rollMorning(this.theme, this.tuning, this.nextSeed);
    this.goto("planning");
  }

  /** Start a challenge run: fresh career at the scenario's spot and cash. */
  startChallenge(def: ChallengeDef): void {
    this.state = newGame(this.theme, this.tuning, def.startLocationId);
    this.state.cash = def.startCash;
    this.state.challengeId = def.id;
    this.state.challengeStatus = "active";
    this.prevPlan = null;
    this.spoilage = [];
    this.autosave();
    this.morning = rollMorning(this.theme, this.tuning, this.nextSeed);
    this.goto("planning");
  }

  /** Morning plan draft: carry over yesterday's recipe/prices/promo/crew. */
  draftPlan(): DayPlan {
    const base = this.prevPlan ?? defaultPlan(this.theme);
    return {
      locationId: this.state!.locationId,
      purchases: [],
      recipe: { ...base.recipe },
      prices: { ...base.prices },
      promoSpend: base.promoSpend,
      crew: [...base.crew],
      buyUpgrades: [],
    };
  }

  openCart(plan: DayPlan): void {
    if (!this.state) return;
    const seed = this.nextSeed;
    this.nextSeed += 1;
    const result = simulateDay(this.theme, this.tuning, this.state, plan, seed);
    this.screen = "day";
    this.root.innerHTML = "";
    showDay(this, plan, result, this.shotHour ?? undefined);
  }

  finishDay(plan: DayPlan, result: DayResult): void {
    this.screen = "results";
    this.root.innerHTML = "";
    showResults(this, plan, result);
  }

  /** Fold the day into state, run overnight, autosave, back to planning. */
  advanceDay(plan: DayPlan, result: DayResult): void {
    if (!this.state) return;
    const mid = applyDayResult(this.state, plan, result);
    const { state, spoiled } = overnight(this.theme, this.tuning, mid);
    this.state = state;
    this.prevPlan = plan;
    this.spoilage = spoiled;
    this.autosave();
    this.morning = rollMorning(this.theme, this.tuning, this.nextSeed);
    this.goto("planning");
  }

  // ---------- tuning ----------

  /** Live-apply one tuning change (from the dev panel). */
  retune(path: string, value: unknown): void {
    this.tuningOverrides = setOverridePath(this.tuning, this.tuningOverrides, path, value);
    this.tuning = mergeTuning(TUNING, this.tuningOverrides);
    // Planning shows rolled morning info (forecast/headline), which depends
    // on tuning — re-roll and re-render so the panel edits are honest.
    if (this.screen === "planning" && this.state) {
      this.morning = rollMorning(this.theme, this.tuning, this.nextSeed);
      this.goto("planning");
    }
  }

  resetTuning(): void {
    this.tuningOverrides = {};
    this.tuning = mergeTuning(TUNING, {});
    if (this.screen === "planning" && this.state) {
      this.morning = rollMorning(this.theme, this.tuning, this.nextSeed);
      this.goto("planning");
    }
  }

  copyTuningLink(): string {
    return buildTuningLink(window.location.href, this.tuningOverrides);
  }

  // ---------- saves ----------

  private saveData(): SaveData | null {
    if (!this.state) return null;
    return {
      version: 1,
      savedAt: new Date().toISOString(),
      state: this.state,
      nextSeed: this.nextSeed,
      tuningB64: Object.keys(this.tuningOverrides).length ? encodeTuning(this.tuningOverrides) : null,
    };
  }

  autosave(): void {
    const d = this.saveData();
    if (d) saveGame(this.theme.id, "auto", d);
  }

  saveTo(slot: SlotId): void {
    const d = this.saveData();
    if (d) saveGame(this.theme.id, slot, d);
  }

  loadFrom(slot: SlotId): boolean {
    const d = loadGame(this.theme.id, slot);
    if (!d) return false;
    this.state = d.state;
    // M3 added career totals — backfill for saves written before them.
    this.state.lifetimeEarnings ??= 0;
    this.state.lifetimeServed ??= 0;
    this.nextSeed = d.nextSeed;
    this.prevPlan = null;
    this.spoilage = [];
    if (d.tuningB64) {
      const over = decodeTuning(d.tuningB64);
      if (over && typeof over === "object" && !Array.isArray(over)) {
        this.tuningOverrides = over as Record<string, unknown>;
        this.tuning = mergeTuning(TUNING, over);
      }
    }
    this.morning = rollMorning(this.theme, this.tuning, this.nextSeed);
    this.goto("planning");
    return true;
  }

  mountHudTitle(sub: string): HTMLElement {
    const hud = el("div", "hud");
    hud.innerHTML = `<span>${this.theme.emoji ?? "🍽️"} ${this.theme.name.toUpperCase()}</span><span class="dim">${sub}</span>`;
    this.root.appendChild(hud);
    return hud;
  }
}
