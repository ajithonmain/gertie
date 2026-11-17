import { didYouMean, makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";
import { isHexColor } from "../spec/color.ts";
import { checkFxRange, parseFx } from "./fx.ts";
import { parseSource } from "./recipe.ts";
import { resolveEase, EASING_NAMES } from "../presets/easing.ts";
import { DEFAULT_BACKGROUND, DEFAULT_CELL_ASPECT, DEFAULT_COLOR, DEFAULT_FONT_FAMILY, DEFAULT_FONT_SIZE, GLYPHS, layeredIntervals, MAX_COLS, MAX_FRAMES, MAX_RECIPE_COLS, MAX_RECIPE_FRAMES, MAX_RECIPE_ROWS, MAX_ROWS, SVG_CELL_LIMIT, type AsciiGlyph, type NAscii, type NAsciiFrame, type NAsciiLayer, type NAsciiSource, type NAsciiStyle, type NLayerKey } from "./types.ts";

type Obj = Record<string, unknown>;

/** How the parser reads the text files that a scene may name. Returns undefined when the file does not exist. */
export interface AsciiIo {
  readText(path: string): string | undefined;
}

export interface ParseOptions {
  /** Used when the scene has no `name`. */
  name?: string;
  io?: AsciiIo;
}

export interface ParseResult {
  scene?: NAscii;
  diagnostics: Diagnostic[];
}

const TOP_FIELDS = ["$schema", "ascii", "name", "cols", "rows", "fps", "loop", "style", "frames", "framesFile", "source", "layers", "duration", "fx"];
const LAYER_FIELDS = ["id", "source", "framesFile", "frames", "text", "color", "at", "fx", "from", "to", "loop"];
const LAYER_FORMS = ["source", "framesFile", "frames", "text"] as const;
const STYLE_FIELDS = ["color", "background", "fontSize", "fontFamily", "glyph", "ramp", "cellAspect", "glow"];
const GRADIENT_FIELDS = ["from", "to", "angle"];
const FRAME_FIELDS = ["text", "file", "hold", "colors", "backgrounds"];
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

// Printable means: no control characters, no tabs, no line or paragraph separators, no zero-width or direction marks.
function isControl(cp: number): boolean {
  return cp <= 0x1f || (cp >= 0x7f && cp <= 0x9f) || cp === 0x2028 || cp === 0x2029 || (cp >= 0x200b && cp <= 0x200f) || (cp >= 0x202a && cp <= 0x202e) || cp === 0x2060 || cp === 0xfeff;
}
const hasControl = (s: string): boolean => [...s].some((c) => isControl(c.codePointAt(0) as number));

/** Rough East Asian wide ranges. A wide character takes two cells in most terminals and breaks a monospace grid. */
export function isWide(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1f64f) ||
    (cp >= 0x1f900 && cp <= 0x1f9ff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  );
}

/** Splits text read from a file into rows. A trailing newline does not make an extra row. */
export function rowsOfText(text: string): string[] {
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  if (rows.length > 1 && rows[rows.length - 1] === "") rows.pop();
  return rows;
}

/** Splits a whole-animation text file into frames at lines that contain only `---`. */
export function framesOfFile(text: string): string[][] {
  const frames: string[][] = [];
  let cur: string[] = [];
  for (const row of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (row.trim() === "---") {
      frames.push(cur);
      cur = [];
    } else cur.push(row);
  }
  if (cur.length > 0 && !(cur.length === 1 && cur[0] === "")) {
    if (cur[cur.length - 1] === "") cur.pop();
    frames.push(cur);
  }
  return frames;
}

interface RawFrame {
  rows: string[];
  hold: number;
  colors: unknown;
  backgrounds: unknown;
  at: string;
}

function colorProblem(v: unknown): boolean {
  return typeof v !== "string" || !isHexColor(v) || v.length === 9;
}

type Err = (code: string, message: string, fix: string, path?: string) => void;

/**
 * Reads the `framesFile` or `frames` of `container` (the scene, or a layer) into raw frames. `prefix` goes in front of paths and
 * messages: "" for the scene, "layers[1]." for a layer.
 */
