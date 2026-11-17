import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSceneText, compileSceneValue } from "../../src/compile.ts";
import { findColorSlots, listColors, parseColorMap, recolorLottie, toHex } from "../../src/lottie-tools/colors.ts";
import { embedLottie, embedProblem } from "../../src/lottie-tools/embed.ts";
import { inspectLottie } from "../../src/lottie-tools/inspect.ts";
import { introduced } from "../../src/lottie-tools/compare.ts";
import { mapTimes, retimeLottie, type JObj } from "../../src/lottie-tools/time.ts";
import { validateLottie } from "../../src/validate/index.ts";

type Any = any; // Lottie documents are explored loosely; the validator is the authority

const root = join(import.meta.dirname, "../..");
// Real After Effects exports shipped with lottie-web (MIT). They are the third-party files of the phase 6 acceptance check.
const dir = join(root, "node_modules/lottie-web/test/animations");
const have = existsSync(join(dir, "ripple.json"));
const third = (name: string): JObj => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
const ACCEPTANCE = ["ripple", "starfish", "lights"];

/** A Lottie file made by the Gertie compiler, so nothing here is written by hand. */
function ours(example: string): JObj {
  const r = compileSceneText(readFileSync(join(root, `examples/${example}.gertie.json`), "utf8"), {});
  assert.ok(r.lottie, example);
  return JSON.parse(JSON.stringify(r.lottie)) as JObj;
}

/** Every `t` of every keyframe list, in document order. */
function keyTimes(doc: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) return void v.forEach(walk);
    if (v === null || typeof v !== "object") return;
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === "k" && Array.isArray(x) && x.length > 0 && x.every((e) => e && typeof e === "object" && typeof (e as Any).t === "number")) for (const e of x) out.push((e as Any).t);
      walk(x);
    }
  };
  walk(doc);
  return out;
}

/** A copy of the document with every colour value replaced by zero, to compare everything else. */
function withoutColors(doc: JObj): string {
  const copy = structuredClone(doc) as JObj;
  for (const s of findColorSlots(copy)) for (let i = 0; i < 3; i++) s.arr[s.at + i] = 0;
  const zeroSolid = (layers: unknown): void => {
    if (Array.isArray(layers)) for (const l of layers) if (l && l.ty === 1) l.sc = "#000000";
  };
  zeroSolid(copy["layers"]);
  if (Array.isArray(copy["assets"])) for (const a of copy["assets"] as Any[]) zeroSolid(a.layers);
  return JSON.stringify(copy);
}

// ---------------------------------------------------------------- time

test("retime scales keyframe times, layer ranges and the animation range, and keeps the frame rate", { skip: !have }, () => {
  const doc = third("starfish");
  const r = retimeLottie(doc, { speed: 2 });
  assert.equal(r.doc["fr"], doc["fr"]);
  assert.equal(r.doc["op"], Math.ceil((doc["op"] as number) / 2));
  assert.equal(r.factor, 0.5);
  const a = keyTimes(doc);
  const b = keyTimes(r.doc);
  assert.equal(a.length, b.length);
  assert.ok(a.length > 5, `${a.length} keyframes`);
  a.forEach((t, i) => assert.ok(Math.abs((b[i] as number) - t * 0.5) < 0.002, `key ${i}: ${t} -> ${b[i]}`));
  (r.doc["layers"] as Any[]).forEach((l, i) => {
    const o = (doc["layers"] as Any[])[i].op;
    assert.ok(Math.abs(l.op - (o === doc["op"] ? r.doc["op"] as number : o / 2)) <= 0.51, `layer ${l.nm}: out ${o} -> ${l.op}`);
  });
});

test("a layer that ended with the animation still does after retiming", { skip: !have }, () => {
  const doc = third("ripple");
  for (const spec of [{ speed: 3 }, { speed: 0.4 }, { duration: 7.3 }]) {
    const r = retimeLottie(doc, spec);
    const op = r.doc["op"] as number;
    for (const l of r.doc["layers"] as Any[]) if ((doc["layers"] as Any[]).find((o) => o.nm === l.nm).op === doc["op"]) assert.equal(l.op, op);
  }
});

