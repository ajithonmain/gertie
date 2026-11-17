import { test } from "node:test";
import assert from "node:assert/strict";
import { collect, framesOf, shapeOf, type OpenSource, type SourceReader } from "../../src/ascii/frames.ts";
import { flatten, layerTimeline, positionAt } from "../../src/ascii/layers.ts";
import { parseAscii } from "../../src/ascii/parse.ts";
import { TYPE_CURSOR } from "../../src/ascii/fx.ts";
import { bezierProgress, EASINGS, type Bezier } from "../../src/presets/easing.ts";
import type { Diagnostic } from "../../src/spec/diagnostics.ts";
import type { NAscii, NAsciiFrame, NLayerKey } from "../../src/ascii/types.ts";

/** A frame from rows of text, with one colour for every non-space cell when given. */
function fr(rows: string[], color: string | null = null, back: string | null = null): NAsciiFrame {
  const w = Math.max(...rows.map((r) => [...r].length));
  const cells = rows.map((r) => {
    const cps = [...r];
    while (cps.length < w) cps.push(" ");
    return cps;
  });
  const grid = (c: string | null): (string | null)[][] | null => (c === null ? null : cells.map((row) => row.map((ch) => (ch === " " ? null : c))));
  return { cells, colors: grid(color), backgrounds: grid(back), hold: 1 };
}
const text = (f: NAsciiFrame): string[] => f.cells.map((r) => r.join(""));

function scene(raw: Record<string, unknown>): NAscii {
  const r = parseAscii({ ascii: 1, ...raw });
  const errs = r.diagnostics.filter((x) => x.severity === "error");
  assert.deepEqual(errs, [], JSON.stringify(errs));
  return r.scene as NAscii;
}
const problems = (raw: Record<string, unknown>): Diagnostic[] => parseAscii({ ascii: 1, ...raw }).diagnostics.filter((x) => x.severity === "error");

/** Every frame of a scene, one per interval. */
async function intervals(s: NAscii, read?: SourceReader): Promise<NAsciiFrame[]> {
  const out: NAsciiFrame[] = [];
  for await (const f of framesOf(s, read)) for (let i = 0; i < f.hold; i++) out.push({ ...f, hold: 1 });
  return out;
}

// ------------------------------------------------------------------ flatten

test("flatten draws layers in order, later on top, with colour and background", () => {
  const under = fr(["aaaa", "aaaa"], "#111111", "#222222");
  const over = fr(["bb"], "#333333", "#444444");
  const f = flatten([under, over], [{ col: 0, row: 0 }, { col: 1, row: 1 }], 4, 2);
  assert.deepEqual(text(f), ["aaaa", "abba"]);
  assert.equal(f.colors?.[1]?.[1], "#333333");
  assert.equal(f.backgrounds?.[1]?.[2], "#444444");
  assert.equal(f.colors?.[1]?.[0], "#111111");
  const swapped = flatten([over, under], [{ col: 1, row: 1 }, { col: 0, row: 0 }], 4, 2);
  assert.deepEqual(text(swapped), ["aaaa", "aaaa"], "the later layer wins");
  assert.equal(f.hold, 1);
});

test("a space is transparent; a non-space cell with no colour replaces the colour under it", () => {
  const under = fr(["xxxxx"], "#ff0000", "#00ff00");
  const over = fr(["o o o"]);
  const f = flatten([under, over], [{ col: 0, row: 0 }, { col: 0, row: 0 }], 5, 1);
  assert.deepEqual(text(f), ["oxoxo"]);
  assert.deepEqual(f.colors?.[0], [null, "#ff0000", null, "#ff0000", null]);
  assert.deepEqual(f.backgrounds?.[0], [null, "#00ff00", null, "#00ff00", null]);
  const none = flatten([fr(["ab"])], [{ col: 0, row: 0 }], 3, 1);
  assert.equal(none.colors, null, "no colour anywhere is null, as in a parsed frame");
  assert.equal(none.backgrounds, null);
});