function readRawFrames(container: Obj, io: AsciiIo | undefined, err: Err, prefix: string): RawFrame[] {
  const rawFrames: RawFrame[] = [];
  if (container["framesFile"] !== undefined) {
    const ff = `${prefix}framesFile`;
    if (typeof container["framesFile"] !== "string") err("E-ASCII-FRAMES", `"${ff}" must be a path to a text file.`, `Use "framesFile": "rocket.txt".`, ff);
    else if (!io) err("E-ASCII-FILE", `"${ff}" needs file access, which is not available here.`, "Run gertie ascii lint on the file instead.", ff);
    else {
      const text = io.readText(container["framesFile"]);
      if (text === undefined) err("E-ASCII-FILE", `${ff} '${container["framesFile"]}' was not found.`, "Check the path. It is relative to the scene file.", ff);
      else framesOfFile(text).forEach((rows, i) => rawFrames.push({ rows, hold: 1, colors: undefined, backgrounds: undefined, at: `${ff} frame ${i}` }));
    }
  } else if (Array.isArray(container["frames"])) {
    container["frames"].forEach((f: unknown, i: number) => {
      const path = `${prefix}frames[${i}]`;
      if (!isObj(f)) return err("E-ASCII-FRAME", `${path} must be an object with "text" or "file".`, 'Use {"text": ["row one", "row two"]} or {"file": "frames/01.txt"}.', path);
      for (const k of Object.keys(f)) if (!FRAME_FIELDS.includes(k)) err("E-ASCII-FRAME", `Unknown field '${k}' in ${path}.${didYouMean(k, FRAME_FIELDS)}`, `Allowed fields: ${FRAME_FIELDS.join(", ")}.`, `${path}.${k}`);
      let hold = 1;
      if (f["hold"] !== undefined) {
        if (typeof f["hold"] === "number" && Number.isInteger(f["hold"]) && f["hold"] >= 1 && f["hold"] <= 600) hold = f["hold"];
        else err("E-ASCII-HOLD", `${path}.hold must be a whole number from 1 to 600, found ${JSON.stringify(f["hold"])}.`, "hold counts frame intervals. Use 2 to show a frame for two intervals.", `${path}.hold`);
      }
      if (f["text"] !== undefined && f["file"] !== undefined) return err("E-ASCII-FRAME", `${path} has both "text" and "file".`, "Use one of them.", path);
      let rows: string[] | undefined;
      if (Array.isArray(f["text"]) && f["text"].every((r: unknown) => typeof r === "string")) rows = f["text"] as string[];
      else if (typeof f["text"] === "string") rows = rowsOfText(f["text"]);
      else if (typeof f["file"] === "string") {
        if (!io) return err("E-ASCII-FILE", `${path} names a file, which needs file access.`, "Run gertie ascii lint on the file instead.", path);
        const text = io.readText(f["file"]);
        if (text === undefined) return err("E-ASCII-FILE", `${path}.file '${f["file"]}' was not found.`, "Check the path. It is relative to the scene file.", `${path}.file`);
        rows = rowsOfText(text);
      } else return err("E-ASCII-FRAME", `${path} needs "text" (an array of strings, one per row) or "file" (a text file).`, 'Add "text": ["..."] to the frame.', path);
      rawFrames.push({ rows, hold, colors: f["colors"], backgrounds: f["backgrounds"], at: path });
    });
  } else if (container["frames"] !== undefined) {
    err("E-ASCII-FRAMES", `"${prefix}frames" must be an array.`, 'Use "frames": [{"text": ["..."]}].', `${prefix}frames`);
  }
  return rawFrames;
}

interface Measured {
  maxW: number;
  maxR: number;
  /** Width of each row of each frame, in code points. */
  widths: number[][];
  /** Rows that hold a wide character. */
  wide: number;
}

/** Checks the characters of raw frames (no control characters) and measures them. */
function measureFrames(rawFrames: RawFrame[], err: Err): Measured {
  let wide = 0;
  let maxW = 0;
  let maxR = 0;
  const widths: number[][] = [];
  for (const f of rawFrames) {
    const w: number[] = [];
    f.rows.forEach((row, r) => {
      if (hasControl(row)) {
        const bad = [...row].find((c) => isControl(c.codePointAt(0) as number)) as string;
        err("E-ASCII-CHAR", `${f.at} row ${r} contains a control character (U+${(bad.codePointAt(0) as number).toString(16).toUpperCase().padStart(4, "0")}). Tabs are not allowed.`, "Replace tabs with spaces and remove other control characters.", f.at);
      }
      const cps = [...row];
      if (cps.some((c) => isWide(c.codePointAt(0) as number))) wide++;
      w.push(cps.length);
      maxW = Math.max(maxW, cps.length);
    });
    widths.push(w);
    maxR = Math.max(maxR, f.rows.length);
  }
  return { maxW, maxR, widths, wide };
}

/** Raw frames padded to `cols` by `rows` cells, with their colours and backgrounds read. */
function normalizeFrames(rawFrames: RawFrame[], rows: number, cols: number, d: Diagnostic[]): NAsciiFrame[] {
  const frames: NAsciiFrame[] = [];
  for (const f of rawFrames) {
    const cells: string[][] = [];
    for (let r = 0; r < rows; r++) {
      const cps = [...(f.rows[r] ?? "")];
      while (cps.length < cols) cps.push(" ");
      cells.push(cps);
    }
    const colors = f.colors === undefined ? null : readColors(f.colors, f.at, rows, cols, d, "colors");
    const backgrounds = f.backgrounds === undefined ? null : readColors(f.backgrounds, f.at, rows, cols, d, "backgrounds");
    frames.push({ cells, colors, backgrounds, hold: f.hold });
  }
  return frames;
}

/** With `dot` and `square` glyphs, every character drawn must be in the ramp, since its size comes from its place there. */
function checkRampChars(frames: NAsciiFrame[], rawFrames: RawFrame[], style: NAsciiStyle, d: Diagnostic[], err: Err): void {
  if (style.glyph === "text" || style.ramp === null) return;
  const known = new Set([...style.ramp]);
  for (let i = 0; i < frames.length && !d.some((x) => x.code === "E-ASCII-STYLE" && x.path === "style.ramp"); i++) {
    const cells = (frames[i] as NAsciiFrame).cells;
    for (let r = 0; r < cells.length; r++) {
      const c = (cells[r] as string[]).findIndex((ch) => ch !== " " && !known.has(ch));
      if (c >= 0) {
        const ch = (cells[r] as string[])[c] as string;
        err("E-ASCII-STYLE", `${(rawFrames[i] as RawFrame).at} row ${r} column ${c} holds '${ch}', which is not in style.ramp, so its ${style.glyph} size is unknown.`, `Add '${ch}' to style.ramp, or draw only with characters of the ramp.`, "style.ramp");
        break;
      }
    }
  }
}

