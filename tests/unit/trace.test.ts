import { test } from "node:test";
import assert from "node:assert/strict";
import { traceImage } from "../../src/trace/trace.ts";
import { quantize, TRANSPARENT, type Raster } from "../../src/trace/quantize.ts";
import { traceMask, signedArea } from "../../src/trace/contour.ts";
import { simplifyLoop, loopToPath } from "../../src/trace/fit.ts";
import { groupNodes } from "../../src/trace/group.ts";
import { importSvg } from "../../src/import/svg.ts";
import { parsePath, samplePath } from "../../src/spec/path.ts";

type Any = any; // fragments are explored loosely

/** A raster built by painting shapes, so the expected geometry is known exactly. */
function canvas(w: number, h: number, bg: [number, number, number, number]): Raster & { paint(f: (x: number, y: number) => boolean, c: [number, number, number, number]): void } {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  return {
    w, h, data,
    paint(f, c) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (f(x + 0.5, y + 0.5)) data.set(c, (y * w + x) * 4);
    },
  };
}
const disk = (cx: number, cy: number, r: number) => (x: number, y: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const rectOf = (x0: number, y0: number, x1: number, y1: number) => (x: number, y: number) => x >= x0 && x < x1 && y >= y0 && y < y1;

/** Area covered by a node's path, by the even-odd rule over its sampled outlines. */
function pathArea(node: Any): number {
  const sp = parsePath(node.d);
  const loops = sp.map((s) => samplePath(s, 24));
  let total = 0;
  for (const l of loops) {
    const a = Math.abs(signedArea(l));
    // A loop inside another is a hole when it is drawn with evenodd.
    const nested = loops.filter((o) => o !== l && Math.abs(signedArea(o)) > a && insidePoly(o, l[0]![0], l[0]![1])).length;
    total += nested % 2 === 0 ? a : -a;
  }
  return total;
}
function insidePoly(p: [number, number][], x: number, y: number): boolean {
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (p[i]![1] > y !== p[j]![1] > y && x < ((p[j]![0] - p[i]![0]) * (y - p[i]![1])) / (p[j]![1] - p[i]![1]) + p[i]![0]) c = !c;
  return c;
}
const nodesOf = (svg: string): Any[] => importSvg(svg, "t.svg").fragment.nodes;

test("quantize keeps the colours of a flat image and merges near-duplicates", () => {
  const img = canvas(40, 40, [250, 250, 250, 255]);
  img.paint(rectOf(5, 5, 20, 20), [200, 20, 20, 255]);
  img.paint(rectOf(22, 22, 36, 36), [201, 21, 21, 255]);
  const q = quantize(img, { colors: 8, alphaCutoff: 128, drop: [] });
  assert.equal(q.palette.length, 2);
  assert.ok(!Array.from(q.labels).includes(TRANSPARENT));
});

test("transparent and dropped pixels are not traced", () => {
  const img = canvas(30, 30, [0, 0, 0, 0]);
  img.paint(rectOf(5, 5, 25, 25), [10, 200, 10, 255]);
  const q = quantize(img, { colors: 4, alphaCutoff: 128, drop: [] });
  assert.equal(q.labels.filter((l) => l === TRANSPARENT).length, 900 - 400);
  const white = canvas(30, 30, [255, 255, 255, 255]);
  white.paint(rectOf(5, 5, 25, 25), [10, 200, 10, 255]);
  const dropped = quantize(white, { colors: 4, alphaCutoff: 128, drop: [{ rgb: [255, 255, 255], tolerance: 10 }] });
  assert.equal(dropped.labels.filter((l) => l === TRANSPARENT).length, 500);
});

test("marching squares finds a closed outline of the right size, and a hole as a second loop", () => {
  const m = new Uint8Array(20 * 20);
  for (let y = 4; y < 16; y++) for (let x = 4; x < 16; x++) m[y * 20 + x] = 1;
  const solid = traceMask(m, 20, 20);
  assert.equal(solid.length, 1);
  assert.ok(Math.abs(Math.abs(solid[0]!.area) - 144) < 8, `area ${solid[0]!.area}`);
  for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) m[y * 20 + x] = 0;
  const ring = traceMask(m, 20, 20);
  assert.equal(ring.length, 2);
  assert.deepEqual(ring.map((l) => l.depth).sort(), [0, 1]);
});

