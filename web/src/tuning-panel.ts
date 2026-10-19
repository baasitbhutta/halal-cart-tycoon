/**
 * Collapsible dev tuning panel. Auto-generates controls by walking the
 * Tuning object: numbers -> slider + input, objects/arrays -> fieldsets.
 * Toggle with backtick (`) or the floating button. Live-applies via
 * Game.retune; "Copy tuning link" puts ?tuning= on the clipboard.
 */
import type { Game } from "./game.js";
import { el, esc } from "./format.js";

export class TuningPanel {
  private game: Game;
  private panel: HTMLElement;
  private toggle: HTMLElement;
  private open = false;

  constructor(game: Game) {
    this.game = game;
    this.toggle = el("button", "", "🎛️");
    this.toggle.id = "tuning-toggle";
    this.toggle.title = "Tuning panel (`)";
    this.toggle.addEventListener("click", () => this.setOpen(!this.open));
    document.body.appendChild(this.toggle);

    this.panel = el("div", "");
    this.panel.id = "tuning-panel";
    document.body.appendChild(this.panel);

    window.addEventListener("keydown", (e) => {
      if (e.key === "`" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        this.setOpen(!this.open);
      }
    });
  }

  setOpen(o: boolean): void {
    this.open = o;
    this.panel.classList.toggle("open", o);
    if (o) this.render();
  }

  private render(): void {
    this.panel.innerHTML = "";
    this.panel.appendChild(el("h3", "", "🎛️ Tuning"));
    this.panel.appendChild(
      el("div", "dim", "Every constant, live. Edits apply immediately and re-roll the morning on the planning screen."),
    );
    const btns = el("div", "btn-row");
    const copy = el("button", "btn-gold btn-small", "🔗 Copy tuning link");
    copy.addEventListener("click", async () => {
      const link = this.game.copyTuningLink();
      try {
        await navigator.clipboard.writeText(link);
        copy.textContent = "✅ Copied!";
      } catch {
        if (typeof prompt !== "undefined") prompt("Copy this link:", link);
        else copy.textContent = "⚠️ Copy blocked";
      }
      setTimeout(() => (copy.textContent = "🔗 Copy tuning link"), 1500);
    });
    const reset = el("button", "btn-gold btn-small", "↩ Reset defaults");
    reset.addEventListener("click", () => {
      this.game.resetTuning();
      this.render();
    });
    btns.append(copy, reset);
    this.panel.appendChild(btns);
    this.renderNode(this.game.tuning, "", this.panel);
  }

  private renderNode(obj: unknown, path: string, parent: HTMLElement): void {
    if (typeof obj === "number") {
      this.renderNumber(obj, path, parent);
      return;
    }
    if (typeof obj === "string" || typeof obj === "boolean") {
      const row = el("div", "trow");
      row.appendChild(el("label", "", esc(labelOf(path))));
      const inp = el("input") as HTMLInputElement;
      if (typeof obj === "boolean") {
        inp.type = "checkbox";
        inp.checked = obj;
        inp.addEventListener("change", () => this.game.retune(path, inp.checked));
      } else {
        inp.type = "text";
        inp.value = obj;
        inp.addEventListener("change", () => this.game.retune(path, inp.value));
      }
      row.appendChild(inp);
      parent.appendChild(row);
      return;
    }
    if (Array.isArray(obj)) {
      const fs = el("fieldset");
      fs.appendChild(el("legend", "", esc(labelOf(path) || "list")));
      obj.forEach((v, i) => this.renderNode(v, `${path}.${i}`, fs));
      parent.appendChild(fs);
      return;
    }
    if (obj && typeof obj === "object") {
      const fs = el("fieldset");
      if (path) fs.appendChild(el("legend", "", esc(labelOf(path))));
      for (const k of Object.keys(obj as Record<string, unknown>)) {
        this.renderNode((obj as Record<string, unknown>)[k], path ? `${path}.${k}` : k, fs);
      }
      parent.appendChild(fs);
      return;
    }
  }

  private renderNumber(v: number, path: string, parent: HTMLElement): void {
    const row = el("div", "trow");
    row.appendChild(el("label", "", esc(labelOf(path))));
    const slider = el("input") as HTMLInputElement;
    slider.type = "range";
    const lo = v >= 0 ? 0 : v * 2;
    const hi = v >= 0 ? Math.max(1, v * 2) : 0;
    slider.min = String(lo);
    slider.max = String(hi);
    slider.step = String(Math.max((hi - lo) / 200, 0.001));
    slider.value = String(v);
    const num = el("input") as HTMLInputElement;
    num.type = "number";
    num.step = "any";
    num.value = String(v);
    const commit = (raw: string) => {
      const n = Number(raw);
      if (isNaN(n)) return;
      this.game.retune(path, n);
      slider.value = String(n);
      num.value = String(n);
    };
    slider.addEventListener("change", () => commit(slider.value));
    num.addEventListener("change", () => commit(num.value));
    row.append(slider, num);
    parent.appendChild(row);
  }
}

function labelOf(path: string): string {
  const last = path.split(".").pop() ?? path;
  return last.replace(/([A-Z])/g, " $1").replace(/_/g, " ");
}
