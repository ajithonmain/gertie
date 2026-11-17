import { test } from "node:test";
import assert from "node:assert/strict";
import { lintStory, toFrames, totalFrames, type SceneFacts } from "../../src/story/lint.ts";
import { joinFilters, planStory, sceneFrameAt } from "../../src/story/plan.ts";
import { captionY, wrapCaption } from "../../src/story/captions.ts";
import { audioFilter, captionFilters, renderScale, sceneFilter, sheetFrames } from "../../src/story/sequence.ts";
import { buildHyperframesProject, sceneBox, transitionMotion } from "../../src/story/hyperframes.ts";

const base = () => ({
  story: 1,
  name: "demo",
  canvas: { w: 1080, h: 1920, background: "#0b0f19" },
  fps: 30,
  scenes: [
    { id: "hook", src: "a.gertie.json", duration: 3, caption: "Tired of spreadsheets?", transition: { type: "fade", duration: 0.4 } },
    { id: "demo", src: "b.gertie.json", duration: 5, caption: "Meet Tally.", transition: { type: "slide-left", duration: 0.5 } },
    { id: "cta", src: "c.gertie.json", duration: 3 },
  ],
});
const exists = () => true;
const codes = (raw: unknown, opts = { fileExists: exists }) => lintStory(raw, opts).diagnostics.map((d) => d.code);

test("a valid storyboard normalizes times to frames and fills defaults", () => {
  const r = lintStory(base(), { fileExists: exists });
  assert.deepEqual(r.diagnostics, []);
  const s = r.story!;
  assert.deepEqual(s.scenes.map((x) => x.frames), [90, 150, 90]);
  assert.deepEqual(s.scenes.map((x) => x.transition), [{ type: "fade", frames: 12 }, { type: "slide-left", frames: 15 }, { type: "cut", frames: 0 }]);
  assert.equal(s.scenes[0]!.fit, "contain");
  assert.equal(s.captions.position, "bottom");
  assert.equal(s.canvas.background, "#0b0f19");
});

test("total length subtracts every transition overlap", () => {
  const s = lintStory(base(), { fileExists: exists }).story!;
  assert.equal(totalFrames(s.scenes), 90 + 150 + 90 - 12 - 15);
});

test("unknown fields are reported with the closest name", () => {
  const b = { ...base(), scens: [] } as Record<string, unknown>;
  const d = lintStory(b, { fileExists: exists }).diagnostics.find((x) => x.code === "E-STORY-UNKNOWN");
  assert.ok(d);
  assert.match(d.message, /did you mean 'scenes'/);
});

test("a missing scene file, font and audio file are errors that name the path", () => {
  const b = base() as Record<string, unknown>;
  b["captions"] = { font: "fonts/Inter.ttf" };
  b["audio"] = { src: "music.mp3" };
  const r = lintStory(b, { fileExists: (p) => p === "b.gertie.json" || p === "c.gertie.json" });
  const msgs = r.diagnostics.filter((d) => d.code === "E-STORY-FILE").map((d) => d.message).join("\n");
  assert.match(msgs, /a\.gertie\.json/);
  assert.match(msgs, /fonts\/Inter\.ttf/);
  assert.match(msgs, /music\.mp3/);
  assert.equal(r.story, undefined);
});

test("a transition longer than a neighbouring scene is an error", () => {
  const b = base();
  b.scenes[0]!.transition = { type: "fade", duration: 3.5 };
  assert.ok(codes(b).includes("E-STORY-TRANSITION"), "longer than the scene it ends");
  const c = base();
  c.scenes[1]!.duration = 0.3;
  c.scenes[0]!.transition = { type: "fade", duration: 0.4 };
  assert.ok(codes(c).includes("E-STORY-TRANSITION"), "longer than the scene it leads into");
});

test("a scene must hold both its incoming and outgoing transition", () => {
  const b = base();
  b.scenes[1]!.duration = 0.8;
  b.scenes[0]!.transition = { type: "fade", duration: 0.5 };
  b.scenes[1]!.transition = { type: "fade", duration: 0.5 };
  const d = lintStory(b, { fileExists: exists }).diagnostics.find((x) => x.code === "E-STORY-TRANSITION");
  assert.ok(d);
  assert.match(d.message, /must hold both/);
});

