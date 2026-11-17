import { spawn } from "node:child_process";
import { requireFfmpeg } from "../export/ffmpeg.ts";

/** A rectangle of the source picture in source pixels. */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RawVideo {
  frames: Uint8Array[];
  cols: number;
  rows: number;
}

/**
 * Decodes a video, GIF or image to RGBA frames of `cols` by `rows` pixels, one pixel per character cell,
 * by piping raw frames out of ffmpeg. With `crop`, ffmpeg crops the source first, before scaling.
 * The picture is scaled with area averaging, so each cell is the mean of its source pixels.
 */
export async function rawFrames(file: string, o: { cols: number; rows: number; fps: number; maxSeconds: number; maxFrames: number; crop?: CropRect }): Promise<RawVideo> {
  requireFfmpeg();
  const args = ["-hide_banner", "-loglevel", "error", "-t", String(o.maxSeconds), "-i", file, "-vf", `${o.crop ? `crop=${o.crop.w}:${o.crop.h}:${o.crop.x}:${o.crop.y},` : ""}fps=${o.fps}:eof_action=pass,scale=${o.cols}:${o.rows}:flags=area,format=rgba`, "-frames:v", String(o.maxFrames), "-f", "rawvideo", "-pix_fmt", "rgba", "-"];
  const chunks: Buffer[] = [];
  let err = "";
  await new Promise<void>((resolve, reject) => {
    const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (d: Buffer) => chunks.push(d));
    p.stderr.on("data", (d: Buffer) => (err += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg could not read ${file} (exit ${code}): ${err.trim().split("\n").slice(-3).join(" | ")}`))));
  });
  const buf = Buffer.concat(chunks);
  const size = o.cols * o.rows * 4;
  if (buf.length === 0 || buf.length % size !== 0) throw new Error(`ffmpeg gave ${buf.length} bytes for ${file}, which is not a whole number of ${o.cols} by ${o.rows} frames`);
  const frames: Uint8Array[] = [];
  for (let at = 0; at < buf.length; at += size) frames.push(buf.subarray(at, at + size));
  return { frames, cols: o.cols, rows: o.rows };
}

const filterChain = (o: { cols: number; rows: number; fps: number; crop?: CropRect }): string => `${o.crop ? `crop=${o.crop.w}:${o.crop.h}:${o.crop.x}:${o.crop.y},` : ""}fps=${o.fps}:eof_action=pass,scale=${o.cols}:${o.rows}:flags=area,format=rgba`;

/**
 * The same frames as `rawFrames`, read as a stream: each frame is yielded as soon as ffmpeg has written it, so a long clip
 * never sits in memory. Stopping early ends the ffmpeg process.
 */
export async function* streamFrames(file: string, o: { cols: number; rows: number; fps: number; maxSeconds: number; maxFrames: number; crop?: CropRect }): AsyncGenerator<Uint8Array> {
  requireFfmpeg();
  const args = ["-hide_banner", "-loglevel", "error", ...(Number.isFinite(o.maxSeconds) ? ["-t", String(o.maxSeconds)] : []), "-i", file, "-vf", filterChain(o), "-frames:v", String(o.maxFrames), "-f", "rawvideo", "-pix_fmt", "rgba", "-"];
  const p = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
  let err = "";
  p.stderr.on("data", (d: Buffer) => (err += d.toString()));
  const closed = new Promise<number | null>((resolve, reject) => {
    p.on("error", reject);
    p.on("close", (code) => resolve(code));
  });
  const size = o.cols * o.rows * 4;
  let buf: Buffer = Buffer.alloc(0);
  let done = false;
  try {
    for await (const chunk of p.stdout as AsyncIterable<Buffer>) {
      buf = buf.length === 0 ? chunk : Buffer.concat([buf, chunk]);
      while (buf.length >= size) {
        yield new Uint8Array(buf.subarray(0, size));
        buf = buf.subarray(size);
      }
    }
    const code = await closed;
    done = true;
    if (code !== 0) throw new Error(`ffmpeg could not read ${file} (exit ${code}): ${err.trim().split("\n").slice(-3).join(" | ")}`);
    if (buf.length !== 0) throw new Error(`ffmpeg gave ${buf.length} bytes more for ${file} than a whole number of ${o.cols} by ${o.rows} frames`);
  } finally {
    if (!done) {
      p.kill("SIGKILL");
      await closed.catch(() => undefined);
    }
  }
}

/** How many frames `streamFrames` gives with these options, found by running the same filters at one pixel per frame. */
export async function countFrames(file: string, o: { fps: number; maxSeconds: number; maxFrames: number; crop?: CropRect }): Promise<number> {
  let n = 0;
  for await (const _ of streamFrames(file, { ...o, cols: 1, rows: 1 })) n++;
  return n;
}
