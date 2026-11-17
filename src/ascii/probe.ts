/**
 * Reading an ASCII reference: the grid, the colours and the kind of glyph of one frame of a clip or picture.
 * Pure: every function takes straight 8-bit RGBA pixels, row by row, and does no file or process access.
 * The rules and how often they are right are in docs/12-ascii.md, part 6.
 */

export type RGB = readonly [number, number, number];

export interface ProbeColor {
  hex: string;
  /** Fraction of the counted cells (or ink pixels, with no grid) that have this colour, 0 to 1. */
  share: number;
}

export interface FrameProbe {
  /** Cell pitch in source pixels, or null when the picture is not on a grid. */
  pitch: { x: number; y: number } | null;
  /** Columns and rows that fit in the picture at that pitch, or null with no pitch. */
  cols: number | null;
  rows: number | null;
  /** Height over width of a cell, as `style.cellAspect` takes it, or null with no pitch. */
  cellAspect: number | null;
  /** The most common colour of the picture. */
  background: string;
  /** Present when the top and bottom (or left and right) edges differ: the picture probably has a gradient behind the grid. */
  gradient: { from: string; to: string; angle: number } | null;
  /** The most common foreground colours, most common first, at most five. */
  colors: ProbeColor[];
  /** "dot" when the cells are filled circles or squares of different sizes, "text" when they are characters, null with no grid or no ink. */
  glyph: "text" | "dot" | null;
  /** The mean asymmetry of the inked cells (0 is a perfectly symmetric dot), which decided `glyph`. */
  asymmetry: number | null;
  /** Strength of the pitch along x and y, 0 to 1 (see `profilePeriod`). */
  strength: { x: number; y: number };
  /** Why the grid or the glyph is null, with what to do instead; null when both were found. */
  note: string | null;
}

/** Smallest and largest pitch searched for, in pixels. */
export const PITCH_MIN = 3;
export const PITCH_MAX = 80;
/** Periods up to this are read from a profile high-passed over a narrower window (see `profilePeriod`). */
const PITCH_MID = 40;
/** A pitch whose comb strength is under this means the picture is not on a grid. Measured on Gertie-made frames, see docs/12-ascii.md part 6. */
export const PITCH_STRENGTH = 0.3;
/** Mean asymmetry under which the cells are taken to be dots. Measured on Gertie-made frames, see docs/12-ascii.md part 6. */
export const DOT_ASYMMETRY = 0.15;
/** Below this cell size in pixels, dots and characters cannot be told apart, and `glyph` is null. */
export const GLYPH_MIN_PITCH = 8;
/** With fewer inked cells than this the frame is too sparse for a grid to be trusted, and `pitch` is null. */
export const MIN_INKED_CELLS = 40;
/** Colour distance (of 441) from the background above which a pixel is ink. */
const INK = 48;

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
export const toHex = (c: RGB): string => `#${hex2(c[0])}${hex2(c[1])}${hex2(c[2])}`;
const dist = (a: RGB, b: RGB): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The most common colour, counted in buckets of 8 levels per channel and reported as the mean of its bucket. */
export function dominantColor(rgba: Uint8Array, w: number, h: number, region?: { x0: number; y0: number; x1: number; y1: number }): RGB {
  const r = region ?? { x0: 0, y0: 0, x1: w, y1: h };
  const count = new Map<number, [number, number, number, number]>();
  for (let y = r.y0; y < r.y1; y++) {
    for (let x = r.x0; x < r.x1; x++) {
      const i = (y * w + x) * 4;
      const R = rgba[i] as number;
      const G = rgba[i + 1] as number;
      const B = rgba[i + 2] as number;
      const k = ((R >> 5) << 6) | ((G >> 5) << 3) | (B >> 5);
      const e = count.get(k);
      if (e) {
        e[0]++;
        e[1] += R;
        e[2] += G;
        e[3] += B;
      } else count.set(k, [1, R, G, B]);
    }
  }
  let best: [number, number, number, number] = [1, 0, 0, 0];
  for (const e of count.values()) if (e[0] > best[0] || best[1] + best[2] + best[3] === 0) best = e;
  return [best[1] / best[0], best[2] / best[0], best[3] / best[0]];
}

/**
 * The background: the colour of the outermost ring of pixels when at least 60 percent of the ring is that colour, else the most
 * common colour of the picture. Large dots can cover most of a frame, so the most common colour alone can be ink; the edge of an
 * ASCII frame is margin or the gap between cells.
 */
