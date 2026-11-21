import type { Ease } from "../presets/easing.ts";
import { sampleKeys } from "../presets/sample.ts";
import type { Fault } from "../spec/fault.ts";
import { ellipseSubpath, rectSubpaths } from "../spec/path.ts";
import type { NGradient, NGroup, NImage, NKey, NNode, NScene, NShape, NTracks, NUse, Rgba, Subpath, TrackValue, Vec2 } from "../spec/types.ts";
import { bezierText, escapeAttr, f, fraction, hex, isLinear, pathData, pct, pctAfterStep, prefixFor } from "./format.ts";

export interface SvgEmitOptions {
  /** Data URIs for image sources, keyed by the `src` value in the scene. */
  images?: Record<string, string>;
  /** Test-only: switches on a deliberate fault for the mutation check. */
  fault?: Fault;
}

export interface SvgResult {
  svg: string;
  /** Properties that had no native SVG form and were sampled at every frame, as "node.property". */
  baked: string[];
}

/** A keyframe whose value is a list of numbers (translate, trim). */
interface VKey {
  t: number;
  ease: Ease;
  v: number[];
}
type Keys = readonly NKey[];
type Attr = [string, string];

const LINEAR: Ease = [0, 0, 1, 1];
const CAPS = ["butt", "round", "square"] as const;
const JOINS = ["miter", "round", "bevel"] as const;
const EPS = 1e-9;

/** Keyframes and rules, with identical keyframe blocks written once. */
class Sheet {
  private readonly byBody = new Map<string, string>();
  readonly blocks: string[] = [];
  readonly rules: string[] = [];

  constructor(
    private readonly duration: string,
    private readonly iterations: string,
  ) {}

  keyframes(name: string, frames: string[]): string {
    const body = frames.join("");
    const known = this.byBody.get(body);
    if (known) return known;
    this.byBody.set(body, name);
    this.blocks.push(`@keyframes ${name}{${body}}`);
    return name;
  }

  rule(cls: string, names: string[], origin: boolean): void {
    const anim = names.map((n) => `${n} ${this.duration} linear ${this.iterations} both`).join(",");
    this.rules.push(`.${cls}{animation:${anim}${origin ? ";transform-origin:0 0" : ""}}`);
  }

  get animated(): boolean {
    return this.rules.length > 0;
  }

  text(): string {
    return [...this.blocks, ...this.rules, "@media (prefers-reduced-motion:reduce){*{animation:none!important}}"].join("\n");
  }
}

interface Wrapper {
  /** Static transform, or the poster value when animated. */
  tf?: string;
  opacity?: string;
  clip?: string;
  mask?: string;
  cls?: string;
  kf?: string[];
  origin?: boolean;
}

class SvgEmitter {
  readonly defs: string[] = [];
  readonly baked: string[] = [];
  private readonly sheet: Sheet;
  private readonly p: string;
  private readonly total: number;
  private readonly fault: Fault | undefined;
  private readonly defDone = new Set<string>();
  /** Every node by id (ids are unique across the scene), so a matte can find its source. */
  private readonly byId = new Map<string, NNode>();
  private readonly maskDone = new Set<string>();
  private hasGeometryAnimation = false;

  constructor(
    private readonly scene: NScene,
    private readonly opts: SvgEmitOptions,
  ) {
    this.p = prefixFor(scene.name);
    this.total = scene.totalFrames;
    this.fault = opts.fault;
    this.sheet = new Sheet(`${f(scene.totalFrames / scene.fps, 6)}s`, scene.loop ? "infinite" : "1");
    const index = (n: NNode): void => {
      this.byId.set(n.id, n);
      if (n.type === "group") n.children.forEach(index);
    };
    scene.nodes.forEach(index);
    Object.values(scene.defs).forEach(index);
  }

  // ---------------------------------------------------------------- keyframes

  /** CSS puts easing on the keyframe where a segment starts; the scene puts it where the segment ends. */
  private frames<K extends { t: number; ease: Ease }>(keys: readonly K[], decl: (k: K) => string): string[] {
    return keys.map((k, n) => {
      let timing = "";
      const next = keys[n + 1];
      if (next) {
        const e = this.fault === "svg-ease-shift" ? k.ease : next.ease;
        if (e === "hold") timing = ";animation-timing-function:step-end";
        else if (!isLinear(e)) timing = `;animation-timing-function:cubic-bezier(${bezierText(e)})`;
      }
      const afterStep = n > 0 && n < keys.length - 1 && k.ease === "hold" && this.fault !== "svg-ease-shift";
      return `${afterStep ? pctAfterStep(k.t, this.total) : pct(k.t, this.total)}{${decl(k)}${timing}}`;
    });
  }

