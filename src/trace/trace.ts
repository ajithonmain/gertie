import { inside, traceMask, type Loop, type Pt } from "./contour.ts";
import { loopToPath, simplifyLoop, smoothLoop } from "./fit.ts";
import { quantize, TRANSPARENT, type Raster } from "./quantize.ts";
import { components, despeckle, modeFilter } from "./regions.ts";

export interface TraceOptions {
  /** Most colours in the palette. */
  colors: number;
  /** Regions smaller than this many pixels (at working size) are merged into their neighbours. */
  speckle: number;
  /** Largest side, in pixels, that is traced. Bigger images are reduced first and the result scaled back. */
  maxSide: number;
  /** Colours to treat as background: pixels within `tolerance` of one become transparent. */
  drop: { rgb: [number, number, number]; tolerance: number }[];
  /** Width of a same-colour outline that closes hairline seams between neighbouring regions. 0 for none. */
  seam: number;
  /** Turn, in degrees, above which an outline vertex stays sharp. */
  corner: number;
  /** Simplification tolerance in pixels. */
  detail: number;
  /** Passes of outline smoothing before simplifying. More passes give smoother curves and slightly rounder small corners. */
  smooth: number;
}

export const DEFAULT_TRACE: TraceOptions = { colors: 16, speckle: 6, maxSide: 1200, drop: [], seam: 0.6, corner: 38, detail: 0.45, smooth: 6 };

export interface TraceResult {
  svg: string;
  width: number;
  height: number;
  regions: number;
  palette: string[];
}

const hex = (c: readonly number[]): string => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

function reduce(img: Raster, maxSide: number): { img: Raster; scale: number } {
  const big = Math.max(img.w, img.h);
  if (big <= maxSide) return { img, scale: 1 };
  const scale = maxSide / big;
  const w = Math.max(1, Math.round(img.w * scale));
  const h = Math.max(1, Math.round(img.h * scale));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.h) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.h) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.w) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.w) / w));
      let r = 0, g = 0, b = 0, a = 0, c = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * img.w + xx) * 4;
        const al = img.data[i + 3] as number;
        r += (img.data[i] as number) * al;
        g += (img.data[i + 1] as number) * al;
        b += (img.data[i + 2] as number) * al;
        a += al;
        c++;
      }
      const o = (y * w + x) * 4;
      out[o] = a > 0 ? r / a : 0;
      out[o + 1] = a > 0 ? g / a : 0;
      out[o + 2] = a > 0 ? b / a : 0;
      out[o + 3] = a / c;
    }
  }
  return { img: { w, h, data: out }, scale };
}

/**
 * Traces a raster image to flat-coloured SVG shapes, stacked from the largest to the smallest.
 * Pure: the caller decodes the image and writes the result. Intended for logos, icons and flat illustrations.
 */
export function traceImage(src: Raster, partial: Partial<TraceOptions> = {}): TraceResult {
  const o = { ...DEFAULT_TRACE, ...partial };
  const { img, scale } = reduce(src, o.maxSide);
  const { w, h } = img;
  const q = quantize(img, { colors: o.colors, alphaCutoff: 128, drop: o.drop });
  let labels = modeFilter(q.labels, w, h, 1);
  let comp = components(labels, w, h, img.data);
  labels = despeckle(labels, w, h, comp.ids, comp.list, o.speckle);
  comp = components(labels, w, h, img.data);

  interface Piece {
    area: number;
    color: string;
    d: string;
    holes: boolean;
  }
  const pieces: Piece[] = [];
  const probe = (loop: Loop): boolean => {
    // Is the inside of this hole transparent? Look a pixel and a half to either side of a few of its points.
    const p = loop.points;
    let yes = 0;
    let total = 0;
    for (let k = 0; k < 3; k++) {
      const i = Math.floor((k * p.length) / 3);
      const a = p[i] as Pt;
      const b = p[(i + 1) % p.length] as Pt;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy) || 1;
      for (const sgn of [1, -1]) {
        const x = a[0] + ((-dy / len) * 1.5 * sgn);
        const y = a[1] + ((dx / len) * 1.5 * sgn);
        if (!inside(p, x, y)) continue;
        total++;
        const px = Math.floor(x);
        const py = Math.floor(y);
        if (px < 0 || py < 0 || px >= w || py >= h || labels[py * w + px] === TRANSPARENT) yes++;
      }
    }
    return total > 0 && yes * 2 > total;
  };

  for (const c of comp.list) {
    const bx = c.box[0];
    const by = c.box[1];
    const bw = c.box[2] - bx + 1;
    const bh = c.box[3] - by + 1;
    const mask = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) if (comp.ids[(by + y) * w + bx + x] === c.id) mask[y * bw + x] = 1;
    const loops = traceMask(mask, bw, bh, { left: bx === 0, top: by === 0, right: c.box[2] === w - 1, bottom: c.box[3] === h - 1 });
    if (loops.length === 0) continue;
    // Holes are kept only where they show the transparent background; others are covered by the shapes drawn on top.
    const kept: Loop[] = [];
    const keptHole = new Set<Loop>();
    for (const l of loops) {
      if (l.depth === 0) kept.push(l);
      else if (l.depth === 1) {
        const shifted: Loop = { ...l, points: l.points.map(([x, y]) => [x + bx, y + by] as Pt) };
        if (probe(shifted)) {
          kept.push(l);
          keptHole.add(l);
        }
      }
    }
    // Islands inside a kept hole are drawn too.
    for (const l of loops) if (l.depth === 2) {
      const p = l.points[0] as Pt;
      if ([...keptHole].some((hh) => inside(hh.points, p[0], p[1]))) kept.push(l);
    }
    const d = kept
      .map((l) => {
        // A region that reaches the edge was traced past it; cut the outline at the image edge.
        const clamped = l.points.map(([x, y]) => [Math.min(w, Math.max(0, x + bx)), Math.min(h, Math.max(0, y + by))] as Pt);
        const simple = simplifyLoop(smoothLoop(clamped, o.smooth), o.detail);
        return simple.length >= 3 ? loopToPath(simple, o.corner, scale) : "";
      })
      .filter((s) => s !== "")
      .join("");
    if (d === "") continue;
    const outer = Math.max(...loops.filter((l) => l.depth === 0).map((l) => Math.abs(l.area)));
    pieces.push({ area: outer, color: hex([c.sum[0] / c.area, c.sum[1] / c.area, c.sum[2] / c.area]), d, holes: keptHole.size > 0 });
  }
  // Nested regions come after the regions that contain them: a region's drawn area counts its holes, so larger comes first.
  pieces.sort((a, b) => b.area - a.area);
  const W = Math.round(src.w);
  const H = Math.round(src.h);
  const body = pieces
    .map((p, i) => `<path id="region-${i + 1}" fill="${p.color}"${p.holes ? ' fill-rule="evenodd"' : ""}${o.seam > 0 ? ` stroke="${p.color}" stroke-width="${o.seam}" stroke-linejoin="round"` : ""} d="${p.d}"/>`)
    .join("\n");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">\n${body}\n</svg>\n`;
  return { svg, width: W, height: H, regions: pieces.length, palette: [...new Set(pieces.map((p) => p.color))] };
}
