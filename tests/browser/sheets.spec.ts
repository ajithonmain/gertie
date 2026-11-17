import { test, expect } from "@playwright/test";
import { compileExample, corpus, examplesDir } from "./helpers.ts";
import { renderChecks } from "../../src/qa/run.ts";

// Visual regression: contact sheets are stored per platform. Update with
// `npx playwright test --config tests/browser/playwright.config.ts --update-snapshots`.
// Baselines exist only for darwin so far. Generate Linux baselines on a CI runner before enabling this there.
test.skip(process.platform !== "darwin", "contact sheet baselines are stored for darwin only");

for (const name of corpus()) {
  test(`contact sheet for ${name} is unchanged`, async () => {
    const c = compileExample(examplesDir, name);
    const out = await renderChecks(c.scene, c.lottie);
    expect(out.sheet).toBeDefined();
    expect(out.sheet as Buffer).toMatchSnapshot(`${name}.sheet.png`);
  });
}
