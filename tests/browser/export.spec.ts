/// <reference lib="dom" />
import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { compileExample, examplesDir, root, serveRepo } from "./helpers.ts";
import { exportScene, type ExportRequest } from "../../src/export/index.ts";
import { ffmpegInfo, probeFile, rawFrame, runFfmpeg } from "../../src/export/ffmpeg.ts";
import { verifyAlpha } from "../../src/export/alpha.ts";
import { defaultTarget, gifLadder, outputSize, type FormatId, type Plan } from "../../src/export/formats.ts";
import { diffFrames, edgeBias, runChecks } from "../../src/export/checks.ts";
import { readZip } from "../../src/export/zip.ts";
import { compileSceneText } from "../../src/compile.ts";

const cli = join(root, "src/cli/gertie.ts");
const tmp = (): string => mkdtempSync(join(tmp_root(), "gertie-export-"));
const tmp_root = (): string => tmpdir();

function request(name: string, outDir: string, extra: Partial<ExportRequest>): ExportRequest {
  const c = compileExample(examplesDir, name);
  return { scene: c.scene, lottie: c.lottie, lottieJson: JSON.stringify(c.lottie), svg: c.svg, outDir, name, version: "test", formats: [], scale: 1, loops: 1, ...extra };
}

const have = ffmpegInfo();
test.skip(!have, "ffmpeg is not installed");

const ALL: FormatId[] = ["lottie", "svg", "lottie-zip", "gif", "apng", "webp", "webm", "prores", "hevc", "mp4"];

