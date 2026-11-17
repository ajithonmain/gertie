import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseAscii } from "../../src/ascii/parse.ts";
import { collect, framesOf, shapeOf, AsciiSourceError, type CellRequest, type OpenSource, type SourceReader } from "../../src/ascii/frames.ts";
import { convertClip, DEFAULT_RAMP, NAMED_RAMPS, rowsForAspect } from "../../src/ascii/convert.ts";
import { MAX_RECIPE_COLS, MAX_RECIPE_FRAMES, MAX_RECIPE_ROWS, rendererFor, SVG_CELL_LIMIT, type NAscii, type NAsciiFrame } from "../../src/ascii/types.ts";
import { mulberry32 } from "../../src/ascii/gen.ts";

const root = join(import.meta.dirname, "../..");

const parse = (raw: unknown, files: Record<string, string> = {}) => parseAscii(raw, { io: { readText: (p) => files[p] } });
const codes = (raw: unknown, files: Record<string, string> = {}): string[] => parse(raw, files).diagnostics.map((d) => d.code);
const scene = (raw: unknown): NAscii => {
  const r = parse(raw);
  assert.ok(r.scene, JSON.stringify(r.diagnostics));
  return r.scene;
};
const recipe = (source: Record<string, unknown>, more: Record<string, unknown> = {}): Record<string, unknown> => ({ ascii: 1, fps: 10, ...more, source: { file: "clip.mp4", ...source } });

/** A synthetic clip: `frames` raster functions of size `w` by `h`, read through an injected reader. Counts every call so a test can see what was read. */
function fakeSource(o: { w: number; h: number; frames: number; kind?: "scene" | "media"; background?: [number, number, number] | null; px?: (cols: number, rows: number, f: number) => Uint8ClampedArray; short?: number }) {
  const calls = { open: [] as string[], passes: 0, requests: [] as CellRequest[] };
  const px =
    o.px ??
    ((cols: number, rows: number, f: number): Uint8ClampedArray => {
      const r = mulberry32(1000 + f);
      const a = new Uint8ClampedArray(cols * rows * 4);
      for (let i = 0; i < a.length; i += 4) a.set([r() * 256, r() * 256, r() * 256, 255], i);
      return a;
    });
  const src: OpenSource = {
    kind: o.kind ?? "media",
    width: o.w,
    height: o.h,
    seconds: o.frames / 10,
    background: o.background ?? null,
    loop: true,
    frameCount: (_fps, _secs, maxFrames) => Promise.resolve(Math.min(maxFrames, o.frames)),
    async *cells(req) {
      calls.passes++;
      calls.requests.push(req);
      const n = Math.min(req.count, o.short ?? o.frames);
      for (let f = 0; f < n; f++) yield px(req.cols, req.rows, f);
    },
  };
  const read: SourceReader = (file) => {
    calls.open.push(file);
    return Promise.resolve(src);
  };
  return { read, calls, px };
}

const drain = async (s: NAscii, read?: SourceReader): Promise<NAsciiFrame[]> => {
  const out: NAsciiFrame[] = [];
  for await (const f of framesOf(s, read)) out.push(f);
  return out;
};

// ------------------------------------------------------------------ parsing and lint

test("a recipe parses: source fields by camel-case flag name, defaults, a named ramp, and no frames", () => {
  const s = scene(recipe({ cols: 120, ramp: "long", palette: ["#7cb342", "#f48fb1"], key: "auto", gamma: 0.8, threshold: 0.1, crop: [0, 0, 100, 50], edgeColor: "#3b82f6", cellBg: 0.3, normalize: false, maxSeconds: 4 }));
  assert.equal(s.cols, 120);
  assert.equal(s.rows, 0, "rows are unknown until the source is looked at");
  assert.deepEqual(s.frames, []);
  assert.ok(s.source);
  assert.equal(s.source.ramp, NAMED_RAMPS["long"]);
  assert.deepEqual(s.source.crop, { x: 0, y: 0, w: 100, h: 50 });
  assert.equal(s.source.normalize, false);
  assert.equal(s.source.maxSeconds, 4);
  const d = scene(recipe({}));
  assert.equal(d.source?.cols, 80);
  assert.equal(d.source?.ramp, DEFAULT_RAMP);
  assert.equal(d.source?.normalize, null, "absent: decided by the kind of source");
  assert.equal(d.source?.rows, null);
  assert.equal(scene(recipe({ rows: 30 })).rows, 30);
});

