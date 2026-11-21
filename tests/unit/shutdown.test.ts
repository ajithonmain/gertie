import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { processLimitMs, shutdown, syncLimit, timedOut, timeoutMessage, trackChild } from "../../src/shutdown.ts";
import { ffmpegInfo, runFfmpeg } from "../../src/export/ffmpeg.ts";

function withScale<T>(scale: string | undefined, fn: () => T): T {
  const before = process.env["GERTIE_TIMEOUT_SCALE"];
  if (scale === undefined) delete process.env["GERTIE_TIMEOUT_SCALE"];
  else process.env["GERTIE_TIMEOUT_SCALE"] = scale;
  try {
    return fn();
  } finally {
    if (before === undefined) delete process.env["GERTIE_TIMEOUT_SCALE"];
    else process.env["GERTIE_TIMEOUT_SCALE"] = before;
  }
}

test("process limits have sane defaults and scale with GERTIE_TIMEOUT_SCALE", () => {
  withScale(undefined, () => {
    assert.equal(processLimitMs("quick"), 60_000);
    assert.equal(processLimitMs("render"), 3_600_000);
  });
  withScale("4", () => assert.equal(processLimitMs("decode"), 1_200_000));
  withScale("nonsense", () => assert.equal(processLimitMs("quick"), 60_000));
  withScale("-2", () => assert.equal(processLimitMs("quick"), 60_000));
});

test("a blocking child that runs past its limit is killed and reported as timed out", { skip: process.platform === "win32" }, () => {
  const started = Date.now();
  const r = withScale("0.005", () => spawnSync("sleep", ["30"], syncLimit("quick")));
  assert.ok(timedOut(r), "spawnSync should report ETIMEDOUT");
  assert.ok(Date.now() - started < 10_000, "the child should be killed at the limit, not after 30 s");
  assert.match(timeoutMessage("sleep", "quick"), /GERTIE_TIMEOUT_SCALE/);
});

test("an ffmpeg encode that runs past its limit is killed and rejects with the fix", { skip: ffmpegInfo() === null }, async () => {
  process.env["GERTIE_TIMEOUT_SCALE"] = "0.0001";
  try {
    // An endless test source: without the limit this would never finish.
    await assert.rejects(runFfmpeg(["-f", "lavfi", "-i", "testsrc", "-f", "null", "-"]), /stopped after .* GERTIE_TIMEOUT_SCALE/s);
  } finally {
    delete process.env["GERTIE_TIMEOUT_SCALE"];
  }
});

test("shutdown kills tracked children that are still running", { skip: process.platform === "win32" }, async () => {
  const child = trackChild(spawn("sleep", ["30"], { stdio: "ignore" }));
  const exited = new Promise<NodeJS.Signals | null>((resolve) => child.once("exit", (_code, signal) => resolve(signal)));
  await shutdown();
  assert.equal(await exited, "SIGKILL");
});
