/** The raw JSON form of an ASCII scene, as written to disk. */
export interface RawFrame {
  text: string[];
  hold?: number;
  colors?: (string | null)[][];
  backgrounds?: (string | null)[][];
}
export interface RawScene {
  ascii: 1;
  name: string;
  cols: number;
  rows: number;
  fps: number;
  loop: boolean;
  style: { color?: string; background?: string | null | { from: string; to: string; angle?: number }; fontSize?: number; fontFamily?: string; glyph?: "text" | "dot" | "square"; ramp?: string; cellAspect?: number; glow?: number };
  frames: RawFrame[];
}

/** Writes a scene as readable JSON: one row of text per line, one row of colours per line. */
export function formatAscii(s: RawScene): string {
  const j = JSON.stringify;
  const out: string[] = [];
  out.push("{");
  out.push(`  "ascii": 1,`);
  out.push(`  "name": ${j(s.name)},`);
  out.push(`  "cols": ${s.cols},`);
  out.push(`  "rows": ${s.rows},`);
  out.push(`  "fps": ${s.fps},`);
  out.push(`  "loop": ${s.loop},`);
  out.push(`  "style": ${j(s.style)},`);
  out.push(`  "frames": [`);
  s.frames.forEach((f, i) => {
    out.push("    {");
    out.push(`      "text": [`);
    f.text.forEach((row, r) => out.push(`        ${j(row)}${r < f.text.length - 1 ? "," : ""}`));
    const more = f.hold !== undefined && f.hold !== 1;
    const hasColors = f.colors !== undefined;
    const hasBacks = f.backgrounds !== undefined;
    out.push(`      ]${more || hasColors || hasBacks ? "," : ""}`);
    if (more) out.push(`      "hold": ${f.hold}${hasColors || hasBacks ? "," : ""}`);
    if (f.colors) {
      out.push(`      "colors": [`);
      f.colors.forEach((row, r) => out.push(`        ${j(row)}${r < (f.colors as unknown[]).length - 1 ? "," : ""}`));
      out.push(`      ]${hasBacks ? "," : ""}`);
    }
    if (f.backgrounds) {
      out.push(`      "backgrounds": [`);
      f.backgrounds.forEach((row, r) => out.push(`        ${j(row)}${r < (f.backgrounds as unknown[]).length - 1 ? "," : ""}`));
      out.push("      ]");
    }
    out.push(`    }${i < s.frames.length - 1 ? "," : ""}`);
  });
  out.push("  ]");
  out.push("}");
  return out.join("\n") + "\n";
}

/** The raw JSON form of a recipe: a scene whose frames are computed from `source` when it is rendered. */
export interface RawRecipe {
  ascii: 1;
  name: string;
  fps: number;
  loop: boolean;
  style: RawScene["style"];
  source: Record<string, unknown>;
}

/** Writes a recipe as readable JSON: the style on one line, one source field per line. */
export function formatRecipe(s: RawRecipe): string {
  const j = JSON.stringify;
  const keys = Object.keys(s.source);
  const out = ["{", `  "ascii": 1,`, `  "name": ${j(s.name)},`, `  "fps": ${s.fps},`, `  "loop": ${s.loop},`, `  "style": ${j(s.style)},`, `  "source": {`];
  keys.forEach((k, i) => out.push(`    ${j(k)}: ${j(s.source[k])}${i < keys.length - 1 ? "," : ""}`));
  out.push("  }", "}");
  return out.join("\n") + "\n";
}

/** Index just past the JSON string that starts at `i` (which is a quote). */
function endOfString(text: string, i: number): number {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === '"') return j + 1;
  }
  return text.length;
}

/**
 * Adds one entry to the top-level `fx` list of a scene file, as text, so the rest of the file keeps its layout (a scene's rows are one per line).
 * Creates the list when there is none. Returns undefined when the text is not a JSON object.
 */
export function appendFx(text: string, entry: Record<string, unknown>): string | undefined {
  const item = JSON.stringify(entry);
  let depth = 0;
  let close = -1;
  let fxOpen = -1;
  let fxClose = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (ch === '"') {
      const end = endOfString(text, i);
      if (depth === 1 && fxOpen < 0 && text.slice(i, end) === '"fx"') {
        const m = /^\s*:\s*\[/.exec(text.slice(end));
        if (m) fxOpen = end + m[0].length - 1;
      }
      i = end - 1;
    } else if (ch === "{" || ch === "[") depth++;
    else if (ch === "}" || ch === "]") {
      depth--;
      if (ch === "]" && fxOpen >= 0 && fxClose < 0 && depth === 1 && i > fxOpen) fxClose = i;
      if (depth === 0 && ch === "}") close = i;
    }
  }
  if (close < 0 || text.slice(0, text.indexOf("{")).trim() !== "") return undefined;
  if (fxOpen >= 0 && fxClose >= 0) {
    const empty = text.slice(fxOpen + 1, fxClose).trim() === "";
    const head = text.slice(0, fxClose).replace(/\s+$/, "");
    return `${head}${empty ? "\n    " : ",\n    "}${item}\n  ${text.slice(fxClose)}`;
  }
  const head = text.slice(0, close).replace(/\s+$/, "");
  return `${head},\n  "fx": [\n    ${item}\n  ]\n${text.slice(close)}`;
}
