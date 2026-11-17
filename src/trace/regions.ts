import { TRANSPARENT } from "./quantize.ts";

export interface Component {
  id: number;
  label: number;
  area: number;
  /** [x0, y0, x1, y1], inclusive pixel bounds. */
  box: [number, number, number, number];
  /** Sum of source red, green and blue over the component's pixels. */
  sum: [number, number, number];
}

/** Labels 4-connected runs of equal label. Returns the component id of every pixel and the components. */
export function components(labels: Uint16Array, w: number, h: number, rgba: Uint8ClampedArray | Uint8Array): { ids: Int32Array; list: Component[] } {
  const ids = new Int32Array(w * h).fill(-1);
  const list: Component[] = [];
  const stack: number[] = [];
  for (let start = 0; start < labels.length; start++) {
    if (ids[start] !== -1 || labels[start] === TRANSPARENT) continue;
    const label = labels[start] as number;
    const comp: Component = { id: list.length, label, area: 0, box: [w, h, 0, 0], sum: [0, 0, 0] };
    ids[start] = comp.id;
    stack.push(start);
    while (stack.length > 0) {
      const p = stack.pop() as number;
      const x = p % w;
      const y = (p - x) / w;
      comp.area++;
      if (x < comp.box[0]) comp.box[0] = x;
      if (y < comp.box[1]) comp.box[1] = y;
      if (x > comp.box[2]) comp.box[2] = x;
      if (y > comp.box[3]) comp.box[3] = y;
      comp.sum[0] += rgba[p * 4] as number;
      comp.sum[1] += rgba[p * 4 + 1] as number;
      comp.sum[2] += rgba[p * 4 + 2] as number;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q >= 0 && ids[q] === -1 && labels[q] === label) {
          ids[q] = comp.id;
          stack.push(q);
        }
      }
    }
    list.push(comp);
  }
  return { ids, list };
}

/**
 * Removes thin lines and single pixels left by anti-aliasing: a pixel whose label is rare in its 3 by 3 neighbourhood
 * takes the most common label there.
 */
export function modeFilter(labels: Uint16Array, w: number, h: number, passes: number): Uint16Array {
  let cur = labels;
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint16Array(cur);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        const own = cur[p] as number;
        if (own === TRANSPARENT) continue;
        const counts = new Map<number, number>();
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const l = cur[p + dy * w + dx] as number;
          counts.set(l, (counts.get(l) ?? 0) + 1);
        }
        if ((counts.get(own) ?? 0) > 3) continue;
        let best = own;
        let bc = counts.get(own) ?? 0;
        for (const [l, c] of counts) if (l !== TRANSPARENT && c > bc) {
          best = l;
          bc = c;
        }
        if (bc >= 5) next[p] = best;
      }
    }
    cur = next;
  }
  return cur;
}

/** Gives every component smaller than `minArea` the most common label on its border, then the caller recomputes components. */
export function despeckle(labels: Uint16Array, w: number, h: number, ids: Int32Array, list: readonly Component[], minArea: number): Uint16Array {
  const out = new Uint16Array(labels);
  const small = list.filter((c) => c.area < minArea).sort((a, b) => a.area - b.area);
  if (small.length === 0) return out;
  const smallSet = new Set(small.map((c) => c.id));
  const pixels = new Map<number, number[]>();
  for (let p = 0; p < ids.length; p++) {
    const id = ids[p] as number;
    if (id >= 0 && smallSet.has(id)) {
      const a = pixels.get(id);
      if (a) a.push(p);
      else pixels.set(id, [p]);
    }
  }
  for (const c of small) {
    const votes = new Map<number, number>();
    for (const p of pixels.get(c.id) ?? []) {
      const x = p % w;
      const y = (p - x) / w;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q < 0) continue;
        const l = out[q] as number;
        if (l !== c.label && l !== TRANSPARENT) votes.set(l, (votes.get(l) ?? 0) + 1);
      }
    }
    let best = -1;
    let bv = 0;
    for (const [l, v] of votes) if (v > bv) {
      best = l;
      bv = v;
    }
    if (best >= 0) for (const p of pixels.get(c.id) ?? []) out[p] = best;
  }
  return out;
}
