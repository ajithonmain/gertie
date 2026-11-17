import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { compileSceneValue } from "../../src/compile.ts";
import { importSvg } from "../../src/import/svg.ts";
import { openSvg } from "../../src/render/svg.ts";
import { launchBrowser, type PwBrowser } from "../../src/render/browser.ts";
import { PARITY_LIMIT } from "../../src/qa/run.ts";
import { root } from "./helpers.ts";

// Acceptance for SVG import: the imported scene must look like the original SVG.
// Both are drawn by the same browser, then compared pixel by pixel with the same threshold as the Lottie and SVG parity check.
const dirs = [join(root, "examples/import/third-party"), join(root, "tests/fixtures/import")];

let browser: PwBrowser;
test.beforeAll(async () => {
  browser = (await launchBrowser()).browser;
});
test.afterAll(async () => {
  await browser?.close();
});

const files = dirs.flatMap((d) => {
  try {
    return readdirSync(d).filter((f) => f.endsWith(".svg")).map((f) => join(d, f));
  } catch {
    return [];
  }
});

for (const file of files) {
  const name = file.split("/").pop() as string;
  test(`import of ${name} matches the original within the parity limit`, async () => {
    const text = readFileSync(file, "utf8");
    const r = importSvg(text, name);
    const { w, h } = r.fragment.canvas;
    const compiled = compileSceneValue({ gertie: 1, name: "imported", canvas: r.fragment.canvas, duration: 1, loop: false, nodes: r.fragment.nodes });
    expect(compiled.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    const svg = (compiled.svg as { svg: string }).svg;

    // The original is wrapped so it is drawn at the canvas size on a transparent background, like the imported scene.
    const original = text.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => `<svg${attrs.replace(/\s(width|height)="[^"]*"/g, "")} width="${w}" height="${h}">`);
    const a = await openSvg(original, { w, h, fps: 30 }, { browser });
    const b = await openSvg(svg, { w, h, fps: 30 }, { browser });
    try {
      const pa = await a.renderFrame(0);
      const pb = await b.renderFrame(0);
      const d = await a.analyze([pa, pb], [[0, 1]], [0, 0, 0, 0], 12, true);
      const fraction = (d.diffs[0] as { fraction: number }).fraction;
      test.info().annotations.push({ type: "differing pixels", description: `${(fraction * 100).toFixed(3)}%` });
      if (fraction > PARITY_LIMIT || process.env["GERTIE_IMPORT_DIFF"]) {
        const dir = join(root, "test-results/import-diff");
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, `${name}.original.png`), pa);
        writeFileSync(join(dir, `${name}.imported.png`), pb);
        writeFileSync(join(dir, `${name}.diff.png`), await a.diffImage(pa, pb, 12));
      }
      expect(fraction, `share of differing pixels (limit ${PARITY_LIMIT})`).toBeLessThanOrEqual(PARITY_LIMIT);
    } finally {
      await a.close();
      await b.close();
    }
  });
}
