import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { changeRate, dominantColor, probeFrame, profilePeriod } from "../../src/ascii/probe.ts";

type RGB = [number, number, number];

/** A w by h raster filled with `bg`. */
function raster(w: number, h: number, bg: RGB): Uint8Array {
  const a = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    a[i * 4] = bg[0];
    a[i * 4 + 1] = bg[1];
    a[i * 4 + 2] = bg[2];
    a[i * 4 + 3] = 255;
  }
  return a;
}

function put(a: Uint8Array, w: number, x: number, y: number, c: RGB): void {
  const i = (y * w + x) * 4;
  a[i] = c[0];
  a[i + 1] = c[1];
  a[i + 2] = c[2];
}

/** A pseudo-random number in 0 to 1 from a cell position, so the pictures are the same on every run. */
const rnd = (a: number, b: number, s = 0): number => {
  const x = Math.sin(a * 127.1 + b * 311.7 + s * 74.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * A grid of `cols` by `rows` cells of `cw` by `ch` pixels after a padding of `pad`, every cell with a mark when `fill(col, row)`.
 * `kind` "dot" draws a centred disc of a size that varies by cell; "text" draws an L or a 7, which are not mirror-symmetric.
 */
function grid(o: { cols: number; rows: number; cw: number; ch: number; pad: number; kind: "dot" | "text"; colors: RGB[]; bg: RGB; fill?: (c: number, r: number) => boolean }): { a: Uint8Array; w: number; h: number } {
  const w = o.cols * o.cw + 2 * o.pad;
  const h = o.rows * o.ch + 2 * o.pad;
  const a = raster(w, h, o.bg);
  for (let r = 0; r < o.rows; r++) {
    for (let c = 0; c < o.cols; c++) {
      if (o.fill && !o.fill(c, r)) continue;
      const colour = o.colors[Math.floor(rnd(c, r, 1) * o.colors.length)] as RGB;
      const x0 = o.pad + c * o.cw;
      const y0 = o.pad + r * o.ch;
      if (o.kind === "dot") {
        const size = 0.25 + 0.7 * rnd(c, r, 2);
        const rad = (size * Math.min(o.cw, o.ch)) / 2;
        for (let y = 0; y < o.ch; y++) for (let x = 0; x < o.cw; x++) if (Math.hypot(x + 0.5 - o.cw / 2, y + 0.5 - o.ch / 2) <= rad) put(a, w, x0 + x, y0 + y, colour);
      } else {
        const seven = rnd(c, r, 3) < 0.5;
        const left = Math.round(o.cw * 0.3);
        const right = Math.round(o.cw * 0.65);
        const top = Math.round(o.ch * 0.25);
        const bottom = Math.round(o.ch * 0.8);
        for (let y = top; y < bottom; y++) put(a, w, x0 + (seven ? right : left), y0 + y, colour);
        for (let x = left; x <= right; x++) put(a, w, x0 + x, y0 + (seven ? top : bottom - 1), colour);
      }
    }
  }
  return { a, w, h };
}

const BG: RGB = [11, 15, 25];
const GREEN: RGB = [124, 179, 66];
const PINK: RGB = [244, 143, 177];
const WHITE: RGB = [245, 245, 245];

test("profilePeriod finds the period of a comb to a fraction of a pixel, and none in a flat or single-bump profile", () => {
  const comb = Array.from({ length: 1000 }, (_, x) => (x % 7.3 < 3 ? 10 : 0));
  const p = profilePeriod(comb);
  assert.ok(p);
  assert.ok(Math.abs(p.period - 7.3) < 0.05, `period ${p.period}`);
  assert.equal(profilePeriod(new Array<number>(500).fill(3)), null);
  assert.equal(profilePeriod(Array.from({ length: 500 }, (_, x) => (x > 200 && x < 260 ? 50 : 0))), null);
});

test("a dense grid of characters: pitch, cols and rows, background, colours, text", () => {
  const g = grid({ cols: 60, rows: 20, cw: 10, ch: 20, pad: 8, kind: "text", colors: [GREEN, PINK, WHITE], bg: BG });
  const p = probeFrame(g.a, g.w, g.h);
  assert.ok(p.pitch);
  assert.ok(Math.abs(p.pitch.x - 10) < 0.1 && Math.abs(p.pitch.y - 20) < 0.2, JSON.stringify(p.pitch));
  assert.equal(p.cols, 61);
  assert.equal(p.rows, 20);
  assert.ok(Math.abs((p.cellAspect ?? 0) - 2) < 0.03);
  assert.equal(p.background, "#0b0f19");
  assert.equal(p.gradient, null);
  assert.equal(p.glyph, "text");
  assert.deepEqual(p.colors.map((c) => c.hex).sort(), ["#7cb342", "#f48fb1", "#f5f5f5"]);
  assert.ok(Math.abs(p.colors.reduce((s, c) => s + c.share, 0) - 1) < 0.02);
  assert.equal(p.note, null);
});

test("a grid of dots of different sizes on square cells reads as dot", () => {
  const g = grid({ cols: 40, rows: 40, cw: 12, ch: 12, pad: 6, kind: "dot", colors: [PINK], bg: [0, 0, 0] });
  const p = probeFrame(g.a, g.w, g.h);
  assert.ok(p.pitch);
  assert.ok(Math.abs(p.pitch.x - 12) < 0.1 && Math.abs(p.pitch.y - 12) < 0.1, JSON.stringify(p.pitch));
  assert.equal(p.cellAspect, 1);
  assert.equal(p.glyph, "dot");
  assert.equal(p.colors[0]?.hex, "#f48fb1");
});

test("cells smaller than 8 pixels: the grid is found and glyph is null with a note", () => {
  const g = grid({ cols: 150, rows: 60, cw: 5, ch: 10, pad: 4, kind: "text", colors: [WHITE], bg: BG });
  const p = probeFrame(g.a, g.w, g.h);
  assert.ok(p.pitch);
  assert.ok(Math.abs(p.pitch.x - 5) < 0.05, JSON.stringify(p.pitch));
  assert.equal(p.glyph, null);
  assert.match(p.note ?? "", /too small/);
});

test("a sparse frame (a few marks) and a picture with no grid give no pitch, with a note that says what to do", () => {
  const sparse = grid({ cols: 40, rows: 15, cw: 10, ch: 20, pad: 8, kind: "text", colors: [WHITE], bg: BG, fill: (c, r) => rnd(c, r, 9) < 0.02 });
  const p = probeFrame(sparse.a, sparse.w, sparse.h);
  assert.equal(p.pitch, null);
  assert.equal(p.cols, null);
  assert.match(p.note ?? "", /--time|enlarged crop/);
  // A smooth picture: a disc on a background.
  const w = 300;
  const h = 200;
  const disc = raster(w, h, BG);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (Math.hypot(x - 150, y - 100) < 70) put(disc, w, x, y, PINK);
  const q = probeFrame(disc, w, h);
  assert.equal(q.pitch, null);
  assert.equal(q.background, "#0b0f19");
});

test("a gradient behind the grid is reported, and is not mistaken for ink", () => {
  const g = grid({ cols: 50, rows: 15, cw: 10, ch: 20, pad: 8, kind: "text", colors: [WHITE], bg: BG, fill: (c, r) => rnd(c, r, 4) < 0.6 });
  // Repaint the background as a vertical gradient from dark blue to purple, keeping the marks.
  const from: RGB = [10, 20, 60];
  const to: RGB = [90, 30, 110];
  for (let y = 0; y < g.h; y++) {
    const t = y / (g.h - 1);
    for (let x = 0; x < g.w; x++) {
      const i = (y * g.w + x) * 4;
      if (g.a[i] === BG[0] && g.a[i + 1] === BG[1] && g.a[i + 2] === BG[2]) put(g.a, g.w, x, y, [from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t, from[2] + (to[2] - from[2]) * t]);
    }
  }
  const p = probeFrame(g.a, g.w, g.h);
  assert.ok(p.gradient);
  assert.equal(p.gradient.angle, 180);
  assert.ok(p.pitch);
  assert.ok(Math.abs(p.pitch.x - 10) < 0.1, JSON.stringify(p.pitch));
  assert.equal(p.colors[0]?.hex, "#f5f5f5");
});

test("dominantColor is the most common colour", () => {
  const a = raster(10, 10, [200, 0, 0]);
  for (let x = 0; x < 10; x++) put(a, 10, x, 0, [0, 0, 255]);
  assert.deepEqual(dominantColor(a, 10, 10), [200, 0, 0]);
});

test("changeRate counts the steps where the picture changes, per second", () => {
  const still = raster(20, 10, BG);
  const moved = raster(20, 10, BG);
  for (let y = 0; y < 10; y++) put(moved, 20, 3, y, WHITE);
  // 30 fps frames of a 10 fps animation: a change every third step.
  const frames: Uint8Array[] = [];
  for (let i = 0; i < 31; i++) frames.push(Math.floor(i / 3) % 2 === 0 ? still : moved);
  assert.equal(changeRate(frames, 30), 10);
  assert.equal(changeRate([still, still, still], 30), 0);
  assert.equal(changeRate([still], 30), null);
});

test("probe.ts has no file or process access", () => {
  const src = readFileSync(new URL("../../src/ascii/probe.ts", import.meta.url), "utf8");
  assert.doesNotMatch(src, /from "node:/);
  assert.doesNotMatch(src, /process\./);
});
