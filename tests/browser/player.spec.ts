/// <reference lib="dom" />
// This file runs callbacks inside the browser, so it needs the DOM types.
import { test, expect } from "@playwright/test";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { compileExample, corpus, examplesDir, root, serveRepo } from "./helpers.ts";
import { openLottie } from "../../src/render/lottie.ts";

const renderPage = pathToFileURL(join(root, "skills/gertie/assets/render.html")).href;

for (const name of corpus()) {
  test(`lottie-web console is clean for ${name}`, async ({ page }) => {
    const c = compileExample(examplesDir, name);
    const messages: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") messages.push(m.text());
    });
    page.on("pageerror", (e) => messages.push(e.message));
    await page.goto(renderPage);
    await page.evaluate((json) => (globalThis as unknown as { loadLottie(d: unknown): Promise<unknown> }).loadLottie(JSON.parse(json)), JSON.stringify(c.lottie));
    for (const f of [0, Math.floor(c.lottie.op / 2), c.lottie.op - 1]) await page.evaluate((n) => (globalThis as unknown as { seek(f: number): void }).seek(n), f);
    expect(messages).toEqual([]);
  });
}

test("seeking is exact: the same frame renders identically twice, different frames differ", async () => {
  const c = compileExample(examplesDir, "spinner-ring");
  const r = await openLottie(c.lottie);
  try {
    const a = await r.renderFrame(7);
    await r.renderFrame(20);
    const b = await r.renderFrame(7);
    expect(a.equals(b)).toBe(true);
    expect((await r.renderFrame(8)).equals(a)).toBe(false);
  } finally {
    await r.close();
  }
});

test("screenshots are transparent where nothing is drawn, and opaque with a background", async () => {
  const spin = compileExample(examplesDir, "spinner-ring");
  const r = await openLottie(spin.lottie);
  try {
    const frame = await r.renderFrame(3);
    // Against a transparent reference, the visible ring is a small part of the canvas.
    const a = await r.analyze([frame], [], [0, 0, 0, 0]);
    expect(a.frames[0]?.content).toBeGreaterThan(0.03);
    expect(a.frames[0]?.content).toBeLessThan(0.15);
    // Against an opaque white reference, nearly every pixel differs: the rest is alpha 0, not white.
    const b = await r.analyze([frame], [], [255, 255, 255, 255]);
    expect(b.frames[0]?.content).toBeGreaterThan(0.9);
  } finally {
    await r.close();
  }
  const bg = compileExample(examplesDir, "gradient-orb");
  const r2 = await openLottie(bg.lottie);
  try {
    const frame = await r2.renderFrame(3);
    const a = await r2.analyze([frame], [], [0, 0, 0, 0]);
    expect(a.frames[0]?.content).toBeGreaterThan(0.99);
  } finally {
    await r2.close();
  }
});

test("a trim path draws on from the start of the path", async () => {
  const c = compileExample(examplesDir, "draw-check");
  const r = await openLottie(c.lottie);
  try {
    // The disc has finished growing by frame 11. The trim end runs from frame 9 to 27.
    const frames = [11, 13, 16, 22];
    const shots: Buffer[] = [];
    for (const f of frames) shots.push(await r.renderFrame(f));
    const a = await r.analyze(shots, [[0, 1], [1, 2], [2, 3]], [0, 0, 0, 0]);
    const [d0, d1, d2] = a.diffs.map((d) => d.bbox!);
    // New ink moves right and up: the check mark is drawn from its short left stroke to its long right stroke.
    expect(d0![2]).toBeLessThan(d1![2]);
    expect(d1![2]).toBeLessThan(d2![2]);
    expect(d0![1]).toBeGreaterThan(d2![1]);
    expect(d2![2]).toBeGreaterThan(170);
  } finally {
    await r.close();
  }
});

test("a masked clip hides what lies outside it", async () => {
  const c = compileExample(examplesDir, "clip-reveal");
  const r = await openLottie(c.lottie);
  try {
    const frame = await r.renderFrame(0);
    const a = await r.analyze([frame], [], [0, 0, 0, 0]);
    // The window is 160 by 160 on a 256 canvas, about 39% with rounded corners, and nothing pokes out.
    expect(a.frames[0]!.content).toBeGreaterThan(0.35);
    expect(a.frames[0]!.content).toBeLessThan(0.4);
    expect(a.frames[0]!.edge).toBe(0);
  } finally {
    await r.close();
  }
});

