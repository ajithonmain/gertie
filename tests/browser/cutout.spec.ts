import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchBrowser, type PwBrowser } from "../../src/render/browser.ts";
import { openLottie } from "../../src/render/lottie.ts";
import { decodeImage } from "../../src/render/image.ts";
import { root } from "./helpers.ts";

// Phase 6, step 5: cutout animation of a painterly picture. The layers are cut along outlines, the picture is animated, and every frame
// is checked for holes and for copies of the parts left behind.
const bundle = join(root, "skills/gertie/scripts/gertie.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [bundle, ...args], { encoding: "utf8", cwd: root });
const painting = join(root, "tests/fixtures/cutout/painting.png");
const parts = join(root, "tests/fixtures/cutout/painting.parts.json");

let browser: PwBrowser;
test.beforeAll(async () => {
  browser = (await launchBrowser()).browser;
});
test.afterAll(async () => {
  await browser?.close();
});

/** Cuts the painting in a temp folder, groups the face, and writes a scene that includes it with the given overrides. */
function setup(overrides: object, duration = 4.8): { dir: string; scene: string } {
  const dir = mkdtempSync(join(tmpdir(), "gertie-cutout-"));
  copyFileSync(painting, join(dir, "painting.png"));
  copyFileSync(parts, join(dir, "parts.json"));
  writeFileSync(join(dir, "groups.json"), JSON.stringify({ face: ["head", "fringe", "eye-l", "eye-r", "lid-l", "lid-r"] }));
  const cut = run("cutout", join(dir, "painting.png"), join(dir, "parts.json"), "--out", join(dir, "cut"), "--json");
  expect(cut.status, cut.stdout + cut.stderr).toBe(0);
  const grp = run("group", join(dir, "cut/fragment.json"), join(dir, "groups.json"), "--out", join(dir, "cut/grouped.fragment.json"));
  expect(grp.status, grp.stderr).toBe(0);
  const scene = { gertie: 1, name: "portrait", canvas: { w: 640, h: 480, background: "#1e293b" }, duration, nodes: [{ id: "portrait", type: "group", include: "cut/grouped.fragment.json", overrides }] };
  writeFileSync(join(dir, "portrait.gertie.json"), JSON.stringify(scene));
  return { dir, scene: join(dir, "portrait.gertie.json") };
}

test("cutting a painting writes the layers, and they put the picture back together at rest", () => {
  const { dir } = setup({});
  try {
    for (const f of ["cut/background.png", "cut/parts/head.png", "cut/parts/body.png", "cut/lids/lid-l.png", "cut/fragment.json", "cut/rest.png", "cut/outlines.png"]) expect(existsSync(join(dir, f)), f).toBe(true);
    const r = run("cutout", join(dir, "painting.png"), join(dir, "parts.json"), "--out", join(dir, "cut2"), "--json");
    const res = JSON.parse(r.stdout);
    expect(res.restDifference).toBeLessThan(0.02);
    expect(res.layers.map((l: { id: string }) => l.id)).toEqual(["background", "hair-back", "body", "head", "fringe", "eye-l", "eye-r", "lid-l", "lid-r"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the example scene (a blink, a head tilt and a drifting background) passes qa", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-cutout-"));
  try {
    const ex = join(root, "examples/cutout");
    copyFileSync(painting, join(dir, "painting.png"));
    copyFileSync(join(ex, "painting.parts.json"), join(dir, "painting.parts.json"));
    copyFileSync(join(ex, "painting.groups.json"), join(dir, "painting.groups.json"));
    copyFileSync(join(ex, "portrait.gertie.json"), join(dir, "portrait.gertie.json"));
    expect(run("cutout", join(dir, "painting.png"), join(dir, "painting.parts.json"), "--out", join(dir, "painting.cutout")).status).toBe(0);
    expect(run("group", join(dir, "painting.cutout/fragment.json"), join(dir, "painting.groups.json"), "--out", join(dir, "painting.cutout/grouped.fragment.json")).status).toBe(0);
    const qa = run("qa", join(dir, "portrait.gertie.json"), "--json");
    expect(qa.status, qa.stdout.slice(0, 500) + qa.stderr).toBe(0);
    const rep = JSON.parse(qa.stdout);
    expect(rep.errors).toBe(0);
    // Only the size of the embedded pictures is mentioned.
    expect(rep.diagnostics.map((d: { code: string }) => d.code).filter((c: string) => c !== "W-L-SIZE")).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("at twice the motion of the example there is no hole and no seam in any frame, and a moved part leaves no copy of itself", async () => {
  // A head tilt of 6 degrees, a drift of 26 pixels each way, the whole face sliding sideways, and a blink: more than anyone would use.
  const { dir, scene } = setup({
    background: { animate: { x: [[0, -30], [1.2, -56, "easeInOutSine"], [2.4, -4, "easeInOutSine"], [3.6, -30, "easeInOutSine"]], y: [[0, -30], [1.2, -4, "easeInOutSine"], [2.4, -56, "easeInOutSine"], [3.6, -30, "easeInOutSine"]] } },
    face: { pivot: [320, 345], animate: { rotation: [[0, 0], [1.2, 6, "easeInOutSine"], [2.4, -6, "easeInOutSine"], [3.6, 0, "easeInOutSine"]], x: [[0, 0], [1.2, 70, "easeInOutSine"], [3.6, 0, "easeInOutSine"]] } },
    "lid-l": { motion: [{ preset: "lid-blink", at: 1.0 }] },
    "lid-r": { motion: [{ preset: "lid-blink", at: 1.0 }] },
  }, 3.6);
  try {
    const c = run("compile", scene, "--lottie", "--json");
    expect(c.status, c.stdout + c.stderr).toBe(0);
    const lottie = JSON.parse(readFileSync(join(dir, "out/portrait.lottie.json"), "utf8"));
    const r = await openLottie(lottie, { browser });
    try {
      const skin = [222, 168, 138];
      let minContent = 1;
      for (let f = 0; f < 108; f += 6) {
        const png = await r.renderFrame(f);
        const a = await r.analyze([png], [], [0, 0, 0, 0]);
        minContent = Math.min(minContent, (a.frames[0] as { content: number }).content);
        // At the frame where the face has slid 70 pixels to the right, the place where the head was holds hair, not a copy of the face.
        if (f === 36) {
          const ras = await decodeImage(png, { browser });
          // The head's old centre is (320, 215); the face has moved right by 70 and tilted slightly, so (275, 215) is no longer face.
          const p = (275 + 215 * ras.w) * 4;
          const dist = Math.hypot((ras.data[p] as number) - skin[0]!, (ras.data[p + 1] as number) - skin[1]!, (ras.data[p + 2] as number) - skin[2]!);
          expect(dist, `pixel at the old head position is ${[...ras.data.subarray(p, p + 3)]}`).toBeGreaterThan(50);
        }
      }
      // Content is the share of pixels that are not transparent: a hole would show as a drop below 1.
      expect(minContent).toBeGreaterThan(0.999);
    } finally {
      await r.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a bad parts file is explained, and the image must be one the browser can read", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-cutout-"));
  try {
    copyFileSync(painting, join(dir, "p.png"));
    writeFileSync(join(dir, "bad.json"), JSON.stringify({ parts: [{ id: "Head", polygon: [[0, 0], [5, 5]] }] }));
    const r = run("cutout", join(dir, "p.png"), join(dir, "bad.json"), "--json");
    expect(r.status).toBe(1);
    const d = JSON.parse(r.stdout).diagnostics as { code: string; message: string }[];
    expect(d.every((x) => x.code === "E-CUTOUT")).toBe(true);
    expect(d.map((x) => x.message).join(" ")).toMatch(/lowercase/);
    writeFileSync(join(dir, "x.png"), "nope");
    writeFileSync(join(dir, "ok.json"), readFileSync(parts));
    expect(run("cutout", join(dir, "x.png"), join(dir, "ok.json")).status).toBe(2);
    expect(run("cutout", join(dir, "missing.png"), join(dir, "ok.json")).status).toBe(2);
    expect(run("cutout", join(dir, "p.png")).status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("grid draws labelled lines on an image, and render --times draws full-size frames at chosen times", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-cutout-"));
  try {
    const g = run("grid", painting, "--step", "100", "--out", join(dir, "grid.png"), "--json");
    expect(g.status, g.stdout + g.stderr).toBe(0);
    expect(JSON.parse(g.stdout)).toMatchObject({ ok: true, size: { w: 640, h: 480 }, step: 100 });
    expect(existsSync(join(dir, "grid.png"))).toBe(true);
    expect(run("grid", painting, "--step", "5").status).toBe(2);
    expect(run("grid", join(dir, "missing.png")).status).toBe(2);

    // Frames at chosen times from a compiled scene.
    const scene = join(root, "examples/spinner-ring.gertie.json");
    expect(run("compile", scene, "--lottie", "--out", dir).status).toBe(0);
    const r = run("render", join(dir, "spinner-ring.lottie.json"), "--times", "0.1,0.6", "--out", join(dir, "frames"), "--json");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const files = JSON.parse(r.stdout).outputs.frames as string[];
    expect(files.length).toBe(2);
    for (const f of files) expect(statSync(f).size).toBeGreaterThan(1000);
    expect(readFileSync(files[0]!).equals(readFileSync(files[1]!))).toBe(false);
    expect(run("render", join(dir, "spinner-ring.lottie.json"), "--times", "abc").status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
