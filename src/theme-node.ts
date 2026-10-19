/**
 * Node-only theme loading (reads the JSON pack from disk).
 * Browser code should fetch the JSON and JSON.parse it instead —
 * everything else in theme.ts is pure and browser-safe.
 */
import { readFileSync } from "node:fs";
import type { Theme } from "./theme.js";

export type { Theme } from "./theme.js";

export function loadTheme(path: string): Theme {
  const raw = readFileSync(path, "utf8");
  const theme = JSON.parse(raw) as Theme;
  // Minimal sanity checks — fail fast on a broken pack.
  if (!theme.supplies?.length) throw new Error("theme has no supplies");
  if (!theme.products?.some((p) => p.flagship)) throw new Error("theme has no flagship product");
  if (!theme.locations?.length) throw new Error("theme has no locations");
  if (!theme.customerTypes?.length) throw new Error("theme has no customer types");
  return theme;
}
