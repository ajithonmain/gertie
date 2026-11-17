import { makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";
import { addToClip, convertFrame, DEFAULT_RAMP, finishClip, rowsForAspect, startClip, type Converted, type RGB } from "./convert.ts";
import { checkFxRange, applyFx } from "./fx.ts";
import { layeredFrames } from "./layers.ts";
import { convertOptionsFor } from "./recipe.ts";
import { layeredIntervals, MAX_RECIPE_FRAMES, MAX_RECIPE_ROWS, rendererFor, totalFrames, type NAscii, type NAsciiFrame, type NAsciiLayer } from "./types.ts";

/** A rectangle of the source picture in source pixels. */
export interface SourceCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What one pass over a source needs: the grid, the frame rate, how many frames, the crop. */
export interface CellRequest {
  cols: number;
  rows: number;
  fps: number;
  /** Exactly this many frames are wanted. */
  count: number;
  /** Seconds of the source to read (media). */
  maxSeconds: number;
  crop?: SourceCrop;
}

/**
 * A source opened by the command line: what it is, and a way to read its cells. `cells` may be called more than once
 * (normalising reads the clip twice); each call is a fresh pass from the first frame.
 */
export interface OpenSource {
  /** `scene` is a Gertie vector scene; `media` is a video, GIF or image. */
  kind: "scene" | "media";
  /** Size of the source picture, in source pixels. */
  width: number;
  height: number;
  /** Length in seconds. For a still image this is 0. */
  seconds: number;
  /** A vector scene's solid background, or null when it is transparent. Null for media. */
  background: RGB | null;
  /** Whether the source loops. A vector scene says; media is taken to loop. */
  loop: boolean;
  /** Number of frames a pass at `fps` gives, reading at most `maxSeconds` (media) and at most `maxFrames`. */
  frameCount(fps: number, maxSeconds: number, maxFrames: number, crop?: SourceCrop): Promise<number>;
  /** The cells of each frame, straight RGBA, `cols * rows * 4` bytes per frame, in order. */
  cells(req: CellRequest): AsyncIterable<ArrayLike<number>>;
}

/** Opens the file a recipe names. Supplied by the command line, which does all file and process access; the path is as written in the recipe. */
export type SourceReader = (file: string) => Promise<OpenSource>;

/** Thrown when a source cannot be turned into frames. Carries a diagnostic that says what to change. */
export class AsciiSourceError extends Error {
  constructor(readonly diagnostic: Diagnostic) {
    super(diagnostic.message);
    this.name = "AsciiSourceError";
  }
}

export interface AsciiShape {
  cols: number;
  rows: number;
  /** Frame intervals, counting holds. For a recipe this is the number of frames computed from the source. */
  intervals: number;
  /** Frames stored (inline) or computed before identical neighbours are folded (recipe). This is what the renderer choice counts. */
  frames: number;
  /** cols times rows times frames. */
  cells: number;
  renderer: "svg" | "canvas";
}

export interface ShapeLimits {
  /** Computed rows are capped at this. Default the recipe limit. */
  maxRows?: number;
  /** Frames beyond this are an error (`E-ASCII-TOOMANY`) unless `clampFrames` is set. Default the recipe limit. */
  maxFrames?: number;
  /** Cap the frame count at `maxFrames` instead of refusing. `ascii from` does this, as in phase 8. */
  clampFrames?: boolean;
}

interface RecipePlan {
  shape: AsciiShape;
  req: CellRequest;
  src: OpenSource;
}

const shapeFrom = (cols: number, rows: number, frames: number, intervals: number): AsciiShape => ({ cols, rows, intervals, frames, cells: cols * rows * frames, renderer: rendererFor(cols * rows * frames) });

async function planRecipe(s: NAscii, read: SourceReader, limits: ShapeLimits): Promise<RecipePlan> {
  const r = s.source;
  if (r === null) throw new Error("planRecipe needs a recipe");
  const src = await read(r.file);
  const crop = r.crop;
  if (crop && (crop.x + crop.w > src.width || crop.y + crop.h > src.height)) {
    throw new AsciiSourceError(makeDiagnostic("E-ASCII-SOURCE", `source.crop [${crop.x}, ${crop.y}, ${crop.w}, ${crop.h}] reaches outside the ${src.width} by ${src.height} source.`, `Keep x + w within ${src.width} and y + h within ${src.height}.`, { path: "source.crop" }));
  }
  const maxRows = limits.maxRows ?? MAX_RECIPE_ROWS;
  const maxFrames = limits.maxFrames ?? MAX_RECIPE_FRAMES;
  const rows = r.rows ?? Math.min(maxRows, rowsForAspect(crop ? crop.w : src.width, crop ? crop.h : src.height, r.cols, s.style.cellAspect));
  const maxSeconds = r.maxSeconds ?? (src.kind === "media" ? 10 : Infinity);
  const natural = await src.frameCount(s.fps, maxSeconds, limits.clampFrames ? maxFrames : maxFrames + 1, crop);
  if (natural > maxFrames && !limits.clampFrames) {
    throw new AsciiSourceError(makeDiagnostic("E-ASCII-TOOMANY", `The source gives more than ${maxFrames} frames at ${s.fps} fps, the limit for a recipe.`, `Lower "fps", or set source.maxSeconds to ${Math.floor((maxFrames / s.fps) * 10) / 10} or less.`, { path: "source" }));
  }
  const count = Math.max(1, Math.min(maxFrames, natural));
  const fxProblem = checkFxRange(s.fx, count / s.fps)[0];
  if (fxProblem) throw new AsciiSourceError(fxProblem);
  return { shape: shapeFrom(r.cols, rows, count, count), req: { cols: r.cols, rows, fps: s.fps, count, maxSeconds, ...(crop ? { crop } : {}) }, src };
}

/** A layer with a `source` as a recipe scene of its own: the scene's frame rate and style, no effects (the layer's run on its timeline). */
function layerRecipe(s: NAscii, l: NAsciiLayer): NAscii {
  const { layers: _layers, duration: _duration, ...rest } = s;
  return { ...rest, source: l.source, fx: [], frames: [], cols: l.source?.cols ?? 0, rows: l.source?.rows ?? 0 };
}

/**
 * Opens the source of every layer that has one, to check it (the crop, the frame limit), and returns the scene's shape.
 * Frames are counted as one per interval: layers move and change, and how many frames fold together is not known before flattening.
 */
async function shapeOfLayers(s: NAscii, read: SourceReader | undefined): Promise<AsciiShape> {
  for (const l of s.layers ?? []) {
    if (!l.source) continue;
    if (!read) throw new Error("a layer with a source needs a source reader");
    try {
      await planRecipe(layerRecipe(s, l), read, {});
    } catch (e) {
      if (e instanceof AsciiSourceError) {
        const d = e.diagnostic;
        throw new AsciiSourceError({ ...d, message: `${l.label}: ${d.message}`, ...(d.path !== undefined ? { path: `${l.label.replace(/ .*$/, "")}.${d.path}` } : {}) });
      }
      throw e;
    }
  }
  const n = layeredIntervals(s);
  return shapeFrom(s.cols, s.rows, n, n);
}

/** The grid size, length and renderer of a scene. Inline frames need no reader; a recipe opens its source through `read` (but converts nothing). */
export async function shapeOf(s: NAscii, read?: SourceReader, limits: ShapeLimits = {}): Promise<AsciiShape> {
  if (s.layers) return shapeOfLayers(s, read);
  // An effect gives every interval it runs over a frame of its own, so with effects the frames stored are counted as one per interval, which is the most there can be.
  if (s.source === null) return shapeFrom(s.cols, s.rows, s.fx.some((e) => e.effect !== "type") ? totalFrames(s) : s.frames.length, totalFrames(s));
  if (!read) throw new Error("a recipe needs a source reader");
  return (await planRecipe(s, read, limits)).shape;
}

/** The scene with the grid of `shape`: a recipe's `rows` filled in. */
export function withShape(s: NAscii, shape: AsciiShape): NAscii {
  return { ...s, cols: shape.cols, rows: shape.rows };
}

const keyOf = (c: Converted): string => JSON.stringify([c.cells.map((row) => row.join("").replace(/ +$/, "")), c.colors, c.backgrounds ?? null]);

/**
 * Every frame of a scene, in order, as `{ cells, colors, backgrounds, hold }`, for all three forms, after the scene's `fx`.
 * See `convertedFrames` for the three forms; effects are applied to that stream as it goes by.
 */
export async function* framesOf(s: NAscii, read?: SourceReader, limits: ShapeLimits = {}): AsyncGenerator<NAsciiFrame> {
  const frames = convertedFrames(s, read, limits);
  if (!s.fx.some((e) => e.effect !== "type")) {
    yield* frames;
    return;
  }
  yield* applyFx(frames, s.fx, s.fps, { ramp: s.style.ramp ?? s.source?.ramp ?? DEFAULT_RAMP, cellAspect: s.style.cellAspect });
}

/**
 * The frames of a scene before effects, for all three forms: inline `frames`,
 * a `framesFile` (both already read by the parser) and a `source` recipe, which is converted here one frame at a time.
 * Identical neighbouring frames of a recipe are folded into one with a longer hold, exactly as `ascii from` folds them,
 * and the holds always add up to the recipe's frame count. Pure apart from `read`, which the command line supplies:
 * this generator opens no file and starts no process itself.
 */
async function* convertedFrames(s: NAscii, read?: SourceReader, limits: ShapeLimits = {}): AsyncGenerator<NAsciiFrame> {
  if (s.layers) {
    // A layer with a source is converted as a recipe of its own, again on each pass when it loops; the others have their frames already.
    yield* layeredFrames(s, (l) => (l.source ? convertedFrames(layerRecipe(s, l), read) : l.frames));
    return;
  }
  if (s.source === null) {
    for (const f of s.frames) yield f;
    return;
  }
  if (!read) throw new Error("a recipe needs a source reader");
  const { req, src } = await planRecipe(s, read, limits);
  const o = convertOptionsFor(s.source, src.kind, src.background, s.style.color);
  const st = startClip(req.cols, req.rows, o);
  if (o.normalize) {
    let n = 0;
    for await (const px of src.cells(req)) {
      if (n++ >= req.count) break;
      addToClip(st, px, o);
    }
    finishClip(st);
  }
  let pending: NAsciiFrame | undefined;
  let pendingKey = "";
  let made = 0;
  for await (const px of src.cells(req)) {
    if (made >= req.count) break;
    const c = convertFrame(px, made, st, o);
    made++;
    const key = keyOf(c);
    if (pending && key === pendingKey) pending.hold++;
    else {
      if (pending) yield pending;
      pending = { cells: c.cells, colors: c.colors, backgrounds: c.backgrounds ?? null, hold: 1 };
      pendingKey = key;
    }
  }
  if (!pending) throw new AsciiSourceError(makeDiagnostic("E-ASCII-SOURCE", `source.file '${s.source.file}' gave no frames.`, "Check that the file is a video, GIF, image or vector scene that plays.", { path: "source.file" }));
  // A source that ends early (a video shorter than its container says) holds its last frame, so the length is what was planned.
  if (made < req.count) pending.hold += req.count - made;
  yield pending;
}

/** Collects every frame into a scene with inline frames. For the SVG path and the terminal, which need the whole animation. */
export async function collect(s: NAscii, read?: SourceReader, limits: ShapeLimits = {}): Promise<NAscii> {
  const shape = await shapeOf(s, read, limits);
  const frames: NAsciiFrame[] = [];
  for await (const f of framesOf(s, read, limits)) frames.push(f);
  return { ...withShape(s, shape), frames };
}