test("a layer partly off the grid is cut; one wholly off it draws nothing", () => {
  const sprite = fr(["123", "456", "789"]);
  assert.deepEqual(text(flatten([sprite], [{ col: -1, row: -1 }], 4, 3)), ["56  ", "89  ", "    "]);
  assert.deepEqual(text(flatten([sprite], [{ col: 2, row: 1 }], 4, 3)), ["    ", "  12", "  45"]);
  for (const p of [{ col: 4, row: 0 }, { col: -3, row: 0 }, { col: 0, row: 3 }, { col: 0, row: -3 }, { col: 500, row: -500 }]) {
    assert.deepEqual(text(flatten([sprite], [p], 4, 3)), ["    ", "    ", "    "], JSON.stringify(p));
  }
  assert.deepEqual(text(flatten([null, sprite], [{ col: 0, row: 0 }, { col: 0, row: 0 }], 3, 1)), ["123"], "a layer that is not there is skipped");
});

// ------------------------------------------------------------------ positions

test("a moving layer is at its keys at the key times and at the eased position between", () => {
  const ease = EASINGS["easeInOut"] as Bezier;
  const keys: NLayerKey[] = [
    { t: 0, col: -10, row: 20, ease },
    { t: 2, col: 30, row: 0, ease: [0, 0, 1, 1] },
    { t: 3, col: 30, row: 10, ease: "hold" },
    { t: 4, col: 0, row: 0, ease: [0, 0, 1, 1] },
  ];
  assert.deepEqual(positionAt(keys, 0), { col: -10, row: 20 });
  assert.deepEqual(positionAt(keys, 2), { col: 30, row: 0 });
  assert.deepEqual(positionAt(keys, 3), { col: 30, row: 10 });
  assert.deepEqual(positionAt(keys, 4), { col: 0, row: 0 });
  assert.deepEqual(positionAt(keys, -1), { col: -10, row: 20 }, "before the first key");
  assert.deepEqual(positionAt(keys, 9), { col: 0, row: 0 }, "after the last key");
  for (const t of [0.25, 0.5, 1, 1.5, 1.9]) {
    const p = bezierProgress(ease, t / 2);
    assert.deepEqual(positionAt(keys, t), { col: Math.round(-10 + 40 * p), row: Math.round(20 - 20 * p) }, `t ${t}`);
  }
  assert.notDeepEqual(positionAt(keys, 0.5), { col: 0, row: 15 }, "eased, not linear");
  assert.deepEqual(positionAt(keys, 2.5), { col: 30, row: 5 }, "linear");
  assert.deepEqual(positionAt(keys, 3.99), { col: 30, row: 10 }, "hold steps");
  assert.deepEqual(positionAt([], 1), { col: 0, row: 0 });
  assert.deepEqual(positionAt([{ t: 1, col: 4, row: 5, ease: "hold" }], 0), { col: 4, row: 5 }, "one key is a fixed position");
});

test("a scene places a moving layer at the keyed cells", async () => {
  const s = scene({ fps: 10, cols: 20, rows: 3, duration: 1, layers: [{ text: ["@"], at: [[0, 0, 0], [0.5, 10, 2, "linear"]] }] });
  const frames = await intervals(s);
  assert.equal(frames.length, 10);
  const where = (f: NAsciiFrame): [number, number] => {
    for (let r = 0; r < f.cells.length; r++) {
      const c = (f.cells[r] as string[]).indexOf("@");
      if (c >= 0) return [c, r];
    }
    return [-1, -1];
  };
  assert.deepEqual(where(frames[0] as NAsciiFrame), [0, 0]);
  assert.deepEqual(where(frames[2] as NAsciiFrame), [4, 1], "0.2 s is 40 percent of the way, rounded");
  assert.deepEqual(where(frames[5] as NAsciiFrame), [10, 2]);
  assert.deepEqual(where(frames[9] as NAsciiFrame), [10, 2]);
});

// ------------------------------------------------------------------ timing

test("a looping layer repeats and a non-looping one holds its last frame", async () => {
  const one = (loop: boolean) => scene({ fps: 10, cols: 1, rows: 1, duration: 1, layers: [{ frames: [{ text: ["a"] }, { text: ["b"], hold: 2 }], loop }] });
  assert.equal((await intervals(one(true))).map((f) => text(f)[0]).join(""), "abbabbabba");
  assert.equal((await intervals(one(false))).map((f) => text(f)[0]).join(""), "abbbbbbbbb");
  const folded: number[] = [];
  for await (const f of framesOf(one(false))) folded.push(f.hold);
  assert.deepEqual(folded, [1, 9], "identical neighbours fold into one frame");
});

