import { closest, makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";
import { isHexColor } from "../spec/color.ts";
import {
  CAPTION_POSITIONS,
  FIT_VALUES,
  FPS_VALUES,
  LONG_STORY_SECONDS,
  MAX_STORY_SECONDS,
  TRANSITION_TYPES,
  type CaptionPosition,
  type Fit,
  type NStory,
  type NStoryScene,
  type TransitionType,
} from "./types.ts";

/** What the linter may ask about a scene file. The command layer answers from the compiler; tests answer from a table. */
export interface SceneFacts {
  w: number;
  h: number;
  /** The scene's own length in seconds. */
  seconds: number;
  loop: boolean;
}

export interface StoryLintOptions {
  fileExists?: (src: string) => boolean;
  /** Facts about a scene file, or undefined when it could not be compiled (the command reports why). */
  sceneFacts?: (src: string) => SceneFacts | undefined;
}

export interface StoryLintResult {
  diagnostics: Diagnostic[];
  story?: NStory;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const typeName = (v: unknown): string => (v === null ? "null" : Array.isArray(v) ? "an array" : typeof v === "object" ? "an object" : `a ${typeof v}`);

const TOP_KEYS = ["story", "name", "canvas", "fps", "audio", "scenes", "captions"];
const CANVAS_KEYS = ["w", "h", "background"];
const AUDIO_KEYS = ["src", "volume", "fadeIn", "fadeOut"];
const SCENE_KEYS = ["id", "src", "duration", "fit", "caption", "transition"];
const TRANSITION_KEYS = ["type", "duration"];
const CAPTION_KEYS = ["position", "size", "color", "font"];
const CAPTION_KEYS_ALL = [...CAPTION_KEYS, "box"];

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
export const DEFAULT_TRANSITION_SECONDS = 0.5;

/** Seconds to whole frames. At least one frame for a positive time. */
export const toFrames = (seconds: number, fps: number): number => Math.max(1, Math.round(seconds * fps));

class Collector {
  readonly list: Diagnostic[] = [];
  add(code: string, message: string, fix: string | undefined, where: { node?: string; path?: string } = {}): void {
    this.list.push(makeDiagnostic(code, message, fix, where));
  }
  unknownKeys(o: Obj, allowed: readonly string[], path: string, node?: string): void {
    for (const k of Object.keys(o)) {
      if (allowed.includes(k)) continue;
      const near = closest(k, allowed);
      this.add("E-STORY-UNKNOWN", `Field '${k}' is not part of the storyboard format${near ? `; did you mean '${near}'?` : ""}.`, near ? `Rename '${k}' to '${near}', or remove it.` : `Remove '${k}'. Allowed here: ${allowed.join(", ")}.`, { ...(node ? { node } : {}), path: `${path}.${k}`.replace(/^\./, "") });
    }
  }
}

function num(c: Collector, o: Obj, key: string, path: string, opts: { min?: number; max?: number; integer?: boolean; positive?: boolean; node?: string }): number | undefined {
  const v = o[key];
  const where = { ...(opts.node ? { node: opts.node } : {}), path: `${path}.${key}`.replace(/^\./, "") };
  if (v === undefined) return undefined;
  if (typeof v !== "number" || !Number.isFinite(v)) {
    c.add("E-STORY-TYPE", `Field '${key}' is ${typeName(v)}, expected a number.`, `Set '${key}' to a number.`, where);
    return undefined;
  }
  if ((opts.positive && v <= 0) || (opts.min !== undefined && v < opts.min) || (opts.max !== undefined && v > opts.max) || (opts.integer && !Number.isInteger(v))) {
    const range = `${opts.integer ? "a whole number " : "a number "}${opts.min !== undefined ? `from ${opts.min}` : opts.positive ? "greater than 0" : ""}${opts.max !== undefined ? ` to ${opts.max}` : ""}`.trim();
    c.add("E-STORY-RANGE", `Field '${key}' is ${v}, expected ${range}.`, `Set '${key}' to ${range}.`, where);
    return undefined;
  }
  return v;
}

function str(c: Collector, o: Obj, key: string, path: string, node?: string): string | undefined {
  const v = o[key];
  if (v === undefined) return undefined;
  if (typeof v !== "string") {
    c.add("E-STORY-TYPE", `Field '${key}' is ${typeName(v)}, expected a string.`, `Set '${key}' to a string.`, { ...(node ? { node } : {}), path: `${path}.${key}`.replace(/^\./, "") });
    return undefined;
  }
  return v;
}

/**
 * Checks a storyboard and normalizes it. Times become frames at the video's frame rate, so the rest of the
 * pipeline never rounds. Returns `story` only when there are no errors.
 */
export function lintStory(raw: unknown, opts: StoryLintOptions = {}): StoryLintResult {
  const c = new Collector();
  if (!isObj(raw)) {
    c.add("E-STORY-TYPE", `The storyboard is ${typeName(raw)}, expected an object.`, "Write the storyboard as a JSON object with 'story', 'canvas', 'fps' and 'scenes'.");
    return { diagnostics: c.list };
  }
  c.unknownKeys(raw, TOP_KEYS, "");

  if (raw["story"] !== 1) c.add("E-STORY-VERSION", raw["story"] === undefined ? "Field 'story' is missing." : `Field 'story' is ${JSON.stringify(raw["story"])}, this version reads storyboard format 1.`, "Set \"story\": 1 at the top of the file.", { path: "story" });

  const name = str(c, raw, "name", "") ?? "video";
  if (!ID.test(name)) c.add("E-STORY-NAME", `Field 'name' is '${name}'. It becomes the output file name, so it may contain only letters, digits, '-' and '_'.`, "Use a name like 'app-intro'.", { path: "name" });

  // Canvas
  let w = 1080;
  let h = 1920;
  let background = "#000000";
  if (raw["canvas"] === undefined) c.add("E-STORY-MISSING", "Field 'canvas' is missing.", "Add \"canvas\": { \"w\": 1080, \"h\": 1920, \"background\": \"#0b0f19\" }.", { path: "canvas" });
  else if (!isObj(raw["canvas"])) c.add("E-STORY-TYPE", `Field 'canvas' is ${typeName(raw["canvas"])}, expected an object.`, "Write canvas as { \"w\": 1080, \"h\": 1920 }.", { path: "canvas" });
  else {
    const cv = raw["canvas"];
    c.unknownKeys(cv, CANVAS_KEYS, "canvas");
    const cw = num(c, cv, "w", "canvas", { min: 64, max: 3840, integer: true });
    const ch = num(c, cv, "h", "canvas", { min: 64, max: 3840, integer: true });
    if (cv["w"] === undefined) c.add("E-STORY-MISSING", "Field 'canvas.w' is missing.", "Add the video width in pixels, for example 1080.", { path: "canvas.w" });
    if (cv["h"] === undefined) c.add("E-STORY-MISSING", "Field 'canvas.h' is missing.", "Add the video height in pixels, for example 1920.", { path: "canvas.h" });
    if (cw !== undefined) w = cw;
    if (ch !== undefined) h = ch;
    if (cw !== undefined && cw % 2 !== 0) c.add("E-STORY-RANGE", `Field 'canvas.w' is ${cw}. H.264 needs an even width.`, `Use ${cw + 1} or ${cw - 1}.`, { path: "canvas.w" });
    if (ch !== undefined && ch % 2 !== 0) c.add("E-STORY-RANGE", `Field 'canvas.h' is ${ch}. H.264 needs an even height.`, `Use ${ch + 1} or ${ch - 1}.`, { path: "canvas.h" });
    const bg = str(c, cv, "background", "canvas");
    if (bg !== undefined) {
      if (!isHexColor(bg) || bg.length === 9) c.add("E-STORY-COLOR", `Field 'canvas.background' is '${bg}', expected #rgb or #rrggbb.`, "Use a solid colour such as '#0b0f19'. MP4 has no transparency.", { path: "canvas.background" });
      else background = bg.length === 4 ? `#${[...bg.slice(1)].map((x) => x + x).join("")}` : bg.toLowerCase();
    }
  }

  // Frame rate
  let fps = 30;
  if (raw["fps"] !== undefined) {
    const f = num(c, raw, "fps", "", {});
    if (f !== undefined) {
      if (!FPS_VALUES.includes(f)) c.add("E-STORY-RANGE", `Field 'fps' is ${f}. Allowed frame rates: ${FPS_VALUES.join(", ")}.`, "Use 30 for most videos.", { path: "fps" });
      else fps = f;
    }
  }

  // Captions style
  const captions: NStory["captions"] = { position: "bottom", size: Math.round(Math.min(w, h) / 20), color: "#ffffff", font: null, box: false };
  if (raw["captions"] !== undefined) {
    if (!isObj(raw["captions"])) c.add("E-STORY-TYPE", `Field 'captions' is ${typeName(raw["captions"])}, expected an object.`, "Write captions as { \"position\": \"bottom\", \"size\": 56, \"color\": \"#ffffff\" }.", { path: "captions" });
    else {
      const cp = raw["captions"];
      c.unknownKeys(cp, CAPTION_KEYS_ALL, "captions");
      const pos = str(c, cp, "position", "captions");
      if (pos !== undefined) {
        if (!(CAPTION_POSITIONS as readonly string[]).includes(pos)) c.add("E-STORY-ENUM", `Field 'captions.position' is '${pos}'. Allowed: ${CAPTION_POSITIONS.join(", ")}.`, "Use 'bottom' for most videos.", { path: "captions.position" });
        else captions.position = pos as CaptionPosition;
      }
      const size = num(c, cp, "size", "captions", { min: 8, max: 400, integer: true });
      if (size !== undefined) captions.size = size;
      const col = str(c, cp, "color", "captions");
      if (col !== undefined) {
        if (!isHexColor(col) || col.length === 9) c.add("E-STORY-COLOR", `Field 'captions.color' is '${col}', expected #rgb or #rrggbb.`, "Use a colour such as '#ffffff'.", { path: "captions.color" });
        else captions.color = col;
      }
      const font = str(c, cp, "font", "captions");
      if (font !== undefined) {
        captions.font = font;
        if (opts.fileExists && !opts.fileExists(font)) c.add("E-STORY-FILE", `Caption font file '${font}' was not found.`, "Fix the path (relative to the storyboard file) or remove 'font' to use a system font.", { path: "captions.font" });
        else if (!/\.(ttf|otf|ttc)$/i.test(font)) c.add("E-STORY-FILE", `Caption font '${font}' is not a .ttf, .otf or .ttc file.`, "Point 'font' at a TrueType or OpenType font file.", { path: "captions.font" });
      }
      if (cp["box"] !== undefined) {
        if (typeof cp["box"] !== "boolean") c.add("E-STORY-TYPE", `Field 'captions.box' is ${typeName(cp["box"])}, expected true or false.`, "Set 'box' to true to draw a dark box behind the caption text.", { path: "captions.box" });
        else captions.box = cp["box"];
      }
    }
  }

  // Scenes
  const scenes: NStoryScene[] = [];
  const rawScenes = raw["scenes"];
  if (rawScenes === undefined) c.add("E-STORY-MISSING", "Field 'scenes' is missing.", "Add a 'scenes' array with at least one scene.", { path: "scenes" });
  else if (!Array.isArray(rawScenes)) c.add("E-STORY-TYPE", `Field 'scenes' is ${typeName(rawScenes)}, expected an array.`, "Write scenes as an array of { \"id\", \"src\", \"duration\" } objects.", { path: "scenes" });
  else if (rawScenes.length === 0) c.add("E-STORY-MISSING", "The 'scenes' array is empty.", "Add at least one scene.", { path: "scenes" });
  else {
    const seen = new Set<string>();
    rawScenes.forEach((rs, i) => {
      const path = `scenes[${i}]`;
      if (!isObj(rs)) return void c.add("E-STORY-TYPE", `Scene ${i} is ${typeName(rs)}, expected an object.`, "Write each scene as { \"id\", \"src\", \"duration\" }.", { path });
      const sid = typeof rs["id"] === "string" ? rs["id"] : `scene${i + 1}`;
      c.unknownKeys(rs, SCENE_KEYS, path, sid);
      if (rs["id"] === undefined) c.add("E-STORY-MISSING", `Scene ${i} has no 'id'.`, "Give every scene a short unique id such as 'hook'.", { path: `${path}.id` });
      else if (typeof rs["id"] !== "string" || !ID.test(rs["id"])) c.add("E-STORY-NAME", `Scene ${i} has id ${JSON.stringify(rs["id"])}. Ids may contain only letters, digits, '-' and '_'.`, "Use an id like 'hook' or 'demo-2'.", { node: sid, path: `${path}.id` });
      else if (seen.has(rs["id"])) c.add("E-STORY-DUPLICATE", `Scene id '${rs["id"]}' is used more than once.`, "Give each scene its own id.", { node: sid, path: `${path}.id` });
      else seen.add(rs["id"]);

      const src = str(c, rs, "src", path, sid);
      if (rs["src"] === undefined) c.add("E-STORY-MISSING", `Scene '${sid}' has no 'src'.`, "Set 'src' to the scene file, for example \"scenes/hook.gertie.json\".", { node: sid, path: `${path}.src` });
      else if (src !== undefined && opts.fileExists && !opts.fileExists(src)) c.add("E-STORY-FILE", `Scene '${sid}' points at '${src}', which was not found.`, "Fix the path (relative to the storyboard file) or create the scene.", { node: sid, path: `${path}.src` });

      const facts = src !== undefined ? opts.sceneFacts?.(src) : undefined;
      let duration = num(c, rs, "duration", path, { positive: true, max: MAX_STORY_SECONDS, node: sid });
      if (rs["duration"] === undefined) {
        if (facts) duration = facts.seconds;
        else c.add("E-STORY-MISSING", `Scene '${sid}' has no 'duration'.`, "Set 'duration' to the seconds the scene is shown, for example 3.", { node: sid, path: `${path}.duration` });
      }

      let fit: Fit = "contain";
      const fitRaw = str(c, rs, "fit", path, sid);
      if (fitRaw !== undefined) {
        if (!(FIT_VALUES as readonly string[]).includes(fitRaw)) c.add("E-STORY-ENUM", `Scene '${sid}' has fit '${fitRaw}'. Allowed: ${FIT_VALUES.join(", ")}.`, "Use 'contain' to show the whole scene, 'cover' to fill the frame.", { node: sid, path: `${path}.fit` });
        else fit = fitRaw as Fit;
      }

      const caption = str(c, rs, "caption", path, sid);
      if (caption !== undefined && caption.trim() === "") c.add("E-STORY-TYPE", `Scene '${sid}' has an empty caption.`, "Remove 'caption' or give it text.", { node: sid, path: `${path}.caption` });

      let tType: TransitionType = "cut";
      let tSeconds = 0;
      if (rs["transition"] !== undefined) {
        const t = rs["transition"];
        if (!isObj(t)) c.add("E-STORY-TYPE", `Scene '${sid}' has a transition that is ${typeName(t)}, expected an object.`, "Write it as { \"type\": \"fade\", \"duration\": 0.4 }.", { node: sid, path: `${path}.transition` });
        else {
          c.unknownKeys(t, TRANSITION_KEYS, `${path}.transition`, sid);
          const ty = str(c, t, "type", `${path}.transition`, sid);
          if (ty === undefined) c.add("E-STORY-MISSING", `Scene '${sid}' has a transition without a 'type'.`, `Set 'type' to one of: ${TRANSITION_TYPES.join(", ")}.`, { node: sid, path: `${path}.transition.type` });
          else if (!(TRANSITION_TYPES as readonly string[]).includes(ty)) {
            const near = closest(ty, TRANSITION_TYPES);
            c.add("E-STORY-ENUM", `Scene '${sid}' has transition type '${ty}'${near ? `; did you mean '${near}'?` : ""}. Allowed: ${TRANSITION_TYPES.join(", ")}.`, near ? `Use '${near}'.` : `Use one of: ${TRANSITION_TYPES.join(", ")}.`, { node: sid, path: `${path}.transition.type` });
          } else tType = ty as TransitionType;
          const td = num(c, t, "duration", `${path}.transition`, { positive: true, max: 5, node: sid });
          if (td !== undefined) tSeconds = td;
          else if (tType !== "cut") tSeconds = DEFAULT_TRANSITION_SECONDS;
          if (tType === "cut" && td !== undefined) c.add("W-STORY-CUT-DURATION", `Scene '${sid}' has a cut with a duration of ${td}. A cut is instant, so the duration is ignored.`, "Remove 'duration' or use 'fade'.", { node: sid, path: `${path}.transition.duration` });
        }
      }

      if (duration !== undefined) {
        const frames = toFrames(duration, fps);
        const tFrames = tType === "cut" ? 0 : toFrames(tSeconds, fps);
        scenes.push({ id: typeof rs["id"] === "string" ? rs["id"] : sid, src: src ?? "", frames, fit, caption: caption?.trim() ? caption : null, transition: { type: tType, frames: tFrames } });
        if (facts) {
          if (duration < facts.seconds - 0.01) c.add("W-STORY-SCENE-CUT", `Scene '${sid}' is shown for ${duration}s but the scene is ${facts.seconds}s long, so its last ${Math.round((facts.seconds - duration) * 100) / 100}s is never seen.`, `Set 'duration' to ${facts.seconds} or shorten the scene.`, { node: sid, path: `${path}.duration` });
          if (fit === "contain") {
            const ratio = (facts.w / facts.h) / (w / h);
            if (ratio < 0.98 || ratio > 1.02) c.add("W-STORY-ASPECT", `Scene '${sid}' is ${facts.w}x${facts.h} and the video is ${w}x${h}, so 'contain' leaves bars of the background colour.`, "Make the scene canvas the same shape as the video, or set 'fit' to 'cover' to fill the frame (edges are cropped).", { node: sid, path: `${path}.fit` });
          }
        }
      }
    });
  }

  // Transitions against durations
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i] as NStoryScene;
    const last = i === scenes.length - 1;
    if (last) {
      if (s.transition.type !== "cut") c.add("W-STORY-TRANSITION-LAST", `Scene '${s.id}' is the last scene, so its '${s.transition.type}' transition has nothing to lead into and is ignored.`, "Remove the transition from the last scene.", { node: s.id, path: `scenes[${i}].transition` });
      s.transition = { type: "cut", frames: 0 };
      continue;
    }
    const next = scenes[i + 1] as NStoryScene;
    const t = s.transition.frames;
    if (t === 0) continue;
    const fmt = (frames: number): string => `${Math.round((frames / fps) * 1000) / 1000}s`;
    if (t > s.frames) c.add("E-STORY-TRANSITION", `Scene '${s.id}' is ${fmt(s.frames)} long but its transition into '${next.id}' is ${fmt(t)}.`, `Shorten the transition to at most ${fmt(s.frames)} or lengthen the scene.`, { node: s.id, path: `scenes[${i}].transition.duration` });
    else if (t > next.frames) c.add("E-STORY-TRANSITION", `Scene '${next.id}' is ${fmt(next.frames)} long but the transition into it from '${s.id}' is ${fmt(t)}.`, `Shorten the transition to at most ${fmt(next.frames)} or lengthen scene '${next.id}'.`, { node: s.id, path: `scenes[${i}].transition.duration` });
    else {
      const incoming = i > 0 ? (scenes[i - 1] as NStoryScene).transition.frames : 0;
      if (incoming + t > s.frames) c.add("E-STORY-TRANSITION", `Scene '${s.id}' is ${fmt(s.frames)} long, but it must hold both the transition in (${fmt(incoming)}) and the transition out (${fmt(t)}).`, `Lengthen scene '${s.id}' to at least ${fmt(incoming + t)} or shorten its transitions.`, { node: s.id, path: `scenes[${i}].transition.duration` });
    }
  }

  // Audio
  let audio: NStory["audio"] = null;
  if (raw["audio"] !== undefined) {
    if (!isObj(raw["audio"])) c.add("E-STORY-TYPE", `Field 'audio' is ${typeName(raw["audio"])}, expected an object.`, "Write audio as { \"src\": \"music.mp3\", \"volume\": 0.6, \"fadeOut\": 1 }.", { path: "audio" });
    else {
      const a = raw["audio"];
      c.unknownKeys(a, AUDIO_KEYS, "audio");
      const src = str(c, a, "src", "audio");
      if (a["src"] === undefined) c.add("E-STORY-MISSING", "Field 'audio.src' is missing.", "Set 'src' to the audio file, for example \"music.mp3\".", { path: "audio.src" });
      else if (src !== undefined && opts.fileExists && !opts.fileExists(src)) c.add("E-STORY-FILE", `Audio file '${src}' was not found.`, "Fix the path (relative to the storyboard file) or remove 'audio'.", { path: "audio.src" });
      const volume = num(c, a, "volume", "audio", { min: 0, max: 4 }) ?? 1;
      const fadeIn = num(c, a, "fadeIn", "audio", { min: 0, max: 60 }) ?? 0;
      const fadeOut = num(c, a, "fadeOut", "audio", { min: 0, max: 60 }) ?? 0;
      if (src !== undefined) audio = { src, volume, fadeIn, fadeOut };
    }
  }

  // Total length
  const total = totalFrames(scenes) / fps;
  if (scenes.length > 0 && total > MAX_STORY_SECONDS) c.add("E-STORY-LENGTH", `The video is ${Math.round(total * 10) / 10}s long. The built-in sequencer stops at ${MAX_STORY_SECONDS}s.`, "Shorten the scenes or split the video into two storyboards.", { path: "scenes" });
  else if (total > LONG_STORY_SECONDS) c.add("W-STORY-LONG", `The video is ${Math.round(total * 10) / 10}s long. Rendering takes about one second of work per second of video, and short videos hold attention better.`, "Aim for six scenes of three to five seconds.", { path: "scenes" });
  if (audio && scenes.length > 0 && audio.fadeOut + audio.fadeIn > total) c.add("W-STORY-FADE", `The audio fades (${audio.fadeIn}s in, ${audio.fadeOut}s out) are longer than the video (${Math.round(total * 10) / 10}s).`, "Shorten the fades.", { path: "audio" });

  if (c.list.some((d) => d.severity === "error")) return { diagnostics: c.list };
  return { diagnostics: c.list, story: { name, canvas: { w, h, background }, fps, audio, scenes, captions } };
}

/** Length of the whole video in frames: each transition overlaps the end of a scene with the start of the next. */
export function totalFrames(scenes: readonly NStoryScene[]): number {
  let t = 0;
  scenes.forEach((s, i) => {
    t += s.frames;
    if (i < scenes.length - 1) t -= s.transition.frames;
  });
  return t;
}
