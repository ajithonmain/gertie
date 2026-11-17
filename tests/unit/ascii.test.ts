import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { frameDifference, framesOfFile, parseAscii, rowsOfText } from "../../src/ascii/parse.ts";
import { emitAsciiSvg, rowRuns, svgProblems } from "../../src/ascii/svg.ts";
import { canvasSize, frameAt, totalFrames, type NAscii } from "../../src/ascii/types.ts";
import { cellsFromRgba, DEFAULT_RAMP, downsample, rowsForAspect } from "../../src/ascii/convert.ts";
import { generate, GENERATORS } from "../../src/ascii/gen.ts";
import { exportJs, exportSh, play, terminalFrame } from "../../src/ascii/terminal.ts";
import { formatAscii } from "../../src/ascii/format.ts";

const root = join(import.meta.dirname, "../..");

const ok = (raw: unknown, io?: { files: Record<string, string> }): NAscii => {
  const r = parseAscii(raw, io ? { io: { readText: (p) => io.files[p] } } : {});
  assert.ok(r.scene, JSON.stringify(r.diagnostics));
  return r.scene;
};
const codes = (raw: unknown, io?: { files: Record<string, string> }): string[] => parseAscii(raw, io ? { io: { readText: (p) => io.files[p] } } : {}).diagnostics.map((d) => d.code);

const two = { ascii: 1, cols: 4, rows: 2, fps: 4, frames: [{ text: ["ab", "cd"] }, { text: ["ef", "gh"], hold: 3 }] };

// ------------------------------------------------------------------ parse and lint

test("a minimal scene parses, pads rows to the grid and counts holds", () => {
  const s = ok(two);
  assert.equal(s.cols, 4);
  assert.equal(s.rows, 2);
  assert.deepEqual(s.frames[0]?.cells[0], ["a", "b", " ", " "]);
  assert.equal(totalFrames(s), 4);
  assert.deepEqual([0, 1, 2, 3].map((n) => frameAt(s, n)), [0, 1, 1, 1]);
});

test("cols and rows are inferred from the frames when left out", () => {
  const s = ok({ ascii: 1, frames: [{ text: ["abc", "d"] }, { text: ["x", "y", "z"] }] });
  assert.equal(s.cols, 3);
  assert.equal(s.rows, 3);
});

test("a row wider than cols names the frame, the row and the fix", () => {
  const r = parseAscii({ ascii: 1, cols: 3, rows: 2, frames: [{ text: ["abc", "abcd"] }] });
  const d = r.diagnostics.find((x) => x.code === "E-ASCII-WIDTH");
  assert.ok(d);
  assert.match(d.message, /frames\[0\] row 1 is 4 characters wide but "cols" is 3/);
  assert.match(d.fix ?? "", /Shorten the row to 3|set "cols" to 4/);
});

test("too many rows, bad characters, bad hold and unknown fields are errors", () => {
  assert.ok(codes({ ascii: 1, rows: 1, frames: [{ text: ["a", "b"] }] }).includes("E-ASCII-ROWS"));
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a\tb"] }] }).includes("E-ASCII-CHAR"));
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a"], hold: 0 }] }).includes("E-ASCII-HOLD"));
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a"], hold: 1.5 }] }).includes("E-ASCII-HOLD"));
  assert.ok(codes({ ascii: 2, frames: [{ text: ["a"] }] }).includes("E-ASCII-VERSION"));
  assert.ok(codes({ ascii: 1, frames: [] }).includes("E-ASCII-NOFRAMES"));
  assert.ok(codes({ ascii: 1 }).includes("E-ASCII-NOFRAMES"));
  assert.ok(codes({ ascii: 1, fps: 99, frames: [{ text: ["a"] }] }).includes("E-ASCII-FPS"));
  const typo = parseAscii({ ascii: 1, framez: [], frames: [{ text: ["a"] }] }).diagnostics.find((d) => d.code === "E-ASCII-FIELD");
  assert.match(typo?.message ?? "", /Did you mean 'frames'/);
  assert.ok(codes({ ascii: 1, style: { color: "green" }, frames: [{ text: ["a"] }] }).includes("E-ASCII-COLOR"));
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a"], file: "x.txt" }] }).includes("E-ASCII-FRAME"));
});