test("retime by duration lands on the requested length, and does not change the input", { skip: !have }, () => {
  const doc = third("starfish");
  const copy = JSON.stringify(doc);
  const r = retimeLottie(doc, { duration: 3 });
  assert.ok(Math.abs(r.toSeconds - 3) < 1 / (doc["fr"] as number));
  assert.equal(JSON.stringify(doc), copy);
});

test("retime reaches into precompositions, markers and time remap keyframes", { skip: !have }, () => {
  const doc = third("ripple");
  const r = retimeLottie(doc, { speed: 2 });
  const pre = (r.doc["assets"] as Any[]).find((a) => Array.isArray(a.layers));
  const orig = (doc["assets"] as Any[]).find((a) => Array.isArray(a.layers));
  assert.ok(pre && orig);
  pre.layers.forEach((l: Any, i: number) => assert.ok(Math.abs(l.op - orig.layers[i].op / 2) <= 0.51, `${l.op} vs ${orig.layers[i].op}`));
  const marked = mapTimes({ ...doc, markers: [{ tm: 10, cm: "a", dr: 20 }] } as JObj, { at: (t) => t * 2, span: (d) => d * 2 });
  assert.deepEqual((marked["markers"] as Any[])[0], { tm: 20, cm: "a", dr: 40 });
  const tm = third("starfish");
  const tmr = retimeLottie(tm, { speed: 2 }).doc;
  const find = (d: JObj): Any => (d["layers"] as Any[]).find((l) => l.tm);
  const t0 = find(tm).tm.k.map((k: Any) => k.t);
  const t1 = find(tmr).tm.k.map((k: Any) => k.t);
  t0.forEach((t: number, i: number) => assert.ok(Math.abs(t1[i] - t / 2) < 0.002));
});

test("retime rejects a bad speed or duration and a file with no length", () => {
  const doc = ours("spinner-ring");
  assert.throws(() => retimeLottie(doc, { speed: 0 }), /speed/);
  assert.throws(() => retimeLottie(doc, { speed: -1 }), /speed/);
  assert.throws(() => retimeLottie(doc, { duration: 0 }), /duration/);
  assert.throws(() => retimeLottie({ ...doc, op: doc["ip"] } as JObj, { speed: 2 }), /usable/);
});

test("retiming a Gertie file and back again gives the same keyframe times", () => {
  const doc = ours("bouncing-dots");
  const back = retimeLottie(retimeLottie(doc, { speed: 2 }).doc, { speed: 0.5 }).doc;
  const a = keyTimes(doc);
  const b = keyTimes(back);
  a.forEach((t, i) => assert.ok(Math.abs((b[i] as number) - t) < 0.005));
});

// ---------------------------------------------------------------- colour

test("colours: hex conversion and the colour map syntax", () => {
  assert.equal(toHex([1, 0.5, 0]), "#ff8000");
  assert.deepEqual(parseColorMap("#f00=#00f, #123456=#abcdef"), [{ from: "#f00", to: "#00f" }, { from: "#123456", to: "#abcdef" }]);
  for (const bad of ["", "#f00", "#f00=blue", "#f00=#00f=#fff", "red=blue"]) assert.throws(() => parseColorMap(bad), /colour/, bad);
});

test("every colour of a Gertie file is found, and recolor replaces exactly those", () => {
  const doc = ours("gradient-orb");
  const colors = listColors(doc);
  assert.ok(colors.length >= 2);
  const first = colors[0]!;
  const r = recolorLottie(doc, [{ from: first.hex, to: "#123456" }]);
  assert.equal(r.replaced[0]!.count, first.count);
  assert.ok(listColors(r.doc).some((c) => c.hex === "#123456" && c.count === first.count));
  assert.ok(!listColors(r.doc).some((c) => c.hex === first.hex));
  assert.equal(withoutColors(r.doc), withoutColors(doc), "nothing but colours changed");
});

test("recolor keeps alpha, matches within a tolerance, and the first matching rule wins", () => {
  const doc = ours("color-shift");
  const colors = listColors(doc);
  const base = colors[0]!.hex;
  const near = `#${[1, 3, 5].map((i) => Math.min(255, parseInt(base.slice(i, i + 2), 16) + 3).toString(16).padStart(2, "0")).join("")}`;
  assert.equal(recolorLottie(doc, [{ from: near, to: "#000000" }], 0).replaced[0]!.count, 0);
  assert.ok(recolorLottie(doc, [{ from: near, to: "#000000" }], 4).replaced[0]!.count > 0);
  const two = recolorLottie(doc, [{ from: base, to: "#111111" }, { from: base, to: "#222222" }]);
  assert.ok(two.replaced[0]!.count > 0);
  assert.equal(two.replaced[1]!.count, 0);
});

