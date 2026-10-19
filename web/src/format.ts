/** Tiny formatting helpers for the UI. */

export function money(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toFixed(2)}`;
}

export function money0(v: number): string {
  const sign = v < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(v))}`;
}

/** Decimal hour (12.25) -> "12:15 PM". */
export function clock(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  const ap = hh >= 12 ? "PM" : "AM";
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${h12}:${String(mm).padStart(2, "0")} ${ap}`;
}

const COND_ICON: Record<string, string> = {
  hot_sunny: "☀️",
  nice: "🌤️",
  cloudy: "☁️",
  rainy: "🌧️",
  cold: "❄️",
};

const COND_LABEL: Record<string, string> = {
  hot_sunny: "Hot & sunny",
  nice: "Nice",
  cloudy: "Cloudy",
  rainy: "Rainy",
  cold: "Cold",
};

export function condIcon(id: string): string {
  return COND_ICON[id] ?? "🌤️";
}

export function condLabel(id: string): string {
  return COND_LABEL[id] ?? id.replace(/_/g, " ");
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
