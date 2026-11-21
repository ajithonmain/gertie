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

// Keep the 3D runtime separate from the Node CLI and inline it only in 3D output.
await build({
  entryPoints: [join(root, "src", "three", "player.js")],
  outfile: join(root, "skills", "gertie", "assets", "three-player.js"),
  bundle: true,
  platform: "browser",
  target: "es2022",
  format: "iife",
  minify: true,
  legalComments: "none",
  banner: { js: "/*! Three.js\n" + readFileSync(join(root, "node_modules", "three", "LICENSE"), "utf8") + "\n*/" },
});
