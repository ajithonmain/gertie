import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { parseHex } from "../../spec/color.ts";
import { didYouMean, hasErrors, makeDiagnostic, report, type Diagnostic } from "../../spec/diagnostics.ts";
import { parseAscii } from "../../ascii/parse.ts";
import { emitAsciiSvg, svgProblems } from "../../ascii/svg.ts";
import { canvasSize, MAX_COLS, MAX_FRAMES, MAX_RECIPE_COLS, MAX_RECIPE_ROWS, MAX_ROWS, SVG_CELL_LIMIT, totalFrames, FX_BY, FX_EFFECTS, type FxBy, type FxEffect, type NAscii, type NAsciiFrame, type NAsciiFx, type NAsciiSource } from "../../ascii/types.ts";
import { DEFAULT_RAMP, NAMED_RAMPS, resolveRamp, rowsForAspect, styleFor, type ConvertControls, type RGB } from "../../ascii/convert.ts";
import { appendFx, formatAscii, formatRecipe, type RawFrame, type RawRecipe, type RawScene } from "../../ascii/format.ts";
import { AsciiSourceError, collect, framesOf, shapeOf, withShape, type AsciiShape, type OpenSource, type ShapeLimits, type SourceReader } from "../../ascii/frames.ts";
import { sourceJson } from "../../ascii/recipe.ts";
import { changeRate, probeFrame } from "../../ascii/probe.ts";
import { checkFxRange, fxJson, FX_PARAMS } from "../../ascii/fx.ts";
import { SourceCompileError, sourceReader } from "./ascii-source.ts";
import { generate, GENERATORS, SPINNER_STYLES } from "../../ascii/gen.ts";
import { type CropRect } from "../../ascii/media.ts";
import { exportJs, exportSh, frameText, playFrames } from "../../ascii/terminal.ts";
import { exportScene } from "../../export/index.ts";
import { DESTINATIONS, DESTINATION_IDS } from "../../export/destinations.ts";
import { ExportUnavailableError } from "../../export/ffmpeg.ts";
import { FORMAT_IDS, parseFormats, type FormatId } from "../../export/formats.ts";
import { RenderUnavailableError } from "../../render/browser.ts";
import { openSvg } from "../../render/svg.ts";
import { openCanvasFrames } from "../../render/ascii-canvas.ts";
import type { Args } from "./args.ts";
import { EXIT_FAIL, EXIT_OK, EXIT_USAGE, fileProblem, numFlag, VERSION, type Outcome } from "./commands.ts";

const SUBCOMMANDS = ["lint", "export", "render", "from", "gen", "play", "fx", "probe"] as const;
const SCRIPT_FORMATS = ["sh", "js"] as const;
type ScriptFormat = (typeof SCRIPT_FORMATS)[number];

const FRAME_FORMAT_LIST = FORMAT_IDS.filter((f) => f !== "svg" && !f.startsWith("lottie")).join(", ");

const USAGE = `ascii needs a subcommand: ${SUBCOMMANDS.join(", ")}.
  gertie ascii lint <file.ascii.json> [--json] [--strict]
  gertie ascii export <file.ascii.json> (--to <svg,gif,webp,mp4,sh,js,...> | --for <destination>) [--out dir] [--scale n] [--bg #rrggbb] [--loops n] [--json]
  gertie ascii render <file.ascii.json> [--sheet-frames n] [--out sheet.png] [--json]
  gertie ascii from <clip.mp4|image.png|anim.gif|scene.gertie.json> [--cols 80] [--rows n] [--fps 10] [--max-seconds 10] [--ramp <name|characters>] [--invert] [--color] [--no-loop] [--recipe] [--out file.ascii.json]
      conversion controls: [--normalize|--no-normalize] [--gamma n] [--threshold n] [--key auto|#hex] [--crop x,y,w,h] [--color-levels n]
        [--palette #a,#b,...] [--tint #hex] [--chars set [--seed n] [--shimmer n]] [--dither ordered] [--edge-color #hex]
      styling: [--glyph text|dot|square] [--cell-aspect n] [--cell-bg n] [--glow n] [--font-size n]
      ramps: ${Object.keys(NAMED_RAMPS).join(", ")}
  gertie ascii gen <${GENERATORS.join("|")}> [--cols n] [--rows n] [--frames n] [--fps n] [--text s] [--style s] [--seed n] [--fg #rrggbb] [--bg #rrggbb|transparent] [--out file.ascii.json]
  gertie ascii play <file.ascii.json> [--loops n] [--once] [--no-color] [--frame n]
  gertie ascii fx <file.ascii.json> --effect <${FX_EFFECTS.filter((e) => e !== "type").join("|")}> [--by <${FX_BY.join("|")}>] [--at s] [--duration s] [--seed n] [--chars s] [--amount n]
      adds an effect in time to the file and lints it. by: reveal and hide. chars: decode and shimmer. amount: shimmer. Duration defaults to the rest of the animation.
  gertie ascii probe <clip|image> [--time s] [--json]
      reads an ASCII reference: cell pitch, cols and rows, background, the five main colours, frame rate, and text or dot.`;

export async function asciiCommand(args: Args): Promise<Outcome> {
  const sub = args.positional[0];
  const rest: Args = { ...args, positional: args.positional.slice(1) };
  switch (sub) {
    case "lint":
      return lintCommand(rest);
    case "export":
      return exportCommand(rest);
    case "render":
      return renderCommand(rest);
    case "from":
      return fromCommand(rest);
    case "gen":
      return genCommand(rest);
    case "play":
      return playCommand(rest);
    case "fx":
      return fxCommand(rest);
    case "probe":
      return probeCommand(rest);
    default:
      return fileProblem(sub === undefined ? USAGE : `Unknown ascii subcommand '${sub}'.\n${USAGE}`);
  }
}

// ----------------------------------------------------------------------------- loading

interface Loaded {
  path: string;
  scene?: NAscii;
  diagnostics: Diagnostic[];
}

const stem = (path: string): string =>
  basename(path)
    .replace(/\.ascii\.json$/i, "")
    .replace(/\.json$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "ascii";

function load(file: string | undefined, what: string): Loaded | Outcome {
  if (!file) return fileProblem(`${what} needs a file: gertie ascii ${what} <file.ascii.json>`);
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  return parseText(path, readFileSync(path, "utf8"));
}

/** Parses the text of the scene file at `path` (which need not be what is on disk), reading the files it names beside it. */
function parseText(path: string, text: string): Loaded {
  const dir = dirname(path);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return { path, diagnostics: [makeDiagnostic("E-ASCII-JSON", `The file is not valid JSON: ${e instanceof Error ? e.message : String(e)}`, 'Fix the syntax. Backslashes in text rows must be doubled; to avoid that, put the frames in a text file and name it with "framesFile".')] };
  }
  const r = parseAscii(raw, {
    name: stem(path),
    io: {
      readText: (p) => {
        const full = resolve(dir, p);
        return existsSync(full) ? readFileSync(full, "utf8") : undefined;
      },
    },
  });
  return { path, ...(r.scene ? { scene: r.scene } : {}), diagnostics: r.diagnostics };
}

const isOutcome = (v: Loaded | Outcome | object): v is Outcome => "code" in v;

