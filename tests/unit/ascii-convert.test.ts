import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cellHash, cellsFromRgba, convertClip, cropRaster, DEFAULT_RAMP, NAMED_RAMPS, resolveRamp, ringMedian, type ConvertControls, type ConvertOptions, type RGB } from "../../src/ascii/convert.ts";
import { mulberry32 } from "../../src/ascii/gen.ts";

const root = join(import.meta.dirname, "../..");

type Opts = ConvertOptions & ConvertControls;
const base: Opts = { ramp: DEFAULT_RAMP, invert: false, color: false, mode: "luma" };

/** A raster of opaque grey cells from a list of values 0 to 255, row by row. */
function grey(cols: number, rows: number, values: number[]): Uint8ClampedArray {
  const px = new Uint8ClampedArray(cols * rows * 4);
  values.forEach((v, i) => px.set([v, v, v, 255], i * 4));
  return px;
}

/** A cols by rows gradient from black to white, left to right. */
function gradient(cols: number, rows: number): Uint8ClampedArray {
  return grey(cols, rows, Array.from({ length: cols * rows }, (_, i) => Math.round(((i % cols) / (cols - 1)) * 255)));
}

const text = (c: { cells: string[][] }): string[] => c.cells.map((r) => r.join(""));
const frameTexts = (cs: { cells: string[][] }[]): string[] => cs.map((c) => text(c).join("|"));

// ------------------------------------------------------------------ the default is the old behaviour

test("with none of the new controls the output is byte-identical to phase 8", () => {
  // Hashes of the phase 8 converter's output on this raster, taken before the controls were added.
  const r = mulberry32(99);
  const cols = 24;
  const rows = 12;
  const px = new Uint8ClampedArray(cols * rows * 4);
  for (let i = 0; i < px.length; i += 4) {
    px[i] = r() * 256;
    px[i + 1] = r() * 256;
    px[i + 2] = r() * 256;
    px[i + 3] = r() < 0.2 ? 0 : r() < 0.3 ? r() * 255 : 255;
  }
  const want: Record<string, string> = JSON.parse(OLD_HASHES);
  for (const mode of ["luma", "alpha", "distance"] as const) {
    for (const invert of [false, true]) {
      for (const color of [false, true]) {
        const c = cellsFromRgba(px, cols, rows, { ramp: " .:-=+*#%@", invert, color, mode, ...(mode === "distance" ? { background: [10, 20, 30] as RGB } : {}) });
        assert.equal(createHash("sha1").update(JSON.stringify(c)).digest("hex"), want[`${mode}-${invert}-${color}`], `${mode} invert=${invert} color=${color}`);
      }
    }
  }
});

// ------------------------------------------------------------------ normalize, gamma, threshold

test("normalize stretches the 2nd to 98th percentile of the whole clip to the full ramp", () => {
  // Values only between 100 and 140 of 255: without normalising the characters are all the same.
  const dim = grey(4, 4, Array.from({ length: 16 }, (_, i) => 100 + i * 3));
  const plain = text(cellsFromRgba(dim, 4, 4, base)).join("");
  assert.ok(new Set(plain).size <= 2, plain);
  const norm = text(cellsFromRgba(dim, 4, 4, { ...base, normalize: true })).join("");
  assert.equal(norm[0], " ");
  assert.equal(norm[norm.length - 1], "@");
  assert.ok(new Set(norm).size >= 6, norm);
});

test("normalize looks at the whole clip, not one frame", () => {
  const dark = grey(2, 1, [0, 100]);
  const bright = grey(2, 1, [0, 200]);
  const both = convertClip([dark, bright], 2, 1, { ...base, normalize: true });
  const alone = convertClip([dark], 2, 1, { ...base, normalize: true });
  assert.notEqual(text(both[0] as { cells: string[][] })[0], text(alone[0] as { cells: string[][] })[0]);
  // the dark frame stays dimmer than the bright one when they are normalised together
  const lum = (c: { cells: string[][] }): number => DEFAULT_RAMP.indexOf((c.cells[0] as string[])[1] as string);
  assert.ok(lum(both[0] as { cells: string[][] }) < lum(both[1] as { cells: string[][] }));
});

test("normalize leaves a flat picture alone instead of dividing by zero", () => {
  const flat = grey(3, 3, new Array<number>(9).fill(128));
  assert.deepEqual(text(cellsFromRgba(flat, 3, 3, { ...base, normalize: true })), text(cellsFromRgba(flat, 3, 3, base)));
});

