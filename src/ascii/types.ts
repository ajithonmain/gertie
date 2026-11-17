/** Cell proportions shared by the SVG emitter, the converters and the generators. Characters are about twice as tall as wide. */
export const CELL_W_EM = 0.6;
export const CELL_H_EM = 1.25;
/** Height of a cell divided by its width at the default font size (a 10 by 20 pixel cell). Used to keep proportions when converting pictures. */
export const CELL_ASPECT = 2;

export const DEFAULT_COLOR = "#22c55e";
export const DEFAULT_BACKGROUND = "#0b0f19";
export const DEFAULT_FONT_SIZE = 16;
export const DEFAULT_FONT_FAMILY = "ui-monospace,'SF Mono',Menlo,Consolas,'DejaVu Sans Mono','Liberation Mono',monospace";

export const MAX_COLS = 240;
export const MAX_ROWS = 120;
export const MAX_FRAMES = 1200;

/** Limits of the recipe form (`source`), whose frames are computed when rendered and never stored. */
export const MAX_RECIPE_COLS = 400;
export const MAX_RECIPE_ROWS = 200;
export const MAX_RECIPE_FRAMES = 3600;
/** Above this many cells in total (cols times rows times frames) an animation is drawn by the canvas renderer, and has no SVG. */
export const SVG_CELL_LIMIT = 400_000;

/** Which renderer draws an animation of this many cells in total. */
export function rendererFor(cells: number): "svg" | "canvas" {
  return cells > SVG_CELL_LIMIT ? "canvas" : "svg";
}

/** The `source` of a recipe: the file to convert and the conversion controls, by their flag names in camel case. Colours are hex. */
export interface NAsciiSource {
  /** Relative to the .ascii.json file. */
  file: string;
  cols: number;
  /** Computed from the source's proportions and `style.cellAspect` when absent. */
  rows: number | null;
  /** Seconds of a video, GIF or image to read. Absent: 10 seconds for media, the whole scene for a vector scene. */
  maxSeconds: number | null;
  ramp: string;
  invert: boolean;
  color: boolean;
  /** Absent: on for video and images, off for vector scenes. */
  normalize: boolean | null;
  gamma?: number;
  threshold?: number;
  key?: "auto" | string;
  crop?: { x: number; y: number; w: number; h: number };
  colorLevels?: number;
  palette?: string[];
  tint?: string;
  chars?: string;
  seed?: number;
  shimmer?: number;
  dither?: "ordered";
  edgeColor?: string;
  cellBg?: number;
}

/** A linear gradient behind the grid. `angle` is in degrees, as in CSS: 0 points up, 90 points right, 180 points down. */
export interface AsciiGradient {
  from: string;
  to: string;
  angle: number;
}

export type AsciiGlyph = "text" | "dot" | "square";
export const GLYPHS: readonly AsciiGlyph[] = ["text", "dot", "square"];

export interface NAsciiStyle {
  color: string;
  /** Null means transparent. With a gradient this is the gradient's `from` colour, which is what flattening and destination checks use. */
  background: string | null;
  /** Set when `background` was given as a gradient object. */
  gradient: AsciiGradient | null;
  fontSize: number;
  fontFamily: string;
  /** `text` draws the character; `dot` and `square` draw a filled shape sized by the character's place in `ramp`. */
  glyph: AsciiGlyph;
  /** The ramp the frames were made with. Required when `glyph` is not `text`. */
  ramp: string | null;
  /** Height of a cell over its width. */
  cellAspect: number;
  /** 0 to 1: a blurred copy of the glyph layer under the sharp one. */
  glow: number;
}

export const DEFAULT_CELL_ASPECT = 2;

export interface NAsciiFrame {
  /** `rows` rows of exactly `cols` single characters (code points). */
  cells: string[][];
  /** Same shape as `cells`. A null cell uses the style colour. Null when the frame has no colour overrides. */
  colors: (string | null)[][] | null;
  /** Same shape as `cells`. A colour filled behind the cell. Null when the frame has none. */
  backgrounds: (string | null)[][] | null;
  /** How many frame intervals this frame is shown for. */
  hold: number;
}

export const FX_EFFECTS = ["reveal", "hide", "decode", "shimmer", "type"] as const;
export type FxEffect = (typeof FX_EFFECTS)[number];
/** What decides when each cell appears (`reveal`) or goes (`hide`). */
export const FX_BY = ["scatter", "rows-up", "rows-down", "cols-right", "cols-left", "radial", "bright-first"] as const;
export type FxBy = (typeof FX_BY)[number];

