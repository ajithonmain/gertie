import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSceneValue } from "../../src/compile.ts";
import { validateSvg } from "../../src/validate/svg.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
function compile(nodes: any[], extra: any = {}): any {
  return compileSceneValue({ gertie: 1, name: "t", canvas: { w: 200, h: 200 }, fps: 30, duration: 1, loop: false, nodes, ...extra });
}
function ok(nodes: any[], extra: any = {}): any {
  const r = compile(nodes, extra);
  assert.deepEqual(r.diagnostics, [], JSON.stringify(r.diagnostics));
  return r;
}
const codes = (r: any): string[] => r.diagnostics.map((d: any) => d.code);

const stops = [[0, "#111111"], [1, "#eeeeee"]];
const linear = (animate: any = {}) => ({ id: "a", type: "rect", w: 100, h: 40, fill: { type: "linear", from: [-50, 0], to: [50, 0], stops }, animate });
const moving = () => linear({ "fill.to": [[0, [50, 0]], [1, [0, 0]]] });
const radial = (animate: any = {}) => ({ id: "a", type: "ellipse", r: 40, fill: { type: "radial", center: [0, 0], radius: 40, stops }, animate });

// ------------------------------------------------------------------ markers

test("markers become Lottie markers in frames", () => {
  const r = ok([linear({ "fill.to": [[0, [50, 0]], [1, [0, 0]]] })], { markers: { intro: [0, 0.5], "loop-1": [0.5, 1] } });
  assert.deepEqual(r.lottie.markers, [{ cm: "intro", tm: 0, dr: 15 }, { cm: "loop-1", tm: 15, dr: 15 }]);
});

test("a scene without markers has no markers array", () => {
  assert.equal(ok([moving()]).lottie.markers, undefined);
});

test("markers are not written to the SVG", () => {
  const r = ok([moving()], { markers: { intro: [0, 1] } });
  assert.ok(!r.svg.svg.includes("intro"));
});

test("E-MARKER: bad name, wrong shape, start not before end, outside the duration", () => {
  const bad = (m: any) => codes(compile([moving()], { markers: m }));
  assert.ok(bad({ Intro: [0, 1] }).includes("E-MARKER"));
  assert.ok(bad({ intro: [0] }).includes("E-MARKER"));
  assert.ok(bad({ intro: "x" }).includes("E-MARKER"));
  assert.ok(bad([]).includes("E-MARKER"));
  assert.ok(bad({ intro: [1, 1] }).includes("E-MARKER"));
  assert.ok(bad({ intro: [0.8, 0.2] }).includes("E-MARKER"));
  assert.ok(bad({ intro: [0, 1.5] }).includes("E-MARKER"));
  assert.ok(bad({ intro: [-0.1, 0.5] }).includes("E-MARKER"));
  assert.deepEqual(bad({ intro: [0, 1], "mid-2": [0.25, 0.75] }), []);
});

// ------------------------------------------------------------------ gradient geometry

test("lottie: linear gradient end points get keyframes with the easing of the arriving key", () => {
  const r = ok([linear({ "fill.from": [[0, [-50, 0]], [1, [50, 0], "easeInOut"]], "fill.to": [[0, [0, 0]], [1, [100, 0], "easeInOut"]] })]);
  const gf = r.lottie.layers[0].shapes[0].it.find((i: any) => i.ty === "gf");
  assert.equal(gf.s.a, 1);
  assert.equal(gf.e.a, 1);
  assert.deepEqual(gf.s.k.map((k: any) => k.s), [[-50, 0], [50, 0]]);
  assert.deepEqual(gf.e.k.map((k: any) => k.s), [[0, 0], [100, 0]]);
  assert.ok(gf.s.k[0].o && gf.s.k[0].i, "easing sits on the keyframe where the segment starts");
});

test("lottie: only one end point animated leaves the other static", () => {
  const r = ok([linear({ "fill.to": [[0, [50, 0]], [1, [0, 0]]] })]);
  const gf = r.lottie.layers[0].shapes[0].it.find((i: any) => i.ty === "gf");
  assert.equal(gf.s.a, 0);
  assert.deepEqual(gf.s.k, [-50, 0]);
  assert.equal(gf.e.a, 1);
});

