import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyFx, checkFxRange, parseFx } from "../../src/ascii/fx.ts";
import { appendFx } from "../../src/ascii/format.ts";
import { collect, framesOf, shapeOf, AsciiSourceError, type OpenSource, type SourceReader } from "../../src/ascii/frames.ts";
import { parseAscii } from "../../src/ascii/parse.ts";
import type { Diagnostic } from "../../src/spec/diagnostics.ts";
import type { NAscii, NAsciiFrame, NAsciiFx } from "../../src/ascii/types.ts";

const root = join(import.meta.dirname, "../..");
const FPS = 10;

/** A frame of `cols` by `rows` cells, all the same character, with a colour per column and an optional background. */
function block(cols: number, rows: number, ch = "#", hold = 1, withBack = false): NAsciiFrame {
  const palette = ["#ff0000", "#00ff00", "#0000ff", "#ffff00"];
  return {
    cells: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ch)),
    colors: Array.from({ length: rows }, () => Array.from({ length: cols }, (_, c) => palette[c % 4] as string)),
    backgrounds: withBack ? Array.from({ length: rows }, () => Array.from({ length: cols }, () => "#112233")) : null,
    hold,
  };
}

const fx = (o: Partial<NAsciiFx> & { effect: NAsciiFx["effect"] }): NAsciiFx => ({ at: 0, duration: 1, seed: 0, ...o });

async function run(frames: NAsciiFrame[], list: NAsciiFx[], opts: { ramp?: string } = {}): Promise<NAsciiFrame[]> {
  const out: NAsciiFrame[] = [];
  for await (const f of applyFx(frames, list, FPS, opts)) out.push(f);
  return out;
}

/** One frame per interval. */
const perInterval = (frames: NAsciiFrame[]): NAsciiFrame[] => frames.flatMap((f) => Array.from({ length: f.hold }, () => ({ ...f, hold: 1 })));
const text = (f: NAsciiFrame): string => f.cells.map((r) => r.join("")).join("\n");
const filled = (f: NAsciiFrame): number => f.cells.reduce((n, r) => n + r.filter((c) => c !== " ").length, 0);
const total = (frames: NAsciiFrame[]): number => frames.reduce((n, f) => n + f.hold, 0);

// ------------------------------------------------------------------ parsing and lint

const problems = (raw: unknown): Diagnostic[] => {
  const d: Diagnostic[] = [];
  parseFx(raw, d);
  return d;
};

test("a valid fx list parses, with defaults", () => {
  const d: Diagnostic[] = [];
  const list = parseFx(
    [
      { effect: "reveal", duration: 2 },
      { effect: "hide", by: "rows-up", at: 1, duration: 1, seed: 4 },
      { effect: "decode", chars: "01", duration: 1 },
      { effect: "shimmer", duration: 1 },
      { effect: "type", at: 0.5 },
    ],
    d,
  );
  assert.deepEqual(d, []);
  assert.deepEqual(list[0], { effect: "reveal", at: 0, duration: 2, seed: 0, by: "scatter" });
  assert.deepEqual(list[1], { effect: "hide", at: 1, duration: 1, seed: 4, by: "rows-up" });
  assert.deepEqual(list[2], { effect: "decode", at: 0, duration: 1, seed: 0, chars: "01" });
  assert.deepEqual(list[3], { effect: "shimmer", at: 0, duration: 1, seed: 0, amount: 0.1 });
  assert.deepEqual(list[4], { effect: "type", at: 0.5, duration: 0, seed: 0, cps: 30 }, "type is only parsed here; duration is ignored");
});

test("an unknown effect, parameter or by gets E-ASCII-FX with the nearest valid name", () => {
  const e = problems([{ effect: "revael", duration: 1 }]);
  assert.equal(e[0]?.code, "E-ASCII-FX");
  assert.match(e[0]?.message ?? "", /Did you mean 'reveal'\?/);
  assert.equal(e[0]?.path, "fx[0].effect");
  const p = problems([{ effect: "reveal", duration: 1, seeed: 3 }]);
  assert.match(p[0]?.message ?? "", /Unknown parameter 'seeed'.*Did you mean 'seed'\?/);
  const wrong = problems([{ effect: "reveal", duration: 1, amount: 0.5 }]);
  assert.match(wrong[0]?.message ?? "", /'amount' is not a parameter of reveal/);
  assert.match(wrong[0]?.fix ?? "", /by, seed, at, duration/);
  const by = problems([{ effect: "reveal", duration: 1, by: "row-up" }]);
  assert.match(by[0]?.message ?? "", /Did you mean 'rows-up'\?/);
  for (const bad of [{ effect: "reveal" }, { effect: "reveal", duration: 0 }, { effect: "reveal", duration: 1, at: -1 }, { effect: "reveal", duration: 1, seed: 1.5 }, { effect: "decode", duration: 1, chars: "a b" }, { effect: "shimmer", duration: 1, amount: 2 }, { effect: "type", cps: 0 }]) {
    assert.ok(problems([bad]).some((x) => x.code === "E-ASCII-FX"), JSON.stringify(bad));
  }
  assert.equal(problems({ effect: "reveal" })[0]?.code, "E-ASCII-FX", "fx must be a list");
});