function summary(s: NAscii): string {
  const frames = totalFrames(s);
  return `${s.name}: ${s.cols} by ${s.rows} cells, ${s.frames.length} frames (${frames} intervals) at ${s.fps} fps, ${(frames / s.fps).toFixed(2)} s, ${s.loop ? "looping" : "plays once"}`;
}

function recipeSummary(s: NAscii, shape: AsciiShape): string {
  if (s.layers) return `${s.name}: ${s.layers.length} layer${s.layers.length === 1 ? "" : "s"} on ${shape.cols} by ${shape.rows} cells, ${shape.intervals} frames at ${s.fps} fps, ${(shape.intervals / s.fps).toFixed(2)} s, ${s.loop ? "looping" : "plays once"}, ${shape.renderer === "svg" ? "SVG renderer" : "canvas renderer"}`;
  return `${s.name}: recipe of ${s.source?.file}, ${shape.cols} by ${shape.rows} cells, ${shape.intervals} frames at ${s.fps} fps, ${(shape.intervals / s.fps).toFixed(2)} s, ${s.loop ? "looping" : "plays once"}, ${shape.renderer === "svg" ? "SVG renderer" : "canvas renderer"}`;
}

/** A failure to open or convert a recipe's source: diagnostics to report, or an outcome when a tool is missing. */
function sourceFailure(e: unknown): Diagnostic[] | Outcome {
  if (e instanceof AsciiSourceError) return [e.diagnostic];
  if (e instanceof SourceCompileError) {
    const errs = (e.outcome.report?.diagnostics ?? []).filter((x) => x.severity === "error");
    const first = errs.slice(0, 3).map((x) => `${x.code}: ${x.message}`).join(" ");
    return [makeDiagnostic("E-ASCII-SOURCE", `source.file '${e.file}' is a vector scene that does not compile${first ? `: ${first}` : "."}`, `Run: gertie lint ${e.file}, and fix it.`, { path: "source.file" })];
  }
  if (e instanceof ExportUnavailableError || e instanceof RenderUnavailableError) return { code: EXIT_USAGE, message: `${e.message}\n  fix: ${e.fix}` };
  throw e;
}

/** The reader for a scene's recipe, or undefined for inline frames. */
const readerFor = (l: Loaded): SourceReader | undefined => (l.scene?.source || l.scene?.layers?.some((x) => x.source !== null) ? sourceReader(dirname(l.path)) : undefined);

/** Runs `f`, turning a source failure into an outcome that reports it beside the file's other diagnostics. */
async function withSource<T>(l: Loaded, strict: boolean, f: () => Promise<T>): Promise<T | Outcome> {
  try {
    return await f();
  } catch (e) {
    const r = sourceFailure(e);
    if (isOutcome(r)) return r;
    return { code: EXIT_FAIL, report: report([...l.diagnostics, ...r], strict) };
  }
}

async function lintCommand(args: Args): Promise<Outcome> {
  const l = load(args.positional[0], "lint");
  if (isOutcome(l)) return l;
  if (l.scene?.source || l.scene?.layers) return lintRecipe(l, args);
  const rep = report(l.diagnostics, args.flags.has("strict"));
  const code = rep.ok ? EXIT_OK : EXIT_FAIL;
  const full = {
    ...rep,
    ...(l.scene ? { scene: { name: l.scene.name, cols: l.scene.cols, rows: l.scene.rows, fps: l.scene.fps, frames: l.scene.frames.length, intervals: totalFrames(l.scene), seconds: totalFrames(l.scene) / l.scene.fps, loop: l.scene.loop, ...canvasSize(l.scene) } } : {}),
  };
  return { code, report: rep, full, lines: l.scene ? [summary(l.scene)] : [] };
}

/** A recipe is linted by opening its source (compiling a vector scene, probing media) without converting it, so the grid size, length and limits are checked. */
async function lintRecipe(l: Loaded, args: Args): Promise<Outcome> {
  const s = l.scene as NAscii;
  const strict = args.flags.has("strict");
  const shape = await withSource(l, strict, () => shapeOf(s, readerFor(l)));
  if (isOutcome(shape)) return shape;
  const rep = report(l.diagnostics, strict);
  const full = { ...rep, scene: { name: s.name, ...(s.layers ? { layers: s.layers.length } : { recipe: true, source: s.source?.file }), cols: shape.cols, rows: shape.rows, fps: s.fps, frames: shape.intervals, intervals: shape.intervals, seconds: shape.intervals / s.fps, loop: s.loop, cells: shape.cells, renderer: shape.renderer, ...canvasSize(withShape(s, shape)) } };
  return { code: rep.ok ? EXIT_OK : EXIT_FAIL, report: rep, full, lines: [recipeSummary(s, shape)] };
}

// ----------------------------------------------------------------------------- export

