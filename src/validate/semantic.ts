import { makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";

type Obj = Record<string, unknown>;

const GEOMETRY = ["rc", "el", "sh", "sr"];
const STYLES = ["fl", "st", "gf", "gs"];

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

class Semantic {
  diags: Diagnostic[] = [];
  private node: string | undefined;

  add(code: string, message: string, fix: string, path: string): void {
    const where: { node?: string; path?: string } = { path };
    if (this.node !== undefined) where.node = this.node;
    this.diags.push(makeDiagnostic(code, message, fix, where));
  }

  run(doc: Obj): void {
    const assets = Array.isArray(doc["assets"]) ? (doc["assets"] as unknown[]) : [];
    const assetIds = new Set<string>();
    for (const a of assets) if (isObj(a) && typeof a["id"] === "string") assetIds.add(a["id"]);
    const ip = typeof doc["ip"] === "number" ? doc["ip"] : 0;
    const op = typeof doc["op"] === "number" ? doc["op"] : Infinity;

    if (doc["ddd"] === 1) this.add("E-L-SUBSET", "3D layers (ddd: 1) are outside the supported subset.", "Remove 3D layers.", "ddd");
    if (Array.isArray(doc["layers"])) this.composition(doc["layers"], "layers", assetIds, ip, op);
    assets.forEach((a, i) => {
      if (isObj(a) && Array.isArray(a["layers"])) {
        this.node = typeof a["nm"] === "string" ? a["nm"] : undefined;
        this.composition(a["layers"], `assets[${i}].layers`, assetIds, ip, op);
      }
    });
    this.node = undefined;
    const size = JSON.stringify(doc).length;
    if (size > 200 * 1024) this.add("W-L-SIZE", `The file is ${(size / 1024).toFixed(0)} KB, above 200 KB.`, "Simplify the scene or drop embedded images.", "");
  }

  composition(layers: unknown[], path: string, assetIds: Set<string>, ip: number, op: number): void {
    const inds = new Set<number>();
    const seen = new Set<number>();
    for (const l of layers) if (isObj(l) && typeof l["ind"] === "number") seen.add(l["ind"]);
    layers.forEach((l, i) => {
      if (!isObj(l)) return;
      const lp = `${path}[${i}]`;
      this.node = typeof l["nm"] === "string" ? l["nm"] : undefined;
      if (typeof l["ind"] === "number") {
        if (inds.has(l["ind"])) this.add("E-L-IND-UNIQUE", `Layer index ${l["ind"]} is used more than once in this composition.`, "Give every layer a unique ind.", lp);
        inds.add(l["ind"]);
      }
      if (typeof l["parent"] === "number" && !seen.has(l["parent"])) this.add("E-L-REF", `Layer parent ${l["parent"]} does not match any layer index.`, "Fix or remove parent.", lp);
      if (typeof l["refId"] === "string" && !assetIds.has(l["refId"])) this.add("E-L-REF", `Layer refId '${l["refId"]}' does not match any asset.`, "Add the asset or fix refId.", lp);
      if (typeof l["ip"] === "number" && typeof l["op"] === "number") {
        if (l["ip"] >= l["op"]) this.add("E-L-LAYER-TIME", `Layer ip ${l["ip"]} is not less than op ${l["op"]}.`, "Make op greater than ip.", lp);
        else if (l["ip"] < ip || l["op"] > op) this.add("E-L-LAYER-TIME", `Layer range ${l["ip"]} to ${l["op"]} is outside the animation range ${ip} to ${op}.`, "Keep layer times within the animation range.", lp);
      }
      if (l["ty"] === 5) this.add("E-L-SUBSET", "Text layers are outside the supported subset.", "Convert text to paths.", lp);
      if (l["ty"] === 13) this.add("E-L-SUBSET", "Camera layers are outside the supported subset.", "Remove the camera.", lp);
      if (Array.isArray(l["ef"]) && l["ef"].length > 0) this.add("E-L-SUBSET", "Layer effects are outside the supported subset.", "Remove effects.", `${lp}.ef`);
      if (l["tt"] === 3 || l["tt"] === 4 || (l["tt"] !== undefined && l["tt"] !== 0 && l["tt"] !== 1 && l["tt"] !== 2)) this.add("E-L-SUBSET", "Luma mattes are outside the supported subset. They fail on several platforms.", "Use an alpha matte (tt 1 or 2) or a clip instead.", lp);
      if ((l["tt"] === 1 || l["tt"] === 2) && !(i > 0 && isObj(layers[i - 1]) && (layers[i - 1] as Obj)["td"] === 1)) this.add("E-L-MATTE-ORDER", `Layer has a track matte (tt ${l["tt"]}) but the layer above it is not a matte source (td: 1).`, "Put the matte source directly above the matted layer and give it td: 1.", lp);
      if (l["ao"] === 1) this.add("E-L-SUBSET", "Auto-orient is outside the supported subset.", "Remove ao.", lp);
      if (l["bm"] !== undefined && l["bm"] !== 0) this.add("E-L-SUBSET", "Blend modes are outside the supported subset.", "Remove the blend mode.", lp);
      if (l["tm"] !== undefined) this.add("E-L-SUBSET", "Time remapping is outside the supported subset.", "Remove tm.", lp);
      if (Array.isArray(l["masksProperties"])) {
        l["masksProperties"].forEach((m, mi) => {
          if (isObj(m) && m["mode"] !== "a") this.add("E-L-SUBSET", `Mask mode ${JSON.stringify(m["mode"])} is outside the supported subset. Only add (\"a\") is allowed.`, 'Use mode "a".', `${lp}.masksProperties[${mi}]`);
        });
      }
      if (isObj(l["ks"])) this.walk(l["ks"], `${lp}.ks`, false);
      if (Array.isArray(l["shapes"])) this.shapes(l["shapes"], `${lp}.shapes`, false);
      if (Array.isArray(l["masksProperties"])) this.walk(l["masksProperties"], `${lp}.masksProperties`, false);
    });
  }

  /** Checks a list of shape items. `inheritedStyle` is true when an enclosing group has a style after this group. */
  shapes(items: unknown[], path: string, inheritedStyle: boolean): void {
    const types = items.map((it) => (isObj(it) ? it["ty"] : undefined));
    items.forEach((it, i) => {
      if (!isObj(it)) return;
      const ip = `${path}[${i}]`;
      const ty = it["ty"];
      if (ty === "mm") this.add("E-L-SUBSET", "Merge paths are outside the supported subset.", "Remove merge paths.", ip);
      if (ty === "rp") this.add("E-L-SUBSET", "Repeaters are outside the supported subset.", "Unroll the repeat into separate shapes.", ip);
      if (ty === "sr") this.add("E-L-SUBSET", "Polystar shapes are outside the supported subset.", "Convert the star to a path.", ip);
      if (typeof ty === "string" && GEOMETRY.includes(ty)) {
        const styled = types.slice(i + 1).some((t) => typeof t === "string" && STYLES.includes(t)) || inheritedStyle;
        if (!styled) this.add("E-L-STYLE-SCOPE", `Geometry '${ty}' has no fill or stroke after it, so it will not be drawn.`, "Put a fill or stroke after the geometry in the same group.", ip);
      }
      if (ty === "gr" && Array.isArray(it["it"])) {
        const sub = it["it"] as unknown[];
        const trs = sub.filter((x) => isObj(x) && x["ty"] === "tr").length;
        const last = sub[sub.length - 1];
        if (trs !== 1 || !isObj(last) || last["ty"] !== "tr") this.add("E-L-GROUP-TR", `Group has ${trs} transform item(s) and its last item is ${isObj(last) ? JSON.stringify(last["ty"]) : "missing"}. A group needs exactly one transform, as its last item.`, "End the group's items with a single tr.", `${ip}.it`);
        const laterStyle = types.slice(i + 1).some((t) => typeof t === "string" && STYLES.includes(t)) || inheritedStyle;
        this.shapes(sub, `${ip}.it`, laterStyle);
      }
      if (ty === "fl" || ty === "st" || ty === "gf" || ty === "gs") this.colorRange(it, ip);
      if (ty === "tm") {
        for (const k of ["s", "e"]) this.pctRange(it[k], `${ip}.${k}`, "Trim");
      }
      if (ty === "fl" || ty === "st" || ty === "gf" || ty === "gs") this.pctRange(it["o"], `${ip}.o`, "Opacity");
      if (ty === "tr") this.pctRange(it["o"], `${ip}.o`, "Opacity");
      this.walk(it, ip, true);
    });
  }

  colorRange(it: Obj, path: string): void {
    const check = (arr: unknown, p: string): void => {
      if (Array.isArray(arr) && arr.some((n) => typeof n === "number" && (n < 0 || n > 1))) this.add("E-L-COLOR-RANGE", `Colour components must be within 0 to 1, found ${JSON.stringify(arr)}.`, "Divide 0 to 255 values by 255.", p);
    };
    const c = it["c"];
    if (isObj(c)) {
      if (c["a"] === 0) check(c["k"], `${path}.c`);
      else if (Array.isArray(c["k"])) c["k"].forEach((kf, i) => isObj(kf) && check(kf["s"], `${path}.c.k[${i}]`));
    }
    const g = it["g"];
    if (isObj(g) && isObj(g["k"]) && g["k"]["a"] === 0) check(g["k"]["k"], `${path}.g`);
  }

  pctRange(p: unknown, path: string, label: string): void {
    if (!isObj(p)) return;
    const bad = (n: unknown): boolean => typeof n === "number" && (n < 0 || n > 100);
    if (p["a"] === 0 && bad(p["k"])) this.add("E-L-PCT-RANGE", `${label} ${p["k"]} is outside 0 to 100.`, "Use a percentage from 0 to 100.", path);
    if (p["a"] === 1 && Array.isArray(p["k"])) {
      p["k"].forEach((kf, i) => {
        if (isObj(kf) && Array.isArray(kf["s"]) && kf["s"].some(bad)) this.add("E-L-PCT-RANGE", `${label} keyframe value ${JSON.stringify(kf["s"])} is outside 0 to 100.`, "Use a percentage from 0 to 100.", `${path}.k[${i}]`);
      });
    }
  }

  /** Generic walk: animated properties, bezier shapes, expressions. */
  walk(v: unknown, path: string, _shapesHandled: boolean): void {
    if (Array.isArray(v)) {
      v.forEach((x, i) => this.walk(x, `${path}[${i}]`, _shapesHandled));
      return;
    }
    if (!isObj(v)) return;
    if (typeof v["x"] === "string" && "k" in v) this.add("E-L-SUBSET", "Expressions are outside the supported subset. They only work in the web player.", "Remove the expression and use keyframes.", path);
    if (typeof v["a"] === "number" && "k" in v) this.property(v, path);
    if (Array.isArray(v["v"]) && Array.isArray(v["i"]) && Array.isArray(v["o"])) {
      if (v["v"].length !== v["i"].length || v["v"].length !== v["o"].length) this.add("E-L-PATH-ARRAYS", `Bezier arrays differ in length: v ${v["v"].length}, i ${v["i"].length}, o ${v["o"].length}.`, "Make v, i and o the same length.", path);
    }
    for (const [k, x] of Object.entries(v)) {
      if (k === "it" || k === "shapes") continue; // handled by shapes()
      if (x !== null && typeof x === "object") this.walk(x, `${path}.${k}`, _shapesHandled);
    }
  }

  property(p: Obj, path: string): void {
    if (p["a"] !== 1 || !Array.isArray(p["k"])) return;
    const ks = p["k"] as unknown[];
    let prev = -Infinity;
    ks.forEach((kf, i) => {
      if (!isObj(kf)) return;
      const kp = `${path}.k[${i}]`;
      if (typeof kf["t"] === "number") {
        if (kf["t"] < prev) this.add("E-L-KEY-ORDER", `Keyframe time ${kf["t"]} is before the previous keyframe time ${prev}.`, "Order keyframes by ascending t.", kp);
        prev = kf["t"];
      }
      const last = i === ks.length - 1;
      if (!last && kf["h"] !== 1 && !(isObj(kf["o"]) && isObj(kf["i"]))) this.add("E-L-KEY-HANDLES", "Keyframe has neither easing handles (o and i) nor a hold flag (h: 1).", "Add o and i, or set h: 1.", kp);
      for (const h of ["o", "i"]) {
        const hv = kf[h];
        if (isObj(hv)) {
          const xs = Array.isArray(hv["x"]) ? hv["x"] : [hv["x"]];
          if (xs.some((x) => typeof x === "number" && (x < 0 || x > 1))) this.add("E-L-EASE-X", `Easing handle ${h}.x ${JSON.stringify(hv["x"])} is outside 0 to 1.`, "Keep handle x values within 0 to 1.", kp);
        }
      }
    });
  }
}

/** Second, independent check of a Lottie document against Gertie's safe subset. */
export function semanticLint(lottie: unknown): Diagnostic[] {
  const s = new Semantic();
  if (isObj(lottie)) s.run(lottie);
  return s.diags;
}
