import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateSync } from "node:zlib";
import { encodePng } from "../../src/cutout/png.ts";
import { inpaint, morph, padEdges, polygonCoverage } from "../../src/cutout/raster.ts";
import { buildCutout, validateSpec } from "../../src/cutout/build.ts";
import { resolveIncludes } from "../../src/import/include.ts";
import { compileSceneValue } from "../../src/compile.ts";
import type { Raster } from "../../src/trace/quantize.ts";

type Any = any; // nodes are explored loosely

function img(w: number, h: number, f: (x: number, y: number) => [number, number, number]): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...f(x, y), 255], (y * w + x) * 4);
  return { w, h, data };
}
const sum = (a: Float32Array): number => a.reduce((s, v) => s + v, 0);
const square = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];

// ---------------------------------------------------------------- PNG

test("the PNG encoder writes a file that decodes to the same pixels", () => {
  const src = img(5, 3, (x, y) => [x * 40, y * 80, 200]);
  src.data[3] = 128;
  const png = encodePng(src);
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(png.readUInt32BE(16), 5);
  assert.equal(png.readUInt32BE(20), 3);
  // Read the IDAT back by hand: strip the filter byte of each row.
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    if (png.toString("ascii", off + 4, off + 8) === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  for (let y = 0; y < 3; y++) {
    assert.equal(raw[y * 21], 0);
    assert.deepEqual([...raw.subarray(y * 21 + 1, y * 21 + 21)], [...src.data.subarray(y * 20, y * 20 + 20)]);
  }
});

// ---------------------------------------------------------------- polygons and masks

test("polygon coverage has the right area and an anti-aliased edge", () => {
  const sq = polygonCoverage(square(2, 2, 12, 8), 16, 16);
  assert.ok(Math.abs(sum(sq) - 60) < 0.01);
  const half = polygonCoverage(square(2.5, 2, 12, 8), 16, 16);
  assert.ok(Math.abs((half[2 * 16 + 2] as number) - 0.5) < 0.01, "a pixel half covered is half covered");
  const tri = polygonCoverage([[0, 0], [10, 0], [0, 10]], 12, 12);
  assert.ok(Math.abs(sum(tri) - 50) < 0.6);
  assert.equal(sum(polygonCoverage([[1, 1], [5, 5]], 8, 8)), 0);
});

test("grow and shrink move the edge by about the radius", () => {
  const m = polygonCoverage(square(10, 10, 20, 20), 30, 30);
  const grown = morph(m, 30, 30, 2);
  const shrunk = morph(m, 30, 30, -2);
  assert.ok(sum(grown) > sum(m) + 40 && sum(grown) < sum(m) + 120, `${sum(grown)}`);
  assert.ok(sum(shrunk) < sum(m) - 30 && sum(shrunk) > sum(m) - 80, `${sum(shrunk)}`);
  assert.equal(grown[15 * 30 + 9], 1, "a pixel out is now inside");
  assert.ok((shrunk[15 * 30 + 10] as number) < 1, "the edge pixel is no longer fully inside");
  assert.equal(morph(m, 30, 30, 0), m);
});

// ---------------------------------------------------------------- fill

test("inpaint fills a hole smoothly from its surroundings and leaves the rest alone", () => {
  const src = img(40, 40, (x) => [x * 5, 100, 50]);
  const known = new Uint8Array(1600).fill(1);
  for (let y = 15; y < 25; y++) for (let x = 15; x < 25; x++) known[y * 40 + x] = 0;
  const before = src.data[(20 * 40 + 20) * 4 + 3];
  src.data.fill(0, (20 * 40 + 20) * 4, (20 * 40 + 20) * 4 + 3);
  const out = inpaint(src, known);
  assert.equal(before, 255);
  const mid = out.data[(20 * 40 + 20) * 4] as number;
  assert.ok(mid > 60 && mid < 140, `the middle of the hole takes a value between its sides: ${mid}`);
  for (let i = 0; i < 1600; i++) if (known[i]) assert.deepEqual([...out.data.subarray(i * 4, i * 4 + 4)], [...src.data.subarray(i * 4, i * 4 + 4)]);
  for (let i = 0; i < 1600; i++) if (!known[i]) assert.equal(out.data[i * 4 + 3], 255);
});

test("inpaint with a domain fills only that area, and pixels outside it are neither used nor changed", () => {
  const src = img(30, 10, () => [10, 10, 10]);
  for (let y = 0; y < 10; y++) for (let x = 20; x < 30; x++) src.data.set([250, 250, 250, 255], (y * 30 + x) * 4);
  const known = new Uint8Array(300);
  const domain = new Uint8Array(300);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 30; x++) {
    if (x < 10) known[y * 30 + x] = 1;
    else if (x < 15) domain[y * 30 + x] = 1;
  }
  const out = inpaint(src, known, domain);
  assert.ok((out.data[(5 * 30 + 12) * 4] as number) < 40, "filled from the known side, not from the bright pixels beyond the domain");
  assert.deepEqual([...out.data.subarray((5 * 30 + 25) * 4, (5 * 30 + 25) * 4 + 4)], [250, 250, 250, 255]);
});

