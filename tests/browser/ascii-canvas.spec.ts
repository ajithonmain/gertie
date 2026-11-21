import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAscii } from "../../src/ascii/parse.ts";
import { emitAsciiSvg } from "../../src/ascii/svg.ts";
import { canvasSize, type NAscii } from "../../src/ascii/types.ts";
import { mulberry32 } from "../../src/ascii/gen.ts";
import { ffmpegInfo, probeFile } from "../../src/export/ffmpeg.ts";
import { launchBrowser, type PwBrowser } from "../../src/render/browser.ts";
import { openAsciiCanvas } from "../../src/render/ascii-canvas.ts";
import { openSvg } from "../../src/render/svg.ts";
import { decodeImages } from "../../src/render/image.ts";
import { root } from "./helpers.ts";

// Phase 8b, task 3: the canvas renderer for dense grids must draw what the SVG draws, and a dense recipe exports to video through it.

const cli = join(root, "src/cli/gertie.ts");
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", cwd: root, maxBuffer: 64 * 1024 * 1024 });

/** A small coloured frame: rows of mixed characters from the long ramp in a few colours, with some cell backgrounds. */
function sample(style: Record<string, unknown>, seed = 42): NAscii {
  const r = mulberry32(seed);
  const ramp = " .:-=+*#%@";
  const palette = ["#ef4444", "#22c55e", "#3b82f6", "#f5f5f5", null];
  const text: string[] = [];
  const colors: (string | null)[][] = [];
  const backgrounds: (string | null)[][] = [];
  for (let y = 0; y < 8; y++) {
    let row = "";
    const c: (string | null)[] = [];
    const b: (string | null)[] = [];
    for (let x = 0; x < 30; x++) {
      row += ramp[Math.floor(r() * ramp.length)];
      c.push(palette[Math.floor(x / 6)] ?? null);
      b.push(y >= 6 && x < 12 ? "#334155" : null);
    }
    text.push(row);
    colors.push(c);
    backgrounds.push(b);
  }
  const p = parseAscii({ ascii: 1, cols: 30, rows: 8, style: { background: "#0b0f19", ...style }, frames: [{ text, colors, backgrounds }] });
  if (!p.scene) throw new Error(JSON.stringify(p.diagnostics));
  return p.scene;
}

/** Fraction of pixels whose colour differs by more than `tol` in any channel. */
function differing(a: { data: ArrayLike<number>; w: number; h: number }, b: { data: ArrayLike<number>; w: number; h: number }, tol: number): number {
  expect([a.w, a.h]).toEqual([b.w, b.h]);
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    let d = 0;
    for (let k = 0; k < 4; k++) d = Math.max(d, Math.abs((a.data[i + k] as number) - (b.data[i + k] as number)));
    if (d > tol) n++;
  }
  return n / (a.w * a.h);
}

/** Draws `s` with the SVG renderer and `t` (by default the same scene) with the canvas renderer; returns the differing fraction at a tolerance of 48 and of 0, and both PNGs. */
async function both(browser: PwBrowser, s: NAscii, t: NAscii = s): Promise<[number, number, Buffer, Buffer]> {
  const { w, h } = canvasSize(s);
  const svg = await openSvg(emitAsciiSvg(s), { w, h, fps: s.fps }, { browser });
  const fromSvg = await svg.renderFrame(0);
  await svg.close();
  const canvas = await openAsciiCanvas(t, { browser });
  const [fromCanvas] = await canvas.draw([t.frames[0] as NAscii["frames"][number]]);
  await canvas.close();
  const [ra, rb] = await decodeImages([fromSvg, fromCanvas as Buffer], { browser });
  if (!ra || !rb) throw new Error("decoding gave no image");
  return [differing(ra, rb, 48), differing(ra, rb, 0), fromSvg as Buffer, fromCanvas as Buffer];
}