export function backgroundOf(rgba: Uint8Array, w: number, h: number): RGB {
  const ring: number[] = [];
  const add = (x: number, y: number): void => {
    const i = (y * w + x) * 4;
    ring.push(rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number, 255);
  };
  for (let x = 0; x < w; x++) {
    add(x, 0);
    if (h > 1) add(x, h - 1);
  }
  for (let y = 1; y < h - 1; y++) {
    add(0, y);
    if (w > 1) add(w - 1, y);
  }
  const px = Uint8Array.from(ring);
  const n = ring.length / 4;
  const edge = dominantColor(px, n, 1);
  let near = 0;
  for (let i = 0; i < n; i++) if (dist([px[i * 4] as number, px[i * 4 + 1] as number, px[i * 4 + 2] as number], edge) < 24) near++;
  return near >= 0.6 * n ? edge : dominantColor(rgba, w, h);
}

/** Ink per pixel: the colour distance from the background, 0 under the ink threshold. */
function inkMap(rgba: Uint8Array, w: number, h: number, bg: (x: number, y: number) => RGB): Float32Array {
  const ink = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = dist([rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number], bg(x, y));
      ink[y * w + x] = d < INK ? 0 : d;
    }
  }
  return ink;
}

/** The profile less its moving average over `2 * half + 1` pixels: a large shape is a slow bump, not cells. */
function highPass(profile: Float64Array | readonly number[], half: number): Float64Array {
  const n = profile.length;
  const pre = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) pre[i + 1] = (pre[i] as number) + (profile[i] as number);
  const p = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - half);
    const b = Math.min(n, i + half + 1);
    p[i] = (profile[i] as number) - ((pre[b] as number) - (pre[a] as number)) / (b - a);
  }
  return p;
}

/** How strongly the profile repeats every `period` pixels: the magnitude of its Fourier component at that period over its total. 0 to 1. */
function comb(p: Float64Array, total: number, period: number): number {
  const step = (2 * Math.PI) / period;
  const dc = Math.cos(step);
  const ds = Math.sin(step);
  let c = 1;
  let s = 0;
  let re = 0;
  let im = 0;
  for (let x = 0; x < p.length; x++) {
    const v = p[x] as number;
    re += v * c;
    im += v * s;
    const nc = c * dc - s * ds;
    s = s * dc + c * ds;
    c = nc;
  }
  return Math.hypot(re, im) / total;
}

/**
 * The period of a profile (column or row sums of ink): the period between `PITCH_MIN` and `PITCH_MAX` pixels at which the
 * high-passed profile has its strongest Fourier component, found on a scan fine enough that the phase cannot slip by a quarter
 * period across the picture; then the largest whole multiple of it that has at least 0.35 of that strength, is at least 1.5 times
 * as strong as the periods half a step either side (a sharp peak, not the broad rise of a large shape) and leaves six periods in
 * the ink (the strongest can be a harmonic of the cell); then refined with a parabola. Null when that strength is under `PITCH_STRENGTH`, or the ink spans
 * fewer than six periods. The design's autocorrelation peak was tried first and found nothing on sparse frames; see
 * docs/12-ascii.md, part 6.
 */
