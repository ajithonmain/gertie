import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve as resolveThreePath } from "node:path";
import { fileURLToPath } from "node:url";
import { parseThreeScene } from "../../three/scene.ts";
import type { Args } from "./args.ts";
import { makeDiagnostic, report } from "../../spec/diagnostics.ts";
import type { Outcome } from "./commands.ts";

export function threeCommand(args: Args): Outcome {
  const [action, input] = args.positional;
  const output = args.flags.get("out");
  if (!input || args.positional.length !== 2 || !["validate", "build"].includes(action ?? "")
    || output === true || (action === "validate" && output !== undefined)
    || [...args.flags.keys()].some((flag) => flag !== "out" && flag !== "json")) {
    return { code: 2, message: "Usage: gertie three validate <scene> [--json] or gertie three build <scene> [--out animation.html] [--json]" };
  }

  try {
    const scene = parseThreeScene(readFileSync(input, "utf8"));
    for (const spec of scene.objects) {
      if (spec.shape !== "relief") continue;
      for (const field of ["image", "depthMap"] as const) {
        const path = resolveThreePath(dirname(input), spec[field]!);
        const png = readFileSync(path);
        if (png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") throw new Error(`${path} must be a PNG file`);
        if (action === "build") spec[field] = `data:image/png;base64,${png.toString("base64")}`;
      }
    }
    if (action === "validate") return { code: 0, lines: ["3D scene is valid."], full: { valid: true } };
    const destination = resolveThreePath(output ?? resolveThreePath(dirname(input), "out", basename(input).replace(/(?:\.three)?\.json$/i, "") + ".html"));
    if (!destination.toLowerCase().endsWith(".html")) throw new Error("--out must end in .html");
    if (existsSync(destination) && realpathSync(destination) === realpathSync(input)) {
      throw new Error("Output would overwrite the input scene");
    }
    const adjacent = new URL("../assets/three-player.js", import.meta.url);
    const sourceTree = new URL("../../../skills/gertie/assets/three-player.js", import.meta.url);
    const player = readFileSync(existsSync(fileURLToPath(adjacent)) ? adjacent : sourceTree, "utf8");
    const html = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Gertie 3D animation</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #111; color: white; font-family: system-ui, sans-serif; }
  main { max-width: 100%; text-align: center; }
  canvas { display: block; max-width: 100%; max-height: calc(100vh - 3rem); width: auto; height: auto; }
  button { margin: 0.75rem; padding: 0.4rem 1rem; }
</style>
<main>
  <canvas role="img" aria-label="3D animation"></canvas>
  <button type="button" hidden>Play</button>
  <p id="status" role="status">Loading 3D animation…</p>
</main>
<script id="scene" type="application/json">${JSON.stringify(scene).replaceAll("<", "\\u003c")}</script>
<script>${player.replace(/<\/script/gi, "<\\/script")}</script>
</html>
`;
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, html);
    return { code: 0, lines: [`wrote ${destination}`], full: { valid: true, outputs: { html: destination } } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 1, report: report([makeDiagnostic("E-THREE", message, undefined)]) };
  }
}
