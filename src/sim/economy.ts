/**
 * Pure economy helpers. No I/O, no RNG except where passed in.
 */
import type { Tuning } from "../tuning.js";
import type { CustomerType, Product, Theme } from "../theme.js";
import type { Lot, Purchase } from "./types.js";

/** Interpolate the rush curve at a decimal hour. */
export function rushAt(tuning: Tuning, hour: number): number {
  const k = tuning.rushCurve;
  if (hour <= k[0].hour) return k[0].v;
  for (let i = 1; i < k.length; i++) {
    if (hour <= k[i].hour) {
      const a = k[i - 1];
      const b = k[i];
      const t = (hour - a.hour) / (b.hour - a.hour);
      return a.v + t * (b.v - a.v);
    }
  }
  return k[k.length - 1].v;
}

/** Recipe slider (axis min..max, neutral 3) -> component quantity multiplier. */
export function sliderMult(tuning: Tuning, v: number): number {
  return tuning.recipe.sliderBase + tuning.recipe.sliderStep * (v - 3);
}

/**
 * How much a customer likes the recipe, 0..1.
 * Falls off with distance from their ideal, scaled by their tolerance.
 */
export function recipeScore(
  recipe: Record<string, number>,
  type: CustomerType,
): number {
  const axes = Object.keys(type.recipeIdeal);
  if (!axes.length) return 1;
  let sum = 0;
  for (const axis of axes) {
    const actual = recipe[axis] ?? 3;
    const ideal = type.recipeIdeal[axis];
    const diff = Math.abs(actual - ideal);
    sum += Math.max(0, 1 - diff / (2 * type.recipeTolerance));
  }
  return sum / axes.length;
}

/** Units of each supply needed for one item, after recipe slider scaling. */
export function componentQtys(
  tuning: Tuning,
  product: Product,
  recipe: Record<string, number>,
): { supplyId: string; qty: number }[] {
  return product.components.map((c) => ({
    supplyId: c.supplyId,
    qty: c.qty * (c.scaledBy ? sliderMult(tuning, recipe[c.scaledBy] ?? 3) : 1),
  }));
}

/** Total units currently in stock for a supply. */
export function stockOnHand(lots: Lot[] | undefined): number {
  if (!lots) return 0;
  return lots.reduce((s, l) => s + l.qty, 0);
}

/**
 * Sensible morning shopping list. Protein (the 1-day perishable core of the
 * menu) comes first — the day can't happen without it; the protein budget is
 * split across the perishable proteins by each flagship's menu-choice weight.
 * Non-perishables are topped up when below 35% of storage cap, but planned
 * spending never takes cash below `reserve`: a real player keeps a buffer so
 * one rained-out day can't soft-lock the cart into a no-protein →
 * no-sales → no-cash trap. Pure: no RNG, no I/O.
 */
export function planPurchases(
  theme: Theme,
  cash: number,
  inventory: Record<string, Lot[]>,
  proteinBundles: number,
  reserve = 25,
): Purchase[] {
  const out: Purchase[] = [];
  let remaining = cash;
  // menu-choice weight per flagship: mean of typePref over customer types
  const mains = theme.products.filter((p) => p.flagship);
  const prodWeight = (p: Product): number => {
    const prefs = theme.customerTypes.map((t) => p.typePref?.[t.id] ?? 1);
    return prefs.reduce((a, b) => a + b, 0) / Math.max(1, prefs.length);
  };
  const perish = theme.supplies.filter((s) => s.shelfLifeDays <= 1);
  const totalW = perish.reduce((sum, s) => {
    const p = mains.find((m) => m.components.some((c) => c.supplyId === s.id));
    return sum + (p ? prodWeight(p) : 0);
  }, 0);
  for (const s of perish) {
    const p = mains.find((m) => m.components.some((c) => c.supplyId === s.id));
    const share = p && totalW > 0 ? prodWeight(p) / totalW : 1 / Math.max(1, perish.length);
    const b = s.bundles[0];
    const want = Math.max(share >= 0.15 ? 1 : 0, Math.round(proteinBundles * share));
    const n = Math.min(want, Math.floor(remaining / b.price));
    if (n > 0) {
      out.push({ supplyId: s.id, bundleIndex: 0, count: n });
      remaining -= n * b.price;
    }
  }
  for (const s of theme.supplies) {
    if (s.shelfLifeDays <= 1) continue;
    if (stockOnHand(inventory[s.id]) >= s.storageCap * 0.35) continue;
    const b = s.bundles[0];
    if (remaining - b.price >= reserve) {
      out.push({ supplyId: s.id, bundleIndex: 0, count: 1 });
      remaining -= b.price;
    }
  }
  return out;
}

export interface Consumption {
  ok: boolean;
  /** supplyId -> {qty, cost} actually taken (empty if !ok) */
  taken: { supplyId: string; qty: number; cost: number }[];
}

/**
 * Try to consume `needs` from inventory (oldest lots first). Pure w.r.t. the
 * passed-in working copy — mutates the lots arrays you hand it, so hand it
 * a clone. Atomic: either everything is taken or nothing is.
 */
export function consume(
  inventory: Record<string, Lot[]>,
  needs: { supplyId: string; qty: number }[],
): Consumption {
  // feasibility check first
  for (const n of needs) {
    if (stockOnHand(inventory[n.supplyId]) < n.qty - 1e-9) {
      return { ok: false, taken: [] };
    }
  }
  const taken: Consumption["taken"] = [];
  for (const n of needs) {
    let remaining = n.qty;
    let cost = 0;
    const lots = inventory[n.supplyId];
    for (const lot of lots) {
      if (remaining <= 1e-9) break;
      const take = Math.min(lot.qty, remaining);
      lot.qty -= take;
      remaining -= take;
      cost += take * lot.unitCost;
    }
    inventory[n.supplyId] = lots.filter((l) => l.qty > 1e-9);
    taken.push({ supplyId: n.supplyId, qty: n.qty, cost });
  }
  return { ok: true, taken };
}

/** What a customer of this type will pay, before jitter. */
export function baseWillingness(
  type: CustomerType,
  weatherWillingnessMult: number,
  headlinePayMult: number,
): number {
  return type.refPrice * weatherWillingnessMult * headlinePayMult;
}

/** Promo demand multiplier: 1 + scale * ln(1 + spend/steepness). */
export function promoMult(tuning: Tuning, spend: number): number {
  return 1 + tuning.promo.responseScale * Math.log(1 + spend / tuning.promo.responseSteepness);
}

/** Appeal (0..1): blend of popularity (they know you) and satisfaction (they like you). */
export function appeal(tuning: Tuning, popularity: number, satisfaction: number): number {
  return (
    tuning.demand.popularityShare * (popularity / 100) +
    (1 - tuning.demand.popularityShare) * (satisfaction / 100)
  );
}

/** Appeal (0..100 scale inputs) -> demand factor. */
export function appealFactor(tuning: Tuning, popularity: number, satisfaction: number): number {
  return tuning.demand.baseAppealFactor + tuning.demand.appealWeight * appeal(tuning, popularity, satisfaction);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Round money to cents for display/ledger (sim keeps full precision internally). */
export function cents(v: number): number {
  return Math.round(v * 100) / 100;
}

export function getThemeRefs(theme: Theme) {
  return {
    supply: (id: string) => theme.supplies.find((s) => s.id === id)!,
    product: (id: string) => theme.products.find((p) => p.id === id)!,
    location: (id: string) => theme.locations.find((l) => l.id === id)!,
    customerType: (id: string) => theme.customerTypes.find((c) => c.id === id)!,
  };
}