test("gamma below 1 lifts dark areas and above 1 deepens them", () => {
  const g = gradient(8, 1);
  const rank = (c: { cells: string[][] }): number => [...(c.cells[0] as string[])].reduce((n, ch) => n + DEFAULT_RAMP.indexOf(ch), 0);
  const flat = rank(cellsFromRgba(g, 8, 1, base));
  assert.ok(rank(cellsFromRgba(g, 8, 1, { ...base, gamma: 0.5 })) > flat);
  assert.ok(rank(cellsFromRgba(g, 8, 1, { ...base, gamma: 2 })) < flat);
  assert.deepEqual(text(cellsFromRgba(g, 8, 1, { ...base, gamma: 1 })), text(cellsFromRgba(g, 8, 1, base)));
});

test("threshold turns cells under the value into spaces", () => {
  const g = gradient(8, 4);
  const c = text(cellsFromRgba(g, 8, 4, { ...base, threshold: 0.5 }));
  // the cell at 3 of 7 is 0.43, dropped; the cell at 4 of 7 is 0.57, kept
  for (const row of c) {
    assert.equal(row.slice(0, 4), "    ");
    assert.ok(!row.slice(4).includes(" "));
  }
  assert.deepEqual(text(cellsFromRgba(g, 8, 4, { ...base, threshold: 0 })), text(cellsFromRgba(g, 8, 4, base)));
});

// ------------------------------------------------------------------ key

/** A subject (value 200) in the middle of a 6 by 6 raster whose border is flat blue. */
function subjectOnBlue(): Uint8ClampedArray {
  const px = new Uint8ClampedArray(36 * 4);
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      const inside = r >= 2 && r <= 3 && c >= 2 && c <= 3;
      px.set(inside ? [220, 200, 60, 255] : [20, 40, 160, 255], (r * 6 + c) * 4);
    }
  }
  return px;
}

test("key auto takes the colour of the outer ring and empties everything near it", () => {
  const px = subjectOnBlue();
  assert.deepEqual(ringMedian(px, 6, 6), [20, 40, 160]);
  const without = text(cellsFromRgba(px, 6, 6, base));
  assert.ok(without[0]?.trim() !== "", "the blue border shows without a key");
  const keyed = text(cellsFromRgba(px, 6, 6, { ...base, key: "auto" }));
  const blank = "      ";
  assert.deepEqual(keyed.map((r) => r.replace(/[^ ]/g, "x")), [blank, blank, "  xx  ", "  xx  ", blank, blank]);
});

test("key with a colour only empties cells within 40 of it", () => {
  const px = new Uint8ClampedArray(3 * 4);
  px.set([100, 100, 100, 255], 0);
  px.set([130, 100, 100, 255], 4); // distance 30: keyed
  px.set([150, 100, 100, 255], 8); // distance 50: kept
  const c = text(cellsFromRgba(px, 3, 1, { ...base, key: [100, 100, 100] }));
  assert.equal(c[0]?.[0], " ");
  assert.equal(c[0]?.[1], " ");
  assert.notEqual(c[0]?.[2], " ");
});

test("the key is taken from the first frame only", () => {
  const blue = subjectOnBlue();
  const red = new Uint8ClampedArray(blue);
  for (let i = 0; i < red.length; i += 4) if (red[i] === 20) red.set([200, 20, 20, 255], i);
  const clip = convertClip([blue, red], 6, 6, { ...base, key: "auto" });
  const a = clip[0] as { cells: string[][] };
  const b = clip[1] as { cells: string[][] };
  assert.equal(text(a)[0]?.trim(), "");
  assert.notEqual(text(b)[0]?.trim(), "", "red border is not keyed because the key is blue");
});

// ------------------------------------------------------------------ crop (vector scenes; media goes through ffmpeg)

test("cropRaster keeps the rectangle and clamps it to the picture", () => {
  const data = new Uint8ClampedArray(4 * 4 * 4);
  for (let i = 0; i < 16; i++) data.set([i, 0, 0, 255], i * 4);
  const r = cropRaster({ w: 4, h: 4, data }, 1, 1, 2, 2);
  assert.deepEqual([r.w, r.h, r.data[0], r.data[4], r.data[8], r.data[12]], [2, 2, 5, 6, 9, 10]);
  const edge = cropRaster({ w: 4, h: 4, data }, 3, 3, 9, 9);
  assert.deepEqual([edge.w, edge.h], [1, 1]);
});

