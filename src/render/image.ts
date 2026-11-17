import { launchBrowser, type PwBrowser, type PwPage } from "./browser.ts";
import type { Raster } from "../trace/quantize.ts";

export function imageMime(b: Uint8Array): string | undefined {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return undefined;
}

interface PageGlobals {
  fetch(url: string): Promise<{ blob(): Promise<unknown> }>;
  createImageBitmap(blob: unknown, opts: object): Promise<{ width: number; height: number }>;
  OffscreenCanvas: new (w: number, h: number) => { getContext(t: string): { drawImage(i: unknown, x: number, y: number): void; getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray } } };
  Blob: new (parts: unknown[]) => unknown;
  FileReader: new () => { result: unknown; onload: (() => void) | null; onerror: (() => void) | null; error: unknown; readAsDataURL(b: unknown): void };
}

async function decodeOnPage(page: PwPage, bytes: Uint8Array): Promise<Raster> {
  const mime = imageMime(bytes);
  if (!mime) throw new Error("the file is not a PNG, JPEG, GIF or WebP image");
  const r = await page.evaluate(
    async (a: { b64: string; mime: string }) => {
      const g = globalThis as unknown as PageGlobals;
      const blob = await (await g.fetch(`data:${a.mime};base64,${a.b64}`)).blob();
      const bmp = await g.createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
      const c = new g.OffscreenCanvas(bmp.width, bmp.height);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0);
      const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
      // The browser's own base64 encoder: building the string by hand took most of the time for large pictures.
      const url = await new Promise<string>((resolve, reject) => {
        const fr = new g.FileReader();
        fr.onload = () => resolve(String(fr.result));
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(new g.Blob([d]));
      });
      return { w: bmp.width, h: bmp.height, b64: url.slice(url.indexOf(",") + 1) };
    },
    { b64: Buffer.from(bytes).toString("base64"), mime },
  );
  return { w: r.w, h: r.h, data: new Uint8ClampedArray(Buffer.from(r.b64, "base64")) };
}

/** Decodes many images (PNG, JPEG, GIF or WebP) to straight RGBA pixels, in order, with one page, using the browser that renders animations. */
export async function decodeImages(images: readonly Uint8Array[], opts: { browser?: PwBrowser } = {}): Promise<Raster[]> {
  for (const b of images) if (!imageMime(b)) throw new Error("the file is not a PNG, JPEG, GIF or WebP image");
  const own = opts.browser === undefined;
  const browser = opts.browser ?? (await launchBrowser()).browser;
  const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
  try {
    await page.goto("about:blank");
    const out: Raster[] = [];
    for (const bytes of images) out.push(await decodeOnPage(page, bytes));
    return out;
  } finally {
    await page.close();
    if (own) await browser.close();
  }
}

/** Decodes one image. See `decodeImages`. */
export async function decodeImage(bytes: Uint8Array, opts: { browser?: PwBrowser } = {}): Promise<Raster> {
  return (await decodeImages([bytes], opts))[0] as Raster;
}
