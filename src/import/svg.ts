import { ellipseSubpath, parsePath, PathSyntaxError, rectSubpaths, samplePath, type Subpath, type Vec2 } from "../spec/path.ts";
import { apply, applyLinear, IDENTITY, isAxisAligned, meanScale, multiply, parseTransform, type Matrix } from "./matrix.ts";
import { declaredProps, inheritProps, parseColor, parseLength, readStyleSheet, withAlpha, type Props, type StyleSheet } from "./style.ts";
import { parseXml, XmlError, type XmlElement } from "./xml.ts";

type Obj = Record<string, unknown>;
type Box = [number, number, number, number];

/** A fragment of scene nodes made from an SVG. Included in a scene with `include`. */
export interface Fragment {
  "gertie-fragment": 1;
  source: string;
  canvas: { w: number; h: number };
  nodes: Obj[];
}

export interface Unsupported {
  element: string;
  id?: string;
  note: string;
  /** How many times it occurred. */
  count: number;
}

export interface ImportResult {
  fragment: Fragment;
  unsupported: Unsupported[];
  /** Bounding box [x, y, w, h] in canvas pixels of every node, by id. Strokes are not included. */
  boxes: Record<string, [number, number, number, number]>;
  stats: { shapes: number; groups: number; gradients: number; clips: number; dropped: number };
}

export class ImportError extends Error {}

const SHAPES = new Set(["path", "rect", "circle", "ellipse", "line", "polyline", "polygon"]);
const SKIP = new Set(["defs", "symbol", "clipPath", "mask", "linearGradient", "radialGradient", "style", "title", "desc", "metadata", "pattern", "marker", "filter", "namedview", "sodipodi:namedview", "script"]);
const TEXTY = new Set(["text", "tspan", "textPath"]);

const num = (v: number): number => Math.round(v * 1000) / 1000;

