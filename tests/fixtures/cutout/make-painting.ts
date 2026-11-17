// Generates tests/fixtures/cutout/painting.png: a synthetic painterly portrait with soft gradients, brush strokes and grain.
// Run with: node --import tsx tests/fixtures/cutout/make-painting.ts
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { encodePng } from "../../../src/cutout/png.ts";
import { mulberry32 } from "../../../src/presets/rigs.ts";

const W = 640;
const H = 480;
const data = new Uint8ClampedArray(W * H * 4);
const rand = mulberry32(7);
type C = [number, number, number];

for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
  const t = y / H;
  const i = (y * W + x) * 4;
  data[i] = 120 + 80 * t;
  data[i + 1] = 150 + 40 * t;
  data[i + 2] = 190 - 30 * t;
  data[i + 3] = 255;
}

/** Paints a soft ellipse: colour(x, y) over the shape with edge softness in pixels and an opacity. */
function ellipse(cx: number, cy: number, rx: number, ry: number, color: (u: number, v: number) => C, alpha = 1, soft = 1.2, rot = 0): void {
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const R = Math.max(rx, ry) + soft + 2;
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H - 1, Math.ceil(cy + R)); y++) for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, Math.ceil(cx + R)); x++) {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const u = (dx * cos + dy * sin) / rx;
    const v = (-dx * sin + dy * cos) / ry;
    const d = Math.sqrt(u * u + v * v);
    const edge = (1 - d) * Math.min(rx, ry);
    const cover = Math.max(0, Math.min(1, edge / soft + 0.5));
    if (cover <= 0) continue;
    const c = color(u, v);
    const a = cover * alpha;
    const i = (y * W + x) * 4;
    for (let k = 0; k < 3; k++) data[i + k] = (data[i + k] as number) * (1 - a) + (c[k] as number) * a;
  }
}
const flat = (c: C) => (): C => c;
const shade = (c: C, light: C, amount: number) => (u: number, v: number): C => {
  const l = Math.max(0, 1 - Math.hypot(u + 0.35, v + 0.4) / 1.4) * amount;
  return [c[0] + (light[0] - c[0]) * l, c[1] + (light[1] - c[1]) * l, c[2] + (light[2] - c[2]) * l];
};
/** Brush strokes: many short, slightly translucent, oriented ellipses of a nearby colour, for a hand-painted look. */
function strokes(cx: number, cy: number, rx: number, ry: number, base: C, n: number, spread = 24): void {
  for (let k = 0; k < n; k++) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const x = cx + Math.cos(a) * rx * r;
    const y = cy + Math.sin(a) * ry * r;
    const j = (rand() - 0.5) * spread;
    ellipse(x, y, 5 + rand() * 9, 1.6 + rand() * 2.2, flat([base[0] + j, base[1] + j * 0.8, base[2] + j * 0.6]), 0.22, 1.5, rand() * Math.PI);
  }
}

// Sky and soft clouds.
for (let k = 0; k < 22; k++) ellipse(rand() * W, rand() * H * 0.6, 40 + rand() * 90, 14 + rand() * 30, flat([225, 232, 240]), 0.13, 18);
strokes(W / 2, 120, 320, 120, [150, 180, 215], 260, 30);

// Hair behind the head.
ellipse(320, 215, 128, 160, shade([58, 36, 28], [110, 70, 52], 0.6), 1, 1.4);
strokes(320, 215, 120, 150, [70, 44, 34], 180, 26);

// Body: a teal garment, neck.
ellipse(320, 500, 230, 170, shade([40, 120, 130], [90, 175, 180], 0.7), 1, 1.4);
strokes(320, 470, 200, 110, [50, 130, 140], 220, 28);
ellipse(320, 345, 34, 55, shade([205, 150, 120], [235, 190, 160], 0.5), 1, 1.2);
ellipse(320, 392, 62, 20, shade([205, 150, 120], [235, 190, 160], 0.5), 1, 1.2);

// Head.
ellipse(320, 215, 104, 132, shade([222, 168, 138], [250, 206, 178], 0.85), 1, 1.4);
strokes(320, 215, 92, 118, [226, 172, 142], 260, 18);
// Cheeks.
ellipse(262, 262, 26, 16, flat([236, 140, 130]), 0.28, 10);
ellipse(378, 262, 26, 16, flat([236, 140, 130]), 0.28, 10);
// Nose and mouth.
ellipse(320, 252, 9, 20, flat([198, 140, 112]), 0.35, 6);
ellipse(320, 292, 30, 7, flat([172, 70, 78]), 1, 1.2);
ellipse(320, 288, 24, 3, flat([205, 105, 108]), 0.5, 2);
// Eyes: sclera, iris, pupil, highlight; brows.
for (const ex of [278, 362]) {
  ellipse(ex, 212, 27, 17, flat([245, 240, 235]), 1, 1.1);
  ellipse(ex, 212, 12, 12, shade([78, 120, 82], [140, 180, 130], 0.6), 1, 1);
  ellipse(ex, 212, 5.5, 5.5, flat([20, 20, 24]), 1, 0.8);
  ellipse(ex - 4, 208, 2.4, 2.4, flat([255, 255, 255]), 0.9, 0.6);
  ellipse(ex, 190, 30, 4.5, flat([62, 40, 30]), 0.95, 1.4, ex < 320 ? -0.12 : 0.12);
}
// Fringe over the forehead.
ellipse(320, 126, 112, 44, shade([58, 36, 28], [110, 70, 52], 0.6), 1, 1.4);
ellipse(262, 150, 60, 22, flat([58, 36, 28]), 1, 1.4, -0.35);
ellipse(380, 150, 60, 22, flat([58, 36, 28]), 1, 1.4, 0.35);
strokes(320, 135, 100, 30, [72, 46, 36], 90, 24);

// Canvas grain.
for (let i = 0; i < W * H; i++) {
  const n = (rand() - 0.5) * 16;
  data[i * 4] = (data[i * 4] as number) + n;
  data[i * 4 + 1] = (data[i * 4 + 1] as number) + n;
  data[i * 4 + 2] = (data[i * 4 + 2] as number) + n;
}
writeFileSync(join(import.meta.dirname, "painting.png"), encodePng({ w: W, h: H, data }));
console.log("wrote painting.png", W, H);
