import { parseHex } from "../spec/color.ts";
import { mulberry32 } from "./gen.ts";
import { CELL_ASPECT, DEFAULT_BACKGROUND, DEFAULT_COLOR } from "./types.ts";

/** Dark to light. */
export const DEFAULT_RAMP = " .:-=+*#%@";

export interface ConvertOptions {
  /** Characters from empty to full. */
  ramp: string;
  /** Flip the ramp, for dark text on a light background. Applies to brightness mode only. */
  invert: boolean;
  /** Keep each cell's colour from the source. */
  color: boolean;
  /**
   * `luma`: brightness decides the character (photos and video).
   * `alpha`: coverage decides it (a drawing on transparency).
   * `distance`: difference from a known background colour decides it (a drawing on a solid colour).
   */
  mode: "luma" | "alpha" | "distance";
  /** Background colour for `distance` mode, 0 to 255. */
  background?: [number, number, number];
}

export interface Converted {
  cells: string[][];
  colors: (string | null)[][] | null;
  /** Cell fills, set by `--cell-bg`. Null when there are none. */
  backgrounds?: (string | null)[][] | null;
}

/** A raster of straight (not premultiplied) RGBA pixels. */
export interface Raster {
  w: number;
  h: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Rows that keep the proportions of a source `w` by `h` when drawn with `cols` columns. */
export function rowsForAspect(w: number, h: number, cols: number, cellAspect: number = CELL_ASPECT): number {
  return Math.max(1, Math.round((cols * h) / w / cellAspect));
}

/** Averages a raster down to `cols` by `rows` cells, weighting colour by alpha. Returns straight RGBA, 4 bytes per cell. */
export function downsample(r: Raster, cols: number, rows: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(cols * rows * 4);
  for (let cy = 0; cy < rows; cy++) {
    const y0 = Math.floor((cy * r.h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * r.h) / rows));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.floor((cx * r.w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * r.w) / cols));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let n = 0;
      for (let y = y0; y < y1 && y < r.h; y++) {
        for (let x = x0; x < x1 && x < r.w; x++) {
          const i = (y * r.w + x) * 4;
          const a = r.data[i + 3] as number;
          sr += (r.data[i] as number) * a;
          sg += (r.data[i + 1] as number) * a;
          sb += (r.data[i + 2] as number) * a;
          sa += a;
          n++;
        }
      }
      const o = (cy * cols + cx) * 4;
      if (sa > 0) {
        out[o] = sr / sa;
        out[o + 1] = sg / sa;
        out[o + 2] = sb / sa;
      }
      out[o + 3] = n === 0 ? 0 : sa / n;
    }
  }
  return out;
}

const hex = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
/** Cell colours are rounded to 8 levels per channel, which keeps runs of one colour long and the SVG small. */
const qhex = (n: number): string => hex(Math.min(255, Math.round(n / 32) * 32));

/** Named ramps, dark to light. A `--ramp` value equal to one of these names selects it; anything else is a literal ramp. */
export const NAMED_RAMPS: Readonly<Record<string, string>> = {
  standard: DEFAULT_RAMP,
  long: " .'`^\",:;Il!i><~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  blocks: " \u2591\u2592\u2593\u2588",
  dots: " \u00b7\u2219\u2022\u25cf",
  binary: " 01",
  digits: " 1732456908",
  bands: " /1X\u25cf",
};

/** The ramp a `--ramp` value stands for: a named ramp, or the value itself. */
export function resolveRamp(value: string): string {
  return Object.prototype.hasOwnProperty.call(NAMED_RAMPS, value) ? (NAMED_RAMPS[value] as string) : value;
}

/** Controls applied by `convertClip` on top of the basic options. Every field is optional; with none set the output is the phase 8 output. */
export interface ConvertControls {
  /** Stretch the 2nd to 98th percentile of the whole clip to 0 to 1. */
  normalize?: boolean;
  /** Power applied to the value after normalising. Default 1. */
  gamma?: number;
  /** Values under this (0 to 1) become spaces. Default 0. */
  threshold?: number;
  /** Cells within 40 (of 441) of this colour become spaces. `auto` takes the median colour of the outer ring of cells of the first frame. */
  key?: "auto" | RGB;
  /** Levels per channel for cell colours, 2 to 32. Left out: the phase 8 rounding (steps of 32). */
  colorLevels?: number;
  /** Each coloured cell takes the nearest of these colours. */
  palette?: RGB[];
  /** One hue, scaled by the cell value from 35 to 100 percent. */
  tint?: RGB;
  /** Characters used in place of a ramp: a stable hash of column, row and seed picks one per cell. Brightness then shows through colour only. */
  chars?: string;
  seed?: number;
  /** With `chars`: the fraction of non-empty cells that take another character on each frame. */
  shimmer?: number;
  /** 4 by 4 Bayer offset of up to half a ramp step before the character is picked. */
  dither?: "ordered";
  /** Cells whose value differs from a 4-neighbour by more than 0.35 take this colour. */
  edgeColor?: RGB;
  /** 0 to 1: every non-empty cell gets a background of its own colour at this brightness. */
  cellBg?: number;
  /** The colour a cell has when it has no colour of its own (the style colour), used by `cellBg`. */
  cellBgBase?: RGB;
}

