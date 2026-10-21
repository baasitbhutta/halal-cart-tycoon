/** Boot: fetch the theme pack, build the Game, show the menu. */
import { Game } from "./game.js";
import { el } from "./format.js";
import { resolveThemeId } from "./themes.js";

async function boot(): Promise<void> {
  const root = document.getElementById("app")!;
  const themeId = resolveThemeId();
  try {
    const res = await fetch(`./data/${themeId}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const theme = await res.json();
    const game = new Game(theme, root);
    // ?shot=<hour> debug: auto-start a stocked day and freeze playback there.
    if (game.shotHour != null) {
      game.shotDay();
      return;
    }
    game.goto("menu");
  } catch (err) {
    root.appendChild(
      el("div", "panel", `<h2>⚠️ Couldn't load the game</h2>
        <div class="dim">The theme pack (data/${themeId}.json) didn't load.
        If you're opening index.html directly from disk, serve the folder instead:
        <b>npm run dev</b>, then open the local URL. (${String(err)})</div>`),
    );
  }
}

boot();
