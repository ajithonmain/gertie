import type { Raster } from "../trace/quantize.ts";

export type Pt = [number, number];

/**
 * Coverage of a polygon over a w by h grid, from 0 to 1, by sampling each pixel on a `ss` by `ss` grid with the even-odd rule.
 * Pixel (x, y) covers [x, x + 1] by [y, y + 1].
 */
export function polygonCoverage(poly: readonly Pt[], w: number, h: number, ss = 4): Float32Array {
  const out = new Float32Array(w * h);
  if (poly.length < 3) return out;
  const ys = poly.map((p) => p[1]);
  const y0 = Math.max(0, Math.floor(Math.min(...ys)));
  const y1 = Math.min(h - 1, Math.ceil(Math.max(...ys)));
  const n = poly.length;
  for (let y = y0; y <= y1; y++) {
    for (let sy = 0; sy < ss; sy++) {
      const py = y + (sy + 0.5) / ss;
      const xs: number[] = [];
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const a = poly[i] as Pt;
        const b = poly[j] as Pt;
        if (a[1] > py !== b[1] > py) xs.push(a[0] + ((py - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const xa = xs[k] as number;
        const xb = xs[k + 1] as number;
        const first = Math.max(0, Math.floor(xa));
        const last = Math.min(w - 1, Math.ceil(xb) - 1);
        for (let x = first; x <= last; x++) {
          const cover = Math.max(0, Math.min(x + 1, xb) - Math.max(x, xa));
          out[y * w + x] = (out[y * w + x] as number) + cover / ss;
        }
      }
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = Math.min(1, out[i] as number);
  return out;
}

/** Grows (r > 0) or shrinks (r < 0) a coverage mask by about |r| pixels, using a round window. */
export function morph(mask: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r === 0) return mask;
  const rad = Math.abs(r);
  const reach = Math.ceil(rad);
  const grow = r > 0;
  // The window, with how much each offset counts: fully inside the radius, fading across its last pixel.
  const win: { dx: number; dy: number; k: number }[] = [];
  for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) {
    const k = Math.max(0, Math.min(1, rad + 0.5 - Math.hypot(dx, dy)));
    if (k > 0) win.push({ dx, dy, k });
  }
  // Only the neighbourhood of the shape can change.
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((mask[y * w + x] as number) > 0) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const out = new Float32Array(mask);
  if (x1 < 0) return out;
  for (let y = Math.max(0, y0 - reach); y <= Math.min(h - 1, y1 + reach); y++) for (let x = Math.max(0, x0 - reach); x <= Math.min(w - 1, x1 + reach); x++) {
    let v = grow ? 0 : 1;
    for (const { dx, dy, k } of win) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const m = mask[yy * w + xx] as number;
      if (grow) {
        const c = m * k;
        if (c > v) v = c;
      } else {
        const c = 1 - (1 - m) * k;
        if (c < v) v = c;
      }
    }
    out[y * w + x] = v;
  }
  return out;
}

/** A one-pass box blur of a mask, for softening an edge by about a pixel. */
export function softenMask(mask: Float32Array, w: number, h: number): Float32Array {
  const out = new Float32Array(mask.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      s += mask[yy * w + xx] as number;
      c++;
    }
    out[y * w + x] = s / c;
  }
  return out;
}

/**
 * Fills the pixels in `domain` from the pixels where `known` is true, working inwards from the edge of the hole one ring at a time
 * and averaging the neighbours already known, then relaxing the patch to a smooth surface and adding grain of the same strength as
 * the pixels beside it. It leaves a plausible patch behind a part that has been cut out: enough for small movements, not a
 * reconstruction of what was hidden. Pixels in neither `known` nor `domain` are not used and not changed.
 */
