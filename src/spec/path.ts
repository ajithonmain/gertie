export type Vec2 = [number, number];

/**
 * One subpath in Lottie bezier form. `i` and `o` are tangents relative to their vertex.
 */
export interface Subpath {
  closed: boolean;
  v: Vec2[];
  i: Vec2[];
  o: Vec2[];
}

export class PathSyntaxError extends Error {
  constructor(
    message: string,
    readonly position: number,
  ) {
    super(message);
    this.name = "PathSyntaxError";
  }
}

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

interface Scanner {
  s: string;
  p: number;
}

function skipSep(sc: Scanner): void {
  while (sc.p < sc.s.length) {
    const c = sc.s.charCodeAt(sc.p);
    if (c === 32 || c === 9 || c === 10 || c === 13 || c === 44) sc.p++;
    else break;
  }
}

function readNumber(sc: Scanner): number {
  skipSep(sc);
  const re = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
  re.lastIndex = sc.p;
  const m = re.exec(sc.s);
  if (!m) throw new PathSyntaxError(`Expected a number at position ${sc.p}`, sc.p);
  sc.p += m[0].length;
  return parseFloat(m[0]);
}

function readFlag(sc: Scanner): number {
  skipSep(sc);
  const c = sc.s[sc.p];
  if (c !== "0" && c !== "1") throw new PathSyntaxError(`Expected arc flag 0 or 1 at position ${sc.p}`, sc.p);
  sc.p++;
  return c === "1" ? 1 : 0;
}

function peekNumberStart(sc: Scanner): boolean {
  skipSep(sc);
  const c = sc.s[sc.p];
  return c !== undefined && /[0-9+\-.]/.test(c);
}

interface Builder {
  subpaths: Subpath[];
  cur: Subpath | null;
  x: number;
  y: number;
  sx: number;
  sy: number;
}

function startSubpath(b: Builder, x: number, y: number): void {
  finishSubpath(b);
  b.cur = { closed: false, v: [[x, y]], i: [[0, 0]], o: [[0, 0]] };
}

function finishSubpath(b: Builder): void {
  if (b.cur && b.cur.v.length >= 2) b.subpaths.push(b.cur);
  b.cur = null;
}

function ensureSubpath(b: Builder): Subpath {
  if (!b.cur) startSubpath(b, b.x, b.y);
  return b.cur as Subpath;
}

function cubicTo(b: Builder, c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): void {
  const sp = ensureSubpath(b);
  const last = sp.v.length - 1;
  sp.o[last] = [c1x - b.x, c1y - b.y];
  sp.v.push([x, y]);
  sp.i.push([c2x - x, c2y - y]);
  sp.o.push([0, 0]);
  b.x = x;
  b.y = y;
}

