import { bezierProgress } from "./easing.ts";
import type { NKey, Subpath, TrackValue, Vec2 } from "../spec/types.ts";

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

const isPaths = (v: TrackValue): v is Subpath[] => Array.isArray(v) && typeof v[0] === "object" && v[0] !== null && !Array.isArray(v[0]);

function lerpPaths(a: Subpath[], b: Subpath[], t: number): Subpath[] {
  const vec = (p: Vec2[], q: Vec2[]): Vec2[] => p.map((u, k) => [lerp(u[0], (q[k] as Vec2)[0], t), lerp(u[1], (q[k] as Vec2)[1], t)]);
  return a.map((sp, n) => {
    const o = b[n] as Subpath;
    return { closed: sp.closed, v: vec(sp.v, o.v), i: vec(sp.i, o.i), o: vec(sp.o, o.o) };
  });
}

/**
 * Samples a keyframe list at a frame. Numbers, vectors and colours are supported.
 * Paths are interpolated vertex by vertex, which needs identical structure in every key (the linter enforces it).
 * The ease of key n describes the segment arriving at key n.
 */
export function sampleKeys(keys: readonly NKey[], frame: number): TrackValue {
  const first = keys[0] as NKey;
  if (frame <= first.t) return first.v;
  const last = keys[keys.length - 1] as NKey;
  if (frame >= last.t) return last.v;
  let i = 1;
  while (i < keys.length && (keys[i] as NKey).t <= frame) i++;
  const a = keys[i - 1] as NKey;
  const b = keys[i] as NKey;
  if (b.ease === "hold") return a.v;
  const x = (frame - a.t) / (b.t - a.t);
  const p = bezierProgress(b.ease, x);
  if (typeof a.v === "number" && typeof b.v === "number") return lerp(a.v, b.v, p);
  if (Array.isArray(a.v) && Array.isArray(b.v) && typeof a.v[0] === "number" && typeof b.v[0] === "number") {
    const av = a.v as number[];
    const bv = b.v as number[];
    return av.map((n, k) => lerp(n, bv[k] as number, p)) as TrackValue;
  }
  if (isPaths(a.v) && isPaths(b.v)) return lerpPaths(a.v, b.v, p);
  return a.v;
}
