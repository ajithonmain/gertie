import { embedLottie, embedProblem } from "../lottie-tools/embed.ts";
import { sampleKeys } from "../presets/sample.ts";
import type { Fault } from "../spec/fault.ts";
import type { Subpath, Vec2 } from "../spec/path.ts";
import type { NGradient, NGroup, NKey, NNode, NScene, NShape, NTracks, NTransform, Rgba, TrackName, TrackValue } from "../spec/types.ts";

// The output is plain JSON built from these loose types. The result is checked by the
// schema validator and the semantic lint, so a looser type here is acceptable.
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JObj = { [key: string]: Json };

export interface EmitOptions {
  /** Data URIs for image sources, keyed by the `src` value in the scene. */
  images?: Record<string, string>;
  /** Parsed JSON of Lottie files placed with `lottie` nodes, keyed by the `src` value in the scene. */
  lotties?: Record<string, unknown>;
  /** Test-only: switches on a deliberate fault for the mutation check. */
  fault?: Fault;
}

let fault: Fault | undefined;

const prop = (k: Json, animated = false): JObj => ({ a: animated ? 1 : 0, k });

function colorArray(c: Rgba): number[] {
  return [c[0] / 255, c[1] / 255, c[2] / 255];
}

function bezierOf(sp: Subpath): JObj {
  return { c: sp.closed, v: sp.v, i: sp.i, o: sp.o };
}

/**
 * Builds a Lottie animated property. The ease of scene key n+1 goes on Lottie keyframe n,
 * because Lottie stores easing on the keyframe where a segment starts.
 */
function animated(keys: readonly NKey[], map: (v: TrackValue) => Json): JObj {
  const out: Json[] = keys.map((k, n) => {
    const kf: JObj = { t: k.t, s: map(k.v) as Json };
    const next = fault === "lottie-ease-shift" ? k : keys[n + 1];
    if (next && (fault === "lottie-ease-shift" || keys[n + 1])) {
      if (next.ease === "hold") kf["h"] = 1;
      else {
        const [x1, y1, x2, y2] = next.ease;
        kf["o"] = { x: [x1], y: [y1] };
        kf["i"] = { x: [x2], y: [y2] };
      }
    }
    return kf;
  });
  return prop(out, true);
}

const scalar = (v: TrackValue): Json => [v as number];

function scalarProp(keys: readonly NKey[] | undefined, staticValue: number, scale = 1, add = 0): JObj {
  if (!keys) return prop(staticValue * scale + add);
  return animated(keys, (v) => [(v as number) * scale + add]);
}

/** Combines two scalar tracks into one vector track. Exact when times and eases match, baked per frame otherwise. */
function vectorProp(a: readonly NKey[] | undefined, av: number, b: readonly NKey[] | undefined, bv: number, scale: number): JObj {
  if (!a && !b) return prop([av * scale, bv * scale]);
  if (!a || !b) {
    // One axis moves, so the keyframes and easing are exact: the other axis is constant.
    const keys = ((a ?? b) as readonly NKey[]).map((k) => ({ t: k.t, ease: k.ease, v: (a ? [k.v as number, bv] : [av, k.v as number]) as Vec2 }));
    return animated(keys, (v) => [(v as Vec2)[0] * scale, (v as Vec2)[1] * scale]);
  }
  const aligned =
    a !== undefined &&
    b !== undefined &&
    a.length === b.length &&
    a.every((k, i) => k.t === (b[i] as NKey).t && JSON.stringify(k.ease) === JSON.stringify((b[i] as NKey).ease));
  if (aligned) {
    const keys = (a as NKey[]).map((k, i) => ({ t: k.t, ease: k.ease, v: [k.v as number, (b as NKey[])[i]?.v as number] as Vec2 }));
    return animated(keys, (v) => [(v as Vec2)[0] * scale, (v as Vec2)[1] * scale]);
  }
  const lo = Math.min(a?.[0]?.t ?? Infinity, b?.[0]?.t ?? Infinity);
  const hi = Math.max(a?.[a.length - 1]?.t ?? -Infinity, b?.[b.length - 1]?.t ?? -Infinity);
  const keys: NKey[] = [];
  for (let f = lo; f <= hi; f++) {
    const x = a ? (sampleKeys(a, f) as number) : av;
    const y = b ? (sampleKeys(b, f) as number) : bv;
    keys.push({ t: f, v: [x, y], ease: [0, 0, 1, 1] });
  }
  return animated(keys, (v) => [(v as Vec2)[0] * scale, (v as Vec2)[1] * scale]);
}

