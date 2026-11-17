import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSceneValue } from "../../src/compile.ts";
import { expandScene, staggerOffsets } from "../../src/presets/expand.ts";
import { PRESET_NAMES, PRESETS } from "../../src/presets/library.ts";
import { RIG_PRESET_NAMES } from "../../src/presets/rigs.ts";
import { expandSpecialEase } from "../../src/presets/ease-expand.ts";
import { rotateCycle, unroll } from "../../src/presets/repeat.ts";
import { bezierProgress, EASINGS, resolveEase, splitBezier } from "../../src/presets/easing.ts";

type Any = any; // scene fragments built in tests; the compiler validates them

// tier "icon" keeps the whole-scene motion warnings quiet, so these tests see only what the preset code reports.
const base = (over: Any = {}): Any => ({ gertie: 1, name: "t", canvas: { w: 300, h: 300 }, duration: 4, loop: false, tier: "icon", ...over });
const rect = (over: Any = {}): Any => ({ id: "a", type: "rect", w: 60, h: 60, x: 150, y: 150, fill: "#ffffff", stroke: { color: "#ff0000", width: 4 }, ...over });
const codes = (d: { code: string }[]): string[] => d.map((x) => x.code);

/** Expanded keyframes of one property of the first node, as [time, value] pairs. */
function keysOf(scene: Any, prop: string, nodeIndex = 0): Any[] {
  const n = (expandScene(scene).scene as Any).nodes[nodeIndex];
  return n.animate?.[prop] ?? [];
}

const REST: Record<string, unknown> = { x: 150, y: 150, rotation: 0, scale: [1, 1], opacity: 1, "trim.end": 1 };
/** Presets whose resting state is not the node's own: an eyelid is flat until it blinks. */
const HIDDEN_AT_REST: Record<string, Record<string, unknown>> = { "lid-blink": { scale: [1, 0] }, rise: { opacity: 0 } };
/** Presets that end away from where they start in some property, because they are hidden at both ends. */
const RESETS = new Set(Object.values(PRESETS).filter((d) => d.resets).map((d) => d.name));

// ---------------------------------------------------------------- every preset

for (const name of PRESET_NAMES) {
  const def = PRESETS[name]!;
  test(`preset ${name}: compiles with no diagnostics and writes keys inside the scene`, () => {
    const scene = base({ duration: 5, nodes: [rect({ motion: [{ preset: name, at: 0.5 }] })] });
    const r = compileSceneValue(scene);
    assert.deepEqual(r.diagnostics, []);
    const n = (expandScene(scene).scene as Any).nodes[0];
    assert.ok(Object.keys(n.animate).length > 0);
    for (const keys of Object.values(n.animate) as Any[][]) {
      assert.ok(keys.length >= 2);
      for (const k of keys) assert.ok(k[0] >= 0 && k[0] <= 5);
    }
  });

  test(`preset ${name}: ${def.category} keys start and end where the category says`, () => {
    const scene = base({ nodes: [rect({ motion: [{ preset: name, at: 0 }] })] });
    const n = (expandScene(scene).scene as Any).nodes[0];
    for (const [prop, keys] of Object.entries(n.animate) as [string, Any[]][]) {
      const first = keys[0][1];
      const last = keys[keys.length - 1][1];
      const rest = HIDDEN_AT_REST[name]?.[prop] ?? REST[prop];
      if (def.category === "entrance") {
        assert.deepEqual(last, rest, `${name} ${prop} should end at rest`);
      } else if (def.category === "exit") {
        assert.deepEqual(first, rest, `${name} ${prop} should start at rest`);
      } else {
        assert.deepEqual(first, rest, `${name} ${prop} should start at rest`);
        if (RESETS.has(name) && prop !== "opacity") assert.notDeepEqual(last, rest, `${name} ${prop} ends away from where it starts`);
        else if (name === "spin") assert.equal((((last as number) - (first as number)) % 360 + 360) % 360, 0, "a spin ends a whole number of turns later");
        else assert.deepEqual(last, rest, `${name} ${prop} should end at rest`);
      }
    }
  });
}

test("entrances change something and exits hide the node or move it away", () => {
  for (const name of ["fade-out", "pop-out", "shrink-out", "slide-out", "draw-off"]) {
    const n = (expandScene(base({ nodes: [rect({ motion: [{ preset: name }] })] })).scene as Any).nodes[0];
    const ends = Object.entries(n.animate).map(([p, k]: [string, Any]) => JSON.stringify(k[k.length - 1][1]) !== JSON.stringify(REST[p]));
    assert.ok(ends.some(Boolean), `${name} should end away from rest`);
  }
});

test("presets are relative to the node's static values", () => {
  const scene = base({ nodes: [rect({ x: 200, scale: 2, opacity: 0.5, motion: [{ preset: "pop-in" }, { preset: "slide-in", at: 1, from: "right", distance: 100 }] })] });
  const sc = keysOf(scene, "scale");
  assert.deepEqual(sc[sc.length - 1][1], [2, 2]);
  const x = keysOf(scene, "x");
  assert.deepEqual([x[0][1], x[x.length - 1][1]], [300, 200]);
  const o = keysOf(scene, "opacity");
  assert.equal(o[o.length - 1][1], 0.5);
});

test("pop-in overshoots by the overshoot parameter", () => {
  const sc = keysOf(base({ nodes: [rect({ motion: [{ preset: "pop-in", overshoot: 1.3 }] })] }), "scale");
  assert.ok(sc.some((k) => k[1][0] === 1.3));
});

test("preset parameters change the result", () => {
  const a = keysOf(base({ nodes: [rect({ motion: [{ preset: "float", distance: 12 }] })] }), "y");
  const b = keysOf(base({ nodes: [rect({ motion: [{ preset: "float", distance: 30 }] })] }), "y");
  assert.equal(a[1][1], 138);
  assert.equal(b[1][1], 120);
});

test("slide-in works from each side and on the right axis", () => {
  for (const [from, prop, start] of [["left", "x", 70], ["right", "x", 230], ["top", "y", 70], ["bottom", "y", 230]] as const) {
    const k = keysOf(base({ nodes: [rect({ motion: [{ preset: "slide-in", from, distance: 80 }] })] }), prop);
    assert.equal(k[0][1], start, from);
  }
});

test("a preset keeps its own duration and start time", () => {
  const k = keysOf(base({ nodes: [rect({ motion: [{ preset: "fade-in", at: 1, duration: 2 }] })] }), "opacity");
  assert.equal(k[0][0], 1);
  assert.equal(k[k.length - 1][0], 3);
});

// ---------------------------------------------------------------- errors

test("E-PRESET-UNKNOWN suggests the closest name", () => {
  const d = compileSceneValue(base({ nodes: [rect({ motion: [{ preset: "pop-inn" }] })] })).diagnostics;
  assert.deepEqual(codes(d), ["E-PRESET-UNKNOWN"]);
  assert.match(d[0]!.message, /pop-in/);
  assert.ok(d[0]!.fix);
});

test("E-PRESET-PARAM for a bad parameter value, a bad enum and a bad time", () => {
  for (const motion of [{ preset: "pulse", amount: "big" }, { preset: "slide-in", from: "up" }, { preset: "fade-in", at: -1 }, { preset: "shake", count: 2.5 }, { preset: "fade-in", duration: 0 }, { preset: "fade-in", repeat: "loop" }]) {
    const d = compileSceneValue(base({ nodes: [rect({ motion: [motion] })] })).diagnostics;
    assert.deepEqual(codes(d), ["E-PRESET-PARAM"], JSON.stringify(motion));
  }
});

test("an unknown field on a motion entry is reported with the valid ones", () => {
  const d = compileSceneValue(base({ nodes: [rect({ motion: [{ preset: "pulse", amout: 1.2 }] })] })).diagnostics;
  assert.deepEqual(codes(d), ["E-FIELD-UNKNOWN"]);
  assert.match(d[0]!.message, /amount/);
});

test("E-PRESET-TARGET when draw-on is used without a stroke", () => {
  const d = compileSceneValue(base({ nodes: [rect({ stroke: undefined, motion: [{ preset: "draw-on" }] })] })).diagnostics;
  assert.deepEqual(codes(d), ["E-PRESET-TARGET"]);
});

test("E-PRESET-RANGE when the preset runs past the scene", () => {
  const d = compileSceneValue(base({ duration: 1, nodes: [rect({ motion: [{ preset: "fade-in", at: 0.8 }] })] })).diagnostics;
  assert.deepEqual(codes(d), ["E-PRESET-RANGE"]);
});