test("a transition on the last scene warns and is dropped", () => {
  const b = base();
  b.scenes[2] = { ...b.scenes[2]!, transition: { type: "fade", duration: 0.4 } } as never;
  const r = lintStory(b, { fileExists: exists });
  assert.ok(r.diagnostics.some((d) => d.code === "W-STORY-TRANSITION-LAST"));
  assert.equal(r.story!.scenes[2]!.transition.type, "cut");
});

test("transition types and fit values are checked, with a suggestion", () => {
  const b = base();
  b.scenes[0]!.transition = { type: "fadee", duration: 0.4 };
  const d = lintStory(b, { fileExists: exists }).diagnostics.find((x) => x.code === "E-STORY-ENUM");
  assert.match(d!.message, /did you mean 'fade'/);
  const c = base() as { scenes: Record<string, unknown>[] };
  c.scenes[0]!["fit"] = "stretch";
  assert.ok(codes(c).includes("E-STORY-ENUM"));
});

test("duplicate ids, odd canvas sizes, bad colours and a missing version are errors", () => {
  const b = base();
  b.scenes[1]!.id = "hook";
  assert.ok(codes(b).includes("E-STORY-DUPLICATE"));
  const c = base();
  c.canvas.w = 1081;
  assert.ok(codes(c).includes("E-STORY-RANGE"));
  const d = base();
  d.canvas.background = "red";
  assert.ok(codes(d).includes("E-STORY-COLOR"));
  const e = { ...base(), story: undefined };
  assert.ok(codes(e).includes("E-STORY-VERSION"));
});

test("a long video warns and an over-long one is an error", () => {
  const b = base();
  b.scenes[0]!.duration = 40;
  assert.ok(codes(b).includes("W-STORY-LONG"));
  const c = base();
  c.scenes[0]!.duration = 60;
  c.scenes[1]!.duration = 60;
  c.scenes[2]!.duration = 60;
  assert.ok(codes(c).includes("E-STORY-LENGTH"));
});

test("scene facts add warnings about cut-off scenes and bars, and supply a missing duration", () => {
  const facts: Record<string, SceneFacts> = { "a.gertie.json": { w: 512, h: 512, seconds: 4, loop: true }, "b.gertie.json": { w: 1080, h: 1920, seconds: 5, loop: true }, "c.gertie.json": { w: 1080, h: 1920, seconds: 3, loop: false } };
  const r = lintStory(base(), { fileExists: exists, sceneFacts: (s) => facts[s] });
  const found = r.diagnostics.map((d) => d.code);
  assert.ok(found.includes("W-STORY-ASPECT"), "512x512 scene in a 9:16 video");
  assert.ok(found.includes("W-STORY-SCENE-CUT"), "3s of a 4s scene: the last second is never seen");
  const b = base();
  b.scenes[2] = { id: "cta", src: "c.gertie.json" } as never;
  assert.equal(lintStory(b, { fileExists: exists, sceneFacts: (s) => facts[s] }).story!.scenes[2]!.frames, 90, "duration defaults to the scene's own length");
  assert.ok(codes(b).includes("E-STORY-MISSING"), "without facts a missing duration is an error");
});

test("seconds round to whole frames and never to zero", () => {
  assert.equal(toFrames(0.4, 30), 12);
  assert.equal(toFrames(0.001, 30), 1);
  assert.equal(toFrames(1 / 24, 24), 1);
});

test("the plan places each scene after the previous one minus the transition", () => {
  const plan = planStory(lintStory(base(), { fileExists: exists }).story!);
  assert.deepEqual(plan.scenes.map((s) => s.start), [0, 78, 213]);
  assert.equal(plan.totalFrames, 303);
  assert.deepEqual(plan.scenes.map((s) => s.clean), [[0, 78], [90, 213], [228, 303]]);
});