/** Reads and checks an ASCII scene. Pure apart from `io`, which reads text files that the scene names. */
export function parseAscii(raw: unknown, opts: ParseOptions = {}): ParseResult {
  const d: Diagnostic[] = [];
  const err = (code: string, message: string, fix: string, path?: string): void => void d.push(makeDiagnostic(code, message, fix, path === undefined ? {} : { path }));
  if (!isObj(raw)) {
    err("E-ASCII-SHAPE", "The file must be a JSON object.", 'Write an object like {"ascii": 1, "fps": 8, "frames": [{"text": ["..."]}]}.');
    return { diagnostics: d };
  }
  if (raw["ascii"] !== 1) {
    err("E-ASCII-VERSION", `"ascii" must be the number 1, found ${JSON.stringify(raw["ascii"])}.`, 'Add "ascii": 1 at the top of the file.', "ascii");
  }
  for (const k of Object.keys(raw)) {
    if (!TOP_FIELDS.includes(k)) err("E-ASCII-FIELD", `Unknown field '${k}'.${didYouMean(k, TOP_FIELDS)}`, `Allowed fields: ${TOP_FIELDS.filter((f) => f !== "$schema").join(", ")}.`, k);
  }

  // name
  let name = opts.name ?? "ascii";
  if (raw["name"] !== undefined) {
    if (typeof raw["name"] === "string" && NAME_RE.test(raw["name"])) name = raw["name"];
    else err("E-ASCII-NAME", `"name" must be lowercase letters, digits and hyphens, found ${JSON.stringify(raw["name"])}.`, 'Use a name like "rocket-launch".', "name");
  } else if (!NAME_RE.test(name)) name = "ascii";

  // fps and loop
  let fps = 8;
  if (raw["fps"] !== undefined) {
    if (typeof raw["fps"] === "number" && Number.isFinite(raw["fps"]) && raw["fps"] >= 1 && raw["fps"] <= 30) fps = raw["fps"];
    else err("E-ASCII-FPS", `"fps" must be a number from 1 to 30, found ${JSON.stringify(raw["fps"])}.`, "Use 6 to 12. Eight reads as deliberate, thirty looks like noise.", "fps");
  }
  let loop = true;
  if (raw["loop"] !== undefined) {
    if (typeof raw["loop"] === "boolean") loop = raw["loop"];
    else err("E-ASCII-LOOP", `"loop" must be true or false, found ${JSON.stringify(raw["loop"])}.`, 'Use "loop": true or "loop": false.', "loop");
  }

  // style
  const style: NAsciiStyle = { color: DEFAULT_COLOR, background: DEFAULT_BACKGROUND as string | null, gradient: null, fontSize: DEFAULT_FONT_SIZE, fontFamily: DEFAULT_FONT_FAMILY, glyph: "text", ramp: null, cellAspect: DEFAULT_CELL_ASPECT, glow: 0 };
  if (raw["style"] !== undefined) {
    const s = raw["style"];
    if (!isObj(s)) err("E-ASCII-STYLE", '"style" must be an object.', 'Use {"color": "#22c55e", "background": "#0b0f19", "fontSize": 16}.', "style");
    else {
      for (const k of Object.keys(s)) if (!STYLE_FIELDS.includes(k)) err("E-ASCII-STYLE", `Unknown style field '${k}'.${didYouMean(k, STYLE_FIELDS)}`, `Allowed style fields: ${STYLE_FIELDS.join(", ")}.`, `style.${k}`);
      if (s["color"] !== undefined) {
        if (colorProblem(s["color"])) err("E-ASCII-COLOR", `style.color must be a hex colour like #22c55e, found ${JSON.stringify(s["color"])}.`, "Use #rgb or #rrggbb.", "style.color");
        else style.color = s["color"] as string;
      }
      if (s["background"] !== undefined) {
        if (s["background"] === null || s["background"] === "transparent") style.background = null;
        else if (isObj(s["background"])) readGradient(s["background"], style, err);
        else if (colorProblem(s["background"])) err("E-ASCII-COLOR", `style.background must be a hex colour, "transparent" or a gradient object, found ${JSON.stringify(s["background"])}.`, 'Use #rgb, #rrggbb, "transparent" or {"from": "#0b0f19", "to": "#1e293b", "angle": 180}.', "style.background");
        else style.background = s["background"] as string;
      }
      if (s["fontSize"] !== undefined) {
        if (typeof s["fontSize"] === "number" && s["fontSize"] >= 6 && s["fontSize"] <= 64) style.fontSize = s["fontSize"];
        else err("E-ASCII-STYLE", `style.fontSize must be a number from 6 to 64, found ${JSON.stringify(s["fontSize"])}.`, "Use 12 to 20.", "style.fontSize");
      }
      if (s["glyph"] !== undefined) {
        if (typeof s["glyph"] === "string" && (GLYPHS as readonly string[]).includes(s["glyph"])) style.glyph = s["glyph"] as AsciiGlyph;
        else err("E-ASCII-STYLE", `style.glyph must be one of ${GLYPHS.join(", ")}, found ${JSON.stringify(s["glyph"])}.${typeof s["glyph"] === "string" ? didYouMean(s["glyph"], [...GLYPHS]) : ""}`, '"text" draws characters; "dot" and "square" draw filled shapes and need "ramp".', "style.glyph");
      }
      if (s["ramp"] !== undefined) {
        if (typeof s["ramp"] === "string" && [...s["ramp"]].length >= 2 && !hasControl(s["ramp"])) style.ramp = s["ramp"];
        else err("E-ASCII-STYLE", `style.ramp must be a string of at least two printable characters, ordered from empty to full, found ${JSON.stringify(s["ramp"])}.`, 'Use the ramp the frames were made with, for example " .:-=+*#%@".', "style.ramp");
      }
      if (s["cellAspect"] !== undefined) {
        if (typeof s["cellAspect"] === "number" && s["cellAspect"] >= 0.5 && s["cellAspect"] <= 4) style.cellAspect = s["cellAspect"];
        else err("E-ASCII-STYLE", `style.cellAspect must be a number from 0.5 to 4, found ${JSON.stringify(s["cellAspect"])}.`, "It is the height of a cell over its width. Use 2 for text, 1 for square cells (dots and squares).", "style.cellAspect");
      }
      if (s["glow"] !== undefined) {
        if (typeof s["glow"] === "number" && s["glow"] >= 0 && s["glow"] <= 1) style.glow = s["glow"];
        else err("E-ASCII-STYLE", `style.glow must be a number from 0 to 1, found ${JSON.stringify(s["glow"])}.`, "Use 0 for none, 0.3 to 0.6 for a soft glow.", "style.glow");
      }
      if (style.glyph !== "text" && style.ramp === null && s["glyph"] !== undefined && !d.some((x) => x.path === "style.glyph" || x.path === "style.ramp")) {
        err("E-ASCII-STYLE", `style.glyph is "${style.glyph}" but style.ramp is missing. The size of each ${style.glyph} comes from the character's place in the ramp.`, 'Add "ramp": " .:-=+*#%@", the ramp the frames were made with.', "style.ramp");
      }
      if (s["fontFamily"] !== undefined) {
        if (typeof s["fontFamily"] === "string" && s["fontFamily"].trim() !== "" && !/[<>&"]/.test(s["fontFamily"])) style.fontFamily = s["fontFamily"];
        else err("E-ASCII-STYLE", `style.fontFamily must be a CSS font stack without quotes of the double kind, found ${JSON.stringify(s["fontFamily"])}.`, "Use a monospace stack, for example \"Menlo,Consolas,monospace\".", "style.fontFamily");
      }
    }
  }

  // fx: effects in time, for every form
  const fx = raw["fx"] !== undefined ? parseFx(raw["fx"], d) : [];
  fx.forEach((e, i) => {
    if (e.effect === "type") err("E-ASCII-FX", `fx[${i}] is "type", which types the text of a text layer; the scene's own fx cannot type.`, 'Move it into the fx of a text layer: "layers": [{"text": ["HELLO"], "fx": [{"effect": "type", "at": 0}]}].', `fx[${i}]`);
  });

  // frames: either inline, named files, or one framesFile
  const io = opts.io;
  const forms = (["frames", "framesFile", "source", "layers"] as const).filter((k) => raw[k] !== undefined);
  if (raw["duration"] !== undefined && raw["layers"] === undefined) err("E-ASCII-SIZE", '"duration" is set but the scene has no "layers". A scene of frames or a recipe takes its length from its frames or its source.', 'Remove "duration", or build the scene from "layers".', "duration");
  let rawFrames: RawFrame[] = [];
  if (forms.length > 1) {
    err("E-ASCII-FRAMES", `${forms.map((k) => `"${k}"`).join(" and ")} are ${forms.length === 2 ? "both" : "all"} present. A scene has exactly one of them.`, 'Use one. "frames" lists frames, "framesFile" names one text file with frames separated by a line containing only ---, "source" names a file to convert when the animation is rendered, and "layers" places several animations on one grid.', forms[1] as string);
  } else if (raw["layers"] !== undefined) {
    return parseLayered(raw, d, { name, fps, loop, style, fx }, io);
  } else if (raw["source"] !== undefined) {
    return parseRecipe(raw, d, { name, fps, loop, style, fx });
  } else rawFrames = readRawFrames(raw, io, err, "");
  if (raw["frames"] === undefined && raw["framesFile"] === undefined && raw["source"] === undefined && raw["layers"] === undefined) err("E-ASCII-NOFRAMES", "The scene has no frames.", 'Add "frames": [...], "framesFile": "frames.txt", or "source": {"file": "scene.gertie.json"} to convert a file.', "frames");
  else if (rawFrames.length === 0 && !d.some((x) => x.severity === "error")) err("E-ASCII-NOFRAMES", "The scene has no frames.", "Add at least one frame.", "frames");
  if (rawFrames.length > MAX_FRAMES) err("E-ASCII-TOOMANY", `The scene has ${rawFrames.length} frames, more than the limit of ${MAX_FRAMES}.`, "Use fewer frames, a shorter clip or a lower frame rate.", "frames");

  // character checks and size
  const { maxW, maxR, widths, wide } = measureFrames(rawFrames, err);

  // cols and rows: explicit, or inferred from the content
  let cols = Math.max(1, maxW);
  let rows = Math.max(1, maxR);
  let colsGiven = false;
  let rowsGiven = false;
  if (raw["cols"] !== undefined) {
    if (typeof raw["cols"] === "number" && Number.isInteger(raw["cols"]) && raw["cols"] >= 1 && raw["cols"] <= MAX_COLS) {
      cols = raw["cols"];
      colsGiven = true;
    } else err("E-ASCII-SIZE", `"cols" must be a whole number from 1 to ${MAX_COLS}, found ${JSON.stringify(raw["cols"])}.`, "Use 40 for a README, up to 80 for a wide banner.", "cols");
  }
  if (raw["rows"] !== undefined) {
    if (typeof raw["rows"] === "number" && Number.isInteger(raw["rows"]) && raw["rows"] >= 1 && raw["rows"] <= MAX_ROWS) {
      rows = raw["rows"];
      rowsGiven = true;
    } else err("E-ASCII-SIZE", `"rows" must be a whole number from 1 to ${MAX_ROWS}, found ${JSON.stringify(raw["rows"])}.`, "Use 12 to 24.", "rows");
  }
  if (!colsGiven && maxW > MAX_COLS) err("E-ASCII-SIZE", `The widest row is ${maxW} characters, more than the limit of ${MAX_COLS}.`, "Make the rows shorter.", "cols");
  if (!rowsGiven && maxR > MAX_ROWS) err("E-ASCII-SIZE", `The tallest frame has ${maxR} rows, more than the limit of ${MAX_ROWS}.`, "Use fewer rows.", "rows");
  for (let i = 0; i < rawFrames.length; i++) {
    const f = rawFrames[i] as RawFrame;
    if (rowsGiven && f.rows.length > rows) err("E-ASCII-ROWS", `${f.at} has ${f.rows.length} rows but "rows" is ${rows}.`, `Remove ${f.rows.length - rows} row(s) from the frame, or set "rows" to ${f.rows.length}.`, f.at);
    if (colsGiven) {
      (widths[i] as number[]).forEach((w, r) => {
        if (w > cols) err("E-ASCII-WIDTH", `${f.at} row ${r} is ${w} characters wide but "cols" is ${cols}.`, `Shorten the row to ${cols} characters, or set "cols" to ${w}.`, f.at);
      });
    }
  }
  if (wide > 0) d.push(makeDiagnostic("W-ASCII-WIDE", `${wide} row(s) contain wide characters (CJK or emoji). They take two cells in most fonts and break the grid.`, "Use ASCII, box-drawing or block characters.", {}));

  // An effect must lie inside the animation. A recipe's length is not known until its source is opened, which checks it there.
  if (fx.length > 0) d.push(...checkFxRange(fx, rawFrames.reduce((n, f) => n + f.hold, 0) / fps));
  if (d.some((x) => x.severity === "error")) return { diagnostics: d };

  // normalize
  const frames = normalizeFrames(rawFrames, rows, cols, d);
  checkRampChars(frames, rawFrames, style, d, err);
  if (d.some((x) => x.severity === "error")) return { diagnostics: d };

  const scene: NAscii = { name, cols, rows, fps, loop, style, frames, source: null, fx };
  d.push(...lintAscii(scene));
  return { scene, diagnostics: d };
}

/** The recipe form: `source` instead of frames. Grid size lives in `source`; the frames are computed by `framesOf`. */
function parseRecipe(raw: Obj, d: Diagnostic[], head: Pick<NAscii, "name" | "fps" | "loop" | "style" | "fx">): ParseResult {
  for (const k of ["cols", "rows"]) {
    if (raw[k] !== undefined) d.push(makeDiagnostic("E-ASCII-SIZE", `"${k}" is at the top of a scene that has "source". The grid of a recipe is set in source.`, `Move it into source: "source": {"file": "...", "${k}": ${JSON.stringify(raw[k])}}.`, { path: k }));
  }
  const r = parseSource(raw["source"], head.style.glyph);
  d.push(...r.diagnostics);
  if (!r.source || d.some((x) => x.severity === "error")) return { diagnostics: d };
  const scene: NAscii = { ...head, cols: r.source.cols, rows: r.source.rows ?? 0, frames: [], source: r.source };
  d.push(...lintAscii(scene));
  return { scene, diagnostics: d };
}

type Head = Pick<NAscii, "name" | "fps" | "loop" | "style" | "fx">;

/** Diagnostics of a sub-parser, moved under a layer: the path gets the layer's place, the message its name. */
const underLayer = (x: Diagnostic, at: string, label: string): Diagnostic => ({ ...x, message: `${label}: ${x.message}`, ...(x.path !== undefined ? { path: `${at}.${x.path}` } : { path: at }) });

/** The scene form with `layers`: several animations placed on one grid. `cols`, `rows` and `duration` are required. */
function parseLayered(raw: Obj, d: Diagnostic[], head: Head, io: AsciiIo | undefined): ParseResult {
  const err: Err = (code, message, fix, path) => void d.push(makeDiagnostic(code, message, fix, path === undefined ? {} : { path }));
  const size = (k: "cols" | "rows", max: number, fix: string): number => {
    const v = raw[k];
    if (v === undefined) err("E-ASCII-SIZE", `A scene with "layers" needs "${k}": the layers are placed on a grid of that size.`, fix, k);
    else if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > max) err("E-ASCII-SIZE", `"${k}" must be a whole number from 1 to ${max}, found ${JSON.stringify(v)}.`, fix, k);
    else return v;
    return 0;
  };
  const cols = size("cols", MAX_RECIPE_COLS, `Add "cols": 80, the width of the grid in cells (up to ${MAX_RECIPE_COLS}).`);
  const rows = size("rows", MAX_RECIPE_ROWS, `Add "rows": 24, the height of the grid in cells (up to ${MAX_RECIPE_ROWS}).`);
  let duration = 0;
  const dv = raw["duration"];
  if (dv === undefined) err("E-ASCII-SIZE", 'A scene with "layers" needs "duration", its length in seconds.', 'Add "duration": 6.', "duration");
  else if (typeof dv !== "number" || !Number.isFinite(dv) || dv <= 0 || dv > 3600) err("E-ASCII-SIZE", `"duration" must be a number of seconds above 0, found ${JSON.stringify(dv)}.`, 'Use the length of the animation, for example "duration": 6.', "duration");
  else duration = dv;
  if (duration > 0 && layeredIntervals({ fps: head.fps, duration }) > MAX_RECIPE_FRAMES) {
    err("E-ASCII-TOOMANY", `${duration} s at ${head.fps} fps is ${layeredIntervals({ fps: head.fps, duration })} frames, more than the limit of ${MAX_RECIPE_FRAMES}.`, `Set "duration" to ${Math.floor((MAX_RECIPE_FRAMES / head.fps) * 10) / 10} or less, or lower "fps".`, "duration");
  }
  if (duration > 0) d.push(...checkFxRange(head.fx, duration));

  const list = raw["layers"];
  const layers: NAsciiLayer[] = [];
  if (!Array.isArray(list) || list.length === 0) {
    err("E-ASCII-LAYER", '"layers" must be a list of at least one layer.', 'Use "layers": [{"id": "sky", "framesFile": "sky.txt"}, {"id": "ship", "text": ["<=>"], "at": [[0, 0, 4], [3, 60, 4]]}].', "layers");
    return { diagnostics: d };
  }
  const ids = new Set<string>();
  list.forEach((l: unknown, i: number) => {
    const at = `layers[${i}]`;
    if (!isObj(l)) return err("E-ASCII-LAYER", `${at} must be an object.`, 'Use {"id": "ship", "framesFile": "ship.txt", "at": [[0, 0, 4]]}.', at);
    const before = d.length;
    let id: string | null = null;
    if (l["id"] !== undefined) {
      if (typeof l["id"] === "string" && NAME_RE.test(l["id"]) && !ids.has(l["id"])) {
        id = l["id"];
        ids.add(id);
      } else err("E-ASCII-LAYER", typeof l["id"] === "string" && ids.has(l["id"]) ? `${at}.id "${l["id"]}" is used by an earlier layer.` : `${at}.id must be lowercase letters, digits and hyphens, found ${JSON.stringify(l["id"])}.`, 'Give each layer its own id, like "koi-1".', `${at}.id`);
    }
    const label = id === null ? at : `${at} ("${id}")`;
    for (const k of Object.keys(l)) if (!LAYER_FIELDS.includes(k)) err("E-ASCII-LAYER", `Unknown field '${k}' in ${label}.${didYouMean(k, LAYER_FIELDS)}`, `Allowed layer fields: ${LAYER_FIELDS.join(", ")}.`, `${at}.${k}`);
    const forms = LAYER_FORMS.filter((k) => l[k] !== undefined);
    if (forms.length !== 1) {
      err("E-ASCII-FRAMES", forms.length === 0 ? `${label} has no picture.` : `${label} has ${forms.map((k) => `"${k}"`).join(" and ")}. A layer has exactly one of them.`, 'Use one of "source" (a file to convert), "framesFile" (a text file of frames), "frames" (a list of frames) or "text" (a still block of rows).', at);
      return;
    }
    const form = forms[0] as (typeof LAYER_FORMS)[number];

    // the picture
    let frames: NAsciiFrame[] = [];
    let source: NAsciiSource | null = null;
    if (form === "source") {
      const r = parseSource(l["source"], head.style.glyph);
      d.push(...r.diagnostics.map((x) => underLayer(x, at, label)));
      source = r.source ?? null;
    } else {
      let raws: RawFrame[];
      if (form === "text") {
        const t = l["text"];
        const rowsT = Array.isArray(t) && t.length > 0 && t.every((x: unknown) => typeof x === "string") ? (t as string[]) : typeof t === "string" && t !== "" ? rowsOfText(t) : undefined;
        if (rowsT === undefined) {
          err("E-ASCII-LAYER", `${label}.text must be a list of rows (strings) or one string with newlines, found ${JSON.stringify(t)}.`, 'Use "text": ["SCENE 01", "SUBJECT: KOI"].', `${at}.text`);
          raws = [];
        } else raws = [{ rows: rowsT, hold: 1, colors: undefined, backgrounds: undefined, at: `${at}.text` }];
      } else raws = readRawFrames(l, io, err, `${at}.`);
      if (raws.length > MAX_FRAMES) err("E-ASCII-TOOMANY", `${label} has ${raws.length} frames, more than the limit of ${MAX_FRAMES}.`, "Use fewer frames.", at);
      const m = measureFrames(raws, err);
      if (m.maxW > MAX_COLS) err("E-ASCII-SIZE", `${label} has a row ${m.maxW} characters wide, more than the limit of ${MAX_COLS}.`, "Make the rows shorter, or convert the picture with \"source\".", at);
      if (m.maxR > MAX_ROWS) err("E-ASCII-SIZE", `${label} has a frame of ${m.maxR} rows, more than the limit of ${MAX_ROWS}.`, "Use fewer rows, or convert the picture with \"source\".", at);
      if (m.wide > 0) d.push(makeDiagnostic("W-ASCII-WIDE", `${label}: ${m.wide} row(s) contain wide characters (CJK or emoji). They take two cells in most fonts and break the grid.`, "Use ASCII, box-drawing or block characters.", { path: at }));
      if (raws.length === 0 && d.length === before) err("E-ASCII-NOFRAMES", `${label} has no frames.`, "Add at least one frame.", at);
      if (d.length === before) {
        frames = normalizeFrames(raws, Math.max(1, m.maxR), Math.max(1, m.maxW), d);
        checkRampChars(frames, raws, head.style, d, err);
      }
    }

    // colour
    let color: string | null = null;
    if (l["color"] !== undefined) {
      if (colorProblem(l["color"])) err("E-ASCII-COLOR", `${label}.color must be a hex colour like #e5533c, found ${JSON.stringify(l["color"])}.`, "Use #rgb or #rrggbb. It colours the cells of the layer that have no colour of their own.", `${at}.color`);
      else color = l["color"] as string;
    }

    // position keyframes
    const keys = l["at"] === undefined ? [] : readKeys(l["at"], at, label, err);

    // time
    const time = (k: "from" | "to", def: number): number => {
      const v = l[k];
      if (v === undefined) return def;
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || (duration > 0 && v > duration)) {
        err("E-ASCII-LAYER", `${label}.${k} must be a number of seconds from 0 to the scene's duration${duration > 0 ? ` (${duration})` : ""}, found ${JSON.stringify(v)}.`, `"from" and "to" bound when the layer is there, in scene seconds.`, `${at}.${k}`);
        return def;
      }
      return v;
    };
    const from = time("from", 0);
    const to = time("to", duration);
    if (l["from"] !== undefined && l["to"] !== undefined && to <= from) err("E-ASCII-LAYER", `${label} has "to" (${to}) at or before "from" (${from}), so it is never there.`, `Set "to" later than "from".`, `${at}.to`);
    let loop = true;
    if (l["loop"] !== undefined) {
      if (typeof l["loop"] === "boolean") loop = l["loop"];
      else err("E-ASCII-LAYER", `${label}.loop must be true or false, found ${JSON.stringify(l["loop"])}.`, "true repeats a layer shorter than its time; false holds its last frame.", `${at}.loop`);
    }

    // effects, in scene seconds
    let fx: NAsciiLayer["fx"] = [];
    if (l["fx"] !== undefined) {
      const sub: Diagnostic[] = [];
      fx = parseFx(l["fx"], sub);
      fx.forEach((e, j) => {
        if (e.effect === "type" && form !== "text") sub.push(makeDiagnostic("E-ASCII-FX", `fx[${j}] is "type", which works only on a text layer.`, `Give the layer "text" in place of "${form}", or use "reveal" with "by": "cols-right".`, { path: `fx[${j}]` }));
      });
      if (duration > 0) sub.push(...checkFxRange(fx, duration));
      d.push(...sub.map((x) => underLayer(x, at, label)));
    }
    if (d.slice(before).some((x) => x.severity === "error")) return;
    layers.push({ id, label, frames, source, text: form === "text", color, at: keys, fx, from, to, loop });
  });
  if (d.some((x) => x.severity === "error")) return { diagnostics: d };
  const scene: NAscii = { ...head, cols, rows, frames: [], source: null, layers, duration };
  d.push(...lintAscii(scene));
  return { scene, diagnostics: d };
}

