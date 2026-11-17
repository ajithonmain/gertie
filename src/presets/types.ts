/** A keyframe while presets are being expanded. `t` is in seconds. `ease` is the raw value as written in a scene. */
export interface PKey {
  t: number;
  v: unknown;
  ease?: unknown;
  /** The `overshoot` option as written on a long-form key. Only present while a property is being expanded. */
  overshoot?: unknown;
}

/** Keyframes by animatable property name, as written in a scene `animate` block. */
export type PropKeys = Record<string, PKey[]>;

/** The static transform values of a node, read from the scene file. Presets are relative to these. */
export interface Statics {
  x: number;
  y: number;
  rotation: number;
  sx: number;
  sy: number;
  opacity: number;
}

export type ParamSpec =
  | { kind: "number"; def: number; min?: number; max?: number }
  | { kind: "int"; def: number; min: number; max: number }
  | { kind: "enum"; def: string; values: readonly string[] };

export type Params = Record<string, number | string>;

export type PresetCategory = "entrance" | "exit" | "emphasis";

export interface PresetDef {
  name: string;
  category: PresetCategory;
  /** Seconds. */
  duration: number;
  params: Record<string, ParamSpec>;
  /** True when the preset may take `repeat`. */
  loops: boolean;
  /** True when each repeat continues from where the last one ended (a spin). */
  cumulative?: boolean;
  /**
   * True when the cycle does not end where it starts but the node is hidden at both ends (smoke, steam, bubbles).
   * A `phase` then treats the wrap as a jump, which is invisible only because of that. Set it for nothing else.
   */
  resets?: true;
  /** Properties that need a stroke on the node. */
  needsStroke?: boolean;
  /** `d` is the preset length in seconds. Keys are returned with `t` from 0 to `d`. */
  build: (s: Statics, p: Params, d: number) => PropKeys;
}

export interface PartRef {
  id: string;
  s: Statics;
}

export interface RigContext {
  /** Preset start and length in seconds. */
  at: number;
  d: number;
  /** End of the scene, for presets that fill the time. */
  sceneEnd: number;
  seed: number;
  /** Frames per second of the scene, for presets that cut a cycle with `rotateCycle`. */
  fps: number;
}

export interface RigPreset {
  name: string;
  duration: number;
  params: Record<string, ParamSpec>;
  loops: boolean;
  /** Part suffixes that must exist. A missing one is E-RIG-PART. */
  required: (p: Params) => string[];
  /** Part suffixes used when present. */
  optional: string[];
  /** Parts that should be reached through a `-ctl` wrapper when the rig has one. */
  transient: string[];
  /** Keys use absolute times (they include `ctx.at`). */
  build: (root: PartRef, parts: Record<string, PartRef>, p: Params, ctx: RigContext) => { id: string; keys: PropKeys }[];
}

export function pk(d: number, rows: [number, unknown, unknown?][]): PKey[] {
  return rows.map(([f, v, e]) => (e === undefined ? { t: f * d, v } : { t: f * d, v, ease: e }));
}
