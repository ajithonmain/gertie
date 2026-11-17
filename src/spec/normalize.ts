import { parseHex, type Rgba } from "./color.ts";
import { ellipseSubpath, parsePath, rectSubpaths, type Subpath, type Vec2 } from "./path.ts";
import { readKey } from "./keys.ts";
import { expandScene } from "../presets/expand.ts";
import { DEFAULT_EASE, resolveEase, type Ease } from "../presets/easing.ts";
import type { MatteMode, NGradient, NKey, NNode, NScene, NStroke, NStyle, NTracks, NTransform, NMarker, Tier, TrackName, TrackValue } from "./types.ts";

type Obj = Record<string, unknown>;
const CAP = { butt: 1, round: 2, square: 3 } as const;
const JOIN = { miter: 1, round: 2, bevel: 3 } as const;

function num(v: unknown, d: number): number {
  return typeof v === "number" ? v : d;
}

function pair(v: unknown, d: Vec2): Vec2 {
  if (typeof v === "number") return [v, v];
  if (Array.isArray(v)) return [v[0] as number, v[1] as number];
  return d;
}

function polyPath(points: Vec2[], closed: boolean): Subpath {
  return { closed, v: points, i: points.map(() => [0, 0] as Vec2), o: points.map(() => [0, 0] as Vec2) };
}

/**
 * Turns a lint-clean scene into the form both emitters consume.
 * The input must already have passed `lintScene` without errors.
 */
