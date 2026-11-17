import { after, test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyzeMotion, estimateBackground, findIdle, frameStat, IDLE_MAX, IDLE_MIN, medianBackground, type FrameStat } from "../../src/study/analyze.ts";
import { parsePoint, sampleColours } from "../../src/study/sample.ts";
import type { Raster } from "../../src/trace/quantize.ts";

function frame(w: number, h: number, bg: [number, number, number, number], boxes: { x: number; y: number; w: number; h: number; c: [number, number, number, number] }[] = []): Raster {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set(bg, i * 4);
  for (const b of boxes) for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) data.set(b.c, (y * w + x) * 4);
  return { w, h, data };
}
const stat = (t: number, cx: number, cy = 0.5, w = 0.1, h = 0.1): FrameStat => ({ t, cx, cy, w, h, area: w * h });
const series = (fps: number, seconds: number, f: (t: number) => Partial<FrameStat>): FrameStat[] => Array.from({ length: Math.round(fps * seconds) + 1 }, (_, i) => ({ ...stat(i / fps, 0.5), ...f(i / fps), t: i / fps }));

test("the background is the border colour, or transparent when the edges are", () => {
  const solid = frame(40, 30, [20, 40, 80, 255], [{ x: 15, y: 10, w: 8, h: 8, c: [255, 0, 0, 255] }]);
  assert.deepEqual(estimateBackground(solid), { kind: "colour", rgb: [20, 40, 80] });
  assert.equal(estimateBackground(frame(40, 30, [0, 0, 0, 0])).kind, "transparent");
});

test("the subject is found as what differs from the background, with its centre and size", () => {
  const f = frame(100, 50, [10, 10, 10, 255], [{ x: 20, y: 10, w: 20, h: 10, c: [200, 200, 0, 255] }]);
  const s = frameStat(f, estimateBackground(f), 0.5)!;
  assert.equal(s.t, 0.5);
  assert.ok(Math.abs(s.cx - 0.3) < 0.02 && Math.abs(s.cy - 0.3) < 0.02, `${s.cx} ${s.cy}`);
  assert.ok(Math.abs(s.w - 0.2) < 0.01 && Math.abs(s.h - 0.2) < 0.01);
  assert.equal(frameStat(frame(100, 50, [10, 10, 10, 255]), { kind: "colour", rgb: [10, 10, 10] }, 0), undefined);
  assert.equal(frameStat(frame(100, 50, [0, 0, 0, 0], [{ x: 5, y: 5, w: 10, h: 10, c: [1, 2, 3, 255] }]), { kind: "transparent" }, 0)!.w, 0.1);
});

test("a static object is background when it stays put, so only the mover is measured", () => {
  const floor = { x: 0, y: 45, w: 100, h: 5, c: [90, 90, 90, 255] as [number, number, number, number] };
  const frames = Array.from({ length: 20 }, (_, i) => frame(100, 50, [10, 10, 10, 255], [floor, { x: i * 4, y: 10, w: 10, h: 10, c: [255, 160, 0, 255] }]));
  const bg = medianBackground(frames);
  const s = frameStat(frames[10] as Raster, bg, 0)!;
  assert.ok(Math.abs(s.h - 0.2) < 0.02, `height ${s.h} is the ball, not the ball and the floor`);
  const withFloor = frameStat(frames[10] as Raster, estimateBackground(frames[0] as Raster), 0)!;
  assert.ok(withFloor.h > 0.6, "with a border-colour background the floor counts");
});

test("a steady move is found with its start, end, distance and an even speed", () => {
  const st = analyzeMotion(series(30, 2, (t) => ({ cx: t < 0.5 ? 0.1 : t > 1.5 ? 0.9 : 0.1 + (t - 0.5) * 0.8 })));
  const x = st.moves.filter((m) => m.channel === "x");
  assert.equal(x.length, 1);
  assert.ok(Math.abs(x[0]!.from - 0.5) < 0.12 && Math.abs(x[0]!.to - 1.5) < 0.12, `${x[0]!.from} ${x[0]!.to}`);
  assert.ok(Math.abs(x[0]!.change - 0.8) < 0.04);
  assert.equal(x[0]!.ease, "even");
  assert.deepEqual(st.holds.map((h) => [Math.round(h.from * 10) / 10, Math.round(h.to * 10) / 10]).slice(0, 1), [[0, 0.5]]);
});

