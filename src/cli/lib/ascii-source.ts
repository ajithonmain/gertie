import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { makeDiagnostic } from "../../spec/diagnostics.ts";
import { cropRaster, downsample } from "../../ascii/convert.ts";
import { AsciiSourceError, type CellRequest, type OpenSource, type SourceReader } from "../../ascii/frames.ts";
import { countFrames, streamFrames } from "../../ascii/media.ts";
import { probe } from "../../export/ffmpeg.ts";
import { launchBrowser } from "../../render/browser.ts";
import type { PwBrowser, PwPage } from "../../render/browser.ts";
import { openLottie } from "../../render/lottie.ts";
import { runCompile, type Outcome } from "./commands.ts";

/** A vector scene named by a recipe did not compile. Carries the compiler's outcome, which `ascii from` prints as it is. */
export class SourceCompileError extends Error {
  constructor(
    readonly file: string,
    readonly outcome: Outcome,
  ) {
    super(`the vector scene '${file}' does not compile`);
    this.name = "SourceCompileError";
  }
}

/** Frames rendered and decoded per batch, as in phase 8. */
const BATCH = 12;

interface CellPageGlobals {
  fetch(url: string): Promise<{ blob(): Promise<unknown> }>;
  createImageBitmap(blob: unknown, opts: object): Promise<{ width: number; height: number }>;
  OffscreenCanvas: new (w: number, h: number) => { getContext(t: string): { drawImage(i: unknown, x: number, y: number): void; getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };
  Blob: new (parts: unknown[]) => unknown;
  FileReader: new () => { result: unknown; onload: (() => void) | null; onerror: (() => void) | null; error: unknown; readAsDataURL(b: unknown): void };
  eval(src: string): unknown;
}

/**
 * Decodes rendered PNGs and averages them into cells inside the browser page, returning only the cells. Decoding in the page and
 * sending every pixel back to Node cost about half a second per frame at 1536 by 1152; the cells are a few kilobytes. The page runs
 * the very same `cropRaster` and `downsample` functions (their source is passed in), so the cells are byte for byte what Node computes.
 */
async function cellsInPage(page: PwPage, pngs: Buffer[], req: { cols: number; rows: number; crop?: [number, number, number, number] }): Promise<Uint8ClampedArray[]> {
  const b64s = await page.evaluate(
    async (a: { pngs: string[]; cols: number; rows: number; crop: [number, number, number, number] | null; ds: string; cr: string }) => {
      const g = globalThis as unknown as CellPageGlobals;
      type R = { w: number; h: number; data: Uint8ClampedArray };
      const downsampleFn = g.eval(`(${a.ds})`) as (r: R, cols: number, rows: number) => Uint8ClampedArray;
      const cropFn = g.eval(`(${a.cr})`) as (r: R, x: number, y: number, w: number, h: number) => R;
      const out: string[] = [];
      for (const b64 of a.pngs) {
        const blob = await (await g.fetch(`data:image/png;base64,${b64}`)).blob();
        const bmp = await g.createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
        const c = new g.OffscreenCanvas(bmp.width, bmp.height);
        const ctx = c.getContext("2d");
        ctx.drawImage(bmp, 0, 0);
        const ras: R = { w: bmp.width, h: bmp.height, data: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
        const cells = downsampleFn(a.crop ? cropFn(ras, a.crop[0], a.crop[1], a.crop[2], a.crop[3]) : ras, a.cols, a.rows);
        out.push(
          await new Promise<string>((resolve, reject) => {
            const fr = new g.FileReader();
            fr.onload = () => resolve(String(fr.result).slice(String(fr.result).indexOf(",") + 1));
            fr.onerror = () => reject(fr.error);
            fr.readAsDataURL(new g.Blob([cells]));
          }),
        );
      }
      return out;
    },
    { pngs: pngs.map((p) => p.toString("base64")), cols: req.cols, rows: req.rows, crop: req.crop ?? null, ds: downsample.toString(), cr: cropRaster.toString() },
  );
  return b64s.map((b) => new Uint8ClampedArray(Buffer.from(b, "base64")));
}

async function cellPage(browser: PwBrowser): Promise<PwPage> {
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  await page.goto("about:blank");
  return page;
}

function openScene(path: string, shown: string): OpenSource {
  const run = runCompile({ command: "compile", positional: [path], flags: new Map() }, false);
  if (!run.result?.scene || !run.result.lottie) throw new SourceCompileError(shown, run.outcome);
  const sc = run.result.scene;
  const lottie = run.result.lottie as { w: number; h: number };
  const seconds = sc.totalFrames / sc.fps;
  const bg = sc.background;
  return {
    kind: "scene",
    width: sc.w,
    height: sc.h,
    seconds,
    background: bg === null ? null : [bg[0], bg[1], bg[2]],
    loop: sc.loop,
    frameCount: (fps, maxSeconds, maxFrames) => Promise.resolve(Math.max(1, Math.min(maxFrames, Math.round(Math.min(seconds, maxSeconds) * fps)))),
    async *cells(req: CellRequest) {
      // The scene is drawn at up to three times its size, so each cell averages several pixels.
      const scale = Math.min(3, Math.max(1, Math.ceil((req.cols * 6) / sc.w)));
      const crop = req.crop;
      const { browser } = await launchBrowser();
      try {
        const r = await openLottie(lottie, { scale, browser });
        const page = await cellPage(browser);
        try {
          for (let at = 0; at < req.count; at += BATCH) {
            const pngs: Buffer[] = [];
            for (let k = at; k < Math.min(req.count, at + BATCH); k++) pngs.push(await r.renderFrame((k * sc.fps) / req.fps));
            yield* await cellsInPage(page, pngs, { cols: req.cols, rows: req.rows, ...(crop ? { crop: [crop.x * scale, crop.y * scale, crop.w * scale, crop.h * scale] as [number, number, number, number] } : {}) });
          }
        } finally {
          await page.close();
          await r.close();
        }
      } finally {
        await browser.close();
      }
    },
  };
}

function openMedia(path: string, shown: string): OpenSource {
  let info;
  try {
    info = probe(path, false);
  } catch (e) {
    throw new AsciiSourceError(makeDiagnostic("E-ASCII-SOURCE", `Cannot read ${shown} as a picture or video: ${e instanceof Error ? e.message : String(e)}`, "Name a video, GIF, image or .gertie.json scene.", { path: "source.file" }));
  }
  const counts = new Map<string, Promise<number>>();
  // ffmpeg failing on the file is a problem with the source, reported like any other; a missing ffmpeg is not, and passes through.
  const unreadable = (e: unknown): unknown => (e instanceof Error && e.name === "Error" ? new AsciiSourceError(makeDiagnostic("E-ASCII-SOURCE", e.message, "Name a video, GIF, image or .gertie.json scene that ffmpeg can read.", { path: "source.file" })) : e);
  return {
    kind: "media",
    width: info.width,
    height: info.height,
    seconds: info.duration,
    background: null,
    loop: true,
    frameCount(fps, maxSeconds, maxFrames, crop) {
      const key = JSON.stringify([fps, maxSeconds, maxFrames, crop ?? null]);
      let n = counts.get(key);
      if (!n) {
        n = countFrames(path, { fps, maxSeconds, maxFrames, ...(crop ? { crop } : {}) }).catch((e: unknown) => {
          throw unreadable(e);
        });
        counts.set(key, n);
      }
      return n;
    },
    async *cells(req: CellRequest) {
      try {
        yield* streamFrames(path, { cols: req.cols, rows: req.rows, fps: req.fps, maxSeconds: req.maxSeconds, maxFrames: req.count, ...(req.crop ? { crop: req.crop } : {}) });
      } catch (e) {
        throw unreadable(e);
      }
    },
  };
}

/**
 * The reader that `framesOf` uses: opens the file a recipe names, relative to the recipe's directory. A `.gertie.json` file is
 * compiled and drawn in the browser; anything else goes through ffmpeg. Each file is opened once per reader.
 */
export function sourceReader(baseDir: string): SourceReader {
  const open = new Map<string, OpenSource>();
  return async (file: string) => {
    const path = resolve(baseDir, file);
    const hit = open.get(path);
    if (hit) return hit;
    if (!existsSync(path)) throw new AsciiSourceError(makeDiagnostic("E-ASCII-FILE", `source.file '${file}' was not found.`, "Check the path. It is relative to the .ascii.json file.", { path: "source.file" }));
    const src = /\.gertie\.json$/i.test(path) ? openScene(path, file) : openMedia(path, file);
    open.set(path, src);
    return src;
  };
}
