// Builds the website into site/dist. Run with: node --import tsx scripts/build-site.mjs
// Pages: home, gallery, and docs.
import { execFileSync } from "node:child_process";
import { transform } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, basename, dirname } from "node:path";
import { parseAscii } from "../src/ascii/parse.ts";
import { emitAsciiSvg } from "../src/ascii/svg.ts";
import { compileSceneText } from "../src/compile.ts";
import { agentCard, commandBox, examplePrompt, featureCards, workflowSteps } from "./landing-content.mjs";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "site", "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const repo = String(pkg.repository?.url ?? "").replace(/\.git$/, "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "gallery"), { recursive: true });
mkdirSync(join(dist, "docs"), { recursive: true });

const SITE = "https://gertiestudio.pages.dev";
const publicPath = file => `/${file.replace(/(^|\/)index\.html$/, "$1")}`;
const seoTags = (file, title, desc, full = true) => {
  const url = SITE + publicPath(file);
  return [
    `<link rel="canonical" href="${url}">`,
    ...(full ? [`<meta property="og:title" content="${esc(title)}">`, `<meta property="og:description" content="${esc(desc)}">`, `<meta property="og:type" content="website">`] : []),
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:image" content="${SITE}/og.png">`,
    `<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("");
};
const headerMarkup = readFileSync(join(root, "site", "src", "header.html"), "utf8").trim();
const footerMarkup = readFileSync(join(root, "site", "src", "footer.html"), "utf8").trim();
const siteHeader = file => headerMarkup
  .replaceAll("{{repo}}", esc(repo))
  .replace("{{docs-current}}", file.startsWith("docs/") ? ' aria-current="page"' : "")
  .replace("{{gallery-current}}", file === "gallery.html" ? ' aria-current="page"' : "");
const siteFooter = footerMarkup.replaceAll("{{repo}}", esc(repo));

function page({ title, desc, file, body }) {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
${seoTags(file, title, desc)}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/landing.css"><link rel="stylesheet" href="/docs.css">
<script src="/navigation.js" defer></script></head>
<body class="reference-page">
<a class="skip" href="#main">Skip to content</a>
${siteHeader(file)}
<main id="main" class="wrap reference-main">${body}</main>
${siteFooter}
</body></html>`;
  writeFileSync(join(dist, file), html);
}

cpSync(join(root, "assets", "header.svg"), join(dist, "header.svg"));
writeFileSync(join(dist, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n");

const posterOf = (svg) => svg
  .replace(/@keyframes\s+[^{}]+\{(?:[^{}]|\{[^{}]*\})*\}/g, "")
  .replace(/@media\s*\(prefers-reduced-motion:\s*reduce\)/g, "@media all")
  .replace(/<animate\b[^>]*\/>/g, "");

// Gallery: compile every example that produces an SVG without needing a fragment file.
const exDir = join(root, "examples");
const items = [];
for (const f of readdirSync(exDir).filter((x) => x.endsWith(".gertie.json")).sort()) {
  const text = readFileSync(join(exDir, f), "utf8");
  const name = f.replace(/\.gertie\.json$/, "");
  const r = compileSceneText(text);
  if (r.diagnostics.some((d) => d.severity === "error") || !r.svg || !r.lottie) continue;
  writeFileSync(join(dist, "gallery", `${name}.svg`), r.svg.svg);
  writeFileSync(join(dist, "gallery", `${name}.poster.svg`), posterOf(r.svg.svg));
  writeFileSync(join(dist, "gallery", `${name}.lottie.json`), JSON.stringify(r.lottie));
  writeFileSync(join(dist, "gallery", `${name}.gertie.json`), text);
  items.push({ name, background: JSON.parse(text).canvas.background });
}


// Landing page: every image is a Gertie scene in site/animations, compiled here to an animated SVG and a still poster.
// Posters keep the reduced-motion geometry and drop the animation keyframes.
const outAnim = join(dist, "animations");
mkdirSync(outAnim, { recursive: true });
const landingAnimations = join(root, "site", "animations");
const galleryBackgrounds = new Map();
for (const f of readdirSync(landingAnimations).filter((f) => f.endsWith(".gertie.json"))) {
  const source = readFileSync(join(landingAnimations, f), "utf8");
  const scene = JSON.parse(source);
  galleryBackgrounds.set(scene.name, scene.canvas.background);
  const result = compileSceneText(source);
  if (result.diagnostics.some((d) => d.severity === "error") || !result.svg) throw new Error(`Landing animation failed: ${f}: ${result.diagnostics.filter((d) => d.severity === "error").map((d) => d.message).join("; ")}`);
  writeFileSync(join(outAnim, `${scene.name}.svg`), result.svg.svg);
  writeFileSync(join(outAnim, `${scene.name}.poster.svg`), posterOf(result.svg.svg));
  // Scenes shown as "Made with Gertie" are published next to their SVG so visitors can open the source.
  if (scene.name.startsWith("hero-")) writeFileSync(join(outAnim, f), source);
}
// The editable hero also appears in the examples gallery. Reuse that build for the landing page.
for (const ext of ["svg", "gertie.json"]) {
  cpSync(join(dist, "gallery", `hero-gertie.${ext}`), join(outAnim, `hero-gertie.${ext}`));
}
// Ready-made SVGs (for example ASCII animation exported by `gertie ascii export`) are copied as they are and win over a scene of the same name.
for (const f of readdirSync(landingAnimations).filter((f) => f.endsWith(".svg") && !f.endsWith(".poster.svg") && f !== "hero-gertie.svg")) {
  const svg = readFileSync(join(landingAnimations, f), "utf8");
  writeFileSync(join(outAnim, f), svg);
  writeFileSync(join(outAnim, f.replace(/\.svg$/, ".poster.svg")), posterOf(svg));
}
const ascii = parseAscii(JSON.parse(readFileSync(join(landingAnimations, "landing-starfield.ascii.json"), "utf8")));
if (!ascii.scene || ascii.diagnostics.some(d => d.severity === "error")) throw new Error("Cannot compile landing starfield");
writeFileSync(join(outAnim, "landing-starfield.svg"), emitAsciiSvg(ascii.scene));
writeFileSync(join(outAnim, "landing-starfield.poster.svg"), emitAsciiSvg({ ...ascii.scene, frames: [ascii.scene.frames[0]] }));
cpSync(join(root, "site", "src", "icons"), join(dist, "icons"), { recursive: true });
cpSync(join(root, "site", "src", "fonts"), join(dist, "fonts"), { recursive: true });
cpSync(join(dist, "icons", "logo.svg"), join(dist, "favicon.svg"));
for (const file of ["landing.css", "landing.js", "gallery.css", "gallery.js", "docs.css", "navigation.js"]) {
  const loader = file.split(".").at(-1);
  const source = readFileSync(join(root, "site", "src", file), "utf8");
  const result = await transform(source, { loader, minify: true, target: "es2020" });
  writeFileSync(join(dist, file), result.code);
}
// The gallery carousel is generated from site/src/gallery.json, so the prompt shown in the drawer is stored in one place.
const galleryItems = JSON.parse(readFileSync(join(root, "site", "src", "gallery.json"), "utf8"));
const threeGallery = galleryItems.filter(item => item.format === "three");
for (const { name, buildScript, modelSource } of threeGallery) {
  if (buildScript) {
    execFileSync(process.execPath, [
      join(root, buildScript), join(dist, "gallery", `${name}.html`),
    ], { stdio: "inherit" });
    if (modelSource) cpSync(join(root, modelSource), join(dist, "gallery", basename(modelSource)));
    continue;
  }
  const source = join(exDir, `${name}.three.json`);
  execFileSync(process.execPath, [
    join(root, "skills", "gertie", "scripts", "gertie.mjs"),
    "three", "build", source, "--out", join(dist, "gallery", `${name}.html`),
  ], { stdio: "inherit" });
  cpSync(source, join(dist, "gallery", `${name}.three.json`));
  const scene = JSON.parse(readFileSync(source, "utf8"));
  for (const object of scene.objects) {
    if (object.shape !== "relief") continue;
    for (const asset of [object.image, object.depthMap]) {
      const target = join(dist, "gallery", asset);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(exDir, asset), target);
    }
  }
  galleryBackgrounds.set(name, scene.background);
}
const threePoster = name => `animations/posters/${name}.png`;
const threePlayer = name => `gallery/${name}.html`;
// The standalone 3D players are full pages that people may share on their own. Give each one
// a real title, a description, link-preview tags, the favicon, a heading for screen readers and
// a small credit link back to the site. The gallery and landing drawers hide the credit when embedded.
for (const { name, title, prompt } of threeGallery) {
  const file = join(dist, "gallery", `${name}.html`);
  const pageTitle = `${title} · Gertie 3D animation`;
  const desc = prompt ? `Made with Gertie, a free open-source animation skill for AI agents. Prompt: ${prompt}` : "Made with Gertie, a free open-source animation skill for AI agents.";
  const head = [
    `<title>${esc(pageTitle)}</title>`,
    `<meta name="description" content="${esc(desc)}">`,
    `<link rel="icon" href="../favicon.svg" type="image/svg+xml">`,
    `<link rel="canonical" href="${SITE}/gallery/${name}">`,
    `<meta property="og:title" content="${esc(pageTitle)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:url" content="${SITE}/gallery/${name}">`,
    `<meta property="og:image" content="${SITE}/${threePoster(name)}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("\n");
  const credit = `<a id="gertie-credit" href="../" style="position:fixed;left:50%;bottom:12px;transform:translateX(-50%);font:13px/1.4 system-ui,sans-serif;color:#cfd6e6;text-decoration:none;opacity:.8">Made with Gertie</a>`;
  const heading = `<h1 style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap">${esc(title)}</h1>`;
  const html = readFileSync(file, "utf8");
  if (!/<title>[^<]*<\/title>/.test(html) || !html.includes("<main>")) throw new Error(`Unexpected 3D player markup in ${file}`);
  writeFileSync(file, html
    .replace(/<title>[^<]*<\/title>/, () => head)
    .replace("<main>", () => `<main>\n${heading}`)
    .replace("</main>", () => `</main>\n${credit}`));
}

for (const [folder, name] of [["", "preset-entrances"], ["", "preset-exits"], ["import", "w3c-demo"], ["trace", "logo-anim"]]) {
  const source = readFileSync(join(exDir, folder, `${name}.gertie.json`), "utf8");
  const result = compileSceneText(source, { loadFragment: path => JSON.parse(readFileSync(join(exDir, folder, path), "utf8")) });
  if (!result.svg || result.diagnostics.some(d => d.severity === "error")) throw new Error(`Cannot compile landing example ${name}`);
  writeFileSync(join(dist, "gallery", `${name}.svg`), result.svg.svg);
  writeFileSync(join(dist, "gallery", `${name}.poster.svg`), posterOf(result.svg.svg));
}
const showcaseDir = join(landingAnimations, "showcase");
for (const file of readdirSync(showcaseDir).filter(file => file.endsWith(".gertie.json"))) {
  const name = file.replace(/\.gertie\.json$/, "");
  const source = readFileSync(join(showcaseDir, file), "utf8");
  galleryBackgrounds.set(name, JSON.parse(source).canvas.background);
  const result = compileSceneText(source);
  if (!result.svg || result.diagnostics.some(d => d.severity === "error")) throw new Error(`Cannot compile showcase scene ${name}`);
  writeFileSync(join(outAnim, `${name}.svg`), result.svg.svg);
  writeFileSync(join(outAnim, `${name}.poster.svg`), posterOf(result.svg.svg));
}
const tile = g => {
  const isThree = g.format === "three";
  const poster = isThree ? threePoster(g.name) : `animations/${g.name}.poster.svg`;
  const animation = isThree ? poster : `animations/${g.name}.svg`;
  const player = isThree ? ` data-player="${threePlayer(g.name)}"` : "";
  const background = galleryBackgrounds.get(g.name);
  const style = /^#[\da-f]{6}$/i.test(background) ? ` style="--tile-bg: ${background}"` : "";
  return `<button class="gtile"${style} type="button" data-title="${esc(g.title)}" data-prompt="${esc(g.prompt)}" data-src="${animation}" data-still="${poster}"${player} aria-label="Open ${esc(g.title)}"><img class="rail-poster" alt="" loading="lazy"><noscript><img src="${poster}" alt="" loading="lazy"></noscript></button>`;
};
const railItems = galleryItems.filter(item => !item.galleryOnly);
const perRow = Math.ceil(railItems.length / 3);
const rows = [0, 1, 2].map((r) => {
  const items = railItems.slice(r * perRow, (r + 1) * perRow);
  return `<div class="rail${r === 1 ? " reverse" : ""}"><div class="rail-track">${items.map(tile).join("")}</div></div>`;
});
// Keep only the assets used by the landing page’s SVG previews and still illustrations.
const mediaDir = join(landingAnimations, "media");
mkdirSync(join(outAnim, "media"), { recursive: true });
for (const f of ["painting.webp", "portrait.svg", "story-strip.webp", "study.webp"]) {
  cpSync(join(mediaDir, f), join(outAnim, "media", f));
}
cpSync(join(exDir, "import", "third-party", "w3c-illustration-1.svg"), join(outAnim, "media", "source-art.svg"));
cpSync(join(exDir, "trace", "logo.png"), join(outAnim, "media", "logo.png"));
// Benchmark: published pass rates and the prompts, from tests/eval/results.
const resDir = join(root, "tests", "eval", "results");
const prompts = JSON.parse(readFileSync(join(root, "tests", "eval", "prompts.json"), "utf8"));
const runs = existsSync(resDir) ? readdirSync(resDir).filter((d) => existsSync(join(resDir, d, "results.json"))).map((d) => JSON.parse(readFileSync(join(resDir, d, "results.json"), "utf8"))) : [];
const benchmarkPrompts = runs.reduce((total, run) => total + run.prompts, 0);
const benchmarkPasses = runs.reduce((total, run) => total + run.rows.filter((row) => row.final).length, 0);
const firstPassRates = runs.map((run) => run.firstPassPct);
const firstPassLow = Math.min(...firstPassRates);
const firstPassHigh = Math.max(...firstPassRates);
const firstPass = firstPassLow === firstPassHigh ? `${firstPassLow}%` : `${firstPassLow}% to ${firstPassHigh}%`;
const proof = {
  dependencies: Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies }).length,
  node: esc(pkg.engines.node.match(/\d+/)[0]),
};
const proofNumber = (value, suffix = "") =>
  `<span class="sr-only">${value}${suffix}</span><span class="proof-number" aria-hidden="true"><span data-proof-count>${value}</span>${suffix}</span>`;
const benchmarkSummary = benchmarkPrompts
  ? `${proofNumber(Number((100 * benchmarkPasses / benchmarkPrompts).toFixed(1)), "%")}
    <h3>of final scenes passed QA</h3>
    <p>${benchmarkPrompts} prompt runs across ${new Set(runs.map((run) => run.model)).size} models. ${firstPass} on the first try.</p>
    <p class="proof-method">QA checks scene validity and motion. Visual quality requires review.</p>`
  : "<h3>Scene QA benchmark</h3>";
const postersDir = join(landingAnimations, "posters");
const posters = new Set(readdirSync(postersDir));
cpSync(postersDir, join(outAnim, "posters"), { recursive: true });
const landing = readFileSync(join(root, "site", "src", "landing.html"), "utf8")
  .replace("<!--gallery-->", rows.join("\n"))
  .replace("<!--proof-benchmark-->", benchmarkSummary)
  .replace("</head>", `${seoTags("index.html", "", "", false)}</head>`);
const replacements = {
  repo: esc(repo),
  "site-header": siteHeader("index.html"),
  "site-footer": siteFooter,
  "command:hero": commandBox("hero"),
  "example-prompt": esc(examplePrompt),
  "workflow-steps": workflowSteps(),
  "feature-cards": featureCards(root, prompts),
  "agent-card": agentCard(),
  "proof:dependencies": proof.dependencies,
  "proof:node": proof.node,
};
writeFileSync(join(dist, "index.html"), landing.replace(/\{\{(.*?)\}\}/gs, (_, key) => {
  if (!Object.hasOwn(replacements, key)) throw new Error(`Unknown landing placeholder: ${key}`);
  return replacements[key];
}).replace(/(?:animations|gallery)\/([\w-]+\.poster)\.svg/g, (path, name) => {
  const poster = `${name}.webp`;
  return posters.has(poster) ? `animations/posters/${poster}` : path;
}));

const curatedNames = new Set(galleryItems.map(item => item.name));
const curatedTitles = new Set(galleryItems.map(item => item.title.toLowerCase()));
const sourceExamples = new Map(items.map(item => [item.name, item]));
const galleryCard = ({ title, format, poster, animation, prompt, source, lottie, background }) => {
  const style = /^#[\da-f]{6}$/i.test(background) ? ` style="--card-bg: ${background}"` : "";
  const extra = Object.entries({ prompt, source, lottie })
    .filter(([, value]) => value).map(([key, value]) => ` data-${key}="${esc(value)}"`).join("");
  return `<li><a class="gallery-card" href="${animation}" data-format="${format}"${style}${extra}>
    <span class="gallery-card-art"><img src="${poster}" alt="" width="400" height="300" loading="lazy" decoding="async"></span>
    <span class="gallery-card-name sr-only">${esc(title)}</span>
  </a></li>`;
};
const fullGallery = [
  ...galleryItems.map(({ name, title, format, prompt, galleryOnly, modelSource }) => {
    const three = format === "three";
    const webp = `${name}.poster.webp`;
    const folder = galleryOnly ? "gallery" : "animations";
    const animation = three ? threePlayer(name) : `${folder}/${name}.svg`;
    const exportedExample = !three && sourceExamples.has(name) &&
      readFileSync(join(dist, animation)).equals(readFileSync(join(dist, "gallery", `${name}.svg`)));
    return galleryCard({
      title, format: three ? "three" : "vector", animation, prompt,
      poster: three ? threePoster(name) : posters.has(webp) ? `animations/posters/${webp}` : `${folder}/${name}.poster.svg`,
      source: three ? `gallery/${modelSource ? basename(modelSource) : `${name}.three.json`}` : exportedExample ? `gallery/${name}.gertie.json` : undefined,
      lottie: exportedExample ? `gallery/${name}.lottie.json` : undefined,
      background: galleryBackgrounds.get(name) ?? sourceExamples.get(name)?.background,
    });
  }),
  ...items.filter(({ name }) => !curatedNames.has(name)).map(({ name, background }) => {
    const title = name.replaceAll("-", " ").replace(/^./, character => character.toUpperCase());
    return galleryCard({
      title: curatedTitles.has(title.toLowerCase()) ? `${title} (source demo)` : title,
      format: "vector", poster: `gallery/${name}.poster.svg`, animation: `gallery/${name}.svg`,
      source: `gallery/${name}.gertie.json`, lottie: `gallery/${name}.lottie.json`, background,
    });
  }),
];
const galleryPage = readFileSync(join(root, "site", "src", "gallery.html"), "utf8");
writeFileSync(join(dist, "gallery.html"), galleryPage
  .replace("{{site-header}}", siteHeader("gallery.html"))
  .replace("{{site-footer}}", siteFooter)
  .replace("<!--gallery-cards-->", fullGallery.join("\n"))
  .replace("</head>", `${seoTags("gallery.html", "Animation gallery · Gertie", "Browse vector and 3D animations made with Gertie. Open an example to see how it was made.")}</head>`));

// Docs: the skill's reference files, rendered.
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u.replace(/^(?:references\/)?([a-z-]+)\.md(?=#|$)/, "/docs/$1/")}">${t}</a>`);
}
function md(src) {
  const out = [];
  const lines = src.replace(/^---[\s\S]*?---\n/, "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^(```|~~~)/.test(l) || /^ {4}\S/.test(l) && !/^ {4}[-*\d]/.test(l) && (i === 0 || lines[i - 1].trim() === "")) {
      const fenced = /^(```|~~~)/.test(l);
      const buf = [];
      if (fenced) { for (i++; i < lines.length && !/^(```|~~~)/.test(lines[i]); i++) buf.push(lines[i]); }
      else { for (; i < lines.length && (/^ {4}/.test(lines[i]) || lines[i].trim() === ""); i++) buf.push(lines[i].replace(/^ {4}/, "")); i--; }
      out.push(`<pre><code>${esc(buf.join("\n").replace(/\n+$/, ""))}</code></pre>`);
    } else if (/^#{1,4} /.test(l)) {
      const n = l.match(/^#+/)[0].length;
      out.push(`<h${n}>${inline(l.replace(/^#+ /, ""))}</h${n}>`);
    } else if (/^\|/.test(l) && /^\|[\s:|-]+\|?$/.test(lines[i + 1] ?? "")) {
      const row = (r, tag) => `<tr>${r.replace(/^\||\|$/g, "").split("|").map((c) => `<${tag}>${inline(c.trim())}</${tag}>`).join("")}</tr>`;
      const rows = [row(l, "th")];
      for (i += 2; i < lines.length && /^\|/.test(lines[i]); i++) rows.push(row(lines[i], "td"));
      i--;
      out.push(`<div class="reference-table" tabindex="0" role="region" aria-label="Reference table"><table>${rows.join("")}</table></div>`);
    } else if (/^\s*([-*]|\d+\.) /.test(l)) {
      const ord = /^\s*\d+\./.test(l);
      const rows = [];
      for (; i < lines.length && /^\s*([-*]|\d+\.) /.test(lines[i]); i++) rows.push(`<li>${inline(lines[i].replace(/^\s*([-*]|\d+\.) /, ""))}</li>`);
      i--;
      out.push(`<${ord ? "ol" : "ul"}>${rows.join("")}</${ord ? "ol" : "ul"}>`);
    } else if (l.trim()) {
      const buf = [l];
      while (i + 1 < lines.length && lines[i + 1].trim() && !/^(#|```|~~~|\||\s*([-*]|\d+\.) )/.test(lines[i + 1])) buf.push(lines[++i]);
      out.push(`<p>${inline(buf.join(" "))}</p>`);
    }
  }
  return out.join("\n");
}
const refDir = join(root, "skills", "gertie", "references");
const refs = readdirSync(refDir).filter((f) => f.endsWith(".md")).sort();
const referenceLabels = {
  artwork: "Artwork", ascii: "ASCII", cutout: "Cutouts", export: "Export", import: "Import",
  lottie: "Lottie", motion: "Motion", "motion-reference": "Motion reference", scene: "Scene format",
  three: "Three.js", trace: "Tracing", video: "Video",
};
const referencePages = [
  { file: "index.html", name: "Overview", path: join(root, "skills", "gertie", "SKILL.md") },
  ...refs.map(file => {
    const slug = file.replace(/\.md$/, "");
    return { file: `${slug}/index.html`, legacy: `/docs/${slug}.html`, name: referenceLabels[slug] ?? slug, path: join(refDir, file) };
  }),
];
for (const reference of referencePages) {
  const links = referencePages.map(({ file, name }) =>
    `<a href="${publicPath(`docs/${file}`)}"${file === reference.file ? ' aria-current="page"' : ""}>${esc(name)}</a>`).join("");
  mkdirSync(dirname(join(dist, "docs", reference.file)), { recursive: true });
  page({
    title: `${reference.name} · Gertie Docs`,
    desc: reference.file === "index.html"
      ? "Learn how to make, animate, and export Gertie scenes."
      : `Gertie documentation for ${reference.name}.`,
    file: `docs/${reference.file}`,
    body: `<div class="reference-layout">
      <nav class="reference-nav" aria-label="Documentation"><p>Documentation</p>${links}</nav>
      <article class="reference-article">${md(readFileSync(reference.path, "utf8"))}</article>
    </div>`,
  });
}
const legacyDocs = referencePages.filter(reference => reference.legacy);
for (const reference of legacyDocs) {
  const target = publicPath(`docs/${reference.file}`);
  writeFileSync(join(dist, reference.legacy.slice(1)), `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(reference.name)} · Gertie Docs</title>
<link rel="canonical" href="${SITE}${target}"><meta http-equiv="refresh" content="0; url=${target}"></head>
<body><a href="${target}">Open ${esc(reference.name)}</a></body></html>`);
}
writeFileSync(join(dist, "_redirects"), [
  "/docs/index.html /docs/ 301",
  ...legacyDocs.map(reference => `${reference.legacy} ${publicPath(`docs/${reference.file}`)} 301`),
].join("\n") + "\n");

// Paste-in prompt for chat apps that cannot run commands.
writeFileSync(join(dist, "prompt.txt"), ["You write Gertie scene files. Reply with one JSON scene file and nothing else. Follow the format below exactly.\n", readFileSync(join(refDir, "scene.md"), "utf8"), readFileSync(join(refDir, "motion.md"), "utf8")].join("\n\n"));

// Crawl and share files.
cpSync(join(root, "site", "src", "og.png"), join(dist, "og.png"));
const pages = ["index.html", "gallery.html", ...referencePages.map(reference => `docs/${reference.file}`)];
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(dist, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${pages.sort().map((f) => `<url><loc>${SITE}${publicPath(f)}</loc></url>`).join("\n")}\n</urlset>\n`);
page({ title: "Page not found · Gertie", desc: "This page does not exist.", file: "404.html", body: `<div><article class="reference-article"><h1>Page not found</h1><p>That page does not exist. Go to the <a href="/index.html">home page</a>, the <a href="/gallery.html">gallery</a> or the <a href="/docs/">docs</a>.</p></article></div>` });

console.log(`site built: ${items.length + threeGallery.length} gallery items, ${refs.length + 1} docs pages, ${runs.length} benchmark runs`);
