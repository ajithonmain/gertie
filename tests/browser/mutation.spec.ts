import { test, expect } from "@playwright/test";
import { compileExample, corpus, examplesDir, launchBrowser, parityScan } from "./helpers.ts";
import type { PwBrowser } from "../../src/render/browser.ts";
import { PARITY_LIMIT, keyFrames } from "../../src/qa/run.ts";
import { sampleFrames } from "../../src/qa/sampling.ts";
import { FAULTS } from "../../src/spec/fault.ts";

// To prove the parity check has teeth, each deliberate fault must make it fail on some corpus example.
let browser: PwBrowser;
test.beforeAll(async () => {
  browser = (await launchBrowser()).browser;
});
test.afterAll(async () => {
  await browser?.close();
});

for (const fault of FAULTS) {
  test(`mutation ${fault} is caught by the parity check`, async () => {
    // Each fault scans the whole corpus, which grows with every phase.
    test.setTimeout(900_000);
    const caught: string[] = [];
    for (const name of corpus()) {
      const c = compileExample(examplesDir, name, { fault });
      const frames = sampleFrames(c.scene.totalFrames, keyFrames(c.scene));
      if ((await parityScan(browser, c, frames)).some((d) => d.fraction > PARITY_LIMIT)) caught.push(name);
    }
    expect(caught.length, `examples where ${fault} made parity fail`).toBeGreaterThan(0);
  });
}

test("with no fault the same scan passes, so the mutations are the cause", async () => {
  test.setTimeout(900_000);
  for (const name of corpus()) {
    const c = compileExample(examplesDir, name);
    const frames = sampleFrames(c.scene.totalFrames, keyFrames(c.scene));
    expect((await parityScan(browser, c, frames)).filter((d) => d.fraction > PARITY_LIMIT)).toEqual([]);
  }
});
