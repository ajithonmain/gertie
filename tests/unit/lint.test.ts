import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSceneText, compileSceneValue } from "../../src/compile.ts";

const dir = join(import.meta.dirname, "../../examples/broken");
const files = readdirSync(dir).filter((f) => f.endsWith(".gertie.json")).sort();

function run(file: string) {
  return compileSceneText(readFileSync(join(dir, file), "utf8"), { fileExists: (s) => existsSync(join(dir, s)) }).diagnostics;
}

for (const file of files) {
  const code = file.replace(".gertie.json", "").toUpperCase();
  test(`broken example ${file} triggers ${code}`, () => {
    const diags = run(file);
    const errors = [...new Set(diags.filter((d) => d.severity === "error").map((d) => d.code))];
    if (code.startsWith("E-")) assert.deepEqual(errors, [code], JSON.stringify(diags));
    else {
      assert.deepEqual(errors, [], JSON.stringify(diags));
      assert.ok(diags.some((d) => d.code === code), JSON.stringify(diags));
    }
    for (const d of diags) if (d.severity === "error") assert.ok(d.fix && d.fix.length > 0, `${d.code} has no fix`);
  });
}

// Non-triggering cases: the valid example raises none of these codes.
test("the valid base scene raises no diagnostics", () => {
  const text = readFileSync(join(dir, "../bouncing-dots.gertie.json"), "utf8");
  assert.deepEqual(compileSceneText(text).diagnostics, []);
});

function scene(patch: (s: any) => void) {
  const s: any = { gertie: 1, name: "t", canvas: { w: 200, h: 200 }, duration: 1, nodes: [{ id: "a", type: "rect", w: 50, h: 50, x: 100, y: 100, fill: "#fff", animate: { x: [[0, 50], [1, 50]] } }] };
  patch(s);
  return compileSceneValue(s).diagnostics;
}
const codes = (d: { code: string }[]) => d.map((x) => x.code);

test("W-NODE-COUNT fires above 200 nodes and not at 200", () => {
  const many = (n: number) => (s: any) => {
    s.nodes = Array.from({ length: n }, (_, i) => ({ id: `n-${i}`, type: "rect", w: 10, h: 10, x: 10, y: 10, fill: "#fff", animate: { x: [[0, 1], [1, 1]] } }));
  };
  assert.ok(codes(scene(many(201))).includes("W-NODE-COUNT"));
  assert.ok(!codes(scene(many(200))).includes("W-NODE-COUNT"));
});

test("W-KEY-COUNT fires above 2000 keyframes", () => {
  const keys = (n: number) => (s: any) => {
    s.duration = 30;
    s.fps = 60;
    s.nodes[0].animate.x = Array.from({ length: n }, (_, i) => [i / 60, i % 2]);
  };
  assert.ok(codes(scene(keys(2001))).includes("W-KEY-COUNT"));
  assert.ok(!codes(scene(keys(100))).includes("W-KEY-COUNT"));
});

test("tier accepts the three tiers, and an unknown value is E-TIER naming them", () => {
  for (const tier of ["icon", "character", "scene"]) assert.deepEqual(codes(scene((s) => { s.tier = tier; })), []);
  const d = scene((s) => { s.tier = "charcter"; });
  assert.deepEqual(codes(d), ["E-TIER"]);
  const hit = d[0];
  assert.ok(hit?.message.includes("icon, character, scene"), hit?.message);
  assert.ok(hit?.message.includes("Did you mean 'character'?"), hit?.message);
  assert.deepEqual(codes(scene((s) => { s.tier = 2; })), ["E-TIER"]);
});

test("a declared tier reaches the normalized scene", () => {
  const s = { gertie: 1, name: "t", tier: "icon", canvas: { w: 200, h: 200 }, duration: 1, nodes: [{ id: "a", type: "rect", w: 50, h: 50, x: 100, y: 100, fill: "#fff", animate: { x: [[0, 50], [1, 60]] } }] };
  const withTier = compileSceneValue(s);
  assert.equal(withTier.scene?.tier, "icon");
  const { tier: _unused, ...without } = s;
  assert.equal(compileSceneValue(without).scene?.tier, undefined);
});

test("unknown field suggests the closest valid field", () => {
  const d = scene((s) => { s.nodes[0].fil = "#fff"; });
  const hit = d.find((x) => x.code === "E-FIELD-UNKNOWN");
  assert.ok(hit?.message.includes("Did you mean 'fill'?"), hit?.message);
});

test("unknown easing suggests the closest name", () => {
  const d = scene((s) => { s.nodes[0].animate.x = [[0, 1], [1, 2, "easeOutQuadd"]]; });
  assert.ok(d.find((x) => x.code === "E-EASE-UNKNOWN")?.message.includes("Did you mean 'easeOutQuad'?"));
});

test("unknown node type does not cascade into geometry errors", () => {
  const d = scene((s) => { s.nodes[0] = { id: "a", type: "circle", r: 5 }; });
  assert.deepEqual(codes(d), ["E-TYPE-UNKNOWN"]);
});

test("all independent problems are reported in one run", () => {
  const d = scene((s) => { s.fps = 31; s.nodes[0].fill = "red"; s.nodes[0].animate.x = [[0, 1]]; });
  assert.deepEqual(new Set(codes(d)), new Set(["E-FPS", "E-COLOR", "E-KEY-SINGLE"]));
});

test("rotation by a full turn does not warn about a loop jump, a partial turn does", () => {
  const rot = (end: number) => (s: any) => { s.nodes[0].animate = { rotation: [[0, 0], [1, end]] }; };
  assert.ok(!codes(scene(rot(360))).includes("W-LOOP-JUMP"));
  assert.ok(codes(scene(rot(180))).includes("W-LOOP-JUMP"));
});