test("frames, framesFile and source are mutually exclusive", () => {
  assert.ok(codes({ ascii: 1, frames: [{ text: ["a"] }], source: { file: "a.mp4" } }).includes("E-ASCII-FRAMES"));
  assert.ok(codes({ ascii: 1, framesFile: "a.txt", source: { file: "a.mp4" } }, { "a.txt": "x" }).includes("E-ASCII-FRAMES"));
  const all = parse({ ascii: 1, frames: [{ text: ["a"] }], framesFile: "a.txt", source: { file: "a.mp4" } }, { "a.txt": "x" }).diagnostics.find((x) => x.code === "E-ASCII-FRAMES");
  assert.match(all?.message ?? "", /"frames" and "framesFile" and "source" are all present/);
  assert.ok(!codes(recipe({})).includes("E-ASCII-NOFRAMES"));
});

test("every source field is linted with E-ASCII-SOURCE, naming the field and the fix", () => {
  const bad: [Record<string, unknown>, string][] = [
    [{ file: "" }, "source.file"],
    [{ cols: 3 }, "source.cols"],
    [{ cols: 401 }, "source.cols"],
    [{ cols: 80.5 }, "source.cols"],
    [{ rows: 201 }, "source.rows"],
    [{ maxSeconds: 0 }, "source.maxSeconds"],
    [{ ramp: "x" }, "source.ramp"],
    [{ invert: "yes" }, "source.invert"],
    [{ color: 1 }, "source.color"],
    [{ normalize: "on" }, "source.normalize"],
    [{ gamma: 20 }, "source.gamma"],
    [{ threshold: -1 }, "source.threshold"],
    [{ key: "blue" }, "source.key"],
    [{ crop: [0, 0, 10] }, "source.crop"],
    [{ crop: "0,0,10,10" }, "source.crop"],
    [{ colorLevels: 40, color: true }, "source.colorLevels"],
    [{ palette: [] }, "source.palette"],
    [{ palette: ["#zzz"] }, "source.palette"],
    [{ tint: "red" }, "source.tint"],
    [{ chars: "A B" }, "source.chars"],
    [{ seed: -1, chars: "AB" }, "source.seed"],
    [{ shimmer: 2, chars: "AB" }, "source.shimmer"],
    [{ dither: "random" }, "source.dither"],
    [{ edgeColor: "#12345" }, "source.edgeColor"],
    [{ cellBg: 1.5 }, "source.cellBg"],
  ];
  for (const [src, path] of bad) {
    const d = parse(recipe(src)).diagnostics.find((x) => x.code === "E-ASCII-SOURCE");
    assert.ok(d, `no E-ASCII-SOURCE for ${JSON.stringify(src)}`);
    assert.equal(d.path, path, JSON.stringify(src));
    assert.ok((d.fix ?? "").length > 0);
  }
  const unknown = parse(recipe({ colour: true })).diagnostics.find((x) => x.code === "E-ASCII-SOURCE");
  assert.match(unknown?.message ?? "", /Unknown field 'colour'.*color/);
  assert.equal(parse({ ascii: 1, source: "clip.mp4" }).diagnostics[0]?.code, "E-ASCII-SOURCE");
});

test("the combinations ascii from refuses are refused in a recipe too", () => {
  const combos: Record<string, unknown>[] = [
    { tint: "#ff0000", palette: ["#00ff00"] },
    { chars: "CZ", ramp: "long" },
    { chars: "CZ", dither: "ordered" },
    { shimmer: 0.2 },
    { seed: 3 },
    { colorLevels: 4 },
    { colorLevels: 4, palette: ["#00ff00"] },
  ];
  for (const c of combos) assert.ok(codes(recipe(c)).includes("E-ASCII-SOURCE"), JSON.stringify(c));
  assert.ok(codes(recipe({ chars: "CZ" }, { style: { glyph: "dot", ramp: " .o" } })).includes("E-ASCII-SOURCE"));
  assert.deepEqual(codes(recipe({ chars: "CZ", shimmer: 0.2, seed: 3 })), []);
  assert.deepEqual(codes(recipe({ colorLevels: 4, color: true })), []);
});

