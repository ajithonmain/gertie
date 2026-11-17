import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseXml, XmlError } from "../../src/import/xml.ts";
import { apply, IDENTITY, multiply, parseTransform } from "../../src/import/matrix.ts";
import { parseColor, parseLength, withAlpha } from "../../src/import/style.ts";
import { ImportError, importSvg } from "../../src/import/svg.ts";
import { summarize } from "../../src/import/summary.ts";
import { resolveIncludes } from "../../src/import/include.ts";
import { compileSceneValue } from "../../src/compile.ts";
import { parsePath } from "../../src/spec/path.ts";

type Any = any; // fragments and scenes are built inline; the compiler validates them

const svg = (body: string, attrs = 'viewBox="0 0 100 100"'): string => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attrs}>${body}</svg>`;
const imp = (body: string, attrs?: string) => importSvg(svg(body, attrs), "t.svg");
const nodes = (body: string, attrs?: string): Any[] => imp(body, attrs).fragment.nodes;

// ---------------------------------------------------------------- xml

test("xml: elements, attributes, text, comments, CDATA, entities and a DOCTYPE", () => {
  const root = parseXml(`<?xml version="1.0"?><!DOCTYPE svg PUBLIC "x" "y" [<!ENTITY a "b">]><!-- c --><svg a="1" b='two &amp; three'><style><![CDATA[.a{fill:red}]]></style><g id="x"><p:q xlink:href="#y"/></g>&#65;</svg>`);
  assert.equal(root.name, "svg");
  assert.deepEqual(root.attrs, { a: "1", b: "two & three" });
  assert.equal(root.children[0]!.text, ".a{fill:red}");
  assert.equal(root.children[1]!.children[0]!.attrs["xlink:href"], "#y");
  assert.equal(root.text, "A");
});

test("xml: errors name the problem", () => {
  for (const [bad, msg] of [["<svg><g></svg>", /does not match/], ["<svg a=1/>", /not quoted/], ["<svg>", /not closed/], ["", /no root/]] as const) {
    assert.throws(() => parseXml(bad), (e: unknown) => e instanceof XmlError && msg.test(e.message), bad);
  }
});

// ---------------------------------------------------------------- matrix and colour

test("transforms: each function, a list, and a bad one", () => {
  const close = (a: number[], b: number[]) => a.forEach((v, i) => assert.ok(Math.abs(v - b[i]!) < 1e-9, `${a} vs ${b}`));
  close([...parseTransform("translate(10 20)")!], [1, 0, 0, 1, 10, 20]);
  close([...parseTransform("scale(2)")!], [2, 0, 0, 2, 0, 0]);
  close([...apply(parseTransform("rotate(90)")!, 1, 0)], [0, 1]);
  close([...apply(parseTransform("rotate(90 10 10)")!, 20, 10)], [10, 20]);
  close([...apply(parseTransform("translate(5,0) scale(2)")!, 1, 1)], [7, 2]);
  close([...apply(parseTransform("skewX(45)")!, 0, 1)], [1, 1]);
  close([...parseTransform("matrix(1 2 3 4 5 6)")!], [1, 2, 3, 4, 5, 6]);
  assert.equal(parseTransform("wobble(3)"), undefined);
  assert.equal(parseTransform("translate(a)"), undefined);
  assert.deepEqual(parseTransform(""), IDENTITY);
  assert.deepEqual([...multiply([2, 0, 0, 2, 0, 0], [1, 0, 0, 1, 3, 0])], [2, 0, 0, 2, 6, 0]);
});

test("colours: hex forms, rgb, hsl, names and alpha", () => {
  assert.equal(parseColor("#abc"), "#aabbcc");
  assert.equal(parseColor("#AABBCC"), "#aabbcc");
  assert.equal(parseColor("#aabbcc80"), "#aabbcc80");
  assert.equal(parseColor("rgb(255, 0, 0)"), "#ff0000");
  assert.equal(parseColor("rgba(0,0,255,0.5)"), "#0000ff80");
  assert.equal(parseColor("hsl(120, 100%, 50%)"), "#00ff00");
  assert.equal(parseColor("Black"), "#000000");
  assert.equal(parseColor("nonsense"), undefined);
  assert.equal(withAlpha("#ff0000", 0.5), "#ff000080");
  assert.equal(withAlpha("#ff000080", 0.5), "#ff000040");
  assert.equal(parseLength("12px"), 12);
  assert.equal(parseLength("50%", 200), 100);
  assert.equal(parseLength("abc"), undefined);
});

