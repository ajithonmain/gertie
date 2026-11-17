import { readFileSync } from "node:fs";
import { rawFrame } from "./ffmpeg.ts";
import { geometry, type FormatId, type Plan } from "./formats.ts";
import { launchBrowser } from "../render/browser.ts";

export interface AlphaResult {
  /** False when there was nothing to check, for example a scene with a solid background. */
  checked: boolean;
  ok: boolean;
  detail: string;
}

interface Points {
  transparent: [number, number][];
  opaque: [number, number][];
}

/** Pixels whose whole 5 by 5 neighbourhood is fully transparent (or fully opaque), so anti-aliasing cannot move them. */
function pickPoints(rgba: Buffer, w: number, h: number): Points {
  const a = (x: number, y: number): number => rgba[(y * w + x) * 4 + 3] as number;
  const out: Points = { transparent: [], opaque: [] };
  const step = Math.max(5, Math.floor(Math.min(w, h) / 12));
  for (let y = 3; y < h - 3; y += step) {
    for (let x = 3; x < w - 3; x += step) {
      let lo = 255;
      let hi = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const v = a(x + dx, y + dy);
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      if (hi === 0) out.transparent.push([x, y]);
      else if (lo === 255) out.opaque.push([x, y]);
    }
  }
  return out;
}

/** Alpha of animated WebP, read back in the browser, because ffmpeg cannot decode animated WebP. */
async function webpAlpha(file: string, pts: [number, number][]): Promise<number[]> {
  const { browser } = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
    const b64 = readFileSync(file).toString("base64");
    return await page.evaluate(
      async (a) => {
        const bin = Uint8Array.from(atob(a.b64), (c) => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bin], { type: "image/webp" }));
        const c = document.createElement("canvas");
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext("2d") as CanvasRenderingContext2D;
        ctx.drawImage(bmp, 0, 0);
        return a.pts.map(([x, y]) => ctx.getImageData(x, y, 1, 1).data[3] as number);
      },
      { b64, pts },
    );
  } finally {
    await browser.close();
  }
}

/** HEVC with alpha stores the alpha layer's parameter sets in the same `hvcC` box, so it lists one more array. */
function hevcHasAlphaLayer(file: string): boolean {
  const b = readFileSync(file);
  const i = b.indexOf("hvcC");
  if (i < 0) return false;
  // hvcC: 22 bytes of configuration, then lengthSizeMinusOne (1 byte), then numOfArrays (1 byte).
  const numArrays = b[i + 4 + 22 + 1] as number;
  return numArrays >= 4;
}

/**
 * Checks that a transparent format kept its transparency. `ffprobe` reports VP9 and HEVC with alpha as
 * yuv420p, so the pixel format cannot be trusted: the file is decoded and a pixel known to be transparent
 * in the source is read back, along with one known to be opaque.
 */
export async function verifyAlpha(file: string, format: FormatId, plan: Plan, firstFrame: string): Promise<AlphaResult> {
  const filter = [geometry(plan, true), "format=rgba"].filter((s) => s !== "").join(",");
  const src = rawFrame(firstFrame, { filter });
  const pts = pickPoints(src, plan.fw, plan.fh);
  if (pts.transparent.length === 0) return { checked: false, ok: true, detail: "frame 0 has no fully transparent area (a solid background?), so alpha was not checked" };

  if (format === "hevc") {
    const ok = hevcHasAlphaLayer(file);
    return { checked: true, ok, detail: ok ? "alpha layer present (structural check: HEVC alpha cannot be decoded by ffmpeg; confirm in Safari)" : "no alpha layer in the file: it would show a black background" };
  }

  let alphaAt: (pts: [number, number][]) => Promise<number[]>;
  if (format === "webp") alphaAt = (p) => webpAlpha(file, p);
  else {
    const raw = rawFrame(file, format === "webm" ? { decoder: "libvpx-vp9" } : {});
    alphaAt = (p) => Promise.resolve(p.map(([x, y]) => raw[(y * plan.fw + x) * 4 + 3] as number));
  }
  const t = await alphaAt(pts.transparent);
  const stillClear = t.filter((v) => v <= 16).length;
  if (stillClear < t.length) return { checked: true, ok: false, detail: `${t.length - stillClear} of ${t.length} pixels that are transparent in the source came back opaque (alpha up to ${Math.max(...t)}). The file would show a solid background.` };
  if (pts.opaque.length > 0) {
    const o = await alphaAt(pts.opaque);
    const stillSolid = o.filter((v) => v >= 200).length;
    if (stillSolid < o.length) return { checked: true, ok: false, detail: `${o.length - stillSolid} of ${o.length} opaque pixels came back transparent. The artwork was lost.` };
  }
  return { checked: true, ok: true, detail: `${pts.transparent.length} transparent and ${pts.opaque.length} opaque pixels read back correctly` };
}