  private kf(name: string, keys: Keys, decl: (v: TrackValue) => string): string {
    return this.sheet.keyframes(name, this.frames(keys, (k) => decl(k.v)));
  }

  private poster(keys: Keys): TrackValue {
    return sampleKeys(keys, this.scene.posterFrame);
  }

  /** Several scalar tracks as one vector track. Null when none animates; "unaligned" when the timelines differ. */
  private aligned(tracks: (Keys | undefined)[], consts: number[]): VKey[] | "unaligned" | null {
    const live = tracks.filter((t): t is Keys => t !== undefined);
    const first = live[0];
    if (!first) return null;
    const same = live.every((tr) => tr.length === first.length && tr.every((k, i) => k.t === (first[i] as NKey).t && JSON.stringify(k.ease) === JSON.stringify((first[i] as NKey).ease)));
    if (live.length > 1 && !same) return "unaligned";
    return first.map((k, i) => ({
      t: k.t,
      ease: k.ease,
      v: tracks.map((tr, c) => (tr ? ((tr[i] as NKey).v as number) : (consts[c] as number))),
    }));
  }

  /** Like `aligned`, but samples every frame when the timelines differ. */
  private vector(tracks: (Keys | undefined)[], consts: number[], label: string): VKey[] | null {
    const a = this.aligned(tracks, consts);
    if (a !== "unaligned") return a;
    this.baked.push(label);
    const out: VKey[] = [];
    for (let fr = 0; fr <= this.total; fr++) out.push({ t: fr, ease: LINEAR, v: tracks.map((tr, c) => (tr ? (sampleKeys(tr, fr) as number) : (consts[c] as number))) });
    return out;
  }

  private posterOf(keys: readonly VKey[]): number[] {
    const at = this.scene.posterFrame;
    const dims = (keys[0] as VKey).v.length;
    const tracks: NKey[][] = Array.from({ length: dims }, (_, d) => keys.map((k) => ({ t: k.t, ease: k.ease, v: k.v[d] as number })));
    return tracks.map((tr) => sampleKeys(tr, at) as number);
  }

  // ---------------------------------------------------------------- wrappers

  /** Set while an instance of an animated definition is being written, so its names stay unique. */
  private scope = "";

  private cls(id: string, suffix: string): string {
    return `${this.p}-${this.scope === "" ? "" : this.scope + "_"}${id}__${suffix}`;
  }

  /** True when nothing in the node can change over time, so one shared copy in `<defs>` is enough. */
  private isStatic(n: NNode): boolean {
    if (Object.keys(n.tracks).length > 0 || n.from !== 0 || n.to < this.total) return false;
    if (n.type === "group") return n.children.every((c) => this.isStatic(c));
    if (n.type === "use") return this.isStatic(this.scene.defs[n.ref] as NNode);
    return true;
  }

  private translateWrappers(n: NNode, px: number, py: number): Wrapper[] {
    const t = n.transform;
    const tx = n.tracks.x ? n.tracks.x.map((k) => ({ ...k, v: (k.v as number) + px })) : undefined;
    const ty = n.tracks.y ? n.tracks.y.map((k) => ({ ...k, v: (k.v as number) + py })) : undefined;
    if (!tx && !ty) {
      const x = px + t.x;
      const y = py + t.y;
      return x === 0 && y === 0 ? [] : [{ tf: `translate(${f(x)} ${f(y)})` }];
    }
    const keys = this.aligned([tx, ty], [px + t.x, py + t.y]);
    if (keys !== "unaligned" && keys) {
      const [px0, py0] = this.posterOf(keys) as [number, number];
      const name = this.sheet.keyframes(this.cls(n.id, "t"), this.frames(keys, (k) => `transform:translate(${f(k.v[0] as number)}px,${f(k.v[1] as number)}px)`));
      return [{ tf: `translate(${f(px0)} ${f(py0)})`, cls: this.cls(n.id, "t"), kf: [name], origin: true }];
    }
    // Different timelines: one wrapper per axis.
    const out: Wrapper[] = [];
    if (tx) {
      const name = this.kf(this.cls(n.id, "tx"), tx, (v) => `transform:translateX(${f(v as number)}px)`);
      out.push({ tf: `translate(${f(this.poster(tx) as number)} 0)`, cls: this.cls(n.id, "tx"), kf: [name], origin: true });
    } else out.push({ tf: `translate(${f(px + t.x)} 0)` });
    if (ty) {
      const name = this.kf(this.cls(n.id, "ty"), ty, (v) => `transform:translateY(${f(v as number)}px)`);
      out.push({ tf: `translate(0 ${f(this.poster(ty) as number)})`, cls: this.cls(n.id, "ty"), kf: [name], origin: true });
    } else out.push({ tf: `translate(0 ${f(py + t.y)})` });
    return out;
  }

