import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { HYPERFRAMES_INSTALL, hyperframesCommand, hyperframesVersion } from "../../story/tools.ts";
import { basename, dirname, extname, join, resolve } from "node:path";
import { ExportUnavailableError } from "../../export/ffmpeg.ts";
import { RenderUnavailableError } from "../../render/browser.ts";
import { hasErrors, makeDiagnostic, report, type Diagnostic } from "../../spec/diagnostics.ts";
import { parseScene } from "../../spec/parse.ts";
import { assetsDir } from "../../render/browser.ts";
import { assetName, buildHyperframesProject, type SceneForProject } from "../../story/hyperframes.ts";
import { lintStory, type SceneFacts } from "../../story/lint.ts";
import { planStory } from "../../story/plan.ts";
import { sequenceStory, storyboardSheet, type SceneAsset } from "../../story/sequence.ts";
import type { Args } from "./args.ts";
import { EXIT_FAIL, EXIT_OK, EXIT_USAGE, fileProblem, qaCommand, runCompile, type CompileRun, type Outcome } from "./commands.ts";

const ENGINES = ["builtin", "hyperframes"] as const;

interface LoadedScene {
  src: string;
  path: string;
  run: CompileRun;
}

/** Compiles every scene file the storyboard names, once each. */
function loadScenes(raw: unknown, baseDir: string): Map<string, LoadedScene> {
  const out = new Map<string, LoadedScene>();
  const scenes = (raw as { scenes?: unknown } | null)?.scenes;
  if (!Array.isArray(scenes)) return out;
  for (const s of scenes) {
    const src = (s as { src?: unknown } | null)?.src;
    if (typeof src !== "string" || out.has(src)) continue;
    const path = resolve(baseDir, src);
    if (!existsSync(path)) continue;
    out.set(src, { src, path, run: runCompile({ command: "compile", positional: [path], flags: new Map() }, false) });
  }
  return out;
}

function factsOf(l: LoadedScene | undefined): SceneFacts | undefined {
  const scene = l?.run.result?.scene;
  if (!scene) return undefined;
  return { w: scene.w, h: scene.h, seconds: scene.totalFrames / scene.fps, loop: scene.loop };
}

function outPaths(args: Args, storyPath: string, name: string, engine: (typeof ENGINES)[number]): { out: string; dir: string; scenesDir: string } {
  const flag = args.flags.get("out");
  const base = dirname(storyPath);
  if (engine === "hyperframes") {
    const dir = typeof flag === "string" ? resolve(flag) : join(base, "out", `${name}-hyperframes`);
    return { out: dir, dir, scenesDir: join(dir, ".qa") };
  }
  if (typeof flag === "string") {
    const p = resolve(flag);
    return extname(p) === "" ? { out: join(p, `${name}.mp4`), dir: p, scenesDir: join(p, `${name}.scenes`) } : { out: p, dir: dirname(p), scenesDir: join(dirname(p), `${basename(p, extname(p))}.scenes`) };
  }
  const dir = join(base, "out");
  return { out: join(dir, `${name}.mp4`), dir, scenesDir: join(dir, `${name}.scenes`) };
}

