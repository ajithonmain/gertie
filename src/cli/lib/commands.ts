import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { parseHex } from "../../spec/color.ts";
import { compileSceneText, compileSceneValue } from "../../compile.ts";
import { ImportError, importSvg } from "../../import/svg.ts";
import { resolveIncludes } from "../../import/include.ts";
import { buildCutout, validateSpec, type CutoutSpec } from "../../cutout/build.ts";
import { gridSvg, outlinesSvg } from "../../cutout/overlay.ts";
import { labelOverlay, summarize } from "../../import/summary.ts";
import { openSvg } from "../../render/svg.ts";
import { openLottie } from "../../render/lottie.ts";
import { decodeImage, decodeImages } from "../../render/image.ts";
import { openRenderer } from "../../render/lottie.ts";
import { parsePoint, sampleColours, type Point } from "../../study/sample.ts";
import { analyzeMotion, estimateBackground, frameStat, medianBackground, type FrameStat, type Move } from "../../study/analyze.ts";
import { launchBrowser } from "../../render/browser.ts";
import { traceImage, type TraceOptions } from "../../trace/trace.ts";
import { groupNodes, type GroupSpec } from "../../trace/group.ts";
import { inspectLottie } from "../../lottie-tools/inspect.ts";
import { isTier, profileLines, profileReport, TIERS, type ProfileReport, type Tier } from "../../lottie-tools/bands.ts";
import { parseColorMap, recolorLottie } from "../../lottie-tools/colors.ts";
import { retimeLottie } from "../../lottie-tools/time.ts";
import { introduced } from "../../lottie-tools/compare.ts";
import type { JObj } from "../../lottie-tools/time.ts";
import { hasErrors, makeDiagnostic, report, type Diagnostic, type Report } from "../../spec/diagnostics.ts";
import { validateLottie } from "../../validate/index.ts";
import { buildQaReport, renderChecks, type RenderOutcome } from "../../qa/run.ts";
import { browserStatus } from "../../render/browser.ts";
import { spawnSync } from "node:child_process";
import { exportScene } from "../../export/index.ts";
import { DESTINATIONS, DESTINATION_IDS } from "../../export/destinations.ts";
import { ffmpegInfo, ExportUnavailableError } from "../../export/ffmpeg.ts";
import { FORMAT_IDS, FORMATS, parseFormats, unavailable, type FormatId } from "../../export/formats.ts";
import { storyReadiness, type StoryReadiness } from "../../story/tools.ts";
import type { Args } from "./args.ts";

export const EXIT_OK = 0;
export const EXIT_FAIL = 1;
export const EXIT_USAGE = 2;

export interface Outcome {
  code: number;
  report?: Report;
  /** A report with extra fields (qa, doctor). Printed instead of `report` in JSON mode. */
  full?: object;
  lines?: string[];
  outputs?: string[];
  message?: string;
}

const MIME: Record<string, string> = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

/** Finds every `src` of an image node in a raw scene, including children and defs. */
function imageSources(raw: unknown): string[] {
  const found = new Set<string>();
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) return void n.forEach(walk);
    const o = n as Record<string, unknown>;
    if (o["type"] === "image" && typeof o["src"] === "string") found.add(o["src"]);
    if (Array.isArray(o["children"])) o["children"].forEach(walk);
  };
  const root = raw as { nodes?: unknown; defs?: unknown } | null;
  if (root && typeof root === "object") {
    walk(root.nodes);
    if (root.defs && typeof root.defs === "object") Object.values(root.defs).forEach(walk);
  }
  return [...found];
}

function formatDiagnostic(d: Diagnostic): string {
  const where = [d.node ? `node ${d.node}` : "", d.path ?? ""].filter(Boolean).join(" ");
  const head = `${d.severity === "error" ? "error" : "warning"} ${d.code}${where ? ` (${where})` : ""}: ${d.message}`;
  return d.fix ? `${head}\n  fix: ${d.fix}` : head;
}

/** Reads included fragments relative to the scene file. */
function fragmentLoader(baseDir: string): (src: string) => unknown {
  return (src) => {
    const p = resolve(baseDir, src);
    if (!existsSync(p)) throw new Error(`file not found: ${src}`);
    return JSON.parse(readFileSync(p, "utf8"));
  };
}

/** Reads the Lottie files that `lottie` nodes place. A file that is missing or is not JSON is left out; the linter says which. */
function loadLotties(raw: unknown, baseDir: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const walk = (n: unknown): void => {
    if (n === null || typeof n !== "object") return;
    if (Array.isArray(n)) return void n.forEach(walk);
    const o = n as Record<string, unknown>;
    if (o["type"] === "lottie" && typeof o["src"] === "string" && !(o["src"] in out)) {
      const p = resolve(baseDir, o["src"]);
      if (existsSync(p)) {
        try {
          out[o["src"]] = JSON.parse(readFileSync(p, "utf8"));
        } catch {
          /* not JSON: the file is left out and the linter reports it */
        }
      }
    }
    if (Array.isArray(o["children"])) o["children"].forEach(walk);
  };
  const root = raw as { nodes?: unknown; defs?: unknown } | null;
  if (root && typeof root === "object") {
    walk(root.nodes);
    if (root.defs && typeof root.defs === "object") Object.values(root.defs).forEach(walk);
  }
  return out;
}

export function fileProblem(message: string): Outcome {
  return { code: EXIT_USAGE, message };
}

export interface CompileRun {
  outcome: Outcome;
  result?: ReturnType<typeof compileSceneText>;
  outputs?: { lottie: string; svg?: string; outDir: string; name: string; baked: string[] };
}

export function compileCommand(args: Args): Outcome {
  return runCompile(args).outcome;
}

declare const __GERTIE_VERSION__: string | undefined;
export const VERSION: string = typeof __GERTIE_VERSION__ === "string" ? __GERTIE_VERSION__ : "dev";

export function runCompile(args: Args, write = true): CompileRun {
  const fail = (outcome: Outcome): CompileRun => ({ outcome });
  const file = args.positional[0];
  if (!file) return fail(fileProblem("compile needs a scene file: gertie compile <scene.gertie.json>"));
  if (args.flags.has("dotlottie")) return fail(fileProblem("The .lottie archive is written by the export command: gertie export <scene> --to lottie-zip"));
  const path = resolve(file);
  if (!existsSync(path)) return fail(fileProblem(`File not found: ${file}`));
  const baseDir = dirname(path);
  const text = readFileSync(path, "utf8");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    raw = undefined;
  }
  // Images and Lottie files that an included fragment brings in are found after the includes are resolved.
  const flat = resolveIncludes(raw, fragmentLoader(baseDir)).scene;
  const images: Record<string, string> = {};
  for (const src of imageSources(flat)) {
    const p = resolve(baseDir, src);
    if (existsSync(p)) images[src] = `data:${MIME[extname(p).toLowerCase()] ?? "application/octet-stream"};base64,${readFileSync(p).toString("base64")}`;
  }

  const lotties = loadLotties(flat, baseDir);
  // --lottie alone skips the SVG, --svg alone asks for it. A scene that places a Lottie file gets no SVG unless it is asked for (and then it is an error).
  const svgOpt = args.flags.has("lottie") && !args.flags.has("svg") ? false : args.flags.has("svg") && !args.flags.has("lottie") ? true : undefined;
  const result = compileSceneText(text, { fileExists: (src) => existsSync(resolve(baseDir, src)), images, lotties, loadFragment: fragmentLoader(baseDir), ...(svgOpt === undefined ? {} : { svg: svgOpt }) });
  const rep = report(result.diagnostics, args.flags.has("strict"));
  if (!result.lottie || hasErrors(result.diagnostics)) return { outcome: { code: EXIT_FAIL, report: rep }, result };
  if (args.flags.has("strict") && !rep.ok) return { outcome: { code: EXIT_FAIL, report: rep }, result };

  const outFlag = args.flags.get("out");
  const outDir = typeof outFlag === "string" ? resolve(outFlag) : join(baseDir, "out");
  const name = (result.scene?.name ?? basename(path).replace(/\.gertie\.json$/, "")) as string;
  const target = join(outDir, `${name}.lottie.json`);
  if (!write) return { outcome: { code: EXIT_OK, report: rep }, result, outputs: { lottie: target, ...(result.svg ? { svg: join(outDir, `${name}.svg`) } : {}), outDir, name, baked: result.svg?.baked ?? [] } };
  mkdirSync(outDir, { recursive: true });
  const svgTarget = join(outDir, `${name}.svg`);
  // With neither --lottie nor --svg both are written; with one of them only that one.
  const wantLottie = args.flags.has("lottie") || !args.flags.has("svg");
  const wantSvg = (args.flags.has("svg") || !args.flags.has("lottie")) && result.svg !== undefined;
  const written: string[] = [];
  if (wantLottie) {
    writeFileSync(target, JSON.stringify(result.lottie, null, args.flags.has("pretty") ? 2 : undefined) + "\n");
    written.push(target);
  }
  if (wantSvg && result.svg) {
    writeFileSync(svgTarget, result.svg.svg);
    written.push(svgTarget);
  }
  const lines = result.svg && result.svg.baked.length > 0 ? [`note: the SVG bakes ${result.svg.baked.join(", ")} (one keyframe per frame). Simplify these properties to shrink the file.`] : [];
  if (result.svgSkipped === "lottie") lines.push("note: no SVG was written, because the scene places a Lottie file and the SVG output cannot show one.");
  return { outcome: { code: EXIT_OK, report: rep, outputs: written, lines }, result, outputs: { lottie: target, ...(result.svg ? { svg: svgTarget } : {}), outDir, name, baked: result.svg?.baked ?? [] } };
}