// ---------------------------------------------------------------- importer

test("canvas comes from the viewBox, and its origin is moved to 0,0", () => {
  const r = imp('<rect x="10" y="10" width="20" height="20" fill="#f00"/>', 'viewBox="10 10 200 100"');
  assert.deepEqual(r.fragment.canvas, { w: 200, h: 100 });
  const n = r.fragment.nodes[0] as Any;
  assert.deepEqual([n.x, n.y, n.w, n.h], [10, 10, 20, 20]);
});

test("with no viewBox the width and height are used", () => {
  assert.deepEqual(imp('<rect width="5" height="5"/>', 'width="64" height="48"').fragment.canvas, { w: 64, h: 48 });
  assert.throws(() => imp('<rect width="5" height="5"/>', ""), ImportError);
});

test("an SVG with nothing drawable, or that is not an svg, is an ImportError", () => {
  assert.throws(() => imp(""), ImportError);
  assert.throws(() => importSvg("<html/>", "t.svg"), ImportError);
  assert.throws(() => importSvg("<svg", "t.svg"), ImportError);
});

test("rect and ellipse stay rect and ellipse when only translated or scaled; otherwise they become paths", () => {
  const n = nodes('<g transform="translate(10 20) scale(2)"><rect x="5" y="5" width="10" height="6" rx="1" fill="#f00"/><circle cx="10" cy="10" r="3" fill="#0f0"/><ellipse cx="1" cy="1" rx="4" ry="2" fill="#00f"/></g><rect width="10" height="10" fill="#f00" transform="rotate(30)"/>');
  const g = n[0];
  assert.deepEqual([g.children[0].type, g.children[0].w, g.children[0].h, g.children[0].radius, g.children[0].x, g.children[0].y], ["rect", 20, 12, 2, 30, 36]);
  assert.deepEqual([g.children[1].type, g.children[1].r, g.children[1].x, g.children[1].y], ["ellipse", 6, 30, 40]);
  assert.deepEqual([g.children[2].type, g.children[2].rx, g.children[2].ry], ["ellipse", 8, 4]);
  assert.equal(n[1].type, "path");
});

test("transforms are flattened into path coordinates", () => {
  const n = nodes('<g transform="translate(10 0)"><path d="M0 0 L10 0 L10 10 Z" transform="scale(2)" fill="#000"/></g>');
  const sp = parsePath(n[0].children[0].d);
  assert.deepEqual(sp[0]!.v, [[10, 0], [30, 0], [30, 20]]);
  assert.equal(sp[0]!.closed, true);
  assert.equal(n[0].transform, undefined);
});

test("curves keep their handles through a rotation", () => {
  const n = nodes('<path d="M0 0 C 10 0 10 10 0 10" transform="rotate(90)" fill="none" stroke="#000"/>');
  const sp = parsePath(n[0].d)[0]!;
  assert.ok(Math.abs(sp.v[1]![0] - -10) < 1e-2 && Math.abs(sp.v[1]![1] - 0) < 1e-2);
  assert.ok(Math.abs(sp.o[0]![0]) < 1e-2 && Math.abs(sp.o[0]![1] - 10) < 1e-2, JSON.stringify(sp.o[0]));
});

test("styles: attributes, classes, ids, the style attribute and inheritance, in cascade order", () => {
  const n = nodes('<style>.a{fill:#00f;stroke:#111}#x{fill:#0f0}path{stroke-width:3}</style><g fill="#f00" stroke-linecap="round"><path id="x" class="a" d="M0 0L9 9" /><path class="a" d="M0 0L9 9" style="fill:#abcdef"/><path d="M0 0L9 9" stroke="#222"/></g>');
  const [a, b, c] = n[0].children;
  assert.equal(a.fill, "#00ff00");
  assert.equal(b.fill, "#abcdef");
  assert.equal(b.stroke.color, "#111111");
  assert.equal(b.stroke.width, 3);
  assert.equal(b.stroke.cap, "round");
  assert.equal(c.fill, "#ff0000");
});