test("recolor does not change the input", () => {
  const doc = ours("pulse-circle");
  const copy = JSON.stringify(doc);
  recolorLottie(doc, [{ from: listColors(doc)[0]!.hex, to: "#00ff00" }]);
  assert.equal(JSON.stringify(doc), copy);
});

test("real files: solid layers, animated fills and gradient strokes are all recoloured", { skip: !have }, () => {
  for (const [name, use] of [["dalek", "solid-layer"], ["banner", "fill"], ["bodymovin", "fill"], ["ripple", "gradient-stroke"]] as const) {
    const doc = third(name);
    const colors = listColors(doc).filter((c) => c.usedIn.includes(use));
    assert.ok(colors.length > 0, `${name} has ${use} colours`);
    const map = colors.slice(0, 6).map((c, i) => ({ from: c.hex, to: ["#ff0001", "#02ff00", "#0003ff", "#ff04ff", "#05ffff", "#ffff06"][i]! }));
    const r = recolorLottie(doc, map);
    assert.ok(r.replaced.every((x) => x.count > 0), `${name}: ${JSON.stringify(r.replaced)}`);
    assert.equal(withoutColors(r.doc), withoutColors(doc), `${name}: nothing but colours changed`);
    const after = listColors(r.doc);
    for (const m of map) assert.ok(after.some((c) => c.hex === m.to), `${name} has ${m.to}`);
  }
});

// ---------------------------------------------------------------- inspect

test("inspect describes a Gertie file", () => {
  const doc = ours("rocket-launch");
  const i = inspectLottie(doc);
  assert.equal(i.size.w, doc["w"]);
  assert.equal(i.frameRate, doc["fr"]);
  assert.equal(i.layerCount, (doc["layers"] as unknown[]).length);
  assert.ok(i.colors.length > 0);
  assert.ok(i.durationSeconds > 0);
  assert.equal(i.features.expressions, 0);
});

test("inspect reports the features of a real file that fall outside the portable subset", { skip: !have }, () => {
  const i = inspectLottie(third("starfish"));
  assert.equal(i.version, "5.1.6");
  assert.equal(i.features.timeRemaps, 1);
  assert.ok(i.features.expressions > 0 && i.features.effects > 0 && i.features.masks >= 1);
  assert.ok(i.notes.some((n) => /expressions/.test(n)));
  const ripple = inspectLottie(third("ripple"));
  assert.ok(ripple.precomps.length >= 1);
  assert.ok(ripple.layers.some((l) => l.type === "precomp" && l.precomp));
});

test("inspect cuts a long layer list and says so", { skip: !have }, () => {
  const big = third("bm_ronda");
  const i = inspectLottie(big);
  if (i.layerCount > 60) assert.deepEqual(i.layersTruncated, { shown: 60, total: i.layerCount });
  assert.ok(i.layers.length <= 60);
});

// ---------------------------------------------------------------- the acceptance check

for (const name of ACCEPTANCE) {
  for (const [label, edit] of [
    ["recolor", (d: JObj) => recolorLottie(d, [{ from: listColors(d)[0]!.hex, to: "#ff00ff" }]).doc],
    ["retime speed 2", (d: JObj) => retimeLottie(d, { speed: 2 }).doc],
    ["retime speed 0.5", (d: JObj) => retimeLottie(d, { speed: 0.5 }).doc],
    ["retime to 3 seconds", (d: JObj) => retimeLottie(d, { duration: 3 }).doc],
    ["recolor then retime", (d: JObj) => retimeLottie(recolorLottie(d, [{ from: listColors(d)[0]!.hex, to: "#00ffff" }]).doc, { speed: 1.5 }).doc],
  ] as const) {
    test(`third-party ${name}: ${label} adds no validation diagnostics and keeps the structure`, { skip: !have }, () => {
      const doc = third(name);
      const out = edit(doc);
      const added = introduced(validateLottie(doc, "external"), validateLottie(out, "external"));
      assert.deepEqual(added.map((d) => `${d.code} ${d.path}`), []);
      assert.equal((out["layers"] as unknown[]).length, (doc["layers"] as unknown[]).length);
      assert.equal((out["assets"] as unknown[] | undefined)?.length, (doc["assets"] as unknown[] | undefined)?.length);
      assert.equal(keyTimes(out).length, keyTimes(doc).length);
      assert.equal(out["fr"], doc["fr"]);
      assert.equal(out["w"], doc["w"]);
    });
  }
}

