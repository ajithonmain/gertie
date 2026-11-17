# Video composition

A scene is one animation of a few seconds. A video is several scenes in sequence with titles, captions, transitions and sound. This document describes the layer that turns scenes into videos.

Gertie's own job is the animated pieces. For assembling a full video it offers two routes:

1. **Built-in sequencer.** Simple, no extra dependency beyond ffmpeg. Scenes play one after another with cuts or crossfades, optional captions and an audio track.
2. **HyperFrames adapter.** For richer videos, Gertie generates a project for HyperFrames, an open-source framework that renders HTML to video, and lets it do the composition.

## The storyboard file

Both routes start from one file, extension `.story.json`.

```json
{
  "story": 1,
  "name": "app-intro",
  "canvas": { "w": 1080, "h": 1920, "background": "#0b0f19" },
  "fps": 30,
  "audio": { "src": "music.mp3", "volume": 0.6, "fadeOut": 1.0 },
  "scenes": [
    { "id": "hook", "src": "scenes/hook.gertie.json", "duration": 3.0,
      "caption": "Tired of spreadsheets?",
      "transition": { "type": "fade", "duration": 0.4 } },
    { "id": "demo", "src": "scenes/demo.gertie.json", "duration": 5.0,
      "caption": "Meet Tally.",
      "transition": { "type": "slide-left", "duration": 0.5 } },
    { "id": "cta", "src": "scenes/cta.gertie.json", "duration": 3.0 }
  ],
  "captions": { "position": "bottom", "size": 56, "color": "#ffffff", "font": "fonts/Inter-Bold.ttf" }
}
```

| Field | Meaning |
|---|---|
| `canvas`, `fps` | The video's size and frame rate |
| `scenes[].src` | A scene file |
| `scenes[].duration` | How long the scene is shown. If longer than the scene's own duration, a looping scene repeats and a non-looping scene holds its last frame. May be left out when the scene compiles: the scene's own length is used |
| `scenes[].fit` | `"contain"` (default), `"cover"` or `"none"`: how a scene of a different size is placed on the video canvas |
| `scenes[].caption` | Text shown during the scene |
| `scenes[].transition` | How this scene gives way to the next: `cut` (default), `fade`, `slide-left`, `slide-right`, `slide-up`, `wipe` |
| `audio` | One background track: `src`, `volume` (default 1), `fadeIn` and `fadeOut` in seconds |
| `captions` | `position` (`bottom`, `center`, `top`), `size`, `color`, `font` (a .ttf, .otf or .ttc), and `box` (true draws a dark box behind the text; the default is a drop shadow) |

Common sizes: 1080 by 1920 for reels and shorts, 1920 by 1080 for landscape, 1080 by 1080 for square posts.

The storyboard has its own lint (`src/story/lint.ts`, pure). Errors: unknown fields (with the closest name), wrong types and ranges, odd canvas sizes, duplicate scene ids, missing scene, font or audio files, a transition longer than either neighbouring scene, a scene too short to hold both its incoming and outgoing transition, more than 120 seconds in total, a scene that does not compile (`E-STORY-SCENE`) and a scene that fails `qa` (`E-STORY-QA`). Warnings: more than 40 seconds, a scene whose shape differs from the video's under `contain` (bars), a scene longer than its slot (its end is never seen), a transition on the last scene (ignored), a duration on a cut, audio fades longer than the video. The codes are listed in `skills/gertie/references/video.md`.

All times are converted to whole frames at the video's frame rate once, in the linter. Nothing after it rounds.

## Route 1: the built-in sequencer

`gertie story video.story.json --out video.mp4`

1. Run `gertie qa` on every scene. Stop if any scene fails.
2. Render each scene's frames at the video's size and frame rate, onto the story background.
3. Encode each scene to an intermediate clip.
4. Join the clips with ffmpeg's `xfade` filter for transitions, or simple concatenation for cuts.
5. Burn in captions with ffmpeg's `drawtext` filter, using the font file named in the storyboard.
6. Mix the audio track, trimmed to the video length with the fade applied.
7. Encode H.264 MP4 with AAC audio.

The transition names map onto `xfade` transition types (`fade`, `slideleft`, `slideright`, `slideup`, `wipeleft`).

**Built and verified (phase 7).** `src/story/` holds the linter, the timeline plan (`plan.ts`), caption helpers, the sequencer (`sequence.ts`) and the adapter (`hyperframes.ts`); the command is `src/cli/lib/story-command.ts`. Differences from the list above and what was learned:

- *Frames, not intermediate clips.* Step 3 of the list became: each scene's frames are rendered at the video's frame rate and size straight into one ffmpeg run with one input per scene, instead of encoding an intermediate clip per scene. This avoids a generation of compression. A scene is rendered at the pixel density that fits it to the canvas (`contain`, `cover`) so vectors stay sharp, capped at 4096 pixels on a side. Looping scenes repeat and one-shot scenes hold their last frame, chosen frame by frame (`sceneFrameAt`), so a scene at 24 fps in a 30 fps video is sampled at fractional frames.
- *`xfade` offsets verified.* The offset of the transition into scene i is the length of the stream built so far minus the transition length, in frames converted to seconds; a cut is a `concat` and gives back no frames. The boundary test (three solid-colour scenes, a fade and a slide) reads pixels from the decoded MP4: the frame counts and every boundary match the plan exactly (`docs/08-testing.md`).
- *Three ffmpeg traps found, all fixed.* (1) `overlay=shortest=1` drops the last frame of every scene; the sequencer ends the background source at the right length instead. (2) `xfade` and `concat` outputs have no declared frame rate and a second `xfade` then fails with "The inputs needs to be a constant frame rate; current rate of 1/0 is invalid"; each join ends in `fps`. (3) `setpts` after `fps` also loses the rate; the order is `setpts` then `fps`.
- *`drawtext` verified on ffmpeg 7.1.1 with libfreetype.* Caption text and the font are put in the work folder and read through `textfile` and `fontfile` by relative name, so nothing needs filter escaping, and `expansion=none` stops `%` from being read as a format. The caption is visible by frame number (`enable='between(n,a,b)'`) during the scene's clean window only, not during its transitions. Wrapping is an estimate of glyph width (0.6 of the font size) because `drawtext` does not wrap; `text_align=center` is used when the ffmpeg build has it (6.1 or newer). Without `captions.font`, a bold system sans-serif is used and the output says which. `gertie doctor` reports `xfade`, `drawtext`, libx264 and the AAC encoder under `story`.
- *Audio.* Trimmed or padded with silence to the exact video length, with volume and fades; a file with no audio stream is an error that says so.
- *`gertie story` runs `qa` on every scene first* and stops, naming the scene, if one fails (`--no-qa` skips it). It writes the MP4 and `<name>.sheet.png`, the contact sheet of one frame from the middle of each scene and one from the middle of each transition.

The sequencer is deliberately limited: one scene at a time, one caption per scene, one audio track. That covers most short social videos. Anything beyond it goes to route 2.

## Route 2: the HyperFrames adapter

HyperFrames is an open-source framework from HeyGen, released in 2026 under the Apache 2.0 licence according to its repository listing. A video is written as an HTML page; the framework renders it to MP4 deterministically with a headless browser and ffmpeg. It is reported to support Lottie playback, GSAP and other browser animation libraries.

Repository: https://github.com/heygen-com/hyperframes

**What was checked on 14 November 2026, from the repository and its documentation (not from secondary sources):**

- *Licence:* the repository's `LICENSE` file is the Apache License 2.0, and the npm package `hyperframes` (version 0.9.42 that day) declares `node >=22`. Gertie does not bundle, vendor or copy any of it.
- *Composition format:* an HTML file whose root has `data-composition-id`, `data-start`, `data-width`, `data-height` and `data-duration`. Timed elements carry `class="clip"`, `data-start`, `data-duration` and `data-track-index`. A nested composition is a `<div>` with `data-composition-id` and `data-composition-src` naming a file whose content is wrapped in a `<template>`; timing inside it is local to that file. Animation is a paused GSAP timeline registered as `window.__timelines["<composition-id>"]`. Audio is an `<audio>` element with `data-start`, `data-duration`, `data-volume`, `data-fade-in` and `data-fade-out`. Rendering never plays: it seeks frame by frame.
- *Lottie:* the runtime seeks every Lottie player pushed onto `window.__hfLottie` to composition time. Its own catalog example (`lottie-character-walk`) loads `lottie-web` from a CDN, loads the animation with `autoplay: false`, and registers it there.
- *Render command:* `hyperframes render --output <file>` renders `index.html` to MP4 (also `--format webm|mov|gif|png-sequence`); `hyperframes lint` checks the HTML without a browser.
- *Its own skill:* HyperFrames ships agent skills (`npx skills add heygen-com/hyperframes`, the `/hyperframes` skill). Gertie's adapter does not replace or duplicate them: it only produces a starting project and the Lottie assets. An agent that edits the project should use HyperFrames' own skill for that.

