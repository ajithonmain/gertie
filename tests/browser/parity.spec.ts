import { test, expect } from "@playwright/test";
import { benchmark, benchmarkDir, compileExample, corpus, examplesDir, launchBrowser, parityScan } from "./helpers.ts";
import type { PwBrowser } from "../../src/render/browser.ts";
import { PARITY_LIMIT } from "../../src/qa/run.ts";

// The main acceptance test for both emitters: the Lottie render and the SVG render of every frame agree.
let browser: PwBrowser;
test.beforeAll(async () => {
  browser = (await launchBrowser()).browser;
});
test.afterAll(async () => {
  await browser?.close();
});

for (const name of corpus()) {
  test(`parity on every frame: ${name}`, async () => {
    test.setTimeout(300_000);
    const c = compileExample(examplesDir, name);
    const frames = Array.from({ length: c.scene.totalFrames }, (_, i) => i);
    const bad = (await parityScan(browser, c, frames)).filter((d) => d.fraction > PARITY_LIMIT);
    expect(bad, `frames over ${PARITY_LIMIT * 100}%`).toEqual([]);
  });
}

// The benchmark corpus: full illustrations of up to 240 frames at 1080 pixels, so each scan takes minutes.
for (const name of benchmark()) {
  test(`parity on every frame: benchmark ${name}`, async () => {
    test.setTimeout(1_200_000);
    const c = compileExample(benchmarkDir, name);
    const frames = Array.from({ length: c.scene.totalFrames }, (_, i) => i);
    const bad = (await parityScan(browser, c, frames)).filter((d) => d.fraction > PARITY_LIMIT);
    expect(bad, `frames over ${PARITY_LIMIT * 100}%`).toEqual([]);
  });
}
