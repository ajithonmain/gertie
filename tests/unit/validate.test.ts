import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSceneText } from "../../src/compile.ts";
import { validateLottie } from "../../src/validate/index.ts";
import { semanticLint } from "../../src/validate/semantic.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Lottie used here is always compiler output, mutated to break one rule.
function base(): any {
  const text = readFileSync(join(import.meta.dirname, "../../examples/timed-nodes.gertie.json"), "utf8");
  const r = compileSceneText(text);
  return JSON.parse(JSON.stringify(r.lottie));
}
const codes = (d: { code: string }[]) => d.map((x) => x.code);
const firstShapeLayer = (l: any) => l.layers.find((x: any) => x.ty === 4 && x.nm === "early");

test("compiler output passes schema and semantic lint with no diagnostics", () => {
  assert.deepEqual(validateLottie(base(), "gertie"), []);
});

test("E-L-KEY-ORDER", () => {
  const l = base();
  const k = firstShapeLayer(l).ks.p.x.k;
  k[1].t = k[0].t - 1;
  assert.ok(codes(semanticLint(l)).includes("E-L-KEY-ORDER"));
});

test("E-L-KEY-HANDLES", () => {
  const l = base();
  delete firstShapeLayer(l).ks.p.x.k[0].o;
  assert.ok(codes(semanticLint(l)).includes("E-L-KEY-HANDLES"));
});

test("E-L-EASE-X", () => {
  const l = base();
  firstShapeLayer(l).ks.p.x.k[0].o.x = [1.5];
  assert.ok(codes(semanticLint(l)).includes("E-L-EASE-X"));
});

test("E-L-GROUP-TR", () => {
  const l = base();
  firstShapeLayer(l).shapes[0].it.pop();
  assert.ok(codes(semanticLint(l)).includes("E-L-GROUP-TR"));
});

test("E-L-STYLE-SCOPE", () => {
  const l = base();
  const it = firstShapeLayer(l).shapes[0].it;
  firstShapeLayer(l).shapes[0].it = it.filter((x: any) => x.ty !== "fl");
  assert.ok(codes(semanticLint(l)).includes("E-L-STYLE-SCOPE"));
});

test("E-L-REF for a missing asset and a missing parent", () => {
  const l = base();
  l.layers.find((x: any) => x.ty === 0).refId = "nope";
  firstShapeLayer(l).parent = 99;
  assert.equal(codes(semanticLint(l)).filter((c) => c === "E-L-REF").length, 2);
});

test("E-L-IND-UNIQUE", () => {
  const l = base();
  l.layers[1].ind = l.layers[0].ind;
  assert.ok(codes(semanticLint(l)).includes("E-L-IND-UNIQUE"));
});

test("E-L-COLOR-RANGE", () => {
  const l = base();
  firstShapeLayer(l).shapes[0].it.find((x: any) => x.ty === "fl").c.k = [255, 0, 0];
  assert.ok(codes(semanticLint(l)).includes("E-L-COLOR-RANGE"));
});

test("E-L-PCT-RANGE", () => {
  const l = base();
  firstShapeLayer(l).shapes[0].it.find((x: any) => x.ty === "fl").o.k = 150;
  assert.ok(codes(semanticLint(l)).includes("E-L-PCT-RANGE"));
});

test("E-L-LAYER-TIME", () => {
  const l = base();
  firstShapeLayer(l).op = firstShapeLayer(l).ip;
  assert.ok(codes(semanticLint(l)).includes("E-L-LAYER-TIME"));
});

test("E-L-PATH-ARRAYS", () => {
  const text = readFileSync(join(import.meta.dirname, "../../examples/morph-triangle.gertie.json"), "utf8");
  const l: any = JSON.parse(JSON.stringify(compileSceneText(text).lottie));
  l.layers[0].shapes[0].it[0].ks.k[0].s[0].i.pop();
  assert.ok(codes(semanticLint(l)).includes("E-L-PATH-ARRAYS"));
});

test("E-L-SUBSET for each banned feature", () => {
  const cases: [string, (l: any) => void][] = [
    ["expression", (l) => { firstShapeLayer(l).ks.r = { a: 0, k: 0, x: "time*10" }; }],
    ["effect", (l) => { firstShapeLayer(l).ef = [{ ty: 5 }]; }],
    ["text", (l) => { firstShapeLayer(l).ty = 5; }],
    ["merge", (l) => { firstShapeLayer(l).shapes[0].it.unshift({ ty: "mm", mm: 1 }); }],
    ["repeater", (l) => { firstShapeLayer(l).shapes[0].it.unshift({ ty: "rp" }); }],
    ["polystar", (l) => { firstShapeLayer(l).shapes[0].it.unshift({ ty: "sr" }); }],
    ["matte", (l) => { firstShapeLayer(l).tt = 3; }],
    ["mask mode", (l) => { firstShapeLayer(l).masksProperties = [{ mode: "s" }]; }],
    ["blend", (l) => { firstShapeLayer(l).bm = 2; }],
    ["time remap", (l) => { firstShapeLayer(l).tm = { a: 0, k: 0 }; }],
    ["auto orient", (l) => { firstShapeLayer(l).ao = 1; }],
  ];
  for (const [name, mutate] of cases) {
    const l = base();
    mutate(l);
    assert.ok(codes(semanticLint(l)).includes("E-L-SUBSET"), name);
  }
});

test("schema failures on compiler output are reported as E-INTERNAL-SCHEMA", () => {
  const l = base();
  firstShapeLayer(l).ks = "broken";
  const d = validateLottie(l, "gertie");
  assert.ok(codes(d).includes("E-INTERNAL-SCHEMA"));
});

test("an external file with an unknown property gets a warning, not an error", () => {
  const l = base();
  firstShapeLayer(l).shapes[0].it[0].zzz = 1;
  const d = validateLottie(l, "external");
  assert.ok(d.some((x) => x.code === "W-L-UNKNOWN-PROP" && x.node === "early"));
  assert.ok(!d.some((x) => x.severity === "error"));
});

test("schema diagnostics are traced back to a node", () => {
  const l = base();
  delete firstShapeLayer(l).ks.o.k;
  const d = validateLottie(l, "gertie");
  assert.ok(d.some((x) => x.node === "early"), JSON.stringify(d));
});

test("W-L-SIZE above 200 KB", () => {
  const l = base();
  l.layers[0].pad = "x".repeat(210 * 1024);
  assert.ok(codes(semanticLint(l)).includes("W-L-SIZE"));
});