/** Reads a layer's `at`: keyframes `[seconds, column, row, ease?]` in time order. */
function readKeys(v: unknown, at: string, label: string, err: Err): NLayerKey[] {
  const path = `${at}.at`;
  const fix = 'Use "at": [[0, -30, 12], [6, 170, 12, "easeInOut"]]: seconds, column and row of the layer\'s top-left cell, and an optional easing name or "hold".';
  if (!Array.isArray(v) || !v.every((k: unknown) => Array.isArray(k))) {
    err("E-ASCII-LAYER", `${label}.at must be a list of keyframes, each [seconds, column, row] with an optional easing, found ${JSON.stringify(v)}.`, Array.isArray(v) && v.length >= 3 && typeof v[0] === "number" ? `Wrap the key in a list: "at": [${JSON.stringify(v)}].` : fix, path);
    return [];
  }
  const keys: NLayerKey[] = [];
  let ok = true;
  (v as unknown[][]).forEach((k, j) => {
    const kp = `${path}[${j}]`;
    const nums = k.slice(0, 3);
    if (k.length < 3 || k.length > 4 || !nums.every((n) => typeof n === "number" && Number.isFinite(n)) || Math.abs(nums[1] as number) > 10000 || Math.abs(nums[2] as number) > 10000 || (nums[0] as number) < 0) {
      err("E-ASCII-LAYER", `${label}.at[${j}] must be [seconds, column, row] with an optional easing, seconds 0 or more and cells within 10000 of the grid, found ${JSON.stringify(k)}.`, fix, kp);
      ok = false;
      return;
    }
    let ease: NLayerKey["ease"] = [0, 0, 1, 1];
    if (k.length === 4) {
      const r = resolveEase(k[3]);
      if (r.kind === "ok") ease = r.ease;
      else {
        const names = [...EASING_NAMES, "hold"];
        const why = r.kind === "unknown-name" ? `Unknown easing '${r.name}'.${didYouMean(r.name, names)}` : r.kind === "deferred" ? `The easing '${r.name}' is not available for layers.` : `The easing ${JSON.stringify(k[3])} is not a name or a bezier [x1, y1, x2, y2] with x1 and x2 from 0 to 1.`;
        err("E-ASCII-LAYER", `${label}.at[${j}]: ${why}`, `Use "hold" or one of: ${EASING_NAMES.join(", ")}.`, `${kp}[3]`);
        ok = false;
        return;
      }
    }
    const t = nums[0] as number;
    const prev = keys[keys.length - 1];
    if (prev && t <= prev.t) {
      err("E-ASCII-LAYER", `${label}.at[${j}] is at ${t} s, not after the key before it (${prev.t} s).`, "List keys in time order, each later than the last.", kp);
      ok = false;
      return;
    }
    keys.push({ t, col: nums[1] as number, row: nums[2] as number, ease });
  });
  return ok ? keys : [];
}

