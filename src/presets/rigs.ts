import { BLINK_OPEN, BLINK_SECONDS, BLINK_SHUT } from "./library.ts";
import { rotateCycle } from "./repeat.ts";
import type { ParamSpec, PartRef, PKey, PropKeys, RigPreset } from "./types.ts";

const num = (def: number, min?: number, max?: number): ParamSpec => {
  const s: ParamSpec = { kind: "number", def };
  if (min !== undefined) s.min = min;
  if (max !== undefined) s.max = max;
  return s;
};
const oneOf = (def: string, values: readonly string[]): ParamSpec => ({ kind: "enum", def, values });
const n = (v: number | string | undefined): number => v as number;

type Row = [number, unknown, unknown?];

/** Keys at fractions of the preset window, in absolute seconds. */
function win(at: number, d: number, rows: Row[]): PKey[] {
  return rows.map(([f, v, e]) => (e === undefined ? { t: at + f * d, v } : { t: at + f * d, v, ease: e }));
}

const S = "easeInOutSine";

/** How far into its cycle the left arm of `rig-idle` starts, as a fraction. */
const ARM_LAG = 0.35;

/** A small deterministic generator, so `random` orders and blink times are repeatable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sc = (p: PartRef, kx = 1, ky = kx): [number, number] => [p.s.sx * kx, p.s.sy * ky];
const out = (p: PartRef, keys: PropKeys): { id: string; keys: PropKeys } => ({ id: p.id, keys });

const defs: RigPreset[] = [
  {
    name: "rig-idle", duration: 3, loops: true, params: { armSway: num(2, 0, 20) }, required: () => ["body", "head"], optional: ["arm-l", "arm-r"], transient: [],
    build: (_r, parts, p, c) => {
      const body = parts["body"] as PartRef;
      const head = parts["head"] as PartRef;
      const res = [
        out(body, {
          y: win(c.at, c.d, [[0, body.s.y], [0.5, body.s.y + 3, S], [1, body.s.y, S]]),
          scale: win(c.at, c.d, [[0, sc(body)], [0.5, sc(body, 1.01, 1.02), S], [1, sc(body), S]]),
        }),
        out(head, {
          rotation: win(c.at, c.d, [[0, head.s.rotation], [0.3, head.s.rotation + 2, S], [0.7, head.s.rotation - 2, S], [1, head.s.rotation, S]]),
        }),
      ];
      // Moving hold: hanging arms drift outward and back. Outward is negative for a right arm and positive for a left one.
      const sway = n(p["armSway"]);
      if (sway > 0) {
        for (const [k, sign] of [["arm-l", 1], ["arm-r", -1]] as const) {
          const arm = parts[k];
          if (!arm) continue;
          const keys = win(c.at, c.d, [[0, arm.s.rotation], [0.5, arm.s.rotation + sign * sway, S], [1, arm.s.rotation, S]]);
          // The left arm runs ARM_LAG of a cycle ahead, so the two arms are never mirror images of each other.
          res.push(out(arm, { rotation: k === "arm-l" ? (rotateCycle(keys, ARM_LAG, c.fps) ?? keys) : keys }));
        }
      }
      return res;
    },
  },
  {
    name: "rig-blink", duration: BLINK_SECONDS, loops: false, params: { every: num(2.6, 0.5, 20) }, required: () => ["eye-l", "eye-r"], optional: [], transient: [],
    build: (_r, parts, p, c) => {
      // Blinks at irregular intervals from `at` to the end of the scene, each BLINK_SECONDS long, closing faster than it reopens.
      const rand = mulberry32(c.seed);
      const every = n(p["every"]);
      const times: number[] = [];
      let t = c.at + every * (0.5 + 0.5 * rand());
      while (t + BLINK_SECONDS < c.sceneEnd - 0.05) {
        times.push(t);
        t += every * (0.7 + 0.6 * rand());
      }
      return ["eye-l", "eye-r"].map((k) => {
        const e = parts[k] as PartRef;
        const keys: PKey[] = [];
        for (const b of times) {
          keys.push({ t: b, v: sc(e) }, { t: b + BLINK_SECONDS * BLINK_SHUT, v: sc(e, 1, 0.1), ease: "easeIn" }, { t: b + BLINK_SECONDS * BLINK_OPEN, v: sc(e, 1, 0.1), ease: "hold" }, { t: b + BLINK_SECONDS, v: sc(e), ease: "easeOut" });
        }
        return out(e, { scale: keys });
      });
    },
  },
  {
    name: "rig-wave", duration: 2.2, loops: false, params: { arm: oneOf("r", ["l", "r"]), raise: num(140, 20, 180), angle: num(24, 0, 90), count: { kind: "int", def: 3, min: 1, max: 8 } },
    required: (p) => [`arm-${p["arm"] as string}`], optional: [], transient: ["arm-l", "arm-r"],
    build: (_r, parts, p, c) => {
      const arm = parts[`arm-${p["arm"] as string}`] as PartRef;
      // Raising a right arm outward turns it counterclockwise (negative); a left arm is the mirror image.
      const sign = p["arm"] === "r" ? -1 : 1;
      const up = arm.s.rotation + sign * n(p["raise"]);
      const a = sign * n(p["angle"]);
      const count = n(p["count"]);
      // Raise, then `count` full waves (each is one swing out and one back, so 2 * count reversals), hold, lower.
      const rows: Row[] = [[0, arm.s.rotation], [0.16, up, "easeOutCubic"]];
      const start = 0.2;
      const span = 0.62;
      for (let k = 1; k <= count * 2; k++) rows.push([start + (span * k) / (count * 2), up + (k % 2 === 1 ? a : -a), S]);
      rows.push([start + span + 0.04, up, S], [1, arm.s.rotation, "easeInOutCubic"]);
      return [out(arm, { rotation: win(c.at, c.d, rows) })];
    },
  },
  {
    name: "rig-nod", duration: 1, loops: false, params: { distance: num(8, 0) }, required: () => ["head"], optional: [], transient: ["head"],
    build: (_r, { head }, p, c) => {
      const h = head as PartRef;
      const d = n(p["distance"]);
      return [out(h, { y: win(c.at, c.d, [[0, h.s.y], [0.2, h.s.y + d, S], [0.4, h.s.y, S], [0.6, h.s.y + d, S], [0.8, h.s.y, S], [1, h.s.y, S]]) })];
    },
  },
  {
    name: "rig-shake-head", duration: 1, loops: false, params: { angle: num(10, 0, 90) }, required: () => ["head"], optional: [], transient: ["head"],
    build: (_r, { head }, p, c) => {
      const h = head as PartRef;
      const a = n(p["angle"]);
      return [out(h, { rotation: win(c.at, c.d, [[0, h.s.rotation], [0.2, h.s.rotation + a, S], [0.5, h.s.rotation - a, S], [0.8, h.s.rotation + a, S], [1, h.s.rotation, S]]) })];
    },
  },
  {
    name: "rig-jump", duration: 1, loops: false, params: { height: num(80, 0) }, required: () => [], optional: ["arm-l", "arm-r"], transient: ["arm-l", "arm-r"],
    build: (root, parts, p, c) => {
      const h = n(p["height"]);
      const r = root;
      const res = [
        out(r, {
          y: win(c.at, c.d, [[0, r.s.y], [0.18, r.s.y + h * 0.12, S], [0.5, r.s.y - h, "easeOutQuad"], [0.82, r.s.y, "easeInQuad"], [1, r.s.y, "easeOut"]]),
          scale: win(c.at, c.d, [[0, sc(r)], [0.18, sc(r, 1.1, 0.88), S], [0.34, sc(r, 0.92, 1.12), "easeOut"], [0.78, sc(r, 0.94, 1.08), "easeIn"], [0.84, sc(r, 1.16, 0.84), "easeOut"], [1, sc(r), "easeInOut"]]),
        }),
      ];
      for (const [k, sign] of [["arm-l", 1], ["arm-r", -1]] as const) {
        const arm = parts[k];
        if (!arm) continue;
        res.push(out(arm, { rotation: win(c.at, c.d, [[0, arm.s.rotation], [0.18, arm.s.rotation - sign * 15, S], [0.5, arm.s.rotation + sign * 70, "easeOutQuad"], [0.84, arm.s.rotation - sign * 10, "easeInQuad"], [1, arm.s.rotation, "easeInOut"]]) }));
      }
      return res;
    },
  },
  {
    name: "rig-look", duration: 1.2, loops: false, params: { direction: oneOf("right", ["left", "right", "up", "down"]), amount: num(5, 0) },
    required: () => ["eye-l", "eye-r"], optional: [], transient: [],
    build: (_r, parts, p, c) => {
      const dir = p["direction"] as string;
      const a = n(p["amount"]);
      const dx = dir === "left" ? -a : dir === "right" ? a : 0;
      const dy = dir === "up" ? -a : dir === "down" ? a : 0;
      return ["eye-l", "eye-r"].map((k) => {
        const e = parts[k] as PartRef;
        return out(e, {
          x: win(c.at, c.d, [[0, e.s.x], [0.25, e.s.x + dx, "easeOutCubic"], [0.75, e.s.x + dx, S], [1, e.s.x, "easeInOutCubic"]]),
          y: win(c.at, c.d, [[0, e.s.y], [0.25, e.s.y + dy, "easeOutCubic"], [0.75, e.s.y + dy, S], [1, e.s.y, "easeInOutCubic"]]),
        });
      });
    },
  },
  {
    name: "rig-walk-in-place", duration: 1, loops: true, params: { swing: num(24, 0, 80) },
    required: () => ["leg-l", "leg-r", "arm-l", "arm-r", "body"], optional: [], transient: [],
    build: (_r, parts, p, c) => {
      const a = n(p["swing"]);
      const swing = (part: PartRef, amp: number, phase: 1 | -1): { id: string; keys: PropKeys } =>
        out(part, { rotation: win(c.at, c.d, [[0, part.s.rotation + phase * amp], [0.5, part.s.rotation - phase * amp, S], [1, part.s.rotation + phase * amp, S]]) });
      const body = parts["body"] as PartRef;
      return [
        swing(parts["leg-l"] as PartRef, a, 1),
        swing(parts["leg-r"] as PartRef, a, -1),
        swing(parts["arm-l"] as PartRef, a * 0.8, -1),
        swing(parts["arm-r"] as PartRef, a * 0.8, 1),
        out(body, { y: win(c.at, c.d, [[0, body.s.y], [0.25, body.s.y - 3, S], [0.5, body.s.y, S], [0.75, body.s.y - 3, S], [1, body.s.y, S]]) }),
      ];
    },
  },
];

export const RIG_PRESETS: Readonly<Record<string, RigPreset>> = Object.fromEntries(defs.map((p) => [p.name, p]));
export const RIG_PRESET_NAMES: readonly string[] = defs.map((p) => p.name);
