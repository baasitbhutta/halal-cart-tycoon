/**
 * Seeded PRNG (mulberry32). All simulation randomness flows through this,
 * so simulateDay(state, plan, seed) is fully deterministic.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pick a weighted key from a weight map using rng(). */
export function pickWeighted<T extends string>(
  rng: () => number,
  weights: Record<T, number>,
): T {
  const entries = Object.entries(weights) as [T, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rng() * total;
  for (const [key, w] of entries) {
    r -= w;
    if (r <= 0) return key;
  }
  return entries[entries.length - 1][0];
}

/** Poisson-ish integer count with mean mu (Knuth for small mu, normal approx for large). */
export function poissonish(rng: () => number, mu: number): number {
  if (mu <= 0) return 0;
  if (mu < 30) {
    let n = 0;
    let p = Math.exp(-mu);
    let s = rng();
    // guard against p underflow weirdness; loop is bounded in practice
    for (let i = 0; i < 1000 && s > p; i++) {
      n++;
      s *= rng();
    }
    return n;
  }
  // normal approximation for large mu
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, Math.round(mu + Math.sqrt(mu) * z));
}
