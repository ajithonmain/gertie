import { bezierProgress } from "../presets/easing.ts";
import { DEFAULT_RAMP } from "./convert.ts";
import { applyFx, typeDuration } from "./fx.ts";
import { layeredIntervals, type NAscii, type NAsciiFrame, type NAsciiLayer, type NLayerKey } from "./types.ts";

/** Where a layer's top-left cell is on the scene grid. */
export interface CellPos {
  col: number;
  row: number;
}

type Frames = AsyncIterable<NAsciiFrame> | Iterable<NAsciiFrame>;

/**
 * Composites one frame from the frames of the layers, in order, later on top. A space is transparent; a non-space cell replaces
 * the cell under it, its colour and background included. Cells that fall outside the `cols` by `rows` grid are dropped.
 * A null entry is a layer that is not there at this moment. The result has a hold of 1.
 */
export function flatten(layerFrames: readonly (NAsciiFrame | null)[], positions: readonly CellPos[], cols: number, rows: number): NAsciiFrame {
  const cells: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  const colors: (string | null)[][] = Array.from({ length: rows }, () => new Array<string | null>(cols).fill(null));
  const backs: (string | null)[][] = Array.from({ length: rows }, () => new Array<string | null>(cols).fill(null));
  let anyColor = false;
  let anyBack = false;
  layerFrames.forEach((f, i) => {
    if (!f) return;
    const p = positions[i] ?? { col: 0, row: 0 };
    for (let r = 0; r < f.cells.length; r++) {
      const R = p.row + r;
      if (R < 0 || R >= rows) continue;
      const src = f.cells[r] as string[];
      for (let c = 0; c < src.length; c++) {
        const C = p.col + c;
        if (C < 0 || C >= cols) continue;
        const ch = src[c] as string;
        if (ch === " ") continue;
        (cells[R] as string[])[C] = ch;
        const colour = f.colors?.[r]?.[c] ?? null;
        const back = f.backgrounds?.[r]?.[c] ?? null;
        (colors[R] as (string | null)[])[C] = colour;
        (backs[R] as (string | null)[])[C] = back;
        if (colour !== null) anyColor = true;
        if (back !== null) anyBack = true;
      }
    }
  });
  return { cells, colors: anyColor ? colors : null, backgrounds: anyBack ? backs : null, hold: 1 };
}

/**
 * The position of a layer at `t` seconds: keys interpolated with the easing of the key a stretch starts from (linear by default,
 * `hold` steps), rounded to whole cells. Before the first key and after the last the layer stays at that key. No keys: 0, 0.
 */
export function positionAt(keys: readonly NLayerKey[], t: number): CellPos {
  const first = keys[0];
  if (!first) return { col: 0, row: 0 };
  if (t <= first.t) return { col: Math.round(first.col), row: Math.round(first.row) };
  for (let i = 0; i + 1 < keys.length; i++) {
    const a = keys[i] as NLayerKey;
    const b = keys[i + 1] as NLayerKey;
    if (t >= b.t) continue;
    if (a.ease === "hold") return { col: Math.round(a.col), row: Math.round(a.row) };
    const p = bezierProgress(a.ease, (t - a.t) / (b.t - a.t));
    return { col: Math.round(a.col + (b.col - a.col) * p), row: Math.round(a.row + (b.row - a.row) * p) };
  }
  const last = keys[keys.length - 1] as NLayerKey;
  return { col: Math.round(last.col), row: Math.round(last.row) };
}

/** The first interval at or after `seconds`, kept within 0 to `n`. */
const intervalAt = (seconds: number, fps: number, n: number): number => Math.max(0, Math.min(n, Math.ceil(seconds * fps - 1e-9)));

const EMPTY: NAsciiFrame = { cells: [], colors: null, backgrounds: null, hold: 1 };

/** A frame with the cells that have no colour of their own given `color`. */
function painted(f: NAsciiFrame, color: string): NAsciiFrame {
  return { ...f, colors: f.cells.map((row, r) => row.map((_, c) => f.colors?.[r]?.[c] ?? color)) };
}

/**
 * A layer on the scene's timeline: `n` intervals of frames (counting holds) in scene time. Empty before `from` and from `to` on;
 * in between the layer's own frames from its first, repeated when it loops and its last one held when it does not.
 * `raw` gives one pass over the layer's own frames each time it is called.
 */
