/**
 * Theme pack schema. The sim core is theme-agnostic: it only reads these
 * shapes. A new theme (taco stand, coffee shop) = a new JSON file + art.
 *
 * Browser-safe: no node imports here. Node code loads packs via
 * theme-node.ts's loadTheme(); browser code fetches the JSON.
 */
import type { ChallengeDef } from "./sim/challenges.js";

export interface SupplyBundle {
  qty: number;
  price: number; // dollars for the whole bundle
}

export interface Supply {
  id: string;
  name: string;
  unit: string; // "lb", "gal", "each"
  bundles: SupplyBundle[];
  /** Days a lot stays usable. Bought day N (age 0); spoils overnight when age >= shelfLifeDays. */
  shelfLifeDays: number; // Infinity = never spoils
  /** Max units storable at cart tier 0. */
  storageCap: number;
}

export interface ProductComponent {
  supplyId: string;
  /** Units consumed per item sold, at recipe slider = 3 (neutral). Scaled by sliders. */
  qty: number;
  /** Which recipe axis scales this component (optional). */
  scaledBy?: string;
}

export interface Product {
  id: string;
  name: string;
  defaultPrice: number; // dollars
  flagship: boolean;
  components: ProductComponent[];
  /** If true, customers may add this to a flagship purchase (drinks). */
  sideItem?: boolean;
  /** Emoji for menus/UI. */
  emoji?: string;
  /** Willingness multiplier for this item (1 = priced like the flagship). */
  refPriceMult?: number;
  /** Per-customer-type choice weight among flagships (default 1). */
  typePref?: Record<string, number>;
}

export interface RecipeAxis {
  id: string;
  name: string;
  min: number;
  max: number;
  default: number;
  blurb: string;
}

export interface Location {
  id: string;
  name: string;
  rent: number; // dollars/day
  /** Base customer arrivals per hour at 100% popularity, rush=1, neutral weather. */
  footTrafficPerHour: number;
  /** One-time popularity head start at this location (the Suburbs bonus). */
  popularityBonus: number;
  /** Customer type mix: typeId -> weight. */
  customerMix: Record<string, number>;
}

export interface CustomerType {
  id: string;
  name: string;
  /** Dollars they're comfortable paying for the flagship (before weather/headline/jitter). */
  refPrice: number;
  /** Minutes they'll wait in line, base. */
  patienceMin: number;
  /** Ideal recipe slider values. */
  recipeIdeal: Record<string, number>;
  /** How forgiving they are of recipe deviation (higher = more forgiving). */
  recipeTolerance: number;
  blurb: string;
}

export interface HeadlineEffects {
  demandMult?: number;
  payMult?: number;
  patienceAddMin?: number;
  popularityAdd?: number;
  tempOverrideF?: number;
}

export interface Headline {
  id: string;
  text: string;
  effects: HeadlineEffects;
}

export interface CrewRole {
  id: string;
  name: string;
  wage: number; // dollars/day
  /** Multiplies serve minutes (e.g. 0.75 = 25% faster). */
  serveMult?: number;
  /** Extra line patience in minutes. */
  patienceAddMin?: number;
  blurb: string;
}

export interface Upgrade {
  id: string;
  name: string;
  cost: number; // dollars, one-time
  serveMult?: number;
  patienceAddMin?: number;
  popularityBoost?: number; // instant popularity points on purchase
  storageMult?: number;
  blurb: string;
}

export interface CartTier {
  id: string;
  name: string;
  cost: number; // dollars to buy (0 = starting cart)
  storageMult: number;
}

export interface SceneTheme {
  signText: string;
  cart: string;
  cartDark: string;
  cartLight: string;
  stripe: string;
}

export interface Theme {
  id: string;
  name: string;
  tagline: string;
  emoji?: string;
  scene?: SceneTheme;
  supplies: Supply[];
  products: Product[];
  recipeAxes: RecipeAxis[];
  locations: Location[];
  customerTypes: CustomerType[];
  headlines: Headline[];
  crew: CrewRole[];
  upgrades: Upgrade[];
  cartTiers: CartTier[];
  challenges?: ChallengeDef[]; // scenario set for this pack (M4: data, not code)
}

export function getSupply(theme: Theme, id: string): Supply {
  const s = theme.supplies.find((x) => x.id === id);
  if (!s) throw new Error(`unknown supply: ${id}`);
  return s;
}

export function getLocation(theme: Theme, id: string): Location {
  const l = theme.locations.find((x) => x.id === id);
  if (!l) throw new Error(`unknown location: ${id}`);
  return l;
}

export function getProduct(theme: Theme, id: string): Product {
  const p = theme.products.find((x) => x.id === id);
  if (!p) throw new Error(`unknown product: ${id}`);
  return p;
}

export function flagship(theme: Theme): Product {
  return theme.products.find((p) => p.flagship)!;
}

/** All main-dish products customers choose between at the window. */
export function flagships(theme: Theme): Product[] {
  return theme.products.filter((p) => p.flagship);
}
