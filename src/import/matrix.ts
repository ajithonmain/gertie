/** An affine matrix [a, b, c, d, e, f] as in SVG: x' = a x + c y + e, y' = b x + d y + f. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** `m1 * m2`: apply m2 first, then m1. */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function apply(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

/** Applies only the linear part, for direction vectors such as bezier tangents. */
export function applyLinear(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y];
}

export const det = (m: Matrix): number => m[0] * m[3] - m[1] * m[2];

/** The mean scale of the matrix, used for stroke widths, dashes and gradient radii. */
export const meanScale = (m: Matrix): number => Math.sqrt(Math.abs(det(m)));

/** True when the matrix only translates and scales (no rotation or skew), so a rect or ellipse stays one. */
export function isAxisAligned(m: Matrix): boolean {
  return Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9 && m[0] > 0 && m[3] > 0;
}

/** Parses a `transform` attribute. Returns undefined when it cannot be read. */
export function parseTransform(s: string | undefined): Matrix | undefined {
  if (s === undefined || s.trim() === "") return IDENTITY;
  let m: Matrix = IDENTITY;
  const re = /([a-zA-Z]+)\s*\(([^)]*)\)/g;
  for (let hit = re.exec(s); hit !== null; hit = re.exec(s)) {
    const args = (hit[2] as string).split(/[\s,]+/).filter((t) => t !== "").map(Number);
    if (args.some((v) => !Number.isFinite(v))) return undefined;
    const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = args;
    let t: Matrix;
    switch (hit[1]) {
      case "matrix":
        if (args.length !== 6) return undefined;
        t = [a, b, c, d, e, f];
        break;
      case "translate":
        t = [1, 0, 0, 1, a, args.length > 1 ? b : 0];
        break;
      case "scale":
        t = [a, 0, 0, args.length > 1 ? b : a, 0, 0];
        break;
      case "rotate": {
        const r = (a * Math.PI) / 180;
        const rot: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0];
        t = args.length === 3 ? multiply(multiply([1, 0, 0, 1, b, c], rot), [1, 0, 0, 1, -b, -c]) : rot;
        break;
      }
      case "skewX":
        t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
        break;
      case "skewY":
        t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        return undefined;
    }
    m = multiply(m, t);
  }
  // Anything left over that is not whitespace or a separator means the attribute was not understood.
  if (s.replace(re, "").replace(/[\s,]/g, "") !== "") return undefined;
  return m;
}
