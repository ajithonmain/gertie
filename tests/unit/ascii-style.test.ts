import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAscii } from "../../src/ascii/parse.ts";
import { backgroundRuns, emitAsciiSvg, glyphSize, gradientLine, svgProblems } from "../../src/ascii/svg.ts";
import { canvasSize, cellHeight, cellWidth, type NAscii } from "../../src/ascii/types.ts";
import { terminalFrame, exportSh } from "../../src/ascii/terminal.ts";
import { formatAscii } from "../../src/ascii/format.ts";
import { convertClip, rowsForAspect } from "../../src/ascii/convert.ts";

const root = join(import.meta.dirname, "../..");
const RAMP = " .:-=+*#%@";

const ok = (raw: object): NAscii => {
  const r = parseAscii({ ascii: 1, ...raw });
  assert.ok(r.scene, JSON.stringify(r.diagnostics));
  return r.scene;
};
const diag = (raw: object): { code: string; message: string; fix?: string | undefined; path?: string | undefined }[] => parseAscii({ ascii: 1, ...raw }).diagnostics;
const frame = { text: ["@.", ":#"] };

// ------------------------------------------------------------------ parse and lint

test("style defaults: glyph text, aspect 2, no glow, no gradient", () => {
  const s = ok({ frames: [frame] });
  assert.deepEqual([s.style.glyph, s.style.ramp, s.style.cellAspect, s.style.glow, s.style.gradient], ["text", null, 2, 0, null]);
  assert.equal(s.frames[0]?.backgrounds, null);
});

test("glyph, ramp, cellAspect and glow parse", () => {
  const s = ok({ style: { glyph: "dot", ramp: RAMP, cellAspect: 1, glow: 0.4 }, frames: [frame] });
  assert.deepEqual([s.style.glyph, s.style.ramp, s.style.cellAspect, s.style.glow], ["dot", RAMP, 1, 0.4]);
});

test("a bad glyph, ramp, cellAspect or glow is E-ASCII-STYLE and names the field and the fix", () => {
  const cases: [object, RegExp][] = [
    [{ glyph: "circle", ramp: RAMP }, /style\.glyph must be one of text, dot, square, found "circle"/],
    [{ ramp: "x" }, /style\.ramp must be a string of at least two/],
    [{ ramp: 5 }, /style\.ramp must be a string/],
    [{ cellAspect: 0 }, /style\.cellAspect must be a number from 0.5 to 4/],
    [{ cellAspect: "tall" }, /style\.cellAspect must be a number/],
    [{ glow: 2 }, /style\.glow must be a number from 0 to 1/],
    [{ glow: -0.1 }, /style\.glow must be a number from 0 to 1/],
  ];
  for (const [style, want] of cases) {
    const d = diag({ style, frames: [frame] }).find((x) => x.code === "E-ASCII-STYLE");
    assert.ok(d, JSON.stringify(style));
    assert.match(d.message, want, JSON.stringify(style));
    assert.ok(d.fix, "has a fix");
  }
});

test("glyph dot or square without a ramp is an error", () => {
  for (const glyph of ["dot", "square"]) {
    const d = diag({ style: { glyph }, frames: [frame] }).find((x) => x.code === "E-ASCII-STYLE");
    assert.match(d?.message ?? "", new RegExp(`style\\.glyph is "${glyph}" but style\\.ramp is missing`));
    assert.match(d?.fix ?? "", /Add "ramp"/);
  }
  // text does not need one
  assert.ok(ok({ style: { glyph: "text" }, frames: [frame] }));
});

test("with dots, a character that is not in the ramp is an error that names the frame, row, column and character", () => {
  const d = diag({ style: { glyph: "dot", ramp: " .#" }, frames: [{ text: ["#.", "ab"] }] }).find((x) => x.code === "E-ASCII-STYLE");
  assert.match(d?.message ?? "", /frames\[0\] row 1 column 0 holds 'a', which is not in style\.ramp/);
  assert.match(d?.fix ?? "", /Add 'a' to style\.ramp/);
});