test("a time range outside the animation is E-ASCII-FX with the fix, for inline frames at parse time", () => {
  const frames = Array.from({ length: 10 }, () => ({ text: ["ab"] }));
  const parse = (fxList: unknown) => parseAscii({ ascii: 1, fps: 10, frames, fx: fxList });
  assert.deepEqual(parse([{ effect: "reveal", at: 0, duration: 1 }]).diagnostics.filter((x) => x.code === "E-ASCII-FX"), [], "a range that ends exactly at the end is inside");
  const late = parse([{ effect: "reveal", at: 0.5, duration: 1 }]).diagnostics.find((x) => x.code === "E-ASCII-FX");
  assert.ok(late);
  assert.match(late.message, /fx\[0\] \(reveal\) runs from 0\.5 s to 1\.5 s, but the animation is 1 s long/);
  assert.match(late.fix ?? "", /"duration" to 0\.5 or less/);
  assert.ok(parse([{ effect: "hide", at: 1, duration: 0.5 }]).diagnostics.some((x) => x.code === "E-ASCII-FX"));
  assert.ok(parse([{ effect: "type", at: 2 }]).diagnostics.some((x) => x.code === "E-ASCII-FX"));
  assert.equal(parse([{ effect: "reveal", at: 0, duration: 1 }]).scene?.fx.length, 1);
  assert.equal(checkFxRange([fx({ effect: "shimmer", at: 0, duration: 2 })], 1).length, 1);
});

// ------------------------------------------------------------------ reveal and hide

test("reveal: empty before at, untouched after at + duration, and holds still add up", async () => {
  const src = [block(10, 4, "#", 30)]; // 3 seconds at 10 fps
  const out = await run(src, [fx({ effect: "reveal", by: "scatter", at: 1, duration: 1 })]);
  assert.equal(total(out), 30);
  const frames = perInterval(out);
  for (let k = 0; k < 10; k++) assert.equal(filled(frames[k] as NAsciiFrame), 0, `interval ${k} is before at`);
  for (let k = 20; k < 30; k++) assert.equal(text(frames[k] as NAsciiFrame), text(src[0] as NAsciiFrame), `interval ${k} is after the end`);
  assert.ok(filled(frames[15] as NAsciiFrame) > 0 && filled(frames[15] as NAsciiFrame) < 40);
  // Before and after stay single held frames; only the running interval-by-interval part is split.
  assert.deepEqual(out.map((f) => f.hold), [10, ...Array.from({ length: 10 }, () => 1), 10]);
});

test("reveal scatter: at progress 0.5 about half of the cells are shown, within 10 percent, on a 40 by 20 grid", async () => {
  const out = await run([block(40, 20, "#", 11)], [fx({ effect: "reveal", by: "scatter", at: 0, duration: 1, seed: 9 })]);
  const frames = perInterval(out);
  const half = filled(frames[5] as NAsciiFrame) / 800;
  assert.ok(Math.abs(half - 0.5) < 0.1, `shown at p 0.5: ${half}`);
  // It grows steadily and never loses a cell once shown.
  let prev: NAsciiFrame | undefined;
  for (let k = 0; k < 10; k++) {
    const f = frames[k] as NAsciiFrame;
    if (prev) assert.ok(filled(f) >= filled(prev), `interval ${k} has fewer cells than ${k - 1}`);
    if (prev) for (let r = 0; r < 20; r++) for (let c = 0; c < 40; c++) if ((prev.cells[r] as string[])[c] !== " ") assert.notEqual((f.cells[r] as string[])[c], " ");
    prev = f;
  }
  assert.equal(filled(frames[10] as NAsciiFrame), 800, "after the end: all of it");
});

