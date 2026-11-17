import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePath, samplePath, PathSyntaxError, type Vec2 } from "../../src/spec/path.ts";

const near = (a: number, b: number, eps = 0.02): void => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

function onCircle(pts: Vec2[], cx: number, cy: number, r: number): void {
  for (const [x, y] of pts) near(Math.hypot(x - cx, y - cy), r, 0.05);
}

test("M L Z makes a closed polygon with straight tangents", () => {
  const [sp] = parsePath("M0 0 L10 0 L10 10 Z");
  assert.ok(sp);
  assert.equal(sp.closed, true);
  assert.equal(sp.v.length, 3);
  assert.deepEqual(sp.o[0], [0, 0]);
});

test("relative commands resolve to absolute", () => {
  const [sp] = parsePath("m10 10 l5 0 l0 5 z");
  assert.deepEqual(sp?.v, [[10, 10], [15, 10], [15, 15]]);
});

test("H h V v", () => {
  const [sp] = parsePath("M0 0 H10 v10 h-10 V0");
  assert.deepEqual(sp?.v, [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]);
  assert.equal(sp?.closed, false);
});

test("closing onto the start vertex drops the duplicate", () => {
  const [sp] = parsePath("M0 0 L10 0 L10 10 L0 0 Z");
  assert.equal(sp?.v.length, 3);
  assert.equal(sp?.closed, true);
});

test("cubic keeps relative tangents", () => {
  const [sp] = parsePath("M0 0 C10 20 30 20 40 0");
  assert.deepEqual(sp?.o[0], [10, 20]);
  assert.deepEqual(sp?.i[1], [-10, 20]);
});

test("S reflects the previous control point", () => {
  const [sp] = parsePath("M0 0 C0 10 10 10 10 0 S20 -10 20 0");
  assert.deepEqual(sp?.o[1], [0, -10]);
});

test("quadratic elevates to a cubic matching the midpoint", () => {
  const [sp] = parsePath("M0 0 Q10 20 20 0");
  assert.ok(sp);
  const pts = samplePath(sp, 2);
  near((pts[1] as Vec2)[0], 10);
  near((pts[1] as Vec2)[1], 10);
});

test("T reflects the previous quadratic control point", () => {
  const [sp] = parsePath("M0 0 Q10 20 20 0 T40 0");
  assert.ok(sp);
  const pts = samplePath(sp, 2);
  near((pts[pts.length - 2] as Vec2)[1], -10);
});

test("arc: half circle stays on the circle", () => {
  const [sp] = parsePath("M0 50 A50 50 0 0 1 100 50");
  assert.ok(sp);
  onCircle(samplePath(sp, 24), 50, 50, 50);
  assert.equal(sp.v.length, 3);
});

test("arc: large-arc flag picks the long way around", () => {
  const [sp] = parsePath("M50 0 A50 50 0 1 1 50 100");
  assert.ok(sp);
  const pts = samplePath(sp, 24);
  onCircle(pts, 50, 50, 50);
  assert.ok(pts.some(([x]) => x > 95));
});

test("arc: compact flags without separators", () => {
  const [sp] = parsePath("M0 0a5 5 0 1010 0");
  assert.ok(sp);
  assert.ok(sp.v.length >= 3);
});

test("arc: radii scaled up when too small", () => {
  const [sp] = parsePath("M0 0 A1 1 0 0 1 100 0");
  assert.ok(sp);
  onCircle(samplePath(sp, 24), 50, 0, 50);
});

test("implicit lineto after M", () => {
  const [sp] = parsePath("M0 0 10 0 10 10");
  assert.equal(sp?.v.length, 3);
});

test("multiple subpaths", () => {
  const sps = parsePath("M0 0 L5 5 M10 10 L20 20 Z");
  assert.equal(sps.length, 2);
  assert.equal(sps[0]?.closed, false);
  assert.equal(sps[1]?.closed, true);
});

test("number grammar: exponents and packed signs", () => {
  const [sp] = parsePath("M1e1-2L.5.5");
  assert.deepEqual(sp?.v, [[10, -2], [0.5, 0.5]]);
});

test("syntax errors carry a position", () => {
  assert.throws(() => parsePath("M0 0 L10"), (e: unknown) => e instanceof PathSyntaxError && e.position >= 8);
  assert.throws(() => parsePath("L0 0"), PathSyntaxError);
  assert.throws(() => parsePath("M0 0 X5 5"), PathSyntaxError);
  assert.throws(() => parsePath(""), PathSyntaxError);
});