test("from and to bound when a layer is there", async () => {
  const s = scene({ fps: 10, cols: 2, rows: 1, duration: 1, layers: [{ text: ["x"] }, { text: [" y"], from: 0.3, to: 0.7 }] });
  assert.deepEqual((await intervals(s)).map((f) => text(f)[0]), ["x ", "x ", "x ", "xy", "xy", "xy", "xy", "x ", "x ", "x "]);
  const t: NAsciiFrame[] = [];
  for await (const f of layerTimeline({ from: 0.25, to: 0.5, loop: true, color: null }, 10, 10, () => [fr(["q"])])) t.push(f);
  assert.deepEqual(t.map((f) => [f.cells.length, f.hold]), [[0, 3], [1, 1], [1, 1], [0, 5]], "times round up to the next interval, and the holds add up");
});

test("a layer starts its own frames at from, and the scene's duration sets the length", async () => {
  const s = scene({ fps: 10, cols: 1, rows: 1, duration: 0.6, layers: [{ frames: [{ text: ["1"] }, { text: ["2"] }, { text: ["3"] }], from: 0.2, loop: false }] });
  assert.deepEqual((await intervals(s)).map((f) => text(f)[0]), [" ", " ", "1", "2", "3", "3"]);
  assert.equal((await shapeOf(s)).intervals, 6);
});

test("layer colour fills the cells that have none", async () => {
  const s = scene({ fps: 4, cols: 3, rows: 1, duration: 1, layers: [{ frames: [{ text: ["abc"], colors: [["#ff0000", null, null]] }], color: "#00ff00" }] });
  const f = (await intervals(s))[0] as NAsciiFrame;
  assert.deepEqual(f.colors?.[0], ["#ff0000", "#00ff00", "#00ff00"]);
});

// ------------------------------------------------------------------ typing

test("a typed text layer shows n cells n / cps seconds after at, the newest as the cursor", async () => {
  const s = scene({ fps: 10, cols: 12, rows: 2, duration: 3.5, layers: [{ text: ["HELLO WORLD", "OK"], fx: [{ effect: "type", at: 0.5, cps: 5 }] }] });
  const frames = await intervals(s);
  const shown = (f: NAsciiFrame): string => f.cells.map((r) => r.join("").trimEnd()).join("|").replace(/\|+$/, "");
  const visible = (f: NAsciiFrame): number => f.cells.reduce((n, r) => n + r.filter((c) => c !== " ").length, 0);
  for (let k = 0; k <= 5; k++) assert.equal(visible(frames[k] as NAsciiFrame), 0, `nothing before ${0.5 + 1 / 5} s (interval ${k})`);
  // At 0.5 + n / 5 seconds, n cells have appeared: interval 5 + 2n.
  assert.equal(shown(frames[7] as NAsciiFrame), TYPE_CURSOR);
  assert.equal(shown(frames[9] as NAsciiFrame), `H${TYPE_CURSOR}`);
  assert.equal(shown(frames[15] as NAsciiFrame), `HELL${TYPE_CURSOR}`);
  assert.equal(shown(frames[17] as NAsciiFrame), `HELLO${TYPE_CURSOR}`, "a space is typed too, and the cursor shows on it");
  assert.equal(shown(frames[27] as NAsciiFrame), `HELLO WORL${TYPE_CURSOR}`);
  assert.equal(shown(frames[29] as NAsciiFrame), `HELLO WORLD|${TYPE_CURSOR}`, "row ends are not typed");
  assert.equal(shown(frames[30] as NAsciiFrame), `HELLO WORLD|${TYPE_CURSOR}`);
  assert.equal(shown(frames[31] as NAsciiFrame), "HELLO WORLD|OK", "13 cells: all typed at 0.5 + 13 / 5 = 3.1 s, and the cursor is gone");
  assert.equal(shown(frames[34] as NAsciiFrame), "HELLO WORLD|OK");
  for (let n = 1; n <= 12; n++) {
    const f = frames[5 + 2 * n] as NAsciiFrame;
    const cells = f.cells.flatMap((r, ri) => r.slice(0, ri === 0 ? 11 : 2));
    const typed = cells.findIndex((c) => c === TYPE_CURSOR) + 1;
    assert.equal(typed, n, `after ${n} / cps seconds the newest is cell ${n}`);
  }
});