/**
 * Position as one two-dimensional property. Used where a player cannot read split position.
 * Exact when only one axis moves or both axes share times and eases, baked per frame otherwise.
 */
function combinedPosition(t: NTransform, tracks: NTracks): JObj {
  const [px, py] = fault === "lottie-no-pivot" ? [0, 0] : t.pivot;
  const shift = (keys: readonly NKey[] | undefined, add: number): NKey[] | undefined => keys?.map((k) => ({ ...k, v: (k.v as number) + add }));
  return vectorProp(shift(tracks.x, px), t.x + px, shift(tracks.y, py), t.y + py, 1);
}

/**
 * `splitPosition` is allowed on layers. **Verified in phase 2:** lottie-web draws nothing when a
 * shape group's transform uses split position, so groups get a combined position instead.
 */
function transformProps(t: NTransform, tracks: NTracks, mode: "layer" | "group" | "identity", shift = 0, anchorAdd = 0): JObj {
  const identity = mode === "identity";
  const [px, py] = fault === "lottie-no-pivot" ? [0, 0] : t.pivot;
  const anchor = identity ? [0, 0] : [px + anchorAdd, py + anchorAdd];
  let p: JObj;
  if (identity) p = prop([0, 0]);
  else if (tracks.x || tracks.y) {
    p = mode === "layer" ? { s: true, x: scalarProp(tracks.x, t.x, 1, px + shift), y: scalarProp(tracks.y, t.y, 1, py + shift) } : combinedPosition(t, tracks);
  } else p = prop([px + t.x + shift, py + t.y + shift]);

  let s: JObj;
  if (identity) s = prop([100, 100]);
  else if (tracks.scale) s = animated(tracks.scale, (v) => [(v as Vec2)[0] * 100, (v as Vec2)[1] * 100]);
  else s = prop([t.scale[0] * 100, t.scale[1] * 100]);

  return {
    a: prop(anchor),
    p,
    s,
    r: identity ? prop(0) : scalarProp(tracks.rotation, t.rotation),
    o: identity ? prop(100) : scalarProp(tracks.opacity, t.opacity, 100),
  };
}

// ------------------------------------------------------------------ shapes

/**
 * One gradient end point as a Lottie property. A radial gradient's end point is the centre moved
 * right by the radius, so it depends on two tracks; `vec` combines them (exact when both share
 * times and eases, baked per frame otherwise).
 */
function radialEnd(center: readonly NKey[] | undefined, c: Vec2, radius: readonly NKey[] | undefined, r: number): JObj {
  if (!center && !radius) return prop([c[0] + r, c[1]]);
  const same = (a: readonly NKey[] | undefined, b: readonly NKey[] | undefined): boolean =>
    a !== undefined && b !== undefined && a.length === b.length && a.every((k, i) => k.t === (b[i] as NKey).t && JSON.stringify(k.ease) === JSON.stringify((b[i] as NKey).ease));
  if (center && radius && !same(center, radius)) {
    const lo = Math.min((center[0] as NKey).t, (radius[0] as NKey).t);
    const hi = Math.max((center[center.length - 1] as NKey).t, (radius[radius.length - 1] as NKey).t);
    const keys: NKey[] = [];
    for (let f = lo; f <= hi; f++) {
      const cc = sampleKeys(center, f) as Vec2;
      keys.push({ t: f, v: [cc[0] + (sampleKeys(radius, f) as number), cc[1]], ease: [0, 0, 1, 1] });
    }
    return animated(keys, (v) => v as Vec2);
  }
  const base = (center ?? radius) as readonly NKey[];
  const keys = base.map((k, i) => {
    const cc = center ? ((center[i] as NKey).v as Vec2) : c;
    const rr = radius ? ((radius[i] as NKey).v as number) : r;
    return { t: k.t, ease: k.ease, v: [cc[0] + rr, cc[1]] as Vec2 };
  });
  return animated(keys, (v) => v as Vec2);
}

