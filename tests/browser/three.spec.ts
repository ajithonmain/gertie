import { expect, test } from "@playwright/test";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { examplesDir, root } from "./helpers.ts";

const cli = join(root, "skills/gertie/scripts/gertie.mjs");
const run = (...args: string[]) => spawnSync(process.execPath, [cli, "three", ...args], { encoding: "utf8" });

test("3D validation rejects a spin that would jump at the loop seam", ({}, info) => {
  const input = info.outputPath("invalid.three.json");
  writeFileSync(input, JSON.stringify({ objects: [{ shape: "box", spin: [0, 0.5, 0] }] }));
  const result = run("validate", input, "--json");
  expect(result.status, result.stderr).toBe(1);
  expect(JSON.parse(result.stdout).diagnostics).toEqual([
    expect.objectContaining({ code: "E-THREE", message: expect.stringContaining("/objects/0/spin/1") }),
  ]);
});

test("the standalone 3D player animates offline and honors reduced motion", async ({ page, context }, info) => {
  const output = info.outputPath("turntable.html");
  const result = run("build", join(examplesDir, "three-turntable.three.json"), "--out", output, "--json");
  expect(result.status, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout).outputs.html).toBe(output);

  await context.setOffline(true);
  await page.emulateMedia({ reducedMotion: "reduce" });
  const errors: Error[] = [];
  page.on("pageerror", (error) => errors.push(error));
  await page.goto(pathToFileURL(output).href);

  const canvas = page.locator("canvas");
  const play = page.getByRole("button", { name: "Play", exact: true });
  const pause = page.getByRole("button", { name: "Pause", exact: true });
  await expect(play).toBeVisible();
  const firstFrame = await canvas.screenshot();
  expect(firstFrame.length).toBeGreaterThan(10_000);
  expect(await canvas.screenshot()).toEqual(firstFrame);

  await play.click();
  await expect(pause).toBeVisible();
  await expect.poll(async () => (await canvas.screenshot()).equals(firstFrame)).toBe(false);
  await pause.click();
  await expect(play).toBeVisible();
  const pausedFrame = await canvas.screenshot();
  expect(await canvas.screenshot()).toEqual(pausedFrame);
  expect(errors).toEqual([]);
});
