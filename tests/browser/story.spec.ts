import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileSceneText } from "../../src/compile.ts";
import { ffmpegFilters, ffmpegInfo, probe } from "../../src/export/ffmpeg.ts";
import { lintStory } from "../../src/story/lint.ts";
import { planStory } from "../../src/story/plan.ts";
import { sequenceStory, storyboardSheet, type SceneAsset } from "../../src/story/sequence.ts";
import { root } from "./helpers.ts";

const info = ffmpegInfo();
test.skip(!info || !ffmpegFilters().has("xfade") || !ffmpegFilters().has("drawtext"), "ffmpeg with xfade and drawtext is not installed");

const cli = join(root, "src/cli/gertie.ts");
const SIZE = 128;

/** A scene that is one solid colour for its whole length. Built through the compiler, never by hand-writing Lottie. */
function solid(name: string, colour: string, seconds: number): string {
  return JSON.stringify({ gertie: 1, name, canvas: { w: SIZE, h: SIZE, background: colour }, fps: 30, duration: seconds, loop: false, nodes: [{ id: "dot", type: "ellipse", r: 4, x: 64, y: 64, fill: colour }] });
}

function assetOf(text: string): SceneAsset {
  const r = compileSceneText(text);
  if (!r.scene || !r.lottie) throw new Error(JSON.stringify(r.diagnostics));
  return { lottie: r.lottie as SceneAsset["lottie"], w: r.scene.w, h: r.scene.h, fps: r.scene.fps, totalFrames: r.scene.totalFrames, loop: r.scene.loop };
}

/** The RGB of one pixel of one frame of a video. */
function pixel(video: string, frame: number, x: number, y: number): [number, number, number] {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", video, "-vf", `select=eq(n\\,${frame}),format=rgb24,crop=1:1:${x}:${y}`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 20 });
  if (r.status !== 0 || r.stdout.length < 3) throw new Error(`could not read frame ${frame}: ${r.stderr.toString()}`);
  return [r.stdout[0] as number, r.stdout[1] as number, r.stdout[2] as number];
}
const near = (got: number[], want: number[], tol = 18): boolean => got.every((v, i) => Math.abs(v - (want[i] as number)) <= tol);

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "gertie-story-"));
}

