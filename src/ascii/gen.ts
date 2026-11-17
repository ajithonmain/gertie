import { DEFAULT_BACKGROUND, DEFAULT_COLOR } from "./types.ts";

export const GENERATORS = ["spinner", "bar", "scroll", "ball", "rain", "stars", "wave"] as const;
export type GeneratorKind = (typeof GENERATORS)[number];

export interface GenOptions {
  name?: string;
  cols?: number;
  rows?: number;
  frames?: number;
  fps?: number;
  text?: string;
  seed?: number;
  /** Spinner look: line, dots, bounce or arrow. */
  style?: string;
  color?: string;
  background?: string | null;
  loop?: boolean;
}

export interface RawAscii {
  ascii: 1;
  name: string;
  cols: number;
  rows: number;
  fps: number;
  loop: boolean;
  style: { color: string; background: string | null };
  frames: { text: string[] }[];
}

/** A small seeded random number generator, so generated animations are the same every time. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Grid = string[][];
const blank = (cols: number, rows: number): Grid => Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
const put = (g: Grid, x: number, y: number, ch: string): void => {
  const row = g[y];
  if (row && x >= 0 && x < row.length) row[x] = ch;
};
const toText = (g: Grid): string[] => g.map((r) => r.join("").replace(/ +$/, ""));
const mod = (n: number, m: number): number => ((n % m) + m) % m;

export const SPINNER_STYLES: Readonly<Record<string, readonly string[]>> = {
  line: ["|", "/", "-", "\\"],
  dots: [".  ", ".. ", "...", " ..", "  .", "   "],
  bounce: ["[=   ]", "[ =  ]", "[  = ]", "[   =]", "[  = ]", "[ =  ]"],
  arrow: ["<   ", "<<  ", "<<< ", " <<<", "  <<", "   <"],
};

interface Spec {
  cols: number;
  rows: number;
  fps: number;
  loop: boolean;
  frames: Grid[];
}

function spinner(o: Required<Pick<GenOptions, "style">> & GenOptions): Spec {
  const seq = SPINNER_STYLES[o.style];
  if (!seq) throw new Error(`Unknown spinner style '${o.style}'. Styles: ${Object.keys(SPINNER_STYLES).join(", ")}.`);
  const label = o.text ?? "";
  const w = Math.max(...seq.map((s) => s.length));
  const cols = o.cols ?? w + (label ? 1 + [...label].length : 0);
  const n = o.frames ?? seq.length * (seq.length < 6 ? 2 : 1);
  const frames: Grid[] = [];
  for (let t = 0; t < n; t++) {
    const g = blank(cols, 1);
    [...(seq[t % seq.length] as string)].forEach((ch, i) => put(g, i, 0, ch));
    [...label].forEach((ch, i) => put(g, w + 1 + i, 0, ch));
    frames.push(g);
  }
  return { cols, rows: 1, fps: o.fps ?? 10, loop: true, frames };
}

function bar(o: GenOptions): Spec {
  const cols = o.cols ?? 30;
  if (cols < 8) throw new Error("A progress bar needs at least 8 columns. Raise --cols.");
  const n = o.frames ?? 21;
  const label = o.text ?? "";
  const frames: Grid[] = [];
  const inner = cols - 2 - 5 - (label ? [...label].length + 1 : 0);
  if (inner < 3) throw new Error("The progress bar is too narrow for its label. Raise --cols or shorten --text.");
  for (let t = 0; t < n; t++) {
    const p = n === 1 ? 1 : t / (n - 1);
    const filled = Math.round(p * inner);
    const g = blank(cols, 1);
    const body = `[${"#".repeat(filled)}${"-".repeat(inner - filled)}] ${String(Math.round(p * 100)).padStart(3)}%${label ? ` ${label}` : ""}`;
    [...body].forEach((ch, i) => put(g, i, 0, ch));
    frames.push(g);
  }
  return { cols, rows: 1, fps: o.fps ?? 10, loop: o.loop ?? false, frames };
}

function scroll(o: GenOptions): Spec {
  const text = o.text ?? "GERTIE";
  const chars = [...text];
  const cols = o.cols ?? 24;
  const n = o.frames ?? cols + chars.length;
  const frames: Grid[] = [];
  for (let t = 0; t < n; t++) {
    const g = blank(cols, 1);
    chars.forEach((ch, i) => put(g, cols - t + i, 0, ch));
    frames.push(g);
  }
  return { cols, rows: 1, fps: o.fps ?? 12, loop: o.loop ?? true, frames };
}

function ball(o: GenOptions): Spec {
  const cols = o.cols ?? 40;
  const rows = o.rows ?? 12;
  if (rows < 4 || cols < 6) throw new Error("A bouncing ball needs at least 6 columns and 4 rows. Raise --cols and --rows.");
  const n = o.frames ?? 40;
  const bounces = 2;
  const frames: Grid[] = [];
  const floor = rows - 1;
  const travel = cols - 3;
  for (let t = 0; t < n; t++) {
    const g = blank(cols, rows);
    for (let x = 0; x < cols; x++) put(g, x, floor, "=");
    const u = t / n;
    const tri = u < 0.5 ? u * 2 : 2 - u * 2;
    const x = 1 + Math.round(tri * travel);
    const p = (u * bounces * 2) % 1;
    const lift = Math.round(4 * p * (1 - p) * (floor - 2));
    const y = floor - 1 - lift;
    put(g, x, y, "O");
    // a shadow on the floor shrinks as the ball rises
    put(g, x, floor, lift > (floor - 2) / 2 ? "." : "_");
    frames.push(g);
  }
  return { cols, rows, fps: o.fps ?? 12, loop: o.loop ?? true, frames };
}

function rain(o: GenOptions): Spec {
  const cols = o.cols ?? 40;
  const rows = o.rows ?? 12;
  const tail = 2;
  const period = rows + tail + 1;
  const n = o.frames ?? period;
  const rnd = mulberry32(o.seed ?? 7);
  const drops: { x: number; y0: number; s: number }[] = [];
  for (let x = 0; x < cols; x++) if (rnd() < 0.28) drops.push({ x, y0: Math.floor(rnd() * period), s: 1 + Math.floor(rnd() * 2) });
  const frames: Grid[] = [];
  for (let t = 0; t < n; t++) {
    const g = blank(cols, rows);
    for (const d of drops) {
      const y = mod(d.y0 + d.s * t, period);
      put(g, d.x, y, "|");
      for (let k = 1; k <= tail; k++) put(g, d.x, y - k, k === 1 ? ":" : ".");
    }
    frames.push(g);
  }
  return { cols, rows, fps: o.fps ?? 10, loop: o.loop ?? true, frames };
}

function stars(o: GenOptions): Spec {
  const cols = o.cols ?? 40;
  const rows = o.rows ?? 12;
  const n = o.frames ?? cols;
  const rnd = mulberry32(o.seed ?? 11);
  const count = Math.max(4, Math.round((cols * rows) / 14));
  const layers = [
    { ch: ".", speed: 1 },
    { ch: "+", speed: 2 },
    { ch: "*", speed: 3 },
  ];
  const field = Array.from({ length: count }, () => ({ x: Math.floor(rnd() * cols), y: Math.floor(rnd() * rows), layer: layers[Math.floor(rnd() * 3)] as (typeof layers)[number] }));
  const frames: Grid[] = [];
  for (let t = 0; t < n; t++) {
    const g = blank(cols, rows);
    // slower layers first so that nearer stars draw on top
    for (const s of [...field].sort((a, b) => a.layer.speed - b.layer.speed)) put(g, mod(s.x - s.layer.speed * t, cols), s.y, s.layer.ch);
    frames.push(g);
  }
  return { cols, rows, fps: o.fps ?? 10, loop: o.loop ?? true, frames };
}

function wave(o: GenOptions): Spec {
  const cols = o.cols ?? 40;
  const rows = o.rows ?? 9;
  const n = o.frames ?? 16;
  const waves = Math.max(1, Math.round(cols / 20));
  const frames: Grid[] = [];
  const mid = (rows - 1) / 2;
  for (let t = 0; t < n; t++) {
    const g = blank(cols, rows);
    for (let x = 0; x < cols; x++) {
      const y = Math.round(mid - mid * Math.sin(2 * Math.PI * ((waves * x) / cols - t / n)));
      put(g, x, y, "*");
    }
    frames.push(g);
  }
  return { cols, rows, fps: o.fps ?? 10, loop: o.loop ?? true, frames };
}

/** Builds an ASCII scene for one of the procedural effects. The result is the raw JSON form, ready to write to a file. */
export function generate(kind: string, o: GenOptions = {}): RawAscii {
  let spec: Spec;
  switch (kind) {
    case "spinner":
      spec = spinner({ style: "line", ...o, ...(o.style ? { style: o.style } : {}) });
      break;
    case "bar":
      spec = bar(o);
      break;
    case "scroll":
      spec = scroll(o);
      break;
    case "ball":
      spec = ball(o);
      break;
    case "rain":
      spec = rain(o);
      break;
    case "stars":
      spec = stars(o);
      break;
    case "wave":
      spec = wave(o);
      break;
    default:
      throw new Error(`Unknown generator '${kind}'. Generators: ${GENERATORS.join(", ")}.`);
  }
  if (spec.frames.length < 1 || spec.frames.length > 1200) throw new Error(`--frames must give between 1 and 1200 frames, got ${spec.frames.length}.`);
  return {
    ascii: 1,
    name: o.name ?? kind,
    cols: spec.cols,
    rows: spec.rows,
    fps: spec.fps,
    loop: spec.loop,
    style: { color: o.color ?? DEFAULT_COLOR, background: o.background === undefined ? DEFAULT_BACKGROUND : o.background },
    frames: spec.frames.map((g) => ({ text: toText(g) })),
  };
}
