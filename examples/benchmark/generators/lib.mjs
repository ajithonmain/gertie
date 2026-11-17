// Drawing helpers for the benchmark scenes. Each script in this folder writes one scene file:
//   node examples/benchmark/generators/<name>.mjs
// The output is plain scene JSON; the compiler never sees these scripts.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const R = (n) => Math.round(n * 10) / 10;
const f = (n) => String(R(n));
/** The scene files are written next to this folder, in examples/benchmark/. */
export const OUT = join(import.meta.dirname, "..");

/** Closed smooth shape through points. A point [x, y, 1] is a sharp corner. k is the handle length. */
export function blob(pts, k = 0.18) {
  const n = pts.length;
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = p1[2] ? [p1[0], p1[1]] : [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2 = p2[2] ? [p2[0], p2[1]] : [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d + " Z";
}
/** Open smooth line through points. */
export function curve(pts, k = 0.18) {
  const n = pts.length;
  let d = `M ${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(i - 1, 0)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(i + 2, n - 1)];
    const c1 = p1[2] ? [p1[0], p1[1]] : [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2 = p2[2] ? [p2[0], p2[1]] : [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    d += ` C ${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return d;
}
/** Circle or ellipse as a four-point path, centred on cx, cy. */
export function oval(cx, cy, rx, ry = rx) {
  const k = 0.5523, a = rx * k, b = ry * k;
  return `M ${f(cx)} ${f(cy - ry)} C ${f(cx + a)} ${f(cy - ry)} ${f(cx + rx)} ${f(cy - b)} ${f(cx + rx)} ${f(cy)} C ${f(cx + rx)} ${f(cy + b)} ${f(cx + a)} ${f(cy + ry)} ${f(cx)} ${f(cy + ry)} C ${f(cx - a)} ${f(cy + ry)} ${f(cx - rx)} ${f(cy + b)} ${f(cx - rx)} ${f(cy)} C ${f(cx - rx)} ${f(cy - b)} ${f(cx - a)} ${f(cy - ry)} ${f(cx)} ${f(cy - ry)} Z`;
}
/** Rounded rectangle as an eight-point path. x, y is the top-left corner. */
export function rrect(x, y, w, h, r) {
  const k = r * 0.4477, x2 = x + w, y2 = y + h;
  return `M ${f(x + r)} ${f(y)} L ${f(x2 - r)} ${f(y)} C ${f(x2 - k)} ${f(y)} ${f(x2)} ${f(y + k)} ${f(x2)} ${f(y + r)} L ${f(x2)} ${f(y2 - r)} C ${f(x2)} ${f(y2 - k)} ${f(x2 - k)} ${f(y2)} ${f(x2 - r)} ${f(y2)} L ${f(x + r)} ${f(y2)} C ${f(x + k)} ${f(y2)} ${f(x)} ${f(y2 - k)} ${f(x)} ${f(y2 - r)} L ${f(x)} ${f(y + r)} C ${f(x)} ${f(y + k)} ${f(x + k)} ${f(y)} ${f(x + r)} ${f(y)} Z`;
}
/** Straight-edged closed shape. */
export function poly(pts) {
  return "M " + pts.map((p) => `${f(p[0])} ${f(p[1])}`).join(" L ") + " Z";
}
export const P = (id, d, fill, extra = {}) => ({ id, type: "path", d, fill, ...extra });
export const S = (id, d, color, width, extra = {}) => ({ id, type: "path", d, fill: null, stroke: { color, width, ...(extra.strokeExtra ?? {}) }, ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== "strokeExtra")) });
export const G = (id, children, extra = {}) => ({ id, type: "group", ...extra, children });
export function save(scene) {
  writeFileSync(join(OUT, `${scene.name}.gertie.json`), JSON.stringify(scene, null, 2) + "\n");
}
/** Writes `ease` on every keyframe after the first that has none, so no segment falls back to the default curve. */
export function fillEase(nodes, ease) {
  for (const n of nodes) {
    for (const [prop, keys] of Object.entries(n.animate ?? {})) {
      const list = Array.isArray(keys) ? keys : keys.keys;
      list.forEach((k, i) => {
        if (i === 0) return;
        if (Array.isArray(k)) { if (k.length === 2) k.push(ease); }
        else if (k.ease === undefined) k.ease = ease;
      });
    }
    if (n.children) fillEase(n.children, ease);
  }
  return nodes;
}
/** Keys that scroll a repeating pattern by `shift` pixels over the scene. `shift` must be a whole number of pattern periods. */
export function scroll(shift, duration) {
  return [[0, 0], [duration, shift, "linear"]];
}
/** Counts nodes and paths of a node list, for staying under the linter's node limit. */
export function tally(nodes) {
  let n = 0, p = 0;
  const walk = (list) => list.forEach((x) => { n++; if (x.type === "path") p++; if (x.children) walk(x.children); });
  walk(nodes);
  return { nodes: n, paths: p };
}