async function exportCommand(args: Args): Promise<Outcome> {
  const to = args.flags.get("to");
  const dest = args.flags.get("for");
  if (to !== undefined && dest !== undefined) return fileProblem("Use --to or --for, not both. --for picks the formats and enforces the platform's limits.");
  if (to === undefined && dest === undefined) return fileProblem(`ascii export needs --to <formats> or --for <destination>. Formats: svg, sh, js, ${FRAME_FORMAT_LIST}. Destinations: ${DESTINATION_IDS.join(", ")}.`);
  let formats: FormatId[] = [];
  const scripts: ScriptFormat[] = [];
  if (typeof to === "string") {
    const names = to
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter((x) => x !== "");
    const frameNames: string[] = [];
    for (const n of names) {
      if ((SCRIPT_FORMATS as readonly string[]).includes(n)) scripts.push(n as ScriptFormat);
      else if (n === "lottie" || n === "lottie-zip") return fileProblem("ASCII animation has no Lottie output, because Lottie has no portable text support. Use svg, a frame format (gif, apng, webp, webm, mp4, prores, hevc), sh or js.");
      else frameNames.push(n);
    }
    const parsed = parseFormats(frameNames.join(","));
    if (parsed.unknown.length > 0) return fileProblem(`Unknown format '${parsed.unknown.join("', '")}'. Formats: svg, sh, js, ${FRAME_FORMAT_LIST}.`);
    formats = parsed.formats;
    if (formats.length + scripts.length === 0) return fileProblem("--to needs at least one format.");
  } else if (typeof dest === "string") {
    if (!DESTINATIONS[dest]) return fileProblem(`Unknown destination '${dest}'. Destinations: ${DESTINATION_IDS.join(", ")}.`);
  } else return fileProblem("--to and --for need a value.");
  const scale = numFlag(args, "scale", 1, 0.25, 4);
  const loops = numFlag(args, "loops", 1, 1, 20);
  if (typeof scale === "string") return fileProblem(scale);
  if (typeof loops === "string") return fileProblem(loops);
  const bg = args.flags.get("bg");
  if (bg !== undefined && (typeof bg !== "string" || parseHex(bg) === null)) return fileProblem("--bg must be a colour like #ffffff or #fff.");

  const l = load(args.positional[0], "export");
  if (isOutcome(l)) return l;
  const rep = report(l.diagnostics, args.flags.has("strict"));
  if (!l.scene || !rep.ok) return { code: EXIT_FAIL, report: rep };
  const loaded = l.scene;
  const read = readerFor(l);
  const strict = args.flags.has("strict");
  const shape = await withSource(l, strict, () => shapeOf(loaded, read));
  if (isOutcome(shape)) return shape;
  const canvas = shape.renderer === "canvas";
  if (canvas) {
    // Above the cell limit there is no SVG: it would be too large to load or play. The text exports hold every frame too.
    const wantsSvg = formats.includes("svg") || (typeof dest === "string" && (DESTINATIONS[dest]?.formats ?? []).some((f) => f.format === "svg"));
    const refused = [...(wantsSvg ? ["svg"] : []), ...scripts];
    if (refused.length > 0) {
      const d = makeDiagnostic("E-ASCII-TOOMANY", `${shape.cols} by ${shape.rows} cells over ${shape.frames} frames is ${shape.cells} cells, more than the ${SVG_CELL_LIMIT} that ${refused.join(" and ")} can hold.`, `Export to mp4, webm or gif, or lower cols, fps or the duration.${typeof dest === "string" ? ` The ${dest} destination includes svg; use --to instead.` : ""}`, { path: "source" });
      return { code: EXIT_FAIL, report: report([...l.diagnostics, d], strict) };
    }
  }
  // The SVG path keeps every frame, as in phase 8; the canvas path streams frames from framesOf into the exporter one at a time.
  const collected = canvas ? withShape(loaded, shape) : await withSource(l, strict, () => collect(loaded, read));
  if (isOutcome(collected)) return collected;
  const s = collected;
  const outFlag = args.flags.get("out");
  const outDir = typeof outFlag === "string" ? resolve(outFlag) : join(dirname(l.path), "out");
  const svg = canvas ? "" : emitAsciiSvg(s);
  const problems = svgProblems(svg);
  if (problems.length > 0) return fileProblem(`The generated SVG ${problems.join(", ")}. This is a bug in Gertie.`);
  const { w, h } = canvasSize(s);
  const keep = args.flags.get("keep-frames");
  const json = args.flags.has("json");
  const lines: string[] = [];
  const outputs: string[] = [];
  const files: object[] = [];

  mkdirSync(outDir, { recursive: true });
  for (const sc of scripts) {
    const path = join(outDir, `${s.name}.${sc === "sh" ? "sh" : "mjs"}`);
    writeFileSync(path, sc === "sh" ? exportSh(s) : exportJs(s), { mode: sc === "sh" ? 0o755 : 0o644 });
    outputs.push(path);
    files.push({ format: sc, path, bytes: readFileSync(path).length });
    lines.push(`${sc.padEnd(10)} ${path}`);
  }

  let res;
  if (typeof dest === "string" || formats.length > 0) {
    try {
      res = await exportScene({
        scene: { w, h, fps: s.fps, totalFrames: shape.intervals, background: s.style.background === null ? null : (parseHex(s.style.background) as [number, number, number, number]) },
        svg,
        openFrames: (sc) => (canvas ? openCanvasFrames(s, framesOf(loaded, read)[Symbol.asyncIterator](), { scale: sc }) : openSvg(svg, { w, h, fps: s.fps }, { scale: sc })),
        outDir,
        name: s.name,
        version: VERSION,
        formats,
        ...(typeof dest === "string" ? { destination: dest } : {}),
        ...(typeof bg === "string" ? { bg } : {}),
        scale,
        loops,
        ...(typeof keep === "string" ? { keepFrames: resolve(keep) } : {}),
        ...(json ? {} : { progress: (x: string) => console.error(x) }),
      });
    } catch (e) {
      if (e instanceof ExportUnavailableError || e instanceof RenderUnavailableError) return { code: EXIT_USAGE, message: `${e.message}\n  fix: ${e.fix}` };
      if (e instanceof AsciiSourceError || e instanceof SourceCompileError) {
        const r = sourceFailure(e);
        return isOutcome(r) ? r : { code: EXIT_FAIL, report: report([...l.diagnostics, ...r], strict) };
      }
      return fileProblem(`Export failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`);
    }
    for (const f of res.files) {
      files.push(f);
      outputs.push(f.path);
      lines.push(`${f.format.padEnd(10)} ${f.path}  ${Math.round((f.bytes / 1024) * 10) / 10} KB${f.width ? `  ${f.width}x${f.height}` : ""}${f.frames ? `  ${f.frames} frames` : ""}${f.fit ? `  (${f.fit})` : ""}`);
    }
    for (const f of res.failures) lines.push(`error ${f.format}: ${f.reason}`, `  fix: ${f.fix}`);
    for (const n of res.notes) lines.push(`note: ${n}`);
  }
  const failures = res?.failures ?? [];
  const ok = failures.length === 0;
  const code = ok ? EXIT_OK : failures.some((f) => !f.environment) ? EXIT_FAIL : EXIT_USAGE;
  const full = { ok, scene: s.name, renderer: shape.renderer, diagnostics: l.diagnostics, files, failures, notes: res?.notes ?? [] };
  return { code, full, lines, outputs, report: rep };
}

// ----------------------------------------------------------------------------- render (contact sheet)

async function renderCommand(args: Args): Promise<Outcome> {
  const l = load(args.positional[0], "render");
  if (isOutcome(l)) return l;
  const rep = report(l.diagnostics, args.flags.has("strict"));
  if (!l.scene || !rep.ok) return { code: EXIT_FAIL, report: rep };
  const loaded = l.scene;
  const read = readerFor(l);
  const shape = await withSource(l, args.flags.has("strict"), () => shapeOf(loaded, read));
  if (isOutcome(shape)) return shape;
  const canvas = shape.renderer === "canvas";
  const collected = canvas ? withShape(loaded, shape) : await withSource(l, args.flags.has("strict"), () => collect(loaded, read));
  if (isOutcome(collected)) return collected;
  const s = collected;
  const count = (() => {
    const v = args.flags.get("sheet-frames");
    return typeof v === "string" && Number(v) >= 1 ? Math.min(32, Math.floor(Number(v))) : 8;
  })();
  const outFlag = args.flags.get("out");
  const outPath = typeof outFlag === "string" ? resolve(outFlag) : join(dirname(l.path), "out", `${s.name}.sheet.png`);
  const { w, h } = canvasSize(s);
  let r;
  try {
    r = canvas ? await openCanvasFrames(s, framesOf(loaded, read)[Symbol.asyncIterator]()) : await openSvg(emitAsciiSvg(s), { w, h, fps: s.fps });
  } catch (e) {
    return { code: EXIT_USAGE, message: `Rendering is not available: ${e instanceof Error ? e.message : String(e)}\n  fix: run 'gertie doctor'` };
  }
  try {
    const total = shape.intervals;
    const n = Math.min(count, total);
    const picks = [...new Set(Array.from({ length: n }, (_, i) => Math.min(total - 1, Math.floor(((i + 0.5) * total) / n))))];
    const frames: Buffer[] = [];
    try {
      for (const f of picks) frames.push(await r.renderFrame(f));
    } catch (e) {
      const x = sourceFailure(e);
      return isOutcome(x) ? x : { code: EXIT_FAIL, report: report([...l.diagnostics, ...x]) };
    }
    const sheet = await r.sheet(
      frames,
      picks.map((f) => `f${f}  ${(f / s.fps).toFixed(2)}s`),
      Math.min(2, picks.length),
      Math.min(w, 480),
    );
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, sheet);
    return { code: EXIT_OK, report: rep, full: { ...rep, outputs: { sheet: outPath }, frames: picks.length, renderer: shape.renderer }, outputs: [outPath], lines: [loaded.source || loaded.layers ? recipeSummary(loaded, shape) : summary(s)] };
  } finally {
    await r.close();
  }
}

