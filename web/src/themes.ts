/** Theme pack registry for the picker. The packs themselves are pure data
 * (web/public/data/<id>.json); this list only names the ones the menu
 * offers. Adding a pack = add its JSON + one line here. */
export interface ThemeChoice {
  id: string;
  name: string;
  emoji: string;
}

export const THEME_CHOICES: ThemeChoice[] = [
  { id: "halal-cart", name: "Halal Cart Tycoon", emoji: "🌯" },
  { id: "taco-stand", name: "Taco Stand Tycoon", emoji: "🌮" },
];

export const DEFAULT_THEME_ID = "halal-cart";
const STORE_KEY = "hct.theme";

export function resolveThemeId(): string {
  const fromUrl = new URLSearchParams(location.search).get("theme");
  if (fromUrl && THEME_CHOICES.some((t) => t.id === fromUrl)) return fromUrl;
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved && THEME_CHOICES.some((t) => t.id === saved)) return saved;
  } catch {
    /* private mode */
  }
  return DEFAULT_THEME_ID;
}

export function switchTheme(id: string): void {
  try {
    localStorage.setItem(STORE_KEY, id);
  } catch {
    /* private mode */
  }
  const url = new URL(location.href);
  url.searchParams.set("theme", id);
  location.assign(url.toString());
}
