import { canvasSize, cellHeight, cellWidth, DEFAULT_CELL_ASPECT, padding, type NAscii, type NAsciiFrame } from "./types.ts";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const num = (n: number): string => String(Math.round(n * 100) / 100);

/** A stretch of characters in one colour, starting at column `col`. `color` is null for the style colour. */
export interface Run {
  col: number;
  text: string;
  color: string | null;
}

/**
 * Splits one row into runs. Spaces draw nothing, so they never start or end a run, and a space
 * between two characters of one colour stays inside that run.
 */
export function rowRuns(cells: readonly string[], colors: readonly (string | null)[] | null): Run[] {
  const runs: Run[] = [];
  let cur: Run | undefined;
  const close = (): void => {
    if (cur) {
      cur.text = cur.text.replace(/ +$/, "");
      if (cur.text !== "") runs.push(cur);
    }
    cur = undefined;
  };
  for (let i = 0; i < cells.length; i++) {
    const ch = cells[i] as string;
    if (ch === " ") {
      if (cur) cur.text += ch;
      continue;
    }
    const color = colors?.[i] ?? null;
    if (cur && cur.color === color) cur.text += ch;
    else {
      close();
      cur = { col: i, text: ch, color };
    }
  }
  close();
  return runs;
}

/** Trims percent noise. At most 8 decimals, which is finer than a microsecond for any length that Gertie allows. */
const pct = (p: number): string => String(Number(p.toFixed(8)));

/** Fraction of the cell (its shorter side) that a dot or square fills: 25 percent for the first non-space entry of the ramp, 95 percent for the last. */
export function glyphSize(ramp: string, ch: string): number {
  const shapes = [...ramp].filter((c) => c !== " ");
  const at = shapes.indexOf(ch);
  if (at < 0) return 0;
  return shapes.length === 1 ? 0.95 : 0.25 + (0.7 * at) / (shapes.length - 1);
}

/** Runs of one colour along a row of cell backgrounds, merged when neighbours share a colour. Cells with no background break a run. */
export function backgroundRuns(row: readonly (string | null)[]): { col: number; n: number; color: string }[] {
  const runs: { col: number; n: number; color: string }[] = [];
  for (let c = 0; c < row.length; c++) {
    const color = row[c] ?? null;
    if (color === null) continue;
    const last = runs[runs.length - 1];
    if (last && last.col + last.n === c && last.color === color) last.n++;
    else runs.push({ col: c, n: 1, color });
  }
  return runs;
}

function frameGroup(f: NAsciiFrame, i: number, s: NAscii): string {
  const cw = cellWidth(s);
  const ch = cellHeight(s);
  const pad = padding(s);
  // At the default cell shape the baseline is the font-based one, as in phase 8; for any other cell height it is the same share of the cell.
  const base = s.style.cellAspect === DEFAULT_CELL_ASPECT ? pad + s.style.fontSize * 0.95 : pad + ch * 0.76;
  const bgs: string[] = [];
  if (f.backgrounds) {
    for (let r = 0; r < s.rows; r++) {
      for (const run of backgroundRuns(f.backgrounds[r] as (string | null)[])) bgs.push(`<rect x="${num(pad + run.col * cw)}" y="${num(pad + r * ch)}" width="${num(run.n * cw)}" height="${num(ch)}" fill="${run.color}"/>`);
    }
  }
  const glyphs: string[] = [];
  const shape = s.style.glyph;
  if (shape === "text") {
    for (let r = 0; r < s.rows; r++) {
      for (const run of rowRuns(f.cells[r] as string[], f.colors ? (f.colors[r] as (string | null)[]) : null)) {
        const n = [...run.text].length;
        const fill = run.color ? ` fill="${run.color}"` : "";
        glyphs.push(`<text x="${num(pad + run.col * cw)}" y="${num(base + r * ch)}" textLength="${num(n * cw)}" lengthAdjust="spacingAndGlyphs"${fill} xml:space="preserve">${esc(run.text)}</text>`);
      }
    }
  } else {
    const side = Math.min(cw, ch);
    for (let r = 0; r < s.rows; r++) {
      const row = f.cells[r] as string[];
      for (let c = 0; c < row.length; c++) {
        const k = row[c] as string;
        if (k === " ") continue;
        const size = glyphSize(s.style.ramp ?? "", k) * side;
        if (size <= 0) continue;
        const color = f.colors?.[r]?.[c] ?? null;
        const fill = color ? ` fill="${color}"` : "";
        const cx = pad + (c + 0.5) * cw;
        const cy = pad + (r + 0.5) * ch;
        glyphs.push(shape === "dot" ? `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(size / 2)}"${fill}/>` : `<rect x="${num(cx - size / 2)}" y="${num(cy - size / 2)}" width="${num(size)}" height="${num(size)}"${fill}/>`);
      }
    }
  }
  if (s.style.glow > 0 && glyphs.length > 0) {
    // The glow is a blurred copy of the glyph layer, painted first so the sharp glyphs sit on top of it.
    return `<g class="f f${i}">${bgs.join("")}<use href="#${GLOW_ID}-${i}" filter="url(#${GLOW_ID})" opacity="0.6"/><g id="${GLOW_ID}-${i}">${glyphs.join("")}</g></g>`;
  }
  return `<g class="f f${i}">${bgs.join("")}${glyphs.join("")}</g>`;
}