function readColors(v: unknown, at: string, rows: number, cols: number, d: Diagnostic[], field: "colors" | "backgrounds"): (string | null)[][] | null {
  const bad = (message: string, fix: string): null => {
    d.push(makeDiagnostic("E-ASCII-COLORS", message, fix, { path: `${at}.${field}` }));
    return null;
  };
  if (!Array.isArray(v)) return bad(`${at}.${field} must be an array with one entry per row.`, `Use "${field}": ["#ff0000", ["#00ff00", null, "#0000ff"]]. A row is one colour or a list with one colour per cell.`);
  if (v.length > rows) return bad(`${at}.${field} has ${v.length} entries but the frame has ${rows} rows.`, `Remove ${v.length - rows} entr${v.length - rows === 1 ? "y" : "ies"}.`);
  const out: (string | null)[][] = [];
  for (let r = 0; r < rows; r++) {
    const e = v[r];
    const row: (string | null)[] = new Array<string | null>(cols).fill(null);
    if (e === undefined || e === null) {
      out.push(row);
      continue;
    }
    if (typeof e === "string") {
      if (colorProblem(e)) return bad(`${at}.${field}[${r}] is not a hex colour: ${JSON.stringify(e)}.`, "Use #rgb or #rrggbb.");
      row.fill(e);
    } else if (Array.isArray(e)) {
      if (e.length > cols) return bad(`${at}.${field}[${r}] has ${e.length} cells but the grid is ${cols} wide.`, `Shorten the list to ${cols} entries.`);
      for (let c = 0; c < e.length; c++) {
        const cell = e[c];
        if (cell === null || cell === undefined) continue;
        if (colorProblem(cell)) return bad(`${at}.${field}[${r}][${c}] is not a hex colour: ${JSON.stringify(cell)}.`, "Use #rgb, #rrggbb or null.");
        row[c] = cell as string;
      }
    } else return bad(`${at}.${field}[${r}] must be a colour, a list of colours or null.`, 'Use "#ff0000" for the whole row or a list with one entry per cell.');
    out.push(row);
  }
  return out;
}

