import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { gradientLine, glyphSize } from "../ascii/svg.ts";
import { canvasSize, cellHeight, cellWidth, DEFAULT_CELL_ASPECT, padding, type NAscii, type NAsciiFrame } from "../ascii/types.ts";
import { assetsDir, launchBrowser, type PwBrowser, type PwPage } from "./browser.ts";
import { openRenderer, type FrameRenderer } from "./lottie.ts";

/** Everything `draw` in ascii-render.html needs about the grid, computed with the SVG emitter's own rules so both renderers agree. */
export interface CanvasStyle {
  cols: number;
  rows: number;
  w: number;
  h: number;
  /** Cell width and height, padding and text baseline of the first row, in pixels. */
  cw: number;
  ch: number;
  pad: number;
  base: number;
  color: string;
  background: string | null;
  gradient: { from: string; to: string; x1: number; y1: number; x2: number; y2: number } | null;
  fontSize: number;
  fontFamily: string;
  glyph: "text" | "dot" | "square";
  /** For dots and squares: the share of the cell each ramp character fills. */
  sizes: Record<string, number>;
  glow: number;
}

/**
 * A frame as sent to the page. A list of colour strings per cell costs more to send to the page than to draw, so colours are
 * a table plus one string per row with one character per cell: code 0x100 is no colour of its own, 0x101 + i is `table[i]`.
 */
export interface PackedFrame {
  rows: string[];
  table: string[];
  colors: string[] | null;
  backgrounds: string[] | null;
}

export function canvasStyle(s: NAscii): CanvasStyle {
  const { w, h } = canvasSize(s);
  const ch = cellHeight(s);
  const pad = padding(s);
  const g = s.style.gradient;
  const sizes: Record<string, number> = {};
  if (s.style.glyph !== "text" && s.style.ramp !== null) for (const c of s.style.ramp) if (c !== " ") sizes[c] = glyphSize(s.style.ramp, c);
  let gradient: CanvasStyle["gradient"] = null;
  if (g) {
    const [x1, y1, x2, y2] = gradientLine(w, h, g.angle);
    gradient = { from: g.from, to: g.to, x1, y1, x2, y2 };
  }
  return {
    cols: s.cols,
    rows: s.rows,
    w,
    h,
    cw: cellWidth(s),
    ch,
    pad,
    // The same baseline as the SVG emitter.
    base: s.style.cellAspect === DEFAULT_CELL_ASPECT ? pad + s.style.fontSize * 0.95 : pad + ch * 0.76,
    color: s.style.color,
    background: s.style.background,
    gradient,
    fontSize: s.style.fontSize,
    fontFamily: s.style.fontFamily,
    glyph: s.style.glyph,
    sizes,
    glow: s.style.glow,
  };
}

/** More colours than this in one frame would reach the surrogate code points. 32 levels per channel is 32768 colours, which fits. */
const MAX_TABLE = 0xd7ff - 0x101;

export function packFrame(f: NAsciiFrame): PackedFrame {
  const table: string[] = [];
  const index = new Map<string, number>();
  const pack = (grid: (string | null)[][] | null): string[] | null =>
    grid === null
      ? null
      : grid.map((row) => {
          let out = "";
          for (const c of row) {
            if (c === null) {
              out += "\u0100";
              continue;
            }
            let i = index.get(c);
            if (i === undefined) {
              i = table.length;
              if (i >= MAX_TABLE) throw new Error(`a frame uses more than ${MAX_TABLE} colours`);
              table.push(c);
              index.set(c, i);
            }
            out += String.fromCharCode(0x101 + i);
          }
          return out;
        });
  return { rows: f.cells.map((r) => r.join("")), table, colors: pack(f.colors), backgrounds: pack(f.backgrounds) };
}

interface CanvasPageApi {
  draw(frame: PackedFrame, style: CanvasStyle): void;
  drawBatch(frames: PackedFrame[], style: CanvasStyle): Promise<string[]>;
}

/** One page with the canvas renderer. `draw` paints frames and returns them as PNGs (transparent where nothing is drawn), captured with canvas.toBlob. */
export interface AsciiCanvas {
  width: number;
  height: number;
  draw(frames: NAsciiFrame[]): Promise<Buffer[]>;
  close(): Promise<void>;
}

/** Frames drawn and captured per call into the page. */
export const CANVAS_BATCH = 8;

