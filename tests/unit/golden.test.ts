import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compileSceneText } from "../../src/compile.ts";
import { imagesFor } from "../images.ts";

const root = join(import.meta.dirname, "../..");
const examples = join(root, "examples");
const golden = join(root, "tests/golden");
const update = process.env["GERTIE_UPDATE_GOLDEN"] === "1";

// The feature corpus in examples/ and the benchmark corpus in examples/benchmark/ (docs/17-quality-tuning.md, section 7) share one golden folder,
// so a scene name must be unique across both.
const sources = [examples, join(examples, "benchmark")].flatMap((dir) =>
  readdirSync(dir).filter((f) => f.endsWith(".gertie.json")).sort().map((file) => ({ dir, file })),
);

test("scene names are unique across the corpus and the benchmark corpus", () => {
  const names = sources.map((s) => s.file);
  assert.deepEqual(names.filter((n, i) => names.indexOf(n) !== i), []);
});

for (const { dir, file } of sources) {
  const name = file.replace(".gertie.json", "");
  test(`corpus ${name}: zero errors and warnings, output matches golden`, () => {
    const text = readFileSync(join(dir, file), "utf8");
    const r = compileSceneText(text, { fileExists: (s) => existsSync(join(dir, s)), images: imagesFor(dir, text) });
    assert.deepEqual(r.diagnostics, [], "the corpus must compile and validate with no diagnostics at all");
    const out = JSON.stringify(r.lottie, null, 1) + "\n";
    const svg = (r.svg as { svg: string }).svg;
    for (const [target, text] of [
      [join(golden, `${name}.lottie.json`), out],
      [join(golden, `${name}.svg`), svg],
    ] as const) {
      if (update) {
        mkdirSync(golden, { recursive: true });
        writeFileSync(target, text);
        continue;
      }
      assert.ok(existsSync(target), `missing golden file ${target}. Run npm run golden:update.`);
      assert.equal(text, readFileSync(target, "utf8"));
    }
  });
}
