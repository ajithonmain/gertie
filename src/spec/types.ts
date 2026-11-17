import type { Rgba } from "./color.ts";
import type { Subpath, Vec2 } from "./path.ts";
import type { Ease } from "../presets/easing.ts";

export type { Rgba, Subpath, Vec2, Ease };

export const SUPPORTED_VERSION = 1;
export const FPS_VALUES: readonly number[] = [24, 25, 30, 50, 60];

/** The kinds of file in `docs/17-quality-tuning.md` section 1. A scene may declare one in `tier`. */
export const TIERS = ["icon", "character", "scene"] as const;
export type Tier = (typeof TIERS)[number];

/** Names of animatable properties as written in a scene `animate` block. */
export type TrackName =
  | "x" | "y" | "rotation" | "scale" | "opacity"
  | "fill" | "stroke.color" | "stroke.width"
  | "trim.start" | "trim.end" | "trim.offset"
  | "d" | "w" | "h" | "radius" | "rx" | "ry" | "r"
  | "fill.from" | "fill.to" | "fill.center" | "fill.radius";

export type TrackValue = number | Vec2 | Rgba | Subpath[];

/** A keyframe after normalization. `t` is a frame. `ease` describes the segment arriving at this key. */
export interface NKey {
  t: number;
  v: TrackValue;
  ease: Ease;
}

export type NTracks = Partial<Record<TrackName, NKey[]>>;

export interface NGradientStop {
  offset: number;
  color: Rgba;
}

export type NGradient =
  | { type: "linear"; from: Vec2; to: Vec2; stops: NGradientStop[] }
  | { type: "radial"; center: Vec2; radius: number; stops: NGradientStop[] };

export interface NStroke {
  color: Rgba;
  width: number;
  cap: 1 | 2 | 3;
  join: 1 | 2 | 3;
  dash: number[] | null;
}

export interface NTrim {
  start: number;
  end: number;
  offset: number;
}

export interface NTransform {
  x: number;
  y: number;
  rotation: number;
  scale: Vec2;
  opacity: number;
  pivot: Vec2;
}

/** `alpha` shows the node where the source is drawn; `alpha-inverted` shows it where the source is not. */
export type MatteMode = "alpha" | "alpha-inverted";

export interface NMatte {
  /** Id of the sibling node that acts as the matte. */
  by: string;
  mode: MatteMode;
}

interface NBase {
  id: string;
  /** First frame the node exists. */
  from: number;
  /** Frame at which the node stops existing (exclusive). */
  to: number;
  transform: NTransform;
  tracks: NTracks;
  clip: Subpath[] | null;
  /** Set when this node is shown through the alpha of a sibling. */
  matte?: NMatte;
  /** True for a node that another sibling uses as its matte. It is not drawn itself. */
  matteSource?: true;
}

export interface NStyle {
  fill: Rgba | NGradient | null;
  fillRule: 1 | 2;
  stroke: NStroke | null;
  trim: NTrim | null;
}

export type NShape =
  | (NBase & NStyle & { type: "rect"; w: number; h: number; radius: number })
  | (NBase & NStyle & { type: "ellipse"; rx: number; ry: number })
  | (NBase & NStyle & { type: "path"; d: Subpath[] });

export type NGroup = NBase & { type: "group"; children: NNode[] };
export type NImage = NBase & { type: "image"; src: string; w: number; h: number };
export type NUse = NBase & { type: "use"; ref: string };
/** Another Lottie animation placed in the scene. Lottie output only. */
export type NLottie = NBase & { type: "lottie"; src: string };
export type NNode = NShape | NGroup | NImage | NUse | NLottie;

/** A named span of the timeline, in frames. Written to the Lottie `markers` array only. */
export interface NMarker {
  name: string;
  start: number;
  end: number;
}

export interface NScene {
  name: string;
  w: number;
  h: number;
  background: Rgba | null;
  fps: number;
  totalFrames: number;
  loop: boolean;
  /** Frame shown when animation is off (reduced motion, previews). */
  posterFrame: number;
  /** The quality tier the scene aims for, when it declares one. */
  tier?: Tier;
  /** Named timeline spans, in declaration order. */
  markers: NMarker[];
  nodes: NNode[];
  defs: Record<string, NNode>;
}