// Second player: dotlottie-web (ThorVG). Tolerance is anti-aliasing noise between two rasterizers.
const SECOND_PLAYER_TOLERANCE = 0.03;
// potted-plant has a large radial glow whose opacity and scale are animated from frame 0. The two rasterizers shade that
// gradient a little differently, and all three sampled frames differ by 3.8 to 4.1 percent, including frame 3 before any leaf moves.
const TOLERANCE_OVERRIDE: Record<string, number> = { "potted-plant": 0.05 };

test.describe("second player agrees with lottie-web", () => {
  let origin = "";
  let close: () => void = () => undefined;
  test.beforeAll(async () => {
    const s = await serveRepo();
    origin = s.origin;
    close = () => s.server.close();
  });
  test.afterAll(() => close());

  for (const name of corpus()) {
    test(`dotlottie-web matches lottie-web for ${name}`, async ({ browser }) => {
      const c = compileExample(examplesDir, name);
      const size = { width: c.lottie.w, height: c.lottie.h };
      const clip = { x: 0, y: 0, ...size };
      const frames = [3, Math.floor(c.lottie.op / 3), Math.floor((c.lottie.op * 2) / 3)];
      const p1 = await browser.newPage({ viewport: size });
      await p1.goto(`${origin}/skills/gertie/assets/render.html`);
      await p1.evaluate((json) => (globalThis as unknown as { loadLottie(d: unknown): Promise<unknown> }).loadLottie(JSON.parse(json)), JSON.stringify(c.lottie));
      const a: Buffer[] = [];
      for (const f of frames) {
        await p1.evaluate((n) => (globalThis as unknown as { seek(f: number): void }).seek(n), f);
        a.push(await p1.screenshot({ omitBackground: true, clip }));
      }
      const p2 = await browser.newPage({ viewport: size });
      await p2.goto(`${origin}/skills/gertie/assets/render.html`);
      await p2.evaluate(
        async (arg) => {
          document.getElementById("stage")?.remove();
          const mod = (await import(`${arg.origin}/node_modules/@lottiefiles/dotlottie-web/dist/index.js`)) as { DotLottie: { new (o: object): { addEventListener(t: string, f: () => void): void }; setWasmUrl(u: string): void } };
          mod.DotLottie.setWasmUrl(`${arg.origin}/node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm`);
          const canvas = document.createElement("canvas");
          canvas.width = arg.w;
          canvas.height = arg.h;
          canvas.style.cssText = "position:absolute;left:0;top:0";
          document.body.appendChild(canvas);
          const dl = new mod.DotLottie({ canvas, data: arg.json, autoplay: false, loop: false });
          (globalThis as unknown as { dl: unknown }).dl = dl;
          await new Promise<void>((res) => dl.addEventListener("load", res));
        },
        { origin, w: c.lottie.w, h: c.lottie.h, json: JSON.stringify(c.lottie) },
      );
      const b: Buffer[] = [];
      for (const f of frames) {
        await p2.evaluate(async (n) => {
          const dl = (globalThis as unknown as { dl: { setFrame(f: number): Promise<void> } }).dl;
          await dl.setFrame(n);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        }, f);
        b.push(await p2.screenshot({ omitBackground: true, clip }));
      }
      const res = await p1.evaluate(
        (arg) => (globalThis as unknown as { analyzeFrames(b: string[], p: number[][], r: number[], t: number): Promise<{ diffs: { fraction: number }[] }> }).analyzeFrames(arg.all, arg.pairs, [0, 0, 0, 0], 12),
        { all: a.flatMap((x, i) => [x.toString("base64"), (b[i] as Buffer).toString("base64")]), pairs: frames.map((_, i) => [i * 2, i * 2 + 1]) },
      );
      for (const d of res.diffs) expect(d.fraction).toBeLessThan(TOLERANCE_OVERRIDE[name] ?? SECOND_PLAYER_TOLERANCE);
      await p1.close();
      await p2.close();
    });
  }
});
