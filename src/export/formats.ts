import type { FfmpegInfo } from "./ffmpeg.ts";

export type FormatId = "lottie" | "svg" | "lottie-zip" | "gif" | "apng" | "webp" | "webm" | "prores" | "hevc" | "mp4";

export const FORMAT_IDS: readonly FormatId[] = ["lottie", "svg", "lottie-zip", "gif", "apng", "webp", "webm", "prores", "hevc", "mp4"];

/** Formats written from frames by ffmpeg. The others are written straight from the compiled scene. */
export const FRAME_FORMATS: readonly FormatId[] = ["gif", "apng", "webp", "webm", "prores", "hevc", "mp4"];

export interface FormatInfo {
  id: FormatId;
  ext: string;
  /** What the file is for, in one line. */
  use: string;
  /** Full alpha channel. GIF has one bit. */
  alpha: "full" | "1-bit" | "none";
  /** ffmpeg encoder it needs, when it needs one. */
  encoder?: string;
  /** When the encoder is missing, what to suggest instead. */
  fallback?: string;
}

export const FORMATS: Readonly<Record<FormatId, FormatInfo>> = {
  lottie: { id: "lottie", ext: "lottie.json", use: "apps and websites with a Lottie player", alpha: "full" },
  svg: { id: "svg", ext: "svg", use: "img tags and READMEs, no JavaScript", alpha: "full" },
  "lottie-zip": { id: "lottie-zip", ext: "lottie", use: "the same Lottie animation as one smaller file", alpha: "full" },
  gif: { id: "gif", ext: "gif", use: "email, chat and legacy tools", alpha: "1-bit", encoder: "gif", fallback: "apng or webp" },
  apng: { id: "apng", ext: "apng", use: "Discord stickers and the web", alpha: "full", encoder: "apng", fallback: "webp or gif" },
  webp: { id: "webp", ext: "webp", use: "the web and WhatsApp stickers", alpha: "full", encoder: "libwebp_anim", fallback: "apng or gif" },
  webm: { id: "webm", ext: "webm", use: "web video and Telegram stickers (Safari does not show its transparency)", alpha: "full", encoder: "libvpx-vp9", fallback: "apng or webp" },
  prores: { id: "prores", ext: "mov", use: "video editors", alpha: "full", encoder: "prores_ks", fallback: "webm or apng" },
  hevc: { id: "hevc", ext: "hevc.mov", use: "Safari and iOS video, macOS only", alpha: "full", encoder: "hevc_videotoolbox", fallback: "apng or webp for Safari" },
  mp4: { id: "mp4", ext: "mp4", use: "video everywhere, on a solid background", alpha: "none", encoder: "libx264", fallback: "gif" },
};

export function parseFormats(list: string): { formats: FormatId[]; unknown: string[] } {
  const formats: FormatId[] = [];
  const unknown: string[] = [];
  for (const raw of list.split(",")) {
    const id = raw.trim().toLowerCase();
    if (id === "") continue;
    if ((FORMAT_IDS as readonly string[]).includes(id)) formats.push(id as FormatId);
    else unknown.push(id);
  }
  return { formats, unknown };
}

/** Why a format cannot be produced here, or undefined when it can. */
export function unavailable(f: FormatId, ff: FfmpegInfo | null): { reason: string; fix: string } | undefined {
  const info = FORMATS[f];
  if (!info.encoder) return undefined;
  if (!ff) return { reason: `${f} needs ffmpeg, which was not found.`, fix: "Install ffmpeg, for example: brew install ffmpeg" };
  if (!ff.encoders.has(info.encoder)) {
    const mac = f === "hevc" ? " HEVC with alpha needs Apple's VideoToolbox, so it works only on macOS." : "";
    return { reason: `${f} needs the ffmpeg encoder '${info.encoder}', which this ffmpeg does not have.${mac}`, fix: `Use ${info.fallback ?? "another format"}, or install an ffmpeg build that includes ${info.encoder}.` };
  }
  return undefined;
}

// ------------------------------------------------------------------ geometry

export interface Plan {
  /** Size of the rendered frame PNGs. */
  srcW: number;
  srcH: number;
  /** Frame rate of the rendered sequence. */
  fps: number;
  /** Size of the output. */
  fw: number;
  fh: number;
  /** Size the frame is scaled to before padding to `fw` by `fh`. Defaults to the output size. */
  sw?: number;
  sh?: number;
  /** True when the frame must be padded or scaled to reach the output size. */
  fitted: boolean;
  /** True when the frame must also be scaled (a fixed size, or a render at a different size from the output), not only padded to even. */
  scale: boolean;
  /** Solid background as 0xRRGGBB, for formats that need one. */
  bg: string;
  /** Scaler used when the frame is scaled. Lanczos by default. `area` is used when frames are shrunk by 1.5 or more, because lanczos leaves a light halo on edges when it shrinks a lot. */
  filter?: "lanczos" | "area";
}