  private rotateWrapper(n: NNode): Wrapper[] {
    const keys = n.tracks.rotation;
    if (keys) {
      const name = this.kf(this.cls(n.id, "r"), keys, (v) => `transform:rotate(${f(v as number, 3)}deg)`);
      return [{ tf: `rotate(${f(this.poster(keys) as number, 3)})`, cls: this.cls(n.id, "r"), kf: [name], origin: true }];
    }
    return n.transform.rotation === 0 ? [] : [{ tf: `rotate(${f(n.transform.rotation, 3)})` }];
  }

  private scaleWrapper(n: NNode): Wrapper[] {
    const keys = n.tracks.scale;
    if (keys) {
      const name = this.kf(this.cls(n.id, "s"), keys, (v) => `transform:scale(${f((v as Vec2)[0], 4)},${f((v as Vec2)[1], 4)})`);
      const [sx, sy] = this.poster(keys) as Vec2;
      return [{ tf: `scale(${f(sx, 4)} ${f(sy, 4)})`, cls: this.cls(n.id, "s"), kf: [name], origin: true }];
    }
    const [sx, sy] = n.transform.scale;
    return sx === 1 && sy === 1 ? [] : [{ tf: `scale(${f(sx, 4)} ${f(sy, 4)})` }];
  }

  /** Window wrapper: the node is transparent outside its `from` and `to` frames. */
  private windowWrapper(n: NNode): Wrapper[] {
    if (n.from === 0 && n.to >= this.total) return [];
    const stops: [number, number][] = [];
    if (n.from > 0) stops.push([0, 0], [n.from, 1]);
    else stops.push([0, 1]);
    if (n.to < this.total) stops.push([n.to, 0]);
    stops.push([this.total, (stops[stops.length - 1] as [number, number])[1]]);
    const frames = stops.map(([fr, v], i) => `${i === 0 || i === stops.length - 1 ? pct(fr, this.total) : pctAfterStep(fr, this.total)}{opacity:${v}${i < stops.length - 1 ? ";animation-timing-function:step-end" : ""}}`);
    const name = this.sheet.keyframes(this.cls(n.id, "v"), frames);
    const visibleAtPoster = this.scene.posterFrame >= n.from && this.scene.posterFrame < n.to;
    return [{ opacity: visibleAtPoster ? "1" : "0", cls: this.cls(n.id, "v"), kf: [name] }];
  }

  private opacityWrapper(n: NNode): Wrapper[] {
    const keys = n.tracks.opacity;
    if (keys) {
      const name = this.kf(this.cls(n.id, "o"), keys, (v) => `opacity:${f(v as number, 3)}`);
      return [{ opacity: f(this.poster(keys) as number, 3), cls: this.cls(n.id, "o"), kf: [name] }];
    }
    return n.transform.opacity === 1 ? [] : [{ opacity: f(n.transform.opacity, 3) }];
  }

  /** Merges neighbouring static wrappers and writes the opening tags. Returns the tags and how many to close. */
  private open(wrappers: Wrapper[]): { open: string[]; close: number } {
    const merged: Wrapper[] = [];
    for (const w of wrappers) {
      const prev = merged[merged.length - 1];
      const plain = (x: Wrapper): boolean => x.kf === undefined && x.opacity === undefined && x.clip === undefined && x.mask === undefined;
      if (prev && plain(prev) && plain(w)) prev.tf = `${prev.tf ?? ""} ${w.tf ?? ""}`.trim();
      else merged.push({ ...w });
    }
    const open = merged.map((w) => {
      const attrs: string[] = [];
      if (w.cls) attrs.push(`class="${w.cls}"`);
      if (w.tf) attrs.push(`transform="${w.tf}"`);
      if (w.opacity !== undefined) attrs.push(`opacity="${w.opacity}"`);
      if (w.clip) attrs.push(`clip-path="url(#${w.clip})"`);
      if (w.mask) attrs.push(`mask="url(#${w.mask})"`);
      if (w.cls && w.kf) this.sheet.rule(w.cls, w.kf, w.origin === true);
      return `<g${attrs.length ? " " + attrs.join(" ") : ""}>`;
    });
    return { open, close: merged.length };
  }

