# Prompts for building phase 8b: dense and styled ASCII

Run these one at a time, in order, each in a fresh session opened in the repository root. Do not start a prompt until the one before it reports all checks passing. Prompts 1, 2 and 4 suit a faster model. Prompts 3 and 5 change the frame pipeline and the renderer; use the stronger model if the faster one fails its checks twice. Prompt 6 needs a model that can read images.

The design is in `docs/12-ascii.md`, section "Dense and styled ASCII: design for phase 8b". The tasks and acceptance checks are in `docs/14-build-plan.md`, "Phase 8b". Each prompt builds one numbered part of the design.

The reference clips that motivated this phase are not in the repository and must not be added to it. The design describes them in words; that description is enough.

Every prompt ends with the same rules, so each one stands alone.

---

## Prompt 1: conversion controls

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 1 of "Phase 8b: dense and styled ASCII" in docs/14-build-plan.md, and nothing else.

Read in full before writing code:
- docs/12-ascii.md, all of it. The specification for this task is "1. Conversion controls" in the section "Dense and styled ASCII: design for phase 8b".
- src/ascii/convert.ts, src/ascii/media.ts, src/ascii/types.ts, src/cli/lib/ascii-command.ts.
- tests/unit/ascii.test.ts, for the style of the existing tests.

Build:
1. In src/ascii/convert.ts, as pure functions over RGBA cells: normalize (2nd to 98th percentile over the whole clip, from a 256-bin histogram), gamma, threshold, key (a colour, or auto from the outer ring of cells of the first frame), color-levels, palette, tint, the named ramps, chars (a stable choice per cell from a hash of column, row and seed), shimmer, ordered dither, edge-color. Apply them in the order the design gives: crop, scale to cells, key, normalise, gamma, threshold, dither, character, colour, edge colour.
2. --crop in src/ascii/media.ts, through ffmpeg, before scaling.
3. The flags on `ascii from` in src/cli/lib/ascii-command.ts, with clear E-USAGE messages for bad values and for combinations the design excludes (tint with palette).
4. Reuse mulberry32 from src/ascii/gen.ts for every hash; do not use Math.random.
5. Unit tests, one or more per flag, on small synthetic rasters built in the test: for example a 4 by 4 gradient for normalize, gamma, threshold and dither; a subject on a flat border for key auto; two frames for chars (same characters on both) and shimmer (the stated fraction differs, and the result is identical for the same seed).
6. The "Verify during build" item on the named ramps: check which characters of `blocks` and `dots` are one cell wide. Use the existing browser alignment test in tests/browser/ascii.spec.ts as the method. Write the finding beside the item in docs/12-ascii.md and remove any character that fails.
7. Add the flags to the `ascii from` usage text and to skills/gertie/references/ascii.md under route 4, briefly. The full rewrite of that file is a later task.