export function validateCommand(args: Args): Outcome {
  const file = args.positional[0];
  if (!file) return fileProblem("validate needs a file: gertie validate <scene.gertie.json | lottie.json>");
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  const text = readFileSync(path, "utf8");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    value = undefined;
  }
  const isLottie = value !== null && typeof value === "object" && !("gertie" in (value as object)) && "layers" in (value as object);
  let diagnostics: Diagnostic[];
  let quality: ProfileReport | undefined;
  if (isLottie) {
    diagnostics = validateLottie(value, "external");
    quality = profileReport(value as JObj);
  } else {
    const res = compileSceneText(text, { fileExists: (src) => existsSync(resolve(dirname(path), src)), lotties: loadLotties(resolveIncludes(value, fragmentLoader(dirname(path))).scene, dirname(path)), loadFragment: fragmentLoader(dirname(path)) });
    diagnostics = res.diagnostics;
    if (res.lottie && !hasErrors(diagnostics)) quality = profileReport(res.lottie as JObj, res.scene?.tier);
  }
  const rep = report(diagnostics, args.flags.has("strict"));
  return { code: rep.ok ? EXIT_OK : EXIT_FAIL, report: rep, ...(quality ? { full: { ...rep, profile: quality } } : {}) };
}

export function profileCommand(args: Args): Outcome {
  const file = args.positional[0];
  if (!file) return fileProblem("profile needs a file: gertie profile <scene.gertie.json | lottie.json> [--tier icon|character|scene] [--json]");
  const tierFlag = args.flags.get("tier");
  if (tierFlag !== undefined && !isTier(tierFlag)) return fileProblem(`--tier is ${JSON.stringify(tierFlag)}. Allowed values: ${TIERS.join(", ")}.`);
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fileProblem(`${file} is not valid JSON. A .lottie archive must be unzipped first; use the animation JSON inside it.`);
  }
  const isScene = value !== null && typeof value === "object" && !Array.isArray(value) && "gertie" in (value as object);
  let doc: JObj;
  let tier: Tier | undefined = isTier(tierFlag) ? tierFlag : undefined;
  let diagnostics: Diagnostic[] = [];
  if (isScene) {
    // The profile never fails on warnings, so --strict is not passed on to the compile.
    const run = runCompile({ ...args, flags: new Map([...args.flags].filter(([k]) => k !== "strict")) }, false);
    if (!run.result?.lottie || !run.result.scene) return run.outcome;
    doc = run.result.lottie as JObj;
    tier ??= run.result.scene.tier;
    diagnostics = run.result.diagnostics;
  } else {
    const r = readLottieFile(file, "profile");
    if (isOutcome(r)) return r;
    doc = r.doc;
  }
  const quality = profileReport(doc, tier);
  const rep = report(diagnostics);
  const full = { ok: true, errors: rep.errors, warnings: rep.warnings, diagnostics: rep.diagnostics, file: path, ...quality };
  return { code: EXIT_OK, full, lines: profileLines(quality) };
}

export async function qaCommand(args: Args): Promise<Outcome> {
  const run = runCompile(args);
  if (!run.result || !run.outputs || !run.result.scene || !run.result.lottie) return run.outcome;
  const { scene, lottie, svg } = run.result;
  const sheetFrames = args.flags.get("sheet-frames");
  let rendered: RenderOutcome | undefined;
  try {
    rendered = await renderChecks(scene, lottie, { thorough: args.flags.has("thorough"), ...(svg ? { svg: svg.svg } : {}), ...(typeof sheetFrames === "string" ? { sheetFrames: Number(sheetFrames) } : {}) });
  } catch (e) {
    return fileProblem(`Rendering failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`);
  }
  const outputs: { lottie: string; svg?: string; sheet?: string; parity?: string } = { lottie: run.outputs.lottie, ...(run.outputs.svg ? { svg: run.outputs.svg } : {}) };
  if (rendered.parityImage) {
    outputs.parity = join(run.outputs.outDir, `${run.outputs.name}.parity-f${rendered.parityImage.frame}.png`);
    writeFileSync(outputs.parity, rendered.parityImage.png);
  }
  if (rendered.sheet) {
    outputs.sheet = join(run.outputs.outDir, `${run.outputs.name}.sheet.png`);
    writeFileSync(outputs.sheet, rendered.sheet);
  }
  const diagnostics = [...run.result.diagnostics, ...rendered.diagnostics];
  const qa = buildQaReport(scene, diagnostics, { outputs, lottieBytes: statSync(run.outputs.lottie).size, ...(run.outputs.svg ? { svgBytes: statSync(run.outputs.svg).size } : {}), baked: run.outputs.baked, rendered, strict: args.flags.has("strict") });
  const lines: string[] = [];
  if (!rendered.rendered && rendered.skipped) lines.push(`render checks skipped: ${rendered.skipped.reason}`, `  fix: ${rendered.skipped.fix}`);
  return { code: qa.ok ? EXIT_OK : EXIT_FAIL, report: qa, full: { ...qa, profile: profileReport(lottie as JObj, scene.tier) }, outputs: Object.values(outputs), lines };
}

