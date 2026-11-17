import { profileLottie, type Profile } from "./profile.ts";
import { TIERS, type Tier } from "../spec/types.ts";
import type { JObj } from "./time.ts";

export { TIERS, type Tier };

export const isTier = (v: unknown): v is Tier => typeof v === "string" && (TIERS as readonly string[]).includes(v);

/** A target range. `values` is a set of allowed values (frame rate); otherwise `min` and `max`, either of which may be open. */
export interface Band {
  min?: number;
  max?: number;
  values?: readonly number[];
}

export type Measure =
  | "canvasLongSide"
  | "frameRate"
  | "durationSeconds"
  | "layers"
  | "paths"
  | "verticesPerPath"
  | "colours"
  | "animatedProperties"
  | "keyframesPerSecond"
  | "easedShare"
  | "easingCurves"
  | "ownStartShare";

export const MEASURE_LABELS: Record<Measure, string> = {
  canvasLongSide: "canvas, longer side",
  frameRate: "frame rate",
  durationSeconds: "duration, seconds",
  layers: "layers",
  paths: "path shapes",
  verticesPerPath: "vertices per path",
  colours: "distinct solid colours",
  animatedProperties: "animated properties",
  keyframesPerSecond: "keyframes per second",
  easedShare: "eased share of segments",
  easingCurves: "distinct easing curves",
  ownStartShare: "properties with their own start frame",
};

/**
 * The target bands, copied from the table in `docs/17-quality-tuning.md` section 1.
 * Change them there first, then here.
 */
export const BANDS: Record<Tier, Record<Measure, Band>> = {
  icon: {
    canvasLongSide: { min: 512, max: 512 },
    frameRate: { values: [30, 60] },
    durationSeconds: { min: 1.5, max: 3 },
    layers: { min: 4, max: 15 },
    paths: { min: 5, max: 20 },
    verticesPerPath: { min: 4, max: 8 },
    colours: { min: 2, max: 5 },
    animatedProperties: { min: 5, max: 25 },
    keyframesPerSecond: { min: 10, max: 25 },
    easedShare: { min: 0.75 },
    easingCurves: { min: 2, max: 4 },
    ownStartShare: { min: 0.25 },
  },
  character: {
    canvasLongSide: { min: 800, max: 1024 },
    frameRate: { values: [30, 60] },
    durationSeconds: { min: 2, max: 6 },
    layers: { min: 15, max: 40 },
    paths: { min: 40, max: 80 },
    verticesPerPath: { min: 6, max: 10 },
    colours: { min: 6, max: 12 },
    animatedProperties: { min: 20, max: 60 },
    keyframesPerSecond: { min: 25, max: 60 },
    easedShare: { min: 0.75 },
    easingCurves: { min: 4, max: 10 },
    ownStartShare: { min: 0.25 },
  },
  scene: {
    canvasLongSide: { min: 1080, max: 1080 },
    frameRate: { values: [30] },
    durationSeconds: { min: 5, max: 10 },
    layers: { min: 30, max: 80 },
    paths: { min: 120, max: 250 },
    verticesPerPath: { min: 5, max: 9 },
    colours: { min: 12, max: 20 },
    animatedProperties: { min: 30, max: 60 },
    keyframesPerSecond: { min: 15, max: 35 },
    easedShare: { min: 0.75 },
    easingCurves: { min: 4, max: 8 },
    ownStartShare: { min: 0.25 },
  },
};

/** `outside` is only for a band given as a set of values, when the value is between two of them. */
export type Mark = "inside" | "below" | "above" | "outside";

export interface MeasureMark {
  measure: Measure;
  label: string;
  value: number;
  band: string;
  mark: Mark;
}

export interface TierMarks {
  tier: Tier;
  /** Measures inside the band, out of all measures. */
  inside: number;
  total: number;
  measures: MeasureMark[];
}

export function bandText(b: Band): string {
  if (b.values) return b.values.join(" or ");
  if (b.min !== undefined && b.max !== undefined) return b.min === b.max ? String(b.min) : `${b.min} to ${b.max}`;
  if (b.min !== undefined) return `${b.min} or more`;
  if (b.max !== undefined) return `${b.max} or less`;
  return "any";
}

/** Marks one value against one band. Pure. */
export function markValue(value: number, b: Band): Mark {
  if (b.values) {
    if (b.values.includes(value)) return "inside";
    if (value < Math.min(...b.values)) return "below";
    if (value > Math.max(...b.values)) return "above";
    return "outside";
  }
  if (b.min !== undefined && value < b.min) return "below";
  if (b.max !== undefined && value > b.max) return "above";
  return "inside";
}

export function measureValue(p: Profile, m: Measure): number {
  return m === "canvasLongSide" ? p.canvas.longSide : p[m];
}

/** Marks every measure of a profile inside, below or above the band for one tier. Pure. */
export function markProfile(p: Profile, tier: Tier): TierMarks {
  const measures = (Object.keys(BANDS[tier]) as Measure[]).map((m): MeasureMark => {
    const band = BANDS[tier][m];
    const value = measureValue(p, m);
    return { measure: m, label: MEASURE_LABELS[m], value, band: bandText(band), mark: markValue(value, band) };
  });
  return { tier, inside: measures.filter((x) => x.mark === "inside").length, total: measures.length, measures };
}

export interface ProfileReport {
  /** The tier the measures were marked against, or null when none was given and all three are reported. */
  tier: Tier | null;
  profile: Profile;
  /** One entry for the tier, or one per tier when no tier was given. */
  bands: TierMarks[];
}

/** The profile of a Lottie document, marked against one tier or against all three. Pure. */
export function profileReport(doc: JObj, tier?: Tier): ProfileReport {
  const profile = profileLottie(doc);
  return { tier: tier ?? null, profile, bands: (tier ? [tier] : TIERS).map((t) => markProfile(profile, t)) };
}

/** Text lines for a terminal: the measures, then one column of marks per tier. */
export function profileLines(r: ProfileReport): string[] {
  const p = r.profile;
  const lines = [
    `canvas ${p.canvas.w} x ${p.canvas.h}, ${p.frameRate} fps, ${p.durationSeconds} s`,
    `${p.layers} layers, ${p.paths} paths, ${p.vertices} vertices (${p.verticesPerPath} per path), ${p.colours} colours, ${p.gradients} gradients`,
    `${p.animatedProperties} animated properties, ${p.keyframes} keyframes (${p.keyframesPerSecond} per second), median ${p.medianKeysPerProperty} keys per property`,
    `eased share ${p.easedShare}, ${p.easingCurves} easing curves, own start share ${p.ownStartShare}, closed loop share ${p.closedLoopShare}`,
    `features: ${p.features.length > 0 ? p.features.join(", ") : "none"}`,
  ];
  for (const b of r.bands) {
    lines.push("", `${b.tier}: ${b.inside} of ${b.total} measures inside the band`);
    const width = Math.max(...b.measures.map((m) => m.label.length));
    for (const m of b.measures) lines.push(`  ${m.label.padEnd(width)}  ${String(m.value).padStart(7)}  ${m.mark.padEnd(7)}  band ${m.band}`);
  }
  if (r.tier === null) lines.push("", "note: no tier given. Set \"tier\" in the scene, or pass --tier icon|character|scene, to mark against one band.");
  return lines;
}
