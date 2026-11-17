import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchBrowser, type PwBrowser } from "../../src/render/browser.ts";
import { openLottie, type FrameRenderer } from "../../src/render/lottie.ts";
import { openSvg } from "../../src/render/svg.ts";
import { decodeImage } from "../../src/render/image.ts";
import { traceImage } from "../../src/trace/trace.ts";
import { importSvg } from "../../src/import/svg.ts";
import { compileExample, examplesDir, root } from "./helpers.ts";

// Phase 6, step 3: tracing a flat image. The traced shapes are drawn and compared with the image they came from.
let browser: PwBrowser;
test.beforeAll(async () => {
  browser = (await launchBrowser()).browser;
});
test.afterAll(async () => {
  await browser?.close();
});

async function differing(png: Buffer, svg: string, w: number, h: number): Promise<number> {
  const s: FrameRenderer = await openSvg(svg, { w, h, fps: 30 }, { browser });
  try {
    const tp = await s.renderFrame(0);
    const d = await s.analyze([png, tp], [[0, 1]], [0, 0, 0, 0], 24, true);
    return (d.diffs[0] as { fraction: number }).fraction;
  } finally {
    await s.close();
  }
}

async function frameOf(name: string, frame: number): Promise<Buffer> {
  const c = compileExample(examplesDir, name);
  const r = await openLottie(c.lottie, { browser });
  try {
    return await r.renderFrame(frame);
  } finally {
    await r.close();
  }
}

const cases: [string, () => Promise<Buffer>, number][] = [
  ["the logo, with a transparent background", async () => readFileSync(join(root, "examples/trace/logo.png")), 0.005],
  ["the rocket illustration", () => frameOf("rocket-launch", 20), 0.005],
  ["the gradient orb (gradients become bands of flat colour)", () => frameOf("gradient-orb", 0), 0.02],
];
for (const [name, source, limit] of cases) {
  test(`tracing ${name} reproduces it`, async () => {
    const png = await source();
    const ras = await decodeImage(png, { browser });
    const t = traceImage(ras);
    expect(t.regions).toBeGreaterThan(2);
    expect(await differing(png, t.svg, ras.w, ras.h)).toBeLessThanOrEqual(limit);
  });
}

// The two real flat illustrations of the importer tests, drawn to bitmaps first. They are much harder: fine detail and gradients.
const third: [string, number][] = [["w3c-illustration-1", 0.04], ["pinegrow-code-collaboration", 0.015]];
for (const [file, limit] of third) {
  test(`tracing a bitmap of the third-party illustration ${file} stays within ${limit * 100} percent`, async () => {
    const path = join(root, `examples/import/third-party/${file}.svg`);
    test.skip(!existsSync(path), "the third-party illustration is not present");
    const text = readFileSync(path, "utf8");
    const { w, h } = importSvg(text, file).fragment.canvas;
    const sized = text.replace(/<svg\b([^>]*)>/, (_m, a: string) => `<svg${a.replace(/\s(width|height)="[^"]*"/g, "")} width="${w}" height="${h}">`);
    const r = await openSvg(sized, { w, h, fps: 30 }, { browser, scale: 2 });
    const png = await r.renderFrame(0);
    await r.close();
    const ras = await decodeImage(png, { browser });
    const t = traceImage(ras);
    expect(t.regions).toBeGreaterThan(50);
    expect(await differing(png, t.svg, ras.w, ras.h)).toBeLessThanOrEqual(limit);
  });
}

test("a JPEG and a WebP are decoded and traced like a PNG", async () => {
  const png = readFileSync(join(root, "examples/trace/logo.png"));
  const base = await decodeImage(png, { browser });
  expect(base.w).toBe(320);
  // Re-encode in the browser, so the formats are real files.
  const page = await browser.newPage();
  try {
    await page.goto("about:blank");
    for (const mime of ["image/jpeg", "image/webp"]) {
      const b64 = await page.evaluate(
        async (a: { b64: string; mime: string }) => {
          const g = globalThis as unknown as { fetch(u: string): Promise<{ blob(): Promise<unknown> }>; createImageBitmap(b: unknown): Promise<{ width: number; height: number }>; OffscreenCanvas: new (w: number, h: number) => { getContext(t: string): { fillStyle: string; fillRect(x: number, y: number, w: number, h: number): void; drawImage(i: unknown, x: number, y: number): void }; convertToBlob(o: object): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> }; btoa(s: string): string };
          const bmp = await g.createImageBitmap(await (await g.fetch(`data:image/png;base64,${a.b64}`)).blob());
          const c = new g.OffscreenCanvas(bmp.width, bmp.height);
          const ctx = c.getContext("2d");
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, bmp.width, bmp.height);
          ctx.drawImage(bmp, 0, 0);
          const buf = new Uint8Array(await (await c.convertToBlob({ type: a.mime, quality: 0.95 })).arrayBuffer());
          let s = "";
          for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192));
          return g.btoa(s);
        },
        { b64: png.toString("base64"), mime },
      );
      const bytes = Buffer.from(b64, "base64");
      const ras = await decodeImage(bytes, { browser });
      expect([ras.w, ras.h]).toEqual([320, 320]);
      const t = traceImage(ras, { drop: [{ rgb: [255, 255, 255], tolerance: 24 }] });
      expect(t.regions, mime).toBeGreaterThanOrEqual(6);
      // The bolt's amber survives the lossy encoding to within a few steps.
      const near = (c: string) => Math.hypot(parseInt(c.slice(1, 3), 16) - 251, parseInt(c.slice(3, 5), 16) - 191, parseInt(c.slice(5, 7), 16) - 36) < 30;
      expect(t.palette.some(near), `${mime}: ${t.palette.join(" ")}`).toBe(true);
    }
  } finally {
    await page.close();
  }
  await expect(decodeImage(Buffer.from("not an image"), { browser })).rejects.toThrow(/not a PNG/);
});

