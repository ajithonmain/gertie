import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { compileSceneText, compileSceneValue } from "../../src/compile.ts";
import { prefixFor } from "../../src/emit-svg/format.ts";
import { validateSvg } from "../../src/validate/svg.ts";

/* eslint-disable @typescript-eslint/no-explicit-any */
function svgOf(nodes: any[], extra: any = {}): { svg: string; baked: string[] } {
  const raw = { gertie: 1, name: "t", canvas: { w: 200, h: 200 }, fps: 30, duration: 1, nodes, ...extra };
  const r = compileSceneValue(raw);
  assert.deepEqual(r.diagnostics.filter((d) => d.severity === "error"), [], JSON.stringify(r.diagnostics));
  return r.svg as { svg: string; baked: string[] };
}
const rect = (o: any = {}) => ({ id: "a", type: "rect", w: 40, h: 20, fill: "#3b82f6", ...o });
const P = prefixFor("t");

test("a static node with no transform has no wrapper", () => {
  const { svg } = svgOf([rect()]);
  assert.ok(!svg.includes("<g"), svg);
  assert.ok(!svg.includes("<style>"), "no animation, so no style block");
  assert.match(svg, /<rect x="-20" y="-10" width="40" height="20" fill="#3b82f6"\/>/);
});

test("static transform channels merge into one wrapper in translate, rotate, scale, pivot order", () => {
  const { svg } = svgOf([rect({ x: 100, y: 50, rotation: 30, scale: 2, pivot: [5, 7] })]);
  assert.match(svg, /<g transform="translate\(105 57\) rotate\(30\) scale\(2 2\) translate\(-5 -7\)">/);
});

test("an animated channel gets its own wrapper with a class, and a static poster transform", () => {
  const { svg } = svgOf([rect({ x: 100, y: 100, rotation: 10, animate: { rotation: [[0, 10], [1, 90]] } })]);
  assert.match(svg, new RegExp(`<g transform="translate\\(100 100\\)"><g class="${P}-a__r" transform="rotate\\(10\\)">`.replace("><", ">\\s*<")));
  assert.match(svg, new RegExp(`\\.${P}-a__r\\{animation:${P}-a__r 1s linear infinite both;transform-origin:0 0\\}`));
  assert.match(svg, /transform:rotate\(90deg\)/);
});

test("x and y with different timelines get one wrapper per axis", () => {
  const { svg } = svgOf([rect({ animate: { x: [[0, 10], [0.5, 50]], y: [[0, 10], [1, 90]] } })]);
  assert.match(svg, /transform:translateX\(50px\)/);
  assert.match(svg, /transform:translateY\(90px\)/);
  assert.ok(svg.includes(`${P}-a__tx`) && svg.includes(`${P}-a__ty`));
});

test("x and y on the same timeline share one translate wrapper", () => {
  const { svg } = svgOf([rect({ animate: { x: [[0, 10], [1, 50]], y: [[0, 10], [1, 90]] } })]);
  assert.match(svg, /transform:translate\(50px,90px\)/);
  assert.ok(!svg.includes("__tx"));
});

