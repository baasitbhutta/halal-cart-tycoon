# Cozy-Balance Benchmarks

How does our tuning compare to real cozy games? Two findings: (1) most cozy
games deliberately have **no stochastic economy at all** — the genre's typical
answer to volatility is to opt out; (2) the famous exception, Animal
Crossing's turnip market, has been datamined, so we reimplemented it and ran
**our own metrics** on it.

## 1. The genre's default: no randomness in the economy

The honest starting point is that there is almost nothing to benchmark
*against*, because cozy games overwhelmingly avoid stochastic economies:

- **Stardew Valley** — crop and artisan-good prices are fixed and
  deterministic; profit is a pure function of what you plant and how you
  process it. The one gamble in the game, Mr. Qi's casino, is opt-in,
  late-game, and runs on **Qi coins, a separate currency that cannot be
  converted back to gold** — the design quarantines randomness away from the
  core economy so it can never touch your farm's solvency.
  (Sources: [vgkami casino guide](https://vgkami.com/stardew-valley-how-to-get-into-mr-qis-casino/),
  [Steam community odds discussion](https://steamcommunity.com/app/413150/discussions/0/365163686046913325/?l=finnish))
- **Disney Dreamlight Valley** — money-making is deterministic farming,
  fishing, and cooking with fixed margins (e.g. 5 canola → 545 Star Coins,
  always; cooking adds a fixed premium). No price ever moves.
  (Source: [TechRaptor money-making guide](https://techraptor.net/gaming/guides/disney-dreamlight-valley-money-making-guide))
- **Animal Crossing: New Horizons** — shop buy/sell prices are fixed. The
  *entire* stochastic economy of the game is the turnip market — one
  opt-in weekly gamble. Everything else is deterministic.

A time-boxed search for other documented stochastic economies in cozy games
(Dinkum, Travellers Rest, Dreamlight Valley) turned up nothing — negative
result, as expected. **Turnips are the genre's lone specimen.**

## 2. The turnip benchmark

`src/harness/benchmarks/turnips.ts` reimplements the ACNH stalk market from
Ninji's datamine (documented by /u/Edricus, "Breaking Down The Stalk Market"
v1.2.1; pattern-of-patterns matrix confirmed by
[mcpower.github.io/turnips](https://mcpower.github.io/turnips/info/)):

- Sunday buy price: uniform integer 90–110 bells. 12 sell windows (Mon AM …
  Sat PM). Unsold turnips rot Sunday (total loss of stake).
- 4 patterns via Markov chain on last week's pattern (first week forced Small
  Spike): Random (fluctuating ≤1.4×), Large Spike (up to 6×, ceiling 660),
  Decreasing (never rises), Small Spike (≤2×, peak on its 4th rising slot).
- 3 sell strategies: **oracle** (sells at weekly max — unachievable upper
  bound), **firstSpike** (sells at first price above buy — the realistic good
  play), **panic** (sells Monday PM no matter what — the bad decision).

Run: `npm run benchmark:turnips` (default 200 seeds × 30 weeks, ~3s).
Metrics use the **exact same definitions** as `src/harness/metrics.ts`.

### Results (200 seeds × 30 weeks; profit per turnip in bells)

| strategy   | mean  | std    | CV   | p10 | p50 | p90 | % loss weeks |
|------------|-------|--------|------|-----|-----|-----|--------------|
| oracle     | 99.96 | 127.23 | 1.27 | -11 | 44  | 332 | 14.2         |
| firstSpike | 12.27 | 31.92  | 2.60 | -54 | 19  | 38  | 14.2         |
| panic      | -12.32| 23.98  | 1.95 | -43 | -16 | 25  | 73.0         |

Decision dominance `|mean(firstSpike)−mean(panic)|/std(firstSpike)` = **0.77**
(oracle vs panic: 0.88). Pattern mix reproduced the datamined stationary
distribution (Random ~34%, Large Spike ~23%, Decreasing ~14%, Small Spike
~29% incl. forced first weeks); oracle mean profit by pattern (Random +34,
Large Spike +302, Decreasing −12, Small Spike +70) matches the documented
pattern shapes — the implementation is faithful.

### Head-to-head: our cart vs the most famous cozy gamble ever shipped

Same metrics, unitless columns (CV, p10/mean, dominance). Horizons differ —
turnips are weekly per-turnip profit, our cart is daily earnings — stated
explicitly; the unitless metrics are directly comparable.

| metric          | turnips (firstSpike) | our cart (cozy / sensible) |
|-----------------|----------------------|----------------------------|
| CV              | **2.60**             | **0.64**                   |
| p10 / mean      | **−4.40**            | **+0.18**                  |
| decision dominance | **0.77**          | **1.54**                   |
| % losing periods| **14.2%**            | **1.9%**                   |

**Turnips are roughly 4× more volatile than our cart, luck-dominated
(dominance < 1), and lose money more than one week in seven — yet Animal
Crossing is the coziest game on earth.** That apparent paradox is the most
useful finding in this document:

1. **The turnip market's coziness doesn't come from low volatility.** It
   comes from *containment*: a hard weekly reset (losses never compound —
   next Sunday is a fresh week), capped downside (you can only lose your
   stake, never go into debt), and total opt-in freedom (buy zero turnips,
   skip the market entirely, nothing bad happens).
2. **Our cart is calmer than turnips on every metric** — CV 0.64 vs 2.60,
   worst decile profitable (+0.18 of mean) vs deeply negative, decisions
   beating luck (1.54) vs luck beating decisions (0.77). If "as cozy as
   Animal Crossing's economy" is the bar, we clear it with room to spare.
3. **The dominance gap is the design lesson.** Turnips get away with
   dominance 0.77 because the *rest* of the game is deterministic and safe —
   the gamble is a contained side-show. Our cart *is* the game, so it needs
   dominance > 1: the player's decisions must matter more than the dice.
   Ours does (1.54). This validates the target rather than just the number.

### Our cozy targets, applied to turnips

| target               | turnips (firstSpike) | our cart |
|----------------------|----------------------|----------|
| CV < 0.70            | FAIL (2.60)          | PASS (0.64) |
| p10 > 0              | FAIL (−54)           | PASS (+12.18) |
| dominance > 1.0      | FAIL (0.77)          | PASS (1.54) |

Turnips fail our targets and are still beloved — which tells us the targets
measure *our chosen design* (a calm daily business sim), not some universal
law of coziness. Nintendo's design achieves coziness through containment
rather than calm. Both are valid; we chose calm, and the benchmark confirms
we're delivering it.

## 3. Honest caveats

- **Different shapes.** Turnips are a weekly all-or-nothing capital gamble
  (stake → spike-or-rot); our cart is daily operating income with
  compounding popularity. CV comparisons across shapes are suggestive, not
  rigorous.
- **Turnips have social play we don't model.** In practice, players sell on
  friends' spike islands — the real-world strategy is "firstSpike on *my*
  island, oracle on *someone's*." Our benchmark models solo play only, which
  understates real player outcomes.
- **Most of the genre opts out.** This benchmark is one data point because
  one data point is all the genre offers. Our targets remain our own design
  choice — informed by this benchmark, not dictated by it.

## 4. Genre design writing: what "cozy" prescribes

Three pieces, each one paragraph on what they prescribe about failure states
and volatility:

1. **"Cosy gaming: how curling up with Animal Crossing is changing what it
   means to be a gamer" (techxplore.com, researcher-written, 2023):**
   "Cosy games are defined by what they omit. Far from presenting players
   with tough challenges and high stakes, cosy games omit the potential for
   winning or losing entirely. The clearest objective is to make your own
   fun." Prescription: remove the *possibility* of losing, not just its
   probability — design the failure state out of existence.
   ([source](https://techxplore.com/news/2023-01-cosy-gaming-animal-gamer.html))
2. **"Is Stardew Valley Actually Cozy?" (ifyoudare.blogspot.com, 2026):**
   defines the genre as "no fail state or game over… Progress feels safe —
   you can't really 'lose'", then argues Stardew only *partially* qualifies
   because its deadlines and optimization pressure create real stress under
   the cozy paint. Prescription and warning in one: aesthetic coziness
   without mechanical coziness reads as betrayal — our volatility targets
   are the mechanical side of that contract.
   ([source](http://ifyoudare.blogspot.com/2026/08/is-stardew-valley-actually-cozy-real.html))
3. **"Why Cozy Games Feel So Good" (punishedbacklog.com, 2026):** "in a cozy
   game, there is no threat of actual failure" — and traces the genre's
   lineage (Harvest Moon → Stardew → Fields of Mistria) as a tradition of
   *safety as a feature*. Prescription: safety isn't the absence of design,
   it's the design — players return for hundreds of hours *because* the
   stakes can't hurt them.
   ([source](https://punishedbacklog.com/why-cozy-games-feel-so-good/))

## 5. Reproducing

```sh
npm run benchmark:turnips -- --seeds 200 --weeks 30
npm run benchmark:turnips -- --seeds 50 --weeks 10 --strategies oracle,panic
```

Implementation: `src/harness/benchmarks/turnips.ts` (pure functions, seeded
mulberry32 like the rest of the repo). Our cart's numbers are read live from
`reports/montecarlo-summary.json` when present.
