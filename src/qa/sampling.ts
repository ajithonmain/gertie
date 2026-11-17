/**
 * Chooses the frames to render for QA: evenly spaced frames, plus every keyframe,
 * so the extremes of motion are always seen. With `thorough`, every frame.
 */
export function sampleFrames(totalFrames: number, keyFrames: readonly number[], opts: { thorough?: boolean; count?: number } = {}): number[] {
  const last = Math.max(0, totalFrames - 1);
  if (opts.thorough) return Array.from({ length: last + 1 }, (_, i) => i);
  const set = new Set<number>(evenFrames(totalFrames, opts.count ?? 8));
  for (const k of keyFrames) set.add(Math.min(Math.max(0, Math.round(k)), last));
  return [...set].sort((a, b) => a - b);
}

/** `count` evenly spaced frames from 0 to the last frame, without duplicates. */
export function evenFrames(totalFrames: number, count: number): number[] {
  const last = Math.max(0, totalFrames - 1);
  if (count <= 1 || last === 0) return [0];
  const out = new Set<number>();
  for (let i = 0; i < count; i++) out.add(Math.round((i * last) / (count - 1)));
  return [...out].sort((a, b) => a - b);
}
