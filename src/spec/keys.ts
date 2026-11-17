import { resolveEase, type EaseResult } from "../presets/easing.ts";

/** A keyframe as written in the scene, in canonical form. */
export interface RawKey {
  time: number;
  value: unknown;
  ease: unknown;
  /** Index in the source array, for diagnostics. */
  index: number;
  /** The `overshoot` option of a long-form key, as written. The expander turns it into extra keys before the linter runs. */
  overshoot?: unknown;
}

export type KeyShapeResult = { ok: true; key: RawKey } | { ok: false; reason: string };

export function readKey(raw: unknown, index: number): KeyShapeResult {
  if (Array.isArray(raw)) {
    if (raw.length < 2 || raw.length > 3) return { ok: false, reason: `has ${raw.length} elements, expected 2 or 3` };
    if (typeof raw[0] !== "number" || !Number.isFinite(raw[0])) return { ok: false, reason: "time is not a number" };
    return { ok: true, key: { time: raw[0], value: raw[1], ease: raw[2], index } };
  }
  if (raw !== null && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (typeof o["t"] !== "number" || !Number.isFinite(o["t"])) return { ok: false, reason: "'t' is not a number" };
    if (!("v" in o)) return { ok: false, reason: "'v' is missing" };
    const key: RawKey = { time: o["t"], value: o["v"], ease: o["ease"], index };
    if (o["overshoot"] !== undefined) key.overshoot = o["overshoot"];
    return { ok: true, key };
  }
  return { ok: false, reason: "is not an array or object" };
}

export function easeOf(key: RawKey): EaseResult {
  return resolveEase(key.ease);
}