const even = (n: number): number => Math.max(2, Math.ceil(n / 2) * 2);

/**
 * Output size. Without a target, the source size. Formats that need even dimensions (H.264 with yuv420p) are
 * padded up to even, never cropped. `sw` and `sh` are the size the frame is scaled to before padding.
 */
export function outputSize(srcW: number, srcH: number, format: FormatId, target?: { w: number; h: number }): { w: number; h: number; sw: number; sh: number; fitted: boolean; scale: boolean } {
  const needsEven = format === "webm" || format === "mp4" || format === "hevc";
  const sw = target?.w ?? srcW;
  const sh = target?.h ?? srcH;
  const w = needsEven ? even(sw) : sw;
  const h = needsEven ? even(sh) : sh;
  const scale = sw !== srcW || sh !== srcH;
  return { w, h, sw, sh, fitted: scale || w !== sw || h !== sh, scale };
}

/** Video formats that are rendered large by default so they are sharp on a full screen. */
export const VIDEO_FORMATS: readonly FormatId[] = ["mp4", "webm", "prores", "hevc"];

/** Default size of the longer side of a video: authored canvases smaller than this are enlarged to it. */
export const VIDEO_MIN_LONG_SIDE = 1080;

/** Default cap on the longer side of a GIF. GIF size grows quickly with area. */
export const GIF_MAX_LONG_SIDE = 640;

/**
 * The size a format is written at when neither `--scale` nor a destination says otherwise, or undefined
 * for the authored size. Video formats reach at least `VIDEO_MIN_LONG_SIDE` on the longer side. GIF keeps
 * the authored size, capped at `GIF_MAX_LONG_SIDE`.
 */
export function defaultTarget(format: FormatId, w: number, h: number): { w: number; h: number } | undefined {
  const long = Math.max(w, h);
  if (VIDEO_FORMATS.includes(format) && long < VIDEO_MIN_LONG_SIDE) {
    const k = VIDEO_MIN_LONG_SIDE / long;
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }
  if (format === "gif" && long > GIF_MAX_LONG_SIDE) {
    const k = GIF_MAX_LONG_SIDE / long;
    return { w: Math.round(w * k), h: Math.round(h * k) };
  }
  return undefined;
}

/** The ffmpeg filter that fits a frame into the output size, padding with transparency (or the background). Empty when nothing is needed. */
export function geometry(p: Plan, transparent: boolean): string {
  if (!p.fitted) return "";
  const colour = transparent ? "0x00000000" : p.bg;
  const fit = p.scale ? `scale=${p.sw ?? p.fw}:${p.sh ?? p.fh}:force_original_aspect_ratio=decrease:flags=${p.filter ?? "lanczos"},` : "";
  return `format=rgba,${fit}pad=${p.fw}:${p.fh}:(ow-iw)/2:(oh-ih)/2:color=${colour}`;
}

// ------------------------------------------------------------------ gif frame rates

/** GIF frame delays are whole hundredths of a second, so only these rates are exact. */
export const GIF_RATES: readonly number[] = [50, 25, 20, 12.5, 10];

export function nearestGifRate(fps: number): number {
  return GIF_RATES.reduce((best, r) => (Math.abs(Math.log(r / fps)) < Math.abs(Math.log(best / fps)) ? r : best), 25);
}

// ------------------------------------------------------------------ quality ladders

/** One step of a quality ladder. A step set to `undefined` is not used by that format. */
export interface Quality {
  fps?: number;
  colors?: number;
  crf?: number;
  q?: number;
}

/** From best to smallest. Export tries them in order until a size limit is met. */
export function ladder(f: FormatId, fps: number, maxFps: number): Quality[] {
  const cap = (r: number): number => Math.min(r, maxFps);
  switch (f) {
    case "gif": {
      const top = nearestGifRate(cap(fps));
      const rates = [top, 20, 12.5, 10].filter((r) => r <= top);
      const steps: Quality[] = [];
      for (const [r, c] of [[0, 256], [0, 128], [1, 128], [1, 64], [2, 64], [3, 32]] as const) steps.push({ fps: rates[Math.min(r, rates.length - 1)] as number, colors: c });
      return steps;
    }
    case "apng":
      return [cap(fps), 24, 20, 15, 12, 10].filter((r) => r <= cap(fps)).map((r) => ({ fps: r }));
    case "webp":
      return [80, 65, 50, 35, 20].map((q) => ({ q, fps: cap(fps) }));
    case "webm":
      // crf 24 was tried as the default and rejected: the same quality for 46 to 50% more bytes (docs/07-render-and-export.md).
      return [30, 34, 38, 42, 46, 52].map((crf) => ({ crf, fps: cap(fps) }));
    case "mp4":
      return [18, 23, 28, 33].map((crf) => ({ crf, fps: cap(fps) }));
    case "hevc":
      return [65, 50, 35].map((q) => ({ q, fps: cap(fps) }));
    default:
      return [{ fps: cap(fps) }];
  }
}

