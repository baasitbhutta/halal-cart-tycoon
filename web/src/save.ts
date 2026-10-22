/**
 * Save/load via localStorage. Saves happen at morning boundaries only
 * (planning screen), so a save is always a clean start-of-day state.
 */
import type { DayPlan, GameState } from "../../src/sim/types.js";

export interface SaveData {
  version: 1;
  savedAt: string; // ISO
  state: GameState;
  nextSeed: number;
  tuningB64: string | null; // tuning overrides, so a tuned game stays tuned
  plan?: DayPlan | null; // last played plan — its prices/recipe/promo/crew seed the next morning's draft, including after a reload
}

export type SlotId = "auto" | "1" | "2" | "3";
export const SLOTS: SlotId[] = ["auto", "1", "2", "3"];

// Saves are namespaced per theme pack — a halal career and a taco career
// never collide. Pre-M4 saves lived at the un-namespaced key; halal-cart
// loads fall back to it so existing careers survive the upgrade.
const KEY = (themeId: string, s: SlotId) => `hct.save.${themeId}.${s}`;
const LEGACY_KEY = (s: SlotId) => `hct.save.${s}`;

export function saveGame(themeId: string, slot: SlotId, data: SaveData): void {
  try {
    localStorage.setItem(KEY(themeId, slot), JSON.stringify(data));
  } catch {
    /* storage full / private mode — the game still runs */
  }
}

export function loadGame(themeId: string, slot: SlotId): SaveData | null {
  try {
    let raw = localStorage.getItem(KEY(themeId, slot));
    if (!raw && themeId === "halal-cart") raw = localStorage.getItem(LEGACY_KEY(slot));
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1 || !d.state) return null;
    return d;
  } catch {
    return null;
  }
}

export function slotSummary(themeId: string, slot: SlotId): string | null {
  const d = loadGame(themeId, slot);
  if (!d) return null;
  const date = new Date(d.savedAt);
  return `Day ${d.state.day} · $${d.state.cash.toFixed(0)} · ${date.toLocaleDateString()}`;
}

export function clearSlot(themeId: string, slot: SlotId): void {
  try {
    localStorage.removeItem(KEY(themeId, slot));
    if (themeId === "halal-cart") localStorage.removeItem(LEGACY_KEY(slot));
  } catch {
    /* ignore */
  }
}