test("type is refused outside text layers, and typing never changes colours", async () => {
  assert.ok(problems({ fps: 10, frames: [{ text: ["ab"] }], fx: [{ effect: "type", at: 0 }] }).some((x) => x.code === "E-ASCII-FX" && /text layer/.test(x.message)));
  const notText = problems({ fps: 10, cols: 4, rows: 1, duration: 1, layers: [{ id: "a", frames: [{ text: ["ab"] }], fx: [{ effect: "type", at: 0 }] }] });
  assert.ok(notText.some((x) => x.code === "E-ASCII-FX" && x.path === "layers[0].fx[0]" && /layers\[0\] \("a"\)/.test(x.message)));
  const s = scene({ fps: 10, cols: 4, rows: 1, duration: 1, layers: [{ text: ["abcd"], color: "#123456", fx: [{ effect: "type", at: 0, cps: 20 }] }] });
  for (const f of await intervals(s)) for (const c of f.colors?.[0] ?? []) assert.ok(c === null || c === "#123456");
});

// ------------------------------------------------------------------ the whole scene

const three = {
  fps: 10,
  cols: 24,
  rows: 6,
  duration: 2,
  layers: [
    { id: "sky", frames: [{ text: ["." + " ".repeat(10) + "*", "   +"] }, { text: [" .", "    +"] }], color: "#888888" },
    { id: "ship", text: ["/^\\", "|o|"], color: "#ff6600", at: [[0, 4, 8], [2, 12, -3, "easeIn"]] },
    { id: "caption", text: ["GO"], at: [[0, 20, 5]], fx: [{ effect: "type", at: 0.3, cps: 4 }, { effect: "shimmer", at: 1, duration: 0.5, chars: "XY", amount: 0.5 }] },
  ],
  fx: [{ effect: "reveal", by: "scatter", at: 0, duration: 0.5, seed: 3 }],
};

test("a scene of three layers flattens to the same frames twice", async () => {
  const a = await collect(scene(three));
  const b = await collect(scene(three));
  assert.deepEqual(a.frames, b.frames);
  assert.equal(a.frames.reduce((n, f) => n + f.hold, 0), 20, "the holds add up to duration times fps");
  assert.equal(a.cols, 24);
  assert.equal(a.rows, 6);
  const last = a.frames[a.frames.length - 1] as NAsciiFrame;
  assert.equal(last.cells[5]?.slice(20, 22).join(""), "GO");
  assert.ok(a.frames.some((f) => f.cells.some((r) => r.join("").includes("/^\\"))), "the ship is seen");
});

test("scene fx run after flattening", async () => {
  const frames = await intervals(scene(three));
  const filled = (f: NAsciiFrame): number => f.cells.reduce((n, r) => n + r.filter((c) => c !== " ").length, 0);
  assert.equal(filled(frames[0] as NAsciiFrame), 0, "the scene's reveal empties the first interval, whatever the layers hold");
  assert.ok(filled(frames[6] as NAsciiFrame) > 0);
});

test("a layer with a source is converted through the injected reader", async () => {
  const opened: string[] = [];
  const read: SourceReader = async (file) => {
    opened.push(file);
    const src: OpenSource = {
      kind: "media",
      width: 8,
      height: 4,
      seconds: 0.2,
      background: null,
      loop: true,
      frameCount: async () => 2,
      async *cells(req) {
        for (let i = 0; i < req.count; i++) yield new Array<number>(req.cols * req.rows * 4).fill(i === 0 ? 255 : 0).map((v, j) => (j % 4 === 3 ? 255 : v));
      },
    };
    return src;
  };
  const s = scene({ fps: 10, cols: 6, rows: 3, duration: 0.6, layers: [{ id: "pic", source: { file: "pic.png", cols: 4, rows: 2, normalize: false } }, { text: ["!"], at: [[0, 5, 0]] }] });
  const shape = await shapeOf(s, read);
  assert.equal(shape.intervals, 6);
  const frames = await intervals(s, read);
  assert.equal(frames.length, 6);
  assert.deepEqual(frames.map((f) => (f.cells[0] as string[]).join("")), ["@@@@ !", "     !", "@@@@ !", "     !", "@@@@ !", "     !"], "the two-frame source loops; white is the last ramp character");
  assert.ok(opened.every((f) => f === "pic.png"));
});