/** Reads a `style.background` gradient object into `style`. */
function readGradient(g: Obj, style: NAsciiStyle, err: (code: string, message: string, fix: string, path?: string) => void): void {
  const fix = 'Use {"from": "#0b0f19", "to": "#1e293b", "angle": 180}. Angle is in degrees: 0 points up, 90 right, 180 down.';
  let ok = true;
  for (const k of Object.keys(g)) {
    if (!GRADIENT_FIELDS.includes(k)) {
      err("E-ASCII-STYLE", `Unknown field '${k}' in style.background.${didYouMean(k, GRADIENT_FIELDS)}`, `Allowed fields: ${GRADIENT_FIELDS.join(", ")}.`, `style.background.${k}`);
      ok = false;
    }
  }
  for (const k of ["from", "to"]) {
    if (g[k] === undefined) {
      err("E-ASCII-STYLE", `style.background has no "${k}" colour.`, fix, `style.background.${k}`);
      ok = false;
    } else if (colorProblem(g[k])) {
      err("E-ASCII-COLOR", `style.background.${k} must be a hex colour like #0b0f19, found ${JSON.stringify(g[k])}.`, "Use #rgb or #rrggbb.", `style.background.${k}`);
      ok = false;
    }
  }
  let angle = 180;
  if (g["angle"] !== undefined) {
    if (typeof g["angle"] === "number" && Number.isFinite(g["angle"]) && g["angle"] >= -360 && g["angle"] <= 360) angle = g["angle"];
    else {
      err("E-ASCII-STYLE", `style.background.angle must be a number of degrees from -360 to 360, found ${JSON.stringify(g["angle"])}.`, fix, "style.background.angle");
      ok = false;
    }
  }
  if (ok) {
    style.gradient = { from: g["from"] as string, to: g["to"] as string, angle };
    style.background = g["from"] as string;
  }
}

