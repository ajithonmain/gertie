import { frameAt, rowText, totalFrames, type NAscii, type NAsciiFrame } from "./types.ts";
import { parseHex } from "../spec/color.ts";

const ESC = "\u001b";
export const HIDE_CURSOR = `${ESC}[?25l`;
export const SHOW_CURSOR = `${ESC}[?25h`;
export const CLEAR = `${ESC}[2J`;
export const HOME = `${ESC}[H`;
export const RESET = `${ESC}[0m`;

function fg(hex: string): string {
  const c = parseHex(hex);
  if (!c) return "";
  return `${ESC}[38;2;${Math.round(c[0])};${Math.round(c[1])};${Math.round(c[2])}m`;
}

function bg(hex: string | null): string {
  if (hex === null) return `${ESC}[49m`;
  const c = parseHex(hex);
  if (!c) return `${ESC}[49m`;
  return `${ESC}[48;2;${Math.round(c[0])};${Math.round(c[1])};${Math.round(c[2])}m`;
}

export interface FrameTextOptions {
  /** Use ANSI colour: the style colour, and any per-cell colours. */
  color: boolean;
  /** `el` ends each row with erase-to-end-of-line (best for playing). `pad` pads rows with spaces instead, so the text has no escape codes (best for files). */
  fill: "el" | "pad";
}

/** One frame as terminal text, rows joined by newlines, with no trailing newline. */
export function terminalFrame(s: NAscii, index: number, o: FrameTextOptions): string {
  return frameText(s, s.frames[index] as NAsciiFrame, o);
}

/** One frame, given as a frame rather than an index, as terminal text. `s` gives the grid and the style colour. */
export function frameText(s: NAscii, f: NAsciiFrame, o: FrameTextOptions): string {
  const lines: string[] = [];
  for (let r = 0; r < s.rows; r++) {
    let line = "";
    if (!o.color) line = rowText(f, r);
    else {
      const cells = f.cells[r] as string[];
      const cols = f.colors ? (f.colors[r] as (string | null)[]) : null;
      const backs = f.backgrounds ? (f.backgrounds[r] as (string | null)[]) : null;
      let cur: string | null | undefined;
      let curBack: string | null = null;
      let text = "";
      for (let c = 0; c < cells.length; c++) {
        const ch = cells[c] as string;
        // a cell background is drawn behind spaces too, so it changes the terminal's background colour for every cell
        if (backs) {
          const b = backs[c] ?? null;
          if (b !== curBack) {
            text += bg(b);
            curBack = b;
          }
        }
        // a space draws nothing, so it never changes the colour
        if (ch !== " ") {
          const color: string | null = cols?.[c] ?? null;
          if (color !== cur) {
            text += fg(color ?? s.style.color);
            cur = color;
          }
        }
        text += ch;
      }
      // trailing spaces are dropped, unless the row has backgrounds: a space may be a coloured cell
      line = backs ? text + (curBack !== null ? bg(null) : "") : text.replace(/ +$/, "");
    }
    if (o.fill === "pad") {
      const visible = o.color ? line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "") : line;
      line += " ".repeat(Math.max(0, s.cols - [...visible].length));
    } else line += `${ESC}[K`;
    lines.push(line);
  }
  return o.color ? lines.join("\n") + RESET : lines.join("\n");
}

export interface PlayOptions {
  /** Passes through the animation this many times. */
  loops: number;
  color: boolean;
  write(text: string): void;
  sleep(ms: number): Promise<void>;
  /** Polled between frames. Return true to stop. */
  stopped(): boolean;
}

/** Plays an animation in a terminal. Moves the cursor home between frames, so there is no flicker, and always restores the cursor. */
export async function play(s: NAscii, o: PlayOptions): Promise<void> {
  return playFrames(s, () => s.frames, o);
}

/**
 * Plays frames that come from `frames()`, which is called once per pass, so a recipe can be played without holding
 * every frame in memory. `s` gives the grid, the frame rate and the style.
 */
export async function playFrames(s: NAscii, frames: () => Iterable<NAsciiFrame> | AsyncIterable<NAsciiFrame>, o: PlayOptions): Promise<void> {
  o.write(HIDE_CURSOR + CLEAR);
  try {
    const frameMs = 1000 / s.fps;
    for (let pass = 0; pass < o.loops && !o.stopped(); pass++) {
      for await (const f of frames()) {
        if (o.stopped()) break;
        o.write(HOME + frameText(s, f, { color: o.color, fill: "el" }));
        await o.sleep(frameMs * f.hold);
      }
    }
  } finally {
    o.write(`${ESC}[${s.rows + 1};1H${RESET}${SHOW_CURSOR}`);
  }
}

const hasCellColors = (s: NAscii): boolean => s.frames.some((f) => f.colors !== null || f.backgrounds !== null);

