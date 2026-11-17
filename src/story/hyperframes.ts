import { basename, extname } from "node:path";
import type { ScenePlan, StoryPlan } from "./plan.ts";
import type { NStory, TransitionType } from "./types.ts";

/**
 * The HyperFrames adapter. It writes a project directory that follows HyperFrames' documented composition
 * format (https://hyperframes.heygen.com/concepts/compositions and /reference/html-schema, read 14 November 2026):
 *
 * - `index.html` is the root composition. Every scene is a nested composition mounted with `data-composition-src`.
 * - Timing is declared with `data-start` and `data-duration`; animation is a paused GSAP timeline registered on
 *   `window.__timelines`; Lottie players are pushed onto `window.__hfLottie`, which the runtime seeks.
 *
 * Nothing here is copied from HyperFrames. The output was linted and rendered with HyperFrames 0.9.43
 * unmodified: see `docs/11-video-composition.md`.
 */

export interface ProjectFile {
  /** Path inside the project, forward slashes. */
  path: string;
  data: string | Buffer;
}

export interface SceneForProject {
  id: string;
  /** The compiled Lottie document, as JSON text. */
  lottieJson: string;
  w: number;
  h: number;
  fps: number;
  totalFrames: number;
  loop: boolean;
}

export interface ProjectRequest {
  story: NStory;
  plan: StoryPlan;
  scenes: ReadonlyMap<string, SceneForProject>;
  /** Contents of lottie.min.js, copied into the project so rendering needs no network for Lottie. */
  lottieLib: string;
  /** The caption font file, if the storyboard names one. */
  font?: { name: string; data: Buffer };
  /** The audio file, if the storyboard names one. */
  audio?: { name: string; data: Buffer };
}

export const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const sec = (frames: number, fps: number): number => Math.round((frames / fps) * 1e6) / 1e6;
/** JSON that is safe inside an HTML script element. */
const scriptJson = (v: unknown): string => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/** The size, in canvas pixels, that a scene occupies for its `fit`. */
export function sceneBox(s: ScenePlan, scene: { w: number; h: number }, canvas: { w: number; h: number }): { w: number; h: number } {
  const k = s.fit === "none" ? 1 : s.fit === "cover" ? Math.max(canvas.w / scene.w, canvas.h / scene.h) : Math.min(canvas.w / scene.w, canvas.h / scene.h);
  return { w: Math.round(scene.w * k), h: Math.round(scene.h * k) };
}

function sceneComposition(s: ScenePlan, scene: SceneForProject, story: NStory): string {
  const box = sceneBox(s, scene, story.canvas);
  const secs = sec(s.frames, story.fps);
  return `<template id="${esc(s.id)}-template">
  <div data-composition-id="${esc(s.id)}" data-width="${story.canvas.w}" data-height="${story.canvas.h}">
    <div class="gertie-stage">
      <div class="gertie-scene" style="width:${box.w}px;height:${box.h}px;"></div>
    </div>

    <style>
      [data-composition-id="${esc(s.id)}"] { position: relative; width: ${story.canvas.w}px; height: ${story.canvas.h}px; overflow: hidden; }
      [data-composition-id="${esc(s.id)}"] .gertie-stage { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; }
      [data-composition-id="${esc(s.id)}"] .gertie-scene { flex: none; }
    </style>

    <script>
      (function () {
        var data = ${scriptJson(JSON.parse(scene.lottieJson))};
        var root = document.querySelector('[data-composition-id="${esc(s.id)}"]');
        var anim = lottie.loadAnimation({
          container: root.querySelector(".gertie-scene"),
          renderer: "svg",
          loop: false,
          autoplay: false,
          animationData: data
        });
        // The runtime seeks every player on window.__hfLottie to composition time.
        window.__hfLottie = window.__hfLottie || [];
        window.__hfLottie.push(anim);

        // A composition needs a timeline of its own length; the Lottie player is seeked by the runtime.
        var tl = gsap.timeline({ paused: true });
        tl.to({}, { duration: ${secs} }, 0);
        window.__timelines = window.__timelines || {};
        window.__timelines["${esc(s.id)}"] = tl;
      })();
    </script>
  </div>
</template>
`;
}

