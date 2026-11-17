import type { Raster } from "../trace/quantize.ts";

/** Where the subject of one frame is, as fractions of the frame (0 to 1). */
export interface FrameStat {
  t: number;
  /** Centre of the moving subject. */
  cx: number;
  cy: number;
  /** Width and height of its bounding box. */
  w: number;
  h: number;
  /** Share of the frame it covers. */
  area: number;
}

export type Background = { kind: "transparent" } | { kind: "colour"; rgb: [number, number, number] } | { kind: "median"; ref: Raster };

/**
 * The background as the per-pixel median over time of up to 31 evenly spaced frames. Anything that stays put (a floor, a wall, a logo)
 * is part of it, so only what changes counts as the subject. It fails when the whole picture moves, such as a camera move.
 */
export function medianBackground(frames: readonly Raster[]): Background {
  const first = frames[0] as Raster;
  const pick: Raster[] = [];
  const step = Math.max(1, Math.floor(frames.length / 31));
  for (let i = 0; i < frames.length; i += step) pick.push(frames[i] as Raster);
  const out = new Uint8ClampedArray(first.w * first.h * 4);
  const col = new Array<number>(pick.length);
  for (let i = 0; i < out.length; i++) {
    for (let k = 0; k < pick.length; k++) col[k] = (pick[k] as Raster).data[i] as number;
    col.sort((a, b) => a - b);
    out[i] = col[col.length >> 1] as number;
  }
  return { kind: "median", ref: { w: first.w, h: first.h, data: out } };
}

/** The background of a clip: transparent if the edges are, otherwise the most common colour around the border of the frame. */
export function estimateBackground(r: Raster): Background {
  const counts = new Map<number, { n: number; rgb: [number, number, number] }>();
  let transparent = 0;
  let total = 0;
  const visit = (x: number, y: number): void => {
    const i = (y * r.w + x) * 4;
    total++;
    if ((r.data[i + 3] as number) < 128) {
      transparent++;
      return;
    }
    const rgb: [number, number, number] = [r.data[i] as number, r.data[i + 1] as number, r.data[i + 2] as number];
    const key = ((rgb[0] >> 3) << 10) | ((rgb[1] >> 3) << 5) | (rgb[2] >> 3);
    const e = counts.get(key);
    if (e) e.n++;
    else counts.set(key, { n: 1, rgb });
  };
  for (let x = 0; x < r.w; x++) {
    visit(x, 0);
    visit(x, r.h - 1);
  }
  for (let y = 1; y < r.h - 1; y++) {
    visit(0, y);
    visit(r.w - 1, y);
  }
  if (transparent * 2 > total) return { kind: "transparent" };
  let best: { n: number; rgb: [number, number, number] } | undefined;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return { kind: "colour", rgb: best ? best.rgb : [0, 0, 0] };
}

/** The bounding box, centre and area of everything that differs from the background. Undefined when the frame is empty. */
export function frameStat(r: Raster, bg: Background, t: number, tolerance = 40): FrameStat | undefined {
  let x0 = r.w, y0 = r.h, x1 = -1, y1 = -1, n = 0, sx = 0, sy = 0;
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
    const i = (y * r.w + x) * 4;
    let fg: boolean;
    if (bg.kind === "transparent") fg = (r.data[i + 3] as number) >= 128;
    else if (bg.kind === "median") {
      const d = Math.abs((r.data[i] as number) - (bg.ref.data[i] as number)) + Math.abs((r.data[i + 1] as number) - (bg.ref.data[i + 1] as number)) + Math.abs((r.data[i + 2] as number) - (bg.ref.data[i + 2] as number)) + Math.abs((r.data[i + 3] as number) - (bg.ref.data[i + 3] as number));
      fg = d > tolerance;
    } else {
      const d = Math.abs((r.data[i] as number) - bg.rgb[0]) + Math.abs((r.data[i + 1] as number) - bg.rgb[1]) + Math.abs((r.data[i + 2] as number) - bg.rgb[2]);
      fg = d > tolerance && (r.data[i + 3] as number) >= 128;
    }
    if (!fg) continue;
    n++;
    sx += x;
    sy += y;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  // A few stray pixels are noise, not a subject.
  if (n < r.w * r.h * 0.0004) return undefined;
  return { t, cx: sx / n / r.w, cy: sy / n / r.h, w: (x1 - x0 + 1) / r.w, h: (y1 - y0 + 1) / r.h, area: n / (r.w * r.h) };
}

export type Channel = "x" | "y" | "width" | "height";

export interface Move {
  channel: Channel;
  /** Seconds. */
  from: number;
  to: number;
  duration: number;
  /** Values as fractions of the frame (for x and width of the frame width, for y and height of its height). */
  start: number;
  end: number;
  change: number;
  /** How the speed varies along the move. */
  ease: "starts slow" | "starts fast" | "slow at both ends" | "even";
}

