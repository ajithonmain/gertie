import { resolveEase } from "./easing.ts";
import { isSpecialEase } from "./ease-expand.ts";
import { rotateCycle } from "./repeat.ts";
import type { PKey } from "./types.ts";

/**
 * Two pure helpers for the expander: the `overshoot` option of a keyframe and the `follow` relation of a node.
 * Both return plain keyframes in seconds and never throw. A problem is returned as a string that names it and the fix.
 */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

// ---------------------------------------------------------------- overshoot

export interface OvershootOptions {
  /** How far past the written value the move goes, as a fraction of the distance it travelled. */
  past: number;
  /** How far back under the written value it comes, as a fraction of the same distance. 0 skips the dip. */
  back: number;
  /** Seconds from the peak to rest. */
  time: number;
}

/** Defaults chosen on contact sheets of a 0.4 second move of 120 pixels and of a scale from 0.6 to 1 (docs/03-scene-spec.md). */
export const OVERSHOOT_DEFAULTS: Readonly<OvershootOptions> = { past: 0.1, back: 0.03, time: 0.3 };
const OVERSHOOT_FIELDS = ["past", "back", "time"];

/** Reads the value of an `overshoot` key: `true`, or an object with any of `past`, `back` and `time`. */
export function readOvershoot(raw: unknown): OvershootOptions | string {
  if (raw === true) return { ...OVERSHOOT_DEFAULTS };
  if (!isObj(raw)) return `'overshoot' is ${JSON.stringify(raw)}, expected true or an object such as { "past": 0.1, "back": 0.03, "time": 0.3 }.`;
  for (const k of Object.keys(raw)) if (!OVERSHOOT_FIELDS.includes(k)) return `Unknown overshoot field '${k}'. Valid fields: ${OVERSHOOT_FIELDS.join(", ")}.`;
  const out = { ...OVERSHOOT_DEFAULTS };
  const limits: Record<string, [number, number, string]> = { past: [0.0001, 1, "greater than 0 and at most 1"], back: [0, 1, "from 0 to 1"], time: [0.05, 3, "from 0.05 to 3 seconds"] };
  for (const k of OVERSHOOT_FIELDS) {
    const v = raw[k];
    if (v === undefined) continue;
    const [lo, hi, text] = limits[k] as [number, number, string];
    if (!isNum(v) || v < lo || v > hi) return `overshoot.${k} is ${JSON.stringify(v)}, expected a number ${text}.`;
    out[k as keyof OvershootOptions] = v;
  }
  return out;
}

const toVec = (v: unknown, size: number): number[] | undefined => {
  if (isNum(v)) return new Array<number>(size).fill(v);
  if (Array.isArray(v) && v.length === size && v.every(isNum)) return v as number[];
  return undefined;
};

/**
 * Replaces the key `key` (which arrives from `prev`) by the keys of an overshoot.
 * The key's time is when the move reaches its peak, which is past the written value by `past` of the distance travelled;
 * the value then dips under it by `back` and comes to rest on the written value `time` seconds later.
 * Times are whole frames, and the rest is before `next`. Returns the keys that replace `key`, or a problem.
 */
export function expandOvershoot(prev: PKey, key: PKey, next: PKey | undefined, opt: OvershootOptions, fps: number, totalFrames: number, clamp: (n: number) => number): PKey[] | string {
  if (key.ease === "hold") return `An overshoot needs a move, and this key's ease is 'hold'.`;
  if (isSpecialEase(key.ease)) return `An overshoot cannot be combined with the '${String(key.ease)}' easing, which already writes its own overshoot.`;
  const scalar = isNum(prev.v) && isNum(key.v);
  const size = Array.isArray(key.v) ? key.v.length : Array.isArray(prev.v) ? prev.v.length : 1;
  const a = toVec(prev.v, size);
  const b = toVec(key.v, size);
  if (!a || !b) return `An overshoot needs numbers or a scale pair, and this property's keyframes are ${typeof key.v === "string" ? "colours or paths" : "not numbers"}.`;
  const dist = b.map((n, i) => n - (a[i] as number));
  if (dist.every((d) => Math.abs(d) < 1e-9)) return `The move does not change the value (${JSON.stringify(prev.v)} to ${JSON.stringify(key.v)}), so there is nothing to overshoot.`;

  const fa = Math.round(key.t * fps);
  const limit = next ? Math.round(next.t * fps) - 1 : totalFrames;
  if (limit - fa < 2) return `There is no room: the next key is ${Math.max(0, limit + 1 - fa)} frame(s) after this one, and an overshoot needs at least 3 frames.`;
  const rest = Math.min(limit, fa + Math.max(2, Math.round(opt.time * fps)));
  const under = Math.min(rest - 1, fa + Math.max(1, Math.round((rest - fa) * 0.4)));
  const at = (f: number): number => f / fps;
  const mix = (k: number): unknown => {
    const v = b.map((n, i) => round4(clamp(n + (dist[i] as number) * k)));
    return scalar ? (v[0] as number) : v;
  };
  const out: PKey[] = [];
  out.push(key.ease === undefined ? { t: key.t, v: mix(opt.past) } : { t: key.t, v: mix(opt.past), ease: key.ease });
  if (opt.back > 0 && under > fa) out.push({ t: at(under), v: mix(-opt.back), ease: "easeInOutSine" });
  out.push({ t: at(rest), v: key.v, ease: "easeInOutSine" });
  return out;
}