  // ---------------------------------------------------------------- paint

  private colorTrack(keys: Keys, id: string, suffix: string, prop: "fill" | "stroke"): { name: string } {
    return { name: this.kf(this.cls(id, suffix), keys, (v) => `${prop}:${hex(v as Rgba)}`) };
  }

  /**
   * CSS cannot animate gradient attributes, so animated geometry uses SMIL on the gradient element,
   * as morphs do. The static attribute holds the poster value, which is what shows with animation off.
   */
  private gradient(id: string, g: NGradient, tracks: NTracks): { id: string; posterId?: string } {
    const gid = this.cls(id, "grad");
    const stops = g.stops.map((s) => `<stop offset="${f(s.offset, 4)}" stop-color="${hex(s.color)}"${s.color[3] < 1 ? ` stop-opacity="${f(s.color[3], 4)}"` : ""}/>`).join("");
    const point = (keys: Keys | undefined, v: Vec2, xa: string, ya: string, label: string): { attrs: string; anims: string } => {
      const at = keys ? (this.poster(keys) as Vec2) : v;
      let anims = "";
      if (keys) {
        const first = (keys[0] as NKey).v as Vec2;
        for (const [i, a] of [xa, ya].entries()) {
          // An axis that never changes needs no animation element.
          if (keys.some((k) => (k.v as Vec2)[i] !== first[i])) anims += this.smil(a, keys, (x) => f((x as Vec2)[i] as number), `${label}.${a}`);
        }
      }
      return { attrs: `${xa}="${f(at[0])}" ${ya}="${f(at[1])}"`, anims };
    };
    let tag: string;
    let attrs: string;
    let animations: string;
    if (g.type === "linear") {
      const a = point(tracks["fill.from"], g.from, "x1", "y1", `${id}.fill.from`);
      const b = point(tracks["fill.to"], g.to, "x2", "y2", `${id}.fill.to`);
      tag = "linearGradient";
      attrs = `${a.attrs} ${b.attrs}`;
      animations = a.anims + b.anims;
    } else {
      const c = point(tracks["fill.center"], g.center, "cx", "cy", `${id}.fill.center`);
      const rk = tracks["fill.radius"];
      const r = rk ? (this.poster(rk) as number) : g.radius;
      const ra = rk ? this.smil("r", rk, (x) => f(x as number), `${id}.fill.radius`) : "";
      tag = "radialGradient";
      attrs = `${c.attrs} r="${f(r)}"`;
      animations = c.anims + ra;
    }
    this.defs.push(`<${tag} id="${gid}" gradientUnits="userSpaceOnUse" ${attrs}>${stops}${animations}</${tag}>`);
    if (!animations) return { id: gid };
    const posterId = `${gid}__poster`;
    this.defs.push(`<${tag} id="${posterId}" href="#${gid}" gradientUnits="userSpaceOnUse" ${attrs}/>`);
    return { id: gid, posterId };
  }

  private smil(attr: string, keys: Keys, map: (v: TrackValue) => string, label: string): string {
    const allHold = keys.slice(1).every((k) => k.ease === "hold");
    const splinable = keys.slice(1).every((k) => k.ease !== "hold" && (k.ease as number[]).every((x) => x >= 0 && x <= 1));
    const timing = `dur="${f(this.total / this.scene.fps, 6)}s" repeatCount="${this.scene.loop ? "indefinite" : "1"}"${this.scene.loop ? "" : ' fill="freeze"'}`;
    if (!allHold && !splinable) {
      this.baked.push(label);
      const all: NKey[] = [];
      for (let fr = 0; fr <= this.total; fr++) all.push({ t: fr, ease: LINEAR, v: sampleKeys(keys, fr) });
      return `<animate attributeName="${attr}" ${timing} values="${all.map((k) => map(k.v)).join(";")}" keyTimes="${all.map((k) => fraction(k.t, this.total)).join(";")}"/>`;
    }
    const values = keys.map((k) => map(k.v)).join(";");
    const times = keys.map((k) => fraction(k.t, this.total)).join(";");
    if (allHold && keys.length > 1) return `<animate attributeName="${attr}" ${timing} calcMode="discrete" values="${values}" keyTimes="${times}"/>`;
    const splines = keys
      .slice(1)
      .map((k) => (k.ease as number[]).map((x) => f(x, 4)).join(" "))
      .join(";");
    return `<animate attributeName="${attr}" ${timing} calcMode="spline" values="${values}" keyTimes="${times}" keySplines="${splines}"/>`;
  }

