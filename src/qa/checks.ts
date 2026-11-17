import { makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";

/** One rendered, analysed frame. */
export interface SampledFrame {
  frame: number;
  /** Fraction of pixels that differ from the empty scene. */
  content: number;
  /** Fraction of the canvas border (the outermost pixel ring) covered by artwork. */
  edge: number;
}

export const THRESHOLDS = {
  /** E-R-BLANK: some frame must show more than this fraction of content. */
  blank: 0.001,
  /** E-R-STATIC: some pair of frames must differ in more than this fraction of pixels. */
  static: 0.0005,
  /** W-R-LOOP: the first frame and the end-of-loop frame may differ in at most this fraction. */
  loop: 0.005,
  /** W-R-CLIPPED: artwork may cover at most this fraction of the canvas border. */
  clipped: 0.01,
  /** W-R-FLICKER: a frame differing from both neighbours by more than this is a flash. */
  flicker: 0.05,
  /** W-R-FLICKER: the neighbours must differ from each other by less than this. */
  flickerNeighbours: 0.01,
} as const;

export function checkBlank(frames: readonly SampledFrame[]): Diagnostic[] {
  if (frames.some((f) => f.content > THRESHOLDS.blank)) return [];
  return [
    makeDiagnostic(
      "E-R-BLANK",
      `Every sampled frame is empty: the most content in any frame is ${pct(Math.max(0, ...frames.map((f) => f.content)))} of the canvas.`,
      "Check that nodes are inside the canvas, have a fill or stroke, a nonzero size and opacity above 0, and that 'from' and 'to' cover the animation.",
    ),
  ];
}

/** `consecutive[i]` is the difference between sampled frame i and i + 1. */
export function checkStatic(consecutive: readonly number[]): Diagnostic[] {
  if (consecutive.some((d) => d > THRESHOLDS.static)) return [];
  return [makeDiagnostic("E-R-STATIC", `No two sampled frames differ (largest difference ${pct(Math.max(0, ...consecutive))}). Nothing moves.`, "Animate at least one property so that it changes visibly, for example x, y, rotation, scale or opacity.")];
}

export function checkLoop(loop: boolean, firstToLast: number | undefined): Diagnostic[] {
  if (!loop || firstToLast === undefined || firstToLast <= THRESHOLDS.loop) return [];
  return [makeDiagnostic("W-R-LOOP", `First and last frames differ in ${pct(firstToLast)} of pixels. The loop will jump.`, "Make each animated property end on its starting value, or set loop to false.")];
}

export function checkClipped(frames: readonly SampledFrame[], hasBackground: boolean): Diagnostic[] {
  if (hasBackground) return [];
  const worst = frames.reduce((a, f) => (f.edge > a.edge ? f : a), frames[0] as SampledFrame);
  if (worst.edge <= THRESHOLDS.clipped) return [];
  return [makeDiagnostic("W-R-CLIPPED", `Artwork covers ${pct(worst.edge)} of the canvas border in frame ${worst.frame}, so something may be cut off.`, "Move or scale the artwork so it sits inside the canvas, or enlarge the canvas.")];
}

export function checkEmptyFrames(frames: readonly SampledFrame[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const f = frames[i] as SampledFrame;
    const prev = frames[i - 1] as SampledFrame;
    const next = frames[i + 1] as SampledFrame;
    if (f.content <= THRESHOLDS.blank && prev.content > THRESHOLDS.blank && next.content > THRESHOLDS.blank) {
      out.push(makeDiagnostic("W-R-EMPTY-FRAMES", `Frame ${f.frame} is empty although frames ${prev.frame} and ${next.frame} are not.`, "Check opacity, scale and 'from'/'to' around this time. Remove the blank moment unless it is intended."));
    }
  }
  return out;
}

/** Needs consecutive frames, so it only runs on a full render. `diffs[i]` is frame i against i + 1. */
export function checkFlicker(frames: readonly SampledFrame[], diffs: readonly number[], skipDiffs: readonly number[]): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (let i = 1; i < frames.length - 1; i++) {
    const a = diffs[i - 1] as number;
    const b = diffs[i] as number;
    const across = skipDiffs[i - 1] as number;
    if (a > THRESHOLDS.flicker && b > THRESHOLDS.flicker && across < THRESHOLDS.flickerNeighbours) {
      out.push(makeDiagnostic("W-R-FLICKER", `Frame ${(frames[i] as SampledFrame).frame} differs from both neighbours by ${pct(Math.min(a, b))} while they match each other.`, "Remove the one-frame flash: check keyframes that land one frame apart, or use a longer transition."));
    }
  }
  return out;
}

export function checkConsole(messages: readonly { level: string; text: string }[]): Diagnostic[] {
  return messages.slice(0, 5).map((m) => makeDiagnostic("W-R-CONSOLE", `lottie-web wrote a ${m.level} to the console: ${m.text.slice(0, 200)}`, "The player may not handle this file. Report it, and check the scene for unusual features."));
}

function pct(x: number): string {
  return `${(x * 100).toFixed(x < 0.1 ? 2 : 1)}%`;
}
