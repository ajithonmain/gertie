import { mirrorEase } from "./ease-expand.ts";
import { resolveEase, splitBezier } from "./easing.ts";
import type { PKey } from "./types.ts";

export type RepeatMode = "loop" | "pingpong";

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Repeated times are sums of floats; rounding keeps 3 x 0.8 at 2.4 and not 2.4000000000000004. */
const tidy = (t: number): number => Math.round(t * 1e6) / 1e6;

export interface Unrolled {
  keys: PKey[];
  /** True when the repeated cycles fill the time up to `end` with no remainder. */
  fits: boolean;
}

/**
 * Repeats a keyframe list until `end` seconds. Only whole cycles are written.
 * `loop` restarts the keys; when the last value differs from the first, the restart happens one frame later, as a hold.
 * `cumulative` instead continues from the last value, so a spin keeps turning.
 * `pingpong` plays the keys forward, then backward, then forward again.
 */
export function unroll(keys: PKey[], mode: RepeatMode, end: number, fps: number, cumulative = false): Unrolled {
  const first = keys[0] as PKey;
  const last = keys[keys.length - 1] as PKey;
  const period = last.t - first.t;
  if (period <= 0) return { keys, fits: false };
  const eps = 0.5 / fps;
  const cycles = Math.floor((end - first.t + eps) / period);
  const remainder = end - first.t - cycles * period;
  const fits = cycles >= 1 && Math.abs(remainder) <= eps;
  if (cycles <= 1) return { keys: keys.map((k) => ({ ...k })), fits };

  const out: PKey[] = keys.map((k) => ({ ...k }));
  const delta = typeof last.v === "number" && typeof first.v === "number" ? last.v - first.v : 0;
  for (let c = 1; c < cycles; c++) {
    const offset = c * period;
    if (mode === "pingpong") {
      const forward = c % 2 === 0;
      const seq = forward ? keys : [...keys].reverse();
      seq.forEach((k, i) => {
        if (i === 0) return;
        const t = tidy(forward ? k.t + offset : first.t + offset + (last.t - k.t));
        // Playing backward, the segment arriving at k leaves k's successor in the original order.
        const src = forward ? k : (keys[keys.length - 1 - i + 1] as PKey);
        const ease = forward ? k.ease : mirrorEase(src.ease);
        out.push(ease === undefined ? { t, v: k.v } : { t, v: k.v, ease });
      });
      continue;
    }
    keys.forEach((k, i) => {
      const v = cumulative && typeof k.v === "number" ? k.v + c * delta : k.v;
      if (i === 0) {
        const prev = out[out.length - 1] as PKey;
        if (same(prev.v, v)) return;
        out.push({ t: tidy(k.t + offset + 1 / fps), v, ease: "hold" });
        return;
      }
      out.push(k.ease === undefined ? { t: tidy(k.t + offset), v } : { t: tidy(k.t + offset), v, ease: k.ease });
    });
  }
  return { keys: out, fits };
}

function mixValues(a: unknown, b: unknown, p: number): unknown {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * p;
  if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((n) => typeof n === "number") && b.every((n) => typeof n === "number")) {
    return (a as number[]).map((n, k) => n + ((b as number[])[k] as number - n) * p);
  }
  return same(a, b) ? a : undefined;
}

/**
 * Starts one cycle of a loop `phase` of the way through (0 to 1), keeping its start time and length.
 * The cycle is cut at that point and the two pieces are swapped, so the motion is the same and only its timing shifts.
 * Returns undefined when the cycle cannot be cut: it does not end where it starts, or the cut falls in a segment
 * whose values or easing cannot be split.
 *
 * With `open`, a cycle that ends on a different value than it starts on is accepted, and the wrap is treated as a
 * jump: the rest of the cycle runs to its last key, one frame later a `hold` key carries the first value, and the
 * start of the cycle follows up to the cut. The jump is only invisible when the node is hidden there, so `open` is
 * for presets that fade out at the end of the cycle and in at its start. A cut within one frame of the wrap returns
 * the keys unchanged.
 */
export function rotateCycle(keys: PKey[], phase: number, fps: number, open = false): PKey[] | undefined {
  const first = keys[0] as PKey;
  const last = keys[keys.length - 1] as PKey;
  const period = last.t - first.t;
  const jump = open && !same(first.v, last.v);
  if (period <= 0 || (!jump && !same(first.v, last.v))) return undefined;
  const cut = first.t + (phase - Math.floor(phase)) * period;
  if (jump && (cut - first.t < 1 / fps || last.t - cut < 1 / fps)) return keys.map((k) => ({ ...k }));
  // One whole frame after the key before it, counted on the frame grid, so that snapping to frames cannot put both on one frame.
  const reset = (t: number): PKey => ({ t: tidy((Math.round(t * fps) + 1) / fps), v: first.v, ease: "hold" });
  // A cut within a frame of a key uses the key, so that no two keys land on one frame.
  const near = keys.findIndex((k) => Math.abs(k.t - cut) < 0.75 / fps);
  const at = (t: number): number => tidy(t >= cut ? t - cut + first.t : t + period - cut + first.t);
  const tail = (from: number, to: number): PKey[] => keys.slice(from, to).map((k) => (k.ease === undefined ? { t: at(k.t), v: k.v } : { t: at(k.t), v: k.v, ease: k.ease }));

  if (near !== -1) {
    if (near === 0 || near === keys.length - 1) return keys.map((k) => ({ ...k }));
    const pivot = keys[near] as PKey;
    const cutAt = pivot.t;
    const shift = (t: number): number => tidy(t > cutAt ? t - cutAt + first.t : t + period - cutAt + first.t);
    const copy = (k: PKey): PKey => (k.ease === undefined ? { t: shift(k.t), v: k.v } : { t: shift(k.t), v: k.v, ease: k.ease });
    const after = keys.slice(near + 1).map(copy);
    const wrap = jump ? [reset((after[after.length - 1] as PKey).t)] : [];
    return [{ t: first.t, v: pivot.v }, ...after, ...wrap, ...keys.slice(1, near + 1).map(copy)];
  }

  const i = keys.findIndex((k) => k.t > cut);
  const a = keys[i - 1] as PKey;
  const b = keys[i] as PKey;
  const x = (cut - a.t) / (b.t - a.t);
  let mid: unknown;
  let left: unknown;
  let right: unknown;
  if (b.ease === "hold") {
    mid = a.v;
    left = "linear";
    right = "hold";
  } else {
    const r = resolveEase(b.ease);
    if (r.kind !== "ok" || r.ease === "hold") return undefined;
    const s = splitBezier(r.ease, x);
    mid = mixValues(a.v, b.v, s.p);
    left = s.left;
    right = s.right;
  }
  if (mid === undefined) return undefined;
  return [
    { t: first.t, v: mid },
    { t: at(b.t), v: b.v, ease: right },
    ...tail(i + 1, keys.length),
    ...(jump ? [reset(at(last.t))] : []),
    ...tail(1, i),
    { t: tidy(first.t + period), v: mid, ease: left },
  ];
}
