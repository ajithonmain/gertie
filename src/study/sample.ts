/** A pixel position in source pixels, from the top-left corner. */
export interface Point {
  x: number;
  y: number;
}

export interface Sampled extends Point {
  /** Six hex digits with a leading hash. */
  hex: string;
  /** Mean opacity of the block from 0 to 1. Only present when the block is not fully opaque. */
  alpha?: number;
}

/** Reads "x,y" as two whole numbers of 0 or more. Undefined when it is anything else. */
export function parsePoint(text: string): Point | undefined {
  const m = /^\s*(\d+)\s*,\s*(\d+)\s*$/.exec(text);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : undefined;
}

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/**
 * The colour at each point: the mean of the 3 by 3 block around it, which steps over antialiasing and compression noise.
 * `rgba` is straight 8-bit pixels, row by row. A block at the edge of the frame uses the pixels it has. Pure.
 */
export function sampleColours(rgba: Uint8Array, w: number, h: number, points: readonly Point[]): Sampled[] {
  return points.map((p) => {
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let y = Math.max(0, p.y - 1); y <= Math.min(h - 1, p.y + 1); y++) {
      for (let x = Math.max(0, p.x - 1); x <= Math.min(w - 1, p.x + 1); x++) {
        const i = (y * w + x) * 4;
        r += rgba[i] as number;
        g += rgba[i + 1] as number;
        b += rgba[i + 2] as number;
        a += rgba[i + 3] as number;
        n++;
      }
    }
    const out: Sampled = { x: p.x, y: p.y, hex: `#${hex2(r / n)}${hex2(g / n)}${hex2(b / n)}` };
    const alpha = a / n / 255;
    if (alpha < 0.999) out.alpha = Math.round(alpha * 1000) / 1000;
    return out;
  });
}