// ----------------------------------------------------------------------------- from

function finish(raw: RawScene, out: string | undefined, fallbackDir: string): Outcome {
  const path = out ? resolve(out) : join(fallbackDir, `${raw.name}.ascii.json`);
  mkdirSync(dirname(path), { recursive: true });
  const text = formatAscii(raw);
  writeFileSync(path, text);
  const r = parseAscii(JSON.parse(text), { name: raw.name });
  const rep = report(r.diagnostics);
  const lines = r.scene ? [summary(r.scene)] : [];
  return {
    code: rep.ok ? EXIT_OK : EXIT_FAIL,
    report: rep,
    full: { ...rep, outputs: [path], ...(r.scene ? { scene: { name: r.scene.name, cols: r.scene.cols, rows: r.scene.rows, frames: r.scene.frames.length, fps: r.scene.fps } } : {}) },
    outputs: [path],
    lines,
  };
}

/** Inline frames as written to a file. `framesOf` has already folded identical neighbours into one frame with a longer hold. */
function toRawFrames(all: NAsciiFrame[]): RawFrame[] {
  return all.map((f) => ({
    text: f.cells.map((row) => row.join("").replace(/ +$/, "")),
    ...(f.hold !== 1 ? { hold: f.hold } : {}),
    ...(f.colors ? { colors: f.colors } : {}),
    ...(f.backgrounds ? { backgrounds: f.backgrounds } : {}),
  }));
}

/** Styling flags of `ascii from`: how the cells are drawn rather than how they are chosen. */
interface StyleFlags {
  glyph: "text" | "dot" | "square";
  cellAspect: number;
  glow: number;
  fontSize?: number;
}

interface Controls {
  controls: ConvertControls;
  style: StyleFlags;
  crop?: CropRect;
  /** The user gave --normalize or --no-normalize. */
  normalizeSet: boolean;
}

const hexRgb = (text: string): RGB | null => {
  const c = parseHex(text.trim());
  return c === null ? null : [c[0], c[1], c[2]];
};

/** Reads the conversion controls of `ascii from`. Returns a usage message when a value is bad or the combination is excluded. */
function parseControls(args: Args): Controls | string {
  const c: ConvertControls = {};
  const num = (name: string, min: number, max: number, whole = false): number | string | undefined => {
    if (!args.flags.has(name)) return undefined;
    const v = args.flags.get(name);
    const n = typeof v === "string" ? Number(v) : NaN;
    if (!Number.isFinite(n) || n < min || n > max || (whole && !Number.isInteger(n))) return `--${name} must be ${whole ? "a whole number" : "a number"} from ${min} to ${max}.`;
    return n;
  };
  const colour = (name: string): RGB | string | undefined => {
    if (!args.flags.has(name)) return undefined;
    const v = args.flags.get(name);
    const rgb = typeof v === "string" ? hexRgb(v) : null;
    return rgb ?? `--${name} needs a colour like #3b82f6.`;
  };
  if (args.flags.has("normalize") && args.flags.has("no-normalize")) return "Use --normalize or --no-normalize, not both.";
  const gamma = num("gamma", 0.1, 10);
  const threshold = num("threshold", 0, 1);
  const levels = num("color-levels", 2, 32, true);
  const shimmer = num("shimmer", 0, 1);
  const seed = num("seed", 0, 4294967295, true);
  for (const v of [gamma, threshold, levels, shimmer, seed]) if (typeof v === "string") return v;
  if (typeof gamma === "number") c.gamma = gamma;
  if (typeof threshold === "number") c.threshold = threshold;
  if (typeof levels === "number") c.colorLevels = levels;
  if (typeof shimmer === "number") c.shimmer = shimmer;
  if (typeof seed === "number") c.seed = seed;

  if (args.flags.has("key")) {
    const v = args.flags.get("key");
    if (v === "auto") c.key = "auto";
    else {
      const rgb = typeof v === "string" ? hexRgb(v) : null;
      if (!rgb) return "--key must be auto or a colour like #000000.";
      c.key = rgb;
    }
  }
  const tint = colour("tint");
  const edge = colour("edge-color");
  if (typeof tint === "string") return tint;
  if (typeof edge === "string") return edge;
  if (tint) c.tint = tint;
  if (edge) c.edgeColor = edge;
  if (args.flags.has("palette")) {
    const v = args.flags.get("palette");
    const list = typeof v === "string" ? v.split(",").map((x) => x.trim()).filter((x) => x !== "") : [];
    const rgbs = list.map(hexRgb);
    if (list.length === 0 || rgbs.some((x) => x === null)) return "--palette needs colours like #7cb342 separated by commas, for example --palette #7cb342,#f48fb1,#f5f5f5.";
    c.palette = rgbs as RGB[];
  }
  if (c.tint && c.palette) return "--tint and --palette cannot be combined: --palette picks from a list of colours, --tint scales one colour. Use one of them.";
  if (args.flags.has("chars")) {
    const v = args.flags.get("chars");
    if (typeof v !== "string" || v === "" || /\s/.test(v)) return '--chars needs a set of visible characters without spaces, for example --chars "CZ".';
    if (args.flags.has("ramp")) return "--chars and --ramp cannot be combined: --chars replaces the ramp. Use one of them.";
    c.chars = v;
  }
  if (c.shimmer !== undefined && c.shimmer > 0 && !c.chars) return "--shimmer needs --chars: it changes which character a cell shows, and without --chars the character comes from brightness.";
  if (c.seed !== undefined && !c.chars) return "--seed needs --chars: it only decides which character each cell gets.";
  if (c.colorLevels !== undefined && !args.flags.has("color") && !c.chars && !c.palette && !c.tint) return "--color-levels needs --color (or --chars, --palette or --tint).";
  if (c.colorLevels !== undefined && c.palette) return "--color-levels has no effect with --palette. Remove one of them.";
  if (args.flags.has("dither")) {
    const v = args.flags.get("dither");
    if (v !== "ordered") return "--dither must be ordered.";
    c.dither = "ordered";
  }
  if (c.dither && c.chars) return "--dither works on a ramp and has no effect with --chars. Remove one of them.";
  const cellBg = num("cell-bg", 0, 1);
  const glow = num("glow", 0, 1);
  const cellAspect = num("cell-aspect", 0.5, 4);
  const fontSize = num("font-size", 6, 64);
  for (const v of [cellBg, glow, cellAspect, fontSize]) if (typeof v === "string") return v;
  const glyph = args.flags.get("glyph");
  if (glyph !== undefined && glyph !== "text" && glyph !== "dot" && glyph !== "square") return "--glyph must be text, dot or square.";
  if (glyph !== undefined && glyph !== "text" && c.chars) return "--glyph dot and --glyph square size each shape by its place in a ramp, so they cannot be combined with --chars. Use a ramp instead.";
  if (typeof cellBg === "number") c.cellBg = cellBg;
  const style: StyleFlags = { glyph: glyph === "dot" || glyph === "square" ? glyph : "text", cellAspect: typeof cellAspect === "number" ? cellAspect : 2, glow: typeof glow === "number" ? glow : 0, ...(typeof fontSize === "number" ? { fontSize } : {}) };
  const out: Controls = { controls: c, style, normalizeSet: args.flags.has("normalize") || args.flags.has("no-normalize") };
  if (args.flags.has("crop")) {
    const v = args.flags.get("crop");
    const parts = typeof v === "string" ? v.split(",").map((x) => Number(x.trim())) : [];
    const [x, y, w, h] = parts;
    if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p)) || (x as number) < 0 || (y as number) < 0 || (w as number) < 1 || (h as number) < 1) return "--crop needs four whole numbers x,y,w,h in source pixels, with w and h at least 1, for example --crop 100,50,800,600.";
    out.crop = { x: x as number, y: y as number, w: w as number, h: h as number };
  }
  return out;
}