test("wide characters and fast frame rates warn", () => {
  const c = codes({ ascii: 1, fps: 24, frames: [{ text: ["a中"] }, { text: ["b"] }] });
  assert.ok(c.includes("W-ASCII-WIDE"));
  assert.ok(c.includes("W-ASCII-FPS"));
});

test("a loop whose last frame differs greatly from the first warns; a smooth loop does not", () => {
  const filled = (n: number): string[] => ["#".repeat(n) + "-".repeat(10 - n)];
  const build = (steps: number[], loop = true): unknown => ({ ascii: 1, loop, frames: steps.map((n) => ({ text: filled(n) })) });
  // 0 to 10 filled: neighbours differ by one cell, the wrap differs by ten
  assert.ok(codes(build([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).includes("W-ASCII-LOOP-JUMP"));
  assert.ok(!codes(build([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], false)).includes("W-ASCII-LOOP-JUMP"));
  assert.ok(!codes(build([0, 2, 4, 6, 8, 10, 8, 6, 4, 2])).includes("W-ASCII-LOOP-JUMP"));
});

test("a scene with nothing drawn, and a scene that never changes, warn", () => {
  assert.ok(codes({ ascii: 1, frames: [{ text: [" "] }, { text: [""] }] }).includes("W-ASCII-EMPTY"));
  assert.ok(!codes({ ascii: 1, frames: [{ text: ["a"] }, { text: [""] }] }).includes("W-ASCII-EMPTY"));
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a"] }, { text: ["a"] }] }).includes("W-ASCII-STATIC"));
});

test("frames can come from text files, and a whole animation from one file split at ---", () => {
  const files = { "f1.txt": "ab\ncd\n", "all.txt": "12\n34\n---\n56\n78\n---\nxy\nzw\n" };
  const a = ok({ ascii: 1, frames: [{ file: "f1.txt", hold: 2 }, { text: "ef\ngh" }] }, { files });
  assert.deepEqual(a.frames[0]?.cells[1], ["c", "d"]);
  assert.equal(a.frames[0]?.hold, 2);
  const b = ok({ ascii: 1, framesFile: "all.txt" }, { files });
  assert.equal(b.frames.length, 3);
  assert.deepEqual(b.frames[2]?.cells[0], ["x", "y"]);
  assert.ok(codes({ ascii: 1, frames: [{ file: "missing.txt" }] }, { files }).includes("E-ASCII-FILE"));
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a"] }], framesFile: "all.txt" }, { files }).includes("E-ASCII-FRAMES"));
  assert.deepEqual(rowsOfText("a\nb\n"), ["a", "b"]);
  assert.equal(framesOfFile("a\n---\nb\n").length, 2);
});

test("colours: a row colour, a per-cell list, null, and bad shapes", () => {
  const s = ok({ ascii: 1, frames: [{ text: ["abc", "def"], colors: ["#f00", ["#00f", null]] }] });
  const c = s.frames[0]?.colors;
  assert.deepEqual(c?.[0], ["#f00", "#f00", "#f00"]);
  assert.deepEqual(c?.[1], ["#00f", null, null]);
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a"], colors: "red" }] }).includes("E-ASCII-COLORS"));
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a"], colors: ["red"] }] }).includes("E-ASCII-COLORS"));
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a"], colors: ["#fff", "#fff"] }] }).includes("E-ASCII-COLORS"));
});

// ------------------------------------------------------------------ SVG

test("the SVG escapes text, keeps spaces, and gives every run a textLength", () => {
  const s = ok({ ascii: 1, cols: 13, rows: 1, frames: [{ text: ["a < b & c  >d"] }] });
  const svg = emitAsciiSvg(s);
  assert.match(svg, /a &lt; b &amp; c  &gt;d/);
  assert.match(svg, /xml:space="preserve"/);
  for (const m of svg.matchAll(/<text [^>]*>/g)) assert.match(m[0], /textLength="[\d.]+" lengthAdjust="spacingAndGlyphs"/);
  assert.deepEqual(svgProblems(svg), []);
});

test("rowRuns trims spaces, splits on colour and ignores the colour of spaces", () => {
  const runs = rowRuns([..."  ab  cd e "], [null, null, "#f00", "#f00", null, null, "#f00", "#f00", null, "#00f", null]);
  assert.deepEqual(runs, [
    { col: 2, text: "ab  cd", color: "#f00" },
    { col: 9, text: "e", color: "#00f" },
  ]);
});

test("canvas size is a whole number of pixels", () => {
  const s = ok({ ascii: 1, cols: 40, rows: 12, frames: [{ text: ["a"] }] });
  assert.deepEqual(canvasSize(s), { w: 416, h: 256 });
  for (const fontSize of [11, 13, 14, 17.5]) {
    const t = ok({ ascii: 1, cols: 9, rows: 3, style: { fontSize }, frames: [{ text: ["a"] }] });
    const { w, h } = canvasSize(t);
    assert.ok(Number.isInteger(w) && Number.isInteger(h), `${fontSize}: ${w} by ${h}`);
  }
});

function keyframePercents(svg: string): { start: number; end: number | null }[] {
  const out: { start: number; end: number | null }[] = [];
  for (const m of svg.matchAll(/@keyframes k\d+\{(.*?)\}\}/g)) {
    const body = m[1] as string;
    const vis = [...body.matchAll(/([\d.e-]+)%\{visibility:(visible|hidden)/g)];
    const start = vis.find((v) => v[2] === "visible");
    const end = vis.find((v) => v[2] === "hidden");
    out.push({ start: Number(start?.[1]), end: end ? Number(end[1]) : null });
  }
  return out;
}

test("keyframes tile the timeline with no gap or overlap, and boundaries sit a hair before the exact frame time", () => {
  const s = ok({ ascii: 1, fps: 6, frames: [{ text: ["a"] }, { text: ["b"], hold: 2 }, { text: ["c"] }, { text: ["d"], hold: 3 }] });
  const k = keyframePercents(emitAsciiSvg(s));
  assert.equal(k.length, 4);
  assert.equal(k[0]?.start, 0);
  for (let i = 0; i < 3; i++) assert.equal(k[i]?.end, k[i + 1]?.start, `frame ${i} ends where frame ${i + 1} starts`);
  assert.equal(k[3]?.end, null);
  const total = totalFrames(s);
  // the second frame starts at interval 1 of 7: 1/7 of the length, minus the shift, so a sample at exactly 1/6 s is inside it
  const exact = (1 / total) * 100;
  const got = k[1]?.start as number;
  assert.ok(got < exact && exact - got < 1e-3, `${got} vs ${exact}`);
  // the duration is written in milliseconds with enough digits
  assert.match(emitAsciiSvg(s), /animation-duration:1166\.666667ms/);
});

test("a single frame is static, a non-looping animation holds its last frame, a loop repeats", () => {
  assert.match(emitAsciiSvg(ok({ ascii: 1, frames: [{ text: ["a"] }] })), /\.f0\{visibility:visible;animation:none\}/);
  const once = emitAsciiSvg(ok({ ascii: 1, loop: false, frames: [{ text: ["a"] }, { text: ["b"] }] }));
  assert.match(once, /animation-iteration-count:1/);
  assert.match(once, /\.f1\{animation-name:k1;animation-fill-mode:forwards\}/);
  assert.match(emitAsciiSvg(ok(two)), /animation-iteration-count:infinite/);
});

test("the SVG shows the first frame under reduced motion and has a transparent option", () => {
  const svg = emitAsciiSvg(ok(two));
  assert.match(svg, /prefers-reduced-motion:reduce/);
  assert.match(svg, /<rect width="100%" height="100%" fill="#0b0f19"\/>/);
  const t = emitAsciiSvg(ok({ ...two, style: { background: "transparent" } }));
  assert.ok(!t.includes("<rect"));
});

// ------------------------------------------------------------------ conversion

test("rows keep proportions: a 16 by 9 source at 80 columns is about 22 rows", () => {
  assert.equal(rowsForAspect(1920, 1080, 80), 23);
  assert.equal(rowsForAspect(100, 100, 40), 20);
  assert.equal(rowsForAspect(100, 1, 40), 1);
});

const px = (...cells: [number, number, number, number][]): Uint8ClampedArray => new Uint8ClampedArray(cells.flat());

test("brightness maps from the first ramp character to the last, and invert flips it", () => {
  const cells = px([0, 0, 0, 255], [128, 128, 128, 255], [255, 255, 255, 255], [255, 255, 255, 0]);
  const plain = cellsFromRgba(cells, 4, 1, { ramp: DEFAULT_RAMP, invert: false, color: false, mode: "luma" });
  assert.equal(plain.cells[0]?.join(""), " +@ ");
  const inv = cellsFromRgba(cells, 4, 1, { ramp: DEFAULT_RAMP, invert: true, color: false, mode: "luma" });
  assert.equal(inv.cells[0]?.join(""), "@=  ");
  assert.equal(plain.colors, null);
});

test("alpha and distance modes draw shapes, colour mode keeps quantised colours", () => {
  const shape = px([200, 30, 30, 255], [0, 0, 0, 0]);
  const a = cellsFromRgba(shape, 2, 1, { ramp: " .#", invert: false, color: true, mode: "alpha" });
  assert.equal(a.cells[0]?.[1], " ");
  assert.notEqual(a.cells[0]?.[0], " ");
  assert.equal(a.colors?.[0]?.[0], "#c02020");
  assert.equal(a.colors?.[0]?.[1], null);
  const d = cellsFromRgba(px([10, 20, 30, 255], [250, 250, 250, 255]), 2, 1, { ramp: " .#", invert: false, color: false, mode: "distance", background: [10, 20, 30] });
  assert.equal(d.cells[0]?.join(""), " #");
  assert.throws(() => cellsFromRgba(px([0, 0, 0, 255]), 1, 1, { ramp: "x", invert: false, color: false, mode: "luma" }));
});

test("downsample averages cells and weights colour by alpha", () => {
  const w = [255, 255, 255, 255];
  const k = [0, 0, 0, 255];
  const out = downsample({ w: 2, h: 2, data: new Uint8ClampedArray([...w, ...k, ...k, ...w]) }, 1, 1);
  assert.equal(out[0], 128);
  assert.equal(out[3], 255);
  const clear = downsample({ w: 2, h: 1, data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]) }, 1, 1);
  assert.deepEqual([...clear], [255, 0, 0, 128]);
});

