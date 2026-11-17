import type { Json, JObj } from "./time.ts";

const isObj = (v: unknown): v is JObj => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
export const toHex = (rgb: readonly number[]): string => `#${hex2((rgb[0] ?? 0) * 255)}${hex2((rgb[1] ?? 0) * 255)}${hex2((rgb[2] ?? 0) * 255)}`;

export function parseHex6(s: string): [number, number, number] | undefined {
  const t = s.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(t)) return [parseInt(t[1]! + t[1]!, 16), parseInt(t[2]! + t[2]!, 16), parseInt(t[3]! + t[3]!, 16)];
  if (/^#[0-9a-f]{6}$/.test(t)) return [parseInt(t.slice(1, 3), 16), parseInt(t.slice(3, 5), 16), parseInt(t.slice(5, 7), 16)];
  return undefined;
}

export type ColorUse = "fill" | "stroke" | "gradient-fill" | "gradient-stroke" | "solid-layer";

/** One place a colour appears. `read` and `write` are given an rgb array in 0 to 1 and the stored array to edit in place. */
interface Slot {
  use: ColorUse;
  /** The array holding the colour: `[r, g, b, a?]` at `at`, or a gradient stop list at `at` with stride info. */
  arr: number[];
  at: number;
}

function slotsOfColorProp(prop: unknown, use: ColorUse, out: Slot[]): void {
  if (!isObj(prop)) return;
  const k = prop["k"];
  if (Array.isArray(k) && k.length > 0 && typeof k[0] === "number") out.push({ use, arr: k as number[], at: 0 });
  else if (Array.isArray(k)) {
    for (const kf of k) {
      if (!isObj(kf)) continue;
      for (const key of ["s", "e"]) {
        const v = kf[key];
        if (Array.isArray(v) && typeof v[0] === "number") out.push({ use, arr: v as number[], at: 0 });
      }
    }
  }
}

/** A gradient's `g` property holds `p` colour stops as `[offset, r, g, b]` runs, then optional `[offset, alpha]` pairs. */
function slotsOfGradient(g: unknown, use: ColorUse, out: Slot[]): void {
  if (!isObj(g)) return;
  const p = g["p"];
  const stops = isNum(p) ? p : undefined;
  const prop = g["k"];
  if (!isObj(prop) || stops === undefined) return;
  const lists: number[][] = [];
  const k = prop["k"];
  if (Array.isArray(k) && typeof k[0] === "number") lists.push(k as number[]);
  else if (Array.isArray(k)) {
    for (const kf of k) {
      if (!isObj(kf)) continue;
      for (const key of ["s", "e"]) {
        const v = kf[key];
        if (Array.isArray(v) && typeof v[0] === "number") lists.push(v as number[]);
      }
    }
  }
  for (const arr of lists) for (let i = 0; i < stops; i++) out.push({ use, arr, at: i * 4 + 1 });
}

/** Finds every colour in a Lottie document. Effects and text colours are not covered. */
export function findColorSlots(doc: Json): Slot[] {
  const out: Slot[] = [];
  const walk = (v: Json): void => {
    if (Array.isArray(v)) return void v.forEach(walk);
    if (!isObj(v)) return;
    const ty = v["ty"];
    if (ty === "fl") slotsOfColorProp(v["c"], "fill", out);
    else if (ty === "st") slotsOfColorProp(v["c"], "stroke", out);
    else if (ty === "gf") slotsOfGradient(v["g"], "gradient-fill", out);
    else if (ty === "gs") slotsOfGradient(v["g"], "gradient-stroke", out);
    for (const x of Object.values(v)) walk(x);
  };
  walk(doc);
  return out;
}

/** Solid layers (`ty` 1) keep their colour as a hex string in `sc`. */
function solidLayers(doc: JObj): JObj[] {
  const out: JObj[] = [];
  const add = (layers: Json): void => {
    if (Array.isArray(layers)) for (const l of layers) if (isObj(l) && l["ty"] === 1 && typeof l["sc"] === "string") out.push(l);
  };
  add(doc["layers"] as Json);
  if (Array.isArray(doc["assets"])) for (const a of doc["assets"]) if (isObj(a)) add(a["layers"] as Json);
  return out;
}

