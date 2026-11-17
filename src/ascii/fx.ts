import { didYouMean, makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";
import { parseHex } from "../spec/color.ts";
import { cellHash, DEFAULT_RAMP } from "./convert.ts";
import { FX_BY, FX_EFFECTS, type FxBy, type FxEffect, type NAsciiFrame, type NAsciiFx } from "./types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

/** The parameters each effect takes, beside the `effect` name itself. */
export const FX_PARAMS: Readonly<Record<FxEffect, readonly string[]>> = {
  reveal: ["by", "seed", "at", "duration"],
  hide: ["by", "seed", "at", "duration"],
  decode: ["chars", "seed", "at", "duration"],
  shimmer: ["amount", "chars", "seed", "at", "duration"],
  type: ["cps", "at"],
};
const ALL_PARAMS = ["effect", "by", "seed", "chars", "amount", "cps", "at", "duration"];

export const DEFAULT_SHIMMER_AMOUNT = 0.1;
export const DEFAULT_TYPE_CPS = 30;

const hasSpaceOrControl = (s: string): boolean => /\s/.test(s) || [...s].some((c) => (c.codePointAt(0) as number) <= 0x1f || (c.codePointAt(0) as number) === 0x7f);

/**
 * Reads and checks the `fx` list of a scene. Every problem is `E-ASCII-FX`, naming the entry, the field, the problem and the fix,
 * with the nearest valid name for an unknown effect, parameter or `by`.
 */
export function parseFx(raw: unknown, d: Diagnostic[]): NAsciiFx[] {
  const err = (path: string, message: string, fix: string): void => void d.push(makeDiagnostic("E-ASCII-FX", message, fix, { path }));
  if (!Array.isArray(raw)) {
    err("fx", '"fx" must be a list of effects.', 'Use "fx": [{"effect": "reveal", "by": "scatter", "at": 0, "duration": 2}].');
    return [];
  }
  const out: NAsciiFx[] = [];
  raw.forEach((e: unknown, i: number) => {
    const at = `fx[${i}]`;
    const before = d.length;
    if (!isObj(e)) return err(at, `${at} must be an object with an "effect".`, 'Use {"effect": "reveal", "by": "scatter", "duration": 2}.');
    const name = e["effect"];
    if (typeof name !== "string" || !(FX_EFFECTS as readonly string[]).includes(name)) {
      return err(`${at}.effect`, `${at}.effect must be one of ${FX_EFFECTS.join(", ")}, found ${JSON.stringify(name)}.${typeof name === "string" ? didYouMean(name, [...FX_EFFECTS]) : ""}`, `Use one of: ${FX_EFFECTS.join(", ")}.`);
    }
    const effect = name as FxEffect;
    const allowed = FX_PARAMS[effect];
    for (const k of Object.keys(e)) {
      if (k === "effect" || allowed.includes(k)) continue;
      const known = ALL_PARAMS.includes(k);
      err(`${at}.${k}`, known ? `'${k}' is not a parameter of ${effect} (${at}).` : `Unknown parameter '${k}' in ${at}.${didYouMean(k, [...allowed])}`, `Parameters of ${effect}: ${allowed.join(", ")}.`);
    }
    const num = (k: string, min: number, max: number, def: number | undefined, fix: string, whole = false, minExclusive = false): number | undefined => {
      const v = e[k];
      if (v === undefined) return def;
      if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (minExclusive && v === min) || (whole && !Number.isInteger(v))) {
        err(`${at}.${k}`, `${at}.${k} must be ${whole ? "a whole number" : "a number"} ${minExclusive ? "above" : "from"} ${min}${max === Infinity ? "" : ` to ${max}`}, found ${JSON.stringify(v)}.`, fix);
        return def;
      }
      return v;
    };
    const atT = num("at", 0, 100000, 0, "Use the time in seconds at which the effect starts, for example 0.5.") ?? 0;
    const seed = num("seed", 0, 4294967295, 0, "Use any whole number; the same seed gives the same result.", true) ?? 0;
    let duration = 0;
    if (effect !== "type") {
      if (e["duration"] === undefined) err(`${at}.duration`, `${at} (${effect}) has no duration.`, 'Add "duration": 2, the time in seconds that the effect takes.');
      else duration = num("duration", 0, 100000, 0, "Use the time in seconds that the effect takes, above 0, for example 2.", false, true) ?? 0;
    }
    let by: FxBy | undefined;
    if (effect === "reveal" || effect === "hide") {
      const v = e["by"];
      if (v === undefined) by = "scatter";
      else if (typeof v === "string" && (FX_BY as readonly string[]).includes(v)) by = v as FxBy;
      else err(`${at}.by`, `${at}.by must be one of ${FX_BY.join(", ")}, found ${JSON.stringify(v)}.${typeof v === "string" ? didYouMean(v, [...FX_BY]) : ""}`, `Use one of: ${FX_BY.join(", ")}.`);
    }
    let chars: string | undefined;
    if ((effect === "decode" || effect === "shimmer") && e["chars"] !== undefined) {
      const v = e["chars"];
      if (typeof v === "string" && v !== "" && !hasSpaceOrControl(v)) chars = v;
      else err(`${at}.chars`, `${at}.chars must be a set of visible characters without spaces, found ${JSON.stringify(v)}.`, 'Use "chars": "01" or leave it out to use the ramp.');
    }
    const amount = effect === "shimmer" ? num("amount", 0, 1, DEFAULT_SHIMMER_AMOUNT, "Use the fraction of cells (0 to 1) that change on each frame, for example 0.1.") : undefined;
    const cps = effect === "type" ? num("cps", 0, 10000, DEFAULT_TYPE_CPS, "Use characters per second, above 0, for example 30.", false, true) : undefined;
    if (d.length > before) return;
    out.push({
      effect,
      at: atT,
      duration,
      seed,
      ...(by !== undefined ? { by } : {}),
      ...(chars !== undefined ? { chars } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(cps !== undefined ? { cps } : {}),
    });
  });
  return out;
}

/** `E-ASCII-FX` for every effect whose time range is not inside an animation of `seconds`. */
export function checkFxRange(fx: readonly NAsciiFx[], seconds: number): Diagnostic[] {
  const d: Diagnostic[] = [];
  const eps = 1e-6;
  fx.forEach((e, i) => {
    const end = e.effect === "type" ? e.at : e.at + e.duration;
    if (e.at >= seconds - eps || end > seconds + eps) {
      const fix = e.effect === "type" ? `Set "at" to a time before ${round(seconds)}.` : e.at >= seconds - eps ? `Set "at" to a time before ${round(seconds)}.` : `Set "duration" to ${round(Math.max(0, seconds - e.at))} or less, or start earlier.`;
      d.push(makeDiagnostic("E-ASCII-FX", `fx[${i}] (${e.effect}) runs from ${round(e.at)} s to ${round(end)} s, but the animation is ${round(seconds)} s long.`, fix, { path: `fx[${i}]` }));
    }
  });
  return d;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export interface FxOptions {
  /** The ramp the frames were made with. `decode` and `shimmer` roll its characters (without the space) when no `chars` is given, and `bright-first` reads a cell's value from its place in it. Default the standard ramp. */
  ramp?: string;
  /** Height of a cell over its width, so `radial` is round on screen. Default 2. */
  cellAspect?: number;
  /**
   * True for the frames of a text layer: `type` entries are applied, and each must carry the time typing takes as its `duration`
   * (`typeDuration` gives it). Otherwise `type` is passed over.
   */
  typing?: boolean;
}

/** The cells a `type` effect types, in reading order: row by row, each row up to its last non-space cell, spaces inside a row included. */
export function typedCells(f: NAsciiFrame): number {
  let n = 0;
  for (const row of f.cells) {
    let last = row.length - 1;
    while (last >= 0 && row[last] === " ") last--;
    n += last + 1;
  }
  return n;
}

/** The seconds a `type` entry takes to type frame `f` at its `cps`. */
export const typeDuration = (e: NAsciiFx, f: NAsciiFrame): number => typedCells(f) / (e.cps ?? DEFAULT_TYPE_CPS);

/** The cursor of the `type` effect, drawn on the newest typed cell. */
export const TYPE_CURSOR = "\u2588";

type Frames = AsyncIterable<NAsciiFrame> | Iterable<NAsciiFrame>;

// Tags that keep one hash from being reused for another purpose.
const TAG_SCATTER = 1;
const TAG_DECODE_T = 2;
const TAG_DECODE_C = 3;
const TAG_SHIMMER_PICK = 4;
const TAG_SHIMMER_CHAR = 5;

const luma = (hex: string): number => {
  const c = parseHex(hex);
  return c === null ? 1 : (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
};

/**
 * The threshold `t` (0 up to but not including 1) of every cell of a frame for `by`, or null for a cell that is empty.
 * `radial` and `bright-first` look at the frame they are applied to; the others need only the grid.
 */
function thresholds(by: FxBy, f: NAsciiFrame, seed: number, o: Required<FxOptions>): (number | null)[][] {
  const rows = f.cells.length;
  const cols = rows === 0 ? 0 : (f.cells[0] as string[]).length;
  const out: (number | null)[][] = f.cells.map((row) => row.map(() => null));
  const ramp = [...o.ramp];
  let cx = 0;
  let cy = 0;
  let n = 0;
  if (by === "radial") {
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        if ((f.cells[r] as string[])[c] !== " ") {
          cx += c;
          cy += r;
          n++;
        }
    if (n > 0) {
      cx /= n;
      cy /= n;
    }
  }
  let maxD = 0;
  const dist = (c: number, r: number): number => Math.hypot(c - cx, (r - cy) * o.cellAspect);
  if (by === "radial") {
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) if ((f.cells[r] as string[])[c] !== " ") maxD = Math.max(maxD, dist(c, r));
  }
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ch = (f.cells[r] as string[])[c] as string;
      if (ch === " ") continue;
      let t: number;
      switch (by) {
        case "scatter":
          t = cellHash(c, r, seed, TAG_SCATTER);
          break;
        case "rows-up":
          t = (rows - 1 - r) / rows;
          break;
        case "rows-down":
          t = r / rows;
          break;
        case "cols-right":
          t = c / cols;
          break;
        case "cols-left":
          t = (cols - 1 - c) / cols;
          break;
        case "radial":
          t = maxD === 0 ? 0 : Math.min(1, dist(c, r) / maxD);
          break;
        case "bright-first": {
          // The value of a cell: its place in the ramp, or, for a character that is not in it, the brightness of its colour, or full.
          const at = ramp.indexOf(ch);
          const colour = f.colors?.[r]?.[c] ?? null;
          const value = at >= 0 && ramp.length > 1 ? at / (ramp.length - 1) : colour !== null ? luma(colour) : 1;
          t = 1 - value;
          break;
        }
      }
      (out[r] as (number | null)[])[c] = Math.min(t, 1);
    }
  }
  return out;
}

