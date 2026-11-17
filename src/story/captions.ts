import { existsSync } from "node:fs";
import type { CaptionPosition } from "./types.ts";

/** Fonts tried when the storyboard names none. Bold sans-serif faces that ship with the operating system. */
export const SYSTEM_FONTS: readonly string[] = [
  "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
  "/Library/Fonts/Arial Bold.ttf",
  "/System/Library/Fonts/Helvetica.ttc",
  "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
  "/usr/share/fonts/TTF/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf",
  "/usr/share/fonts/liberation/LiberationSans-Bold.ttf",
  "C:\\Windows\\Fonts\\arialbd.ttf",
];

export function systemFont(exists: (p: string) => boolean = existsSync): string | undefined {
  return SYSTEM_FONTS.find((p) => exists(p));
}

/** Average glyph advance of a bold sans-serif face, as a fraction of the font size. Slightly generous so lines err on the short side. */
const GLYPH = 0.6;

/** Breaks a caption into lines that fit `maxWidth` pixels at `size`. Explicit newlines are kept. A word longer than a line stays whole. */
export function wrapCaption(text: string, size: number, maxWidth: number): string[] {
  const perLine = Math.max(4, Math.floor(maxWidth / (size * GLYPH)));
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line === "") line = word;
      else if (line.length + 1 + word.length <= perLine) line += ` ${word}`;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** The `y` expression of a drawtext filter for a caption position. */
export function captionY(position: CaptionPosition, canvasH: number): string {
  const margin = Math.round(canvasH * 0.08);
  if (position === "top") return String(margin);
  if (position === "center") return "(h-text_h)/2";
  return `h-text_h-${margin}`;
}

/** ffmpeg colour from `#rrggbb`. */
export const ffColor = (hex: string): string => `0x${hex.slice(1)}`;