test("reveal by rows and columns starts where the name says, and radial starts at the centre", async () => {
  const frames = async (by: NAsciiFx["by"]): Promise<NAsciiFrame[]> => perInterval(await run([block(10, 10, "#", 12)], [fx({ effect: "reveal", by, at: 0, duration: 1 })]));
  const rowsOf = (f: NAsciiFrame): number[] => f.cells.map((r, i) => (r.some((c) => c !== " ") ? i : -1)).filter((i) => i >= 0);
  const colsOf = (f: NAsciiFrame): number[] => Array.from({ length: 10 }, (_, c) => c).filter((c) => f.cells.some((r) => r[c] !== " "));
  // A cell is shown once p reaches its threshold: at p = 0.2 on ten rows, the three whose thresholds are 0, 0.1 and 0.2.
  const up = (await frames("rows-up"))[2] as NAsciiFrame;
  assert.deepEqual(rowsOf(up), [7, 8, 9], "the bottom rows first");
  assert.deepEqual(rowsOf((await frames("rows-up"))[0] as NAsciiFrame), [9], "at p 0 only the bottom row, whose threshold is 0");
  assert.deepEqual(rowsOf((await frames("rows-down"))[2] as NAsciiFrame), [0, 1, 2]);
  assert.deepEqual(colsOf((await frames("cols-right"))[2] as NAsciiFrame), [0, 1, 2]);
  assert.deepEqual(colsOf((await frames("cols-left"))[2] as NAsciiFrame), [7, 8, 9]);
  const radial = (await frames("radial"))[3] as NAsciiFrame;
  const shown: [number, number][] = [];
  radial.cells.forEach((row, r) => row.forEach((ch, c) => ch !== " " && shown.push([c, r])));
  assert.ok(shown.length > 0 && shown.length < 100);
  for (const [c, r] of shown) assert.ok(Math.hypot(c - 4.5, (r - 4.5) * 2) <= Math.hypot(4.5, 9) * 0.45, `cell ${c},${r} is too far out`);
});

test("reveal bright-first shows the brightest characters of the ramp first, and uses the colour for a character not in it", async () => {
  const f: NAsciiFrame = { cells: [[" ", ".", "#", "@", " "]], colors: null, backgrounds: null, hold: 12 };
  const out = perInterval(await run([f], [fx({ effect: "reveal", by: "bright-first", at: 0, duration: 1 })], { ramp: " .:-=+*#%@" }));
  assert.equal(text(out[1] as NAsciiFrame).trim(), "@", "the brightest first");
  assert.ok(filled(out[5] as NAsciiFrame) >= 2);
  assert.equal(filled(out[10] as NAsciiFrame), 3);
  // A character outside the ramp takes its value from its colour: white before black.
  const g: NAsciiFrame = { cells: [["C", "Z"]], colors: [["#000000", "#ffffff"]], backgrounds: null, hold: 12 };
  const early = perInterval(await run([g], [fx({ effect: "reveal", by: "bright-first", at: 0, duration: 1 })]))[1] as NAsciiFrame;
  assert.equal(text(early).trim(), "Z");
});

test("hide is the reverse: untouched before at, empty once it has run, and a cell shown by reveal is hidden at the same progress", async () => {
  const src = [block(40, 20, "#", 30)];
  const out = await run(src, [fx({ effect: "hide", by: "scatter", at: 1, duration: 1, seed: 2 })]);
  assert.equal(total(out), 30);
  const frames = perInterval(out);
  for (let k = 0; k < 10; k++) assert.equal(text(frames[k] as NAsciiFrame), text(src[0] as NAsciiFrame));
  for (let k = 20; k < 30; k++) assert.equal(filled(frames[k] as NAsciiFrame), 0);
  assert.ok(Math.abs(filled(frames[15] as NAsciiFrame) / 800 - 0.5) < 0.1);
  const up = perInterval(await run([block(10, 10, "#", 12)], [fx({ effect: "hide", by: "rows-up", at: 0, duration: 1 })]));
  assert.ok(up[2]?.cells[9]?.every((c) => c === " "), "the bottom row goes first");
  assert.ok(up[2]?.cells[0]?.every((c) => c === "#"));
});

test("a revealed or hidden cell loses its background, so no fill is left behind; blanks stay blank", async () => {
  const out = perInterval(await run([block(8, 2, "#", 12, true), { cells: [[" ", " "]], colors: null, backgrounds: null, hold: 1 }], [fx({ effect: "reveal", by: "cols-right", at: 0, duration: 1 })]));
  const f = out[3] as NAsciiFrame;
  f.cells.forEach((row, r) => row.forEach((ch, c) => assert.equal((f.backgrounds?.[r] as (string | null)[])[c], ch === " " ? null : "#112233")));
  assert.equal(filled(out[12] as NAsciiFrame), 0, "a blank cell is never given a character");
});

