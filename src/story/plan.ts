import { totalFrames } from "./lint.ts";
import type { Fit, NStory, TransitionType } from "./types.ts";

/** ffmpeg `xfade` names for the storyboard's transitions. `cut` has none: it is a concatenation. */
export const XFADE: Record<Exclude<TransitionType, "cut">, string> = {
  fade: "fade",
  "slide-left": "slideleft",
  "slide-right": "slideright",
  "slide-up": "slideup",
  wipe: "wipeleft",
};

export interface ScenePlan {
  id: string;
  index: number;
  src: string;
  fit: Fit;
  /** Video frame at which the scene's first frame appears. During a transition in, it is blended with the previous scene. */
  start: number;
  /** Frames the scene is rendered for. */
  frames: number;
  /** How this scene leaves: type and length in frames. */
  out: { type: TransitionType; frames: number };
  /** Length in frames of the transition into this scene. */
  inFrames: number;
  /** The frames during which the scene is on screen alone, as [from, to). Captions live here. */
  clean: [number, number];
  caption: string | null;
}

export interface StoryPlan {
  fps: number;
  totalFrames: number;
  scenes: ScenePlan[];
}

/** Places every scene on the video's timeline. A transition of T frames overlaps the last T frames of a scene with the first T of the next. */
export function planStory(story: NStory): StoryPlan {
  const scenes: ScenePlan[] = [];
  let start = 0;
  story.scenes.forEach((s, i) => {
    const prev = i > 0 ? (story.scenes[i - 1] as (typeof story.scenes)[number]).transition.frames : 0;
    const outFrames = i < story.scenes.length - 1 ? s.transition.frames : 0;
    scenes.push({
      id: s.id,
      index: i,
      src: s.src,
      fit: s.fit,
      start,
      frames: s.frames,
      out: { type: outFrames === 0 ? "cut" : s.transition.type, frames: outFrames },
      inFrames: prev,
      clean: [start + prev, start + s.frames - outFrames],
      caption: s.caption,
    });
    start += s.frames - outFrames;
  });
  return { fps: story.fps, totalFrames: totalFrames(story.scenes), scenes };
}

/**
 * Which frame of the scene's own animation to show at the k-th frame of its slot.
 * A looping scene repeats; a scene that does not loop holds its last frame.
 */
export function sceneFrameAt(k: number, videoFps: number, sceneFps: number, sceneFrames: number, loop: boolean): number {
  const raw = (k * sceneFps) / videoFps;
  if (loop) {
    const m = raw % sceneFrames;
    return Math.round(m * 1e6) / 1e6;
  }
  return Math.min(raw, sceneFrames - 1);
}

const sec = (frames: number, fps: number): string => (frames / fps).toFixed(6).replace(/0+$/, "").replace(/\.$/, "");

/**
 * The filter that joins the per-scene streams `[v0]`, `[v1]`... into `[vjoined]`.
 * `xfade`'s offset is measured from the start of the stream built so far, so for the transition into scene i
 * it is the length so far minus the transition. This is the rule the design document flagged for testing.
 * xfade and concat output a stream with no declared frame rate, and the next xfade refuses that, so each join ends in `fps`.
 */
export function joinFilters(plan: StoryPlan): { filters: string[]; label: string } {
  const filters: string[] = [];
  let cur = "[v0]";
  let len = (plan.scenes[0] as ScenePlan).frames;
  for (let i = 1; i < plan.scenes.length; i++) {
    const prev = plan.scenes[i - 1] as ScenePlan;
    const s = plan.scenes[i] as ScenePlan;
    const out = `[j${i}]`;
    const t = prev.out.frames;
    if (t === 0 || prev.out.type === "cut") {
      filters.push(`${cur}[v${i}]concat=n=2:v=1:a=0,fps=${plan.fps}${out}`);
      len += s.frames;
    } else {
      filters.push(`${cur}[v${i}]xfade=transition=${XFADE[prev.out.type as Exclude<TransitionType, "cut">]}:duration=${sec(t, plan.fps)}:offset=${sec(len - t, plan.fps)},fps=${plan.fps}${out}`);
      len += s.frames - t;
    }
    cur = out;
  }
  return { filters, label: cur };
}