test("fill defaults to black, none is none, a shape with neither is dropped, and the root can set a default", () => {
  const n = nodes('<path d="M0 0L9 0L9 9Z"/><path d="M0 0L9 0L9 9Z" fill="none"/><path d="M0 0L9 0" fill="none" stroke="#f00"/>');
  assert.equal(n.length, 2);
  assert.equal(n[0].fill, "#000000");
  assert.equal(n[1].stroke.color, "#ff0000");
  assert.equal(n[1].fill, undefined);
  assert.equal(nodes('<path d="M0 0L9 0L9 9Z"/>', 'viewBox="0 0 10 10" fill="#0000ff"')[0].fill, "#0000ff");
  assert.throws(() => nodes('<path d="M0 0L9 0L9 9Z"/>', 'viewBox="0 0 10 10" fill="none"'), ImportError);
});

test("fill-opacity, stroke-opacity and rgba become colour alpha; opacity stays a node property", () => {
  const n = nodes('<path d="M0 0L9 0L9 9Z" fill="#ff0000" fill-opacity="0.5" stroke="rgba(0,0,255,0.5)" stroke-opacity="0.5" opacity="0.4"/>');
  assert.equal(n[0].fill, "#ff000080");
  assert.equal(n[0].stroke.color, "#0000ff40");
  assert.equal(n[0].opacity, 0.4);
});

test("stroke width and dashes scale with the transform; caps and joins are explicit", () => {
  const n = nodes('<path d="M0 0L9 9" transform="scale(2)" stroke="#000" stroke-width="3" stroke-dasharray="4 2" fill="none"/>');
  assert.equal(n[0].stroke.width, 6);
  assert.deepEqual(n[0].stroke.dash, [8, 4]);
  assert.equal(n[0].stroke.cap, "butt");
  assert.equal(n[0].stroke.join, "miter");
});

test("display none, visibility hidden and empty groups are skipped", () => {
  const n = nodes('<g display="none"><rect width="9" height="9"/></g><rect width="9" height="9" visibility="hidden"/><g><g/></g><rect id="keep" width="9" height="9"/>');
  assert.deepEqual(n.map((x: Any) => x.id), ["keep"]);
});

test("ids: own id, Inkscape label, sanitised, unique, generated when missing", () => {
  const n = nodes('<g id="Layer_1"><rect id="Arm Left" width="9" height="9"/><rect id="arm-left" width="9" height="9"/><rect inkscape:label="Head 2" width="9" height="9" xmlns:inkscape="x"/><rect width="9" height="9"/><rect id="9lives" width="9" height="9"/></g>');
  assert.deepEqual(n[0].children.map((x: Any) => x.id), ["arm-left", "arm-left-2", "head-2", "rect-1", "n-9lives"]);
  assert.equal(n[0].id, "layer-1");
});

test("an Illustrator escaped id is decoded", () => {
  assert.equal(nodes('<rect id="_x31_st_x5F_part" width="9" height="9"/>')[0].id, "n-1st-part");
});

test("polygon, polyline and line become paths; a line has no fill", () => {
  const n = nodes('<polygon points="0,0 10,0 10,10" fill="#f00"/><polyline points="0,0 5,5 9,0" fill="none" stroke="#000"/><line x1="0" y1="0" x2="9" y2="9" stroke="#000"/>');
  assert.equal(parsePath(n[0].d)[0]!.closed, true);
  assert.equal(parsePath(n[1].d)[0]!.closed, false);
  assert.equal(n[2].fill, undefined);
});

test("arcs and relative commands in a path are converted", () => {
  const n = nodes('<path d="M10 50 a40 40 0 0 1 80 0" fill="none" stroke="#000"/>');
  const sp = parsePath(n[0].d)[0]!;
  assert.ok(sp.v.length >= 2);
  assert.ok(Math.abs(sp.v[sp.v.length - 1]![0] - 90) < 1e-2);
});

test("use copies the referenced shape with its offset, and gets a unique id each time", () => {
  const n = nodes('<defs><circle id="d" r="4" fill="#f00"/></defs><use xlink:href="#d" x="10" y="20"/><use xlink:href="#d" x="30" y="20" id="second"/>');
  assert.equal(n.length, 2);
  assert.deepEqual([n[0].type, n[0].x, n[0].y, n[0].r], ["ellipse", 10, 20, 4]);
  assert.equal(n[1].id, "second");
  assert.notEqual(n[0].id, n[1].id);
});

test("a use of something that does not exist is reported, not fatal", () => {
  const r = imp('<use xlink:href="#nope"/><rect width="9" height="9"/>');
  assert.equal(r.fragment.nodes.length, 1);
  assert.ok(r.unsupported.some((u) => u.element === "use" && /nope/.test(u.note)));
});