test("simplifying keeps a long straight edge on the line, and sharp corners stay sharp", () => {
  const sq: [number, number][] = [];
  for (let i = 0; i <= 100; i++) sq.push([i, 0]);
  for (let i = 1; i <= 100; i++) sq.push([100, i]);
  for (let i = 99; i >= 0; i--) sq.push([i, 100]);
  for (let i = 99; i >= 1; i--) sq.push([0, i]);
  const s = simplifyLoop(sq, 0.5);
  assert.equal(s.length, 4);
  const d = loopToPath(s, 38, 1);
  assert.equal((d.match(/L/g) ?? []).length, 4, "four straight sides");
  assert.ok(!/C/.test(d));
});

test("a flat image is traced to stacked regions with the right colours, largest first", () => {
  const img = canvas(120, 100, [20, 30, 60, 255]);
  img.paint(rectOf(20, 20, 70, 80), [230, 60, 40, 255]);
  img.paint(disk(95, 50, 15), [250, 220, 40, 255]);
  const t = traceImage(img);
  assert.equal(t.regions, 3);
  assert.deepEqual(t.palette.length, 3);
  const n = nodesOf(t.svg);
  assert.equal(n[0].fill, "#141e3c");
  assert.deepEqual(n.map((x: Any) => x.id), ["region-1", "region-2", "region-3"]);
  assert.ok(Math.abs(pathArea(n[2]) - Math.PI * 15 * 15) < Math.PI * 225 * 0.04, `disk area ${pathArea(n[2])}`);
});

test("a region that reaches the edge of the image reaches the edge exactly, with square corners", () => {
  const img = canvas(80, 60, [10, 10, 10, 255]);
  img.paint(disk(40, 30, 12), [200, 200, 200, 255]);
  const sp = parsePath((nodesOf(traceImage(img, { seam: 0 }).svg)[0] as Any).d);
  const xs = sp.flatMap((s) => s.v.map((p) => p[0]));
  const ys = sp.flatMap((s) => s.v.map((p) => p[1]));
  assert.deepEqual([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)], [0, 80, 0, 60]);
  const bg = nodesOf(traceImage(img, { seam: 0 }).svg)[0] as Any;
  assert.ok(Math.abs(pathArea(bg) - 80 * 60) < 80 * 60 * 0.01, "stacked: the background is a full rectangle under the disk");
});

test("a hole that shows the transparent background stays a hole, and one that is filled by another region does not", () => {
  const img = canvas(100, 100, [0, 0, 0, 0]);
  img.paint(disk(50, 50, 40), [200, 30, 30, 255]);
  img.paint(disk(50, 50, 20), [0, 0, 0, 0]);
  const t = traceImage(img);
  const n = nodesOf(t.svg);
  assert.equal(n.length, 1);
  assert.equal(n[0].fillRule, "evenodd");
  assert.ok(Math.abs(pathArea(n[0]) - Math.PI * (1600 - 400)) < Math.PI * 1200 * 0.04, `ring area ${pathArea(n[0])}`);

  const solid = canvas(100, 100, [0, 0, 0, 0]);
  solid.paint(disk(50, 50, 40), [200, 30, 30, 255]);
  solid.paint(disk(50, 50, 20), [30, 30, 200, 255]);
  const t2 = traceImage(solid);
  const n2 = nodesOf(t2.svg);
  assert.equal(n2.length, 2);
  assert.equal(n2[0].fillRule, undefined, "the ring is drawn as a filled disk under the inner one");
  assert.ok(Math.abs(pathArea(n2[0]) - Math.PI * 1600) < Math.PI * 1600 * 0.04);
});

test("a thin ring around a larger region is drawn before it, so it does not cover it", () => {
  const img = canvas(120, 120, [255, 255, 255, 255]);
  img.paint(disk(60, 60, 50), [30, 30, 30, 255]);
  img.paint(disk(60, 60, 44), [250, 200, 20, 255]);
  const n = nodesOf(traceImage(img).svg);
  const fills = n.map((x: Any) => x.fill);
  assert.ok(fills.indexOf("#1e1e1e") < fills.indexOf("#fac814"), fills.join(" "));
});

