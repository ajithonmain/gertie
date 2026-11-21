import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { syncLimit } from "../shutdown.ts";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { drawtextHasAlign, ExportUnavailableError, ffmpegFilters, ffmpegInfo, probe, runFfmpeg, type Probe } from "../export/ffmpeg.ts";
import { launchBrowser, type PwBrowser } from "../render/browser.ts";
import { openLottie, openRenderer } from "../render/lottie.ts";
import { captionY, ffColor, systemFont, wrapCaption } from "./captions.ts";
import { joinFilters, sceneFrameAt, type ScenePlan, type StoryPlan } from "./plan.ts";
import type { NStory } from "./types.ts";

/** A compiled scene, ready to be rendered into the video. */
export interface SceneAsset {
  lottie: { w: number; h: number; [key: string]: unknown };
  w: number;
  h: number;
  fps: number;
  totalFrames: number;
  loop: boolean;
}

export interface SequenceRequest {
  story: NStory;
  plan: StoryPlan;
  /** Keyed by scene id. */
  assets: ReadonlyMap<string, SceneAsset>;
  /** Folder the storyboard lives in. Font and audio paths are relative to it. */
  baseDir: string;
  /** The MP4 to write. */
  out: string;
  /** Keep the rendered frames and the ffmpeg command in this folder. */
  keepWork?: string;
  progress?: (line: string) => void;
}

export interface SequenceResult {
  out: string;
  bytes: number;
  probe: Probe;
  /** The ffmpeg filter graph, for the log. */
  filterGraph: string;
  notes: string[];
}

/** Largest side, in pixels, a scene is rendered at before ffmpeg scales it the rest of the way. */
const MAX_RENDER_SIDE = 4096;

/** Pixel density that makes a scene fill (cover) or fit inside (contain) the video. */
export function renderScale(fit: ScenePlan["fit"], scene: { w: number; h: number }, canvas: { w: number; h: number }): number {
  const raw = fit === "none" ? 1 : fit === "cover" ? Math.max(canvas.w / scene.w, canvas.h / scene.h) : Math.min(canvas.w / scene.w, canvas.h / scene.h);
  return Math.max(0.1, Math.min(raw, MAX_RENDER_SIDE / Math.max(scene.w, scene.h)));
}

const num = (n: number): string => String(Math.round(n * 1e6) / 1e6);

/** The filter that places one scene's frames on the video canvas, over the story background. */
export function sceneFilter(i: number, s: ScenePlan, story: NStory): string {
  const { w, h, background } = story.canvas;
  const fit = s.fit === "contain" ? `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos` : s.fit === "cover" ? `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}` : "null";
  const secs = s.frames / story.fps;
  return [
    `color=c=${ffColor(background)}:s=${w}x${h}:r=${story.fps}:d=${num(secs)}[bg${i}]`,
    `[${i}:v]format=rgba,${fit}[fg${i}]`,
    `[bg${i}][fg${i}]overlay=x=(W-w)/2:y=(H-h)/2:format=auto,format=yuv420p,setsar=1,setpts=PTS-STARTPTS,fps=${story.fps}[v${i}]`,
  ].join(";");
}

interface CaptionFile {
  file: string;
  text: string;
  from: number;
  to: number;
}

/** The `drawtext` filters that burn each scene's caption in. Text is read from files so it needs no escaping. */
export function captionFilters(captions: CaptionFile[], story: NStory, fontName: string, align: boolean): string[] {
  const c = story.captions;
  const style = c.box ? `box=1:boxcolor=0x000000@0.55:boxborderw=${Math.round(c.size * 0.35)}` : `shadowcolor=0x000000@0.7:shadowx=${Math.max(1, Math.round(c.size / 28))}:shadowy=${Math.max(1, Math.round(c.size / 28))}`;
  return captions.map((cap) => `drawtext=fontfile=${fontName}:textfile=${cap.file}:expansion=none:fontsize=${c.size}:fontcolor=${ffColor(c.color)}:line_spacing=${Math.round(c.size * 0.25)}${align ? ":text_align=center" : ""}:x=(w-text_w)/2:y=${captionY(c.position, story.canvas.h)}:${style}:enable='between(n,${cap.from},${cap.to - 1})'`);
}

/** The audio chain: trimmed or padded to the video length, with volume and fades. */
export function audioFilter(inputIndex: number, audio: NonNullable<NStory["audio"]>, seconds: number): string {
  const fadeIn = Math.min(audio.fadeIn, seconds);
  const fadeOut = Math.min(audio.fadeOut, seconds);
  const parts = [`aresample=48000`, `apad=whole_dur=${num(seconds)}`, `atrim=0:${num(seconds)}`, `asetpts=PTS-STARTPTS`, `volume=${num(audio.volume)}`];
  if (fadeIn > 0) parts.push(`afade=t=in:st=0:d=${num(fadeIn)}`);
  if (fadeOut > 0) parts.push(`afade=t=out:st=${num(Math.max(0, seconds - fadeOut))}:d=${num(fadeOut)}`);
  return `[${inputIndex}:a]${parts.join(",")}[aout]`;
}

