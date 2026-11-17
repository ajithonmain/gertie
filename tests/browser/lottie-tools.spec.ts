import { test, expect } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSceneText } from "../../src/compile.ts";
import { listColors, recolorLottie } from "../../src/lottie-tools/colors.ts";
import { retimeLottie, type JObj } from "../../src/lottie-tools/time.ts";
import { launchBrowser, type PwBrowser } from "../../src/render/browser.ts";
import { openLottie, type FrameRenderer } from "../../src/render/lottie.ts";
import { PARITY_LIMIT } from "../../src/qa/run.ts";
import { root } from "./helpers.ts";

// Phase 6, step 2 acceptance: three third-party Lottie files survive each operation. Here they are drawn in lottie-web
// before and after. The real After Effects exports shipped with lottie-web (MIT) are the third-party files.
const dir = join(root, "node_modules/lottie-web/test/animations");
const FILES = ["ripple", "starfish", "lights"];
const load = (n: string): JObj => JSON.parse(readFileSync(join(dir, `${n}.json`), "utf8"));
test.skip(!existsSync(join(dir, "ripple.json")), "lottie-web test animations are not installed");

let browser: PwBrowser;
test.beforeAll(async () => {
  browser = (await launchBrowser()).browser;
});
test.afterAll(async () => {
  await browser?.close();
});

async function diff(r: FrameRenderer, a: Buffer, b: Buffer): Promise<number> {
  const d = await r.analyze([a, b], [[0, 1]], [0, 0, 0, 0], 12, true);
  return (d.diffs[0] as { fraction: number }).fraction;
}
async function content(r: FrameRenderer, a: Buffer): Promise<number> {
  return ((await r.analyze([a], [], [0, 0, 0, 0])).frames[0] as { content: number }).content;
}

for (const name of FILES) {
  test(`${name}: the unedited file renders, and rendering is repeatable`, async () => {
    const doc = load(name);
    const r = await openLottie(doc as { w: number; h: number }, { browser });
    try {
      const f = Math.floor((doc["op"] as number) / 2);
      const a = await r.renderFrame(f);
      expect(await content(r, a)).toBeGreaterThan(0.0005);
      expect(await diff(r, a, await r.renderFrame(f))).toBe(0);
      expect(await r.consoleMessages()).toEqual([]);
    } finally {
      await r.close();
    }
  });

  test(`${name}: recolor changes the colours it was asked to and nothing else`, async () => {
    const doc = load(name);
    const palette = ["#ff0001", "#02ff00", "#0003ff", "#ff04ff", "#05ffff", "#ffff06", "#ff7f07", "#08ff7f"];
    const map = listColors(doc).map((c, i) => ({ from: c.hex, to: palette[i % palette.length] as string }));
    const out = recolorLottie(doc, map).doc;
    const a = await openLottie(doc as { w: number; h: number }, { browser });
    const b = await openLottie(out as { w: number; h: number }, { browser });
    try {
      let changed = 0;
      for (const f of [0.15, 0.4, 0.7].map((x) => (doc["op"] as number) * x)) {
        const pa = await a.renderFrame(f);
        const pb = await b.renderFrame(f);
        // The same shapes are drawn: the amount of artwork does not change, only its colour.
        expect(Math.abs((await content(a, pa)) - (await content(b, pb)))).toBeLessThan(0.002);
        if ((await diff(a, pa, pb)) > 0.0005) changed++;
      }
      expect(changed, "at least one sampled frame shows the new colours").toBeGreaterThan(0);
      expect(await b.consoleMessages()).toEqual([]);
    } finally {
      await a.close();
      await b.close();
    }
  });

  test(`${name}: retiming by 1 changes nothing, and retiming by 2 plays the same motion in half the time`, async () => {
    const doc = load(name);
    const same = retimeLottie(doc, { speed: 1 }).doc;
    const fast = retimeLottie(doc, { speed: 2 }).doc;
    const a = await openLottie(doc as { w: number; h: number }, { browser });
    const same_r = await openLottie(same as { w: number; h: number }, { browser });
    const fast_r = await openLottie(fast as { w: number; h: number }, { browser });
    try {
      const op = doc["op"] as number;
      for (const x of [0.2, 0.5, 0.8]) {
        const f = op * x;
        const p = await a.renderFrame(f);
        expect(await diff(a, p, await same_r.renderFrame(f)), `speed 1 at frame ${f}`).toBe(0);
        const q = await fast_r.renderFrame(f / 2);
        // Expressions that read time are not retimed, so a small difference is possible in files that use them.
        expect(await diff(a, p, q), `speed 2: frame ${f.toFixed(0)} of the original against frame ${(f / 2).toFixed(0)} of the retimed file`).toBeLessThanOrEqual(PARITY_LIMIT);
      }
      expect(await fast_r.consoleMessages()).toEqual([]);
    } finally {
      await a.close();
      await same_r.close();
      await fast_r.close();
    }
  });
}

