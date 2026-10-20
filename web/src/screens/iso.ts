/**
 * Isometric street scene for the day view (M2).
 *
 * Canvas 2D, fully procedural — no image assets. Chunky 2002-homage look:
 * logical 480x270, CSS-upscaled with pixelated rendering. All drawing uses
 * the same dark-green/gold/red palette as the DOM UI.
 *
 * The scene owns a set of customer agents. The day view drives it with
 * per-tick telemetry: beginDay(seed) then applyTick(tick, onComplaint).
 * An internal rAF loop animates walking, bobbing, steam and served/angry
 * reactions; it keeps running even when tick playback is paused.
 */
import type { TickSummary } from "../../../src/sim/types.js";
import { mulberry32 } from "../../../src/rng.js";

// ---------- palette ----------
const INK = "#20301f";
const SIDE_A = "#cfc4a8";
const SIDE_B = "#c4b898";
const ROAD = "#54555e";
const ROAD_LINE = "#e8e4da";
const CART_RED = "#b3392e";
const CART_DARK = "#7e241d";
const CART_LIGHT = "#d4695e";
const CREAM = "#f5f0e6";
const GOLD = "#d8a93f";
const GOLD_DARK = "#9a7426";

const SKINS = ["#f1c9a5", "#e0ac82", "#c98d5f", "#8d5a3b", "#6b4226"];
const SHIRTS = ["#3f6fb5", "#c94f4f", "#4fae62", "#e0a83c", "#8a5fc0", "#e8e6df", "#2f9e8f", "#d4695e"];
const HAIRS = ["#202020", "#4a3220", "#8a8a8a", "#d8cfc0"];
const PANTS = "#2c3242";

// ---------- iso projection ----------
const TW = 32; // tile width px
const TH = 16; // tile height px
const OX = 210; // screen origin x
const OY = 30; // screen origin y

export const ISO_W = 480;
export const ISO_H = 270;

function sx(x: number, y: number): number {
  return OX + (x - y) * (TW / 2);
}
function sy(x: number, y: number, z = 0): number {
  return OY + (x + y) * (TH / 2) - z;
}

// ---------- world layout ----------
const CART = { x: 3.2, y: 5.2 };
const SPAWN = { x: 14.6, y: 9.2 };
const SERVED_EXIT = { x: 14.8, y: 5.2 };
const ANGRY_EXIT = { x: 7.2, y: 11.6 };

function slotPos(i: number): { x: number; y: number } {
  if (i < 6) return { x: 5.7 + i * 0.95, y: 5.2 };
  const k = i - 5;
  // crowd compresses past slot 11
  const yy = Math.min(5.2 + k * 0.95, 10.2);
  const jx = i > 11 ? ((i * 37) % 10) / 10 - 0.5 : 0;
  return { x: 10.45 + jx * 0.5, y: yy };
}

type AgentState = "walk-in" | "queue" | "served" | "angry" | "leaving";

interface Agent {
  id: number;
  wx: number;
  wy: number;
  slot: number;
  state: AgentState;
  exitX: number;
  exitY: number;
  shirt: string;
  skin: string;
  hair: string;
  phase: number;
  moodT: number; // anim timer for served/angry
  cause: string | null;
  speed: number;
}

interface Puff {
  x: number;
  y: number;
  vy: number;
  r: number;
  life: number;
  maxLife: number;
}

export type ComplaintCause = "price" | "wait" | "stockout";

export class IsoScene {
  private ctx: CanvasRenderingContext2D;
  private rng: () => number = mulberry32(1);
  private agents: Agent[] = [];
  private puffs: Puff[] = [];
  private nextId = 1;
  private hour = 10;
  private time = 0;
  private lastFrame = 0;
  private raf = 0;
  private running = false;

  constructor(private canvas: HTMLCanvasElement) {
    canvas.width = ISO_W;
    canvas.height = ISO_H;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }

  /** Screen coords (logical px) for a world point — used to place DOM bubbles. */
  toScreen(x: number, y: number, z = 0): { x: number; y: number } {
    return { x: sx(x, y), y: sy(x, y, z) };
  }