export function profilePeriod(profile: Float64Array | readonly number[]): { period: number; strength: number } | null {
  const n = profile.length;
  const hi = Math.min(PITCH_MAX, n / 4);
  if (hi < PITCH_MIN) return null;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if ((profile[i] as number) > 0) {
      if (first < 0) first = i;
      last = i;
    }
  }
  if (first < 0) return null;
  // Two high-passes: a window just over 40 pixels for periods up to 40, so the bump of a small object does not drown its cells, and
  // a window just over `PITCH_MAX` for larger periods, so those cells survive the filter.
  const bands = [PITCH_MID, PITCH_MAX].map((top) => {
    const p = highPass(profile, top + 1);
    let total = 0;
    for (let i = 0; i < n; i++) total += Math.abs(p[i] as number);
    return { top, p, total };
  });
  if (!((bands[0] as { total: number }).total > 0)) return null;
  const scan: { period: number; strength: number }[] = [];
  for (let period = PITCH_MIN; period <= hi; period += Math.max(0.0005, (period * period) / (8 * n))) {
    const b = (period <= PITCH_MID ? bands[0] : bands[1]) as { p: Float64Array; total: number };
    scan.push({ period, strength: comb(b.p, b.total, period) });
  }
  let top = 0;
  for (let i = 1; i < scan.length; i++) if ((scan[i] as { strength: number }).strength > (scan[top] as { strength: number }).strength) top = i;
  // Thin strokes put much of a cell's energy in its harmonics, so the strongest period can be the cell divided by a whole number.
  // The cell is the largest whole multiple of it that is still strong: a period that is not a multiple of the cell has no energy.
  const strongest = scan[top] as { period: number; strength: number };
  // Strongest scan entry within 2 percent of `period`, as an index, or -1.
  const near = (period: number): number => {
    let m = -1;
    for (let i = 0; i < scan.length; i++) {
      const e = scan[i] as { period: number; strength: number };
      if (e.period >= period * 0.98 && e.period <= period * 1.02 && (m < 0 || e.strength > (scan[m] as { strength: number }).strength)) m = i;
    }
    return m;
  };
  const strengthAt = (period: number): number => {
    const m = near(period);
    return m < 0 ? 0 : (scan[m] as { strength: number }).strength;
  };
  let at = top;
  for (let k = 2; k * strongest.period <= hi * 1.02 && last - first + 1 >= 6 * k * strongest.period; k++) {
    const m = near(k * strongest.period);
    if (m < 0) continue;
    const v = (scan[m] as { strength: number }).strength;
    // A real cell is a sharp peak; a large shape gives a broad rise that is as strong half a period either side.
    const side = Math.max(strengthAt((k - 0.5) * strongest.period), strengthAt((k + 0.5) * strongest.period));
    if (v >= 0.35 * strongest.strength && v >= 1.5 * side) at = m;
  }
  const best = scan[at] as { period: number; strength: number };
  let period = best.period;
  const a = scan[at - 1];
  const b = scan[at + 1];
  if (a && b) {
    const den = a.strength - 2 * best.strength + b.strength;
    if (den < 0) {
      const off = Math.max(-0.5, Math.min(0.5, (0.5 * (a.strength - b.strength)) / den));
      period = best.period + off * (off < 0 ? best.period - a.period : b.period - best.period);
    }
  }
  if (best.strength < PITCH_STRENGTH || last - first + 1 < 6 * period) return null;
  return { period, strength: best.strength };
}

/** The offset in 0 to `pitch` at which grid lines fall where the profile is lowest: the gaps between cells. */
function gridPhase(profile: Float64Array, pitch: number): number {
  let best = 0;
  let bestSum = Infinity;
  const steps = Math.max(1, Math.ceil(pitch));
  for (let s = 0; s < steps; s++) {
    const o = (s * pitch) / steps;
    let sum = 0;
    let n = 0;
    for (let x = o; x < profile.length; x += pitch) {
      sum += profile[Math.floor(x)] as number;
      n++;
    }
    if (n > 0 && sum / n < bestSum) {
      bestSum = sum / n;
      best = o;
    }
  }
  return best;
}

/**
 * Probes one frame. `rgba` is `w` by `h` straight 8-bit pixels.
 * - Background: `backgroundOf`; a gradient is reported when the top and bottom (or left and right) strips differ.
 * - Pitch: the column and row sums of ink (distance from the background), each read by `profilePeriod`.
 * - Colours: the strongest pixel of each inked cell, so antialiased edges and glow do not count; without a grid, every ink pixel.
 * - Glyph: the inked cells' mean mirror asymmetry (left-right and top-bottom, about the cell's ink centroid), against each cell's
 *   own corner colour. Null below `GLYPH_MIN_PITCH`.
 * - No grid (`pitch` null) when either axis has no period or fewer than `MIN_INKED_CELLS` cells have ink; `note` says why.
 */
