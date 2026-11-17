import { didYouMean, makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";
import { readKey } from "../spec/keys.ts";
import { FPS_VALUES } from "../spec/types.ts";
import { expandSpecialEase, isNumeric, isSpecialEase } from "./ease-expand.ts";
import { PRESET_NAMES, PRESETS } from "./library.ts";
import { mulberry32, RIG_PRESET_NAMES, RIG_PRESETS } from "./rigs.ts";
import { expandOvershoot, followKeys, readFollow, readOvershoot } from "./motion-extras.ts";
import { rotateCycle, unroll, type RepeatMode } from "./repeat.ts";
import type { ParamSpec, Params, PartRef, PKey, Statics } from "./types.ts";

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export const ALL_PRESET_NAMES: readonly string[] = [...PRESET_NAMES, ...RIG_PRESET_NAMES];
const STAGGER_ORDERS = ["forward", "reverse", "center-out", "edges-in", "random"] as const;
const REPEATS = ["loop", "pingpong"] as const;
const ENTRY_FIELDS = ["preset", "at", "duration", "repeat", "phase", "applyTo", "seed"];
const STAGGER_FIELDS = ["each", "phase", "order", "seed"];

interface Stagger {
  each: number;
  /** Fraction of a cycle by which each child of a looping preset trails the one before it. */
  phase: number;
  order: string;
  seed: number;
}

export interface Expanded {
  /** A copy of the scene with `motion`, `stagger`, `{ keys, repeat }` and special easings replaced by plain keyframes. */
  scene: unknown;
  diagnostics: Diagnostic[];
}

/** Children of one group that run one looping preset with the same length, start and phase. */
interface InStep {
  preset: string;
  nodes: Set<Obj>;
}

/** Fewer children than this in step is a pair moving together, which reads as intended. */
const SYNC_MIN = 3;

interface Block {
  /** True when the block is a loop started part of the way through its cycle by `phase`. */
  phased?: boolean;
  prop: string;
  start: number;
  end: number;
  keys: PKey[];
  user: boolean;
  label: string;
}

const fmt = (n: number): string => String(Math.round(n * 1000) / 1000);

/** The time a property starts to move: the first key whose value differs from the next. The first key's time when nothing changes. */
function firstChange(keys: readonly PKey[]): number {
  for (let i = 0; i + 1 < keys.length; i++) {
    if (JSON.stringify((keys[i] as PKey).v) !== JSON.stringify((keys[i + 1] as PKey).v)) return (keys[i] as PKey).t;
  }
  return keys[0]?.t ?? 0;
}

function staticsOf(n: Obj): Statics {
  const sc = n["scale"];
  let sx = 1;
  let sy = 1;
  if (isNum(sc)) sx = sy = sc;
  else if (Array.isArray(sc) && sc.length === 2 && isNum(sc[0]) && isNum(sc[1])) [sx, sy] = [sc[0], sc[1]];
  return {
    x: isNum(n["x"]) ? n["x"] : 0,
    y: isNum(n["y"]) ? n["y"] : 0,
    rotation: isNum(n["rotation"]) ? n["rotation"] : 0,
    sx,
    sy,
    opacity: isNum(n["opacity"]) ? n["opacity"] : 1,
  };
}

function* descendants(n: Obj): Generator<Obj> {
  if (!Array.isArray(n["children"])) return;
  for (const c of n["children"]) {
    if (!isObj(c)) continue;
    yield c;
    yield* descendants(c);
  }
}

function clampFor(prop: string): (v: number) => number {
  if (prop === "opacity" || prop === "trim.start" || prop === "trim.end") return (v) => Math.min(1, Math.max(0, v));
  if (["w", "h", "radius", "rx", "ry", "r", "stroke.width"].includes(prop)) return (v) => Math.max(0, v);
  return (v) => v;
}

class Expander {
  readonly diags: Diagnostic[] = [];
  readonly fps: number;
  readonly duration: number;
  private readonly blocks = new Map<Obj, Block[]>();
  private readonly order: { node: Obj; path: string }[] = [];
  private readonly parents = new Map<Obj, Obj>();
  /** By group, then by preset, length, start and phase: the children that loop in step. */
  private readonly loops = new Map<Obj, Map<string, InStep>>();
  /** The first frame of every animated property, for the start rule of W-SYNC. A phased loop counts as its own start. */
  private readonly starts: { frame: number; phased: boolean }[] = [];

  constructor(private readonly root: Obj, fps: number, duration: number) {
    this.fps = fps;
    this.duration = duration;
  }

  private add(code: string, message: string, fix: string, node: string | undefined, path: string): void {
    const where: { node?: string; path?: string } = { path };
    if (node !== undefined) where.node = node;
    this.diags.push(makeDiagnostic(code, message, fix, where));
  }

  run(): void {
    const top = this.root["nodes"];
    if (Array.isArray(top)) top.forEach((n, i) => this.collect(n, `nodes[${i}]`));
    const defs = this.root["defs"];
    if (isObj(defs)) for (const [k, v] of Object.entries(defs)) this.collect(v, `defs.${k}`);
    for (const { node, path } of this.order) this.motion(node, path);
    for (const { node, path } of this.order) this.sync(node, path);
    for (const { node, path } of this.order) this.finish(node, path);
    // Parents come before their children in `order`, so a chain of followers reads keys that are already written.
    for (const { node, path } of this.order) this.follow(node, path);
    this.syncStarts();
  }

  /**
   * More than 6 animated properties of which over 80 percent begin on one frame look mechanical.
   * A property begins at the first key whose value differs from the next one, as `profile` counts it: a key that only holds the resting value until the move starts is not the start.
   * A loop that carries a `phase`, and a follower with a delay, start part of the way through their motion, so each counts as its own start.
   */
  private syncStarts(): void {
    if (this.starts.length <= 6) return;
    const counts = new Map<number, number>();
    for (const s of this.starts) if (!s.phased) counts.set(s.frame, (counts.get(s.frame) ?? 0) + 1);
    let frame = 0;
    let most = 0;
    for (const [f, c] of counts) if (c > most) [frame, most] = [f, c];
    if (most / this.starts.length > 0.8) {
      this.add("W-SYNC", `${most} of ${this.starts.length} animated properties start on frame ${frame}, which looks mechanical.`, `Offset the starts: put the nodes in a group and give it a stagger of 0.03 to 0.1 seconds with "applyTo": "children", or give the parts their own 'at', 'delay' or, for loops, 'phase'. Parts that trail a parent can use 'follow'.`, undefined, "nodes");
    }
  }

  private collect(n: unknown, path: string): void {
    if (!isObj(n)) return;
    this.order.push({ node: n, path });
    if (Array.isArray(n["children"])) {
      n["children"].forEach((c, i) => {
        if (isObj(c)) this.parents.set(c, n);
        this.collect(c, `${path}.children[${i}]`);
      });
    }
  }

  private idOf(n: Obj): string | undefined {
    return typeof n["id"] === "string" ? n["id"] : undefined;
  }

  // ------------------------------------------------------------------ motion entries

  private motion(node: Obj, path: string): void {
    const id = this.idOf(node);
    const stagger = this.staggerOf(node, path);
    const motion = node["motion"];
    let usesChildren = false;
    if (motion !== undefined) {
      if (!Array.isArray(motion)) {
        this.add("E-FIELD-TYPE", `Field 'motion' is not an array.`, 'Use "motion": [ { "preset": "pop-in" } ].', id, `${path}.motion`);
      } else {
        motion.forEach((e, i) => {
          const ep = `${path}.motion[${i}]`;
          if (!isObj(e)) {
            this.add("E-FIELD-TYPE", `motion[${i}] is not an object.`, 'Write each entry as { "preset": "pop-in", "at": 0.2 }.', id, ep);
            return;
          }
          if (e["applyTo"] === "children") usesChildren = true;
          this.entry(node, e, ep, stagger);
        });
      }
    }
    if (stagger && !usesChildren) {
      this.add("W-STAGGER-UNUSED", "The group has 'stagger' but no motion entry with applyTo 'children', so the stagger does nothing.", `Add "applyTo": "children" to a motion entry, or remove 'stagger'.`, id, `${path}.stagger`);
    }
  }

  /**
   * Notes that `child` runs a looping preset, for W-SYNC. Entries are in step when the preset, the repeat mode,
   * the length, the start and the phase are all the same. A spin is left out: gears and loaders turn together on purpose.
   */
  private noteLoop(group: Obj | undefined, child: Obj, name: string, repeat: RepeatMode | undefined, length: number, at: number, phase: number): void {
    if (!group || !repeat || PRESETS[name]?.cumulative) return;
    const key = [name, repeat, fmt(length), fmt(at), fmt(phase)].join("|");
    const byKey = this.loops.get(group) ?? new Map<string, InStep>();
    const hit = byKey.get(key) ?? { preset: name, nodes: new Set<Obj>() };
    hit.nodes.add(child);
    byKey.set(key, hit);
    this.loops.set(group, byKey);
  }

  /** One W-SYNC per group and preset, however many children or sets of children are in step. */
  private sync(group: Obj, path: string): void {
    const byKey = this.loops.get(group);
    if (!byKey) return;
    const id = this.idOf(group);
    const worst = new Map<string, number>();
    for (const { preset, nodes } of byKey.values()) {
      if (nodes.size >= SYNC_MIN) worst.set(preset, Math.max(worst.get(preset) ?? 0, nodes.size));
    }
    for (const [preset, count] of worst) {
      this.add("W-SYNC", `${count} nodes in '${id ?? "this group"}' run '${preset}' in step, which looks mechanical.`, `Give the group a stagger with a phase, for example "stagger": { "phase": 0.15 } with "applyTo": "children" on the group, or give each entry its own "phase".`, id, `${path}.children`);
    }
  }

  private staggerOf(node: Obj, path: string): Stagger | undefined {
    const s = node["stagger"];
    if (s === undefined) return undefined;
    const id = this.idOf(node);
    const p = `${path}.stagger`;
    if (node["type"] !== "group") {
      this.add("E-FIELD-TYPE", "'stagger' is only valid on a group.", "Remove 'stagger', or put the nodes in a group and stagger that.", id, p);
      return undefined;
    }
    if (!isObj(s)) {
      this.add("E-FIELD-TYPE", "Field 'stagger' is not an object.", 'Use "stagger": { "each": 0.08, "order": "forward" }.', id, p);
      return undefined;
    }
    for (const k of Object.keys(s)) {
      if (!STAGGER_FIELDS.includes(k)) this.add("E-FIELD-UNKNOWN", `Unknown stagger field '${k}'.${didYouMean(k, STAGGER_FIELDS)} Valid fields: ${STAGGER_FIELDS.join(", ")}.`, "Use only each, phase, order and seed.", id, `${p}.${k}`);
    }
    const phase = s["phase"] === undefined ? 0 : s["phase"];
    if (!isNum(phase) || phase < 0 || phase >= 1) {
      this.add("E-FIELD-TYPE", `stagger.phase is ${JSON.stringify(phase)}, expected a fraction of a cycle from 0 up to, but not including, 1.`, "Set phase to a number such as 0.15: each child then trails the one before it by 15 percent of a cycle.", id, `${p}.phase`);
      return undefined;
    }
    const each = s["each"] === undefined && s["phase"] !== undefined ? 0 : s["each"];
    if (!isNum(each) || each < 0) {
      this.add("E-FIELD-TYPE", `stagger.each is ${JSON.stringify(s["each"])}, expected seconds as a number of 0 or more.`, "Set each to a number such as 0.08.", id, `${p}.each`);
      return undefined;
    }
    const order = s["order"] === undefined ? "forward" : s["order"];
    if (typeof order !== "string" || !(STAGGER_ORDERS as readonly string[]).includes(order)) {
      this.add("E-FIELD-TYPE", `stagger.order is ${JSON.stringify(order)}. Valid orders: ${STAGGER_ORDERS.join(", ")}.`, "Use one of the valid orders.", id, `${p}.order`);
      return undefined;
    }
    return { each, phase, order, seed: isNum(s["seed"]) ? s["seed"] : 1 };
  }

  private entry(node: Obj, e: Obj, ep: string, stagger: Stagger | undefined): void {
    const id = this.idOf(node);
    const name = e["preset"];
    if (name === undefined) {
      this.add("E-FIELD-MISSING", "A motion entry needs a 'preset'.", `Add "preset": one of ${ALL_PRESET_NAMES.join(", ")}.`, id, `${ep}.preset`);
      return;
    }
    if (typeof name !== "string" || !ALL_PRESET_NAMES.includes(name)) {
      this.add("E-PRESET-UNKNOWN", `Unknown preset ${JSON.stringify(name)}.${typeof name === "string" ? didYouMean(name, ALL_PRESET_NAMES) : ""} Valid presets: ${ALL_PRESET_NAMES.join(", ")}.`, "Use one of the valid preset names.", id, `${ep}.preset`);
      return;
    }
    const rig = RIG_PRESETS[name];
    const def = PRESETS[name];
    const specs: Record<string, ParamSpec> = (rig ?? def)?.params ?? {};
    const defaultLength = (rig ?? def)?.duration ?? 0.5;
    const loops = (rig ?? def)?.loops ?? false;

    let bad = false;
    for (const k of Object.keys(e)) {
      if (!ENTRY_FIELDS.includes(k) && !(k in specs)) {
        const valid = [...ENTRY_FIELDS.filter((f) => f !== "seed"), ...Object.keys(specs)];
        this.add("E-FIELD-UNKNOWN", `Unknown field '${k}' for preset '${name}'.${didYouMean(k, valid)} Valid fields: ${valid.join(", ")}.`, "Remove the field or use one of the valid ones.", id, `${ep}.${k}`);
        bad = true;
      }
    }
    const at = e["at"] === undefined ? 0 : e["at"];
    if (!isNum(at) || at < 0) {
      this.add("E-PRESET-PARAM", `'at' is ${JSON.stringify(at)}, expected a start time in seconds of 0 or more.`, "Set at to a number of seconds.", id, `${ep}.at`);
      bad = true;
    }
    const length = e["duration"] === undefined ? defaultLength : e["duration"];
    if (!isNum(length) || length <= 0) {
      this.add("E-PRESET-PARAM", `'duration' is ${JSON.stringify(length)}, expected seconds greater than 0.`, "Set duration to a number of seconds.", id, `${ep}.duration`);
      bad = true;
    }
    let repeat: RepeatMode | undefined;
    if (e["repeat"] !== undefined) {
      if (typeof e["repeat"] !== "string" || !(REPEATS as readonly string[]).includes(e["repeat"])) {
        this.add("E-PRESET-PARAM", `'repeat' is ${JSON.stringify(e["repeat"])}. Valid values: loop, pingpong.`, 'Use "repeat": "loop" or "pingpong".', id, `${ep}.repeat`);
        bad = true;
      } else if (!loops) {
        this.add("E-PRESET-PARAM", `Preset '${name}' does not repeat.`, `Remove 'repeat', or use a looping preset: ${[...PRESET_NAMES.filter((n) => PRESETS[n]?.loops), ...RIG_PRESET_NAMES.filter((n) => RIG_PRESETS[n]?.loops)].join(", ")}.`, id, `${ep}.repeat`);
        bad = true;
      } else repeat = e["repeat"] as RepeatMode;
    }
    const phase = e["phase"] === undefined ? 0 : e["phase"];
    if (!isNum(phase) || phase < 0 || phase >= 1) {
      this.add("E-PRESET-PARAM", `'phase' is ${JSON.stringify(phase)}, expected a fraction of a cycle from 0 up to, but not including, 1.`, "Set phase to a number such as 0.25 to start the loop a quarter of the way through its cycle.", id, `${ep}.phase`);
      bad = true;
    } else if (e["phase"] !== undefined && e["repeat"] !== "loop") {
      this.add("E-PRESET-PARAM", `'phase' shifts a repeating loop, and this entry ${e["repeat"] === "pingpong" ? "uses repeat 'pingpong'" : "has no repeat"}.`, 'Add "repeat": "loop", or remove \'phase\' and use \'at\' to start later.', id, `${ep}.phase`);
      bad = true;
    } else if (e["phase"] !== undefined && def?.cumulative) {
      this.add("E-PRESET-PARAM", `Preset '${name}' keeps turning, so a 'phase' would only change the angle it starts from.`, "Remove 'phase' and set the node's 'rotation' to the starting angle.", id, `${ep}.phase`);
      bad = true;
    }
    const params: Params = {};
    for (const [k, spec] of Object.entries(specs)) {
      const v = e[k] === undefined ? spec.def : e[k];
      const msg = checkParam(k, v, spec);
      if (msg) {
        this.add("E-PRESET-PARAM", `${msg} (preset '${name}').`, `Set '${k}' to a valid value.`, id, `${ep}.${k}`);
        bad = true;
      } else params[k] = v as number | string;
    }
    const applyTo = e["applyTo"];
    if (applyTo !== undefined && applyTo !== "self" && applyTo !== "children") {
      this.add("E-PRESET-PARAM", `'applyTo' is ${JSON.stringify(applyTo)}. Valid values: self, children.`, 'Use "applyTo": "children" with a group, or remove it.', id, `${ep}.applyTo`);
      bad = true;
    }
    if (bad) return;
    const seed = isNum(e["seed"]) ? e["seed"] : 1;
    const start = at as number;
    const len = length as number;
    const startPhase = phase as number;
    const label = `'${name}' at ${ep}`;

    if (applyTo === "children") {
      if (rig || node["type"] !== "group" || !Array.isArray(node["children"])) {
        this.add("E-PRESET-TARGET", `applyTo 'children' needs a group and an ordinary preset, and '${id ?? "this node"}' is ${rig ? `using the rig preset '${name}'` : "not a group"}.`, "Use applyTo children on a group with a plain preset such as pop-in.", id, `${ep}.applyTo`);
        return;
      }
      const kids = (node["children"] as unknown[]).filter(isObj);
      const offsets = staggerOffsets(kids.length, stagger?.each ?? 0, stagger?.order ?? "forward", stagger?.seed ?? 1);
      // A child that trails by a fraction of a cycle is the same as one that started that much earlier in the cycle before.
      const ranks = staggerOffsets(kids.length, 1, stagger?.order ?? "forward", stagger?.seed ?? 1);
      const lag = repeat === "loop" && !def?.cumulative ? (stagger?.phase ?? 0) : 0;
      const turn = (v: number): number => Math.round((v - Math.floor(v)) * 1e6) / 1e6;
      // A stagger that offsets the children in time or in phase is the author's own answer to loops in step, so it never gets W-SYNC.
      const spread = stagger !== undefined && (stagger.each > 0 || stagger.phase > 0);
      if (!spread) kids.forEach((k) => this.noteLoop(node, k, name, repeat, len, start, startPhase));
      kids.forEach((k, i) => this.applyPreset(k, name, params, start + (offsets[i] as number), len, repeat, turn(startPhase - (ranks[i] as number) * lag), `${label} on '${this.idOf(k) ?? `child ${i}`}'`, ep));
      return;
    }
    this.noteLoop(this.parents.get(node), node, name, repeat, len, start, startPhase);
    if (rig) this.applyRig(node, name, params, start, len, repeat, startPhase, seed, label, ep);
    else this.applyPreset(node, name, params, start, len, repeat, startPhase, label, ep);
  }

  // ------------------------------------------------------------------ plain presets

  private applyPreset(node: Obj, name: string, params: Params, at: number, length: number, repeat: RepeatMode | undefined, phase: number, label: string, ep: string): void {
    const def = PRESETS[name];
    if (!def) return;
    const id = this.idOf(node);
    const stroke = isObj(node["stroke"]);
    if (def.needsStroke && !stroke) {
      this.add("E-PRESET-TARGET", `Preset '${name}' animates the stroke trim, and '${id ?? "this node"}' has no stroke.`, "Add a stroke to the node, or use a different preset.", id, ep);
      return;
    }
    if (def.needsStroke && node["type"] === "group") {
      this.add("E-PRESET-TARGET", `Preset '${name}' needs a stroked shape, and '${id ?? "this node"}' is a group.`, "Apply the preset to a shape with a stroke.", id, ep);
      return;
    }
    if (at + length > this.duration + 0.5 / this.fps) {
      this.add("E-PRESET-RANGE", `Preset '${name}' runs from ${fmt(at)} to ${fmt(at + length)} seconds, past the scene duration of ${fmt(this.duration)}.`, "Start it earlier, shorten its duration, or lengthen the scene.", id, ep);
      return;
    }
    const local = def.build(staticsOf(node), params, length);
    for (const [prop, keys] of Object.entries(local)) {
      this.put(node, prop, keys.map((k) => ({ ...k, t: at + k.t })), repeat, phase, def.cumulative === true, def.resets === true, label, ep, id);
    }
  }

  private put(node: Obj, prop: string, written: PKey[], repeat: RepeatMode | undefined, phase: number, cumulative: boolean, open: boolean, label: string, ep: string, id: string | undefined): void {
    let abs = written;
    if (repeat === "loop" && phase > 0) {
      const turned = rotateCycle(written, phase, this.fps, open);
      if (turned) abs = turned;
      else this.add("E-PRESET-PARAM", `${label} cannot take a 'phase' on '${prop}': that property does not end the cycle where it starts.`, "Remove 'phase' from this entry.", id, `${ep}.phase`);
    }
    let keys = abs;
    if (repeat) {
      const u = unroll(abs, repeat, this.duration, this.fps, cumulative);
      keys = u.keys;
      if (!u.fits) {
        const period = (abs[abs.length - 1] as PKey).t - (abs[0] as PKey).t;
        this.add("W-REPEAT-FIT", `The repeat period of ${fmt(period)} seconds does not divide the time from ${fmt((abs[0] as PKey).t)} to ${fmt(this.duration)} seconds evenly, so the loop will not be seamless.`, "Change the preset duration so a whole number of repeats fits the scene.", id, ep);
      }
    }
    const list = this.blocks.get(node) ?? [];
    const block: Block = { prop, start: (keys[0] as PKey).t, end: (keys[keys.length - 1] as PKey).t, keys, user: false, label };
    if (repeat === "loop" && phase > 0) block.phased = true;
    list.push(block);
    this.blocks.set(node, list);
  }

  // ------------------------------------------------------------------ rigs

  private applyRig(root: Obj, name: string, params: Params, at: number, length: number, repeat: RepeatMode | undefined, phase: number, seed: number, label: string, ep: string): void {
    const rig = RIG_PRESETS[name];
    if (!rig) return;
    const id = this.idOf(root);
    if (root["type"] !== "group") {
      this.add("E-PRESET-TARGET", `Rig preset '${name}' goes on the root group of a rig, and '${id ?? "this node"}' is not a group.`, "Apply rig presets to the group that contains the parts.", id, ep);
      return;
    }
    if (at + length > this.duration + 0.5 / this.fps) {
      this.add("E-PRESET-RANGE", `Preset '${name}' runs from ${fmt(at)} to ${fmt(at + length)} seconds, past the scene duration of ${fmt(this.duration)}.`, "Start it earlier, shorten its duration, or lengthen the scene.", id, ep);
      return;
    }
    const found = new Map<string, Obj>();
    const wanted = [...rig.required(params), ...rig.optional];
    const all = [...descendants(root)];
    for (const suffix of wanted) {
      const hit = all.find((d) => typeof d["id"] === "string" && (d["id"] as string).endsWith(`-${suffix}`));
      if (hit) found.set(suffix, hit);
    }
    let missing = false;
    for (const suffix of rig.required(params)) {
      if (!found.has(suffix)) {
        missing = true;
        const prefix = id ?? "robot";
        this.add("E-RIG-PART", `Rig preset '${name}' on '${id ?? "this node"}' needs a part whose id ends in '-${suffix}'. None was found inside the group.`, `Add a part named '${prefix}-${suffix}' inside '${prefix}'. Parts used by ${name}: ${[...rig.required(params), ...rig.optional.map((o) => `${o} (optional)`)].join(", ")}.`, id, ep);
      }
    }
    if (missing) return;

    const parts: Record<string, PartRef> = {};
    const nodes = new Map<string, Obj>();
    for (const [suffix, n] of found) {
      let target = n;
      if (rig.transient.includes(suffix)) {
        const ctl = all.find((d) => d["id"] === `${n["id"] as string}-ctl`);
        if (ctl) target = ctl;
      }
      const tid = target["id"] as string;
      parts[suffix] = { id: tid, s: staticsOf(target) };
      nodes.set(tid, target);
    }
    const rootRef: PartRef = { id: id ?? "", s: staticsOf(root) };
    nodes.set(rootRef.id, root);
    for (const r of rig.build(rootRef, parts, params, { at, d: length, sceneEnd: this.duration, seed, fps: this.fps })) {
      const target = nodes.get(r.id);
      if (!target) continue;
      for (const [prop, keys] of Object.entries(r.keys)) this.put(target, prop, keys, repeat, phase, false, false, label, ep, r.id);
    }
  }

  // ------------------------------------------------------------------ overshoot

  /**
   * Replaces each long-form key that has an `overshoot` option by the keys of the overshoot (see `expandOvershoot`).
   * A key with a problem keeps its written value and the option is dropped, so the rest of the property still reaches the linter.
   */
  private overshoots(prop: string, keys: PKey[], id: string | undefined, pp: string): PKey[] {
    if (!keys.some((k) => k.overshoot !== undefined)) return keys;
    const clamp = clampFor(prop);
    const total = Math.round(this.duration * this.fps);
    const out: PKey[] = [];
    keys.forEach((k, i) => {
      const { overshoot, ...plain } = k;
      if (overshoot === undefined || overshoot === false) {
        out.push(plain);
        return;
      }
      const kp = `${pp}[${i}]`;
      const fail = (why: string): void => {
        this.add("E-OVERSHOOT", `Overshoot on '${prop}' of '${id ?? "this node"}', key ${i}: ${why}`, `Fix or remove the 'overshoot' option. It goes on a long-form key that arrives from an earlier key: { "t": 0.5, "v": 100, "ease": "easeOut", "overshoot": true }.`, id, kp);
        out.push(plain);
      };
      if (i === 0) return fail("the first key has nothing to arrive from.");
      const opt = readOvershoot(overshoot);
      if (typeof opt === "string") return fail(opt);
      const made = expandOvershoot(keys[i - 1] as PKey, plain, keys[i + 1], opt, this.fps, total, clamp);
      if (typeof made === "string") return fail(made);
      out.push(...made);
    });
    return out;
  }

  // ------------------------------------------------------------------ follow

  /** Gives a node with `follow` the keys of its parent group's animation, later and scaled. See `followKeys`. */
  private follow(node: Obj, path: string): void {
    const raw = node["follow"];
    if (raw === undefined) return;
    delete node["follow"];
    const id = this.idOf(node);
    const fp = `${path}.follow`;
    const fail = (why: string): void => this.add("E-FOLLOW", `Follow on '${id ?? "this node"}': ${why}`, `Put the node directly inside a group that animates the same property, and use "follow": { "props": ["rotation"], "delay": 0.1, "scale": 1.5 }. The node must not animate that property itself.`, id, fp);
    const opt = readFollow(raw);
    if (typeof opt === "string") return fail(opt);
    const parent = this.parents.get(node);
    if (!parent) return fail("the node has no parent group to follow. Put it inside a group.");
    const pa = parent["animate"];
    const own: Obj = isObj(node["animate"]) ? { ...node["animate"] } : {};
    const written: Obj = {};
    for (const prop of opt.props) {
      if (own[prop] !== undefined) return fail(`the node already animates '${prop}'. Remove that animation, or leave '${prop}' out of follow.props.`);
      const list = isObj(pa) ? pa[prop] : undefined;
      if (!Array.isArray(list)) return fail(`the parent group '${this.idOf(parent) ?? "?"}' has no animation of '${prop}' to follow.`);
      const keys: PKey[] = [];
      for (let i = 0; i < list.length; i++) {
        const r = readKey(list[i], i);
        if (!r.ok) return fail(`the parent's '${prop}' keys could not be read (${r.reason}).`);
        keys.push(r.key.ease === undefined ? { t: r.key.time, v: r.key.value } : { t: r.key.time, v: r.key.value, ease: r.key.ease });
      }
      const rest = isNum(node[prop]) ? (node[prop] as number) : 0;
      const made = followKeys(keys, opt, rest, this.fps, this.duration, this.root["loop"] !== false);
      if (typeof made === "string") return fail(made);
      this.starts.push({ frame: Math.round(firstChange(made) * this.fps), phased: opt.delay > 0 });
      written[prop] = made.map((k) => (k.ease === undefined ? [k.t, k.v] : [k.t, k.v, k.ease]));
    }
    node["animate"] = { ...own, ...written };
  }

  // ------------------------------------------------------------------ merge

  private finish(node: Obj, path: string): void {
    const id = this.idOf(node);
    const animate = node["animate"];
    const presetBlocks = this.blocks.get(node) ?? [];
    delete node["motion"];
    delete node["stagger"];
    if (animate !== undefined && !isObj(animate)) return;
    const out: Obj = isObj(animate) ? { ...animate } : {};
    const props = new Set<string>([...Object.keys(out), ...presetBlocks.map((b) => b.prop)]);

    for (const prop of props) {
      const pp = `${path}.animate.${prop}`;
      const raw = out[prop];
      const blocks: Block[] = presetBlocks.filter((b) => b.prop === prop);
      let userKeys: PKey[] | undefined;
      if (raw !== undefined) {
        let list: unknown;
        let repeat: RepeatMode | undefined;
        if (isObj(raw)) {
          const extra = Object.keys(raw).filter((k) => k !== "keys" && k !== "repeat");
          const okRepeat = raw["repeat"] === "loop" || raw["repeat"] === "pingpong";
          if (!Array.isArray(raw["keys"]) || !okRepeat || extra.length > 0) {
            this.add("E-KEY-SHAPE", `Property '${prop}' is an object that is not { "keys": [...], "repeat": "loop" | "pingpong" }.`, 'Write "rotation": { "keys": [[0, -8], [0.5, 8], [1, -8]], "repeat": "loop" }, or a plain keyframe array.', id, pp);
            delete out[prop];
            continue;
          }
          list = raw["keys"];
          repeat = raw["repeat"] as RepeatMode;
          out[prop] = list;
        } else list = raw;
        if (!Array.isArray(list)) continue;
        const read: PKey[] = [];
        let ok = true;
        list.forEach((k, i) => {
          const r = readKey(k, i);
          if (!r.ok) ok = false;
          else {
            const pk: PKey = r.key.ease === undefined ? { t: r.key.time, v: r.key.value } : { t: r.key.time, v: r.key.value, ease: r.key.ease };
            if (r.key.overshoot !== undefined) pk.overshoot = r.key.overshoot;
            read.push(pk);
          }
        });
        // Anything the linter should describe (bad shape, one key, unordered times) is left exactly as written.
        if (!ok || read.length < 2 || !read.every((k, i) => i === 0 || k.t > (read[i - 1] as PKey).t)) continue;
        const settled = this.overshoots(prop, read, id, pp);
        userKeys = settled;
        if (repeat) {
          const u = unroll(settled, repeat, this.duration, this.fps);
          userKeys = u.keys;
          if (!u.fits) this.add("W-REPEAT-FIT", `The repeat period of ${fmt((read[read.length - 1] as PKey).t - (read[0] as PKey).t)} seconds does not divide the time from ${fmt((read[0] as PKey).t)} to ${fmt(this.duration)} seconds evenly, so the loop will not be seamless.`, "Adjust the keyframe times so a whole number of repeats fills the scene.", id, pp);
        }
      }
      if (userKeys) blocks.push({ prop, start: (userKeys[0] as PKey).t, end: (userKeys[userKeys.length - 1] as PKey).t, keys: userKeys, user: true, label: `the 'animate' entry for '${prop}'` });
      if (blocks.length === 0) continue;

      const merged = this.merge(prop, blocks, id, path);
      this.starts.push({ frame: Math.round(firstChange(merged) * this.fps), phased: blocks.some((b) => b.phased === true) });
      out[prop] = this.expandEases(prop, merged, id, pp).map((k) => (k.ease === undefined ? [k.t, k.v] : [k.t, k.v, k.ease]));
    }
    if (isObj(animate) || presetBlocks.length > 0) node["animate"] = out;
  }

  private merge(prop: string, blocks: Block[], id: string | undefined, path: string): PKey[] {
    const sorted = [...blocks].sort((a, b) => a.start - b.start);
    const eps = 0.5 / this.fps;
    let reach = -Infinity;
    let reachLabel = "";
    for (const b of sorted) {
      if (b.start < reach - eps) {
        this.add("E-PRESET-OVERLAP", `${cap(b.label)} and ${reachLabel} both write '${prop}' on '${id ?? "this node"}' between ${fmt(b.start)} and ${fmt(Math.min(reach, b.end))} seconds.`, `Move one of them so they do not overlap in time, or animate a different property. For a transient motion on a rig part, wrap the part in a '-ctl' group and put the motion on the wrapper.`, id, `${path}.animate.${prop}`);
      }
      if (b.end > reach) {
        reach = b.end;
        reachLabel = b.label;
      }
    }

    const items: { k: PKey; user: boolean; lead: boolean }[] = [];
    for (const b of sorted) {
      b.keys.forEach((k, i) => {
        let key = k;
        if (!b.user) {
          const t = Math.min(this.duration, Math.max(0, Math.round(k.t * this.fps) / this.fps));
          key = { ...k, t };
          if (i === 0 && items.length > 0) key.ease = "hold";
        }
        items.push({ k: key, user: b.user, lead: i === 0 });
      });
    }
    items.sort((a, b) => a.k.t - b.k.t);
    const kept: { k: PKey; user: boolean }[] = [];
    for (const it of items) {
      const prev = kept[kept.length - 1];
      if (prev && Math.round(it.k.t * this.fps) <= Math.round(prev.k.t * this.fps)) {
        if (!it.user) continue;
        if (!prev.user) kept.pop();
      }
      kept.push(it);
    }
    return kept.map((i) => i.k);
  }

  private expandEases(prop: string, keys: PKey[], id: string | undefined, path: string): PKey[] {
    if (!keys.some((k, i) => i > 0 && isSpecialEase(k.ease))) return keys;
    const clamp = clampFor(prop);
    const out: PKey[] = [keys[0] as PKey];
    for (let i = 1; i < keys.length; i++) {
      const b = keys[i] as PKey;
      const a = out[out.length - 1] as PKey;
      if (!isSpecialEase(b.ease)) {
        out.push(b);
        continue;
      }
      if (!isNumeric(a.v) || !isNumeric(b.v) || (Array.isArray(a.v) && Array.isArray(b.v) && a.v.length !== b.v.length) || Array.isArray(a.v) !== Array.isArray(b.v)) {
        this.add("E-EASE-TARGET", `Easing '${b.ease}' on '${prop}' needs numeric values, and this property's keyframes are not numbers.`, "Use a bezier easing for colours and paths, or animate a numeric property.", id, `${path}[${i}]`);
        out.push({ t: b.t, v: b.v });
        continue;
      }
      if (b.t - a.t < 2 / this.fps) {
        out.push({ t: b.t, v: b.v, ease: "easeOut" });
        continue;
      }
      out.push(...expandSpecialEase(b.ease, { t: a.t, v: a.v }, { t: b.t, v: b.v }, this.fps, clamp));
    }
    return out;
  }
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function checkParam(name: string, v: unknown, spec: ParamSpec): string | undefined {
  if (spec.kind === "enum") {
    return typeof v === "string" && spec.values.includes(v) ? undefined : `Parameter '${name}' is ${JSON.stringify(v)}. Valid values: ${spec.values.join(", ")}`;
  }
  if (!isNum(v)) return `Parameter '${name}' is ${JSON.stringify(v)}, expected a number`;
  if (spec.kind === "int" && !Number.isInteger(v)) return `Parameter '${name}' is ${v}, expected a whole number`;
  if (spec.min !== undefined && v < spec.min) return `Parameter '${name}' is ${v}, expected ${spec.min} or more`;
  if (spec.max !== undefined && v > spec.max) return `Parameter '${name}' is ${v}, expected ${spec.max} or less`;
  return undefined;
}

/** The start offset in seconds for each of `count` children, in child order. */
export function staggerOffsets(count: number, each: number, order: string, seed: number): number[] {
  const idx = Array.from({ length: count }, (_, i) => i);
  let rank: number[];
  const centre = (count - 1) / 2;
  const byDistance = (desc: boolean): number[] => {
    const sorted = [...idx].sort((a, b) => {
      const d = Math.abs(a - centre) - Math.abs(b - centre);
      return (desc ? -d : d) || a - b;
    });
    const r = new Array<number>(count).fill(0);
    sorted.forEach((child, position) => (r[child] = position));
    return r;
  };
  if (order === "reverse") rank = idx.map((i) => count - 1 - i);
  else if (order === "center-out") rank = byDistance(false);
  else if (order === "edges-in") rank = byDistance(true);
  else if (order === "random") {
    const rand = mulberry32(seed);
    const perm = [...idx];
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [perm[i], perm[j]] = [perm[j] as number, perm[i] as number];
    }
    rank = perm;
  } else rank = idx;
  return rank.map((r) => r * each);
}

/**
 * Pure transform from a parsed scene to a scene with plain keyframes.
 * It never throws: a scene it cannot read is returned unchanged for the linter to describe.
 */
export function expandScene(raw: unknown): Expanded {
  if (!isObj(raw)) return { scene: raw, diagnostics: [] };
  const copy = structuredClone(raw) as Obj;
  const duration = copy["duration"];
  if (!isNum(duration) || duration <= 0) return { scene: copy, diagnostics: [] };
  const fpsRaw = copy["fps"];
  const fps = isNum(fpsRaw) && FPS_VALUES.includes(fpsRaw) ? fpsRaw : 30;
  const ex = new Expander(copy, fps, duration);
  ex.run();
  return { scene: copy, diagnostics: ex.diags };
}

