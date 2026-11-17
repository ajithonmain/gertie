import { openRenderer, type FrameRenderer, type PageApi } from "./lottie.ts";
import type { PwBrowser } from "./browser.ts";

/**
 * Opens an animated SVG inline in a headless browser and seeks it frame by frame.
 * Frame numbers map to seconds through `fps`, so `renderFrame(n)` matches Lottie frame n.
 */
export function openSvg(svg: string, dims: { w: number; h: number; fps: number }, opts: { scale?: number; browser?: PwBrowser } = {}): Promise<FrameRenderer> {
  return openRenderer(dims, (page) => page.evaluate((a) => (globalThis as unknown as PageApi).loadSvg(a.svg, a.fps), { svg, fps: dims.fps }), opts);
}