const GLOW_ID = "gertie-glow";
const BG_ID = "gertie-bg";

/** The x1 y1 x2 y2 of a CSS-style linear gradient of `angle` degrees over a `w` by `h` box: the line through the centre whose length makes the corners take the end colours. */
export function gradientLine(w: number, h: number, angle: number): [number, number, number, number] {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const len = Math.abs(w * dx) + Math.abs(h * dy);
  return [w / 2 - (dx * len) / 2, h / 2 - (dy * len) / 2, w / 2 + (dx * len) / 2, h / 2 + (dy * len) / 2];
}

/** Microseconds by which each frame boundary is moved earlier. A frame sampled exactly at its start time must land in that frame, not the one before, whatever rounding the browser does. */
const BOUNDARY_SHIFT_S = 5e-6;

/**
 * The animated SVG. Every frame is a group of text rows; all groups share one place and a stepped
 * CSS animation shows one at a time. No script, no font file. Each text run has a `textLength`,
 * so the grid stays aligned whatever monospace font the viewer has.
 */
export function emitAsciiSvg(s: NAscii): string {
  const { w, h } = canvasSize(s);
  const fps = s.fps;
  const total = s.frames.reduce((n, f) => n + f.hold, 0);
  const durationS = total / fps;
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${num(w)} ${num(h)}" width="${num(w)}" height="${num(h)}" font-family="${s.style.fontFamily}" font-size="${s.style.fontSize}" fill="${s.style.color}" role="img" aria-label="${esc(s.name)}">`);

  const css: string[] = [];
  const single = s.frames.length === 1;
  const iteration = s.loop ? "infinite" : "1";
  css.push(`.f{visibility:hidden;animation-duration:${Number((durationS * 1000).toFixed(6))}ms;animation-timing-function:step-end;animation-iteration-count:${iteration}}`);
  let start = 0;
  s.frames.forEach((f, i) => {
    const end = start + f.hold;
    const last = i === s.frames.length - 1;
    // Boundaries are shared between neighbours so no instant has two frames or none.
    const at = (frame: number): number => (frame === 0 ? 0 : Math.max(0, ((frame / fps - BOUNDARY_SHIFT_S) / durationS) * 100));
    if (single) css.push(`.f0{visibility:visible;animation:none}`);
    else {
      const from = start === 0 ? `0%{visibility:visible}` : `${pct(at(start))}%{visibility:visible}`;
      // A frame that is the end of a one-shot animation must still be showing at 100%, or the held (forwards) value would be hidden.
      const to = last ? (s.loop ? "" : "100%{visibility:visible}") : `${pct(at(end))}%{visibility:hidden}`;
      css.push(`.f${i}{animation-name:k${i}${last && !s.loop ? ";animation-fill-mode:forwards" : ""}}@keyframes k${i}{${from}${to}}`);
    }
    start = end;
  });
  css.push(`@media (prefers-reduced-motion:reduce){.f{animation:none}.f0{visibility:visible}}`);
  out.push(`<style>${css.join("")}</style>`);
  const defs: string[] = [];
  const g = s.style.gradient;
  if (g) {
    const [x1, y1, x2, y2] = gradientLine(w, h, g.angle);
    defs.push(`<linearGradient id="${BG_ID}" gradientUnits="userSpaceOnUse" x1="${num(x1)}" y1="${num(y1)}" x2="${num(x2)}" y2="${num(y2)}"><stop offset="0" stop-color="${g.from}"/><stop offset="1" stop-color="${g.to}"/></linearGradient>`);
  }
  if (s.style.glow > 0) defs.push(`<filter id="${GLOW_ID}" filterUnits="userSpaceOnUse" x="0" y="0" width="${num(w)}" height="${num(h)}"><feGaussianBlur stdDeviation="${num(s.style.glow * s.style.fontSize)}"/></filter>`);
  if (defs.length > 0) out.push(`<defs>${defs.join("")}</defs>`);
  if (g) out.push(`<rect width="100%" height="100%" fill="url(#${BG_ID})"/>`);
  else if (s.style.background !== null) out.push(`<rect width="100%" height="100%" fill="${s.style.background}"/>`);
  s.frames.forEach((f, i) => out.push(frameGroup(f, i, s)));
  out.push("</svg>");
  return out.join("\n") + "\n";
}

/** The check that the SVG is safe to show in an img tag or README: no script, no external references. */
export function svgProblems(svg: string): string[] {
  const p: string[] = [];
  if (/<script/i.test(svg)) p.push("contains a script element");
  if (/\bon[a-z]+\s*=/i.test(svg)) p.push("contains an event handler attribute");
  if (/(href|src)\s*=\s*["'](?!#)/i.test(svg)) p.push("references an external resource");
  if (/<foreignObject/i.test(svg)) p.push("contains a foreignObject");
  return p;
}