export async function storyCommand(args: Args): Promise<Outcome> {
  const file = args.positional[0];
  if (!file) return fileProblem("story needs a storyboard file: gertie story <video.story.json> [--out video.mp4]");
  const engineFlag = args.flags.get("engine");
  const engine = engineFlag === undefined ? "builtin" : typeof engineFlag === "string" && (ENGINES as readonly string[]).includes(engineFlag) ? (engineFlag as (typeof ENGINES)[number]) : undefined;
  if (!engine) return fileProblem(`Unknown engine '${String(engineFlag)}'. Engines: ${ENGINES.join(", ")}.`);
  if (args.flags.has("render") && engine !== "hyperframes") return fileProblem("--render goes with --engine hyperframes. The built-in sequencer always renders.");

  const path = resolve(file);
  if (!existsSync(path)) return fileProblem(`File not found: ${file}`);
  const baseDir = dirname(path);
  const parsed = parseScene(readFileSync(path, "utf8"));
  if (!parsed.ok) return { code: EXIT_FAIL, report: report([parsed.diagnostic]) };

  // Compile every scene first: the linter needs their sizes and lengths.
  const loaded = loadScenes(parsed.value, baseDir);
  const lint = lintStory(parsed.value, { fileExists: (src) => existsSync(resolve(baseDir, src)), sceneFacts: (src) => factsOf(loaded.get(src)) });
  const diagnostics: Diagnostic[] = [...lint.diagnostics];
  for (const l of loaded.values()) {
    const sceneErrors = l.run.result?.diagnostics.filter((d) => d.severity === "error") ?? [];
    const failed = l.run.outcome.code !== EXIT_OK || !l.run.result?.lottie;
    if (failed) {
      const first = sceneErrors[0];
      diagnostics.push(makeDiagnostic("E-STORY-SCENE", `Scene file '${l.src}' does not compile (${sceneErrors.length} error${sceneErrors.length === 1 ? "" : "s"})${first ? `: ${first.code}${first.node ? ` at node ${first.node}` : ""}: ${first.message}` : ""}.`, `Run: node scripts/gertie.mjs qa ${l.src}  and fix the errors it lists.`, { path: l.src }));
    }
  }
  const rep = report(diagnostics, args.flags.has("strict"));
  const story = lint.story;
  if (!story || hasErrors(diagnostics) || !rep.ok) return { code: EXIT_FAIL, report: rep };
  const plan = planStory(story);
  const paths = outPaths(args, path, story.name, engine);
  const summary = `${story.scenes.length} scene${story.scenes.length === 1 ? "" : "s"}, ${Math.round((plan.totalFrames / story.fps) * 100) / 100}s, ${story.canvas.w}x${story.canvas.h} at ${story.fps} fps`;
  if (args.flags.has("lint-only")) return { code: EXIT_OK, report: rep, lines: [`storyboard ok: ${summary}`] };

  // Every scene must pass qa before it goes into a video.
  const qaLines: string[] = [];
  if (!args.flags.has("no-qa")) {
    for (const s of story.scenes) {
      const scenePath = resolve(baseDir, s.src);
      const q = await qaCommand({ command: "qa", positional: [scenePath], flags: new Map<string, string | true>([["out", join(paths.scenesDir, s.id)], ...(args.flags.has("strict") ? ([["strict", true]] as [string, true][]) : [])]) });
      if (q.code !== EXIT_OK) {
        const qa = (q.report?.diagnostics ?? []).filter((d) => d.severity === "error").slice(0, 3);
        const detail = qa.map((d) => `${d.code}${d.node ? ` (node ${d.node})` : ""}: ${d.message}`).join(" | ") || q.message || "see the qa report";
        return { code: EXIT_FAIL, report: report([...diagnostics, makeDiagnostic("E-STORY-QA", `Scene '${s.id}' failed qa, so the video was not built: ${detail}`, `Run: node scripts/gertie.mjs qa ${s.src}  and fix the scene. Use --no-qa to build anyway.`, { node: s.id })]) };
      }
      for (const l of q.lines ?? []) if (l.startsWith("render checks skipped")) qaLines.push(`scene '${s.id}': ${l}`);
    }
  }

  const sceneOf = (id: string): LoadedScene => loaded.get((story.scenes.find((s) => s.id === id) as { src: string }).src) as LoadedScene;
  const json = args.flags.has("json");
  const lines: string[] = [...qaLines];

  if (engine === "hyperframes") {
    const scenes = new Map<string, SceneForProject>();
    for (const s of story.scenes) {
      const r = sceneOf(s.id).run.result;
      if (!r?.scene || !r.lottie) return fileProblem(`Scene '${s.id}' did not compile.`);
      scenes.set(s.id, { id: s.id, lottieJson: JSON.stringify(r.lottie), w: r.scene.w, h: r.scene.h, fps: r.scene.fps, totalFrames: r.scene.totalFrames, loop: r.scene.loop });
    }
    const font = story.captions.font ? resolve(baseDir, story.captions.font) : undefined;
    const audio = story.audio ? resolve(baseDir, story.audio.src) : undefined;
    const files = buildHyperframesProject({
      story,
      plan,
      scenes,
      lottieLib: readFileSync(join(assetsDir(), "lottie.min.js"), "utf8"),
      ...(font ? { font: { name: assetName(font), data: readFileSync(font) } } : {}),
      ...(audio ? { audio: { name: assetName(audio), data: readFileSync(audio) } } : {}),
    });
    const written: string[] = [];
    for (const f of files) {
      const target = join(paths.dir, f.path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, f.data);
      written.push(target);
    }
    lines.push(`HyperFrames project: ${summary}`, `  open ${join(paths.dir, "index.html")}; render with: cd ${paths.dir} && hyperframes render --output video.mp4`);
    lines.push("note: the project renders with HyperFrames unmodified and `hyperframes lint` passes; edit the HTML freely, it is yours.");
    if (args.flags.has("render")) {
      const v = hyperframesVersion();
      if (!v) return { code: EXIT_USAGE, report: rep, lines: [...lines, HYPERFRAMES_INSTALL], outputs: written, full: { ok: false, engine, summary, project: paths.dir, outputs: written, diagnostics: rep.diagnostics, error: HYPERFRAMES_INSTALL } };
      lines.push(`running hyperframes ${v}`);
      const videoOut = join(paths.dir, `${story.name}.mp4`);
      const r = spawnSync(hyperframesCommand(), ["render", "--output", videoOut], { cwd: paths.dir, stdio: json ? ["ignore", "ignore", "inherit"] : ["ignore", "inherit", "inherit"] });
      if (r.status !== 0) return { code: EXIT_FAIL, report: report([...diagnostics, makeDiagnostic("E-STORY-HYPERFRAMES", `hyperframes render exited with ${String(r.status)}.`, `Run it yourself to see the output: cd ${paths.dir} && hyperframes lint && hyperframes render`)]), lines, outputs: written };
      written.push(videoOut);
    } else if (!hyperframesVersion()) lines.push(HYPERFRAMES_INSTALL);
    return { code: EXIT_OK, report: rep, lines, outputs: written, full: { ok: true, engine, summary, project: paths.dir, outputs: written, diagnostics: rep.diagnostics } };
  }

  // Built-in sequencer
  const assets = new Map<string, SceneAsset>();
  for (const s of story.scenes) {
    const r = sceneOf(s.id).run.result;
    if (!r?.scene || !r.lottie) return fileProblem(`Scene '${s.id}' did not compile.`);
    assets.set(s.id, { lottie: r.lottie as SceneAsset["lottie"], w: r.scene.w, h: r.scene.h, fps: r.scene.fps, totalFrames: r.scene.totalFrames, loop: r.scene.loop });
  }
  let result;
  try {
    const keep = args.flags.get("keep-work");
    result = await sequenceStory({ story, plan, assets, baseDir, out: paths.out, ...(typeof keep === "string" ? { keepWork: resolve(keep) } : {}), ...(json ? {} : { progress: (l: string) => console.error(l) }) });
  } catch (e) {
    if (e instanceof ExportUnavailableError || e instanceof RenderUnavailableError) return { code: EXIT_USAGE, message: `${e.message}\n  fix: ${e.fix}` };
    return fileProblem(`Building the video failed: ${e instanceof Error ? e.message : String(e)}`);
  }
  const outputs = [result.out];
  let sheetPath: string | undefined;
  if (!args.flags.has("no-sheet")) {
    try {
      sheetPath = join(dirname(result.out), `${basename(result.out, extname(result.out))}.sheet.png`);
      writeFileSync(sheetPath, await storyboardSheet(result.out, plan, story.canvas));
      outputs.push(sheetPath);
    } catch (e) {
      sheetPath = undefined;
      lines.push(`note: no contact sheet: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  lines.push(`video ${result.out}  ${Math.round(result.bytes / 1024)} KB  ${result.probe.width}x${result.probe.height}  ${result.probe.frames} frames  ${Math.round(result.probe.duration * 100) / 100}s`);
  for (const n of result.notes) lines.push(`note: ${n}`);
  if (sheetPath) lines.push(`Look at the contact sheet before delivering: ${sheetPath}`);
  const full = { ok: true, engine, summary, video: { path: result.out, bytes: result.bytes, width: result.probe.width, height: result.probe.height, frames: result.probe.frames, seconds: result.probe.duration }, ...(sheetPath ? { sheet: sheetPath } : {}), notes: result.notes, diagnostics: rep.diagnostics };
  return { code: EXIT_OK, report: rep, full, lines, outputs };
}