// ---------------------------------------------------------------- the whole flow, from the built CLI

const bundle = join(root, "skills/gertie/scripts/gertie.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [bundle, ...args], { encoding: "utf8", cwd: root });

test("trace, group, include and animate a logo with the CLI, and qa passes", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-trace-"));
  try {
    const ex = join(root, "examples/trace");
    for (const f of ["logo.png", "logo.groups.json", "logo-anim.gertie.json"]) writeFileSync(join(dir, f), readFileSync(join(ex, f)));
    const tr = run("trace", join(dir, "logo.png"), "--json");
    expect(tr.status, tr.stdout + tr.stderr).toBe(0);
    const res = JSON.parse(tr.stdout);
    expect(res.summary.counts.shapes).toBe(10);
    expect(existsSync(res.outputs.preview)).toBe(true);
    const gr = run("group", join(dir, "logo.fragment.json"), join(dir, "logo.groups.json"), "--out", join(dir, "logo.grouped.fragment.json"));
    expect(gr.status, gr.stderr).toBe(0);
    const qa = run("qa", join(dir, "logo-anim.gertie.json"), "--json");
    expect(qa.status, qa.stdout + qa.stderr).toBe(0);
    expect(JSON.parse(qa.stdout)).toMatchObject({ ok: true, errors: 0, warnings: 0 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a traced third-party illustration is grouped by position and animated, and qa passes", () => {
  const svg = join(root, "examples/import/third-party/w3c-illustration-1.svg");
  test.skip(!existsSync(svg), "the third-party illustration is not present");
  const dir = mkdtempSync(join(tmpdir(), "gertie-trace-"));
  try {
    // A bitmap of the illustration, made with the same browser.
    const png = join(dir, "art.png");
    const make = spawnSync(process.execPath, ["--import", "tsx", "-e", `
      import { readFileSync, writeFileSync } from "node:fs";
      import { openSvg } from ${JSON.stringify(join(root, "src/render/svg.ts"))};
      const t = readFileSync(${JSON.stringify(svg)}, "utf8").replace(/<svg\\b([^>]*)>/, (_m, a) => "<svg" + a + ' width="500" height="387">');
      const r = await openSvg(t, { w: 500, h: 387, fps: 30 }, { scale: 2 });
      writeFileSync(${JSON.stringify(png)}, await r.renderFrame(0));
      await r.close();`], { encoding: "utf8", cwd: root });
    expect(make.status, make.stderr).toBe(0);
    const tr = run("trace", png, "--colors", "24", "--no-preview", "--json");
    expect(tr.status, tr.stdout + tr.stderr).toBe(0);
    const frag = JSON.parse(readFileSync(join(dir, "art.fragment.json"), "utf8"));
    const ids = (side: (cx: number) => boolean): string[] => {
      const boxes = JSON.parse(tr.stdout).summary.nodes as { id: string; bbox: number[] }[];
      return boxes.filter((b) => side(b.bbox[0]! + b.bbox[2]! / 2)).map((b) => b.id).filter((id) => id !== "region-1");
    };
    expect(frag.nodes.length).toBeGreaterThan(50);
    const topIds = new Set(frag.nodes.map((n: { id: string }) => n.id));
    const keep = (l: string[]) => l.filter((id) => topIds.has(id));
    const groups = { "left-half": keep(ids((c) => c < 1000 * 0.45)), "right-half": keep(ids((c) => c >= 1000 * 0.45)) };
    writeFileSync(join(dir, "groups.json"), JSON.stringify(groups));
    expect(run("group", join(dir, "art.fragment.json"), join(dir, "groups.json"), "--out", join(dir, "art.grouped.fragment.json")).status).toBe(0);
    const scene = { gertie: 1, name: "art-anim", canvas: { w: 1000, h: 774 }, duration: 2.4, nodes: [{ id: "art", type: "group", include: "art.grouped.fragment.json", overrides: { "left-half": { motion: [{ preset: "float", distance: 6 }] }, "right-half": { motion: [{ preset: "float", distance: 10 }] } } }] };
    writeFileSync(join(dir, "art.gertie.json"), JSON.stringify(scene));
    const qa = run("qa", join(dir, "art.gertie.json"), "--json");
    expect(qa.status, qa.stdout.slice(0, 600) + qa.stderr).toBe(0);
    expect(JSON.parse(qa.stdout).errors).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("trace refuses a file that is not an image, and bad numbers", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-trace-"));
  try {
    writeFileSync(join(dir, "x.png"), "not an image");
    expect(run("trace", join(dir, "x.png")).status).toBe(2);
    expect(run("trace", join(dir, "missing.png")).status).toBe(2);
    expect(run("trace", join(root, "examples/trace/logo.png"), "--colors", "1").status).toBe(2);
    expect(run("trace", join(root, "examples/trace/logo.png"), "--drop", "white").status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