test("the grid of a recipe is set in source, not at the top", () => {
  const d = parse(recipe({}, { cols: 100 })).diagnostics.find((x) => x.code === "E-ASCII-SIZE");
  assert.ok(d);
  assert.match(d.fix ?? "", /"source": \{"file": "\.\.\.", "cols": 100\}/);
});

test("a recipe gets none of the warnings about frame content, and W-ASCII-FPS fires above 15 fps only under 80 columns", () => {
  assert.deepEqual(codes(recipe({ cols: 120 }, { fps: 24 })), []);
  assert.deepEqual(codes(recipe({ cols: 60 }, { fps: 24 })), ["W-ASCII-FPS"]);
  assert.deepEqual(codes(recipe({ cols: 80 }, { fps: 30 })), []);
  const row = (n: number): string => "#".repeat(n);
  const inline = (cols: number, fps: number): string[] => codes({ ascii: 1, fps, frames: [{ text: [row(cols)] }, { text: [row(cols - 1)] }, { text: [row(cols - 2)] }] });
  assert.ok(inline(40, 24).includes("W-ASCII-FPS"));
  assert.ok(!inline(80, 24).includes("W-ASCII-FPS"));
  assert.ok(!inline(40, 15).includes("W-ASCII-FPS"));
});

// ------------------------------------------------------------------ framesOf

test("framesOf yields inline frames and a framesFile's frames as parsed, with no reader", async () => {
  const s = scene({ ascii: 1, frames: [{ text: ["ab"], hold: 2 }, { text: ["cd"], colors: ["#ff0000"] }] });
  const got = await drain(s);
  assert.deepEqual(got, s.frames);
  const f = parse({ ascii: 1, framesFile: "all.txt" }, { "all.txt": "a\n---\nb\n---\nc\n" }).scene as NAscii;
  assert.deepEqual((await drain(f)).map((x) => x.cells[0]?.join("")), ["a", "b", "c"]);
  assert.deepEqual(await shapeOf(f), { cols: 1, rows: 1, intervals: 3, frames: 3, cells: 3, renderer: "svg" });
});

test("framesOf converts a recipe through the injected reader, exactly as convertClip does, frame by frame", async () => {
  const { read, calls, px } = fakeSource({ w: 320, h: 180, frames: 6 });
  const s = scene(recipe({ cols: 24, color: true, normalize: false }));
  const shape = await shapeOf(s, read);
  const rows = rowsForAspect(320, 180, 24);
  assert.deepEqual(shape, { cols: 24, rows, intervals: 6, frames: 6, cells: 24 * rows * 6, renderer: "svg" });
  const got = await drain(s, read);
  assert.deepEqual(calls.open, ["clip.mp4", "clip.mp4"], "the path is passed as written in the recipe");
  const want = convertClip(Array.from({ length: 6 }, (_, f) => px(24, rows, f)), 24, rows, { ramp: DEFAULT_RAMP, invert: false, color: true, mode: "luma", cellBgBase: [34, 197, 94], normalize: false });
  assert.equal(got.length, 6);
  got.forEach((f, i) => {
    assert.deepEqual(f.cells, want[i]?.cells);
    assert.deepEqual(f.colors, want[i]?.colors);
    assert.equal(f.backgrounds, null);
    assert.equal(f.hold, 1);
  });
});