const rgbOf = (hexColor: string | undefined): RGB => {
  const c = parseHex(hexColor ?? "#22c55e");
  return c ? [c[0], c[1], c[2]] : [34, 197, 94];
};

/** Adds the styling flags to the style that `styleFor` chose. Fields left at their defaults are not written, so old files and new ones look the same. */
function styledStyle(base: RawScene["style"], f: StyleFlags, ramp: string): RawScene["style"] {
  return {
    ...base,
    ...(f.fontSize !== undefined ? { fontSize: f.fontSize } : {}),
    ...(f.glyph !== "text" ? { glyph: f.glyph, ramp } : {}),
    ...(f.cellAspect !== 2 ? { cellAspect: f.cellAspect } : {}),
    ...(f.glow > 0 ? { glow: f.glow } : {}),
  };
}

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
const rgbHex = (c: RGB): string => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;

/** The conversion flags of `ascii from` as a recipe source, so that both forms convert through one path. */
function sourceOf(file: string, cols: number, rows: number | undefined, maxSeconds: number | null, ramp: string, invert: boolean, color: boolean, normalize: boolean | null, ctl: Controls): NAsciiSource {
  const c = ctl.controls;
  return {
    file,
    cols,
    rows: rows ?? null,
    maxSeconds,
    ramp,
    invert,
    color,
    normalize,
    ...(c.gamma !== undefined ? { gamma: c.gamma } : {}),
    ...(c.threshold !== undefined ? { threshold: c.threshold } : {}),
    ...(c.key !== undefined ? { key: c.key === "auto" ? "auto" : rgbHex(c.key) } : {}),
    ...(ctl.crop ? { crop: ctl.crop } : {}),
    ...(c.colorLevels !== undefined ? { colorLevels: c.colorLevels } : {}),
    ...(c.palette !== undefined ? { palette: c.palette.map(rgbHex) } : {}),
    ...(c.tint !== undefined ? { tint: rgbHex(c.tint) } : {}),
    ...(c.chars !== undefined ? { chars: c.chars } : {}),
    ...(c.seed !== undefined ? { seed: c.seed } : {}),
    ...(c.shimmer !== undefined ? { shimmer: c.shimmer } : {}),
    ...(c.dither !== undefined ? { dither: c.dither } : {}),
    ...(c.edgeColor !== undefined ? { edgeColor: rgbHex(c.edgeColor) } : {}),
    ...(c.cellBg !== undefined ? { cellBg: c.cellBg } : {}),
  };
}

/** Limits of the phase 8 inline form, which `ascii from` keeps when it writes frames: computed rows and the frame count are capped, not refused. */
const INLINE_LIMITS: ShapeLimits = { maxRows: MAX_ROWS, maxFrames: MAX_FRAMES, clampFrames: true };

const posixPath = (p: string): string => p.split(sep).join("/");