test("E-PRESET-OVERLAP between two presets and between a preset and animate", () => {
  const two = compileSceneValue(base({ nodes: [rect({ motion: [{ preset: "pop-in", at: 0 }, { preset: "pulse", at: 0.2 }] })] })).diagnostics;
  assert.deepEqual(codes(two), ["E-PRESET-OVERLAP"]);
  assert.match(two[0]!.message, /scale/);
  const withAnimate = compileSceneValue(base({ nodes: [rect({ animate: { opacity: [[0, 0.2], [1, 0.8]] }, motion: [{ preset: "fade-in", at: 0.5 }] })] })).diagnostics;
  assert.deepEqual(codes(withAnimate), ["E-PRESET-OVERLAP"]);
});

test("presets over separate time ranges merge, and merge with animate", () => {
  const scene = base({ nodes: [rect({ animate: { opacity: [[3, 1], [4, 0.5]] }, motion: [{ preset: "fade-in", at: 0 }, { preset: "flash", at: 1 }] })] });
  assert.deepEqual(codes(compileSceneValue(scene).diagnostics), []);
  const o = keysOf(scene, "opacity");
  const times = o.map((k) => k[0]);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.equal(new Set(times).size, times.length);
});

test("touching presets do not collide on a frame", () => {
  const scene = base({ nodes: [rect({ motion: [{ preset: "fade-in", at: 0, duration: 1 }, { preset: "fade-out", at: 1, duration: 1 }] })] });
  assert.deepEqual(codes(compileSceneValue(scene).diagnostics), []);
});

test("the old E-NOT-IMPLEMENTED for motion is gone", () => {
  const d = compileSceneValue(base({ nodes: [rect({ motion: [{ preset: "fade-in" }] })] })).diagnostics;
  assert.ok(!codes(d).includes("E-NOT-IMPLEMENTED"));
});

// ---------------------------------------------------------------- special easings

test("bounce lands on the target, then rebounds to 25, 10 and 3 percent", () => {
  const k = expandSpecialEase("bounce", { t: 0, v: 0 }, { t: 2, v: 100 }, 60, (v) => v);
  const values = k.map((x) => Math.round(x.v as number));
  assert.deepEqual(values, [100, 75, 100, 90, 100, 97, 100]);
  assert.equal(k[k.length - 1]!.t, 2);
  const times = k.map((x) => x.t);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
});

test("elastic and spring overshoot and settle on the target", () => {
  const e = expandSpecialEase("elastic", { t: 0, v: 0 }, { t: 1, v: 100 }, 60, (v) => v).map((x) => Math.round(x.v as number));
  assert.deepEqual(e, [130, 85, 107, 97, 100]);
  const s = expandSpecialEase("spring", { t: 0, v: 0 }, { t: 1, v: 100 }, 60, (v) => v).map((x) => Math.round(x.v as number));
  assert.deepEqual(s, [112, 96, 100]);
});

test("special easings work on scale pairs, clamp opacity and never collide on frames", () => {
  const scene = base({ nodes: [rect({ animate: { scale: [[0, [1, 1]], [1, [2, 2], "spring"]], opacity: [[0, 0], [1, 0.9, "elastic"]] } })] });
  const r = compileSceneValue(scene);
  assert.deepEqual(r.diagnostics, []);
  for (const k of keysOf(scene, "opacity")) assert.ok(k[1] >= 0 && k[1] <= 1);
  const tiny = base({ fps: 24, nodes: [rect({ animate: { x: [[0, 0], [0.12, 100, "bounce"]] } })] });
  assert.deepEqual(compileSceneValue(tiny).diagnostics.filter((d) => d.severity === "error"), []);
});

test("E-EASE-TARGET for a special easing on a colour", () => {
  const scene = base({ nodes: [rect({ animate: { fill: [[0, "#ff0000"], [1, "#0000ff", "bounce"]] } })] });
  assert.deepEqual(codes(compileSceneValue(scene).diagnostics), ["E-EASE-TARGET"]);
});

// ---------------------------------------------------------------- repeat

test("repeat loop on animate unrolls whole cycles", () => {
  const scene = base({ duration: 2, loop: true, nodes: [rect({ animate: { rotation: { keys: [[0, -8], [0.5, 8], [1, -8]], repeat: "loop" } } })] });
  assert.deepEqual(compileSceneValue(scene).diagnostics, []);
  assert.deepEqual(keysOf(scene, "rotation").map((k) => k[0]), [0, 0.5, 1, 1.5, 2]);
});

test("repeat pingpong plays backward on odd cycles", () => {
  const scene = base({ duration: 3, nodes: [rect({ animate: { x: { keys: [[0, 0], [1, 100]], repeat: "pingpong" } } })] });
  assert.deepEqual(keysOf(scene, "x").map((k) => [k[0], k[1]]), [[0, 0], [1, 100], [2, 0], [3, 100]]);
});

test("pingpong mirrors the easing of the reversed segment", () => {
  const r = unroll([{ t: 0, v: 0 }, { t: 1, v: 10, ease: [0.1, 0, 0.2, 1] }], "pingpong", 2, 30);
  const back = r.keys[2]!.ease as number[];
  assert.deepEqual(back.map((n) => Math.round(n * 10) / 10), [0.8, 0, 0.9, 1]);
});

test("loop with different first and last values restarts one frame later as a hold", () => {
  const r = unroll([{ t: 0, v: 0 }, { t: 1, v: 10 }], "loop", 2, 30);
  assert.deepEqual(r.keys.map((k) => k.v), [0, 10, 0, 10]);
  assert.equal(r.keys[2]!.ease, "hold");
});

test("W-REPEAT-FIT when the period does not divide the scene", () => {
  const scene = base({ duration: 2.5, nodes: [rect({ animate: { rotation: { keys: [[0, 0], [1, 10], [2, 0]], repeat: "loop" } } })] });
  assert.ok(codes(compileSceneValue(scene).diagnostics).includes("W-REPEAT-FIT"));
  const fits = base({ duration: 2.4, nodes: [rect({ motion: [{ preset: "pulse", repeat: "loop" }] })] });
  assert.ok(!codes(compileSceneValue(fits).diagnostics).includes("W-REPEAT-FIT"));
  const misfit = base({ duration: 2.5, nodes: [rect({ motion: [{ preset: "pulse", repeat: "loop" }] })] });
  assert.ok(codes(compileSceneValue(misfit).diagnostics).includes("W-REPEAT-FIT"));
});

test("a spin with repeat keeps turning", () => {
  const scene = base({ duration: 3, nodes: [rect({ motion: [{ preset: "spin", repeat: "loop" }] })] });
  const k = keysOf(scene, "rotation");
  assert.deepEqual(k.map((x) => x[1]), [0, 360, 720, 1080]);
  assert.deepEqual(compileSceneValue(scene).diagnostics, []);
});

test("a repeat object that is not { keys, repeat } is E-KEY-SHAPE", () => {
  const scene = base({ nodes: [rect({ animate: { x: { keys: [[0, 0], [1, 1]], repeat: "forever" } } })] });
  assert.deepEqual(codes(compileSceneValue(scene).diagnostics), ["E-KEY-SHAPE"]);
});

// ---------------------------------------------------------------- stagger

test("stagger offsets for each order", () => {
  assert.deepEqual(staggerOffsets(4, 0.1, "forward", 1).map((n) => Math.round(n * 10)), [0, 1, 2, 3]);
  assert.deepEqual(staggerOffsets(4, 0.1, "reverse", 1).map((n) => Math.round(n * 10)), [3, 2, 1, 0]);
  assert.deepEqual(staggerOffsets(5, 0.1, "center-out", 1).map((n) => Math.round(n * 10)), [3, 1, 0, 2, 4]);
  assert.deepEqual(staggerOffsets(5, 0.1, "edges-in", 1).map((n) => Math.round(n * 10)), [0, 2, 4, 3, 1]);
  const a = staggerOffsets(6, 0.1, "random", 7);
  assert.deepEqual(a, staggerOffsets(6, 0.1, "random", 7));
  assert.deepEqual([...a].sort((x, y) => x - y).map((n) => Math.round(n * 10)), [0, 1, 2, 3, 4, 5]);
});

