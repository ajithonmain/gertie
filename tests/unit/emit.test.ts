import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSceneValue } from "../../src/compile.ts";
import { bezierProgress, EASINGS } from "../../src/presets/easing.ts";
import { sampleKeys } from "../../src/presets/sample.ts";
import { normalizeScene } from "../../src/spec/normalize.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
function compile(nodes: any[], extra: any = {}): any {
  const raw = { gertie: 1, name: "t", canvas: { w: 200, h: 200 }, fps: 30, duration: 1, nodes, ...extra };
  const r = compileSceneValue(raw);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === "error"), [], JSON.stringify(r.diagnostics));
  return r.lottie;
}
const rect = (o: any = {}) => ({ id: "a", type: "rect", w: 40, h: 20, fill: "#3b82f6", ...o });
const items = (layer: any) => layer.shapes[0].it;

test("rect: size is full width and height, position is the centre", () => {
  const l = compile([rect()]);
  const rc = items(l.layers[0])[0];
  assert.equal(rc.ty, "rc");
  assert.deepEqual(rc.s.k, [40, 20]);
  assert.deepEqual(rc.p.k, [0, 0]);
});

test("ellipse: size is the diameter", () => {
  const l = compile([{ id: "e", type: "ellipse", rx: 10, ry: 5, fill: "#fff" }]);
  assert.deepEqual(items(l.layers[0])[0].s.k, [20, 10]);
});

test("circle shorthand r sets both radii", () => {
  const l = compile([{ id: "e", type: "ellipse", r: 8, fill: "#fff" }]);
  assert.deepEqual(items(l.layers[0])[0].s.k, [16, 16]);
});

test("path: relative tangents, closed flag, one sh per subpath", () => {
  const l = compile([{ id: "p", type: "path", d: "M0 0 C10 20 30 20 40 0 Z M50 50 L60 60", fill: "#fff" }]);
  const sh = items(l.layers[0]).filter((i: any) => i.ty === "sh");
  assert.equal(sh.length, 2);
  assert.equal(sh[0].ks.k.c, true);
  assert.deepEqual(sh[0].ks.k.o[0], [10, 20]);
  assert.equal(sh[1].ks.k.c, false);
});

test("colour conversion rounds to three decimals and alpha goes to opacity", () => {
  const l = compile([rect({ fill: "#3b82f680" })]);
  const fl = items(l.layers[0]).find((i: any) => i.ty === "fl");
  assert.deepEqual(fl.c.k, [0.231, 0.51, 0.965]);
  assert.equal(fl.o.k, 50.196);
  assert.equal(fl.r, 1);
});

test("even-odd fill rule", () => {
  const l = compile([rect({ fillRule: "evenodd" })]);
  assert.equal(items(l.layers[0]).find((i: any) => i.ty === "fl").r, 2);
});

test("stroke is written before fill so it draws on top, trim sits before both", () => {
  const l = compile([rect({ stroke: { color: "#000", width: 4, cap: "butt", join: "miter", dash: [8, 6] }, trim: { start: 0.1, end: 0.6, offset: 0.25 } })]);
  const it = items(l.layers[0]);
  assert.deepEqual(it.map((i: any) => i.ty), ["rc", "tm", "st", "fl", "tr"]);
  const st = it[2];
  assert.equal(st.lc, 1);
  assert.equal(st.lj, 1);
  assert.deepEqual(st.d.map((d: any) => d.n), ["d", "g", "o"]);
  const tm = it[1];
  assert.equal(tm.s.k, 10);
  assert.equal(tm.e.k, 60);
  assert.equal(tm.o.k, 90);
});

test("odd-length dash arrays are doubled like SVG", () => {
  const l = compile([rect({ stroke: { color: "#000", dash: [5] } })]);
  const st = items(l.layers[0]).find((i: any) => i.ty === "st");
  assert.deepEqual(st.d.map((d: any) => d.v.k), [5, 5, 0]);
});

test("gradient fill: flat stop array and alpha block", () => {
  const l = compile([rect({ fill: { type: "linear", from: [0, -10], to: [0, 10], stops: [[0, "#ff0000"], [1, "#0000ff80"]] } })]);
  const gf = items(l.layers[0]).find((i: any) => i.ty === "gf");
  assert.equal(gf.t, 1);
  assert.equal(gf.g.p, 2);
  assert.deepEqual(gf.g.k.k, [0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 0.502]);
});

