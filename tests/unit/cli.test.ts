import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = join(import.meta.dirname, "../..");
const cli = join(root, "src/cli/gertie.ts");
const run = (...args: string[]) => spawnSync(process.execPath, ["--import", "tsx", cli, ...args], { encoding: "utf8", cwd: root });

test("--version prints a version", () => {
  const r = run("--version");
  assert.equal(r.status, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+/);
});

test("compile writes out/<name>.lottie.json next to the scene and exits 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    const scene = join(dir, "dots.gertie.json");
    writeFileSync(scene, readFileSync(join(root, "examples/bouncing-dots.gertie.json")));
    const r = run("compile", scene, "--json");
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.ok(existsSync(join(dir, "out", "bouncing-dots.lottie.json")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compile with errors exits 1 and prints one JSON object", () => {
  const r = run("compile", join(root, "examples/broken/e-fps.gertie.json"), "--json", "--out", join(tmpdir(), "gertie-unused"));
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.diagnostics[0].code, "E-FPS");
});

test("a missing file exits 2", () => {
  assert.equal(run("compile", "nope.gertie.json").status, 2);
  assert.equal(run("validate").status, 2);
  assert.equal(run("bogus").status, 2);
});

test("validate accepts a compiled Lottie file", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    const scene = join(dir, "s.gertie.json");
    writeFileSync(scene, readFileSync(join(root, "examples/spinner-ring.gertie.json")));
    assert.equal(run("compile", scene).status, 0);
    const r = run("validate", join(dir, "out", "spinner-ring.lottie.json"), "--json");
    assert.equal(r.status, 0, r.stdout);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--strict turns warnings into a failure", () => {
  const r = run("validate", join(root, "examples/broken/w-loop-jump.gertie.json"), "--strict", "--json");
  assert.equal(r.status, 1);
  assert.equal(run("validate", join(root, "examples/broken/w-loop-jump.gertie.json")).status, 0);
});

test("compile writes both outputs by default, and only the one asked for with --lottie or --svg", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    const scene = join(dir, "dots.gertie.json");
    writeFileSync(scene, readFileSync(join(root, "examples/bouncing-dots.gertie.json")));
    assert.equal(run("compile", scene).status, 0);
    assert.ok(existsSync(join(dir, "out", "bouncing-dots.lottie.json")));
    assert.ok(existsSync(join(dir, "out", "bouncing-dots.svg")));
    rmSync(join(dir, "out"), { recursive: true });
    assert.equal(run("compile", scene, "--svg").status, 0);
    assert.ok(existsSync(join(dir, "out", "bouncing-dots.svg")));
    assert.ok(!existsSync(join(dir, "out", "bouncing-dots.lottie.json")));
    rmSync(join(dir, "out"), { recursive: true });
    assert.equal(run("compile", scene, "--lottie").status, 0);
    assert.ok(!existsSync(join(dir, "out", "bouncing-dots.svg")));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compile --dotlottie is still rejected as not yet available", () => {
  assert.equal(run("compile", join(root, "examples/bouncing-dots.gertie.json"), "--dotlottie").status, 2);
});

test("doctor reports node, playwright, browser and ffmpeg as one JSON object", () => {
  const r = run("doctor", "--json");
  const out = JSON.parse(r.stdout);
  assert.equal(out.node.ok, true);
  assert.ok("browser" in out && "ffmpeg" in out && "playwright" in out);
});