export async function exportCommand(args: Args): Promise<Outcome> {
  const to = args.flags.get("to");
  const dest = args.flags.get("for");
  if (to !== undefined && dest !== undefined) return fileProblem("Use --to or --for, not both. --for picks the formats and enforces the platform's limits.");
  if (to === undefined && dest === undefined) return fileProblem(`export needs --to <formats> or --for <destination>. Formats: ${FORMAT_IDS.join(", ")}. Destinations: ${DESTINATION_IDS.join(", ")}.`);
  let formats: FormatId[] = [];
  if (typeof to === "string") {
    const parsed = parseFormats(to);
    if (parsed.unknown.length > 0) return fileProblem(`Unknown format '${parsed.unknown.join("', '")}'. Formats: ${FORMAT_IDS.join(", ")}.`);
    formats = parsed.formats;
    if (formats.length === 0) return fileProblem("--to needs at least one format.");
  } else if (typeof dest === "string") {
    if (!DESTINATIONS[dest]) return fileProblem(`Unknown destination '${dest}'. Destinations: ${DESTINATION_IDS.join(", ")}.`);
  } else return fileProblem("--to and --for need a value.");
  const number = (flag: string, def: number, min: number, max: number): number | string => {
    const v = args.flags.get(flag);
    if (v === undefined) return def;
    const n = typeof v === "string" ? Number(v) : NaN;
    return Number.isFinite(n) && n >= min && n <= max ? n : `--${flag} must be a number from ${min} to ${max}.`;
  };
  const scale = args.flags.has("scale") ? number("scale", 1, 0.25, 4) : undefined;
  const quality = args.flags.get("quality");
  if (quality !== undefined && quality !== "high" && quality !== "standard") return fileProblem("--quality must be high or standard.");
  const loops = number("loops", 1, 1, 20);
  if (typeof scale === "string") return fileProblem(scale);
  if (typeof loops === "string") return fileProblem(loops);
  const bg = args.flags.get("bg");
  if (bg !== undefined && (typeof bg !== "string" || parseHex(bg) === null)) return fileProblem("--bg must be a colour like #ffffff or #fff.");

  const run = runCompile(args, false);
  if (!run.result || !run.outputs || !run.result.scene || !run.result.lottie) return run.outcome;
  const { scene, lottie, svg } = run.result;
  if (!svg && formats.includes("svg")) return fileProblem("The scene places a Lottie file, which the SVG output cannot show. Export another format.");
  const keep = args.flags.get("keep-frames");
  const json = args.flags.has("json");
  let res;
  try {
    res = await exportScene({
      scene,
      lottie,
      lottieJson: JSON.stringify(lottie),
      svg: svg?.svg ?? "",
      outDir: run.outputs.outDir,
      name: run.outputs.name,
      version: VERSION,
      formats,
      ...(typeof dest === "string" ? { destination: dest } : {}),
      ...(typeof bg === "string" ? { bg } : {}),
      ...(scale !== undefined ? { scale } : {}),
      ...(quality !== undefined ? { quality } : {}),
      loops,
      ...(typeof keep === "string" ? { keepFrames: resolve(keep) } : {}),
      ...(json ? {} : { progress: (l: string) => console.error(l) }),
    });
  } catch (e) {
    if (e instanceof ExportUnavailableError) return { code: EXIT_USAGE, message: `${e.message}\n  fix: ${e.fix}` };
    return fileProblem(`Export failed unexpectedly: ${e instanceof Error ? e.message : String(e)}`);
  }
  const ok = res.failures.length === 0;
  const full = { ok, scene: scene.name, diagnostics: run.result.diagnostics, files: res.files, failures: res.failures, notes: res.notes };
  const lines: string[] = [];
  for (const f of res.files) lines.push(`${f.format.padEnd(10)} ${f.path}  ${Math.round(f.bytes / 1024 * 10) / 10} KB${f.width ? `  ${f.width}x${f.height}` : ""}${f.frames ? `  ${f.frames} frames` : ""}${f.fit ? `  (${f.fit})` : ""}${f.alpha?.checked ? `  alpha ok` : ""}${f.checks?.some((c) => c.checked) ? `  checks ok (${f.checks.filter((c) => c.checked).map((c) => c.name).join(", ")})` : ""}`);
  for (const f of res.failures) lines.push(`error ${f.format}: ${f.reason}`, `  fix: ${f.fix}`);
  for (const n of res.notes) lines.push(`note: ${n}`);
  const code = ok ? EXIT_OK : res.failures.some((f) => !f.environment) ? EXIT_FAIL : EXIT_USAGE;
  return { code, full, lines, outputs: res.files.map((f) => f.path), report: report(run.result.diagnostics) };
}

interface DoctorReport {
  ok: boolean;
  node: { version: string; ok: boolean };
  playwright: boolean;
  browser: { ok: boolean; source?: string; detail: string; fix?: string };
  ffmpeg: { ok: boolean; version?: string };
  /** For every export format: whether it can be produced here, and if not why and what to do. */
  formats: { format: string; ok: boolean; reason?: string; fix?: string }[];
  /** Whether videos can be built from storyboards, and whether HyperFrames is installed. */
  story: StoryReadiness;
  notes: string[];
}

export async function doctorCommand(): Promise<Outcome> {
  const major = Number(process.versions.node.split(".")[0]);
  const status = await browserStatus();
  const ff = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
  const ffVersion = ff.status === 0 ? /ffmpeg version (\S+)/.exec(ff.stdout)?.[1] : undefined;
  const notes: string[] = [];
  if (!status.source && status.fix) notes.push(`To enable rendering: ${status.fix}`);
  const info = ffmpegInfo();
  if (!ffVersion) notes.push("ffmpeg was not found. It is needed only for export to GIF, APNG, WebP, WebM, ProRes, HEVC and MP4. Lottie, SVG and .lottie archives do not need it.");
  const story = storyReadiness();
  const formats = FORMAT_IDS.map((format) => {
    const u = unavailable(format, info);
    return u ? { format, ok: false, reason: u.reason, fix: u.fix } : { format, ok: true };
  });
  const rep: DoctorReport = {
    ok: major >= 22,
    node: { version: process.versions.node, ok: major >= 22 },
    playwright: status.playwright,
    browser: { ok: status.source !== undefined, ...(status.source ? { source: status.source } : {}), detail: status.detail, ...(status.fix ? { fix: status.fix } : {}) },
    ffmpeg: { ok: ffVersion !== undefined, ...(ffVersion ? { version: ffVersion } : {}) },
    formats,
    story,
    notes,
  };
  const lines = [
    `node ${rep.node.version} ${rep.node.ok ? "ok" : "too old, need 22 or newer"}`,
    `playwright ${rep.playwright ? "ok" : "missing"}`,
    `browser ${rep.browser.ok ? "ok" : "missing"}: ${rep.browser.detail}`,
    `ffmpeg ${rep.ffmpeg.ok ? `ok (${rep.ffmpeg.version})` : "missing"}`,
    `formats ${formats.filter((f) => f.ok).map((f) => f.format).join(", ")}`,
    ...formats.filter((f) => !f.ok).map((f) => `  ${f.format} unavailable: ${f.reason}`),
    `story ${story.ok ? "ok" : "unavailable"}${story.hyperframes ? `; hyperframes ${story.hyperframes}` : "; hyperframes not installed (optional)"}`,
    ...story.missing.map((m) => `  story: ${m.what} missing, ${m.effect}. ${m.fix}`),
    ...notes,
  ];
  return { code: rep.ok ? EXIT_OK : EXIT_FAIL, full: rep, lines };
}

export function emit(outcome: Outcome, json: boolean): void {
  if (json && outcome.full) {
    console.log(JSON.stringify(outcome.full));
    return;
  }
  if (!json && outcome.full && !outcome.report) {
    for (const l of outcome.lines ?? []) console.log(l);
    return;
  }
  if (json) {
    if (outcome.message !== undefined) {
      console.log(JSON.stringify({ ok: false, errors: 1, warnings: 0, diagnostics: [makeDiagnostic("E-USAGE", outcome.message, undefined)] }));
      return;
    }
    const rep = outcome.report ?? report([]);
    console.log(JSON.stringify(outcome.outputs ? { ...rep, outputs: outcome.outputs } : rep));
    return;
  }
  if (outcome.message !== undefined) {
    console.error(outcome.message);
    return;
  }
  const rep = outcome.report;
  if (rep) {
    for (const d of rep.diagnostics) console.error(formatDiagnostic(d));
    console.error(`${rep.errors} error(s), ${rep.warnings} warning(s)`);
  }
  for (const l of outcome.lines ?? []) console.error(l);
  for (const o of outcome.outputs ?? []) console.log(`wrote ${o}`);
}

export async function importCommand(args: Args): Promise<Outcome> {
  const file = args.positional[0];
  if (!file) return fileProblem("import needs an SVG file: gertie import <artwork.svg> [--out fragment.json] [--preview preview.png] [--no-preview] [--json]");
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  return finishImport(args, readFileSync(path, "utf8"), basename(path), basename(path).replace(/\.svg$/i, ""), dirname(path), []);
}