test("padding mirrors the picture across its edge, even when the pad is larger than the picture", () => {
  const p = padEdges(img(2, 2, (x, y) => [x * 100, y * 100, 0]), 3);
  assert.deepEqual([p.w, p.h], [8, 8]);
  const at = (x: number, y: number) => [...p.data.subarray((y * 8 + x) * 4, (y * 8 + x) * 4 + 3)];
  assert.deepEqual(at(3, 3), [0, 0, 0], "the picture itself is unchanged");
  assert.deepEqual(at(2, 3), [0, 0, 0], "the first column mirrored");
  assert.deepEqual(at(1, 3), [100, 0, 0], "then the second");
  assert.deepEqual(at(0, 3), [100, 0, 0], "then back again");
  assert.equal(padEdges(img(2, 2, () => [1, 2, 3]), 0).w, 2);
});

// ---------------------------------------------------------------- the parts file

test("validateSpec names each problem", () => {
  const ok = { parts: [{ id: "head", polygon: square(10, 10, 40, 40) }] };
  assert.deepEqual(validateSpec(ok, 100, 100), []);
  const bad = (s: unknown): string => validateSpec(s, 100, 100).join(" | ");
  assert.match(bad(null), /must be an object/);
  assert.match(bad({}), /'parts' must be a list/);
  assert.match(bad({ parts: [{ id: "Head", polygon: square(1, 1, 30, 30) }] }), /'id' must be lowercase/);
  assert.match(bad({ parts: [{ id: "a", polygon: square(1, 1, 30, 30) }, { id: "a", polygon: square(1, 1, 30, 30) }] }), /used twice/);
  assert.match(bad({ parts: [{ id: "background", polygon: square(1, 1, 30, 30) }] }), /'background'/);
  assert.match(bad({ parts: [{ id: "a", polygon: [[0, 0], [5, 5]] }] }), /at least 3/);
  assert.match(bad({ parts: [{ id: "a", polygon: square(1, 1, 3, 3) }] }), /less than 16 square pixels/);
  assert.match(bad({ parts: [{ id: "a", polygon: square(1, 1, 300, 300) }] }), /pixels outside the 100 by 100 image/);
  assert.deepEqual(validateSpec({ bleed: 20, parts: [{ id: "a", polygon: square(-25, 10, 40, 60) }] }, 100, 100), [], "a part may reach past the edge by the bleed plus 8");
  assert.match(bad({ parts: [{ id: "a", polygon: square(-25, 10, 40, 60) }] }), /pixels outside/);
  assert.match(bad({ parts: [{ id: "a", polygon: square(1, 1, 30, 30), pivot: 4 }] }), /'pivot'/);
  assert.match(bad({ parts: [{ id: "a", polygon: square(1, 1, 30, 30), colour: 1 }] }), /unknown field 'colour'/);
  assert.match(bad({ ...ok, bleed: -1 }), /'bleed'/);
  assert.match(bad({ ...ok, extra: 1 }), /unknown field 'extra'/);
  assert.match(bad({ ...ok, lids: [{ id: "lid", ellipse: [1, 2, 0, 4], sample: [1, 1] }] }), /positive radii/);
  assert.match(bad({ ...ok, lids: [{ id: "lid", ellipse: [1, 2, 3, 4], sample: [1, 1], flat: "yes" }] }), /'flat'/);
  assert.match(bad({ ...ok, lids: [{ id: "lid", ellipse: [1, 2, 3, 4], sample: [1, 1], tint: 1 }] }), /unknown field 'tint'/);
  assert.match(bad({ ...ok, lids: [{ id: "head", ellipse: [5, 5, 3, 3], sample: [1, 1] }] }), /used twice/);
});

// ---------------------------------------------------------------- building layers

/** Sky on the left half, ground on the right, with a red head and a blue hat on it, so every layer has something to check. */
const scene = (): Raster =>
  img(100, 80, (x, y) => {
    if (x >= 30 && x < 70 && y >= 20 && y < 60) return y < 35 ? [20, 40, 220] : [220, 30, 30];
    return x < 50 ? [30, 160, 230] : [60, 200, 90];
  });

