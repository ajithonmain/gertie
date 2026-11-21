import { ALL_PRESET_NAMES } from "../src/presets/expand.ts";
import { EASING_NAMES } from "../src/presets/easing.ts";
import { FORMAT_IDS } from "../src/export/formats.ts";
import { DESTINATIONS } from "../src/export/destinations.ts";

const esc = value => String(value).replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[char]);
const installCommand = "npx skills add ajithonmain/gertie";

export const examplePrompt = "“Make a blue loading spinner that loops every two seconds.”";

export function commandBox(id) {
  return `<div class="command"><span class="command-prefix" aria-hidden="true">$</span><code id="${id}-command" data-shared="install-command">${installCommand}</code><button class="copy" type="button" aria-label="Copy install command" data-target="${id}-command" hidden><span class="ico i-copy" aria-hidden="true"></span><span class="copy-label">Copy</span></button></div>`;
}

const art = (name, alt, folder = "animations") =>
  `<img class="animated-art" loading="lazy" decoding="async" src="${folder}/${name}.poster.svg" data-still="${folder}/${name}.poster.svg" data-animation="${folder}/${name}.svg" alt="${esc(alt)}" width="400" height="300">`;
const still = (src, alt) => `<img loading="lazy" src="${src}" alt="${esc(alt)}">`;
const stage = (content, extra = "") => `<div class="media ${extra}">${content}</div>`;

export function workflowSteps() {
  const icon = (name) => `<span class="ico" style="--icon: url(icons/${name}.svg)" aria-hidden="true"></span>`;
  const step = (type, title, description, example) =>
    `<li class="how-step how-step-${type}">
      <div class="how-copy"><h2>${title}</h2><p>${description}</p></div>
      <div class="how-stage how-visual">
        <img src="animations/workflow-${type}.poster.svg" data-still="animations/workflow-${type}.poster.svg" data-animation="animations/workflow-${type}.svg" alt="" width="480" height="378" loading="lazy" decoding="async" fetchpriority="low">
      </div>
      <div class="how-example">${example}</div>
    </li>`;
  return `<ol class="how-steps" role="list">
    ${step("ask", "Ask", "Describe what you want to animate.",
      `<p data-shared="example-prompt">${esc(examplePrompt)}</p>`)}
    ${step("check", "Check", "Gertie previews the motion and tells your agent what to fix.",
      `<p class="how-status">${icon("check")} Loop checked</p>`)}
    ${step("export", "Export", "Your agent gives you a file ready to use.",
      `<p><code>spinner.svg</code></p>`)}
  </ol>`;
}

function card(id, title, intro, visual, footer = "") {
  return `<article class="feature-demo" id="${id}">
    <header class="feature-intro"><h3>${title}</h3><p>${intro}</p></header>
    <div class="feature-preview">${visual}</div>
    ${footer}
  </article>`;
}
const guide = (href, label) => `<a class="text-link" href="${href}">${label}<span class="ico" style="--icon: url(icons/arrow-ur.svg)" aria-hidden="true"></span></a>`;
const codePanel = lines => `<div class="code-panel" role="group" aria-label="Commands">${lines.map(line => `<p><span aria-hidden="true">$</span> <code>${esc(line)}</code></p>`).join("")}</div>`;
const textLine = items => `<p class="list-line">${esc(items.join(" · "))}</p>`;

function makeCard() {
  const tiles = [
    ["studio-bell", "Notification", "Icon", "A bell rings and settles"],
    ["studio-check", "Success", "Icon", "A checkmark draws itself"],
    ["ui-toggle", "Toggle", "UI motion", "A toggle glides from off to on"],
    ["char-robot-idle", "Robot", "Character", "A robot blinks and bobs"],
    ["scene-sunrise", "Sunrise", "Scene", "The sun rises over two hills"],
    ["landing-starfield", "Starfield", "ASCII", "A yellow starfield drawn with text characters"],
  ];
  const grid = `<ul class="tile-grid" role="list">${tiles.map(([name, label, type, alt]) =>
    `<li class="tile"><div class="tile-art">${art(name, alt)}</div><div class="tile-meta"><strong>${label}</strong><span>${type}</span></div></li>`).join("")}</ul>`;
  return card("make", "Start with a prompt",
    "Describe an icon, character, interface or scene. Your agent writes the scene file, checks it and exports the animation.",
    `<p class="prompt-bar" data-shared="example-prompt">${esc(examplePrompt)}</p>${grid}`);
}

function motionCard() {
  return card("move", `${ALL_PRESET_NAMES.length} ways to move`,
    `Entrances, exits, emphasis and character rigs, with ${EASING_NAMES.length} easings shared by Lottie and CSS.`,
    stage(art("bento-m-showreel", "A koi swims around a lotus")));
}

function artworkCard() {
  const compare = (before, after) => stage(`<figure>${before}<figcaption>Source</figcaption></figure><figure>${after}<figcaption>Animated</figcaption></figure>`, "comparison");
  return card("art", "Animate your artwork",
    "Bring a logo, illustration, cutout, Lottie file or reference clip into a scene.",
    `<div class="split">${compare(still("animations/media/source-art.svg", "Original SVG illustration"), art("w3c-demo", "Imported illustration in motion", "gallery"))}` +
    codePanel(["gertie import artwork.svg", "gertie trace logo.png", "gertie cutout painting.png parts.json", "gertie retime animation.json --speed 1.5", "gertie study clip.mp4"]) + "</div>");
}

function exportCard() {
  const formatLabel = { lottie: "Lottie", svg: "SVG", "lottie-zip": ".lottie", gif: "GIF", apng: "APNG", webp: "WebP", webm: "WebM", prores: "ProRes 4444", hevc: "HEVC", mp4: "MP4" };
  const embed = ['<img src="animation.svg" alt="Loading">', "![Loading](animation.svg)"];
  return card("export", "Export for any screen",
    `One scene exports to ${FORMAT_IDS.length} formats and ${Object.keys(DESTINATIONS).length} destination presets, with transparency where the format allows.`,
    `<div class="split">${stage(art("char-blob-wave", "Animated SVG mascot"))}<div class="stack">${codePanel(embed)}${textLine(FORMAT_IDS.map(id => formatLabel[id] ?? id))}</div></div>`);
}

export function agentCard() {
  return `<article class="feature-demo" id="agent">
    <div class="agent-copy">
      <header class="feature-intro"><h3>Add it to your agent</h3><p>One command installs the skill. Then ask for an animation in plain words. No account, no API key.</p></header>
      ${commandBox("agent")}
      <p class="list-line">Works in Claude Code and Codex CLI. Needs Node 22 or newer; Playwright (render checks) and ffmpeg (video and GIF) are used when present. Run <code>gertie doctor</code> to check.</p>
    </div>
    <div class="feature-preview">${stage(art("bento-install", "A terminal installs the skill, asks for a loading spinner, then shows the loop checked and spinner.svg exported"), "terminal-stage")}</div>
  </article>`;
}

function threeCard() {
  return card("three", "Build in 3D",
    "Animate modeled characters and objects in a standalone Three.js player.",
    stage(art("bento-3d-robot", "Mint-green 3D robot swaying at its desktop console"), "three-stage"),
    guide("gallery/desktop-robot.html", "Play the 3D robot"));
}

export function featureCards() {
  return [makeCard(), threeCard(), motionCard(), artworkCard(), exportCard()].join("\n");
}
