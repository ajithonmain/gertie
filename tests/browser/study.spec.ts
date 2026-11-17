import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root } from "./helpers.ts";

// Phase 6, step 4: the motion reference. The clip is made from a scene whose keyframes are known, so the measurements can be checked.
const bundle = join(root, "skills/gertie/scripts/gertie.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [bundle, ...args], { encoding: "utf8", cwd: root });
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;
test.skip(!ffmpeg, "ffmpeg is not installed");

const scene = join(root, "tests/fixtures/study/ball-reference.gertie.json");

for (const format of ["mp4", "gif"] as const) {
  test(`study of a ${format} of a bouncing ball finds the hold, the falls and the rises at the right times`, () => {
    const dir = mkdtempSync(join(tmpdir(), "gertie-study-"));
    try {
      const ex = run("export", scene, "--to", format, "--scale", "1", "--out", dir, "--json");
      expect(ex.status, ex.stdout + ex.stderr).toBe(0);
      const clip = join(dir, `ball-reference.${format}`);
      const r = run("study", clip, "--out", join(dir, "sheet.png"), "--json");
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const s = JSON.parse(r.stdout);
      expect(s.source).toMatchObject({ width: 480, height: 270 });
      expect(existsSync(s.outputs.sheet)).toBe(true);
      expect(statSync(s.outputs.sheet).size).toBeGreaterThan(5000);
      // The ball waits for 0.4 seconds.
      expect(s.holds[0].from).toBeLessThanOrEqual(0.05);
      expect(Math.abs(s.holds[0].to - 0.4)).toBeLessThanOrEqual(0.1);
      // Vertical moves: down to 1.0, up to 1.4, down to 1.75, up to 2.0 (the scene's keyframes), within a tenth of a second.
      const ys = s.moves.filter((m: { channel: string }) => m.channel === "y");
      const ends = [1.0, 1.4, 1.75, 2.0];
      for (const t of ends) expect(ys.some((m: { to: number }) => Math.abs(m.to - t) <= 0.1), `a vertical move ends near ${t}: ${ys.map((m: { to: number }) => m.to).join(", ")}`).toBe(true);
      const first = ys.find((m: { to: number }) => Math.abs(m.to - 1.0) <= 0.1);
      expect(first.change).toBeGreaterThan(0.4);
      expect(first.ease).toBe("starts slow");
      const rise = ys.find((m: { to: number }) => Math.abs(m.to - 1.4) <= 0.1);
      expect(rise.change).toBeLessThan(-0.15);
      expect(rise.ease).toBe("starts fast");
      // It travels three quarters of the way across the frame.
      const x = s.moves.find((m: { channel: string }) => m.channel === "x");
      expect(Math.abs(x.change - 0.75)).toBeLessThan(0.08);
      expect(s.loopGap).toBeGreaterThan(0.01);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("study prints a readable description, and refuses what it cannot read", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-study-"));
  try {
    expect(run("export", scene, "--to", "mp4", "--out", dir).status).toBe(0);
    const r = run("study", join(dir, "ball-reference.mp4"), "--out", join(dir, "s.png"));
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/holds \(nothing moves\): 0\.00 s to 0\.4\d s/);
    expect(r.stdout).toMatch(/y: .*moves down by \d+% of the frame height, starts slow/);
    expect(r.stdout).toMatch(/does not loop exactly/);
    writeFileSync(join(dir, "x.mp4"), "not a video");
    expect(run("study", join(dir, "x.mp4")).status).toBe(2);
    expect(run("study", join(dir, "missing.mp4")).status).toBe(2);
    expect(run("study", join(dir, "ball-reference.mp4"), "--fps", "0").status).toBe(2);
    expect(run("study", join(dir, "ball-reference.mp4"), "--background", "sky").status).toBe(2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