test("a gradient background parses; its from colour is the flat background; angle defaults to 180", () => {
  const s = ok({ style: { background: { from: "#000", to: "#223344", angle: 90 } }, frames: [frame] });
  assert.deepEqual(s.style.gradient, { from: "#000", to: "#223344", angle: 90 });
  assert.equal(s.style.background, "#000");
  assert.equal(ok({ style: { background: { from: "#000", to: "#fff" } }, frames: [frame] }).style.gradient?.angle, 180);
});

test("a bad gradient names the field", () => {
  const cases: [object, string, RegExp][] = [
    [{ from: "#000" }, "E-ASCII-STYLE", /style\.background has no "to" colour/],
    [{ from: "#000", to: "blue" }, "E-ASCII-COLOR", /style\.background\.to must be a hex colour/],
    [{ from: "#000", to: "#fff", angle: "up" }, "E-ASCII-STYLE", /style\.background\.angle must be a number of degrees/],
    [{ from: "#000", to: "#fff", angel: 1 }, "E-ASCII-STYLE", /Unknown field 'angel' in style\.background\. Did you mean 'angle'/],
  ];
  for (const [background, code, want] of cases) {
    const d = diag({ style: { background }, frames: [frame] }).find((x) => x.code === code);
    assert.match(d?.message ?? "", want, JSON.stringify(background));
  }
});

test("frame backgrounds parse in the shapes of colors and are linted as E-ASCII-COLORS", () => {
  const s = ok({ frames: [{ text: ["ab", "cd"], backgrounds: ["#112233", [null, "#445566"]] }] });
  assert.deepEqual(s.frames[0]?.backgrounds, [["#112233", "#112233"], [null, "#445566"]]);
  const bad: [unknown, RegExp][] = [
    ["#fff", /backgrounds must be an array/],
    [["#111", "#222", "#333"], /backgrounds has 3 entries but the frame has 2 rows/],
    [["red"], /backgrounds\[0\] is not a hex colour/],
    [[["#111", "#222", "#333"]], /backgrounds\[0\] has 3 cells but the grid is 2 wide/],
    [[["#111", "x"]], /backgrounds\[0\]\[1\] is not a hex colour/],
    [[5], /backgrounds\[0\] must be a colour, a list of colours or null/],
  ];
  for (const [backgrounds, want] of bad) {
    const d = diag({ frames: [{ text: ["ab", "cd"], backgrounds }] }).find((x) => x.code === "E-ASCII-COLORS");
    assert.match(d?.message ?? "", want, JSON.stringify(backgrounds));
    assert.match(d?.message ?? "", /frames\[0\]\.backgrounds/);
    assert.ok(d?.fix);
  }
  // colors errors still say colors
  assert.match(diag({ frames: [{ text: ["ab"], colors: ["red"] }] }).find((x) => x.code === "E-ASCII-COLORS")?.message ?? "", /frames\[0\]\.colors\[0\]/);
});

// ------------------------------------------------------------------ geometry

test("cell geometry: the default is unchanged, another aspect scales the height from the width", () => {
  const d = ok({ style: { fontSize: 13 }, frames: [frame] });
  assert.deepEqual([cellWidth(d), cellHeight(d)], [8, 16]);
  const sq = ok({ style: { fontSize: 10, cellAspect: 1 }, frames: [frame] });
  assert.deepEqual([cellWidth(sq), cellHeight(sq)], [6, 6]);
  assert.deepEqual(canvasSize(sq), { w: 2 * 6 + 10, h: 2 * 6 + 10 });
  assert.equal(rowsForAspect(100, 100, 40, 1), 40);
  assert.equal(rowsForAspect(100, 100, 40), 20);
});

test("glyphSize runs from 25 to 95 percent over the non-space entries of the ramp", () => {
  assert.equal(glyphSize(" .#", "."), 0.25);
  assert.equal(glyphSize(" .#", "#"), 0.95);
  assert.ok(Math.abs(glyphSize(RAMP, "=") - (0.25 + (0.7 * 3) / 8)) < 1e-12);
  assert.equal(glyphSize(" #", "#"), 0.95);
  assert.equal(glyphSize(" .#", "x"), 0);
});

// ------------------------------------------------------------------ SVG text