/** The part of importing that follows reading an SVG: convert, write the fragment, summarize, draw the labelled preview. Also used by `trace`. */
async function finishImport(args: Args, svgText: string, source: string, stem: string, dir: string, leading: string[]): Promise<Outcome> {
  let result: ReturnType<typeof importSvg>;
  try {
    result = importSvg(svgText, source);
  } catch (e) {
    if (e instanceof ImportError) return { code: EXIT_FAIL, report: report([makeDiagnostic("E-IMPORT", e.message, "Export the artwork again as plain SVG (no embedded images or text), or fix the file.")]) };
    throw e;
  }
  const outFlag = args.flags.get("out");
  const outPath = typeof outFlag === "string" ? resolve(outFlag) : join(dir, `${stem}.fragment.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result.fragment, null, 1) + "\n");

  const summary = summarize(result);
  const diagnostics: Diagnostic[] = result.unsupported.map((u) =>
    makeDiagnostic("W-IMPORT-UNSUPPORTED", `<${u.element}>${u.id ? ` '${u.id}'` : ""}: ${u.note}${u.count > 1 ? ` (${u.count} times)` : ""}.`, "Tell the user what was left out. Fix it in the design tool and import again if it matters."),
  );
  // The fragment is placed in a one-second scene so it goes through the same lint as any scene.
  const name = (stem.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "artwork").replace(/^([^a-z0-9])/, "a$1");
  const wrapper = compileSceneValue({ gertie: 1, name, canvas: result.fragment.canvas, duration: 1, loop: false, nodes: result.fragment.nodes });
  diagnostics.push(...wrapper.diagnostics.filter((d) => d.code !== "W-STATIC"));

  const lines: string[] = [...leading];
  const outputs: { fragment: string; preview?: string } = { fragment: outPath };
  if (!args.flags.has("no-preview") && wrapper.svg && !hasErrors(wrapper.diagnostics)) {
    const previewFlag = args.flags.get("preview");
    const previewPath = typeof previewFlag === "string" ? resolve(previewFlag) : join(dirname(outPath), `${stem}.preview.png`);
    try {
      const { w, h } = result.fragment.canvas;
      const svg = wrapper.svg.svg.replace(/<\/svg>\s*$/, `${labelOverlay(result.fragment, result.boxes)}</svg>`);
      const r = await openSvg(svg, { w, h, fps: 30 }, { scale: Math.max(w, h) < 800 ? 2 : 1 });
      try {
        writeFileSync(previewPath, await r.renderFrame(0));
        outputs.preview = previewPath;
      } finally {
        await r.close();
      }
    } catch (e) {
      lines.push(`preview skipped: ${e instanceof Error ? e.message : String(e)}`, "  fix: run 'gertie doctor' to see how to enable rendering");
    }
  }

  const rep = report(diagnostics, args.flags.has("strict"));
  for (const n of summary.nodes) lines.push(`${"  ".repeat(n.depth)}${n.id}  ${n.type}  [${n.bbox.join(", ")}]${n.fill ? `  ${n.fill}` : ""}${n.children !== undefined ? `  ${n.children} children` : ""}`);
  if (summary.truncated) lines.push(`(showing ${summary.truncated.shown} of ${summary.truncated.total} nodes: all groups, then the largest shapes. The fragment file has every node.)`);
  for (const a of summary.advice) lines.push(`note: ${a}`);
  const full = { ...rep, outputs, summary };
  return { code: rep.ok ? EXIT_OK : EXIT_FAIL, report: rep, full, outputs: Object.values(outputs), lines };
}

export function numFlag(args: Args, name: string, def: number, min: number, max: number): number | string {
  const v = args.flags.get(name);
  if (v === undefined) return def;
  const n = typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= min && n <= max ? n : `--${name} must be a number from ${min} to ${max}.`;
}

export async function traceCommand(args: Args): Promise<Outcome> {
  const file = args.positional[0];
  if (!file) return fileProblem("trace needs an image: gertie trace <logo.png> [--colors n] [--speckle n] [--drop #fff,...] [--seam n] [--detail n] [--out fragment.json] [--keep-svg traced.svg] [--no-preview] [--json]");
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  const opts: Partial<TraceOptions> = {};
  for (const [flag, key, def, min, max] of [["colors", "colors", 16, 2, 64], ["speckle", "speckle", 6, 0, 10000], ["seam", "seam", 0.6, 0, 5], ["detail", "detail", 0.6, 0.1, 5]] as const) {
    const v = numFlag(args, flag, def, min, max);
    if (typeof v === "string") return fileProblem(v);
    opts[key] = v;
  }
  const dropText = args.flags.get("drop");
  if (typeof dropText === "string") {
    const drop: TraceOptions["drop"] = [];
    for (const part of dropText.split(",").map((p) => p.trim()).filter((p) => p !== "")) {
      const rgb = parseHex(part);
      if (rgb === null) return fileProblem(`--drop needs hex colours such as #ffffff, separated by commas. '${part}' is not one.`);
      drop.push({ rgb: [Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255)], tolerance: 24 });
    }
    opts.drop = drop;
  }
  let raster;
  try {
    raster = await decodeImage(readFileSync(path));
  } catch (e) {
    return { code: EXIT_USAGE, message: `Could not read the image: ${e instanceof Error ? e.message : String(e)}\n  fix: use a PNG, JPEG, GIF or WebP file, and run 'gertie doctor' to check that rendering is available` };
  }
  const t = traceImage(raster, opts);
  const stem = basename(path).replace(/\.[a-z0-9]+$/i, "");
  const keep = args.flags.get("keep-svg");
  const lines = [`traced ${raster.w} x ${raster.h} pixels into ${t.regions} regions with ${t.palette.length} colours`];
  if (typeof keep === "string") {
    mkdirSync(dirname(resolve(keep)), { recursive: true });
    writeFileSync(resolve(keep), t.svg);
  }
  return finishImport(args, t.svg, basename(path), stem, dirname(path), lines);
}