export function inpaint(src: Raster, known: Uint8Array, domain?: Uint8Array): Raster {
  const { w, h } = src;
  const data = new Uint8ClampedArray(src.data);
  const have = new Uint8Array(known);
  const want = new Uint8Array(w * h);
  let remaining = 0;
  for (let i = 0; i < want.length; i++) if (!known[i] && (domain ? domain[i] : 1)) {
    want[i] = 1;
    remaining++;
  }
  if (remaining === 0) return { w, h, data };
  const filled: number[] = [];
  const nbrs = (p: number): number[] => {
    const x = p % w;
    const y = (p - x) / w;
    return [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
  };
  let ring: number[] = [];
  for (let p = 0; p < want.length; p++) if (want[p] && nbrs(p).some((q) => q >= 0 && have[q])) ring.push(p);
  while (ring.length > 0) {
    const values: [number, number, number, number][] = [];
    for (const p of ring) {
      const x = p % w;
      const y = (p - x) / w;
      let r = 0, g = 0, b = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx;
        const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const q = yy * w + xx;
        if (!have[q]) continue;
        const wt = dx === 0 || dy === 0 ? 2 : 1;
        r += (data[q * 4] as number) * wt;
        g += (data[q * 4 + 1] as number) * wt;
        b += (data[q * 4 + 2] as number) * wt;
        c += wt;
      }
      values.push([p, r / c, g / c, b / c]);
    }
    const next: number[] = [];
    const seen = new Set<number>();
    for (const [p, r, g, b] of values) {
      data[p * 4] = r;
      data[p * 4 + 1] = g;
      data[p * 4 + 2] = b;
      data[p * 4 + 3] = 255;
      have[p] = 1;
      want[p] = 0;
      filled.push(p);
    }
    for (const p of ring) for (const q of nbrs(p)) if (q >= 0 && want[q] && !seen.has(q)) {
      seen.add(q);
      next.push(q);
    }
    ring = next;
  }
  if (filled.length === 0) return { w, h, data };
  // Relax the patch towards a smooth surface: each filled pixel moves to the average of its neighbours, updated in place, which
  // removes the streaks the ring-by-ring fill leaves. Known pixels never change, and pixels that are not part of the layer are not used.
  const iterations = Math.min(120, Math.max(30, Math.round(Math.sqrt(filled.length))));
  const cur = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) for (let k = 0; k < 3; k++) cur[i * 3 + k] = data[i * 4 + k] as number;
  // Neighbour offsets (in floats) of every filled pixel, worked out once: a neighbour that is not part of the layer is replaced by the pixel itself.
  const nb = new Int32Array(filled.length * 4);
  for (let f = 0; f < filled.length; f++) {
    const p = filled[f] as number;
    const x = p % w;
    const cand = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, p >= w ? p - w : -1, p < w * (h - 1) ? p + w : -1];
    for (let k = 0; k < 4; k++) {
      const q = cand[k] as number;
      nb[f * 4 + k] = (q >= 0 && have[q] ? q : p) * 3;
    }
  }
  for (let it = 0; it < iterations; it++) {
    for (let f = 0; f < filled.length; f++) {
      const o = (filled[f] as number) * 3;
      const l = nb[f * 4] as number;
      const r = nb[f * 4 + 1] as number;
      const u = nb[f * 4 + 2] as number;
      const d = nb[f * 4 + 3] as number;
      cur[o] = ((cur[l] as number) + (cur[r] as number) + (cur[u] as number) + (cur[d] as number)) / 4;
      cur[o + 1] = ((cur[l + 1] as number) + (cur[r + 1] as number) + (cur[u + 1] as number) + (cur[d + 1] as number)) / 4;
      cur[o + 2] = ((cur[l + 2] as number) + (cur[r + 2] as number) + (cur[u + 2] as number) + (cur[d + 2] as number)) / 4;
    }
  }
  // Put the grain back: measure how rough the known pixels beside the hole are, and add noise of the same strength.
  let sum = 0;
  let n = 0;
  const near = new Set<number>();
  for (const p of filled) {
    const x = p % w;
    const y = (p - x) / w;
    for (let dy = -4; dy <= 4; dy += 2) for (let dx = -4; dx <= 4; dx += 2) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 1 && yy >= 1 && xx < w - 1 && yy < h - 1 && known[yy * w + xx]) near.add(yy * w + xx);
    }
  }
  for (const q of near) {
    let nb = 0;
    for (const o of [q - 1, q + 1, q - w, q + w]) nb += data[o * 4 + 1] as number;
    const resid = (data[q * 4 + 1] as number) - nb / 4;
    sum += resid * resid;
    n++;
  }
  const sigma = n > 0 ? Math.sqrt(sum / n) / 1.1 : 0;
  let seed = 12345;
  const rnd = (): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (const p of filled) {
    const g = (rnd() - 0.5) * 2 * Math.sqrt(3) * sigma;
    for (let k = 0; k < 3; k++) data[p * 4 + k] = (cur[p * 3 + k] as number) + g;
  }
  return { w, h, data };
}

/**
 * The image with `pad` pixels added on every side by mirroring it across its edge, so a layer can drift or a part can reach past the
 * edge without showing smeared pixels: the mirrored texture looks like more of the picture.
 */
export function padEdges(src: Raster, pad: number): Raster {
  if (pad <= 0) return src;
  const w = src.w + 2 * pad;
  const h = src.h + 2 * pad;
  const data = new Uint8ClampedArray(w * h * 4);
  const mirror = (v: number, n: number): number => {
    // Reflect into 0..n-1 repeatedly, so a pad larger than the image still works.
    const period = 2 * n;
    let m = ((v % period) + period) % period;
    if (m >= n) m = period - 1 - m;
    return m;
  };
  for (let y = 0; y < h; y++) {
    const sy = mirror(y - pad, src.h);
    for (let x = 0; x < w; x++) {
      const sx = mirror(x - pad, src.w);
      data.set(src.data.subarray((sy * src.w + sx) * 4, (sy * src.w + sx) * 4 + 4), (y * w + x) * 4);
    }
  }
  return { w, h, data };
}