function gradientItem(g: NGradient, rule: number, node: string, tracks: NTracks): JObj {
  const stops = g.stops;
  const flat: number[] = [];
  for (const st of stops) flat.push(st.offset, ...colorArray(st.color));
  if (stops.some((st) => st.color[3] < 1)) for (const st of stops) flat.push(st.offset, st.color[3]);
  const pointProp = (keys: readonly NKey[] | undefined, v: Vec2): JObj => (keys ? animated(keys, (k) => k as Vec2) : prop(v));
  const s = g.type === "linear" ? pointProp(tracks["fill.from"], g.from) : pointProp(tracks["fill.center"], g.center);
  const e = g.type === "linear" ? pointProp(tracks["fill.to"], g.to) : radialEnd(tracks["fill.center"], g.center, tracks["fill.radius"], g.radius);
  return {
    ty: "gf",
    nm: `${node}-fill`,
    t: g.type === "linear" ? 1 : 2,
    s,
    e,
    g: { p: stops.length, k: prop(flat) },
    o: prop(100),
    r: rule,
  };
}

/**
 * Dash entries carry an `nm`. **Verified in phase 2:** lottie-web draws nothing, for the whole
 * animation, when the entries have only `n` and `v`.
 */
function dashes(dash: number[]): Json {
  const arr = dash.length % 2 === 1 ? [...dash, ...dash] : dash;
  const items: Json[] = arr.map((v, i) => ({ n: i % 2 === 0 ? "d" : "g", nm: i % 2 === 0 ? "dash" : "gap", v: prop(v) }));
  items.push({ n: "o", nm: "offset", v: prop(0) });
  return items;
}

function geometryItems(n: NShape): JObj[] {
  switch (n.type) {
    case "rect":
      return [{ ty: "rc", nm: "rect", p: prop([0, 0]), s: vectorProp(n.tracks.w, n.w, n.tracks.h, n.h, 1), r: scalarProp(n.tracks.radius, n.radius) }];
    case "ellipse":
      return [{ ty: "el", nm: "ellipse", p: prop([0, 0]), s: vectorProp(n.tracks.rx, n.rx, n.tracks.ry, n.ry, 2) }];
    case "path": {
      const morph = n.tracks.d;
      return n.d.map((sp, idx) => ({
        ty: "sh",
        nm: `path-${idx}`,
        ks: morph ? animated(morph, (v) => [bezierOf((v as Subpath[])[idx] as Subpath)]) : prop(bezierOf(sp)),
      }));
    }
  }
}

function styleItems(n: NShape): JObj[] {
  const items: JObj[] = [];
  if (n.trim) {
    items.push({
      ty: "tm",
      nm: "trim",
      s: scalarProp(n.tracks["trim.start"], n.trim.start, 100),
      e: scalarProp(n.tracks["trim.end"], n.trim.end, 100),
      o: scalarProp(n.tracks["trim.offset"], n.trim.offset, 360),
      m: 1,
    });
  }
  // Lottie draws earlier items on top: stroke first puts the stroke over the fill, like SVG.
  if (n.stroke) {
    const st = n.stroke;
    const colorKeys = n.tracks["stroke.color"];
    const item: JObj = {
      ty: "st",
      nm: "stroke",
      c: colorKeys ? animated(colorKeys, (v) => colorArray(v as Rgba)) : prop(colorArray(st.color)),
      o: prop(st.color[3] * 100),
      w: scalarProp(n.tracks["stroke.width"], st.width),
      lc: st.cap,
      lj: st.join,
      ml: 4,
    };
    if (st.dash) item["d"] = dashes(st.dash);
    items.push(item);
  }
  if (n.fill) {
    if (Array.isArray(n.fill)) {
      const colorKeys = n.tracks.fill;
      items.push({
        ty: "fl",
        nm: "fill",
        c: colorKeys ? animated(colorKeys, (v) => colorArray(v as Rgba)) : prop(colorArray(n.fill)),
        o: prop(n.fill[3] * 100),
        r: n.fillRule,
      });
    } else items.push(gradientItem(n.fill, n.fillRule, n.id, n.tracks));
  }
  return items;
}

function trItem(t: NTransform, tracks: NTracks, identity: boolean): JObj {
  return { ty: "tr", ...transformProps(t, tracks, identity ? "identity" : "group") };
}

/** A shape node as a Lottie group. `identity` is true when the layer already carries the transform. */
function shapeGroup(n: NShape, identity: boolean): JObj {
  return { ty: "gr", nm: n.id, it: [...geometryItems(n), ...styleItems(n), trItem(n.transform, n.tracks, identity)] };
}