export interface ColorCount {
  hex: string;
  count: number;
  usedIn: ColorUse[];
}

/** The distinct colours in a document with how often each is used, most used first. */
export function listColors(doc: JObj): ColorCount[] {
  const map = new Map<string, { count: number; uses: Set<ColorUse> }>();
  const bump = (hex: string, use: ColorUse): void => {
    const e = map.get(hex) ?? { count: 0, uses: new Set<ColorUse>() };
    e.count++;
    e.uses.add(use);
    map.set(hex, e);
  };
  for (const s of findColorSlots(doc)) bump(toHex(s.arr.slice(s.at, s.at + 3)), s.use);
  for (const l of solidLayers(doc)) {
    const rgb = parseHex6(l["sc"] as string);
    if (rgb) bump(`#${hex2(rgb[0])}${hex2(rgb[1])}${hex2(rgb[2])}`, "solid-layer");
  }
  return [...map.entries()].map(([hex, e]) => ({ hex, count: e.count, usedIn: [...e.uses] })).sort((a, b) => b.count - a.count || a.hex.localeCompare(b.hex));
}

export interface ColorMapping {
  from: string;
  to: string;
}

export interface Recolored {
  doc: JObj;
  /** How many colour values were replaced, per mapping, in the order given. */
  replaced: { from: string; to: string; count: number }[];
}

/** Parses `#ff0000=#3b82f6,#00ff00=#111111`. Throws with a message naming the bad part. */
export function parseColorMap(text: string): ColorMapping[] {
  const out: ColorMapping[] = [];
  for (const part of text.split(",").map((p) => p.trim()).filter((p) => p !== "")) {
    const [a, b, ...rest] = part.split("=").map((p) => p.trim());
    if (a === undefined || b === undefined || rest.length > 0 || !parseHex6(a) || !parseHex6(b)) throw new Error(`'${part}' is not a colour pair. Write it as #ff0000=#3b82f6, with 3 or 6 digit hex colours, and separate several pairs with commas`);
    out.push({ from: a.toLowerCase(), to: b.toLowerCase() });
  }
  if (out.length === 0) throw new Error("the colour map is empty. Write it as #ff0000=#3b82f6");
  return out;
}

/**
 * Replaces colours throughout a Lottie document: fills, strokes, gradient stops and solid layers, including animated colours.
 * A colour matches when each of its red, green and blue values, as 0 to 255, is within `tolerance` of the mapping's source.
 * Alpha is kept. The first matching mapping wins.
 */
export function recolorLottie(doc: JObj, map: readonly ColorMapping[], tolerance = 0): Recolored {
  const copy = structuredClone(doc) as JObj;
  const rules = map.map((m) => ({ ...m, rgb: parseHex6(m.from) as [number, number, number], to: parseHex6(m.to) as [number, number, number], count: 0 }));
  const find = (rgb: readonly number[]): (typeof rules)[number] | undefined =>
    rules.find((r) => [0, 1, 2].every((i) => Math.abs(Math.round((rgb[i] ?? 0) * 255) - (r.rgb[i] as number)) <= tolerance));
  const put = (v: number): number => Math.round((v / 255) * 10000) / 10000;

  for (const s of findColorSlots(copy)) {
    const rule = find(s.arr.slice(s.at, s.at + 3));
    if (!rule) continue;
    for (let i = 0; i < 3; i++) s.arr[s.at + i] = put(rule.to[i] as number);
    rule.count++;
  }
  for (const l of solidLayers(copy)) {
    const rgb = parseHex6(l["sc"] as string);
    if (!rgb) continue;
    const rule = find([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255]);
    if (!rule) continue;
    l["sc"] = rule.to.reduce((a, v) => a + hex2(v), "#");
    rule.count++;
  }
  return { doc: copy, replaced: rules.map((r) => ({ from: r.from, to: r.to.reduce((a, v) => a + hex2(v), "#"), count: r.count })) };
}
