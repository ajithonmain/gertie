import type { CutoutSpec } from "./build.ts";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const COLORS = ["#f43f5e", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

/** SVG of an image with a labelled grid, for reading pixel coordinates by eye. `imageUri` is a data URI of the image. */
export function gridSvg(w: number, h: number, imageUri: string, step: number): string {
  const font = Math.max(9, Math.round(Math.min(w, h) / 50));
  const parts: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${imageUri}" width="${w}" height="${h}"/>`];
  const lines: string[] = [];
  for (let x = step; x < w; x += step) lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${h}"/>`);
  for (let y = step; y < h; y += step) lines.push(`<line x1="0" y1="${y}" x2="${w}" y2="${y}"/>`);
  parts.push(`<g stroke="#000" stroke-opacity="0.55" stroke-width="1.6">${lines.join("")}</g><g stroke="#fff" stroke-opacity="0.8" stroke-width="0.7">${lines.join("")}</g>`);
  const labels: string[] = [];
  const t = (x: number, y: number, text: string): string => `<text x="${x}" y="${y}" font-size="${font}" fill="#fff" stroke="#000" stroke-width="${font / 4}" paint-order="stroke" font-family="sans-serif">${text}</text>`;
  for (let x = step; x < w; x += step) labels.push(t(x + 2, font + 1, String(x)));
  for (let y = step; y < h; y += step) labels.push(t(2, y - 2, String(y)));
  parts.push(`<g>${labels.join("")}</g></svg>`);
  return parts.join("");
}

/** SVG of an image with every part's outline, its id and pivot, and the lids and where each lid's skin comes from. */
export function outlinesSvg(w: number, h: number, imageUri: string, spec: CutoutSpec): string {
  const font = Math.max(10, Math.round(Math.min(w, h) / 40));
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image href="${imageUri}" width="${w}" height="${h}"/>`];
  spec.parts.forEach((p, i) => {
    const c = COLORS[i % COLORS.length] as string;
    out.push(`<polygon points="${p.polygon.map(([x, y]) => `${x},${y}`).join(" ")}" fill="${c}" fill-opacity="0.12" stroke="#000" stroke-width="3" stroke-opacity="0.5"/>`);
    out.push(`<polygon points="${p.polygon.map(([x, y]) => `${x},${y}`).join(" ")}" fill="none" stroke="${c}" stroke-width="1.5"/>`);
    const [lx, ly] = p.polygon.reduce((a, q) => (q[1] < a[1] ? q : a), p.polygon[0] as [number, number]);
    out.push(`<text x="${lx + 3}" y="${ly + font}" font-size="${font}" fill="${c}" stroke="#000" stroke-width="${font / 4}" paint-order="stroke" font-family="sans-serif">${i + 1} ${esc(p.id)}</text>`);
    if (p.pivot) out.push(`<g stroke="#000" stroke-width="3"><path d="M${p.pivot[0] - 7} ${p.pivot[1]}h14M${p.pivot[0]} ${p.pivot[1] - 7}v14"/></g><g stroke="${c}" stroke-width="1.5"><path d="M${p.pivot[0] - 7} ${p.pivot[1]}h14M${p.pivot[0]} ${p.pivot[1] - 7}v14"/></g>`);
  });
  for (const l of spec.lids ?? []) {
    const [cx, cy, rx, ry] = l.ellipse;
    out.push(`<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#000" stroke-width="3" stroke-opacity="0.5"/><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="#fff" stroke-width="1.2" stroke-dasharray="4 3"/>`);
    const pw = Math.ceil(2 * rx) + 4;
    const ph = Math.ceil(2 * ry) + 4;
    out.push(`<rect x="${l.sample[0] - pw / 2}" y="${l.sample[1] - ph / 2}" width="${pw}" height="${ph}" fill="none" stroke="#000" stroke-width="3" stroke-opacity="0.5"/><rect x="${l.sample[0] - pw / 2}" y="${l.sample[1] - ph / 2}" width="${pw}" height="${ph}" fill="none" stroke="#fff" stroke-width="1.2"/>`);
    out.push(`<text x="${cx + rx + 3}" y="${cy}" font-size="${font}" fill="#fff" stroke="#000" stroke-width="${font / 4}" paint-order="stroke" font-family="sans-serif">${esc(l.id)}</text>`);
  }
  out.push("</svg>");
  return out.join("");
}