// ------------------------------------------------------------------ layers

type Node = NNode;

/**
 * A group can become one shape layer only when nothing inside it needs its own layer:
 * no images, instances, clips or partial lifetimes.
 */
function isPlainShapeTree(g: NGroup, totalFrames: number): boolean {
  const ok = (n: Node): boolean => {
    if (n.type === "image" || n.type === "lottie" || n.type === "use" || n.clip) return false;
    if (n.from !== 0 || n.to !== totalFrames) return false;
    // A matte pair needs both nodes as layers of their own, as a time window does.
    if (n.matte || n.matteSource) return false;
    if (n.type === "group") return n.children.every(ok);
    return true;
  };
  return g.children.every(ok);
}

function plainGroupItem(n: Node): JObj {
  if (n.type === "group") {
    return { ty: "gr", nm: n.id, it: [...[...n.children].reverse().map(plainGroupItem), trItem(n.transform, n.tracks, false)] };
  }
  return shapeGroup(n as NShape, false);
}

class Emitter {
  assets: JObj[] = [];
  private readonly assetIds = new Set<string>();

  constructor(
    private readonly scene: NScene,
    private readonly opts: EmitOptions,
  ) {
    this.margin = Math.max(scene.w, scene.h);
  }

  /**
   * A precomposition clips its content to its own rectangle. Local coordinates are often negative
   * (shapes centred on the origin), so a precomposition is `margin` larger on every side and its
   * content sits `margin` in from the corner. The layer anchor and its masks compensate.
   */
  private readonly margin: number;
  /** Position shift for layers placed inside a precomposition. */
  private shift = 0;

  private layerBase(n: Node, ty: number, ind: number): JObj {
    const comp = ty === 0;
    return { ty, nm: n.id, ind, ip: n.from, op: n.to, st: 0, ks: transformProps(n.transform, n.tracks, "layer", this.shift, comp ? this.margin : 0) };
  }

  private addMask(layer: JObj, n: Node): void {
    if (!n.clip) return;
    const by = layer["ty"] === 0 ? this.margin : 0;
    layer["hasMask"] = true;
    layer["masksProperties"] = n.clip.map((sp) => ({
      mode: "a",
      pt: prop(bezierOf(by === 0 ? sp : { ...sp, v: sp.v.map(([x, y]) => [x + by, y + by] as Vec2) })),
      o: prop(100),
      x: prop(0),
    }));
  }

  private compSize(): { w: number; h: number } {
    return { w: this.scene.w + 2 * this.margin, h: this.scene.h + 2 * this.margin };
  }

  private precompAsset(id: string, name: string, nodes: Node[]): void {
    if (this.assetIds.has(id)) return;
    this.assetIds.add(id);
    // Reserve the slot first so a nested reference cannot recurse into this asset.
    const asset: JObj = { id, nm: name, layers: [] };
    this.assets.push(asset);
    const outer = this.shift;
    this.shift = this.margin;
    asset["layers"] = this.layers(nodes);
    this.shift = outer;
  }

  /**
   * Converts nodes in painter's order to Lottie layers, first layer on top. A matted node is
   * preceded by its source, a layer with `td: 1` directly above it, and gets `tt` 1 (alpha) or 2
   * (inverted alpha). A source used by several nodes is written once above each of them, and a
   * source is not written where it stands.
   */
  layers(nodes: Node[]): Json[] {
    const out: Json[] = [];
    let ind = 1;
    const byId = new Map(nodes.map((n) => [n.id, n]));
    for (const n of fault === "lottie-no-reverse" ? nodes : [...nodes].reverse()) {
      if (n.matteSource) continue;
      const source = n.matte ? byId.get(n.matte.by) : undefined;
      if (n.matte && source) {
        const sl = this.layer(source, ind++);
        sl["td"] = 1;
        out.push(sl);
      }
      const l = this.layer(n, ind++);
      if (n.matte && source) l["tt"] = n.matte.mode === "alpha" ? 1 : 2;
      out.push(l);
    }
    return out;
  }