export function probeFrame(rgba: Uint8Array, w: number, h: number): FrameProbe {
  const bg = backgroundOf(rgba, w, h);
  const strip = (x0: number, y0: number, x1: number, y1: number): RGB => dominantColor(rgba, w, h, { x0, y0, x1, y1 });
  const sh = Math.max(1, Math.round(h / 12));
  const sw = Math.max(1, Math.round(w / 12));
  const top = strip(0, 0, w, sh);
  const bottom = strip(0, h - sh, w, h);
  const left = strip(0, 0, sw, h);
  const right = strip(w - sw, 0, w, h);
  let gradient: FrameProbe["gradient"] = null;
  const vertical = dist(top, bottom);
  const horizontal = dist(left, right);
  if (Math.max(vertical, horizontal) > 24) gradient = vertical >= horizontal ? { from: toHex(top), to: toHex(bottom), angle: 180 } : { from: toHex(left), to: toHex(right), angle: 90 };
  // With a gradient the background of a pixel is interpolated along it, so the gradient is not ink.
  const bgAt = gradient === null ? (): RGB => bg : gradient.angle === 180 ? (_x: number, y: number): RGB => mix(top, bottom, h <= 1 ? 0 : y / (h - 1)) : (x: number): RGB => mix(left, right, w <= 1 ? 0 : x / (w - 1));
  const ink = inkMap(rgba, w, h, bgAt);
  const colX = new Float64Array(w);
  const rowY = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = ink[y * w + x] as number;
      colX[x] = (colX[x] as number) + v;
      rowY[y] = (rowY[y] as number) + v;
    }
  }
  const px = profilePeriod(colX);
  const py = profilePeriod(rowY);
  const strength = { x: px?.strength ?? 0, y: py?.strength ?? 0 };
  const none = (note: string): FrameProbe => ({ pitch: null, cols: null, rows: null, cellAspect: null, background: toHex(bg), gradient, colors: inkColors(rgba, w, h, ink), glyph: null, asymmetry: null, strength, note });
  const fix = "Probe another frame with --time, one where the picture is full, or count the cells on an enlarged crop (gertie grid <frame.png> --step 50).";
  if (!px || !py) return none(`No regular grid was found along ${!px && !py ? "either axis" : !px ? "x" : "y"}. ${fix}`);
  const ox = gridPhase(colX, px.period);
  const oy = gridPhase(rowY, py.period);
  const cells = cellStats(rgba, w, h, ink, px.period, py.period, ox, oy);
  if (cells.inked < MIN_INKED_CELLS) return none(`Only ${cells.inked} cells have ink, too few to trust a grid. ${fix}`);
  const small = Math.min(px.period, py.period) < GLYPH_MIN_PITCH;
  const glyph = small || cells.asymmetry === null ? null : cells.asymmetry < DOT_ASYMMETRY ? "dot" : "text";
  return {
    pitch: { x: round2(px.period), y: round2(py.period) },
    cols: Math.floor(w / px.period + 0.25),
    rows: Math.floor(h / py.period + 0.25),
    cellAspect: round2(py.period / px.period),
    background: toHex(bg),
    gradient,
    colors: cells.colors.length > 0 ? cells.colors : inkColors(rgba, w, h, ink),
    glyph,
    asymmetry: cells.asymmetry === null ? null : round2(cells.asymmetry),
    strength,
    note: small ? `Cells of ${round2(Math.min(px.period, py.period))} pixels are too small to tell dots from characters. Look at an enlarged crop (gertie grid <frame.png> --step 50).` : null,
  };
}

const round2 = (n: number): number => Math.round(n * 100) / 100;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Counts colours in buckets of 8 levels per channel, merges buckets closer than 48, and returns the five largest with their shares. */
function topColors(samples: readonly RGB[]): ProbeColor[] {
  if (samples.length === 0) return [];
  const buckets = new Map<number, { n: number; sum: [number, number, number] }>();
  for (const c of samples) {
    const k = ((c[0] >> 5) << 6) | ((c[1] >> 5) << 3) | (c[2] >> 5);
    const e = buckets.get(k);
    if (e) {
      e.n++;
      e.sum[0] += c[0];
      e.sum[1] += c[1];
      e.sum[2] += c[2];
    } else buckets.set(k, { n: 1, sum: [c[0], c[1], c[2]] });
  }
  const list = [...buckets.values()].sort((a, b) => b.n - a.n);
  const merged: { n: number; sum: [number, number, number] }[] = [];
  for (const e of list) {
    const c: RGB = [e.sum[0] / e.n, e.sum[1] / e.n, e.sum[2] / e.n];
    const into = merged.find((m) => dist([m.sum[0] / m.n, m.sum[1] / m.n, m.sum[2] / m.n], c) < 48);
    if (into) {
      into.n += e.n;
      into.sum[0] += e.sum[0];
      into.sum[1] += e.sum[1];
      into.sum[2] += e.sum[2];
    } else merged.push({ n: e.n, sum: [...e.sum] });
  }
  merged.sort((a, b) => b.n - a.n);
  return merged.slice(0, 5).map((m) => ({ hex: toHex([m.sum[0] / m.n, m.sum[1] / m.n, m.sum[2] / m.n]), share: round2(m.n / samples.length) }));
}

function inkColors(rgba: Uint8Array, w: number, h: number, ink: Float32Array): ProbeColor[] {
  const s: RGB[] = [];
  for (let i = 0; i < w * h; i++) if ((ink[i] as number) > 0) s.push([rgba[i * 4] as number, rgba[i * 4 + 1] as number, rgba[i * 4 + 2] as number]);
  return topColors(s);
}