export async function openAsciiCanvas(s: NAscii, opts: { scale?: number; browser?: PwBrowser } = {}): Promise<AsciiCanvas> {
  const style = canvasStyle(s);
  const own = opts.browser === undefined;
  const browser = opts.browser ?? (await launchBrowser()).browser;
  let page: PwPage | undefined;
  try {
    page = await browser.newPage({ viewport: { width: style.w, height: style.h }, deviceScaleFactor: opts.scale ?? 1 });
    await page.goto(pathToFileURL(join(assetsDir(), "ascii-render.html")).href);
    await page.evaluate(() => {
      (globalThis as unknown as { document: { documentElement: { classList: { add(c: string): void } } } }).document.documentElement.classList.add("capture");
    });
  } catch (e) {
    await page?.close().catch(() => undefined);
    if (own) await browser.close().catch(() => undefined);
    throw e;
  }
  const ready = page;
  return {
    width: style.w,
    height: style.h,
    async draw(frames) {
      const b64 = await ready.evaluate((a) => (globalThis as unknown as CanvasPageApi).drawBatch(a.f, a.s), { f: frames.map(packFrame), s: style });
      return b64.map((x) => Buffer.from(x, "base64"));
    },
    async close() {
      await ready.close();
      if (own) await browser.close();
    },
  };
}

/**
 * A frame renderer for the exporter and the contact sheet that draws with the canvas renderer, pulling frames from `frames`
 * as they are needed. Frames must be asked for in order (the exporter does); a held frame is drawn once and its picture reused.
 * The contact sheet and pixel analysis use render.html in a second page, opened only when they are called.
 */
export async function openCanvasFrames(s: NAscii, frames: AsyncIterator<NAsciiFrame>, opts: { scale?: number; browser?: PwBrowser } = {}): Promise<FrameRenderer> {
  const own = opts.browser === undefined;
  const browser = opts.browser ?? (await launchBrowser()).browser;
  let canvas: AsciiCanvas;
  try {
    canvas = await openAsciiCanvas(s, { ...opts, browser });
  } catch (e) {
    if (own) await browser.close().catch(() => undefined);
    throw e;
  }
  let helper: FrameRenderer | undefined;
  const tools = async (): Promise<FrameRenderer> => (helper ??= await openRenderer({ w: canvas.width, h: canvas.height }, () => Promise.resolve({ totalFrames: 0, frameRate: s.fps }), { browser, ...(opts.scale !== undefined ? { scale: opts.scale } : {}) }));
  // A queue of drawn frames: [first interval, end interval, picture]. Frames are pulled and drawn CANVAS_BATCH at a time.
  const queue: { start: number; end: number; png: Buffer }[] = [];
  let pulled = 0;
  let done = false;
  let last: { start: number; end: number; png: Buffer } | undefined;
  const fill = async (): Promise<void> => {
    const batch: NAsciiFrame[] = [];
    const spans: [number, number][] = [];
    while (batch.length < CANVAS_BATCH) {
      const next = await frames.next();
      if (next.done) {
        done = true;
        break;
      }
      batch.push(next.value);
      spans.push([pulled, pulled + next.value.hold]);
      pulled += next.value.hold;
    }
    if (batch.length === 0) return;
    const pngs = await canvas.draw(batch);
    pngs.forEach((png, i) => queue.push({ start: (spans[i] as [number, number])[0], end: (spans[i] as [number, number])[1], png }));
  };
  return {
    totalFrames: 0,
    frameRate: s.fps,
    width: canvas.width,
    height: canvas.height,
    async renderFrame(n) {
      const f = Math.floor(n);
      if (last && f < last.start) throw new Error(`the canvas renderer draws frames in order; frame ${f} was asked for after frame ${last.start}`);
      while (!last || f >= last.end) {
        if (queue.length === 0) {
          if (done) break;
          await fill();
          continue;
        }
        last = queue.shift();
      }
      // Past the last frame the last picture stays.
      if (!last) throw new Error("the animation has no frames");
      return last.png;
    },
    analyze: async (...a) => (await tools()).analyze(...a),
    sheet: async (...a) => (await tools()).sheet(...a),
    diffImage: async (...a) => (await tools()).diffImage(...a),
    nodeBoxes: () => Promise.resolve([]),
    consoleMessages: () => Promise.resolve([]),
    async close() {
      await frames.return?.(undefined);
      await helper?.close();
      await canvas.close();
      if (own) await browser.close();
    },
  };
}
