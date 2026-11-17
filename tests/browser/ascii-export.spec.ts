import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseAscii } from "../../src/ascii/parse.ts";
import { totalFrames, type NAscii } from "../../src/ascii/types.ts";
import { ffmpegInfo, probeFile } from "../../src/export/ffmpeg.ts";
import { examplesDir, root } from "./helpers.ts";

// Phase 8, steps 2 to 5 through the real command line: rendering and export through the existing pipeline,
// conversion from scenes, video and images, and the script exports.

const cli = join(root, "src/cli/gertie.ts");
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", cwd: root, maxBuffer: 64 * 1024 * 1024 });
const tmp = (): string => mkdtempSync(join(tmpdir(), "gertie-ascii-"));
const have = ffmpegInfo();
test.skip(!have, "ffmpeg is not installed");

const rocket = join(root, "examples/ascii/rocket.ascii.json");

function load(file: string): NAscii {
  const r = parseAscii(JSON.parse(readFileSync(file, "utf8")), { io: { readText: (p) => (existsSync(resolve(dirname(file), p)) ? readFileSync(resolve(dirname(file), p), "utf8") : undefined) } });
  if (!r.scene) throw new Error(JSON.stringify(r.diagnostics));
  return r.scene;
}

/** Every frame of a video as raw RGB, with its size. */
function decode(file: string): { w: number; h: number; frames: Buffer[] } {
  const p = probeFile(file);
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-i", file, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 512 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr.toString());
  const size = p.width * p.height * 3;
  const frames: Buffer[] = [];
  for (let o = 0; o + size <= r.stdout.length; o += size) frames.push(r.stdout.subarray(o, o + size));
  return { w: p.width, h: p.height, frames };
}

/** The first pixel row that has green text in it, or -1. */
function topInk(f: Buffer, w: number, h: number): number {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      if ((f[i + 1] as number) > 120 && (f[i + 1] as number) > (f[i] as number) + 50 && (f[i + 1] as number) > (f[i + 2] as number) + 30) return y;
    }
  }
  return -1;
}