/** Fraction of cells that differ between two frames. */
export function frameDifference(a: NAsciiFrame, b: NAsciiFrame): number {
  let diff = 0;
  let n = 0;
  for (let r = 0; r < a.cells.length; r++) {
    const ra = a.cells[r] as string[];
    const rb = b.cells[r] as string[];
    for (let c = 0; c < ra.length; c++) {
      n++;
      if (ra[c] !== rb[c]) diff++;
    }
  }
  return n === 0 ? 0 : diff / n;
}

/** Warnings about a valid scene. */
export function lintAscii(s: NAscii): Diagnostic[] {
  const d: Diagnostic[] = [];
  const warn = (code: string, message: string, fix: string, path?: string): void => void d.push(makeDiagnostic(code, message, fix, path === undefined ? {} : { path }));
  // Small text art reads as noise when fast; dense grids converted from smooth sources look right at 24 to 30.
  if (s.fps > 15 && s.cols < 80) warn("W-ASCII-FPS", `${s.fps} frames per second is fast for text. It reads as noise.`, "Use 6 to 12 frames per second.", "fps");
  // A recipe or a scene of layers has no frames until it is rendered, so the checks of frame content do not apply to it.
  if (s.source !== null || s.layers) return d;
  if (s.frames.every((f) => f.cells.every((row) => row.every((c) => c === " ")))) warn("W-ASCII-EMPTY", "Every frame is blank, so nothing is drawn.", "Draw something in the frames.", "frames");
  if (s.frames.length > 1 && s.frames.every((f) => frameDifference(f, s.frames[0] as NAsciiFrame) === 0 && JSON.stringify(f.colors) === JSON.stringify((s.frames[0] as NAsciiFrame).colors))) warn("W-ASCII-STATIC", "Every frame is identical, so nothing moves.", "Change the frames, or use one frame with a larger hold.", "frames");
  if (s.loop && s.frames.length >= 3) {
    const first = s.frames[0] as NAsciiFrame;
    const last = s.frames[s.frames.length - 1] as NAsciiFrame;
    const wrap = frameDifference(last, first);
    let sum = 0;
    for (let i = 1; i < s.frames.length; i++) sum += frameDifference(s.frames[i - 1] as NAsciiFrame, s.frames[i] as NAsciiFrame);
    const typical = sum / (s.frames.length - 1);
    if (wrap > 0.3 && wrap > 2.5 * typical) warn("W-ASCII-LOOP-JUMP", `The last frame differs from the first in ${Math.round(wrap * 100)}% of cells, while neighbouring frames differ in ${Math.round(typical * 100)}%. The loop will jump.`, 'Make the last frame lead into the first, or set "loop": false.', "frames");
  }
  const cellsTotal = s.cols * s.rows * s.frames.length;
  if (cellsTotal > SVG_CELL_LIMIT) warn("W-ASCII-LARGE", `${s.frames.length} frames of ${s.cols} by ${s.rows} are ${cellsTotal} cells, more than the ${SVG_CELL_LIMIT} an SVG can hold, so this animation exports only to raster and video formats, drawn by the canvas renderer.`, "Keep it if you want video or GIF. For an SVG, use fewer frames or a smaller grid; for a dense animation, write it as a recipe with ascii from --recipe.", "frames");
  return d;
}