function arcTo(b: Builder, rxIn: number, ryIn: number, rotDeg: number, large: number, sweep: number, x: number, y: number): void {
  const x0 = b.x;
  const y0 = b.y;
  if (x0 === x && y0 === y) return;
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    cubicTo(b, x0, y0, x, y, x, y);
    return;
  }
  const phi = (rotDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (x0 - x) / 2;
  const dy2 = (y0 - y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = den === 0 ? 0 : Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number => {
    const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  const n = Math.max(1, Math.ceil(Math.abs(dTheta) / (Math.PI / 2) - 1e-9));
  const delta = dTheta / n;
  const k = (4 / 3) * Math.tan(delta / 4);
  let t = theta1;
  for (let idx = 0; idx < n; idx++) {
    const cosT1 = Math.cos(t);
    const sinT1 = Math.sin(t);
    const cosT2 = Math.cos(t + delta);
    const sinT2 = Math.sin(t + delta);
    const pt = (ex: number, ey: number): Vec2 => [
      cosPhi * rx * ex - sinPhi * ry * ey + cx,
      sinPhi * rx * ex + cosPhi * ry * ey + cy,
    ];
    const dv = (ex: number, ey: number): Vec2 => [
      cosPhi * rx * ex - sinPhi * ry * ey,
      sinPhi * rx * ex + cosPhi * ry * ey,
    ];
    const d1 = dv(-sinT1, cosT1);
    const d2 = dv(-sinT2, cosT2);
    const p2 = idx === n - 1 ? ([x, y] as Vec2) : pt(cosT2, sinT2);
    const c1: Vec2 = [b.x + k * d1[0], b.y + k * d1[1]];
    const c2: Vec2 = [p2[0] - k * d2[0], p2[1] - k * d2[1]];
    cubicTo(b, c1[0], c1[1], c2[0], c2[1], p2[0], p2[1]);
    t += delta;
  }
}

function closeSubpath(b: Builder): void {
  const sp = b.cur;
  if (sp && sp.v.length >= 2) {
    sp.closed = true;
    const first = sp.v[0] as Vec2;
    const last = sp.v[sp.v.length - 1] as Vec2;
    if (Math.abs(first[0] - last[0]) <= 0.001 && Math.abs(first[1] - last[1]) <= 0.001) {
      sp.i[0] = sp.i[sp.v.length - 1] as Vec2;
      sp.v.pop();
      sp.i.pop();
      sp.o.pop();
    }
    finishSubpath(b);
  } else {
    b.cur = null;
  }
  b.x = b.sx;
  b.y = b.sy;
}

/**
 * Parses an SVG path string into subpaths of cubic bezier segments.
 * Supports M m L l H h V v C c S s Q q T t A a Z z.
 */
export function parsePath(d: string): Subpath[] {
  const sc: Scanner = { s: d, p: 0 };
  const b: Builder = { subpaths: [], cur: null, x: 0, y: 0, sx: 0, sy: 0 };
  let cmd = "";
  let prevCmd = "";
  let lastC2: Vec2 | null = null;
  let lastQ: Vec2 | null = null;
  let first = true;

  for (;;) {
    skipSep(sc);
    if (sc.p >= sc.s.length) break;
    const ch = sc.s[sc.p] as string;
    if (/[a-zA-Z]/.test(ch)) {
      if (!(ch.toLowerCase() in ARGS)) throw new PathSyntaxError(`Unknown path command '${ch}' at position ${sc.p}`, sc.p);
      cmd = ch;
      sc.p++;
      if (first && cmd !== "M" && cmd !== "m") throw new PathSyntaxError(`Path must start with M, found '${ch}' at position ${sc.p - 1}`, sc.p - 1);
    } else {
      if (cmd === "" ) throw new PathSyntaxError(`Path must start with a command, found '${ch}' at position ${sc.p}`, sc.p);
      if (cmd === "z" || cmd === "Z" || !peekNumberStart(sc)) throw new PathSyntaxError(`Unexpected '${ch}' at position ${sc.p}`, sc.p);
      // implicit repeat; M becomes L
      if (cmd === "M") cmd = "L";
      else if (cmd === "m") cmd = "l";
    }
    first = false;
    const rel = cmd === cmd.toLowerCase();
    const lc = cmd.toLowerCase();
    const ox = rel ? b.x : 0;
    const oy = rel ? b.y : 0;
    let c2: Vec2 | null = null;
    let q: Vec2 | null = null;

    switch (lc) {
      case "m": {
        const x = readNumber(sc) + ox;
        const y = readNumber(sc) + oy;
        startSubpath(b, x, y);
        b.x = b.sx = x;
        b.y = b.sy = y;
        break;
      }
      case "l": {
        const x = readNumber(sc) + ox;
        const y = readNumber(sc) + oy;
        cubicTo(b, b.x, b.y, x, y, x, y);
        break;
      }
      case "h": {
        const x = readNumber(sc) + ox;
        cubicTo(b, b.x, b.y, x, b.y, x, b.y);
        break;
      }
      case "v": {
        const y = readNumber(sc) + oy;
        cubicTo(b, b.x, b.y, b.x, y, b.x, y);
        break;
      }
      case "c": {
        const x1 = readNumber(sc) + ox;
        const y1 = readNumber(sc) + oy;
        const x2 = readNumber(sc) + ox;
        const y2 = readNumber(sc) + oy;
        const x = readNumber(sc) + ox;
        const y = readNumber(sc) + oy;
        cubicTo(b, x1, y1, x2, y2, x, y);
        c2 = [x2, y2];
        break;
      }
      case "s": {
        const x2 = readNumber(sc) + ox;
        const y2 = readNumber(sc) + oy;
        const x = readNumber(sc) + ox;
        const y = readNumber(sc) + oy;
        const prevCubic: boolean = "csCS".includes(prevCmd) && lastC2 !== null;
        const x1: number = prevCubic ? 2 * b.x - (lastC2 as Vec2)[0] : b.x;
        const y1: number = prevCubic ? 2 * b.y - (lastC2 as Vec2)[1] : b.y;
        cubicTo(b, x1, y1, x2, y2, x, y);
        c2 = [x2, y2];
        break;
      }
      case "q": {
        const qx = readNumber(sc) + ox;
        const qy = readNumber(sc) + oy;
        const x = readNumber(sc) + ox;
        const y = readNumber(sc) + oy;
        cubicTo(b, b.x + (2 / 3) * (qx - b.x), b.y + (2 / 3) * (qy - b.y), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
        q = [qx, qy];
        break;
      }
      case "t": {
        const x = readNumber(sc) + ox;
        const y = readNumber(sc) + oy;
        const prevQuad: boolean = "qtQT".includes(prevCmd) && lastQ !== null;
        const qx: number = prevQuad ? 2 * b.x - (lastQ as Vec2)[0] : b.x;
        const qy: number = prevQuad ? 2 * b.y - (lastQ as Vec2)[1] : b.y;
        cubicTo(b, b.x + (2 / 3) * (qx - b.x), b.y + (2 / 3) * (qy - b.y), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
        q = [qx, qy];
        break;
      }
      case "a": {
        const rx = readNumber(sc);
        const ry = readNumber(sc);
        const rot = readNumber(sc);
        const large = readFlag(sc);
        const sweep = readFlag(sc);
        const x = readNumber(sc) + ox;
        const y = readNumber(sc) + oy;
        arcTo(b, rx, ry, rot, large, sweep, x, y);
        break;
      }
      case "z": {
        closeSubpath(b);
        break;
      }
    }
    prevCmd = cmd;
    lastC2 = c2;
    lastQ = q;
  }
  finishSubpath(b);
  if (b.subpaths.length === 0) throw new PathSyntaxError("Path has no drawable segments", 0);
  return b.subpaths;
}

/** A rounded or plain rectangle centred on (cx, cy) as subpaths. */
export function rectSubpaths(cx: number, cy: number, w: number, h: number, radius: number): Subpath[] {
  const l = cx - w / 2;
  const t = cy - h / 2;
  const r = Math.min(Math.max(radius, 0), w / 2, h / 2);
  if (r === 0) return parsePath(`M${l} ${t}H${l + w}V${t + h}H${l}Z`);
  return parsePath(
    `M${l + r} ${t}H${l + w - r}A${r} ${r} 0 0 1 ${l + w} ${t + r}V${t + h - r}A${r} ${r} 0 0 1 ${l + w - r} ${t + h}H${l + r}A${r} ${r} 0 0 1 ${l} ${t + h - r}V${t + r}A${r} ${r} 0 0 1 ${l + r} ${t}Z`,
  );
}

/** An ellipse as four cubic segments with control distance 0.5523 times the radius. */
export function ellipseSubpath(cx: number, cy: number, rx: number, ry: number): Subpath {
  const k = 0.5523;
  return {
    closed: true,
    v: [
      [cx, cy - ry],
      [cx + rx, cy],
      [cx, cy + ry],
      [cx - rx, cy],
    ],
    i: [
      [-k * rx, 0],
      [0, -k * ry],
      [k * rx, 0],
      [0, k * ry],
    ],
    o: [
      [k * rx, 0],
      [0, k * ry],
      [-k * rx, 0],
      [0, -k * ry],
    ],
  };
}

/** Structure signature used to check that two paths can be morphed into each other. */
export function pathStructure(sp: readonly Subpath[]): string {
  return sp.map((s) => `${s.closed ? "closed" : "open"}:${s.v.length}`).join(",");
}

/** Evaluates a subpath at parameter u in [0, segments], used by tests and the sampler. */
export function samplePath(sp: Subpath, perSegment = 16): Vec2[] {
  const pts: Vec2[] = [];
  const n = sp.v.length;
  const segs = sp.closed ? n : n - 1;
  for (let s = 0; s < segs; s++) {
    const a = sp.v[s] as Vec2;
    const bI = (s + 1) % n;
    const bv = sp.v[bI] as Vec2;
    const c1: Vec2 = [a[0] + (sp.o[s] as Vec2)[0], a[1] + (sp.o[s] as Vec2)[1]];
    const c2: Vec2 = [bv[0] + (sp.i[bI] as Vec2)[0], bv[1] + (sp.i[bI] as Vec2)[1]];
    for (let k = 0; k <= perSegment; k++) {
      const t = k / perSegment;
      const mt = 1 - t;
      pts.push([
        mt * mt * mt * a[0] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * bv[0],
        mt * mt * mt * a[1] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * bv[1],
      ]);
    }
  }
  return pts;
}