// ------------------------------------------------------------------ decode and shimmer

test("decode: before at and after the end the frame is untouched; while running, hidden cells roll a new character each frame", async () => {
  const src = [block(30, 10, "#", 40)];
  const out = await run(src, [fx({ effect: "decode", chars: "01", at: 1, duration: 2, seed: 5 })]);
  assert.equal(total(out), 40);
  const frames = perInterval(out);
  for (let k = 0; k < 10; k++) assert.equal(text(frames[k] as NAsciiFrame), text(src[0] as NAsciiFrame), `interval ${k} is before at`);
  for (let k = 30; k < 40; k++) assert.equal(text(frames[k] as NAsciiFrame), text(src[0] as NAsciiFrame), `interval ${k} is after the end`);
  const early = frames[11] as NAsciiFrame;
  const rolled = (f: NAsciiFrame): number => f.cells.flat().filter((c) => c === "0" || c === "1").length;
  assert.ok(rolled(early) > 250, `most cells are still rolling at the start: ${rolled(early)}`);
  assert.ok(early.cells.flat().every((c) => c === "0" || c === "1" || c === "#"));
  assert.ok(rolled(frames[28] as NAsciiFrame) < rolled(early) / 2, "fewer cells roll as it nears the end");
  // Re-rolled every frame: the same cell does not keep one character.
  assert.notEqual(text(frames[11] as NAsciiFrame), text(frames[12] as NAsciiFrame));
  // A cell that has settled stays settled.
  const settled = (f: NAsciiFrame): boolean[] => f.cells.flat().map((c) => c === "#");
  const a = settled(frames[20] as NAsciiFrame);
  const b = settled(frames[25] as NAsciiFrame);
  a.forEach((s, i) => s && assert.ok(b[i]));
});

test("decode rolls the ramp without the space when no chars are given", async () => {
  const out = perInterval(await run([block(20, 5, "@", 12)], [fx({ effect: "decode", at: 0, duration: 1 })], { ramp: " .oO@" }));
  const used = new Set(out[1]?.cells.flat());
  for (const c of used) assert.ok(".oO@".includes(c), `'${c}' is not in the ramp`);
  assert.ok(used.size > 1);
});

test("shimmer: the stated fraction of cells changes on each frame, only while it runs, and the picture is the original outside it", async () => {
  const src = [block(40, 20, "#", 40)];
  const out = await run(src, [fx({ effect: "shimmer", amount: 0.25, chars: "ab", at: 1, duration: 2, seed: 6 })]);
  assert.equal(total(out), 40);
  const frames = perInterval(out);
  for (const k of [0, 5, 9, 30, 39]) assert.equal(text(frames[k] as NAsciiFrame), text(src[0] as NAsciiFrame), `interval ${k} is outside the effect`);
  const changed = (f: NAsciiFrame): number => f.cells.flat().filter((c) => c !== "#").length;
  for (const k of [10, 15, 29]) {
    const share = changed(frames[k] as NAsciiFrame) / 800;
    assert.ok(Math.abs(share - 0.25) < 0.06, `interval ${k}: ${share}`);
  }
  assert.notEqual(text(frames[10] as NAsciiFrame), text(frames[11] as NAsciiFrame), "a different set of cells each frame");
  // Blank cells stay blank.
  const sparse: NAsciiFrame = { cells: [["#", " ", "#", " "]], colors: null, backgrounds: null, hold: 12 };
  for (const f of perInterval(await run([sparse], [fx({ effect: "shimmer", amount: 1, chars: "ab", at: 0, duration: 1 })]))) assert.deepEqual([f.cells[0]?.[1], f.cells[0]?.[3]], [" ", " "]);
});

// ------------------------------------------------------------------ repeatability, colours, streaming