test("qa without a usable browser runs gates 1 and 2, skips rendering and says how to fix it", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    const r = spawnSync(process.execPath, ["--import", "tsx", cli, "qa", join(root, "examples/spinner-ring.gertie.json"), "--json", "--out", dir], {
      encoding: "utf8",
      cwd: root,
      env: { ...process.env, GERTIE_BROWSER: join(dir, "no-such-browser") },
    });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.render, "skipped");
    assert.equal(out.ok, true);
    assert.ok(out.skipped.fix.length > 0);
    assert.ok(existsSync(join(dir, "spinner-ring.lottie.json")));
    assert.equal(out.profile.tier, null);
    assert.equal(out.profile.bands.length, 3);
    assert.ok(out.profile.profile.animatedProperties > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("qa stops at gate 1 when the scene is invalid and does not render", () => {
  const r = run("qa", join(root, "examples/broken/e-fps.gertie.json"), "--json", "--out", join(tmpdir(), "gertie-unused"));
  assert.equal(r.status, 1);
  const out = JSON.parse(r.stdout);
  assert.equal(out.diagnostics[0].code, "E-FPS");
  assert.equal(out.render, undefined);
});

// ---------------------------------------------------------------- import

const sample = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80"><g id="arm"><rect id="hand" x="10" y="10" width="20" height="40" fill="#ff0000"/></g><circle id="head" cx="60" cy="30" r="15" fill="#00ff00"/><text x="1" y="9">hi</text></svg>`;

test("import writes a fragment, prints a summary as JSON, and reports what it left out", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    const file = join(dir, "robot.svg");
    writeFileSync(file, sample);
    const r = run("import", file, "--no-preview", "--json");
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.ok, true);
    assert.equal(out.summary.canvas.w, 100);
    assert.deepEqual(out.summary.nodes.map((n: { id: string }) => n.id), ["arm", "hand", "head"]);
    assert.ok(out.diagnostics.some((d: { code: string }) => d.code === "W-IMPORT-UNSUPPORTED"));
    const frag = JSON.parse(readFileSync(join(dir, "robot.fragment.json"), "utf8"));
    assert.equal(frag["gertie-fragment"], 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a scene that includes the fragment compiles with the command line, relative to the scene file", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    writeFileSync(join(dir, "robot.svg"), sample);
    assert.equal(run("import", join(dir, "robot.svg"), "--no-preview").status, 0);
    const scene = { gertie: 1, name: "robot", canvas: { w: 100, h: 80 }, duration: 1, loop: true, nodes: [{ id: "character", type: "group", include: "robot.fragment.json", overrides: { arm: { pivot: [20, 10], animate: { rotation: [[0, -10], [0.5, 10, "easeInOut"], [1, -10, "easeInOut"]] } } } }] };
    writeFileSync(join(dir, "robot.gertie.json"), JSON.stringify(scene));
    const r = run("compile", join(dir, "robot.gertie.json"), "--json");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(existsSync(join(dir, "out", "robot.svg")));
    const bad = { ...scene, nodes: [{ ...scene.nodes[0], overrides: { arn: { opacity: 0.5 } } }] };
    writeFileSync(join(dir, "bad.gertie.json"), JSON.stringify(bad));
    const b = run("validate", join(dir, "bad.gertie.json"), "--json");
    assert.equal(b.status, 1);
    assert.equal(JSON.parse(b.stdout).diagnostics[0].code, "E-INCLUDE-OVERRIDE");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("import of a file that is not an SVG exits 1 with E-IMPORT, and a missing file exits 2", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    writeFileSync(join(dir, "x.svg"), "<html><body/></html>");
    const r = run("import", join(dir, "x.svg"), "--no-preview", "--json");
    assert.equal(r.status, 1);
    assert.equal(JSON.parse(r.stdout).diagnostics[0].code, "E-IMPORT");
    assert.equal(run("import", join(dir, "missing.svg")).status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- Lottie tools

const thirdParty = join(root, "node_modules/lottie-web/test/animations/starfish.json");
const haveThird = existsSync(thirdParty);

test("inspect prints a summary as JSON, with validation of a file that is not portable", { skip: !haveThird }, () => {
  const r = run("inspect", thirdParty, "--json");
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.size.w, 800);
  assert.equal(out.frameRate, 60);
  assert.equal(out.validation.portable, false);
  assert.ok(out.features.expressions > 0);
  assert.ok(Array.isArray(out.colors) && out.colors.length > 0);
});

test("recolor writes a new file, reports the replacements and that it added no diagnostics", { skip: !haveThird }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    const top = JSON.parse(run("inspect", thirdParty, "--json").stdout).colors[0].hex as string;
    const out = join(dir, "r.json");
    const r = run("recolor", thirdParty, "--map", `${top}=#ff00ff`, "--out", out, "--no-render", "--json");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const res = JSON.parse(r.stdout);
    assert.equal(res.ok, true);
    assert.ok(res.replaced[0].count > 0);
    assert.equal(res.validation.introduced, 0);
    const colors = JSON.parse(run("inspect", out, "--json").stdout).colors.map((c: { hex: string }) => c.hex);
    assert.ok(colors.includes("#ff00ff") && !colors.includes(top));
    // The input file is untouched.
    assert.equal(JSON.parse(run("inspect", thirdParty, "--json").stdout).colors[0].hex, top);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("recolor says what colours the file has when nothing matched, and refuses a bad map", { skip: !haveThird }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    const out = join(dir, "r.json");
    const r = run("recolor", thirdParty, "--map", "#123456=#654321", "--out", out, "--no-render");
    assert.equal(r.status, 0);
    assert.match(r.stderr, /no match for #123456/);
    const bad = run("recolor", thirdParty, "--map", "red=blue", "--no-render");
    assert.equal(bad.status, 2);
    assert.match(bad.stderr, /not a colour pair/);
    assert.equal(run("recolor", thirdParty, "--no-render").status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retime by speed and by duration, and the usage errors", { skip: !haveThird }, () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    const out = join(dir, "t.json");
    const r = run("retime", thirdParty, "--speed", "2", "--out", out, "--no-render", "--json");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(JSON.parse(r.stdout).validation.introduced, 0);
    assert.ok(Math.abs(JSON.parse(run("inspect", out, "--json").stdout).durationSeconds - 2.5) < 0.1);
    const d = run("retime", thirdParty, "--duration", "1", "--out", out, "--no-render", "--json");
    assert.equal(d.status, 0);
    assert.ok(Math.abs(JSON.parse(run("inspect", out, "--json").stdout).durationSeconds - 1) < 0.05);
    assert.equal(run("retime", thirdParty, "--no-render").status, 2);
    assert.equal(run("retime", thirdParty, "--speed", "2", "--duration", "3", "--no-render").status, 2);
    assert.equal(run("retime", thirdParty, "--speed", "-1", "--no-render").status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- profile

test("profile of a scene compiles it and marks the measures against all three tiers", () => {
  const r = run("profile", join(root, "examples/night-sky.gertie.json"), "--json");
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.tier, null);
  assert.deepEqual(out.bands.map((b: { tier: string }) => b.tier), ["icon", "character", "scene"]);
  assert.equal(out.profile.layers, 2);
  assert.equal(out.profile.animatedProperties, 16);
  assert.equal(out.profile.keyframes, 94);
  const text = run("profile", join(root, "examples/night-sky.gertie.json"));
  assert.equal(text.status, 0);
  assert.match(text.stdout, /icon: \d+ of 12 measures inside the band/);
});

test("profile uses the scene's own tier unless --tier is given", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    const scene = JSON.parse(readFileSync(join(root, "examples/candle.gertie.json"), "utf8"));
    scene.tier = "icon";
    writeFileSync(join(dir, "c.gertie.json"), JSON.stringify(scene));
    const own = JSON.parse(run("profile", join(dir, "c.gertie.json"), "--json").stdout);
    assert.equal(own.tier, "icon");
    assert.deepEqual(own.bands.map((b: { tier: string }) => b.tier), ["icon"]);
    const flag = JSON.parse(run("profile", join(dir, "c.gertie.json"), "--tier", "scene", "--json").stdout);
    assert.equal(flag.tier, "scene");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("profile reads a compiled Lottie file, and validate adds the profile to its JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    writeFileSync(join(dir, "s.gertie.json"), readFileSync(join(root, "examples/candle.gertie.json")));
    assert.equal(run("compile", join(dir, "s.gertie.json"), "--lottie").status, 0);
    const lottie = join(dir, "out", "candle.lottie.json");
    const r = run("profile", lottie, "--tier", "character", "--json");
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.profile.layers, 7);
    assert.equal(out.profile.colours, 6);
    assert.equal(out.profile.keyframes, 92);
    assert.equal(out.bands[0].tier, "character");
    const v = JSON.parse(run("validate", lottie, "--json").stdout);
    assert.equal(v.ok, true);
    assert.equal(v.profile.profile.keyframes, 92);
    const vs = JSON.parse(run("validate", join(dir, "s.gertie.json"), "--json").stdout);
    assert.equal(vs.profile.profile.keyframes, 92);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("profile exits 0 on warnings, 1 when the scene cannot compile, 2 when the file cannot be read or --tier is unknown", () => {
  assert.equal(run("profile", join(root, "examples/broken/w-loop-jump.gertie.json"), "--strict").status, 0);
  assert.equal(run("profile", join(root, "examples/broken/e-fps.gertie.json"), "--json").status, 1);
  assert.equal(run("profile", "missing.json").status, 2);
  assert.equal(run("profile").status, 2);
  const bad = run("profile", join(root, "examples/night-sky.gertie.json"), "--tier", "huge", "--json");
  assert.equal(bad.status, 2);
  assert.match(JSON.parse(bad.stdout).diagnostics[0].message, /icon, character, scene/);
});

test("inspect and the edits refuse a file that is not Lottie, and a missing file", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    writeFileSync(join(dir, "a.json"), JSON.stringify({ hello: 1 }));
    writeFileSync(join(dir, "b.json"), "not json");
    for (const cmd of ["inspect", "recolor", "retime"]) {
      assert.equal(run(cmd, join(dir, "a.json"), "--map", "#000=#fff", "--speed", "2").status, 2, cmd);
      assert.equal(run(cmd, join(dir, "b.json"), "--map", "#000=#fff", "--speed", "2").status, 2, cmd);
      assert.equal(run(cmd, join(dir, "missing.json"), "--map", "#000=#fff", "--speed", "2").status, 2, cmd);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("compile of a scene that places a Lottie file writes the Lottie only, and --svg is an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "gertie-"));
  try {
    writeFileSync(join(dir, "src.gertie.json"), readFileSync(join(root, "examples/spinner-ring.gertie.json")));
    assert.equal(run("compile", join(dir, "src.gertie.json"), "--lottie").status, 0);
    const placed = join(dir, "out", "spinner-ring.lottie.json");
    assert.ok(existsSync(placed));
    const scene = { gertie: 1, name: "placed", canvas: { w: 256, h: 256 }, duration: 1, nodes: [{ id: "spin", type: "lottie", src: "out/spinner-ring.lottie.json" }] };
    writeFileSync(join(dir, "placed.gertie.json"), JSON.stringify(scene));
    const ok = run("compile", join(dir, "placed.gertie.json"), "--json");
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.ok(existsSync(join(dir, "out", "placed.lottie.json")));
    assert.ok(!existsSync(join(dir, "out", "placed.svg")));
    const svg = run("compile", join(dir, "placed.gertie.json"), "--svg", "--json");
    assert.equal(svg.status, 1);
    assert.equal(JSON.parse(svg.stdout).diagnostics[0].code, "E-SVG-LOTTIE");
    writeFileSync(join(dir, "missing.gertie.json"), JSON.stringify({ ...scene, nodes: [{ ...scene.nodes[0], src: "nope.json" }] }));
    assert.equal(JSON.parse(run("validate", join(dir, "missing.gertie.json"), "--json").stdout).diagnostics[0].code, "E-LOTTIE-MISSING");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