test("buildCutout makes a background, one layer per part and the fragment nodes, back to front", () => {
  const r = buildCutout(scene(), { bleed: 10, parts: [{ id: "head", polygon: square(30, 20, 70, 60), pivot: [50, 60] }, { id: "hat", polygon: square(30, 20, 70, 35) }] }, "scene.png");
  assert.deepEqual(r.files.map((f) => f.path), ["background.png", "parts/head.png", "parts/hat.png"]);
  assert.deepEqual(r.fragment.nodes.map((n) => n["id"]), ["background", "head", "hat"]);
  assert.deepEqual(r.fragment.canvas, { w: 100, h: 80 });
  const [bg, head, hat] = r.fragment.nodes as Any[];
  assert.deepEqual([bg.x, bg.y, bg.w, bg.h], [-10, -10, 120, 100]);
  // The edge is softened over a pixel, so the layer is cropped one pixel wider than the outline on each side.
  assert.deepEqual([head.x, head.y, head.w, head.h], [29, 19, 42, 42]);
  assert.deepEqual(head.pivot, [21, 41], "a pivot is in the part's own coordinates");
  assert.equal(hat.pivot, undefined);
  assert.equal(head.type, "image");
});

test("the background has no trace of the parts, and every part is opaque inside its outline", () => {
  const r = buildCutout(scene(), { parts: [{ id: "head", polygon: square(30, 20, 70, 60) }] }, "scene.png");
  const decode = (png: Buffer): Raster => {
    let off = 8;
    const idat: Buffer[] = [];
    while (off < png.length) {
      const len = png.readUInt32BE(off);
      if (png.toString("ascii", off + 4, off + 8) === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
      off += 12 + len;
    }
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    const raw = inflateSync(Buffer.concat(idat));
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) data.set(raw.subarray(y * (w * 4 + 1) + 1, (y + 1) * (w * 4 + 1)), y * w * 4);
    return { w, h, data };
  };
  const bg = decode(r.files[0]!.png);
  const at = (i: Raster, x: number, y: number) => [...i.data.subarray((y * i.w + x) * 4, (y * i.w + x) * 4 + 4)];
  // The hole is filled from the sky and ground beside it: blue-green, nothing like the red head.
  const hole = at(bg, 50, 40);
  assert.ok(hole[0]! < 120 && hole[3] === 255, `hole colour ${hole}`);
  assert.deepEqual(at(bg, 5, 5), [30, 160, 230, 255]);
  const head = decode(r.files[1]!.png);
  assert.deepEqual(at(head, 20, 30), [220, 30, 30, 255]);
  assert.equal(at(head, 20, 20)[3], 255);
});

