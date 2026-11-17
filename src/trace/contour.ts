export type Pt = [number, number];

export interface Loop {
  points: Pt[];
  /** Signed area by the shoelace formula. The sign depends only on the direction the loop was walked. */
  area: number;
  /** How many other loops contain this one. Even is an outer boundary, odd is a hole. */
  depth: number;
}

export function signedArea(p: readonly Pt[]): number {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length] as Pt;
    const c = p[i] as Pt;
    a += c[0] * q[1] - q[0] * c[1];
  }
  return a / 2;
}

export function inside(p: readonly Pt[], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const a = p[i] as Pt;
    const b = p[j] as Pt;
    if (a[1] > y !== b[1] > y && x < ((b[0] - a[0]) * (y - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/**
 * Traces the boundary of the pixels where `mask` is 1 as closed loops of subpixel points, using marching squares
 * on a mask blurred by one [1 6 1] pass in each direction, at the 0.5 level. Coordinates are pixel units with the origin at the
 * top-left corner of the mask, and pixel (x, y) is centred on (x + 0.5, y + 0.5).
 */
export function traceMask(mask: Uint8Array, w: number, h: number, edges: { left?: boolean; right?: boolean; top?: boolean; bottom?: boolean } = {}): Loop[] {
  // Pad by 4 so every boundary is closed, then blur. On a side that is the edge of the image the first 2 pixels of padding repeat the
  // last pixel, so a region that reaches the edge continues past it and is cut by the canvas, with no inset and no rounded corners.
  // The other 2 are empty, so such a region still has a closed outer boundary, outside the canvas.
  const PAD = 4;
  const REP = 2;
  const pw = w + 2 * PAD;
  const ph = h + 2 * PAD;
  const a = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    let sx = x - PAD;
    let sy = y - PAD;
    if (sx < 0) sx = edges.left && sx >= -REP ? 0 : -1;
    else if (sx >= w) sx = edges.right && sx < w + REP ? w - 1 : -1;
    if (sy < 0) sy = edges.top && sy >= -REP ? 0 : -1;
    else if (sy >= h) sy = edges.bottom && sy < h + REP ? h - 1 : -1;
    a[y * pw + x] = sx < 0 || sy < 0 ? 0 : (mask[sy * w + sx] as number);
  }
  const b = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const l = a[y * pw + Math.max(0, x - 1)] as number;
    const c = a[y * pw + x] as number;
    const r = a[y * pw + Math.min(pw - 1, x + 1)] as number;
    b[y * pw + x] = (l + 6 * c + r) / 8;
  }
  const v = new Float32Array(pw * ph);
  for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
    const u = b[Math.max(0, y - 1) * pw + x] as number;
    const c = b[y * pw + x] as number;
    const d = b[Math.min(ph - 1, y + 1) * pw + x] as number;
    v[y * pw + x] = (u + 6 * c + d) / 8;
  }
  const val = (x: number, y: number): number => v[y * pw + x] as number;
  const IS = 0.5;

  // An edge point is named by its grid edge: horizontal edge (x,y)-(x+1,y) is 2*(y*pw+x), vertical (x,y)-(x,y+1) is 2*(y*pw+x)+1.
  const hId = (x: number, y: number): number => 2 * (y * pw + x);
  const vId = (x: number, y: number): number => 2 * (y * pw + x) + 1;
  const pointOf = (id: number): Pt => {
    const vertical = (id & 1) === 1;
    const cell = id >> 1;
    const x = cell % pw;
    const y = (cell - x) / pw;
    if (vertical) {
      const t = (IS - val(x, y)) / (val(x, y + 1) - val(x, y));
      return [x, y + t];
    }
    const t = (IS - val(x, y)) / (val(x + 1, y) - val(x, y));
    return [x + t, y];
  };

  const adj = new Map<number, number[]>();
  const link = (p: number, q: number): void => {
    const A = adj.get(p);
    if (A) A.push(q);
    else adj.set(p, [q]);
    const B = adj.get(q);
    if (B) B.push(p);
    else adj.set(q, [p]);
  };
  for (let y = 0; y < ph - 1; y++) for (let x = 0; x < pw - 1; x++) {
    const tl = val(x, y) >= IS;
    const tr = val(x + 1, y) >= IS;
    const br = val(x + 1, y + 1) >= IS;
    const bl = val(x, y + 1) >= IS;
    const code = (tl ? 8 : 0) | (tr ? 4 : 0) | (br ? 2 : 0) | (bl ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const top = hId(x, y);
    const bottom = hId(x, y + 1);
    const left = vId(x, y);
    const right = vId(x + 1, y);
    switch (code) {
      case 1: case 14: link(left, bottom); break;
      case 2: case 13: link(bottom, right); break;
      case 3: case 12: link(left, right); break;
      case 4: case 11: link(top, right); break;
      case 6: case 9: link(top, bottom); break;
      case 7: case 8: link(left, top); break;
      case 5:
      case 10: {
        const centre = (val(x, y) + val(x + 1, y) + val(x + 1, y + 1) + val(x, y + 1)) / 4 >= IS;
        // code 5: top-right and bottom-left are inside. If the centre is inside they join across it.
        if ((code === 5) === centre) {
          link(left, top);
          link(bottom, right);
        } else {
          link(left, bottom);
          link(top, right);
        }
        break;
      }
      default:
    }
  }

  const seen = new Set<number>();
  const loops: Loop[] = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const ids: number[] = [];
    let prev = -1;
    let cur = start;
    for (;;) {
      seen.add(cur);
      ids.push(cur);
      const next = (adj.get(cur) as number[]).find((n) => n !== prev && (n === start ? ids.length > 2 : !seen.has(n)));
      if (next === undefined) break;
      if (next === start) break;
      prev = cur;
      cur = next;
    }
    if (ids.length < 3) continue;
    // Back to pixel units: grid vertex (gx, gy) is pixel (gx - PAD, gy - PAD), whose centre is half a pixel further.
    const points = ids.map((id) => {
      const p = pointOf(id);
      return [p[0] - PAD + 0.5, p[1] - PAD + 0.5] as Pt;
    });
    loops.push({ points, area: signedArea(points), depth: 0 });
  }
  for (const l of loops) {
    const p = l.points[0] as Pt;
    l.depth = loops.filter((o) => o !== l && Math.abs(o.area) > Math.abs(l.area) && inside(o.points, p[0], p[1])).length;
  }
  return loops;
}