export function groupCommand(args: Args): Outcome {
  const [fragFile, groupsFile] = args.positional;
  if (!fragFile || !groupsFile) return fileProblem("group needs a fragment and a grouping file: gertie group <fragment.json> <groups.json> [--out grouped.fragment.json]");
  const fragPath = resolve(fragFile);
  const gPath = resolve(groupsFile);
  for (const [p, f] of [[fragPath, fragFile], [gPath, groupsFile]] as const) if (!existsSync(p)) return fileProblem(`File not found: ${f}`);
  let frag: { [k: string]: unknown };
  let spec: unknown;
  try {
    frag = JSON.parse(readFileSync(fragPath, "utf8")) as { [k: string]: unknown };
    spec = JSON.parse(readFileSync(gPath, "utf8"));
  } catch (e) {
    return fileProblem(`Could not read JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (frag["gertie-fragment"] !== 1 || !Array.isArray(frag["nodes"])) return fileProblem(`${fragFile} is not a Gertie fragment. Create one with gertie import or gertie trace.`);
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) return fileProblem(`${groupsFile} must be an object mapping group ids to lists of node ids, such as { "head": ["region-3", "region-4"] }.`);
  const res = groupNodes(frag["nodes"] as Record<string, unknown>[], spec as GroupSpec);
  if (res.errors.length > 0) return { code: EXIT_FAIL, report: report(res.errors.map((m) => makeDiagnostic("E-GROUP", m, "Fix the grouping file. Node ids are in the fragment and in the import summary."))) };
  const outFlag = args.flags.get("out");
  const outPath = typeof outFlag === "string" ? resolve(outFlag) : fragPath.replace(/\.json$/i, ".grouped.json");
  writeFileSync(outPath, JSON.stringify({ ...frag, nodes: res.nodes }, null, 1) + "\n");
  return { code: EXIT_OK, report: report([]), outputs: [outPath], lines: [`${Object.keys(spec as object).length} groups made; ${res.nodes.length} top-level nodes`] };
}

// ---------------------------------------------------------------- Lottie as a reference

function readLottieFile(file: string | undefined, command: string): { doc: JObj; path: string } | Outcome {
  if (!file) return fileProblem(`${command} needs a Lottie JSON file: gertie ${command} <animation.json>`);
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  let doc: unknown;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fileProblem(`${file} is not valid JSON. A .lottie archive must be unzipped first; use the animation JSON inside it.`);
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc) || !Array.isArray((doc as JObj)["layers"])) return fileProblem(`${file} is not a Lottie animation (no 'layers' array).`);
  return { doc: doc as JObj, path };
}

const isOutcome = (v: unknown): v is Outcome => typeof v === "object" && v !== null && "code" in v;

function countCodes(d: readonly Diagnostic[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of d) out[x.code] = (out[x.code] ?? 0) + 1;
  return out;
}

export function inspectCommand(args: Args): Outcome {
  const r = readLottieFile(args.positional[0], "inspect");
  if (isOutcome(r)) return r;
  const info = inspectLottie(r.doc);
  const diagnostics = validateLottie(r.doc, "external");
  const rep = report(diagnostics);
  const outside = countCodes(diagnostics.filter((d) => d.severity === "error"));
  const full = { ok: true, file: r.path, ...info, validation: { errors: rep.errors, warnings: rep.warnings, errorsByCode: outside, portable: rep.errors === 0 } };
  const lines = [
    `${info.name ?? basename(r.path)}${info.version ? `  (made with ${info.version})` : ""}`,
    `${info.size.w} x ${info.size.h}, ${info.frameRate} fps, frames ${info.frames.in} to ${info.frames.out} (${info.durationSeconds} seconds)`,
    `${info.layerCount} layers: ${Object.entries(info.layerTypes).map(([k, v]) => `${v} ${k}`).join(", ")}`,
    ...(info.precomps.length > 0 ? [`${info.precomps.length} precompositions: ${info.precomps.slice(0, 8).map((p) => `${p.id} (${p.layers} layers)`).join(", ")}`] : []),
    `colours: ${info.colors.length === 0 ? "none found" : info.colors.slice(0, 12).map((c) => `${c.hex} x${c.count}`).join(", ")}${info.colors.length > 12 ? ", ..." : ""}`,
    `validation: ${rep.errors} errors, ${rep.warnings} warnings${rep.errors === 0 ? " (portable)" : ` (not portable: ${Object.entries(outside).map(([k, v]) => `${k} x${v}`).join(", ")})`}`,
    ...info.notes.map((n) => `note: ${n}`),
  ];
  return { code: EXIT_OK, full, lines };
}

interface RenderStats {
  rendered: boolean;
  frames: number;
  /** Highest share of pixels with content in any sampled frame. */
  maxContent: number;
  console: string[];
  skipped?: string;
}

async function renderStats(doc: JObj, count = 6): Promise<RenderStats> {
  let r;
  try {
    r = await openLottie(doc as { w: number; h: number });
  } catch (e) {
    return { rendered: false, frames: 0, maxContent: 0, console: [], skipped: e instanceof Error ? e.message : String(e) };
  }
  try {
    const ip = typeof doc["ip"] === "number" ? doc["ip"] : 0;
    const op = typeof doc["op"] === "number" ? doc["op"] : 0;
    const frames: Buffer[] = [];
    for (let i = 0; i < count; i++) frames.push(await r.renderFrame(ip + ((op - ip) * (i + 0.5)) / count));
    const a = await r.analyze(frames, [], [0, 0, 0, 0]);
    const msgs = (await r.consoleMessages()).map((m) => `${m.level}: ${m.text}`.slice(0, 160));
    return { rendered: true, frames: frames.length, maxContent: Math.max(0, ...a.frames.map((f) => f.content)), console: msgs.slice(0, 5) };
  } finally {
    await r.close();
  }
}

/** Shared tail of recolor and retime: validate against the input, render, write, report. */
async function finishEdit(args: Args, src: { doc: JObj; path: string }, edited: JObj, suffix: string, lines: string[], extra: object): Promise<Outcome> {
  const before = validateLottie(src.doc, "external");
  const after = validateLottie(edited, "external");
  const added = introduced(before, after);
  const outFlag = args.flags.get("out");
  const outPath = typeof outFlag === "string" ? resolve(outFlag) : join(dirname(src.path), `${basename(src.path).replace(/\.json$/i, "")}.${suffix}.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(edited) + "\n");

  const diagnostics: Diagnostic[] = added.map((d) => ({ ...d, message: `New after the edit: ${d.message}` }));
  let render: RenderStats | undefined;
  if (!args.flags.has("no-render")) {
    render = await renderStats(edited);
    if (!render.rendered) lines.push(`render skipped: ${render.skipped}`);
    else {
      if (render.maxContent <= 0.0005) diagnostics.push(makeDiagnostic("E-R-BLANK", "After the edit every sampled frame is empty.", "The edit should not do this. Try a smaller change, and report the file as a Gertie bug."));
      for (const c of render.console) diagnostics.push(makeDiagnostic("W-R-CONSOLE", `lottie-web wrote to the console while playing the edited file: ${c}`, "The player may not handle this file."));
    }
  }
  const rep = report(diagnostics, args.flags.has("strict"));
  lines.push(`validation: the original had ${before.filter((d) => d.severity === "error").length} errors and ${before.filter((d) => d.severity === "warning").length} warnings; the edit added ${added.length}`);
  if (render?.rendered) lines.push(`render: ${render.frames} frames drawn, no errors`);
  const full = { ...rep, outputs: { lottie: outPath }, validation: { before: { errors: before.filter((d) => d.severity === "error").length, warnings: before.filter((d) => d.severity === "warning").length }, introduced: added.length }, ...(render ? { render } : {}), ...extra };
  return { code: rep.ok ? EXIT_OK : EXIT_FAIL, report: rep, full, outputs: [outPath], lines };
}

export async function recolorCommand(args: Args): Promise<Outcome> {
  const r = readLottieFile(args.positional[0], "recolor");
  if (isOutcome(r)) return r;
  const mapText = args.flags.get("map");
  if (typeof mapText !== "string") return fileProblem('recolor needs --map "#ff0000=#3b82f6" (several pairs separated by commas). Run gertie inspect to see the colours in the file.');
  const tol = args.flags.get("tolerance");
  const tolerance = typeof tol === "string" ? Number(tol) : 0;
  if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 255) return fileProblem("--tolerance must be a number from 0 to 255.");
  let map;
  try {
    map = parseColorMap(mapText);
  } catch (e) {
    return fileProblem(e instanceof Error ? e.message : String(e));
  }
  const out = recolorLottie(r.doc, map, tolerance);
  const lines = out.replaced.map((x) => `${x.from} -> ${x.to}: ${x.count} replaced`);
  const unmatched = out.replaced.filter((x) => x.count === 0);
  if (unmatched.length > 0) {
    const have = inspectLottie(r.doc).colors.slice(0, 10).map((c) => c.hex).join(", ");
    lines.push(`note: no match for ${unmatched.map((u) => u.from).join(", ")}. The file's most used colours are: ${have}. Use --tolerance to match near colours.`);
  }
  return finishEdit(args, r, out.doc, "recolored", lines, { replaced: out.replaced });
}

export async function retimeCommand(args: Args): Promise<Outcome> {
  const r = readLottieFile(args.positional[0], "retime");
  if (isOutcome(r)) return r;
  const speed = args.flags.get("speed");
  const duration = args.flags.get("duration");
  if ((speed === undefined) === (duration === undefined)) return fileProblem("retime needs one of --speed <factor> (2 is twice as fast) or --duration <seconds>.");
  const raw = speed ?? duration;
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n <= 0) return fileProblem(`--${speed !== undefined ? "speed" : "duration"} needs a number above 0.`);
  let res;
  try {
    res = retimeLottie(r.doc, speed !== undefined ? { speed: n } : { duration: n });
  } catch (e) {
    return fileProblem(e instanceof Error ? e.message : String(e));
  }
  const info = inspectLottie(r.doc);
  const lines = [`${res.fromSeconds.toFixed(2)} s -> ${res.toSeconds.toFixed(2)} s at ${info.frameRate} fps (frames ${info.frames.in} to ${info.frames.out} -> ${res.doc["ip"]} to ${res.doc["op"]})`];
  if (info.features.expressions > 0) lines.push(`note: ${info.features.expressions} expressions compute from time and are not changed by retiming`);
  return finishEdit(args, r, res.doc, "retimed", lines, { factor: res.factor, seconds: { from: res.fromSeconds, to: res.toSeconds } });
}

