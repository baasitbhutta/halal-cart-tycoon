# Tycoon benchmarks — calibrating against the genre, not the vibe

**Date:** 2026-10-19
**Question:** our balance targets (CV < 0.7, p10 > $0, dominance > 1) were set in the
cozy frame. The user redirected: this is a *tycoon* game in the Lemonade Tycoon
lineage. Tycoon players expect bigger swings and real stakes — the fun is riding
volatility. What does classic tycoon volatility actually look like, numerically?

## 1. The numbers: three volatility signatures side by side

### 1a. 1973 Lemonade Stand — faithful reimplementation, our metrics

`src/harness/benchmarks/lemonade1973.ts` reimplements the original 1973 Bob
Jamison / 1979 Charlie Kellner BASIC game from the published source (formulas
documented in the file header; Raymond Chen's devblogs article cross-checked,
two discrepancies noted and resolved in favor of the original listing).
Run: `npm run benchmark:lemonade1973` (200 seeds × 30 days, ~3s).
Daily metric = **profit in dollars** (post-bankruptcy days count as $0).
Metrics use the exact definitions in `src/harness/metrics.ts`.

| strategy | mean | std | CV | p10 | p50 | p90 | % loss days | % bankrupt |
|---|---|---|---|---|---|---|---|---|
| sensible (10¢, match supply to forecast, advertise on sunny) | 1.83 | 2.29 | **1.25** | -2.23 | 2.10 | 4.78 | 24.4 | 1.0 |
| greedy (all-in bankroll, $1.00 — the famous jackpot exploit) | -0.07 | 0.36 | 5.39¹ | 0.00 | 0.00 | 0.00 | 3.3 | **100.0** |
| sloppy (random price/ads/supply) | -0.05 | 1.03 | 20.47¹ | -1.50 | 0.00 | 1.04 | 21.9 | 79.5 |
| sharpshooter (bet 10% of bankroll at $1.00 — the *sized* jackpot play) | 0.03 | 1.78 | 53.10¹ | -0.40 | -0.10 | -0.05 | 90.8 | 17.5 |

¹ CV explodes when the mean is near zero — a metric artifact, not information.
Read CV only on the sensible row.

Decision dominance `|mean(sensible)−mean(greedy)|/std(sensible)` = **0.83**
(sensible vs sloppy: 0.82). **Luck slightly dominates even the canonical
good-vs-bad decision gap in the genre's origin game.**

Recovery (bad day = profit < 50% of trailing 7-day mean):
sensible — 1417 bad days, mean recovery **2.4d**, max **18d**, 156 unrecovered.

Two findings worth their own sentences:

- **The famous exploit is ruinous played naively.** Chen's all-in-at-$1.00
  jackpot strategy goes bankrupt in 100% of runs (mean −$0.07/day). The 1973
  game punishes the exact play its own math seems to invite.