// ------------------------------------------------------------------ colour: levels, palette, tint

const colorOpts: Opts = { ...base, color: true };
const orange = (): Uint8ClampedArray => new Uint8ClampedArray([250, 130, 20, 255]);

test("color-levels sets the number of levels per channel", () => {
  assert.equal(cellsFromRgba(orange(), 1, 1, { ...colorOpts, colorLevels: 2 }).colors?.[0]?.[0], "#ff8000".replace("80", "ff"));
  const levelsOf = (n: number): number => {
    const seen = new Set<string>();
    const px = new Uint8ClampedArray(256 * 4);
    for (let i = 0; i < 256; i++) px.set([i, i, i, 255], i * 4);
    for (const row of cellsFromRgba(px, 256, 1, { ...colorOpts, colorLevels: n }).colors ?? []) for (const c of row) if (c) seen.add(c.slice(1, 3));
    return seen.size;
  };
  assert.equal(levelsOf(2), 2);
  assert.equal(levelsOf(4), 4);
  // the darkest levels fall into empty cells, which carry no colour
  assert.ok(levelsOf(32) >= 29 && levelsOf(32) <= 32);
});

test("palette gives each coloured cell the nearest palette colour and implies colour", () => {
  const px = new Uint8ClampedArray([240, 120, 150, 255, 100, 190, 60, 255, 250, 250, 245, 255]);
  const palette: RGB[] = [[0x7c, 0xb3, 0x42], [0xf4, 0x8f, 0xb1], [0xf5, 0xf5, 0xf5]];
  const c = cellsFromRgba(px, 3, 1, { ...base, palette });
  assert.deepEqual(c.colors?.[0], ["#f48fb1", "#7cb342", "#f5f5f5"]);
});

test("tint scales one colour by the cell value from 35 to 100 percent", () => {
  const px = grey(3, 1, [60, 160, 255]);
  const c = cellsFromRgba(px, 3, 1, { ...base, tint: [200, 100, 0] });
  const reds = (c.colors?.[0] ?? []).map((x) => parseInt((x as string).slice(1, 3), 16));
  assert.ok(reds[0] as number < (reds[1] as number) && (reds[1] as number) < (reds[2] as number));
  assert.equal(reds[2], 200);
  assert.ok((reds[0] as number) >= 0.35 * 200 - 1);
});

// ------------------------------------------------------------------ ramps

test("named ramps resolve, anything else is literal", () => {
  assert.equal(resolveRamp("standard"), DEFAULT_RAMP);
  assert.equal(resolveRamp("binary"), " 01");
  assert.equal(resolveRamp(" -#"), " -#");
  assert.equal(resolveRamp("toString"), "toString");
  for (const [name, ramp] of Object.entries(NAMED_RAMPS)) {
    const chars = [...ramp];
    assert.equal(chars[0], " ", name);
    assert.equal(new Set(chars).size, chars.length, `${name} has no repeated characters`);
  }
  assert.equal([...(NAMED_RAMPS["long"] as string)].length, 69);
});

test("a long ramp is used across its whole length", () => {
  const c = text(cellsFromRgba(gradient(69, 1), 69, 1, { ...base, ramp: resolveRamp("long") }))[0] as string;
  assert.equal(c[0], " ");
  assert.equal(c[68], "$");
  assert.ok(new Set(c).size > 40);
});

// ------------------------------------------------------------------ chars and shimmer

test("chars picks a stable character per cell: the same on every frame", () => {
  const f = grey(6, 4, new Array<number>(24).fill(200));
  const clip = convertClip([f, f, f], 6, 4, { ...base, chars: "CZ", seed: 3 });
  assert.deepEqual(text(clip[0] as { cells: string[][] }), text(clip[1] as { cells: string[][] }));
  assert.deepEqual(text(clip[1] as { cells: string[][] }), text(clip[2] as { cells: string[][] }));
  const all = text(clip[0] as { cells: string[][] }).join("");
  assert.ok(all.includes("C") && all.includes("Z"));
  assert.ok(![...all].some((ch) => ch !== "C" && ch !== "Z"));
});

