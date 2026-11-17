import { rawFrame } from "./ffmpeg.ts";
import { geometry, type FormatId, type Plan } from "./formats.ts";

/** One export check. `checked` is false when the check does not apply to this file, with the reason in `detail`. */
export interface CheckResult {
  name: "frames" | "fringe" | "loop";
  checked: boolean;
  ok: boolean;
  detail: string;
}

/** Largest mean absolute difference, over the colour channels on a 0 to 255 scale, between a decoded frame and its source. */
export const FRAME_MAE_LIMIT = 6;
/** Largest share of pixels that may differ by more than 48 on any channel. Tiny, sharp text in a lossy codec reached 2.9%, so 5% leaves room; a colour shift moves the mean difference far more. */
export const FRAME_BAD_LIMIT = 0.05;
/** Largest mean signed luminance error on edge pixels, on a 0 to 255 scale, before a fringe is reported. */
export const FRINGE_LIMIT = 6;
/** How much larger than the source's own last-to-first difference the decoded one may be, on a 0 to 255 scale. */
export const LOOP_SLACK = 3;
/** Fewest edge pixels the fringe check needs to say anything. */
const MIN_EDGE_PIXELS = 50;

const VIDEO: ReadonlySet<FormatId> = new Set(["mp4", "webm", "prores", "hevc"]);

type Rgb = [number, number, number];

/** Premultiplied or straight RGBA over a solid colour, as RGB bytes. */
function over(rgba: Buffer, i: number, bg: Rgb, out: Rgb): void {
  const a = (rgba[i + 3] as number) / 255;
  for (let c = 0; c < 3; c++) out[c] = (rgba[i + c] as number) * a + bg[c as 0 | 1 | 2] * (1 - a);
}

export interface FrameDiff {
  /** Mean absolute difference per colour channel, 0 to 255. */
  mae: number;
  /** Share of pixels where any channel differs by more than 48. */
  bad: number;
}

/** Compares two RGBA frames of the same size after laying both on a solid colour. */
export function diffFrames(a: Buffer, b: Buffer, bg: Rgb): FrameDiff {
  const n = Math.min(a.length, b.length) / 4;
  const pa: Rgb = [0, 0, 0];
  const pb: Rgb = [0, 0, 0];
  let sum = 0;
  let bad = 0;
  for (let p = 0; p < n; p++) {
    over(a, p * 4, bg, pa);
    over(b, p * 4, bg, pb);
    let worst = 0;
    for (let c = 0; c < 3; c++) {
      const d = Math.abs((pa[c] as number) - (pb[c] as number));
      sum += d;
      worst = Math.max(worst, d);
    }
    if (worst > 48) bad++;
  }
  return { mae: sum / (n * 3), bad: bad / n };
}

const lum = (c: Rgb): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Mean signed luminance error (decoded minus source) over the partly transparent pixels of the source, laid on
 * `bg`. Counts the edge pixels it used. A premultiplication error makes edge pixels too dark over white and
 * too light over black.
 */
export function edgeBias(src: Buffer, dec: Buffer, bg: Rgb): { bias: number; edge: number } {
  const n = Math.min(src.length, dec.length) / 4;
  const ps: Rgb = [0, 0, 0];
  const pd: Rgb = [0, 0, 0];
  let sum = 0;
  let edge = 0;
  for (let p = 0; p < n; p++) {
    const a = src[p * 4 + 3] as number;
    if (a < 8 || a > 247) continue;
    over(src, p * 4, bg, ps);
    over(dec, p * 4, bg, pd);
    sum += lum(pd) - lum(ps);
    edge++;
  }
  return { bias: edge === 0 ? 0 : sum / edge, edge };
}

export interface CheckInput {
  file: string;
  format: FormatId;
  plan: Plan;
  /** Path of the rendered frame with this index, 0 based. */
  framePath: (index: number) => string;
  /** Frames in the rendered sequence, loops included. */
  sourceFrames: number;
  /** Frames in the output file. */
  outputFrames: number;
  /** Frame rate of the output file, and of the rendered sequence. */
  outFps: number;
  srcFps: number;
  /** The scene has a solid background, so every frame is opaque. */
  solid: boolean;
  /** The scene is meant to loop. */
  loops: boolean;
  /** The colour used behind transparency when comparing, as RGB bytes. */
  bg: Rgb;
}

/** The ffmpeg filter that reads a decoded video frame the way a player does: BT.709, limited range. */
const PLAYER_DECODE = "scale=in_color_matrix=bt709:in_range=tv:out_range=pc";

function decode(inp: CheckInput, index: number): Buffer {
  const filter = VIDEO.has(inp.format) ? PLAYER_DECODE : "";
  return rawFrame(inp.file, { ...(inp.format === "webm" ? { decoder: "libvpx-vp9" } : {}), ...(filter ? { filter } : {}), index });
}