test("stagger copies a children preset to every child with an offset", () => {
  const kids = [0, 1, 2].map((i) => rect({ id: `bar-${i}`, x: 50 + i * 80, stroke: undefined }));
  const scene = base({ nodes: [{ id: "bars", type: "group", stagger: { each: 0.2, order: "forward" }, motion: [{ preset: "grow-in", axis: "y", at: 0.5, applyTo: "children" }], children: kids }] });
  assert.deepEqual(compileSceneValue(scene).diagnostics, []);
  const firstKey = ((expandScene(scene).scene as Any).nodes[0].children as Any[]).map((c) => Math.round(c.animate.scale[0][0] * 10) / 10);
  assert.deepEqual(firstKey, [0.5, 0.7, 0.9]);
  const lastKey = ((expandScene(scene).scene as Any).nodes[0].children as Any[]).map((c) => c.animate.scale[c.animate.scale.length - 1][0]);
  assert.deepEqual(lastKey.map((t: number) => Math.round(t * 10) / 10), [1, 1.2, 1.4]);
});

test("stagger on a non-group, a missing applyTo and applyTo on a rig preset", () => {
  assert.deepEqual(codes(compileSceneValue(base({ nodes: [rect({ stagger: { each: 0.1 }, motion: [{ preset: "fade-in" }] })] })).diagnostics), ["E-FIELD-TYPE"]);
  const unused = base({ nodes: [{ id: "g", type: "group", stagger: { each: 0.1 }, motion: [{ preset: "fade-in" }], children: [rect({ id: "c" })] }] });
  assert.ok(codes(compileSceneValue(unused).diagnostics).includes("W-STAGGER-UNUSED"));
  const onRig = base({ nodes: [{ id: "g", type: "group", motion: [{ preset: "rig-idle", applyTo: "children" }], children: [rect({ id: "c" })] }] });
  assert.deepEqual(codes(compileSceneValue(onRig).diagnostics), ["E-PRESET-TARGET"]);
});

// ---------------------------------------------------------------- rigs

const part = (id: string, over: Any = {}): Any => ({ id, type: "rect", w: 20, h: 40, fill: "#cccccc", ...over });
const robot = (motion: Any[], extra: Any[] = []): Any =>
  base({
    nodes: [
      {
        id: "robot", type: "group", x: 150, y: 250, motion,
        children: [
          part("robot-body", { y: -60 }),
          part("robot-arm-l", { x: -30, y: -80 }),
          part("robot-arm-r", { x: 30, y: -80 }),
          part("robot-head", { y: -120 }),
          part("robot-eye-l", { x: -8, y: -120, w: 6, h: 6 }),
          part("robot-eye-r", { x: 8, y: -120, w: 6, h: 6 }),
          part("robot-leg-l", { x: -10, y: -10 }),
          part("robot-leg-r", { x: 10, y: -10 }),
          ...extra,
        ],
      },
    ],
  });

for (const name of RIG_PRESET_NAMES) {
  test(`rig preset ${name}: compiles with no diagnostics and animates parts`, () => {
    const scene = robot([{ preset: name }]);
    assert.deepEqual(compileSceneValue(scene).diagnostics, []);
    const kids = ((expandScene(scene).scene as Any).nodes[0].children as Any[]).filter((c) => c.animate);
    const root = (expandScene(scene).scene as Any).nodes[0];
    assert.ok(kids.length > 0 || root.animate, name);
  });
}

test("E-RIG-PART names the missing part and how to fix it", () => {
  const scene = robot([{ preset: "rig-nod" }]);
  (scene.nodes[0].children as Any[]).splice(3, 1);
  const d = compileSceneValue(scene).diagnostics;
  assert.deepEqual(codes(d), ["E-RIG-PART"]);
  assert.match(d[0]!.message, /-head/);
  assert.match(d[0]!.fix!, /robot-head/);
});

test("rig-wave uses the chosen arm and reports the missing one", () => {
  const left = robot([{ preset: "rig-wave", arm: "l" }]);
  const arm = ((expandScene(left).scene as Any).nodes[0].children as Any[]).find((c) => c.id === "robot-arm-l");
  assert.ok(arm.animate.rotation);
  const missing = robot([{ preset: "rig-wave", arm: "r" }]);
  (missing.nodes[0].children as Any[]).splice(2, 1);
  assert.deepEqual(codes(compileSceneValue(missing).diagnostics), ["E-RIG-PART"]);
});

test("rig-wave makes `count` full waves, each one swing out and one back", () => {
  for (const count of [1, 3, 5]) {
    const arm = ((expandScene(robot([{ preset: "rig-wave", arm: "r", count }])).scene as Any).nodes[0].children as Any[]).find((c) => c.id === "robot-arm-r");
    const v = (arm.animate.rotation as Any[]).map((k) => k[1] as number);
    // After the raise, count the direction changes of the wave.
    const up = v[1]!;
    const wave = v.slice(2, 2 + count * 2);
    assert.equal(wave.length, count * 2);
    wave.forEach((x, i) => assert.ok(i % 2 === 0 ? x < up : x > up, `swing ${i} of ${count}`));
  }
});

test("a right arm raises outward (negative rotation) and a left arm the opposite way", () => {
  const r = ((expandScene(robot([{ preset: "rig-wave", arm: "r" }])).scene as Any).nodes[0].children as Any[]).find((c) => c.id === "robot-arm-r");
  const l = ((expandScene(robot([{ preset: "rig-wave", arm: "l" }])).scene as Any).nodes[0].children as Any[]).find((c) => c.id === "robot-arm-l");
  assert.ok(r.animate.rotation[1][1] < 0);
  assert.ok(l.animate.rotation[1][1] > 0);
});

test("rig presets use the -ctl wrapper for transient motion, so idle and nod can overlap", () => {
  const head = part("robot-head", { y: -120 });
  const ctlScene = robot([{ preset: "rig-nod", at: 1 }, { preset: "rig-idle", at: 0, duration: 3 }]);
  const kids = ctlScene.nodes[0].children as Any[];
  const i = kids.findIndex((c) => c.id === "robot-head");
  kids[i] = { id: "robot-head-ctl", type: "group", children: [head] };
  assert.deepEqual(compileSceneValue(ctlScene).diagnostics, []);
  const root = (expandScene(ctlScene).scene as Any).nodes[0];
  const ctl = (root.children as Any[]).find((c) => c.id === "robot-head-ctl");
  assert.ok(ctl.animate.y, "nod went to the wrapper");
  assert.ok(ctl.children[0].animate.rotation, "idle stayed on the head");
  const noCtl = robot([{ preset: "rig-nod", at: 1 }, { preset: "rig-idle", at: 0, duration: 3 }]);
  assert.deepEqual(codes(compileSceneValue(noCtl).diagnostics), []);
});

test("two rig presets writing the same property of the same part overlap", () => {
  const d = compileSceneValue(robot([{ preset: "rig-shake-head", at: 0 }, { preset: "rig-shake-head", at: 0.5 }])).diagnostics;
  assert.deepEqual(codes(d), ["E-PRESET-OVERLAP"]);
});

test("a rig preset on a node that is not a group is E-PRESET-TARGET", () => {
  assert.deepEqual(codes(compileSceneValue(base({ nodes: [rect({ motion: [{ preset: "rig-idle" }] })] })).diagnostics), ["E-PRESET-TARGET"]);
});

test("rig-blink is repeatable from its seed and different with another", () => {
  const a = JSON.stringify(expandScene(robot([{ preset: "rig-blink", seed: 3 }])).scene);
  assert.equal(a, JSON.stringify(expandScene(robot([{ preset: "rig-blink", seed: 3 }])).scene));
  assert.notEqual(a, JSON.stringify(expandScene(robot([{ preset: "rig-blink", seed: 4 }])).scene));
});

/** The test robot with one arm inside a `-ctl` wrapper, as a rig needs when a wave is layered on the idle. */
const robotWithArmCtl = (motion: Any[], side: "l" | "r" = "r"): Any => {
  const scene = robot(motion);
  const kids = scene.nodes[0].children as Any[];
  const i = kids.findIndex((c) => c.id === `robot-arm-${side}`);
  kids[i] = { id: `robot-arm-${side}-ctl`, type: "group", children: [kids[i]] };
  return scene;
};
const rigKids = (scene: Any): Any[] => (expandScene(scene).scene as Any).nodes[0].children as Any[];

