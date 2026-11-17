import { pk, type ParamSpec, type PresetDef, type PropKeys, type Statics } from "./types.ts";

const num = (def: number, min?: number, max?: number): ParamSpec => {
  const s: ParamSpec = { kind: "number", def };
  if (min !== undefined) s.min = min;
  if (max !== undefined) s.max = max;
  return s;
};
const int = (def: number, min: number, max: number): ParamSpec => ({ kind: "int", def, min, max });
const oneOf = (def: string, values: readonly string[]): ParamSpec => ({ kind: "enum", def, values });

const SIDES = ["left", "right", "top", "bottom"] as const;
const n = (v: number | string | undefined): number => v as number;

/** The scale of a node multiplied by a factor, as a pair. */
const sc = (s: Statics, kx = 1, ky = kx): [number, number] => [s.sx * kx, s.sy * ky];


/** Seconds one blink takes. Shorter than this and the closed eye is on screen for a single frame at 30 fps, which reads as a flicker. */
export const BLINK_SECONDS = 0.3;
/** Fractions of a blink at which the eye is shut and at which it starts to reopen. */
export const BLINK_SHUT = 0.35;
export const BLINK_OPEN = 0.5;

const defs: PresetDef[] = [
  // ------------------------------------------------------------- entrances
  {
    name: "fade-in", category: "entrance", duration: 0.4, loops: false, params: {},
    build: (s, _p, d) => ({ opacity: pk(d, [[0, 0], [1, s.opacity, "easeOut"]]) }),
  },
  {
    name: "pop-in", category: "entrance", duration: 0.5, loops: false, params: { overshoot: num(1.15, 1, 2) },
    build: (s, p, d) => ({
      scale: pk(d, [[0, sc(s, 0)], [0.55, sc(s, n(p["overshoot"])), "easeOutCubic"], [0.8, sc(s, 0.95), "easeInOut"], [1, sc(s), "easeInOut"]]),
      opacity: pk(d, [[0, 0], [0.3, s.opacity, "easeOut"]]),
    }),
  },
  {
    name: "slide-in", category: "entrance", duration: 0.5, loops: false, params: { from: oneOf("left", SIDES), distance: num(80, 0) },
    build: (s, p, d) => {
      const side = p["from"] as string;
      const dist = n(p["distance"]);
      const horizontal = side === "left" || side === "right";
      const sign = side === "left" || side === "top" ? -1 : 1;
      const rest = horizontal ? s.x : s.y;
      return {
        [horizontal ? "x" : "y"]: pk(d, [[0, rest + sign * dist], [1, rest, "easeOutCubic"]]),
        opacity: pk(d, [[0, 0], [0.6, s.opacity, "easeOut"]]),
      };
    },
  },
  {
    name: "drop-in", category: "entrance", duration: 0.6, loops: false, params: { distance: num(120, 0) },
    build: (s, p, d) => {
      const dist = n(p["distance"]);
      return {
        y: pk(d, [[0, s.y - dist], [0.62, s.y, "easeInQuad"], [0.8, s.y - dist * 0.06, "easeOutQuad"], [1, s.y, "easeInQuad"]]),
        scale: pk(d, [[0, sc(s, 0.94, 1.08)], [0.6, sc(s, 0.94, 1.08)], [0.66, sc(s, 1.2, 0.8), "easeOutQuad"], [0.82, sc(s, 0.97, 1.04), "easeOut"], [1, sc(s), "easeInOut"]]),
        opacity: pk(d, [[0, 0], [0.2, s.opacity, "easeOut"]]),
      };
    },
  },
  {
    name: "draw-on", category: "entrance", duration: 0.8, loops: false, needsStroke: true, params: {},
    build: (_s, _p, d) => ({ "trim.end": pk(d, [[0, 0], [1, 1, "easeInOut"]]) }),
  },
  {
    name: "grow-in", category: "entrance", duration: 0.5, loops: false, params: { axis: oneOf("both", ["x", "y", "both"]) },
    build: (s, p, d) => {
      const axis = p["axis"] as string;
      const from: [number, number] = axis === "x" ? [0, s.sy] : axis === "y" ? [s.sx, 0] : [0, 0];
      return { scale: pk(d, [[0, from], [1, sc(s), "easeOutBack"]]) };
    },
  },
  {
    name: "spin-in", category: "entrance", duration: 0.6, loops: false, params: { turns: num(0.5, 0.05, 4) },
    build: (s, p, d) => ({
      rotation: pk(d, [[0, s.rotation - 360 * n(p["turns"])], [1, s.rotation, "easeOutCubic"]]),
      scale: pk(d, [[0, sc(s, 0)], [1, sc(s), "easeOut"]]),
      opacity: pk(d, [[0, 0], [0.4, s.opacity, "easeOut"]]),
    }),
  },

  // ------------------------------------------------------------- exits
  {
    name: "fade-out", category: "exit", duration: 0.4, loops: false, params: {},
    build: (s, _p, d) => ({ opacity: pk(d, [[0, s.opacity], [1, 0, "easeIn"]]) }),
  },
  {
    name: "pop-out", category: "exit", duration: 0.4, loops: false, params: {},
    build: (s, _p, d) => ({
      scale: pk(d, [[0, sc(s)], [0.3, sc(s, 1.1), "easeOut"], [1, sc(s, 0), "easeIn"]]),
      opacity: pk(d, [[0, s.opacity], [0.5, s.opacity], [1, 0, "easeIn"]]),
    }),
  },
  {
    name: "slide-out", category: "exit", duration: 0.5, loops: false, params: { to: oneOf("right", SIDES), distance: num(80, 0) },
    build: (s, p, d) => {
      const side = p["to"] as string;
      const horizontal = side === "left" || side === "right";
      const sign = side === "left" || side === "top" ? -1 : 1;
      const rest = horizontal ? s.x : s.y;
      return {
        [horizontal ? "x" : "y"]: pk(d, [[0, rest], [1, rest + sign * n(p["distance"]), "easeInCubic"]]),
        opacity: pk(d, [[0, s.opacity], [0.4, s.opacity], [1, 0, "easeIn"]]),
      };
    },
  },
  {
    name: "draw-off", category: "exit", duration: 0.8, loops: false, needsStroke: true, params: {},
    build: (_s, _p, d) => ({ "trim.end": pk(d, [[0, 1], [1, 0, "easeInOut"]]) }),
  },
  {
    name: "shrink-out", category: "exit", duration: 0.4, loops: false, params: {},
    build: (s, _p, d) => ({
      scale: pk(d, [[0, sc(s)], [1, sc(s, 0), "easeInBack"]]),
      opacity: pk(d, [[0, s.opacity], [0.7, s.opacity], [1, 0, "easeIn"]]),
    }),
  },

  // ------------------------------------------------------------- emphasis and loops
  {
    name: "pulse", category: "emphasis", duration: 0.8, loops: true, params: { amount: num(1.08, 0.1, 3) },
    build: (s, p, d) => ({ scale: pk(d, [[0, sc(s)], [0.5, sc(s, n(p["amount"])), "easeInOutSine"], [1, sc(s), "easeInOutSine"]]) }),
  },
  {
    name: "breathe", category: "emphasis", duration: 3, loops: true, params: { amount: num(0.03, 0, 0.5) },
    build: (s, p, d) => {
      const a = n(p["amount"]);
      return {
        scale: pk(d, [[0, sc(s)], [0.5, sc(s, 1 + a, 1 + a * 1.4), "easeInOutSine"], [1, sc(s), "easeInOutSine"]]),
        y: pk(d, [[0, s.y], [0.5, s.y - 3, "easeInOutSine"], [1, s.y, "easeInOutSine"]]),
      };
    },
  },
  {
    name: "float", category: "emphasis", duration: 2.4, loops: true, params: { distance: num(12, 0) },
    build: (s, p, d) => ({
      y: pk(d, [[0, s.y], [0.5, s.y - n(p["distance"]), "easeInOutSine"], [1, s.y, "easeInOutSine"]]),
      rotation: pk(d, [[0, s.rotation], [0.25, s.rotation + 2, "easeInOutSine"], [0.75, s.rotation - 2, "easeInOutSine"], [1, s.rotation, "easeInOutSine"]]),
    }),
  },
  {
    name: "wiggle", category: "emphasis", duration: 0.6, loops: true, params: { angle: num(8, 0, 180) },
    build: (s, p, d) => {
      const a = n(p["angle"]);
      return { rotation: pk(d, [[0, s.rotation], [0.25, s.rotation + a, "easeInOutSine"], [0.5, s.rotation, "easeInOutSine"], [0.75, s.rotation - a, "easeInOutSine"], [1, s.rotation, "easeInOutSine"]]) };
    },
  },
  {
    name: "shake", category: "emphasis", duration: 0.5, loops: true, params: { distance: num(8, 0), count: int(3, 1, 12) },
    build: (s, p, d) => {
      const count = n(p["count"]);
      const rows: [number, unknown, unknown?][] = [[0, s.x]];
      for (let k = 0; k < count; k++) {
        const decay = 1 - (k / count) * 0.6;
        rows.push([(4 * k + 1) / (4 * count), s.x + n(p["distance"]) * decay, "easeInOutSine"]);
        rows.push([(4 * k + 3) / (4 * count), s.x - n(p["distance"]) * decay, "easeInOutSine"]);
      }
      rows.push([1, s.x, "easeInOutSine"]);
      return { x: pk(d, rows) };
    },
  },
  {
    name: "spin", category: "emphasis", duration: 1, loops: true, cumulative: true, params: { turns: num(1, 0.05, 20), direction: oneOf("cw", ["cw", "ccw"]) },
    build: (s, p, d) => {
      const sign = p["direction"] === "ccw" ? -1 : 1;
      return { rotation: pk(d, [[0, s.rotation], [1, s.rotation + sign * 360 * n(p["turns"]), "linear"]]) };
    },
  },
  {
    name: "swing", category: "emphasis", duration: 1.2, loops: true, params: { angle: num(20, 0, 180) },
    build: (s, p, d) => {
      const a = n(p["angle"]);
      const r = s.rotation;
      return { rotation: pk(d, [[0, r], [0.15, r + a, "easeOutSine"], [0.4, r - a * 0.6, "easeInOutSine"], [0.65, r + a * 0.3, "easeInOutSine"], [0.85, r - a * 0.1, "easeInOutSine"], [1, r, "easeInOutSine"]]) };
    },
  },
  {
    name: "bounce", category: "emphasis", duration: 0.8, loops: true, params: { height: num(60, 0) },
    build: (s, p, d) => {
      const h = n(p["height"]);
      return {
        y: pk(d, [[0, s.y], [0.3, s.y - h, "easeOutQuad"], [0.6, s.y, "easeInQuad"], [0.75, s.y - h * 0.25, "easeOutQuad"], [0.9, s.y, "easeInQuad"], [1, s.y, "easeOut"]]),
        scale: pk(d, [[0, sc(s)], [0.3, sc(s, 0.95, 1.06), "easeOut"], [0.55, sc(s, 0.95, 1.06), "easeIn"], [0.6, sc(s, 1.18, 0.82), "easeOut"], [0.72, sc(s, 0.97, 1.03), "easeOut"], [1, sc(s), "easeInOut"]]),
      };
    },
  },
  {
    name: "blink", category: "emphasis", duration: BLINK_SECONDS, loops: true, params: {},
    // A lid closes faster than it opens: about a third of the time to close, a short hold, the rest to reopen.
    build: (s, _p, d) => ({ scale: pk(d, [[0, sc(s)], [BLINK_SHUT, sc(s, 1, 0.1), "easeIn"], [BLINK_OPEN, sc(s, 1, 0.1), "hold"], [1, sc(s), "easeOut"]]) }),
  },
  {
    name: "lid-blink", category: "emphasis", duration: BLINK_SECONDS, loops: true, params: {},
    // An eyelid drawn over an eye: hidden (flat) at rest, it drops over the eye and lifts again. Put the node's pivot at the top of the eye.
    build: (s, _p, d) => ({ scale: pk(d, [[0, sc(s, 1, 0)], [BLINK_SHUT, sc(s), "easeIn"], [BLINK_OPEN, sc(s), "hold"], [1, sc(s, 1, 0), "easeOut"]]) }),
  },
  {
    name: "sway", category: "emphasis", duration: 4, loops: true, params: { angle: num(3, 0, 45) },
    // The same shape as wiggle with ambient defaults. Pivot at the base of the plant.
    build: (s, p, d) => {
      const a = n(p["angle"]);
      return { rotation: pk(d, [[0, s.rotation], [0.25, s.rotation + a, "easeInOutSine"], [0.5, s.rotation, "easeInOutSine"], [0.75, s.rotation - a, "easeInOutSine"], [1, s.rotation, "easeInOutSine"]]) };
    },
  },
  {
    name: "flicker", category: "emphasis", duration: 2.2, loops: true, params: { lean: num(3, 0, 20), stretch: num(0.05, 0, 0.5) },
    // Two rhythms that do not line up inside one cycle: two leans and three stretches. Pivot at the base of the flame.
    build: (s, p, d) => {
      const l = n(p["lean"]);
      const st = n(p["stretch"]);
      const e = "easeInOutSine";
      return {
        rotation: pk(d, [[0, s.rotation], [0.125, s.rotation + l, e], [0.375, s.rotation - l, e], [0.5, s.rotation, e], [0.625, s.rotation + l * 0.7, e], [0.875, s.rotation - l * 0.7, e], [1, s.rotation, e]]),
        scale: pk(d, [
          [0, sc(s)],
          [1 / 6, sc(s, 1 - st * 0.4, 1 + st), e],
          [2 / 6, sc(s), e],
          [3 / 6, sc(s, 1 - st * 0.3, 1 + st * 0.7), e],
          [4 / 6, sc(s), e],
          [5 / 6, sc(s, 1 - st * 0.4, 1 + st), e],
          [1, sc(s), e],
        ]),
      };
    },
  },
  {
    name: "jiggle", category: "emphasis", duration: 0.54, loops: true, params: { amount: num(0.02, 0, 0.2), shift: num(2, 0, 40) },
    // Something waiting to be pressed: two beats of squash and a sideways nudge. Pivot at the bottom edge.
    build: (s, p, d) => {
      const a = n(p["amount"]);
      const sh = n(p["shift"]);
      const e = "easeInOutSine";
      return {
        scale: pk(d, [[0, sc(s)], [0.25, sc(s, 1 + a, 1 - a), e], [0.5, sc(s), e], [0.75, sc(s, 1 + a, 1 - a), e], [1, sc(s), e]]),
        x: pk(d, [[0, s.x], [0.25, s.x + sh, e], [0.5, s.x, e], [0.75, s.x - sh, e], [1, s.x, e]]),
      };
    },
  },
  {
    name: "twinkle", category: "emphasis", duration: 1.6, loops: true, params: { dip: num(0.5, 0, 1) },
    // Rest, a dip in size and brightness, rest again. The still parts let stars with different phases look irregular.
    build: (s, p, d) => {
      const dip = n(p["dip"]);
      const e = "easeInOutSine";
      return {
        scale: pk(d, [[0, sc(s)], [0.35, sc(s), e], [0.5, sc(s, 1 - dip * 0.5), e], [0.65, sc(s), e], [1, sc(s)]]),
        opacity: pk(d, [[0, s.opacity], [0.35, s.opacity, e], [0.5, s.opacity * (1 - dip), e], [0.65, s.opacity, e], [1, s.opacity]]),
      };
    },
  },
  {
    name: "rise", category: "emphasis", duration: 3, loops: true, resets: true, params: { distance: num(40, 0), grow: num(0.3, 0, 3) },
    // Smoke, steam, bubbles. Hidden at both ends, so y and scale may restart from a different value than they end on.
    build: (s, p, d) => ({
      y: pk(d, [[0, s.y], [1, s.y - n(p["distance"]), "linear"]]),
      opacity: pk(d, [[0, 0], [0.3, s.opacity, "easeOut"], [0.6, s.opacity], [1, 0, "easeIn"]]),
      scale: pk(d, [[0, sc(s)], [1, sc(s, 1 + n(p["grow"])), "linear"]]),
    }),
  },
  {
    name: "wave", category: "emphasis", duration: 1.2, loops: true, params: { angle: num(20, 0, 180), count: int(3, 1, 8) },
    build: (s, p, d) => {
      const a = n(p["angle"]);
      const count = n(p["count"]);
      const rows: [number, unknown, unknown?][] = [[0, s.rotation], [0.12, s.rotation + a, "easeOutSine"]];
      const span = 0.76;
      for (let k = 1; k <= count * 2; k++) rows.push([0.12 + (span * k) / (count * 2), s.rotation + (k % 2 === 1 ? -a : a), "easeInOutSine"]);
      rows.push([1, s.rotation, "easeInOutSine"]);
      return { rotation: pk(d, rows) };
    },
  },
  {
    name: "heartbeat", category: "emphasis", duration: 1, loops: true, params: { amount: num(1.15, 1, 3) },
    build: (s, p, d) => {
      const a = n(p["amount"]);
      return { scale: pk(d, [[0, sc(s)], [0.1, sc(s, a), "easeOut"], [0.22, sc(s), "easeInOut"], [0.34, sc(s, 1 + (a - 1) * 0.7), "easeOut"], [0.48, sc(s), "easeInOut"], [1, sc(s), "linear"]]) };
    },
  },
  {
    name: "flash", category: "emphasis", duration: 0.4, loops: true, params: { count: int(2, 1, 12) },
    build: (s, p, d) => {
      const count = n(p["count"]);
      const rows: [number, unknown, unknown?][] = [[0, s.opacity]];
      for (let k = 0; k < count; k++) {
        rows.push([(2 * k + 1) / (2 * count), 0, "easeInOutSine"]);
        rows.push([(2 * k + 2) / (2 * count), s.opacity, "easeInOutSine"]);
      }
      return { opacity: pk(d, rows) };
    },
  },
];

export const PRESETS: Readonly<Record<string, PresetDef>> = Object.fromEntries(defs.map((p) => [p.name, p]));
export const PRESET_NAMES: readonly string[] = defs.map((p) => p.name);
