export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type JObj = { [key: string]: Json };

const isObj = (v: unknown): v is JObj => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const r3 = (v: number): number => Math.round(v * 1000) / 1000;

export interface TimeMap {
  /** Maps a time in frames. */
  at: (t: number) => number;
  /** Maps a duration in frames. */
  span: (d: number) => number;
}

/** A keyframe list: the `k` of an animated property, whose items have a numeric `t`. */
function isKeyframes(v: unknown): v is JObj[] {
  return Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && isNum(x["t"]));
}

/**
 * Returns a copy of a Lottie document with every time mapped: the animation range, layer ranges and start times,
 * keyframe times and marker times. Frame rate and everything else are untouched.
 * A layer boundary that equals the old animation boundary becomes the new one, so a layer that ended with the animation still does.
 */
export function mapTimes(doc: JObj, map: TimeMap): JObj {
  const oldIp = isNum(doc["ip"]) ? doc["ip"] : 0;
  const oldOp = isNum(doc["op"]) ? doc["op"] : 0;
  const newIp = map.at(oldIp);
  const newOp = Math.ceil(map.at(oldOp) - 1e-9);

  const layerTime = (key: string, v: number): number => {
    if (key === "ip" && v === oldIp) return newIp;
    if (key === "op" && v === oldOp) return newOp;
    return r3(map.at(v));
  };

  const walkLayers = (layers: Json): void => {
    if (!Array.isArray(layers)) return;
    for (const l of layers) {
      if (!isObj(l)) continue;
      for (const key of ["ip", "op"]) if (isNum(l[key])) l[key] = layerTime(key, l[key] as number);
      if (isNum(l["st"])) l["st"] = r3(map.at(l["st"] as number));
    }
  };

  const copy = structuredClone(doc) as JObj;
  if (isNum(copy["ip"])) copy["ip"] = newIp;
  if (isNum(copy["op"])) copy["op"] = newOp;
  walkLayers(copy["layers"] as Json);
  if (Array.isArray(copy["assets"])) for (const a of copy["assets"]) if (isObj(a)) walkLayers(a["layers"] as Json);
  if (Array.isArray(copy["markers"])) {
    for (const m of copy["markers"]) {
      if (!isObj(m)) continue;
      if (isNum(m["tm"]) && isNum(m["dr"])) {
        const end = r3(map.at((m["tm"] as number) + (m["dr"] as number)));
        m["tm"] = r3(map.at(m["tm"] as number));
        m["dr"] = r3(end - (m["tm"] as number));
      } else if (isNum(m["tm"])) m["tm"] = r3(map.at(m["tm"] as number));
    }
  }

  const walk = (v: Json): void => {
    if (Array.isArray(v)) return void v.forEach(walk);
    if (!isObj(v)) return;
    for (const [key, val] of Object.entries(v)) {
      if (key === "k" && isKeyframes(val)) for (const kf of val) kf["t"] = r3(map.at(kf["t"] as number));
      walk(val);
    }
  };
  walk(copy);
  return copy;
}

export function durationSeconds(doc: JObj): number | undefined {
  const fr = doc["fr"];
  const ip = doc["ip"];
  const op = doc["op"];
  if (!isNum(fr) || fr <= 0 || !isNum(ip) || !isNum(op)) return undefined;
  return (op - ip) / fr;
}

export type RetimeSpec = { speed: number } | { duration: number };

export interface Retimed {
  doc: JObj;
  /** The factor times were multiplied by: 2 means twice as long. */
  factor: number;
  fromSeconds: number;
  toSeconds: number;
}

/** Rescales all keyframe times so the animation runs at `speed` times as fast, or lasts `duration` seconds. Frame rate is kept. */
export function retimeLottie(doc: JObj, spec: RetimeSpec): Retimed {
  const from = durationSeconds(doc);
  if (from === undefined || from <= 0) throw new Error("the file has no usable frame rate and in and out points, so it cannot be retimed");
  let factor: number;
  if ("speed" in spec) {
    if (!(spec.speed > 0) || !Number.isFinite(spec.speed)) throw new Error(`speed must be a number above 0, got ${spec.speed}`);
    factor = 1 / spec.speed;
  } else {
    if (!(spec.duration > 0) || !Number.isFinite(spec.duration)) throw new Error(`duration must be a number of seconds above 0, got ${spec.duration}`);
    factor = spec.duration / from;
  }
  const ip = isNum(doc["ip"]) ? doc["ip"] : 0;
  // Scale about the in point, so an animation that starts at frame 30 still starts there.
  const out = mapTimes(doc, { at: (t) => ip + (t - ip) * factor, span: (d) => d * factor });
  return { doc: out, factor, fromSeconds: from, toSeconds: durationSeconds(out) ?? from * factor };
}