test("linear gradients: user space, bounding box, href inheritance, stop opacity and gradientTransform", () => {
  const n = nodes(`<defs>
    <linearGradient id="a" x1="0" y1="0" x2="100" y2="0" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f00"/><stop offset="100%" stop-color="#00f" stop-opacity="0.5"/></linearGradient>
    <linearGradient id="b" xlink:href="#a" x1="0" x2="1" y2="1" gradientUnits="objectBoundingBox"/>
  </defs>
  <path d="M10 10 H60 V30 H10 Z" fill="url(#a)"/>
  <path d="M10 10 H60 V30 H10 Z" fill="url(#b)"/>`);
  assert.deepEqual(n[0].fill, { type: "linear", from: [0, 0], to: [100, 0], stops: [[0, "#ff0000"], [1, "#0000ff80"]] });
  assert.deepEqual([n[1].fill.from, n[1].fill.to], [[10, 10], [60, 30]]);
});

test("a gradient on a translated rect is given in the rect's own coordinates", () => {
  const n = nodes('<defs><linearGradient id="a" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient></defs><rect x="20" y="20" width="40" height="20" fill="url(#a)"/>');
  assert.deepEqual([n[0].x, n[0].y], [40, 30]);
  assert.deepEqual([n[0].fill.from, n[0].fill.to], [[-20, -10], [20, -10]]);
});

test("radial gradients: centre and radius follow the transform, and a stretched one is reported", () => {
  const ok = imp('<defs><radialGradient id="r" cx="50" cy="50" r="20" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><path transform="scale(2)" d="M0 0H50V50H0Z" fill="url(#r)"/>');
  const f = (ok.fragment.nodes[0] as Any).fill;
  assert.deepEqual([f.type, f.center, f.radius], ["radial", [100, 100], 40]);
  assert.equal(ok.unsupported.length, 0);
  const stretched = imp('<defs><radialGradient id="r"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient></defs><path d="M0 0H80V20H0Z" fill="url(#r)"/>');
  assert.ok(stretched.unsupported.some((u) => /radial gradient stretched/.test(u.note)));
});

test("a gradient with one stop is a solid colour, and a missing gradient falls back", () => {
  const n = nodes('<defs><linearGradient id="a"><stop offset="0" stop-color="#123456"/></linearGradient></defs><path d="M0 0H9V9Z" fill="url(#a)"/><path d="M0 0H9V9Z" fill="url(#missing) #abcdef"/>');
  assert.equal(n[0].fill, "#123456");
  assert.equal(n[1].fill, "#abcdef");
});

test("clip-path becomes a clip on the element, in canvas coordinates", () => {
  const n = nodes('<defs><clipPath id="c"><rect x="10" y="10" width="30" height="30"/></clipPath></defs><g clip-path="url(#c)" transform="translate(5 5)"><rect width="90" height="90" fill="#f00"/></g>');
  assert.equal(n[0].type, "group");
  const clip = parsePath(n[0].clip.d)[0]!;
  assert.deepEqual(clip.v[0], [15, 15]);
});

test("a mask of white shapes becomes a clip, any other mask is removed and reported", () => {
  const white = imp('<defs><path id="s" d="M0 0H20V20H0Z"/><mask id="m" fill="#fff"><use xlink:href="#s"/></mask></defs><rect width="90" height="90" fill="#f00" mask="url(#m)"/>');
  assert.ok((white.fragment.nodes[0] as Any).clip);
  assert.equal(white.unsupported.length, 0);
  const grey = imp('<defs><mask id="m"><rect width="20" height="20" fill="#888"/></mask></defs><rect width="90" height="90" fill="#f00" mask="url(#m)"/>');
  assert.equal((grey.fragment.nodes[0] as Any).clip, undefined);
  assert.ok(grey.unsupported.some((u) => u.element === "mask"));
});

test("unsupported content is reported with what was lost", () => {
  const r = imp('<defs><filter id="f"/></defs><text x="1" y="9">hi</text><image href="x.png"/><rect width="9" height="9" filter="url(#f)" style="mix-blend-mode:multiply"/>');
  const els = r.unsupported.map((u) => u.element).sort();
  assert.deepEqual(els, ["filter", "image", "mix-blend-mode", "text"]);
  assert.equal(r.fragment.nodes.length, 1);
});

