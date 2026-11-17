import { closest, didYouMean, makeDiagnostic, type Diagnostic } from "./diagnostics.ts";
import { isHexColor, parseHex } from "./color.ts";
import { parsePath, pathStructure, PathSyntaxError, type Subpath } from "./path.ts";
import { EASING_NAMES, resolveEase } from "../presets/easing.ts";
import { isEasedCurve } from "../presets/motion-extras.ts";
import { readKey, type RawKey } from "./keys.ts";
import { expandScene } from "../presets/expand.ts";
import { resolveIncludes, type FragmentLoader } from "../import/include.ts";
import { embedProblem } from "../lottie-tools/embed.ts";
import { FPS_VALUES, SUPPORTED_VERSION, TIERS } from "./types.ts";

export interface LintOptions {
  /** Returns true when an image file exists. Omit to skip the check. */
  fileExists?: (src: string) => boolean;
  /** Loads an included fragment by its path. Omit when files are not available; a scene that uses `include` then reports E-INCLUDE-LOAD. */
  loadFragment?: FragmentLoader;
  /** Parsed JSON of Lottie files placed with `lottie` nodes, keyed by `src`. A file that could not be read as JSON is left out. Omit to skip the content checks. */
  lotties?: Record<string, unknown>;
}

type Obj = Record<string, unknown>;

const ID_RE = /^[a-z][a-z0-9-]*$/;
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;
const TOP_FIELDS = ["$schema", "gertie", "name", "canvas", "fps", "duration", "loop", "poster", "tier", "markers", "palette", "defs", "nodes"];
const COMMON_FIELDS = ["id", "type", "x", "y", "rotation", "scale", "opacity", "pivot", "from", "to", "animate", "motion", "clip", "matte"];
const STYLE_FIELDS = ["fill", "fillRule", "stroke", "trim"];
const TYPE_FIELDS: Record<string, string[]> = {
  group: ["children"],
  rect: ["w", "h", "radius", ...STYLE_FIELDS],
  ellipse: ["rx", "ry", "r", ...STYLE_FIELDS],
  path: ["d", ...STYLE_FIELDS],
  line: ["x1", "y1", "x2", "y2", ...STYLE_FIELDS],
  polygon: ["points", "r", ...STYLE_FIELDS],
  star: ["points", "r", "innerR", ...STYLE_FIELDS],
  image: ["src", "w", "h"],
  lottie: ["src"],
  use: ["ref"],
};
const NODE_TYPES = Object.keys(TYPE_FIELDS);
const MATTE_MODES = ["alpha", "alpha-inverted"] as const;
const SHAPE_TYPES = ["rect", "ellipse", "path", "line", "polygon", "star"];
const TRANSFORM_PROPS = ["x", "y", "rotation", "scale", "opacity"];

type ValueKind = "number" | "scale" | "color" | "path" | "unit" | "nonneg" | "point" | "positive";

function propKinds(type: string, node: Obj): Record<string, ValueKind> {
  const kinds: Record<string, ValueKind> = { x: "number", y: "number", rotation: "number", scale: "scale", opacity: "unit" };
  if (!SHAPE_TYPES.includes(type)) return kinds;
  if (typeof node["fill"] === "string") kinds["fill"] = "color";
  const gradient = node["fill"];
  if (isObj(gradient) && gradient["type"] === "linear") Object.assign(kinds, { "fill.from": "point", "fill.to": "point" });
  if (isObj(gradient) && gradient["type"] === "radial") Object.assign(kinds, { "fill.center": "point", "fill.radius": "positive" });
  const stroke = node["stroke"];
  if (stroke !== null && typeof stroke === "object") {
    kinds["stroke.color"] = "color";
    kinds["stroke.width"] = "nonneg";
    kinds["trim.start"] = "unit";
    kinds["trim.end"] = "unit";
    kinds["trim.offset"] = "number";
  }
  if (type === "path") kinds["d"] = "path";
  if (type === "rect") Object.assign(kinds, { w: "nonneg", h: "nonneg", radius: "nonneg" });
  if (type === "ellipse") Object.assign(kinds, { rx: "nonneg", ry: "nonneg", r: "nonneg" });
  return kinds;
}

function isObj(v: unknown): v is Obj {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}
function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
function isPair(v: unknown): v is [number, number] {
  return Array.isArray(v) && v.length === 2 && isNum(v[0]) && isNum(v[1]);
}
function typeName(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  return typeof v;
}
function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

class Linter {
  readonly diags: Diagnostic[] = [];
  palette: Record<string, string> = {};
  fps = 30;
  duration = 1;
  loop = true;
  canvasW = 0;
  canvasH = 0;
  ids = new Map<string, string>();
  defKeys = new Set<string>();
  useRefs: { ref: string; from: string; node: string; path: string }[] = [];
  nodeCount = 0;
  keyCount = 0;
  animatedTracks = 0;
  /** Artwork counters for W-ART-PRIMITIVE and W-ART-FLAT. */
  tier: string | undefined;
  shapeCount = 0;
  hasCurvePath = false;
  hasGradient = false;
  fillColors = new Set<string>();
  /** Motion counters for W-EASE-UNIFORM. */
  easedSegments = 0;
  easeCurves = new Set<string>();

  constructor(private readonly opts: LintOptions) {}

  add(code: string, message: string, fix: string, node?: string, path?: string): void {
    const where: { node?: string; path?: string } = {};
    if (node !== undefined) where.node = node;
    if (path !== undefined) where.path = path;
    this.diags.push(makeDiagnostic(code, message, fix, where));
  }

  unknownFields(o: Obj, allowed: readonly string[], path: string, node?: string): void {
    for (const k of Object.keys(o)) {
      if (!allowed.includes(k)) {
        this.add(
          "E-FIELD-UNKNOWN",
          `Unknown field '${k}' at ${path || "root"}.${didYouMean(k, allowed)} Valid fields: ${allowed.join(", ")}.`,
          `Remove '${k}' or rename it to a valid field.`,
          node,
          path ? `${path}.${k}` : k,
        );
      }
    }
  }

  /** Validates a number field. Returns the value, or undefined when absent or invalid. */
  num(o: Obj, field: string, path: string, node: string | undefined, opts: { required?: boolean; min?: number; max?: number; positive?: boolean } = {}): number | undefined {
    const v = o[field];
    const p = `${path}.${field}`;
    if (v === undefined) {
      if (opts.required) this.add("E-FIELD-MISSING", `Required field '${field}' is missing.`, `Add '${field}' as a number.`, node, p);
      return undefined;
    }
    if (!isNum(v)) {
      this.add("E-FIELD-TYPE", `Field '${field}' is ${typeName(v)} ${JSON.stringify(v)}, expected a number.`, `Set '${field}' to a number.`, node, p);
      return undefined;
    }
    if (opts.positive && v <= 0) {
      this.add("E-FIELD-TYPE", `Field '${field}' is ${v}, expected a number greater than 0.`, `Set '${field}' to a positive number.`, node, p);
      return undefined;
    }
    if ((opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max)) {
      this.add("E-FIELD-TYPE", `Field '${field}' is ${v}, allowed range is ${opts.min ?? "-inf"} to ${opts.max ?? "inf"}.`, `Set '${field}' within the allowed range.`, node, p);
      return undefined;
    }
    return v;
  }