const dots = (): NAscii => ok({ cols: 3, rows: 2, fps: 4, style: { glyph: "dot", ramp: " .#", cellAspect: 1, fontSize: 10, background: "#000000" }, frames: [{ text: ["#. ", " .#"], colors: [["#ff0000", null, null], [null, null, "#00ff00"]] }] });

test("a dot frame is circles, centred in their cells and sized by the ramp, with no text elements", () => {
  const svg = emitAsciiSvg(dots());
  assert.deepEqual(svgProblems(svg), []);
  assert.ok(!svg.includes("<text"));
  // cell 6 by 6, padding 5: the first cell centre is 8, 8 and "#" is 95 percent of 6
  assert.match(svg, /<circle cx="8" cy="8" r="2\.85" fill="#ff0000"\/>/);
  // "." is 25 percent: radius 0.75, centre of cell (1, 0) is 14, 8
  assert.match(svg, /<circle cx="14" cy="8" r="0\.75"\/>/);
  assert.match(svg, /<circle cx="20" cy="14" r="2\.85" fill="#00ff00"\/>/);
  assert.equal((svg.match(/<circle/g) ?? []).length, 4);
});

test("a square frame is rects of the same size, centred in the cell", () => {
  const s = ok({ cols: 2, rows: 1, style: { glyph: "square", ramp: " .#", cellAspect: 1, fontSize: 10 }, frames: [{ text: ["#."] }] });
  const svg = emitAsciiSvg(s);
  // 95 percent of 6 is 5.7, centred at 8: x = 8 - 2.85
  assert.match(svg, /<rect x="5\.15" y="5\.15" width="5\.7" height="5\.7"\/>/);
  assert.match(svg, /<rect x="13\.25" y="7\.25" width="1\.5" height="1\.5"\/>/);
  assert.ok(!svg.includes("<circle"));
});

test("cell backgrounds are rects merged along a row when neighbours share a colour, and go behind the glyphs", () => {
  assert.deepEqual(backgroundRuns(["#111", "#111", null, "#111", "#222", "#222"]), [
    { col: 0, n: 2, color: "#111" },
    { col: 3, n: 1, color: "#111" },
    { col: 4, n: 2, color: "#222" },
  ]);
  const s = ok({ cols: 4, rows: 2, style: { fontSize: 16 }, frames: [{ text: ["abcd", "efgh"], backgrounds: [["#112233", "#112233", "#112233", null], [null, "#445566", null, "#445566"]] }] });
  const svg = emitAsciiSvg(s);
  const g = svg.split('<g class="f f0">')[1] as string;
  // cell 10 by 20, padding 8
  assert.ok(g.startsWith('<rect x="8" y="8" width="30" height="20" fill="#112233"/>'));
  assert.match(g, /<rect x="18" y="28" width="10" height="20" fill="#445566"\/><rect x="38" y="28" width="10" height="20" fill="#445566"\/>/);
  assert.ok(g.indexOf("<rect") < g.indexOf("<text"), "backgrounds are painted before the text");
  assert.equal((g.match(/<rect/g) ?? []).length, 3);
});

test("a gradient is a linearGradient behind the grid, at the CSS angle", () => {
  const svg = emitAsciiSvg(ok({ cols: 4, rows: 2, style: { background: { from: "#000000", to: "#ffffff", angle: 90 } }, frames: [{ text: ["ab"] }] }));
  assert.match(svg, /<linearGradient id="gertie-bg" gradientUnits="userSpaceOnUse" x1="0" y1="[\d.]+" x2="56" y2="[\d.]+"><stop offset="0" stop-color="#000000"\/><stop offset="1" stop-color="#ffffff"\/><\/linearGradient>/);
  assert.match(svg, /<rect width="100%" height="100%" fill="url\(#gertie-bg\)"\/>/);
  assert.deepEqual(svgProblems(svg), []);
  // 0 degrees points up, 180 down, 90 right, 135 down and right
  assert.deepEqual(gradientLine(100, 50, 180).map((n) => Math.round(n) + 0), [50, 0, 50, 50]);
  assert.deepEqual(gradientLine(100, 50, 0).map((n) => Math.round(n) + 0), [50, 50, 50, 0]);
  assert.deepEqual(gradientLine(100, 50, 90).map((n) => Math.round(n) + 0), [0, 25, 100, 25]);
  const diag135 = gradientLine(100, 50, 135);
  assert.ok(diag135[0] < diag135[2] && diag135[1] < diag135[3]);
});

