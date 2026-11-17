import { spawn, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export class ExportUnavailableError extends Error {
  constructor(
    message: string,
    readonly fix: string,
  ) {
    super(message);
    this.name = "ExportUnavailableError";
  }
}

export interface FfmpegInfo {
  version: string;
  encoders: Set<string>;
}

/** Encoders Gertie uses, and the formats that need them. */
export const ENCODERS = ["gif", "apng", "libwebp_anim", "libvpx-vp9", "prores_ks", "libx264", "hevc_videotoolbox"] as const;

let cached: FfmpegInfo | null | undefined;

/** Finds ffmpeg and lists its encoders by parsing `ffmpeg -encoders`. Null when ffmpeg is not installed. */
export function ffmpegInfo(): FfmpegInfo | null {
  if (cached !== undefined) return cached;
  const v = spawnSync("ffmpeg", ["-hide_banner", "-version"], { encoding: "utf8" });
  if (v.status !== 0) return (cached = null);
  const version = /ffmpeg version (\S+)/.exec(v.stdout)?.[1] ?? "unknown";
  const e = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" });
  const encoders = new Set<string>();
  for (const line of e.stdout.split("\n")) {
    const m = /^\s*[VAS][A-Z.]{5}\s+(\S+)/.exec(line);
    if (m) encoders.add(m[1] as string);
  }
  return (cached = { version, encoders });
}

let filtersCache: Set<string> | undefined;

/** Names of the filters this ffmpeg build has, from `ffmpeg -filters`. Empty when ffmpeg is missing. */
export function ffmpegFilters(): Set<string> {
  if (filtersCache) return filtersCache;
  const out = new Set<string>();
  const r = spawnSync("ffmpeg", ["-hide_banner", "-filters"], { encoding: "utf8" });
  if (r.status === 0) for (const line of r.stdout.split("\n")) {
    const m = /^\s*[T.][S.][C.]\s+(\S+)/.exec(line);
    if (m) out.add(m[1] as string);
  }
  return (filtersCache = out);
}

let drawtextAlign: boolean | undefined;

/** Whether `drawtext` has the `text_align` option (ffmpeg 6.1 and newer), which centres the lines of a wrapped caption. */
export function drawtextHasAlign(): boolean {
  if (drawtextAlign !== undefined) return drawtextAlign;
  const r = spawnSync("ffmpeg", ["-hide_banner", "-h", "filter=drawtext"], { encoding: "utf8" });
  return (drawtextAlign = r.status === 0 && /\btext_align\b/.test(r.stdout));
}

export function requireFfmpeg(): FfmpegInfo {
  const info = ffmpegInfo();
  if (!info) throw new ExportUnavailableError("ffmpeg was not found, so GIF, video and image-sequence formats cannot be produced.", "Install ffmpeg (macOS: brew install ffmpeg; Debian or Ubuntu: apt install ffmpeg) and run: node scripts/gertie.mjs doctor");
  return info;
}

/** Runs ffmpeg and rejects with its last lines of output when it fails. */
export function runFfmpeg(args: readonly string[], opts: { cwd?: string } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], { stdio: ["ignore", "ignore", "pipe"], ...(opts.cwd ? { cwd: opts.cwd } : {}) });
    let err = "";
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (exit ${code}): ${err.trim().split("\n").slice(-4).join(" | ")}`))));
  });
}

/** Decodes one frame of a file (the first unless `index` is given) to raw RGBA, through an optional decoder and video filter. */
export function rawFrame(file: string, opts: { decoder?: string; filter?: string; index?: number } = {}): Buffer {
  const vf = [opts.index ? `select=eq(n\\,${opts.index})` : "", opts.filter ?? ""].filter((x) => x !== "").join(",");
  const args = ["-hide_banner", "-loglevel", "error", ...(opts.decoder ? ["-c:v", opts.decoder] : []), "-i", file, ...(vf ? ["-vf", vf, "-fps_mode", "passthrough"] : []), "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "-"];
  const r = spawnSync("ffmpeg", args, { maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`ffmpeg could not decode ${file}: ${r.stderr.toString().trim().split("\n").slice(-2).join(" | ")}`);
  return r.stdout;
}

export interface Probe {
  width: number;
  height: number;
  frames: number;
  duration: number;
  codec: string;
}

/** Stream facts from ffprobe. Frame count is counted, not read from the header, because GIF and WebP headers lie. */
export function probe(file: string, countFrames = true): Probe {
  const r = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", ...(countFrames ? ["-count_frames"] : []), "-show_entries", "stream=codec_name,width,height,nb_read_frames,nb_frames,duration:format=duration", "-of", "json", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffprobe failed on ${file}: ${r.stderr.trim()}`);
  const j = JSON.parse(r.stdout) as { streams: { codec_name: string; width: number; height: number; nb_read_frames?: string; nb_frames?: string; duration?: string }[]; format: { duration?: string } };
  const s = j.streams[0];
  if (!s) throw new Error(`no video stream in ${file}`);
  return {
    width: s.width,
    height: s.height,
    frames: Number(s.nb_read_frames ?? s.nb_frames ?? 0),
    duration: Number(s.duration ?? j.format.duration ?? 0),
    codec: s.codec_name,
  };
}

/** ffprobe cannot read animated WebP, so read the container: canvas size from the VP8X chunk, frames by counting ANMF chunks. */
export function probeWebp(file: string): Probe {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") throw new Error(`${file} is not a WebP file`);
  let width = 0;
  let height = 0;
  let frames = 0;
  let duration = 0;
  let p = 12;
  while (p + 8 <= b.length) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "VP8X") {
      width = (b.readUIntLE(p + 12, 3) as number) + 1;
      height = (b.readUIntLE(p + 15, 3) as number) + 1;
    } else if (id === "ANMF") {
      frames++;
      duration += b.readUIntLE(p + 8 + 12, 3);
    }
    p += 8 + size + (size % 2);
  }
  return { width, height, frames, duration: duration / 1000, codec: "webp" };
}

export const probeFile = (file: string): Probe => (file.endsWith(".webp") ? probeWebp(file) : probe(file));