test("every import compiles as a scene with no errors", () => {
  const dirs = [join(import.meta.dirname, "../../examples/import/third-party"), join(import.meta.dirname, "../fixtures/import")];
  for (const d of dirs) {
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d).filter((x) => x.endsWith(".svg"))) {
      const r = importSvg(readFileSync(join(d, f), "utf8"), f);
      const c = compileSceneValue({ gertie: 1, name: "t", canvas: r.fragment.canvas, duration: 1, loop: false, nodes: r.fragment.nodes });
      assert.deepEqual(c.diagnostics.filter((x) => x.severity === "error"), [], f);
    }
  }
});

test("the same input always gives the same output", () => {
  const f = join(import.meta.dirname, "../fixtures/import/figma-style.svg");
  const t = readFileSync(f, "utf8");
  assert.equal(JSON.stringify(importSvg(t, "a.svg").fragment), JSON.stringify(importSvg(t, "a.svg").fragment));
});

// ---------------------------------------------------------------- summary

test("summary lists groups first, flags a flat file and an unlayered one", () => {
  const flat = summarize(imp(Array.from({ length: 50 }, (_, i) => `<rect x="${i}" y="0" width="5" height="5" fill="#f00"/>`).join("")));
  assert.ok(flat.advice.some((a) => /no groups/.test(a)));
  assert.equal(flat.truncated?.total, 50 > 80 ? 50 : undefined);
  const mixed = summarize(imp(Array.from({ length: 50 }, (_, i) => `<rect x="${i}" y="0" width="5" height="5" fill="#f00"/>`).join("") + '<g id="arm"><rect width="5" height="5"/></g>'));
  assert.ok(mixed.advice.some((a) => /loose/.test(a)));
  const one = summarize(imp('<path d="M0 0H9V9Z" fill="#f00"/>'));
  assert.ok(one.advice.some((a) => /one shape/.test(a)));
  const layered = summarize(imp('<g id="a"><g id="b"><g id="c"><rect width="5" height="5"/></g></g></g>'));
  assert.ok(layered.advice.some((a) => /layered/.test(a)));
  assert.deepEqual(layered.nodes.map((n) => [n.id, n.depth]), [["a", 0], ["b", 1], ["c", 2], ["rect-1", 3]]);
});

test("summary bounding boxes are in canvas pixels", () => {
  const s = summarize(imp('<g id="g" transform="translate(10 20)"><rect id="r" width="30" height="40" fill="#f00"/></g>'));
  assert.deepEqual(s.nodes.find((n) => n.id === "g")!.bbox, [10, 20, 30, 40]);
});

test("a long list is cut to the groups and the largest shapes, and says so", () => {
  const body = '<g id="part"><rect width="2" height="2"/></g>' + Array.from({ length: 120 }, (_, i) => `<rect id="s${i}" x="0" y="0" width="${i + 1}" height="${i + 1}" fill="#f00"/>`).join("");
  const s = summarize(imp(body));
  assert.equal(s.nodes.length, 80);
  assert.ok(s.truncated && s.truncated.total === 122);
  assert.ok(s.nodes.some((n) => n.id === "part"));
  assert.ok(s.nodes.some((n) => n.id === "s119"));
  assert.ok(!s.nodes.some((n) => n.id === "s0"));
});

// ---------------------------------------------------------------- include and overrides

const fragment = (): Any => ({
  "gertie-fragment": 1,
  source: "robot.svg",
  canvas: { w: 200, h: 200 },
  nodes: [
    { id: "body", type: "rect", w: 60, h: 80, x: 100, y: 120, fill: "#888888" },
    { id: "arm", type: "group", children: [{ id: "hand", type: "ellipse", r: 10, x: 140, y: 100, fill: "#ffcc00" }] },
  ],
});
const sceneWith = (extra: Any): Any => ({ gertie: 1, name: "t", canvas: { w: 200, h: 200 }, duration: 2, loop: true, nodes: [{ id: "character", type: "group", include: "robot.fragment.json", ...extra }] });
const load = (p: string): unknown => {
  if (p === "robot.fragment.json") return fragment();
  if (p === "bad.json") return { nope: true };
  throw new Error(`file not found: ${p}`);
};

test("include puts the fragment's nodes inside the group, and the file is not copied into the scene", () => {
  const r = resolveIncludes(sceneWith({}), load);
  assert.deepEqual(r.diagnostics, []);
  const g = (r.scene as Any).nodes[0];
  assert.equal(g.include, undefined);
  assert.deepEqual(g.children.map((c: Any) => c.id), ["body", "arm"]);
});