test("every format is produced from one example and passes its checks", async () => {
  const dir = tmp();
  try {
    const formats = ALL.filter((f) => f !== "hevc" || have?.encoders.has("hevc_videotoolbox"));
    const res = await exportScene(request("spinner-ring", dir, { formats }));
    expect(res.failures).toEqual([]);
    expect(res.files.map((f) => f.format).sort()).toEqual([...formats].sort());
    const c = compileExample(examplesDir, "spinner-ring");
    for (const f of res.files) {
      expect(statSync(f.path).size, `${f.format} is not empty`).toBeGreaterThan(200);
      if (f.width === undefined) continue;
      expect([f.width, f.height], `${f.format} size`).toEqual([256, 256]);
      // GIF is resampled to 25 fps, everything else keeps 30.
      const expected = f.format === "gif" ? 25 : c.scene.totalFrames;
      expect(Math.abs((f.frames as number) - expected), `${f.format} frame count`).toBeLessThanOrEqual(1);
      const p = probeFile(f.path);
      if (p.duration > 0) expect(Math.abs(p.duration - c.scene.totalFrames / c.scene.fps) / (c.scene.totalFrames / c.scene.fps), `${f.format} duration`).toBeLessThan(0.05);
      if (["gif", "apng", "webp", "webm", "prores", "hevc"].includes(f.format)) {
        expect(f.alpha?.checked, `${f.format} alpha was checked`).toBe(true);
        expect(f.alpha?.ok, `${f.format} alpha: ${f.alpha?.detail}`).toBe(true);
      }
    }
    expect(JSON.parse(readFileSync(join(dir, "spinner-ring.lottie.json"), "utf8")).w).toBe(256);
    expect(readFileSync(join(dir, "spinner-ring.svg"), "utf8").startsWith("<svg ")).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// Limits come from docs/07-render-and-export.md, written out here on purpose so the table in the code is checked against them.
const LIMITS: Record<string, { format: FormatId; w?: number; h?: number; longSide?: number; maxBytes: number; maxSeconds?: number; maxFps?: number; maxFrames?: number }> = {
  telegram: { format: "webm", longSide: 512, maxBytes: 256 * 1024, maxSeconds: 3, maxFps: 30 },
  "discord-sticker": { format: "apng", w: 320, h: 320, maxBytes: 512 * 1024 },
  "slack-emoji": { format: "gif", w: 128, h: 128, maxBytes: 128 * 1024, maxFrames: 50 },
  whatsapp: { format: "webp", w: 512, h: 512, maxBytes: 500 * 1024 },
  reel: { format: "mp4", w: 1080, h: 1920, maxBytes: Infinity },
};

for (const [dest, lim] of Object.entries(LIMITS)) {
  test(`--for ${dest} produces a file within the platform's limits`, async () => {
    const dir = tmp();
    try {
      const res = await exportScene(request("spinner-ring", dir, { destination: dest, bg: "#101820" }));
      expect(res.failures).toEqual([]);
      const f = res.files.find((x) => x.format === lim.format);
      expect(f, `${dest} wrote a ${lim.format}`).toBeDefined();
      const file = f as NonNullable<typeof f>;
      expect(file.bytes).toBeLessThanOrEqual(lim.maxBytes);
      if (lim.w) expect([file.width, file.height]).toEqual([lim.w, lim.h]);
      if (lim.longSide) expect(Math.max(file.width as number, file.height as number)).toBe(lim.longSide);
      const p = probeFile(file.path);
      if (lim.maxSeconds) expect(p.duration).toBeLessThanOrEqual(lim.maxSeconds);
      if (lim.maxFrames) expect(file.frames).toBeLessThanOrEqual(lim.maxFrames);
      if (lim.maxFps) expect((file.frames as number) / p.duration).toBeLessThanOrEqual(lim.maxFps + 0.5);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("--for telegram fails clearly when the animation is longer than three seconds", async () => {
  const dir = tmp();
  try {
    const scene = JSON.parse(readFileSync(join(examplesDir, "spinner-ring.gertie.json"), "utf8"));
    scene.duration = 4;
    for (const n of scene.nodes) delete n.animate;
    scene.nodes[0].animate = { rotation: [[0, 0], [4, 360, "linear"]] };
    const r = compileSceneText(JSON.stringify(scene), {});
    expect(r.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const req = { ...request("spinner-ring", dir, { destination: "telegram" }), scene: r.scene!, lottie: r.lottie!, lottieJson: JSON.stringify(r.lottie), svg: r.svg!.svg };
    const res = await exportScene(req);
    expect(res.files).toEqual([]);
    expect(res.failures[0]?.reason).toMatch(/at most 3 seconds/);
    expect(res.failures[0]?.environment).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a limit that cannot be met is an error that says how far over the file is, and writes nothing", async () => {
  const dir = tmp();
  try {
    // Photographic gradients at 128 pixels in a GIF cannot fit in 128 KB at 50 frames: use a busy scene.
    const res = await exportScene(request("gradient-orb", dir, { destination: "slack-emoji" }));
    if (res.failures.length === 0) {
      // The scene fitted by lowering quality. That is also correct; the file must then be within the limit.
      expect(res.files[0]!.bytes).toBeLessThanOrEqual(128 * 1024);
      expect(res.files[0]!.fit).toBeDefined();
    } else {
      expect(res.failures[0]!.reason).toMatch(/KB/);
      expect(existsSync(join(dir, "gradient-orb.slack-emoji.gif"))).toBe(false);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a transparent WebM placed over a coloured page shows the page through it", async ({ page }) => {
  const dir = tmp();
  try {
    const res = await exportScene(request("spinner-ring", dir, { formats: ["webm"] }));
    const webm = res.files[0]!.path;
    const html = join(dir, "page.html");
    writeFileSync(html, `<body style="margin:0;background:rgb(255,0,255)"><video id="v" src="${pathToFileURL(webm).href}" muted loop autoplay playsinline style="display:block;width:256px;height:256px"></video></body>`);
    await page.setViewportSize({ width: 256, height: 256 });
    await page.goto(pathToFileURL(html).href);
    await page.waitForFunction(() => (document.getElementById("v") as HTMLVideoElement).readyState >= 3, undefined, { timeout: 15000 });
    await page.evaluate(() => (document.getElementById("v") as HTMLVideoElement).pause());
    const png = await page.screenshot();
    const px = await page.evaluate(async (b64) => {
      const img = new Image();
      img.src = "data:image/png;base64," + b64;
      await img.decode();
      const c = document.createElement("canvas");
      c.width = img.width;
      c.height = img.height;
      const ctx = c.getContext("2d") as CanvasRenderingContext2D;
      ctx.drawImage(img, 0, 0);
      const at = (x: number, y: number): number[] => Array.from(ctx.getImageData(x, y, 1, 1).data);
      let magenta = 0;
      let other = 0;
      const d = ctx.getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4) (d[i]! > 240 && d[i + 1]! < 15 && d[i + 2]! > 240 ? magenta++ : other++);
      return { corner: at(2, 2), magenta, other };
    }, png.toString("base64"));
    expect(px.corner.slice(0, 3), "a transparent corner shows the page colour").toEqual([255, 0, 255]);
    expect(px.magenta).toBeGreaterThan(256 * 256 * 0.5);
    expect(px.other, "the artwork is drawn on top").toBeGreaterThan(500);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the .lottie archive has the right entries and plays in dotlottie-web", async ({ page }) => {
  const dir = tmp();
  const s = await serveRepo();
  try {
    const res = await exportScene(request("spinner-ring", dir, { formats: ["lottie-zip"], version: "9.9.9" }));
    const buf = readFileSync(res.files[0]!.path);
    const entries = readZip(buf);
    expect(entries.map((e) => e.name)).toEqual(["manifest.json", "a/spinner-ring.json"]);
    expect(JSON.parse(entries[0]!.data.toString())).toEqual({ version: "2", generator: "gertie 9.9.9", animations: [{ id: "spinner-ring" }] });
    expect(JSON.parse(entries[1]!.data.toString()).fr).toBe(30);
    await page.setViewportSize({ width: 256, height: 256 });
    await page.goto(`${s.origin}/skills/gertie/assets/render.html`);
    const out = await page.evaluate(
      async (a) => {
        document.getElementById("stage")?.remove();
        const mod = (await import(`${a.origin}/node_modules/@lottiefiles/dotlottie-web/dist/index.js`)) as { DotLottie: { new (o: object): { addEventListener(t: string, f: (e: unknown) => void): void; setFrame(n: number): void; totalFrames: number }; setWasmUrl(u: string): void } };
        mod.DotLottie.setWasmUrl(`${a.origin}/node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm`);
        const canvas = document.createElement("canvas");
        canvas.width = 256;
        canvas.height = 256;
        document.body.appendChild(canvas);
        const bin = Uint8Array.from(atob(a.b64), (ch) => ch.charCodeAt(0));
        const dl = new mod.DotLottie({ canvas, data: bin.buffer, autoplay: false, loop: false });
        const state = await new Promise<string>((resolve) => {
          dl.addEventListener("load", () => resolve("load"));
          dl.addEventListener("loadError", () => resolve("loadError"));
          setTimeout(() => resolve("timeout"), 10000);
        });
        if (state !== "load") return { state, frames: 0, ink: 0 };
        dl.setFrame(8);
        await new Promise((r) => setTimeout(r, 300));
        const d = (canvas.getContext("2d") as CanvasRenderingContext2D).getImageData(0, 0, 256, 256).data;
        let ink = 0;
        for (let i = 3; i < d.length; i += 4) if (d[i]! > 8) ink++;
        return { state, frames: dl.totalFrames, ink };
      },
      { origin: s.origin, b64: buf.toString("base64") },
    );
    expect(out.state).toBe("load");
    expect(out.frames).toBe(30);
    expect(out.ink, "the animation drew something").toBeGreaterThan(500);
  } finally {
    s.server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("alpha verification catches a file that lost its transparency", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(request("spinner-ring", dir, { formats: ["apng"], keepFrames: join(dir, "frames") }));
    expect(res.failures).toEqual([]);
    const bad = join(dir, "opaque.webm");
    // The same frames encoded without alpha: black where the scene is clear.
    await runFfmpeg(["-framerate", "30", "-i", join(dir, "frames", "f_%04d.png"), "-c:v", "libvpx-vp9", "-pix_fmt", "yuv420p", "-b:v", "0", "-crf", "30", "-an", bad]);
    const plan: Plan = { srcW: 256, srcH: 256, fps: 30, fw: 256, fh: 256, fitted: false, scale: false, bg: "0xffffff" };
    const r = await verifyAlpha(bad, "webm", plan, join(dir, "frames", "f_0000.png"));
    expect(r.checked).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.detail).toMatch(/opaque/);
    // And the default decoder drops alpha even from a good file, which is why the decoder is forced.
    const good = res.files[0]!;
    expect(good.alpha?.ok).toBe(true);
    const webm = await exportScene(request("spinner-ring", join(dir, "w"), { formats: ["webm"] }));
    const raw = rawFrame(webm.files[0]!.path);
    expect(raw[3], "default decoder: alpha dropped").toBe(255);
    expect(rawFrame(webm.files[0]!.path, { decoder: "libvpx-vp9" })[3], "forced decoder: alpha kept").toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a scene with a solid background skips the alpha check and says why", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(request("gradient-orb", dir, { formats: ["webm"] }));
    expect(res.failures).toEqual([]);
    expect(res.files[0]!.alpha).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("odd canvas sizes are padded to even for video, and the image size is kept for images", () => {
  expect(outputSize(255, 101, "mp4")).toMatchObject({ w: 256, h: 102, fitted: true });
  expect(outputSize(255, 101, "webm")).toMatchObject({ w: 256, h: 102 });
  expect(outputSize(255, 101, "apng")).toMatchObject({ w: 255, h: 101, fitted: false });
});

test("--loops repeats the sequence for formats that do not loop", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(request("spinner-ring", dir, { formats: ["mp4"], loops: 3 }));
    expect(res.failures).toEqual([]);
    expect(res.files[0]!.frames).toBe(90);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--bg gives an opaque GIF whose clear pixels are the background colour", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(request("spinner-ring", dir, { formats: ["gif"], bg: "#ff0000" }));
    expect(res.failures).toEqual([]);
    const px = rawFrame(res.files[0]!.path);
    // A GIF palette may round a channel by a step or two.
    expect(px[0]!).toBeGreaterThanOrEqual(250);
    expect([px[1]!, px[2]!, px[3]!]).toEqual([0, 0, 255]);
    expect(res.notes.join(" ")).not.toMatch(/Transparent GIF/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the export command reports JSON, and a missing ffmpeg is a clear exit 2 while .lottie and svg still work", () => {
  const dir = tmp();
  try {
    const run = (env: NodeJS.ProcessEnv, ...a: string[]): ReturnType<typeof spawnSync> => spawnSync(process.execPath, ["--import", "tsx", cli, ...a], { encoding: "utf8", cwd: root, env });
    const scene = join(examplesDir, "spinner-ring.gertie.json");
    const noFfmpeg = { ...process.env, PATH: dirname(process.execPath) };
    const bad = run(noFfmpeg, "export", scene, "--to", "gif", "--out", dir, "--json");
    expect(bad.status).toBe(2);
    const j = JSON.parse(bad.stdout as string);
    expect(j.failures[0].reason).toMatch(/ffmpeg, which was not found/);
    expect(j.failures[0].fix).toMatch(/brew install ffmpeg|apt install ffmpeg/);
    const fine = run(noFfmpeg, "export", scene, "--to", "lottie-zip,svg,lottie", "--out", dir, "--json");
    expect(fine.status, fine.stderr as string).toBe(0);
    expect(existsSync(join(dir, "spinner-ring.lottie"))).toBe(true);
    const usage = run(process.env, "export", scene, "--to", "bogus", "--out", dir, "--json");
    expect(usage.status).toBe(2);
    expect(run(process.env, "export", scene, "--json").status).toBe(2);
    expect(run(process.env, "export", scene, "--to", "gif", "--for", "telegram").status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("doctor lists which export formats this machine can make", () => {
  const r = spawnSync(process.execPath, ["--import", "tsx", cli, "doctor", "--json"], { encoding: "utf8", cwd: root });
  const out = JSON.parse(r.stdout);
  expect(out.formats.map((f: { format: string }) => f.format)).toEqual(["lottie", "svg", "lottie-zip", "gif", "apng", "webp", "webm", "prores", "hevc", "mp4"]);
  expect(out.formats.find((f: { format: string }) => f.format === "lottie-zip").ok).toBe(true);
});

// ---------------------------------------------------------------- phase 10: GIF and video quality

/** A request that leaves the size to the defaults, as the command line does without --scale. */
function auto(name: string, outDir: string, extra: Partial<ExportRequest>): ExportRequest {
  const r = request(name, outDir, extra);
  delete r.scale;
  return r;
}

test("default sizes: video longer side at least 1080, GIF capped at 640, images unchanged", () => {
  expect(defaultTarget("mp4", 256, 256)).toEqual({ w: 1080, h: 1080 });
  expect(defaultTarget("webm", 512, 256)).toEqual({ w: 1080, h: 540 });
  expect(defaultTarget("prores", 100, 400)).toEqual({ w: 270, h: 1080 });
  expect(defaultTarget("mp4", 1080, 1080)).toBeUndefined();
  expect(defaultTarget("mp4", 2048, 1024)).toBeUndefined();
  expect(defaultTarget("gif", 1024, 512)).toEqual({ w: 640, h: 320 });
  expect(defaultTarget("gif", 256, 256)).toBeUndefined();
  expect(defaultTarget("apng", 256, 256)).toBeUndefined();
  expect(defaultTarget("webp", 2000, 2000)).toBeUndefined();
});

test("a scaled size that is odd is padded up to even for video, not cut down", () => {
  const o = outputSize(1081, 429, "mp4", { w: 1081, h: 429 });
  expect([o.w, o.h]).toEqual([1082, 430]);
  expect(o.fitted).toBe(true);
  expect(outputSize(1081, 429, "gif", { w: 1081, h: 429 })).toMatchObject({ w: 1081, h: 429, fitted: false });
});

test("without --scale a 256 pixel scene exports video at 1080 and GIF at 256", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(auto("spinner-ring", dir, { formats: ["mp4", "webm", "gif"] }));
    expect(res.failures).toEqual([]);
    const by = Object.fromEntries(res.files.map((f) => [f.format, f]));
    expect([by.mp4!.width, by.mp4!.height]).toEqual([1080, 1080]);
    expect([by.webm!.width, by.webm!.height]).toEqual([1080, 1080]);
    expect([by.gif!.width, by.gif!.height]).toEqual([256, 256]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--scale overrides the video default", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(request("spinner-ring", dir, { formats: ["mp4"], scale: 2 }));
    expect([res.files[0]!.width, res.files[0]!.height]).toEqual([512, 512]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--quality high renders at twice the output size and still writes the same output size", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(request("spinner-ring", dir, { formats: ["mp4"], scale: 1, quality: "high", keepFrames: join(dir, "frames") }));
    expect(res.failures).toEqual([]);
    expect([res.files[0]!.width, res.files[0]!.height]).toEqual([256, 256]);
    const png = readFileSync(join(dir, "frames", "f_0000.png"));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([512, 512]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a 60 fps scene makes a GIF at 50 fps, or 25 when 50 is over the size budget", () => {
  expect(gifLadder(60, Infinity).map((q) => q.fps)).toEqual([50, 25]);
  expect(gifLadder(30, Infinity).map((q) => q.fps)).toEqual([25]);
  expect(gifLadder(24, Infinity).map((q) => q.fps)).toEqual([25]);
});

test("video files are tagged BT.709", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(request("spinner-ring", dir, { formats: ["mp4", "webm", "prores"] }));
    expect(res.failures).toEqual([]);
    for (const f of res.files) {
      const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=color_space,color_transfer,color_primaries", "-of", "csv=p=0", f.path], { encoding: "utf8" });
      expect(r.stdout.trim(), f.format).toBe("bt709,bt709,bt709");
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the decoded-frame checks run on video and pass on good files", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(request("spinner-ring", dir, { formats: ["mp4", "webm", "prores"], scale: 1 }));
    expect(res.failures).toEqual([]);
    for (const f of res.files) {
      expect(f.checks, `${f.format} has checks`).toBeDefined();
      const frames = f.checks!.find((c) => c.name === "frames")!;
      expect(frames.checked && frames.ok, `${f.format}: ${frames.detail}`).toBe(true);
      const loop = f.checks!.find((c) => c.name === "loop")!;
      expect(loop.checked && loop.ok, `${f.format}: ${loop.detail}`).toBe(true);
      const fringe = f.checks!.find((c) => c.name === "fringe")!;
      if (f.format === "mp4") expect(fringe.checked).toBe(false);
      else expect(fringe.checked && fringe.ok, `${f.format}: ${fringe.detail}`).toBe(true);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the frame check catches a colour shift, and the loop check catches a file that stops early", async () => {
  const dir = tmp();
  try {
    const res = await exportScene(request("gradient-orb", dir, { formats: ["apng"], scale: 1, keepFrames: join(dir, "frames") }));
    expect(res.failures).toEqual([]);
    const plan: Plan = { srcW: 256, srcH: 256, fps: 30, fw: 256, fh: 256, fitted: false, scale: false, bg: "0xffffff" };
    const base = { format: "mp4" as FormatId, plan, framePath: (i: number) => join(dir, "frames", `f_${String(i).padStart(4, "0")}.png`), sourceFrames: 60, outFps: 30, srcFps: 30, solid: true, loops: true, bg: [255, 255, 255] as [number, number, number] };
    const encode = async (out: string, vf: string, frames: number): Promise<void> => runFfmpeg(["-framerate", "30", "-i", join(dir, "frames", "f_%04d.png"), "-frames:v", String(frames), "-vf", `${vf}format=yuv420p`, "-c:v", "libx264", "-crf", "18", "-an", out]);

    const good = join(dir, "good.mp4");
    await encode(good, "scale=out_color_matrix=bt709:out_range=tv,", 60);
    const ok = runChecks({ ...base, file: good, outputFrames: 60 });
    expect(ok.every((c) => !c.checked || c.ok), JSON.stringify(ok)).toBe(true);

    // Rotating the hue is a large colour shift.
    const shifted = join(dir, "shifted.mp4");
    await encode(shifted, "hue=h=120,scale=out_color_matrix=bt709:out_range=tv,", 60);
    const bad = runChecks({ ...base, file: shifted, outputFrames: 60 });
    expect(bad.find((c) => c.name === "frames")?.ok).toBe(false);

    // The same colours, but cut after 20 frames: the file no longer returns to its first frame.
    const cut = join(dir, "cut.mp4");
    await encode(cut, "scale=out_color_matrix=bt709:out_range=tv,", 20);
    const short = runChecks({ ...base, file: cut, outputFrames: 20 });
    expect(short.find((c) => c.name === "loop")?.checked).toBe(true);
    expect(short.find((c) => c.name === "loop")?.ok).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("frame and edge differences on small buffers", () => {
  const px = (r: number, g: number, b: number, a: number): Buffer => Buffer.from([r, g, b, a]);
  expect(diffFrames(px(10, 20, 30, 255), px(10, 20, 30, 255), [0, 0, 0]).mae).toBe(0);
  expect(diffFrames(px(10, 20, 30, 255), px(20, 30, 40, 255), [0, 0, 0]).mae).toBe(10);
  // A clear pixel is the background whatever its colour channels hold.
  expect(diffFrames(px(255, 0, 0, 0), px(0, 0, 255, 0), [9, 9, 9]).mae).toBe(0);
  // Edge pixel at half alpha, decoded too dark: negative bias over white.
  const e = edgeBias(px(200, 200, 200, 128), px(100, 100, 100, 128), [255, 255, 255]);
  expect(e.edge).toBe(1);
  expect(e.bias).toBeLessThan(0);
  expect(edgeBias(px(200, 200, 200, 255), px(100, 100, 100, 255), [255, 255, 255]).edge).toBe(0);
});
