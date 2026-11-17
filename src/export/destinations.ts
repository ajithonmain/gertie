import type { FormatId } from "./formats.ts";

export interface DestFormat {
  format: FormatId;
  /** Output size for a canvas of this size. Omit to keep the canvas size. */
  target?: (w: number, h: number) => { w: number; h: number };
  maxBytes?: number;
  maxSeconds?: number;
  maxFps?: number;
  maxFrames?: number;
  /** Needs a solid background, so `--bg` applies. */
  solid?: boolean;
  /** Only produced when the encoder exists, and skipped quietly when it does not. */
  optional?: boolean;
}

export interface Destination {
  id: string;
  note: string;
  formats: DestFormat[];
}

const KB = 1024;
const even = (n: number): number => Math.max(2, Math.round(n / 2) * 2);
const square = (n: number) => (): { w: number; h: number } => ({ w: n, h: n });
/** One side exactly `n`, the other in proportion and even. */
const longSide =
  (n: number) =>
  (w: number, h: number): { w: number; h: number } =>
    w >= h ? { w: n, h: even((n * h) / w) } : { w: even((n * w) / h), h: n };

/**
 * The Telegram, Discord and Slack limits come from those platforms' documentation.
 * The WhatsApp limit comes from third-party sources (see docs/07-render-and-export.md).
 */
export const DESTINATIONS: Readonly<Record<string, Destination>> = {
  "web-img": { id: "web-img", note: "Animated WebP, with APNG and GIF alternatives", formats: [{ format: "webp" }, { format: "apng", optional: true }, { format: "gif", optional: true }] },
  "web-video": { id: "web-video", note: "WebM with alpha, plus HEVC with alpha on macOS", formats: [{ format: "webm" }, { format: "hevc", optional: true }] },
  telegram: { id: "telegram", note: "WebM VP9, one side exactly 512 pixels, at most 3 seconds, 30 fps, 256 KB", formats: [{ format: "webm", target: longSide(512), maxBytes: 256 * KB, maxSeconds: 3, maxFps: 30 }] },
  "discord-sticker": { id: "discord-sticker", note: "APNG, exactly 320 by 320, at most 512 KB", formats: [{ format: "apng", target: square(320), maxBytes: 512 * KB }] },
  "slack-emoji": { id: "slack-emoji", note: "GIF, square, under 128 KB, at most 50 frames", formats: [{ format: "gif", target: square(128), maxBytes: 128 * KB - 1, maxFrames: 50 }] },
  whatsapp: { id: "whatsapp", note: "Animated WebP, 512 by 512, at most 500 KB", formats: [{ format: "webp", target: square(512), maxBytes: 500 * KB }] },
  editor: { id: "editor", note: "ProRes 4444 MOV for video editors", formats: [{ format: "prores" }] },
  email: { id: "email", note: "GIF", formats: [{ format: "gif", solid: true }] },
  reel: { id: "reel", note: "MP4, 1080 by 1920, solid background", formats: [{ format: "mp4", target: () => ({ w: 1080, h: 1920 }), solid: true }] },
  readme: { id: "readme", note: "Animated SVG, with a GIF alternative", formats: [{ format: "svg" }, { format: "gif", optional: true }] },
};

export const DESTINATION_IDS: readonly string[] = Object.keys(DESTINATIONS);