  beginDay(seed: number): void {
    this.rng = mulberry32(seed >>> 0);
    this.agents = [];
    this.puffs = [];
    this.nextId = 1;
    this.hour = 10;
  }

  setHour(h: number): void {
    this.hour = h;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      const dt = Math.min(0.05, (now - this.lastFrame) / 1000);
      this.lastFrame = now;
      this.time += dt;
      this.update(dt);
      this.render();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  // ---------- tick reconciliation ----------
  applyTick(t: TickSummary, onComplaint: (x: number, y: number, cause: ComplaintCause) => void): void {
    const queuing = () => this.agents.filter((a) => a.state === "walk-in" || a.state === "queue");

    // arrivals walk in from the east
    const before = queuing().length;
    for (let k = 0; k < t.arrivals; k++) {
      const r = this.rng;
      this.agents.push({
        id: this.nextId++,
        wx: SPAWN.x + r() * 0.6,
        wy: SPAWN.y + (r() - 0.5) * 0.8,
        slot: before + k,
        state: "walk-in",
        exitX: 0,
        exitY: 0,
        shirt: SHIRTS[Math.floor(r() * SHIRTS.length)],
        skin: SKINS[Math.floor(r() * SKINS.length)],
        hair: HAIRS[Math.floor(r() * HAIRS.length)],
        phase: r() * Math.PI * 2,
        moodT: 0,
        cause: null,
        speed: 2.6 + r() * 1.2,
      });
    }

    // the front of the queue is served / storms off
    const front = queuing().sort((a, b) => a.slot - b.slot);
    let fi = 0;
    const take = (n: number): Agent[] => {
      const out = front.slice(fi, fi + n);
      fi += out.length;
      return out;
    };
    for (const a of take(t.served)) {
      a.state = "served";
      a.moodT = 0.9;
      a.exitX = SERVED_EXIT.x;
      a.exitY = SERVED_EXIT.y;
    }
    const angry: [Agent, ComplaintCause][] = [];
    for (const a of take(t.missedPrice)) angry.push([a, "price"]);
    for (const a of take(t.missedWait)) angry.push([a, "wait"]);
    for (const a of take(t.stockouts)) angry.push([a, "stockout"]);
    for (const [a, cause] of angry) {
      a.state = "angry";
      a.moodT = 1.4;
      a.cause = cause;
      a.exitX = ANGRY_EXIT.x + (this.rng() - 0.5);
      a.exitY = ANGRY_EXIT.y;
      const p = this.toScreen(a.wx, a.wy, 26);
      onComplaint(p.x, p.y, cause);
    }

    // compress the remaining queue into slots 0..n
    const rest = queuing().sort((a, b) => a.slot - b.slot);
    rest.forEach((a, i) => {
      a.slot = i;
      if (a.state === "walk-in" && i < 12) a.state = "queue";
    });
  }

  queueCount(): number {
    return this.agents.filter((a) => a.state === "walk-in" || a.state === "queue").length;
  }

  // ---------- animation ----------
  private update(dt: number): void {
    // steam over the grill
    if (this.rng() < 0.85) {
      const g = this.toScreen(CART.x + 0.3, CART.y - 0.2, 34);
      this.puffs.push({
        x: g.x + (this.rng() - 0.5) * 10,
        y: g.y,
        vy: -16 - this.rng() * 12,
        r: 3 + this.rng() * 3,
        life: 0,
        maxLife: 1.2 + this.rng() * 0.6,
      });
    }
    for (const p of this.puffs) {
      p.life += dt;
      p.y += p.vy * dt;
      p.r += dt * 3;
    }
    this.puffs = this.puffs.filter((p) => p.life < p.maxLife);

    for (const a of this.agents) {
      let tx = a.wx;
      let ty = a.wy;
      if (a.state === "walk-in" || a.state === "queue") {
        const s = slotPos(a.slot);
        tx = s.x;
        ty = s.y;
      } else if (a.state === "served" || a.state === "angry") {
        a.moodT -= dt;
        if (a.moodT <= 0) {
          a.state = "leaving";
        }
      } else if (a.state === "leaving") {
        tx = a.exitX;
        ty = a.exitY;
      }
      const dx = tx - a.wx;
      const dy = ty - a.wy;
      const d = Math.hypot(dx, dy);
      if (d > 0.02) {
        const step = Math.min(d, a.speed * dt * (a.state === "leaving" ? 1.6 : 1));
        a.wx += (dx / d) * step;
        a.wy += (dy / d) * step;
        a.phase += dt * 10;
      }
    }
    // drop agents that reached their exit
    this.agents = this.agents.filter((a) => {
      if (a.state !== "leaving") return true;
      return Math.hypot(a.exitX - a.wx, a.exitY - a.wy) > 0.4;
    });
  }

  // ---------- drawing ----------
  private render(): void {
    const c = this.ctx;
    // sky
    const sky = c.createLinearGradient(0, 0, 0, 110);
    sky.addColorStop(0, "#8fbde0");
    sky.addColorStop(1, "#d9ecf6");
    c.fillStyle = sky;
    c.fillRect(0, 0, ISO_W, 110);

    this.drawBuildings(c);
    this.drawGround(c);
    this.drawCart(c);

    // agents painter-sorted by depth
    const sorted = [...this.agents].sort((a, b) => a.wx + a.wy - (b.wx + b.wy));
    for (const a of sorted) this.drawPerson(c, a);

    this.drawPuffs(c);
    this.drawLight(c);
  }

  private tile(c: CanvasRenderingContext2D, x: number, y: number, color: string): void {
    const cx = sx(x, y);
    const cy = sy(x, y);
    c.fillStyle = color;
    c.beginPath();
    c.moveTo(cx, cy - TH / 2);
    c.lineTo(cx + TW / 2, cy);
    c.lineTo(cx, cy + TH / 2);
    c.lineTo(cx - TW / 2, cy);
    c.closePath();
    c.fill();
  }

  private drawGround(c: CanvasRenderingContext2D): void {
    // sidewalk field
    for (let x = 0; x < 15; x++) {
      for (let y = 0; y < 11; y++) {
        // road band along the south edge
        if (y >= 9) {
          this.tile(c, x + 0.5, y + 0.5, ROAD);
        } else {
          this.tile(c, x + 0.5, y + 0.5, (x + y) % 2 === 0 ? SIDE_A : SIDE_B);
        }
      }
    }
    // road dashes
    c.fillStyle = ROAD_LINE;
    for (let x = 0; x < 15; x += 2) {
      const p = this.toScreen(x + 0.9, 10, 0);
      c.fillRect(p.x - 6, p.y - 1, 12, 2);
    }
    // curb line
    const c0 = this.toScreen(0, 9, 0);
    const c1 = this.toScreen(15, 9, 0);
    c.strokeStyle = "#3d3d45";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(c0.x, c0.y - TH / 2);
    c.lineTo(c1.x, c1.y - TH / 2);
    c.stroke();
  }

  private drawBuildings(c: CanvasRenderingContext2D): void {
    // back-alley facades along the north edge
    const facades = [
      { x: 0, w: 150, h: 78, col: "#7d8a99" },
      { x: 150, w: 110, h: 96, col: "#6b7686" },
      { x: 260, w: 130, h: 70, col: "#87919f" },
      { x: 390, w: 90, h: 88, col: "#707b8a" },
    ];
    for (const f of facades) {
      c.fillStyle = f.col;
      c.fillRect(f.x, 110 - f.h, f.w, f.h);
      c.fillStyle = "rgba(0,0,0,0.18)";
      c.fillRect(f.x, 110 - f.h, f.w, 4);
      // windows
      c.fillStyle = "#f7d774";
      for (let wx = f.x + 10; wx < f.x + f.w - 14; wx += 24) {
        for (let wy = 110 - f.h + 12; wy < 100; wy += 22) {
          c.fillRect(wx, wy, 12, 14);
        }
      }
    }
  }

  private isoBox(
    c: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    d: number,
    h: number,
    top: string,
    left: string,
    right: string,
  ): void {
    // footprint corners in screen space
    const p000 = this.toScreen(x, y, 0);
    const p100 = this.toScreen(x + w, y, 0);
    const p010 = this.toScreen(x, y + d, 0);
    const p110 = this.toScreen(x + w, y + d, 0);
    const up = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - h });
    // left face (x..x+w edge at y+d)
    c.fillStyle = left;
    c.beginPath();
    c.moveTo(p010.x, p010.y);
    c.lineTo(p110.x, p110.y);
    c.lineTo(up(p110).x, up(p110).y);
    c.lineTo(up(p010).x, up(p010).y);
    c.closePath();
    c.fill();
    // right face (y..y+d edge at x+w)
    c.fillStyle = right;
    c.beginPath();
    c.moveTo(p100.x, p100.y);
    c.lineTo(p110.x, p110.y);
    c.lineTo(up(p110).x, up(p110).y);
    c.lineTo(up(p100).x, up(p100).y);
    c.closePath();
    c.fill();
    // top face
    c.fillStyle = top;
    c.beginPath();
    c.moveTo(up(p000).x, up(p000).y);
    c.lineTo(up(p100).x, up(p100).y);
    c.lineTo(up(p110).x, up(p110).y);
    c.lineTo(up(p010).x, up(p010).y);
    c.closePath();
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 1;
    c.stroke();
  }

  private drawCart(c: CanvasRenderingContext2D): void {
    const { x, y } = CART;
    // drop shadow
    const sh = this.toScreen(x + 1.1, y + 0.8, 0);
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.beginPath();
    c.ellipse(sh.x, sh.y, 44, 14, 0, 0, Math.PI * 2);
    c.fill();

    // body
    this.isoBox(c, x, y, 2.2, 1.5, 26, CART_RED, CART_DARK, CART_LIGHT);
    // white stripe on the body faces
    const s0 = this.toScreen(x, y + 1.5, 14);
    const s1 = this.toScreen(x + 2.2, y + 1.5, 14);
    c.strokeStyle = CREAM;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(s0.x, s0.y);
    c.lineTo(s1.x, s1.y);
    c.stroke();
    const s2 = this.toScreen(x + 2.2, y, 14);
    const s3 = this.toScreen(x + 2.2, y + 1.5, 14);
    c.beginPath();
    c.moveTo(s2.x, s2.y);
    c.lineTo(s3.x, s3.y);
    c.stroke();

    // grill on top (dark box + gold rim)
    this.isoBox(c, x + 0.25, y + 0.25, 1.1, 0.8, 8, "#3a3a40", "#26262b", "#4a4a52");
    const g = this.toScreen(x + 0.8, y + 0.65, 36);
    c.fillStyle = "#ff9a3c";
    c.fillRect(g.x - 8, g.y - 2, 16, 3); // heat glow

    // umbrella pole + striped canopy
    const poleB = this.toScreen(x + 1.1, y + 0.75, 26);
    const apex = this.toScreen(x + 1.1, y + 0.75, 74);
    c.strokeStyle = "#5a4632";
    c.lineWidth = 3;
    c.beginPath();
    c.moveTo(poleB.x, poleB.y);
    c.lineTo(apex.x, apex.y);
    c.stroke();
    // canopy: striped gores apex->rim
    const rimR = 52;
    const rimY = apex.y + 26;
    for (let i = 0; i < 12; i++) {
      const a0 = (i / 12) * Math.PI * 2;
      const a1 = ((i + 1) / 12) * Math.PI * 2;
      c.fillStyle = i % 2 === 0 ? CART_RED : CREAM;
      c.beginPath();
      c.moveTo(apex.x, apex.y);
      c.lineTo(apex.x + Math.cos(a0) * rimR, rimY + Math.sin(a0) * rimR * 0.32);
      c.lineTo(apex.x + Math.cos(a1) * rimR, rimY + Math.sin(a1) * rimR * 0.32);
      c.closePath();
      c.fill();
    }
    c.strokeStyle = INK;
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(apex.x, rimY, rimR, rimR * 0.32, 0, 0, Math.PI * 2);
    c.stroke();

    // menu sign
    const sign = this.toScreen(x + 2.45, y + 0.2, 0);
    c.strokeStyle = "#5a4632";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(sign.x, sign.y);
    c.lineTo(sign.x, sign.y - 26);
    c.stroke();
    c.fillStyle = INK;
    c.fillRect(sign.x - 16, sign.y - 44, 34, 20);
    c.fillStyle = GOLD;
    c.fillRect(sign.x - 14, sign.y - 42, 30, 16);
    c.fillStyle = INK;
    c.font = "bold 8px monospace";
    c.textAlign = "center";
    c.fillText("HALAL", sign.x + 1, sign.y - 30);
  }

  private drawPerson(c: CanvasRenderingContext2D, a: Agent): void {
    const p = this.toScreen(a.wx, a.wy, 0);
    let hop = 0;
    let jx = 0;
    if (a.state === "served") {
      hop = Math.abs(Math.sin(a.moodT * 10)) * 5; // happy bounce
    } else if (a.state === "angry") {
      jx = Math.sin(a.moodT * 30) * 1.5; // grumble shake
    }
    const bob = Math.abs(Math.sin(a.phase)) * 1.5;
    const x = Math.round(p.x + jx);
    const y = Math.round(p.y - hop - (a.state === "walk-in" || a.state === "leaving" ? bob : bob * 0.4));

    // shadow
    c.fillStyle = "rgba(0,0,0,0.25)";
    c.beginPath();
    c.ellipse(p.x, p.y + 1, 6, 2.5, 0, 0, Math.PI * 2);
    c.fill();

    // legs
    c.fillStyle = PANTS;
    c.fillRect(x - 3, y - 7, 2.5, 7);
    c.fillRect(x + 1, y - 7, 2.5, 7);
    // torso
    c.fillStyle = INK;
    c.fillRect(x - 5, y - 17, 10, 11);
    c.fillStyle = a.shirt;
    c.fillRect(x - 4, y - 16, 8, 9);
    // head
    c.fillStyle = INK;
    c.fillRect(x - 4, y - 25, 8, 8);
    c.fillStyle = a.skin;
    c.fillRect(x - 3, y - 24, 6, 6);
    // hair cap
    c.fillStyle = a.hair;
    c.fillRect(x - 3, y - 24, 6, 2.5);
    // served: little platter held up
    if (a.state === "served") {
      c.fillStyle = CREAM;
      c.fillRect(x + 3, y - 22, 7, 4);
      c.fillStyle = GOLD_DARK;
      c.fillRect(x + 3, y - 22, 7, 1);
    }
    // angry: red tick above head
    if (a.state === "angry") {
      c.fillStyle = "#c0392b";
      c.fillRect(x + 4, y - 30, 2, 6);
      c.fillRect(x + 2, y - 32, 6, 2);
    }
  }

  private drawPuffs(c: CanvasRenderingContext2D): void {
    for (const p of this.puffs) {
      const a = 1 - p.life / p.maxLife;
      c.fillStyle = `rgba(245,245,245,${(a * 0.7).toFixed(2)})`;
      c.beginPath();
      c.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      c.fill();
    }
  }

  private drawLight(c: CanvasRenderingContext2D): void {
    // time-of-day tint: cool morning, neutral midday, warm afternoon
    const h = this.hour;
    let col = "rgba(255,255,255,0)";
    if (h < 11.5) col = "rgba(150,180,230,0.10)";
    else if (h > 14.5) col = "rgba(255,150,70,0.14)";
    else if (h > 13) col = "rgba(255,190,120,0.06)";
    if (col !== "rgba(255,255,255,0)") {
      c.fillStyle = col;
      c.fillRect(0, 0, ISO_W, ISO_H);
    }
  }
}