test("chars depends on the seed, not on brightness, and implies colour", () => {
  const g = gradient(12, 4);
  const a = convertClip([g], 12, 4, { ...base, chars: "CZ", seed: 3 })[0] as { cells: string[][]; colors: unknown };
  const b = convertClip([g], 12, 4, { ...base, chars: "CZ", seed: 4 })[0] as { cells: string[][] };
  assert.notDeepEqual(text(a), text(b));
  assert.notEqual(a.colors, null);
  // empty (black) cells stay empty
  assert.equal(a.cells[0]?.[0], " ");
});

test("shimmer re-rolls the stated fraction of cells per frame, and is repeatable", () => {
  const f = grey(40, 20, new Array<number>(800).fill(200));
  const run = (seed: number): { cells: string[][] }[] => convertClip([f, f, f], 40, 20, { ...base, chars: "CZ+*", seed, shimmer: 0.25 });
  const a = run(5);
  const diff = (x: { cells: string[][] }, y: { cells: string[][] }): number => {
    let n = 0;
    x.cells.forEach((row, r) => row.forEach((ch, c) => ch !== (y.cells[r] as string[])[c] && n++));
    return n / 800;
  };
  const stable = convertClip([f, f], 40, 20, { ...base, chars: "CZ+*", seed: 5 });
  assert.equal(diff(stable[0] as { cells: string[][] }, stable[1] as { cells: string[][] }), 0);
  // frame 0 vs the unshimmered base differs in about a quarter of the cells; so do frames against each other (about 1 - (0.75^2 + share that re-rolled to the same char))
  const fromBase = diff(a[0] as { cells: string[][] }, stable[0] as { cells: string[][] });
  assert.ok(Math.abs(fromBase - 0.25) < 0.06, `fraction ${fromBase}`);
  assert.ok(diff(a[0] as { cells: string[][] }, a[1] as { cells: string[][] }) > 0.2);
  assert.deepEqual(frameTexts(run(5)), frameTexts(a));
  assert.notDeepEqual(frameTexts(run(6)), frameTexts(a));
});

// ------------------------------------------------------------------ dither

test("ordered dither breaks a flat tone into a pattern and keeps it centred", () => {
  const flat = grey(8, 8, new Array<number>(64).fill(110));
  const ramp = " .#";
  const plain = text(cellsFromRgba(flat, 8, 8, { ...base, ramp })).join("");
  assert.equal(new Set(plain).size, 1);
  const d = text(cellsFromRgba(flat, 8, 8, { ...base, ramp, dither: "ordered" }));
  assert.ok(new Set(d.join("")).size >= 2, d.join("|"));
  // the 4 by 4 pattern repeats
  assert.deepEqual(d.map((r) => r.slice(0, 4)), d.map((r) => r.slice(4)));
  assert.deepEqual(d[0]?.slice(0, 4), d[4]?.slice(0, 4));
  // black stays black, white stays white
  const bw = grey(2, 1, [0, 255]);
  assert.deepEqual(text(cellsFromRgba(bw, 2, 1, { ...base, ramp, dither: "ordered" })), [" #"]);
});

// ------------------------------------------------------------------ edge colour

test("edge-color marks cells whose value differs from a neighbour by more than 0.35", () => {
  // a bright square on dark: the cells of the square touching the dark take the edge colour only where the step is large
  const vals = [0, 0, 0, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 0, 0, 0];
  const px = grey(4, 4, vals);
  const c = cellsFromRgba(px, 4, 4, { ...base, edgeColor: [59, 130, 246] });
  const col = c.colors as (string | null)[][];
  assert.equal(col[1]?.[1], "#3b82f6");
  assert.equal(col[2]?.[2], "#3b82f6");
  // space cells never get a colour
  assert.equal(col[0]?.[0], null);
  // a soft gradient (step 1/7 per cell) has no edges
  const soft = cellsFromRgba(gradient(8, 1), 8, 1, { ...base, edgeColor: [59, 130, 246] });
  assert.equal(soft.colors, null);
});

// ------------------------------------------------------------------ order of operations and hashes

test("the hash is repeatable and spread over 0 to 1", () => {
  assert.equal(cellHash(3, 4, 5), cellHash(3, 4, 5));
  assert.notEqual(cellHash(3, 4, 5), cellHash(4, 3, 5));
  let sum = 0;
  for (let i = 0; i < 2000; i++) sum += cellHash(i, 7, 1);
  assert.ok(Math.abs(sum / 2000 - 0.5) < 0.03);
});