  /** Resolves a colour string. Returns null and reports E-COLOR when invalid. */
  color(v: unknown, path: string, node?: string): string | null {
    if (typeof v !== "string") {
      this.add("E-COLOR", `Colour at ${path} is ${typeName(v)} ${JSON.stringify(v)}, expected a hex string or '$name'.`, "Use '#rrggbb', '#rgb', '#rrggbbaa' or '$name' from the palette.", node, path);
      return null;
    }
    if (v.startsWith("$")) {
      const hex = this.palette[v.slice(1)];
      if (hex === undefined) {
        const names = Object.keys(this.palette);
        this.add(
          "E-COLOR",
          `Unknown palette colour '${v}'.${didYouMean(v.slice(1), names).replace("'", "'$")} Palette names: ${names.length ? names.join(", ") : "(palette is empty)"}.`,
          "Add the colour to 'palette' or use a hex colour.",
          node,
          path,
        );
        return null;
      }
      return hex;
    }
    if (!isHexColor(v)) {
      this.add("E-COLOR", `Colour '${v}' is not valid.`, "Use '#rrggbb', '#rgb', '#rrggbbaa' or '$name' from the palette.", node, path);
      return null;
    }
    return v;
  }

  pathString(v: unknown, path: string, node?: string): Subpath[] | null {
    if (typeof v !== "string") {
      this.add("E-FIELD-TYPE", `Path data at ${path} is ${typeName(v)}, expected an SVG path string.`, "Set it to a string such as 'M0 0 L10 10'.", node, path);
      return null;
    }
    try {
      return parsePath(v);
    } catch (e) {
      if (e instanceof PathSyntaxError) {
        this.add("E-PATH-SYNTAX", `Path syntax error at character ${e.position}: ${e.message}. Path: '${v.slice(0, 60)}'.`, "Fix the path string. Supported commands: M L H V C S Q T A Z, absolute or relative.", node, path);
        return null;
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------- root

  run(raw: unknown): void {
    if (!isObj(raw)) {
      this.add("E-FIELD-TYPE", `The scene must be a JSON object, found ${typeName(raw)}.`, "Wrap the scene in { ... }.", undefined, "");
      return;
    }
    if (raw["gertie"] === undefined) this.add("E-VERSION", "Field 'gertie' is missing.", `Add "gertie": ${SUPPORTED_VERSION} at the top level.`, undefined, "gertie");
    else if (raw["gertie"] !== SUPPORTED_VERSION) this.add("E-VERSION", `Unsupported format version ${JSON.stringify(raw["gertie"])}.`, `Set "gertie": ${SUPPORTED_VERSION}.`, undefined, "gertie");
    this.unknownFields(raw, TOP_FIELDS, "");

    const name = raw["name"];
    if (name === undefined) this.add("E-FIELD-MISSING", "Required field 'name' is missing.", "Add a name of lowercase letters, digits and hyphens.", undefined, "name");
    else if (typeof name !== "string" || !NAME_RE.test(name)) this.add("E-FIELD-TYPE", `Field 'name' is ${JSON.stringify(name)}, expected lowercase letters, digits and hyphens.`, "Use a name like 'my-animation'.", undefined, "name");

    this.canvas(raw["canvas"]);

    if (raw["fps"] !== undefined) {
      if (typeof raw["fps"] === "number" && FPS_VALUES.includes(raw["fps"])) this.fps = raw["fps"];
      else this.add("E-FPS", `fps is ${JSON.stringify(raw["fps"])}. Allowed values: ${FPS_VALUES.join(", ")}.`, "Set fps to one of the allowed values, usually 30.", undefined, "fps");
    }
    if (raw["duration"] === undefined) this.add("E-FIELD-MISSING", "Required field 'duration' is missing.", "Add 'duration' in seconds, for example 1.5.", undefined, "duration");
    else if (!isNum(raw["duration"]) || raw["duration"] <= 0 || raw["duration"] > 30) this.add("E-DURATION", `duration is ${JSON.stringify(raw["duration"])}, expected a number greater than 0 and at most 30 seconds.`, "Set duration in seconds between 0 and 30.", undefined, "duration");
    else this.duration = raw["duration"];

    if (raw["loop"] !== undefined) {
      if (typeof raw["loop"] === "boolean") this.loop = raw["loop"];
      else this.add("E-FIELD-TYPE", `Field 'loop' is ${typeName(raw["loop"])}, expected true or false.`, "Set loop to true or false.", undefined, "loop");
    }

    if (raw["poster"] !== undefined) {
      const p = raw["poster"];
      if (!isNum(p) || p < 0 || (this.duration !== undefined && p > this.duration)) {
        this.add("E-FIELD-TYPE", `Field 'poster' is ${JSON.stringify(p)}, expected a time in seconds from 0 up to the duration.`, "Set poster to the second whose frame best represents the animation, or remove it.", undefined, "poster");
      }
    }

    if (raw["tier"] !== undefined && !(typeof raw["tier"] === "string" && (TIERS as readonly string[]).includes(raw["tier"]))) {
      const t = raw["tier"];
      this.add(
        "E-TIER",
        `Field 'tier' is ${JSON.stringify(t)}.${typeof t === "string" ? didYouMean(t, TIERS) : ""} Allowed values: ${TIERS.join(", ")}.`,
        `Set tier to "icon" (an icon or loader), "character" (a character or illustration) or "scene" (a full scene), or remove it.`,
        undefined,
        "tier",
      );
    }

    if (typeof raw["tier"] === "string") this.tier = raw["tier"];

    this.markersBlock(raw["markers"]);

    this.paletteBlock(raw["palette"]);

    const defs = raw["defs"];
    const defNodes: [string, Obj][] = [];
    if (defs !== undefined) {
      if (!isObj(defs)) this.add("E-FIELD-TYPE", `Field 'defs' is ${typeName(defs)}, expected an object of nodes.`, "Make defs an object mapping names to nodes.", undefined, "defs");
      else
        for (const [k, v] of Object.entries(defs)) {
          this.defKeys.add(k);
          if (isObj(v)) defNodes.push([k, v]);
          else this.add("E-FIELD-TYPE", `defs.${k} is ${typeName(v)}, expected a node object.`, "Make each definition a node object.", undefined, `defs.${k}`);
        }
    }

    const nodes = raw["nodes"];
    if (nodes === undefined) this.add("E-FIELD-MISSING", "Required field 'nodes' is missing.", "Add 'nodes' as an array with at least one node.", undefined, "nodes");
    else if (!Array.isArray(nodes)) this.add("E-FIELD-TYPE", `Field 'nodes' is ${typeName(nodes)}, expected an array.`, "Make nodes an array of node objects.", undefined, "nodes");
    else if (nodes.length === 0) this.add("E-FIELD-MISSING", "Field 'nodes' is empty.", "Add at least one node.", undefined, "nodes");
    else
      nodes.forEach((n, i) => {
        if (isObj(n)) this.node(n, `nodes[${i}]`, true, undefined);
        else this.add("E-FIELD-TYPE", `nodes[${i}] is ${typeName(n)}, expected a node object.`, "Make each node an object.", undefined, `nodes[${i}]`);
      });
    for (const [k, v] of defNodes) this.node(v, `defs.${k}`, false, k);
    if (Array.isArray(nodes)) this.matteSiblings(nodes, "nodes");
    // A definition is one node with no siblings, so a matte on it can never name one.
    for (const [k, v] of defNodes) this.matteSiblings([v], `defs.${k}`);

    for (const u of this.useRefs) {
      if (!this.defKeys.has(u.ref)) {
        this.add("E-USE-REF", `Node '${u.node}' uses '${u.ref}' but 'defs' has no such entry.${didYouMean(u.ref, [...this.defKeys])} Available: ${[...this.defKeys].join(", ") || "(none)"}.`, "Add the definition to 'defs' or fix 'ref'.", u.node, u.path);
      }
    }
    this.checkDefCycles(defNodes);

    if (this.nodeCount > 200) this.add("W-NODE-COUNT", `The scene has ${this.nodeCount} nodes. Large scenes produce large files and slow players.`, "Use 'defs' and 'use' to share geometry, or simplify the scene.");
    if (this.keyCount > 2000) this.add("W-KEY-COUNT", `The scene has ${this.keyCount} keyframes.`, "Remove keyframes or shorten the animation.");
    this.artwork();
    this.motionChecks();
    if (this.animatedTracks === 0 && this.diags.every((d) => d.severity !== "error")) this.add("W-STATIC", "No property is animated, so the output is a still image.", "Add an 'animate' block to at least one node.");
  }

  /** Records one solid fill colour as lowercase #rrggbb, resolving palette names and ignoring alpha. */
  noteFill(v: unknown): void {
    if (typeof v !== "string") return;
    const resolved = v.startsWith("$") ? this.palette[v.slice(1)] : v;
    if (resolved === undefined) return;
    const rgba = parseHex(resolved);
    if (rgba === null) return;
    this.fillColors.add(rgba.slice(0, 3).map((c) => c.toString(16).padStart(2, "0")).join(""));
  }

  /** Whole-scene artwork warnings. They stay quiet for icons, which are legitimately made of a few primitives. */
  artwork(): void {
    if (this.tier === "icon") return;
    if (this.shapeCount > 8 && !this.hasCurvePath) {
      this.add(
        "W-ART-PRIMITIVE",
        `The scene has ${this.shapeCount} shape nodes and no path with a curve in it, so it is built only from primitives and straight segments.`,
        "Draw the silhouette and the large interior shapes as 'path' nodes with C, S or Q curve commands (6 to 10 vertices each), and keep rect, ellipse and star for what is truly that shape. See references/artwork.md.",
      );
    }
    if (this.shapeCount > 12 && this.fillColors.size <= 3 && !this.hasGradient) {
      this.add(
        "W-ART-FLAT",
        `The scene has ${this.shapeCount} shape nodes but only ${this.fillColors.size} distinct fill colour${this.fillColors.size === 1 ? "" : "s"} and no gradient, so it reads as flat.`,
        "Add a shade and a tint for each base colour (a palette of 6 to 12 colours), shading shapes clipped to their base, and a gradient on one large curved surface. See references/artwork.md.",
      );
    }
  }

  /**
   * Whole-scene motion warnings, run on the expanded scene so they see what the emitters see.
   * Both stay quiet for icons. The start rule of W-SYNC is in the expander, which knows which loops carry a phase.
   */
  motionChecks(): void {
    if (this.tier !== "icon") {
      const perSecond = this.keyCount / this.duration;
      if (this.animatedTracks > 0 && this.duration > 3 && perSecond < 3) {
        this.add(
          "W-MOTION-SPARSE",
          `The scene runs ${fmt(this.duration)} seconds and has ${this.keyCount} keyframes, ${perSecond.toFixed(1)} per second. Under 3 per second it reads as long holds between poses.`,
          "Add anticipation before a move, an 'overshoot' after it, a moving hold (a drift of a few pixels or a degree) when a part has arrived, and secondary motion with 'follow' on attached parts. See references/motion.md.",
        );
      }
      if (this.easedSegments > 20 && this.easeCurves.size === 1) {
        this.add(
          "W-EASE-UNIFORM",
          `All ${this.easedSegments} eased segments use the same curve, ${[...this.easeCurves][0]}.`,
          "Choose the ease by weight: 'easeOutCubic' or 'snap' for light and fast things, 'smooth' for deliberate moves, 'gentle' for drifts, 'settle' for arrivals. Use at least three different curves. See references/motion.md.",
        );
      }
    }
  }

  canvas(c: unknown): void {
    if (c === undefined) {
      this.add("E-FIELD-MISSING", "Required field 'canvas' is missing.", 'Add "canvas": { "w": 512, "h": 512 }.', undefined, "canvas");
      return;
    }
    if (!isObj(c)) {
      this.add("E-CANVAS", `Field 'canvas' is ${typeName(c)}, expected { "w": ..., "h": ... }.`, 'Use "canvas": { "w": 512, "h": 512 }.', undefined, "canvas");
      return;
    }
    this.unknownFields(c, ["w", "h", "background"], "canvas");
    for (const f of ["w", "h"] as const) {
      const v = c[f];
      if (v === undefined) this.add("E-FIELD-MISSING", `Required field 'canvas.${f}' is missing.`, `Add canvas.${f} as an integer.`, undefined, `canvas.${f}`);
      else if (!isNum(v) || !Number.isInteger(v) || v <= 0 || v > 4096) this.add("E-CANVAS", `canvas.${f} is ${JSON.stringify(v)}, expected a positive integer of at most 4096.`, `Set canvas.${f} to an integer between 1 and 4096.`, undefined, `canvas.${f}`);
      else if (f === "w") this.canvasW = v;
      else this.canvasH = v;
    }
    if (c["background"] !== undefined && c["background"] !== null) this.color(c["background"], "canvas.background");
  }

  paletteBlock(p: unknown): void {
    if (p === undefined) return;
    if (!isObj(p)) {
      this.add("E-FIELD-TYPE", `Field 'palette' is ${typeName(p)}, expected an object of colours.`, 'Use "palette": { "blue": "#3b82f6" }.', undefined, "palette");
      return;
    }
    for (const [k, v] of Object.entries(p)) {
      if (typeof v === "string" && isHexColor(v)) this.palette[k] = v;
      else this.add("E-COLOR", `Palette colour '${k}' is ${JSON.stringify(v)}, expected a hex colour.`, "Use '#rrggbb', '#rgb' or '#rrggbbaa'.", undefined, `palette.${k}`);
    }
  }

  checkDefCycles(defNodes: [string, Obj][]): void {
    const edges = new Map<string, string[]>();
    const collect = (n: Obj, out: string[]): void => {
      if (n["type"] === "use" && typeof n["ref"] === "string") out.push(n["ref"]);
      if (Array.isArray(n["children"])) for (const c of n["children"]) if (isObj(c)) collect(c, out);
    };
    for (const [k, v] of defNodes) {
      const out: string[] = [];
      collect(v, out);
      edges.set(k, out);
    }
    const state = new Map<string, number>();
    const visit = (k: string, stack: string[]): void => {
      if (state.get(k) === 2) return;
      if (state.get(k) === 1) {
        this.add("E-USE-CYCLE", `Definitions reference each other in a loop: ${[...stack, k].join(" -> ")}.`, "Remove the circular 'use' so a definition never contains itself.", undefined, `defs.${k}`);
        return;
      }
      state.set(k, 1);
      for (const next of edges.get(k) ?? []) if (edges.has(next)) visit(next, [...stack, k]);
      state.set(k, 2);
    };
    for (const k of edges.keys()) visit(k, []);
  }

  // ---------------------------------------------------------------- nodes

  node(n: Obj, path: string, top: boolean, defKey: string | undefined): void {
    this.nodeCount++;
    const id = n["id"];
    let nodeId: string | undefined;
    if (id === undefined) this.add("E-FIELD-MISSING", "Required field 'id' is missing.", "Give the node a unique id of lowercase letters, digits and hyphens.", undefined, `${path}.id`);
    else if (typeof id !== "string" || !ID_RE.test(id)) this.add("E-ID-FORMAT", `Node id ${JSON.stringify(id)} is not valid. Ids use lowercase letters, digits and hyphens and start with a letter.`, "Rename the id, for example 'dot-1'.", undefined, `${path}.id`);
    else {
      nodeId = id;
      const prev = this.ids.get(id);
      if (prev !== undefined) this.add("E-ID-DUPLICATE", `Node id '${id}' is already used at ${prev}.`, "Give every node a unique id.", id, `${path}.id`);
      else this.ids.set(id, path);
    }

    const type = n["type"];
    if (type === undefined) {
      this.add("E-FIELD-MISSING", "Required field 'type' is missing.", `Add a type. Valid types: ${NODE_TYPES.join(", ")}.`, nodeId, `${path}.type`);
      return;
    }
    if (typeof type !== "string" || !NODE_TYPES.includes(type)) {
      this.add("E-TYPE-UNKNOWN", `Unknown node type ${JSON.stringify(type)}.${typeof type === "string" ? didYouMean(type, NODE_TYPES) : ""} Valid types: ${NODE_TYPES.join(", ")}.`, "Use one of the valid node types.", nodeId, `${path}.type`);
      return;
    }

    const allowed = [...COMMON_FIELDS, ...(TYPE_FIELDS[type] as string[])];
    // A group never takes style fields, but report that with a clearer code below.
    if (type === "group") allowed.push(...STYLE_FIELDS);
    this.unknownFields(n, allowed, path, nodeId);

    if (!top && type !== "group") {
      /* nested nodes follow the same rules */
    }
    void defKey;

    for (const f of ["x", "y", "rotation"] as const) this.num(n, f, path, nodeId);
    this.num(n, "opacity", path, nodeId, { min: 0, max: 1 });
    const sc = n["scale"];
    if (sc !== undefined && !isNum(sc) && !isPair(sc)) this.add("E-FIELD-TYPE", `Field 'scale' is ${JSON.stringify(sc)}, expected a number or [sx, sy].`, "Use scale: 1.5 or scale: [1.5, 1].", nodeId, `${path}.scale`);
    const pv = n["pivot"];
    if (pv !== undefined && !isPair(pv)) this.add("E-FIELD-TYPE", `Field 'pivot' is ${JSON.stringify(pv)}, expected [x, y].`, "Use pivot: [120, 200].", nodeId, `${path}.pivot`);
    const from = this.num(n, "from", path, nodeId, { min: 0, max: this.duration });
    const to = this.num(n, "to", path, nodeId, { min: 0, max: this.duration });
    if (from !== undefined && to !== undefined && from >= to) this.add("E-NODE-TIME", `'from' (${from}) must be less than 'to' (${to}).`, "Make 'from' earlier than 'to'.", nodeId, `${path}.from`);

    switch (type) {
      case "group": {
        for (const f of STYLE_FIELDS) if (n[f] !== undefined) this.add("E-GROUP-STYLE", `A group cannot have '${f}'. Groups have no fill or stroke of their own.`, `Move '${f}' onto the child shapes.`, nodeId, `${path}.${f}`);
        const ch = n["children"];
        if (!Array.isArray(ch)) this.add("E-FIELD-MISSING", "A group needs a 'children' array.", "Add 'children' with at least one node.", nodeId, `${path}.children`);
        else if (ch.length === 0) this.add("E-GROUP-EMPTY", "The group has no children.", "Add child nodes or remove the group.", nodeId, `${path}.children`);
        else {
          ch.forEach((c, i) => {
            if (isObj(c)) this.node(c, `${path}.children[${i}]`, false, undefined);
            else this.add("E-FIELD-TYPE", `${path}.children[${i}] is ${typeName(c)}, expected a node object.`, "Make each child an object.", nodeId, `${path}.children[${i}]`);
          });
          this.matteSiblings(ch, `${path}.children`);
        }
        break;
      }
      case "use": {
        const ref = n["ref"];
        if (typeof ref !== "string") this.add("E-FIELD-MISSING", "A 'use' node needs 'ref', the name of an entry in 'defs'.", "Add 'ref'.", nodeId, `${path}.ref`);
        else this.useRefs.push({ ref, from: path, node: nodeId ?? path, path: `${path}.ref` });
        break;
      }
      case "image": {
        const src = n["src"];
        if (typeof src !== "string") this.add("E-FIELD-MISSING", "An image needs 'src', a file path.", "Add 'src'.", nodeId, `${path}.src`);
        else if (this.opts.fileExists && !this.opts.fileExists(src)) this.add("E-IMAGE-MISSING", `Image file '${src}' does not exist.`, "Fix the path. It is relative to the scene file.", nodeId, `${path}.src`);
        this.num(n, "w", path, nodeId, { required: true, positive: true });
        this.num(n, "h", path, nodeId, { required: true, positive: true });
        break;
      }
      case "lottie": {
        const src = n["src"];
        if (typeof src !== "string") this.add("E-FIELD-MISSING", "A lottie node needs 'src', the path of a Lottie JSON file.", "Add 'src'.", nodeId, `${path}.src`);
        else if (this.opts.fileExists && !this.opts.fileExists(src)) this.add("E-LOTTIE-MISSING", `Lottie file '${src}' does not exist.`, "Fix the path. It is relative to the scene file.", nodeId, `${path}.src`);
        else if (this.opts.lotties) {
          // The placed file animates by itself, so the scene is not static.
          this.animatedTracks++;
          const doc = this.opts.lotties[src];
          const problem = embedProblem(doc);
          if (problem) this.add(problem.code, `${problem.message} (${src})`, problem.fix, nodeId, `${path}.src`);
          else {
            const d = doc as { fr: number; ip: number; op: number };
            const have = (d.op - d.ip) / d.fr;
            const want = (to ?? this.duration ?? have) - (from ?? 0);
            if (Math.abs(have - want) > 0.05) this.add("W-LOTTIE-DURATION", `The Lottie file lasts ${fmt(have)} seconds and the node lasts ${fmt(want)}. ${have < want ? "The animation ends first and then nothing is shown." : "The end of the animation is cut off."}`, "Retime the file (gertie retime --duration) or change the node's 'from' and 'to'.", nodeId, `${path}.src`);
          }
        }
        break;
      }
      default:
        this.shape(n, type, path, nodeId);
    }

    if (n["clip"] !== undefined) this.clip(n["clip"], path, nodeId);
    if (n["matte"] !== undefined) this.matteField(n["matte"], path, nodeId);
    this.animate(n, type, path, nodeId, from, to);
    if (top && nodeId !== undefined && !n["animate"]) {
      /* static top-level nodes are still checked for visibility */
    }
    if (top && nodeId !== undefined) this.visibility(n, type, nodeId, path);
  }

  shape(n: Obj, type: string, path: string, node: string | undefined): void {
    switch (type) {
      case "rect":
        this.num(n, "w", path, node, { required: true, positive: true });
        this.num(n, "h", path, node, { required: true, positive: true });
        this.num(n, "radius", path, node, { min: 0 });
        break;
      case "ellipse":
        if (n["r"] === undefined && (n["rx"] === undefined || n["ry"] === undefined)) this.add("E-FIELD-MISSING", "An ellipse needs 'r' (circle) or both 'rx' and 'ry'.", "Add 'r', or 'rx' and 'ry'.", node, path);
        this.num(n, "r", path, node, { positive: true });
        this.num(n, "rx", path, node, { positive: true });
        this.num(n, "ry", path, node, { positive: true });
        break;
      case "path":
        if (n["d"] === undefined) this.add("E-FIELD-MISSING", "A path needs 'd', an SVG path string.", "Add 'd'.", node, `${path}.d`);
        else this.pathString(n["d"], `${path}.d`, node);
        break;
      case "line":
        for (const f of ["x1", "y1", "x2", "y2"]) this.num(n, f, path, node, { required: true });
        break;
      case "polygon":
      case "star": {
        const pts = this.num(n, "points", path, node, { required: true, min: type === "star" ? 3 : 3 });
        if (pts !== undefined && !Number.isInteger(pts)) this.add("E-FIELD-TYPE", `'points' is ${pts}, expected an integer.`, "Use a whole number of points.", node, `${path}.points`);
        this.num(n, "r", path, node, { required: true, positive: true });
        if (type === "star") this.num(n, "innerR", path, node, { required: true, positive: true });
        break;
      }
    }

    const fill = n["fill"];
    let hasFill = false;
    this.shapeCount++;
    if (type === "path" && typeof n["d"] === "string" && /[CcSsQqTtAa]/.test(n["d"])) this.hasCurvePath = true;
    if (isObj(fill)) this.hasGradient = true;
    this.noteFill(fill);
    const animatedFill = isObj(n["animate"]) ? n["animate"]["fill"] : undefined;
    if (Array.isArray(animatedFill)) for (const k of animatedFill) this.noteFill(Array.isArray(k) ? k[1] : isObj(k) ? k["v"] : undefined);
    if (fill !== undefined && fill !== null) {
      hasFill = true;
      if (typeof fill === "string") this.color(fill, `${path}.fill`, node);
      else if (isObj(fill)) this.gradient(fill, `${path}.fill`, node);
      else this.add("E-COLOR", `Field 'fill' is ${typeName(fill)}, expected a colour or gradient.`, "Use a hex colour, '$name' or a gradient object.", node, `${path}.fill`);
    }
    if (n["fillRule"] !== undefined && n["fillRule"] !== "nonzero" && n["fillRule"] !== "evenodd") this.add("E-FIELD-TYPE", `fillRule is ${JSON.stringify(n["fillRule"])}, expected "nonzero" or "evenodd".`, "Use \"nonzero\" or \"evenodd\".", node, `${path}.fillRule`);

    const stroke = n["stroke"];
    let hasStroke = false;
    if (stroke !== undefined && stroke !== null) {
      if (!isObj(stroke)) this.add("E-FIELD-TYPE", `Field 'stroke' is ${typeName(stroke)}, expected an object { color, width }.`, 'Use "stroke": { "color": "#fff", "width": 4 }.', node, `${path}.stroke`);
      else {
        hasStroke = true;
        this.unknownFields(stroke, ["color", "width", "cap", "join", "dash"], `${path}.stroke`, node);
        if (stroke["color"] === undefined) this.add("E-FIELD-MISSING", "A stroke needs 'color'.", "Add stroke.color.", node, `${path}.stroke.color`);
        else this.color(stroke["color"], `${path}.stroke.color`, node);
        this.num(stroke, "width", `${path}.stroke`, node, { min: 0 });
        if (stroke["cap"] !== undefined && !["butt", "round", "square"].includes(stroke["cap"] as string)) this.add("E-FIELD-TYPE", `stroke.cap is ${JSON.stringify(stroke["cap"])}, expected butt, round or square.`, "Use butt, round or square.", node, `${path}.stroke.cap`);
        if (stroke["join"] !== undefined && !["miter", "round", "bevel"].includes(stroke["join"] as string)) this.add("E-FIELD-TYPE", `stroke.join is ${JSON.stringify(stroke["join"])}, expected miter, round or bevel.`, "Use miter, round or bevel.", node, `${path}.stroke.join`);
        const dash = stroke["dash"];
        if (dash !== undefined && !(Array.isArray(dash) && dash.length > 0 && dash.every((d) => isNum(d) && d >= 0))) this.add("E-FIELD-TYPE", `stroke.dash is ${JSON.stringify(dash)}, expected an array of lengths such as [8, 6].`, "Use an array of non-negative numbers.", node, `${path}.stroke.dash`);
      }
    }
    if (!hasFill && !hasStroke) this.add("E-SHAPE-INVISIBLE", `The ${type} has neither fill nor stroke, so it would be invisible.`, "Add a 'fill' colour or a 'stroke' object.", node, path);
    if (type === "line" && !hasStroke) this.add("E-SHAPE-INVISIBLE", "A line is only visible with a stroke.", "Add a 'stroke' object to the line.", node, path);

    const trim = n["trim"];
    if (trim !== undefined && trim !== null) {
      if (!hasStroke) this.add("E-TRIM-NO-STROKE", "'trim' only affects strokes and this shape has none.", "Add a 'stroke' or remove 'trim'.", node, `${path}.trim`);
      if (!isObj(trim)) this.add("E-FIELD-TYPE", `Field 'trim' is ${typeName(trim)}, expected { start, end, offset }.`, 'Use "trim": { "start": 0, "end": 1 }.', node, `${path}.trim`);
      else {
        this.unknownFields(trim, ["start", "end", "offset"], `${path}.trim`, node);
        for (const f of ["start", "end"]) {
          const v = trim[f];
          if (v !== undefined && (!isNum(v) || v < 0 || v > 1)) this.add("E-RANGE-TRIM", `trim.${f} is ${JSON.stringify(v)}, expected 0 to 1.`, "Use a value between 0 and 1.", node, `${path}.trim.${f}`);
        }
        this.num(trim, "offset", `${path}.trim`, node);
      }
    }
  }

  /** The shape of a `matte` field: { by, mode }. */
  matteField(m: unknown, path: string, node: string | undefined): void {
    const p = `${path}.matte`;
    if (!isObj(m)) {
      this.add("E-MATTE-FIELD", `Field 'matte' is ${typeName(m)}, expected { "by": "<sibling id>", "mode": "alpha" }.`, 'Write "matte": { "by": "badge-shape", "mode": "alpha" }.', node, p);
      return;
    }
    this.unknownFields(m, ["by", "mode"], p, node);
    if (typeof m["by"] !== "string") this.add("E-MATTE-BY", m["by"] === undefined ? "A matte needs 'by', the id of the sibling node whose alpha is used." : `matte.by is ${typeName(m["by"])}, expected the id of a sibling node.`, 'Add "by": "<id of a node in the same list>".', node, `${p}.by`);
    const mode = m["mode"];
    if (mode !== undefined && !(typeof mode === "string" && (MATTE_MODES as readonly string[]).includes(mode)))
      this.add("E-MATTE-MODE", `matte.mode is ${JSON.stringify(mode)}.${typeof mode === "string" ? didYouMean(mode, MATTE_MODES) : ""} Allowed values: ${MATTE_MODES.join(", ")}.`, 'Use "alpha" (visible where the source is) or "alpha-inverted" (visible where the source is not). Luma mattes are not supported.', node, `${p}.mode`);
  }

  /** Checks every matte in one list of siblings: the source exists in the list, is not itself matted, and is always used in one mode. */
  matteSiblings(list: unknown[], path: string): void {
    const byId = new Map<string, Obj>();
    for (const c of list) if (isObj(c) && typeof c["id"] === "string") byId.set(c["id"], c);
    const modes = new Map<string, string>();
    list.forEach((c, i) => {
      if (!isObj(c) || !isObj(c["matte"]) || typeof c["matte"]["by"] !== "string") return;
      const id = typeof c["id"] === "string" ? c["id"] : undefined;
      const by = c["matte"]["by"];
      const mp = `${path}[${i}].matte.by`;
      const source = byId.get(by);
      if (source === undefined || by === id) {
        const sibs = [...byId.keys()].filter((k) => k !== id);
        const why = by === id ? "A node cannot be its own matte." : `No sibling has that id. A matte source must be in the same list of nodes as the node it mattes (same parent group, or both at the top level).`;
        this.add("E-MATTE-SIBLING", `Node '${id ?? path}' is matted by '${by}'. ${why}${by === id ? "" : didYouMean(by, sibs)} Siblings: ${sibs.join(", ") || "(none)"}.`, "Move the source next to the node it mattes, or fix 'by'.", id, mp);
        return;
      }
      if (isObj(source["matte"])) this.add("E-MATTE-CHAIN", `Node '${id ?? path}' is matted by '${by}', which is itself matted. A matte source cannot have a matte of its own.`, `Remove the matte from '${by}', or draw the combined shape as one node.`, id, mp);
      const mode = typeof c["matte"]["mode"] === "string" ? c["matte"]["mode"] : "alpha";
      const known = modes.get(by);
      if (known !== undefined && known !== mode) this.add("E-MATTE-CONFLICT", `Source '${by}' is used as a '${known}' matte by one node and as a '${mode}' matte by node '${id ?? path}'.`, `Use one mode for each source, or add a second copy of the source shape with its own id.`, id, `${path}[${i}].matte.mode`);
      else modes.set(by, mode);
    });
  }

  /** Markers are named spans of the timeline. They are written to the Lottie file only. */
  markersBlock(markers: unknown): void {
    if (markers === undefined) return;
    if (!isObj(markers)) {
      this.add("E-MARKER", `Field 'markers' is ${typeName(markers)}, expected an object mapping a name to [start, end] in seconds.`, 'Use "markers": { "intro": [0, 1], "loop": [1, 3] }.', undefined, "markers");
      return;
    }
    for (const [name, span] of Object.entries(markers)) {
      const p = `markers.${name}`;
      if (!ID_RE.test(name)) this.add("E-MARKER", `Marker name ${JSON.stringify(name)} is not valid. Names use lowercase letters, digits and hyphens and start with a letter.`, "Rename the marker, for example 'loop-start'.", undefined, p);
      if (!isPair(span)) {
        this.add("E-MARKER", `Marker '${name}' is ${JSON.stringify(span)}, expected [start, end] in seconds.`, `Write "${name}": [0, 1].`, undefined, p);
        continue;
      }
      const [a, b] = span;
      if (!(a < b)) this.add("E-MARKER", `Marker '${name}' starts at ${fmt(a)} and ends at ${fmt(b)}. The start must be less than the end.`, `Make the end later than the start, for example [${fmt(a)}, ${fmt(a + 1)}].`, undefined, p);
      else if (a < 0 || b > this.duration) this.add("E-MARKER", `Marker '${name}' spans ${fmt(a)} to ${fmt(b)} seconds, outside 0 to ${fmt(this.duration)}.`, `Keep both times between 0 and ${fmt(this.duration)}.`, undefined, p);
    }
  }

  gradient(g: Obj, path: string, node: string | undefined): void {
    const t = g["type"];
    let stopsOk = true;
    if (t === "linear") {
      this.unknownFields(g, ["type", "from", "to", "stops"], path, node);
      if (!isPair(g["from"]) || !isPair(g["to"])) {
        this.add("E-GRADIENT", "A linear gradient needs 'from' and 'to' as [x, y] pairs.", 'Add "from": [0, -50], "to": [0, 50].', node, path);
        stopsOk = false;
      }
    } else if (t === "radial") {
      this.unknownFields(g, ["type", "center", "radius", "stops"], path, node);
      if (!isPair(g["center"]) || !isNum(g["radius"]) || g["radius"] <= 0) {
        this.add("E-GRADIENT", "A radial gradient needs 'center' as [x, y] and a positive 'radius'.", 'Add "center": [0, 0], "radius": 80.', node, path);
        stopsOk = false;
      }
    } else {
      this.add("E-GRADIENT", `Gradient type is ${JSON.stringify(t)}, expected "linear" or "radial".`, 'Set "type" to "linear" or "radial".', node, `${path}.type`);
      return;
    }
    const stops = g["stops"];
    if (!Array.isArray(stops) || stops.length < 2) {
      this.add("E-GRADIENT", "A gradient needs at least two stops.", 'Use "stops": [[0, "#ff8a00"], [1, "#e52e71"]].', node, `${path}.stops`);
      return;
    }
    let last = -1;
    stops.forEach((s, i) => {
      if (!Array.isArray(s) || s.length !== 2 || !isNum(s[0]) || s[0] < 0 || s[0] > 1) {
        this.add("E-GRADIENT", `Stop ${i} is ${JSON.stringify(s)}, expected [offset, colour] with offset from 0 to 1.`, "Write each stop as [0.5, \"#rrggbb\"].", node, `${path}.stops[${i}]`);
        return;
      }
      if (s[0] <= last) this.add("E-GRADIENT", `Stop ${i} offset ${s[0]} is not greater than the previous offset ${last}.`, "Order stops by ascending offset.", node, `${path}.stops[${i}]`);
      last = s[0];
      this.color(s[1], `${path}.stops[${i}][1]`, node);
    });
    void stopsOk;
  }

  clip(c: unknown, path: string, node: string | undefined): void {
    const p = `${path}.clip`;
    if (!isObj(c)) {
      this.add("E-FIELD-TYPE", `Field 'clip' is ${typeName(c)}, expected a shape such as { "type": "rect", "w": 100, "h": 100 }.`, "Use a rect, ellipse or path description.", node, p);
      return;
    }
    const t = c["type"];
    if (t !== "rect" && t !== "ellipse" && t !== "path") {
      this.add("E-TYPE-UNKNOWN", `Clip type is ${JSON.stringify(t)}. Valid clip types: rect, ellipse, path.`, "Use rect, ellipse or path.", node, `${p}.type`);
      return;
    }
    if (c["animate"] !== undefined) this.add("E-NOT-IMPLEMENTED", "Animated clips are not available yet.", "Remove 'animate' from the clip, or animate the clipped node instead.", node, `${p}.animate`);
    const fields: Record<string, string[]> = { rect: ["w", "h", "radius"], ellipse: ["rx", "ry", "r"], path: ["d"] };
    this.unknownFields(c, ["type", "x", "y", "animate", ...(fields[t] as string[])], p, node);
    this.num(c, "x", p, node);
    this.num(c, "y", p, node);
    if (t === "rect") {
      this.num(c, "w", p, node, { required: true, positive: true });
      this.num(c, "h", p, node, { required: true, positive: true });
      this.num(c, "radius", p, node, { min: 0 });
    } else if (t === "ellipse") {
      if (c["r"] === undefined && (c["rx"] === undefined || c["ry"] === undefined)) this.add("E-FIELD-MISSING", "An ellipse clip needs 'r' or both 'rx' and 'ry'.", "Add 'r', or 'rx' and 'ry'.", node, p);
      this.num(c, "r", p, node, { positive: true });
      this.num(c, "rx", p, node, { positive: true });
      this.num(c, "ry", p, node, { positive: true });
    } else if (c["d"] === undefined) this.add("E-FIELD-MISSING", "A path clip needs 'd'.", "Add 'd'.", node, `${p}.d`);
    else this.pathString(c["d"], `${p}.d`, node);
  }

  // ---------------------------------------------------------------- animation

  animate(n: Obj, type: string, path: string, node: string | undefined, from: number | undefined, to: number | undefined): void {
    const a = n["animate"];
    if (a === undefined) return;
    const ap = `${path}.animate`;
    if (!isObj(a)) {
      this.add("E-FIELD-TYPE", `Field 'animate' is ${typeName(a)}, expected an object mapping property names to keyframes.`, 'Use "animate": { "x": [[0, 0], [1, 100]] }.', node, ap);
      return;
    }
    const kinds = propKinds(type, n);
    const valid = Object.keys(kinds);
    for (const [prop, keys] of Object.entries(a)) {
      const pp = `${ap}.${prop}`;
      const kind = kinds[prop];
      if (kind === undefined) {
        this.add("E-PROP-UNKNOWN", this.propHint(type, prop, n, valid), `Animate one of: ${valid.join(", ")}.`, node, pp);
        continue;
      }
      this.track(prop, kind, keys, pp, node, from ?? 0, to ?? this.duration);
    }
  }

  propHint(type: string, prop: string, n: Obj, valid: string[]): string {
    const base = `Property '${prop}' cannot be animated on this ${type}.`;
    const g = n["fill"];
    if (prop.startsWith("fill.")) {
      const linear = ["fill.from", "fill.to"];
      const radial = ["fill.center", "fill.radius"];
      if (!isObj(g)) return `${base} Gradient geometry can only be animated on a node whose fill is a gradient.`;
      if (g["type"] === "linear" && radial.includes(prop)) return `${base} This node has a linear gradient, which animates 'fill.from' and 'fill.to'. 'fill.center' and 'fill.radius' belong to a radial gradient.`;
      if (g["type"] === "radial" && linear.includes(prop)) return `${base} This node has a radial gradient, which animates 'fill.center' and 'fill.radius'. 'fill.from' and 'fill.to' belong to a linear gradient.`;
    }
    if (prop === "fill") return `${base} Only a solid colour fill can be animated, and this node has ${isObj(g) ? "a gradient (animate 'fill.from' and 'fill.to', or 'fill.center' and 'fill.radius', instead; gradient stops stay static)" : "no"} fill.`;
    if (prop.startsWith("stroke") || prop.startsWith("trim")) return `${base} The node has no stroke.`;
    if (["polygon", "star", "line"].includes(type)) return `${base} Polygons, stars and lines are converted to paths, so only transform, fill and stroke properties animate. Use a 'path' node to morph geometry.`;
    return `${base}${didYouMean(prop, valid)} Valid properties: ${valid.join(", ")}.`;
  }

  track(prop: string, kind: ValueKind, keys: unknown, path: string, node: string | undefined, from: number, to: number): void {
    if (!Array.isArray(keys)) {
      this.add("E-KEY-SHAPE", `Keyframes for '${prop}' are ${typeName(keys)}, expected an array of [time, value] keyframes.`, "Write keyframes as [[0, 0], [1, 100]].", node, path);
      return;
    }
    if (keys.length < 2) {
      this.add("E-KEY-SINGLE", `Property '${prop}' has ${keys.length} keyframe. An animation needs at least two.`, "Add a second keyframe, or set the value statically on the node.", node, path);
      return;
    }
    this.animatedTracks++;
    this.keyCount += keys.length;
    const parsed: RawKey[] = [];
    let bad = false;
    keys.forEach((k, i) => {
      const r = readKey(k, i);
      if (!r.ok) {
        this.add("E-KEY-SHAPE", `Keyframe ${i} of '${prop}' ${r.reason}. Expected [time, value] or [time, value, ease].`, "Write keyframes as [0.5, 100] or [0.5, 100, \"easeOut\"].", node, `${path}[${i}]`);
        bad = true;
      } else parsed.push(r.key);
    });
    if (bad) return;
    for (const k of parsed.slice(1)) {
      if (!isEasedCurve(k.ease === undefined ? "easeInOut" : k.ease)) continue;
      this.easedSegments++;
      const r = resolveEase(k.ease === undefined ? "easeInOut" : k.ease);
      if (r.kind === "ok" && r.ease !== "hold") this.easeCurves.add(r.ease.map((n) => Math.round(n * 100) / 100).join(", "));
    }

    let prevTime = -Infinity;
    const frames = new Set<number>();
    let ordered = true;
    for (const k of parsed) {
      const kp = `${path}[${k.index}]`;
      if (k.time < 0 || k.time > this.duration) {
        this.add("E-KEY-RANGE", `Keyframe time ${fmt(k.time)} is outside 0 to ${fmt(this.duration)} seconds.`, `Use a time between 0 and ${fmt(this.duration)}.`, node, kp);
        ordered = false;
      } else if (k.time <= prevTime) {
        this.add("E-KEY-ORDER", `Keyframe time ${fmt(k.time)} is not after the previous keyframe time ${fmt(prevTime)}.`, `Keyframe times must increase. Change this time to a value greater than ${fmt(prevTime)}, or reorder the keyframes.`, node, kp);
        ordered = false;
      } else {
        const frame = Math.round(k.time * this.fps);
        if (frames.has(frame)) this.add("E-KEY-COLLIDE", `Keyframe time ${fmt(k.time)} lands on frame ${frame}, which the previous keyframe already uses at ${this.fps} fps.`, `Space keyframes at least ${fmt(1 / this.fps)} seconds apart.`, node, kp);
        frames.add(frame);
      }
      prevTime = Math.max(prevTime, k.time);
      this.easeCheck(k, k.index === 0, kp, node);
    }

    const values: unknown[] = [];
    let valuesOk = true;
    for (const k of parsed) {
      const ok = this.value(kind, k.value, `${path}[${k.index}]`, prop, node);
      if (ok === undefined) valuesOk = false;
      values.push(ok);
    }
    if (!valuesOk) return;

    if (kind === "path") {
      const base = values[0] as Subpath[];
      const baseStruct = pathStructure(base);
      for (let i = 1; i < values.length; i++) {
        const other = values[i] as Subpath[];
        if (pathStructure(other) !== baseStruct) {
          this.add("E-MORPH-MISMATCH", `Path keyframe ${i} has a different structure from keyframe 0. ${this.describeMismatch(base, other)}`, "Morphing needs the same number of subpaths, the same number of segments in each, and the same open or closed state. Rewrite both paths with the same commands.", node, `${path}[${i}]`);
          return;
        }
      }
    }

    if (this.loop && ordered && from === 0 && to === this.duration) this.loopJump(prop, kind, values, parsed, path, node);
    if (ordered) this.fast(prop, kind, values, parsed, path, node);
  }

  describeMismatch(a: Subpath[], b: Subpath[]): string {
    if (a.length !== b.length) return `Keyframe 0 has ${a.length} subpath(s), this one has ${b.length}.`;
    for (let i = 0; i < a.length; i++) {
      const x = a[i] as Subpath;
      const y = b[i] as Subpath;
      if (x.closed !== y.closed) return `Subpath ${i} is ${x.closed ? "closed" : "open"} in keyframe 0 and ${y.closed ? "closed" : "open"} here.`;
      if (x.v.length !== y.v.length) return `Subpath ${i} has ${x.v.length} vertices in keyframe 0 and ${y.v.length} here.`;
    }
    return "";
  }

  easeCheck(k: RawKey, first: boolean, path: string, node: string | undefined): void {
    if (k.ease === undefined) return;
    if (first) {
      this.add("W-EASE-FIRST", "An ease on the first keyframe has no effect, because nothing arrives at it.", "Remove the ease from the first keyframe.", node, path);
    }
    const r = resolveEase(k.ease);
    switch (r.kind) {
      case "unknown-name":
        this.add("E-EASE-UNKNOWN", `Unknown easing '${r.name}'.${didYouMean(r.name, [...EASING_NAMES, "hold"])} Valid names: ${EASING_NAMES.join(", ")}, hold.`, "Use a valid easing name or a [x1, y1, x2, y2] bezier.", node, path);
        break;
      case "deferred":
        // bounce, elastic and spring are expanded to keyframes before the linter runs. One left here is on a first key, which has no effect.
        break;
      case "bad-range":
        this.add("E-EASE-RANGE", `Custom bezier [${r.value.join(", ")}] has x1 or x2 outside 0 to 1.`, "Keep x1 and x2 within 0 to 1. y values may go outside to overshoot.", node, path);
        break;
      case "bad-shape":
        this.add("E-EASE-UNKNOWN", `Easing ${JSON.stringify(k.ease)} is not a name or a [x1, y1, x2, y2] bezier.`, "Use a valid easing name or four numbers.", node, path);
        break;
      default:
    }
  }

  /** Validates a keyframe value. Returns a comparable form, or undefined when invalid. */
  value(kind: ValueKind, v: unknown, path: string, prop: string, node: string | undefined): unknown {
    switch (kind) {
      case "number":
      case "nonneg":
      case "unit": {
        if (!isNum(v)) {
          this.add("E-KEY-VALUE", `Value ${JSON.stringify(v)} for '${prop}' is not a number.`, "Use a number.", node, path);
          return undefined;
        }
        if (kind === "unit") {
          if (prop === "opacity" && (v < 0 || v > 1)) {
            this.add("E-RANGE-OPACITY", `Opacity ${v} is outside 0 to 1.`, "Use an opacity between 0 and 1.", node, path);
            return undefined;
          }
          if (prop.startsWith("trim.") && (v < 0 || v > 1)) {
            this.add("E-RANGE-TRIM", `${prop} value ${v} is outside 0 to 1.`, "Use a value between 0 and 1.", node, path);
            return undefined;
          }
        }
        if (kind === "nonneg" && v < 0) {
          this.add("E-KEY-VALUE", `Value ${v} for '${prop}' is negative.`, "Use a value of 0 or more.", node, path);
          return undefined;
        }
        return v;
      }
      case "point": {
        if (isPair(v)) return v;
        this.add("E-KEY-VALUE", `Value ${JSON.stringify(v)} for '${prop}' is not an [x, y] pair.`, "Use [0, -50].", node, path);
        return undefined;
      }
      case "positive": {
        if (isNum(v) && v > 0) return v;
        this.add("E-KEY-VALUE", `Value ${JSON.stringify(v)} for '${prop}' is not a number above 0.`, "Use a radius greater than 0, for example 80.", node, path);
        return undefined;
      }
      case "scale": {
        if (isNum(v)) return [v, v];
        if (isPair(v)) return v;
        this.add("E-KEY-VALUE", `Value ${JSON.stringify(v)} for 'scale' is not a number or [sx, sy].`, "Use 1.5 or [1.5, 1].", node, path);
        return undefined;
      }
      case "color": {
        const hex = this.color(v, path, node);
        if (hex === null) return undefined;
        return parseHex(hex);
      }
      case "path":
        return this.pathString(v, path, node) ?? undefined;
    }
  }

  loopJump(prop: string, kind: ValueKind, values: unknown[], keys: RawKey[], path: string, node: string | undefined): void {
    const first = values[0];
    const last = values[values.length - 1];
    // A straight, constant-speed move across the whole scene is a scroll: a repeating pattern that travels a whole number of its periods
    // closes exactly, as a full turn does, and the linter cannot see the pattern. The render check W-R-LOOP decides whether it does close.
    if ((prop === "x" || prop === "y") && keys.length === 2 && keys[1]?.ease === "linear") return;
    let same: boolean;
    if (kind === "path") same = JSON.stringify(first) === JSON.stringify(last);
    else if (prop === "rotation") same = Math.abs((((last as number) - (first as number)) % 360) as number) < 1e-9;
    else same = JSON.stringify(first) === JSON.stringify(last);
    if (!same) {
      const f = kind === "path" ? "the first path" : JSON.stringify(first);
      const l = kind === "path" ? "the last path" : JSON.stringify(last);
      this.add("W-LOOP-JUMP", `The scene loops, but '${prop}' starts at ${f} and ends at ${l}, so the loop will jump.`, `Make the last keyframe value equal the first, or set "loop": false.`, node, path);
    }
    void keys;
  }

  fast(prop: string, kind: ValueKind, values: unknown[], keys: RawKey[], path: string, node: string | undefined): void {
    const limit = prop === "opacity" ? 0.5 : prop === "rotation" ? 90 : prop === "x" ? this.canvasW / 2 : prop === "y" ? this.canvasH / 2 : Infinity;
    if (!Number.isFinite(limit) || limit <= 0 || kind === "color" || kind === "path" || kind === "scale" || kind === "point") return;
    for (let i = 1; i < keys.length; i++) {
      const a = keys[i - 1] as RawKey;
      const b = keys[i] as RawKey;
      const frames = (b.time - a.time) * this.fps;
      const hold = b.ease === "hold";
      const delta = Math.abs((values[i] as number) - (values[i - 1] as number));
      if (!hold && frames <= 2.5 && delta > limit) {
        this.add("W-FAST", `'${prop}' changes by ${fmt(delta)} within ${fmt(frames)} frames, which usually flickers.`, `Give the change more time, or use "hold" if a jump is intended.`, node, `${path}[${b.index}]`);
        return;
      }
    }
  }

  /** Conservative offscreen and tiny checks for simple, statically placed top-level shapes. */
  visibility(n: Obj, type: string, node: string, path: string): void {
    const a = isObj(n["animate"]) ? n["animate"] : {};
    const placementAnimated = ["x", "y", "scale", "rotation"].some((p) => p in a);
    const geometryAnimated = ["w", "h", "rx", "ry", "r"].some((p) => p in a);
    if (geometryAnimated || placementAnimated || n["pivot"] !== undefined) return;
    if (n["from"] !== undefined || n["to"] !== undefined) return;
    let hw: number;
    let hh: number;
    if (type === "rect" && isNum(n["w"]) && isNum(n["h"])) {
      hw = n["w"] / 2;
      hh = n["h"] / 2;
    } else if (type === "ellipse") {
      const rx = isNum(n["rx"]) ? n["rx"] : isNum(n["r"]) ? n["r"] : NaN;
      const ry = isNum(n["ry"]) ? n["ry"] : isNum(n["r"]) ? n["r"] : NaN;
      hw = rx;
      hh = ry;
    } else if ((type === "polygon" || type === "star") && isNum(n["r"])) {
      hw = n["r"];
      hh = n["r"];
    } else return;
    if (!Number.isFinite(hw) || !Number.isFinite(hh)) return;
    const sc = n["scale"];
    const [sx, sy] = isNum(sc) ? [sc, sc] : isPair(sc) ? sc : [1, 1];
    hw *= Math.abs(sx);
    hh *= Math.abs(sy);
    const x = isNum(n["x"]) ? n["x"] : 0;
    const y = isNum(n["y"]) ? n["y"] : 0;
    if (hw * 2 < 2 || hh * 2 < 2) this.add("W-TINY", `The node is ${fmt(hw * 2)} by ${fmt(hh * 2)} pixels, smaller than 2 pixels.`, "Make the node larger.", node, path);
    if (this.canvasW > 0 && (x + hw < 0 || x - hw > this.canvasW || y + hh < 0 || y - hh > this.canvasH)) {
      this.add("W-OFFSCREEN", `The node is entirely outside the ${this.canvasW} by ${this.canvasH} canvas for the whole animation.`, "Move it inside the canvas, or animate it into view.", node, path);
    }
  }
}

/** Presets, repeats and special easings are expanded to plain keyframes first, so every rule below sees what the emitters will see. */
export function lintScene(raw: unknown, opts: LintOptions = {}): Diagnostic[] {
  const included = resolveIncludes(raw, opts.loadFragment);
  const expanded = expandScene(included.scene);
  const l = new Linter(opts);
  l.run(expanded.scene);
  const early = [...included.diagnostics, ...expanded.diagnostics];
  const blocked = early.some((d) => d.severity === "error");
  // A scene whose includes or presets failed to expand looks static only because of that failure.
  return [...early, ...l.diags.filter((d) => !(blocked && d.code === "W-STATIC"))];
}

export { closest };
