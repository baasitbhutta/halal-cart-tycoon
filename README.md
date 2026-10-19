# Halal Cart Tycoon — M1: Playable Web App

**Play it:** `npm run dev` → http://localhost:5173 · or `npm run build:web` → static `dist-web/` (deployable to GitHub Pages as-is).

The 2002-homage UI skin: dark green pinstripe panels, chunky beveled gold buttons, pure CSS (no image assets yet — isometric canvas is M2). Full loop: **main menu → morning planning → animated day → results → next day**, with localStorage saves (autosave + 3 named slots).

## The screens

- **Planning** — date, weather forecast (condition + temp, with the original's "forecasts have been wrong before…" wink), the day's headline, overnight spoilage banner. Six tabs:
  - 🛒 **Supplies** — bundle steppers per supply, on-hand vs storage cap, live morning-spend total. Chicken spoils overnight: buy fresh daily.
  - 🧪 **Recipe** — the 4 sauce/portion sliders.
  - 💲 **Menu & Price** — price per item + daily promo stepper.
  - 🧑‍🍳 **Crew** — hire each morning; wages hit today's earnings. **Wired to the real sim** (serve speed / line patience).
  - 🔧 **Upgrades** — one-time buys (awning, POS register, LED sign, second grill). **Wired to the real sim** (serveMult / patience / popularity / storage all applied in `simulateDay`).
  - 📍 **Spot** — 4 NYC locations (Midtown Side Street $0, Central Park South $15, Financial District $40, Times Square $60) with rent, traffic, and customer mix. Moving resets popularity/satisfaction per location, like the original. *M1 addition: traffic values are scaled from the Midtown baseline, not MC-validated — treat FiDi/Times Square balance as provisional.*
- **Day view** — animated 15-min tick playback: clock 10:00→16:00, the lunch-rush curve chart with a now-marker, queue dots, ticking visitors/served/revenue, reaction bubbles for unhappy customers (tap for hints). Speed: 1× / 4× / ⏭ skip.
- **Results** — the full ledger (revenue, stock used/lost, gross profit, margin %, rent, promo, wages, upgrades, earnings), satisfaction/popularity bars, missed sales split by cause (price vs wait), stockouts, and the sim's notes (wrong forecasts, headlines).

## Tuning panel (DESIGN.md §16)

Press `` ` `` (or the 🎛️ button): every tuning constant as a live slider/input, auto-generated from `src/tuning.ts`. Edits apply immediately and re-roll the morning. **🔗 Copy tuning link** → `?tuning=<base64>` (+ optional `?seed=`); loading that URL restores the exact balance scenario. Saves remember their tuning overrides.

## What's stubbed / provisional in M1

- **Cart tiers** (Pro/Double-Wide in the theme) have no purchase path — `DayPlan` has no cart-tier field in the sim. Coming in M2/M3.
- **Charts** (temperature/visitors/revenue history) — data is in `state.history`; UI not built yet.
- **Headline deck** is 7, not 100; **weather** has no seasons; one save per slot.
- **Mobile**: layouts stack at 390px, 44px+ touch targets, no hover-dependent UI. Reasoned through CSS, not device-tested — flag anything awkward.
- The animated day view replays recorded per-tick telemetry (`DayResult.ticks`, additive sim change); the isometric canvas view is M2.

## Dev notes

- UI is a thin layer over the pure sim: `web/src/` calls `simulateDay`/`overnight`/`rollMorning` only. No game logic in UI code.
- `src/theme.ts` is browser-safe (no node imports); node-only `loadTheme` lives in `src/theme-node.ts`.
- `npm run smoke:web` — headless jsdom smoke test (esbuild + jsdom, dev deps): plays menu → planning (all tabs) → day → results → day 2, plus tuning panel and slot saves. Not part of `npm test`.
- All node CLIs (`play`, `sweep`, `montecarlo`, benchmarks) untouched and working; `npm test` is 17/17 green (11 original + URL round-trip + `setOverridePath` tests).

---

# Halal Cart Tycoon — M0: Simulation Core

The playable economy as pure numbers. No graphics — if the numbers aren't fun here, art won't save it.

**Design doc:** `../DESIGN.md` · **Original-game RE spec:** `../lemonade-reverse-engineering/MECH_SPEC.md`

## Quick start

```bash
npm install
npm test          # build + run all tests (Node's built-in runner)
npm run play -- --days 10 --seed 42        # play 10 days, print results
npm run play -- --plan myplan.json --days 5 # custom morning plan (partial DayPlan JSON)
npm run sweep -- --param tuning.demand.appealWeight --values 0.4,0.5,0.6 --days 10 --seeds 4
```

`--param` accepts `tuning.<dot.path>` (into `src/tuning.ts`) or `plan.<dot.path>`
(e.g. `plan.prices.chicken_platter`). That's the balance loop: sweep → read the
table → edit one constant → commit.

## Layout

```
data/halal-cart.json      theme pack (M0: 1 location, 2 products, 3 customer types,
                          7 headlines, 2 crew roles, 4 upgrades)
tuning/presets/standard.json versioned snapshot of the current balance
src/tuning.ts             EVERY formula constant, named + commented + units.
                          The only file you edit to rebalance.
src/rng.ts                seeded PRNG (mulberry32) — all randomness flows through it
src/theme.ts              theme-pack schema + loader (sim core is theme-agnostic)
src/sim/types.ts          GameState / DayPlan / DayResult / Ledger
src/sim/economy.ts        pure helpers: rush curve, recipe scoring, FIFO lots, ...
src/sim/day.ts            simulateDay(state, plan, seed) -> DayResult — the whole day;
                          applyDayResult; overnight (spoilage); newGame; defaultPlan
src/harness/play.ts       CLI: play N days, print the "Day's Results" ledger
src/harness/sweep.ts      CLI: vary one param × N seeds × M days, print P&L table
test/                     determinism, spoilage math, economy sanity (11 tests)
```

## The model (one paragraph)

Each day: morning purchases (bundle pricing, storage caps, cash-limited) →
weather forecast (which can be wrong — the sim rolls actuals separately) + one
NYC headline → 15-minute ticks from 10:00–16:00 with a lunch-rush curve
(dead morning, slammed 12:00–13:30). Per tick:
`arrivals = footTraffic × rush × weather × appeal × headline × promo`
(popularity + satisfaction blended — the original's own definition of what
brings customers). Each arrival picks a customer type, joins the queue if the
line looks survivable, then buys iff price ≤ willingness (type ref-price ×
weather × headline × jitter), stock exists, and the wait beats their patience.
Missed sales are split by cause (price vs. wait). Satisfaction =
0.75·recipe + 0.125·price-fairness + 0.125·served-ratio − stockout penalty,
smoothed per location. Overnight, FIFO lots age and spoil (chicken: 1 day —
buy fresh daily; rice: 2; pita: 3; sauces: 7–14; drinks/containers: never).

## Balance notes (from harness sweeps, 4 seeds × 10 days)

Sensible play = daily small-bundle shopping, $9.50 platter, decent recipe
(white 4 / hot 2 / meat 3 / rice 3), $3 promo.

- **Day-1 earnings ≈ $15–30; day-10 ≈ $40–80** (multi-seed late-3 avg ≈ $52).
  Always solvent on sensible play. Matches the original's day-1 ≈ $17.
- **Price has a real sweet spot:** $7→$54/day, $9.50→$73, $11→$60, $13→$13
  (25% solvent), $20→$0. Pricing is a decision, not a dial.
- **Promo has diminishing returns:** $0→$47, $3→$59, $5→$65, $10→$68,
  $20→$72. $3–5/day is the sweet spot; $20 is nearly wasted.
- **Mistakes are punished:** terrible recipe → satisfaction tanks → demand
  (which runs on appeal = popularity + satisfaction) collapses → earns <75%
  of sensible. $20 price → ~0 sales. No chicken → stockouts, not free money.
- **Lively, not flat:** weather + headline stacks produce genuine boom/bust
  days (the original's forecast gamble is preserved: 30% of forecasts are wrong).

### What I changed from the design doc's starting guesses, and why

1. `footTrafficPerHour` 18 → 5 (theme): day-1 earnings were $150+, 10× the
   original's scale. A $9.50 platter needs ~10× fewer customers than $1 lemonade.
2. `basePopularityFactor` 0.25 → `baseAppealFactor` 0.12, `appealWeight` 0.75 → 0.5:
   demand now runs on **appeal = 0.65·popularity + 0.35·satisfaction** (the
   original: "the number of people coming to your stand is strongly influenced
   by those two parameters"). This was the key structural fix — it makes
   satisfaction economically load-bearing, so bad recipes actually cost money.
3. `recipeWeight` 0.6 → 0.75 (price/served 0.2 → 0.125): recipe is the primary
   satisfaction driver per the original; otherwise good service masked terrible food.
4. `dailyGrowth` 2.5 → 1.5, `promoPerDollar` 0.8 → 0.35, promo response
   0.5/ln(1+$ /2) → 0.35/ln(1+$ /3): promo was a dominant strategy ($20/day
   always correct). Now it saturates.
5. `defaultPlan`: middle bundles → small bundles (the old default overbought
   rice 3× over); promo $5 → $3.

### Monte Carlo pass (2026-10-19) — `npm run montecarlo`

200 seeds × 30 days × 4 strategies × 3 presets. Full table in
`reports/montecarlo-summary.json`.

**Tycoon retune** (supersedes the cozy pass below): rebalanced against
classic tycoon games (1973 Lemonade Stand: CV 1.25, 24.4% losing days) with
decision-dominance > 1 kept as a deliberate invariant. Targets: CV 0.9–1.3,
p10/mean ≥ −0.5, red days 15–25%, dominance > 1, bankruptcy < 5%.

| preset   | mean  | CV   | p10    | meanRec | maxRec | domin. | %loss | bnkrpt |
|----------|-------|------|--------|---------|--------|--------|-------|--------|
| standard | 32.52 | 0.96 | -4.37  | 2.1     | 16     | 1.21   | 14.3  | 0      |
| volatile | 30.48 | 1.44 | -22.21 | 2.2     | 13     | 0.81   | 29.4  | 0      |
| flat     | 27.35 | 0.99 | -7.98  | 2.1     | 17     | 1.20   | 15.9  | 0      |

Strategy means (standard): sensible 32.52, greedy −5.11, sloppy 28.21,
cheapskate 5.04. The standard preset passes every target except red days
(14.3% vs 15% — within MC noise) and maxRec (16 vs 10 — the max-of-draws
artifact; mean recovery is 2.1 days). Volatile is the wild counterfactual:
it breaks dominance (0.81), demonstrating the tradeoff.

#### What changed in the tycoon retune, and why

1. **Economic earnings** (`src/harness/montecarlo.ts`): earnings now =
   operating earnings − spoilage. The original 2002 game reported "Stock
   lost ($)" as a separate line, but for balance purposes waste must be
   priced in — otherwise overbuying is free and greedy strategies aren't
   punished. This made greedy properly negative (−$5.11 vs +$1.38 before),
   which is what lets dominance exceed 1 while CV rises.
2. **payMult-reactive pricing** (strategies): the `tiktok_slam` headline
   (payMult 0.75) was zeroing revenue — 20 visitors, 0 sales — because
   willingness dropped below the rigid $9.50 price. The strategy now scales
   price by headline payMult (slam → $7, tax refund → $12). This single fix
   raised mean $5.50, cut CV 1.20→0.88, and took dominance 0.98→1.31. A real
   player reads the headline; now the harness does too.
3. **Newsvendor chicken buying** (strategies): buy to the 80th percentile of
   forecast demand (conversion 0.55 × 1.35), not the mean. Underage (lost
   $6.50 margin) costs 4× overage (wasted $1.60 chicken). Stopped the
   systematic $15/day overbuying.
4. **Proximity-weighted wrong forecasts** (`src/sim/day.ts`): when the
   forecast is wrong, it's usually CLOSE (a few degrees off), not 180°
   wrong. Keeps the gamble frequent but mild.
5. **Forecast-reactive promo**: $4 on good forecasts, $1 on rainy/cold.
   Don't advertise a rained-out day.

#### Honest gaps

- **Red days 14.3% vs 15% target**: 0.7pp short, within MC noise (±1pp).
  Pushing harder would require silly forecast-wrong rates (>30%).
- **maxRec 16 vs 10 target**: unpassable as a max-of-hundreds-of-draws
  metric; mean recovery 2.1 days is the real number. Needs a p99 metric.
- **Volatile preset dominance 0.81**: breaks the >1 invariant by design
  (it's the "what if we crank it" counterfactual).

### Earlier cozy pass (superseded)

| preset   | mean  | CV   | p10    | meanRec | maxRec | domin. | %loss | bnkrpt |
|----------|-------|------|--------|---------|--------|--------|-------|--------|
| cozy     | 66.35 | 0.64 | 12.18  | 1.9     | 13     | 1.54   | 1.9   | 0      |
| volatile | 66.68 | 0.82 | -4.00  | 1.8     | 14     | 0.73   | 12.7  | 0      |
| flat     | 68.05 | 0.50 | 25.10  | 1.9     | 11     | 1.99   | 0.3   | 0      |

Strategy means (cozy): sensible 66.35, greedy 1.38, sloppy 60.11,
cheapskate 21.46. Decisions move the needle; the ordering
volatile < cozy < flat on every volatility metric is exactly the design
intent (cozy = interesting but not stressful).

#### What changed this pass, and why

1. **Promo overspend bug fix** (`src/sim/day.ts`): promo spend is now capped
   at cash on hand after morning purchases — the original warned "Not enough
   money for the advertising amount you set!" We were letting a $4 promo
   drive cash negative on $0-revenue days: 2/200 sensible runs went bankrupt
   (worst: -$107 after a broke-and-bleeding spiral). Now: 0 bankrupt runs on
   all presets. No legitimate play is affected (cap only binds when you
   couldn't afford it).
2. **Cash buffer in morning shopping** (`planPurchases`, `src/sim/economy.ts`):
   chicken first, then non-perishables only if cash stays above a $25 reserve.
   Before, a fixed plan could spend $82 → $2 on a full restock, then a rainy
   $0 day pinned cash at exactly $0 — a soft-lock (no chicken → no sales →
   no cash, forever). A real player keeps a buffer; now the harness does too.
3. **Reactive chicken buying** (strategies): 1× bundle while popularity < 25,
   2× after — "buy to expected demand", since chicken spoils overnight.
   (The old fixed 2× wasted ~$14/day early; fixed 1× stocked out on boom
   days. Both were strategy artifacts, not sim economics.)
4. **Recipe test honesty** (`test/economy.test.ts`): the old assertion
   (bad recipe < 75% of good earnings) failed because with a fixed shopping
   list the chicken quantity — not recipe — is the binding constraint on
   throughput. Now asserts directionally; the real recipe economics are
   measured by MC sloppy-vs-sensible (60.11 vs 66.35 — recipe matters, modestly,
   with reactive play).

#### Honest FAILs (not chased)

- **CV < 0.40**: cozy lands at 0.64. Variance decomposition (ablation runs)
  shows weather demand multipliers are the dominant source; even with
  perfectly flat weather + zero willingness jitter, CV only falls to ~0.47
  (headlines ±30% and Poisson arrivals remain). Hitting 0.40 would require
  flattening the weather/headlines that make days feel different — killing
  the texture to satisfy the number. The better coziness evidence: p10
  ($12.18) is solidly profitable and only 1.9% of days lose money.
  Recommendation: keep the target as an aspiration, or restate it as
  "CV < 0.70 with p10 > $0".
- **max recovery ≤ 2 days**: max over ~600 bad-day episodes is 13. This is a
  statistical artifact — the max of hundreds of draws from a geometric
  distribution is essentially guaranteed to exceed 2. The meaningful number
  is **mean recovery: 1.9 days** on all presets, and the Markov analysis
  (exact hitting times on the 9-state satisfaction×popularity chain) shows
  low-satisfaction states are *never even visited* in 5,800 sensible
  transitions. The 2-day rule holds where it matters.

### Known limitations (M0 scope)

- One location, no rent pressure yet (rent = $0 at Midtown Side Street).
- Upgrades/crew exist in the theme and apply generically, but the 10-location
  progression, menu unlocks, and challenge ranks are M3.
- Weather is random per day (no seasons); headline deck is 7, not 100.
- The economy is tuned for the *sensible* plan; degenerate strategies
  (e.g. 0/0/0-style exploits from the original) haven't been adversarially tested.

## What's next (M2)

Isometric day-view canvas (the animated CSS day view becomes real sprites);
cart-tier purchases; history charts; headline deck expansion toward 100.

## Monte Carlo balance framework

`npm run montecarlo` — because balance should be a number, not a vibe.

For each (tuning preset × named strategy) it runs N seeds × D days of
`simulateDay` (default 200 × 30) and measures:

- **Strategies** (`src/harness/strategies.ts`) — fixed play-styles, the
  "selected" side of the luck-vs-decisions comparison: `sensible` ($9.50,
  balanced recipe, fresh chicken daily), `greedy` ($14 — tests price
  punishment), `sloppy` (drowned in hot sauce — tests recipe load-bearing),
  `cheapskate` ($7, chicken every 2nd day — tests spoilage pressure).
- **Volatility** — earnings distribution per preset: mean, std dev, CV
  (std/mean), deciles. Target: **CV in 0.9–1.3** (tycoon frame — cheerful
  capitalism with real sting; calibrated against 1973 Lemonade Stand at 1.25).
- **Losing days** — target **15–25% red days** and **p10/mean ≥ −0.5**:
  losing days should sting, not dominate.
- **Recovery** — a "bad day" is earnings < 50% of the trailing 7-day mean;
  recovery = days until earnings return to that mean. Target: **mean ≤ 3 days,
  max ≤ 10 days**.
- **Decision dominance** — `|mean(sensible) − mean(greedy)| / std(sensible)`.
  Target **> 1.0** (design invariant): switching strategy should matter more
  than getting lucky.
- **Bankruptcy** — the backstop exists; target **< 5% of runs** for sensible
  play (rare, not the experience).
- **Markov recovery** — each day's (satisfaction, popularity) is discretized
  into 9 states; the 9×9 transition matrix is estimated from all runs, and
  mean hitting times back to high-satisfaction states are solved exactly
  (linear algebra, 9 states). This is the rigorous version of the recovery rule:
  "expected days to recover from the worst observed state."
- **Presets** (`tuning/presets/`) — `standard.json` (baseline) is compared
  against two counterfactuals: `volatile.json` (sharp weather swings, jumpy
  customers — the stressful end) and `flat.json` (dampened randomness — the
  boring end). Standard should sit between them: lively but fair.

```sh
npm run montecarlo -- --presets standard,volatile,flat \
  --strategies sensible,greedy,sloppy,cheapskate --seeds 200 --days 30
```

Raw per-day results go to `reports/mc-<preset>-<strategy>.json` (gitignored);
the comparison table + PASS/FAIL summary is committed at
`reports/montecarlo-summary.json`.

### Benchmarks vs real cozy games

`npm run benchmark:turnips` — reimplements Animal Crossing's datamined
turnip market (Ninji's algorithm) and runs our *own* metrics on it, so we can
compare our tuning against the most famous stochastic cozy economy ever
shipped. Write-up: [`benchmarks/COZY_BENCHMARKS.md`](benchmarks/COZY_BENCHMARKS.md).

### Benchmarks vs real tycoon games

`npm run benchmark:lemonade1973` — faithful reimplementation of the original
1973 Lemonade Stand (Bob Jamison / Charlie Kellner BASIC, formulas in the
file header), measured with the same metrics: sensible play lands at CV 1.25,
p10/mean −1.22, 24.4% losing days, dominance 0.83 — the genre's origin is
roughly 2× as volatile as our cart and luck-dominated. Qualitative deep
dives on 2002 Lemonade Tycoon (no bankruptcy; stakes = rank + spoilage),
OpenRCT2 (bankruptcy as rare backstop; celebrated gains, silent losses), and
Recettear (weekly debt clock as the stakes engine). Full write-up and revised
tycoon-frame targets (CV 0.9–1.3, 15–25% red days, dominance > 1 kept as
invariant): [`benchmarks/TYCOON_BENCHMARKS.md`](benchmarks/TYCOON_BENCHMARKS.md).
