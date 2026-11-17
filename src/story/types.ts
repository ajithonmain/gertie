import { FPS_VALUES } from "../spec/types.ts";

export { FPS_VALUES };

export const TRANSITION_TYPES = ["cut", "fade", "slide-left", "slide-right", "slide-up", "wipe"] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];

export const FIT_VALUES = ["contain", "cover", "none"] as const;
export type Fit = (typeof FIT_VALUES)[number];

export const CAPTION_POSITIONS = ["bottom", "center", "top"] as const;
export type CaptionPosition = (typeof CAPTION_POSITIONS)[number];

/** Longest video Gertie will build, in seconds. */
export const MAX_STORY_SECONDS = 120;
/** Length above which the linter warns that the video is long for one request. */
export const LONG_STORY_SECONDS = 40;

export interface NTransition {
  type: TransitionType;
  /** Length in frames. Zero for a cut. */
  frames: number;
}

export interface NStoryScene {
  id: string;
  src: string;
  /** Frames the scene is shown for. */
  frames: number;
  fit: Fit;
  caption: string | null;
  /** How this scene gives way to the next one. Ignored on the last scene. */
  transition: NTransition;
}

export interface NCaptions {
  position: CaptionPosition;
  size: number;
  color: string;
  font: string | null;
  box: boolean;
}

export interface NAudio {
  src: string;
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface NStory {
  name: string;
  canvas: { w: number; h: number; background: string };
  fps: number;
  audio: NAudio | null;
  scenes: NStoryScene[];
  captions: NCaptions;
}
