// Fails when any installed package has a licence outside the allowed list.
// Rule book: docs/15-licences-and-naming.md. Run with: npm run check:licences
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ALLOWED = new Set(["MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "Python-2.0", "MIT-0", "Unlicense"]);

// Reviewed exceptions. Each is a development-only package reached through hyperframes, an optional external tool that is never bundled.
const EXCEPTIONS = new Map([
  ["@img/sharp-libvips-darwin-arm64", "LGPL-3.0-or-later; prebuilt libvips for sharp, dynamically linked, dev-only via hyperframes, not bundled"],
  ["@img/sharp-libvips-darwin-x64", "same as above"],
  ["@img/sharp-libvips-linux-x64", "same as above"],
  ["@img/sharp-libvips-linux-arm64", "same as above"],
  ["@img/sharp-wasm32", "Apache-2.0 AND LGPL-3.0-or-later AND MIT; WebAssembly build of sharp with libvips, optional install on Linux, dev-only via hyperframes, not bundled"],
]);

function packages(root) {
  const out = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const dir = join(root, entry.name);
    if (entry.name.startsWith("@")) out.push(...packages(dir));
    else {
      if (existsSync(join(dir, "package.json"))) out.push(dir);
      const nested = join(dir, "node_modules");
      if (existsSync(nested)) out.push(...packages(nested));
    }
  }
  return out;
}

function licenceOf(pkg) {
  const l = pkg.license ?? pkg.licenses;
  if (typeof l === "string") return l;
  if (l && typeof l === "object" && !Array.isArray(l)) return l.type ?? "UNKNOWN";
  if (Array.isArray(l)) return l.map((x) => x.type ?? String(x)).join(" OR ");
  return "UNKNOWN";
}

function ok(expr) {
  const parts = expr.replace(/[()]/g, "").split(/\s+(?:OR|AND)\s+/);
  const anyOr = / OR /.test(expr);
  const results = parts.map((p) => ALLOWED.has(p.trim()));
  return anyOr ? results.some(Boolean) : results.every(Boolean);
}

const bad = [];
let count = 0;
for (const dir of packages("node_modules")) {
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  if (typeof pkg.name !== "string") continue;
  count++;
  const lic = licenceOf(pkg);
  if (EXCEPTIONS.has(pkg.name) || ok(lic)) continue;
  bad.push(`${pkg.name}@${pkg.version}: ${lic}`);
}
if (bad.length > 0) {
  console.error(`Licence check failed. Packages outside the allowed list:\n  ${bad.join("\n  ")}\nReview the licence file, then add to docs/15-licences-and-naming.md and to EXCEPTIONS with a reason.`);
  process.exit(1);
}
console.log(`Licence check passed: ${count} packages.`);
