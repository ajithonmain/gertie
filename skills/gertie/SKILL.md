---
name: gertie
description: Create vector animations and export them as Lottie JSON and animated SVG. Use when the user asks for an animation, animated icon, loader, spinner, logo animation, sticker, motion graphic or any short looping vector animation. You write a small scene file; Gertie compiles it to valid Lottie JSON, renders it in a real browser, checks it and gives you a contact sheet image to look at. Free alternative to paid AI animation tools. Requires Node 22 and a shell.
---

# Gertie

Gertie turns a small scene file that you write into a finished animation, as Lottie JSON and as an animated SVG. You decide what to draw and how it moves. Gertie compiles, checks and renders it.

This version covers writing, compiling, validating and quality-checking scenes, with both outputs, and exporting to GIF, APNG, WebP, WebM, ProRes, HEVC, MP4 and a `.lottie` archive, or straight to a platform with its limits (Telegram, Discord, Slack, WhatsApp and more), and building multi-scene videos with captions, transitions and music from a storyboard, and making text-character (ASCII) animation. Read `references/export.md` before exporting, `references/video.md` before making a video and `references/ascii.md` before making ASCII animation.

## Rules

1. Never write Lottie JSON by hand. Write a scene file and compile it.
2. Never present a result that did not pass `qa` with zero errors.
3. Read `references/scene.md` before writing your first scene. Models that skip it invent fields that do not exist.
4. If the user supplies an SVG, import it instead of redrawing it: read `references/import.md`.
5. If the user supplies a Lottie file, read `references/lottie.md`. Do not rewrite it by hand.
6. If the user supplies a PNG or JPEG logo, icon or flat illustration, trace it: read `references/trace.md`. If it is a painting or photo with texture and the user wants it to move a little (a blink, a head tilt, a drifting background), read `references/cutout.md`.
7. If the user shows a video or GIF and wants "something that moves like this", read `references/motion-reference.md`.
8. If the user wants a video of several scenes (an intro, a reel, an explainer, an ad) with captions, transitions or music, read `references/video.md`. Write one scene per file, then a `.story.json`, and run `story`.
9. If the user wants ASCII or text-character animation (a README banner, a terminal loader, a retro look, a dense colourful clip of characters or dots), or shows an ASCII clip to imitate, read `references/ascii.md`. It is a separate engine with its own scene file (`.ascii.json`) and commands. Small subjects: write frames in a text file or generate them. Anything dense or smooth: build a vector scene, pass `qa`, and convert it as a recipe. Several moving things: layers. To imitate a clip: `ascii probe` for its grid and colours. Never draw large shapes in characters.
10. Before drawing anything beyond a few shapes (a character, an illustration, a scene), read `references/artwork.md`: build order, curved paths, shading, palette, canvas size. Scenes made only of primitives or flat colour raise `W-ART-PRIMITIVE` and `W-ART-FLAT`.
11. Read `references/motion.md` before writing keyframes for anything beyond a plain spin or slide, and always for a character. Use motion presets and rig presets instead of hand-placed keyframes: they give the animation its ease, anticipation, overshoot and squash.

## Workflow

1. **Understand the request.** Settle the subject, the motion, the size, and whether it loops. Ask only if a missing answer would change the result. Otherwise use defaults: 512 by 512 canvas, 30 fps, 2 seconds, looping, transparent background.
2. **Write the scene** as `<name>.gertie.json`. If the user supplied an SVG, run `node scripts/gertie.mjs import <file.svg> --json` first and include the result (see `references/import.md`). Times are in seconds. Later nodes draw on top of earlier ones. Give things a `motion` preset where one fits. For a character, build a rig and use rig presets (`references/motion.md`).
3. **Check it.** Run the script at `scripts/gertie.mjs` inside this skill's folder:

       node scripts/gertie.mjs qa <name>.gertie.json --json

   This compiles the scene, validates the output, renders sampled frames in a browser and runs the render checks. Files go to `out/` next to the scene: `<name>.lottie.json`, `<name>.svg` and `<name>.sheet.png`. The check renders the Lottie and the SVG separately and compares them, frame by frame.
4. **Fix every diagnostic.** Each has a `code`, a `path` into your scene, a `message` and a `fix`. Apply the fix, edit the scene and run `qa` again. Fix errors first, then read the warnings. `W-LOOP-JUMP` and `W-R-LOOP` mean the loop visibly jumps; `W-R-CLIPPED` means something is cut off by the canvas edge. `W-SYNC` means three or more children of one group run the same loop in step, which looks mechanical: give the group a `stagger` with a `phase`, or give each entry its own `phase`. `E-R-PARITY` means the Lottie and the SVG look different, so one of the two outputs is wrong: it names the frame, a node and a diff image (`outputs.parity`). Simplify that node's animation to find the cause, and tell the user if it is a bug in Gertie.
5. **Look at it.** Open the contact sheet image named in `outputs.sheet`. It shows eight frames in order, each labelled with its frame number and time, drawn on a checkerboard so transparency is visible. Check that the right things are present, the colours are right, the motion between frames makes sense and nothing is cut off or overlapping. If it is not right, edit the scene and go back to step 3. Stop after three rounds of visual revision. Use `--sheet-frames 16` for more detail when debugging timing.
6. **Measure it against the quality bar** for anything beyond a quick icon. Set the scene's top-level `"tier"` to what you are making, then run `node scripts/gertie.mjs profile <scene>`. See "Quality tiers" below.
7. **Export** only if the user needs another format: `node scripts/gertie.mjs export <scene> --to <formats>` or `--for <destination>`. See `references/export.md`. It needs ffmpeg for everything except `lottie`, `svg` and `lottie-zip`.
8. **Deliver** the `.lottie.json` and `.svg` files, the scene file and the contact sheet. Say what was checked. If the report has a `baked` list, the SVG carries one keyframe per frame for those properties; it is correct but larger, and simplifying them (same easing and times on trim start, end and offset; no overshoot easing on a morph or on rect and ellipse size) shrinks it.

