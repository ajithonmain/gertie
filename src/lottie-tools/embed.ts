import { mapTimes, type Json, type JObj } from "./time.ts";

const isObj = (v: unknown): v is JObj => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export interface Embedded {
  w: number;
  h: number;
  /** The layers of the external composition, timed in the scene's frame rate. */
  layers: JObj[];
  /** The external file's own assets, with ids prefixed so they cannot clash with the scene's. */
  assets: JObj[];
}

/** Why an external Lottie file cannot be placed in a scene, or undefined when it can. */
export function embedProblem(doc: unknown): { code: "E-LOTTIE-INVALID" | "E-LOTTIE-IMAGES"; message: string; fix: string } | undefined {
  if (!isObj(doc)) return { code: "E-LOTTIE-INVALID", message: "The file is not a Lottie animation: it is not a JSON object.", fix: "Use a Lottie JSON file (not a .lottie archive: unzip it and use the animation JSON inside)." };
  for (const k of ["fr", "ip", "op", "w", "h"] as const) {
    if (!isNum(doc[k])) return { code: "E-LOTTIE-INVALID", message: `The file is not a Lottie animation: '${k}' is missing or not a number.`, fix: "Use a Lottie JSON file exported from After Effects, LottieFiles or Gertie." };
  }
  if ((doc["fr"] as number) <= 0 || (doc["w"] as number) <= 0 || (doc["h"] as number) <= 0 || (doc["op"] as number) <= (doc["ip"] as number)) {
    return { code: "E-LOTTIE-INVALID", message: "The Lottie file has a non-positive frame rate or size, or no frames.", fix: "Use a valid Lottie file." };
  }
  if (!Array.isArray(doc["layers"])) return { code: "E-LOTTIE-INVALID", message: "The file is not a Lottie animation: 'layers' is missing.", fix: "Use a Lottie JSON file." };
  const external = (doc["assets"] as Json[] | undefined)?.filter((a) => isObj(a) && typeof a["p"] === "string" && a["e"] !== 1 && !String(a["p"]).startsWith("data:")) ?? [];
  if (external.length > 0) {
    return { code: "E-LOTTIE-IMAGES", message: `The Lottie file uses ${external.length} image file(s) stored outside it, which a scene cannot carry.`, fix: "Export the animation with images embedded (base64), or use one without images." };
  }
  return undefined;
}

/**
 * Prepares an external Lottie document to become a precomposition of a scene at `fps`.
 * Times are rescaled to the scene's frame rate and shifted so the file's in point is time zero; asset ids are prefixed.
 */
export function embedLottie(doc: JObj, prefix: string, fps: number): Embedded {
  const ip = isNum(doc["ip"]) ? doc["ip"] : 0;
  const k = fps / (doc["fr"] as number);
  const timed = mapTimes(doc, { at: (t) => (t - ip) * k, span: (d) => d * k });

  const ids = new Set<string>();
  if (Array.isArray(timed["assets"])) for (const a of timed["assets"]) if (isObj(a) && typeof a["id"] === "string") ids.add(a["id"]);
  const fixLayers = (layers: Json): void => {
    if (!Array.isArray(layers)) return;
    for (const l of layers) if (isObj(l) && typeof l["refId"] === "string" && ids.has(l["refId"])) l["refId"] = prefix + l["refId"];
  };
  const assets: JObj[] = [];
  if (Array.isArray(timed["assets"])) {
    for (const a of timed["assets"]) {
      if (!isObj(a)) continue;
      if (typeof a["id"] === "string") a["id"] = prefix + a["id"];
      fixLayers(a["layers"] as Json);
      assets.push(a);
    }
  }
  fixLayers(timed["layers"] as Json);
  return { w: doc["w"] as number, h: doc["h"] as number, layers: timed["layers"] as JObj[], assets };
}