async function fromCommand(args: Args): Promise<Outcome> {
  const file = args.positional[0];
  if (!file) return fileProblem("ascii from needs an input: gertie ascii from <clip.mp4|image.png|anim.gif|scene.gertie.json> [--cols 80]");
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  const cols = numFlag(args, "cols", 80, 4, MAX_RECIPE_COLS);
  const fps = numFlag(args, "fps", 10, 1, 30);
  const maxSeconds = numFlag(args, "max-seconds", 10, 0.1, 120);
  const rowsFlag = args.flags.has("rows") ? numFlag(args, "rows", 0, 1, MAX_RECIPE_ROWS) : undefined;
  for (const v of [cols, fps, maxSeconds, rowsFlag]) if (typeof v === "string") return fileProblem(v);
  if (typeof cols === "number" && !Number.isInteger(cols)) return fileProblem("--cols must be a whole number.");
  if (typeof rowsFlag === "number" && !Number.isInteger(rowsFlag)) return fileProblem("--rows must be a whole number.");
  const ramp = args.flags.get("ramp");
  const resolvedRamp = typeof ramp === "string" ? resolveRamp(ramp) : DEFAULT_RAMP;
  if (ramp !== undefined && (typeof ramp !== "string" || [...resolvedRamp].length < 2)) return fileProblem(`--ramp needs a name (${Object.keys(NAMED_RAMPS).join(", ")}) or at least two characters ordered from empty to full, for example --ramp " .:-=+*#%@"`);
  const ctl = parseControls(args);
  if (typeof ctl === "string") return fileProblem(ctl);
  const invert = args.flags.has("invert");
  const color = args.flags.has("color");
  const outFlag = args.flags.get("out");
  const base = stem(path.replace(/\.gertie\.json$/i, "").replace(/\.[A-Za-z0-9]+$/, ""));
  const outPath = typeof outFlag === "string" ? resolve(outFlag) : join(dirname(path), `${base}.ascii.json`);
  const isScene = /\.gertie\.json$/i.test(path);

  // The input is opened once by the same reader that rendering a recipe uses, so both forms convert the same way.
  const read = sourceReader(dirname(path));
  let src: OpenSource;
  try {
    src = await read(basename(path));
  } catch (e) {
    if (e instanceof SourceCompileError) return e.outcome;
    if (e instanceof AsciiSourceError) return fileProblem(e.diagnostic.message);
    throw e;
  }
  const crop = ctl.crop;
  if (crop && (crop.x + crop.w > src.width || crop.y + crop.h > src.height)) return fileProblem(`--crop ${crop.x},${crop.y},${crop.w},${crop.h} reaches outside the ${src.width} by ${src.height} ${isScene ? "scene" : "source"}. Keep x + w within ${src.width} and y + h within ${src.height}.`);

  // Vector scenes are not normalised unless asked: their colours are already the intended ones. Video and images are, unless --no-normalize.
  const normalize = isScene ? (args.flags.has("normalize") ? true : null) : ctl.normalizeSet ? args.flags.has("normalize") : null;
  const bgc = src.background;
  const style = styledStyle(isScene ? (bgc ? styleFor({ invert: false, background: bgc }) : styleFor({ invert: false })) : styleFor({ invert }), ctl.style, resolvedRamp);
  const loop = !args.flags.has("no-loop") && (isScene ? src.loop : true);
  const rows0 = typeof rowsFlag === "number" ? rowsFlag : undefined;
  // The recipe names its source relative to itself, unless the two share nothing but the root, where an absolute path is clearer.
  const rel = relative(dirname(outPath), path);
  const sharesOnlyRoot = rel.split(sep).filter((x) => x === "..").length >= dirname(outPath).split(sep).filter((x) => x !== "").length;
  const fileFromOut = sharesOnlyRoot ? posixPath(path) : posixPath(rel) || basename(path);
  const recipeOf = (fileField: string, secs: number | null): RawRecipe => ({ ascii: 1, name: base, fps: fps as number, loop, style, source: sourceJson(sourceOf(fileField, cols as number, rows0, secs, resolvedRamp, invert, color, normalize, ctl)) });

  // In memory, the conversion is a recipe that names the input relative to its own directory.
  const mem = parseAscii(recipeOf(basename(path), isScene ? null : (maxSeconds as number)), { name: base });
  if (!mem.scene) return { code: EXIT_FAIL, report: report(mem.diagnostics) };
  const scene = mem.scene;
  let shape: AsciiShape;
  try {
    shape = await shapeOf(scene, read, INLINE_LIMITS);
  } catch (e) {
    if (e instanceof AsciiSourceError) return fileProblem(e.diagnostic.message);
    const r = sourceFailure(e);
    return isOutcome(r) ? r : { code: EXIT_FAIL, report: report(r) };
  }
  // A dense animation is written as a recipe: its frames would make a large file and an SVG too big to play.
  const naturalRows = rows0 ?? rowsForAspect(crop ? crop.w : src.width, crop ? crop.h : src.height, cols as number, ctl.style.cellAspect);
  const tooBig = (cols as number) > MAX_COLS || naturalRows > MAX_ROWS || shape.cells > SVG_CELL_LIMIT;
  if (args.flags.has("recipe") || tooBig) {
    const why = args.flags.has("recipe") ? "" : (cols as number) > MAX_COLS || naturalRows > MAX_ROWS ? `the grid is larger than inline frames allow (${MAX_COLS} by ${MAX_ROWS}), ` : `${shape.cells} cells is more than ${SVG_CELL_LIMIT}, `;
    return finishRecipe(recipeOf(fileFromOut, isScene || !args.flags.has("max-seconds") ? null : (maxSeconds as number)), outPath, why);
  }
  const frames: NAsciiFrame[] = [];
  try {
    for await (const f of framesOf(scene, read, INLINE_LIMITS)) frames.push(f);
  } catch (e) {
    if (e instanceof ExportUnavailableError || e instanceof RenderUnavailableError) return { code: EXIT_USAGE, message: `${e.message}\n  fix: ${e.fix}` };
    if (e instanceof AsciiSourceError) return fileProblem(e.diagnostic.message);
    return fileProblem(e instanceof Error ? e.message : String(e));
  }
  const raw: RawScene = { ascii: 1, name: base, cols: shape.cols, rows: shape.rows, fps: fps as number, loop, style, frames: toRawFrames(frames) };
  const o = finish(raw, outPath, dirname(path));
  if (!isScene) return o;
  return { ...o, lines: [`converted ${shape.intervals} frames of ${basename(path).replace(/\.gertie\.json$/i, "")} (${src.seconds.toFixed(2)} s) at ${fps} fps`, ...(o.lines ?? [])] };
}

/** Writes a recipe and lints it, which opens the source to report the grid, length and renderer. */
async function finishRecipe(raw: RawRecipe, path: string, why: string): Promise<Outcome> {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, formatRecipe(raw));
  const r = parseAscii(JSON.parse(formatRecipe(raw)), { name: raw.name });
  const l: Loaded = { path, ...(r.scene ? { scene: r.scene } : {}), diagnostics: r.diagnostics };
  const out = l.scene ? await lintRecipe(l, { command: "ascii", positional: [], flags: new Map() }) : { code: EXIT_FAIL, report: report(r.diagnostics) };
  const note = why === "" ? [] : [`note: written as a recipe because ${why}so frames are computed when it is rendered or exported.`];
  return { ...out, outputs: [path], lines: [...(out.lines ?? []), ...note], full: { ...(out.full ?? out.report ?? {}), outputs: [path] } };
}

// ----------------------------------------------------------------------------- gen

function genCommand(args: Args): Outcome {
  const kind = args.positional[0];
  if (!kind) return fileProblem(`ascii gen needs a generator: ${GENERATORS.join(", ")}. Example: gertie ascii gen spinner --text Loading`);
  if (!(GENERATORS as readonly string[]).includes(kind)) return fileProblem(`Unknown generator '${kind}'. Generators: ${GENERATORS.join(", ")}.`);
  const opt = (name: string, min: number, max: number): number | undefined | string => (args.flags.has(name) ? numFlag(args, name, 0, min, max) : undefined);
  const cols = opt("cols", 1, MAX_COLS);
  const rows = opt("rows", 1, MAX_ROWS);
  const frames = opt("frames", 1, MAX_FRAMES);
  const fps = opt("fps", 1, 30);
  const seed = opt("seed", 0, 4294967295);
  for (const v of [cols, rows, frames, fps, seed]) if (typeof v === "string") return fileProblem(v);
  const text = args.flags.get("text");
  const style = args.flags.get("style");
  if (typeof style === "string" && kind === "spinner" && !(style in SPINNER_STYLES)) return fileProblem(`Unknown spinner style '${style}'. Styles: ${Object.keys(SPINNER_STYLES).join(", ")}.`);
  const fg = args.flags.get("fg");
  if (fg !== undefined && (typeof fg !== "string" || parseHex(fg) === null)) return fileProblem("--fg must be a colour like #22c55e.");
  const bg = args.flags.get("bg");
  if (bg !== undefined && bg !== "transparent" && (typeof bg !== "string" || parseHex(bg) === null)) return fileProblem("--bg must be a colour like #0b0f19, or transparent.");
  const outFlag = args.flags.get("out");
  const name = args.flags.get("name");
  let raw;
  try {
    raw = generate(kind, {
      ...(typeof cols === "number" ? { cols } : {}),
      ...(typeof rows === "number" ? { rows } : {}),
      ...(typeof frames === "number" ? { frames } : {}),
      ...(typeof fps === "number" ? { fps } : {}),
      ...(typeof seed === "number" ? { seed } : {}),
      ...(typeof text === "string" ? { text } : {}),
      ...(typeof style === "string" ? { style } : {}),
      ...(typeof fg === "string" ? { color: fg } : {}),
      ...(typeof bg === "string" ? { background: bg === "transparent" ? null : bg } : {}),
      ...(args.flags.has("no-loop") ? { loop: false } : args.flags.has("loop") ? { loop: true } : {}),
      ...(typeof name === "string" ? { name } : {}),
    });
  } catch (e) {
    return fileProblem(e instanceof Error ? e.message : String(e));
  }
  return finish(raw, typeof outFlag === "string" ? outFlag : undefined, process.cwd());
}