test("radial gradient end point lies on the edge", () => {
  const l = compile([rect({ fill: { type: "radial", center: [5, 5], radius: 20, stops: [[0, "#fff"], [1, "#000"]] } })]);
  const gf = items(l.layers[0]).find((i: any) => i.ty === "gf");
  assert.equal(gf.t, 2);
  assert.deepEqual(gf.e.k, [25, 5]);
});

test("transform: anchor is pivot and position is pivot plus x,y", () => {
  const l = compile([rect({ x: 100, y: 50, pivot: [-10, 5], scale: [2, 3], rotation: 15, opacity: 0.5 })]);
  const ks = l.layers[0].ks;
  assert.deepEqual(ks.a.k, [-10, 5]);
  assert.deepEqual(ks.p.k, [90, 55]);
  assert.deepEqual(ks.s.k, [200, 300]);
  assert.equal(ks.r.k, 15);
  assert.equal(ks.o.k, 50);
});

test("animated x writes a split position and adds the pivot to every keyframe", () => {
  const l = compile([rect({ x: 100, y: 50, pivot: [10, 0], animate: { x: [[0, 0], [1, 100]] } })]);
  const p = l.layers[0].ks.p;
  assert.equal(p.s, true);
  assert.deepEqual(p.x.k.map((k: any) => k.s), [[10], [110]]);
  assert.equal(p.y.a, 0);
  assert.equal(p.y.k, 50);
});

test("position keyframes carry no spatial tangents", () => {
  const l = compile([rect({ animate: { x: [[0, 0], [1, 100]], y: [[0, 0], [1, 100]] } })]);
  assert.ok(!JSON.stringify(l).includes('"ti"'));
  assert.ok(!JSON.stringify(l).includes('"to"'));
});

test("easing shift: the ease written on scene key n+1 lands on Lottie keyframe n", () => {
  const l = compile([rect({ animate: { rotation: [[0, 0], [0.5, 90, "easeOutQuad"], [1, 180, "linear"]] } })]);
  const k = l.layers[0].ks.r.k;
  assert.equal(k.length, 3);
  const [ox, oy, ix, iy] = EASINGS["easeOutQuad"]!;
  assert.deepEqual(k[0].o, { x: [ox], y: [oy] });
  assert.deepEqual(k[0].i, { x: [ix], y: [iy] });
  assert.deepEqual(k[1].o, { x: [0], y: [0] });
  assert.deepEqual(k[1].i, { x: [1], y: [1] });
  assert.equal(k[2].o, undefined);
  assert.equal(k[2].i, undefined);
  assert.deepEqual(k.map((x: any) => x.t), [0, 15, 30]);
});

test("a custom bezier easing is written verbatim", () => {
  const l = compile([rect({ animate: { rotation: [[0, 0], [1, 90, [0.1, 0.2, 0.3, 1.4]]] } })]);
  const k = l.layers[0].ks.r.k;
  assert.deepEqual(k[0].o, { x: [0.1], y: [0.2] });
  assert.deepEqual(k[0].i, { x: [0.3], y: [1.4] });
});

test("hold segments use h: 1 with no handles", () => {
  const l = compile([rect({ animate: { opacity: [[0, 1], [0.5, 0, "hold"], [1, 1]] } })]);
  const k = l.layers[0].ks.o.k;
  assert.equal(k[0].h, 1);
  assert.equal(k[0].o, undefined);
  assert.equal(k[0].i, undefined);
  assert.deepEqual(k[0].s, [100]);
  assert.deepEqual(k[1].s, [0]);
});

test("a property that starts late is padded with a hold from frame 0", () => {
  const l = compile([rect({ animate: { opacity: [[0.5, 0], [1, 1]] } })]);
  const k = l.layers[0].ks.o.k;
  assert.deepEqual(k.map((x: any) => x.t), [0, 15, 30]);
  assert.equal(k[0].h, 1);
  assert.deepEqual(k[0].s, k[1].s);
  assert.equal(k[1].h, undefined);
});

