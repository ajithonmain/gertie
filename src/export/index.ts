import { copyFileSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseHex } from "../spec/color.ts";
import type { NScene } from "../spec/types.ts";
import type { Json } from "../emit-lottie/index.ts";
import { openLottie, type FrameRenderer } from "../render/lottie.ts";
import { type AlphaResult, verifyAlpha } from "./alpha.ts";
import { DESTINATIONS, type DestFormat } from "./destinations.ts";
import { ffmpegInfo, probeFile, runFfmpeg } from "./ffmpeg.ts";
import { defaultTarget, encodeArgs, FORMATS, FRAME_FORMATS, GIF_BUDGET_BYTES, gifLadder, ladder, outputSize, unavailable, type FormatId, type Plan, type Quality } from "./formats.ts";
import { type CheckResult, runChecks } from "./checks.ts";
import { buildLottieArchive } from "./lottie-archive.ts";

export type RenderQuality = "standard" | "high";

/** Render at twice the output size for these formats unless told otherwise. Set from the measurements in docs/07-render-and-export.md. */
export const DEFAULT_QUALITY: Readonly<Record<FormatId, RenderQuality>> = { lottie: "standard", svg: "standard", "lottie-zip": "standard", gif: "standard", apng: "standard", webp: "standard", webm: "standard", prores: "standard", hevc: "standard", mp4: "standard" };

/** The longer side of a rendered frame never exceeds this, in pixels. */
const MAX_RENDER_SIDE = 4320;

/** What export needs to know about the animation: its size, timing and whether it has a solid background. */
export type ExportScene = Pick<NScene, "w" | "h" | "fps" | "totalFrames" | "background"> & { loop?: boolean };

export interface ExportRequest {
  scene: ExportScene;
  /** The compiled Lottie. Absent for animations that have no Lottie form (ASCII). */
  lottie?: { [key: string]: Json };
  lottieJson?: string;
  svg: string;
  /** Opens a renderer for the frames, at the given scale. Defaults to rendering `lottie`. */
  openFrames?: (scale: number) => Promise<FrameRenderer>;
  outDir: string;
  name: string;
  version: string;
  /** Formats to write. Ignored when `destination` is set. */
  formats: FormatId[];
  destination?: string;
  /** Solid background colour for formats that need one, `#rgb` or `#rrggbb`. */
  bg?: string;
  /**
   * Multiplier on the canvas size for the output. When absent, video formats are written with the longer side
   * at least 1080 pixels and GIF at the authored size capped at 640 pixels. When set, it overrides both.
   */
  scale?: number;
  /** `high` renders at twice the output size and scales down with lanczos. Absent means the default for each format. */
  quality?: RenderQuality;
  /** Repeat the frame sequence this many times before encoding. */
  loops: number;
  /** Keep the rendered frames in this directory instead of a temporary one. */
  keepFrames?: string;
  progress?: (line: string) => void;
}

export interface ExportedFile {
  format: FormatId;
  path: string;
  bytes: number;
  width?: number;
  height?: number;
  frames?: number;
  /** What was done to fit a limit, for example "frame rate lowered to 20". */
  fit?: string;
  alpha?: AlphaResult;
  /** Results of the decoded-frame checks, for the video formats. */
  checks?: CheckResult[];
}

export interface ExportFailure {
  format: FormatId;
  reason: string;
  fix: string;
  /** True when the cause is a missing tool, not the scene. */
  environment: boolean;
}

export interface ExportResult {
  files: ExportedFile[];
  failures: ExportFailure[];
  notes: string[];
}

interface Job {
  format: FormatId;
  dest?: DestFormat;
  destId?: string;
}

function ffmpegColour(bg: string | undefined): string {
  const rgba = parseHex(bg ?? "#ffffff");
  if (!rgba) throw new Error(`--bg '${bg}' is not a colour. Use #rgb or #rrggbb.`);
  const h = (n: number): string => Math.round(n).toString(16).padStart(2, "0");
  return `0x${h(rgba[0])}${h(rgba[1])}${h(rgba[2])}`;
}