test("xfade offsets are the length so far minus the transition, and cuts concatenate", () => {
  const plan = planStory(lintStory(base(), { fileExists: exists }).story!);
  const j = joinFilters(plan);
  assert.deepEqual(j.filters, [
    "[v0][v1]xfade=transition=fade:duration=0.4:offset=2.6,fps=30[j1]",
    "[j1][v2]xfade=transition=slideleft:duration=0.5:offset=7.1,fps=30[j2]",
  ]);
  assert.equal(j.label, "[j2]");
  const cut = base();
  cut.scenes[0]!.transition = { type: "cut" } as never;
  const j2 = joinFilters(planStory(lintStory(cut, { fileExists: exists }).story!));
  assert.equal(j2.filters[0], "[v0][v1]concat=n=2:v=1:a=0,fps=30[j1]");
  assert.match(j2.filters[1]!, /offset=7\.5[^0-9]/, "the cut gives back no frames, so the next offset moves");
});

test("a looping scene repeats, a one-shot scene holds its last frame, and frame rates convert", () => {
  assert.equal(sceneFrameAt(0, 30, 30, 60, true), 0);
  assert.equal(sceneFrameAt(65, 30, 30, 60, true), 5);
  assert.equal(sceneFrameAt(500, 30, 30, 60, false), 59);
  assert.equal(sceneFrameAt(30, 30, 24, 60, true), 24, "one second of a 24 fps scene is 24 of its frames");
  assert.equal(sceneFrameAt(45, 30, 24, 24, true), 12, "wraps after one second");
});

test("captions wrap to the width and keep explicit line breaks", () => {
  const lines = wrapCaption("Tired of spreadsheets and the endless copying between them", 40, 600);
  assert.ok(lines.length >= 2);
  assert.ok(lines.every((l) => l.length <= Math.floor(600 / (40 * 0.6))));
  assert.deepEqual(wrapCaption("one\ntwo", 40, 1000), ["one", "two"]);
  assert.deepEqual(wrapCaption("extraordinarilylongword", 40, 100), ["extraordinarilylongword"]);
  assert.equal(captionY("bottom", 1000), "h-text_h-80");
  assert.equal(captionY("top", 1000), "80");
});

test("the scene filter fits, covers or centres a scene on the background", () => {
  const story = lintStory(base(), { fileExists: exists }).story!;
  const plan = planStory(story);
  assert.match(sceneFilter(0, plan.scenes[0]!, story), /color=c=0x0b0f19:s=1080x1920:r=30:d=3\[bg0\].*scale=1080:1920:force_original_aspect_ratio=decrease/);
  const cover = { ...plan.scenes[0]!, fit: "cover" as const };
  assert.match(sceneFilter(0, cover, story), /force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920/);
  const none = { ...plan.scenes[0]!, fit: "none" as const };
  assert.match(sceneFilter(0, none, story), /format=rgba,null\[fg0\]/);
  assert.equal(renderScale("contain", { w: 540, h: 960 }, { w: 1080, h: 1920 }), 2);
  assert.equal(renderScale("cover", { w: 100, h: 100 }, { w: 1080, h: 1920 }), 19.2);
  assert.equal(renderScale("none", { w: 100, h: 100 }, { w: 1080, h: 1920 }), 1);
  assert.equal(renderScale("cover", { w: 1, h: 2 }, { w: 3840, h: 3840 }), 2048, "capped so the largest side stays at 4096 px");
});

test("caption filters show the text only inside the clean window, by frame number", () => {
  const story = lintStory(base(), { fileExists: exists }).story!;
  const f = captionFilters([{ file: "cap0.txt", text: "x", from: 0, to: 78 }], story, "font.ttf", true);
  assert.equal(f.length, 1);
  assert.match(f[0]!, /textfile=cap0\.txt:expansion=none:fontsize=\d+/);
  assert.match(f[0]!, /enable='between\(n,0,77\)'/);
  assert.match(f[0]!, /text_align=center/);
  assert.match(captionFilters([{ file: "c", text: "x", from: 1, to: 2 }], story, "f.ttf", false)[0]!, /^(?!.*text_align)/);
});