test("introduced matches by code and location, and counts repeats", () => {
  const d = (code: string, path: string) => ({ code, severity: "error" as const, path, message: "m" });
  assert.deepEqual(introduced([d("A", "x")], [d("A", "x")]), []);
  assert.deepEqual(introduced([d("A", "x")], [d("A", "x"), d("A", "x")]).length, 1);
  assert.deepEqual(introduced([], [d("B", "y")]).map((x) => x.code), ["B"]);
});

// ---------------------------------------------------------------- embedding a Lottie file in a scene

test("embedProblem accepts a Gertie file and explains why other files are refused", () => {
  assert.equal(embedProblem(ours("spinner-ring")), undefined);
  assert.equal(embedProblem(5)?.code, "E-LOTTIE-INVALID");
  assert.equal(embedProblem({ layers: [] })?.code, "E-LOTTIE-INVALID");
  assert.equal(embedProblem({ fr: 30, ip: 0, op: 0, w: 10, h: 10, layers: [] })?.code, "E-LOTTIE-INVALID");
  assert.equal(embedProblem({ fr: 30, ip: 0, op: 30, w: 10, h: 10, layers: [], assets: [{ id: "i", w: 1, h: 1, u: "images/", p: "a.png", e: 0 }] })?.code, "E-LOTTIE-IMAGES");
  assert.equal(embedProblem({ fr: 30, ip: 0, op: 30, w: 10, h: 10, layers: [], assets: [{ id: "i", w: 1, h: 1, u: "", p: "data:image/png;base64,AAAA", e: 1 }] }), undefined);
});

test("embedLottie rescales time to the scene's frame rate and prefixes asset ids", { skip: !have }, () => {
  const doc = third("ripple");
  const e = embedLottie(doc, "x-", 30);
  assert.equal(e.w, 800);
  const ids = e.assets.map((a) => a.id as string);
  assert.ok(ids.length > 0 && ids.every((id) => id.startsWith("x-")));
  for (const l of e.layers as Any[]) if (l.refId) assert.ok(ids.includes(l.refId), l.refId);
  const o = (doc["layers"] as Any[])[0];
  assert.ok(Math.abs((e.layers as Any[])[0].op - o.op / 2) <= 0.51);
});

const sceneWith = (extra: Any = {}, over: Any = {}): Any => ({ gertie: 1, name: "t", canvas: { w: 512, h: 512 }, fps: 30, duration: 1, loop: true, nodes: [{ id: "spin", type: "lottie", src: "spinner.json", x: 100, y: 50, ...extra }], ...over });
const spinner = (): JObj => ours("spinner-ring");
const opts = (doc: unknown = spinner()) => ({ fileExists: (s: string) => s === "spinner.json", lotties: { "spinner.json": doc } });

test("a scene can place a Lottie file: the output validates and has the file as a precomposition", () => {
  const c = compileSceneValue(sceneWith(), opts());
  assert.deepEqual(c.diagnostics.filter((d) => d.severity === "error"), []);
  const lottie = c.lottie as Any;
  const layer = lottie.layers.find((l: Any) => l.nm === "spin");
  assert.equal(layer.ty, 0);
  assert.ok(lottie.assets.some((a: Any) => a.id === layer.refId && Array.isArray(a.layers)));
  assert.deepEqual(layer.ks.p.k.slice(0, 2), [100, 50]);
});

test("the placed file is rescaled to the scene's frame rate", () => {
  const src = spinner();
  const at60 = compileSceneValue(sceneWith({}, { fps: 60 }), opts(src)).lottie as Any;
  const asset = at60.assets.find((a: Any) => a.id === "lottie-spin");
  const srcOp = (src["layers"] as Any[])[0].op;
  assert.ok(Math.abs(asset.layers[0].op - srcOp * (60 / (src["fr"] as number))) <= 0.51);
});