/** One entry of the scene's `fx` list. Fields that an effect does not use are absent. */
export interface NAsciiFx {
  effect: FxEffect;
  /** Seconds. Default 0. */
  at: number;
  /** Seconds. 0 for `type`, which ignores it. */
  duration: number;
  /** `reveal` and `hide`. */
  by?: FxBy;
  seed: number;
  /** `decode` and `shimmer`: the characters to roll. Absent: the scene's ramp without the space. */
  chars?: string;
  /** `shimmer`: fraction of non-empty cells re-rolled on each frame. */
  amount?: number;
  /** `type`: characters per second. */
  cps?: number;
}

/** One position keyframe of a layer: its top-left cell in the scene grid at time `t`. `ease` shapes the motion from this key to the next. */
export interface NLayerKey {
  /** Seconds, scene time. */
  t: number;
  col: number;
  row: number;
  /** "hold" steps; a bezier eases. Default linear. */
  ease: "hold" | [number, number, number, number];
}

/** One layer of a scene with `layers`: a small animation of its own, placed and moved on the scene grid. */
export interface NAsciiLayer {
  /** The layer's `id`, or null. */
  id: string | null;
  /** How messages name the layer: `layers[1] ("koi")`, or `layers[1]` without an id. */
  label: string;
  /** The frames of a `frames`, `framesFile` or `text` layer, on the layer's own grid. Empty for a `source` layer. */
  frames: NAsciiFrame[];
  /** Set for a layer converted from a file. */
  source: NAsciiSource | null;
  /** True for a `text` layer, the only kind the `type` effect works on. */
  text: boolean;
  /** Colour of the layer's cells that have none of their own. Null: the style colour. */
  color: string | null;
  /** Position keyframes in time order. Empty: fixed at 0, 0. */
  at: NLayerKey[];
  /** Effects on this layer, run before flattening. Times are scene seconds. */
  fx: NAsciiFx[];
  /** Seconds, scene time: the layer exists from `from` up to, not including, `to`. */
  from: number;
  to: number;
  /** A layer shorter than its time repeats when true, and holds its last frame when false. */
  loop: boolean;
}

export interface NAscii {
  name: string;
  cols: number;
  rows: number;
  fps: number;
  loop: boolean;
  style: NAsciiStyle;
  /** Effects in time, applied in order by `framesOf`. Empty when there are none. */
  fx: NAsciiFx[];
  /** Empty for a recipe: its frames come from `framesOf`. */
  frames: NAsciiFrame[];
  /** Set for the recipe form. Then `rows` is 0 until `shapeOf` has looked at the source, unless `source.rows` is given. */
  source: NAsciiSource | null;
  /** Set for a scene built from layers. Then `frames` is empty, `source` is null, and `duration` is set. */
  layers?: NAsciiLayer[];
  /** Seconds. Set, and required, with `layers`. */
  duration?: number;
}

/** Number of frame intervals of a scene with layers: its duration at its frame rate, at least one. */
export function layeredIntervals(s: Pick<NAscii, "fps" | "duration">): number {
  return Math.max(1, Math.round((s.duration ?? 0) * s.fps));
}

/** Total number of frame intervals, counting holds. */
export function totalFrames(s: NAscii): number {
  return s.frames.reduce((n, f) => n + f.hold, 0);
}

/** The index into `frames` that is shown during frame interval `n` (0 based, counting holds). */
export function frameAt(s: NAscii, n: number): number {
  let acc = 0;
  for (let i = 0; i < s.frames.length; i++) {
    acc += (s.frames[i] as NAsciiFrame).hold;
    if (n < acc) return i;
  }
  return s.frames.length - 1;
}

// Whole pixels, so the canvas is a whole number of pixels and renders without a seam at its edges.
export const cellWidth = (s: NAscii): number => Math.max(1, Math.round(s.style.fontSize * CELL_W_EM));
/** At the default aspect the height is the font-based one (10 by 20 at size 16); any other aspect is the cell width times that aspect. */
export const cellHeight = (s: NAscii): number => (s.style.cellAspect === DEFAULT_CELL_ASPECT ? Math.max(1, Math.round(s.style.fontSize * CELL_H_EM)) : Math.max(1, Math.round(cellWidth(s) * s.style.cellAspect)));
export const padding = (s: NAscii): number => Math.round(s.style.fontSize / 2);

/** The drawn size of the animation, in pixels. */
export function canvasSize(s: NAscii): { w: number; h: number } {
  return { w: s.cols * cellWidth(s) + 2 * padding(s), h: s.rows * cellHeight(s) + 2 * padding(s) };
}

/** The text of one row of a frame, trailing spaces removed. */
export function rowText(f: NAsciiFrame, r: number): string {
  return (f.cells[r] as string[]).join("").replace(/ +$/, "");
}