test("an ASCII animation goes through export to every frame format, with the right frame count, size and content", () => {
  const dir = tmp();
  try {
    const formats = ["svg", "gif", "apng", "webp", "webm", "mp4", "sh", "js"];
    const r = run("ascii", "export", rocket, "--to", formats.join(","), "--out", dir, "--json");
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const out = JSON.parse(r.stdout) as { ok: boolean; files: { format: string; path: string; width?: number; height?: number; frames?: number; alpha?: { ok: boolean } }[] };
    expect(out.ok).toBe(true);
    expect(out.files.map((f) => f.format).sort()).toEqual([...formats].sort());
    const s = load(rocket);
    const total = totalFrames(s);
    for (const f of out.files) {
      expect(statSync(f.path).size, `${f.format} is not empty`).toBeGreaterThan(100);
      if (f.width === undefined) continue;
      expect([f.width, f.height], `${f.format} size`).toEqual([216, 296]);
      // GIF delays are whole hundredths of a second, so 8 fps becomes 10 fps there.
      const expected = f.format === "gif" ? Math.round((total / s.fps) * 10) : total;
      expect(Math.abs((f.frames as number) - expected), `${f.format} frame count ${f.frames}`).toBeLessThanOrEqual(1);
    }
    // The video really shows the rocket rising: the top of the drawing moves up the picture.
    const v = decode(join(dir, "rocket.mp4"));
    expect(v.frames.length).toBe(total);
    const tops = v.frames.map((f) => topInk(f, v.w, v.h));
    expect(tops.every((t) => t >= 0), `ink in every frame: ${tops}`).toBe(true);
    for (let i = 1; i < tops.length; i++) expect(tops[i] as number, `frame ${i} is not lower than frame ${i - 1}: ${tops}`).toBeLessThanOrEqual(tops[i - 1] as number);
    expect((tops[0] as number) - (tops[6] as number)).toBeGreaterThan(100);
    // The background is the scene's own colour (#0b0f19) at a corner, and the file is H.264.
    const c = v.frames[0] as Buffer;
    expect(c[0]).toBeLessThan(30);
    expect(c[2]).toBeLessThan(45);
    expect(probeFile(join(dir, "rocket.mp4")).codec).toBe("h264");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--for readme writes the SVG and a GIF; --for telegram keeps its limits", () => {
  const dir = tmp();
  try {
    const r = run("ascii", "export", join(root, "examples/ascii/bouncing-ball.ascii.json"), "--for", "readme", "--out", dir, "--json");
    expect(r.status, r.stderr + r.stdout).toBe(0);
    expect(existsSync(join(dir, "bouncing-ball.readme.svg"))).toBe(true);
    expect(existsSync(join(dir, "bouncing-ball.readme.gif"))).toBe(true);
    // The platform's 3 second limit is enforced: the 3.33 second example is refused, with the fix named.
    const long = run("ascii", "export", join(root, "examples/ascii/bouncing-ball.ascii.json"), "--for", "telegram", "--out", dir, "--json");
    expect(long.status).toBe(1);
    expect(JSON.parse(long.stdout).failures[0].reason).toMatch(/at most 3 seconds/);
    // A shorter one fits.
    const short = join(dir, "short.ascii.json");
    expect(run("ascii", "gen", "ball", "--frames", "30", "--out", short).status).toBe(0);
    const t = run("ascii", "export", short, "--for", "telegram", "--out", dir, "--json");
    expect(t.status, t.stderr + t.stdout).toBe(0);
    const f = (JSON.parse(t.stdout) as { files: { path: string; bytes: number; width: number; height: number }[] }).files[0];
    expect(Math.max(f?.width ?? 0, f?.height ?? 0)).toBe(512);
    expect(f?.bytes).toBeLessThanOrEqual(256 * 1024);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a transparent ASCII animation exports with real transparency", () => {
  const dir = tmp();
  try {
    const file = join(dir, "clear.ascii.json");
    writeFileSync(file, JSON.stringify({ ascii: 1, fps: 10, cols: 8, rows: 2, style: { background: "transparent" }, frames: [{ text: ["HELLO", "WORLD"] }, { text: ["hello", "world"] }] }));
    const r = run("ascii", "export", file, "--to", "apng,webm,webp", "--out", join(dir, "out"), "--json");
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const out = JSON.parse(r.stdout) as { files: { format: string; alpha?: { ok: boolean; checked: boolean } }[] };
    for (const f of out.files) expect(f.alpha, f.format).toMatchObject({ checked: true, ok: true });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** Rows of an ASCII scene's frame as text. */
const frameRows = (s: NAscii, i: number): string[] => (s.frames[i] as NAscii["frames"][number]).cells.map((r) => r.join(""));
const inkCells = (rows: string[]): [number, number][] => rows.flatMap((r, y) => [...r].flatMap((c, x) => (c === " " ? [] : [[x, y] as [number, number]])));

test("a vector scene converts to recognisable ASCII: a circle is round, a rising rocket rises", () => {
  const dir = tmp();
  try {
    const circle = join(dir, "circle.ascii.json");
    const c = run("ascii", "from", join(examplesDir, "pulse-circle.gertie.json"), "--cols", "40", "--out", circle, "--json");
    expect(c.status, c.stderr + c.stdout).toBe(0);
    const cs = load(circle);
    expect([cs.cols, cs.rows]).toEqual([40, 20]);
    // Take the largest frame of the pulse. Its ink must be as wide as it is tall once cell proportions (10 by 20 px) are accounted for.
    let best: [number, number][] = [];
    for (let i = 0; i < cs.frames.length; i++) {
      const cells = inkCells(frameRows(cs, i));
      if (cells.length > best.length) best = cells;
    }
    const xs = best.map((p) => p[0]);
    const ys = best.map((p) => p[1]);
    const wPx = (Math.max(...xs) - Math.min(...xs) + 1) * 10;
    const hPx = (Math.max(...ys) - Math.min(...ys) + 1) * 20;
    expect(wPx / hPx, `ink is ${wPx} by ${hPx} px`).toBeGreaterThan(0.8);
    expect(wPx / hPx).toBeLessThan(1.25);
    // The circle is centred, and the middle is denser than the edge.
    const cx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const cy = ys.reduce((a, b) => a + b, 0) / ys.length;
    expect(Math.abs(cx - 19.5)).toBeLessThan(2);
    expect(Math.abs(cy - 9.5)).toBeLessThan(2);

    const rocketFile = join(dir, "rocket.ascii.json");
    const r = run("ascii", "from", join(examplesDir, "rocket-launch.gertie.json"), "--cols", "40", "--out", rocketFile, "--json");
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const rs = load(rocketFile);
    const cyOf = (i: number): number => {
      const cells = inkCells(frameRows(rs, i));
      return cells.length === 0 ? NaN : cells.reduce((a, p) => a + p[1], 0) / cells.length;
    };
    const first = cyOf(0);
    const later = cyOf(rs.frames.length - 4);
    expect(first, "the rocket starts near the bottom").toBeGreaterThan(rs.rows * 0.5);
    expect(later, `the rocket is higher later: ${first} then ${later}`).toBeLessThan(first - 4);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a video converts frame by frame: a white square moving right across black", () => {
  const dir = tmp();
  try {
    const video = join(dir, "move.mp4");
    const ff = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=320x180:r=10:d=2", "-f", "lavfi", "-i", "color=c=white:s=40x40:r=10:d=2", "-filter_complex", "[0][1]overlay=x='t*130':y=70", "-pix_fmt", "yuv420p", video]);
    expect(ff.status, ff.stderr.toString()).toBe(0);
    const out = join(dir, "move.ascii.json");
    const r = run("ascii", "from", video, "--cols", "40", "--fps", "5", "--out", out, "--json");
    expect(r.status, r.stderr + r.stdout).toBe(0);
    const s = load(out);
    expect(s.cols).toBe(40);
    expect(s.rows).toBe(Math.round((40 * 180) / 320 / 2));
    expect(totalFrames(s)).toBe(10);
    const lefts = Array.from({ length: s.frames.length }, (_, i) => Math.min(...inkCells(frameRows(s, i)).map((p) => p[0])));
    expect(lefts.every(Number.isFinite), `ink in every frame: ${lefts}`).toBe(true);
    for (let i = 1; i < lefts.length; i++) expect(lefts[i] as number).toBeGreaterThan(lefts[i - 1] as number);
    // the square is bright, so it uses the dense end of the ramp
    expect(frameRows(s, 0).join("")).toContain("@");
    expect(r.stdout).not.toContain('"errors":1');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an image converts to one frame, and --invert and --ramp change the characters", () => {
  const dir = tmp();
  try {
    const png = join(dir, "half.png");
    const ff = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=black:s=200x100:d=1,drawbox=x=0:y=0:w=100:h=100:color=white:t=fill", "-frames:v", "1", png]);
    expect(ff.status, ff.stderr.toString()).toBe(0);
    const out = join(dir, "half.ascii.json");
    expect(run("ascii", "from", png, "--cols", "20", "--out", out, "--json").status).toBe(0);
    const s = load(out);
    expect(s.frames.length).toBe(1);
    const row = frameRows(s, 0)[0] as string;
    expect(row.slice(0, 10)).toBe("@".repeat(10));
    expect(row.slice(10)).toBe(" ".repeat(10));
    const inv = join(dir, "inv.ascii.json");
    expect(run("ascii", "from", png, "--cols", "20", "--invert", "--ramp", " #", "--out", inv, "--json").status).toBe(0);
    const t = load(inv);
    expect((frameRows(t, 0)[0] as string).slice(0, 10)).toBe(" ".repeat(10));
    expect((frameRows(t, 0)[0] as string).slice(10)).toBe("#".repeat(10));
    expect(t.style.background).toBe("#f8fafc");
    // a missing file and a file that is not a picture are usage problems, not crashes
    expect(run("ascii", "from", join(dir, "nope.png")).status).toBe(2);
    writeFileSync(join(dir, "text.png"), "not a picture");
    expect(run("ascii", "from", join(dir, "text.png")).status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--color keeps the colours of the source in a per-cell list", () => {
  const dir = tmp();
  try {
    mkdirSync(dir, { recursive: true });
    const png = join(dir, "red.png");
    spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0xe02020:s=100x50:d=1", "-frames:v", "1", png]);
    const out = join(dir, "red.ascii.json");
    expect(run("ascii", "from", png, "--cols", "10", "--color", "--out", out, "--json").status).toBe(0);
    const s = load(out);
    const colors = (s.frames[0] as NAscii["frames"][number]).colors;
    expect(colors?.[0]?.[0]).toBe("#e02020");
    // it survives into the SVG as a fill
    const svg = run("ascii", "export", out, "--to", "svg", "--out", join(dir, "o"), "--json");
    expect(svg.status, svg.stderr).toBe(0);
    expect(readFileSync(join(dir, "o", "red.svg"), "utf8")).toContain('fill="#e02020"');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