test("the same effects and seed give byte-identical frames, and another seed gives different ones", async () => {
  const list = (seed: number): NAsciiFx[] => [fx({ effect: "reveal", by: "scatter", duration: 1, seed }), fx({ effect: "shimmer", amount: 0.2, at: 0.5, duration: 0.5, seed }), fx({ effect: "decode", at: 0, duration: 1, seed })];
  const src = (): NAsciiFrame[] => [block(30, 12, "#", 20)];
  const a = JSON.stringify(await run(src(), list(3)));
  const b = JSON.stringify(await run(src(), list(3)));
  assert.equal(a, b);
  assert.notEqual(a, JSON.stringify(await run(src(), list(4))));
  for (const effect of ["reveal", "hide", "decode", "shimmer"] as const) {
    const one = (seed: number): Promise<NAsciiFrame[]> => run(src(), [fx({ effect, seed, amount: 0.3, at: 0, duration: 1 })]);
    assert.equal(JSON.stringify(await one(1)), JSON.stringify(await one(1)), effect);
    assert.notEqual(JSON.stringify(await one(1)), JSON.stringify(await one(2)), effect);
  }
});

test("colours are never changed, by any effect", async () => {
  const src = [block(24, 8, "#", 20)];
  for (const effect of ["reveal", "hide", "decode", "shimmer"] as const) {
    for (const f of await run(src, [fx({ effect, amount: 0.5, at: 0, duration: 1 })])) assert.deepEqual(f.colors, (src[0] as NAsciiFrame).colors, effect);
  }
});

test("applyFx works on a stream: it yields before it has read the whole input, and does not change the input", async () => {
  let pulled = 0;
  async function* source(): AsyncGenerator<NAsciiFrame> {
    for (let i = 0; i < 1000; i++) {
      pulled++;
      yield block(6, 3, "#", 1);
    }
  }
  const it = applyFx(source(), [fx({ effect: "reveal", by: "rows-up", at: 0, duration: 50 })], FPS)[Symbol.asyncIterator]();
  for (let i = 0; i < 3; i++) await it.next();
  assert.ok(pulled <= 4, `read ${pulled} frames to give 3`);
  await it.return?.(undefined);
  const input = [block(6, 3, "#", 6)];
  const before = JSON.stringify(input);
  await run(input, [fx({ effect: "reveal", by: "radial", at: 0, duration: 0.5 }), fx({ effect: "decode", at: 0, duration: 0.5 })]);
  assert.equal(JSON.stringify(input), before);
});

test("no effects, and an effect that is only type, pass frames through unchanged", async () => {
  const src = [block(5, 2, "#", 3), block(5, 2, "@", 2)];
  assert.deepEqual(await run(src, []), src);
  assert.deepEqual(await run(src, [fx({ effect: "type", cps: 10 })]), src);
});

test("effects apply in order, each to the result of the one before", async () => {
  const src = [block(20, 10, "#", 12)];
  const both = perInterval(await run(src, [fx({ effect: "reveal", by: "cols-right", at: 0, duration: 1 }), fx({ effect: "decode", chars: "xy", at: 0, duration: 1 })]));
  // decode only rolls cells that reveal left in place, so a hidden cell is still a space.
  const f = both[2] as NAsciiFrame;
  assert.ok(f.cells.flat().includes(" "));
  assert.ok(f.cells.flat().every((c) => " #xy".includes(c)));
  assert.ok(f.cells.every((row) => row.slice(10).every((c) => c === " ")));
});

// ------------------------------------------------------------------ framesOf and the scene

const scene = (raw: Record<string, unknown>): NAscii => {
  const r = parseAscii(raw);
  assert.ok(r.scene, JSON.stringify(r.diagnostics));
  return r.scene;
};

test("framesOf applies scene fx to inline frames, and the scene keeps its length", async () => {
  const s = scene({ ascii: 1, fps: 10, frames: [{ text: ["####", "####"], hold: 10 }], fx: [{ effect: "reveal", by: "cols-right", at: 0, duration: 0.5 }] });
  const out: NAsciiFrame[] = [];
  for await (const f of framesOf(s)) out.push(f);
  assert.equal(total(out), 10);
  assert.equal(filled(out[0] as NAsciiFrame), 2, "at p 0 only the left column, whose threshold is 0, is shown");
  assert.equal(text(out[out.length - 1] as NAsciiFrame), "####\n####");
  const c = await collect(s);
  assert.equal(total(c.frames), 10);
  assert.equal((await shapeOf(s)).intervals, 10);
});