export type RGB = [number, number, number];

export const KEY_DISTANCE = 40;
export const EDGE_STEP = 0.35;

/** A repeatable number in [0, 1) from integers, using mulberry32 seeded by mixing the parts. No Math.random anywhere. */
export function cellHash(...parts: number[]): number {
  let s = 0x9e3779b9;
  for (const p of parts) s = Math.imul(s ^ (p | 0), 0x85ebca6b) ^ (s >>> 13);
  return mulberry32(s >>> 0)();
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

const dist3 = (a: RGB, b: RGB): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Median colour of the outermost ring of cells. This is what `--key auto` takes as the background. */
export function ringMedian(px: ArrayLike<number>, cols: number, rows: number): RGB {
  const ch: number[][] = [[], [], []];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (r !== 0 && r !== rows - 1 && c !== 0 && c !== cols - 1) continue;
      const i = (r * cols + c) * 4;
      for (let k = 0; k < 3; k++) (ch[k] as number[]).push(px[i + k] as number);
    }
  }
  const med = (a: number[]): number => {
    a.sort((x, y) => x - y);
    return a[Math.floor(a.length / 2)] as number;
  };
  return [med(ch[0] as number[]), med(ch[1] as number[]), med(ch[2] as number[])];
}

/** Crops a raster to the rectangle `x, y, w, h` (clamped to the raster). Used for vector scenes; media goes through ffmpeg. */
export function cropRaster(r: Raster, x: number, y: number, w: number, h: number): Raster {
  const x0 = Math.max(0, Math.min(r.w - 1, Math.round(x)));
  const y0 = Math.max(0, Math.min(r.h - 1, Math.round(y)));
  const cw = Math.max(1, Math.min(r.w - x0, Math.round(w)));
  const ch = Math.max(1, Math.min(r.h - y0, Math.round(h)));
  const data = new Uint8ClampedArray(cw * ch * 4);
  for (let row = 0; row < ch; row++) {
    const from = ((y0 + row) * r.w + x0) * 4;
    data.set(r.data.subarray(from, from + cw * 4), row * cw * 4);
  }
  return { w: cw, h: ch, data };
}

/** The 0 to 1 value of one cell, as in phase 8. */
function baseValue(R: number, G: number, B: number, A: number, o: ConvertOptions): number {
  const lum = (0.2126 * R + 0.7152 * G + 0.0722 * B) / 255;
  if (o.mode === "alpha") return A < 0.04 ? 0 : A * (0.4 + 0.6 * lum);
  if (o.mode === "distance") {
    const bg = o.background ?? [0, 0, 0];
    const d = Math.min(1, Math.hypot(R - bg[0], G - bg[1], B - bg[2]) / 220);
    return d < 0.08 ? 0 : d;
  }
  if (A < 0.04) return 0;
  return o.invert ? 1 - lum : lum;
}

/** Colour of a cell when colour is on: palette, then tint, then the source colour. */
function cellColor(R: number, G: number, B: number, d: number, o: ConvertOptions & ConvertControls): string {
  if (o.palette && o.palette.length > 0) {
    let best = o.palette[0] as RGB;
    let bd = Infinity;
    for (const p of o.palette) {
      const k = dist3([R, G, B], p);
      if (k < bd) {
        bd = k;
        best = p;
      }
    }
    return `#${hex(best[0])}${hex(best[1])}${hex(best[2])}`;
  }
  if (o.tint) {
    const f = 0.35 + 0.65 * d;
    return `#${hex(o.tint[0] * f)}${hex(o.tint[1] * f)}${hex(o.tint[2] * f)}`;
  }
  if (o.colorLevels !== undefined) {
    const q = (n: number): string => hex((Math.round((n / 255) * (o.colorLevels as number - 1)) / (o.colorLevels as number - 1)) * 255);
    return `#${q(R)}${q(G)}${q(B)}`;
  }
  return `#${qhex(R)}${qhex(G)}${qhex(B)}`;
}

