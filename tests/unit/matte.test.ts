import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSceneValue } from "../../src/compile.ts";
import { semanticLint } from "../../src/validate/semantic.ts";
import { validateSchema } from "../../src/validate/schema.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
function compile(nodes: any[], extra: any = {}): any {
  return compileSceneValue({ gertie: 1, name: "t", canvas: { w: 200, h: 200 }, fps: 30, duration: 1, loop: false, nodes, ...extra });
}
function ok(nodes: any[]): any {
  const r = compile(nodes);
  assert.deepEqual(r.diagnostics, [], JSON.stringify(r.diagnostics));
  return r;
}
const codes = (r: any): string[] => r.diagnostics.map((d: any) => d.code);

const move = { x: [[0, 0], [1, 100]] };
const source = (id = "src") => ({ id, type: "ellipse", r: 40, x: 100, y: 100, fill: "#ffffff" });
const matted = (by = "src", mode?: string, id = "m") => ({ id, type: "rect", w: 60, h: 300, x: 100, y: 100, fill: "#ff0000", animate: move, matte: mode ? { by, mode } : { by } });

// ------------------------------------------------------------------ lint

test("a matte on a node with a sibling source compiles with no diagnostics", () => {
  ok([source(), matted()]);
  ok([source(), matted("src", "alpha-inverted")]);
});

test("E-MATTE-BY: 'by' missing or not a string", () => {
  assert.ok(codes(compile([source(), { ...matted(), matte: {} }])).includes("E-MATTE-BY"));
  assert.ok(codes(compile([source(), { ...matted(), matte: { by: 3 } }])).includes("E-MATTE-BY"));
});

test("E-MATTE-FIELD: matte is not an object, or has an unknown field", () => {
  assert.ok(codes(compile([source(), { ...matted(), matte: "src" }])).includes("E-MATTE-FIELD"));
  assert.ok(codes(compile([source(), { ...matted(), matte: { by: "src", feather: 4 } }])).includes("E-FIELD-UNKNOWN"));
});

test("E-MATTE-MODE: only alpha and alpha-inverted exist", () => {
  const r = compile([source(), matted("src", "luma")]);
  assert.ok(codes(r).includes("E-MATTE-MODE"));
  assert.match(r.diagnostics.find((d: any) => d.code === "E-MATTE-MODE").message, /alpha, alpha-inverted/);
});

test("E-MATTE-SIBLING: the source is missing, is the node itself, or is in another list", () => {
  assert.ok(codes(compile([source(), matted("nope")])).includes("E-MATTE-SIBLING"));
  assert.ok(codes(compile([source(), matted("m")])).includes("E-MATTE-SIBLING"));
  const inGroup = { id: "g", type: "group", children: [source("inner")] };
  const r = compile([inGroup, matted("inner")]);
  assert.ok(codes(r).includes("E-MATTE-SIBLING"));
  // The same pair inside one group is fine.
  ok([{ id: "g", type: "group", children: [source("inner"), matted("inner")] }]);
});

test("E-MATTE-CONFLICT: one source used in two modes; the same mode twice is fine", () => {
  assert.ok(codes(compile([source(), matted("src", "alpha", "a"), matted("src", "alpha-inverted", "b")])).includes("E-MATTE-CONFLICT"));
  ok([source(), matted("src", "alpha", "a"), matted("src", "alpha", "b")]);
});

test("E-MATTE-CHAIN: a source cannot itself be matted", () => {
  const second = { ...source("src2"), matte: { by: "src" } };
  assert.ok(codes(compile([source(), second, matted("src2")])).includes("E-MATTE-CHAIN"));
});

// ------------------------------------------------------------------ Lottie

test("Lottie: the source is a td layer directly above the matted layer, which gets tt 1", () => {
  const { lottie } = ok([source(), matted()]);
  const layers = lottie.layers as any[];
  assert.deepEqual(layers.map((l) => l.nm), ["src", "m"]);
  assert.equal(layers[0].td, 1);
  assert.equal(layers[0].tt, undefined);
  assert.equal(layers[1].tt, 1);
  assert.equal(layers[1].td, undefined);
});

test("Lottie: the inverted mode is tt 2", () => {
  const layers = ok([source(), matted("src", "alpha-inverted")]).lottie.layers as any[];
  assert.equal(layers[1].tt, 2);
});