function jobsFor(req: ExportRequest): Job[] {
  if (req.destination) {
    const d = DESTINATIONS[req.destination];
    if (!d) throw new Error(`Unknown destination '${req.destination}'.`);
    return d.formats.map((f) => ({ format: f.format, dest: f, destId: d.id }));
  }
  return req.formats.map((format) => ({ format }));
}

/** The size a job is written at, before padding to even: a destination, an explicit --scale, or the format default. */
function wantedSize(req: ExportRequest, j: Job): { w: number; h: number } {
  const { w, h } = req.scene;
  const t = j.dest?.target?.(w, h);
  if (t) return t;
  if (req.scale !== undefined) return { w: Math.round(w * req.scale), h: Math.round(h * req.scale) };
  return defaultTarget(j.format, w, h) ?? { w, h };
}

const qualityOf = (req: ExportRequest, j: Job): RenderQuality => req.quality ?? DEFAULT_QUALITY[j.format];

/** Largest render scale any job needs: its output size over the canvas, doubled for `high` quality. */
function renderScale(req: ExportRequest, jobs: Job[]): number {
  let need = 1;
  for (const j of jobs) {
    const t = wantedSize(req, j);
    let k = Math.max(t.w / req.scene.w, t.h / req.scene.h);
    // A destination with a fixed size has always been rendered at a whole multiple, then fitted.
    if (j.dest?.target) k = Math.ceil(k);
    if (qualityOf(req, j) === "high") k *= 2;
    need = Math.max(need, k);
  }
  return Math.min(MAX_RENDER_SIDE / Math.max(req.scene.w, req.scene.h), need);
}

async function renderFrames(req: ExportRequest, dir: string, scale: number): Promise<{ w: number; h: number; count: number }> {
  const r = req.openFrames ? await req.openFrames(scale) : await openLottie(req.lottie as { w: number; h: number }, { scale });
  try {
    const total = req.scene.totalFrames;
    const every = Math.max(1, Math.floor(total / 10));
    for (let f = 0; f < total; f++) {
      writeFileSync(join(dir, `f_${String(f).padStart(4, "0")}.png`), await r.renderFrame(f));
      if (req.progress && (f % every === 0 || f === total - 1)) req.progress(`rendering frames ${f + 1}/${total}`);
    }
    // Video files do not loop by themselves: repeat the sequence when asked.
    for (let k = 1; k < req.loops; k++) for (let f = 0; f < total; f++) copyFileSync(join(dir, `f_${String(f).padStart(4, "0")}.png`), join(dir, `f_${String(k * total + f).padStart(4, "0")}.png`));
    return { w: Math.round(req.scene.w * scale), h: Math.round(req.scene.h * scale), count: total * req.loops };
  } finally {
    await r.close();
  }
}

const SOLID_ONLY: ReadonlySet<FormatId> = new Set(["mp4"]);
const FRAME_VIDEO: ReadonlySet<FormatId> = new Set(["mp4", "webm", "prores", "hevc"]);