  private layer(n: Node, ind: number): JObj {
    let layer: JObj;
    switch (n.type) {
      case "group": {
        if (isPlainShapeTree(n, this.scene.totalFrames)) {
          layer = { ...this.layerBase(n, 4, ind), shapes: [...n.children].reverse().map(plainGroupItem) };
        } else {
          const id = `comp-${n.id}`;
          this.precompAsset(id, n.id, n.children);
          layer = { ...this.layerBase(n, 0, ind), refId: id, ...this.compSize() };
        }
        break;
      }
      case "use": {
        const def = this.scene.defs[n.ref] as Node;
        const id = `comp-def-${n.ref}`;
        this.precompAsset(id, n.ref, [def]);
        layer = { ...this.layerBase(n, 0, ind), refId: id, ...this.compSize() };
        break;
      }
      case "image": {
        const id = `img-${n.id}`;
        if (!this.assetIds.has(id)) {
          this.assetIds.add(id);
          this.assets.push({ id, w: n.w, h: n.h, e: 1, u: "", p: this.opts.images?.[n.src] ?? "" });
        }
        layer = { ...this.layerBase(n, 2, ind), refId: id };
        break;
      }
      case "lottie": {
        const doc = this.opts.lotties?.[n.src] as JObj | undefined;
        const id = `lottie-${n.id}`;
        if (doc && !embedProblem(doc)) {
          const e = embedLottie(doc, `${id}-`, this.scene.fps);
          if (!this.assetIds.has(id)) {
            this.assetIds.add(id);
            this.assets.push(...(e.assets as JObj[]), { id, nm: n.id, layers: e.layers });
          }
          // An embedded file is not padded by the margin Gertie's own precompositions use, so its layer is built without the margin compensation (as a shape layer) and made a precomposition afterwards.
          layer = { ...this.layerBase(n, 4, ind), refId: id, w: e.w, h: e.h };
        } else {
          // The linter reports a missing or unreadable file; an empty composition keeps the output well formed.
          this.assets.push({ id, nm: n.id, layers: [] });
          layer = { ...this.layerBase(n, 4, ind), refId: id, w: 1, h: 1 };
        }
        break;
      }
      default:
        layer = { ...this.layerBase(n, 4, ind), shapes: [shapeGroup(n, true)] };
    }
    this.addMask(layer, n);
    if (n.type === "lottie") layer["ty"] = 0;
    return layer;
  }
}

function round(v: Json): Json {
  if (typeof v === "number") return Object.is(v, -0) ? 0 : Math.round(v * 1000) / 1000;
  if (Array.isArray(v)) return v.map(round);
  if (v !== null && typeof v === "object") {
    const o: JObj = {};
    for (const [k, x] of Object.entries(v)) o[k] = round(x);
    return o;
  }
  return v;
}

/** Compiles a normalized scene to a Lottie JSON object. Pure: no file access. */
export function emitLottie(scene: NScene, opts: EmitOptions = {}): JObj {
  fault = opts.fault;
  try {
    return emitLottieInner(scene, opts);
  } finally {
    fault = undefined;
  }
}

function emitLottieInner(scene: NScene, opts: EmitOptions): JObj {
  const e = new Emitter(scene, opts);
  const layers = e.layers(scene.nodes);
  if (scene.background) {
    const [r, g, b, a] = scene.background;
    layers.push({
      ty: 4,
      nm: "background",
      ind: layers.length + 1,
      ip: 0,
      op: scene.totalFrames,
      st: 0,
      ks: transformProps({ x: 0, y: 0, rotation: 0, scale: [1, 1], opacity: 1, pivot: [0, 0] }, {}, "layer"),
      shapes: [
        {
          ty: "gr",
          nm: "background",
          it: [
            { ty: "rc", nm: "rect", p: prop([scene.w / 2, scene.h / 2]), s: prop([scene.w, scene.h]), r: prop(0) },
            { ty: "fl", nm: "fill", c: prop(colorArray([r, g, b, a])), o: prop(a * 100), r: 1 },
            trItem({ x: 0, y: 0, rotation: 0, scale: [1, 1], opacity: 1, pivot: [0, 0] }, {}, true),
          ],
        },
      ],
    });
  }
  const doc: JObj = {
    nm: scene.name,
    fr: scene.fps,
    ip: 0,
    op: scene.totalFrames,
    w: scene.w,
    h: scene.h,
    assets: e.assets,
    layers,
  };
  // Markers are written in frames: `tm` is the start and `dr` the length.
  if (scene.markers.length > 0) doc["markers"] = scene.markers.map((m) => ({ cm: m.name, tm: m.start, dr: m.end - m.start }));
  return round(doc) as JObj;
}

export type { TrackName };