// ------------------------------------------------------------------ parsing and lint

test("a scene with layers needs cols, rows and duration", () => {
  const base = { fps: 10, layers: [{ text: ["x"] }] };
  const codes = (raw: Record<string, unknown>) => problems(raw).map((x) => `${x.code} ${x.path}`);
  assert.deepEqual(codes(base).sort(), ["E-ASCII-SIZE cols", "E-ASCII-SIZE duration", "E-ASCII-SIZE rows"]);
  assert.deepEqual(codes({ ...base, cols: 401, rows: 4, duration: 1 }), ["E-ASCII-SIZE cols"]);
  assert.deepEqual(codes({ ...base, cols: 4, rows: 4, duration: 0 }), ["E-ASCII-SIZE duration"]);
  assert.deepEqual(codes({ ...base, cols: 4, rows: 4, duration: 400 }), ["E-ASCII-TOOMANY duration"], "4000 frames is more than 3600");
  assert.deepEqual(codes({ fps: 10, frames: [{ text: ["x"] }], duration: 1 }), ["E-ASCII-SIZE duration"], "duration without layers");
  assert.ok(codes({ ...base, cols: 4, rows: 4, duration: 1, frames: [{ text: ["x"] }] }).includes("E-ASCII-FRAMES layers"));
  assert.deepEqual(codes({ ...base, cols: 4, rows: 4, duration: 1, fx: [{ effect: "reveal", at: 0.5, duration: 1 }] }), ["E-ASCII-FX fx[0]"], "scene fx must lie inside the duration");
  const ok = scene({ ...base, cols: 4, rows: 4, duration: 1 });
  assert.equal(ok.layers?.length, 1);
  assert.equal(ok.duration, 1);
});

test("each layer has exactly one picture, and its problems name the layer and the field", () => {
  const raw = (layer: unknown) => ({ fps: 10, cols: 10, rows: 4, duration: 2, layers: [{ text: ["ok"] }, layer] });
  const one = (layer: unknown): Diagnostic => {
    const p = problems(raw(layer));
    assert.equal(p.length, 1, JSON.stringify(p));
    return p[0] as Diagnostic;
  };
  let x = one({ id: "koi" });
  assert.equal(x.code, "E-ASCII-FRAMES");
  assert.match(x.message, /layers\[1\] \("koi"\) has no picture/);
  x = one({ text: ["a"], frames: [{ text: ["b"] }] });
  assert.equal(x.code, "E-ASCII-FRAMES");
  assert.match(x.message, /exactly one/);
  x = one({ text: ["a"], colour: "#fff" });
  assert.equal(x.code, "E-ASCII-LAYER");
  assert.equal(x.path, "layers[1].colour");
  assert.match(x.message, /did you mean 'color'/i);
  x = one({ text: ["a"], color: "red" });
  assert.equal(x.code, "E-ASCII-COLOR");
  assert.equal(x.path, "layers[1].color");
  x = one({ id: "Bad Id", text: ["a"] });
  assert.equal(x.path, "layers[1].id");
  assert.equal(problems({ fps: 10, cols: 10, rows: 4, duration: 2, layers: [{ id: "a", text: ["x"] }, { id: "a", text: ["y"] }] })[0]?.message.includes("used by an earlier layer"), true);
  x = one({ text: 5 });
  assert.equal(x.path, "layers[1].text");
  assert.equal(problems(raw({ frames: [{ txt: ["a"] }] }))[0]?.path, "layers[1].frames[0].txt");
  x = one({ frames: [{ text: ["a\tb"] }] });
  assert.equal(x.code, "E-ASCII-CHAR");
  x = one({ text: ["a"], from: 1.5, to: 1 });
  assert.equal(x.path, "layers[1].to");
  x = one({ text: ["a"], to: 3 });
  assert.equal(x.path, "layers[1].to");
  assert.match(x.message, /duration \(2\)/);
  x = one({ text: ["a"], loop: "yes" });
  assert.equal(x.path, "layers[1].loop");
  x = one({ text: ["a"], fx: [{ effect: "reveel", duration: 1 }] });
  assert.equal(x.code, "E-ASCII-FX");
  assert.equal(x.path, "layers[1].fx[0].effect");
  assert.match(x.message, /^layers\[1\]: /);
  x = one({ text: ["a"], fx: [{ effect: "reveal", at: 1.5, duration: 1 }] });
  assert.equal(x.path, "layers[1].fx[0]");
  x = one({ source: { file: "a.png", colls: 4 } });
  assert.equal(x.code, "E-ASCII-SOURCE");
  assert.equal(x.path, "layers[1].source.colls");
  x = one({ framesFile: "missing.txt" });
  assert.equal(x.code, "E-ASCII-FILE");
});