test("easing is written on the CSS keyframe where the segment starts, taken from the scene key where it ends", () => {
  const { svg } = svgOf([rect({ animate: { opacity: [[0, 0], [0.5, 1, "easeOut"], [1, 0, "easeIn"]] } })]);
  const block = /@keyframes [^{]+__o\{([^@]*?)\}\n/.exec(svg)?.[1] as string;
  // key 0 starts the segment that arrives at 0.5 with easeOut; key 0.5 starts the segment that arrives at 1 with easeIn
  assert.match(block, /^0%\{opacity:0;animation-timing-function:cubic-bezier\(0\.33,1,0\.68,1\)\}/);
  assert.match(block, /50%\{opacity:1;animation-timing-function:cubic-bezier\(0\.32,0,0\.67,0\)\}/);
  assert.match(block, /100%\{opacity:0\}$/);
});

test("overshoot easing is written as it is in CSS", () => {
  const { svg } = svgOf([rect({ animate: { scale: [[0, 0], [1, 1, "easeOutBack"]] } })]);
  assert.match(svg, /cubic-bezier\(0\.34,1\.56,0\.64,1\)/);
});

test("a hold segment becomes step-end, and the step is written just before the frame so the frame shows the new value", () => {
  const { svg } = svgOf([rect({ animate: { opacity: [[0, 1], [0.5, 0, "hold"], [1, 1] ] } })]);
  assert.match(svg, /0%\{opacity:1;animation-timing-function:step-end\}/);
  assert.match(svg, /49\.999%\{opacity:0;/);
});

test("trim end becomes dash values on a path of length one", () => {
  const { svg } = svgOf([{ id: "l", type: "line", x1: 0, y1: 0, x2: 100, y2: 0, stroke: { color: "#fff", width: 4, cap: "butt" }, animate: { "trim.end": [[0, 0], [1, 1]] } }]);
  assert.match(svg, /pathLength="1"/);
  assert.match(svg, /stroke-dasharray:0 1;stroke-dashoffset:0/);
  assert.match(svg, /stroke-dasharray:1 1;stroke-dashoffset:0/);
});

test("trim on a closed shape repeats the dash once per path length, so an offset wraps around", () => {
  const { svg } = svgOf([{ id: "c", type: "ellipse", r: 40, x: 100, y: 100, stroke: { color: "#fff", width: 4, cap: "butt" }, trim: { start: 0, end: 0.25 }, animate: { "trim.offset": [[0, 0], [1, 1]] } }]);
  assert.match(svg, /stroke-dasharray:0\.25 0\.75;stroke-dashoffset:0/);
  assert.match(svg, /stroke-dasharray:0\.25 0\.75;stroke-dashoffset:-1/);
});

test("a zero-length trim with round caps hides the stroke so no dot is drawn", () => {
  const { svg } = svgOf([{ id: "l", type: "line", x1: 0, y1: 0, x2: 100, y2: 0, stroke: { color: "#fff", width: 8, cap: "round" }, animate: { "trim.end": [[0, 0], [1, 1]] } }]);
  assert.match(svg, /stroke-opacity="0"/);
  assert.match(svg, /__guard\{0%\{stroke-opacity:0;/);
});

test("trim start and end on different timelines are baked, and reported", () => {
  const { svg, baked } = svgOf([{ id: "l", type: "line", x1: 0, y1: 0, x2: 100, y2: 0, stroke: { color: "#fff", width: 4 }, animate: { "trim.start": [[0, 0], [0.5, 0.5]], "trim.end": [[0, 0.2], [1, 1]] } }]);
  assert.deepEqual(baked, ["l.trim"]);
  assert.equal((svg.match(/stroke-dasharray:/g) ?? []).length > 30, true, "one keyframe per frame");
});

test("a morph becomes SMIL with one key spline per segment", () => {
  const { svg, baked } = svgOf([{ id: "m", type: "path", d: "M0 0 L10 0 L10 10 Z", fill: "#fff", animate: { d: [[0, "M0 0 L10 0 L10 10 Z"], [0.5, "M0 0 L20 0 L20 20 Z", "easeInOut"], [1, "M0 0 L10 0 L10 10 Z", "easeInOut"]] } }]);
  assert.deepEqual(baked, []);
  assert.match(svg, /<animate attributeName="d" dur="1s" repeatCount="indefinite" calcMode="spline" values="[^"]+;[^"]+;[^"]+" keyTimes="0;0\.5;1" keySplines="0\.65 0 0\.35 1;0\.65 0 0\.35 1"\/>/);
});

test("a morph with an overshoot easing is baked, because key splines cannot leave 0 to 1", () => {
  const { svg, baked } = svgOf([{ id: "m", type: "path", d: "M0 0 L10 0 L10 10 Z", fill: "#fff", animate: { d: [[0, "M0 0 L10 0 L10 10 Z"], [1, "M0 0 L20 0 L20 20 Z", "easeOutBack"]] } }]);
  assert.deepEqual(baked, ["m.d"]);
  assert.ok(!svg.includes("keySplines"));
  assert.equal(((/values="([^"]+)"/.exec(svg)?.[1] as string).match(/M/g) ?? []).length, 31, "frames 0 to 30");
});

test("a morph mixing hold and bezier segments is baked", () => {
  const { baked } = svgOf([{ id: "m", type: "path", d: "M0 0 L10 0 L10 10 Z", fill: "#fff", animate: { d: [[0, "M0 0 L10 0 L10 10 Z"], [0.5, "M0 0 L20 0 L20 20 Z", "hold"], [1, "M0 0 L10 0 L10 10 Z"]] } }]);
  assert.deepEqual(baked, ["m.d"]);
});

test("a rect width animation uses SMIL on x and width so the rectangle stays centred", () => {
  const { svg } = svgOf([rect({ animate: { w: [[0, 40], [1, 80]] } })]);
  assert.match(svg, /<animate attributeName="x"[^>]*values="-20;-40"/);
  assert.match(svg, /<animate attributeName="width"[^>]*values="40;80"/);
});

test("a time window becomes a step opacity wrapper, with a poster that respects the window", () => {
  const { svg } = svgOf([rect({ from: 0.5 })]);
  assert.match(svg, /<g class="[^"]+__v" opacity="0">/);
  assert.match(svg, /0%\{opacity:0;animation-timing-function:step-end\}49\.999%\{opacity:1;animation-timing-function:step-end\}100%\{opacity:1\}/);
});

test("the poster option sets the static value of every animated property", () => {
  const nodes = [rect({ animate: { opacity: [[0, 0], [1, 1, "linear"]] } })];
  const at0 = svgOf(nodes).svg;
  const atEnd = svgOf(nodes, { poster: 0.5 }).svg;
  assert.match(at0, /opacity="0"/);
  assert.match(atEnd, /opacity="0\.5"/);
});

test("reduced motion switches CSS animation off", () => {
  const { svg } = svgOf([rect({ animate: { opacity: [[0, 0], [1, 1]] } })]);
  assert.match(svg, /@media \(prefers-reduced-motion:reduce\)\{\*\{animation:none!important\}\}/);
});

test("a non-looping scene runs once and holds its last state", () => {
  const { svg } = svgOf([rect({ animate: { opacity: [[0, 0], [1, 1]] } })], { loop: false });
  assert.match(svg, /animation:[^;]*linear 1 both/);
});

test("identical keyframes are written once and shared", () => {
  const anim = { animate: { opacity: [[0, 0], [1, 1]] } };
  const { svg } = svgOf([rect({ id: "a", ...anim }), rect({ id: "b", ...anim })]);
  assert.equal((svg.match(/@keyframes/g) ?? []).length, 1);
  assert.equal((svg.match(/animation:/g) ?? []).length, 3, "two rules plus the reduced motion rule");
});

test("an animated definition is written once per instance, a static one stays a shared use", () => {
  const animated = svgOf([{ id: "i1", type: "use", ref: "d", x: 10 }, { id: "i2", type: "use", ref: "d", x: 50 }], {
    defs: { d: { id: "d", type: "rect", w: 10, h: 10, fill: "#fff", animate: { opacity: [[0, 0], [1, 1]] } } },
  }).svg;
  assert.ok(!animated.includes("<use"), "Chromium does not animate content behind a use");
  assert.ok(animated.includes(`${P}-i1_d__sh`) && animated.includes(`${P}-i2_d__sh`));
  const still = svgOf([{ id: "i1", type: "use", ref: "d", x: 10 }, { id: "i2", type: "use", ref: "d", x: 50 }], { defs: { d: { id: "d", type: "rect", w: 10, h: 10, fill: "#fff" } } }).svg;
  assert.equal((still.match(/<use /g) ?? []).length, 2);
  assert.equal((still.match(/<g id="/g) ?? []).length, 1);
});

test("a clip becomes a clipPath in defs applied to the innermost wrapper", () => {
  const { svg } = svgOf([rect({ x: 50, clip: { type: "rect", w: 10, h: 10 } })]);
  assert.match(svg, /<clipPath id="[^"]+__clip"><path d="M-5 -5/);
  assert.match(svg, /<g clip-path="url\(#[^)]+__clip\)">/);
});

test("gradients use user space units so their coordinates are in the node's own space", () => {
  const { svg } = svgOf([rect({ fill: { type: "linear", from: [0, 0], to: [10, 0], stops: [[0, "#000"], [1, "#fff"]] } })]);
  assert.match(svg, /<linearGradient id="[^"]+" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="10" y2="0">/);
});

test("ids and classes carry a prefix from the scene name, and two scenes share none", () => {
  const a = svgOf([rect({ animate: { opacity: [[0, 0], [1, 1]] } })], { name: "first-scene" }).svg;
  const b = svgOf([rect({ animate: { opacity: [[0, 0], [1, 1]] } })], { name: "second-scene" }).svg;
  const names = (s: string): Set<string> => new Set([...s.matchAll(/(?:class|id)="([^"]+)"|@keyframes ([^{]+)\{/g)].map((m) => (m[1] ?? m[2]) as string));
  const shared = [...names(a)].filter((n) => names(b).has(n));
  assert.deepEqual(shared, []);
});

test("the SVG validator rejects scripts, event handlers, imports and external references", () => {
  assert.equal(validateSvg('<svg xmlns="x"><rect/></svg>').length, 0);
  assert.equal(validateSvg('<svg xmlns="x"><image href="data:image/png;base64,AA=="/><use href="#a"/></svg>').length, 0);
  assert.equal(validateSvg('<svg xmlns="x"><script>1</script></svg>')[0]?.code, "E-S-SCRIPT");
  assert.equal(validateSvg('<svg xmlns="x"><rect onclick="x()"/></svg>')[0]?.code, "E-S-SCRIPT");
  assert.equal(validateSvg('<svg xmlns="x"><style>@import "a.css";</style></svg>')[0]?.code, "E-S-EXTERNAL");
  assert.equal(validateSvg('<svg xmlns="x"><image href="https://x.test/a.png"/></svg>')[0]?.code, "E-S-EXTERNAL");
  assert.equal(validateSvg('<svg xmlns="x"><rect fill="url(https://x.test/a)"/></svg>')[0]?.code, "E-S-EXTERNAL");
});

test("no corpus output contains a script or an external reference", () => {
  const dir = join(import.meta.dirname, "../../examples");
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".gertie.json"))) {
    const r = compileSceneText(readFileSync(join(dir, f), "utf8"), { fileExists: (s) => existsSync(join(dir, s)) });
    const svg = (r.svg as { svg: string }).svg;
    assert.deepEqual(validateSvg(svg), [], f);
    assert.ok(!/<script|@import|https?:/i.test(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")), f);
  }
});

test("output is deterministic", () => {
  const nodes = [rect({ animate: { x: [[0, 0], [1, 100]], opacity: [[0, 0], [1, 1]] } })];
  assert.equal(svgOf(nodes).svg, svgOf(nodes).svg);
});