test("rig-idle, rig-blink and rig-wave combine on one rig whose waving arm has a -ctl wrapper", () => {
  const scene = robotWithArmCtl([{ preset: "rig-idle", repeat: "loop" }, { preset: "rig-blink" }, { preset: "rig-wave", at: 0.5 }]);
  scene.duration = 6;
  assert.deepEqual(compileSceneValue(scene).diagnostics, []);
  const ctl = rigKids(scene).find((c) => c.id === "robot-arm-r-ctl");
  assert.ok(ctl.animate.rotation, "the wave went to the wrapper");
  assert.ok(ctl.children[0].animate.rotation, "the idle sway stayed on the arm");
});

test("rig-idle with rig-wave on an arm without a -ctl wrapper is E-PRESET-OVERLAP", () => {
  const scene = robot([{ preset: "rig-idle", repeat: "loop" }, { preset: "rig-wave", at: 0.5 }]);
  scene.duration = 6;
  const d = compileSceneValue(scene).diagnostics;
  assert.deepEqual(codes(d), ["E-PRESET-OVERLAP"]);
  assert.match(d[0]!.fix!, /-ctl/);
});

test("rig-idle sways both arms outward, and the two arms are out of phase", () => {
  const kids = rigKids(robot([{ preset: "rig-idle" }]));
  const l = kids.find((c) => c.id === "robot-arm-l").animate.rotation as Any[];
  const r = kids.find((c) => c.id === "robot-arm-r").animate.rotation as Any[];
  assert.ok(l.length >= 2 && r.length >= 2);
  // Outward is negative for a right arm and positive for a left arm; neither swings inward past rest.
  const rv = r.map((k) => k[1] as number);
  const lv = l.map((k) => k[1] as number);
  assert.equal(Math.min(...rv), -2);
  assert.equal(Math.max(...rv), 0);
  assert.equal(Math.max(...lv), 2);
  assert.equal(Math.min(...lv), 0);
  // Not mirror images: the times of the keys differ, and so do the mirrored values.
  assert.notDeepEqual(l.map((k) => k[0]), r.map((k) => k[0]));
  assert.notDeepEqual(lv, rv.map((v) => -v));
  // The left arm's cycle is closed, so it loops.
  assert.equal(lv[0], lv[lv.length - 1]);
  assert.ok(lv[0]! > 0 && lv[0]! < 2, "the left arm starts part of the way out");
});

test("rig-idle armSway sets the angle, and 0 writes nothing to the arms", () => {
  const wide = rigKids(robot([{ preset: "rig-idle", armSway: 6 }]));
  assert.equal(Math.min(...(wide.find((c) => c.id === "robot-arm-r").animate.rotation as Any[]).map((k) => k[1] as number)), -6);
  const off = robot([{ preset: "rig-idle", armSway: 0 }]);
  assert.deepEqual(compileSceneValue(off).diagnostics, []);
  const kids = rigKids(off);
  assert.equal(kids.find((c) => c.id === "robot-arm-l").animate, undefined);
  assert.equal(kids.find((c) => c.id === "robot-arm-r").animate, undefined);
  assert.ok(kids.find((c) => c.id === "robot-body").animate.y, "the rest of the idle is still written");
  assert.deepEqual(codes(compileSceneValue(robot([{ preset: "rig-idle", armSway: 21 }])).diagnostics), ["E-PRESET-PARAM"]);
});

test("rig-idle on a rig without arms is unchanged by the arm sway", () => {
  const strip = (scene: Any): Any => {
    scene.nodes[0].children = (scene.nodes[0].children as Any[]).filter((c) => !String(c.id).startsWith("robot-arm-"));
    return scene;
  };
  const noArms = strip(robot([{ preset: "rig-idle" }]));
  assert.deepEqual(compileSceneValue(noArms).diagnostics, []);
  // With the sway turned off the parts that remain get exactly the same keys, so the arms add nothing to them.
  assert.deepEqual(expandScene(noArms).scene, expandScene(strip(robot([{ preset: "rig-idle", armSway: 0 }]))).scene);
  const withArms = rigKids(robot([{ preset: "rig-idle" }])).filter((c) => !String(c.id).startsWith("robot-arm-"));
  assert.deepEqual(rigKids(noArms), withArms);
});

// ---------------------------------------------------------------- loops in step

const dots = (count: number, motion: (i: number) => Any[] | undefined, group: Any = {}): Any =>
  base({
    nodes: [
      {
        id: "row", type: "group", ...group,
        children: Array.from({ length: count }, (_, i) => {
          const m = motion(i);
          return rect({ id: `dot-${i}`, x: 40 + i * 50, w: 20, h: 20, ...(m ? { motion: m } : {}) });
        }),
      },
    ],
  });
// The group rule only; the whole-scene start rule has its own tests below.
const syncs = (scene: Any): Any[] => expandScene(scene).diagnostics.filter((d) => d.code === "W-SYNC" && !/start on frame/.test(d.message));

test("W-SYNC: five children running one looping preset in step give exactly one warning", () => {
  const own = dots(5, () => [{ preset: "pulse", duration: 2, repeat: "loop" }]);
  const d = expandScene(own).diagnostics;
  assert.deepEqual(codes(d), ["W-SYNC"]);
  assert.equal(d[0]!.severity, "warning");
  assert.equal(d[0]!.node, "row");
  assert.equal(d[0]!.message, "5 nodes in 'row' run 'pulse' in step, which looks mechanical.");
  assert.match(d[0]!.fix!, /"stagger": \{ "phase": 0\.15 \}/);
  assert.match(d[0]!.fix!, /"applyTo": "children"/);
  // The same from one entry on the group, with no stagger.
  const fromGroup = dots(5, () => undefined, { motion: [{ preset: "pulse", duration: 2, repeat: "loop", applyTo: "children" }] });
  assert.deepEqual(codes(expandScene(fromGroup).diagnostics), ["W-SYNC"]);
  // A stagger that offsets nothing is no exception.
  const flat = dots(5, () => undefined, { stagger: { each: 0 }, motion: [{ preset: "pulse", duration: 2, repeat: "loop", applyTo: "children" }] });
  assert.equal(syncs(flat).length, 1);
});

test("W-SYNC: two children in step give none, three give one", () => {
  assert.deepEqual(syncs(dots(2, () => [{ preset: "pulse", duration: 2, repeat: "loop" }])), []);
  assert.equal(syncs(dots(3, () => [{ preset: "pulse", duration: 2, repeat: "loop" }])).length, 1);
  // Two in step among five, the others on phases of their own.
  assert.deepEqual(syncs(dots(5, (i) => [{ preset: "pulse", duration: 2, repeat: "loop", ...(i < 2 ? {} : { phase: i * 0.15 }) }])), []);
});

test("W-SYNC: the same five with stagger.phase give none, and neither does stagger.each", () => {
  const entry = { preset: "pulse", duration: 2, repeat: "loop", applyTo: "children" };
  assert.deepEqual(expandScene(dots(5, () => undefined, { stagger: { phase: 0.15 }, motion: [entry] })).diagnostics, []);
  // A phase step of one half puts three of five children on the same phase; the stagger is still the author's choice.
  assert.deepEqual(syncs(dots(5, () => undefined, { stagger: { phase: 0.5 }, motion: [entry] })), []);
  assert.deepEqual(syncs(dots(5, () => undefined, { stagger: { each: 0.1 }, motion: [{ ...entry, duration: 1.2 }] })), []);
});

test("W-SYNC: five spins give none", () => {
  assert.deepEqual(expandScene(dots(5, () => [{ preset: "spin", duration: 2, repeat: "loop" }])).diagnostics, []);
});

test("W-SYNC: children with different durations, starts or phases give none", () => {
  assert.deepEqual(syncs(dots(5, (i) => [{ preset: "pulse", duration: 1 + i * 0.25, repeat: "loop" }])), []);
  assert.deepEqual(syncs(dots(5, (i) => [{ preset: "pulse", duration: 0.5, at: i * 0.5, repeat: "loop" }])), []);
  assert.deepEqual(syncs(dots(5, (i) => [{ preset: "pulse", duration: 2, repeat: "loop", ...(i === 0 ? {} : { phase: i * 0.15 }) }])), []);
});

