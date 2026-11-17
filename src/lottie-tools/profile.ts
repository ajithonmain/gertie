import { inspectLottie } from "./inspect.ts";
import { listColors } from "./colors.ts";
import type { Json, JObj } from "./time.ts";

const isObj = (v: unknown): v is JObj => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const round = (v: number, places: number): number => {
  const f = 10 ** places;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
};

/** Structural features the profile reports, in the order they are listed. */
export const PROFILE_FEATURES = [
  "parenting",
  "precompositions",
  "null-layers",
  "mattes",
  "masks",
  "path-morphing",
  "gradient-fills",
  "gradient-strokes",
  "strokes",
  "trim-paths",
  "merge-paths",
  "repeater",
  "rounded-corners",
  "markers",
  "effects",
  "blend-modes",
  "images",
  "solid-layers",
  "text-layers",
  "time-remapping",
  "expressions",
] as const;
export type ProfileFeature = (typeof PROFILE_FEATURES)[number];

/**
 * The measurements of `docs/16-quality-benchmark.md`, taken from one Lottie document.
 * Every count is over the whole file, precompositions included.
 */
export interface Profile {
  canvas: { w: number; h: number; longSide: number };
  frameRate: number;
  durationSeconds: number;
  /** Layers of the main composition plus the layers of every precomposition. */
  layers: number;
  /** Free-form path shapes (`sh`). Rectangles, ellipses and stars are not counted. */
  paths: number;
  /** Vertices of every path, read from the first keyframe when the path is animated. */
  vertices: number;
  /** Vertices divided by paths, 0 when there are no paths. */
  verticesPerPath: number;
  /** Distinct colours of solid fills, strokes and solid layers, compared as #rrggbb. Gradient stops are not counted. */
  colours: number;
  /** Gradient fills and gradient strokes. */
  gradients: number;
  animatedProperties: number;
  keyframes: number;
  keyframesPerSecond: number;
  /** Share of keyframe segments with a non-linear, non-hold ease. 0 when there are no segments. */
  easedShare: number;
  /** Distinct easing curves over every non-hold segment, with handles rounded to one decimal. */
  easingCurves: number;
  medianKeysPerProperty: number;
  /** Share of animated properties whose motion starts on a frame no other property's motion starts on. */
  ownStartShare: number;
  /** Share of animated properties that end on the value they start with. */
  closedLoopShare: number;
  features: ProfileFeature[];
}

interface Key {
  t: number;
  value: Json | undefined;
  hold: boolean;
  /** Outgoing handle `[x, y]` and incoming handle `[x, y]` of the segment that leaves this key, first dimension. */
  out?: [number, number];
  in?: [number, number];
}

/** A keyframe list: the `k` of an animated property, whose items have a numeric `t`. */
function isKeyframes(v: unknown): v is JObj[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && isNum(x["t"]));
}

/** The first number of a handle component, which may be a number or an array of numbers. */
function first(v: Json | undefined): number | undefined {
  if (isNum(v)) return v;
  if (Array.isArray(v) && isNum(v[0])) return v[0];
  return undefined;
}

function handle(h: Json | undefined): [number, number] | undefined {
  if (!isObj(h)) return undefined;
  const x = first(h["x"]);
  const y = first(h["y"]);
  return x !== undefined && y !== undefined ? [x, y] : undefined;
}

function readKeys(k: JObj[]): Key[] {
  const keys: Key[] = [];
  let prevEnd: Json | undefined;
  for (const kf of k) {
    // Older files store the end value of a segment as `e` on its first key instead of `s` on the next.
    const value = kf["s"] !== undefined ? kf["s"] : prevEnd;
    const key: Key = { t: kf["t"] as number, value, hold: kf["h"] === 1 };
    const o = handle(kf["o"]);
    const i = handle(kf["i"]);
    if (o) key.out = o;
    if (i) key.in = i;
    keys.push(key);
    prevEnd = kf["e"] !== undefined ? kf["e"] : undefined;
  }
  return keys;
}

/** Equal within 0.001 for every number, so values that differ only by rounding count as the same. */
function sameValue(a: Json | undefined, b: Json | undefined): boolean {
  if (isNum(a) && isNum(b)) return Math.abs(a - b) <= 1e-3;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => sameValue(x, b[i]));
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    return ka.length === Object.keys(b).length && ka.every((k) => sameValue(a[k], b[k]));
  }
  return a === b;
}