Check, and fix until all pass:
- npx tsc --noEmit
- npm test
- Convert examples/pulse-circle.gertie.json with --palette, with --chars "CZ" --seed 3, and with --ramp bands --edge-color "#3b82f6"; run `ascii lint` on each result (zero errors) and `ascii render` on each, and look at the contact sheets.
- npm run build

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- No new dependency. The converter stays pure; file and process access stays in src/cli and src/ascii/media.ts.
- Existing behaviour is the default: with none of the new flags, output for a vector scene is byte-identical to before. Prove it with a test. --normalize is on by default only for video and images; say in docs/12-ascii.md that this changes their output.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, each check's result, changes from the design, and anything not verified.
```

---

## Prompt 2: cell styling

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 2 of "Phase 8b: dense and styled ASCII" in docs/14-build-plan.md, and nothing else. Task 1 is done.

Read in full before writing code:
- docs/12-ascii.md, all of it. The specification is "2. Cell styling". Read "Output: animated SVG" closely: the rules about whole-pixel cells, runs, textLength and the 5 microsecond boundary shift must keep holding.
- src/ascii/types.ts, src/ascii/parse.ts, src/ascii/svg.ts, src/ascii/convert.ts.
- tests/browser/ascii.spec.ts and tests/browser/ascii-export.spec.ts.

Build:
1. Style fields glyph ("text", "dot", "square"), ramp, cellAspect, background as a colour or a gradient object, and glow. Parse and lint them in src/ascii/parse.ts with E-ASCII-STYLE messages that name the field, the problem and the fix. `ramp` is required when glyph is not "text".
2. Frame field `backgrounds`, in the same shapes as `colors`, linted the same way (E-ASCII-COLORS).
3. The SVG emitter: dots as <circle> and squares as <rect> sized by the character's position in the ramp (25 percent of the cell for the first non-space entry, 95 percent for the last); cell backgrounds as <rect> runs merged along a row when neighbours share a colour; the gradient as a <linearGradient> behind the grid; glow as the design describes.
4. `ascii from`: --glyph, --cell-aspect, --cell-bg n, --glow n, --font-size n. With cellAspect 1 the row count is computed for square cells.
5. Terminal playback, the shell script and the JavaScript module ignore the new styling, except that cell backgrounds become ANSI background colours in `play` and the shell script. Say so in the document.
6. The "Verify during build" item on glow: does an SVG with the filter still play inside <img> in Chromium and WebKit, and what does it cost per frame at 120 columns. Write the finding in docs/12-ascii.md. If it breaks <img> playback, make glow apply to raster exports only and make `--to svg` say so.

Tests:
- Unit: parsing and lint of every new field, good and bad; SVG text for a dot frame, a square frame, a frame with backgrounds, a gradient.
- Browser: a dot frame, a square frame, cell backgrounds and the gradient each render where expected (sample pixels at cell centres); the existing alignment and timing tests still pass.

Check, and fix until all pass:
- npx tsc --noEmit, npm test, npm run test:browser (the ascii specs at least), npm run build.
- Every file in examples/ascii/ still lints and exports byte-identically to before. Prove it by exporting to svg before and after and comparing.

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- The SVG output must stay free of scripts, event handlers, foreignObject and external references.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, each check's result, changes from the design, and anything not verified.
```

---

## Prompt 3: recipes, the canvas renderer and streamed export

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 3 of "Phase 8b: dense and styled ASCII" in docs/14-build-plan.md, and nothing else. Tasks 1 and 2 are done. This is the largest task of the phase: plan it before writing code, and build it in the three steps below, running the tests after each.

Read in full before writing code:
- docs/12-ascii.md, all of it. The specification is "3. Large grids: a recipe file, a canvas renderer, streamed export".
- docs/07-render-and-export.md, for how the renderer and exporter work and what `openFrames` is.
- src/ascii/ (every file), src/cli/lib/ascii-command.ts, src/render/, src/export/, and skills/gertie/assets/render.html.
- src/import/include.ts, as the pattern for reading files at the edge and keeping the core pure.

Step 1, the recipe form:
- `source` on an .ascii.json: `file` plus every conversion control by its camel-case name. `frames`, `framesFile` and `source` are mutually exclusive (E-ASCII-FRAMES). Lint every field.
- One async generator, framesOf(scene, read), in src/ascii/, that yields { cells, colors, backgrounds, hold } per frame for all three forms. `read` is a function supplied by src/cli that opens the source; the generator itself touches no file and starts no process.
- `ascii from ... --recipe` writes the recipe form. It is the default when cols * rows * frames would exceed 400,000 cells.
- Move `ascii render`, `ascii play` and `ascii export` onto framesOf. Behaviour for existing files must not change.

Step 2, the canvas renderer:
- skills/gertie/assets/ascii-render.html with a draw(frame, style) function, as the design describes. Dark, minimal, no external requests.
- The exporter calls it once per frame and takes the frame from the canvas. Nothing accumulates in the page.
- The "Verify during build" item: measure frames per second at 200 by 100 cells with colour, write the number in docs/12-ascii.md, and switch to canvas.toBlob batching if it is under 5.

Step 3, choosing a renderer, limits and lint:
- Up to 400,000 cells in total: the SVG path, as now. Above: the canvas renderer for raster and video, and `--to svg` refused with E-ASCII-TOOMANY and the fix from the design.
- Recipe limits: 400 columns, 200 rows, 3600 frames. Inline frames keep today's limits.
- W-ASCII-FPS above 15 fps fires only when the grid is under 80 columns.