  // ---------------------------------------------------------------- shapes

  private shape(n: NShape): string {
    const id = n.id;
    const cls = this.cls(id, "sh");
    const attrs: Attr[] = [];
    const anims: string[] = [];
    const children: string[] = [];
    const at = this.scene.posterFrame;

    const trim = n.stroke && n.trim ? n.trim : null;
    let tag: string;
    switch (n.type) {
      case "rect": {
        const hasGeo = n.tracks.w || n.tracks.h || n.tracks.radius;
        if (trim && !hasGeo) {
          tag = "path";
          attrs.push(["d", pathData(rectSubpaths(0, 0, n.w, n.h, n.radius))]);
          break;
        }
        tag = "rect";
        const w = n.tracks.w ? (sampleKeys(n.tracks.w, at) as number) : n.w;
        const h = n.tracks.h ? (sampleKeys(n.tracks.h, at) as number) : n.h;
        const r = n.tracks.radius ? (sampleKeys(n.tracks.radius, at) as number) : n.radius;
        attrs.push(["x", f(-w / 2)], ["y", f(-h / 2)], ["width", f(w)], ["height", f(h)]);
        if (r > 0 || n.tracks.radius) attrs.push(["rx", f(r)]);
        if (n.tracks.w) {
          children.push(this.smil("x", n.tracks.w, (v) => f(-(v as number) / 2), `${id}.w`));
          children.push(this.smil("width", n.tracks.w, (v) => f(v as number), `${id}.w`));
        }
        if (n.tracks.h) {
          children.push(this.smil("y", n.tracks.h, (v) => f(-(v as number) / 2), `${id}.h`));
          children.push(this.smil("height", n.tracks.h, (v) => f(v as number), `${id}.h`));
        }
        if (n.tracks.radius) children.push(this.smil("rx", n.tracks.radius, (v) => f(v as number), `${id}.radius`));
        break;
      }
      case "ellipse": {
        const hasGeo = n.tracks.rx || n.tracks.ry;
        if (trim && !hasGeo) {
          tag = "path";
          attrs.push(["d", pathData([ellipseSubpath(0, 0, n.rx, n.ry)])]);
          break;
        }
        tag = "ellipse";
        const rx = n.tracks.rx ? (sampleKeys(n.tracks.rx, at) as number) : n.rx;
        const ry = n.tracks.ry ? (sampleKeys(n.tracks.ry, at) as number) : n.ry;
        attrs.push(["rx", f(rx)], ["ry", f(ry)]);
        if (n.tracks.rx) children.push(this.smil("rx", n.tracks.rx, (v) => f(v as number), `${id}.rx`));
        if (n.tracks.ry) children.push(this.smil("ry", n.tracks.ry, (v) => f(v as number), `${id}.ry`));
        break;
      }
      case "path": {
        tag = "path";
        const morph = n.tracks.d;
        attrs.push(["d", pathData(morph ? (this.poster(morph) as Subpath[]) : n.d)]);
        if (morph) children.push(this.smil("d", morph, (v) => pathData(v as Subpath[]), `${id}.d`));
        break;
      }
    }

    // fill
    const fillKeys = n.tracks.fill;
    let posterGradient: string | undefined;
    if (n.fill === null) attrs.push(["fill", "none"]);
    else if (Array.isArray(n.fill)) {
      const color = fillKeys ? (this.poster(fillKeys) as Rgba) : n.fill;
      attrs.push(["fill", hex(color)]);
      if (n.fill[3] < 1) attrs.push(["fill-opacity", f(n.fill[3], 4)]);
      if (fillKeys) anims.push(this.colorTrack(fillKeys, id, "fill", "fill").name);
    } else {
      const gradient = this.gradient(id, n.fill, n.tracks);
      attrs.push(["fill", `url(#${gradient.id})`]);
      posterGradient = gradient.posterId;
    }
    if (n.fill !== null && n.fillRule === 2) attrs.push(["fill-rule", "evenodd"]);

    // stroke
    const st = n.stroke;
    if (st) {
      const colorKeys = n.tracks["stroke.color"];
      attrs.push(["stroke", hex(colorKeys ? (this.poster(colorKeys) as Rgba) : st.color)]);
      if (st.color[3] < 1) attrs.push(["stroke-opacity", f(st.color[3], 4)]);
      const widthKeys = n.tracks["stroke.width"];
      attrs.push(["stroke-width", f(widthKeys ? (this.poster(widthKeys) as number) : st.width)]);
      attrs.push(["stroke-linecap", CAPS[st.cap - 1] as string], ["stroke-linejoin", JOINS[st.join - 1] as string], ["stroke-miterlimit", "4"]);
      if (colorKeys) anims.push(this.colorTrack(colorKeys, id, "stroke", "stroke").name);
      if (widthKeys) anims.push(this.kf(this.cls(id, "sw"), widthKeys, (v) => `stroke-width:${f(v as number)}px`));
      if (trim) this.trim(n, trim, tag === "path" && n.type === "path" ? n.d.every((s) => s.closed) : true, attrs, anims);
      else if (st.dash) {
        const arr = st.dash.length % 2 === 1 ? [...st.dash, ...st.dash] : st.dash;
        attrs.push(["stroke-dasharray", arr.map((v) => f(v)).join(" ")]);
      }
    }

    // opacity lives on the element itself for shapes
    const opKeys = n.tracks.opacity;
    if (opKeys) {
      attrs.push(["opacity", f(this.poster(opKeys) as number, 3)]);
      anims.push(this.kf(this.cls(id, "o"), opKeys, (v) => `opacity:${f(v as number, 3)}`));
    } else if (n.transform.opacity !== 1) attrs.push(["opacity", f(n.transform.opacity, 3)]);

    if (anims.length > 0) {
      attrs.unshift(["class", cls]);
      this.sheet.rule(cls, anims, false);
    }
    if (children.length === 0 && !posterGradient) return this.element(tag, attrs, children);

    // CSS cannot pause SMIL. Show the same shape at its sampled poster geometry
    // when reduced motion is requested, retaining its paint and wrapper state.
    this.hasGeometryAnimation = true;
    const animated = this.element(tag, attrs, children);
    if (posterGradient) setAttr(attrs, "fill", `url(#${posterGradient})`);
    const poster = this.element(tag, attrs, []);
    return `<g class="${this.p}__geometry-motion">${animated}</g><g class="${this.p}__geometry-poster" display="none">${poster}</g>`;
  }