test("lottie: radial centre moves the start point and the end point, radius moves only the end point", () => {
  const gfOf = (r: any) => r.lottie.layers[0].shapes[0].it.find((i: any) => i.ty === "gf");
  const c = gfOf(ok([radial({ "fill.center": [[0, [0, 0]], [1, [10, 5]]] })]));
  assert.deepEqual(c.s.k.map((k: any) => k.s), [[0, 0], [10, 5]]);
  assert.deepEqual(c.e.k.map((k: any) => k.s), [[40, 0], [50, 5]]);
  const rad = gfOf(ok([radial({ "fill.radius": [[0, 40], [1, 60]] })]));
  assert.equal(rad.s.a, 0);
  assert.deepEqual(rad.e.k.map((k: any) => k.s), [[40, 0], [60, 0]]);
});

test("lottie: radial centre and radius on different timelines are baked per frame, and still exact at the keys", () => {
  const g = gfOf(ok([radial({ "fill.center": [[0, [0, 0]], [1, [20, 0]]], "fill.radius": [[0, 40], [0.5, 60], [1, 40]] })]));
  assert.equal(g.e.k.length, 31);
  assert.deepEqual(g.e.k[0].s, [40, 0]);
  assert.deepEqual(g.e.k[15].s, [70, 0]);
  assert.deepEqual(g.e.k[30].s, [60, 0]);
  function gfOf(r: any): any {
    return r.lottie.layers[0].shapes[0].it.find((i: any) => i.ty === "gf");
  }
});

test("svg: gradient geometry uses SMIL on the gradient element and the static attributes hold the poster value", () => {
  const { svg } = ok([linear({ "fill.to": [[0, [50, 0]], [1, [0, 0], "easeInOut"]] })]).svg;
  assert.match(svg, /<linearGradient [^>]*x1="-50" y1="0" x2="50" y2="0">/);
  const anim = [...svg.matchAll(/<animate attributeName="(\w+)"/g)].map((m) => m[1]);
  assert.deepEqual(anim, ["x2"], "y2 never changes, so it is not animated");
  assert.match(svg, /values="50;0"/);
  assert.match(svg, /calcMode="spline"/);
  assert.deepEqual(validateSvg(svg), []);
});

test("svg: radial centre and radius animate cx, cy and r", () => {
  const { svg } = ok([radial({ "fill.center": [[0, [0, 0]], [1, [10, 5]]], "fill.radius": [[0, 40], [1, 60]] })]).svg;
  const anim = [...svg.matchAll(/<animate attributeName="(\w+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(anim, ["cx", "cy", "r"]);
});

test("svg: an overshoot easing on gradient geometry is baked", () => {
  const r = ok([linear({ "fill.to": [[0, [50, 0]], [1, [0, 0], [0.3, 1.6, 0.6, 1]]] })]);
  assert.ok(r.svg.baked.some((b: string) => b.includes("fill.to")), JSON.stringify(r.svg.baked));
});

test("lint: gradient geometry on the wrong gradient type or a solid fill is E-PROP-UNKNOWN and names the right properties", () => {
  const a = compile([linear({ "fill.center": [[0, [0, 0]], [1, [5, 5]]] })]);
  assert.deepEqual(codes(a), ["E-PROP-UNKNOWN"]);
  assert.match(a.diagnostics[0].message, /linear gradient.*fill\.from.*fill\.to/);
  const b = compile([radial({ "fill.from": [[0, [0, 0]], [1, [5, 5]]] })]);
  assert.deepEqual(codes(b), ["E-PROP-UNKNOWN"]);
  assert.match(b.diagnostics[0].message, /radial gradient.*fill\.center.*fill\.radius/);
  const c = compile([{ id: "a", type: "rect", w: 10, h: 10, fill: "#ffffff", animate: { "fill.from": [[0, [0, 0]], [1, [5, 5]]] } }]);
  assert.deepEqual(codes(c), ["E-PROP-UNKNOWN"]);
});

test("lint: gradient geometry value shapes", () => {
  assert.deepEqual(codes(compile([linear({ "fill.from": [[0, 5], [1, [5, 5]]] })])), ["E-KEY-VALUE"]);
  assert.deepEqual(codes(compile([radial({ "fill.radius": [[0, 40], [1, 0]] })])), ["E-KEY-VALUE"]);
  assert.deepEqual(codes(compile([radial({ "fill.center": [[0, [0, 0]], [1, "x"]] })])), ["E-KEY-VALUE"]);
  assert.deepEqual(codes(compile([linear({ "fill.from": [[0, [0, 0]], [1, [5, 5]]] })])), []);
});