/** The largest default GIF in bytes before the frame rate is halved. A size budget, not a platform limit. */
export const GIF_BUDGET_BYTES = 6 * 1024 * 1024;

/**
 * GIF steps when no destination sets a size limit: the nearest exact GIF rate (50 for a 60 fps scene), then 25
 * if the first file is over `GIF_BUDGET_BYTES`.
 */
export function gifLadder(fps: number, maxFps: number): Quality[] {
  const top = nearestGifRate(Math.min(fps, maxFps));
  return (top > 25 ? [top, 25] : [top]).map((r) => ({ fps: r, colors: 256 }));
}

// ------------------------------------------------------------------ ffmpeg arguments

/** RGB frames to limited-range BT.709 YUV, which is what players assume for HD. ffmpeg's own default is BT.601, which shifts colours. */
const TO_709 = "scale=out_color_matrix=bt709:out_range=tv";
/**
 * Tags that say so, so the player does not have to guess. Set on the frames in the filter chain: the
 * -colorspace and -color_primaries output options alone wrote only the matrix, not primaries or transfer.
 */
const TAG_709 = "setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv";

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

function chain(...parts: string[]): string {
  return parts.filter((s) => s !== "").join(",");
}

/**
 * The ffmpeg arguments for one frame format. Frames are `<dir>/f_%04d.png` at `p.fps`.
 * The recipes were verified in phase 4 on ffmpeg 7.1.1 (see `docs/07-render-and-export.md`).
 */
export function encodeArgs(f: FormatId, p: Plan, q: Quality, frames: string, out: string, opts: { transparentGif: boolean }): string[] {
  const input = ["-framerate", num(p.fps), "-i", frames];
  const rate = q.fps !== undefined && q.fps !== p.fps ? `fps=${num(q.fps)}` : "";
  switch (f) {
    case "gif": {
      const colors = q.colors ?? 256;
      const r = `fps=${num(q.fps ?? 25)}`;
      if (opts.transparentGif) {
        const geo = geometry(p, true);
        const g = chain(geo, r);
        return [...input, "-filter_complex", `[0:v]${g},split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full:max_colors=${colors}[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:alpha_threshold=128`, "-gifflags", "-offsetting", "-loop", "0", out];
      }
      const geo = geometry(p, false);
      return ["-f", "lavfi", "-i", `color=c=${p.bg}:s=${p.fw}x${p.fh}:r=${num(p.fps)}`, ...input, "-filter_complex", `[1:v]${geo === "" ? "null" : geo}[g];[0:v][g]overlay=shortest=1,${r},split[a][b];[a]palettegen=stats_mode=full:max_colors=${colors}[p];[b][p]paletteuse=dither=sierra2_4a`, "-loop", "0", out];
    }
    case "apng": {
      const vf = chain(geometry(p, true), rate);
      return [...input, ...(vf ? ["-vf", vf] : []), "-plays", "0", "-pred", "mixed", out];
    }
    case "webp": {
      const vf = chain(geometry(p, true), rate);
      // Do not set -compression_level: 6 ran for over three minutes on 90 frames in testing.
      return [...input, ...(vf ? ["-vf", vf] : []), "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", String(q.q ?? 80), "-loop", "0", out];
    }
    case "webm": {
      const vf = chain(geometry(p, true), rate, TO_709, "format=yuva420p", TAG_709);
      return [...input, ...(vf ? ["-vf", vf] : []), "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", String(q.crf ?? 30), "-row-mt", "1", "-auto-alt-ref", "0", "-an", out];
    }
    case "prores": {
      const vf = chain(geometry(p, true), rate, TO_709, "format=yuva444p10le", TAG_709);
      return [...input, "-vf", vf, "-c:v", "prores_ks", "-profile:v", "4444", "-alpha_bits", "16", "-vendor", "apl0", "-an", out];
    }
    case "hevc": {
      const vf = chain(geometry(p, true), rate);
      return [...input, ...(vf ? ["-vf", vf] : []), "-c:v", "hevc_videotoolbox", "-allow_sw", "1", "-alpha_quality", "0.75", "-q:v", String(q.q ?? 65), "-tag:v", "hvc1", "-pix_fmt", "bgra", "-an", out];
    }
    case "mp4": {
      const geo = geometry(p, false);
      return ["-f", "lavfi", "-i", `color=c=${p.bg}:s=${p.fw}x${p.fh}:r=${num(p.fps)}`, ...input, "-filter_complex", `[1:v]${geo === "" ? "null" : geo}[g];[0:v][g]overlay=shortest=1:format=rgb,${chain(rate, TO_709, "format=yuv420p", TAG_709)}`, "-c:v", "libx264", "-crf", String(q.crf ?? 18), "-preset", "slow", "-tune", "animation", "-movflags", "+faststart", "-an", out];
    }
    default:
      throw new Error(`${f} is not a frame format`);
  }
}