test("single-pixel specks and one-pixel anti-aliasing lines do not become regions", () => {
  const img = canvas(80, 80, [240, 240, 240, 255]);
  img.paint(rectOf(10, 10, 50, 50), [40, 60, 200, 255]);
  for (const [x, y] of [[60, 60], [70, 15], [65, 40]] as const) img.paint(rectOf(x, y, x + 1, y + 1), [10, 10, 10, 255]);
  const t = traceImage(img);
  assert.equal(t.regions, 2);
});

test("drop removes the background colour and the shapes on it remain", () => {
  const img = canvas(60, 60, [255, 255, 255, 255]);
  img.paint(disk(30, 30, 20), [10, 120, 200, 255]);
  const t = traceImage(img, { drop: [{ rgb: [255, 255, 255], tolerance: 20 }] });
  assert.equal(t.regions, 1);
  assert.equal(nodesOf(t.svg)[0].fill, "#0a78c8");
});

test("a large image is reduced for tracing and the result is scaled back to its own size", () => {
  const img = canvas(400, 300, [10, 10, 10, 255]);
  img.paint(disk(200, 150, 100), [220, 220, 220, 255]);
  const t = traceImage(img, { maxSide: 100 });
  assert.deepEqual([t.width, t.height], [400, 300]);
  const f = importSvg(t.svg, "t.svg").fragment;
  assert.deepEqual(f.canvas, { w: 400, h: 300 });
  const d = nodesOf(t.svg)[1] as Any;
  assert.ok(Math.abs(pathArea(d) - Math.PI * 10000) < Math.PI * 10000 * 0.05, `area ${pathArea(d)}`);
});

test("tracing is deterministic, and the seam option adds or removes the outline", () => {
  const img = canvas(60, 60, [20, 20, 20, 255]);
  img.paint(disk(30, 30, 15), [200, 100, 50, 255]);
  assert.equal(traceImage(img).svg, traceImage(img).svg);
  assert.ok(/stroke-width/.test(traceImage(img).svg));
  assert.ok(!/stroke/.test(traceImage(img, { seam: 0 }).svg));
});

test("a fully transparent image traces to nothing", () => {
  const t = traceImage(canvas(20, 20, [0, 0, 0, 0]));
  assert.equal(t.regions, 0);
});

// ---------------------------------------------------------------- grouping

const frag = (): Any[] => ["a", "b", "c", "d", "e"].map((id) => ({ id, type: "rect", w: 1, h: 1, fill: "#fff" }));

test("a group is placed where its first member was and keeps its members in stack order", () => {
  const r = groupNodes(frag(), { pair: ["d", "b"], solo: ["e"] });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.nodes.map((n) => n["id"]), ["a", "pair", "c", "solo"]);
  assert.deepEqual((r.nodes[1] as Any).children.map((n: Any) => n.id), ["b", "d"]);
  assert.equal((r.nodes[1] as Any).type, "group");
});

test("grouping errors name the problem", () => {
  assert.match(groupNodes(frag(), { g: ["zzz"] }).errors[0]!, /not a node of the fragment/);
  assert.match(groupNodes(frag(), { g: ["a"], h: ["a"] }).errors[0]!, /both 'g' and 'h'/);
  assert.match(groupNodes(frag(), { a: ["b"] }).errors[0]!, /already the id/);
  assert.match(groupNodes(frag(), { "Bad Name": ["b"] }).errors[0]!, /not valid/);
  assert.match(groupNodes(frag(), { g: [] }).errors[0]!, /needs a list/);
  const nested = [{ id: "outer", type: "group", children: [{ id: "inner", type: "rect", w: 1, h: 1, fill: "#fff" }] }];
  assert.match(groupNodes(nested, { g: ["inner"] }).errors[0]!, /inside another group/);
});

test("when grouping fails the nodes are returned unchanged", () => {
  const nodes = frag();
  assert.equal(groupNodes(nodes, { g: ["nope"] }).nodes.length, 5);
});
