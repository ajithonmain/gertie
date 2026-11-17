export type Bezier = [number, number, number, number];
export type Ease = "hold" | Bezier;

export const EASINGS: Readonly<Record<string, Bezier>> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.32, 0, 0.67, 0],
  easeOut: [0.33, 1, 0.68, 1],
  easeInOut: [0.65, 0, 0.35, 1],
  easeInSine: [0.12, 0, 0.39, 0],
  easeOutSine: [0.61, 1, 0.88, 1],
  easeInOutSine: [0.37, 0, 0.63, 1],
  easeInQuad: [0.11, 0, 0.5, 0],
  easeOutQuad: [0.5, 1, 0.89, 1],
  easeInOutQuad: [0.45, 0, 0.55, 1],
  easeInCubic: [0.32, 0, 0.67, 0],
  easeOutCubic: [0.33, 1, 0.68, 1],
  easeInOutCubic: [0.65, 0, 0.35, 1],
  easeInQuart: [0.5, 0, 0.75, 0],
  easeOutQuart: [0.25, 1, 0.5, 1],
  easeInOutQuart: [0.76, 0, 0.24, 1],
  easeInExpo: [0.7, 0, 0.84, 0],
  easeOutExpo: [0.16, 1, 0.3, 1],
  easeInOutExpo: [0.87, 0, 0.13, 1],
  easeInBack: [0.36, 0, 0.66, -0.56],
  easeOutBack: [0.34, 1.56, 0.64, 1],
  easeInOutBack: [0.68, -0.6, 0.32, 1.6],
  // Named by character, from the curves most used in the reference set (docs/17-quality-tuning.md section 3.2).
  smooth: [0.7, 0, 0.3, 1],
  gentle: [0.2, 0, 0.8, 1],
  snap: [0.8, 0, 0.3, 1],
  settle: [0.3, 1, 0.7, 1],
};

export const EASING_NAMES: readonly string[] = Object.keys(EASINGS);

/** Names that need the preset machinery of phase 5. */
export const DEFERRED_EASINGS: readonly string[] = ["bounce", "elastic", "spring"];

export const DEFAULT_EASE: Bezier = EASINGS["easeInOut"] as Bezier;

export type EaseResult =
  | { kind: "ok"; ease: Ease }
  | { kind: "unknown-name"; name: string }
  | { kind: "deferred"; name: string }
  | { kind: "bad-range"; value: number[] }
  | { kind: "bad-shape" };

export function resolveEase(raw: unknown): EaseResult {
  if (raw === undefined) return { kind: "ok", ease: DEFAULT_EASE };
  if (raw === "hold") return { kind: "ok", ease: "hold" };
  if (typeof raw === "string") {
    const b = EASINGS[raw];
    if (b) return { kind: "ok", ease: [...b] as Bezier };
    if (DEFERRED_EASINGS.includes(raw)) return { kind: "deferred", name: raw };
    return { kind: "unknown-name", name: raw };
  }
  if (Array.isArray(raw) && raw.length === 4 && raw.every((n) => typeof n === "number" && Number.isFinite(n))) {
    const v = raw as number[];
    if ((v[0] as number) < 0 || (v[0] as number) > 1 || (v[2] as number) < 0 || (v[2] as number) > 1) return { kind: "bad-range", value: v };
    return { kind: "ok", ease: [v[0], v[1], v[2], v[3]] as Bezier };
  }
  return { kind: "bad-shape" };
}

/** Evaluates a CSS-style cubic bezier easing: progress in [0,1] to eased progress. */
export function bezierProgress(b: Bezier, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const [x1, y1, x2, y2] = b;
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sx = (t: number): number => ((ax * t + bx) * t + cx) * t;
  let lo = 0;
  let hi = 1;
  let t = x;
  for (let k = 0; k < 40; k++) {
    const v = sx(t);
    if (Math.abs(v - x) < 1e-7) break;
    if (v < x) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return ((ay * t + by) * t + cy) * t;
}

export interface BezierSplit {
  /** Eased progress at the split point. */
  p: number;
  /** The curve from the start to the split point, as an easing of its own. */
  left: Bezier;
  /** The curve from the split point to the end, as an easing of its own. */
  right: Bezier;
}

/**
 * Splits an easing at a fraction `x` of its time into two easings that together trace the same curve.
 * Used to start a loop part of the way through its cycle without changing how it moves.
 */
export function splitBezier(b: Bezier, x: number): BezierSplit {
  const [x1, y1, x2, y2] = b;
  const xAt = (u: number): number => 3 * (1 - u) * (1 - u) * u * x1 + 3 * (1 - u) * u * u * x2 + u * u * u;
  let lo = 0;
  let hi = 1;
  let u = x;
  for (let k = 0; k < 50; k++) {
    const v = xAt(u);
    if (Math.abs(v - x) < 1e-9) break;
    if (v < x) lo = u;
    else hi = u;
    u = (lo + hi) / 2;
  }
  type P = [number, number];
  const mix = (a: P, c: P): P => [a[0] + (c[0] - a[0]) * u, a[1] + (c[1] - a[1]) * u];
  const p1: P = [x1, y1];
  const p2: P = [x2, y2];
  const a = mix([0, 0], p1);
  const m = mix(p1, p2);
  const c = mix(p2, [1, 1]);
  const d = mix(a, m);
  const e = mix(m, c);
  const f = mix(d, e);
  const round = (n: number): number => Math.round(n * 1e4) / 1e4;
  const clamp = (n: number): number => Math.min(1, Math.max(0, n));
  // A piece over which the value does not change has no height to scale by; any easing draws it the same.
  const unit = (from: P, h1: P, h2: P, to: P): Bezier => {
    const w = to[0] - from[0];
    const h = to[1] - from[1];
    if (w < 1e-9 || Math.abs(h) < 1e-9) return [0, 0, 1, 1];
    return [round(clamp((h1[0] - from[0]) / w)), round((h1[1] - from[1]) / h), round(clamp((h2[0] - from[0]) / w)), round((h2[1] - from[1]) / h)];
  };
  return { p: f[1], left: unit([0, 0], a, d, f), right: unit(f, e, c, [1, 1]) };
}
