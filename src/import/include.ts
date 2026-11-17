import { posix } from "node:path";
import { didYouMean, makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);

export interface Included {
  scene: unknown;
  diagnostics: Diagnostic[];
}

/** Loads a fragment by the path written in the scene. Returns the parsed JSON, or throws with a readable message. */
export type FragmentLoader = (path: string) => unknown;

/** Paths of images and Lottie files inside a fragment are relative to the fragment file; make them relative to the scene that includes it. */
function rebase(nodes: unknown[], includePath: string): void {
  const dir = posix.dirname(includePath.replace(/\\/g, "/"));
  if (dir === ".") return;
  const walk = (n: unknown): void => {
    if (!isObj(n)) return;
    if ((n["type"] === "image" || n["type"] === "lottie") && typeof n["src"] === "string" && !/^(data:|https?:|\/)/.test(n["src"])) n["src"] = posix.normalize(posix.join(dir, n["src"]));
    if (Array.isArray(n["children"])) n["children"].forEach(walk);
  };
  nodes.forEach(walk);
}

const FORBIDDEN_OVERRIDES = ["id", "type", "children", "include", "overrides"];

function findById(nodes: unknown, id: string): Obj | undefined {
  if (!Array.isArray(nodes)) return undefined;
  for (const n of nodes) {
    if (!isObj(n)) continue;
    if (n["id"] === id) return n;
    const hit = findById(n["children"], id);
    if (hit) return hit;
  }
  return undefined;
}

function idsOf(nodes: unknown, out: string[] = []): string[] {
  if (!Array.isArray(nodes)) return out;
  for (const n of nodes) {
    if (!isObj(n)) continue;
    if (typeof n["id"] === "string") out.push(n["id"]);
    idsOf(n["children"], out);
  }
  return out;
}

/**
 * Replaces every group that has `include` with the nodes of the named fragment, then applies its `overrides`.
 * An override merges fields into the node with that id: `animate` per property, `motion` appended, anything else replaced.
 * Pure: the fragment text comes from `load`. A scene without `include` is returned as it is.
 */
export function resolveIncludes(raw: unknown, load: FragmentLoader | undefined): Included {
  if (!isObj(raw)) return { scene: raw, diagnostics: [] };
  const diagnostics: Diagnostic[] = [];
  const add = (code: string, message: string, fix: string, node: string | undefined, path: string): void => {
    const where: { node?: string; path?: string } = { path };
    if (node !== undefined) where.node = node;
    diagnostics.push(makeDiagnostic(code, message, fix, where));
  };

  let found = false;
  const scan = (n: unknown): void => {
    if (!isObj(n)) return;
    if (n["include"] !== undefined) found = true;
    if (Array.isArray(n["children"])) n["children"].forEach(scan);
  };
  if (Array.isArray(raw["nodes"])) raw["nodes"].forEach(scan);
  if (isObj(raw["defs"])) Object.values(raw["defs"]).forEach(scan);
  if (!found) return { scene: raw, diagnostics };

  const scene = structuredClone(raw) as Obj;

  const resolve = (n: unknown, path: string): void => {
    if (!isObj(n)) return;
    const id = typeof n["id"] === "string" ? n["id"] : undefined;
    if (n["include"] !== undefined) {
      const src = n["include"];
      const overrides = n["overrides"];
      delete n["include"];
      delete n["overrides"];
      if (typeof src !== "string" || src === "") {
        add("E-FIELD-TYPE", `Field 'include' is ${JSON.stringify(src)}, expected the path of a fragment file.`, 'Use "include": "fragment.json".', id, `${path}.include`);
        n["children"] = [];
        return;
      }
      if (n["type"] !== "group") add("E-FIELD-TYPE", `'include' is only valid on a group, and this node is '${String(n["type"])}'.`, 'Use { "type": "group", "include": "fragment.json" }.', id, `${path}.include`);
      if (Array.isArray(n["children"]) && n["children"].length > 0) add("E-FIELD-TYPE", "A group with 'include' cannot also have 'children'.", "Remove 'children', or put the included group inside another group.", id, `${path}.children`);
      let frag: unknown;
      if (!load) add("E-INCLUDE-LOAD", `'${src}' cannot be loaded here, because this check has no access to files.`, "Run the gertie command on the scene file so fragments can be read.", id, `${path}.include`);
      else {
        try {
          frag = load(src);
        } catch (e) {
          add("E-INCLUDE-LOAD", `The fragment '${src}' could not be loaded: ${e instanceof Error ? e.message : String(e)}.`, "Check the path (relative to the scene file) and create the fragment with: gertie import <artwork.svg> --out fragment.json", id, `${path}.include`);
        }
      }
      if (frag !== undefined && (!isObj(frag) || frag["gertie-fragment"] !== 1 || !Array.isArray(frag["nodes"]))) {
        add("E-INCLUDE-LOAD", `'${src}' is not a Gertie fragment (it needs "gertie-fragment": 1 and a "nodes" array).`, "Create the fragment with: gertie import <artwork.svg> --out fragment.json", id, `${path}.include`);
        frag = undefined;
      }
      const kids = frag === undefined ? [] : (structuredClone((frag as Obj)["nodes"]) as unknown[]);
      rebase(kids, src);
      n["children"] = kids;

      if (overrides !== undefined) {
        if (!isObj(overrides)) add("E-FIELD-TYPE", "Field 'overrides' is not an object mapping node ids to fields.", 'Use "overrides": { "arm": { "pivot": [10, 20] } }.', id, `${path}.overrides`);
        else if (frag !== undefined) {
          for (const [target, patch] of Object.entries(overrides)) {
            const op = `${path}.overrides.${target}`;
            const node = findById(kids, target);
            if (!node) {
              const all = idsOf(kids);
              add("E-INCLUDE-OVERRIDE", `The fragment '${src}' has no node '${target}'.${didYouMean(target, all)} It has ${all.length} nodes, for example: ${all.slice(0, 12).join(", ")}.`, "Use an id from the import summary (gertie import prints it), or open the fragment file.", id, op);
              continue;
            }
            if (!isObj(patch)) {
              add("E-FIELD-TYPE", `The override for '${target}' is not an object.`, 'Write { "pivot": [10, 20], "animate": { ... } }.', id, op);
              continue;
            }
            for (const [k, v] of Object.entries(patch)) {
              if (FORBIDDEN_OVERRIDES.includes(k)) {
                add("E-INCLUDE-OVERRIDE", `An override cannot change '${k}' of '${target}'.`, "Overrides add or change transform, style, animate and motion fields only.", id, `${op}.${k}`);
              } else if (k === "animate" && isObj(v)) {
                node["animate"] = { ...(isObj(node["animate"]) ? node["animate"] : {}), ...v };
              } else if (k === "motion" && Array.isArray(v)) {
                node["motion"] = [...(Array.isArray(node["motion"]) ? node["motion"] : []), ...v];
              } else node[k] = v;
            }
          }
        }
      }
    }
    if (Array.isArray(n["children"])) n["children"].forEach((c, i) => resolve(c, `${path}.children[${i}]`));
  };

  if (Array.isArray(scene["nodes"])) scene["nodes"].forEach((n, i) => resolve(n, `nodes[${i}]`));
  if (isObj(scene["defs"])) for (const [k, v] of Object.entries(scene["defs"])) resolve(v, `defs.${k}`);
  return { scene, diagnostics };
}