/** Per cell: the colour of its strongest ink pixel, and its mirror asymmetry measured against the cell's own corners. */
function cellStats(rgba: Uint8Array, w: number, h: number, ink: Float32Array, pw: number, ph: number, ox: number, oy: number): { colors: ProbeColor[]; asymmetry: number | null; inked: number } {
  const colors: RGB[] = [];
  const asym: number[] = [];
  const at = (x: number, y: number): RGB => {
    const i = (y * w + x) * 4;
    return [rgba[i] as number, rgba[i + 1] as number, rgba[i + 2] as number];
  };
  let maxInk = 0;
  const found: { x0: number; y0: number; x1: number; y1: number; strongest: number; sum: number }[] = [];
  for (let cy = oy; cy + ph <= h; cy += ph) {
    for (let cx = ox; cx + pw <= w; cx += pw) {
      const x0 = Math.round(cx);
      const y0 = Math.round(cy);
      const x1 = Math.round(cx + pw);
      const y1 = Math.round(cy + ph);
      let sum = 0;
      let strongest = -1;
      let best = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = ink[y * w + x] as number;
          sum += v;
          if (v > best) {
            best = v;
            strongest = y * w + x;
          }
        }
      }
      if (strongest < 0) continue;
      maxInk = Math.max(maxInk, sum);
      found.push({ x0, y0, x1, y1, strongest, sum });
    }
  }
  for (const c of found) {
    colors.push(at(c.strongest % w, Math.floor(c.strongest / w)));
    if (c.sum < 0.1 * maxInk) continue;
    // Ink against the cell's own corners, so a cell background is not mistaken for a symmetric dot.
    const corners = [at(c.x0, c.y0), at(c.x1 - 1, c.y0), at(c.x0, c.y1 - 1), at(c.x1 - 1, c.y1 - 1)];
    const mean = (k: 0 | 1 | 2): number => corners.reduce((s, q) => s + q[k], 0) / 4;
    const local: RGB = [mean(0), mean(1), mean(2)];
    const cw = c.x1 - c.x0;
    const chh = c.y1 - c.y0;
    const v = new Float64Array(cw * chh);
    let total = 0;
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const d = dist(at(c.x0 + x, c.y0 + y), local);
        v[y * cw + x] = d;
        total += d;
      }
    }
    if (total <= 0) continue;
    // Mirror about the cell's ink centroid, not its centre, so a grid phase off by a pixel does not make a dot look lopsided.
    let mx = 0;
    let my = 0;
    for (let y = 0; y < chh; y++) for (let x = 0; x < cw; x++) {
      const a = v[y * cw + x] as number;
      mx += a * x;
      my += a * y;
    }
    mx /= total;
    my /= total;
    const sample = (x: number, y: number): number => {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const fx = x - x0;
      const fy = y - y0;
      const g = (xx: number, yy: number): number => (xx < 0 || yy < 0 || xx >= cw || yy >= chh ? 0 : (v[yy * cw + xx] as number));
      return (1 - fy) * ((1 - fx) * g(x0, y0) + fx * g(x0 + 1, y0)) + fy * ((1 - fx) * g(x0, y0 + 1) + fx * g(x0 + 1, y0 + 1));
    };
    let diff = 0;
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        const a = v[y * cw + x] as number;
        diff += Math.abs(a - sample(2 * mx - x, y)) + Math.abs(a - sample(x, 2 * my - y));
      }
    }
    asym.push(diff / (4 * total));
  }
  return { colors: topColors(colors), asymmetry: asym.length === 0 ? null : asym.reduce((s, a) => s + a, 0) / asym.length, inked: found.length };
}

/**
 * The rate at which the picture changes: of the frame-to-frame steps in `frames` (small rasters, in order, at `fps`), the number
 * that differ in more than 0.05 percent of pixels (and at least 3), per second. An ASCII clip exported at 30 fps from a 10 fps animation gives about 10.
 */
export function changeRate(frames: readonly Uint8Array[], fps: number): number | null {
  if (frames.length < 2) return null;
  let changes = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1] as Uint8Array;
    const b = frames[i] as Uint8Array;
    let diff = 0;
    for (let j = 0; j < a.length; j += 4) if (Math.abs((a[j] as number) - (b[j] as number)) + Math.abs((a[j + 1] as number) - (b[j + 1] as number)) + Math.abs((a[j + 2] as number) - (b[j + 2] as number)) > 60) diff++;
    if (diff > Math.max(2, (a.length / 4) * 0.0005)) changes++;
  }
  return round2((changes * fps) / (frames.length - 1));
}
