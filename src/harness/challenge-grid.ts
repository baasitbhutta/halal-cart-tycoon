/**
 * challenge-grid — measure candidate retunes for the miscalibrated
 * challenges (campus_crush, five_star, big_time) before touching the data.
 * Each variant is played by the fixture strategies on the SAME seed stream,
 * so differences are the variant, not the weather.
 *
 * Halal pack only: taco parity is asserted by the taco-mirror test and the
 * last full MC came back digit-for-digit identical.
 *
 * Usage: node dist/src/harness/challenge-grid.js [--challenge campus_crush] [--seeds 200]
 * Omit --challenge to run all three grids.
 */
import { resolve } from "node:path";
import { loadTheme, type Theme } from "../theme-node.js";
import { type ChallengeDef } from "../sim/challenges.js";
import { runChallenge, type RunOutcome } from "./challenge-mc.js";

const arg = (name: string, def: string | null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const onlyChallenge = arg("challenge", null);
const seeds = parseInt(arg("seeds", "200")!, 10);

interface Variant {
  label: string;
  patch: Partial<Pick<ChallengeDef, "days" | "startCash">> & { target?: number };
}

function applyVariant(base: ChallengeDef, v: Variant): ChallengeDef {
  const def: ChallengeDef = {
    ...base,
    days: v.patch.days ?? base.days,
    startCash: v.patch.startCash ?? base.startCash,
  };
  if (v.patch.target !== undefined) {
    if (def.goal.kind === "cash") def.goal = { kind: "cash", atLeast: v.patch.target };
    else if (def.goal.kind === "serve") def.goal = { kind: "serve", customers: v.patch.target };
    else def.goal = { kind: "satisfaction", atLeast: v.patch.target };
  }
  return def;
}

/** Which fixture strategies to play each challenge with. */
const STRATEGIES: Record<string, string[]> = {
  campus_crush: ["sensible", "cheapskate", "sloppy"],
  five_star: ["sensible", "sloppy"],
  big_time: ["sensible"],
};

const GRIDS: Record<string, Variant[]> = {
  campus_crush: [
    { label: "baseline 160 / 21d / $250", patch: {} },
    { label: "target 120 / 21d", patch: { target: 120 } },
    { label: "target 100 / 21d", patch: { target: 100 } },
    { label: "target 80 / 21d", patch: { target: 80 } },
    { label: "target 60 / 21d", patch: { target: 60 } },
    { label: "160 / 28d", patch: { days: 28 } },
    { label: "100 / 28d", patch: { target: 100, days: 28 } },
    { label: "120 / 21d / $350 start", patch: { target: 120, startCash: 350 } },
    { label: "100 / 21d / $350 start", patch: { target: 100, startCash: 350 } },
    { label: "80 / 28d / $350 start", patch: { target: 80, days: 28, startCash: 350 } },
  ],
  five_star: [
    { label: "baseline 85% / 21d", patch: {} },
    { label: "88% / 21d", patch: { target: 88 } },
    { label: "89% / 21d", patch: { target: 89 } },
    { label: "90% / 21d", patch: { target: 90 } },
    { label: "92% / 21d", patch: { target: 92 } },
    { label: "95% / 21d", patch: { target: 95 } },
    { label: "90% / 14d", patch: { target: 90, days: 14 } },
  ],
  big_time: [
    { label: "baseline $2,000 / 21d / $600 start", patch: {} },
    { label: "target $1,800 / 21d", patch: { target: 1800 } },
    { label: "target $1,700 / 21d", patch: { target: 1700 } },
    { label: "target $1,600 / 21d", patch: { target: 1600 } },
    { label: "target $1,500 / 21d", patch: { target: 1500 } },
    { label: "target $1,400 / 21d", patch: { target: 1400 } },
    { label: "$2,000 / 24d", patch: { days: 24 } },
    { label: "$2,000 / 28d", patch: { days: 28 } },
    { label: "$1,700 / 24d", patch: { target: 1700, days: 24 } },
    { label: "$2,000 / 21d / $800 start", patch: { startCash: 800 } },
  ],
};

const pct = (x: number) => `${Math.round(x * 100)}%`.padStart(4);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};

/** The headline progress number for the goal kind, over sensible runs. */
const progress = (def: ChallengeDef, runs: RunOutcome[]) => {
  if (def.goal.kind === "cash") return `$${median(runs.map((x) => x.finalCash))} end`;
  if (def.goal.kind === "serve") return `${median(runs.map((x) => x.served))} served`;
  return `${median(runs.map((x) => x.maxSatisfaction))}% maxSat`;
};

const theme: Theme = loadTheme(resolve("data/halal-cart.json"));
const challengeIds = onlyChallenge ? [onlyChallenge] : Object.keys(GRIDS);

for (const cid of challengeIds) {
  const base = (theme.challenges ?? []).find((c) => c.id === cid);
  const variants = GRIDS[cid];
  if (!base || !variants) {
    console.log(`no challenge ${cid}, skipped`);
    continue;
  }
  const sids = STRATEGIES[cid] ?? ["sensible"];
  console.log(`\n══ ${theme.name} — ${base.emoji} ${base.name} retune grid (${seeds} paired seeds) ══`);
  console.log(`   ${"variant".padEnd(32)} ${sids.map((s) => s.padEnd(14)).join(" ")}  sensible progress`);
  for (const v of variants) {
    const def = applyVariant(base, v);
    const cells: string[] = [];
    let prog = "";
    for (const sid of sids) {
      const runs = Array.from({ length: seeds }, (_, r) => runChallenge(theme, def, sid, r));
      const wins = runs.filter((x) => x.won);
      const cell = `${pct(wins.length / runs.length)}${wins.length ? ` (day ${median(wins.map((x) => x.winDay!))})` : ""}`;
      cells.push(cell.padEnd(14));
      if (sid === "sensible") prog = progress(def, runs);
    }
    console.log(`   ${v.label.padEnd(32)} ${cells.join(" ")}  ${prog}`);
  }
}