export async function renderCommand(args: Args): Promise<Outcome> {
  const r = readLottieFile(args.positional[0], "render");
  if (isOutcome(r)) return r;
  const timesFlag = args.flags.get("times");
  if (typeof timesFlag === "string") {
    const times = timesFlag.split(",").map((t) => Number(t.trim()));
    if (times.length === 0 || times.some((t) => !Number.isFinite(t) || t < 0)) return fileProblem("--times needs seconds separated by commas, such as --times 0.6,1.1,1.8");
    const base = basename(r.path).replace(/\.json$/i, "");
    const outFlag0 = args.flags.get("out");
    const dir = typeof outFlag0 === "string" ? resolve(outFlag0) : dirname(r.path);
    let rr;
    try {
      rr = await openLottie(r.doc as { w: number; h: number });
    } catch (e) {
      return { code: EXIT_USAGE, message: `Rendering is not available: ${e instanceof Error ? e.message : String(e)}\n  fix: run 'gertie doctor'` };
    }
    try {
      const ip = typeof r.doc["ip"] === "number" ? r.doc["ip"] : 0;
      const fr = typeof r.doc["fr"] === "number" ? r.doc["fr"] : 30;
      const files: string[] = [];
      mkdirSync(dir, { recursive: true });
      for (const t of times) {
        const out = join(dir, `${base}.t${t.toFixed(2)}s.png`);
        writeFileSync(out, await rr.renderFrame(ip + t * fr));
        files.push(out);
      }
      return { code: EXIT_OK, report: report([]), full: { ok: true, errors: 0, warnings: 0, diagnostics: [], outputs: { frames: files }, times }, outputs: files };
    } finally {
      await rr.close();
    }
  }
  const nFlag = args.flags.get("sheet-frames");
  const count = typeof nFlag === "string" && Number(nFlag) >= 1 ? Math.min(32, Math.floor(Number(nFlag))) : 8;
  const outFlag = args.flags.get("out");
  const outPath = typeof outFlag === "string" ? resolve(outFlag) : join(dirname(r.path), `${basename(r.path).replace(/\.json$/i, "")}.sheet.png`);
  let renderer;
  try {
    renderer = await openLottie(r.doc as { w: number; h: number });
  } catch (e) {
    return { code: EXIT_USAGE, message: `Rendering is not available: ${e instanceof Error ? e.message : String(e)}\n  fix: run 'gertie doctor'` };
  }
  try {
    const ip = typeof r.doc["ip"] === "number" ? r.doc["ip"] : 0;
    const op = typeof r.doc["op"] === "number" ? r.doc["op"] : 0;
    const fr = typeof r.doc["fr"] === "number" ? r.doc["fr"] : 30;
    const frames: Buffer[] = [];
    const labels: string[] = [];
    for (let i = 0; i < count; i++) {
      const f = ip + ((op - ip) * (i + 0.5)) / count;
      frames.push(await renderer.renderFrame(f));
      labels.push(`f${Math.round(f)}  ${(f / fr).toFixed(2)}s`);
    }
    const sheet = await renderer.sheet(frames, labels, Math.min(4, count), 256);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, sheet);
    const msgs = (await renderer.consoleMessages()).map((m) => `${m.level}: ${m.text}`.slice(0, 160));
    const diagnostics = msgs.slice(0, 5).map((m) => makeDiagnostic("W-R-CONSOLE", `lottie-web wrote to the console: ${m}`, "The player may not handle this file."));
    const rep = report(diagnostics);
    return { code: EXIT_OK, report: rep, full: { ...rep, outputs: { sheet: outPath }, frames: count }, outputs: [outPath] };
  } finally {
    await renderer.close();
  }
}

// ---------------------------------------------------------------- Motion reference

function describeMove(m: Move): string {
  const pct = Math.round(Math.abs(m.change) * 100);
  const what: Record<string, string> = {
    x: m.change > 0 ? `moves right by ${pct}% of the frame width` : `moves left by ${pct}% of the frame width`,
    y: m.change > 0 ? `moves down by ${pct}% of the frame height` : `moves up by ${pct}% of the frame height`,
    width: m.change > 0 ? `gets wider by ${pct}% of the frame width` : `gets narrower by ${pct}% of the frame width`,
    height: m.change > 0 ? `gets taller by ${pct}% of the frame height` : `gets shorter by ${pct}% of the frame height`,
  };
  return `${m.from.toFixed(2)} s to ${m.to.toFixed(2)} s (${m.duration.toFixed(2)} s): ${what[m.channel]}, ${m.ease}`;
}