test("the speed profile is read: ease in, ease out, and slow at both ends", () => {
  const prog = (f: (p: number) => number) => analyzeMotion(series(30, 1.5, (t) => ({ cx: 0.1 + 0.8 * f(Math.min(1, Math.max(0, (t - 0.25) / 1))) })));
  assert.equal(prog((p) => p * p * p).moves.find((m) => m.channel === "x")!.ease, "starts slow");
  assert.equal(prog((p) => 1 - (1 - p) ** 3).moves.find((m) => m.channel === "x")!.ease, "starts fast");
  assert.equal(prog((p) => 0.5 - Math.cos(Math.PI * p) / 2).moves.find((m) => m.channel === "x")!.ease, "slow at both ends");
});

test("a bounce is found as alternating moves with their durations", () => {
  const y = (t: number): number => (t < 0.4 ? 0.1 : t < 1 ? 0.1 + 0.7 * ((t - 0.4) / 0.6) ** 2 : t < 1.4 ? 0.8 - 0.3 * Math.sin(((t - 1) / 0.4) * (Math.PI / 2)) : 0.5 + 0.3 * ((t - 1.4) / 0.4) ** 2);
  const st = analyzeMotion(series(30, 1.8, (t) => ({ cy: Math.min(0.8, y(t)) })));
  const ys = st.moves.filter((m) => m.channel === "y");
  assert.ok(ys.length >= 3, JSON.stringify(ys));
  assert.ok(ys[0]!.change > 0.5 && ys[1]!.change < -0.2 && ys[2]!.change > 0.2, ys.map((m) => m.change.toFixed(2)).join(" "));
  assert.equal(ys[0]!.ease, "starts slow");
  assert.equal(ys[1]!.ease, "starts fast");
});

test("noise is not movement, and a still clip has holds and no moves", () => {
  const st = analyzeMotion(series(30, 2, (t) => ({ cx: 0.5 + 0.001 * Math.sin(t * 90) })));
  assert.deepEqual(st.moves, []);
  assert.equal(st.holds.length, 1);
});

test("size changes are measured too, and too few frames give nothing", () => {
  const st = analyzeMotion(series(30, 1, (t) => ({ w: 0.1 + 0.2 * t, h: 0.1 })));
  const w = st.moves.find((m) => m.channel === "width")!;
  assert.ok(w && w.change > 0.15);
  assert.deepEqual(analyzeMotion([stat(0, 0.1)]).moves, []);
});

test("movement in two directions at once is reported on both axes", () => {
  const st = analyzeMotion(series(30, 1.5, (t) => ({ cx: 0.1 + 0.6 * Math.min(1, t / 1.5), cy: 0.2 + 0.5 * Math.min(1, t / 1.5) })));
  assert.deepEqual([...new Set(st.moves.map((m) => m.channel))].sort(), ["x", "y"]);
});

// ---------------------------------------------------------------- idle: small steady swings

const swing = (period: number, amplitude: number, centre = 0.5) => (t: number): number => centre - amplitude * Math.cos((2 * Math.PI * t) / period);

test("a steady small swing is reported with its amplitude and period, and a still clip has none", () => {
  const st = analyzeMotion(series(30, 9, (t) => ({ h: swing(3, 0.01, 0.5)(t) })));
  assert.deepEqual(st.moves, []);
  assert.equal(st.idle.length, 1);
  const i = st.idle[0]!;
  assert.equal(i.channel, "height");
  assert.ok(Math.abs(i.period - 3) < 0.1, `period ${i.period}`);
  assert.ok(Math.abs(i.amplitude - 0.01) < 0.0015, `amplitude ${i.amplitude}`);
  assert.deepEqual(analyzeMotion(series(30, 9, () => ({}))).idle, []);
});