Tests:
- Unit: recipe parsing and lint; framesOf for each of the three forms with an injected `read`; the cell-count rule that picks the renderer; the new limits; the changed warning.
- Browser: one small coloured frame drawn by both renderers differs in under 2 percent of pixels; a 160 column recipe made from examples/rocket-launch.gertie.json exports to mp4 with the right frame count and size.

Check, and fix until all pass:
- npx tsc --noEmit, npm test, npm run test:browser, npm run build.
- Every file in examples/ascii/ exports to svg and gif byte-identically to before.
- Time the export of a 180 column, 24 fps, 8 second recipe to mp4 and report it. The target is under two minutes. Report the size of its .ascii.json; the target is under 2 KB.

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- No new dependency. Playwright and ffmpeg are detected at run time and their absence is reported clearly, as elsewhere.
- Keep the core pure: no file reads or processes inside framesOf or anything it calls directly.
- If the design turns out to be wrong or unworkable somewhere, stop at that point, choose the smallest change that works, and record it in docs/12-ascii.md as a Decision with the reason. Do not silently do something else.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built in each step, each check's result with numbers, changes from the design, and anything not verified.
```

---

## Prompt 4: effects in time

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 4 of "Phase 8b: dense and styled ASCII" in docs/14-build-plan.md, and nothing else. Tasks 1 to 3 are done.

Read in full before writing code:
- docs/12-ascii.md, all of it. The specification is "4. Effects in time".
- src/ascii/ (framesOf and the files around it), src/ascii/gen.ts for mulberry32, src/cli/lib/ascii-command.ts.

Build:
1. src/ascii/fx.ts: a pure function applyFx(frames, fx, fps) covering reveal, hide, decode and shimmer exactly as the table specifies, with every `by` value. It works on a stream of frames; it must not need the whole animation in memory, except that `radial` and `bright-first` may look at the frame they are applied to. Do not build `type` here beyond parsing it; it belongs to text layers in the next task.
2. `fx` on the scene, parsed and linted: E-ASCII-FX for an unknown effect or parameter, with the nearest valid name, and for a time range outside the animation.
3. framesOf applies scene `fx` after reading frames.
4. `gertie ascii fx <file> --effect <name> [--by ...] [--at s] [--duration s] [--seed n] [--chars s] [--amount n]`, which appends an entry to the file and prints the result of lint.
5. Unit tests, per effect: before `at` and after `at + duration` the frames are what the rule says (for reveal, empty before and untouched after); at progress 0.5 about half the non-empty cells are shown for scatter (within 10 percent on a 40 by 20 grid); rows-up reveals the bottom row first; the same seed gives identical frames and another seed gives different ones; colours are never changed.

Check, and fix until all pass:
- npx tsc --noEmit, npm test, npm run build.
- Add a scatter reveal to a copy of examples/ascii/pulse-circle.ascii.json, run `ascii render --sheet-frames 16`, and look at the sheet: cells must appear a few at a time and end on the full picture.

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- No Math.random anywhere: every choice comes from a seeded hash, so output is repeatable.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, each check's result, changes from the design, and anything not verified.
```

---

## Prompt 5: layers

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 5 of "Phase 8b: dense and styled ASCII" in docs/14-build-plan.md, and nothing else. Tasks 1 to 4 are done.

Read in full before writing code:
- docs/12-ascii.md, all of it. The specification is "5. Layers", and the `type` row of the effects table.
- src/ascii/ (parse, framesOf, fx), src/presets/easing.ts (reused for position easing).

Build:
1. `layers` on a scene, parsed and linted: each layer has exactly one of source, framesFile, frames or text, plus optional id, color, at, fx, from, to and loop. With layers, the scene's cols, rows and duration are required (E-ASCII-SIZE). Messages name the layer id or index, the field, the problem and the fix.
2. A pure function flatten(layerFrames, positions) that composites one frame: layers in order, later on top; a space is transparent; a non-space cell replaces the one under it with its colour and background; cells outside the grid are dropped.
3. Position keyframes [seconds, column, row, ease?], interpolated with the easing from src/presets/easing.ts and rounded to whole cells; `hold` steps. One key or none is a fixed position.
4. Layer timing: a layer shorter than the scene repeats when loop is true (the default) and holds its last frame otherwise; `from` and `to` bound when it exists.
5. Layer `fx` run before flattening; scene `fx` after. Build the `type` effect for text layers: cells appear in reading order at `cps` characters per second, with a block cursor on the newest cell.
6. framesOf handles a scene with layers. No rotation or scaling of layers: the design decides against it.

