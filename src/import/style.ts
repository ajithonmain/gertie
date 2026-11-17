import type { XmlElement } from "./xml.ts";

/** CSS colour names used by design tools. Anything else is reported by the importer. */
const NAMED: Record<string, string> = {
  black: "#000000", white: "#ffffff", red: "#ff0000", green: "#008000", blue: "#0000ff", yellow: "#ffff00",
  orange: "#ffa500", purple: "#800080", pink: "#ffc0cb", gray: "#808080", grey: "#808080", silver: "#c0c0c0",
  maroon: "#800000", olive: "#808000", lime: "#00ff00", aqua: "#00ffff", cyan: "#00ffff", teal: "#008080",
  navy: "#000080", fuchsia: "#ff00ff", magenta: "#ff00ff", brown: "#a52a2a", gold: "#ffd700", crimson: "#dc143c",
  coral: "#ff7f50", indigo: "#4b0082", violet: "#ee82ee", beige: "#f5f5dc", ivory: "#fffff0", khaki: "#f0e68c",
  salmon: "#fa8072", tan: "#d2b48c", turquoise: "#40e0d0", lightgray: "#d3d3d3", lightgrey: "#d3d3d3",
  darkgray: "#a9a9a9", darkgrey: "#a9a9a9", whitesmoke: "#f5f5f5", transparent: "#00000000",
};

const hex2 = (n: number): string => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");