/** A steady small oscillation of one channel, such as a breath or a float. */
export interface Idle {
  channel: Channel;
  /** Seconds: the span it was measured over. */
  start: number;
  end: number;
  /** Half the peak-to-peak size, as a fraction of the frame (or of the crop). */
  amplitude: number;
  /** Seconds for one full cycle. */
  period: number;
}

/** Peak-to-peak sizes below this are the silhouette's edge flickering by a pixel or two, not motion. */
export const IDLE_MIN = 0.004;
/** At or above this a swing is a move, not an idle. */
export const IDLE_MAX = 0.03;
/** An idle has to cross its own middle at least this many times in the span. */
export const IDLE_CROSSINGS = 4;
/** The length of a cycle (every second crossing) varies by less than this share of its mean. A random flicker does not. */
const IDLE_REGULARITY = 0.35;
/** Shortest stretch worth measuring, in seconds. */
const IDLE_MIN_SPAN = 0.5;

export interface Study {
  /** One entry per analysed frame. */
  samples: FrameStat[];
  moves: Move[];
  /** Spans of at least 0.15 seconds where nothing moves. */
  holds: { from: number; to: number }[];
  /** Share of the frame that differs between the first and last frame: near 0 means the clip loops. */
  loopGap?: number;
  /** Steady small oscillations found outside the moves, one per channel and span. */
  idle: Idle[];
}

const value = (s: FrameStat, c: Channel): number => (c === "x" ? s.cx : c === "y" ? s.cy : c === "width" ? s.w : s.h);

function at(samples: readonly FrameStat[], c: Channel, t: number): number {
  if (t <= (samples[0] as FrameStat).t) return value(samples[0] as FrameStat, c);
  const last = samples[samples.length - 1] as FrameStat;
  if (t >= last.t) return value(last, c);
  let i = 1;
  while ((samples[i] as FrameStat).t < t) i++;
  const a = samples[i - 1] as FrameStat;
  const b = samples[i] as FrameStat;
  const k = (t - a.t) / (b.t - a.t);
  return value(a, c) + (value(b, c) - value(a, c)) * k;
}

function smooth(v: readonly number[]): number[] {
  return v.map((_, i) => ((v[Math.max(0, i - 1)] as number) + 2 * (v[i] as number) + (v[Math.min(v.length - 1, i + 1)] as number)) / 4);
}

/**
 * Finds the moves in a sequence of frame statistics: for each channel, stretches between turning points that change by at least
 * `minChange`, with when they happen, how far they go and how the speed varies. Pure.
 */
export function analyzeMotion(samples: readonly FrameStat[], minChange = 0.03): Study {
  const moves: Move[] = [];
  if (samples.length < 3) return { samples: [...samples], moves, holds: [], idle: [] };
  for (const channel of ["x", "y", "width", "height"] as Channel[]) {
    const raw = samples.map((s) => value(s, channel));
    const v = smooth(smooth(raw));
    const threshold = channel === "width" || channel === "height" ? minChange * 0.8 : minChange;
    // Turning points: where the direction of travel changes by more than noise.
    let anchor = 0;
    let dir = 0;
    let extreme = 0;
    const cuts: number[] = [0];
    for (let i = 1; i < v.length; i++) {
      if (dir === 0) {
        if (Math.abs((v[i] as number) - (v[anchor] as number)) >= threshold / 2) {
          dir = Math.sign((v[i] as number) - (v[anchor] as number));
          extreme = i;
        }
      } else if (dir * ((v[i] as number) - (v[extreme] as number)) > 1e-6) extreme = i;
      else if (dir * ((v[i] as number) - (v[extreme] as number)) >= -1e-6) continue;
      else if (dir * ((v[extreme] as number) - (v[i] as number)) >= threshold / 2) {
        cuts.push(extreme);
        anchor = extreme;
        dir = Math.sign((v[i] as number) - (v[extreme] as number));
        extreme = i;
      }
    }
    cuts.push(dir === 0 ? v.length - 1 : extreme);
    for (let c = 0; c + 1 < cuts.length; c++) {
      let i0 = cuts[c] as number;
      const i1 = cuts[c + 1] as number;
      if (i1 <= i0) continue;
      // Start where the motion actually starts: trim the flat lead-in.
      const total = (v[i1] as number) - (v[i0] as number);
      if (Math.abs(total) < threshold) continue;
      while (i0 < i1 - 1 && Math.abs((v[i0 + 1] as number) - (v[i0] as number)) < Math.abs(total) * 0.002) i0++;
      const a = samples[i0] as FrameStat;
      const b = samples[i1] as FrameStat;
      const dur = b.t - a.t;
      if (dur <= 0) continue;
      const start = v[i0] as number;
      const end = v[i1] as number;
      const prog = (f: number): number => (at(samples.map((s, k) => ({ ...s, ...patch(channel, v[k] as number) })), channel, a.t + dur * f) - start) / (end - start);
      const p25 = prog(0.25);
      const p50 = prog(0.5);
      const p75 = prog(0.75);
      let ease: Move["ease"] = "even";
      if (p25 < 0.2 && p75 > 0.8) ease = "slow at both ends";
      else if (p50 < 0.38) ease = "starts slow";
      else if (p50 > 0.62) ease = "starts fast";
      moves.push({ channel, from: round(a.t), to: round(b.t), duration: round(dur), start: round(start), end: round(end), change: round(end - start), ease });
    }
  }
  moves.sort((p, q) => p.from - q.from || p.channel.localeCompare(q.channel));

  // Holds: spans where every channel is still.
  const still: boolean[] = samples.map((s, i) => {
    if (i === 0) return true;
    const p = samples[i - 1] as FrameStat;
    return Math.abs(s.cx - p.cx) < 0.003 && Math.abs(s.cy - p.cy) < 0.003 && Math.abs(s.w - p.w) < 0.004 && Math.abs(s.h - p.h) < 0.004;
  });
  const holds: Study["holds"] = [];
  let start = -1;
  for (let i = 0; i <= samples.length; i++) {
    if (i < samples.length && still[i]) {
      if (start < 0) start = i - 1 < 0 ? 0 : i - 1;
    } else if (start >= 0) {
      const a = (samples[start] as FrameStat).t;
      const b = (samples[i - 1] as FrameStat).t;
      if (b - a >= 0.15) holds.push({ from: round(a), to: round(b) });
      start = -1;
    }
  }
  return { samples: [...samples], moves, holds, idle: findIdle(samples, moves) };
}