  /** Trim paths as dash values on a path of length 1. */
  private trim(n: NShape, trim: { start: number; end: number; offset: number }, closed: boolean, attrs: Attr[], anims: string[]): void {
    const dash = (v: number[]): { vis: number; off: number } => {
      const lo = Math.min(v[0] as number, v[1] as number);
      const hi = Math.max(v[0] as number, v[1] as number);
      return { vis: Math.max(0, Math.min(1, hi - lo)), off: -(lo + (v[2] as number)) };
    };
    // A closed path wraps, so the pattern repeats once per path length. An open path does not wrap.
    const decl = (v: number[]): string => {
      const { vis, off } = dash(v);
      return `stroke-dasharray:${f(vis, 5)} ${f(closed ? Math.max(0, 1 - vis) : 1, 5)};stroke-dashoffset:${f(off, 5)}`;
    };
    const { tracks } = n;
    const keys = this.vector([tracks["trim.start"], tracks["trim.end"], tracks["trim.offset"]], [trim.start, trim.end, trim.offset], `${n.id}.trim`);
    const st = n.stroke as NonNullable<NShape["stroke"]>;
    const roundCaps = st.cap !== 1;
    attrs.push(["pathLength", "1"]);
    if (!keys) {
      const { vis, off } = dash([trim.start, trim.end, trim.offset]);
      attrs.push(["stroke-dasharray", `${f(vis, 5)} ${f(closed ? Math.max(0, 1 - vis) : 1, 5)}`], ["stroke-dashoffset", f(off, 5)]);
      if (vis <= EPS && roundCaps) setAttr(attrs, "stroke-opacity", "0");
      return;
    }
    const poster = dash(this.posterOf(keys));
    attrs.push(["stroke-dasharray", `${f(poster.vis, 5)} ${f(closed ? Math.max(0, 1 - poster.vis) : 1, 5)}`], ["stroke-dashoffset", f(poster.off, 5)]);
    anims.push(this.sheet.keyframes(this.cls(n.id, "trim"), this.frames(keys, (k) => decl(k.v))));

    // A zero-length dash still draws a dot with a round or square cap. Hide the stroke while the length is zero.
    if (roundCaps && keys.some((k) => dash(k.v).vis <= EPS)) {
      const alpha = f(st.color[3], 4);
      const entries: { at: string; v: string; timing: boolean }[] = [];
      keys.forEach((k, i) => {
        const zero = dash(k.v).vis <= EPS;
        entries.push({ at: i === 0 || i === keys.length - 1 ? pct(k.t, this.total) : pctAfterStep(k.t, this.total), v: zero ? "0" : alpha, timing: i < keys.length - 1 });
        const next = keys[i + 1];
        if (zero && next) {
          const nudged = parseFloat(pct(k.t, this.total)) + 1e-4;
          entries.push({ at: `${Math.round(nudged * 1e4) / 1e4}%`, v: dash(next.v).vis <= EPS ? "0" : alpha, timing: true });
        }
      });
      const frames = entries.map((e) => `${e.at}{stroke-opacity:${e.v}${e.timing ? ";animation-timing-function:step-end" : ""}}`);
      anims.push(this.sheet.keyframes(this.cls(n.id, "guard"), frames));
      if (dash(this.posterOf(keys)).vis <= EPS) setAttr(attrs, "stroke-opacity", "0");
    }
  }