test("normalising reads the clip twice and matches the whole-clip converter; media is normalised by default, a vector scene is not", async () => {
  const dim = (cols: number, rows: number, f: number): Uint8ClampedArray => {
    const a = new Uint8ClampedArray(cols * rows * 4);
    for (let i = 0; i < cols * rows; i++) {
      const v = 20 + ((i * 7 + f * 3) % 60);
      a.set([v, v, v, 255], i * 4);
    }
    return a;
  };
  const media = fakeSource({ w: 100, h: 100, frames: 4, px: dim });
  const s = scene(recipe({ cols: 10, rows: 5 }));
  const got = await drain(s, media.read);
  assert.equal(media.calls.passes, 2);
  const frames = Array.from({ length: 4 }, (_, f) => dim(10, 5, f));
  const want = convertClip(frames, 10, 5, { ramp: DEFAULT_RAMP, invert: false, color: false, mode: "luma", normalize: true });
  assert.deepEqual(got.map((f) => f.cells), want.map((c) => c.cells));
  const plain = convertClip(frames, 10, 5, { ramp: DEFAULT_RAMP, invert: false, color: false, mode: "luma" });
  assert.notDeepEqual(want.map((c) => c.cells), plain.map((c) => c.cells), "the test clip must be one that normalising changes");

  const vec = fakeSource({ w: 100, h: 100, frames: 4, px: dim, kind: "scene", background: [0, 0, 0] });
  await drain(s, vec.read);
  assert.equal(vec.calls.passes, 1, "a vector scene is not normalised unless asked");
});

test("identical neighbours fold into one frame with a longer hold, and the holds add up to the frame count", async () => {
  const still = (cols: number, rows: number, f: number): Uint8ClampedArray => new Uint8ClampedArray(cols * rows * 4).fill(f < 3 ? 255 : 80);
  const { read } = fakeSource({ w: 100, h: 50, frames: 5, px: still });
  const got = await drain(scene(recipe({ cols: 8, rows: 2, normalize: false })), read);
  assert.deepEqual(got.map((f) => f.hold), [3, 2]);
  const short = fakeSource({ w: 100, h: 50, frames: 5, px: still, short: 2 });
  const s = await collect(scene(recipe({ cols: 8, rows: 2, normalize: false })), short.read);
  assert.deepEqual(s.frames.map((f) => f.hold), [5], "a source that ends early holds its last frame");
  assert.equal(s.rows, 2);
});

test("the same recipe and seed give byte-identical frames", async () => {
  const s = scene(recipe({ cols: 16, chars: "CZ+", shimmer: 0.3, seed: 7, normalize: false }));
  const a = await drain(s, fakeSource({ w: 64, h: 64, frames: 4 }).read);
  const b = await drain(s, fakeSource({ w: 64, h: 64, frames: 4 }).read);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const c = await drain(scene(recipe({ cols: 16, chars: "CZ+", shimmer: 0.3, seed: 8, normalize: false })), fakeSource({ w: 64, h: 64, frames: 4 }).read);
  assert.notEqual(JSON.stringify(a), JSON.stringify(c));
});

test("framesOf is pure: it has no file or process access of its own", () => {
  const text = readFileSync(join(root, "src/ascii/frames.ts"), "utf8") + readFileSync(join(root, "src/ascii/recipe.ts"), "utf8") + readFileSync(join(root, "src/ascii/layers.ts"), "utf8");
  for (const bad of ["node:fs", "node:child_process", "spawn(", "readFileSync", "process."]) assert.ok(!text.includes(bad), `frames.ts, recipe.ts or layers.ts uses ${bad}`);
});

// ------------------------------------------------------------------ renderer choice and limits

test("the renderer is SVG up to 400,000 cells in total and canvas above", async () => {
  assert.equal(SVG_CELL_LIMIT, 400_000);
  assert.equal(rendererFor(400_000), "svg");
  assert.equal(rendererFor(400_001), "canvas");
  // 100 by 50 cells: 80 frames is exactly 400,000, 81 is over.
  for (const [frames, want] of [
    [80, "svg"],
    [81, "canvas"],
  ] as const) {
    const shape = await shapeOf(scene(recipe({ cols: 100, rows: 50 })), fakeSource({ w: 200, h: 200, frames }).read);
    assert.equal(shape.cells, 100 * 50 * frames);
    assert.equal(shape.renderer, want);
  }
  // Inline frames count stored frames, not holds: one frame held 600 times is a small SVG.
  const held = scene({ ascii: 1, frames: [{ text: ["#".repeat(200)], hold: 600 }] });
  assert.equal((await shapeOf(held)).renderer, "svg");
});