function source(inp: CheckInput, index: number): Buffer {
  const filter = [geometry(inp.plan, true), "format=rgba"].filter((s) => s !== "").join(",");
  return rawFrame(inp.framePath(index), { filter });
}

/**
 * Checks of the encoded file against the frames it was made from, for the video formats:
 * 1. the first, middle and last decoded frames match the rendered frames,
 * 2. transparent formats show no dark or light fringe on anti-aliased edges,
 * 3. a looping scene still loops: the decoded last frame is no further from the first than the rendered one is.
 */
export function runChecks(inp: CheckInput): CheckResult[] {
  const out: CheckResult[] = [];
  if (!VIDEO.has(inp.format)) return out;
  const alphaDecodable = inp.format === "webm" || inp.format === "prores";
  const opaque = inp.solid || inp.format === "mp4";
  const frames: CheckResult = { name: "frames", checked: true, ok: true, detail: "" };

  // A resampled frame rate or a format whose alpha cannot be decoded does not line up with the rendered frames.
  let skip: string | undefined;
  if (Math.abs(inp.outFps - inp.srcFps) > 1e-6) skip = `the frame rate was lowered to ${inp.outFps}, so output frames do not line up one to one with the rendered ones`;
  else if (!alphaDecodable && !opaque) skip = "ffmpeg cannot decode the alpha layer of this format, so a transparent file cannot be compared";
  else if (inp.outputFrames < 1) skip = "the file has no frames";
  if (skip) {
    out.push({ name: "frames", checked: false, ok: true, detail: skip });
    out.push({ name: "fringe", checked: false, ok: true, detail: skip });
    out.push({ name: "loop", checked: false, ok: true, detail: skip });
    return out;
  }

  const last = inp.outputFrames - 1;
  const picks = [...new Set([0, Math.floor(last / 2), last])];
  const worst: FrameDiff = { mae: 0, bad: 0 };
  const dec: Record<number, Buffer> = {};
  const src: Record<number, Buffer> = {};
  for (const i of picks) {
    dec[i] = decode(inp, i);
    src[i] = source(inp, Math.min(i, inp.sourceFrames - 1));
    const d = diffFrames(src[i] as Buffer, dec[i] as Buffer, inp.bg);
    worst.mae = Math.max(worst.mae, d.mae);
    worst.bad = Math.max(worst.bad, d.bad);
  }
  frames.ok = worst.mae <= FRAME_MAE_LIMIT && worst.bad <= FRAME_BAD_LIMIT;
  frames.detail = `frames ${picks.join(", ")}: mean difference ${worst.mae.toFixed(2)} of 255 (limit ${FRAME_MAE_LIMIT}), ${(worst.bad * 100).toFixed(2)}% of pixels off by more than 48 (limit ${FRAME_BAD_LIMIT * 100}%)${frames.ok ? "" : ". The colours shifted or the compression is too heavy"}`;
  out.push(frames);

  // Fringe: only transparent files have edges that blend with nothing.
  if (opaque) out.push({ name: "fringe", checked: false, ok: true, detail: "the file is opaque, so there is no edge blending to check" });
  else {
    const i = picks[Math.min(1, picks.length - 1)] as number;
    const white = edgeBias(src[i] as Buffer, dec[i] as Buffer, [255, 255, 255]);
    const black = edgeBias(src[i] as Buffer, dec[i] as Buffer, [0, 0, 0]);
    if (white.edge < MIN_EDGE_PIXELS) out.push({ name: "fringe", checked: false, ok: true, detail: `only ${white.edge} anti-aliased edge pixels in frame ${i}, too few to judge` });
    else {
      const ok = white.bias >= -FRINGE_LIMIT && black.bias <= FRINGE_LIMIT;
      out.push({ name: "fringe", checked: true, ok, detail: `${white.edge} edge pixels in frame ${i}: luminance error ${white.bias.toFixed(2)} over white (dark fringe below -${FRINGE_LIMIT}), ${black.bias.toFixed(2)} over black (light fringe above ${FRINGE_LIMIT})` });
    }
  }

  if (!inp.loops) out.push({ name: "loop", checked: false, ok: true, detail: "the scene does not loop" });
  else if (last === 0) out.push({ name: "loop", checked: false, ok: true, detail: "the file has one frame" });
  else {
    // The rendered loop closes on the last rendered frame, not on whichever frame the file happens to end at.
    const srcGap = diffFrames(src[0] as Buffer, source(inp, inp.sourceFrames - 1), inp.bg).mae;
    const decGap = diffFrames(dec[0] as Buffer, dec[last] as Buffer, inp.bg).mae;
    const ok = decGap <= srcGap + LOOP_SLACK;
    out.push({ name: "loop", checked: true, ok, detail: `last-to-first difference ${decGap.toFixed(2)} in the file against ${srcGap.toFixed(2)} in the rendered frames (allowed excess ${LOOP_SLACK})` });
  }
  return out;
}