  private element(tag: string, attrs: Attr[], children: string[]): string {
    const a = attrs.map(([k, v]) => ` ${k}="${escapeAttr(v)}"`).join("");
    return children.length === 0 ? `<${tag}${a}/>` : `<${tag}${a}>${children.join("")}</${tag}>`;
  }

  // ---------------------------------------------------------------- nodes

  private image(n: NImage): string {
    const attrs: Attr[] = [["href", this.opts.images?.[n.src] ?? ""], ["width", f(n.w)], ["height", f(n.h)]];
    const anims: string[] = [];
    const opKeys = n.tracks.opacity;
    if (opKeys) {
      attrs.push(["opacity", f(this.poster(opKeys) as number, 3)]);
      anims.push(this.kf(this.cls(n.id, "o"), opKeys, (v) => `opacity:${f(v as number, 3)}`));
    } else if (n.transform.opacity !== 1) attrs.push(["opacity", f(n.transform.opacity, 3)]);
    if (anims.length > 0) {
      const cls = this.cls(n.id, "sh");
      attrs.unshift(["class", cls]);
      this.sheet.rule(cls, anims, false);
    }
    return this.element("image", attrs, []);
  }

  /**
   * An instance of a definition. **Verified in phase 3:** Chromium does not run the CSS animations of
   * the content a `<use>` points at, so an animated definition is written out once per instance.
   * Identical keyframe blocks are still written only once. A static definition stays a shared `<use>`.
   */
  private instance(n: NUse): string {
    const def = this.scene.defs[n.ref] as NNode;
    if (!this.isStatic(def)) {
      const outer = this.scope;
      this.scope = outer === "" ? n.id : `${outer}_${n.id}`;
      try {
        return this.node(def);
      } finally {
        this.scope = outer;
      }
    }
    const id = `${this.p}__def-${n.ref}`;
    if (!this.defDone.has(n.ref)) {
      this.defDone.add(n.ref);
      const outer = this.scope;
      this.scope = "";
      const body = this.node(def);
      this.scope = outer;
      this.defs.push(`<g id="${id}">${body}</g>`);
    }
    return `<use href="#${id}"/>`;
  }

  private content(n: NNode): string {
    switch (n.type) {
      case "group": {
        const kids = this.fault === "svg-reverse-order" ? [...(n as NGroup).children].reverse() : (n as NGroup).children;
        return kids.filter((c) => !c.matteSource).map((c) => this.node(c)).join("");
      }
      case "use":
        return this.instance(n);
      case "image":
        return this.image(n);
      case "lottie":
        // compileSceneValue never asks for an SVG of a scene that has one.
        throw new Error(`node '${n.id}' places a Lottie file, which the SVG output cannot show`);
      default:
        return this.shape(n);
    }
  }