test("a part behind another is filled where the one in front covers it, so it can move without showing a copy", () => {
  const r = buildCutout(scene(), { grow: 0, parts: [{ id: "head", polygon: square(30, 20, 70, 60) }, { id: "hat", polygon: square(30, 20, 70, 35) }] }, "scene.png");
  const png = r.files[1]!.png;
  // The head layer under the hat should be red-ish (continued from the face), not the hat's blue.
  let off = 8;
  const idat: Buffer[] = [];
  while (off < png.length) {
    const len = png.readUInt32BE(off);
    if (png.toString("ascii", off + 4, off + 8) === "IDAT") idat.push(png.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const w = png.readUInt32BE(16);
  const px = (x: number, y: number) => [...raw.subarray(y * (w * 4 + 1) + 1 + x * 4, y * (w * 4 + 1) + 1 + x * 4 + 4)];
  const under = px(20, 5);
  assert.ok(under[0]! > 150 && under[2]! < 90, `behind the hat the head is red, got ${under}`);
});

test("a lid is a patch of the picture's own skin with a soft elliptical edge, pivoting at its top; a flat lid is one colour", () => {
  const r = buildCutout(scene(), { parts: [{ id: "far", polygon: square(300, 300, 340, 340) }], lids: [{ id: "lid", ellipse: [20, 40, 8, 5], sample: [80, 40] }, { id: "flat-lid", ellipse: [50, 40, 8, 5], sample: [50, 50], flat: true }] }, "scene.png");
  const lid = r.fragment.nodes.find((n) => n["id"] === "lid") as Any;
  assert.deepEqual([lid.type, lid.src, lid.w, lid.h, lid.x, lid.y], ["image", "lids/lid.png", 20, 14, 10, 33]);
  assert.deepEqual(lid.pivot, [10, 0]);
  assert.ok(r.files.some((f) => f.path === "lids/lid.png"));
  const flat = r.fragment.nodes.find((n) => n["id"] === "flat-lid") as Any;
  assert.deepEqual([flat.type, flat.x, flat.y, flat.rx, flat.ry, flat.fill], ["ellipse", 50, 40, 8, 5, "#dc1e1e"]);
  assert.deepEqual(flat.pivot, [0, -5]);
  assert.ok(r.notes.some((n) => /covers no pixels/.test(n)));
  assert.ok(!r.fragment.nodes.some((n) => n["id"] === "far"));
});

test("a part whose outline runs past the edge gets mirrored pixels there, and bleed mirrors the picture instead of smearing it", () => {
  const striped = img(40, 20, (x) => (x % 2 === 0 ? [200, 0, 0] : [0, 0, 200]));
  const r = buildCutout(striped, { bleed: 6, parts: [{ id: "edge", polygon: [[-4, 2], [20, 2], [20, 18], [-4, 18]] }] }, "s.png");
  const edge = r.fragment.nodes[1] as Any;
  assert.ok(edge.x <= -3, `the part starts past the edge: ${edge.x}`);
  const bg = r.fragment.nodes[0] as Any;
  assert.deepEqual([bg.x, bg.w], [-6, 52]);
  const pad = padEdges(striped, 3);
  const at = (x: number) => [...pad.data.subarray((5 * pad.w + x) * 4, (5 * pad.w + x) * 4 + 3)];
  assert.deepEqual(at(2), [200, 0, 0], "the picture's first column, mirrored");
  assert.deepEqual(at(1), [0, 0, 200], "then its second: the stripes continue, they are not one smeared pixel");
});

test("inset and grow change the part and the hole it leaves", () => {
  const spec = (extra: object) => buildCutout(scene(), { parts: [{ id: "head", polygon: square(30, 20, 70, 60) }], ...extra }, "s.png");
  const a = (spec({ inset: 0 }).fragment.nodes[1] as Any).w;
  const b = (spec({ inset: 3 }).fragment.nodes[1] as Any).w;
  assert.ok(b < a);
});

// ---------------------------------------------------------------- includes bring their images along

test("images in an included fragment are found relative to the scene, not the fragment", () => {
  const frag = { "gertie-fragment": 1, source: "p.png", canvas: { w: 10, h: 10 }, nodes: [{ id: "bg", type: "image", src: "background.png", w: 10, h: 10 }, { id: "head", type: "image", src: "parts/head.png", w: 4, h: 4 }] };
  const sc = { gertie: 1, name: "t", canvas: { w: 10, h: 10 }, duration: 1, nodes: [{ id: "art", type: "group", include: "art/painting.cutout/fragment.json" }] };
  const r = resolveIncludes(sc, () => frag);
  assert.deepEqual(r.diagnostics, []);
  const kids = (r.scene as Any).nodes[0].children as Any[];
  assert.deepEqual(kids.map((k) => k.src), ["art/painting.cutout/background.png", "art/painting.cutout/parts/head.png"]);
  const same = resolveIncludes({ ...sc, nodes: [{ ...sc.nodes[0], include: "frag.json" }] }, () => frag);
  assert.equal(((same.scene as Any).nodes[0].children as Any[])[0].src, "background.png");
  const images = { "art/painting.cutout/background.png": "data:image/png;base64,AAAA", "art/painting.cutout/parts/head.png": "data:image/png;base64,AAAA" };
  const c = compileSceneValue(sc, { loadFragment: () => frag, fileExists: (s) => s.startsWith("art/painting.cutout/"), images });
  assert.deepEqual(c.diagnostics.filter((d) => d.severity === "error"), []);
});

test("the lid-blink preset hides the lid at rest and closes it over the eye for a moment", () => {
  const sc = { gertie: 1, name: "t", canvas: { w: 100, h: 100 }, duration: 2, loop: true, nodes: [{ id: "lid", type: "ellipse", rx: 10, ry: 6, x: 50, y: 50, fill: "#d9a58a", pivot: [0, -6], motion: [{ preset: "lid-blink", at: 0.5 }, { preset: "lid-blink", at: 1.4 }] }] };
  const c = compileSceneValue(sc);
  assert.deepEqual(c.diagnostics, []);
  const keys = (c.scene as Any).nodes[0].tracks.scale as { t: number; v: number[] }[];
  assert.deepEqual(keys[0]!.v, [1, 0], "hidden before the first blink");
  assert.ok(keys.some((k) => k.v[1] === 1), "fully closed at the middle of a blink");
  assert.deepEqual(keys[keys.length - 1]!.v, [1, 0], "hidden again after the last");
});