export function normalizeScene(raw: unknown): NScene {
  const s = expandScene(raw).scene as Obj;
  const palette = (s["palette"] ?? {}) as Record<string, string>;
  const fps = num(s["fps"], 30);
  const duration = s["duration"] as number;
  const totalFrames = Math.max(1, Math.round(duration * fps));
  const canvas = s["canvas"] as Obj;

  const colorOf = (v: unknown): Rgba => {
    const str = v as string;
    return parseHex(str.startsWith("$") ? (palette[str.slice(1)] as string) : str) as Rgba;
  };
  const frameOf = (t: number): number => Math.round(t * fps);

  const track = (prop: string, rawKeys: unknown[]): NKey[] => {
    const keys: NKey[] = rawKeys.map((k, i) => {
      const r = readKey(k, i);
      if (!r.ok) throw new Error(`normalize: bad keyframe at ${prop}[${i}]`);
      const e = resolveEase(r.key.ease);
      const ease: Ease = e.kind === "ok" ? e.ease : DEFAULT_EASE;
      return { t: frameOf(r.key.time), v: keyValue(prop, r.key.value), ease };
    });
    const first = keys[0] as NKey;
    const last = keys[keys.length - 1] as NKey;
    if (first.t > 0) {
      first.ease = "hold";
      keys.unshift({ t: 0, v: first.v, ease: DEFAULT_EASE });
    }
    if (last.t < totalFrames) keys.push({ t: totalFrames, v: last.v, ease: "hold" });
    return keys;
  };

  const keyValue = (prop: string, v: unknown): TrackValue => {
    if (prop === "scale") return pair(v, [1, 1]);
    if (prop === "fill.from" || prop === "fill.to" || prop === "fill.center") return pair(v, [0, 0]);
    if (prop === "fill" || prop === "stroke.color") return colorOf(v);
    if (prop === "d") return parsePath(v as string);
    return v as number;
  };

  const transform = (n: Obj): NTransform => ({
    x: num(n["x"], 0),
    y: num(n["y"], 0),
    rotation: num(n["rotation"], 0),
    scale: pair(n["scale"], [1, 1]),
    opacity: num(n["opacity"], 1),
    pivot: pair(n["pivot"], [0, 0]),
  });

  const clipPath = (c: Obj): Subpath[] => {
    const x = num(c["x"], 0);
    const y = num(c["y"], 0);
    let sp: Subpath[];
    if (c["type"] === "rect") sp = rectSubpaths(x, y, c["w"] as number, c["h"] as number, num(c["radius"], 0));
    else if (c["type"] === "ellipse") {
      const r = c["r"] as number | undefined;
      sp = [ellipseSubpath(x, y, num(c["rx"], r ?? 0), num(c["ry"], r ?? 0))];
    } else {
      sp = parsePath(c["d"] as string).map((p) => ({
        closed: p.closed,
        v: p.v.map(([px, py]) => [px + x, py + y] as Vec2),
        i: p.i,
        o: p.o,
      }));
    }
    return sp;
  };

  const style = (n: Obj, tracks: NTracks): NStyle => {
    const fillRaw = n["fill"];
    let fill: NStyle["fill"] = null;
    if (typeof fillRaw === "string") fill = colorOf(fillRaw);
    else if (fillRaw !== null && typeof fillRaw === "object") {
      const g = fillRaw as Obj;
      const stops = (g["stops"] as [number, string][]).map(([offset, c]) => ({ offset, color: colorOf(c) }));
      fill =
        g["type"] === "linear"
          ? ({ type: "linear", from: g["from"] as Vec2, to: g["to"] as Vec2, stops } satisfies NGradient)
          : ({ type: "radial", center: g["center"] as Vec2, radius: g["radius"] as number, stops } satisfies NGradient);
    }
    if (tracks.fill && typeof fillRaw === "string") fill = (tracks.fill[0] as NKey).v as Rgba;

    let stroke: NStroke | null = null;
    const sr = n["stroke"];
    if (sr !== null && typeof sr === "object") {
      const st = sr as Obj;
      stroke = {
        color: colorOf(st["color"]),
        width: num(st["width"], 2),
        cap: CAP[(st["cap"] as keyof typeof CAP) ?? "round"],
        join: JOIN[(st["join"] as keyof typeof JOIN) ?? "round"],
        dash: Array.isArray(st["dash"]) ? (st["dash"] as number[]) : null,
      };
      if (tracks["stroke.color"]) stroke.color = (tracks["stroke.color"][0] as NKey).v as Rgba;
      if (tracks["stroke.width"]) stroke.width = (tracks["stroke.width"][0] as NKey).v as number;
    }
    let trim: NStyle["trim"] = null;
    if (n["trim"] !== null && typeof n["trim"] === "object" && stroke) {
      const t = n["trim"] as Obj;
      trim = { start: num(t["start"], 0), end: num(t["end"], 1), offset: num(t["offset"], 0) };
    } else if (stroke && (tracks["trim.start"] || tracks["trim.end"] || tracks["trim.offset"])) {
      trim = { start: 0, end: 1, offset: 0 };
    }
    return { fill, fillRule: n["fillRule"] === "evenodd" ? 2 : 1, stroke, trim };
  };

  // Ids are unique across the scene, so one set tells every node whether a sibling uses it as a matte.
  const sources = new Set<string>();
  const findSources = (list: unknown): void => {
    if (!Array.isArray(list)) return;
    for (const c of list as Obj[]) {
      const m = c["matte"];
      if (m !== null && typeof m === "object" && typeof (m as Obj)["by"] === "string") sources.add((m as Obj)["by"] as string);
      findSources(c["children"]);
    }
  };
  findSources(s["nodes"]);
  findSources(Object.values((s["defs"] ?? {}) as Record<string, Obj>));

  const node = (n: Obj): NNode => {
    const type = n["type"] as string;
    const tracks: NTracks = {};
    const animate = (n["animate"] ?? {}) as Obj;
    for (const [prop, keys] of Object.entries(animate)) {
      const list = track(prop, keys as unknown[]);
      if (type === "ellipse" && prop === "r") {
        tracks.rx = list;
        tracks.ry = list.map((k) => ({ ...k }));
      } else tracks[prop as TrackName] = list;
    }
    const from = Math.min(frameOf(num(n["from"], 0)), totalFrames - 1);
    const to = Math.max(from + 1, n["to"] === undefined ? totalFrames : Math.min(frameOf(n["to"] as number), totalFrames));
    const m = n["matte"];
    const matte = m !== null && typeof m === "object" ? { by: (m as Obj)["by"] as string, mode: ((m as Obj)["mode"] ?? "alpha") as MatteMode } : undefined;
    const base = {
      id: n["id"] as string,
      from,
      to,
      transform: transform(n),
      tracks,
      clip: n["clip"] ? clipPath(n["clip"] as Obj) : null,
      ...(matte ? { matte } : {}),
      ...(sources.has(n["id"] as string) ? { matteSource: true as const } : {}),
    };
    switch (type) {
      case "group":
        return { ...base, type: "group", children: (n["children"] as Obj[]).map(node) };
      case "use":
        return { ...base, type: "use", ref: n["ref"] as string };
      case "image":
        return { ...base, type: "image", src: n["src"] as string, w: n["w"] as number, h: n["h"] as number };
      case "lottie":
        return { ...base, type: "lottie", src: n["src"] as string };
      case "rect":
        return { ...base, ...style(n, tracks), type: "rect", w: n["w"] as number, h: n["h"] as number, radius: num(n["radius"], 0) };
      case "ellipse": {
        const r = n["r"] as number | undefined;
        const rx = num(n["rx"], r ?? 0);
        const ry = num(n["ry"], r ?? 0);
        return { ...base, ...style(n, tracks), type: "ellipse", rx, ry };
      }
      case "path":
        return { ...base, ...style(n, tracks), type: "path", d: parsePath(n["d"] as string) };
      case "line": {
        const p = polyPath(
          [
            [n["x1"] as number, n["y1"] as number],
            [n["x2"] as number, n["y2"] as number],
          ],
          false,
        );
        return { ...base, ...style(n, tracks), type: "path", d: [p] };
      }
      case "polygon":
      case "star": {
        const count = n["points"] as number;
        const r = n["r"] as number;
        const inner = type === "star" ? (n["innerR"] as number) : r;
        const verts: Vec2[] = [];
        const steps = type === "star" ? count * 2 : count;
        for (let k = 0; k < steps; k++) {
          const radius = type === "star" && k % 2 === 1 ? inner : r;
          const a = -Math.PI / 2 + (k * 2 * Math.PI) / steps;
          verts.push([radius * Math.cos(a), radius * Math.sin(a)]);
        }
        return { ...base, ...style(n, tracks), type: "path", d: [polyPath(verts, true)] };
      }
      default:
        throw new Error(`normalize: unknown node type ${type}`);
    }
  };

  const defs: Record<string, NNode> = {};
  for (const [k, v] of Object.entries((s["defs"] ?? {}) as Record<string, Obj>)) defs[k] = node(v);

  const markers: NMarker[] = Object.entries((s["markers"] ?? {}) as Record<string, [number, number]>).map(([name, [a, b]]) => {
    const start = Math.min(totalFrames, Math.max(0, frameOf(a)));
    return { name, start, end: Math.min(totalFrames, Math.max(start, frameOf(b))) };
  });

  const bg = canvas["background"];
  return {
    name: s["name"] as string,
    w: canvas["w"] as number,
    h: canvas["h"] as number,
    background: typeof bg === "string" ? colorOf(bg) : null,
    fps,
    totalFrames,
    loop: s["loop"] !== false,
    posterFrame: Math.min(totalFrames - 1, Math.max(0, frameOf(num(s["poster"], 0)))),
    ...(typeof s["tier"] === "string" ? { tier: s["tier"] as Tier } : {}),
    markers,
    nodes: (s["nodes"] as Obj[]).map(node),
    defs,
  };
}
