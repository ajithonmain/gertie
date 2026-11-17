import type { Raster } from "../trace/quantize.ts";
import { encodePng } from "./png.ts";
import { inpaint, morph, padEdges, polygonCoverage, softenMask, type Pt } from "./raster.ts";

type Obj = Record<string, unknown>;

export interface PartSpec {
  id: string;
  /** Outline in image pixels. */
  polygon: Pt[];
  /** The point the part turns around, in image pixels. */
  pivot?: Pt;
}

export interface LidSpec {
  id: string;
  /** [centre x, centre y, radius x, radius y] in image pixels. */
  ellipse: [number, number, number, number];
  /**
   * The centre of a patch of skin next to the eye, the size of the lid, which the lid is cut from, so it has the picture's own grain and
   * tone. The patch must not touch the eye or a brow.
   */
  sample: Pt;
  /**
   * A point of skin whose colour the lid should have, when the patch has the right grain but the wrong tone (a patch from a cheek that
   * blushes, say). The lid keeps the patch's grain and takes its average colour from here.
   */
  tone?: Pt;
  /** Fill the lid with one flat colour (the mean of the patch) instead of the patch itself. */
  flat?: boolean;
}

export interface CutoutSpec {
  /** Pixels added around the picture by mirroring its edge, so the background can drift and a part can extend past the edge. Default 0. */
  bleed?: number;
  /** How far the area behind a part is grown before it is filled, to remove the fringe of old background colour at its edge. Default 2. */
  grow?: number;
  /** Shrinks every part's edge in by this many pixels. Default 0. */
  inset?: number;
  /** Parts from back to front. The picture itself is the background behind them all. */
  parts: PartSpec[];
  lids?: LidSpec[];
}

export interface CutoutFile {
  /** Path relative to the cutout folder. */
  path: string;
  png: Buffer;
}

