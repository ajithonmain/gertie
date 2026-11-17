// Bundles each entry in src/cli/ into a single-file .mjs under skills/gertie/scripts/.
import { build } from "esbuild";
import { readdirSync, readFileSync, chmodSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const entryDir = join(root, "src", "cli");
const outDir = join(root, "skills", "gertie", "scripts");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

const entries = readdirSync(entryDir).filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"));

for (const file of entries) {
  const name = file.replace(/\.ts$/, "");
  const outfile = join(outDir, `${name}.mjs`);
  await build({
    entryPoints: [join(entryDir, file)],
    outfile,
    bundle: true,
    platform: "node",
    target: "node22",
    format: "esm",
    external: ["playwright", "playwright-core"],
    define: { __GERTIE_VERSION__: JSON.stringify(version) },
    legalComments: "none",
    logLevel: "warning",
  });
  chmodSync(outfile, 0o755);
  console.log(`built skills/gertie/scripts/${name}.mjs`);
}