- **The "smart" version barely survives either.** Sharpshooter (Kelly-style
  10% bankroll bets) is +EV in theory (+3.3%/day bankroll growth, verified:
  E[return|jackpot] = 1.88×, E[return|normal] = −0.095×) but nets only
  +$0.03/day with 17.5% bankruptcy and 90.8% losing days. Volatility drag eats
  the edge: the ensemble grows, the median player bleeds. (An earlier version
  of this strategy that could bet *zero* glasses at tiny bankrolls looked
  safer but was secretly sidelined by integer bet minimums — a real friction
  in the original's design, now fixed and documented in the file.)

### 1b. Three-way comparison

| metric | ACNH turnips (firstSpike)¹ | 1973 Lemonade (sensible) | our cart (cozy / sensible) |
|---|---|---|---|
| CV | **2.60** | **1.25** | **0.64** |
| p10 / mean | **−4.40** | **−1.22** | **+0.18** |
| decision dominance | **0.77** | **0.83** | **1.54** |
| % losing periods | 14.2% (weeks) | **24.4%** (days) | **1.9%** (days) |
| bankruptcy | n/a (losses capped at stake) | **1.0%** (100% if reckless) | 0% |

¹ Turnip numbers from `benchmarks/COZY_BENCHMARKS.md` (200 seeds × 30 weeks).

**Reading it:** the genre's origin sits almost exactly between the cozy gamble
and our cart on every volatility measure — CV 1.25 vs 2.60 vs 0.64, p10/mean
−1.22 vs −4.40 vs +0.18. But 1973 is *more* punishing than turnips on loss
frequency (nearly 1 day in 4 loses money) and it has something neither of the
others has: real bankruptcy. Meanwhile our cart is the calmest of the three on
every axis *and* the only one where decisions clearly dominate luck (1.54 vs
0.83 vs 0.77). The 1973 column is what "classic tycoon volatility" looks like
as a number: **CV ≈ 1.25, a quarter of days red, p10 deeply negative, luck
roughly tied with decisions.**

## 2. 2002 Lemonade Tycoon — the stakes we descend from (qualitative)

From the Stephen M. FAQ, strategy guides, and our binary-string
reverse-engineering (`~/workspace/lemonade-reverse-engineering/MECH_SPEC.md`):

- **No bankruptcy mechanic found.** No bankruptcy strings in the binary, no
  fail state in any guide. The game *refuses* to let you overspend: setting an
  ad budget you can't afford pops "Not enough money for the advertising amount
  you set!" Perishable stock can spoil (pure loss), bad recipes tank
  satisfaction, overpricing kills demand — but the business itself cannot die.
- **Stakes = rank + opportunity cost.** Challenge mode is 30 days, scored on
  total earnings against rank thresholds. Failure feels like a *bad rank* and
  watching spoiled inventory get thrown out, not a game-over screen.
- **The volatility is in the weather/demand dice,** and the skill is matching
  supply to it exactly ("maximum profitability comes from exactly matching
  your supply with the demand curve" — Game Over Online review). Sound
  familiar: it's our M0 balance finding restated.

**Takeaway:** the direct ancestor *removed* 1973's bankruptcy and kept the
volatility. Its stakes are reputational (rank) and economic (waste), not
existential. This is the strongest evidence that our game doesn't need
bankruptcy-as-experience — but 1973 shows the genre tolerates it as backstop.

## 3. OpenRCT2 — how the most beloved tycoon does tension without cruelty

Researched from code-adjacent docs, the RCT wiki, and player guides (no
implementation; time-boxed as instructed):

- **Bankruptcy is real but rare in practice.** Cash below $0 triggers a
  warning; fail to recover and the scenario ends ("Bankrupt"). Loans accrue
  monthly interest, and several scenarios *start* you deep in debt — the
  early game is a "profit race" against the interest clock. But veterans'
  consensus (Steam forums): "the problem isn't *if* you win, it's *when* you
  win." Bankruptcy is the guardrail at the edge of the cliff, not the road.
- **Death spirals exist but are recoverable.** Low park rating → fewer guests
  → less income → can't fix problems → rating drops further. The loop is real,
  yet almost always escapable with one good ride — recovery is a design
  requirement, not an accident.
- **Extraction is bounded by design.** Every guest carries a *finite wallet*;
  overprice the entrance and they simply can't enter. The known heuristic
  (price ≈ ride excitement rating) is the game telling you the fair band.
  You cannot infinitely exploit — the sim pushes back.
- **Asymmetric feedback.** Every single purchase plays a "ka-ching" and
  visibly ticks the treasury up, *one transaction at a time*; upkeep and wages
  are subtracted silently in bulk. Gains are celebrated loudly, losses are
  quiet. The volatility is real but the *presentation* is warm.

**Takeaway for us:** RCT's formula is *real stakes, kind presentation,
guaranteed recoverability*. Bankruptcy exists so recklessness has a price;
everything else (finite wallets, rating spirals you can climb out of,
celebrated gains) keeps the tension from curdling into cruelty.

## 4. Recettear — the debt clock as stakes engine (qualitative, brief)

From wikis and guides (sources were solid enough to include):

- **The stakes are a weekly escalating debt payment to Tear; miss one and
  it's game over.** But the failure is soft: you restart at the beginning of
  the month with all items and XP intact. Real deadline, forgiving loop.
- **Market prices fluctuate like a stock exchange,** announced via news
  flashes; selling into a spike can double value. This is volatility-as-toy.
- **Mispricing has two punishments:** haggle too high and the customer walks
  away angry (lost sale, no crash); and — the elegant one — **dumping too
  much of one category over-saturates the market and crashes its value
  endogenously.** Volatility you cause yourself.
- Customer budgets are finite (like RCT's wallets); nailing the price first
  try earns a "Just" bonus that compounds into merchant levels.

**Takeaway:** Recettear separates *volatility* (market swings — fun, play
with it) from *stakes* (the debt clock — the thing that can end you). That's
a clean architecture worth stealing: our weather/demand dice supply the
volatility; *something else* should supply the stakes.

## 5. Recalibration proposal — revised targets for our game

Evidence first, judgment flagged as judgment:

| target | old (cozy frame) | proposed (tycoon frame) | basis |
|---|---|---|---|
| CV | < 0.70 | **0.9 – 1.3** | 1973 = 1.25 (evidence); 2.60 = too wild for a daily business sim (judgment); 0.64 = calmer than the genre origin (evidence) |
| p10 / mean | > 0 | **≥ −0.5** (mildly negative allowed) | 1973 = −1.22 (evidence); we needn't go that far — losing days should sting, not dominate (judgment) |
| % loss days | (untargeted; was 1.9%) | **15 – 25%** | 1973 = 24.4% (evidence); ~1 red day in 4–6 keeps tension without despair (judgment) |
| decision dominance | > 1.0 | **> 1.0 (keep as invariant)** | 1973 = 0.83 — the genre tolerates luck-domination, but *fair mechanics where decisions beat luck* is our differentiator (design choice, explicitly not evidence) |
| bankruptcy | (mechanic exists; 0% observed) | **exists as backstop; < 5% for sensible play** | RCT model: real fail state, rarely the experience (evidence); 2002 removed it entirely and was fine (counter-evidence — so keep it rare, not central) |
| recovery | mean ≤ 3d | **mean ≤ 3d, max ≤ ~10d** | 1973 max = 18d feels punishing (judgment); RCT spirals are always climbable (evidence) |

In five lines: **raise CV target to 0.9–1.3** (1973 sits at 1.25; our 0.64 is
calmer than the genre's origin). **Let p10 go mildly negative** (≥ −0.5× mean;
losing days should sting). **Target 15–25% red days** (1973: 24.4%; we're at
1.9% — over-sheltered). **Keep dominance > 1 as a design invariant** — it's
our "fair tycoon" differentiator, stricter than 1973's 0.83 by choice.
**Bankruptcy stays a rare backstop** (< 5% sensible), RCT-style, not the
experience.

What this means mechanically (for the tuning pass, not this doc): the
volatility budget should come from *demand/weather dice* (1973's storms,
Recettear's market flashes), while *stakes* come from perishable waste and
fixed daily costs (2002's spoilage, RCT's interest clock) — never from making
the sim itself unfair. And steal RCT's asymmetric feedback: celebrate gains
loudly, keep losses quiet.

## 6. Caveats

- The 1973 game is a few dozen lines of BASIC with all-or-nothing weather
  events (storm = sell zero, jackpot = sell everything); its volatility is
  lumpier than any smooth demand curve we'd ship. CV 1.25 is a ceiling
  reference, not a bullseye.
- The metrics aren't perfectly commensurable: 1973's daily metric is *profit*
  (can be very negative on storm days — you lose the whole batch), ours is
  daily earnings; turnips are weekly with losses capped at the stake.
- CV is meaningless when the mean is near zero (see the greedy/sloppy/
  sharpshooter rows) — only the sensible rows carry information.
- "No bankruptcy in 2002" rests on binary-string RE plus guide consensus,
  not exhaustive proof; a hidden fail state can't be fully ruled out.
- OpenRCT2 research was docs/wikis/guides only, time-boxed; no code
  archaeology, no implementation.
- The dominance comparison pairs differ per game (sensible-vs-greedy for
  1973, sensible-vs-slapdash for ours); the <1 vs >1 contrast is robust to
  the pairing but the exact values aren't.
- These targets remain design choices. The genre gives a *range* (roughly
  CV 0.9–1.6, red days common, luck ≈ decisions); where we sit in it is taste.