/**
 * What converting a clip needs to know about the whole clip: the key colour (from the first frame with `--key auto`)
 * and the normalising range (from every frame). Built by `startClip`, `addToClip` and `finishClip`, so a clip can be
 * converted as a stream: one pass to gather the range when normalising, then one pass that converts frame by frame.
 */
export interface ClipState {
  cols: number;
  rows: number;
  keyColor: RGB | null;
  /** Set once the key colour has been taken (from the first frame, for `auto`). */
  keyTaken: boolean;
  hist: number[];
  total: number;
  lo: number;
  span: number;
}

/** A fresh clip state. With a fixed key colour the key is known at once; with `auto` it is taken from the first frame given to `addToClip` or `convertFrame`. */
export function startClip(cols: number, rows: number, o: ConvertOptions & ConvertControls): ClipState {
  return { cols, rows, keyColor: o.key === "auto" ? null : (o.key ?? null), keyTaken: o.key !== "auto", hist: new Array<number>(256).fill(0), total: 0, lo: 0, span: 0 };
}

function takeKey(st: ClipState, px: ArrayLike<number>): void {
  if (!st.keyTaken) {
    st.keyColor = ringMedian(px, st.cols, st.rows);
    st.keyTaken = true;
  }
}

const isKeyed = (st: ClipState, px: ArrayLike<number>, i: number): boolean => st.keyColor !== null && dist3([px[i] as number, px[i + 1] as number, px[i + 2] as number], st.keyColor) <= KEY_DISTANCE;

/** Adds one frame to the normalising histogram. Only needed when `normalize` is on. */
export function addToClip(st: ClipState, px: ArrayLike<number>, o: ConvertOptions & ConvertControls): void {
  takeKey(st, px);
  const n = st.cols * st.rows;
  for (let c = 0; c < n; c++) {
    const i = c * 4;
    if (isKeyed(st, px, i)) continue;
    const A = (px[i + 3] as number) / 255;
    if (A < 0.04 && o.mode !== "distance") continue;
    const d = baseValue(px[i] as number, px[i + 1] as number, px[i + 2] as number, A, o);
    const bin = Math.min(255, Math.floor(d * 255.999));
    st.hist[bin] = (st.hist[bin] as number) + 1;
    st.total++;
  }
}

/** Turns the histogram into the 2nd to 98th percentile range. A picture whose range is under one step is left as it is. */
export function finishClip(st: ClipState): void {
  if (st.total === 0) return;
  const at = (q: number): number => {
    let acc = 0;
    for (let b = 0; b < 256; b++) {
      acc += st.hist[b] as number;
      if (acc >= q * st.total) return b / 255;
    }
    return 1;
  };
  const a = at(0.02);
  const b = at(0.98);
  if (b - a >= 1 / 255) {
    st.lo = a;
    st.span = b - a;
  }
}

/**
 * Converts every frame of a clip. Normalising and the automatic key look at the whole clip, so they need all frames at once;
 * everything else is per cell. Order: key, normalise, gamma, threshold, dither, character, colour, edge colour.
 */
export function convertClip(frames: ArrayLike<number>[], cols: number, rows: number, o: ConvertOptions & ConvertControls): Converted[] {
  const st = startClip(cols, rows, o);
  if (frames[0]) takeKey(st, frames[0]);
  // Pass 1 (only with normalise): a 256-bin histogram of cell values over the whole clip.
  if (o.normalize) {
    for (const px of frames) addToClip(st, px, o);
    finishClip(st);
  }
  return frames.map((px, f) => convertFrame(px, f, st, o));
}