test("a Lottie file placed in a scene looks like the file itself", async () => {
  const src = compileSceneText(readFileSync(join(root, "examples/spinner-ring.gertie.json"), "utf8"), {});
  const placed = JSON.parse(JSON.stringify(src.lottie)) as JObj;
  const w = placed["w"] as number;
  const h = placed["h"] as number;
  const scene = { gertie: 1, name: "placed", canvas: { w, h }, fps: placed["fr"], duration: ((placed["op"] as number) - (placed["ip"] as number)) / (placed["fr"] as number), nodes: [{ id: "spin", type: "lottie", src: "spinner.json" }] };
  const c = compileSceneText(JSON.stringify(scene), { fileExists: () => true, lotties: { "spinner.json": placed } });
  expect(c.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const a = await openLottie(placed as { w: number; h: number }, { browser });
  const b = await openLottie(c.lottie as { w: number; h: number }, { browser });
  try {
    for (const f of [3, 10, 17, 25]) {
      const pa = await a.renderFrame(f);
      expect(await content(a, pa)).toBeGreaterThan(0.0005);
      expect(await diff(a, pa, await b.renderFrame(f)), `frame ${f}`).toBeLessThanOrEqual(PARITY_LIMIT);
    }
  } finally {
    await a.close();
    await b.close();
  }
});

test("a placed file keeps its look at a different frame rate and moves with the node", async () => {
  const src = compileSceneText(readFileSync(join(root, "examples/spinner-ring.gertie.json"), "utf8"), {});
  const placed = JSON.parse(JSON.stringify(src.lottie)) as JObj;
  const w = placed["w"] as number;
  const h = placed["h"] as number;
  const mk = (extra: object, fps: number) => ({ gertie: 1, name: "placed", canvas: { w: w * 2, h }, fps, duration: 1, nodes: [{ id: "spin", type: "lottie", src: "spinner.json", ...extra }] });
  const at60 = compileSceneText(JSON.stringify(mk({}, 60)), { fileExists: () => true, lotties: { "spinner.json": placed } });
  const moved = compileSceneText(JSON.stringify(mk({ x: w }, 30)), { fileExists: () => true, lotties: { "spinner.json": placed } });
  expect(at60.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  expect(moved.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const left = compileSceneText(JSON.stringify(mk({ x: 0 }, 30)), { fileExists: () => true, lotties: { "spinner.json": placed } });
  const orig = await openLottie(placed as { w: number; h: number }, { browser });
  const r60 = await openLottie(at60.lottie as { w: number; h: number }, { browser });
  const rm = await openLottie(moved.lottie as { w: number; h: number }, { browser });
  const rl = await openLottie(left.lottie as { w: number; h: number }, { browser });
  try {
    // Half a second in, whatever the frame rate, the picture is the same.
    const po = await orig.renderFrame(15);
    const pm = await rm.renderFrame(15);
    const pl = await rl.renderFrame(15);
    const p60 = await r60.renderFrame(30);
    const one = await content(orig, po);
    expect(one).toBeGreaterThan(0.0005);
    // The canvas is twice as wide, so the same artwork covers half the share of pixels, at either frame rate and either position.
    for (const p of [pm, pl, p60]) expect(Math.abs((await content(rm, p)) - one / 2)).toBeLessThan(0.0015);
    // The 60 fps copy and the 30 fps copy at x = 0 are the same picture.
    expect(await diff(rl, pl, p60)).toBeLessThanOrEqual(PARITY_LIMIT);
    // Moving the node by one canvas width moves the artwork: the two pictures are not the same.
    expect(await diff(rl, pl, pm)).toBeGreaterThan(0.005);
  } finally {
    await orig.close();
    await r60.close();
    await rm.close();
    await rl.close();
  }
});
