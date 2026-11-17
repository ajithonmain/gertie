import { makeDiagnostic, report, type Diagnostic, type Report } from "../spec/diagnostics.ts";
import type { NNode, NScene } from "../spec/types.ts";
import type { Json } from "../emit-lottie/index.ts";
import { openLottie, type FrameRenderer } from "../render/lottie.ts";
import { openSvg } from "../render/svg.ts";
import { launchBrowser, RenderUnavailableError, type PwBrowser } from "../render/browser.ts";
import { prefixFor } from "../emit-svg/format.ts";
import { checkBlank, checkClipped, checkConsole, checkEmptyFrames, checkFlicker, checkLoop, checkStatic, type SampledFrame } from "./checks.ts";
import { evenFrames, sampleFrames } from "./sampling.ts";

export interface QaOptions {
  thorough?: boolean;
  /** Frames on the contact sheet. Default 8. */
  sheetFrames?: number;
  browser?: PwBrowser;
  /** The compiled SVG. When given, its render is compared with the Lottie render (E-R-PARITY). */
  svg?: string;
}

/** Share of pixels that may differ between the Lottie and SVG renders of one frame. */
export const PARITY_LIMIT = 0.02;

export interface RenderOutcome {
  /** True when rendering ran. */
  rendered: boolean;
  diagnostics: Diagnostic[];
  sheet?: Buffer;
  /** Diff image of the worst frame when parity failed: differing pixels in red. */
  parityImage?: { frame: number; png: Buffer };
  /** Parity result, when the SVG was compared. */
  parity?: { frames: number; worst: number; worstFrame: number };
  framesRendered: number;
  /** Why rendering was skipped, with the fix. */
  skipped?: { reason: string; fix: string };
}

/** Every keyframe frame in the scene, so the extremes of motion are always sampled. */
export function keyFrames(scene: NScene): number[] {
  const frames = new Set<number>();
  const walk = (n: NNode): void => {
    for (const keys of Object.values(n.tracks)) for (const k of keys ?? []) frames.add(k.t);
    frames.add(n.from);
    if (n.type === "group") n.children.forEach(walk);
  };
  scene.nodes.forEach(walk);
  Object.values(scene.defs).forEach(walk);
  return [...frames].filter((f) => f >= 0 && f < scene.totalFrames);
}

/** The scene's "empty" colour: transparent, or the background. Alpha is 0 to 255. */
function emptyColour(scene: NScene): [number, number, number, number] {
  if (!scene.background) return [0, 0, 0, 0];
  const [r, g, b, a] = scene.background;
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a * 255)];
}