test("controls apply in the stated order: key before normalise, threshold after gamma", () => {
  // key removes the bright border so it cannot stretch the range
  const px = subjectOnBlue();
  const keyed = convertClip([px], 6, 6, { ...base, key: "auto", normalize: true })[0] as { cells: string[][] };
  assert.notEqual(keyed.cells[2]?.[2], " ");
  // threshold compares the value after gamma: 0.5 raised to 2 is 0.25, under 0.3
  const half = grey(1, 1, [128]);
  assert.equal(text(cellsFromRgba(half, 1, 1, { ...base, threshold: 0.3 }))[0], text(cellsFromRgba(half, 1, 1, base))[0]);
  assert.equal(text(cellsFromRgba(half, 1, 1, { ...base, threshold: 0.3, gamma: 2 }))[0], " ");
});

// ------------------------------------------------------------------ command line

const cli = join(root, "src/cli/gertie.ts");
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", cwd: root });

test("ascii from rejects bad values and excluded combinations with a usage error that names the flag", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-ascii-from-"));
  try {
    const src = join(dir, "x.png");
    writeFileSync(src, "not an image");
    const cases: [string[], RegExp][] = [
      [["--gamma", "0"], /--gamma must be a number from 0.1 to 10/],
      [["--threshold", "2"], /--threshold must be a number from 0 to 1/],
      [["--key", "blue"], /--key must be auto or a colour/],
      [["--crop", "1,2,3"], /--crop needs four whole numbers/],
      [["--crop", "0,0,0,5"], /--crop needs four whole numbers/],
      [["--color-levels", "1", "--color"], /--color-levels must be a whole number from 2 to 32/],
      [["--color-levels", "8"], /--color-levels needs --color/],
      [["--palette", "red,blue"], /--palette needs colours/],
      [["--tint", "#fff", "--palette", "#000,#fff"], /--tint and --palette cannot be combined/],
      [["--tint", "nope"], /--tint needs a colour/],
      [["--chars", "a b"], /--chars needs a set of visible characters/],
      [["--chars", "CZ", "--ramp", "long"], /--chars and --ramp cannot be combined/],
      [["--shimmer", "0.5"], /--shimmer needs --chars/],
      [["--shimmer", "2", "--chars", "CZ"], /--shimmer must be a number from 0 to 1/],
      [["--seed", "3"], /--seed needs --chars/],
      [["--dither", "random"], /--dither must be ordered/],
      [["--dither", "ordered", "--chars", "CZ"], /--dither works on a ramp/],
      [["--edge-color", "x"], /--edge-color needs a colour/],
      [["--normalize", "--no-normalize"], /--normalize or --no-normalize, not both/],
      [["--ramp", "x"], /--ramp needs a name/],
    ];
    for (const [flags, want] of cases) {
      const r = run("ascii", "from", src, ...flags);
      assert.equal(r.status, 2, `${flags.join(" ")}: ${r.stdout}${r.stderr}`);
      assert.match(r.stdout + r.stderr, want, flags.join(" "));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

const OLD_HASHES = String.raw`{"luma-false-false":"7ed88505e5b8493be695f295ac9e62934198545e","luma-false-true":"8663db4fabd530758afc926b654275d5426b7363","luma-true-false":"c558eb5dfc3dbdff95b176ba0a667b07ff520cd3","luma-true-true":"71d323d962ce1a59a918ebf37423b66c9582871d","alpha-false-false":"d4ec3989af44360a042c3f74e7d5cb7918460cd8","alpha-false-true":"4af830b2a3d3ed92646eece4fdf6a691aaf08246","alpha-true-false":"d4ec3989af44360a042c3f74e7d5cb7918460cd8","alpha-true-true":"4af830b2a3d3ed92646eece4fdf6a691aaf08246","distance-false-false":"f9ab672853aee8dd984c9d7a4de2c4b92c50da6a","distance-false-true":"8d09838335733ebaaf37f1805b987cf2642e2e25","distance-true-false":"f9ab672853aee8dd984c9d7a4de2c4b92c50da6a","distance-true-true":"8d09838335733ebaaf37f1805b987cf2642e2e25"}`;