function hasAudioStream(file: string): boolean {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", file], { encoding: "utf8", ...syncLimit("quick") });
  return r.status === 0 && r.stdout.trim() === "audio";
}

/** Checks that this ffmpeg can build the video, before any frame is rendered. */
export function requireStoryTools(story: NStory): void {
  const info = ffmpegInfo();
  if (!info) throw new ExportUnavailableError("ffmpeg was not found, so the video cannot be built.", "Install ffmpeg (macOS: brew install ffmpeg; Debian or Ubuntu: apt install ffmpeg) and run: node scripts/gertie.mjs doctor");
  const filters = ffmpegFilters();
  if (!info.encoders.has("libx264")) throw new ExportUnavailableError("This ffmpeg has no libx264 encoder, which MP4 needs.", "Install an ffmpeg build with libx264 (macOS: brew install ffmpeg).");
  if (story.scenes.some((s, i) => i < story.scenes.length - 1 && s.transition.frames > 0) && !filters.has("xfade")) throw new ExportUnavailableError("This ffmpeg has no 'xfade' filter, which transitions need.", "Install ffmpeg 4.3 or newer, or use cuts.");
  if (story.scenes.some((s) => s.caption !== null) && !filters.has("drawtext")) throw new ExportUnavailableError("This ffmpeg has no 'drawtext' filter (it needs libfreetype), so captions cannot be burned in.", "Install an ffmpeg build with libfreetype (macOS: brew install ffmpeg), or remove the captions.");
  if (story.audio && !info.encoders.has("aac")) throw new ExportUnavailableError("This ffmpeg has no AAC encoder, which MP4 audio needs.", "Install a full ffmpeg build.");
}

/** Renders every scene's frames at the video's frame rate, sized for the canvas. Returns the folder per scene. */
async function renderSceneFrames(req: SequenceRequest, work: string, browser: PwBrowser): Promise<string[]> {
  const dirs: string[] = [];
  for (const s of req.plan.scenes) {
    const asset = req.assets.get(s.id);
    if (!asset) throw new Error(`Scene '${s.id}' was not compiled.`);
    const dir = join(work, `s${s.index}`);
    mkdirSync(dir, { recursive: true });
    dirs.push(dir);
    const r = await openLottie(asset.lottie, { scale: renderScale(s.fit, asset, req.story.canvas), browser });
    try {
      const done = new Map<number, string>();
      for (let k = 0; k < s.frames; k++) {
        const target = join(dir, `f_${String(k).padStart(5, "0")}.png`);
        const sf = sceneFrameAt(k, req.story.fps, asset.fps, asset.totalFrames, asset.loop);
        const have = done.get(sf);
        if (have) copyFileSync(have, target);
        else {
          writeFileSync(target, await r.renderFrame(sf));
          done.set(sf, target);
        }
        if (req.progress && (k % 15 === 0 || k === s.frames - 1)) req.progress(`scene ${s.index + 1}/${req.plan.scenes.length} '${s.id}': frame ${k + 1}/${s.frames}`);
      }
    } finally {
      await r.close();
    }
  }
  return dirs;
}

