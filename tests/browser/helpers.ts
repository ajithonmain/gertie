import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join } from "node:path";
import { imagesFor } from "../images.ts";
import { launchBrowser, type PwBrowser } from "../../src/render/browser.ts";
import { openLottie } from "../../src/render/lottie.ts";
import { openSvg } from "../../src/render/svg.ts";
import { compileSceneText, type CompileOptions } from "../../src/compile.ts";
import type { NScene } from "../../src/spec/types.ts";
import type { Json } from "../../src/emit-lottie/index.ts";

export const root = join(import.meta.dirname, "../..");
export const examplesDir = join(root, "examples");
export const brokenRenderDir = join(examplesDir, "broken-render");

export interface Compiled {
  name: string;
  scene: NScene;
  lottie: { [key: string]: Json } & { w: number; h: number; op: number };
  svg: string;
  baked: string[];
}

export function corpus(): string[] {
  return readdirSync(examplesDir)
    .filter((f) => f.endsWith(".gertie.json"))
    .map((f) => f.replace(".gertie.json", ""))
    .sort();
}

/** The benchmark corpus of `docs/17-quality-tuning.md`, section 7. */
export const benchmarkDir = join(examplesDir, "benchmark");

export function benchmark(): string[] {
  return readdirSync(benchmarkDir)
    .filter((f) => f.endsWith(".gertie.json"))
    .map((f) => f.replace(".gertie.json", ""))
    .sort();
}

export function compileExample(dir: string, name: string, opts: CompileOptions = {}): Compiled {
  const text = readFileSync(join(dir, `${name}.gertie.json`), "utf8");
  const images = imagesFor(dir, text);
  const r = compileSceneText(text, { fileExists: (s) => existsSync(join(dir, s)), images, ...opts });
  if (!r.scene || !r.lottie || !r.svg || r.diagnostics.some((d) => d.severity === "error")) throw new Error(`${name} did not compile: ${JSON.stringify(r.diagnostics)}`);
  return { name, scene: r.scene, lottie: r.lottie as Compiled["lottie"], svg: r.svg.svg, baked: r.svg.baked };
}

export interface FrameDiff {
  frame: number;
  fraction: number;
}

/** Renders the Lottie and the SVG at the given frames and returns the share of differing pixels per frame. */
export async function parityScan(browser: PwBrowser, c: Compiled, frames: readonly number[]): Promise<FrameDiff[]> {
  const L = await openLottie(c.lottie, { browser });
  const S = await openSvg(c.svg, { w: c.scene.w, h: c.scene.h, fps: c.scene.fps }, { browser });
  try {
    const out: FrameDiff[] = [];
    for (const frame of frames) {
      const a = await L.renderFrame(frame);
      const b = await S.renderFrame(frame);
      const r = await L.analyze([a, b], [[0, 1]], [0, 0, 0, 0], 12, true);
      out.push({ frame, fraction: (r.diffs[0] as { fraction: number }).fraction });
    }
    return out;
  } finally {
    await S.close();
    await L.close();
  }
}

const TYPES: Record<string, string> = { ".js": "text/javascript", ".html": "text/html", ".wasm": "application/wasm", ".json": "application/json" };

/** Serves the repository over HTTP. dotlottie-web needs this to fetch its WebAssembly file. */
export async function serveRepo(): Promise<{ server: Server; origin: string }> {
  const server = createServer((req, res) => {
    const p = join(root, decodeURIComponent((req.url ?? "/").split("?")[0] as string));
    if (!p.startsWith(root) || !existsSync(p)) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { "content-type": TYPES[extname(p)] ?? "application/octet-stream" }).end(readFileSync(p));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { server, origin: `http://127.0.0.1:${port}` };
}

export { launchBrowser };