test("recipe limits: 400 columns, 200 rows, 3600 frames", async () => {
  assert.equal(MAX_RECIPE_COLS, 400);
  assert.equal(MAX_RECIPE_ROWS, 200);
  assert.equal(MAX_RECIPE_FRAMES, 3600);
  assert.deepEqual(codes(recipe({ cols: 400, rows: 200 })), []);
  assert.ok(codes(recipe({ cols: 401 })).includes("E-ASCII-SOURCE"));
  assert.ok(codes(recipe({ rows: 201 })).includes("E-ASCII-SOURCE"));
  const s = scene(recipe({ cols: 40, rows: 10 }));
  assert.equal((await shapeOf(s, fakeSource({ w: 10, h: 10, frames: 3600 }).read)).intervals, 3600);
  await assert.rejects(shapeOf(s, fakeSource({ w: 10, h: 10, frames: 3601 }).read), (e: unknown) => e instanceof AsciiSourceError && e.diagnostic.code === "E-ASCII-TOOMANY" && /maxSeconds/.test(e.diagnostic.fix ?? ""));
  // Computed rows are capped at the recipe limit.
  assert.equal((await shapeOf(scene(recipe({ cols: 400 })), fakeSource({ w: 10, h: 100, frames: 1 }).read)).rows, 200);
  // A crop outside the source is refused when the source is opened.
  await assert.rejects(shapeOf(scene(recipe({ crop: [0, 0, 20, 20] })), fakeSource({ w: 10, h: 10, frames: 1 }).read), (e: unknown) => e instanceof AsciiSourceError && e.diagnostic.path === "source.crop");
});

// ------------------------------------------------------------------ the command line