/** Parses a CSS colour to `#rrggbb` or `#rrggbbaa`. Returns undefined when it is not understood. `none` is handled by the caller. */
export function parseColor(raw: string): string | undefined {
  const s = raw.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`;
  if (/^#[0-9a-f]{4}$/.test(s)) return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}${s[4]}${s[4]}`;
  if (/^#[0-9a-f]{6}$/.test(s) || /^#[0-9a-f]{8}$/.test(s)) return s;
  const fn = /^(rgba?|hsla?)\(([^)]*)\)$/.exec(s);
  if (fn) {
    const parts = (fn[2] as string).split(/[\s,/]+/).filter((t) => t !== "");
    if (parts.length < 3) return undefined;
    const num = (t: string, scale: number): number => (t.endsWith("%") ? (parseFloat(t) / 100) * scale : parseFloat(t));
    let rgb: number[];
    if ((fn[1] as string).startsWith("rgb")) rgb = [num(parts[0] as string, 255), num(parts[1] as string, 255), num(parts[2] as string, 255)];
    else {
      const h = (((parseFloat(parts[0] as string) % 360) + 360) % 360) / 360;
      const sat = num(parts[1] as string, 1);
      const l = num(parts[2] as string, 1);
      const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
      const p = 2 * l - q;
      const f = (t: number): number => {
        const u = (t + 1) % 1;
        if (u < 1 / 6) return p + (q - p) * 6 * u;
        if (u < 1 / 2) return q;
        if (u < 2 / 3) return p + (q - p) * (2 / 3 - u) * 6;
        return p;
      };
      rgb = [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
    }
    if (rgb.some((v) => !Number.isFinite(v))) return undefined;
    const alpha = parts[3] !== undefined ? num(parts[3], 1) : 1;
    const base = `#${hex2(rgb[0] as number)}${hex2(rgb[1] as number)}${hex2(rgb[2] as number)}`;
    return alpha >= 1 ? base : `${base}${hex2(alpha * 255)}`;
  }
  return NAMED[s];
}

/** Multiplies the alpha of a `#rrggbb` or `#rrggbbaa` colour by `k`. */
export function withAlpha(color: string, k: number): string {
  if (k >= 1) return color;
  const rgb = color.slice(0, 7);
  const a = color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1;
  return `${rgb}${hex2(a * k * 255)}`;
}

// ---------------------------------------------------------------- cascade

export type Props = Record<string, string>;

interface Rule {
  selector: string;
  specificity: number;
  order: number;
  props: Props;
}

export interface StyleSheet {
  rules: Rule[];
  /** Selectors that were skipped because they are beyond class, id and element selectors. */
  skipped: string[];
}

function parseDeclarations(text: string): Props {
  const out: Props = {};
  for (const decl of text.split(";")) {
    const k = decl.indexOf(":");
    if (k === -1) continue;
    const name = decl.slice(0, k).trim().toLowerCase();
    const value = decl.slice(k + 1).replace(/!important\s*$/i, "").trim();
    if (name !== "") out[name] = value;
  }
  return out;
}

/** Reads the rules of every `<style>` element. Supported selectors: `tag`, `.class`, `#id`, `*`, and compounds such as `path.cls`, separated by commas. */
export function readStyleSheet(root: XmlElement): StyleSheet {
  const sheet: StyleSheet = { rules: [], skipped: [] };
  let order = 0;
  const walk = (el: XmlElement): void => {
    if (el.name === "style") {
      const css = el.text.replace(/\/\*[\s\S]*?\*\//g, "");
      const re = /([^{}]+)\{([^{}]*)\}/g;
      for (let m = re.exec(css); m !== null; m = re.exec(css)) {
        const props = parseDeclarations(m[2] as string);
        for (const sel of (m[1] as string).split(",").map((t) => t.trim()).filter((t) => t !== "")) {
          if (sel.startsWith("@") || !/^(\*|[A-Za-z][\w-]*)?(\.[\w-]+|#[\w-]+)*$/.test(sel)) {
            sheet.skipped.push(sel);
            continue;
          }
          const ids = (sel.match(/#[\w-]+/g) ?? []).length;
          const classes = (sel.match(/\.[\w-]+/g) ?? []).length;
          const tag = /^[A-Za-z]/.test(sel) ? 1 : 0;
          sheet.rules.push({ selector: sel, specificity: ids * 100 + classes * 10 + tag, order: order++, props });
        }
      }
    }
    el.children.forEach(walk);
  };
  walk(root);
  return sheet;
}

function matches(selector: string, el: XmlElement): boolean {
  const tag = /^[A-Za-z][\w-]*/.exec(selector)?.[0];
  if (tag !== undefined && tag !== el.name) return false;
  const classes = (el.attrs["class"] ?? "").split(/\s+/);
  for (const c of selector.match(/\.[\w-]+/g) ?? []) if (!classes.includes(c.slice(1))) return false;
  for (const i of selector.match(/#[\w-]+/g) ?? []) if (el.attrs["id"] !== i.slice(1)) return false;
  return true;
}

const STYLE_ATTRS = [
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "opacity", "display", "visibility", "clip-path", "clip-rule",
  "mask", "color", "stop-color", "stop-opacity", "filter", "mix-blend-mode",
];

/** The element's own declared properties: presentation attributes, then style sheet rules, then the `style` attribute. */
export function declaredProps(el: XmlElement, sheet: StyleSheet): Props {
  const out: Props = {};
  for (const k of STYLE_ATTRS) {
    const v = el.attrs[k];
    if (v !== undefined) out[k] = v.trim();
  }
  const hits = sheet.rules.filter((r) => matches(r.selector, el)).sort((a, b) => a.specificity - b.specificity || a.order - b.order);
  for (const r of hits) Object.assign(out, r.props);
  if (el.attrs["style"] !== undefined) Object.assign(out, parseDeclarations(el.attrs["style"]));
  return out;
}

/** Properties that pass from parent to child. */
export const INHERITED = new Set([
  "fill", "fill-opacity", "fill-rule", "stroke", "stroke-width", "stroke-opacity", "stroke-linecap", "stroke-linejoin",
  "stroke-miterlimit", "stroke-dasharray", "stroke-dashoffset", "visibility", "clip-rule", "color",
]);

export function inheritProps(parent: Props, own: Props): Props {
  const out: Props = {};
  for (const k of INHERITED) if (parent[k] !== undefined) out[k] = parent[k] as string;
  for (const [k, v] of Object.entries(own)) {
    if (v === "inherit") continue;
    out[k] = v;
  }
  return out;
}

/** Parses a length such as `12`, `12px` or `50%`. `pct` is the value 100 percent stands for. */
export function parseLength(raw: string | undefined, pct = 1): number | undefined {
  if (raw === undefined) return undefined;
  const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(px|%|pt|em)?\s*$/.exec(raw);
  if (!m) return undefined;
  const v = parseFloat(m[1] as string);
  if (m[2] === "%") return (v / 100) * pct;
  if (m[2] === "pt") return (v * 4) / 3;
  if (m[2] === "em") return v * 16;
  return v;
}
