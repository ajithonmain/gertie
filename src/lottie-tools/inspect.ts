import { listColors, type ColorCount } from "./colors.ts";
import { durationSeconds, type Json, type JObj } from "./time.ts";

const isObj = (v: unknown): v is JObj => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

const LAYER_TYPES: Record<number, string> = { 0: "precomp", 1: "solid", 2: "image", 3: "null", 4: "shape", 5: "text", 6: "audio", 13: "camera" };

export interface LayerInfo {
  index: number;
  name: string;
  type: string;
  in: number;
  out: number;
  parent?: number;
  precomp?: string;
  matte?: boolean;
  hidden?: boolean;
}

export interface Features {
  /** Property expressions. They only run in the web player. */
  expressions: number;
  effects: number;
  masks: number;
  mattes: number;
  timeRemaps: number;
  textLayers: number;
  imageAssets: number;
  externalImages: number;
  threeD: number;
  blendModes: number;
}

export interface LottieInfo {
  name?: string;
  /** The `v` field: the version of the tool that wrote the file. */
  version?: string;
  size: { w: number; h: number };
  frameRate: number;
  frames: { in: number; out: number };
  durationSeconds: number;
  layerCount: number;
  layerTypes: Record<string, number>;
  /** Layers of the main composition, in file order (top layer first). */
  layers: LayerInfo[];
  layersTruncated?: { shown: number; total: number };
  precomps: { id: string; layers: number }[];
  colors: ColorCount[];
  features: Features;
  /** Sentences about what an edit or an embed cannot be expected to do. */
  notes: string[];
}

const MAX_LAYERS = 60;

/** Describes a Lottie document without changing it. Pure. */
export function inspectLottie(doc: JObj): LottieInfo {
  const features: Features = { expressions: 0, effects: 0, masks: 0, mattes: 0, timeRemaps: 0, textLayers: 0, imageAssets: 0, externalImages: 0, threeD: 0, blendModes: 0 };
  const layerTypes: Record<string, number> = {};

  const scanLayers = (layers: Json, top: boolean): LayerInfo[] => {
    const out: LayerInfo[] = [];
    if (!Array.isArray(layers)) return out;
    layers.forEach((l, i) => {
      if (!isObj(l)) return;
      const ty = isNum(l["ty"]) ? l["ty"] : -1;
      const type = LAYER_TYPES[ty] ?? `type-${ty}`;
      if (top) layerTypes[type] = (layerTypes[type] ?? 0) + 1;
      if (ty === 5) features.textLayers++;
      if (Array.isArray(l["ef"]) && l["ef"].length > 0) features.effects++;
      if (Array.isArray(l["masksProperties"])) features.masks += l["masksProperties"].length;
      if (l["tt"] !== undefined || l["td"] === 1) features.mattes++;
      if (l["tm"] !== undefined) features.timeRemaps++;
      if (l["ddd"] === 1) features.threeD++;
      if (isNum(l["bm"]) && l["bm"] !== 0) features.blendModes++;
      if (top) {
        const info: LayerInfo = { index: isNum(l["ind"]) ? l["ind"] : i + 1, name: typeof l["nm"] === "string" ? l["nm"] : "", type, in: isNum(l["ip"]) ? l["ip"] : 0, out: isNum(l["op"]) ? l["op"] : 0 };
        if (isNum(l["parent"])) info.parent = l["parent"];
        if (typeof l["refId"] === "string") info.precomp = l["refId"];
        if (l["tt"] !== undefined) info.matte = true;
        if (l["hd"] === true) info.hidden = true;
        out.push(info);
      }
    });
    return out;
  };

  const layers = scanLayers(doc["layers"] as Json, true);
  const precomps: LottieInfo["precomps"] = [];
  if (Array.isArray(doc["assets"])) {
    for (const a of doc["assets"]) {
      if (!isObj(a)) continue;
      if (Array.isArray(a["layers"]) && typeof a["id"] === "string") {
        precomps.push({ id: a["id"], layers: a["layers"].length });
        scanLayers(a["layers"] as Json, false);
      } else if (typeof a["p"] === "string") {
        features.imageAssets++;
        if (a["e"] !== 1 && !String(a["p"]).startsWith("data:")) features.externalImages++;
      }
    }
  }
  // Expressions are the `x` string inside a property object, next to its `k`.
  const walk = (v: Json): void => {
    if (Array.isArray(v)) return void v.forEach(walk);
    if (!isObj(v)) return;
    if (typeof v["x"] === "string" && "k" in v) features.expressions++;
    for (const x of Object.values(v)) walk(x);
  };
  walk(doc);

  const frames = { in: isNum(doc["ip"]) ? doc["ip"] : 0, out: isNum(doc["op"]) ? doc["op"] : 0 };
  const fr = isNum(doc["fr"]) ? doc["fr"] : 0;
  const notes: string[] = [];
  if (features.expressions > 0) notes.push(`${features.expressions} expressions: they run only in the web player, and retiming does not change what they compute from time`);
  if (features.effects > 0) notes.push(`${features.effects} layers have effects, which are outside the portable subset and are not recoloured`);
  if (features.timeRemaps > 0) notes.push(`${features.timeRemaps} layers use time remapping`);
  if (features.externalImages > 0) notes.push(`${features.externalImages} images are separate files, not embedded, so the animation needs those files next to it`);
  if (features.textLayers > 0) notes.push(`${features.textLayers} text layers: their colours are not recoloured, and text needs the file's fonts`);

  const info: LottieInfo = {
    size: { w: isNum(doc["w"]) ? doc["w"] : 0, h: isNum(doc["h"]) ? doc["h"] : 0 },
    frameRate: fr,
    frames,
    durationSeconds: Math.round((durationSeconds(doc) ?? 0) * 1000) / 1000,
    layerCount: layers.length,
    layerTypes,
    layers: layers.slice(0, MAX_LAYERS),
    precomps,
    colors: listColors(doc),
    features,
    notes,
  };
  if (typeof doc["nm"] === "string") info.name = doc["nm"];
  if (typeof doc["v"] === "string") info.version = doc["v"];
  if (layers.length > MAX_LAYERS) info.layersTruncated = { shown: MAX_LAYERS, total: layers.length };
  return info;
}