test("framesOf applies scene fx to a recipe, and an effect past the end of the source is E-ASCII-FX when it is opened", async () => {
  const source = (frames: number): { read: SourceReader } => {
    const src: OpenSource = {
      kind: "media",
      width: 100,
      height: 50,
      seconds: frames / 10,
      background: null,
      loop: true,
      frameCount: (_f, _s, max) => Promise.resolve(Math.min(max, frames)),
      async *cells(req) {
        for (let f = 0; f < req.count; f++) yield new Uint8ClampedArray(req.cols * req.rows * 4).fill(255);
      },
    };
    return { read: () => Promise.resolve(src) };
  };
  const s = scene({ ascii: 1, fps: 10, source: { file: "a.mp4", cols: 8, rows: 2, normalize: false }, fx: [{ effect: "reveal", by: "cols-right", at: 0, duration: 1 }] });
  const out: NAsciiFrame[] = [];
  for await (const f of framesOf(s, source(20).read)) out.push(f);
  assert.equal(total(out), 20);
  assert.equal(filled(out[0] as NAsciiFrame), 2);
  assert.equal(filled(out[out.length - 1] as NAsciiFrame), 16);
  await assert.rejects(shapeOf(s, source(5).read), (e: unknown) => e instanceof AsciiSourceError && e.diagnostic.code === "E-ASCII-FX" && /but the animation is 0\.5 s long/.test(e.diagnostic.message));
});

// ------------------------------------------------------------------ appending to a file, and the command

test("appendFx adds the first entry, adds to an existing list, and keeps the rest of the file as it was", () => {
  const base = '{\n  "ascii": 1,\n  "frames": [\n    {"text": ["a\\"fx\\": ["]}\n  ]\n}\n';
  const one = appendFx(base, { effect: "reveal", at: 0, duration: 1 }) as string;
  assert.ok(one.startsWith(base.slice(0, base.lastIndexOf("\n  ]") + 4)));
  assert.deepEqual((JSON.parse(one) as { fx: unknown[] }).fx, [{ effect: "reveal", at: 0, duration: 1 }]);
  const two = appendFx(one, { effect: "hide", at: 1, duration: 1 }) as string;
  assert.deepEqual((JSON.parse(two) as { fx: unknown[] }).fx, [{ effect: "reveal", at: 0, duration: 1 }, { effect: "hide", at: 1, duration: 1 }]);
  assert.equal((JSON.parse(two) as { frames: unknown[] }).frames.length, 1);
  assert.deepEqual((JSON.parse(appendFx('{"ascii":1,"fx":[]}', { effect: "reveal" }) as string) as { fx: unknown[] }).fx, [{ effect: "reveal" }]);
  assert.equal(appendFx("[1]", { effect: "reveal" }), undefined);
});

const cli = join(root, "src/cli/gertie.ts");
const runCli = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", cwd: root });

test("ascii fx appends an entry, defaults the duration to the rest of the animation, lints, and refuses bad input without writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-fx-"));
  try {
    const file = join(dir, "a.ascii.json");
    const frames = Array.from({ length: 10 }, (_, i) => ({ text: ["#".repeat(i + 1), "####"] }));
    writeFileSync(file, JSON.stringify({ ascii: 1, name: "a", fps: 10, loop: false, frames }, null, 1));
    const r = runCli("ascii", "fx", file, "--effect", "reveal", "--by", "rows-up", "--at", "0.2", "--seed", "4");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout + r.stderr, /added \{"effect":"reveal","by":"rows-up","seed":4,"at":0\.2,"duration":0\.8\}/);
    assert.match(r.stdout + r.stderr, /0 error\(s\), 0 warning\(s\)/);
    const r2 = runCli("ascii", "fx", file, "--effect", "shimmer", "--amount", "0.2", "--chars", "ab", "--at", "0", "--duration", "0.5", "--json");
    assert.equal(r2.status, 0, r2.stderr + r2.stdout);
    const written = JSON.parse(readFileSync(file, "utf8")) as { fx: { effect: string }[] };
    assert.deepEqual(written.fx.map((e) => e.effect), ["reveal", "shimmer"]);
    const before = readFileSync(file, "utf8");
    for (const args of [
      ["--effect", "revael"],
      ["--effect", "reveal", "--amount", "0.5"],
      ["--effect", "reveal", "--by", "sideways"],
      ["--effect", "type"],
      ["--effect", "reveal", "--duration", "0"],
      [],
    ]) assert.equal(runCli("ascii", "fx", file, ...args).status, 2, JSON.stringify(args));
    const late = runCli("ascii", "fx", file, "--effect", "hide", "--at", "0.5", "--duration", "5");
    assert.equal(late.status, 1);
    assert.match(late.stdout + late.stderr, /but the animation is 1 s long/);
    assert.equal(readFileSync(file, "utf8"), before, "nothing was written");
    assert.equal(runCli("ascii", "lint", file).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