test("a property that ends early is padded to the last frame", () => {
  const l = compile([rect({ animate: { opacity: [[0, 0], [0.5, 1]] } })]);
  const k = l.layers[0].ks.o.k;
  assert.deepEqual(k.map((x: any) => x.t), [0, 15, 30]);
  assert.equal(k[1].h, 1);
  assert.deepEqual(k[2].s, [100]);
});

test("order: later nodes are earlier layers, and later children are earlier group items", () => {
  const l = compile([rect({ id: "bottom" }), rect({ id: "middle" }), rect({ id: "top" })]);
  assert.deepEqual(l.layers.map((x: any) => x.nm), ["top", "middle", "bottom"]);
  assert.deepEqual(l.layers.map((x: any) => x.ind), [1, 2, 3]);
  const g = compile([{ id: "g", type: "group", children: [rect({ id: "c1" }), rect({ id: "c2" })] }]);
  assert.equal(g.layers.length, 1);
  assert.equal(g.layers[0].ty, 4);
  assert.deepEqual(g.layers[0].shapes.map((s: any) => s.nm), ["c2", "c1"]);
});

test("a plain group becomes one shape layer with nested groups", () => {
  const l = compile([{ id: "g", type: "group", x: 10, children: [{ id: "inner", type: "group", children: [rect({ id: "r" })] }] }]);
  assert.equal(l.layers.length, 1);
  assert.equal(l.assets.length, 0);
  const inner = l.layers[0].shapes[0];
  assert.equal(inner.ty, "gr");
  assert.equal(inner.it[inner.it.length - 1].ty, "tr");
});

test("a group with a child that has a lifetime becomes a precomposition", () => {
  const l = compile([{ id: "g", type: "group", children: [rect({ id: "r", from: 0.2, to: 0.5 })] }]);
  assert.equal(l.layers[0].ty, 0);
  assert.equal(l.layers[0].refId, "comp-g");
  // A precomposition is larger than the canvas by one canvas size on every side, so that content
  // at negative local coordinates is not clipped. Found by the SVG parity check in phase 3.
  assert.equal(l.layers[0].w, 600);
  assert.deepEqual(l.layers[0].ks.a.k, [200, 200]);
  assert.deepEqual(l.assets[0].layers[0].ks.p.k, [200, 200]);
  assert.equal(l.assets[0].layers[0].ip, 6);
  assert.equal(l.assets[0].layers[0].op, 15);
});

test("a group containing a clipped child becomes a precomposition", () => {
  const l = compile([{ id: "g", type: "group", children: [rect({ id: "r", clip: { type: "rect", w: 10, h: 10 } })] }]);
  assert.equal(l.layers[0].ty, 0);
  assert.equal(l.assets[0].layers[0].masksProperties.length, 1);
});

test("clip becomes an add mask on the layer", () => {
  const l = compile([rect({ clip: { type: "ellipse", r: 10, x: 5 } })]);
  const m = l.layers[0].masksProperties[0];
  assert.equal(m.mode, "a");
  assert.equal(m.pt.k.c, true);
  assert.equal(m.pt.k.v.length, 4);
  assert.deepEqual(m.pt.k.v[1], [15, 0]);
});

test("use builds one asset and instances share it", () => {
  const l = compile(
    [{ id: "u1", type: "use", ref: "d", x: 10 }, { id: "u2", type: "use", ref: "d", x: 50 }],
    { defs: { d: rect({ id: "def-rect" }) } },
  );
  assert.equal(l.assets.length, 1);
  assert.equal(l.assets[0].id, "comp-def-d");
  assert.deepEqual(l.layers.map((x: any) => x.refId), ["comp-def-d", "comp-def-d"]);
  assert.deepEqual(l.layers.map((x: any) => x.ks.p.k), [[50, 0], [10, 0]]);
});

test("image nodes become image layers with an embedded asset", () => {
  const raw = { gertie: 1, name: "t", canvas: { w: 100, h: 100 }, duration: 1, nodes: [{ id: "pic", type: "image", src: "a.png", w: 40, h: 30, animate: { x: [[0, 0], [1, 5]] } }] };
  const r = compileSceneValue(raw, { images: { "a.png": "data:image/png;base64,AAAA" } });
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === "error"), []);
  const l: any = r.lottie;
  assert.equal(l.layers[0].ty, 2);
  assert.equal(l.layers[0].refId, "img-pic");
  assert.deepEqual(l.assets[0], { id: "img-pic", w: 40, h: 30, e: 1, u: "", p: "data:image/png;base64,AAAA" });
});

