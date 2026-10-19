/**
 * Save/load via localStorage. Saves happen at morning boundaries only
 * (planning screen), so a save is always a clean start-of-day state.
 */
import type { GameState } from "../../src/sim/types.js";

export interface SaveData {
  version: 1;
  savedAt: string; // ISO
  state: GameState;
  nextSeed: number;
  tuningB64: string | null; // tuning overrides, so a tuned game stays tuned
}

export type SlotId = "auto" | "1" | "2" | "3";
export const SLOTS: SlotId[] = ["auto", "1", "2", "3"];

const KEY = (s: SlotId) => `hct.save.${s}`;

export function saveGame(slot: SlotId, data: SaveData): void {
  try {
    localStorage.setItem(KEY(slot), JSON.stringify(data));
  } catch {
    /* storage full / private mode — the game still runs */
  }
}

export function loadGame(slot: SlotId): SaveData | null {
  try {
    const raw = localStorage.getItem(KEY(slot));
    if (!raw) return null;
    const d = JSON.parse(raw) as SaveData;
    if (d.version !== 1 || !d.state) return null;
    return d;
  } catch {
    return null;
  }
}

export function slotSummary(slot: SlotId): string | null {
  const d = loadGame(slot);
  if (!d) return null;
  const date = new Date(d.savedAt);
  return `Day ${d.state.day} · $${d.state.cash.toFixed(0)} · ${date.toLocaleDateString()}`;
}

export function clearSlot(slot: SlotId): void {
  try {
    localStorage.removeItem(KEY(slot));
  } catch {
    /* ignore */
  }
}
