import { mulberry32 } from "../presets/rigs.ts";

export interface Raster {
  w: number;
  h: number;
  /** RGBA, 4 bytes per pixel, straight (not premultiplied) alpha. */
  data: Uint8ClampedArray | Uint8Array;
}

export const TRANSPARENT = 0xffff;

const dist2 = (r: number, g: number, b: number, c: readonly number[]): number => (r - (c[0] as number)) ** 2 + (g - (c[1] as number)) ** 2 + (b - (c[2] as number)) ** 2;

export interface QuantizeOptions {
  /** Most colours to keep. */
  colors: number;
  /** Pixels with alpha below this count as transparent. */
  alphaCutoff: number;
  /** Colours (as [r, g, b]) to treat as background and make transparent, with the distance within which a pixel matches. */
  drop: { rgb: [number, number, number]; tolerance: number }[];
}

export interface Quantized {
  labels: Uint16Array;
  palette: [number, number, number][];
}

/**
 * Reduces an image to a small palette with k-means, seeded deterministically (k-means++ with a fixed generator),
 * and returns the palette index of every pixel. Transparent and dropped pixels get TRANSPARENT.
 */
export function quantize(img: Raster, opts: QuantizeOptions): Quantized {
  const { w, h, data } = img;
  const n = w * h;
  const labels = new Uint16Array(n).fill(TRANSPARENT);
  const solid = new Uint8Array(n);
  const samples: number[] = [];
  const step = Math.max(1, Math.floor(Math.sqrt(n / 40000)));
  for (let i = 0; i < n; i++) {
    const r = data[i * 4] as number;
    const g = data[i * 4 + 1] as number;
    const b = data[i * 4 + 2] as number;
    if ((data[i * 4 + 3] as number) < opts.alphaCutoff) continue;
    if (opts.drop.some((d) => dist2(r, g, b, d.rgb) <= d.tolerance * d.tolerance)) continue;
    solid[i] = 1;
    const x = i % w;
    const y = (i - x) / w;
    if (x % step === 0 && y % step === 0) samples.push(r, g, b);
  }
  const count = samples.length / 3;
  if (count === 0) return { labels, palette: [] };

  const k = Math.max(1, Math.min(opts.colors, count));
  const rand = mulberry32(1);
  const cents: number[][] = [];
  const first = Math.floor(rand() * count);
  cents.push([samples[first * 3] as number, samples[first * 3 + 1] as number, samples[first * 3 + 2] as number]);
  const nearest = new Float64Array(count).fill(Infinity);
  while (cents.length < k) {
    const last = cents[cents.length - 1] as number[];
    let total = 0;
    for (let i = 0; i < count; i++) {
      const d = dist2(samples[i * 3] as number, samples[i * 3 + 1] as number, samples[i * 3 + 2] as number, last);
      if (d < (nearest[i] as number)) nearest[i] = d;
      total += nearest[i] as number;
    }
    if (total <= 0) break;
    let pick = rand() * total;
    let idx = 0;
    for (; idx < count - 1; idx++) {
      pick -= nearest[idx] as number;
      if (pick <= 0) break;
    }
    cents.push([samples[idx * 3] as number, samples[idx * 3 + 1] as number, samples[idx * 3 + 2] as number]);
  }
  for (let iter = 0; iter < 8; iter++) {
    const sum = cents.map(() => [0, 0, 0, 0]);
    for (let i = 0; i < count; i++) {
      const r = samples[i * 3] as number;
      const g = samples[i * 3 + 1] as number;
      const b = samples[i * 3 + 2] as number;
      let best = 0;
      let bd = Infinity;
      for (let c = 0; c < cents.length; c++) {
        const d = dist2(r, g, b, cents[c] as number[]);
        if (d < bd) {
          bd = d;
          best = c;
        }
      }
      const s = sum[best] as number[];
      s[0] = (s[0] as number) + r;
      s[1] = (s[1] as number) + g;
      s[2] = (s[2] as number) + b;
      s[3] = (s[3] as number) + 1;
    }
    let moved = 0;
    sum.forEach((s, c) => {
      if ((s[3] as number) === 0) return;
      const nc = [(s[0] as number) / (s[3] as number), (s[1] as number) / (s[3] as number), (s[2] as number) / (s[3] as number)];
      moved += dist2(nc[0] as number, nc[1] as number, nc[2] as number, cents[c] as number[]);
      cents[c] = nc;
    });
    if (moved < 0.5) break;
  }
  // Merge centroids that are nearly the same colour, so one flat colour is not split in two.
  const palette: [number, number, number][] = [];
  const remap: number[] = [];
  for (const c of cents) {
    const hit = palette.findIndex((p) => dist2(p[0], p[1], p[2], c) < 10 * 10);
    if (hit >= 0) remap.push(hit);
    else {
      remap.push(palette.length);
      palette.push([c[0] as number, c[1] as number, c[2] as number]);
    }
  }
  for (let i = 0; i < n; i++) {
    if (!solid[i]) continue;
    const r = data[i * 4] as number;
    const g = data[i * 4 + 1] as number;
    const b = data[i * 4 + 2] as number;
    let best = 0;
    let bd = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const d = dist2(r, g, b, palette[c] as number[]);
      if (d < bd) {
        bd = d;
        best = c;
      }
    }
    labels[i] = best;
  }
  return { labels, palette };
}