test("background becomes the bottom-most layer", () => {
  const l = compile([rect()], { canvas: { w: 200, h: 200, background: "#102030" } });
  assert.equal(l.layers[l.layers.length - 1].nm, "background");
  assert.equal(l.layers[0].nm, "a");
});

test("lifetime maps to layer in and out points", () => {
  const l = compile([rect({ from: 0.2, to: 0.8 })]);
  assert.equal(l.layers[0].ip, 6);
  assert.equal(l.layers[0].op, 24);
  assert.equal(l.op, 30);
});

test("morph writes one bezier per keyframe", () => {
  const l = compile([{ id: "p", type: "path", d: "M0 0 L10 0 L10 10 Z", fill: "#fff", animate: { d: [[0, "M0 0 L10 0 L10 10 Z"], [1, "M0 0 L20 0 L20 20 Z"]] } }]);
  const sh = items(l.layers[0])[0];
  assert.equal(sh.ks.a, 1);
  assert.equal(sh.ks.k[1].s[0].v[1][0], 20);
});

test("animated size of a rect with different eases is baked per frame", () => {
  const l = compile([rect({ animate: { w: [[0, 10], [1, 50, "easeIn"]], h: [[0, 10], [1, 50, "easeOut"]] } })]);
  const s = items(l.layers[0])[0].s;
  assert.equal(s.k.length, 31);
});

test("numbers are rounded to three decimals", () => {
  const l = compile([rect({ x: 1 / 3 })]);
  assert.equal(l.layers[0].ks.p.k[0], 0.333);
});

test("output key order is stable across runs", () => {
  const nodes = [rect({ animate: { x: [[0, 0], [1, 10]] } })];
  assert.equal(JSON.stringify(compile(nodes)), JSON.stringify(compile(nodes)));
});

test("output never contains features outside the safe subset", () => {
  const l = compile([rect({ stroke: { color: "#000" }, trim: { start: 0, end: 1 }, clip: { type: "rect", w: 5, h: 5 } })]);
  const s = JSON.stringify(l);
  for (const banned of ['"ty":"mm"', '"ty":"rp"', '"ty":"sr"', '"ef"', '"tt"', '"bm"', '"ao"', '"tm":{']) assert.ok(!s.includes(banned), banned);
});

// ------------------------------------------------------------- normalizer and sampler

test("normalizer: polygon and star become closed paths with the right vertex counts", () => {
  const n = normalizeScene({ gertie: 1, name: "t", canvas: { w: 100, h: 100 }, duration: 1, nodes: [
    { id: "p", type: "polygon", points: 6, r: 10, fill: "#fff" },
    { id: "s", type: "star", points: 5, r: 10, innerR: 4, fill: "#fff" },
    { id: "l", type: "line", x1: 0, y1: 0, x2: 5, y2: 5, stroke: { color: "#fff" } },
  ] });
  const [p, s, l] = n.nodes as any[];
  assert.equal(p.d[0].v.length, 6);
  assert.equal(s.d[0].v.length, 10);
  assert.equal(l.d[0].closed, false);
  assert.deepEqual(p.d[0].v[0].map((x: number) => Math.round(x * 1000) / 1000), [0, -10]);
});

test("normalizer: seconds become frames and totalFrames is round(duration * fps)", () => {
  const n = normalizeScene({ gertie: 1, name: "t", canvas: { w: 100, h: 100 }, fps: 24, duration: 1.5, nodes: [rect({ animate: { x: [[0, 0], [0.75, 1]] } })] });
  assert.equal(n.totalFrames, 36);
  assert.deepEqual((n.nodes[0] as any).tracks.x.map((k: any) => k.t), [0, 18, 36]);
});

test("normalizer: palette references resolve and the circle shorthand animates both radii", () => {
  const n = normalizeScene({ gertie: 1, name: "t", canvas: { w: 100, h: 100 }, duration: 1, palette: { c: "#ff0000" }, nodes: [{ id: "e", type: "ellipse", r: 5, fill: "$c", animate: { r: [[0, 5], [1, 9]] } }] });
  const e = n.nodes[0] as any;
  assert.deepEqual(e.fill, [255, 0, 0, 1]);
  assert.ok(e.tracks.rx && e.tracks.ry);
});

