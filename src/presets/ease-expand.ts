import { EASINGS, resolveEase, type Bezier } from "./easing.ts";
import type { PKey } from "./types.ts";

export const SPECIAL_EASINGS = ["bounce", "elastic", "spring"] as const;
export type SpecialEase = (typeof SPECIAL_EASINGS)[number];

export function isSpecialEase(v: unknown): v is SpecialEase {
  return typeof v === "string" && (SPECIAL_EASINGS as readonly string[]).includes(v);
}

interface Leg {
  /** Fraction of the segment duration at which the leg ends. */
  at: number;
  /** Progress at the end of the leg: 0 is the start value, 1 is the target. */
  p: number;
  ease: string;
}

/** Bounce: fall to the target, then rebound to 25, 10 and 3 percent of the distance. Leg time grows with the square root of height. */
function bounceLegs(): Leg[] {
  const heights = [0.25, 0.1, 0.03];
  const legs: { w: number; p: number; ease: string }[] = [{ w: 1, p: 1, ease: "easeInQuad" }];
  for (const h of heights) {
    const w = Math.sqrt(h);
    legs.push({ w, p: 1 - h, ease: "easeOutQuad" });
    legs.push({ w, p: 1, ease: "easeInQuad" });
  }
  const total = legs.reduce((a, l) => a + l.w, 0);
  let acc = 0;
  return legs.map((l) => {
    acc += l.w;
    return { at: acc / total, p: l.p, ease: l.ease };
  });
}

const ELASTIC_PEAKS = [1.3, 0.85, 1.07, 0.97, 1];
const ELASTIC_AT = [0.3, 0.5, 0.68, 0.85, 1];
const SPRING_PEAKS = [1.12, 0.96, 1];
const SPRING_AT = [0.45, 0.72, 1];

function legsFor(name: SpecialEase): Leg[] {
  if (name === "bounce") return bounceLegs();
  const peaks = name === "elastic" ? ELASTIC_PEAKS : SPRING_PEAKS;
  const at = name === "elastic" ? ELASTIC_AT : SPRING_AT;
  return peaks.map((p, i) => ({ at: at[i] as number, p, ease: i === 0 ? "easeOutSine" : "easeInOutSine" }));
}

export interface NumericKey {
  t: number;
  v: number | number[];
}

/** True when the value can be interpolated with an overshoot: a number or a list of numbers. */
export function isNumeric(v: unknown): v is number | number[] {
  return (typeof v === "number" && Number.isFinite(v)) || (Array.isArray(v) && v.length > 0 && v.every((n) => typeof n === "number" && Number.isFinite(n)));
}

/**
 * Replaces the segment from `a` to `b` by the keys of a bounce, elastic or spring.
 * Returns the keys after `a`, ending with `b` itself. Times are snapped to frames and keys that would share a frame are dropped,
 * so the result never raises E-KEY-COLLIDE. `clamp` limits values for properties with a fixed range.
 */
export function expandSpecialEase(name: SpecialEase, a: NumericKey, b: NumericKey, fps: number, clamp: (n: number) => number): PKey[] {
  const fa = Math.round(a.t * fps);
  const fb = Math.round(b.t * fps);
  const lerp = (p: number): number | number[] => {
    if (typeof a.v === "number" && typeof b.v === "number") return clamp(a.v + (b.v - a.v) * p);
    const av = a.v as number[];
    const bv = b.v as number[];
    return av.map((n, i) => clamp(n + ((bv[i] as number) - n) * p));
  };
  const out: PKey[] = [];
  let last = fa;
  for (const leg of legsFor(name)) {
    const f = Math.round(fa + leg.at * (fb - fa));
    if (leg.at >= 1 || f >= fb) break;
    if (f <= last) continue;
    out.push({ t: f / fps, v: lerp(leg.p), ease: leg.ease });
    last = f;
  }
  out.push({ t: b.t, v: b.v, ease: name === "bounce" ? "easeInQuad" : "easeInOutSine" });
  return out;
}

/** The easing of a segment played backward: the bezier mirrored through its centre. Names that are not beziers are returned unchanged. */
export function mirrorEase(ease: unknown): unknown {
  if (ease === undefined || ease === "hold") return ease;
  const r = resolveEase(ease);
  if (r.kind !== "ok" || r.ease === "hold") return ease;
  const [x1, y1, x2, y2] = r.ease as Bezier;
  return [1 - x2, 1 - y2, 1 - x1, 1 - y1];
}

export { EASINGS };
