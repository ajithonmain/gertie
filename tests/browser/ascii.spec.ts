import { test, expect, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { parseAscii } from "../../src/ascii/parse.ts";
import { emitAsciiSvg, svgProblems } from "../../src/ascii/svg.ts";
import { NAMED_RAMPS } from "../../src/ascii/convert.ts";
import { canvasSize, cellHeight, cellWidth, frameAt, padding, totalFrames, type NAscii } from "../../src/ascii/types.ts";
import { root } from "./helpers.ts";

// These tests use the browser of the Playwright project they run in: Chromium, Firefox or WebKit.
// Acceptance for phase 8: the grid stays aligned in all three, an ASCII SVG plays as an image (as in a README),
// and every frame is shown at exactly its own time.

const renderPage = pathToFileURL(join(root, "skills/gertie/assets/render.html")).href;

function scene(raw: object): NAscii {
  const r = parseAscii({ ascii: 1, ...raw });
  if (!r.scene) throw new Error(JSON.stringify(r.diagnostics));
  return r.scene;
}

type Win = { loadSvg(text: string, fps: number): Promise<unknown>; seek(frame: number): void };

async function openInRenderer(page: Page, s: NAscii): Promise<void> {
  const { w, h } = canvasSize(s);
  await page.setViewportSize({ width: w, height: h });
  await page.goto(renderPage);
  await page.evaluate((a) => (globalThis as unknown as Win).loadSvg(a.svg, a.fps), { svg: emitAsciiSvg(s), fps: s.fps });
}

test("the grid stays aligned: every character starts at its own cell, whatever its width", async ({ page }) => {
  const s = scene({
    cols: 24,
    fps: 4,
    frames: [
      {
        text: ["iiiiiiiiiiiiiiiiiiiiiiii", "WWWWWWWWWWWWWWWWWWWWWWWW", "i W i W i W i W i W i W ", ".:-=+*#%@.:-=+*#%@.:-=+*", "||||||||||||||||||||||||", "MMMMMMMMiiiiiiii........"],
        colors: [null, ["#ff0000", "#ff0000", "#00ff00"], null, null, null, ["#3366ff", "#3366ff", "#3366ff", "#3366ff", "#3366ff", "#3366ff", "#3366ff", "#3366ff", "#ffcc00"]],
      },
    ],
  });
  const svg = emitAsciiSvg(s);
  expect(svgProblems(svg)).toEqual([]);
  await page.setContent(`<!doctype html><body style="margin:0;background:#000">${svg}</body>`);
  const cell = cellWidth(s);
  const result = await page.evaluate(() => {
    type TextEl = SVGTextContentElement;
    const out: { text: string; x: number; textLength: number; computed: number; starts: number[]; widths: number[] }[] = [];
    for (const el of Array.from(document.querySelectorAll("text")) as TextEl[]) {
      const n = el.getNumberOfChars();
      const starts: number[] = [];
      const widths: number[] = [];
      for (let k = 0; k < n; k++) {
        starts.push(el.getStartPositionOfChar(k).x);
        widths.push(el.getExtentOfChar(k).width);
      }
      out.push({ text: el.textContent ?? "", x: Number(el.getAttribute("x")), textLength: Number(el.getAttribute("textLength")), computed: el.getComputedTextLength(), starts, widths });
    }
    return out;
  });
  expect(result.length).toBeGreaterThanOrEqual(6);
  for (const r of result) {
    const n = [...r.text].length;
    expect(r.textLength, r.text).toBe(n * cell);
    // the run as a whole is exactly as long as its cells
    expect(Math.abs(r.computed - n * cell), `${r.text}: length ${r.computed} vs ${n * cell}`).toBeLessThanOrEqual(1);
    // and every character starts at its own cell
    r.starts.forEach((x, k) => expect(Math.abs(x - (r.x + k * cell)), `${r.text}[${k}] starts at ${x}, want ${r.x + k * cell}`).toBeLessThanOrEqual(1.5));
  }
});

test("each frame is shown at exactly its own time, at awkward frame rates and with holds", async ({ page }) => {
  const rates = [5, 7, 8, 12, 24, 30];
  for (const fps of rates) {
    // a deterministic mix of holds, with a total that is not a friendly number
    const holds = Array.from({ length: 11 }, (_, i) => 1 + ((i * 7 + fps) % 3));
    const s = scene({ fps, loop: true, frames: holds.map((hold, i) => ({ text: [`F${i}`], hold })) });
    await openInRenderer(page, s);
    const total = totalFrames(s);
    for (let n = 0; n < total; n++) {
      for (const at of [n, n + 0.5]) {
        await page.evaluate((f) => (globalThis as unknown as Win).seek(f), at);
        const visible = await page.evaluate(() => Array.from(document.querySelectorAll("g.f")).map((g, i) => (getComputedStyle(g).visibility === "visible" ? i : -1)).filter((i) => i >= 0));
        expect(visible, `fps ${fps}, interval ${at} of ${total}`).toEqual([frameAt(s, n)]);
      }
    }
  }
});

test("a looping animation wraps, a non-looping one holds its last frame", async ({ page }) => {
  const loop = scene({ fps: 8, frames: [{ text: ["a"] }, { text: ["b"] }, { text: ["c"] }] });
  await openInRenderer(page, loop);
  const visibleAt = async (f: number): Promise<number[]> => {
    await page.evaluate((x) => (globalThis as unknown as Win).seek(x), f);
    return page.evaluate(() => Array.from(document.querySelectorAll("g.f")).map((g, i) => (getComputedStyle(g).visibility === "visible" ? i : -1)).filter((i) => i >= 0));
  };
  expect(await visibleAt(3)).toEqual([0]);
  expect(await visibleAt(4)).toEqual([1]);
  expect(await visibleAt(8)).toEqual([2]);
  const once = scene({ fps: 8, loop: false, frames: [{ text: ["a"] }, { text: ["b"] }, { text: ["c"] }] });
  await openInRenderer(page, once);
  expect(await visibleAt(2)).toEqual([2]);
  expect(await visibleAt(3)).toEqual([2]);
  expect(await visibleAt(40)).toEqual([2]);
});

async function imgPage(page: Page, s: NAscii, dir: string): Promise<void> {
  const { w, h } = canvasSize(s);
  writeFileSync(join(dir, "anim.svg"), emitAsciiSvg(s));
  writeFileSync(join(dir, "index.html"), `<!doctype html><body style="margin:0;background:#fff"><img id="a" src="anim.svg" width="${w}" height="${h}" alt=""></body>`);
  await page.setViewportSize({ width: w, height: h });
  await page.goto(pathToFileURL(join(dir, "index.html")).href);
  await page.waitForFunction(() => (document.getElementById("a") as HTMLImageElement).complete);
}

const hash = (b: Buffer): string => createHash("sha1").update(b).digest("hex");

test("as an <img>, as in a README, the SVG plays; opened as a document under reduced motion it shows the first frame", async ({ page }) => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-img-"));
  try {
    const s = scene({ fps: 5, cols: 10, rows: 2, frames: [{ text: ["##########", "##########"] }, { text: ["..........", ".........."] }, { text: ["          ", "@@@@@@@@@@"] }] });
    expect(svgProblems(emitAsciiSvg(s))).toEqual([]);
    await imgPage(page, s, dir);
    const natural = await page.evaluate(() => ({ w: (document.getElementById("a") as HTMLImageElement).naturalWidth, h: (document.getElementById("a") as HTMLImageElement).naturalHeight }));
    expect(natural).toEqual(canvasSize(s));
    const seen = new Set<string>();
    for (let i = 0; i < 14; i++) {
      seen.add(hash(await page.screenshot()));
      await page.waitForTimeout(110);
    }
    expect(seen.size, "the three frames each appear").toBeGreaterThanOrEqual(3);

    // Observed in Chromium and WebKit: inside an <img> the browser does not pass the user's reduced-motion setting to the SVG, so it keeps playing.
    // Opened as a document, the setting applies and the SVG shows its first frame.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(pathToFileURL(join(dir, "anim.svg")).href);
    const still = new Set<string>();
    for (let i = 0; i < 6; i++) {
      still.add(hash(await page.screenshot()));
      await page.waitForTimeout(250);
    }
    expect(still.size, "one still frame under reduced motion, as a document").toBe(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the cell grid is as wide as the canvas says, in pixels", async ({ page }) => {
  const s = scene({ cols: 30, rows: 3, frames: [{ text: ["x".repeat(30), "", "y".repeat(30)] }] });
  await page.setContent(`<!doctype html><body style="margin:0">${emitAsciiSvg(s)}</body>`);
  const box = await page.evaluate(() => {
    const r = document.querySelector("svg")?.getBoundingClientRect();
    const t = Array.from(document.querySelectorAll("text")).map((e) => e.getBoundingClientRect());
    return { w: r?.width ?? 0, h: r?.height ?? 0, text: t.map((b) => ({ left: b.left, right: b.right })) };
  });
  expect(box.w).toBe(canvasSize(s).w);
  expect(box.h).toBe(canvasSize(s).h);
  for (const t of box.text) {
    expect(Math.abs(t.left - padding(s))).toBeLessThanOrEqual(1.5);
    expect(Math.abs(t.right - (padding(s) + 30 * cellWidth(s)))).toBeLessThanOrEqual(1.5);
  }
});

test("every character of every named ramp is one cell wide: its natural advance equals that of M", async ({ page }) => {
  const s = scene({ cols: 4, frames: [{ text: ["MMMM"] }] });
  await page.setContent(`<!doctype html><body style="margin:0">${emitAsciiSvg(s)}</body>`);
  const family = await page.evaluate(() => getComputedStyle(document.querySelector("svg") as SVGSVGElement).fontFamily);
  const ramps = Object.fromEntries(Object.entries(NAMED_RAMPS).map(([k, v]) => [k, [...v].filter((c) => c !== " ")]));
  // measure each character on its own, without textLength, at a large size so rounding does not hide a difference
  const wrong = await page.evaluate(
    ({ ramps, family }) => {
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      const t = document.createElementNS(ns, "text");
      t.setAttribute("font-family", family);
      t.setAttribute("font-size", "160");
      svg.appendChild(t);
      document.body.appendChild(svg);
      const width = (c: string): number => {
        t.textContent = c;
        return t.getComputedTextLength();
      };
      const ref = width("M");
      const bad: string[] = [];
      for (const [name, chars] of Object.entries(ramps)) for (const c of chars) if (Math.abs(width(c) / ref - 1) > 0.02) bad.push(`${name}: ${c} U+${(c.codePointAt(0) as number).toString(16)} is ${(width(c) / ref).toFixed(3)} cells`);
      return bad;
    },
    { ramps, family },
  );
  expect(wrong).toEqual([]);
});

// ------------------------------------------------------------------ cell styling (phase 8b, task 2)

type Px = [number, number, number, number];

/** Rasterises an SVG through an <img> and a canvas, and returns the RGBA at the given points. Single-frame scenes only: the SVG is read at its start. */
async function pixelsOf(page: Page, svg: string, w: number, h: number, pts: [number, number][]): Promise<Px[]> {
  await page.setContent("<!doctype html><body></body>");
  return page.evaluate(
    async (a) => {
      const img = new Image();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(a.svg);
      await img.decode();
      const c = document.createElement("canvas");
      c.width = a.w;
      c.height = a.h;
      const g = c.getContext("2d") as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0, a.w, a.h);
      return a.pts.map(([x, y]) => Array.from(g.getImageData(x, y, 1, 1).data) as Px);
    },
    { svg, w, h, pts },
  );
}

const near = (p: Px, rgb: [number, number, number], tol = 24): boolean => Math.abs(p[0] - rgb[0]) <= tol && Math.abs(p[1] - rgb[1]) <= tol && Math.abs(p[2] - rgb[2]) <= tol;
const BG: [number, number, number] = [0, 0, 0];
const RED: [number, number, number] = [255, 0, 0];

// Cells of 24 by 24 pixels and a padding of 20, so the centre of cell (c, r) is at 20 + 24c + 12, 20 + 24r + 12.
const big = { fontSize: 40, cellAspect: 1, background: "#000000", ramp: " .#" };
const centre = (c: number, r: number): [number, number] => [20 + 24 * c + 12, 20 + 24 * r + 12];

test("dots: a dot is a round shape whose size follows the ramp", async ({ page }) => {
  const s = scene({ cols: 2, rows: 1, style: { ...big, glyph: "dot", color: "#ff0000" }, frames: [{ text: ["#."] }] });
  const { w, h } = canvasSize(s);
  const [cx0, cy0] = centre(0, 0);
  const [cx1, cy1] = centre(1, 0);
  const p = await pixelsOf(page, emitAsciiSvg(s), w, h, [
    [cx0, cy0], // centre of the large dot
    [cx0 + 10, cy0], // inside its radius (11.4)
    [cx0 + 9, cy0 + 9], // inside the cell, outside the circle (distance 12.7)
    [cx1, cy1], // centre of the small dot
    [cx1 + 5, cy1], // outside the small dot (radius 3)
  ]);
  expect(near(p[0] as Px, RED)).toBe(true);
  expect(near(p[1] as Px, RED)).toBe(true);
  expect(near(p[2] as Px, BG)).toBe(true);
  expect(near(p[3] as Px, RED)).toBe(true);
  expect(near(p[4] as Px, BG)).toBe(true);
});

test("squares: a square fills the corners of its share of the cell that a dot leaves empty", async ({ page }) => {
  const s = scene({ cols: 2, rows: 1, style: { ...big, glyph: "square", color: "#ff0000" }, frames: [{ text: ["#."] }] });
  const { w, h } = canvasSize(s);
  const [cx0, cy0] = centre(0, 0);
  const [cx1, cy1] = centre(1, 0);
  const p = await pixelsOf(page, emitAsciiSvg(s), w, h, [
    [cx0 + 9, cy0 + 9], // the corner that the dot left empty
    [cx0 - 9, cy0 - 9],
    [cx0 + 11.9, cy0], // outside the 95 percent square (half side 11.4)
    [cx1 + 1, cy1 + 1], // small square, half side 3
    [cx1 + 5, cy1 + 5],
  ]);
  expect(near(p[0] as Px, RED)).toBe(true);
  expect(near(p[1] as Px, RED)).toBe(true);
  expect(near(p[2] as Px, BG, 120)).toBe(true);
  expect(near(p[3] as Px, RED)).toBe(true);
  expect(near(p[4] as Px, BG)).toBe(true);
});

test("cell backgrounds fill whole cells, merge across neighbours without a seam, and leave other cells alone", async ({ page }) => {
  const s = scene({ cols: 4, rows: 1, style: { fontSize: 40, cellAspect: 1, background: "#000000", color: "#ffffff" }, frames: [{ text: ["a b "], backgrounds: [["#204080", "#204080", null, "#802040"]] }] });
  const { w, h } = canvasSize(s);
  const y = 20 + 1;
  const p = await pixelsOf(page, emitAsciiSvg(s), w, h, [
    [20 + 1, y], // top-left corner of cell 0
    [20 + 24, y], // the seam between cells 0 and 1
    [20 + 24 + 23, y], // far corner of cell 1
    [20 + 48 + 1, y], // cell 2 has none
    [20 + 72 + 1, y], // cell 3 has another colour, behind a space
  ]);
  expect(near(p[0] as Px, [0x20, 0x40, 0x80])).toBe(true);
  expect(near(p[1] as Px, [0x20, 0x40, 0x80], 2), "no seam between merged cells").toBe(true);
  expect(near(p[2] as Px, [0x20, 0x40, 0x80])).toBe(true);
  expect(near(p[3] as Px, BG)).toBe(true);
  expect(near(p[4] as Px, [0x80, 0x20, 0x40])).toBe(true);
});

test("a gradient background runs from one colour to the other at the given angle", async ({ page }) => {
  const mk = (angle: number): NAscii => scene({ cols: 10, rows: 4, style: { background: { from: "#000000", to: "#ffffff", angle } }, frames: [{ text: [" "] }] });
  for (const [angle, from, to] of [
    [90, [1, 40], [-2, 40]],
    [180, [40, 1], [40, -2]],
    [0, [40, -2], [40, 1]],
  ] as const) {
    const s = mk(angle);
    const { w, h } = canvasSize(s);
    const at = (v: readonly [number, number]): [number, number] => [v[0] < 0 ? w + v[0] : v[0], v[1] < 0 ? h + v[1] : v[1]];
    const p = await pixelsOf(page, emitAsciiSvg(s), w, h, [at(from), at(to)]);
    const lum = (q: Px): number => (q[0] + q[1] + q[2]) / 3;
    expect(lum(p[0] as Px), `angle ${angle} start`).toBeLessThan(40);
    expect(lum(p[1] as Px), `angle ${angle} end`).toBeGreaterThan(215);
  }
  // 135 degrees: top-left dark, bottom-right light, and the other two corners about halfway
  const s = mk(135);
  const { w, h } = canvasSize(s);
  const p = await pixelsOf(page, emitAsciiSvg(s), w, h, [[1, 1], [w - 2, h - 2], [w - 2, 1]]);
  expect((p[0] as Px)[0]).toBeLessThan(40);
  expect((p[1] as Px)[0]).toBeGreaterThan(215);
  expect(Math.abs((p[2] as Px)[0] - 128)).toBeLessThan(80);
});

test("glow: an SVG with the filter still plays inside an <img>, and the glow lights the cells around a glyph", async ({ page }, info) => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-glow-"));
  try {
    const frames = [{ text: ["##########", "##########"] }, { text: ["..........", ".........."] }, { text: ["          ", "@@@@@@@@@@"] }];
    const s = scene({ fps: 5, cols: 10, rows: 2, style: { glow: 0.6 }, frames });
    expect(svgProblems(emitAsciiSvg(s))).toEqual([]);
    await imgPage(page, s, dir);
    const natural = await page.evaluate(() => ({ w: (document.getElementById("a") as HTMLImageElement).naturalWidth, h: (document.getElementById("a") as HTMLImageElement).naturalHeight }));
    expect(natural).toEqual(canvasSize(s));
    const seen = new Set<string>();
    for (let i = 0; i < 14; i++) {
      seen.add(hash(await page.screenshot()));
      await page.waitForTimeout(110);
    }
    expect(seen.size, "the three frames each appear, with glow on").toBeGreaterThanOrEqual(3);
    info.annotations.push({ type: "glow-in-img", description: `${seen.size} distinct screenshots in 1.5 s` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  // one solid block of text: the pixel just outside it is lighter than the background with glow, and exactly the background without
  const block = { cols: 6, rows: 3, frames: [{ text: ["      ", " #### ", "      "] }] };
  const glowing = scene({ ...block, style: { glow: 0.8, background: "#000000", color: "#ffffff" } });
  const flat = scene({ ...block, style: { background: "#000000", color: "#ffffff" } });
  const { w, h } = canvasSize(glowing);
  // the top edge of the glyph row, a few pixels above the ink
  const outside: [number, number][] = [[padding(glowing) + cellWidth(glowing) * 3, padding(glowing) + cellHeight(glowing) + 1]];
  const withGlow = (await pixelsOf(page, emitAsciiSvg(glowing), w, h, outside))[0] as Px;
  const without = (await pixelsOf(page, emitAsciiSvg(flat), w, h, outside))[0] as Px;
  expect(without[0]).toBe(0);
  expect(withGlow[0], "glow adds light outside the glyphs").toBeGreaterThan(8);
});

test("glow cost: time to show every frame of a 120 column clip, with and without the filter", async ({ page }, info) => {
  test.setTimeout(180_000);
  const cols = 120;
  const rows = 40;
  const n = 12;
  const mk = (glow: number): NAscii => {
    const ramp = " .:-=+*#%@";
    const text = Array.from({ length: n }, (_, f) => ({
      text: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ramp[(r * 7 + c * 3 + f * 5) % ramp.length]).join("")),
      colors: Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => ["#ff6b6b", "#feca57", "#48dbfb", "#1dd1a1"][(c + r + f) % 4])),
    }));
    return scene({ cols, rows, fps: 12, style: { glow }, frames: text });
  };
  const timeIt = async (s: NAscii): Promise<number> => {
    await openInRenderer(page, s);
    await page.evaluate(() => (globalThis as unknown as Win).seek(0));
    await page.screenshot();
    const t0 = Date.now();
    for (let f = 0; f < n; f++) {
      await page.evaluate((x) => (globalThis as unknown as Win).seek(x), f);
      await page.screenshot();
    }
    return (Date.now() - t0) / n;
  };
  const plain = await timeIt(mk(0));
  const glow = await timeIt(mk(0.5));
  const msg = `${cols} by ${rows} cells, ${n} frames: ${plain.toFixed(0)} ms per frame without glow, ${glow.toFixed(0)} ms with glow`;
  info.annotations.push({ type: "glow-cost", description: msg });
  console.log(msg);
  expect(glow).toBeGreaterThan(0);
});