test("W-SYNC: one warning per group and preset, none without repeat or outside a group", () => {
  // Two presets in step on the same five children: one warning each.
  const two = dots(5, () => [{ preset: "pulse", duration: 2, repeat: "loop" }, { preset: "wiggle", duration: 2, repeat: "loop" }]);
  assert.deepEqual(syncs(two).map((d) => d.message), ["5 nodes in 'row' run 'pulse' in step, which looks mechanical.", "5 nodes in 'row' run 'wiggle' in step, which looks mechanical."]);
  // Two sets of three in step with each other but not with the other set: still one warning for the preset.
  const sets = dots(6, (i) => [{ preset: "pulse", duration: i < 3 ? 2 : 1, repeat: "loop" }]);
  assert.equal(syncs(sets).length, 1);
  // A preset played once is not a loop.
  assert.deepEqual(syncs(dots(5, () => [{ preset: "pulse", duration: 2 }])), []);
  // Top-level nodes are not children of a group.
  const top = base({ nodes: Array.from({ length: 5 }, (_, i) => rect({ id: `n-${i}`, x: 40 + i * 50, motion: [{ preset: "pulse", duration: 2, repeat: "loop" }] })) });
  assert.deepEqual(syncs(top), []);
});

// ---------------------------------------------------------------- corpus coverage

test("every preset and rig preset appears in at least one corpus example", () => {
  const dir = join(import.meta.dirname, "../../examples");
  const used = new Set<string>();
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".gertie.json"))) {
    for (const m of readFileSync(join(dir, f), "utf8").matchAll(/"preset"\s*:\s*"([a-z-]+)"/g)) used.add(m[1]!);
  }
  const missing = [...PRESET_NAMES, ...RIG_PRESET_NAMES].filter((n) => !used.has(n));
  assert.deepEqual(missing, [], "add a corpus example that uses each of these presets");
  assert.ok(existsSync(dir));
});

// ------------------------------------------------------------------ phase

/** The value of a numeric keyframe list at a time, by sampling the easing of each segment. */
function valueAt(keys: Any[], t: number): number {
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    const [t1, v1, ease] = keys[i];
    const [t0, v0] = keys[i - 1];
    if (t > t1) continue;
    if (ease === "hold") return t === t1 ? v1 : v0;
    const r = resolveEase(ease);
    assert.equal(r.kind, "ok");
    return v0 + (v1 - v0) * bezierProgress((r as Any).ease, (t - t0) / (t1 - t0));
  }
  return keys[keys.length - 1][1];
}

test("splitBezier cuts an easing into two that trace the same curve", () => {
  for (const name of ["easeInOutSine", "easeOutBack", "easeInQuad", "linear"]) {
    const b = EASINGS[name]!;
    for (const x of [0.2, 0.5, 0.83]) {
      const s = splitBezier(b, x);
      assert.ok(Math.abs(s.p - bezierProgress(b, x)) < 1e-4, `${name} progress at ${x}`);
      for (const u of [0.25, 0.5, 0.75]) {
        assert.ok(Math.abs(s.p * bezierProgress(s.left, u) - bezierProgress(b, x * u)) < 2e-3, `${name} left piece at ${u}`);
        assert.ok(Math.abs(s.p + (1 - s.p) * bezierProgress(s.right, u) - bezierProgress(b, x + (1 - x) * u)) < 2e-3, `${name} right piece at ${u}`);
      }
    }
  }
});

test("phase starts a loop part of the way through and keeps the same motion", () => {
  const plain = keysOf(base({ nodes: [rect({ motion: [{ preset: "wiggle", angle: 10, duration: 2, repeat: "loop" }] })] }), "rotation");
  for (const phase of [0.1, 0.25, 0.4, 0.9]) {
    const turned = keysOf(base({ nodes: [rect({ motion: [{ preset: "wiggle", angle: 10, duration: 2, repeat: "loop", phase }] })] }), "rotation");
    assert.equal(turned[0][0], 0);
    assert.equal(turned[turned.length - 1][0], 4);
    assert.deepEqual(turned[0][1], turned[turned.length - 1][1], "the loop still closes");
    for (let t = 0; t <= 4; t += 0.1) {
      const want = valueAt(plain, (t + phase * 2) % 2);
      assert.ok(Math.abs(valueAt(turned, t) - want) < 0.05, `phase ${phase} at ${t.toFixed(1)}s: ${valueAt(turned, t)} vs ${want}`);
    }
  }
});

test("a phase on a key time swaps the pieces without adding a key", () => {
  const plain = keysOf(base({ nodes: [rect({ motion: [{ preset: "pulse", duration: 2, repeat: "loop" }] })] }), "scale");
  const half = keysOf(base({ nodes: [rect({ motion: [{ preset: "pulse", duration: 2, repeat: "loop", phase: 0.5 }] })] }), "scale");
  assert.equal(half.length, plain.length);
  assert.deepEqual(half[0][1], [1.08, 1.08]);
  assert.deepEqual(half[1][1], [1, 1]);
});

test("phase works on scale pairs and on a rig loop", () => {
  const scale = keysOf(base({ nodes: [rect({ motion: [{ preset: "pulse", duration: 2, repeat: "loop", phase: 0.3 }] })] }), "scale");
  assert.ok(scale[0][1][0] > 1 && scale[0][1][0] < 1.08);
  const r = expandScene(robot([{ preset: "rig-idle", repeat: "loop", phase: 0.4 }]));
  // The test robot's scene is not a whole number of idle cycles, so only errors matter here.
  assert.deepEqual(codes(r.diagnostics).filter((c) => c.startsWith("E-")), []);
});

test("E-PRESET-PARAM for a phase without repeat loop, out of range, or on a spin", () => {
  const bad = (m: Any): string[] => codes(expandScene(base({ nodes: [rect({ motion: [m] })] })).diagnostics);
  assert.deepEqual(bad({ preset: "pulse", phase: 0.3 }), ["E-PRESET-PARAM"]);
  assert.deepEqual(bad({ preset: "pulse", repeat: "pingpong", phase: 0.3 }), ["E-PRESET-PARAM"]);
  assert.deepEqual(bad({ preset: "pulse", repeat: "loop", duration: 2, phase: 1 }), ["E-PRESET-PARAM"]);
  assert.deepEqual(bad({ preset: "spin", repeat: "loop", phase: 0.3 }), ["E-PRESET-PARAM"]);
});

test("stagger phase makes each child trail the one before it, and every loop still fits", () => {
  const kids = [0, 1, 2, 3].map((i) => rect({ id: `k${i}`, x: 40 + i * 60 }));
  const scene = base({ nodes: [{ id: "g", type: "group", stagger: { phase: 0.25 }, motion: [{ preset: "wiggle", angle: 10, duration: 4, repeat: "loop", applyTo: "children" }], children: kids }] });
  const r = expandScene(scene);
  assert.deepEqual(codes(r.diagnostics), []);
  const out = (r.scene as Any).nodes[0].children.map((c: Any) => c.animate.rotation);
  // The first child is at the top of its swing at 1 second; each later child gets there a quarter of a cycle later.
  [1, 2, 3, 0].forEach((t, i) => assert.ok(Math.abs(valueAt(out[i], t) - 10) < 0.05, `child ${i} peaks at ${t}s`));
  for (const k of out) assert.deepEqual(k[0][1], k[k.length - 1][1]);
  assert.deepEqual(codes(expandScene(base({ nodes: [{ id: "g", type: "group", stagger: { phase: 1.5 }, motion: [{ preset: "pulse", applyTo: "children" }], children: kids }] })).diagnostics).filter((c) => c === "E-FIELD-TYPE"), ["E-FIELD-TYPE"]);
});

test("a blink closes faster than it reopens and stays shut for more than a frame", () => {
  const k = keysOf(base({ nodes: [rect({ motion: [{ preset: "blink", at: 1 }] })] }), "scale");
  const shut = k.filter((x: Any) => x[1][1] < 0.2).map((x: Any) => x[0]);
  assert.equal(shut.length, 2, "the closed eye is held");
  const start = k[0][0];
  const end = k[k.length - 1][0];
  assert.ok(shut[0] - start < end - shut[1], "closing is quicker than reopening");
  assert.ok(shut[0] - start >= 0.099, "closing takes at least three frames at 30 fps");
});

// ---------------------------------------------------------------- presets that reset while hidden

const FPS = 30;
const open = (keys: Any[], phase: number): Any[] => rotateCycle(keys, phase, FPS, true)!;

test("rotateCycle without open still refuses a cycle that does not end where it starts", () => {
  const keys = [{ t: 0, v: 0 }, { t: 3, v: 10, ease: "linear" }];
  assert.equal(rotateCycle(keys, 0.5, FPS), undefined);
  assert.equal(rotateCycle(keys, 0.5, FPS, false), undefined);
});

