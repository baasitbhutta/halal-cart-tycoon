/**
 * ?tuning= / ?seed= URL params — shareable balance scenarios.
 *
 * Browser-safe (no node imports): the web UI and the node tests both use this.
 * Tuning travels as base64url(JSON). On load: mergeTuning(TUNING, decode(b64)).
 */

function b64encode(s: string): string {
  // btoa is browser; Buffer is node. Pick whichever exists.
  const g = globalThis as unknown as {
    btoa?: (s: string) => string;
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
  };
  const b64 = g.btoa
    ? g.btoa(s)
    : g.Buffer!.from(s, "utf8").toString("base64");
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64decode(s: string): string {
  const g = globalThis as unknown as {
    atob?: (s: string) => string;
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
  };
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  if (g.atob) {
    const bin = g.atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }
  return g.Buffer!.from(padded, "base64").toString("utf8");
}

/** Encode a (partial) tuning object for the ?tuning= param. */
export function encodeTuning(over: unknown): string {
  // UTF-8 safe: TextEncoder handles non-ASCII in comments/strings.
  const bytes = new TextEncoder().encode(JSON.stringify(over));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return b64encode(bin);
}

/** Decode a ?tuning= param back to an object. Returns null on bad input. */
export function decodeTuning(s: string): unknown {
  try {
    return JSON.parse(b64decode(s));
  } catch {
    return null;
  }
}

export interface UrlParams {
  tuning: unknown | null;
  seed: number | null;
}

/** Parse ?tuning= and ?seed= from a query string (with or without leading ?). */
export function parseUrlParams(search: string): UrlParams {
  const q = search.startsWith("?") ? search.slice(1) : search;
  const params = new URLSearchParams(q);
  const t = params.get("tuning");
  const s = params.get("seed");
  let seed: number | null = null;
  if (s !== null && s !== "" && !isNaN(Number(s))) seed = Math.floor(Number(s));
  return { tuning: t ? decodeTuning(t) : null, seed };
}

/** Build up a sparse overrides object: set `path` to `value`, creating
 *  intermediate objects/arrays by mirroring the shapes found in `base`
 *  (the current merged tuning). Unlike setTuningPath (which needs a full
 *  Tuning), this works when starting from `{}`. */
export function setOverridePath(
  base: unknown,
  over: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const out = JSON.parse(JSON.stringify(over)) as Record<string, unknown>;
  const parts = path.split(".");
  let curO: Record<string, unknown> & unknown[] = out as unknown as Record<string, unknown> & unknown[];
  let curB: unknown = base;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i];
    const bChild = (curB as Record<string, unknown> | null)?.[p];
    const oChild = curO[p];
    if (oChild === null || typeof oChild !== "object") {
      curO[p] = Array.isArray(bChild) ? [...(bChild as unknown[])] : {};
    }
    curO = curO[p] as Record<string, unknown> & unknown[];
    curB = bChild;
  }
  curO[parts[parts.length - 1]] = value;
  return out;
}

/** Build a shareable link: base URL + ?tuning= (+ optional ?seed=). */
export function buildTuningLink(baseUrl: string, over: unknown, seed?: number): string {
  const url = new URL(baseUrl);
  url.searchParams.set("tuning", encodeTuning(over));
  if (seed !== undefined) url.searchParams.set("seed", String(seed));
  return url.toString();
}