test("glow is a blur filter and a blurred copy of the glyphs under the sharp ones, with no script or external reference", () => {
  const svg = emitAsciiSvg(ok({ cols: 4, rows: 1, style: { glow: 0.5, fontSize: 16 }, frames: [{ text: ["ab"] }, { text: ["cd"] }] }));
  assert.match(svg, /<filter id="gertie-glow" filterUnits="userSpaceOnUse" x="0" y="0" width="56" height="36"><feGaussianBlur stdDeviation="8"\/><\/filter>/);
  assert.match(svg, /<g class="f f0"><use href="#gertie-glow-0" filter="url\(#gertie-glow\)" opacity="0.6"\/><g id="gertie-glow-0"><text /);
  assert.match(svg, /<g class="f f1"><use href="#gertie-glow-1"/);
  assert.deepEqual(svgProblems(svg), []);
  // a blank frame has nothing to glow
  assert.ok(!emitAsciiSvg(ok({ style: { glow: 0.5 }, frames: [{ text: ["ab"] }, { text: [" "] }] })).includes('href="#gertie-glow-1"'));
});

test("without any of the new fields the SVG has no defs, no use and no extra rects", () => {
  const svg = emitAsciiSvg(ok({ frames: [{ text: ["ab"] }, { text: ["cd"] }] }));
  assert.ok(!/<defs|<use|<circle|linearGradient|filter/.test(svg));
  assert.equal((svg.match(/<rect/g) ?? []).length, 1);
});

test("a non-default cell aspect moves the text baseline with the cell", () => {
  const tall = ok({ cols: 2, rows: 2, style: { cellAspect: 3, fontSize: 10 }, frames: [{ text: ["ab", "cd"] }] });
  // cell 6 by 18, padding 5: baseline is 76 percent of the cell down
  assert.match(emitAsciiSvg(tall), /y="18\.68"/);
  assert.match(emitAsciiSvg(tall), /y="36\.68"/);
});

// ------------------------------------------------------------------ terminal, shell script, file format

