// Builds the website into site/dist. Run with: node --import tsx scripts/build-site.mjs
// Pages: home, playground, gallery, docs, benchmark. The playground bundles the real compiler from src/.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";
import { compileSceneText } from "../src/compile.ts";

const root = new URL("..", import.meta.url).pathname;
const dist = join(root, "site", "dist");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const repo = String(pkg.repository?.url ?? "").replace(/\.git$/, "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "gallery"), { recursive: true });
mkdirSync(join(dist, "docs"), { recursive: true });

const LOGO = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8" stroke="#1e293b"/><path d="M12 4a8 8 0 0 1 8 8"/></svg>`;
const NAV = [["index.html", "Home"], ["playground.html", "Playground"], ["gallery.html", "Gallery"], ["docs/index.html", "Docs"], ["benchmark.html", "Benchmark"]];

function page({ title, desc, file, body, script }) {
  const depth = file.split("/").length - 1;
  const up = "../".repeat(depth);
  const nav = NAV.map(([href, label]) => `<a href="${up}${href}"${href === file || (file.startsWith("docs/") && href === "docs/index.html") ? ' aria-current="page"' : ""}>${label}</a>`).join("");
  const github = repo ? `<a href="${esc(repo)}">GitHub</a>` : "";
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="icon" href="${up}favicon.svg" type="image/svg+xml"><link rel="stylesheet" href="${up}style.css"></head>
<body><header class="top"><div class="in"><a class="brand" href="${up}index.html">${LOGO}Gertie</a><nav>${nav}${github}</nav></div></header>
<main>${body}</main>
<footer><div class="in">Gertie is MIT licensed and free. It runs on your machine and makes no network requests. Gertie is not affiliated with LottieFiles or the Lottie Animation Community.</div></footer>
${script ?? ""}</body></html>`;
  writeFileSync(join(dist, file), html);
}

cpSync(join(root, "site", "src", "style.css"), join(dist, "style.css"));
cpSync(join(root, "assets", "header.svg"), join(dist, "header.svg"));
writeFileSync(join(dist, "favicon.svg"), LOGO.replace('width="24" height="24" ', "").replace("<svg ", '<svg xmlns="http://www.w3.org/2000/svg" '));
writeFileSync(join(dist, "_headers"), "/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n");

// Gallery: compile every example that produces an SVG without needing a fragment file.
const exDir = join(root, "examples");
const items = [];
for (const f of readdirSync(exDir).filter((x) => x.endsWith(".gertie.json")).sort()) {
  const text = readFileSync(join(exDir, f), "utf8");
  const name = f.replace(/\.gertie\.json$/, "");
  const r = compileSceneText(text);
  if (r.diagnostics.some((d) => d.severity === "error") || !r.svg || !r.lottie) continue;
  writeFileSync(join(dist, "gallery", `${name}.svg`), r.svg.svg);
  writeFileSync(join(dist, "gallery", `${name}.lottie.json`), JSON.stringify(r.lottie));
  writeFileSync(join(dist, "gallery", `${name}.gertie.json`), text);
  items.push({ name, text });
}

const cards = (list) => list.map((i) => `<div class="card"><div class="stage"><img src="gallery/${i.name}.svg" alt="${esc(i.name)} animation" loading="lazy"></div><div class="name">${esc(i.name)}</div><div class="links"><a href="gallery/${i.name}.gertie.json">scene</a><a href="gallery/${i.name}.lottie.json">lottie</a><a href="gallery/${i.name}.svg">svg</a></div></div>`).join("");

page({
  title: "Gertie: free vector animation for any AI agent",
  desc: "Open-source agent skill that compiles a small scene file to Lottie JSON and animated SVG, then renders, checks and exports GIF, video and more.",
  file: "index.html",
  body: `<section class="hero"><div><h1>Vector animation from any AI agent. Free.</h1>
<p class="lead">Ask your agent for an animation. It writes a small scene file. Gertie compiles it to Lottie JSON and animated SVG, renders it in a real browser, checks it, and exports GIF, transparent video and more. No credits, no account, no network calls.</p>
<div class="install"><pre><code>npx skills add ${esc(repo.replace("https://github.com/", "") || "OWNER/gertie")}</code></pre></div>
<p><a href="playground.html">Try the playground</a> &middot; <a href="docs/index.html">Read the docs</a></p></div>
<img src="header.svg" alt="A pulsing ring, animated by Gertie"></section>
<h2>What you get</h2>
<table><tr><th>Output</th><th>Use it for</th></tr>
<tr><td>Lottie JSON and .lottie</td><td>Apps and websites</td></tr>
<tr><td>Animated SVG</td><td>Works in an img tag with no JavaScript, including READMEs</td></tr>
<tr><td>GIF, APNG, WebP</td><td>Anywhere that needs an image</td></tr>
<tr><td>WebM with alpha, ProRes 4444, HEVC with alpha, MP4</td><td>Video, with transparency where the format allows</td></tr>
<tr><td>Destination presets</td><td>Telegram, Discord, Slack, WhatsApp and more, within their limits</td></tr>
<tr><td>Storyboards</td><td>Multi-scene videos with captions, transitions and music</td></tr></table>
<h2>Examples</h2><div class="grid">${cards(items.slice(0, 8))}</div><p><a href="gallery.html">See all ${items.length}</a></p>
<h2>Works with</h2><p>Claude Code, Codex CLI, Gemini CLI, Cursor and any agent that reads the Agent Skills format. See the <a href="benchmark.html">benchmark</a> for how well agents do with it, and the exact prompts used.</p>`,
});

page({
  title: "Gertie gallery",
  desc: "Every example scene in the Gertie corpus, with its scene file, Lottie JSON and SVG.",
  file: "gallery.html",
  body: `<h1>Gallery</h1><p class="lead">Every example below was compiled from a scene file by Gertie. Nothing is hand-written Lottie.</p><div class="grid">${cards(items)}</div>`,
});

// Playground
await build({ entryPoints: [join(root, "site", "src", "playground.ts")], bundle: true, platform: "browser", format: "iife", target: "es2022", minify: true, outfile: join(dist, "playground.js"), alias: { "node:path": join(root, "site", "src", "path-shim.ts") }, logLevel: "warning", legalComments: "none" });
const small = items.filter((i) => i.text.length < 30000);
page({
  title: "Gertie playground",
  desc: "Edit a Gertie scene file and see the compiled animation and lint messages live in your browser.",
  file: "playground.html",
  body: `<h1>Playground</h1><p class="lead">The real compiler runs in your browser. Paste a scene file from a chat model, or edit an example. Nothing is uploaded. Video and GIF export need ffmpeg, so use the skill for those.</p>
<div class="bar"><label>Example <select id="picker"></select></label><button id="dl-lottie" disabled>Download Lottie JSON</button><button id="dl-svg" disabled>Download SVG</button></div>
<div class="cols"><div><textarea id="editor" spellcheck="false" aria-label="Scene file"></textarea></div><div><div class="stage big" id="stage"></div><ul class="diag" id="diag"></ul></div></div>
<script id="examples" type="application/json">${JSON.stringify(small).replace(/</g, "\\u003c")}</script>`,
  script: `<script src="playground.js"></script>`,
});

// Docs: the skill's reference files, rendered.
function inline(s) {
  return esc(s).replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>").replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => `<a href="${u.replace(/\.md(#|$)/, ".html$1")}">${t}</a>`);
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
      out.push(`<table>${rows.join("")}</table>`);
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
const side = `<aside><a href="index.html">Overview</a>${refs.map((f) => `<a href="${f.replace(/\.md$/, ".html")}">${f.replace(/\.md$/, "")}</a>`).join("")}</aside>`;
page({
  title: "Gertie docs",
  desc: "The Gertie skill reference files: scene format, motion presets, artwork, export, video and ASCII.",
  file: "docs/index.html",
  body: `<div class="docs">${side}<article>${md(readFileSync(join(root, "skills", "gertie", "SKILL.md"), "utf8"))}</article></div>`,
});
for (const f of refs) {
  page({ title: `Gertie docs: ${f.replace(/\.md$/, "")}`, desc: `Gertie reference: ${f.replace(/\.md$/, "")}.`, file: `docs/${f.replace(/\.md$/, ".html")}`, body: `<div class="docs">${side}<article>${md(readFileSync(join(refDir, f), "utf8"))}</article></div>` });
}
// Paste-in prompt for chat apps that cannot run commands.
writeFileSync(join(dist, "prompt.txt"), ["You write Gertie scene files. Reply with one JSON scene file and nothing else. Follow the format below exactly.\n", readFileSync(join(refDir, "scene.md"), "utf8"), readFileSync(join(refDir, "motion.md"), "utf8")].join("\n\n"));

// Benchmark: published pass rates and the prompts, from tests/eval/results.
const resDir = join(root, "tests", "eval", "results");
const prompts = JSON.parse(readFileSync(join(root, "tests", "eval", "prompts.json"), "utf8"));
const runs = existsSync(resDir) ? readdirSync(resDir).filter((d) => existsSync(join(resDir, d, "results.json"))).map((d) => ({ dir: d, ...JSON.parse(readFileSync(join(resDir, d, "results.json"), "utf8")) })) : [];
let bench;
if (runs.length) {
  bench = `<table><tr><th>Model</th><th>Date</th><th>Prompts</th><th>First pass</th><th>Within three runs</th><th>Final scene passes</th></tr>${runs.map((r) => `<tr><td>${esc(r.model)}</td><td>${esc(r.date)}</td><td>${r.prompts}</td><td>${r.firstPassPct}%</td><td>${r.within3Pct}%</td><td>${r.finalPct}%</td></tr>`).join("")}</table>`;
  mkdirSync(join(dist, "benchmark"), { recursive: true });
  for (const r of runs) {
    const sheets = r.rows.filter((x) => existsSync(join(resDir, r.dir, x.id, "sheet.png")));
    for (const x of sheets) { mkdirSync(join(dist, "benchmark", r.dir), { recursive: true }); cpSync(join(resDir, r.dir, x.id, "sheet.png"), join(dist, "benchmark", r.dir, `${x.id}.png`)); }
    bench += `<h3>${esc(r.model)}: contact sheets</h3><div class="grid">${sheets.map((x) => `<div class="card"><img src="benchmark/${r.dir}/${x.id}.png" alt="Contact sheet for ${esc(x.id)}" loading="lazy"><div class="name">${esc(x.id)}</div><div class="links">${x.final ? "passes" : "fails"} qa</div></div>`).join("")}</div>`;
  }
} else bench = `<p class="mut">No evaluation run has been published yet.</p>`;
page({
  title: "Gertie benchmark",
  desc: "Published pass rates for AI agents using the Gertie skill, with the method and the full prompt set.",
  file: "benchmark.html",
  body: `<h1>Benchmark</h1><p class="lead">Can an agent with Gertie installed make a valid animation from a plain prompt? Passing means the scene compiles, validates, renders and has zero qa errors. It does not mean the animation is beautiful, so judge the contact sheets yourself.</p>
${bench}
<h2>Method</h2><ul><li>Each prompt runs in a fresh folder with only the skill installed, using the agent in non-interactive mode.</li>
<li><strong>First pass</strong>: the first qa run the agent made had zero errors.</li><li><strong>Within three runs</strong>: one of its first three qa runs had zero errors.</li>
<li><strong>Final</strong>: the scene left in the folder passes qa when the harness runs it afterwards.</li>
<li>The renderer is provisioned in advance, so the score measures the skill and not an npm install.</li>
<li>One run per prompt per model. Treat differences of a few points as noise.</li>
<li>Code and prompts: <code>tests/eval/</code> in the repository. Run it with <code>node tests/eval/run.mjs --model haiku</code>.</li></ul>
<h2>The ${prompts.length} prompts</h2><table><tr><th>Id</th><th>Category</th><th>Prompt</th></tr>${prompts.map((p) => `<tr><td>${esc(p.id)}</td><td>${esc(p.category)}</td><td>${esc(p.prompt)}</td></tr>`).join("")}</table>`,
});
console.log(`site built: ${items.length} gallery items, ${refs.length + 1} docs pages, ${runs.length} benchmark runs`);