function pct(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 2 : 1)}%`;
}

/** The node whose shape rectangle overlaps the differing area the most. */
function nodeBehind(boxes: { cls: string; x: number; y: number; w: number; h: number }[], bbox: [number, number, number, number] | null, prefix: string): string | undefined {
  if (!bbox) return undefined;
  let best: string | undefined;
  let bestArea = 0;
  for (const b of boxes) {
    const w = Math.min(b.x + b.w, bbox[2] + 1) - Math.max(b.x, bbox[0]);
    const h = Math.min(b.y + b.h, bbox[3] + 1) - Math.max(b.y, bbox[1]);
    if (w > 0 && h > 0 && w * h > bestArea) {
      bestArea = w * h;
      const name = b.cls.replace(new RegExp(`^${prefix}-`), "").replace(/__sh.*$/, "");
      best = name.split("_")[0] as string;
    }
  }
  return best;
}

function label(frame: number, fps: number): string {
  return `f${Math.round(frame)}  ${(frame / fps).toFixed(2)}s`;
}

/** Gate 3: renders sampled frames and runs the render checks. */
export async function renderChecks(scene: NScene, lottie: { [key: string]: Json }, opts: QaOptions = {}): Promise<RenderOutcome> {
  let renderer: FrameRenderer;
  let svgRenderer: FrameRenderer | undefined;
  let launched: PwBrowser | undefined;
  try {
    const browser = opts.browser ?? (launched = (await launchBrowser()).browser);
    renderer = await openLottie(lottie as { w: number; h: number }, { browser });
    if (opts.svg !== undefined) {
      try {
        svgRenderer = await openSvg(opts.svg, { w: scene.w, h: scene.h, fps: scene.fps }, { browser });
      } catch (e) {
        await renderer.close();
        await launched?.close().catch(() => undefined);
        return { rendered: true, diagnostics: [makeDiagnostic("E-R-PLAYER", `The browser could not load the SVG output: ${e instanceof Error ? e.message : String(e)}`, "This is a Gertie bug in the SVG emitter. Report the scene.")], framesRendered: 0 };
      }
    }
  } catch (e) {
    await launched?.close().catch(() => undefined);
    if (e instanceof RenderUnavailableError) return { rendered: false, diagnostics: [], framesRendered: 0, skipped: { reason: e.message, fix: e.fix } };
    return { rendered: false, diagnostics: [makeDiagnostic("E-R-PLAYER", `lottie-web could not load the animation: ${e instanceof Error ? e.message : String(e)}`, "The player rejected the file. Simplify the scene to find the node that triggers it, and report it as a Gertie bug.")], framesRendered: 0 };
  }
  try {
    const frames = sampleFrames(scene.totalFrames, keyFrames(scene), { thorough: opts.thorough === true });
    const png = new Map<number, Buffer>();
    for (const f of frames) png.set(f, await renderer.renderFrame(f));
    // Lottie draws nothing at frame == op, so the frame that closes the loop is just before it.
    const loopFrame = scene.totalFrames - 0.001;
    const loopPng = await renderer.renderFrame(loopFrame);
    const ordered = frames.map((f) => png.get(f) as Buffer);
    const all = [...ordered, loopPng];
    const pairs: [number, number][] = [];
    for (let i = 0; i < frames.length - 1; i++) pairs.push([i, i + 1]);
    const loopPair = pairs.length;
    pairs.push([0, frames.length]);
    const skipPairs: [number, number][] = [];
    if (opts.thorough) for (let i = 0; i < frames.length - 2; i++) skipPairs.push([i, i + 2]);
    const base = pairs.length;
    const analysis = await renderer.analyze(all, [...pairs, ...skipPairs], emptyColour(scene));

    const sampled: SampledFrame[] = frames.map((frame, i) => {
      const s = analysis.frames[i];
      return { frame, content: s?.content ?? 0, edge: s?.edge ?? 0 };
    });
    const consecutive = analysis.diffs.slice(0, frames.length - 1).map((d) => d.fraction);
    const diagnostics: Diagnostic[] = [
      ...checkBlank(sampled),
      ...(sampled.some((f) => f.content > 0.001) ? checkStatic(consecutive) : []),
      ...checkLoop(scene.loop, analysis.diffs[loopPair]?.fraction),
      ...checkClipped(sampled, scene.background !== null),
      ...checkEmptyFrames(sampled),
    ];
    if (opts.thorough && frames.length >= 3) diagnostics.push(...checkFlicker(sampled, consecutive, analysis.diffs.slice(base).map((d) => d.fraction)));
    diagnostics.push(...checkConsole(await renderer.consoleMessages()));

    let parity: RenderOutcome["parity"];
    let parityImage: RenderOutcome["parityImage"];
    let svgCount = 0;
    if (svgRenderer) {
      const svgPng: Buffer[] = [];
      for (const f of frames) svgPng.push(await svgRenderer.renderFrame(f));
      svgCount = svgPng.length;
      const both = [...ordered, ...svgPng];
      const cmp = await renderer.analyze(both, ordered.map((_, i) => [i, ordered.length + i] as [number, number]), emptyColour(scene), 12, true);
      const fractions = cmp.diffs.map((d) => d.fraction);
      let worst = 0;
      fractions.forEach((x, i) => {
        if (x > (fractions[worst] as number)) worst = i;
      });
      const failing = frames.filter((_, i) => (fractions[i] as number) > PARITY_LIMIT);
      parity = { frames: frames.length, worst: fractions[worst] ?? 0, worstFrame: frames[worst] ?? 0 };
      if (failing.length > 0) {
        const wf = frames[worst] as number;
        await svgRenderer.renderFrame(wf);
        const culprit = nodeBehind(await svgRenderer.nodeBoxes(), cmp.diffs[worst]?.bbox ?? null, prefixFor(scene.name));
        parityImage = { frame: wf, png: await renderer.diffImage(ordered[worst] as Buffer, svgPng[worst] as Buffer) };
        diagnostics.push(
          makeDiagnostic(
            "E-R-PARITY",
            `The Lottie and SVG renders differ in ${pct((fractions[worst] as number))} of pixels at frame ${wf}${failing.length > 1 ? ` (${failing.length} of ${frames.length} sampled frames exceed ${pct(PARITY_LIMIT)})` : ""}.${culprit ? ` The differing area is mostly node '${culprit}'.` : ""}`,
            "One of the two emitters is wrong for this scene. Look at the parity diff image beside the contact sheet. Simplify the node named above (try removing its animation tracks one at a time) and report the scene as a Gertie bug.",
            culprit ? { node: culprit } : {},
          ),
        );
      }
    }

    const sheetFrames = evenFrames(scene.totalFrames, opts.sheetFrames ?? 8);
    const sheetPng: Buffer[] = [];
    for (const f of sheetFrames) sheetPng.push(png.get(f) ?? (await renderer.renderFrame(f)));
    const cols = sheetFrames.length <= 4 ? sheetFrames.length : sheetFrames.length <= 8 ? 4 : 4;
    const sheet = await renderer.sheet(sheetPng, sheetFrames.map((f) => label(f, scene.fps)), cols, 256);
    return { rendered: true, diagnostics, sheet, framesRendered: png.size + 1 + svgCount, ...(parity ? { parity } : {}), ...(parityImage ? { parityImage } : {}) };
  } finally {
    await svgRenderer?.close();
    await renderer.close();
    await launched?.close().catch(() => undefined);
  }
}

export interface QaReport extends Report {
  scene: string;
  duration: number;
  fps: number;
  frames: number;
  outputs: { lottie?: string; svg?: string; sheet?: string; parity?: string };
  sizes: { lottie?: number; svg?: number };
  /** Properties the SVG emitter had to bake, one keyframe per frame. */
  baked?: string[];
  parity?: { frames: number; worst: number; worstFrame: number };
  render: "ran" | "skipped";
  skipped?: { reason: string; fix: string };
  framesRendered: number;
}

export function buildQaReport(scene: NScene, diagnostics: Diagnostic[], extra: { outputs: QaReport["outputs"]; lottieBytes?: number; svgBytes?: number; baked?: string[]; rendered: RenderOutcome | undefined; strict: boolean }): QaReport {
  const base = report(diagnostics, extra.strict);
  const out: QaReport = {
    ...base,
    scene: scene.name,
    duration: scene.totalFrames / scene.fps,
    fps: scene.fps,
    frames: scene.totalFrames,
    outputs: extra.outputs,
    sizes: { ...(extra.lottieBytes === undefined ? {} : { lottie: extra.lottieBytes }), ...(extra.svgBytes === undefined ? {} : { svg: extra.svgBytes }) },
    render: extra.rendered?.rendered ? "ran" : "skipped",
    framesRendered: extra.rendered?.framesRendered ?? 0,
  };
  if (extra.rendered?.skipped) out.skipped = extra.rendered.skipped;
  if (extra.baked && extra.baked.length > 0) out.baked = extra.baked;
  if (extra.rendered?.parity) out.parity = extra.rendered.parity;
  return out;
}