// ------------------------------------------------------------------ generators

test("every generator makes a scene that lints with no error and no warning", () => {
  for (const kind of GENERATORS) {
    const raw = generate(kind);
    const r = parseAscii(JSON.parse(formatAscii(raw)));
    assert.ok(r.scene, `${kind}: ${JSON.stringify(r.diagnostics)}`);
    assert.deepEqual(r.diagnostics, [], kind);
  }
});

test("generators are deterministic, and the looping ones loop seamlessly", () => {
  for (const kind of GENERATORS) assert.deepEqual(generate(kind, { seed: 3 }), generate(kind, { seed: 3 }), kind);
  // These move at a fixed speed, so generating twice as many frames must come back to frame 0 after one period.
  for (const kind of ["spinner", "scroll", "rain", "stars"]) {
    const a = generate(kind);
    const n = a.frames.length;
    assert.deepEqual(generate(kind, { frames: n * 2 }).frames[n], a.frames[0], `${kind}: frame ${n} of ${n * 2} equals frame 0`);
  }
  // These spread one cycle over all their frames, so check that the step from the last frame back to the first is an ordinary step.
  for (const kind of ["ball", "wave"]) {
    const s = parseAscii(generate(kind)).scene as NAscii;
    const steps = s.frames.slice(1).map((f, i) => frameDifference(s.frames[i] as (typeof s.frames)[number], f));
    const wrap = frameDifference(s.frames[s.frames.length - 1] as (typeof s.frames)[number], s.frames[0] as (typeof s.frames)[number]);
    assert.ok(wrap <= Math.max(...steps) * 1.25 + 0.01, `${kind}: wrap ${wrap} against largest step ${Math.max(...steps)}`);
  }
  assert.notDeepEqual(generate("rain", { seed: 1 }).frames[0], generate("rain", { seed: 2 }).frames[0]);
});