export interface CutoutResult {
  files: CutoutFile[];
  fragment: { "gertie-fragment": 1; source: string; canvas: { w: number; h: number }; nodes: Obj[] };
  notes: string[];
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const isPt = (p: unknown): p is Pt => Array.isArray(p) && p.length === 2 && p.every((v) => typeof v === "number" && Number.isFinite(v));

/** Problems with a parts file, each written so the author can fix it. Empty when it is usable. */
export function validateSpec(spec: unknown, w: number, h: number): string[] {
  const errors: string[] = [];
  if (spec === null || typeof spec !== "object" || Array.isArray(spec)) return ["the parts file must be an object with a 'parts' list"];
  const s = spec as Record<string, unknown>;
  for (const k of Object.keys(s)) if (!["bleed", "grow", "inset", "parts", "lids"].includes(k)) errors.push(`unknown field '${k}'. Valid fields: bleed, grow, inset, parts, lids`);
  for (const k of ["bleed", "grow", "inset"]) {
    const v = s[k];
    if (v !== undefined && (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 200)) errors.push(`'${k}' must be a number from 0 to 200`);
  }
  const ids = new Set<string>(["background"]);
  const parts = s["parts"];
  if (!Array.isArray(parts) || parts.length === 0) errors.push("'parts' must be a list with at least one part, from back to front");
  else {
    parts.forEach((p, i) => {
      const where = `parts[${i}]`;
      if (p === null || typeof p !== "object") return void errors.push(`${where} must be an object`);
      const o = p as Record<string, unknown>;
      const id = o["id"];
      if (typeof id !== "string" || !ID_RE.test(id)) errors.push(`${where}: 'id' must be lowercase letters, digits and hyphens, starting with a letter (got ${JSON.stringify(id)})`);
      else if (ids.has(id)) errors.push(`${where}: id '${id}' is used twice${id === "background" ? " ('background' is the picture behind the parts)" : ""}`);
      else ids.add(id);
      const poly = o["polygon"];
      if (!Array.isArray(poly) || poly.length < 3 || !poly.every(isPt)) errors.push(`${where} (${String(id)}): 'polygon' must be a list of at least 3 [x, y] points`);
      else {
        const pts = poly as Pt[];
        let a = 0;
        for (let k = 0; k < pts.length; k++) {
          const q = pts[(k + 1) % pts.length] as Pt;
          a += (pts[k] as Pt)[0] * q[1] - q[0] * (pts[k] as Pt)[1];
        }
        if (Math.abs(a) / 2 < 16) errors.push(`${where} (${String(id)}): the polygon covers less than 16 square pixels. Check that the points are in image pixels`);
        const reach = (typeof s["bleed"] === "number" ? (s["bleed"] as number) : 0) + 8;
        const outside = pts.filter(([x, y]) => x < -reach || y < -reach || x > w + reach || y > h + reach).length;
        if (outside > 0) errors.push(`${where} (${String(id)}): ${outside} point(s) are more than ${reach} pixels outside the ${w} by ${h} image (the most a part may extend past the edge is the 'bleed' plus 8). Points are in image pixels`);
      }
      if (o["pivot"] !== undefined && !isPt(o["pivot"])) errors.push(`${where} (${String(id)}): 'pivot' must be [x, y]`);
      for (const k of Object.keys(o)) if (!["id", "polygon", "pivot"].includes(k)) errors.push(`${where}: unknown field '${k}'. Valid fields: id, polygon, pivot`);
    });
  }
  const lids = s["lids"];
  if (lids !== undefined) {
    if (!Array.isArray(lids)) errors.push("'lids' must be a list");
    else {
      lids.forEach((l, i) => {
        const where = `lids[${i}]`;
        if (l === null || typeof l !== "object") return void errors.push(`${where} must be an object`);
        const o = l as Record<string, unknown>;
        const id = o["id"];
        if (typeof id !== "string" || !ID_RE.test(id)) errors.push(`${where}: 'id' must be lowercase letters, digits and hyphens`);
        else if (ids.has(id)) errors.push(`${where}: id '${id}' is used twice`);
        else ids.add(id);
        const e = o["ellipse"];
        if (!Array.isArray(e) || e.length !== 4 || !e.every((v) => typeof v === "number" && Number.isFinite(v)) || (e[2] as number) <= 0 || (e[3] as number) <= 0) errors.push(`${where}: 'ellipse' must be [centre x, centre y, radius x, radius y] with positive radii`);
        if (!isPt(o["sample"])) errors.push(`${where}: 'sample' must be [x, y], the centre of a patch of skin next to the eye`);
        if (o["flat"] !== undefined && typeof o["flat"] !== "boolean") errors.push(`${where}: 'flat' must be true or false`);
        if (o["tone"] !== undefined && !isPt(o["tone"])) errors.push(`${where}: 'tone' must be [x, y], a point of skin whose colour the lid should have`);
        for (const k of Object.keys(o)) if (!["id", "ellipse", "sample", "flat", "tone"].includes(k)) errors.push(`${where}: unknown field '${k}'. Valid fields: id, ellipse, sample, tone, flat`);
      });
    }
  }
  return errors;
}

const hex = (r: number, g: number, b: number): string => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("")}`;

/** The mean colour of a 5 by 5 patch of the image around a point. */
function sampleColor(img: Raster, p: Pt): string {
  const [r, g, b] = sampleRgb(img, p);
  return hex(r, g, b);
}

function sampleRgb(img: Raster, p: Pt): [number, number, number] {
  let r = 0, g = 0, b = 0, c = 0;
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
    const x = Math.round(p[0]) + dx;
    const y = Math.round(p[1]) + dy;
    if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
    const i = (y * img.w + x) * 4;
    r += img.data[i] as number;
    g += img.data[i + 1] as number;
    b += img.data[i + 2] as number;
    c++;
  }
  return c === 0 ? [128, 128, 128] : [r / c, g / c, b / c];
}

const num = (v: number): number => Math.round(v * 100) / 100;

/**
 * Cuts an image into layers along hand-drawn polygons. Layers are built from the back: the background is the whole picture with every
 * part's area filled in, and each part is the pixels inside its outline with the areas of the parts in front of it filled in, so a
 * part can move without showing a hole or a copy of what was in front. The picture is first padded by `bleed` pixels of mirrored
 * edge, so the background can drift and a part whose outline runs past the edge has pixels there. Pure: the caller decodes the image
 * and writes the files.
 */
export function buildCutout(source: Raster, spec: CutoutSpec, sourceName: string): CutoutResult {
  const bleed = Math.round(spec.bleed ?? 0);
  const img = padEdges(source, bleed);
  const { w, h } = img;
  const grow = spec.grow ?? 2;
  const inset = spec.inset ?? 0;
  const notes: string[] = [];
  const shift = (p: Pt): Pt => [p[0] + bleed, p[1] + bleed];
  const polys = spec.parts.map((p) => p.polygon.map(shift));
  const own = polys.map((poly) => {
    let m = polygonCoverage(poly, w, h);
    if (inset > 0) m = morph(m, w, h, -inset);
    return softenMask(m, w, h);
  });
  const files: CutoutFile[] = [];
  const nodes: Obj[] = [];

  // The area each part leaves behind, grown a little to take its fringe with it. Computed once per part.
  const grown = polys.map((poly, j) => (grow > 0 ? morph(polygonCoverage(poly, w, h), w, h, grow) : (own[j] as Float32Array)));
  const holeFrom = (start: number): Float32Array => {
    const hole = new Float32Array(w * h);
    for (let j = start; j < spec.parts.length; j++) {
      const g = grown[j] as Float32Array;
      for (let i = 0; i < hole.length; i++) if ((g[i] as number) > (hole[i] as number)) hole[i] = g[i] as number;
    }
    return hole;
  };

  // Background: the whole padded picture, with every part's area filled in.
  {
    const hole = holeFrom(0);
    const known = new Uint8Array(w * h);
    for (let i = 0; i < known.length; i++) known[i] = (hole[i] as number) < 0.5 ? 1 : 0;
    const filled = inpaint(img, known);
    const opaque = new Uint8ClampedArray(filled.data);
    for (let i = 0; i < w * h; i++) opaque[i * 4 + 3] = 255;
    files.push({ path: "background.png", png: encodePng({ w, h, data: opaque }) });
    nodes.push({ id: "background", type: "image", src: "background.png", w, h, x: -bleed, y: -bleed });
  }

  spec.parts.forEach((p, idx) => {
    const mask = own[idx] as Float32Array;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((mask[y * w + x] as number) > 0.003) {
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    if (x1 < 0) {
      notes.push(`part '${p.id}' covers no pixels of the image and was left out`);
      return;
    }
    // The pixels behind the parts in front of this one are filled from this part's own pixels.
    const front = holeFrom(idx + 1);
    const known = new Uint8Array(w * h);
    for (let i = 0; i < known.length; i++) known[i] = (mask[i] as number) > 0.5 && (front[i] as number) < 0.5 ? 1 : 0;
    const domain = new Uint8Array(w * h);
    for (let i = 0; i < domain.length; i++) domain[i] = (front[i] as number) >= 0.5 && (mask[i] as number) > 0.003 ? 1 : 0;
    const filled = inpaint(img, known, domain);
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    const data = new Uint8ClampedArray(cw * ch * 4);
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const si = (y + y0) * w + x + x0;
      const di = y * cw + x;
      // Pixels hidden behind a part in front take the filled colour; the rest, edge pixels included, keep their own.
      const srcData = (front[si] as number) >= 0.5 ? filled.data : img.data;
      data[di * 4] = srcData[si * 4] as number;
      data[di * 4 + 1] = srcData[si * 4 + 1] as number;
      data[di * 4 + 2] = srcData[si * 4 + 2] as number;
      data[di * 4 + 3] = Math.round((mask[si] as number) * 255);
    }
    const file = `parts/${p.id}.png`;
    files.push({ path: file, png: encodePng({ w: cw, h: ch, data }) });
    // Node coordinates are canvas pixels: the padded picture starts `bleed` pixels before the canvas.
    const node: Obj = { id: p.id, type: "image", src: file, w: cw, h: ch, x: x0 - bleed, y: y0 - bleed };
    if (p.pivot) node["pivot"] = [num(p.pivot[0] + bleed - x0), num(p.pivot[1] + bleed - y0)];
    nodes.push(node);
  });

  for (const l of spec.lids ?? []) {
    const [cx, cy, rx, ry] = l.ellipse;
    if (l.flat) {
      nodes.push({ id: l.id, type: "ellipse", rx, ry, x: cx, y: cy, fill: sampleColor(img, shift(l.sample)), pivot: [0, -ry] });
      continue;
    }
    // The lid is a patch of the picture's own skin, the size of the lid, with a soft elliptical edge, so it has the same grain and tone.
    const pw = Math.ceil(2 * rx) + 4;
    const ph = Math.ceil(2 * ry) + 4;
    const sx = Math.max(0, Math.min(w - pw, Math.round(l.sample[0] + bleed - pw / 2)));
    const sy = Math.max(0, Math.min(h - ph, Math.round(l.sample[1] + bleed - ph / 2)));
    const data = new Uint8ClampedArray(pw * ph * 4);
    // With a tone point, the patch keeps its grain but takes the colour of that spot: shift its mean to the tone's.
    const shiftRgb = [0, 0, 0];
    if (l.tone) {
      let m0 = 0, m1 = 0, m2 = 0;
      for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
        const si = ((sy + y) * w + sx + x) * 4;
        m0 += img.data[si] as number;
        m1 += img.data[si + 1] as number;
        m2 += img.data[si + 2] as number;
      }
      const t = sampleRgb(img, shift(l.tone));
      shiftRgb[0] = t[0] - m0 / (pw * ph);
      shiftRgb[1] = t[1] - m1 / (pw * ph);
      shiftRgb[2] = t[2] - m2 / (pw * ph);
    }
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const si = ((sy + y) * w + sx + x) * 4;
      const di = (y * pw + x) * 4;
      data[di] = (img.data[si] as number) + (shiftRgb[0] as number);
      data[di + 1] = (img.data[si + 1] as number) + (shiftRgb[1] as number);
      data[di + 2] = (img.data[si + 2] as number) + (shiftRgb[2] as number);
      const u = (x + 0.5 - pw / 2) / rx;
      const v = (y + 0.5 - ph / 2) / ry;
      const edge = (1 - Math.hypot(u, v)) * Math.min(rx, ry);
      data[di + 3] = Math.round(255 * Math.max(0, Math.min(1, edge / 1.5 + 0.5)));
    }
    const file = `lids/${l.id}.png`;
    files.push({ path: file, png: encodePng({ w: pw, h: ph, data }) });
    // Placed so the patch's centre is the eye's centre; the pivot is the top middle, so the lid drops from the top of the eye.
    nodes.push({ id: l.id, type: "image", src: file, w: pw, h: ph, x: num(cx - pw / 2), y: num(cy - ph / 2), pivot: [num(pw / 2), 0] });
  }
  return { files, fragment: { "gertie-fragment": 1, source: sourceName, canvas: { w: source.w, h: source.h }, nodes }, notes };
}