// ----------------------------------------------------------------------------- fx

/** `ascii fx`: appends one effect to the scene file and lints the result. */
async function fxCommand(args: Args): Promise<Outcome> {
  const file = args.positional[0];
  if (!file) return fileProblem("ascii fx needs a file: gertie ascii fx <file.ascii.json> --effect reveal --by scatter --at 0 --duration 2");
  const effectFlag = args.flags.get("effect");
  const names = FX_EFFECTS.filter((e) => e !== "type");
  if (typeof effectFlag !== "string") return fileProblem(`ascii fx needs --effect <${names.join("|")}>.`);
  if (effectFlag === "type") return fileProblem(`--effect type types the text of a text layer, so it goes in that layer's fx: {"text": ["..."], "fx": [{"effect": "type", "at": 0}]}. Scene-wide effects: ${names.join(", ")}.`);
  if (!(names as readonly string[]).includes(effectFlag)) {
    return fileProblem(`Unknown effect '${effectFlag}'.${didYouMean(effectFlag, [...names])} Effects: ${names.join(", ")}.`);
  }
  const effect = effectFlag as FxEffect;
  const allowed = FX_PARAMS[effect];
  const given: [string, string][] = [["by", "by"], ["chars", "chars"], ["amount", "amount"]];
  for (const [flag, param] of given) if (args.flags.has(flag) && !allowed.includes(param)) return fileProblem(`--${flag} is not a parameter of ${effect}. Parameters of ${effect}: ${allowed.filter((a) => a !== "at" && a !== "duration").join(", ")}, at, duration.`);
  const numFx = (name: string, min: number, max: number, whole = false): number | string | undefined => {
    if (!args.flags.has(name)) return undefined;
    const v = args.flags.get(name);
    const n = typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= min && n <= max && (!whole || Number.isInteger(n)) ? n : `--${name} must be ${whole ? "a whole number" : "a number"} from ${min} to ${max}.`;
  };
  const at = numFx("at", 0, 100000);
  const duration = numFx("duration", 0, 100000);
  const seed = numFx("seed", 0, 4294967295, true);
  const amount = numFx("amount", 0, 1);
  for (const v of [at, duration, seed, amount]) if (typeof v === "string") return fileProblem(v);
  if (typeof duration === "number" && duration <= 0) return fileProblem("--duration must be above 0.");
  const by = args.flags.get("by");
  if (args.flags.has("by") && (typeof by !== "string" || !(FX_BY as readonly string[]).includes(by))) return fileProblem(`--by must be one of ${FX_BY.join(", ")}.`);
  const chars = args.flags.get("chars");
  if (args.flags.has("chars") && (typeof chars !== "string" || chars === "" || /\s/.test(chars))) return fileProblem('--chars needs a set of visible characters without spaces, for example --chars "01".');

  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  const text = readFileSync(path, "utf8");
  const before = parseText(path, text);
  if (!before.scene || hasErrors(before.diagnostics)) return { code: EXIT_FAIL, report: report(before.diagnostics), message: "Fix these problems first; the effect was not added." };
  // How long the animation is, for the default duration. A recipe opens its source to find out.
  const read = readerFor(before);
  const shape = await withSource(before, false, () => shapeOf(before.scene as NAscii, read));
  if (isOutcome(shape)) return shape;
  const seconds = shape.intervals / before.scene.fps;
  const startAt = typeof at === "number" ? at : 0;
  const entry: NAsciiFx = {
    effect,
    at: startAt,
    duration: typeof duration === "number" ? duration : Math.max(0.001, Math.round((seconds - startAt) * 10000) / 10000),
    seed: typeof seed === "number" ? seed : 0,
    ...(effect === "reveal" || effect === "hide" ? { by: (by as FxBy | undefined) ?? "scatter" } : {}),
    ...(typeof chars === "string" ? { chars } : {}),
    ...(effect === "shimmer" ? { amount: typeof amount === "number" ? amount : 0.1 } : {}),
  };
  const range = checkFxRange([entry], seconds);
  if (range[0]) return { code: EXIT_FAIL, report: report(range), message: `${range[0].message}\n  fix: ${range[0].fix ?? ""}\nThe effect was not added.` };
  const next = appendFx(text, fxJson(entry));
  if (next === undefined) return fileProblem(`${file} is not a JSON object, so no effect can be added to it.`);
  writeFileSync(path, next);
  const out = await lintCommand({ ...args, positional: [file] });
  return { ...out, lines: [`added ${JSON.stringify(fxJson(entry))} to ${file}`, ...(out.lines ?? [])] };
}

// ----------------------------------------------------------------------------- play