function pathVertices(ks: Json | undefined): number {
  if (!isObj(ks)) return 0;
  const k = ks["k"];
  let shape: Json | undefined = k;
  if (isKeyframes(k)) {
    const s = k[0]?.["s"];
    shape = Array.isArray(s) ? s[0] : undefined;
  }
  if (!isObj(shape) || !Array.isArray(shape["v"])) return 0;
  return shape["v"].length;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

/** Measures a Lottie document the way `docs/16-quality-benchmark.md` measured the reference. Pure. */
export function profileLottie(doc: JObj): Profile {
  const used = new Set<ProfileFeature>();
  let layers = 0;
  let paths = 0;
  let vertices = 0;
  let gradients = 0;

  const shapeItems = (items: Json | undefined): void => {
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!isObj(it)) continue;
      switch (it["ty"]) {
        case "gr":
          shapeItems(it["it"]);
          break;
        case "sh":
          paths++;
          vertices += pathVertices(it["ks"]);
          if (isObj(it["ks"]) && isKeyframes(it["ks"]["k"])) used.add("path-morphing");
          break;
        case "gf":
          gradients++;
          used.add("gradient-fills");
          break;
        case "gs":
          gradients++;
          used.add("gradient-strokes");
          break;
        case "st":
          used.add("strokes");
          break;
        case "tm":
          used.add("trim-paths");
          break;
        case "mm":
          used.add("merge-paths");
          break;
        case "rp":
          used.add("repeater");
          break;
        case "rd":
          used.add("rounded-corners");
          break;
      }
    }
  };

  const layerList = (list: Json | undefined): void => {
    if (!Array.isArray(list)) return;
    for (const l of list) {
      if (!isObj(l)) continue;
      layers++;
      if (isNum(l["parent"])) used.add("parenting");
      if (l["ty"] === 0) used.add("precompositions");
      if (l["ty"] === 1) used.add("solid-layers");
      if (l["ty"] === 2) used.add("images");
      if (l["ty"] === 3) used.add("null-layers");
      if (l["ty"] === 5) used.add("text-layers");
      if (l["tt"] !== undefined || l["td"] === 1) used.add("mattes");
      if (Array.isArray(l["masksProperties"]) && l["masksProperties"].length > 0) used.add("masks");
      if (Array.isArray(l["ef"]) && l["ef"].length > 0) used.add("effects");
      if (isNum(l["bm"]) && l["bm"] !== 0) used.add("blend-modes");
      if (l["tm"] !== undefined) used.add("time-remapping");
      shapeItems(l["shapes"]);
    }
  };
  layerList(doc["layers"]);
  if (Array.isArray(doc["assets"])) for (const a of doc["assets"]) if (isObj(a)) layerList(a["layers"]);
  if (Array.isArray(doc["markers"]) && doc["markers"].length > 0) used.add("markers");
  if (inspectLottie(doc).features.expressions > 0) used.add("expressions");

  // Every object whose `k` is a keyframe list is one animated property, wherever it sits.
  const props: Key[][] = [];
  const walk = (v: Json): void => {
    if (Array.isArray(v)) return void v.forEach(walk);
    if (!isObj(v)) return;
    const k = v["k"];
    if (isKeyframes(k)) {
      props.push(readKeys(k));
      return;
    }
    for (const x of Object.values(v)) walk(x);
  };
  walk(doc["layers"] ?? null);
  walk(doc["assets"] ?? null);

  let keyframes = 0;
  let segments = 0;
  let eased = 0;
  const curves = new Set<string>();
  const starts: number[] = [];
  let closed = 0;
  for (const keys of props) {
    keyframes += keys.length;
    for (let i = 0; i + 1 < keys.length; i++) {
      const k = keys[i] as Key;
      segments++;
      if (k.hold || !k.out || !k.in) continue;
      const [ox, oy] = k.out;
      const [ix, iy] = k.in;
      curves.add([ox, oy, ix, iy].map((n) => round(n, 1)).join(","));
      const linear = Math.abs(ox - oy) <= 1e-3 && Math.abs(ix - iy) <= 1e-3;
      if (!linear) eased++;
    }
    // A property's motion starts at the first key whose value differs from the next one.
    let start = (keys[0] as Key).t;
    for (let i = 0; i + 1 < keys.length; i++) {
      if (!sameValue((keys[i] as Key).value, (keys[i + 1] as Key).value)) {
        start = (keys[i] as Key).t;
        break;
      }
    }
    starts.push(start);
    if (sameValue((keys[0] as Key).value, (keys[keys.length - 1] as Key).value)) closed++;
  }
  const startCount = new Map<number, number>();
  for (const s of starts) startCount.set(s, (startCount.get(s) ?? 0) + 1);
  const ownStarts = starts.filter((s) => startCount.get(s) === 1).length;

  const w = isNum(doc["w"]) ? doc["w"] : 0;
  const h = isNum(doc["h"]) ? doc["h"] : 0;
  const fr = isNum(doc["fr"]) ? doc["fr"] : 0;
  const ip = isNum(doc["ip"]) ? doc["ip"] : 0;
  const op = isNum(doc["op"]) ? doc["op"] : 0;
  const duration = fr > 0 ? (op - ip) / fr : 0;
  const colours = listColors(doc).filter((c) => c.usedIn.some((u) => u === "fill" || u === "stroke" || u === "solid-layer")).length;
  const n = props.length;

  return {
    canvas: { w, h, longSide: Math.max(w, h) },
    frameRate: fr,
    durationSeconds: round(duration, 3),
    layers,
    paths,
    vertices,
    verticesPerPath: paths > 0 ? round(vertices / paths, 2) : 0,
    colours,
    gradients,
    animatedProperties: n,
    keyframes,
    keyframesPerSecond: duration > 0 ? round(keyframes / duration, 2) : 0,
    easedShare: segments > 0 ? round(eased / segments, 3) : 0,
    easingCurves: curves.size,
    medianKeysPerProperty: median(props.map((p) => p.length)),
    ownStartShare: n > 0 ? round(ownStarts / n, 3) : 0,
    closedLoopShare: n > 0 ? round(closed / n, 3) : 0,
    features: PROFILE_FEATURES.filter((f) => used.has(f)),
  };
}
