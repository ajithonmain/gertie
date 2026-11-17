import { test } from "node:test";
import assert from "node:assert/strict";
import { checkBlank, checkClipped, checkConsole, checkEmptyFrames, checkFlicker, checkLoop, checkStatic, type SampledFrame } from "../../src/qa/checks.ts";
import { evenFrames, sampleFrames } from "../../src/qa/sampling.ts";

const f = (frame: number, content: number, edge = 0): SampledFrame => ({ frame, content, edge });
const codes = (d: { code: string }[]) => d.map((x) => x.code);

test("E-R-BLANK fires only when every frame is empty", () => {
  assert.deepEqual(codes(checkBlank([f(0, 0), f(5, 0.0005)])), ["E-R-BLANK"]);
  assert.deepEqual(checkBlank([f(0, 0), f(5, 0.002)]), []);
});

test("E-R-STATIC fires only when no pair of frames differs", () => {
  assert.deepEqual(codes(checkStatic([0, 0.0001])), ["E-R-STATIC"]);
  assert.deepEqual(checkStatic([0, 0.01]), []);
});

test("W-R-LOOP needs a looping scene and a difference above the threshold", () => {
  assert.deepEqual(codes(checkLoop(true, 0.03)), ["W-R-LOOP"]);
  assert.deepEqual(checkLoop(true, 0.001), []);
  assert.deepEqual(checkLoop(false, 0.5), []);
  assert.deepEqual(checkLoop(true, undefined), []);
});

test("W-R-CLIPPED is skipped with a background and fires above 1% of the border", () => {
  assert.deepEqual(codes(checkClipped([f(0, 0.1, 0.02)], false)), ["W-R-CLIPPED"]);
  assert.deepEqual(checkClipped([f(0, 0.1, 0.02)], true), []);
  assert.deepEqual(checkClipped([f(0, 0.1, 0.005)], false), []);
});

test("W-R-EMPTY-FRAMES flags an isolated empty frame, not an empty run at the ends", () => {
  assert.deepEqual(codes(checkEmptyFrames([f(0, 0.1), f(5, 0), f(9, 0.1)])), ["W-R-EMPTY-FRAMES"]);
  assert.deepEqual(checkEmptyFrames([f(0, 0), f(5, 0.1), f(9, 0.1)]), []);
  assert.deepEqual(checkEmptyFrames([f(0, 0.1), f(5, 0), f(9, 0)]), []);
});

test("W-R-FLICKER needs a frame unlike both neighbours that look alike", () => {
  const frames = [f(0, 0.1), f(1, 0.1), f(2, 0.1)];
  assert.deepEqual(codes(checkFlicker(frames, [0.2, 0.2], [0.001])), ["W-R-FLICKER"]);
  assert.deepEqual(checkFlicker(frames, [0.2, 0.2], [0.2]), []);
  assert.deepEqual(checkFlicker(frames, [0.2, 0.001], [0.001]), []);
});

test("W-R-CONSOLE reports each console message, at most five", () => {
  const msgs = Array.from({ length: 8 }, (_, i) => ({ level: "error", text: `m${i}` }));
  assert.equal(checkConsole(msgs).length, 5);
  assert.deepEqual(checkConsole([]), []);
});

test("sampling: eight even frames plus every keyframe, thorough is every frame", () => {
  assert.deepEqual(evenFrames(30, 8), [0, 4, 8, 12, 17, 21, 25, 29]);
  assert.deepEqual(sampleFrames(30, [], {}), [0, 4, 8, 12, 17, 21, 25, 29]);
  assert.deepEqual(sampleFrames(30, [9, 18, 99], {}), [0, 4, 8, 9, 12, 17, 18, 21, 25, 29]);
  assert.equal(sampleFrames(30, [], { thorough: true }).length, 30);
  assert.deepEqual(sampleFrames(1, [0], {}), [0]);
  assert.deepEqual(evenFrames(3, 8), [0, 1, 2]);
});