const fmtSeconds = (n: number): string => String(Number(n.toFixed(4)));

/** A self-contained POSIX shell script that plays the animation. Needs only a terminal and `sleep`. */
export function exportSh(s: NAscii): string {
  const color = hasCellColors(s);
  const bodies = s.frames.map((_, i) => terminalFrame(s, i, { color, fill: "pad" }));
  let tag = "GERTIE_FRAME";
  while (bodies.some((b) => b.split("\n").includes(tag))) tag += "_X";
  const lines: string[] = [];
  lines.push("#!/bin/sh");
  lines.push(`# ${s.name}: terminal animation made with Gertie.`);
  lines.push(`# Run with: sh ${s.name}.sh      Stop with Ctrl-C.`);
  lines.push(`# ${s.cols} columns by ${s.rows} rows, ${s.fps} frames per second.`);
  lines.push(`trap 'printf "\\033[0m\\033[?25h\\n"; exit 0' INT TERM`);
  lines.push(`pause() { sleep "$1" 2>/dev/null || sleep 1; }`);
  const c = parseHex(s.style.color);
  if (c && !color) lines.push(`printf '\\033[38;2;${Math.round(c[0])};${Math.round(c[1])};${Math.round(c[2])}m'`);
  lines.push(`printf '\\033[?25l\\033[2J'`);
  const body: string[] = [];
  s.frames.forEach((f, i) => {
    body.push(`printf '\\033[H'`);
    body.push(`cat <<'${tag}'`);
    body.push(bodies[i] as string);
    body.push(tag);
    body.push(`pause ${fmtSeconds(f.hold / s.fps)}`);
  });
  if (s.loop) {
    lines.push("while :; do");
    lines.push(...body);
    lines.push("done");
  } else {
    lines.push(...body);
    lines.push(`printf '\\033[0m\\033[?25h\\n'`);
  }
  return lines.join("\n") + "\n";
}

/** A small ES module that exports the frames, for a command-line tool's loading indicator. */
export function exportJs(s: NAscii): string {
  const frames = s.frames.map((f) => Array.from({ length: s.rows }, (_, r) => rowText(f, r)).join("\n"));
  const delays = s.frames.map((f) => Math.round((f.hold * 1000) / s.fps));
  const out: string[] = [];
  out.push(`// ${s.name}: terminal animation made with Gertie.`);
  out.push(`export const name = ${JSON.stringify(s.name)};`);
  out.push(`export const cols = ${s.cols};`);
  out.push(`export const rows = ${s.rows};`);
  out.push(`export const fps = ${s.fps};`);
  out.push(`export const loop = ${s.loop};`);
  out.push(`/** Each frame is the text of all rows joined by a newline. */`);
  out.push(`export const frames = [`);
  for (const f of frames) out.push(`  ${JSON.stringify(f)},`);
  out.push(`];`);
  out.push(`/** Milliseconds each frame is shown for. */`);
  out.push(`export const delays = ${JSON.stringify(delays)};`);
  out.push(``);
  out.push(`/**`);
  out.push(` * Draws the animation on a stream until the returned function is called.`);
  out.push(` * Does nothing when the stream is not a terminal. Call the returned function to stop and clear the cursor.`);
  out.push(` */`);
  out.push(`export function start(stream = process.stderr) {`);
  out.push(`  if (!stream.isTTY) return () => {};`);
  out.push(`  let i = 0;`);
  out.push(`  let timer;`);
  out.push(`  let stopped = false;`);
  out.push(`  stream.write("\\x1b[?25l");`);
  out.push(`  const draw = () => {`);
  out.push(`    if (stopped) return;`);
  out.push(`    const up = i === 0 && !drawn ? "" : rows > 1 ? "\\x1b[" + (rows - 1) + "A\\r" : "\\r";`);
  out.push(`    drawn = true;`);
  out.push(`    stream.write(up + frames[i].split("\\n").map((l) => l + "\\x1b[K").join("\\n"));`);
  out.push(`    const wait = delays[i];`);
  out.push(`    i += 1;`);
  out.push(`    if (i >= frames.length) {`);
  out.push(`      if (!loop) return;`);
  out.push(`      i = 0;`);
  out.push(`    }`);
  out.push(`    timer = setTimeout(draw, wait);`);
  out.push(`  };`);
  out.push(`  let drawn = false;`);
  out.push(`  draw();`);
  out.push(`  return () => {`);
  out.push(`    stopped = true;`);
  out.push(`    clearTimeout(timer);`);
  out.push(`    stream.write("\\x1b[?25h\\n");`);
  out.push(`  };`);
  out.push(`}`);
  return out.join("\n") + "\n";
}

export { totalFrames, frameAt };