Tests (unit): overlap order; transparency of spaces; a layer positioned partly and wholly off the grid; a moving layer is at the keyed cells at the key times and between them at the eased position; a looping layer and a non-looping one; from and to; a typed text layer shows n characters after n / cps seconds; a scene of three layers flattens to the same frames twice.

Check, and fix until all pass:
- npx tsc --noEmit, npm test, npm run build.
- Write a small scene with a starfield background layer (from `ascii gen stars`), a rocket sprite layer (examples/ascii/rocket.txt) that moves from below the grid to above it, and a typed caption layer. Run lint (zero errors) and `ascii render --sheet-frames 16`, and look at the sheet.

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- The compositing and timing code is pure. Reading a layer's source goes through the same injected `read` as framesOf.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, each check's result, changes from the design, and anything not verified.
```

---

## Prompt 6: probe, the reference text, the examples, and closing the phase (needs vision)

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 6 of "Phase 8b: dense and styled ASCII" in docs/14-build-plan.md and close the phase. Tasks 1 to 5 are done. You need to be able to look at images for this task; if you cannot, say so and stop.

Read in full first:
- docs/12-ascii.md, all of it, including what the earlier tasks recorded.
- docs/14-build-plan.md, "Phase 8b", for the acceptance list.
- skills/gertie/references/ascii.md, scene.md and motion.md.

Part A, `ascii probe`:
- `gertie ascii probe <clip|image> [--time s] --json`, as "6. Reading a reference: ascii probe" specifies: cell pitch by autocorrelation, cols and rows, background colour, the five most common foreground colours, frame rate, and text or dot.
- Do the "Verify during build" item: make clips with Gertie at 40, 120 and 200 columns, text and dot, probe them, and record how often the result is within 5 percent. If the pitch is unreliable on compressed video, keep colours and frame rate, report the pitch as null, and document what the agent does instead.

Part B, five corpus examples in examples/ascii/, all original art made in this repository. Do not download, trace or copy anyone's artwork.
1. A bouquet that grows and blooms: a vector scene (stems with draw-on, flowers with pop-in, staggered, using the presets in motion.md) converted as a recipe of 160 to 200 columns with the `long` ramp, a three-colour palette, glow, and a rows-up reveal.
2. A halftone: a Gertie-made picture rendered as coloured dots on square cells with a scatter reveal.
3. A letter field: a shape rendered with --chars and shimmer on a gradient background, with a typed caption layer.
4. Bands: a shape rendered with the `bands` ramp and an edge colour.
5. A pond-like scene: a background layer and at least three sprite layers moving on different paths.
For each: lint with zero errors, export to mp4 and gif, render a 16 frame contact sheet and look at it. Revise until it reads clearly, at most three rounds each.

Part C, the reference text:
- Rewrite skills/gertie/references/ascii.md around the two playbooks in "What the agent does, after this phase": from scratch, and from a reference. Add the table of looks, each with the exact command or recipe fields that produce it, taken from the five examples. Keep everything that is still true from the current file (writing frames in a text file, the checks, frame rate for GIF, the export formats). Update the ASCII lines in skills/gertie/SKILL.md.
- Every command line in the file must be one you ran.

Part D, close the phase:
- npm run build, npm test, npm run test:browser.
- Go through the acceptance list. For each item write "Met" or "Not met" with the evidence, in a "Result (phase 8b)" paragraph in docs/14-build-plan.md in the style of the other phases. Do not mark an item met without having run its check. The comparison with the reference clips can only be done by the project owner, who has them: mark that part "For the owner to check" and list, per example, what to compare.
- The two agent checks in the acceptance list: run each with a subagent that is given only the files under skills/gertie/ and the prompt, and report what it did. If you cannot start a subagent, mark them not run.
- Add the examples to the corpus list in docs/08-testing.md.

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Report results as they are. A failing check is a finding to write down.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: each acceptance item and its status, and what is still open.
```