test("an idle swing survives values rounded to pixel steps", () => {
  const step = 1 / 256;
  const st = analyzeMotion(series(30, 9, (t) => ({ w: Math.round(swing(3, 0.008, 0.5)(t) / step) * step })));
  const w = st.idle.find((i) => i.channel === "width")!;
  assert.ok(w, JSON.stringify(st.idle));
  assert.ok(Math.abs(w.period - 3) < 0.3, `period ${w.period}`);
});

test("swings under the lower threshold are edge noise, and swings over the upper one are moves", () => {
  assert.equal(IDLE_MIN, 0.004);
  assert.equal(IDLE_MAX, 0.03);
  assert.deepEqual(analyzeMotion(series(30, 9, (t) => ({ cy: swing(3, 0.0015)(t) }))).idle, []);
  const big = analyzeMotion(series(30, 9, (t) => ({ cy: swing(3, 0.04)(t) })));
  assert.deepEqual(big.idle, []);
  assert.ok(big.moves.length > 0);
});

test("a random flicker of a few pixels is not an idle, because its cycles are not regular", () => {
  let seed = 7;
  const rand = (): number => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const st = analyzeMotion(series(30, 9, () => ({ w: 0.1 + Math.round(rand() * 2) / 256 })));
  assert.deepEqual(st.idle, []);
});

test("idle is measured outside the moves of its own channel", () => {
  // x slides from 0.2 to 0.7 in the first second, then rests; y breathes the whole time.
  const st = analyzeMotion(series(30, 9, (t) => ({ cx: 0.2 + 0.5 * Math.min(1, t), cy: swing(3, 0.01)(t) })));
  assert.ok(st.moves.some((m) => m.channel === "x"));
  assert.deepEqual(st.idle.map((i) => i.channel), ["y"]);
  const onX = findIdle(series(30, 9, (t) => ({ cx: 0.5 + swing(3, 0.01, 0)(t) })), []);
  assert.deepEqual(onX.map((i) => i.channel), ["x"]);
});

// ---------------------------------------------------------------- sample

test("parsePoint reads two whole numbers and nothing else", () => {
  assert.deepEqual(parsePoint("12,34"), { x: 12, y: 34 });
  assert.deepEqual(parsePoint(" 5 , 6 "), { x: 5, y: 6 });
  for (const bad of ["", "1", "1,2,3", "-1,2", "1.5,2", "a,b"]) assert.equal(parsePoint(bad), undefined, bad);
});

test("sampleColours averages a 3 by 3 block, uses what is there at an edge, and reports opacity", () => {
  const w = 5, h = 5;
  const px = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) px.set([100, 150, 200, 255], i * 4);
  // One bright pixel inside the block around (2,2): the mean moves by a ninth.
  px.set([255, 255, 255, 255], (2 * w + 2) * 4);
  const [a, corner] = sampleColours(px, w, h, [{ x: 1, y: 1 }, { x: 4, y: 4 }]);
  assert.equal(a!.hex, "#" + [100 + 155 / 9, 150 + 105 / 9, 200 + 55 / 9].map((v) => Math.round(v).toString(16).padStart(2, "0")).join(""));
  assert.equal(corner!.hex, "#6496c8");
  assert.equal(a!.alpha, undefined);
  const clear = new Uint8Array(4 * 4).fill(0);
  assert.equal(sampleColours(clear, 2, 2, [{ x: 0, y: 0 }])[0]!.alpha, 0);
});

// ---------------------------------------------------------------- clips made by Gertie

const root = join(import.meta.dirname, "../..");
const cli = join(root, "src/cli/gertie.ts");
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"] });
const doctor = (() => {
  try {
    return JSON.parse(run("doctor", "--json").stdout) as { browser?: { ok?: boolean }; ffmpeg?: { ok?: boolean } };
  } catch {
    return {};
  }
})();
const haveTools = doctor.browser?.ok === true && doctor.ffmpeg?.ok === true;

/** The `breathe` preset repeats every 3 seconds. The clip is a circle on a plain background, 9 seconds, 3 cycles. */
const BREATHE_SECONDS = 3;
const SUBJECT_CROP = "100,100,280,280";

