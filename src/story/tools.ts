import { spawnSync } from "node:child_process";
import { syncLimit } from "../shutdown.ts";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { ffmpegFilters, ffmpegInfo } from "../export/ffmpeg.ts";
import { systemFont } from "./captions.ts";

/** The command that runs HyperFrames: one on the path, else the project's own `node_modules/.bin`. */
export function hyperframesCommand(cwd: string = process.cwd()): string {
  const r = spawnSync("hyperframes", ["--version"], { encoding: "utf8", ...syncLimit("quick") });
  if (r.status === 0) return "hyperframes";
  const local = join(cwd, "node_modules", ".bin", process.platform === "win32" ? "hyperframes.cmd" : "hyperframes");
  return existsSync(local) ? local : "hyperframes";
}

/** Whether HyperFrames is installed (on the path or in `node_modules`), and its version. */
export function hyperframesVersion(): string | undefined {
  const r = spawnSync(hyperframesCommand(), ["--version"], { encoding: "utf8", ...syncLimit("quick") });
  return r.status === 0 ? r.stdout.trim().split("\n").pop() : undefined;
}

export const HYPERFRAMES_INSTALL =
  "HyperFrames is not installed. It is a separate open-source tool (Apache 2.0, Node 22 or newer). Install it with: npm install -g hyperframes   or run it without installing as: npx hyperframes render --output video.mp4";

export interface StoryReadiness {
  /** The built-in sequencer can build a video with cuts and fades. */
  ok: boolean;
  /** What is missing, each with the effect and the fix. */
  missing: { what: string; effect: string; fix: string }[];
  captionFont?: string;
  hyperframes?: string;
}

/** What the video builder needs from this machine, for `doctor`. */
export function storyReadiness(): StoryReadiness {
  const info = ffmpegInfo();
  const missing: StoryReadiness["missing"] = [];
  const fix = "Install a full ffmpeg build (macOS: brew install ffmpeg).";
  if (!info) missing.push({ what: "ffmpeg", effect: "no video can be built", fix });
  else {
    const filters = ffmpegFilters();
    if (!info.encoders.has("libx264")) missing.push({ what: "libx264", effect: "MP4 cannot be written", fix });
    if (!filters.has("xfade")) missing.push({ what: "xfade filter", effect: "transitions other than cut are unavailable", fix: "Use ffmpeg 4.3 or newer." });
    if (!filters.has("drawtext")) missing.push({ what: "drawtext filter (libfreetype)", effect: "captions cannot be burned in", fix });
    if (!info.encoders.has("aac")) missing.push({ what: "aac encoder", effect: "audio cannot be added", fix });
  }
  const font = systemFont();
  if (!font) missing.push({ what: "system caption font", effect: "captions need captions.font in the storyboard", fix: "Set captions.font to a .ttf or .otf file." });
  const hf = hyperframesVersion();
  return { ok: info !== null && !missing.some((m) => m.what === "ffmpeg" || m.what === "libx264"), missing, ...(font ? { captionFont: font } : {}), ...(hf ? { hyperframes: hf } : {}) };
}
