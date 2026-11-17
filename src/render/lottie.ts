import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { assetsDir, launchBrowser, type PwBrowser, type PwPage } from "./browser.ts";

export interface FrameStats {
  width: number;
  height: number;
  /** Fraction of pixels that differ from the empty scene. */
  content: number;
  /** Fraction of the canvas border covered by content. */
  edge: number;
}
export interface PairDiff {
  fraction: number;
  bbox: [number, number, number, number] | null;
}
export interface ConsoleMessage {
  level: string;
  text: string;
}

export interface PageApi {
  loadLottie(data: unknown): Promise<{ totalFrames: number; frameRate: number }>;
  loadSvg(text: string, fps: number): Promise<{ totalFrames: number; frameRate: number }>;
  seek(frame: number): void;
  analyzeFrames(b64s: string[], pairs: [number, number][], ref: number[], tol: number, premult?: boolean): Promise<{ frames: FrameStats[]; diffs: PairDiff[] }>;
  makeSheet(b64s: string[], labels: string[], cols: number, cellW: number): Promise<string>;
  makeDiff(a: string, b: string, tol: number): Promise<string>;
  nodeBoxes(): Promise<{ cls: string; x: number; y: number; w: number; h: number }[]>;
  consoleLog: ConsoleMessage[];
}

export interface FrameRenderer {
  totalFrames: number;
  frameRate: number;
  width: number;
  height: number;
  /** Renders one frame as a transparent PNG. Fractional frames are allowed. */
  renderFrame(frame: number): Promise<Buffer>;
  analyze(frames: Buffer[], pairs: [number, number][], ref: [number, number, number, number], tolerance?: number, premult?: boolean): Promise<{ frames: FrameStats[]; diffs: PairDiff[] }>;
  sheet(frames: Buffer[], labels: string[], cols: number, cellWidth: number): Promise<Buffer>;
  /** A PNG with differing pixels in red over a dimmed copy of the first image. */
  diffImage(a: Buffer, b: Buffer, tolerance?: number): Promise<Buffer>;
  /** Screen rectangles of every shape element (SVG only), at the frame last rendered. */
  nodeBoxes(): Promise<{ cls: string; x: number; y: number; w: number; h: number }[]>;
  consoleMessages(): Promise<ConsoleMessage[]>;
  close(): Promise<void>;
}
export type LottieRenderer = FrameRenderer;

/** Opens render.html in a headless page, runs `load` to put an animation in it, and wraps the result. */
export async function openRenderer(
  dims: { w: number; h: number },
  load: (api: PwPage) => Promise<{ totalFrames: number; frameRate: number }>,
  opts: { scale?: number; browser?: PwBrowser } = {},
): Promise<FrameRenderer> {
  const own = opts.browser === undefined;
  const browser = opts.browser ?? (await launchBrowser()).browser;
  let page: PwPage | undefined;
  let info: { totalFrames: number; frameRate: number };
  try {
    page = await browser.newPage({ viewport: { width: dims.w, height: dims.h }, deviceScaleFactor: opts.scale ?? 1 });
    await page.goto(pathToFileURL(join(assetsDir(), "render.html")).href);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const loadFailure = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("the player did not finish loading the animation within 10 seconds")), 10_000);
    });
    try {
      info = await Promise.race([load(page), loadFailure]);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    await page?.close().catch(() => undefined);
    if (own) await browser.close().catch(() => undefined);
    throw e;
  }
  const readyPage = page;
  return {
    totalFrames: info.totalFrames,
    frameRate: info.frameRate,
    width: dims.w,
    height: dims.h,
    async renderFrame(frame) {
      await readyPage.evaluate((f) => (globalThis as unknown as PageApi).seek(f), frame);
      return readyPage.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: dims.w, height: dims.h } });
    },
    analyze: (frames, pairs, ref, tolerance = 12, premult = false) => readyPage.evaluate((a) => (globalThis as unknown as PageApi).analyzeFrames(a.b, a.p, a.r, a.t, a.m), { b: frames.map((f) => f.toString("base64")), p: pairs, r: ref, t: tolerance, m: premult }),
    async sheet(frames, labels, cols, cellWidth) {
      const b64 = await readyPage.evaluate((a) => (globalThis as unknown as PageApi).makeSheet(a.b, a.l, a.c, a.w), { b: frames.map((f) => f.toString("base64")), l: labels, c: cols, w: cellWidth });
      return Buffer.from(b64, "base64");
    },
    async diffImage(a, b, tolerance = 12) {
      const b64 = await readyPage.evaluate((x) => (globalThis as unknown as PageApi).makeDiff(x.a, x.b, x.t), { a: a.toString("base64"), b: b.toString("base64"), t: tolerance });
      return Buffer.from(b64, "base64");
    },
    nodeBoxes: () => readyPage.evaluate(() => (globalThis as unknown as PageApi).nodeBoxes()),
    consoleMessages: () => readyPage.evaluate(() => (globalThis as unknown as PageApi).consoleLog),
    async close() {
      await readyPage.close();
      if (own) await browser.close();
    },
  };
}

/** Opens a Lottie document in lottie-web inside a headless browser. */
export function openLottie(lottie: { w: number; h: number }, opts: { scale?: number; browser?: PwBrowser } = {}): Promise<FrameRenderer> {
  return openRenderer(lottie, (page) => page.evaluate((json) => (globalThis as unknown as PageApi).loadLottie(JSON.parse(json)), JSON.stringify(lottie)), opts);
}