/** Entry and exit motion for a transition. `in` is applied to the incoming scene, `out` to the outgoing one. */
export function transitionMotion(type: TransitionType): { out: Record<string, string | number>; inFrom: Record<string, string | number>; inTo: Record<string, string | number> } | undefined {
  switch (type) {
    case "fade":
      return { out: { opacity: 0 }, inFrom: { opacity: 0 }, inTo: { opacity: 1 } };
    case "slide-left":
      return { out: { xPercent: -100 }, inFrom: { xPercent: 100 }, inTo: { xPercent: 0 } };
    case "slide-right":
      return { out: { xPercent: 100 }, inFrom: { xPercent: -100 }, inTo: { xPercent: 0 } };
    case "slide-up":
      return { out: { yPercent: -100 }, inFrom: { yPercent: 100 }, inTo: { yPercent: 0 } };
    case "wipe":
      return { out: {}, inFrom: { clipPath: "inset(0 0 0 100%)" }, inTo: { clipPath: "inset(0 0 0 0%)" } };
    default:
      return undefined;
  }
}

function rootComposition(story: NStory, plan: StoryPlan, fontPath: string | undefined, audio: { name: string } | undefined): string {
  const { w, h, background } = story.canvas;
  const total = sec(plan.totalFrames, story.fps);
  const c = story.captions;
  const hasFont = fontPath !== undefined;
  const fontFamily = hasFont ? `"GertieCaption", sans-serif` : `system-ui, -apple-system, "Segoe UI", Arial, sans-serif`;
  const margin = Math.round(h * 0.08);
  const pos = c.position === "top" ? `top: ${margin}px;` : c.position === "center" ? "top: 50%; transform: translateY(-50%);" : `bottom: ${margin}px;`;
  const box = c.box ? `background: rgba(0,0,0,0.55); padding: ${Math.round(c.size * 0.35)}px; border-radius: ${Math.round(c.size * 0.2)}px;` : `text-shadow: ${Math.max(1, Math.round(c.size / 28))}px ${Math.max(1, Math.round(c.size / 28))}px 0 rgba(0,0,0,0.7);`;

  const scenes = plan.scenes
    .map((s) => `      <div id="scene-${esc(s.id)}" class="clip scene" data-composition-id="${esc(s.id)}" data-composition-src="compositions/${esc(s.id)}.html" data-start="${sec(s.start, story.fps)}" data-duration="${sec(s.frames, story.fps)}" data-track-index="1" data-width="${w}" data-height="${h}"></div>`)
    .join("\n");

  const captions = plan.scenes
    .filter((s) => s.caption !== null && s.clean[1] > s.clean[0])
    .map((s) => `      <div id="caption-${esc(s.id)}" class="clip caption" data-start="${sec(s.clean[0], story.fps)}" data-duration="${sec(s.clean[1] - s.clean[0], story.fps)}" data-track-index="2"><span>${esc(s.caption as string).replace(/\n/g, "<br>")}</span></div>`)
    .join("\n");

  const steps: string[] = [];
  plan.scenes.forEach((s, i) => {
    const next = plan.scenes[i + 1];
    if (!next || s.out.frames === 0) return;
    const m = transitionMotion(s.out.type);
    if (!m) return;
    const at = sec(next.start, story.fps);
    const d = sec(s.out.frames, story.fps);
    steps.push(`      tl.fromTo("#scene-${s.id}", { opacity: 1, xPercent: 0, yPercent: 0 }, { ...${scriptJson({ opacity: 1, xPercent: 0, yPercent: 0, ...m.out })}, duration: ${d}, ease: "none", immediateRender: false }, ${at});`);
    steps.push(`      tl.fromTo("#scene-${next.id}", ${scriptJson({ ...({ opacity: 1, xPercent: 0, yPercent: 0, clipPath: "inset(0 0 0 0%)" } as Record<string, unknown>), ...m.inFrom })}, { ...${scriptJson(m.inTo)}, duration: ${d}, ease: "none" }, ${at});`);
  });

  const audioTag = audio && story.audio ? `\n      <audio id="music" src="assets/${esc(audio.name)}" data-start="0" data-duration="${total}" data-track-index="9" data-volume="${story.audio.volume}"${story.audio.fadeIn > 0 ? ` data-fade-in="${story.audio.fadeIn}"` : ""}${story.audio.fadeOut > 0 ? ` data-fade-out="${story.audio.fadeOut}"` : ""}></audio>` : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${w}, height=${h}" />
    <title>${esc(story.name)}</title>
    <script src="${GSAP_URL}"></script>
    <script src="assets/lottie.min.js"></script>
    <style>
      ${fontPath ? `@font-face { font-family: "GertieCaption"; src: url("${fontPath}") format("${extname(fontPath).toLowerCase() === ".otf" ? "opentype" : "truetype"}"); }\n      ` : ""}* { margin: 0; padding: 0; box-sizing: border-box; }
      body { margin: 0; }
      #root { position: relative; width: ${w}px; height: ${h}px; overflow: hidden; background: ${background}; isolation: isolate; }
      .scene { position: absolute; inset: 0; }
      .caption { position: absolute; left: 0; right: 0; display: flex; justify-content: center; ${pos} z-index: 10; text-align: center; font-family: ${fontFamily}; font-weight: 700; font-size: ${c.size}px; line-height: 1.25; color: ${c.color}; }
      .caption span { display: inline-block; max-width: ${Math.round(w * 0.86)}px; ${box} }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="${w}" data-height="${h}" data-fps="${story.fps}">
${scenes}
${captions}${audioTag}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      var tl = gsap.timeline({ paused: true });
${steps.join("\n")}
      tl.to({}, { duration: 0 }, ${total});
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;
}

