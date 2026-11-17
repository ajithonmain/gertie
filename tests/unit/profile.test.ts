import { test } from "node:test";
import assert from "node:assert/strict";
import { compileSceneValue } from "../../src/compile.ts";
import { profileLottie } from "../../src/lottie-tools/profile.ts";
import { BANDS, markProfile, markValue, profileReport } from "../../src/lottie-tools/bands.ts";
import type { JObj } from "../../src/lottie-tools/time.ts";

/**
 * A small scene whose profile was counted by hand from the scene file:
 * - layers: background, box, leaf, tri = 4 (one layer per top-level node)
 * - paths: leaf (4 vertices, the closing Z adds none) and tri (3) = 2 paths, 7 vertices, 3.5 per path
 * - colours: #111111 background, #3b82f6 box, #ffffff box stroke, #22c55e leaf = 4. tri's gradient stops do not count
 * - gradients: 1
 * - animated properties: box x, box opacity, leaf rotation = 3
 * - keyframes: box x 3; box opacity 4 (the compiler adds a hold key at 0 and one at the end); leaf rotation 3 = 10, 5 per second
 * - segments: 2 + 3 + 2 = 7. Eased: box x 2, leaf 2. Opacity is hold, linear, hold. 4 of 7
 * - curves: easeInOut, easeOut, easeIn and linear = 4 (holds have none)
 * - starts: box x at 0, leaf at 0, opacity at frame 15. One of three is on its own frame
 * - closed loops: box x and leaf rotation end where they start, opacity does not. 2 of 3
 */
function sample(): JObj {
  const r = compileSceneValue({
    gertie: 1,
    name: "profile-sample",
    canvas: { w: 512, h: 384, background: "#111111" },
    fps: 30,
    duration: 2,
    loop: false,
    nodes: [
      {
        id: "box", type: "rect", w: 60, h: 40, x: 100, y: 100, fill: "#3b82f6", stroke: { color: "#ffffff", width: 2 },
        animate: { x: [[0, 100], [1, 200, "easeInOut"], [2, 100, "easeInOut"]], opacity: [[0.5, 1], [1.5, 0.5, "linear"]] },
      },
      { id: "leaf", type: "path", d: "M0 0 L40 0 L40 30 L0 30 Z", x: 200, y: 200, fill: "#22c55e", animate: { rotation: [[0, 0], [1, 10, "easeOut"], [2, 0, "easeIn"]] } },
      { id: "tri", type: "path", d: "M0 0 L20 0 L10 20 Z", x: 300, y: 200, fill: { type: "linear", from: [0, 0], to: [0, 20], stops: [[0, "#f97316"], [1, "#facc15"]] } },
    ],
  });
  assert.ok(r.lottie, JSON.stringify(r.diagnostics));
  return r.lottie as JObj;
}

test("the profile of a small compiled scene matches the hand count", () => {
  const p = profileLottie(sample());
  assert.deepEqual(p.canvas, { w: 512, h: 384, longSide: 512 });
  assert.equal(p.frameRate, 30);
  assert.equal(p.durationSeconds, 2);
  assert.equal(p.layers, 4);
  assert.equal(p.paths, 2);
  assert.equal(p.vertices, 7);
  assert.equal(p.verticesPerPath, 3.5);
  assert.equal(p.colours, 4);
  assert.equal(p.gradients, 1);
  assert.equal(p.animatedProperties, 3);
  assert.equal(p.keyframes, 10);
  assert.equal(p.keyframesPerSecond, 5);
  assert.equal(p.easedShare, 0.571);
  assert.equal(p.easingCurves, 4);
  assert.equal(p.medianKeysPerProperty, 3);
  assert.equal(p.ownStartShare, 0.333);
  assert.equal(p.closedLoopShare, 0.667);
  assert.deepEqual(p.features, ["gradient-fills", "strokes"]);
});

test("a file with no animation and no paths profiles to zeros, not to NaN", () => {
  const r = compileSceneValue({ gertie: 1, name: "still", canvas: { w: 100, h: 100 }, duration: 1, nodes: [{ id: "a", type: "rect", w: 10, h: 10, x: 50, y: 50, fill: "#fff" }] });
  const p = profileLottie(r.lottie as JObj);
  assert.equal(p.paths, 0);
  assert.equal(p.verticesPerPath, 0);
  assert.equal(p.animatedProperties, 0);
  assert.equal(p.easedShare, 0);
  assert.equal(p.ownStartShare, 0);
  assert.equal(p.medianKeysPerProperty, 0);
});

test("a value below, inside and above a range band is marked so", () => {
  const band = { min: 4, max: 8 };
  assert.equal(markValue(3.9, band), "below");
  assert.equal(markValue(4, band), "inside");
  assert.equal(markValue(8, band), "inside");
  assert.equal(markValue(8.1, band), "above");
  assert.equal(markValue(0.5, { min: 0.75 }), "below");
  assert.equal(markValue(1, { min: 0.75 }), "inside");
});

test("a band given as a set of values marks a value between two of them as outside", () => {
  const band = { values: [30, 60] };
  assert.equal(markValue(24, band), "below");
  assert.equal(markValue(30, band), "inside");
  assert.equal(markValue(50, band), "outside");
  assert.equal(markValue(60, band), "inside");
  assert.equal(markValue(120, band), "above");
});

test("markProfile marks every measure of the tier, and profileReport covers all tiers when none is given", () => {
  const doc = sample();
  const icon = markProfile(profileLottie(doc), "icon");
  assert.equal(icon.total, Object.keys(BANDS.icon).length);
  const by = Object.fromEntries(icon.measures.map((m) => [m.measure, m.mark]));
  assert.equal(by["canvasLongSide"], "inside");
  assert.equal(by["layers"], "inside");
  assert.equal(by["paths"], "below");
  assert.equal(by["verticesPerPath"], "below");
  assert.equal(by["keyframesPerSecond"], "below");
  assert.equal(by["easedShare"], "below");
  assert.equal(by["easingCurves"], "inside");
  assert.equal(by["ownStartShare"], "inside");
  assert.equal(icon.inside, icon.measures.filter((m) => m.mark === "inside").length);

  assert.deepEqual(profileReport(doc).bands.map((b) => b.tier), ["icon", "character", "scene"]);
  const one = profileReport(doc, "scene");
  assert.equal(one.tier, "scene");
  assert.deepEqual(one.bands.map((b) => b.tier), ["scene"]);
});