test("overrides merge into a node by id at any depth: animate per property, motion appended, other fields replaced", () => {
  const scene = sceneWith({ overrides: { arm: { pivot: [120, 100], animate: { rotation: [[0, -10], [1, 20, "easeInOut"], [2, -10, "easeInOut"]] } }, hand: { fill: "#ff0000", motion: [{ preset: "pulse" }] } } });
  const r = resolveIncludes(scene, load);
  assert.deepEqual(r.diagnostics, []);
  const [, arm] = (r.scene as Any).nodes[0].children;
  assert.deepEqual(arm.pivot, [120, 100]);
  assert.ok(arm.animate.rotation);
  assert.equal(arm.children[0].fill, "#ff0000");
  assert.equal(arm.children[0].motion[0].preset, "pulse");
});

test("an included, overridden scene compiles to Lottie and SVG", () => {
  const scene = sceneWith({ overrides: { arm: { pivot: [120, 100], animate: { rotation: [[0, -10], [1, 20, "easeInOut"], [2, -10, "easeInOut"]] } } } });
  const c = compileSceneValue(scene, { loadFragment: load });
  assert.deepEqual(c.diagnostics, []);
  assert.ok(c.lottie && c.svg);
});

test("a preset in an override is expanded like any other", () => {
  const scene = sceneWith({ overrides: { hand: { motion: [{ preset: "wiggle", duration: 1, repeat: "loop" }] } } });
  assert.deepEqual(compileSceneValue(scene, { loadFragment: load }).diagnostics, []);
});

test("E-INCLUDE-OVERRIDE names the ids that exist and suggests the nearest", () => {
  const r = resolveIncludes(sceneWith({ overrides: { arn: { opacity: 0.5 } } }), load);
  assert.deepEqual(r.diagnostics.map((d) => d.code), ["E-INCLUDE-OVERRIDE"]);
  assert.match(r.diagnostics[0]!.message, /arm/);
  assert.ok(r.diagnostics[0]!.fix);
});

test("an override cannot change id, type or children", () => {
  const r = resolveIncludes(sceneWith({ overrides: { arm: { id: "x", children: [] } } }), load);
  assert.deepEqual(r.diagnostics.map((d) => d.code), ["E-INCLUDE-OVERRIDE", "E-INCLUDE-OVERRIDE"]);
});

test("E-INCLUDE-LOAD for a missing file, a file that is not a fragment, and no loader", () => {
  const missing = resolveIncludes({ ...sceneWith({}), nodes: [{ id: "g", type: "group", include: "nope.json" }] }, load);
  assert.deepEqual(missing.diagnostics.map((d) => d.code), ["E-INCLUDE-LOAD"]);
  assert.match(missing.diagnostics[0]!.message, /not found/);
  const wrong = resolveIncludes({ ...sceneWith({}), nodes: [{ id: "g", type: "group", include: "bad.json" }] }, load);
  assert.match(wrong.diagnostics[0]!.message, /not a Gertie fragment/);
  const none = resolveIncludes(sceneWith({}), undefined);
  assert.deepEqual(none.diagnostics.map((d) => d.code), ["E-INCLUDE-LOAD"]);
});

test("include on a non-group, and include together with children, are errors", () => {
  const rect = resolveIncludes({ ...sceneWith({}), nodes: [{ id: "g", type: "rect", w: 1, h: 1, include: "robot.fragment.json" }] }, load);
  assert.ok(rect.diagnostics.some((d) => d.code === "E-FIELD-TYPE"));
  const both = resolveIncludes(sceneWith({ children: [{ id: "x", type: "rect", w: 1, h: 1, fill: "#fff" }] }), load);
  assert.ok(both.diagnostics.some((d) => d.code === "E-FIELD-TYPE"));
});

test("a failed include is not also reported as a static scene", () => {
  const c = compileSceneValue(sceneWith({}), {});
  assert.ok(!c.diagnostics.some((d) => d.code === "W-STATIC"));
});

test("the included group can be moved and animated like any group", () => {
  const scene = sceneWith({ x: 20, animate: { opacity: [[0, 0], [1, 1]] } });
  const c = compileSceneValue(scene, { loadFragment: load });
  assert.deepEqual(c.diagnostics.map((d) => d.code), ["W-LOOP-JUMP"]);
});

test("a scene without include is returned untouched", () => {
  const s = { gertie: 1, nodes: [] };
  assert.equal(resolveIncludes(s, undefined).scene, s);
});