/** The built-in sequencer: renders each scene, joins them with cuts or `xfade`, burns in captions, mixes the audio, writes an H.264 MP4. */
export async function sequenceStory(req: SequenceRequest): Promise<SequenceResult> {
  const { story, plan } = req;
  const notes: string[] = [];
  requireStoryTools(story);

  const needsCaptions = plan.scenes.some((s) => s.caption !== null);
  let fontSrc: string | undefined;
  if (needsCaptions) {
    if (story.captions.font) fontSrc = resolve(req.baseDir, story.captions.font);
    else {
      fontSrc = systemFont();
      if (!fontSrc) throw new ExportUnavailableError("No system font was found for the captions.", "Set captions.font in the storyboard to a .ttf or .otf file.");
      notes.push(`captions use the system font ${basename(fontSrc)}; set captions.font to choose another`);
    }
    if (!existsSync(fontSrc)) throw new Error(`Caption font '${fontSrc}' was not found.`);
  }
  let audioSrc: string | undefined;
  if (story.audio) {
    audioSrc = resolve(req.baseDir, story.audio.src);
    if (!hasAudioStream(audioSrc)) throw new Error(`Audio file '${story.audio.src}' has no audio stream. Use an MP3, WAV, M4A or similar file.`);
  }

  const work = req.keepWork ? resolve(req.keepWork) : mkdtempSync(join(tmpdir(), "gertie-story-"));
  mkdirSync(work, { recursive: true });
  const { browser } = await launchBrowser();
  try {
    await renderSceneFrames(req, work, browser);
  } finally {
    await browser.close().catch(() => undefined);
  }

  try {
    // Captions: the font and the text files sit in the work folder so the filter needs no path escaping.
    let fontName = "";
    if (fontSrc) {
      fontName = `font${extname(fontSrc).toLowerCase()}`;
      copyFileSync(fontSrc, join(work, fontName));
    }
    const captionFiles: CaptionFile[] = [];
    for (const s of plan.scenes) {
      if (s.caption === null || s.clean[1] <= s.clean[0]) continue;
      const lines = wrapCaption(s.caption, story.captions.size, story.canvas.w * 0.86);
      const file = `cap${s.index}.txt`;
      writeFileSync(join(work, file), lines.join("\n"));
      captionFiles.push({ file, text: s.caption, from: s.clean[0], to: s.clean[1] });
    }

    const seconds = plan.totalFrames / story.fps;
    const join_ = joinFilters(plan);
    const post = [...captionFilters(captionFiles, story, fontName, drawtextHasAlign()), "format=yuv420p"].join(",");
    const graph = [...plan.scenes.map((s, i) => sceneFilter(i, s, story)), ...join_.filters, `${join_.label}${post}[vout]`, ...(story.audio ? [audioFilter(plan.scenes.length, story.audio, seconds)] : [])].join(";\n");

    const inputs = plan.scenes.flatMap((s) => ["-framerate", String(story.fps), "-start_number", "0", "-i", `s${s.index}/f_%05d.png`]);
    const args = [
      ...inputs,
      ...(audioSrc ? ["-i", audioSrc] : []),
      "-filter_complex", graph,
      "-map", "[vout]",
      ...(story.audio ? ["-map", "[aout]"] : []),
      "-frames:v", String(plan.totalFrames),
      "-r", String(story.fps),
      "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart",
      ...(story.audio ? ["-c:a", "aac", "-b:a", "192k", "-t", num(seconds)] : []),
      resolve(req.out),
    ];
    mkdirSync(dirname(resolve(req.out)), { recursive: true });
    if (req.keepWork) writeFileSync(join(work, "ffmpeg-args.json"), JSON.stringify(args, null, 2));
    req.progress?.("encoding");
    await runFfmpeg(args, { cwd: work });

    const p = probe(resolve(req.out));
    if (p.frames !== plan.totalFrames) notes.push(`the file has ${p.frames} frames, the plan had ${plan.totalFrames}`);
    return { out: resolve(req.out), bytes: statSync(resolve(req.out)).size, probe: p, filterGraph: graph, notes };
  } finally {
    if (!req.keepWork) rmSync(work, { recursive: true, force: true });
  }
}

export interface SheetFrame {
  frame: number;
  label: string;
}

/** One frame from the middle of each scene's clean part and one from the middle of each transition. */
export function sheetFrames(plan: StoryPlan): SheetFrame[] {
  const out: SheetFrame[] = [];
  const last = plan.totalFrames - 1;
  plan.scenes.forEach((s, i) => {
    const mid = Math.min(last, Math.floor((s.clean[0] + Math.max(s.clean[0] + 1, s.clean[1])) / 2));
    out.push({ frame: mid, label: `${s.id} ${(mid / plan.fps).toFixed(2)}s` });
    const next = plan.scenes[i + 1];
    if (next && s.out.frames > 0) {
      const t = Math.min(last, next.start + Math.floor(s.out.frames / 2));
      out.push({ frame: t, label: `${s.out.type} ${(t / plan.fps).toFixed(2)}s` });
    }
  });
  return out;
}

/** Pulls exact frames out of the finished video in one pass. */
export async function extractFrames(video: string, frames: readonly number[]): Promise<Map<number, Buffer>> {
  const unique = [...new Set(frames)].sort((a, b) => a - b);
  const dir = mkdtempSync(join(tmpdir(), "gertie-sheet-"));
  try {
    const select = unique.map((n) => `eq(n,${n})`).join("+");
    await runFfmpeg(["-i", video, "-vf", `select='${select}'`, "-fps_mode", "passthrough", "-frames:v", String(unique.length), join(dir, "%03d.png")]);
    const out = new Map<number, Buffer>();
    unique.forEach((n, i) => out.set(n, readFileSync(join(dir, `${String(i + 1).padStart(3, "0")}.png`))));
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** The storyboard contact sheet: scene frames and transition frames, labelled, in one PNG. */
export async function storyboardSheet(video: string, plan: StoryPlan, canvas: { w: number; h: number }): Promise<Buffer> {
  const picks = sheetFrames(plan);
  const frames = await extractFrames(video, picks.map((p) => p.frame));
  const { browser } = await launchBrowser();
  try {
    const r = await openRenderer({ w: 64, h: 64 }, async () => ({ totalFrames: 1, frameRate: 1 }), { browser });
    try {
      const cols = Math.min(picks.length, canvas.h > canvas.w ? 6 : 3);
      const cell = canvas.h > canvas.w ? 200 : 360;
      return await r.sheet(picks.map((p) => frames.get(p.frame) as Buffer), picks.map((p) => p.label), cols, cell);
    } finally {
      await r.close();
    }
  } finally {
    await browser.close().catch(() => undefined);
  }
}