/** The ratio of the longest to the shortest stretch of a matrix. 1 means it scales evenly in every direction. */
function anisotropy(m: Matrix): number {
  const a = m[0] * m[0] + m[1] * m[1];
  const b = m[0] * m[2] + m[1] * m[3];
  const c = m[2] * m[2] + m[3] * m[3];
  const mid = (a + c) / 2;
  const diff = Math.sqrt(((a - c) / 2) ** 2 + b * b);
  const lo = mid - diff;
  return lo <= 1e-12 ? Infinity : Math.sqrt((mid + diff) / lo);
}
const unionBox = (a: Box | undefined, b: Box | undefined): Box | undefined => (a === undefined ? b : b === undefined ? a : [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);

function transformSubpaths(sp: readonly Subpath[], m: Matrix): Subpath[] {
  return sp.map((s) => ({
    closed: s.closed,
    v: s.v.map(([x, y]) => apply(m, x, y)),
    i: s.i.map(([x, y]) => applyLinear(m, x, y)),
    o: s.o.map(([x, y]) => applyLinear(m, x, y)),
  }));
}

/** Serializes subpaths as an SVG path string made of M, L, C and Z. */
export function subpathsToD(sp: readonly Subpath[]): string {
  const out: string[] = [];
  const pt = (p: Vec2): string => `${num(p[0])} ${num(p[1])}`;
  for (const s of sp) {
    if (s.v.length === 0) continue;
    out.push(`M${pt(s.v[0] as Vec2)}`);
    const count = s.closed ? s.v.length : s.v.length - 1;
    for (let k = 0; k < count; k++) {
      const a = s.v[k] as Vec2;
      const nxt = (k + 1) % s.v.length;
      const b = s.v[nxt] as Vec2;
      const o = s.o[k] as Vec2;
      const i = s.i[nxt] as Vec2;
      if (o[0] === 0 && o[1] === 0 && i[0] === 0 && i[1] === 0) out.push(`L${pt(b)}`);
      else out.push(`C${pt([a[0] + o[0], a[1] + o[1]])} ${pt([b[0] + i[0], b[1] + i[1]])} ${pt(b)}`);
    }
    if (s.closed) out.push("Z");
  }
  return out.join("");
}

function boxOf(sp: readonly Subpath[]): Box | undefined {
  let box: Box | undefined;
  for (const s of sp) for (const [x, y] of samplePath(s, 12)) box = unionBox(box, [x, y, x, y]);
  return box;
}

const polyPath = (pts: Vec2[], closed: boolean): Subpath => ({ closed, v: pts, i: pts.map(() => [0, 0] as Vec2), o: pts.map(() => [0, 0] as Vec2) });

interface Ctx {
  /** Set while drawing the target of a `use`: ids come from the `use` element. The first node takes the id exactly, later ones get a suffix. */
  useId?: string;
  usedFirst?: boolean;
  depth: number;
}

interface Item {
  node: Obj;
  box: Box | undefined;
}

class Importer {
  readonly unsupported = new Map<string, Unsupported>();
  readonly boxes: Record<string, [number, number, number, number]> = {};
  readonly stats = { shapes: 0, groups: 0, gradients: 0, clips: 0, dropped: 0 };
  private readonly byId = new Map<string, XmlElement>();
  private readonly sheet: StyleSheet;
  private readonly usedIds = new Set<string>();
  private counter = 0;

  constructor(private readonly root: XmlElement) {
    const index = (el: XmlElement): void => {
      const id = el.attrs["id"];
      if (id !== undefined && !this.byId.has(id)) this.byId.set(id, el);
      el.children.forEach(index);
    };
    index(root);
    this.sheet = readStyleSheet(root);
    for (const s of this.sheet.skipped) this.note("style", undefined, `CSS selector '${s}' is not supported (only tag, class and id selectors) and was ignored`);
  }

  note(element: string, id: string | undefined, note: string): void {
    const key = `${element}|${id ?? ""}|${note}`;
    const hit = this.unsupported.get(key);
    if (hit) hit.count++;
    else this.unsupported.set(key, id === undefined ? { element, note, count: 1 } : { element, id, note, count: 1 });
  }

  // ------------------------------------------------------------------ ids

  private sanitize(raw: string): string {
    let s = raw.replace(/_x([0-9A-Fa-f]+)_/g, (_m, h: string) => String.fromCodePoint(parseInt(h, 16)));
    s = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (s === "") return "";
    return /^[a-z]/.test(s) ? s : `n-${s}`;
  }

  private idFor(el: XmlElement, kind: string, ctx: Ctx): string {
    const preferred = ctx.useId === undefined ? [el.attrs["id"], el.attrs["inkscape:label"], el.attrs["data-name"]] : [];
    let base = "";
    for (const p of preferred) {
      if (p === undefined) continue;
      base = this.sanitize(p);
      if (base !== "") break;
    }
    if (ctx.useId !== undefined) {
      base = ctx.usedFirst ? `${ctx.useId}-${++this.counter}` : ctx.useId;
      ctx.usedFirst = true;
    } else if (base === "") base = `${kind}-${++this.counter}`;
    let id = base;
    let k = 2;
    while (this.usedIds.has(id)) id = `${base}-${k++}`;
    this.usedIds.add(id);
    return id;
  }

  // ------------------------------------------------------------------ entry

  run(source: string): ImportResult {
    const rootEl = this.root;
    if (rootEl.name !== "svg") throw new ImportError(`The root element is <${rootEl.name}>, not <svg>.`);
    const vb = (rootEl.attrs["viewBox"] ?? "").trim().split(/[\s,]+/).map(Number);
    let minX = 0;
    let minY = 0;
    let w: number;
    let h: number;
    if (vb.length === 4 && vb.every((v) => Number.isFinite(v)) && (vb[2] as number) > 0 && (vb[3] as number) > 0) {
      [minX, minY, w, h] = vb as [number, number, number, number];
    } else {
      const aw = parseLength(rootEl.attrs["width"]);
      const ah = parseLength(rootEl.attrs["height"]);
      if (aw === undefined || ah === undefined || aw <= 0 || ah <= 0) throw new ImportError("The <svg> element has no usable viewBox and no width and height.");
      w = aw;
      h = ah;
    }
    const m: Matrix = [1, 0, 0, 1, -minX, -minY];
    const canvas = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
    if (canvas.w > 4096 || canvas.h > 4096) this.note("svg", undefined, `The canvas is ${canvas.w} by ${canvas.h}; scenes are limited to 4096 pixels on a side, so scale the SVG down before importing`);

    const own = declaredProps(rootEl, this.sheet);
    const items = this.children(rootEl, m, inheritProps({}, own), { depth: 0 });
    if (items.length === 0) throw new ImportError("The SVG has nothing to draw: no shapes were found that could be converted.");
    return {
      fragment: { "gertie-fragment": 1, source, canvas, nodes: items.map((i) => i.node) },
      unsupported: [...this.unsupported.values()],
      boxes: this.boxes,
      stats: this.stats,
    };
  }

  // ------------------------------------------------------------------ elements

  private children(el: XmlElement, m: Matrix, props: Props, ctx: Ctx): Item[] {
    const out: Item[] = [];
    for (const c of el.children) out.push(...this.element(c, m, props, ctx));
    return out;
  }

  private record(node: Obj, box: Box | undefined): void {
    if (box !== undefined) this.boxes[node["id"] as string] = [num(box[0]), num(box[1]), num(box[2] - box[0]), num(box[3] - box[1])];
  }

  private element(el: XmlElement, parentM: Matrix, parentProps: Props, ctx: Ctx): Item[] {
    const name = el.name.replace(/^svg:/, "");
    if (SKIP.has(name)) return [];
    if (TEXTY.has(name)) {
      this.note(name, el.attrs["id"], "Text is not imported. Convert text to outlines in the design tool first");
      return [];
    }
    if (name === "image" || name === "foreignObject" || name === "switch") {
      this.note(name, el.attrs["id"], `<${name}> is not imported`);
      return [];
    }
    const isGroup = name === "g" || name === "a" || name === "svg";
    if (!isGroup && !SHAPES.has(name) && name !== "use") {
      if (!name.includes(":")) this.note(name, el.attrs["id"], `<${name}> is not a supported element and was skipped`);
      return [];
    }

    const own = declaredProps(el, this.sheet);
    if (own["display"] === "none") return [];
    const props = inheritProps(parentProps, own);
    if (props["visibility"] === "hidden" || props["visibility"] === "collapse") return [];

    let own_m = parseTransform(el.attrs["transform"] ?? own["transform"]);
    if (own_m === undefined) {
      this.note(name, el.attrs["id"], `The transform '${el.attrs["transform"]}' could not be read and was ignored`);
      own_m = IDENTITY;
    }
    const m = multiply(parentM, own_m);

    if (own["filter"] !== undefined && own["filter"] !== "none") this.note("filter", el.attrs["id"], "Filters (such as drop shadows and blurs) are removed");
    if (own["mix-blend-mode"] !== undefined && own["mix-blend-mode"] !== "normal") this.note("mix-blend-mode", el.attrs["id"], `Blend mode '${own["mix-blend-mode"]}' is ignored`);

    const opacity = own["opacity"] === undefined ? 1 : Math.min(1, Math.max(0, parseFloat(own["opacity"])));
    const clip = this.clipOf(own, el, m);

    if (name === "use") return this.use(el, m, props, ctx, opacity, clip);
    if (isGroup) return this.group(el, name, m, props, ctx, opacity, clip);
    const item = this.shape(el, name, m, props, ctx, opacity, clip);
    return item ? [item] : [];
  }

  private group(el: XmlElement, name: string, m: Matrix, props: Props, ctx: Ctx, opacity: number, clip: Subpath[] | undefined): Item[] {
    if (name === "svg" && el !== this.root) this.note("svg", el.attrs["id"], "A nested <svg> is treated as a group; its own viewBox is ignored");
    const id = this.idFor(el, "group", ctx);
    const kids = this.children(el, m, props, ctx);
    if (kids.length === 0) {
      this.usedIds.delete(id);
      this.stats.dropped++;
      return [];
    }
    const node: Obj = { id, type: "group" };
    if (opacity < 1) node["opacity"] = num(opacity);
    if (clip) node["clip"] = { type: "path", d: subpathsToD(clip) };
    node["children"] = kids.map((k) => k.node);
    let box: Box | undefined;
    for (const k of kids) box = unionBox(box, k.box);
    this.record(node, box);
    this.stats.groups++;
    return [{ node, box }];
  }

  private use(el: XmlElement, m: Matrix, props: Props, ctx: Ctx, opacity: number, clip: Subpath[] | undefined): Item[] {
    const ref = (el.attrs["xlink:href"] ?? el.attrs["href"] ?? "").replace(/^#/, "");
    const target = this.byId.get(ref);
    if (!target || ctx.depth > 8) {
      this.note("use", el.attrs["id"], target ? "Nested <use> elements are too deep" : `<use> refers to '${ref}', which does not exist`);
      return [];
    }
    const x = parseLength(el.attrs["x"]) ?? 0;
    const y = parseLength(el.attrs["y"]) ?? 0;
    const im = multiply(m, [1, 0, 0, 1, x, y]);
    const own = this.sanitize(el.attrs["id"] ?? "");
    const inner: Ctx = { useId: own !== "" ? own : `use-${++this.counter}`, depth: ctx.depth + 1 };
    // A symbol's content is drawn like a group. Other elements are drawn as themselves.
    const kids = target.name === "symbol" ? this.children(target, im, props, inner) : this.element(target, im, props, inner);
    if (kids.length === 0) return [];
    if (opacity >= 1 && !clip) return kids;
    const gid = this.idFor(el, "use", { depth: ctx.depth });
    const node: Obj = { id: gid, type: "group" };
    if (opacity < 1) node["opacity"] = num(opacity);
    if (clip) node["clip"] = { type: "path", d: subpathsToD(clip) };
    node["children"] = kids.map((k) => k.node);
    let box: Box | undefined;
    for (const k of kids) box = unionBox(box, k.box);
    this.record(node, box);
    this.stats.groups++;
    return [{ node, box }];
  }

  // ------------------------------------------------------------------ shapes

  /** The geometry of a shape element in its own user space, or undefined when it has none. */
  private geometry(el: XmlElement, name: string): { kind: "rect" | "ellipse" | "path"; sp: Subpath[]; rect?: { x: number; y: number; w: number; h: number; r: number }; ell?: { cx: number; cy: number; rx: number; ry: number } } | undefined {
    const a = el.attrs;
    const L = (k: string, d = 0): number => parseLength(a[k]) ?? d;
    switch (name) {
      case "path": {
        try {
          const sp = parsePath(a["d"] ?? "");
          return sp.length === 0 ? undefined : { kind: "path", sp };
        } catch (e) {
          if (e instanceof PathSyntaxError) {
            this.note("path", a["id"], `The path data could not be read (${e.message}) and the path was skipped`);
            return undefined;
          }
          throw e;
        }
      }
      case "rect": {
        const w = L("width");
        const h = L("height");
        if (w <= 0 || h <= 0) return undefined;
        const x = L("x");
        const y = L("y");
        let rx = parseLength(a["rx"]);
        let ry = parseLength(a["ry"]);
        if (rx === undefined && ry === undefined) rx = ry = 0;
        else if (rx === undefined) rx = ry as number;
        else if (ry === undefined) ry = rx;
        const r = Math.max(0, Math.min(rx as number, (ry as number), w / 2, h / 2));
        if (Math.abs((rx as number) - (ry as number)) > 1e-6 && Math.min(rx as number, ry as number) > 0) this.note("rect", a["id"], "A rectangle with different rx and ry is imported with the smaller radius");
        return { kind: "rect", sp: rectSubpaths(x + w / 2, y + h / 2, w, h, r), rect: { x, y, w, h, r } };
      }
      case "circle":
      case "ellipse": {
        const rx = name === "circle" ? L("r") : parseLength(a["rx"]) ?? parseLength(a["ry"]) ?? 0;
        const ry = name === "circle" ? L("r") : parseLength(a["ry"]) ?? parseLength(a["rx"]) ?? 0;
        if (rx <= 0 || ry <= 0) return undefined;
        const cx = L("cx");
        const cy = L("cy");
        return { kind: "ellipse", sp: [ellipseSubpath(cx, cy, rx, ry)], ell: { cx, cy, rx, ry } };
      }
      case "line":
        return { kind: "path", sp: [polyPath([[L("x1"), L("y1")], [L("x2"), L("y2")]], false)] };
      default: {
        const pts = (a["points"] ?? "").trim().split(/[\s,]+/).filter((t) => t !== "").map(Number);
        if (pts.length < 4 || pts.some((v) => !Number.isFinite(v))) return undefined;
        const v: Vec2[] = [];
        for (let k = 0; k + 1 < pts.length; k += 2) v.push([pts[k] as number, pts[k + 1] as number]);
        return { kind: "path", sp: [polyPath(v, name === "polygon")] };
      }
    }
  }

  private shape(el: XmlElement, name: string, m: Matrix, props: Props, ctx: Ctx, opacity: number, clip: Subpath[] | undefined): Item | undefined {
    const g = this.geometry(el, name);
    if (!g) return undefined;
    const userBox = boxOf(g.sp) ?? [0, 0, 0, 0];

    const fillOpacity = props["fill-opacity"] === undefined ? 1 : Math.min(1, Math.max(0, parseFloat(props["fill-opacity"])));
    const strokeOpacity = props["stroke-opacity"] === undefined ? 1 : Math.min(1, Math.max(0, parseFloat(props["stroke-opacity"])));
    // A line has no area, so a default black fill would add nothing.
    const openShape = name === "line";

    // Axis-aligned rectangles and ellipses stay rect and ellipse nodes; everything else becomes a path in canvas coordinates.
    let type: "rect" | "ellipse" | "path" = "path";
    let origin: Vec2 = [0, 0];
    if (g.kind === "rect" && g.rect && isAxisAligned(m) && Math.abs(m[0] - m[3]) < 1e-9) type = "rect";
    else if (g.kind === "ellipse" && g.ell && isAxisAligned(m)) type = "ellipse";
    if (type === "rect" && g.rect) origin = apply(m, g.rect.x + g.rect.w / 2, g.rect.y + g.rect.h / 2);
    if (type === "ellipse" && g.ell) origin = apply(m, g.ell.cx, g.ell.cy);

    const fill = openShape ? null : this.paint(props["fill"] ?? "#000000", props, fillOpacity, m, userBox, origin, "fill", el);
    const strokeRaw = props["stroke"] ?? "none";
    const strokeWidth = (parseLength(props["stroke-width"]) ?? 1) * meanScale(m);
    let stroke: Obj | undefined;
    if (strokeRaw !== "none" && strokeWidth > 0) {
      const paint = this.paint(strokeRaw, props, strokeOpacity, m, userBox, origin, "stroke", el);
      let color: string | undefined;
      if (typeof paint === "string") color = paint;
      else if (paint && typeof paint === "object") {
        const stops = (paint as { stops: [number, string][] }).stops;
        color = (stops[Math.floor(stops.length / 2)] as [number, string])[1];
        this.note("gradient", el.attrs["id"], "A gradient stroke is imported as a solid colour (the middle stop)");
      }
      if (color) {
        stroke = { color, width: num(strokeWidth), cap: props["stroke-linecap"] === "round" ? "round" : props["stroke-linecap"] === "square" ? "square" : "butt", join: props["stroke-linejoin"] === "round" ? "round" : props["stroke-linejoin"] === "bevel" ? "bevel" : "miter" };
        const dash = (props["stroke-dasharray"] ?? "none") === "none" ? [] : (props["stroke-dasharray"] as string).split(/[\s,]+/).map((t) => parseLength(t) ?? NaN);
        if (dash.length > 0 && dash.every((v) => Number.isFinite(v) && v >= 0) && dash.some((v) => v > 0)) stroke["dash"] = dash.map((v) => num(v * meanScale(m)));
        if (props["stroke-dashoffset"] !== undefined && parseFloat(props["stroke-dashoffset"]) !== 0) this.note("stroke-dashoffset", el.attrs["id"], "A dash offset is ignored");
      }
    }
    if (fill === null && !stroke) {
      this.stats.dropped++;
      return undefined;
    }

    const id = this.idFor(el, name === "path" ? "path" : name, ctx);
    const node: Obj = { id, type };
    let box: Box | undefined;
    const canvasSp = transformSubpaths(g.sp, m);
    box = boxOf(canvasSp);
    if (type === "rect" && g.rect) {
      node["w"] = num(g.rect.w * m[0]);
      node["h"] = num(g.rect.h * m[3]);
      if (g.rect.r > 0) node["radius"] = num(g.rect.r * m[0]);
      node["x"] = num(origin[0]);
      node["y"] = num(origin[1]);
    } else if (type === "ellipse" && g.ell) {
      const rx = g.ell.rx * m[0];
      const ry = g.ell.ry * m[3];
      if (Math.abs(rx - ry) < 1e-9) node["r"] = num(rx);
      else {
        node["rx"] = num(rx);
        node["ry"] = num(ry);
      }
      node["x"] = num(origin[0]);
      node["y"] = num(origin[1]);
    } else node["d"] = subpathsToD(canvasSp);

    if (fill !== null) node["fill"] = fill;
    if (props["fill-rule"] === "evenodd") node["fillRule"] = "evenodd";
    if (stroke) node["stroke"] = stroke;
    if (opacity < 1) node["opacity"] = num(opacity);
    if (clip) {
      const local = transformSubpaths(clip, [1, 0, 0, 1, -origin[0], -origin[1]]);
      node["clip"] = { type: "path", d: subpathsToD(local) };
    }
    this.record(node, box);
    this.stats.shapes++;
    return { node, box };
  }

  // ------------------------------------------------------------------ paint

  /** Resolves a fill or stroke value to a colour string, a gradient object or null for none. */
  private paint(raw: string, props: Props, alpha: number, m: Matrix, bbox: Box, origin: Vec2, what: "fill" | "stroke", el: XmlElement): string | Obj | null | undefined {
    const v = raw.trim();
    if (v === "none") return null;
    const url = /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)\s*(.*)$/.exec(v);
    if (url) {
      const g = this.gradient(url[1] as string, alpha, m, bbox, origin, el);
      if (g !== undefined) return g;
      const fb = (url[2] as string).trim();
      if (fb !== "" && fb !== "none") return this.paint(fb, props, alpha, m, bbox, origin, what, el);
      return null;
    }
    const resolved = v === "currentColor" || v === "currentcolor" ? props["color"] ?? "#000000" : v;
    const c = parseColor(resolved);
    if (c === undefined) {
      this.note(what, el.attrs["id"], `The colour '${raw}' is not understood and black was used`);
      return withAlpha("#000000", alpha);
    }
    return withAlpha(c, alpha);
  }

  private gradient(id: string, alpha: number, m: Matrix, bbox: Box, origin: Vec2, user: XmlElement): Obj | string | undefined {
    const first = this.byId.get(id);
    if (!first || (first.name !== "linearGradient" && first.name !== "radialGradient")) {
      this.note("gradient", user.attrs["id"], `The paint '#${id}' is not a gradient that exists, and was ignored`);
      return undefined;
    }
    // Follow href links for attributes and stops.
    const chain: XmlElement[] = [];
    for (let el: XmlElement | undefined = first; el && chain.length < 8 && !chain.includes(el); el = this.byId.get((el.attrs["xlink:href"] ?? el.attrs["href"] ?? "").replace(/^#/, ""))) chain.push(el);
    const attr = (k: string): string | undefined => {
      for (const el of chain) if (el.attrs[k] !== undefined) return el.attrs[k];
      return undefined;
    };
    const stopsEl = chain.find((e) => e.children.some((c) => c.name === "stop"));
    const stops: [number, string][] = [];
    let last = 0;
    for (const s of stopsEl?.children.filter((c) => c.name === "stop") ?? []) {
      const sp = inheritProps({}, declaredProps(s, this.sheet));
      const off = parseLength(sp["offset"] ?? s.attrs["offset"], 1) ?? 0;
      const offset = Math.max(last, Math.min(1, off));
      last = offset;
      const c = parseColor(sp["stop-color"] === "currentColor" ? sp["color"] ?? "#000000" : sp["stop-color"] ?? "#000000") ?? "#000000";
      const so = sp["stop-opacity"] === undefined ? 1 : Math.min(1, Math.max(0, parseFloat(sp["stop-opacity"])));
      stops.push([num(offset), withAlpha(c, so * alpha)]);
    }
    if (stops.length === 0) return undefined;
    if (stops.length === 1) return (stops[0] as [number, string])[1];
    if ((attr("spreadMethod") ?? "pad") !== "pad") this.note("gradient", id, `spreadMethod '${attr("spreadMethod")}' is imported as pad`);

    const objectBox = (attr("gradientUnits") ?? "objectBoundingBox") === "objectBoundingBox";
    const bw = bbox[2] - bbox[0];
    const bh = bbox[3] - bbox[1];
    const gt = parseTransform(attr("gradientTransform")) ?? IDENTITY;
    let space: Matrix = m;
    if (objectBox) space = multiply(space, [bw, 0, 0, bh, bbox[0], bbox[1]]);
    space = multiply(space, gt);
    const val = (k: string, d: string): number => parseLength(attr(k) ?? d, objectBox ? 1 : 1) ?? 0;
    const shift = (p: Vec2): Vec2 => [num(p[0] - origin[0]), num(p[1] - origin[1])];
    this.stats.gradients++;
    if (first.name === "linearGradient") {
      return {
        type: "linear",
        from: shift(apply(space, val("x1", "0%"), val("y1", "0%"))),
        to: shift(apply(space, val("x2", "100%"), val("y2", "0%"))),
        stops,
      };
    }
    const cx = val("cx", "50%");
    const cy = val("cy", "50%");
    const r = val("r", "50%");
    if (attr("fx") !== undefined && Math.abs(val("fx", "50%") - cx) > 1e-6) this.note("gradient", id, "A radial gradient focal point is ignored");
    // A scene gradient is circular. SVG stretches the gradient with the shape it fills, which gives an ellipse.
    const stretch = anisotropy(space);
    if (stretch > 1.1) this.note("gradient", id, `A radial gradient stretched ${stretch.toFixed(1)} to 1 (it fills a non-square shape or is scaled unevenly) is imported as a circle, so its falloff differs`);
    return { type: "radial", center: shift(apply(space, cx, cy)), radius: num(r * meanScale(space)), stops };
  }

  // ------------------------------------------------------------------ clips and masks

  private urlId(v: string | undefined): string | undefined {
    if (v === undefined || v === "none") return undefined;
    return /^url\(\s*['"]?#([^'")\s]+)['"]?\s*\)$/.exec(v.trim())?.[1];
  }

  /** The clip of an element as subpaths in canvas coordinates. A mask whose content is plain white shapes is treated as a clip. */
  private clipOf(own: Props, el: XmlElement, m: Matrix): Subpath[] | undefined {
    const parts: Subpath[][] = [];
    const cid = this.urlId(own["clip-path"]);
    if (cid !== undefined) {
      const c = this.shapesOf(cid, "clipPath", m, el);
      if (c) parts.push(c);
    }
    const mid = this.urlId(own["mask"]);
    if (mid !== undefined) {
      const c = this.shapesOf(mid, "mask", m, el);
      if (c) parts.push(c);
    }
    if (parts.length === 0) return undefined;
    if (parts.length > 1) this.note("clip", el.attrs["id"], "An element with both a clip-path and a mask keeps only the clip-path");
    this.stats.clips++;
    return parts[0];
  }

  private shapesOf(id: string, kind: "clipPath" | "mask", m: Matrix, user: XmlElement): Subpath[] | undefined {
    const def = this.byId.get(id);
    if (!def || def.name !== kind) {
      this.note(kind, user.attrs["id"], `'#${id}' is not a ${kind} that exists, so it was ignored`);
      return undefined;
    }
    if (kind === "clipPath" && def.attrs["clipPathUnits"] === "objectBoundingBox") {
      this.note("clipPath", id, "clipPathUnits objectBoundingBox is not supported and the clip was dropped");
      return undefined;
    }
    const base = inheritProps({}, declaredProps(def, this.sheet));
    const out: Subpath[] = [];
    let ok = true;
    const collect = (el: XmlElement, cm: Matrix, props: Props, depth: number): void => {
      for (const c of el.children) {
        const name = c.name;
        const own = declaredProps(c, this.sheet);
        if (own["display"] === "none") continue;
        const p = inheritProps(props, own);
        const t = parseTransform(c.attrs["transform"] ?? own["transform"]) ?? IDENTITY;
        const mm = multiply(cm, t);
        if (name === "use" && depth < 8) {
          const target = this.byId.get((c.attrs["xlink:href"] ?? c.attrs["href"] ?? "").replace(/^#/, ""));
          if (!target) continue;
          const wrapper: XmlElement = { name: "g", attrs: {}, children: [target], text: "" };
          collect(wrapper, multiply(mm, [1, 0, 0, 1, parseLength(c.attrs["x"]) ?? 0, parseLength(c.attrs["y"]) ?? 0]), p, depth + 1);
        } else if (name === "g" && depth < 8) collect(c, mm, p, depth + 1);
        else if (SHAPES.has(name)) {
          if (kind === "mask") {
            // Only opaque white content reveals the whole shape, which is what a clip does.
            const f = parseColor(p["fill"] ?? "#000000");
            const op = own["opacity"] === undefined ? 1 : parseFloat(own["opacity"]);
            const fo = p["fill-opacity"] === undefined ? 1 : parseFloat(p["fill-opacity"]);
            if (f !== "#ffffff" || op < 1 || fo < 1 || (p["stroke"] !== undefined && p["stroke"] !== "none")) {
              ok = false;
              continue;
            }
          }
          const g = this.geometry(c, name);
          if (g) out.push(...transformSubpaths(g.sp, mm));
        }
      }
    };
    collect(def, m, base, 0);
    if (kind === "mask" && !ok) {
      this.note("mask", id, "Only masks of plain white shapes are supported (they become clips). This mask was removed");
      return undefined;
    }
    if (out.length === 0) return undefined;
    return out;
  }
}

/** Converts SVG text to a scene fragment. Throws `ImportError` when the file cannot be read as SVG. */
export function importSvg(text: string, source: string): ImportResult {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (e) {
    if (e instanceof XmlError) throw new ImportError(`The file is not well-formed XML: ${e.message}.`);
    throw e;
  }
  return new Importer(root).run(source);
}
