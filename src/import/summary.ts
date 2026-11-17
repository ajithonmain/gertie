import type { Fragment, ImportResult, Unsupported } from "./svg.ts";

type Obj = Record<string, unknown>;

export interface SummaryNode {
  id: string;
  type: string;
  /** [x, y, w, h] in canvas pixels. */
  bbox: [number, number, number, number];
  fill?: string;
  children?: number;
  depth: number;
}

export interface ImportSummary {
  source: string;
  canvas: { w: number; h: number };
  counts: { shapes: number; groups: number; gradients: number; clips: number; topLevel: number; maxDepth: number };
  nodes: SummaryNode[];
  /** Set when `nodes` lists only part of the tree. */
  truncated?: { shown: number; total: number };
  unsupported: Unsupported[];
  /** What the layering means for animation, in sentences the agent can pass on to the user. */
  advice: string[];
}

const MAX_NODES = 80;

function fillOf(n: Obj): string | undefined {
  const f = n["fill"];
  if (typeof f === "string") return f;
  if (f !== null && typeof f === "object") return "gradient";
  return undefined;
}

export function summarize(r: ImportResult): ImportSummary {
  const all: SummaryNode[] = [];
  let maxDepth = 0;
  const walk = (nodes: Obj[], depth: number): void => {
    for (const n of nodes) {
      const id = n["id"] as string;
      const box = r.boxes[id] ?? [0, 0, 0, 0];
      const kids = Array.isArray(n["children"]) ? (n["children"] as Obj[]) : undefined;
      const sn: SummaryNode = { id, type: n["type"] as string, bbox: box, depth };
      const fill = fillOf(n);
      if (fill !== undefined) sn.fill = fill;
      if (kids) sn.children = kids.length;
      all.push(sn);
      maxDepth = Math.max(maxDepth, depth);
      if (kids) walk(kids, depth + 1);
    }
  };
  walk(r.fragment.nodes, 0);

  // Groups come first because they are the parts that can move; shapes fill the rest by size.
  const area = (s: SummaryNode): number => s.bbox[2] * s.bbox[3];
  let shown = all;
  let truncated: ImportSummary["truncated"];
  if (all.length > MAX_NODES) {
    const groups = all.filter((s) => s.type === "group");
    const rest = all.filter((s) => s.type !== "group").sort((a, b) => area(b) - area(a));
    const keep = new Set([...groups, ...rest].slice(0, MAX_NODES));
    shown = all.filter((s) => keep.has(s));
    truncated = { shown: shown.length, total: all.length };
  }

  const topLevel = r.fragment.nodes.length;
  const advice: string[] = [];
  const looseShapes = r.fragment.nodes.filter((n) => n["type"] !== "group").length;
  if (r.stats.groups === 0 && r.stats.shapes > 1) {
    advice.push(`The artwork has no groups: ${r.stats.shapes} shapes sit side by side. Each shape can move on its own, but a part made of several shapes cannot move as one. Group them by listing ids in a scene, or ask the user for a layered file.`);
  } else if (looseShapes > 40 && r.stats.groups <= 12) {
    advice.push(`Most of the artwork is loose: ${looseShapes} shapes at the top level and only ${r.stats.groups} groups. Only the groups move as parts. To move anything else as one piece, wrap its shapes in a group in your scene, or ask the user for a layered file.`);
  }
  if (r.stats.shapes === 1 || (topLevel === 1 && r.stats.groups === 0)) {
    advice.push("The artwork is one shape, so nothing can move independently of anything else. Ask the user for a layered file if you need separate parts.");
  }
  if (r.stats.groups > 0 && maxDepth >= 2 && advice.length === 0) {
    advice.push("The artwork is layered. Animate groups by id; set `pivot` on a group to the point it should turn around, in canvas pixels.");
  }
  if (r.unsupported.length > 0) advice.push("Some parts could not be imported (see 'unsupported'). Tell the user what was left out.");

  const out: ImportSummary = {
    source: r.fragment.source,
    canvas: r.fragment.canvas,
    counts: { shapes: r.stats.shapes, groups: r.stats.groups, gradients: r.stats.gradients, clips: r.stats.clips, topLevel, maxDepth },
    nodes: shown,
    unsupported: r.unsupported,
    advice,
  };
  if (truncated) out.truncated = truncated;
  return out;
}

const COLORS = ["#f43f5e", "#22c55e", "#3b82f6", "#f59e0b", "#a855f7", "#06b6d4", "#ec4899", "#84cc16"];

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

/**
 * SVG markup to draw over the artwork: an outline and the id of each node at the first level that splits into parts, so a model with vision can tell which id is which part.
 * With many loose shapes only the largest are labelled.
 */
export function labelOverlay(fragment: Fragment, boxes: ImportResult["boxes"]): string {
  // Design tools often wrap everything in one or two groups. Labelling those would show one box, so look inside to the first level that splits into parts.
  let level: Obj[] = fragment.nodes;
  while (level.length === 1 && level[0]?.["type"] === "group" && Array.isArray(level[0]["children"]) && (level[0]["children"] as Obj[]).length > 0) level = level[0]["children"] as Obj[];
  const top = level.map((n) => ({ id: n["id"] as string, box: boxes[n["id"] as string], group: n["type"] === "group" })).filter((t) => t.box !== undefined);
  const area = (t: { box: [number, number, number, number] | undefined }): number => (t.box ? t.box[2] * t.box[3] : 0);
  const { w, h } = fragment.canvas;
  // Groups are the parts that can move, so they come first. Small loose shapes are left unlabelled: they only add clutter.
  const big = (t: { box: [number, number, number, number] | undefined }): boolean => area(t) >= w * h * 0.015;
  const chosen = top.length <= 16 ? top : [...top].filter((t) => t.group || big(t)).sort((a, b) => Number(b.group) - Number(a.group) || area(b) - area(a)).slice(0, 24);
  const font = Math.max(10, Math.round(Math.min(w, h) / 45));
  const parts: string[] = [`<g font-family="sans-serif" font-size="${font}" pointer-events="none">`];
  chosen.forEach((t, k) => {
    const [x, y, bw, bh] = t.box as [number, number, number, number];
    const c = COLORS[k % COLORS.length] as string;
    parts.push(`<rect x="${x}" y="${y}" width="${Math.max(bw, 1)}" height="${Math.max(bh, 1)}" fill="none" stroke="${c}" stroke-width="${Math.max(1, font / 8)}" stroke-dasharray="${font / 2} ${font / 3}"/>`);
    const tx = Math.min(Math.max(x + 2, 0), Math.max(0, w - t.id.length * font * 0.6));
    const ty = Math.min(Math.max(y + font, font), h - 2);
    parts.push(`<text x="${tx}" y="${ty}" fill="${c}" stroke="#000" stroke-width="${font / 4}" paint-order="stroke">${esc(t.id)}</text>`);
  });
  parts.push("</g>");
  return parts.join("");
}