test("rotateCycle with open: a numeric property runs on to its last key, resets one frame later, then restarts", () => {
  const keys = [{ t: 0, v: 0 }, { t: 3, v: 30, ease: "linear" }];
  const turned = open(keys, 0.25);
  const hold = turned.find((k) => k.ease === "hold")!;
  assert.deepEqual(hold.v, 0, "the reset carries the first value");
  assert.ok(Math.abs(hold.t - (Math.round(2.25 * FPS) + 1) / FPS) < 1e-6, "one frame after the old end, on the frame grid");
  assert.ok(Math.abs(turned[0].v - 7.5) < 0.01, "starts a quarter of the way up");
  assert.equal(turned[turned.length - 1].t, 3);
  assert.ok(Math.abs(turned[turned.length - 1].v - 7.5) < 0.01, "ends where it starts");
  const run = turned.slice(0, turned.indexOf(hold));
  assert.deepEqual(run[run.length - 1].v, 30);
});

test("rotateCycle with open: phase 0.5 puts the midpoint first", () => {
  const turned = open([{ t: 0, v: 0 }, { t: 2, v: 20, ease: "linear" }], 0.5);
  assert.ok(Math.abs(turned[0].v - 10) < 0.01);
  assert.equal(turned.filter((k) => k.ease === "hold").length, 1);
  assert.ok(Math.abs(turned[turned.length - 1].v - 10) < 0.01);
});

test("rotateCycle with open: a scale pair is interpolated per component", () => {
  const turned = open([{ t: 0, v: [1, 1] }, { t: 2, v: [1.4, 1.4], ease: "linear" }], 0.25);
  assert.ok(Math.abs(turned[0].v[0] - 1.1) < 0.01 && Math.abs(turned[0].v[1] - 1.1) < 0.01);
  assert.deepEqual(turned.find((k) => k.ease === "hold")!.v, [1, 1]);
});

test("rotateCycle with open: a cut within a frame of the wrap returns the keys unchanged", () => {
  const keys = [{ t: 0, v: 0 }, { t: 3, v: 30, ease: "linear" }];
  assert.deepEqual(open(keys, 0.005), keys);
  assert.deepEqual(open(keys, 0.995), keys);
});

test("rotateCycle with open leaves a closed cycle as the closed rotation does", () => {
  const keys = [{ t: 0, v: 0 }, { t: 1, v: 5, ease: "easeInOutSine" }, { t: 2, v: 0, ease: "easeInOutSine" }];
  assert.deepEqual(open(keys, 0.3), rotateCycle(keys, 0.3, FPS));
});

test("rise is hidden at both ends and moves up and grows while visible", () => {
  const scene = base({ nodes: [rect({ motion: [{ preset: "rise", duration: 3 }] })] });
  const o = keysOf(scene, "opacity");
  assert.equal(o[0][1], 0);
  assert.equal(o[o.length - 1][1], 0);
  assert.equal(keysOf(scene, "y")[1][1], 110);
  assert.deepEqual(keysOf(scene, "scale")[1][1], [1.3, 1.3]);
});

test("rise with repeat loop and phase 0.5 produces no diagnostics and closes in opacity", () => {
  const scene = base({ duration: 6, loop: true, nodes: [rect({ motion: [{ preset: "rise", repeat: "loop", phase: 0.5 }] })] });
  assert.deepEqual(compileSceneValue(scene).diagnostics, []);
  const o = keysOf(scene, "opacity");
  assert.equal(o[0][1], o[o.length - 1][1]);
  assert.ok(keysOf(scene, "y").some((k: Any) => k[2] === "hold"), "y resets while the node is invisible");
});

// ---------------------------------------------------------------- ambient presets

const AMBIENT: Record<string, { param: string; low: number; high: number; prop: string }> = {
  sway: { param: "angle", low: 2, high: 9, prop: "rotation" },
  flicker: { param: "lean", low: 2, high: 9, prop: "rotation" },
  jiggle: { param: "shift", low: 1, high: 8, prop: "x" },
  twinkle: { param: "dip", low: 0.2, high: 0.8, prop: "opacity" },
};

for (const [name, spec] of Object.entries(AMBIENT)) {
  test(`${name}: a parameter changes the result`, () => {
    const at = (v: number): Any[] => keysOf(base({ nodes: [rect({ motion: [{ preset: name, [spec.param]: v }] })] }), spec.prop);
    assert.notDeepEqual(at(spec.low), at(spec.high));
  });

  test(`${name}: repeat loop with a phase compiles clean and closes`, () => {
    const scene = base({ duration: 4, loop: true, nodes: [rect({ motion: [{ preset: name, duration: 2, repeat: "loop", phase: 0.4 }] })] });
    assert.deepEqual(compileSceneValue(scene).diagnostics, []);
    const keys = keysOf(scene, spec.prop);
    assert.deepEqual(keys[0][1], keys[keys.length - 1][1]);
  });
}

test("twinkle rests for the first third of the cycle and dips to half brightness by default", () => {
  const o = keysOf(base({ nodes: [rect({ motion: [{ preset: "twinkle", duration: 1 }] })] }), "opacity");
  assert.equal(o[0][1], 1);
  assert.equal(o[1][1], 1);
  assert.ok(Math.abs(o[1][0] - 0.35) < 0.04);
  assert.equal(Math.min(...o.map((k: Any) => k[1] as number)), 0.5);
});

test("flicker writes both rotation and scale, on different beats", () => {
  const scene = base({ nodes: [rect({ motion: [{ preset: "flicker" }] })] });
  assert.ok(keysOf(scene, "rotation").length > 0);
  assert.ok(keysOf(scene, "scale").length > 0);
  assert.notDeepEqual(keysOf(scene, "rotation").map((k: Any) => k[0]), keysOf(scene, "scale").map((k: Any) => k[0]));
});

test("jiggle with shift 0 and amount 0 stays at rest", () => {
  const scene = base({ nodes: [rect({ motion: [{ preset: "jiggle", amount: 0, shift: 0 }] })] });
  for (const k of keysOf(scene, "x")) assert.equal(k[1], 150);
  for (const k of keysOf(scene, "scale")) assert.deepEqual(k[1], [1, 1]);
});

// ---------------------------------------------------------------- named easings (docs/17 section 3.2)

test("smooth, gentle, snap and settle resolve to their curves, and the default ease is unchanged", () => {
  const want: Record<string, number[]> = { smooth: [0.7, 0, 0.3, 1], gentle: [0.2, 0, 0.8, 1], snap: [0.8, 0, 0.3, 1], settle: [0.3, 1, 0.7, 1] };
  for (const [name, curve] of Object.entries(want)) assert.deepEqual(resolveEase(name), { kind: "ok", ease: curve });
  assert.deepEqual(resolveEase(undefined), { kind: "ok", ease: [0.65, 0, 0.35, 1] });
});

// ---------------------------------------------------------------- overshoot

/** A scene with one square sliding in x, with the given long-form key written last. */
const slide = (last: Any, extra: Any[] = []): Any => base({ nodes: [rect({ animate: { x: [[0, 100], ...extra, last] } })] });

test("overshoot: the key's time is the peak, then a dip under the target, then rest on the written value", () => {
  const scene = slide({ t: 1, v: 200, ease: "easeOut", overshoot: true });
  const keys = keysOf(scene, "x");
  // Distance 100: peak 10 percent past, dip 3 percent under, rest on 200. Times are whole frames at 30 fps.
  assert.deepEqual(keys[0], [0, 100]);
  assert.deepEqual(keys[1], [1, 210, "easeOut"]);
  assert.equal(keys[2][1], 197);
  assert.equal(keys[2][2], "easeInOutSine");
  assert.deepEqual(keys[3].slice(1), [200, "easeInOutSine"]);
  assert.ok(Math.abs(keys[3][0] - 1.3) < 1e-9, "rest is 0.3 seconds after the peak");
  assert.ok(keys[2][0] > 1 && keys[2][0] < keys[3][0]);
  for (const k of keys) assert.ok(Math.abs(k[0] * 30 - Math.round(k[0] * 30)) < 1e-9, "on a frame");
  assert.deepEqual(compileSceneValue(scene).diagnostics, []);
});