test("a linear x or y move across the whole scene is a scroll and does not warn about a loop jump", () => {
  const move = (prop: string, keys: unknown[]) => (s: any) => { s.nodes[0].animate = { [prop]: keys }; };
  assert.ok(!codes(scene(move("x", [[0, 0], [1, -200, "linear"]]))).includes("W-LOOP-JUMP"));
  assert.ok(!codes(scene(move("y", [[0, 0], [1, 120, "linear"]]))).includes("W-LOOP-JUMP"));
  assert.ok(codes(scene(move("x", [[0, 0], [1, -200]]))).includes("W-LOOP-JUMP"), "an eased move is not a scroll");
  assert.ok(codes(scene(move("x", [[0, 0], [0.5, -100, "linear"], [1, -200, "linear"]]))).includes("W-LOOP-JUMP"), "three keys are not a scroll");
  assert.ok(codes(scene(move("opacity", [[0, 0], [1, 1, "linear"]]))).includes("W-LOOP-JUMP"), "only x and y scroll");
});

test("a non-looping scene does not warn about a loop jump", () => {
  const d = scene((s) => { s.loop = false; s.nodes[0].animate.x = [[0, 1], [1, 90]]; });
  assert.ok(!codes(d).includes("W-LOOP-JUMP"));
});

test("hold easing suppresses W-FAST", () => {
  const d = scene((s) => { s.nodes[0].animate = { opacity: [[0, 1], [0.5, 1], [0.55, 0, "hold"], [1, 1]] }; });
  assert.ok(!codes(d).includes("W-FAST"));
});

test("a shape placed inside the canvas does not warn", () => {
  assert.ok(!codes(scene(() => {})).includes("W-OFFSCREEN"));
});

test("a palette reference resolves and an unknown one is E-COLOR", () => {
  assert.deepEqual(codes(scene((s) => { s.palette = { red: "#ff0000" }; s.nodes[0].fill = "$red"; })), []);
  assert.ok(codes(scene((s) => { s.nodes[0].fill = "$nope"; })).includes("E-COLOR"));
});

test("the long keyframe form is accepted", () => {
  assert.deepEqual(codes(scene((s) => { s.nodes[0].animate.x = [{ t: 0, v: 1 }, { t: 1, v: 1, ease: "linear" }]; })), []);
});

const shapes = (n: number, make: (i: number) => any) => (s: any) => {
  s.nodes = Array.from({ length: n }, (_, i) => make(i));
  s.nodes[0].animate = { x: [[0, 1], [1, 1]] };
};
const palette6 = ["#e11d48", "#3b82f6", "#22c55e", "#f59e0b", "#a855f7", "#14b8a6"];
const rectNode = (i: number, fill: unknown) => ({ id: `r-${i}`, type: "rect", w: 20, h: 20, x: 10, y: 10, fill });
const curvePath = (i: number, fill: unknown) => ({ id: `p-${i}`, type: "path", d: "M 0 0 C 10 0 20 10 20 20 L 0 20 Z", x: 10, y: 10, fill });

test("W-ART-PRIMITIVE fires on 9 primitives and not on 8, nor with a curved path, nor for an icon", () => {
  const prim = (n: number) => shapes(n, (i) => rectNode(i, palette6[i % 6]));
  assert.ok(codes(scene(prim(9))).includes("W-ART-PRIMITIVE"));
  assert.ok(!codes(scene(prim(8))).includes("W-ART-PRIMITIVE"));
  const withCurve = (s: any) => { prim(9)(s); s.nodes[1] = curvePath(1, "#fff"); };
  assert.ok(!codes(scene(withCurve)).includes("W-ART-PRIMITIVE"));
  const straight = (s: any) => { prim(9)(s); s.nodes[1] = { id: "p-1", type: "path", d: "M 0 0 L 20 0 L 20 20 Z", fill: "#fff" }; };
  assert.ok(codes(scene(straight)).includes("W-ART-PRIMITIVE"));
  const icon = (s: any) => { prim(9)(s); s.tier = "icon"; };
  assert.ok(!codes(scene(icon)).includes("W-ART-PRIMITIVE"));
});

test("W-ART-FLAT fires on 13 shapes with 3 colours and no gradient, and not with a fourth colour, a gradient, 12 shapes or an icon", () => {
  const three = ["#111111", "#444444", "#777777"];
  const flat = (n: number) => shapes(n, (i) => curvePath(i, three[i % 3]));
  assert.ok(codes(scene(flat(13))).includes("W-ART-FLAT"));
  assert.ok(!codes(scene(flat(12))).includes("W-ART-FLAT"));
  const fourth = (s: any) => { flat(13)(s); s.nodes[1].fill = "#999999"; };
  assert.ok(!codes(scene(fourth)).includes("W-ART-FLAT"));
  const grad = (s: any) => { flat(13)(s); s.nodes[1].fill = { type: "linear", from: [0, 0], to: [0, 20], stops: [[0, "#111111"], [1, "#777777"]] }; };
  assert.ok(!codes(scene(grad)).includes("W-ART-FLAT"));
  const palette = (s: any) => { s.palette = { a: "#111111", b: "#222222", c: "#333333", d: "#444444" }; shapes(13, (i) => curvePath(i, "$" + "abcd"[i % 4]))(s); };
  assert.ok(!codes(scene(palette)).includes("W-ART-FLAT"));
  const icon = (s: any) => { flat(13)(s); s.tier = "icon"; };
  assert.ok(!codes(scene(icon)).includes("W-ART-FLAT"));
});