// ---------------------------------------------------------------- follow

export interface FollowOptions {
  props: string[];
  /** Seconds the child trails its parent. */
  delay: number;
  /** Multiplier on the parent's movement away from its first value. */
  scale: number;
}

export const FOLLOW_PROPS = ["rotation", "x", "y"] as const;
export const FOLLOW_DEFAULTS = { props: ["rotation"], delay: 0.1, scale: 1.5 } as const;
const FOLLOW_FIELDS = ["props", "delay", "scale"];

/** Reads the value of a `follow` field. `true` means all defaults. */
export function readFollow(raw: unknown): FollowOptions | string {
  if (raw === true) return { props: [...FOLLOW_DEFAULTS.props], delay: FOLLOW_DEFAULTS.delay, scale: FOLLOW_DEFAULTS.scale };
  if (!isObj(raw)) return `'follow' is ${JSON.stringify(raw)}, expected true or an object such as { "props": ["rotation"], "delay": 0.1, "scale": 1.5 }.`;
  for (const k of Object.keys(raw)) if (!FOLLOW_FIELDS.includes(k)) return `Unknown follow field '${k}'. Valid fields: ${FOLLOW_FIELDS.join(", ")}.`;
  const props = raw["props"] === undefined ? [...FOLLOW_DEFAULTS.props] : raw["props"];
  if (!Array.isArray(props) || props.length === 0 || !props.every((p) => typeof p === "string" && (FOLLOW_PROPS as readonly string[]).includes(p))) {
    return `follow.props is ${JSON.stringify(props)}, expected a list made of ${FOLLOW_PROPS.join(", ")}.`;
  }
  const delay = raw["delay"] === undefined ? FOLLOW_DEFAULTS.delay : raw["delay"];
  if (!isNum(delay) || delay < 0 || delay > 3) return `follow.delay is ${JSON.stringify(delay)}, expected seconds from 0 to 3.`;
  const scale = raw["scale"] === undefined ? FOLLOW_DEFAULTS.scale : raw["scale"];
  if (!isNum(scale) || scale === 0 || Math.abs(scale) > 10) return `follow.scale is ${JSON.stringify(scale)}, expected a non-zero number from -10 to 10.`;
  return { props: props as string[], delay, scale };
}

/**
 * The keys of a child that repeats its parent's animation of one property, `delay` seconds later and `scale` times as far.
 * `parent` holds the parent's final keys, `rest` is the child's own static value.
 * When the parent's keys span the whole scene and end where they start, the scene loops, so the child's keys are the same
 * cycle cut by `rotateCycle` and the loop still closes. Otherwise the keys are shifted later and any that pass the end are dropped.
 */
export function followKeys(parent: PKey[], opt: FollowOptions, rest: number, fps: number, duration: number, loop: boolean): PKey[] | string {
  if (parent.length < 2 || !parent.every((k) => isNum(k.v))) return "the parent's keyframes are not numbers";
  const base = parent[0]?.v as number;
  const scaled: PKey[] = parent.map((k) => {
    const v = round4(rest + opt.scale * ((k.v as number) - base));
    return k.ease === undefined ? { t: k.t, v } : { t: k.t, v, ease: k.ease };
  });
  const first = scaled[0] as PKey;
  const last = scaled[scaled.length - 1] as PKey;
  const eps = 0.5 / fps;
  const delay = Math.round(opt.delay * fps) / fps;
  const period = last.t - first.t;
  const closed = Math.abs((last.v as number) - (first.v as number)) < 1e-9;
  if (loop && closed && first.t <= eps && Math.abs(last.t - duration) <= eps && period > 0) {
    const phase = 1 - (delay % period) / period;
    const turned = rotateCycle(scaled, phase >= 1 ? 0 : phase, fps);
    if (turned) return turned;
  }
  const total = Math.round(duration * fps);
  const out: PKey[] = [];
  for (const k of scaled) {
    const t = Math.round((k.t + delay) * fps) / fps;
    if (Math.round(t * fps) > total) break;
    out.push({ ...k, t });
  }
  if (out.length < 2) return `a delay of ${delay} seconds pushes all but ${out.length} of the parent's keys past the end of the scene`;
  return out;
}

/** True when an ease value is a real curve rather than a hold or a straight line. Used by the eased-share counters. */
export function isEasedCurve(ease: unknown): boolean {
  if (ease === "hold") return false;
  const r = resolveEase(ease);
  if (r.kind !== "ok" || r.ease === "hold") return false;
  return !(r.ease[0] === 0 && r.ease[1] === 0 && r.ease[2] === 1 && r.ease[3] === 1);
}