test("overshoot: past, back and time are options, back 0 skips the dip, and a move downward overshoots downward", () => {
  const keys = keysOf(slide({ t: 1, v: 100, overshoot: { past: 0.2, back: 0, time: 0.2 } }, [[0.5, 300]]), "x");
  // 300 to 100 is a move of -200: the peak is 20 percent past, at 60.
  assert.deepEqual(keys.map((k: Any) => k[1]), [100, 300, 60, 100]);
  assert.ok(Math.abs(keys[3][0] - 1.2) < 1e-9);
});

test("overshoot: a scale pair overshoots per component, and opacity is clamped to 1", () => {
  const scene = base({ nodes: [rect({ animate: { scale: [[0, [0.5, 0.5]], { t: 0.5, v: [1, 1], overshoot: true }], opacity: [[0, 0.2], { t: 0.5, v: 0.95, overshoot: { past: 0.5 } }] } })] });
  const sc = keysOf(scene, "scale");
  assert.deepEqual(sc[1][1], [1.05, 1.05]);
  const op = keysOf(scene, "opacity");
  assert.equal(op[1][1], 1);
  assert.deepEqual(compileSceneValue(scene).diagnostics, []);
});

test("overshoot: the rest lands before the next key and never on its frame", () => {
  const keys = keysOf(base({ nodes: [rect({ animate: { x: [[0, 100], { t: 1, v: 200, overshoot: { time: 1 } }, [1.2, 150]] } })] }), "x");
  const frames = keys.map((k: Any) => Math.round(k[0] * 30));
  assert.deepEqual(frames, [...new Set(frames)].sort((a: number, b: number) => a - b));
  assert.equal(frames[frames.length - 1], 36);
  assert.ok((frames[frames.length - 2] as number) < 36, "the rest is at least one frame before the next key");
});

test("overshoot inside a repeat is repeated with it", () => {
  const scene = base({ duration: 2, loop: true, nodes: [rect({ animate: { x: { keys: [[0, 100], { t: 0.4, v: 200, overshoot: true }, [1, 100]], repeat: "loop" } } })] });
  const keys = keysOf(scene, "x");
  assert.equal(keys.filter((k: Any) => k[1] === 210).length, 2);
});

test("E-OVERSHOOT: first key, hold, a colour, a bad option, an unknown field, no room and no movement", () => {
  const first = base({ nodes: [rect({ animate: { x: [{ t: 0, v: 100, overshoot: true }, [1, 200]] } })] });
  assert.ok(codes(compileSceneValue(first).diagnostics).includes("E-OVERSHOOT"));
  assert.ok(codes(compileSceneValue(slide({ t: 1, v: 200, ease: "hold", overshoot: true })).diagnostics).includes("E-OVERSHOOT"));
  assert.ok(codes(compileSceneValue(slide({ t: 1, v: 200, ease: "bounce", overshoot: true })).diagnostics).includes("E-OVERSHOOT"));
  const colour = base({ nodes: [rect({ animate: { fill: [[0, "#ff0000"], { t: 1, v: "#0000ff", overshoot: true }] } })] });
  assert.ok(codes(compileSceneValue(colour).diagnostics).includes("E-OVERSHOOT"));
  for (const bad of [{ past: 2 }, { past: "a" }, { wobble: 1 }, "yes", { time: 0 }]) {
    const d = compileSceneValue(slide({ t: 1, v: 200, overshoot: bad })).diagnostics;
    assert.ok(codes(d).includes("E-OVERSHOOT"), JSON.stringify(bad));
  }
  const tight = base({ nodes: [rect({ animate: { x: [[0, 100], { t: 1, v: 200, overshoot: true }, [1.05, 150]] } })] });
  const room = compileSceneValue(tight).diagnostics.find((d) => d.code === "E-OVERSHOOT");
  assert.match(room?.message ?? "", /no room/);
  assert.ok(codes(compileSceneValue(slide({ t: 1, v: 100, overshoot: true })).diagnostics).includes("E-OVERSHOOT"));
});

test("E-OVERSHOOT names the node, the property and the fix", () => {
  const d = compileSceneValue(slide({ t: 1, v: 200, overshoot: { past: 5 } })).diagnostics.find((x) => x.code === "E-OVERSHOOT");
  assert.equal(d?.node, "a");
  assert.match(d?.message ?? "", /'x'/);
  assert.match(d?.fix ?? "", /overshoot/);
});

// ---------------------------------------------------------------- follow

/** A group that swings, with one child that follows it. The scene loops by default. */
function follower(follow: Any, over: Any = {}, parentKeys?: Any): Any {
  const swing = parentKeys ?? [[0, 0], [1, 10, "easeInOut"], [2, 0, "easeInOut"], [3, -10, "easeInOut"], [4, 0, "easeInOut"]];
  return base({ loop: true, ...over, nodes: [{ id: "g", type: "group", pivot: [150, 300], animate: { rotation: swing }, children: [rect({ id: "tip", follow })] }] });
}
const childKeys = (scene: Any, prop = "rotation"): Any[] => (expandScene(scene).scene as Any).nodes[0].children[0].animate?.[prop] ?? [];

test("follow: a child repeats its parent's rotation later and scaled, and the loop still closes", () => {
  const scene = follower({ delay: 0.5, scale: 2 });
  const keys = childKeys(scene);
  assert.equal(keys[0][1], keys[keys.length - 1][1], "first and last values match");
  // The parent reaches 10 at 1 s. The child, trailing by 0.5 s and scaled by 2, reaches 20 at 1.5 s.
  const peak = keys.find((k: Any) => k[1] === 20);
  assert.ok(peak && Math.abs(peak[0] - 1.5) < 1e-9, JSON.stringify(keys));
  assert.ok(keys.some((k: Any) => k[1] === -20 && Math.abs(k[0] - 3.5) < 1e-9));
  const r = compileSceneValue(scene);
  assert.deepEqual(r.diagnostics, []);
});

test("follow: defaults are rotation, 0.1 seconds and a scale of 1.5; the child's own rotation is the rest", () => {
  const keys = childKeys(follower(true));
  assert.ok(keys.some((k: Any) => k[1] === 15 && Math.abs(k[0] - 1.1) < 0.02));
  const shifted = childKeys(follower({ delay: 0.5, scale: 1 }, {}), "rotation");
  assert.ok(shifted.length >= 5);
  const withRest = base({ loop: true, nodes: [{ id: "g", type: "group", animate: { rotation: [[0, 0], [1, 10], [2, 0]] }, children: [rect({ id: "tip", rotation: 5, follow: { scale: 1 } })] }], duration: 2 });
  const k2 = (expandScene(withRest).scene as Any).nodes[0].children[0].animate.rotation;
  assert.ok(k2.some((k: Any) => k[1] === 15), "5 degrees of its own plus 10 of the parent's");
});

test("follow: without a loop the keys are shifted later and a key past the end is dropped", () => {
  const scene = follower({ delay: 0.5, scale: 1 }, { loop: false, duration: 3 }, [[0, 0], [1, 10], [2.8, 0]]);
  const keys = childKeys(scene);
  assert.deepEqual(keys.map((k: Any) => k[0]), [0.5, 1.5]);
});

test("follow: position, several properties, and a chain of followers", () => {
  const scene = base({ loop: true, duration: 2, nodes: [{ id: "g", type: "group", animate: { x: [[0, 0], [1, 30], [2, 0]], y: [[0, 0], [1, -10], [2, 0]] }, children: [{ id: "mid", type: "group", follow: { props: ["x", "y"], delay: 0.2, scale: 1 }, children: [rect({ id: "tip", follow: { props: ["x"], delay: 0.2, scale: 1 } })] }] }] });
  const e = expandScene(scene).scene as Any;
  const mid = e.nodes[0].children[0];
  assert.ok(mid.animate.x && mid.animate.y);
  const tip = mid.children[0];
  assert.ok(tip.animate.x, "the second follower reads keys the first one wrote");
  assert.equal(tip.animate.y, undefined);
  assert.equal(JSON.stringify(e).includes("follow"), false, "the option is gone after expansion");
  assert.deepEqual(compileSceneValue(scene).diagnostics, []);
});