/** Everything the project needs, as a list of files. Pure: the caller writes them. */
export function buildHyperframesProject(req: ProjectRequest): ProjectFile[] {
  const { story, plan } = req;
  const files: ProjectFile[] = [];
  const fontPath = req.font ? `assets/fonts/${req.font.name}` : undefined;
  const index = rootComposition(story, plan, fontPath, req.audio ? { name: req.audio.name } : undefined);
  files.push({ path: "index.html", data: index });
  for (const s of plan.scenes) {
    const scene = req.scenes.get(s.id);
    if (!scene) throw new Error(`Scene '${s.id}' was not compiled.`);
    files.push({ path: `compositions/${s.id}.html`, data: sceneComposition(s, scene, story) });
    files.push({ path: `assets/${s.id}.lottie.json`, data: scene.lottieJson });
  }
  files.push({ path: "assets/lottie.min.js", data: req.lottieLib });
  if (req.font && fontPath) files.push({ path: fontPath, data: req.font.data });
  if (req.audio) files.push({ path: `assets/${req.audio.name}`, data: req.audio.data });
  files.push({ path: "README.md", data: projectReadme(story, plan) });
  return files;
}

function projectReadme(story: NStory, plan: StoryPlan): string {
  const secs = Math.round((plan.totalFrames / story.fps) * 100) / 100;
  return `# ${story.name}

A HyperFrames project generated by Gertie from \`${story.name}.story.json\`. ${plan.scenes.length} scenes, ${secs} seconds, ${story.canvas.w}x${story.canvas.h} at ${story.fps} fps.

- \`index.html\` is the root composition: scene timing, captions, transitions and audio.
- \`compositions/<scene>.html\` plays one Gertie scene as Lottie.
- \`assets/\` holds the compiled Lottie files, the Lottie player, and any font and audio.

Render:

    hyperframes render --output video.mp4

Install HyperFrames first if the command is not found (it needs Node 22 or newer and ffmpeg): \`npm install -g hyperframes\`, or run it without installing as \`npx hyperframes render --output video.mp4\`.

The project is yours to edit. To change a scene's animation, edit the scene's \`.gertie.json\` in the storyboard project and run \`gertie story\` again; edit the HTML here for anything the storyboard cannot say.
`;
}

/** Name for a copied asset: the original file name, safe for a URL. */
export function assetName(path: string): string {
  return basename(path).replace(/[^A-Za-z0-9._-]/g, "_");
}