const stripErase = (t: string): string =>
  t
    .split("\n")
    .map((x) => x.replace(/\u001b\[K$/, ""))
    .join("\n");

async function playCommand(args: Args): Promise<Outcome> {
  const l = load(args.positional[0], "play");
  if (isOutcome(l)) return l;
  const rep = report(l.diagnostics);
  if (!l.scene || hasErrors(l.diagnostics)) return { code: EXIT_FAIL, report: rep };
  const loaded = l.scene;
  const read = readerFor(l);
  const shape = await withSource(l, false, () => shapeOf(loaded, read));
  if (isOutcome(shape)) return shape;
  const s = withShape(loaded, shape);
  const color = !args.flags.has("no-color") && !process.env["NO_COLOR"];
  /** The frame shown during interval `n`, read through framesOf, which stops converting once it is found. */
  const frameNumber = (n: number): Promise<NAsciiFrame | Outcome> =>
    withSource(l, false, async () => {
      let acc = 0;
      let last: NAsciiFrame | undefined;
      for await (const f of framesOf(loaded, read)) {
        last = f;
        acc += f.hold;
        if (n < acc) break;
      }
      return last as NAsciiFrame;
    });
  const frameFlag = args.flags.get("frame");
  if (frameFlag !== undefined) {
    const n = typeof frameFlag === "string" ? Number(frameFlag) : NaN;
    const total = shape.intervals;
    if (!Number.isInteger(n) || n < 0 || n >= total) return fileProblem(`--frame must be a whole number from 0 to ${total - 1}.`);
    const f = await frameNumber(n);
    if (isOutcome(f)) return f;
    const text = stripErase(frameText(s, f, { color: false, fill: "el" }));
    return { code: EXIT_OK, full: { ok: true, frame: n, text: text.split("\n") }, lines: [text] };
  }
  if (!process.stdout.isTTY) {
    const f = await frameNumber(0);
    if (isOutcome(f)) return f;
    const text = stripErase(frameText(s, f, { color: false, fill: "el" }));
    const note = "stdout is not a terminal, so only frame 0 is shown. Use --frame n for another frame, or run this in a terminal to play it.";
    return { code: EXIT_OK, full: { ok: true, frame: 0, text: text.split("\n"), note }, lines: [text, `note: ${note}`] };
  }
  const cols = process.stdout.columns ?? 0;
  const rowsAvail = process.stdout.rows ?? 0;
  if ((cols > 0 && cols < s.cols) || (rowsAvail > 0 && rowsAvail < s.rows + 1)) {
    return { code: EXIT_USAGE, message: `The terminal is ${cols} by ${rowsAvail} and the animation needs ${s.cols} by ${s.rows + 1}. Enlarge the terminal and run it again.` };
  }
  const loopsFlag = args.flags.has("loops") ? numFlag(args, "loops", 1, 1, 1000) : undefined;
  if (typeof loopsFlag === "string") return fileProblem(loopsFlag);
  const loops = args.flags.has("once") ? 1 : (loopsFlag ?? (s.loop ? Infinity : 1));
  // A recipe small enough for an SVG is converted once and kept; a larger one is converted again on every pass, so it never sits in memory.
  let frames: () => Iterable<NAsciiFrame> | AsyncIterable<NAsciiFrame> = () => loaded.frames;
  if (loaded.source || loaded.layers || loaded.fx.length > 0) {
    if (shape.renderer === "svg") {
      const all = await withSource(l, false, () => collect(loaded, read));
      if (isOutcome(all)) return all;
      frames = () => all.frames;
    } else frames = () => framesOf(loaded, read);
  }
  let stop = false;
  let wake: (() => void) | undefined;
  const onSig = (): void => {
    stop = true;
    wake?.();
  };
  process.on("SIGINT", onSig);
  process.on("SIGTERM", onSig);
  try {
    await playFrames(s, frames, {
      loops,
      color,
      write: (t) => void process.stdout.write(t),
      sleep: (ms) =>
        new Promise<void>((done) => {
          const t = setTimeout(done, ms);
          wake = () => {
            clearTimeout(t);
            done();
          };
        }),
      stopped: () => stop,
    });
  } finally {
    process.off("SIGINT", onSig);
    process.off("SIGTERM", onSig);
  }
  process.stdout.write("\n");
  return { code: EXIT_OK, full: { ok: true }, lines: [] };
}

// ----------------------------------------------------------------------------- probe

/** Width of the small frames used to measure how often the picture changes. */
const CHANGE_WIDTH = 160;

async function probeCommand(args: Args): Promise<Outcome> {
  const file = args.positional[0];
  if (!file) return fileProblem("probe needs a clip or image: gertie ascii probe <clip.mp4|anim.gif|frame.png> [--time s] [--json]");
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  const timeFlag = args.flags.get("time");
  if (timeFlag === true) return fileProblem("--time needs a number of seconds, such as --time 1.5.");
  const have = (cmd: string): boolean => spawnSync(cmd, ["-version"], { encoding: "utf8" }).status === 0;
  if (!have("ffmpeg") || !have("ffprobe")) return { code: EXIT_USAGE, message: "ascii probe needs ffmpeg and ffprobe, and they were not found.\n  fix: install ffmpeg (for example 'brew install ffmpeg' or 'apt install ffmpeg'), then run 'gertie doctor'" };
  const info = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,duration:format=duration", "-of", "json", path], { encoding: "utf8" });
  let st: { width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; duration?: string } | undefined;
  let fmtDuration: string | undefined;
  try {
    const j = JSON.parse(info.stdout) as { streams?: (typeof st)[]; format?: { duration?: string } };
    st = j.streams?.[0];
    fmtDuration = j.format?.duration;
  } catch {
    st = undefined;
  }
  if (info.status !== 0 || !st?.width || !st.height) return fileProblem(`${file} could not be read as a video or image: ${info.stderr.trim().split("\n")[0] ?? "no video stream"}`);
  const w = st.width;
  const h = st.height;
  const rate = (txt: string | undefined): number => {
    const [a, b] = (txt ?? "").split("/").map(Number);
    return a && b ? a / b : 0;
  };
  const duration = Number(st.duration ?? fmtDuration ?? 0) || 0;
  const isStill = duration === 0 || /\.(png|jpe?g|webp|bmp)$/i.test(path);
  const fps = isStill ? null : Math.round((rate(st.avg_frame_rate) || rate(st.r_frame_rate)) * 100) / 100 || null;
  // Default: the middle of a clip, where a reveal or typing has usually finished; the only frame of a picture.
  let time = isStill ? 0 : duration / 2;
  if (timeFlag !== undefined) {
    const t = Number(timeFlag);
    if (!Number.isFinite(t) || t < 0) return fileProblem(`--time ${String(timeFlag)} is not a number of seconds of 0 or more.`);
    if (!isStill && t >= duration) return fileProblem(`--time ${t} is at or past the end of the clip, which is ${duration.toFixed(2)} s long. Give a time under that.`);
    time = t;
  }
  const one = spawnSync("ffmpeg", ["-v", "error", ...(time > 0 ? ["-ss", String(time)] : []), "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: w * h * 4 + 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (one.status !== 0 || one.stdout.length !== w * h * 4) return fileProblem(`No frame could be taken from ${file} at ${time} seconds: ${String(one.stderr).trim().split("\n")[0] ?? "no output"}`);
  const frame = probeFrame(new Uint8Array(one.stdout.buffer, one.stdout.byteOffset, one.stdout.length), w, h);
  // How often the picture changes, from up to 3 seconds at the clip's own rate (at most 60), on small frames.
  let changesPerSecond: number | null = null;
  if (!isStill && fps) {
    const sw = Math.min(CHANGE_WIDTH, w);
    const shh = Math.max(2, Math.round((h * sw) / w / 2) * 2);
    const afps = Math.min(60, fps);
    const from = Math.max(0, Math.min(time, duration - 3));
    const run = spawnSync("ffmpeg", ["-v", "error", "-ss", String(from), "-t", "3", "-i", path, "-vf", `fps=${afps},scale=${sw}:${shh}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: sw * shh * 4 * 200 + 1024, stdio: ["ignore", "pipe", "pipe"] });
    if (run.status === 0) {
      const size = sw * shh * 4;
      const frames: Uint8Array[] = [];
      for (let at = 0; at + size <= run.stdout.length; at += size) frames.push(new Uint8Array(run.stdout.buffer, run.stdout.byteOffset + at, size));
      changesPerSecond = changeRate(frames, afps);
    }
  }
  const result = { file: path, size: { w, h }, time: Math.round(time * 1000) / 1000, duration: isStill ? null : Math.round(duration * 1000) / 1000, fps, changesPerSecond, ...frame };
  const lines = [
    `${basename(path)}: ${w} x ${h}${isStill ? "" : `, ${result.duration} s at ${fps} fps, about ${changesPerSecond ?? "?"} changes per second`}; frame at ${result.time} s`,
    frame.pitch ? `grid: ${frame.cols} cols by ${frame.rows} rows, cell ${frame.pitch.x} by ${frame.pitch.y} px (cellAspect ${frame.cellAspect}), glyph ${frame.glyph ?? "unknown"}` : "grid: not found",
    `background: ${frame.background}${frame.gradient ? `, gradient ${frame.gradient.from} to ${frame.gradient.to} at ${frame.gradient.angle} degrees` : ""}`,
    `colours: ${frame.colors.map((c) => `${c.hex} ${Math.round(c.share * 100)}%`).join(", ") || "none"}`,
    ...(frame.note ? [`note: ${frame.note}`] : []),
  ];
  return { code: EXIT_OK, full: { ok: true, errors: 0, warnings: 0, diagnostics: [], ...result }, lines };
}
