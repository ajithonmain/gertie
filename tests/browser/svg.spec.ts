import { test, expect, type Page } from "@playwright/test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileExample, corpus, examplesDir, launchBrowser, root } from "./helpers.ts";
import type { Compiled } from "./helpers.ts";
import { keyFrames } from "../../src/qa/run.ts";
import { sampleFrames } from "../../src/qa/sampling.ts";
import { openSvg } from "../../src/render/svg.ts";
import type { PwBrowser } from "../../src/render/browser.ts";
import type { FrameRenderer } from "../../src/render/lottie.ts";

// These tests use the browser of the Playwright project they run in (Chromium, Firefox or WebKit).
// The reference renders always come from Chromium, driven through Gertie's own renderer.

const renderPage = pathToFileURL(join(root, "skills/gertie/assets/render.html")).href;
const LIMIT = 0.02;

let reference: PwBrowser;
test.beforeAll(async () => {
  reference = (await launchBrowser()).browser;
});
test.afterAll(async () => {
  await reference?.close();
});

type Win = { loadSvg(text: string, fps: number): Promise<unknown>; seek(frame: number): void };

async function openInPage(page: Page, c: Compiled): Promise<void> {
  await page.setViewportSize({ width: c.scene.w, height: c.scene.h });
  await page.goto(renderPage);
  await page.evaluate((a) => (globalThis as unknown as Win).loadSvg(a.svg, a.fps), { svg: c.svg, fps: c.scene.fps });
}

const shot = (page: Page, c: Compiled, frame: number): Promise<Buffer> =>
  page.evaluate((f) => (globalThis as unknown as Win).seek(f), frame).then(() => page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: c.scene.w, height: c.scene.h } }));

async function diff(ref: FrameRenderer, a: Buffer, b: Buffer): Promise<number> {
  const r = await ref.analyze([a, b], [[0, 1]], [0, 0, 0, 0], 12, true);
  return (r.diffs[0] as { fraction: number }).fraction;
}

for (const name of corpus()) {
  const c = compileExample(examplesDir, name);
  const total = c.scene.totalFrames;

  test(`${name}: frames match the Chromium render`, async ({ page }) => {
    await openInPage(page, c);
    const ref = await openSvg(c.svg, { w: c.scene.w, h: c.scene.h, fps: c.scene.fps }, { browser: reference });
    try {
      const worst: { frame: number; fraction: number }[] = [];
      for (const f of sampleFrames(total, keyFrames(c.scene))) {
        worst.push({ frame: f, fraction: await diff(ref, await ref.renderFrame(f), await shot(page, c, f)) });
      }
      const bad = worst.filter((w) => w.fraction > LIMIT);
      expect(bad, `frames over ${LIMIT * 100}%`).toEqual([]);
    } finally {
      await ref.close();
    }
  });

  test(`${name}: seeking is exact and the loop closes`, async ({ page }) => {
    await openInPage(page, c);
    const ref = await openSvg(c.svg, { w: c.scene.w, h: c.scene.h, fps: c.scene.fps }, { browser: reference });
    try {
      const mid = Math.floor(total / 2);
      const first = await shot(page, c, mid);
      await shot(page, c, 0);
      await shot(page, c, total - 1);
      // Not exactly 0: a rotating shape can differ by a few anti-aliased pixels between two seeks of the same frame (seen on preset-entrances, intermittently).
      expect(await diff(ref, first, await shot(page, c, mid)), "the same frame seeked twice").toBeLessThan(0.0002);
      if (c.scene.loop) expect(await diff(ref, await shot(page, c, 0), await shot(page, c, total)), "frame at the duration equals frame 0").toBeLessThan(0.005);
    } finally {
      await ref.close();
    }
  });

  test(`${name}: animates inside an <img>`, async ({ page }) => {
    await page.setViewportSize({ width: c.scene.w, height: c.scene.h });
    await page.setContent(`<body style="margin:0;background:transparent"><img width="${c.scene.w}" height="${c.scene.h}" src="data:image/svg+xml;base64,${Buffer.from(c.svg).toString("base64")}"></body>`);
    const first = await page.screenshot();
    await page.waitForTimeout(400);
    let moved = !(await page.screenshot()).equals(first);
    // A loop whose length divides 400 milliseconds could land on the same frame, and on a busy machine the animation
    // can start late. Look again at other times, for about two seconds in all, before deciding it does not play.
    for (const wait of [170, 330, 500, 1000]) {
      if (moved) break;
      await page.waitForTimeout(wait);
      moved = !(await page.screenshot()).equals(first);
    }
    expect(moved, "two screenshots of the <img> differ, so the animation plays").toBe(true);
  });

  test(`${name}: makes no network request`, async ({ page }) => {
    const dir = mkdtempSync(join(tmpdir(), "gertie-svg-"));
    const file = join(dir, `${name}.svg`);
    writeFileSync(file, c.svg);
    const url = pathToFileURL(file).href;
    const requests: string[] = [];
    page.on("request", (r) => {
      if (r.url() !== url && !r.url().startsWith("data:")) requests.push(r.url());
    });
    await page.goto(url);
    await page.waitForTimeout(100);
    expect(requests).toEqual([]);
  });

  test(`${name}: reduced motion shows the poster frame`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: c.scene.w, height: c.scene.h });
    const dir = mkdtempSync(join(tmpdir(), "gertie-svg-"));
    const file = join(dir, `${name}.svg`);
    writeFileSync(file, c.svg);
    await page.goto(pathToFileURL(file).href);
    const first = await page.screenshot({ omitBackground: true });
    await page.waitForTimeout(400);
    expect((await page.screenshot({ omitBackground: true })).equals(first), "two screenshots 400 ms apart are identical").toBe(true);
    // The poster frame defaults to frame 0.
    const ref = await openSvg(c.svg, { w: c.scene.w, h: c.scene.h, fps: c.scene.fps }, { browser: reference });
    try {
      expect(await diff(ref, await ref.renderFrame(c.scene.posterFrame), first)).toBeLessThan(0.01);
    } finally {
      await ref.close();
    }
  });
}