test("E-FOLLOW: no parent group, no animation to follow, the node's own animation, and bad options", () => {
  const top = base({ nodes: [rect({ follow: true, animate: { x: [[0, 1], [1, 2]] } })] });
  assert.match(compileSceneValue(top).diagnostics.find((d) => d.code === "E-FOLLOW")?.message ?? "", /no parent group/);
  const still = base({ nodes: [{ id: "g", type: "group", children: [rect({ follow: true })] }] });
  assert.match(compileSceneValue(still).diagnostics.find((d) => d.code === "E-FOLLOW")?.message ?? "", /no animation of 'rotation'/);
  const own = follower(true);
  (own.nodes[0].children[0] as Any).animate = { rotation: [[0, 0], [1, 5]] };
  assert.match(compileSceneValue(own).diagnostics.find((d) => d.code === "E-FOLLOW")?.message ?? "", /already animates/);
  for (const bad of [{ props: ["scale"] }, { props: [] }, { delay: -1 }, { delay: "a" }, { scale: 0 }, { speed: 2 }, "yes"]) {
    assert.ok(codes(compileSceneValue(follower(bad)).diagnostics).includes("E-FOLLOW"), JSON.stringify(bad));
  }
  const d = compileSceneValue(follower({ scale: 0 })).diagnostics.find((x) => x.code === "E-FOLLOW");
  assert.equal(d?.node, "tip");
  assert.match(d?.fix ?? "", /follow/);
});

// ---------------------------------------------------------------- W-MOTION-SPARSE, W-EASE-UNIFORM, W-SYNC on starts

const warnings = (scene: Any): string[] => codes(compileSceneValue(scene).diagnostics);

test("W-MOTION-SPARSE: over 3 seconds and fewer than 3 keyframes per second", () => {
  const sparse = base({ tier: "character", duration: 6, nodes: [rect({ animate: { x: [[0, 100], [3, 200], [6, 100]] } })] });
  const found = compileSceneValue(sparse).diagnostics.find((d) => d.code === "W-MOTION-SPARSE");
  assert.ok(found);
  assert.match(found.message, /6 seconds/);
  assert.match(found.fix ?? "", /overshoot/);
  const dense = base({ tier: "character", duration: 6, nodes: [rect({ animate: { x: { keys: [[0, 100], [0.25, 140], [0.5, 100]], repeat: "loop" } } })] });
  assert.ok(!warnings(dense).includes("W-MOTION-SPARSE"), "25 keys in 6 seconds is over 4 per second");
});

test("W-MOTION-SPARSE: exactly 3 keyframes per second is enough, a 3 second scene is exempt, and so is an icon", () => {
  const eighteen = Array.from({ length: 18 }, (_, i) => [i * 0.3, i % 2 ? 100 : 140]);
  const enough = base({ tier: "character", duration: 6, nodes: [rect({ animate: { x: eighteen } })] });
  assert.ok(!warnings(enough).includes("W-MOTION-SPARSE"));
  const short = base({ tier: "character", duration: 3, nodes: [rect({ animate: { x: [[0, 100], [3, 200]] } })] });
  assert.ok(!warnings(short).includes("W-MOTION-SPARSE"));
  const icon = base({ tier: "icon", duration: 6, nodes: [rect({ animate: { x: [[0, 100], [3, 200], [6, 100]] } })] });
  assert.ok(!warnings(icon).includes("W-MOTION-SPARSE"));
});

/** 22 segments with the given easing on one node. */
const manySegments = (eases: (string | undefined)[], tier = "character"): Any => {
  const keys: Any[] = [[0, 100]];
  eases.forEach((e, i) => keys.push(e === undefined ? [(i + 1) * 0.1, i % 2 ? 100 : 140] : [(i + 1) * 0.1, i % 2 ? 100 : 140, e]));
  return base({ tier, duration: 4, loop: false, nodes: [rect({ animate: { x: keys } })] });
};

test("W-EASE-UNIFORM: more than 20 eased segments, all one curve", () => {
  const same = manySegments(new Array(21).fill("easeInOutSine"));
  const found = compileSceneValue(same).diagnostics.find((d) => d.code === "W-EASE-UNIFORM");
  assert.ok(found);
  assert.match(found.message, /21 eased segments/);
  assert.ok(warnings(manySegments(new Array(21).fill(undefined))).includes("W-EASE-UNIFORM"), "the default ease counts as one curve");
});

test("W-EASE-UNIFORM: not with two curves, not with 20 segments, not for a linear or hold run, and not for an icon", () => {
  assert.ok(!warnings(manySegments(Array.from({ length: 21 }, (_, i) => (i % 2 ? "smooth" : "gentle")))).includes("W-EASE-UNIFORM"));
  assert.ok(!warnings(manySegments(new Array(20).fill("easeInOutSine"))).includes("W-EASE-UNIFORM"));
  assert.ok(!warnings(manySegments(new Array(25).fill("linear"))).includes("W-EASE-UNIFORM"));
  assert.ok(!warnings(manySegments(new Array(25).fill("hold"))).includes("W-EASE-UNIFORM"));
  assert.ok(!warnings(manySegments(new Array(21).fill("easeInOutSine"), "icon")).includes("W-EASE-UNIFORM"));
});

/** `count` squares, each animating x from `start(i)` seconds. */
const starters = (count: number, start: (i: number) => number, extra: Any = {}): Any =>
  base({ tier: "icon", loop: false, ...extra, nodes: Array.from({ length: count }, (_, i) => rect({ id: `n-${i}`, animate: { x: [[start(i), 100], [start(i) + 0.5, 150]] } })) });
const startWarning = (scene: Any): boolean => compileSceneValue(scene).diagnostics.some((d) => d.code === "W-SYNC" && /start on frame/.test(d.message));

test("W-SYNC on starts: more than 6 animated properties and over 80 percent on one frame", () => {
  const scene = starters(7, () => 0);
  const found = compileSceneValue(scene).diagnostics.find((d) => d.code === "W-SYNC");
  assert.ok(found);
  assert.match(found.message, /7 of 7 animated properties start on frame 0/);
  assert.match(found.fix ?? "", /stagger of 0.03 to 0.1 seconds/);
  assert.ok(startWarning(starters(10, (i) => (i === 0 ? 0.2 : 0))), "9 of 10 is over 80 percent");
});

test("W-SYNC on starts: not with 6 properties, with offsets, with 80 percent or less, or with phased loops", () => {
  assert.ok(!startWarning(starters(6, () => 0)));
  assert.ok(!startWarning(starters(8, (i) => i * 0.05)));
  assert.ok(!startWarning(starters(10, (i) => (i < 2 ? 0.2 : 0))), "8 of 10 is exactly 80 percent");
  const loops = base({ tier: "icon", duration: 4, loop: true, nodes: [{ id: "row", type: "group", stagger: { phase: 0.12 }, motion: [{ preset: "wiggle", angle: 5, duration: 4, repeat: "loop", applyTo: "children" }], children: Array.from({ length: 8 }, (_, i) => rect({ id: `b-${i}` })) }] });
  assert.ok(!startWarning(loops), "a phase starts each loop at its own point in the cycle");
  const staggered = base({ tier: "icon", duration: 4, loop: false, nodes: [{ id: "row", type: "group", stagger: { each: 0.06 }, motion: [{ preset: "pop-in", applyTo: "children" }], children: Array.from({ length: 8 }, (_, i) => rect({ id: `c-${i}` })) }] });
  assert.ok(!startWarning(staggered));
});

test("W-SYNC on starts: a key that holds the resting value is not the start", () => {
  // Every property has a key at 0, but each begins to change at its own time.
  const held = base({ tier: "icon", loop: false, nodes: Array.from({ length: 8 }, (_, i) => rect({ id: `h-${i}`, animate: { x: [[0, 100], [0.2 + i * 0.05, 100], [1, 150]] } })) });
  assert.ok(!startWarning(held));
  // Held to the same frame, they still start together.
  const together = base({ tier: "icon", loop: false, nodes: Array.from({ length: 8 }, (_, i) => rect({ id: `t-${i}`, animate: { x: [[0, 100], [0.3, 100], [1, 150]] } })) });
  const found = compileSceneValue(together).diagnostics.find((d) => d.code === "W-SYNC");
  assert.match(found?.message ?? "", /8 of 8 animated properties start on frame 9/);
});

test("W-SYNC on starts: followers with a delay count as their own start", () => {
  const kids = Array.from({ length: 7 }, (_, i) => rect({ id: `k-${i}`, follow: { delay: 0.1 } }));
  const scene = base({ tier: "icon", loop: true, nodes: [{ id: "g", type: "group", animate: { rotation: [[0, 0], [2, 10], [4, 0]] }, children: kids }] });
  assert.ok(!startWarning(scene));
});