export async function* layerTimeline(layer: Pick<NAsciiLayer, "from" | "to" | "loop" | "color">, n: number, fps: number, raw: () => Frames): AsyncGenerator<NAsciiFrame> {
  const k0 = intervalAt(layer.from, fps, n);
  const k1 = Math.max(k0, intervalAt(layer.to, fps, n));
  if (k0 > 0) yield { ...EMPTY, hold: k0 };
  let need = k1 - k0;
  let last: NAsciiFrame | undefined;
  const seen = new Map<NAsciiFrame, NAsciiFrame>();
  const paint = (f: NAsciiFrame): NAsciiFrame => {
    if (layer.color === null) return f;
    let p = seen.get(f);
    if (!p) {
      p = painted(f, layer.color);
      seen.set(f, p);
    }
    return p;
  };
  while (need > 0) {
    let got = false;
    for await (const f of raw()) {
      got = true;
      last = paint(f);
      const h = Math.min(f.hold, need);
      yield { ...last, hold: h };
      need -= h;
      if (need === 0) break;
    }
    if (!got || !layer.loop) break;
    // A recipe layer is converted again on each pass, so its painted frames are new objects; keep the cache from growing.
    seen.clear();
  }
  if (need > 0) yield last ? { ...last, hold: need } : { ...EMPTY, hold: need };
  if (k1 < n) yield { ...EMPTY, hold: n - k1 };
}

/** The layer's `fx` as `applyFx` takes them: a `type` entry carries the time it takes to type the layer's text as its duration. */
export function layerFx(layer: NAsciiLayer): NAsciiLayer["fx"] {
  const text = layer.frames[0];
  return layer.fx.map((e) => (e.effect === "type" && layer.text && text ? { ...e, duration: typeDuration(e, text) } : e));
}

function sameFrame(a: NAsciiFrame, b: NAsciiFrame): boolean {
  const grid = <T>(x: T[][] | null, y: T[][] | null): boolean => {
    if (x === null || y === null) return x === y;
    for (let r = 0; r < x.length; r++) {
      const p = x[r] as T[];
      const q = y[r] as T[];
      for (let c = 0; c < p.length; c++) if (p[c] !== q[c]) return false;
    }
    return true;
  };
  return grid(a.cells, b.cells) && grid(a.colors, b.colors) && grid(a.backgrounds, b.backgrounds);
}

/**
 * Every frame of a scene with layers, before the scene's own `fx`. Each layer is put on the scene's timeline, its `fx` are run on it,
 * and then the layers are flattened interval by interval at their positions. Identical neighbouring frames are folded into one with a
 * longer hold, and the holds add up to the scene's duration at its frame rate. Pure: `raw(layer)` gives one pass over a layer's own
 * frames, which for a layer with a `source` is where the command line's reader is used.
 */
export async function* layeredFrames(s: NAscii, raw: (layer: NAsciiLayer) => Frames, ramp?: string): AsyncGenerator<NAsciiFrame> {
  const layers = s.layers ?? [];
  const n = layeredIntervals(s);
  const its = layers.map((l) => {
    const fx = layerFx(l);
    const timeline = layerTimeline(l, n, s.fps, () => raw(l));
    const stream = fx.length === 0 ? timeline : applyFx(timeline, fx, s.fps, { ramp: l.source?.ramp ?? s.style.ramp ?? ramp ?? DEFAULT_RAMP, cellAspect: s.style.cellAspect, typing: l.text });
    return stream[Symbol.asyncIterator]();
  });
  const cur: (NAsciiFrame | null)[] = layers.map(() => null);
  const left: number[] = layers.map(() => 0);
  let prevFrames: (NAsciiFrame | null)[] = [];
  let prevPos: CellPos[] = [];
  let pending: NAsciiFrame | undefined;
  // A caller may stop early (ascii play --frame stops at the frame it wants), so the layers are closed in a finally: a source layer
  // holds a converter, and for a vector scene a browser, that would otherwise keep the process alive.
  try {
    for (let k = 0; k < n; k++) {
      for (let i = 0; i < its.length; i++) {
        if ((left[i] as number) > 0) continue;
        const next = await (its[i] as AsyncIterator<NAsciiFrame>).next();
        if (next.done) {
          cur[i] = null;
          left[i] = Infinity;
        } else {
          cur[i] = next.value.cells.length === 0 ? null : next.value;
          left[i] = next.value.hold;
        }
      }
      const pos = layers.map((l) => positionAt(l.at, k / s.fps));
      const unchanged = pending !== undefined && cur.every((f, i) => f === prevFrames[i]) && pos.every((p, i) => p.col === prevPos[i]?.col && p.row === prevPos[i]?.row);
      if (pending && unchanged) pending.hold++;
      else {
        const f = flatten(cur, pos, s.cols, s.rows);
        if (pending && sameFrame(pending, f)) pending.hold++;
        else {
          if (pending) yield pending;
          pending = f;
        }
      }
      prevFrames = cur.slice();
      prevPos = pos;
      for (let i = 0; i < left.length; i++) left[i] = (left[i] as number) - 1;
    }
    if (pending) yield pending;
  } finally {
    for (const it of its) await it.return?.(undefined);
  }
}