test("position keys are checked", () => {
  const key = (at: unknown): Diagnostic | undefined => problems({ fps: 10, cols: 10, rows: 4, duration: 2, layers: [{ text: ["a"], at }] })[0];
  assert.equal(key([[0, 1, 2], [1, 3, 4, "easeOut"], [2, 0, 0, "hold"]]), undefined);
  assert.equal(key([[0, 1, 2, [0.2, 0, 0.8, 1]]]), undefined, "a bezier is an easing too");
  let x = key([0, 1, 2]) as Diagnostic;
  assert.equal(x.code, "E-ASCII-LAYER");
  assert.match(x.fix ?? "", /Wrap the key in a list: "at": \[\[0,1,2\]\]/);
  x = key([[0, 1]]) as Diagnostic;
  assert.equal(x.path, "layers[0].at[0]");
  x = key([[1, 0, 0], [1, 2, 2]]) as Diagnostic;
  assert.match(x.message, /not after the key before it/);
  x = key([[0, 0, 0, "easeInOt"]]) as Diagnostic;
  assert.equal(x.path, "layers[0].at[0][3]");
  assert.match(x.message, /did you mean 'easeInOut'/i);
  x = key([[0, 0, 0, "bounce"]]) as Diagnostic;
  assert.match(x.message, /not available/);
});

test("a scene with layers has no frame-content warnings and its shape counts one frame per interval", async () => {
  const r = parseAscii({ ascii: 1, fps: 10, cols: 300, rows: 100, duration: 2, layers: [{ text: [" "] }] });
  assert.deepEqual(r.diagnostics, [], "no W-ASCII-EMPTY: there are no frames until it is flattened");
  const shape = await shapeOf(r.scene as NAscii);
  assert.deepEqual([shape.cols, shape.rows, shape.intervals, shape.frames, shape.cells, shape.renderer], [300, 100, 20, 20, 600000, "canvas"]);
});

test("stopping early closes the source of every layer, so a converter or browser is not left open", async () => {
  let closed = 0;
  const read: SourceReader = async () => {
    const src: OpenSource = {
      kind: "media",
      width: 8,
      height: 4,
      seconds: 2,
      background: null,
      loop: true,
      frameCount: async () => 20,
      async *cells(req) {
        try {
          for (let i = 0; i < req.count; i++) yield new Array<number>(req.cols * req.rows * 4).fill(i % 2 === 0 ? 255 : 0).map((v, j) => (j % 4 === 3 ? 255 : v));
        } finally {
          closed++;
        }
      },
    };
    return src;
  };
  const s = scene({ fps: 10, cols: 6, rows: 3, duration: 2, layers: [{ id: "pic", source: { file: "pic.png", cols: 4, rows: 2, normalize: false } }, { text: ["!"], at: [[0, 5, 0]] }] });
  let seen = 0;
  for await (const _ of framesOf(s, read)) if (++seen === 2) break;
  assert.equal(seen, 2);
  assert.ok(closed >= 1, "the layer's source was closed when the caller stopped");
});