test("the audio chain pads or trims to the video length and fades out at the end", () => {
  const a = audioFilter(3, { src: "m.mp3", volume: 0.6, fadeIn: 0, fadeOut: 1 }, 10.1);
  assert.equal(a, "[3:a]aresample=48000,apad=whole_dur=10.1,atrim=0:10.1,asetpts=PTS-STARTPTS,volume=0.6,afade=t=out:st=9.1:d=1[aout]");
  assert.match(audioFilter(1, { src: "m.mp3", volume: 1, fadeIn: 0.5, fadeOut: 0 }, 4), /afade=t=in:st=0:d=0\.5/);
});

test("the contact sheet picks a frame in each scene and in each transition", () => {
  const plan = planStory(lintStory(base(), { fileExists: exists }).story!);
  const picks = sheetFrames(plan);
  assert.equal(picks.length, 5);
  assert.deepEqual(picks.map((p) => p.frame), [39, 84, 151, 220, 265]);
  assert.ok(picks.every((p) => p.frame >= 0 && p.frame < plan.totalFrames));
});

test("the HyperFrames project times scenes, captions and audio with data attributes", () => {
  const story = lintStory({ ...base(), audio: { src: "m.mp3", volume: 0.5, fadeOut: 1 } }, { fileExists: exists }).story!;
  const plan = planStory(story);
  const scenes = new Map(story.scenes.map((s) => [s.id, { id: s.id, lottieJson: JSON.stringify({ v: "5.7.0", w: 540, h: 960, fr: 30, ip: 0, op: 90, layers: [], tricky: "</script>" }), w: 540, h: 960, fps: 30, totalFrames: 90, loop: true }]));
  const files = buildHyperframesProject({ story, plan, scenes, lottieLib: "/* lottie */", audio: { name: "m.mp3", data: Buffer.from("x") } });
  const paths = files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["README.md", "assets/cta.lottie.json", "assets/demo.lottie.json", "assets/hook.lottie.json", "assets/lottie.min.js", "assets/m.mp3", "compositions/cta.html", "compositions/demo.html", "compositions/hook.html", "index.html"]);
  const index = files.find((f) => f.path === "index.html")!.data as string;
  assert.match(index, /data-composition-id="main"[^>]*data-duration="10\.1"[^>]*data-width="1080"[^>]*data-height="1920"/);
  assert.match(index, /id="scene-demo" class="clip scene" data-composition-id="demo" data-composition-src="compositions\/demo\.html" data-start="2\.6" data-duration="5"/);
  assert.match(index, /id="scene-cta"[^>]*data-start="7\.1"/);
  assert.match(index, /id="caption-hook"[^>]*data-start="0" data-duration="2\.6"/);
  assert.match(index, /<audio id="music" src="assets\/m\.mp3" data-start="0" data-duration="10\.1" data-track-index="9" data-volume="0\.5" data-fade-out="1">/);
  assert.match(index, /window\.__timelines\["main"\] = tl;/);
  assert.match(index, /"#scene-demo"/);
  const scene = files.find((f) => f.path === "compositions/hook.html")!.data as string;
  assert.match(scene, /^<template id="hook-template">/);
  assert.match(scene, /window\.__hfLottie\.push\(anim\)/);
  assert.match(scene, /window\.__timelines\["hook"\] = tl;/);
  assert.ok(!scene.includes("</script>\"") && scene.includes("\\u003c/script>"), "JSON in a script element cannot close it");
});

test("each transition has entry and exit motion, and a cut has none", () => {
  assert.equal(transitionMotion("cut"), undefined);
  assert.deepEqual(transitionMotion("slide-left")!.inFrom, { xPercent: 100 });
  assert.deepEqual(transitionMotion("slide-left")!.out, { xPercent: -100 });
  assert.ok(transitionMotion("wipe")!.inFrom["clipPath"]);
  assert.deepEqual(sceneBox({ fit: "contain" } as never, { w: 540, h: 960 }, { w: 1080, h: 1920 }), { w: 1080, h: 1920 });
  assert.deepEqual(sceneBox({ fit: "cover" } as never, { w: 100, h: 100 }, { w: 1080, h: 1920 }), { w: 1920, h: 1920 });
});