test("terminal playback draws cell backgrounds as ANSI background colours, including behind spaces, and resets them", () => {
  const s = ok({ cols: 3, rows: 1, frames: [{ text: ["a b"], backgrounds: [["#102030", "#102030", null]] }] });
  const t = terminalFrame(s, 0, { color: true, fill: "el" });
  assert.equal(t, "\u001b[48;2;16;32;48m\u001b[38;2;34;197;94ma \u001b[49mb\u001b[K\u001b[0m".replace("\u001b[K", "\u001b[K"));
  // plain text ignores styling
  assert.equal(terminalFrame(s, 0, { color: false, fill: "el" }), "a b\u001b[K");
  // a row that ends on a background resets it before erase-to-end-of-line, so the fill does not run to the edge
  const e = ok({ cols: 2, rows: 1, frames: [{ text: ["ab"], backgrounds: [["#102030", "#102030"]] }] });
  assert.ok(terminalFrame(e, 0, { color: true, fill: "el" }).includes("\u001b[49m\u001b[K"));
  // pad mode keeps the width without escape codes
  const visible = terminalFrame(ok({ cols: 5, rows: 1, frames: [{ text: ["ab"], backgrounds: [["#102030", null]] }] }), 0, { color: true, fill: "pad" }).replace(/\u001b\[[0-9;]*m/g, "");
  assert.equal(visible.length, 5);
});

test("the shell script uses colour when a frame has backgrounds", () => {
  const sh = exportSh(ok({ cols: 2, rows: 1, frames: [{ text: ["ab"], backgrounds: [["#102030", "#102030"]] }] }));
  assert.ok(sh.includes("48;2;16;32;48"));
});

test("glyph, glow and gradient do not change terminal text", () => {
  const plain = ok({ cols: 2, rows: 1, frames: [{ text: ["#."] }] });
  const styled = ok({ cols: 2, rows: 1, style: { glyph: "dot", ramp: " .#", glow: 0.5, background: { from: "#000", to: "#fff" }, cellAspect: 1 }, frames: [{ text: ["#."] }] });
  assert.equal(terminalFrame(styled, 0, { color: true, fill: "pad" }), terminalFrame(plain, 0, { color: true, fill: "pad" }));
});

test("formatAscii writes backgrounds and the new style fields, and the result parses back", () => {
  const text = formatAscii({
    ascii: 1,
    name: "x",
    cols: 2,
    rows: 1,
    fps: 4,
    loop: true,
    style: { glyph: "square", ramp: " .#", cellAspect: 1, glow: 0.3, background: { from: "#000000", to: "#112233", angle: 45 } },
    frames: [{ text: ["#."], colors: [["#ff0000", null]], backgrounds: [["#112233", null]], hold: 2 }, { text: [".#"], backgrounds: [[null, "#445566"]] }],
  });
  const s = ok(JSON.parse(text));
  assert.equal(s.style.glyph, "square");
  assert.equal(s.style.gradient?.angle, 45);
  assert.deepEqual(s.frames[0]?.backgrounds, [["#112233", null]]);
  assert.deepEqual(s.frames[1]?.backgrounds, [[null, "#445566"]]);
  assert.equal(s.frames[0]?.hold, 2);
});

// ------------------------------------------------------------------ converter: cell-bg

test("cellBg gives every non-empty cell a background of its own colour at that brightness", () => {
  const px = new Uint8ClampedArray([200, 100, 50, 255, 0, 0, 0, 255]);
  const c = convertClip([px], 2, 1, { ramp: RAMP, invert: false, color: true, mode: "luma", cellBg: 0.5 })[0];
  const first = c?.backgrounds?.[0]?.[0] as string;
  // the cell colour is rounded to steps of 32 (#c06040), then halved
  assert.equal(first, "#603020");
  assert.equal(c?.backgrounds?.[0]?.[1], null);
  // no cell-bg: no backgrounds key at all
  assert.equal(convertClip([px], 2, 1, { ramp: RAMP, invert: false, color: true, mode: "luma" })[0]?.backgrounds, undefined);
});

// ------------------------------------------------------------------ command line

const cli = join(root, "src/cli/gertie.ts");
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", cwd: root });

test("ascii from writes the styling, computes square rows, and the file lints clean", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-style-"));
  try {
    const out = join(dir, "dots.ascii.json");
    const r = run("ascii", "from", join(root, "examples/pulse-circle.gertie.json"), "--cols", "30", "--glyph", "dot", "--cell-aspect", "1", "--cell-bg", "0.35", "--glow", "0.4", "--font-size", "10", "--color", "--out", out);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const raw = JSON.parse(readFileSync(out, "utf8")) as { rows: number; cols: number; style: Record<string, unknown>; frames: { backgrounds?: unknown }[] };
    assert.equal(raw.rows, 30, "a square scene with square cells has as many rows as columns");
    assert.deepEqual([raw.style["glyph"], raw.style["cellAspect"], raw.style["glow"], raw.style["fontSize"], raw.style["ramp"]], ["dot", 1, 0.4, 10, " .:-=+*#%@"]);
    assert.ok(raw.frames.some((f) => f.backgrounds !== undefined));
    const l = run("ascii", "lint", out, "--json", "--strict");
    assert.equal(l.status, 0, l.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ascii from rejects bad styling values and conflicts", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-style-"));
  try {
    const src = join(dir, "x.png");
    writeFileSync(src, "x");
    const cases: [string[], RegExp][] = [
      [["--glyph", "star"], /--glyph must be text, dot or square/],
      [["--glow", "2"], /--glow must be a number from 0 to 1/],
      [["--cell-bg", "-1"], /--cell-bg must be a number from 0 to 1/],
      [["--cell-aspect", "9"], /--cell-aspect must be a number from 0.5 to 4/],
      [["--font-size", "2"], /--font-size must be a number from 6 to 64/],
      [["--glyph", "dot", "--chars", "CZ"], /--glyph dot and --glyph square size each shape by its place in a ramp/],
    ];
    for (const [flags, want] of cases) {
      const r = run("ascii", "from", src, ...flags);
      assert.equal(r.status, 2, flags.join(" "));
      assert.match(r.stdout + r.stderr, want, flags.join(" "));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