/** Writes every requested format. Frames are rendered once and shared. */
export async function exportScene(req: ExportRequest): Promise<ExportResult> {
  mkdirSync(req.outDir, { recursive: true });
  const result: ExportResult = { files: [], failures: [], notes: [] };
  const jobs = jobsFor(req);
  const ff = ffmpegInfo();
  const seconds = (req.scene.totalFrames / req.scene.fps) * req.loops;
  if (req.scale !== undefined && !(req.scale > 0)) throw new Error("scale must be a positive number.");

  const runnable: Job[] = [];
  for (const j of jobs) {
    const u = unavailable(j.format, ff);
    if (u) {
      // A format that a destination lists as an extra is skipped without complaint.
      if (j.dest?.optional) result.notes.push(`${j.format} skipped: ${u.reason}`);
      else result.failures.push({ format: j.format, ...u, environment: true });
      continue;
    }
    if (j.dest?.maxSeconds !== undefined && seconds > j.dest.maxSeconds + 1e-9) {
      result.failures.push({ format: j.format, reason: `${j.destId} allows at most ${j.dest.maxSeconds} seconds and the animation is ${seconds.toFixed(2)}.`, fix: `Set "duration" to ${j.dest.maxSeconds} or less in the scene, or use fewer --loops.`, environment: false });
      continue;
    }
    runnable.push(j);
  }

  const label = (j: Job): string => (j.destId ? `${req.name}.${j.destId}` : req.name);
  const target = (j: Job): string => join(req.outDir, `${label(j)}.${FORMATS[j.format].ext}`);

  // Formats written straight from the compiled scene.
  const framed: Job[] = [];
  for (const j of runnable) {
    if ((j.format === "lottie" || j.format === "lottie-zip") && (req.lottie === undefined || req.lottieJson === undefined)) {
      result.failures.push({ format: j.format, reason: `This animation has no ${j.format} form.`, fix: "Export svg or a frame format instead.", environment: false });
      continue;
    } else if (j.format === "lottie") writeFileSync(target(j), (req.lottieJson as string) + "\n");
    else if (j.format === "svg") writeFileSync(target(j), req.svg);
    else if (j.format === "lottie-zip") writeFileSync(target(j), buildLottieArchive(req.name, req.lottieJson as string, req.version));
    else {
      framed.push(j);
      continue;
    }
    result.files.push({ format: j.format, path: target(j), bytes: statSync(target(j)).size });
  }
  if (framed.length === 0) return result;

  const dir = req.keepFrames ?? mkdtempSync(join(tmpdir(), "gertie-frames-"));
  if (req.keepFrames) mkdirSync(dir, { recursive: true });
  try {
    const scale = renderScale(req, framed);
    const src = await renderFrames(req, dir, scale);
    const frames = join(dir, "f_%04d.png");
    const first = join(dir, "f_0000.png");

    for (const j of framed) {
      const solid = SOLID_ONLY.has(j.format) || j.dest?.solid === true || (j.format === "gif" && (req.bg !== undefined || req.scene.background !== null));
      const size = outputSize(src.w, src.h, j.format, wantedSize(req, j));
      const plan: Plan = { srcW: src.w, srcH: src.h, fps: req.scene.fps, fw: size.w, fh: size.h, sw: size.sw, sh: size.sh, fitted: size.fitted, scale: size.scale, bg: ffmpegColour(req.bg), ...(qualityOf(req, j) === "high" || src.w / size.sw >= 1.5 ? { filter: "area" as const } : {}) };
      const sizeLimited = j.dest?.maxBytes !== undefined;
      const steps: Quality[] = j.format === "gif" && !sizeLimited ? gifLadder(req.scene.fps, j.dest?.maxFps ?? Infinity) : ladder(j.format, req.scene.fps, j.dest?.maxFps ?? Infinity);
      const out = target(j);
      const ext = FORMATS[j.format].ext;
      const tmpOut = join(dir, `out.${ext}`);
      let chosen: { q: Quality; bytes: number } | undefined;
      let smallest = Infinity;
      let tried = 0;
      for (const q of steps) {
        const rate = q.fps ?? req.scene.fps;
        if (j.dest?.maxFrames !== undefined && Math.round(seconds * rate) > j.dest.maxFrames) continue;
        tried++;
        req.progress?.(`encoding ${j.format}${tried > 1 ? ` (attempt ${tried})` : ""}`);
        try {
          await runFfmpeg(encodeArgs(j.format, plan, q, frames, tmpOut, { transparentGif: !solid }));
        } catch (e) {
          result.failures.push({ format: j.format, reason: e instanceof Error ? e.message : String(e), fix: "Run: node scripts/gertie.mjs doctor, and check that ffmpeg is a full build.", environment: true });
          chosen = undefined;
          tried = -1;
          break;
        }
        const bytes = statSync(tmpOut).size;
        smallest = Math.min(smallest, bytes);
        // A GIF with no platform limit has a soft budget: a smaller frame rate is tried only when it is exceeded.
        const budget = j.dest?.maxBytes ?? (j.format === "gif" && steps.length > 1 && q !== steps[steps.length - 1] ? GIF_BUDGET_BYTES : undefined);
        if (budget === undefined || bytes <= budget) {
          chosen = { q, bytes };
          break;
        }
      }
      if (tried === -1) continue;
      if (!chosen) {
        const why =
          tried === 0
            ? `${j.destId} allows at most ${j.dest?.maxFrames} frames, and ${seconds.toFixed(2)} seconds needs more even at the lowest frame rate.`
            : `The smallest ${j.format} Gertie could make is ${Math.round(smallest / 1024)} KB, over the ${j.destId} limit of ${Math.round((j.dest?.maxBytes ?? 0) / 1024)} KB.`;
        result.failures.push({ format: j.format, reason: why, fix: "Shorten the animation, use fewer or flatter shapes (gradients and many small moving parts cost the most), or lower the canvas size.", environment: false });
        continue;
      }
      copyFileSync(tmpOut, out);
      const pr = probeFile(out);
      const file: ExportedFile = { format: j.format, path: out, bytes: chosen.bytes, width: pr.width, height: pr.height, frames: pr.frames };
      const first0 = steps[0] as Quality;
      const notes: string[] = [];
      if (chosen.q.fps !== undefined && chosen.q.fps !== first0.fps) notes.push(`frame rate lowered to ${chosen.q.fps}`);
      if (chosen.q.colors !== undefined && chosen.q.colors !== first0.colors) notes.push(`palette cut to ${chosen.q.colors} colours`);
      if (chosen.q.crf !== undefined && chosen.q.crf !== first0.crf) notes.push(`quality lowered (crf ${chosen.q.crf})`);
      if (chosen.q.q !== undefined && chosen.q.q !== first0.q) notes.push(`quality lowered (${chosen.q.q})`);
      if (notes.length > 0) file.fit = notes.join(", ");

      // A transparent format must still be transparent after encoding, or the file is worthless.
      const info = FORMATS[j.format];
      if (info.alpha !== "none" && !solid && req.scene.background === null) {
        file.alpha = await verifyAlpha(out, j.format, plan, first);
        if (!file.alpha.ok) {
          rmSync(out, { force: true });
          result.failures.push({ format: j.format, reason: `Alpha verification failed: ${file.alpha.detail}`, fix: `Use ${info.fallback ?? "another format"}, or export with --bg <colour> for a solid background.`, environment: false });
          continue;
        }
      }
      // The encoded video is decoded again and compared with the frames it was made from.
      if (FRAME_VIDEO.has(j.format)) {
        const rate = chosen.q.fps ?? req.scene.fps;
        const bgc = parseHex(req.bg ?? "#ffffff") ?? [255, 255, 255, 1];
        file.checks = runChecks({ file: out, format: j.format, plan, framePath: (i) => join(dir, `f_${String(i).padStart(4, "0")}.png`), sourceFrames: src.count, outputFrames: pr.frames, outFps: rate, srcFps: req.scene.fps, solid: solid || req.scene.background !== null, loops: req.scene.loop === true, bg: [bgc[0], bgc[1], bgc[2]] });
        const bad = file.checks.find((c) => c.checked && !c.ok);
        if (bad) {
          rmSync(out, { force: true });
          result.failures.push({ format: j.format, reason: `Check '${bad.name}' failed: ${bad.detail}.`, fix: bad.name === "loop" ? "Re-export. If it fails again, make each animated property end on its starting value." : "Re-export with a lower --scale or --quality high, or use a lossless format (apng).", environment: false });
          continue;
        }
      }
      if (j.format === "gif" && !solid) result.notes.push("Transparent GIF has one bit of transparency, so curved edges are jagged and one palette colour is used for clear. Prefer apng, webp or webm where the destination accepts them.");
      if (j.format === "webm") result.notes.push("WebM transparency does not show in Safari. Use hevc (macOS only), apng or webp for Safari.");
      result.files.push(file);
    }
  } finally {
    if (!req.keepFrames) rmSync(dir, { recursive: true, force: true });
  }
  result.notes = [...new Set(result.notes)];
  return result;
}

export { FRAME_FORMATS };
