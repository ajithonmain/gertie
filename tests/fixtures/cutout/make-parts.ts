// Writes tests/fixtures/cutout/painting.parts.json: outlines of the parts of painting.png, as an agent would draw them.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const ell = (cx: number, cy: number, rx: number, ry: number, n = 40): [number, number][] =>
  Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2;
    return [Math.round(cx + rx * Math.cos(a)), Math.min(480, Math.round(cy + ry * Math.sin(a)))] as [number, number];
  });
const spec = {
  bleed: 30,
  grow: 2,
  inset: 1.5,
  parts: [
    { id: "hair-back", polygon: ell(320, 215, 130, 162), pivot: [320, 120] },
    { id: "body", polygon: ell(320, 500, 232, 172), pivot: [320, 480] },
    { id: "head", polygon: ell(320, 215, 107, 135), pivot: [320, 345] },
    { id: "fringe", polygon: ell(320, 128, 118, 50), pivot: [320, 345] },
    { id: "eye-l", polygon: ell(278, 212, 30, 20, 24), pivot: [278, 212] },
    { id: "eye-r", polygon: ell(362, 212, 30, 20, 24), pivot: [362, 212] },
  ],
  lids: [
    // The lids are cut from patches of cheek (for the grain), the size of the lid and clear of the eye and the mouth; the tone comes from the nose bridge.
    { id: "lid-l", ellipse: [278, 212, 31, 20], sample: [262, 262], tone: [320, 214] },
    { id: "lid-r", ellipse: [362, 212, 31, 20], sample: [378, 262], tone: [320, 214] },
  ],
};
writeFileSync(join(import.meta.dirname, "painting.parts.json"), JSON.stringify(spec));
