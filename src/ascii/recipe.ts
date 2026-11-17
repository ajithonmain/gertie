import { didYouMean, makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";
import { isHexColor, parseHex } from "../spec/color.ts";
import { DEFAULT_RAMP, NAMED_RAMPS, resolveRamp, type ConvertControls, type ConvertOptions, type RGB } from "./convert.ts";
import { MAX_RECIPE_COLS, MAX_RECIPE_ROWS, type NAsciiSource } from "./types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

/** Every field of `source`: the file, the grid, and each conversion control of `ascii from` by its flag name in camel case. */
export const SOURCE_FIELDS = ["file", "cols", "rows", "maxSeconds", "ramp", "invert", "color", "normalize", "gamma", "threshold", "key", "crop", "colorLevels", "palette", "tint", "chars", "seed", "shimmer", "dither", "edgeColor", "cellBg"];

const colorOk = (v: unknown): v is string => typeof v === "string" && isHexColor(v) && v.length !== 9;
const hasSpaceOrControl = (s: string): boolean => /\s/.test(s) || [...s].some((c) => (c.codePointAt(0) as number) <= 0x1f || (c.codePointAt(0) as number) === 0x7f);

/**
 * Reads and checks the `source` of a recipe. Every problem is `E-ASCII-SOURCE` and names the field, the problem and the fix.
 * `glyph` is the scene's `style.glyph`, which excludes `chars` when it is not `text`.
 */
export function parseSource(raw: unknown, glyph: string): { source?: NAsciiSource; diagnostics: Diagnostic[] } {
  const d: Diagnostic[] = [];
  const err = (field: string, message: string, fix: string): void => void d.push(makeDiagnostic("E-ASCII-SOURCE", message, fix, { path: field === "" ? "source" : `source.${field}` }));
  if (!isObj(raw)) {
    err("", '"source" must be an object naming the file to convert and how.', 'Use "source": {"file": "scene.gertie.json", "cols": 160}.');
    return { diagnostics: d };
  }
  for (const k of Object.keys(raw)) if (!SOURCE_FIELDS.includes(k)) err(k, `Unknown field '${k}' in source.${didYouMean(k, SOURCE_FIELDS)}`, `Allowed fields: ${SOURCE_FIELDS.join(", ")}.`);

  const num = (k: string, min: number, max: number, whole: boolean, fix: string): number | undefined => {
    const v = raw[k];
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isFinite(v) || v < min || v > max || (whole && !Number.isInteger(v))) {
      err(k, `source.${k} must be ${whole ? "a whole number" : "a number"} from ${min} to ${max}, found ${JSON.stringify(v)}.`, fix);
      return undefined;
    }
    return v;
  };
  const bool = (k: string): boolean | undefined => {
    const v = raw[k];
    if (v === undefined) return undefined;
    if (typeof v !== "boolean") {
      err(k, `source.${k} must be true or false, found ${JSON.stringify(v)}.`, `Use "${k}": true or leave it out.`);
      return undefined;
    }
    return v;
  };
  const colour = (k: string): string | undefined => {
    const v = raw[k];
    if (v === undefined) return undefined;
    if (!colorOk(v)) {
      err(k, `source.${k} must be a hex colour like #3b82f6, found ${JSON.stringify(v)}.`, "Use #rgb or #rrggbb.");
      return undefined;
    }
    return v;
  };

  let file = "";
  if (typeof raw["file"] === "string" && raw["file"].trim() !== "") file = raw["file"];
  else err("file", raw["file"] === undefined ? "source has no file." : `source.file must be a path, found ${JSON.stringify(raw["file"])}.`, 'Name the vector scene, video, GIF or image to convert, relative to this file: "file": "bouquet.gertie.json".');

  const cols = num("cols", 4, MAX_RECIPE_COLS, true, `Use 120 to 200 for a dense animation. A recipe allows up to ${MAX_RECIPE_COLS} columns.`) ?? 80;
  const rows = num("rows", 1, MAX_RECIPE_ROWS, true, `Leave rows out to keep the source's proportions, or use up to ${MAX_RECIPE_ROWS}.`);
  const maxSeconds = num("maxSeconds", 0.1, 120, false, "Use the number of seconds of the source to convert, for example 8.");

  let ramp = DEFAULT_RAMP;
  if (raw["ramp"] !== undefined) {
    const v = raw["ramp"];
    if (typeof v === "string" && [...resolveRamp(v)].length >= 2 && !/[\u0000-\u001f\u007f]/.test(v)) ramp = resolveRamp(v);
    else err("ramp", `source.ramp must be a ramp name (${Object.keys(NAMED_RAMPS).join(", ")}) or at least two characters ordered from empty to full, found ${JSON.stringify(v)}.`, 'Use "ramp": "long", or a literal ramp such as " .:-=+*#%@".');
  }
  const invert = bool("invert") ?? false;
  const color = bool("color") ?? false;
  const normalize = bool("normalize");
  const gamma = num("gamma", 0.1, 10, false, "Use 1 for no change; below 1 lifts dark areas.");
  const threshold = num("threshold", 0, 1, false, "Use 0 for none, 0.1 to 0.3 to drop faint cells.");
  const colorLevels = num("colorLevels", 2, 32, true, "Use 4 to 16 levels per channel.");
  const seed = num("seed", 0, 4294967295, true, "Use any whole number; the same seed gives the same characters.");
  const shimmer = num("shimmer", 0, 1, false, "Use 0.02 to 0.1 for a light flicker.");
  const cellBg = num("cellBg", 0, 1, false, "Use 0.35 for a fill at about a third of the cell's colour.");
  const tint = colour("tint");
  const edgeColor = colour("edgeColor");

  let key: "auto" | string | undefined;
  if (raw["key"] !== undefined) {
    if (raw["key"] === "auto" || colorOk(raw["key"])) key = raw["key"] as string;
    else err("key", `source.key must be "auto" or a hex colour, found ${JSON.stringify(raw["key"])}.`, '"auto" takes the colour of the edge of the first frame as the background; or give it, for example "#000000".');
  }
  let crop: NAsciiSource["crop"];
  if (raw["crop"] !== undefined) {
    const v = raw["crop"];
    const ok = Array.isArray(v) && v.length === 4 && v.every((p) => typeof p === "number" && Number.isInteger(p)) && (v[0] as number) >= 0 && (v[1] as number) >= 0 && (v[2] as number) >= 1 && (v[3] as number) >= 1;
    if (ok) crop = { x: v[0] as number, y: v[1] as number, w: v[2] as number, h: v[3] as number };
    else err("crop", `source.crop must be four whole numbers [x, y, w, h] in source pixels, with w and h at least 1, found ${JSON.stringify(v)}.`, 'Use "crop": [100, 50, 800, 600].');
  }
  let palette: string[] | undefined;
  if (raw["palette"] !== undefined) {
    const v = raw["palette"];
    if (Array.isArray(v) && v.length > 0 && v.every(colorOk)) palette = v as string[];
    else err("palette", `source.palette must be a list of hex colours, found ${JSON.stringify(v)}.`, 'Use "palette": ["#7cb342", "#f48fb1", "#f5f5f5"].');
  }
  let chars: string | undefined;
  if (raw["chars"] !== undefined) {
    const v = raw["chars"];
    if (typeof v === "string" && v !== "" && !hasSpaceOrControl(v)) chars = v;
    else err("chars", `source.chars must be a set of visible characters without spaces, found ${JSON.stringify(v)}.`, 'Use "chars": "CZ".');
  }
  let dither: "ordered" | undefined;
  if (raw["dither"] !== undefined) {
    if (raw["dither"] === "ordered") dither = "ordered";
    else err("dither", `source.dither must be "ordered", found ${JSON.stringify(raw["dither"])}.`, 'Use "dither": "ordered" or leave it out.');
  }

  // The combinations `ascii from` refuses are refused here too, with the same reasons.
  if (tint !== undefined && palette !== undefined) err("tint", "source.tint and source.palette cannot be combined: palette picks from a list of colours, tint scales one colour.", "Remove one of them.");
  if (chars !== undefined && raw["ramp"] !== undefined) err("chars", "source.chars and source.ramp cannot be combined: chars replaces the ramp.", "Remove one of them.");
  if (chars !== undefined && dither !== undefined) err("dither", "source.dither works on a ramp and has no effect with source.chars.", "Remove one of them.");
  if (shimmer !== undefined && shimmer > 0 && chars === undefined) err("shimmer", "source.shimmer needs source.chars: it changes which character a cell shows, and without chars the character comes from brightness.", 'Add "chars", or remove "shimmer".');
  if (seed !== undefined && chars === undefined) err("seed", "source.seed needs source.chars: it only decides which character each cell gets.", 'Add "chars", or remove "seed".');
  if (colorLevels !== undefined && !color && chars === undefined && palette === undefined && tint === undefined) err("colorLevels", "source.colorLevels needs colour.", 'Add "color": true (or chars, palette or tint).');
  if (colorLevels !== undefined && palette !== undefined) err("colorLevels", "source.colorLevels has no effect with source.palette.", "Remove one of them.");
  if (chars !== undefined && glyph !== "text") err("chars", `style.glyph "${glyph}" sizes each shape by its place in a ramp, so it cannot be combined with source.chars.`, 'Use a ramp, or set style.glyph to "text".');

  if (d.length > 0) return { diagnostics: d };
  const source: NAsciiSource = {
    file,
    cols,
    rows: rows ?? null,
    maxSeconds: maxSeconds ?? null,
    ramp,
    invert,
    color,
    normalize: normalize ?? null,
    ...(gamma !== undefined ? { gamma } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
    ...(key !== undefined ? { key } : {}),
    ...(crop !== undefined ? { crop } : {}),
    ...(colorLevels !== undefined ? { colorLevels } : {}),
    ...(palette !== undefined ? { palette } : {}),
    ...(tint !== undefined ? { tint } : {}),
    ...(chars !== undefined ? { chars } : {}),
    ...(seed !== undefined ? { seed } : {}),
    ...(shimmer !== undefined ? { shimmer } : {}),
    ...(dither !== undefined ? { dither } : {}),
    ...(edgeColor !== undefined ? { edgeColor } : {}),
    ...(cellBg !== undefined ? { cellBg } : {}),
  };
  return { source, diagnostics: d };
}

const rgb = (hex: string): RGB => {
  const c = parseHex(hex) as [number, number, number, number];
  return [c[0], c[1], c[2]];
};

/**
 * The converter options for a source, once its kind is known. These are exactly the options `ascii from` passes for the same flags:
 * a vector scene is read by coverage (transparent) or by distance from its background, never inverted, and not normalised unless asked;
 * video and images are read by brightness and normalised unless `normalize` is false.
 */
export function convertOptionsFor(src: NAsciiSource, kind: "scene" | "media", background: RGB | null, styleColor: string): ConvertOptions & ConvertControls {
  const scene = kind === "scene";
  const c: ConvertControls = {};
  if (src.gamma !== undefined) c.gamma = src.gamma;
  if (src.threshold !== undefined) c.threshold = src.threshold;
  if (src.colorLevels !== undefined) c.colorLevels = src.colorLevels;
  if (src.shimmer !== undefined) c.shimmer = src.shimmer;
  if (src.seed !== undefined) c.seed = src.seed;
  if (src.key !== undefined) c.key = src.key === "auto" ? "auto" : rgb(src.key);
  if (src.tint !== undefined) c.tint = rgb(src.tint);
  if (src.edgeColor !== undefined) c.edgeColor = rgb(src.edgeColor);
  if (src.palette !== undefined) c.palette = src.palette.map(rgb);
  if (src.chars !== undefined) c.chars = src.chars;
  if (src.dither !== undefined) c.dither = src.dither;
  if (src.cellBg !== undefined) c.cellBg = src.cellBg;
  const base: ConvertOptions = scene
    ? { ramp: src.ramp, invert: false, color: src.color, mode: background === null ? "alpha" : "distance", ...(background !== null ? { background } : {}) }
    : { ramp: src.ramp, invert: src.invert, color: src.color, mode: "luma" };
  return { ...base, ...c, cellBgBase: rgb(styleColor), normalize: src.normalize ?? !scene };
}

/** The `source` object as written to a file: defaults left out, the ramp by name when it is a named ramp. */
export function sourceJson(src: NAsciiSource): Record<string, unknown> {
  const named = Object.keys(NAMED_RAMPS).find((k) => NAMED_RAMPS[k] === src.ramp);
  const out: Record<string, unknown> = { file: src.file, cols: src.cols };
  if (src.rows !== null) out["rows"] = src.rows;
  if (src.maxSeconds !== null) out["maxSeconds"] = src.maxSeconds;
  if (src.ramp !== DEFAULT_RAMP) out["ramp"] = named ?? src.ramp;
  if (src.invert) out["invert"] = true;
  if (src.color) out["color"] = true;
  if (src.normalize !== null) out["normalize"] = src.normalize;
  for (const k of ["gamma", "threshold", "key", "colorLevels", "palette", "tint", "chars", "seed", "shimmer", "dither", "edgeColor", "cellBg"] as const) if (src[k] !== undefined) out[k] = src[k];
  if (src.crop) out["crop"] = [src.crop.x, src.crop.y, src.crop.w, src.crop.h];
  return out;
}