test("Lottie: layers below and above the pair keep painter's order, and the source is not written where it stands", () => {
  const under = { id: "under", type: "rect", w: 20, h: 20, fill: "#00ff00" };
  const over = { id: "over", type: "rect", w: 20, h: 20, fill: "#0000ff" };
  // The source is written first in the scene, the matted node last.
  const layers = ok([over, source(), under, matted()]).lottie.layers as any[];
  assert.deepEqual(layers.map((l) => l.nm), ["src", "m", "under", "over"]);
  assert.deepEqual(layers.map((l) => l.ind), [1, 2, 3, 4]);
});

test("Lottie: a source shared by two nodes is written above each, with its own index", () => {
  const layers = ok([source(), matted("src", "alpha", "a"), matted("src", "alpha", "b")]).lottie.layers as any[];
  assert.deepEqual(layers.map((l) => [l.nm, l.td ?? 0, l.tt ?? 0]), [["src", 1, 0], ["b", 0, 1], ["src", 1, 0], ["a", 0, 1]]);
  assert.equal(new Set(layers.map((l) => l.ind)).size, 4);
});

test("Lottie: a group holding a matte pair becomes a precomposition, as a time window does", () => {
  const { lottie } = ok([{ id: "g", type: "group", children: [source("inner"), matted("inner")] }]);
  assert.equal((lottie.layers as any[])[0].ty, 0);
  const inner = (lottie.assets as any[])[0].layers as any[];
  assert.deepEqual(inner.map((l) => [l.nm, l.td ?? 0, l.tt ?? 0]), [["inner", 1, 0], ["m", 0, 1]]);
});

test("Lottie: a matte file passes the schema with no warnings, and the matte checks accept it", () => {
  const { lottie } = ok([source(), matted()]);
  assert.deepEqual(validateSchema(lottie, "gertie"), []);
  assert.deepEqual(semanticLint(lottie), []);
});

test("semantic check: luma mattes and an orphan tt are rejected, alpha pairs are not", () => {
  const base = (layers: any[]) => ({ fr: 30, ip: 0, op: 30, w: 10, h: 10, layers });
  const layer = (extra: any) => ({ ty: 3, ind: Math.floor(Math.random() * 1e6), ip: 0, op: 30, st: 0, ks: {}, ...extra });
  assert.ok(semanticLint(base([layer({ td: 1 }), layer({ tt: 3 })])).some((d) => d.code === "E-L-SUBSET"));
  assert.ok(semanticLint(base([layer({}), layer({ tt: 1 })])).some((d) => d.code === "E-L-MATTE-ORDER"));
  assert.deepEqual(semanticLint(base([layer({ td: 1 }), layer({ tt: 2 })])).filter((d) => d.code.startsWith("E-L-")), []);
});

// ------------------------------------------------------------------ SVG

test("SVG: the alpha matte is a mask element holding the source, and the source is not drawn outside it", () => {
  const svg: string = ok([source(), matted()]).svg.svg;
  assert.match(svg, /<mask id="[^"]+__matte"[^>]*mask-type="alpha"[^>]*style="mask-type:alpha"/);
  assert.equal((svg.match(/<ellipse/g) ?? []).length, 1);
  assert.match(svg, /<g mask="url\(#[^"]+__matte\)">/);
  assert.ok(svg.indexOf("<mask") < svg.indexOf('<g mask="'));
  assert.ok(!svg.includes("<script"));
});

test("SVG: the inverted matte is a luminance mask with a white rectangle and the source drawn in black", () => {
  const svg: string = ok([source(), matted("src", "alpha-inverted")]).svg.svg;
  const mask = /<mask id="([^"]+)"[^>]*>(.*?)<\/mask>/s.exec(svg);
  assert.ok(mask);
  assert.ok(!(mask[0] as string).includes("mask-type"));
  assert.match(mask[2] as string, /^<rect [^>]*fill="#fff"\/><g class="[^"]+__src">/);
  assert.match(svg, /\.[^{]+__src \[fill\]:not\(\[fill="none"\]\)\{fill:#000!important\}/);
});

test("SVG: a source shared by two nodes has one mask", () => {
  const svg: string = ok([source(), matted("src", "alpha", "a"), matted("src", "alpha", "b")]).svg.svg;
  assert.equal((svg.match(/<mask /g) ?? []).length, 1);
  assert.equal((svg.match(/<g mask=/g) ?? []).length, 2);
});

test("SVG: a matte source inside a group is masked in the group's space and left out of the group's drawing", () => {
  const svg: string = ok([{ id: "g", type: "group", x: 10, children: [source("inner"), matted("inner")] }]).svg.svg;
  assert.equal((svg.match(/<ellipse/g) ?? []).length, 1);
  assert.match(svg, /<g transform="translate\(10 0\)">\s*<g mask=/);
});