test("the SVG and canvas renderers draw one small coloured frame alike: under 2 percent of pixels differ", async ({}, testInfo) => {
  const { browser } = await launchBrowser();
  try {
    const cases: [string, Record<string, unknown>][] = [
      ["text", {}],
      ["text with glow", { glow: 0.5 }],
      ["text on a gradient, font size 12", { background: { from: "#0b0f19", to: "#1e3a8a", angle: 135 }, fontSize: 12 }],
      ["dots on square cells", { glyph: "dot", ramp: " .:-=+*#%@", cellAspect: 1 }],
      ["squares", { glyph: "square", ramp: " .:-=+*#%@", cellAspect: 1 }],
    ];
    const results: string[] = [];
    for (const [name, style] of cases) {
      const [f, exact, fromSvg, fromCanvas] = await both(browser, sample(style));
      results.push(`${name}: ${(f * 100).toFixed(2)}% (${(exact * 100).toFixed(2)}% not exactly equal)`);
      if (f >= 0.02) {
        // Keep both pictures so a failure on another platform can be looked at, not guessed at. The files go to the
        // test's output folder (which CI uploads); a short summary is also printed, because the list reporter keeps
        // in-memory attachments out of the folder.
        const slug = name.replace(/\W+/g, "-");
        for (const [label, body] of [["svg", fromSvg], ["canvas", fromCanvas]] as const) {
          const file = testInfo.outputPath(`${slug}-${label}.png`);
          writeFileSync(file, body);
          await testInfo.attach(`${slug}-${label}.png`, { path: file, contentType: "image/png" });
          console.log(`ASCII-DIFF ${slug} ${label} ${body.length} bytes png base64: ${body.toString("base64")}`);
        }
        const fonts = spawnSync("fc-match", ["monospace"], { encoding: "utf8" });
        console.log(`ASCII-DIFF fonts: ${fonts.error ? "fc-match not available" : fonts.stdout.trim()}`);
      }
      expect(f, name).toBeLessThan(0.02);
    }
    console.log(`renderers differ in: ${results.join(", ")}`);
    // The measure can fail: a frame with other characters, drawn by the canvas, differs from the SVG in far more pixels.
    const [control] = await both(browser, sample({}), sample({}, 7));
    console.log(`control (different characters): ${(control * 100).toFixed(2)}%`);
    expect(control).toBeGreaterThan(0.02);
  } finally {
    await browser.close();
  }
});

test("a 160 column recipe made from rocket-launch exports to mp4 through the canvas renderer, with the right frame count and size", async () => {
  test.skip(!ffmpegInfo(), "ffmpeg is not installed");
  const dir = mkdtempSync(join(tmpdir(), "gertie-canvas-"));
  try {
    const recipe = join(dir, "rocket.ascii.json");
    const from = run("ascii", "from", join(root, "examples/rocket-launch.gertie.json"), "--cols", "160", "--fps", "24", "--color", "--font-size", "6", "--recipe", "--out", recipe, "--json");
    expect(from.status, from.stderr + from.stdout).toBe(0);
    const raw = JSON.parse(readFileSync(recipe, "utf8")) as { source: { cols: number }; frames?: unknown };
    expect(raw.frames).toBeUndefined();
    expect(raw.source.cols).toBe(160);
    const lint = JSON.parse(run("ascii", "lint", recipe, "--json").stdout) as { scene: { cols: number; rows: number; frames: number; renderer: string; w: number; h: number } };
    // rocket-launch is 256 by 320 and 2.4 seconds: 100 rows, 58 frames at 24 fps, far over the SVG limit.
    expect(lint.scene.cols).toBe(160);
    expect(lint.scene.rows).toBe(100);
    expect(lint.scene.frames).toBe(Math.round(2.4 * 24));
    expect(lint.scene.renderer).toBe("canvas");
    const out = join(dir, "out");
    const r = run("ascii", "export", recipe, "--to", "mp4", "--out", out, "--json");
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const res = JSON.parse(r.stdout) as { renderer: string; files: { format: string; path: string }[] };
    expect(res.renderer).toBe("canvas");
    const mp4 = res.files.find((f) => f.format === "mp4");
    expect(mp4).toBeDefined();
    const p = probeFile((mp4 as { path: string }).path);
    expect(p.frames).toBe(lint.scene.frames);
    // H.264 pads odd sizes to even.
    expect(p.width).toBe(Math.ceil(lint.scene.w / 2) * 2);
    expect(p.height).toBe(Math.ceil(lint.scene.h / 2) * 2);
    // svg is refused with the fix, and so are the text exports.
    const svg = run("ascii", "export", recipe, "--to", "svg", "--out", out);
    expect(svg.status).toBe(1);
    expect(svg.stdout + svg.stderr).toMatch(/E-ASCII-TOOMANY[\s\S]*mp4, webm or gif, or lower cols, fps or the duration/);
    expect(run("ascii", "export", recipe, "--to", "sh", "--out", out).status).toBe(1);
    // The contact sheet goes through the canvas renderer too.
    const sheet = join(dir, "sheet.png");
    const rs = run("ascii", "render", recipe, "--sheet-frames", "4", "--out", sheet, "--json");
    expect(rs.status, rs.stderr).toBe(0);
    expect((JSON.parse(rs.stdout) as { renderer: string }).renderer).toBe("canvas");
    expect(readFileSync(sheet).subarray(1, 4).toString()).toBe("PNG");
    writeFileSync(join(dir, "done"), "");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