**Verified against HyperFrames 0.9.43 (phase 7, step 2).** `npm install --save-dev hyperframes` (74 packages), then `gertie story examples/story/app-intro.story.json --engine hyperframes --out /tmp/hf-project`, then `hyperframes lint` and `hyperframes render --output video.mp4` in the project, with no edits. Lint reported 0 errors and 0 warnings. The render produced a 540 by 960 H.264 MP4 of 303 frames (10.1 s) with an AAC track, in about 18 s. The five questions that were open:

1. Lint and render accept the project unmodified: **yes.**
2. A Lottie player in a nested composition is seeked to the composition's local time: **yes.** Frames at 0, 40, 100, 150, 200 and 280 show each scene's animation at the same phase as the built-in render (structural similarity 0.93 to 0.96, the gap being text rendering and caption box width).
3. A nested-composition host can be animated from the root timeline: **yes.** The fade (frames 78 to 90) and the slide-left (frames 213 to 228) match the built-in render, with similarity 0.98 to 0.999 inside the transitions.
4. Whether `data-fps` is honoured: **not distinguished.** The render came out at 30 fps, which is also HyperFrames' default. A storyboard at a different fps has not been tried.
5. A scene shorter than its slot holds its last frame in this route: **by design, not tested.**

Known difference from the built-in route: the caption box spans the full caption width in HyperFrames, while the built-in route fits the box to the text. Both are readable; if the box matters, edit the HTML.

Gertie finds HyperFrames on the path or in the project's `node_modules/.bin`.

### What the adapter does

`gertie story video.story.json --engine hyperframes --out project/`

1. Compile every scene to Lottie JSON.
2. Generate a HyperFrames project directory: an HTML composition that places each scene's Lottie on the timeline at its start time, with captions as HTML text and transitions as CSS or GSAP animations, following HyperFrames' conventions.
3. Copy the Lottie files, fonts and audio into the project.
4. Print the HyperFrames command that renders it. With `--render`, run that command.

Gertie does not bundle HyperFrames or copy its code. It detects whether the `hyperframes` command is on the path, and if not, explains how to install it. With `--render` and no `hyperframes` command, `gertie story` still writes the project and exits with code 2 and the install instruction. Transitions are GSAP tweens on the scene elements (opacity for `fade`, `xPercent` or `yPercent` for the slides, `clipPath` for `wipe`), which approximate `xfade`'s; the Lottie player is local (`assets/lottie.min.js`, the build Gertie renders with) and GSAP is loaded from jsdelivr as HyperFrames' own examples do.

### Why use it

Because the composition is an HTML page, the agent can then edit it freely: several animations on screen at once, animated typography, charts, screen recordings, layouts that the storyboard format cannot describe. Gertie produces the starting project and the animated assets; HyperFrames and the agent take it from there.

## Remotion

Remotion is a mature alternative that composes video with React. Its licence is free for individuals and for companies of up to three people; larger companies need a paid licence.

**Decision: Remotion is not a default and Gertie does not depend on it.** A skill described as free for anyone cannot route users into a paid licence without warning. A Remotion adapter may be added later as an option, and if so the command must print the licence condition every time it is used. Gertie's Lottie output works in Remotion through its `@remotion/lottie` package without any adapter, and the reference text says so.

## Captions from speech

Out of scope for version 1. The storyboard takes caption text directly. A later version could accept a subtitle file (`.srt`) with timed captions that span scenes.

## Voiceover

Out of scope for version 1. The audio field accepts one finished file. Users who want narration record or generate it elsewhere and supply the file.

## What the agent does

This procedure goes into `skills/gertie/references/video.md`:

1. Agree a short outline with the user: scenes, what each shows, how long, the caption for each.
2. Write each scene as its own `.gertie.json` and get each through `gertie qa`.
3. Write the storyboard.
4. Run `gertie story`. Look at the storyboard contact sheet (one frame from the middle of each scene and one from each transition).
5. Deliver the MP4.

Keep videos short. Six scenes of three to five seconds is a comfortable upper size for one request.