test("three solid scenes with a fade and a slide: the frame at every boundary is right", async () => {
  const dir = tmp();
  try {
    const raw = {
      story: 1,
      name: "boundaries",
      canvas: { w: SIZE, h: SIZE, background: "#000000" },
      fps: 30,
      scenes: [
        { id: "red", src: "red.gertie.json", duration: 1, transition: { type: "fade", duration: 0.4 } },
        { id: "green", src: "green.gertie.json", duration: 1, transition: { type: "slide-left", duration: 0.5 } },
        { id: "blue", src: "blue.gertie.json", duration: 1 },
      ],
    };
    const { story, diagnostics } = lintStory(raw);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const plan = planStory(story!);
    // Scenes start at frames 0, 18 and 33. The fade covers 18..29, the slide 33..47, and the video is 63 frames.
    expect(plan.scenes.map((s) => s.start)).toEqual([0, 18, 33]);
    expect(plan.totalFrames).toBe(63);
    const assets = new Map([
      ["red", assetOf(solid("red", "#ff0000", 1))],
      ["green", assetOf(solid("green", "#00ff00", 1))],
      ["blue", assetOf(solid("blue", "#0000ff", 1))],
    ]);
    const out = join(dir, "boundaries.mp4");
    const res = await sequenceStory({ story: story!, plan, assets, baseDir: dir, out });
    expect(res.probe.frames).toBe(63);
    expect(res.probe.width).toBe(SIZE);
    expect(res.probe.codec).toBe("h264");

    const RED = [255, 0, 0], GREEN = [0, 255, 0], BLUE = [0, 0, 255];
    // Before the fade, at its first frame, in the middle, and at the first pure green frame.
    expect(near(pixel(out, 0, 64, 64), RED), "frame 0 is red").toBe(true);
    expect(near(pixel(out, 17, 64, 64), RED), "frame 17 is the last pure red frame").toBe(true);
    expect(near(pixel(out, 18, 64, 64), RED, 30), "the fade starts from red").toBe(true);
    const mid = pixel(out, 24, 64, 64);
    expect(mid[0], "mid-fade has red").toBeGreaterThan(60);
    expect(mid[1], "mid-fade has green").toBeGreaterThan(60);
    expect(near(pixel(out, 30, 64, 64), GREEN), "frame 30 is the first pure green frame").toBe(true);
    expect(near(pixel(out, 32, 64, 64), GREEN), "frame 32 is the last pure green frame").toBe(true);
    // The slide: green leaves to the left while blue comes in from the right.
    const left = pixel(out, 40, 4, 64);
    const right = pixel(out, 40, 123, 64);
    expect(near(left, GREEN, 30), "mid-slide, the left edge is still green").toBe(true);
    expect(near(right, BLUE, 30), "mid-slide, the right edge is already blue").toBe(true);
    expect(near(pixel(out, 48, 64, 64), BLUE), "frame 48 is the first pure blue frame").toBe(true);
    expect(near(pixel(out, 62, 64, 64), BLUE), "the last frame is blue").toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a cut is instant, and a scene longer than its animation holds its last frame or loops", async () => {
  const dir = tmp();
  try {
    // A scene that fades from black to white over its first half second. Held, the last frame stays white; looping, it returns to black.
    const flip = JSON.stringify({ gertie: 1, name: "flip", canvas: { w: SIZE, h: SIZE, background: "#000000" }, fps: 30, duration: 1, loop: false, nodes: [{ id: "w", type: "rect", w: SIZE, h: SIZE, x: 64, y: 64, fill: "#ffffff", animate: { opacity: [[0, 0, "hold"], [0.5, 1]] } }] });
    const raw = () => ({ story: 1, name: "hold", canvas: { w: SIZE, h: SIZE, background: "#000000" }, fps: 30, scenes: [{ id: "a", src: "a.gertie.json", duration: 2 }, { id: "b", src: "b.gertie.json", duration: 1 }] });
    const held = assetOf(flip);
    const looped = { ...held, loop: true };
    const blue = assetOf(solid("blue", "#0000ff", 1));
    for (const [label, asset, frame, white] of [["held", held, 30, true], ["looped", looped, 30, false]] as const) {
      const { story } = lintStory(raw());
      const plan = planStory(story!);
      const out = join(dir, `${label}.mp4`);
      await sequenceStory({ story: story!, plan, assets: new Map([["a", asset], ["b", blue]]), baseDir: dir, out });
      // The scene is 30 frames long and shown for 60. Frame 30 is the start of the second pass when looping (black again) and the held last frame, 29, otherwise (white).
      const p = pixel(out, frame, 64, 64);
      expect(white ? p[0] > 200 : p[0] < 40, `${label} frame ${frame}: ${p}`).toBe(true);
      expect(near(pixel(out, 59, 64, 64), [255, 255, 255]) || !white, `${label} last frame`).toBe(true);
      expect(near(pixel(out, 60, 64, 64), [0, 0, 255]), `${label}: the cut to blue is at frame 60`).toBe(true);
      expect(near(pixel(out, 59, 64, 64), [0, 0, 255], 30), `${label}: frame 59 is not blue yet`).toBe(false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("captions appear only in their scene's clean window", async () => {
  const dir = tmp();
  try {
    const raw = {
      story: 1,
      name: "caps",
      canvas: { w: SIZE, h: SIZE, background: "#000000" },
      fps: 30,
      scenes: [
        { id: "a", src: "a.gertie.json", duration: 1, caption: "HELLO", transition: { type: "fade", duration: 0.3 } },
        { id: "b", src: "b.gertie.json", duration: 1 },
      ],
      captions: { position: "center", size: 40, color: "#ffffff" },
    };
    const { story } = lintStory(raw);
    const plan = planStory(story!);
    const assets = new Map([["a", assetOf(solid("a", "#000000", 1))], ["b", assetOf(solid("b", "#000000", 1))]]);
    const out = join(dir, "caps.mp4");
    await sequenceStory({ story: story!, plan, assets, baseDir: dir, out });
    // Scene a is clean for frames 0..20 (the fade starts at 21). Look for any bright pixel in a centre band.
    const bright = (frame: number): number => {
      const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", out, "-vf", `select=eq(n\\,${frame}),format=gray,crop=${SIZE}:48:0:40`, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"], { maxBuffer: 1 << 20 });
      return [...r.stdout].filter((v) => v > 128).length;
    };
    expect(bright(10), "caption is on screen in the clean window").toBeGreaterThan(40);
    expect(bright(20), "and on its last clean frame").toBeGreaterThan(40);
    expect(bright(25), "and gone during the transition").toBe(0);
    expect(bright(45), "and absent from the next scene").toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the example storyboard renders to a correct MP4 with captions, two transitions and music, and a contact sheet", async () => {
  const dir = tmp();
  try {
    const out = join(dir, "app-intro.mp4");
    const r = spawnSync(process.execPath, ["--import", "tsx", cli, "story", join(root, "examples/story/app-intro.story.json"), "--out", out, "--json"], { encoding: "utf8", cwd: root, timeout: 180_000 });
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const j = JSON.parse(r.stdout) as { ok: boolean; video: { frames: number; width: number; height: number; seconds: number }; sheet?: string };
    expect(j.ok).toBe(true);
    expect([j.video.width, j.video.height]).toEqual([540, 960]);
    // 3 s + 5 s + 3 s, minus a 0.4 s fade and a 0.5 s slide.
    expect(j.video.frames).toBe(303);
    const p = probe(out);
    expect(p.codec).toBe("h264");
    const audio = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_name,duration", "-of", "csv=p=0", out], { encoding: "utf8" }).stdout.trim().split(",");
    expect(audio[0]).toBe("aac");
    expect(Math.abs(Number(audio[1]) - 10.1)).toBeLessThan(0.1);
    expect(j.sheet && existsSync(j.sheet)).toBeTruthy();
    expect(readFileSync(j.sheet as string).subarray(1, 4).toString()).toBe("PNG");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the CLI refuses a storyboard whose scene fails qa, and names the scene", () => {
  const dir = tmp();
  try {
    mkdirSync(join(dir, "scenes"));
    writeFileSync(join(dir, "scenes", "bad.gertie.json"), readFileSync(join(root, "examples/broken/e-fps.gertie.json")));
    writeFileSync(join(dir, "s.story.json"), JSON.stringify({ story: 1, name: "s", canvas: { w: 128, h: 128 }, fps: 30, scenes: [{ id: "bad", src: "scenes/bad.gertie.json", duration: 1 }] }));
    const r = spawnSync(process.execPath, ["--import", "tsx", cli, "story", join(dir, "s.story.json"), "--json"], { encoding: "utf8", cwd: root });
    expect(r.status).toBe(1);
    const j = JSON.parse(r.stdout) as { diagnostics: { code: string; message: string }[] };
    expect(j.diagnostics.map((d) => d.code)).toContain("E-STORY-SCENE");
    expect(existsSync(join(dir, "out", "s.mp4"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--engine hyperframes writes a project, and --render says how to install HyperFrames when it is missing", () => {
  const dir = tmp();
  try {
    const proj = join(dir, "project");
    const env = { ...process.env, PATH: "/usr/bin:/bin" };
    const r = spawnSync(process.execPath, ["--import", "tsx", cli, "story", join(root, "examples/story/app-intro.story.json"), "--engine", "hyperframes", "--out", proj, "--no-qa", "--render", "--json"], { encoding: "utf8", cwd: root, env });
    expect(r.status).toBe(2);
    expect(existsSync(join(proj, "index.html"))).toBe(true);
    expect(existsSync(join(proj, "compositions", "demo.html"))).toBe(true);
    expect(existsSync(join(proj, "assets", "lottie.min.js"))).toBe(true);
    expect(existsSync(join(proj, "assets", "music.mp3"))).toBe(true);
    expect(r.stdout + r.stderr).toMatch(/npm install -g hyperframes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the storyboard sheet draws a labelled tile for every scene and transition", async () => {
  const dir = tmp();
  try {
    const raw = { story: 1, name: "s", canvas: { w: SIZE, h: SIZE }, fps: 30, scenes: [{ id: "a", src: "a", duration: 1, transition: { type: "fade", duration: 0.3 } }, { id: "b", src: "b", duration: 1 }] };
    const { story } = lintStory(raw);
    const plan = planStory(story!);
    const out = join(dir, "s.mp4");
    await sequenceStory({ story: story!, plan, assets: new Map([["a", assetOf(solid("a", "#ff0000", 1))], ["b", assetOf(solid("b", "#0000ff", 1))]]), baseDir: dir, out });
    const png = await storyboardSheet(out, plan, story!.canvas);
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect(png.length).toBeGreaterThan(2000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a generated HyperFrames scene composition runs: Lottie loads and registers for seeking", async ({ page }) => {
  const dir = tmp();
  try {
    const proj = join(dir, "project");
    const r = spawnSync(process.execPath, ["--import", "tsx", cli, "story", join(root, "examples/story/app-intro.story.json"), "--engine", "hyperframes", "--out", proj, "--no-qa", "--json"], { encoding: "utf8", cwd: root });
    expect(r.status, r.stderr).toBe(0);
    const html = readFileSync(join(proj, "compositions", "hook.html"), "utf8");
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.setContent("<!doctype html><body></body>");
    await page.addScriptTag({ content: readFileSync(join(proj, "assets", "lottie.min.js"), "utf8") });
    // HyperFrames provides gsap and mounts the template; a stub stands in for both.
    await page.evaluate(() => {
      (globalThis as unknown as { gsap: unknown }).gsap = { timeline: () => ({ to: () => undefined }) };
    });
    const inner = /<template[^>]*>([\s\S]*)<\/template>/.exec(html)![1] as string;
    const body = inner.replace(/<script>[\s\S]*<\/script>/, "");
    const script = /<script>([\s\S]*)<\/script>/.exec(inner)![1] as string;
    await page.evaluate((markup) => void (document.body.innerHTML = markup), body);
    await page.addScriptTag({ content: script });
    const state = await page.evaluate(() => {
      const g = globalThis as unknown as { __hfLottie?: { totalFrames: number }[]; __timelines?: Record<string, unknown> };
      return { players: g.__hfLottie?.length ?? 0, frames: g.__hfLottie?.[0]?.totalFrames ?? 0, timeline: Object.keys(g.__timelines ?? {}), svgs: document.querySelectorAll(".gertie-scene svg").length };
    });
    expect(errors).toEqual([]);
    expect(state).toEqual({ players: 1, frames: 90, timeline: ["hook"], svgs: 1 });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