test("transforms and animation on a lottie node apply to the whole file", () => {
  const c = compileSceneValue(sceneWith({ scale: 0.5, rotation: 10, animate: { opacity: [[0, 0], [0.5, 1], [1, 0]] } }), opts());
  assert.deepEqual(c.diagnostics.filter((d) => d.severity === "error"), []);
  const layer = (c.lottie as Any).layers.find((l: Any) => l.nm === "spin");
  assert.equal(layer.ks.o.a, 1);
});

test("a lottie node inside a group puts the group in a precomposition", () => {
  const scene = sceneWith({}, { nodes: [{ id: "g", type: "group", children: [{ id: "spin", type: "lottie", src: "spinner.json" }] }] });
  const c = compileSceneValue(scene, opts());
  assert.deepEqual(c.diagnostics.filter((d) => d.severity === "error"), []);
});

test("the SVG output is skipped for a scene with a lottie node, and asking for it is E-SVG-LOTTIE", () => {
  const c = compileSceneValue(sceneWith(), opts());
  assert.equal(c.svg, undefined);
  assert.equal(c.svgSkipped, "lottie");
  const asked = compileSceneValue(sceneWith(), { ...opts(), svg: true });
  assert.deepEqual(asked.diagnostics.map((d) => d.code), ["E-SVG-LOTTIE"]);
  assert.ok(asked.diagnostics[0]!.fix);
  assert.equal(compileSceneValue(sceneWith(), { ...opts(), svg: false }).svgSkipped, "off");
});

test("lint: E-LOTTIE-MISSING, E-LOTTIE-INVALID, E-LOTTIE-IMAGES and a missing src", () => {
  const code = (d: { code: string }[]) => d.map((x) => x.code);
  assert.deepEqual(code(compileSceneValue(sceneWith({ src: "nope.json" }), opts()).diagnostics), ["E-LOTTIE-MISSING"]);
  assert.deepEqual(code(compileSceneValue(sceneWith(), opts({ hello: 1 })).diagnostics), ["E-LOTTIE-INVALID"]);
  const withImages = { ...spinner(), assets: [{ id: "i", w: 1, h: 1, u: "images/", p: "a.png", e: 0 }] };
  assert.deepEqual(code(compileSceneValue(sceneWith(), opts(withImages)).diagnostics), ["E-LOTTIE-IMAGES"]);
  const noSrc = sceneWith();
  delete noSrc.nodes[0].src;
  assert.deepEqual(code(compileSceneValue(noSrc, opts()).diagnostics), ["E-FIELD-MISSING"]);
  assert.deepEqual(code(compileSceneValue(sceneWith({ w: 5 }), opts()).diagnostics), ["E-FIELD-UNKNOWN"]);
});

test("lint: W-LOTTIE-DURATION when the file and the node last different times", () => {
  const long = compileSceneValue(sceneWith({}, { duration: 4 }), opts());
  assert.ok(long.diagnostics.some((d) => d.code === "W-LOTTIE-DURATION" && /ends first/.test(d.message)));
  const cut = compileSceneValue(sceneWith({}, { duration: 0.5 }), opts());
  assert.ok(cut.diagnostics.some((d) => d.code === "W-LOTTIE-DURATION" && /cut off/.test(d.message)));
  const timed = compileSceneValue(sceneWith({ from: 0, to: 1 }, { duration: 3 }), opts());
  assert.ok(!timed.diagnostics.some((d) => d.code === "W-LOTTIE-DURATION"));
});

test("placing a real third-party file reports what the portable subset refuses instead of failing", { skip: !have }, () => {
  const c = compileSceneValue(sceneWith({ src: "ripple.json" }, { duration: 6 }), { fileExists: () => true, lotties: { "ripple.json": third("ripple") } });
  assert.ok(c.lottie);
  assert.ok(c.diagnostics.some((d) => d.code === "E-L-SUBSET"));
});

test("the Lottie of a scene with a placed file is deterministic", () => {
  const a = JSON.stringify(compileSceneValue(sceneWith(), opts()).lottie);
  assert.equal(a, JSON.stringify(compileSceneValue(sceneWith(), opts()).lottie));
});