Other commands:

    node scripts/gertie.mjs qa <scene> --thorough     render every frame and also check for one-frame flashes
    node scripts/gertie.mjs compile <scene> --json    compile only, no browser; --lottie or --svg writes just one output
    node scripts/gertie.mjs validate <file> --json    check a scene or any Lottie file
    node scripts/gertie.mjs export <scene> --to webm --json   write other formats; see references/export.md
    node scripts/gertie.mjs import <file.svg> --json   turn an SVG into a fragment with a summary and a labelled preview; see references/import.md
    node scripts/gertie.mjs trace <logo.png> --json      trace a flat PNG or JPEG to shapes; then group; see references/trace.md
    node scripts/gertie.mjs cutout <painting.png> <parts.json> --json   cut a painting into layers along outlines; see references/cutout.md
    node scripts/gertie.mjs grid <image.png> --step 50   draw a labelled grid on an image to read pixel coordinates
    node scripts/gertie.mjs render <file.lottie.json> --times 0.6,1.1 --out frames   draw full-size frames at chosen times
    node scripts/gertie.mjs story <video.story.json> --json   build an MP4 from scenes with captions, transitions and music; see references/video.md
    node scripts/gertie.mjs ascii lint|render|export|gen|from|fx|play ...   text-character animation; see references/ascii.md
    node scripts/gertie.mjs ascii probe <clip.mp4> --json   read the grid, colours and frame rate of an ASCII clip to imitate
    node scripts/gertie.mjs study <clip.mp4> --json      measure the motion in a video or GIF and draw a contact sheet; see references/motion-reference.md
    node scripts/gertie.mjs study <clip.mp4> --crop x,y,w,h --rate source --json   the same on one subject at the clip's own frame rate, with an idle list for small swings
    node scripts/gertie.mjs sample <image-or-clip> --at x,y --at x,y   print the colour at each point as hex, from the pixels; --time seconds picks the frame of a clip
    node scripts/gertie.mjs profile <scene or file.json> [--tier icon|character|scene] --json   measure paths, colours, keyframes and easing against the quality bands
    node scripts/gertie.mjs inspect <file.json> --json   describe a Lottie file; also recolor, retime and render, see references/lottie.md
    node scripts/gertie.mjs doctor                    report whether Node, a browser and ffmpeg are available, and which export formats work

Exit code 0 means no errors, 1 means errors were found, 2 means the command could not run.

## Quality tiers

Professionally made animations of the same kind look alike when measured. `profile` measures your compiled animation the same way and marks each measure `inside`, `below` or `above` the band for its tier. It never fails; it tells you where the gap is. `validate --json` and `qa --json` include the same report under `profile`.

| Tier | What it is | What it needs most |
|---|---|---|
| `icon` | An icon or loader, about 512 pixels, 1.5 to 3 seconds | Few shapes (5 to 20 paths, 2 to 5 colours), but every move eased, with overshoot and a clean loop |
| `character` | A character or illustration, 800 to 1024 pixels, 2 to 6 seconds | A real drawing: 40 to 80 paths, 6 to 12 colours, and dense motion (25 to 60 keyframes a second, 4 or more different eases) |
| `scene` | A full scene, 1080 pixels, 5 to 10 seconds | Much more drawing (120 to 250 paths, 12 to 20 colours) but no more motion than a character: animate a few things well |

Declare the tier in the scene with `"tier": "icon"` (or `"character"`, `"scene"`) so the report marks one band; without it `profile` reports all three. In every tier, aim for at least three quarters of segments eased and at least a quarter of animated properties starting on a frame of their own (offset, do not synchronise). A `below` on paths or colours means the drawing is too simple; a `below` on keyframes per second means things stop moving between poses.

## What each output can and cannot do

- **Lottie JSON** plays in lottie-web, dotlottie players and native mobile players. Use it for apps.
- **GIF, APNG, WebP, WebM, ProRes, HEVC, MP4** are made by `export`. They are pictures of the animation, not vectors.
- **Animated SVG** needs no player and no JavaScript. It plays when opened in a browser, in an `<img>` tag and in a README (checked in Chromium and WebKit; Firefox has not been checked). It cannot be paused or scrubbed, and native mobile apps cannot play it. Under `prefers-reduced-motion` it shows one still frame, chosen by the scene's optional top-level `poster` (seconds). Morphs and rect or ellipse size changes keep moving under reduced motion.

## If you cannot see images

Skip step 5. Rely on the automatic checks and tell the user the result was checked automatically but not looked at.

## If there is no browser

`qa` still compiles and validates, and reports `"render": "skipped"` with the command that fixes it. Run `node scripts/gertie.mjs doctor`, follow what it says, and tell the user that the render checks did not run until they do.

## If you cannot run commands

Write the scene file following `references/scene.md` and give it to the user with the compile command.
