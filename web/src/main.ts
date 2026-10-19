/** Boot: fetch the theme pack, build the Game, show the menu. */
import { Game } from "./game.js";
import { el } from "./format.js";

async function boot(): Promise<void> {
  const root = document.getElementById("app")!;
  try {
    const res = await fetch("./data/halal-cart.json");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const theme = await res.json();
    const game = new Game(theme, root);
    game.goto("menu");
  } catch (err) {
    root.appendChild(
      el("div", "panel", `<h2>⚠️ Couldn't load the game</h2>
        <div class="dim">The theme pack (data/halal-cart.json) didn't load.
        If you're opening index.html directly from disk, serve the folder instead:
        <b>npm run dev</b>, then open the local URL. (${String(err)})</div>`),
    );
  }
}

boot();