  /**
   * The mask for a matte source, written once in `<defs>`. It sits outside the matted node's own
   * transforms, so source and node share the coordinate space of their parent, as siblings do.
   * `alpha` is an alpha mask. `alpha-inverted` is a luminance mask: a white rectangle with the
   * source drawn over it in black. The source is recoloured by a rule scoped to the mask, which
   * beats the source's own fills and their animations; strokes are recoloured only where the
   * shape has one, and a transparent source colour leaves the white partly showing.
   * **Verified in phase 10:** CSS and SMIL animation inside a mask runs in Chromium and WebKit,
   * inline and through an `<img>`.
   */
  private mask(n: NNode): string | undefined {
    const m = n.matte;
    const source = m ? this.byId.get(m.by) : undefined;
    if (!m || !source) return undefined;
    const inverted = m.mode === "alpha-inverted";
    const id = this.cls(m.by, inverted ? "matte-inv" : "matte");
    if (!this.maskDone.has(id)) {
      this.maskDone.add(id);
      const edge = Math.max(this.scene.w, this.scene.h);
      const box = `x="${-edge}" y="${-edge}" width="${this.scene.w + 2 * edge}" height="${this.scene.h + 2 * edge}"`;
      const body = this.node(source);
      if (inverted) {
        const black = `${id}__src`;
        this.sheet.rules.push(`.${black} [fill]:not([fill="none"]){fill:#000!important}`, `.${black} [stroke]{stroke:#000!important}`);
        this.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" ${box}><rect ${box} fill="#fff"/><g class="${black}">${body}</g></mask>`);
      } else this.defs.push(`<mask id="${id}" maskUnits="userSpaceOnUse" ${box} mask-type="alpha" style="mask-type:alpha">${body}</mask>`);
    }
    return id;
  }

  /** One node as a chain of wrappers around its content. */
  node(n: NNode): string {
    const pivot: Vec2 = this.fault === "svg-no-pivot" ? [0, 0] : n.transform.pivot;
    const [px, py] = pivot;
    const maskId = this.mask(n);
    const wrappers: Wrapper[] = [...(maskId ? [{ mask: maskId }] : []), ...this.windowWrapper(n)];
    if (n.type === "group" || n.type === "use") wrappers.push(...this.opacityWrapper(n));
    wrappers.push(...this.translateWrappers(n, px, py), ...this.rotateWrapper(n), ...this.scaleWrapper(n));
    if (px !== 0 || py !== 0) wrappers.push({ tf: `translate(${f(-px)} ${f(-py)})` });
    if (n.clip) {
      const cid = this.cls(n.id, "clip");
      this.defs.push(`<clipPath id="${cid}"><path d="${pathData(n.clip)}"/></clipPath>`);
      wrappers.push({ clip: cid });
    }
    const { open, close } = this.open(wrappers);
    return `${open.join("")}${this.content(n)}${"</g>".repeat(close)}`;
  }

  emit(): SvgResult {
    const s = this.scene;
    const nodes = (this.fault === "svg-reverse-order" ? [...s.nodes].reverse() : s.nodes).filter((n) => !n.matteSource);
    const body = nodes.map((n) => this.node(n));
    if (s.background) {
      const [, , , a] = s.background;
      body.unshift(`<rect width="${s.w}" height="${s.h}" fill="${hex(s.background)}"${a < 1 ? ` fill-opacity="${f(a, 4)}"` : ""}/>`);
    }
    const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${s.w} ${s.h}" width="${s.w}" height="${s.h}">`];
    if (this.sheet.animated || this.hasGeometryAnimation) {
      const geometry = this.hasGeometryAnimation
        ? `\n@media (prefers-reduced-motion:reduce){.${this.p}__geometry-motion{display:none}.${this.p}__geometry-poster{display:inline}}`
        : "";
      out.push(`<style>\n${this.sheet.text()}${geometry}\n</style>`);
    }
    if (this.defs.length > 0) out.push(`<defs>\n${this.defs.join("\n")}\n</defs>`);
    out.push(...body.map((b) => b.replace(/></g, ">\n<")));
    out.push("</svg>");
    return { svg: out.join("\n") + "\n", baked: this.baked };
  }
}

function setAttr(attrs: Attr[], key: string, value: string): void {
  const i = attrs.findIndex(([k]) => k === key);
  if (i >= 0) attrs[i] = [key, value];
  else attrs.push([key, value]);
}

/** Compiles a normalized scene to one self-contained animated SVG. Pure: no file access. */
export function emitSvg(scene: NScene, opts: SvgEmitOptions = {}): SvgResult {
  return new SvgEmitter(scene, opts).emit();
}