/** A copy of a frame that can be written to. Colours are shared, because an effect never changes them. */
function writable(f: NAsciiFrame): NAsciiFrame {
  return { cells: f.cells.map((row) => row.slice()), colors: f.colors, backgrounds: f.backgrounds ? f.backgrounds.map((row) => row.slice()) : null, hold: f.hold };
}

/** Makes cell (c, r) empty. Its background goes with it, so no fill is left behind; its colour is kept. */
function blank(f: NAsciiFrame, c: number, r: number): void {
  (f.cells[r] as string[])[c] = " ";
  if (f.backgrounds) (f.backgrounds[r] as (string | null)[])[c] = null;
}

interface Window {
  fx: NAsciiFx;
  /** First interval at or after `at`. */
  k0: number;
  /** First interval at or after `at + duration`. */
  k1: number;
}

const windowOf = (fx: NAsciiFx, fps: number): Window => ({ fx, k0: Math.ceil(fx.at * fps - 1e-9), k1: Math.ceil((fx.at + fx.duration) * fps - 1e-9) });

/** One effect on the frame shown during interval `k`. Returns the frame, written to only when something changes. */
function applyOne(f: NAsciiFrame, w: Window, k: number, fps: number, o: Required<FxOptions>, owned: { v: boolean }): NAsciiFrame {
  const e = w.fx;
  const own = (): NAsciiFrame => {
    if (owned.v) return f;
    owned.v = true;
    return writable(f);
  };
  if (e.effect === "type") {
    // Typing: nothing before `at`; then n cells in reading order after n / cps seconds, the newest drawn as the cursor; untouched once all are typed.
    if (!o.typing || k >= w.k1) return f;
    const n = k < w.k0 ? 0 : Math.max(0, Math.floor((k / fps - e.at) * (e.cps ?? DEFAULT_TYPE_CPS) + 1e-9));
    if (n >= typedCells(f)) return f;
    const g = own();
    let i = 0;
    for (let r = 0; r < g.cells.length; r++) {
      const row = g.cells[r] as string[];
      let last = row.length - 1;
      while (last >= 0 && row[last] === " ") last--;
      for (let c = 0; c <= last; c++, i++) {
        if (i >= n) blank(g, c, r);
        else if (i === n - 1) row[c] = TYPE_CURSOR;
      }
    }
    return g;
  }
  const active = k >= w.k0 && k < w.k1;
  const p = active ? Math.max(0, Math.min(1, (k / fps - e.at) / e.duration)) : k < w.k0 ? 0 : 1;
  const rows = f.cells.length;
  const cols = rows === 0 ? 0 : (f.cells[0] as string[]).length;
  const roll = (e.chars !== undefined ? [...e.chars] : [...o.ramp].filter((c) => c !== " ")) as string[];

  if (e.effect === "reveal" || e.effect === "hide") {
    const reveal = e.effect === "reveal";
    // reveal: empty before `at`, untouched after the end. hide: untouched before `at`, empty after the end.
    if (reveal ? k >= w.k1 : k < w.k0) return f;
    const all = reveal ? k < w.k0 : k >= w.k1;
    const t = all ? null : thresholds(e.by ?? "scatter", f, e.seed, o);
    const g = own();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        if ((g.cells[r] as string[])[c] === " ") continue;
        // reveal: empty while p < t. hide: empty once p >= t.
        const th = t === null ? 0 : ((t[r] as (number | null)[])[c] ?? 0);
        if (all || (reveal ? p < th : p >= th)) blank(g, c, r);
      }
    }
    return g;
  }
  // decode and shimmer change the picture only while they run.
  if (!active || roll.length === 0) return f;
  const g = own();
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const cur = (g.cells[r] as string[])[c] as string;
      if (cur === " ") continue;
      if (e.effect === "decode") {
        if (p < cellHash(c, r, e.seed, TAG_DECODE_T)) (g.cells[r] as string[])[c] = roll[Math.floor(cellHash(c, r, k, e.seed, TAG_DECODE_C) * roll.length)] as string;
      } else if (cellHash(c, r, k, e.seed, TAG_SHIMMER_PICK) < (e.amount ?? DEFAULT_SHIMMER_AMOUNT)) {
        // A chosen cell takes another character than the one it has, so the stated fraction really changes on every frame.
        let i = Math.floor(cellHash(c, r, k, e.seed, TAG_SHIMMER_CHAR) * roll.length);
        if (roll[i] === cur) i = (i + 1) % roll.length;
        if (roll[i] !== cur) (g.cells[r] as string[])[c] = roll[i] as string;
      }
    }
  }
  return g;
}

