import type { Bezier } from "../presets/easing.ts";
import type { Rgba, Subpath, Vec2 } from "../spec/types.ts";

/** Rounds to `dp` decimals and prints the shortest form, never "-0". */
export function f(v: number, dp = 2): string {
  const k = 10 ** dp;
  const r = Math.round(v * k) / k;
  return Object.is(r, -0) ? "0" : String(r);
}

/** A keyframe percentage with four decimals, rounded down so a step never fires after its frame. */
export function pct(frame: number, total: number): string {
  const exact = (frame / total) * 100;
  let r = Math.round(exact * 1e4) / 1e4;
  if (r > exact + 1e-9) r = Math.round((r - 1e-4) * 1e4) / 1e4;
  return `${Math.max(0, r)}%`;
}

/**
 * The percentage for a keyframe that follows a `step-end` segment. **Verified in phase 3:** in Chromium,
 * seeking to exactly the keyframe time still gives the value from before the step, so the step is
 * written 0.001 percent early (microseconds), which leaves every frame boundary on the new value.
 */
export function pctAfterStep(frame: number, total: number): string {
  const v = parseFloat(pct(frame, total)) - 0.001;
  return `${Math.max(0, Math.round(v * 1e4) / 1e4)}%`;
}

/** A SMIL key time: a fraction between 0 and 1, rounded down for the same reason. */
export function fraction(frame: number, total: number): string {
  const exact = frame / total;
  let r = Math.round(exact * 1e6) / 1e6;
  if (r > exact + 1e-12) r = Math.round((r - 1e-6) * 1e6) / 1e6;
  return String(Math.max(0, r));
}

export function hex(c: Rgba): string {
  const h = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${h(c[0])}${h(c[1])}${h(c[2])}`;
}

export function bezierText(b: Bezier): string {
  return `${f(b[0], 4)},${f(b[1], 4)},${f(b[2], 4)},${f(b[3], 4)}`;
}

export const isLinear = (b: Bezier): boolean => b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 1;

/** Rebuilds a path string from normalized subpaths. Every segment is a cubic, so morph keys always match. */
export function pathData(sp: readonly Subpath[]): string {
  const out: string[] = [];
  for (const s of sp) {
    const n = s.v.length;
    const v0 = s.v[0] as Vec2;
    out.push(`M${f(v0[0])} ${f(v0[1])}`);
    const segs = s.closed ? n : n - 1;
    for (let k = 0; k < segs; k++) {
      const a = s.v[k] as Vec2;
      const j = (k + 1) % n;
      const b = s.v[j] as Vec2;
      const o = s.o[k] as Vec2;
      const i = s.i[j] as Vec2;
      out.push(`C${f(a[0] + o[0])} ${f(a[1] + o[1])} ${f(b[0] + i[0])} ${f(b[1] + i[1])} ${f(b[0])} ${f(b[1])}`);
    }
    if (s.closed) out.push("Z");
  }
  return out.join("");
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** A short token from the scene name, so several Gertie SVGs can sit in one page without id clashes. */
export function prefixFor(name: string): string {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const t = (h >>> 0).toString(36).padStart(3, "0");
  return `g${t.slice(0, 3)}`;
}