/** Exporting a 9 second clip takes a while, so each fixture is exported once for all the tests below. */
const clipDir = haveTools ? mkdtempSync(join(tmpdir(), "gertie-study-")) : "";
after(() => {
  if (clipDir) rmSync(clipDir, { recursive: true, force: true });
});
const clip = (name: string): string => {
  const file = join(clipDir, `${name}.mp4`);
  if (!existsSync(file)) {
    const r = run("export", join(root, `tests/fixtures/study/${name}.gertie.json`), "--to", "mp4", "--scale", "1", "--out", clipDir, "--json");
    assert.equal(r.status, 0, r.stdout + r.stderr);
  }
  return file;
};

test("study --crop --rate source on a Gertie clip of a circle with breathe reports an idle period within 10 percent of the preset", { skip: !haveTools }, () => {
  const study = (file: string) => {
    const r = run("study", file, "--crop", SUBJECT_CROP, "--rate", "source", "--background", "border", "--out", join(clipDir, "sheet.png"), "--json");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    return JSON.parse(r.stdout) as { analysis: { fps: number; crop: unknown; rate: string }; idle: { channel: string; period: number; amplitude: number }[]; moves: unknown[]; outputs: { sheet: string } };
  };

  const out = study(clip("breathe-circle"));
  assert.equal(out.analysis.fps, 30);
  assert.equal(out.analysis.rate, "source");
  assert.deepEqual(out.analysis.crop, { x: 100, y: 100, w: 280, h: 280 });
  assert.ok(out.idle.length >= 2, JSON.stringify(out.idle));
  for (const i of out.idle) {
    assert.ok(Math.abs(i.period - BREATHE_SECONDS) / BREATHE_SECONDS <= 0.1, `${i.channel} period ${i.period}`);
    assert.ok(i.amplitude >= IDLE_MIN / 2 && i.amplitude < IDLE_MAX / 2, `${i.channel} amplitude ${i.amplitude}`);
  }
  assert.ok(existsSync(out.outputs.sheet));

  // A clip that moves and then holds still has moves and no idle.
  const still = study(clip("slide-then-hold"));
  assert.ok(still.moves.length > 0);
  assert.deepEqual(still.idle, []);
});

test("study --crop outside the frame, and a bad --crop or --rate, are E-USAGE", { skip: !haveTools }, () => {
  const file = clip("breathe-circle");
  for (const crop of ["300,300,300,300", "-1,0,100,100", "0,0,100", "0,0,4,4", "a,b,c,d"]) {
    const r = run("study", file, "--crop", crop, "--json");
    assert.equal(r.status, 2, crop);
    assert.equal(JSON.parse(r.stdout).diagnostics[0].code, "E-USAGE");
  }
  assert.equal(run("study", file, "--rate", "fast", "--json").status, 2);
});

test("sample prints the colour at each point of a clip frame, and refuses a point outside it", { skip: !haveTools }, () => {
  const file = clip("breathe-circle");
  const r = run("sample", file, "--at", "240,240", "--at", "5,5", "--time", "1.5", "--json");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const out = JSON.parse(r.stdout) as { samples: { x: number; y: number; hex: string }[]; time: number; size: { w: number; h: number } };
  assert.deepEqual(out.size, { w: 480, h: 480 });
  assert.equal(out.time, 1.5);
  const near = (hex: string, want: [number, number, number]): boolean => [1, 3, 5].every((k, i) => Math.abs(parseInt(hex.slice(k, k + 2), 16) - want[i]!) <= 6);
  assert.ok(near(out.samples[0]!.hex, [0xf5, 0x9e, 0x0b]), out.samples[0]!.hex);
  assert.ok(near(out.samples[1]!.hex, [0x0f, 0x17, 0x2a]), out.samples[1]!.hex);
  for (const args of [["--at", "480,0"], ["--at", "1,1", "--time", "100"], []]) {
    const bad = run("sample", file, ...args, "--json");
    assert.equal(bad.status, 2, args.join(" "));
    assert.equal(JSON.parse(bad.stdout).diagnostics[0].code, "E-USAGE");
  }
});