/** Converts frame number `f` of a clip, given the clip state (the key colour and, when normalising, the finished range). Pure. */
export function convertFrame(px: ArrayLike<number>, f: number, st: ClipState, o: ConvertOptions & ConvertControls): Converted {
  const chars = o.chars !== undefined ? [...o.chars] : null;
  const ramp = [...o.ramp];
  if (!chars && ramp.length < 2) throw new Error("the ramp needs at least two characters");
  if (chars && chars.length < 1) throw new Error("--chars needs at least one character");
  takeKey(st, px);
  const { cols, rows, lo, span } = st;
  const n = cols * rows;
  const colorOn = !!(o.color || o.palette || o.tint || chars);
  const gamma = o.gamma ?? 1;
  const threshold = o.threshold ?? 0;
  const seed = o.seed ?? 0;
  const keyed = (p: ArrayLike<number>, i: number): boolean => isKeyed(st, p, i);
  const step = ramp.length > 1 ? 1 / (ramp.length - 1) : 1;
  {
    const val = new Float32Array(n);
    const off = new Uint8Array(n);
    for (let c = 0; c < n; c++) {
      const i = c * 4;
      if (keyed(px, i)) {
        off[c] = 1;
        continue;
      }
      let d = baseValue(px[i] as number, px[i + 1] as number, px[i + 2] as number, (px[i + 3] as number) / 255, o);
      if (span > 0) d = Math.max(0, Math.min(1, (d - lo) / span));
      if (gamma !== 1) d = Math.pow(d, gamma);
      if (d < threshold) {
        d = 0;
        off[c] = 1;
      }
      val[c] = d;
    }
    const cells: string[][] = [];
    const colors: (string | null)[][] = [];
    const backs: (string | null)[][] = [];
    let anyColor = false;
    let anyBack = false;
    for (let r = 0; r < rows; r++) {
      const row: string[] = [];
      const crow: (string | null)[] = [];
      const brow: (string | null)[] = [];
      for (let c = 0; c < cols; c++) {
        const k = r * cols + c;
        const i = k * 4;
        const d = val[k] as number;
        let ch: string;
        if (off[k]) ch = " ";
        else if (chars) {
          if (d <= 0) ch = " ";
          else {
            const base = Math.floor(cellHash(c, r, seed) * chars.length);
            ch = chars[base] as string;
            if (o.shimmer && chars.length > 1 && cellHash(c, r, f, seed, 1) < o.shimmer) ch = chars[(base + 1 + Math.floor(cellHash(c, r, f, seed, 2) * (chars.length - 1))) % chars.length] as string;
          }
        } else {
          let v = d;
          if (o.dither === "ordered" && d > 0) v = Math.max(0, Math.min(1, d + (((BAYER4[(r % 4) * 4 + (c % 4)] as number) + 0.5) / 16 - 0.5) * step));
          const idx = v <= 0 ? 0 : Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1)));
          ch = ramp[idx] as string;
        }
        row.push(ch);
        const A = (px[i + 3] as number) / 255;
        let col: string | null = null;
        if (ch !== " ") {
          if (o.edgeColor && isEdge(val, cols, rows, c, r)) col = `#${hex(o.edgeColor[0])}${hex(o.edgeColor[1])}${hex(o.edgeColor[2])}`;
          else if (colorOn && A >= 0.04) col = cellColor(px[i] as number, px[i + 1] as number, px[i + 2] as number, d, o);
        }
        if (col !== null) anyColor = true;
        crow.push(col);
        let back: string | null = null;
        if (o.cellBg !== undefined && o.cellBg > 0 && ch !== " ") {
          const base = col !== null ? (parseHex(col) as number[]).slice(0, 3) : (o.cellBgBase ?? [34, 197, 94]);
          back = `#${hex((base[0] as number) * o.cellBg)}${hex((base[1] as number) * o.cellBg)}${hex((base[2] as number) * o.cellBg)}`;
          anyBack = true;
        }
        brow.push(back);
      }
      cells.push(row);
      colors.push(crow);
      backs.push(brow);
    }
    return { cells, colors: anyColor ? colors : null, ...(anyBack ? { backgrounds: backs } : {}) };
  }
}

function isEdge(val: Float32Array, cols: number, rows: number, c: number, r: number): boolean {
  const v = val[r * cols + c] as number;
  if (c > 0 && Math.abs(v - (val[r * cols + c - 1] as number)) > EDGE_STEP) return true;
  if (c < cols - 1 && Math.abs(v - (val[r * cols + c + 1] as number)) > EDGE_STEP) return true;
  if (r > 0 && Math.abs(v - (val[(r - 1) * cols + c] as number)) > EDGE_STEP) return true;
  if (r < rows - 1 && Math.abs(v - (val[(r + 1) * cols + c] as number)) > EDGE_STEP) return true;
  return false;
}

/** Maps the cell pixels of one frame (straight RGBA, `cols * rows * 4` bytes) to characters. The frame is the whole clip for the clip-wide controls. */
export function cellsFromRgba(px: Uint8ClampedArray | Uint8Array, cols: number, rows: number, o: ConvertOptions & ConvertControls): Converted {
  return convertClip([px], cols, rows, o)[0] as Converted;
}

/** Sensible defaults for the text colours of converted output. */
export function styleFor(o: { invert: boolean; background?: [number, number, number] | null }): { color: string; background: string | null } {
  if (o.background) {
    const [r, g, b] = o.background;
    const bgHex = `#${hex(r)}${hex(g)}${hex(b)}`;
    const light = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.55;
    return { color: light ? "#111827" : DEFAULT_COLOR, background: bgHex };
  }
  if (o.invert) return { color: "#111827", background: "#f8fafc" };
  return { color: DEFAULT_COLOR, background: DEFAULT_BACKGROUND };
}
