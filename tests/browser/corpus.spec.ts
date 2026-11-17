import { test, expect } from "@playwright/test";
import { brokenRenderDir, compileExample, corpus, examplesDir } from "./helpers.ts";
import { renderChecks } from "../../src/qa/run.ts";

for (const name of corpus()) {
  test(`qa: ${name} renders with no errors and no warnings`, async () => {
    // A 6 second scene at 1024 pixels (potted-plant) takes about 90 seconds, which is the default limit.
    test.setTimeout(240_000);
    const c = compileExample(examplesDir, name);
    const out = await renderChecks(c.scene, c.lottie, { svg: c.svg });
    expect(out.rendered).toBe(true);
    expect(out.diagnostics).toEqual([]);
    expect(out.sheet?.length ?? 0).toBeGreaterThan(1000);
  });
}

// Deliberately broken renders: each must be caught by exactly its check.
const broken: [string, string, boolean][] = [
  ["e-r-blank", "E-R-BLANK", false],
  ["e-r-static", "E-R-STATIC", false],
  ["w-r-loop", "W-R-LOOP", false],
  ["w-r-clipped", "W-R-CLIPPED", false],
  ["w-r-empty-frames", "W-R-EMPTY-FRAMES", false],
  ["w-r-flicker", "W-R-FLICKER", true],
];
for (const [name, code, thorough] of broken) {
  test(`qa catches ${name} with ${code}`, async () => {
    const c = compileExample(brokenRenderDir, name);
    const out = await renderChecks(c.scene, c.lottie, { thorough, svg: c.svg });
    expect(out.diagnostics.map((d) => d.code)).toEqual([code]);
  });
}

test("the flicker check does not run without --thorough", async () => {
  const c = compileExample(brokenRenderDir, "w-r-flicker");
  const out = await renderChecks(c.scene, c.lottie, { thorough: false, svg: c.svg });
  expect(out.diagnostics).toEqual([]);
});

test("a very short loop-closing frame matches frame 0 (loop check is exact)", async () => {
  const c = compileExample(examplesDir, "spinner-ring");
  const out = await renderChecks(c.scene, c.lottie, { thorough: true, svg: c.svg });
  expect(out.diagnostics.map((d) => d.code)).not.toContain("W-R-LOOP");
});