test("bezier progress is exact at the ends and symmetric for easeInOut", () => {
  assert.equal(bezierProgress([0.65, 0, 0.35, 1], 0), 0);
  assert.equal(bezierProgress([0.65, 0, 0.35, 1], 1), 1);
  assert.ok(Math.abs(bezierProgress([0.65, 0, 0.35, 1], 0.5) - 0.5) < 1e-4);
  assert.ok(Math.abs(bezierProgress([0, 0, 1, 1], 0.3) - 0.3) < 1e-4);
});

test("sampler interpolates numbers, vectors and honours hold", () => {
  const keys = [
    { t: 0, v: 0, ease: [0, 0, 1, 1] as [number, number, number, number] },
    { t: 10, v: 100, ease: [0, 0, 1, 1] as [number, number, number, number] },
    { t: 20, v: 0, ease: "hold" as const },
  ];
  assert.equal(sampleKeys(keys, 5), 50);
  assert.equal(sampleKeys(keys, 15), 100);
  assert.equal(sampleKeys(keys, -3), 0);
  assert.equal(sampleKeys(keys, 99), 0);
  const vec = [
    { t: 0, v: [0, 0] as [number, number], ease: [0, 0, 1, 1] as [number, number, number, number] },
    { t: 10, v: [10, 20] as [number, number], ease: [0, 0, 1, 1] as [number, number, number, number] },
  ];
  assert.deepEqual(sampleKeys(vec, 5), [5, 10]);
});

// ------------------------------------------------------------- rules learned from rendering (phase 2)

test("a shape group's transform never uses split position, even when x and y animate", () => {
  const l = compile([{ id: "g", type: "group", children: [rect({ id: "c", animate: { x: [[0, 0], [1, 10]] } }), rect({ id: "d", animate: { x: [[0, 0], [1, 10]], y: [[0, 5], [1, 9, "linear"]] } })] }]);
  const trs = l.layers[0].shapes.map((g: any) => g.it[g.it.length - 1].p);
  for (const p of trs) {
    assert.equal(p.s, undefined);
    assert.equal(p.a, 1);
  }
});

test("group position with one moving axis is exact, not baked", () => {
  const l = compile([{ id: "g", type: "group", children: [rect({ id: "c", pivot: [2, 0], y: 7, animate: { x: [[0, 0], [0.5, 10, "easeOut"], [1, 0]] } })] }]);
  const p = l.layers[0].shapes[0].it.at(-1).p;
  assert.deepEqual(p.k.map((k: any) => k.t), [0, 15, 30]);
  assert.deepEqual(p.k.map((k: any) => k.s), [[2, 7], [12, 7], [2, 7]]);
});

test("layers carry st but not sr, and the root carries neither v nor ddd", () => {
  const l = compile([rect()]);
  assert.equal(l.layers[0].st, 0);
  assert.equal("sr" in l.layers[0], false);
  assert.equal("v" in l, false);
  assert.equal("ddd" in l, false);
});

test("masks carry an expansion of 0 and no inv or nm", () => {
  const l = compile([rect({ clip: { type: "rect", w: 10, h: 10 } })]);
  assert.equal(l.layers[0].hasMask, true);
  assert.deepEqual(l.layers[0].masksProperties[0].x, { a: 0, k: 0 });
  assert.equal("inv" in l.layers[0].masksProperties[0], false);
  assert.equal("nm" in l.layers[0].masksProperties[0], false);
});

test("dash entries are named", () => {
  const l = compile([rect({ stroke: { color: "#000", dash: [8, 6] } })]);
  const st = items(l.layers[0]).find((i: any) => i.ty === "st");
  assert.deepEqual(st.d.map((d: any) => d.nm), ["dash", "gap", "offset"]);
});

test("precomposition assets do not carry fr", () => {
  const l = compile([{ id: "g", type: "group", children: [rect({ id: "r", from: 0.2 })] }]);
  assert.equal("fr" in l.assets[0], false);
});
