/**
 * Cozy-balance metrics. Pure functions over recorded Monte Carlo runs.
 * No sim code here — only statistics.
 */

export interface DistStats {
  n: number;
  mean: number;
  std: number;
  cv: number; // coefficient of variation = std / mean
  p10: number;
  p50: number;
  p90: number;
  min: number;
  max: number;
  pctNegative: number; // % of samples < 0
}

function percentile(sorted: number[], q: number): number {
  if (!sorted.length) return NaN;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * sorted.length)));
  return sorted[i];
}

/** Distribution stats for a sample of daily earnings (or any metric). */
export function distStats(xs: number[]): DistStats {
  const n = xs.length;
  const sorted = [...xs].sort((a, b) => a - b);
  const mean = n ? xs.reduce((a, b) => a + b, 0) / n : NaN;
  const variance = n > 1 ? xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1) : 0;
  const std = Math.sqrt(variance);
  return {
    n,
    mean,
    std,
    cv: mean !== 0 ? std / Math.abs(mean) : NaN,
    p10: percentile(sorted, 0.1),
    p50: percentile(sorted, 0.5),
    p90: percentile(sorted, 0.9),
    min: n ? sorted[0] : NaN,
    max: n ? sorted[n - 1] : NaN,
    pctNegative: n ? (100 * xs.filter((x) => x < 0).length) / n : NaN,
  };
}

export interface RecoveryStats {
  runs: number;
  badDays: number;
  meanRecoveryDays: number; // over recovered bad days
  maxRecoveryDays: number; // over recovered bad days
  unrecovered: number; // bad days never recovered within the run
}

/**
 * The 2-day rule, operationalized. A "bad day" is earnings < 50% of the
 * trailing 7-day mean (frozen at the bad day). Recovery = days until earnings
 * return to >= that trailing mean.
 */
export function recoveryStats(earningsByRun: number[][]): RecoveryStats {
  const recoveries: number[] = [];
  let badDays = 0;
  let unrecovered = 0;
  for (const e of earningsByRun) {
    for (let i = 3; i < e.length; i++) {
      const from = Math.max(0, i - 7);
      const trail = e.slice(from, i).reduce((a, b) => a + b, 0) / (i - from);
      if (!(trail > 0)) continue; // degenerate: no meaningful baseline
      if (e[i] >= 0.5 * trail) continue;
      badDays++;
      let k = -1;
      for (let j = i + 1; j < e.length; j++) {
        if (e[j] >= trail) {
          k = j - i;
          break;
        }
      }
      if (k < 0) unrecovered++;
      else recoveries.push(k);
    }
  }
  return {
    runs: earningsByRun.length,
    badDays,
    meanRecoveryDays: recoveries.length ? recoveries.reduce((a, b) => a + b, 0) / recoveries.length : 0,
    maxRecoveryDays: recoveries.length ? Math.max(...recoveries) : 0,
    unrecovered,
  };
}

/**
 * Decision-dominance: how much more do *decisions* move the needle than *luck*?
 *   |mean(A) - mean(B)| / std(A)
 * > 1 means switching strategy matters more than getting lucky.
 */
export function decisionDominance(meanA: number, meanB: number, stdA: number): number {
  if (!(stdA > 0)) return NaN;
  return Math.abs(meanA - meanB) / stdA;
}

// ---------------------------------------------------------------------------
// Markov analysis: the day-to-day game is a Markov process over (satisfaction,
// popularity). Discretize into 3x3 = 9 states and estimate the transition
// matrix from observed runs, then solve for mean hitting times back to "good".
// ---------------------------------------------------------------------------

export const BAND_LABELS = ["low", "mid", "high"] as const;

export function band(v: number): number {
  if (v < 40) return 0;
  if (v < 70) return 1;
  return 2;
}

/** state index = satBand * 3 + popBand (0..8). */
export function stateIndex(satisfaction: number, popularity: number): number {
  return band(satisfaction) * 3 + band(popularity);
}

export function stateLabel(idx: number): string {
  const sat = BAND_LABELS[Math.floor(idx / 3)];
  const pop = BAND_LABELS[idx % 3];
  return `sat:${sat}/pop:${pop}`;
}

/** "Good" states: satisfaction is high (bands 6,7,8). "Bad": satisfaction low (0,1,2). */
export const GOOD_STATES = [6, 7, 8];
export const BAD_STATES = [0, 1, 2];

/** Solve Ax = b by Gaussian elimination with partial pivoting. Returns null if singular. */
function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

export interface MarkovResult {
  counts: number[][]; // 9x9 raw transition counts
  matrix: number[][]; // 9x9 row-stochastic
  stationary: number[]; // power-iteration estimate
  /** Mean hitting time (days) from each state to the good set; null if never observed / unreachable. */
  hittingTime: (number | null)[];
  /** Max hitting time over bad states; null if no bad state was ever observed. */
  worstRecoveryDays: number | null;
  totalTransitions: number;
}

export interface DayState {
  satisfaction: number;
  popularity: number;
}

/**
 * @param stateSequences one sequence of end-of-day (satisfaction, popularity)
 *        per run; transitions are counted between consecutive days.
 */
export function markovAnalysis(stateSequences: DayState[][]): MarkovResult {
  const N = 9;
  const counts: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  let total = 0;
  for (const seq of stateSequences) {
    for (let i = 0; i + 1 < seq.length; i++) {
      const a = stateIndex(seq[i].satisfaction, seq[i].popularity);
      const b = stateIndex(seq[i + 1].satisfaction, seq[i + 1].popularity);
      counts[a][b]++;
      total++;
    }
  }
  const matrix: number[][] = counts.map((row) => {
    const s = row.reduce((a, b) => a + b, 0);
    return s > 0 ? row.map((c) => c / s) : row.map(() => 0);
  });

  // Stationary-ish distribution via power iteration.
  let pi = Array(N).fill(1 / N);
  for (let it = 0; it < 2000; it++) {
    const next = Array(N).fill(0);
    for (let a = 0; a < N; a++) for (let b = 0; b < N; b++) next[b] += pi[a] * matrix[a][b];
    const s = next.reduce((x, y) => x + y, 0);
    if (s > 0) pi = next.map((x) => x / s);
    else break;
  }

  // Mean hitting time to GOOD_STATES: solve (I - Q) h = 1 over transient states.
  const good = new Set(GOOD_STATES);
  const transient = Array.from({ length: N }, (_, i) => i).filter((i) => !good.has(i));
  const hittingTime: (number | null)[] = Array(N).fill(null);
  for (const g of GOOD_STATES) hittingTime[g] = 0;
  const observed = transient.filter((i) => counts[i].reduce((a, b) => a + b, 0) > 0);
  if (observed.length) {
    const idx = new Map(observed.map((s, k) => [s, k]));
    const m = observed.length;
    const A: number[][] = Array.from({ length: m }, () => Array(m).fill(0));
    const b = Array(m).fill(1);
    for (const s of observed) {
      const r = idx.get(s)!;
      A[r][r] = 1;
      for (const t of observed) {
        A[r][idx.get(t)!] -= matrix[s][t];
      }
      // probability mass leaking to good states is absorbed (stays in the 1 = b)
    }
    const h = solveLinear(A, b);
    if (h) for (const s of observed) hittingTime[s] = Math.max(0, h[idx.get(s)!]);
  }

  const badTimes = BAD_STATES.map((s) => hittingTime[s]).filter((x): x is number => x !== null);
  return {
    counts,
    matrix,
    stationary: pi,
    hittingTime,
    worstRecoveryDays: badTimes.length ? Math.max(...badTimes) : null,
    totalTransitions: total,
  };
}
