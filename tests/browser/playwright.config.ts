import { defineConfig, type PlaywrightTestConfig } from "@playwright/test";

// Playwright's own Chromium is optional. By default an installed Google Chrome is used;
// set GERTIE_PW_CHANNEL="" and run `npx playwright install chromium` to use the bundled one.
const channel = process.env["GERTIE_PW_CHANNEL"] ?? "chrome";

// Chromium runs every spec. Firefox and WebKit run only the cross-browser SVG spec.
// Enable them with: GERTIE_BROWSERS=chromium,firefox,webkit npx playwright install firefox webkit
const wanted = (process.env["GERTIE_BROWSERS"] ?? "chromium").split(",").map((s) => s.trim());

const projects: NonNullable<PlaywrightTestConfig["projects"]> = wanted.map((name) =>
  name === "chromium" ? { name, use: channel ? { channel } : {} } : { name, testMatch: "**/{svg,ascii}.spec.ts", use: { browserName: name as "firefox" | "webkit" } },
);

export default defineConfig({
  testDir: ".",
  testMatch: "**/*.spec.ts",
  reporter: "list",
  timeout: 90_000,
  workers: 2,
  projects,
  // Keep snapshot names independent of the project name, so they stay valid when more browsers are enabled.
  snapshotPathTemplate: "{testDir}/{testFileDir}/{testFileName}-snapshots/{arg}{-snapshotSuffix}{ext}",
  expect: { toMatchSnapshot: { maxDiffPixelRatio: 0.02 } },
});