test("generator options are honoured and bad ones explain the fix", () => {
  const sp = generate("spinner", { text: "Loading", style: "dots" });
  assert.equal(sp.frames[0]?.text[0], ".   Loading");
  assert.equal(generate("bar", { cols: 20, frames: 5 }).frames.length, 5);
  assert.match(generate("bar", { frames: 3 }).frames[2]?.text[0] ?? "", /^\[#+\] 100%$/);
  assert.equal(generate("scroll", { text: "HI", cols: 6 }).frames.length, 8);
  assert.throws(() => generate("spinner", { style: "nope" }), /Styles: /);
  assert.throws(() => generate("bar", { cols: 4 }), /--cols/);
  assert.throws(() => generate("ball", { rows: 2 }), /--rows/);
  assert.throws(() => generate("nope"), /Generators: /);
  const ball = generate("ball");
  assert.ok(ball.frames.every((f) => f.text.join("\n").includes("O")));
});

// ------------------------------------------------------------------ terminal

test("terminalFrame gives plain rows, and colour mode wraps them in ANSI colour", () => {
  const s = ok({ ascii: 1, cols: 5, rows: 2, frames: [{ text: ["ab", "  c"], colors: ["#ff0000", null] }] });
  assert.equal(terminalFrame(s, 0, { color: false, fill: "pad" }), "ab   \n  c  ");
  const c = terminalFrame(s, 0, { color: true, fill: "el" });
  assert.match(c, /\u001b\[38;2;255;0;0mab/);
  assert.ok(c.endsWith("\u001b[0m"));
  assert.ok(c.includes("\u001b[K"));
});

test("play homes the cursor between frames, waits for each hold, and always restores the cursor", async () => {
  const s = ok(two);
  const out: string[] = [];
  const waits: number[] = [];
  await play(s, { loops: 2, color: false, write: (t) => out.push(t), sleep: async (ms) => void waits.push(ms), stopped: () => false });
  assert.equal(out[0], "\u001b[?25l\u001b[2J");
  assert.equal(out.filter((t) => t.startsWith("\u001b[H")).length, 4);
  assert.deepEqual(waits, [250, 750, 250, 750]);
  assert.ok((out[out.length - 1] as string).endsWith("\u001b[?25h"));
  // stopping early (Ctrl-C) still restores the cursor
  const out2: string[] = [];
  let n = 0;
  await play(s, { loops: 100, color: false, write: (t) => out2.push(t), sleep: async () => undefined, stopped: () => ++n > 3 });
  assert.ok((out2[out2.length - 1] as string).endsWith("\u001b[?25h"));
  assert.ok(out2.length < 12);
});

test("the shell export is valid sh and prints every frame in order", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-"));
  try {
    const raw = generate("bar", { cols: 20, frames: 3, fps: 30 });
    const s = ok(raw);
    const script = join(dir, "bar.sh");
    writeFileSync(script, exportSh(s));
    assert.equal(spawnSync("sh", ["-n", script]).status, 0);
    // a stub sleep so the test does not wait
    const bin = join(dir, "bin");
    mkdirSync(bin);
    writeFileSync(join(bin, "sleep"), "#!/bin/sh\nexit 0\n");
    chmodSync(join(bin, "sleep"), 0o755);
    const r = spawnSync("sh", [script], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env["PATH"]}` } });
    assert.equal(r.status, 0, r.stderr);
    const at = (needle: string): number => r.stdout.indexOf(needle);
    assert.ok(at("0%") >= 0 && at("50%") > at("0%") && at("100%") > at("50%"), r.stdout);
    assert.ok(r.stdout.includes("\u001b[?25h"));
    // a looping script keeps a loop and a trap
    const loopy = exportSh(ok(generate("spinner")));
    assert.match(loopy, /while :; do/);
    assert.match(loopy, /trap /);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the shell export picks a heredoc tag that no frame contains", () => {
  const s = ok({ ascii: 1, loop: false, frames: [{ text: ["GERTIE_FRAME"] }, { text: ["b"] }] });
  const sh = exportSh(s);
  assert.match(sh, /cat <<'GERTIE_FRAME_X'/);
});

test("the JavaScript export is a module with frames, delays and a start function", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-"));
  try {
    const s = ok(two);
    const file = join(dir, "two.mjs");
    writeFileSync(file, exportJs(s));
    const m = (await import(pathToFileURL(file).href)) as { frames: string[]; delays: number[]; fps: number; start: (stream: unknown) => () => void; rows: number };
    assert.deepEqual(m.frames, ["ab\ncd", "ef\ngh"]);
    assert.deepEqual(m.delays, [250, 750]);
    assert.equal(m.fps, 4);
    // not a terminal: does nothing
    const quiet: string[] = [];
    m.start({ isTTY: false, write: (t: string) => quiet.push(t) })();
    assert.deepEqual(quiet, []);
    // a terminal: draws the first frame at once and restores the cursor on stop
    const out: string[] = [];
    const stop = m.start({ isTTY: true, write: (t: string) => out.push(t) });
    stop();
    assert.equal(out[0], "\u001b[?25l");
    assert.match(out[1] as string, /^ab\u001b\[K\ncd\u001b\[K$/);
    assert.ok((out[out.length - 1] as string).includes("\u001b[?25h"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ------------------------------------------------------------------ command line

const cli = join(root, "src/cli/gertie.ts");
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", cwd: root });

test("ascii: gen, lint and play --frame work together from the command line", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-"));
  try {
    const file = join(dir, "wave.ascii.json");
    const g = run("ascii", "gen", "wave", "--cols", "20", "--rows", "5", "--out", file, "--json");
    assert.equal(g.status, 0, g.stderr);
    const l = run("ascii", "lint", file, "--json");
    assert.equal(l.status, 0, l.stdout);
    const lint = JSON.parse(l.stdout) as { ok: boolean; scene: { cols: number; rows: number; frames: number; w: number; h: number } };
    assert.equal(lint.ok, true);
    assert.deepEqual([lint.scene.cols, lint.scene.rows, lint.scene.frames, lint.scene.w, lint.scene.h], [20, 5, 16, 216, 116]);
    const p = run("ascii", "play", file, "--frame", "3", "--json");
    const play0 = JSON.parse(p.stdout) as { text: string[] };
    assert.equal(play0.text.length, 5);
    assert.ok(play0.text.some((row) => row.includes("*")));
    assert.equal(run("ascii", "play", file, "--frame", "99").status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ascii: errors exit 1 with a fix, usage problems exit 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-"));
  try {
    const file = join(dir, "bad.ascii.json");
    writeFileSync(file, JSON.stringify({ ascii: 1, cols: 3, frames: [{ text: ["abcdef"] }] }));
    const r = run("ascii", "lint", file, "--json");
    assert.equal(r.status, 1);
    const out = JSON.parse(r.stdout) as { diagnostics: { code: string; fix: string }[] };
    assert.equal(out.diagnostics[0]?.code, "E-ASCII-WIDTH");
    assert.ok(out.diagnostics[0]?.fix);
    writeFileSync(file, "{ not json");
    assert.equal(JSON.parse(run("ascii", "lint", file, "--json").stdout).diagnostics[0].code, "E-ASCII-JSON");
    assert.equal(run("ascii").status, 2);
    assert.equal(run("ascii", "bogus").status, 2);
    assert.equal(run("ascii", "lint", join(dir, "nope.ascii.json")).status, 2);
    assert.equal(run("ascii", "gen", "nope").status, 2);
    assert.equal(run("ascii", "export", file).status, 2);
    assert.equal(run("ascii", "export", file, "--to", "lottie").status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ascii: a frames file with backslashes works without doubling them", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-"));
  try {
    writeFileSync(join(dir, "rocket.txt"), " /\\\n/__\\\n---\n /\\\n/__\\\n **\n");
    writeFileSync(join(dir, "rocket.ascii.json"), JSON.stringify({ ascii: 1, fps: 8, framesFile: "rocket.txt" }));
    const r = run("ascii", "play", join(dir, "rocket.ascii.json"), "--frame", "1", "--json");
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual((JSON.parse(r.stdout) as { text: string[] }).text, [" /\\", "/__\\", " **"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the examples in examples/ascii lint clean", () => {
  const dir = join(root, "examples/ascii");
  const names = readdirSync(dir).filter((f) => f.endsWith(".ascii.json"));
  assert.ok(names.length >= 3, `found ${names.length} examples`);
  for (const f of names) {
    const r = run("ascii", "lint", join(dir, f), "--json", "--strict");
    assert.equal(r.status, 0, `${f}: ${r.stdout}`);
  }
});