/**
 * Applies a scene's `fx` list, in order, to a stream of frames. Pure: it reads frames as they arrive and yields frames as it can,
 * so it needs no more than the frame it is working on (`radial` and `bright-first` look at that frame only).
 *
 * Time is counted in frame intervals: interval `k` is at `k / fps` seconds, and a frame with a `hold` of n covers n of them.
 * While an effect runs, every interval gets a frame of its own (hold 1), because the picture changes each time; before and after it
 * a held frame stays one frame, so the holds always add up to the length of the input. An effect never changes colours.
 * `type` belongs to text layers: it is applied only with `typing`, and passed over otherwise.
 */
export async function* applyFx(frames: Frames, fx: readonly NAsciiFx[], fps: number, opts: FxOptions = {}): AsyncGenerator<NAsciiFrame> {
  const o: Required<FxOptions> = { ramp: opts.ramp ?? DEFAULT_RAMP, cellAspect: opts.cellAspect ?? 2, typing: opts.typing ?? false };
  const wins = fx.filter((e) => e.effect !== "type" || o.typing).map((e) => windowOf(e, fps));
  if (wins.length === 0) {
    yield* frames;
    return;
  }
  const running = (k: number): boolean => wins.some((w) => k >= w.k0 && k < w.k1);
  let start = 0;
  for await (const f of frames) {
    const end = start + f.hold;
    // Cut the frame where an effect starts or ends, so each piece is either wholly running or wholly not.
    const cuts = new Set<number>([start, end]);
    for (const w of wins) for (const k of [w.k0, w.k1]) if (k > start && k < end) cuts.add(k);
    const points = [...cuts].sort((a, b) => a - b);
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i] as number;
      const b = points[i + 1] as number;
      const step = running(a) ? 1 : b - a;
      for (let k = a; k < b; k += step) {
        const owned = { v: false };
        let g = f;
        for (const w of wins) g = applyOne(g, w, k, fps, o, owned);
        // An untouched frame keeps its own object; a changed one is a copy with the length of this piece.
        yield g === f ? { ...f, hold: step } : { ...g, hold: step };
      }
    }
    start = end;
  }
}

/** The entry of `ascii fx` as it is written to a file: only the fields the effect uses. */
export function fxJson(e: NAsciiFx): Record<string, unknown> {
  return {
    effect: e.effect,
    ...(e.by !== undefined ? { by: e.by } : {}),
    ...(e.chars !== undefined ? { chars: e.chars } : {}),
    ...(e.amount !== undefined ? { amount: e.amount } : {}),
    ...(e.cps !== undefined ? { cps: e.cps } : {}),
    ...(e.seed !== 0 ? { seed: e.seed } : {}),
    at: e.at,
    ...(e.effect !== "type" ? { duration: e.duration } : {}),
  };
}