export function sampleCommand(args: Args): Outcome {
  const usage = "sample needs an image or clip and at least one point: gertie sample <image-or-clip> --at x,y [--at x,y ...] [--time seconds] [--json]";
  const file = args.positional[0];
  if (!file) return fileProblem(usage);
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  const given = args.all?.get("at") ?? [];
  if (given.length === 0) return fileProblem(usage);
  const points: Point[] = [];
  for (const g of given) {
    const p = parsePoint(g);
    if (!p) return fileProblem(`--at ${g} is not a point. Write two whole numbers of pixels from the top-left corner, such as --at 120,80.`);
    points.push(p);
  }
  const timeFlag = args.flags.get("time");
  const time = numFlag(args, "time", 0, 0, 36000);
  if (typeof time === "string" || timeFlag === true) return fileProblem(typeof time === "string" ? time : "--time needs a number of seconds, such as --time 1.5.");
  const have = (cmd: string): boolean => spawnSync(cmd, ["-version"], { encoding: "utf8" }).status === 0;
  if (!have("ffmpeg") || !have("ffprobe")) return { code: EXIT_USAGE, message: "sample needs ffmpeg and ffprobe, and they were not found.\n  fix: install ffmpeg (for example 'brew install ffmpeg' or 'apt install ffmpeg'), then run 'gertie doctor'" };
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", path], { encoding: "utf8" });
  let size: { width?: number; height?: number } | undefined;
  try {
    size = (JSON.parse(probe.stdout) as { streams?: { width?: number; height?: number }[] }).streams?.[0];
  } catch {
    size = undefined;
  }
  if (probe.status !== 0 || !size?.width || !size.height) return fileProblem(`${file} could not be read as an image or video: ${probe.stderr.trim().split("\n")[0] ?? "no video stream"}`);
  const { width: w, height: h } = size;
  const outside = points.find((p) => p.x >= w || p.y >= h);
  if (outside) return fileProblem(`--at ${outside.x},${outside.y} is outside the ${w} x ${h} frame.\n  fix: x runs from 0 to ${w - 1} and y from 0 to ${h - 1}. Run 'gertie grid' on the image to read coordinates.`);
  const ex = spawnSync("ffmpeg", ["-v", "error", ...(time > 0 ? ["-ss", String(time)] : []), "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: w * h * 4 + 1024, stdio: ["ignore", "pipe", "pipe"] });
  if (ex.status !== 0 || ex.stdout.length !== w * h * 4) return fileProblem(`No frame could be taken from ${file}${time > 0 ? ` at ${time} seconds (is the clip that long?)` : ""}: ${String(ex.stderr).trim().split("\n")[0] ?? "no output"}`);
  const colours = sampleColours(ex.stdout, w, h, points);
  return {
    code: EXIT_OK,
    full: { ok: true, errors: 0, warnings: 0, diagnostics: [], file: path, time, size: { w, h }, samples: colours },
    lines: [`${basename(path)}: ${w} x ${h}, frame at ${time} s, mean of a 3 x 3 block at each point`, ...colours.map((c) => `${c.x},${c.y}  ${c.hex}${c.alpha !== undefined ? `  (opacity ${c.alpha})` : ""}`)],
  };
}

export async function studyCommand(args: Args): Promise<Outcome> {
  const file = args.positional[0];
  if (!file) return fileProblem("study needs a video or animated image: gertie study <clip.mp4|clip.gif|clip.webm> [--crop x,y,w,h] [--rate source] [--fps 8] [--cols 8] [--cell 192] [--out sheet.png] [--json]");
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  const sheetFps = numFlag(args, "fps", 8, 1, 30);
  const cols = numFlag(args, "cols", 8, 1, 16);
  const cell = numFlag(args, "cell", 192, 64, 512);
  const maxSeconds = numFlag(args, "max-seconds", 20, 1, 120);
  for (const v of [sheetFps, cols, cell, maxSeconds]) if (typeof v === "string") return fileProblem(v);
  const sfps = sheetFps as number;
  const rateFlag = args.flags.get("rate");
  if (rateFlag !== undefined && rateFlag !== "source") return fileProblem("--rate must be 'source' (analyse at the clip's own frame rate, up to 60). Leave it out for the default rate.");
  const cropFlag = args.flags.get("crop");
  let cropBox: { x: number; y: number; w: number; h: number } | undefined;
  if (cropFlag !== undefined) {
    const parts = typeof cropFlag === "string" ? cropFlag.split(",").map((s) => (s.trim() === "" ? NaN : Number(s))) : [];
    if (parts.length !== 4 || !parts.every((n) => Number.isInteger(n))) return fileProblem("--crop needs four whole numbers in source pixels: --crop x,y,w,h (for example --crop 120,80,200,200).");
    cropBox = { x: parts[0] as number, y: parts[1] as number, w: parts[2] as number, h: parts[3] as number };
  }
  const have = (cmd: string): boolean => spawnSync(cmd, ["-version"], { encoding: "utf8" }).status === 0;
  if (!have("ffmpeg") || !have("ffprobe")) return { code: EXIT_USAGE, message: "study needs ffmpeg and ffprobe, and they were not found.\n  fix: install ffmpeg (for example 'brew install ffmpeg' or 'apt install ffmpeg'), then run 'gertie doctor'" };

  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate,avg_frame_rate,duration:format=duration", "-of", "json", path], { encoding: "utf8" });
  let info: { streams?: { width?: number; height?: number; r_frame_rate?: string; avg_frame_rate?: string; duration?: string }[]; format?: { duration?: string } };
  try {
    info = JSON.parse(probe.stdout) as typeof info;
  } catch {
    info = {};
  }
  const st = info.streams?.[0];
  if (probe.status !== 0 || !st || !st.width || !st.height) return fileProblem(`${file} could not be read as a video or animated image: ${probe.stderr.trim().split("\n")[0] ?? "no video stream"}`);
  const rate = (txt: string | undefined): number => {
    const [a, b] = (txt ?? "").split("/").map(Number);
    return a && b ? a / b : a || 0;
  };
  if (cropBox && (cropBox.x < 0 || cropBox.y < 0 || cropBox.w < 8 || cropBox.h < 8 || cropBox.x + cropBox.w > st.width || cropBox.y + cropBox.h > st.height)) {
    return fileProblem(`--crop ${cropBox.x},${cropBox.y},${cropBox.w},${cropBox.h} is outside the ${st.width} x ${st.height} frame, or smaller than 8 pixels.\n  fix: give x and y of 0 or more and a width and height of at least 8, with x + w up to ${st.width} and y + h up to ${st.height}. Run 'gertie grid' on a frame to read the pixel coordinates.`);
  }
  const srcFps = rate(st.avg_frame_rate) || rate(st.r_frame_rate) || 25;
  const seconds = Math.min(Number(st.duration ?? info.format?.duration ?? 0) || (maxSeconds as number), maxSeconds as number);
  // The default analysis rate is the source rate rounded and capped at 30, and never below the sheet rate. `--rate source` caps at 60 and ignores the sheet rate.
  const afps = rateFlag === "source" ? Math.max(1, Math.min(60, Math.round(srcFps))) : Math.max(sfps, Math.min(30, Math.round(srcFps)));
  const width = Math.min(256, cropBox ? cropBox.w : st.width);

  const tmp = mkdtempSync(join(tmpdir(), "gertie-study-"));
  try {
    const ex = spawnSync("ffmpeg", ["-v", "error", "-t", String(seconds), "-i", path, "-vf", `${cropBox ? `crop=${cropBox.w}:${cropBox.h}:${cropBox.x}:${cropBox.y},` : ""}fps=${afps},scale=${width}:-2:flags=area`, join(tmp, "f-%05d.png")], { encoding: "utf8" });
    const names = readdirSync(tmp).filter((n) => n.endsWith(".png")).sort();
    if (ex.status !== 0 || names.length < 3) return fileProblem(`No frames could be taken from ${file}: ${ex.stderr.trim().split("\n")[0] ?? "too few frames"}`);
    const pngs = names.map((n) => readFileSync(join(tmp, n)));
    const { browser } = await launchBrowser().catch((e: unknown) => {
      throw new Error(e instanceof Error ? e.message : String(e));
    });
    try {
      const rasters = await decodeImages(pngs, { browser });
      const bgMode = args.flags.get("background");
      if (bgMode !== undefined && bgMode !== "median" && bgMode !== "border") return fileProblem("--background must be median (everything that stays put is background, the default) or border (the colour around the edge of the frame).");
      const bg = bgMode === "border" ? estimateBackground(rasters[0] as (typeof rasters)[number]) : medianBackground(rasters);
      const stats: FrameStat[] = [];
      rasters.forEach((r, i) => {
        const s = frameStat(r, bg, i / afps);
        if (s) stats.push(s);
      });
      const study = analyzeMotion(stats);
      // First against last frame: a clip that loops ends where it began.
      const a = rasters[0] as (typeof rasters)[number];
      const b = rasters[rasters.length - 1] as (typeof rasters)[number];
      let diff = 0;
      for (let i = 0; i < a.w * a.h; i++) {
        const d = Math.abs((a.data[i * 4] as number) - (b.data[i * 4] as number)) + Math.abs((a.data[i * 4 + 1] as number) - (b.data[i * 4 + 1] as number)) + Math.abs((a.data[i * 4 + 2] as number) - (b.data[i * 4 + 2] as number)) + Math.abs((a.data[i * 4 + 3] as number) - (b.data[i * 4 + 3] as number));
        if (d > 48) diff++;
      }
      const loopGap = diff / (a.w * a.h);

      // The contact sheet: frames at the sheet rate, labelled with their time.
      const pick: number[] = [];
      const step = Math.max(1, afps / sfps);
      for (let t = 0; Math.round(t) < pngs.length && pick.length < 64; t += step) pick.push(Math.round(t));
      const r = await openRenderer({ w: cell as number, h: cell as number }, async () => ({ totalFrames: 1, frameRate: 1 }), { browser });
      let sheet: Buffer;
      try {
        sheet = await r.sheet(pick.map((i) => pngs[i] as Buffer), pick.map((i) => `${(i / afps).toFixed(2)}s`), Math.min(cols as number, pick.length), cell as number);
      } finally {
        await r.close();
      }
      const outFlag = args.flags.get("out");
      const stemOf = basename(path).replace(/\.[a-z0-9]+$/i, "");
      // --out may be a file or an existing folder; the default is next to the clip.
      const outPath = typeof outFlag === "string" ? (existsSync(resolve(outFlag)) && statSync(resolve(outFlag)).isDirectory() ? join(resolve(outFlag), `${stemOf}.study.png`) : resolve(outFlag)) : join(dirname(path), `${stemOf}.study.png`);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, sheet);

      const lines = [
        `${basename(path)}: ${st.width} x ${st.height}, ${srcFps.toFixed(1)} fps, ${seconds.toFixed(2)} s; analysed ${rasters.length} frames at ${afps} fps; ${loopGap < 0.01 ? "the clip loops (first and last frames match)" : `first and last frames differ (${(loopGap * 100).toFixed(1)}% of pixels), so it does not loop exactly`}`,
        `background: ${bg.kind === "median" ? "what stays put over the whole clip" : bg.kind === "transparent" ? "transparent" : `#${bg.rgb.map((v) => v.toString(16).padStart(2, "0")).join("")}`}; the moving subject is everything that differs from it${stats.length < rasters.length ? ` (found in ${stats.length} of ${rasters.length} frames)` : ""}`,
        ...(study.holds.length > 0 ? [`holds (nothing moves): ${study.holds.map((h) => `${h.from.toFixed(2)} s to ${h.to.toFixed(2)} s`).join("; ")}`] : []),
        ...study.moves.map((m) => `${m.channel}: ${describeMove(m)}`),
        ...study.idle.map((i) => `idle ${i.channel}: swings by ${(i.amplitude * 100).toFixed(2)}% of the ${cropBox ? "crop" : "frame"} either side of its middle, one cycle every ${i.period.toFixed(2)} s, from ${i.start.toFixed(2)} s to ${i.end.toFixed(2)} s. Use a looping preset with this period`),
        ...(study.moves.length === 0 ? ["no clear movement of the subject was measured. If the whole picture changes (a camera move, a scrolling background) these measurements do not apply; read the contact sheet instead"] : []),
        "note: positions are fractions of the frame, measured on the silhouette of everything that is not background. This describes timing and distance, not shapes. Check it against the contact sheet.",
      ];
      const full = {
        ok: true,
        file: path,
        source: { width: st.width, height: st.height, fps: Math.round(srcFps * 100) / 100, seconds: Math.round(seconds * 1000) / 1000 },
        analysis: { fps: afps, rate: rateFlag === "source" ? "source" : "default", ...(cropBox ? { crop: cropBox } : {}), frames: rasters.length, background: bg.kind === "median" ? { kind: "median" } : bg, subjectFrames: stats.length },
        loopGap: Math.round(loopGap * 10000) / 10000,
        holds: study.holds,
        moves: study.moves,
        /** Steady small swings outside the moves: { channel, start, end, amplitude, period }, amplitude as a fraction of the frame or of the crop, seconds. */
        idle: study.idle,
        /** [seconds, centre x, centre y, width, height] as fractions of the frame, one row per analysed frame. */
        samples: study.samples.map((s) => [Math.round(s.t * 1000) / 1000, Math.round(s.cx * 1000) / 1000, Math.round(s.cy * 1000) / 1000, Math.round(s.w * 1000) / 1000, Math.round(s.h * 1000) / 1000]),
        outputs: { sheet: outPath },
      };
      return { code: EXIT_OK, full, lines, outputs: [outPath] };
    } finally {
      await browser.close();
    }
  } catch (e) {
    return { code: EXIT_USAGE, message: `Study failed: ${e instanceof Error ? e.message : String(e)}\n  fix: run 'gertie doctor' to check that rendering is available` };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------- Cutout

export async function cutoutCommand(args: Args): Promise<Outcome> {
  const [imageFile, partsFile] = args.positional;
  if (!imageFile || !partsFile) return fileProblem("cutout needs an image and a parts file: gertie cutout <painting.png> <parts.json> [--out folder] [--json]");
  const imagePath = resolve(imageFile);
  const partsPath = resolve(partsFile);
  for (const [p, f] of [[imagePath, imageFile], [partsPath, partsFile]] as const) if (!existsSync(p)) return fileProblem(`File not found: ${f}`);
  let specRaw: unknown;
  try {
    specRaw = JSON.parse(readFileSync(partsPath, "utf8"));
  } catch (e) {
    return fileProblem(`${partsFile} is not valid JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  let img;
  try {
    img = await decodeImage(readFileSync(imagePath));
  } catch (e) {
    return { code: EXIT_USAGE, message: `Could not read the image: ${e instanceof Error ? e.message : String(e)}\n  fix: use a PNG, JPEG or WebP file, and run 'gertie doctor' to check that rendering is available` };
  }
  const problems = validateSpec(specRaw, img.w, img.h);
  if (problems.length > 0) return { code: EXIT_FAIL, report: report(problems.map((m) => makeDiagnostic("E-CUTOUT", m, "Fix the parts file. Points are in image pixels, parts go from back to front, ids are lowercase letters, digits and hyphens."))) };
  const stem = basename(imagePath).replace(/\.[a-z0-9]+$/i, "");
  const outFlag = args.flags.get("out");
  const outDir = typeof outFlag === "string" ? resolve(outFlag) : join(dirname(imagePath), `${stem}.cutout`);
  const res = buildCutout(img, specRaw as CutoutSpec, basename(imagePath));
  for (const f of res.files) {
    const target = join(outDir, f.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.png);
  }
  const fragPath = join(outDir, "fragment.json");
  writeFileSync(fragPath, JSON.stringify(res.fragment, null, 1) + "\n");
  // The outlines drawn on the picture, so the author can see what was cut.
  const original = await imageToPng(imagePath);
  const outlinesPath = join(outDir, "outlines.png");
  try {
    const r = await openSvg(outlinesSvg(img.w, img.h, `data:image/png;base64,${original.toString("base64")}`, specRaw as CutoutSpec), { w: img.w, h: img.h, fps: 30 });
    try {
      writeFileSync(outlinesPath, await r.renderFrame(0));
    } finally {
      await r.close();
    }
  } catch {
    /* the outlines are a convenience; the rest check below reports a rendering problem */
  }

  // Put the layers back together at rest and compare with the picture, so a bad outline shows up as a number.
  const images: Record<string, string> = {};
  for (const f of res.files) images[f.path] = `data:image/png;base64,${f.png.toString("base64")}`;
  const wrapper = compileSceneValue({ gertie: 1, name: "cutout", canvas: res.fragment.canvas, duration: 1, loop: false, nodes: res.fragment.nodes }, { images });
  const diagnostics: Diagnostic[] = wrapper.diagnostics.filter((d) => d.code !== "W-STATIC");
  let restDifference: number | undefined;
  const lines = [`${res.fragment.nodes.length} layers written to ${outDir}`, ...res.notes.map((n) => `note: ${n}`)];
  if (wrapper.lottie && !hasErrors(wrapper.diagnostics)) {
    try {
      const r = await openLottie(wrapper.lottie as { w: number; h: number });
      try {
        // Lids are drawn flat at rest, so the layers are expected to match the picture closely.
        const png = await r.renderFrame(0);
        const d = await r.analyze([original, png], [[0, 1]], [0, 0, 0, 0], 16, true);
        restDifference = (d.diffs[0] as { fraction: number }).fraction;
        writeFileSync(join(outDir, "rest.png"), png);
        lines.push(`at rest the layers differ from the picture in ${(restDifference * 100).toFixed(2)}% of pixels (rest.png). ${restDifference > 0.02 ? "That is a lot: check the outlines, or raise 'grow'." : "Good."}`);
        if (restDifference > 0.02) diagnostics.push(makeDiagnostic("W-CUTOUT-REST", `The layers put back together differ from the picture in ${(restDifference * 100).toFixed(1)}% of pixels.`, "Check that the polygons follow the parts, and that parts are listed from back to front."));
      } finally {
        await r.close();
      }
    } catch (e) {
      lines.push(`rest check skipped: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const rep = report(diagnostics, args.flags.has("strict"));
  if (existsSync(outlinesPath)) lines.push(`outlines drawn on the picture: ${outlinesPath}`);
  const full = { ...rep, outputs: { fragment: fragPath, folder: outDir, ...(existsSync(outlinesPath) ? { outlines: outlinesPath } : {}) }, layers: res.fragment.nodes.map((n) => ({ id: n["id"], type: n["type"], ...(typeof n["w"] === "number" ? { size: [n["w"], n["h"]] } : {}), x: n["x"], y: n["y"], ...(n["pivot"] ? { pivot: n["pivot"] } : {}) })), ...(restDifference === undefined ? {} : { restDifference }) };
  return { code: rep.ok ? EXIT_OK : EXIT_FAIL, report: rep, full, outputs: [fragPath], lines };
}

/** The original file as PNG bytes, for comparing with a render. A PNG is used as it is. */
async function imageToPng(path: string): Promise<Buffer> {
  const bytes = readFileSync(path);
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return bytes;
  const ras = await decodeImage(bytes);
  const { encodePng } = await import("../../cutout/png.ts");
  return encodePng(ras);
}

export async function gridCommand(args: Args): Promise<Outcome> {
  const file = args.positional[0];
  if (!file) return fileProblem("grid needs an image: gertie grid <image> [--step 50] [--out grid.png]");
  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  const step = numFlag(args, "step", 50, 10, 500);
  if (typeof step === "string") return fileProblem(step);
  let img;
  try {
    img = await decodeImage(readFileSync(path));
  } catch (e) {
    return { code: EXIT_USAGE, message: `Could not read the image: ${e instanceof Error ? e.message : String(e)}` };
  }
  const png = await imageToPng(path);
  const outFlag = args.flags.get("out");
  const outPath = typeof outFlag === "string" ? resolve(outFlag) : join(dirname(path), `${basename(path).replace(/\.[a-z0-9]+$/i, "")}.grid.png`);
  const r = await openSvg(gridSvg(img.w, img.h, `data:image/png;base64,${png.toString("base64")}`, step), { w: img.w, h: img.h, fps: 30 });
  try {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, await r.renderFrame(0));
  } finally {
    await r.close();
  }
  return { code: EXIT_OK, report: report([]), full: { ok: true, errors: 0, warnings: 0, diagnostics: [], size: { w: img.w, h: img.h }, step, outputs: { grid: outPath } }, outputs: [outPath], lines: [`${img.w} x ${img.h} pixels, grid every ${step} pixels. Coordinates are x across and y down from the top-left corner.`] };
}
