import type { Pt } from "./contour.ts";

/**
 * Smooths a closed outline by averaging each point with its neighbours, which removes the ripple that the pixel grid leaves on curves.
 * A point where the outline turns sharply over a short stretch is a real corner and is held in place.
 */
export function smoothLoop(points: readonly Pt[], passes: number, cornerDegrees = 50, window = 3): Pt[] {
  const n = points.length;
  if (n < 8 || passes <= 0) return [...points];
  const P = (a: readonly Pt[], i: number): Pt => a[((i % n) + n) % n] as Pt;
  const fixed: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const a = P(points, i - window);
    const b = P(points, i);
    const c = P(points, i + window);
    const v1: Pt = [b[0] - a[0], b[1] - a[1]];
    const v2: Pt = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    const cos = l1 === 0 || l2 === 0 ? 1 : (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    fixed.push((Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI > cornerDegrees);
  }
  let cur = [...points];
  for (let pass = 0; pass < passes; pass++) {
    const next: Pt[] = cur.map((p, i) => {
      if (fixed[i]) return p;
      const a = P(cur, i - 1);
      const c = P(cur, i + 1);
      return [(a[0] + 2 * p[0] + c[0]) / 4, (a[1] + 2 * p[1] + c[1]) / 4] as Pt;
    });
    cur = next;
  }
  return cur;
}

/** Douglas-Peucker on an open polyline, keeping the end points. */
function rdp(p: readonly Pt[], eps: number): Pt[] {
  if (p.length < 3) return [...p];
  const a = p[0] as Pt;
  const b = p[p.length - 1] as Pt;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  let worst = -1;
  let wi = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const q = p[i] as Pt;
    const d = len === 0 ? Math.hypot(q[0] - a[0], q[1] - a[1]) : Math.abs(dy * q[0] - dx * q[1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > worst) {
      worst = d;
      wi = i;
    }
  }
  if (worst <= eps) return [a, b];
  const left = rdp(p.slice(0, wi + 1), eps);
  const right = rdp(p.slice(wi), eps);
  return [...left.slice(0, -1), ...right];
}

/** Simplifies a closed loop: split at the two points farthest apart, simplify each half. */
export function simplifyLoop(points: readonly Pt[], eps: number): Pt[] {
  if (points.length < 4) return [...points];
  let i0 = 0;
  const p0 = points[0] as Pt;
  let far = 0;
  points.forEach((q, i) => {
    const d = Math.hypot(q[0] - p0[0], q[1] - p0[1]);
    if (d > far) {
      far = d;
      i0 = i;
    }
  });
  const a = points.slice(0, i0 + 1);
  const b = [...points.slice(i0), p0];
  const s1 = rdp(a, eps);
  const s2 = rdp(b, eps);
  return [...s1.slice(0, -1), ...s2.slice(0, -1)];
}

const f = (n: number): string => String(Math.round(n * 100) / 100);

/**
 * Turns a closed polygon into a path of straight lines and cubic curves. A vertex where the outline turns by more than
 * `corner` degrees stays sharp; every other vertex gets a smooth tangent, so curves are not faceted.
 */
export function loopToPath(poly: readonly Pt[], corner: number, scale: number): string {
  const n = poly.length;
  if (n < 3) return "";
  const P = (i: number): Pt => poly[((i % n) + n) % n] as Pt;
  const sharp: boolean[] = [];
  const tan: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = P(i - 1);
    const b = P(i);
    const c = P(i + 1);
    const v1: Pt = [b[0] - a[0], b[1] - a[1]];
    const v2: Pt = [c[0] - b[0], c[1] - b[1]];
    const l1 = Math.hypot(v1[0], v1[1]);
    const l2 = Math.hypot(v2[0], v2[1]);
    const cos = l1 === 0 || l2 === 0 ? 1 : (v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2);
    const turn = (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    sharp.push(turn > corner);
    const t: Pt = [c[0] - a[0], c[1] - a[1]];
    const tl = Math.hypot(t[0], t[1]) || 1;
    tan.push([t[0] / tl, t[1] / tl]);
  }
  const s = (v: number): string => f(v / scale);
  const out: string[] = [`M${s((P(0))[0])} ${s((P(0))[1])}`];
  for (let i = 0; i < n; i++) {
    const a = P(i);
    const b = P(i + 1);
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ia = i;
    const ib = (i + 1) % n;
    if (sharp[ia] && sharp[ib]) {
      out.push(`L${s(b[0])} ${s(b[1])}`);
      continue;
    }
    const k = seg / 3;
    const ta = tan[ia] as Pt;
    const tb = tan[ib] as Pt;
    const c1: Pt = sharp[ia] ? [a[0] + ((b[0] - a[0]) / 3), a[1] + ((b[1] - a[1]) / 3)] : [a[0] + ta[0] * k, a[1] + ta[1] * k];
    const c2: Pt = sharp[ib] ? [b[0] - ((b[0] - a[0]) / 3), b[1] - ((b[1] - a[1]) / 3)] : [b[0] - tb[0] * k, b[1] - tb[1] * k];
    out.push(`C${s(c1[0])} ${s(c1[1])} ${s(c2[0])} ${s(c2[1])} ${s(b[0])} ${s(b[1])}`);
  }
  out.push("Z");
  return out.join("");
}
