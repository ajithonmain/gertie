import { test, expect } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brokenRenderDir, examplesDir, root } from "./helpers.ts";

// These run the committed bundle, as an agent would: node scripts/gertie.mjs <command>.
const bundle = join(root, "skills/gertie/scripts/gertie.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [bundle, ...args], { encoding: "utf8", cwd: root });

test("gertie qa renders, writes a contact sheet and exits 0", () => {
  const out = mkdtempSync(join(tmpdir(), "gertie-qa-"));
  try {
    const r = run("qa", join(examplesDir, "bouncing-dots.gertie.json"), "--json", "--out", out);
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout);
    expect(report).toMatchObject({ ok: true, render: "ran", errors: 0, warnings: 0, scene: "bouncing-dots", fps: 30, frames: 36 });
    expect(existsSync(report.outputs.sheet)).toBe(true);
    expect(statSync(report.outputs.sheet).size).toBeGreaterThan(5000);
    expect(report.framesRendered).toBeGreaterThanOrEqual(9);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("gertie qa exits 1 with E-R-BLANK for an off-canvas scene", () => {
  const out = mkdtempSync(join(tmpdir(), "gertie-qa-"));
  try {
    const r = run("qa", join(brokenRenderDir, "e-r-blank.gertie.json"), "--json", "--out", out);
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).diagnostics.map((d: { code: string }) => d.code)).toEqual(["E-R-BLANK"]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("gertie qa --thorough renders every frame", () => {
  const out = mkdtempSync(join(tmpdir(), "gertie-qa-"));
  try {
    const r = run("qa", join(examplesDir, "spinner-ring.gertie.json"), "--thorough", "--json", "--out", out);
    expect(r.status, r.stderr).toBe(0);
    const report = JSON.parse(r.stdout);
    // 30 Lottie frames, the frame that closes the loop, and 30 SVG frames.
    expect(report.framesRendered).toBe(61);
    expect(report.parity.frames).toBe(30);
    expect(report.parity.worst).toBeLessThan(0.02);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test("gertie doctor finds a browser", () => {
  const r = run("doctor", "--json");
  expect(JSON.parse(r.stdout).browser.ok).toBe(true);
});

// ---------------------------------------------------------------- Lottie tools, from the bundle

test("gertie render draws a contact sheet of a Lottie file, and recolor and retime render their result", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-lt-"));
  try {
    const src = join(root, "node_modules/lottie-web/test/animations/ripple.json");
    test.skip(!existsSync(src), "lottie-web test animations are not installed");
    const sheet = join(dir, "s.png");
    const r = run("render", src, "--out", sheet, "--json");
    expect(r.status, r.stderr).toBe(0);
    expect(statSync(sheet).size).toBeGreaterThan(5000);

    const out = join(dir, "r.json");
    const top = JSON.parse(run("inspect", src, "--json").stdout).colors[0].hex as string;
    const rc = run("recolor", src, "--map", `${top}=#ff00ff`, "--out", out, "--json");
    expect(rc.status, rc.stdout + rc.stderr).toBe(0);
    expect(JSON.parse(rc.stdout)).toMatchObject({ ok: true, validation: { introduced: 0 }, render: { rendered: true } });

    const rt = run("retime", src, "--speed", "2", "--out", join(dir, "t.json"), "--json");
    expect(rt.status, rt.stdout + rt.stderr).toBe(0);
    expect(JSON.parse(rt.stdout)).toMatchObject({ ok: true, validation: { introduced: 0 }, render: { rendered: true } });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("gertie qa checks a scene that places a Lottie file, without an SVG", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-lt-"));
  try {
    writeFileSync(join(dir, "src.gertie.json"), readFileSync(join(examplesDir, "spinner-ring.gertie.json")));
    expect(run("compile", join(dir, "src.gertie.json"), "--lottie").status).toBe(0);
    const scene = { gertie: 1, name: "placed", canvas: { w: 256, h: 256 }, duration: 1, nodes: [{ id: "spin", type: "lottie", src: "out/spinner-ring.lottie.json" }] };
    writeFileSync(join(dir, "placed.gertie.json"), JSON.stringify(scene));
    const r = run("qa", join(dir, "placed.gertie.json"), "--json");
    expect(r.status, r.stdout + r.stderr).toBe(0);
    const rep = JSON.parse(r.stdout);
    expect(rep).toMatchObject({ ok: true, render: "ran", errors: 0, warnings: 0 });
    expect(rep.outputs.svg).toBeUndefined();
    expect(existsSync(rep.outputs.sheet)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