const cli = join(root, "src/cli/gertie.ts");
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", cwd: root });
const haveFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("ascii from --recipe writes a small recipe that lints, and frames, play and lint go through it", { skip: !haveFfmpeg && "ffmpeg is not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-recipe-"));
  try {
    const out = join(dir, "badge.ascii.json");
    const r = run("ascii", "from", join(root, "examples/badge.png"), "--cols", "40", "--recipe", "--palette", "#7cb342,#f48fb1", "--glow", "0.4", "--out", out, "--json");
    assert.equal(r.status, 0, r.stderr + r.stdout);
    const raw = JSON.parse(readFileSync(out, "utf8")) as { source: Record<string, unknown>; frames?: unknown; style: Record<string, unknown> };
    assert.equal(raw.frames, undefined);
    assert.deepEqual(Object.keys(raw.source), ["file", "cols", "palette"]);
    assert.match(String(raw.source["file"]), /examples\/badge\.png$/);
    assert.equal(raw.source["cols"], 40);
    assert.deepEqual(raw.source["palette"], ["#7cb342", "#f48fb1"]);
    assert.equal(raw.style["glow"], 0.4);
    assert.ok(statSync(out).size < 2048);
    const lint = run("ascii", "lint", out, "--json");
    assert.equal(lint.status, 0, lint.stdout);
    const full = JSON.parse(lint.stdout) as { scene: { cols: number; rows: number; renderer: string; recipe: boolean } };
    assert.equal(full.scene.recipe, true);
    assert.equal(full.scene.cols, 40);
    assert.equal(full.scene.renderer, "svg");
    // The recipe and the inline conversion give the same frame.
    const inline = join(dir, "inline.ascii.json");
    assert.equal(run("ascii", "from", join(root, "examples/badge.png"), "--cols", "40", "--palette", "#7cb342,#f48fb1", "--glow", "0.4", "--out", inline).status, 0);
    const a = run("ascii", "play", out, "--frame", "0");
    const b = run("ascii", "play", inline, "--frame", "0");
    assert.equal(a.status, 0, a.stderr);
    assert.equal(a.stdout, b.stdout);
    // A missing source is a lint error that names it.
    const bad = join(dir, "bad.ascii.json");
    spawnSync("sh", ["-c", `echo '{"ascii":1,"source":{"file":"nope.mp4"}}' > ${bad}`]);
    const lb = run("ascii", "lint", bad, "--json");
    assert.equal(lb.status, 1);
    assert.match(lb.stdout, /E-ASCII-FILE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an inline animation over the cell limit warns, refuses svg and the text exports, and inline limits are unchanged", { skip: !haveFfmpeg && "ffmpeg is not installed" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-large-"));
  try {
    // 100 by 50 cells, 81 frames: 405,000 cells.
    const frames = Array.from({ length: 81 }, (_, i) => ({ text: Array.from({ length: 50 }, (_, r) => "#".repeat(1 + ((i + r) % 100))) }));
    const raw = { ascii: 1, cols: 100, rows: 50, fps: 10, frames };
    const d = parse(raw).diagnostics.find((x) => x.code === "W-ASCII-LARGE");
    assert.ok(d);
    assert.match(d.message, /405000 cells, more than the 400000/);
    assert.equal((await shapeOf(scene(raw))).renderer, "canvas");
    assert.ok(!codes({ ...raw, frames: frames.slice(0, 80) }).includes("W-ASCII-LARGE"));
    const file = join(dir, "big.ascii.json");
    writeFileSync(file, JSON.stringify(raw));
    for (const to of ["svg", "sh", "js"]) {
      const r = run("ascii", "export", file, "--to", to, "--out", join(dir, "out"), "--json");
      assert.equal(r.status, 1, to);
      assert.match(r.stdout, /E-ASCII-TOOMANY/, to);
    }
    const readme = run("ascii", "export", file, "--for", "readme", "--out", join(dir, "out"));
    assert.equal(readme.status, 1);
    assert.match(readme.stdout + readme.stderr, /use --to instead/);
    // Inline frames keep the phase 8 limits.
    assert.ok(codes({ ascii: 1, cols: 241, frames: [{ text: ["a"] }] }).includes("E-ASCII-SIZE"));
    assert.ok(codes({ ascii: 1, rows: 121, frames: [{ text: ["a"] }] }).includes("E-ASCII-SIZE"));
    assert.ok(codes({ ascii: 1, frames: Array.from({ length: 1201 }, () => ({ text: ["a"] })) }).includes("E-ASCII-TOOMANY"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ascii from writes a recipe by default when cols times rows times frames would exceed 400,000 cells", { skip: !haveFfmpeg && "ffmpeg is not installed" }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-auto-"));
  try {
    const clip = join(dir, "clip.mp4");
    assert.equal(spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=2", "-pix_fmt", "yuv420p", clip]).status, 0);
    // 120 by 34 cells: 20 frames at 10 fps is 81,600 cells, inline; 60 frames at 30 fps is 244,800, still inline; 200 columns at 30 fps is over.
    const small = join(dir, "small.ascii.json");
    assert.equal(run("ascii", "from", clip, "--cols", "120", "--out", small).status, 0);
    assert.ok(Array.isArray((JSON.parse(readFileSync(small, "utf8")) as { frames?: unknown }).frames));
    const big = join(dir, "big.ascii.json");
    const r = run("ascii", "from", clip, "--cols", "200", "--fps", "30", "--out", big);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.match(r.stdout + r.stderr, /written as a recipe because 672000 cells is more than 400000/);
    const raw = JSON.parse(readFileSync(big, "utf8")) as { frames?: unknown; source?: { file: string; cols: number } };
    assert.equal(raw.frames, undefined);
    assert.deepEqual(raw.source, { file: "clip.mp4", cols: 200 });
    assert.ok(statSync(big).size < 2048);
    // More than 240 columns cannot be inline at all.
    const wide = join(dir, "wide.ascii.json");
    const w = run("ascii", "from", clip, "--cols", "300", "--out", wide);
    assert.equal(w.status, 0, w.stderr + w.stdout);
    assert.match(w.stdout + w.stderr, /larger than inline frames allow/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