/**
 * Finds steady small oscillations. For each channel, the spans are the stretches of the clip outside that channel's moves, which is
 * the whole clip when there are none. In a span, the value must swing between IDLE_MIN and IDLE_MAX peak to peak and cross the middle
 * of its range at least IDLE_CROSSINGS times, at regular intervals. `amplitude` is half the swing and `period` is the mean time from one crossing to the next in the same direction, which is twice the mean time between
 * crossings. Pure.
 */
export function findIdle(samples: readonly FrameStat[], moves: readonly Move[]): Idle[] {
  const out: Idle[] = [];
  if (samples.length < 3) return out;
  const t0 = (samples[0] as FrameStat).t;
  const t1 = (samples[samples.length - 1] as FrameStat).t;
  for (const channel of ["x", "y", "width", "height"] as Channel[]) {
    const busy = moves.filter((m) => m.channel === channel).sort((a, b) => a.from - b.from);
    const spans: [number, number][] = [];
    let cursor = t0;
    for (const m of busy) {
      if (m.from > cursor) spans.push([cursor, m.from]);
      cursor = Math.max(cursor, m.to);
    }
    if (t1 > cursor) spans.push([cursor, t1]);
    for (const [a, b] of spans) {
      if (b - a < IDLE_MIN_SPAN) continue;
      const part = samples.filter((s) => s.t >= a - 1e-9 && s.t <= b + 1e-9);
      if (part.length < 8) continue;
      // Smoothed twice, as the moves are, so that a value that rests on the boundary of two pixel levels does not flip back and forth.
      const v = smooth(smooth(part.map((s) => value(s, channel))));
      const hi = Math.max(...v);
      const lo = Math.min(...v);
      const swing = hi - lo;
      if (swing < IDLE_MIN || swing >= IDLE_MAX) continue;
      // Crossings of the middle of the range, with a band so that a sample resting on the line does not count twice.
      const mid = (hi + lo) / 2;
      const band = swing * 0.15;
      const at: number[] = [];
      let side = 0;
      part.forEach((s, i) => {
        const d = (v[i] as number) - mid;
        const now = d > band ? 1 : d < -band ? -1 : 0;
        if (now === 0) return;
        if (side !== 0 && now !== side) at.push(s.t);
        side = now;
      });
      if (at.length < IDLE_CROSSINGS) continue;
      // The time between crossings is half a cycle. It is measured from one crossing to the next in the same direction, as whole
      // cycles, because a value rounded to a few pixel levels spends unequal time above and below its middle, which skews
      // half-cycle gaps but not whole ones. The cycles must also be regular.
      const cycles = at.slice(2).map((t, i) => t - (at[i] as number));
      const cycle = cycles.reduce((p, q) => p + q, 0) / cycles.length;
      const spread = Math.sqrt(cycles.reduce((p, q) => p + (q - cycle) ** 2, 0) / cycles.length);
      if (cycle <= 0 || spread / cycle > IDLE_REGULARITY) continue;
      out.push({ channel, start: round((part[0] as FrameStat).t), end: round((part[part.length - 1] as FrameStat).t), amplitude: round(swing / 2), period: round(cycle) });
    }
  }
  return out.sort((p, q) => p.start - q.start || p.channel.localeCompare(q.channel));
}

function patch(c: Channel, v: number): Partial<FrameStat> {
  return c === "x" ? { cx: v } : c === "y" ? { cy: v } : c === "width" ? { w: v } : { h: v };
}

const round = (n: number): number => Math.round(n * 1000) / 1000;
