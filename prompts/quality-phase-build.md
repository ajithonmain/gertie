# Prompts for building the quality phase

Run these one at a time, in order, each in a fresh session opened in the repository root. Do not start a prompt until the one before it reports all checks passing. Prompts 1 to 6 suit a faster model. Prompt 7 needs a model that can read images, and is the one place where a stronger model is worth using, because it draws the benchmark artwork.

The design is in `docs/17-quality-tuning.md`, and the measurements behind it are in `docs/16-quality-benchmark.md`.

The open decisions at the end of `docs/17-quality-tuning.md` are settled in these prompts as follows. Change the prompts if you decide otherwise.

| Decision | Settled as |
|---|---|
| Scene declares its tier | Yes: a top-level `tier` field, optional |
| Names of the new easings | `smooth`, `gentle`, `snap`, `settle`, as proposed |
| Mattes | Built, but after artwork, motion and export (prompt 6) |
| Default video render size | Longer side at least 1080 pixels |

Every prompt ends with the same rules, so each one stands alone.

---

## Prompt 1: the phase entry, the `tier` field and `gertie profile`

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build section 1 of docs/17-quality-tuning.md ("Quality profile and targets"), and nothing else.

Read in full before writing code:
- docs/16-quality-benchmark.md and docs/17-quality-tuning.md.
- docs/03-scene-spec.md ("Top-level fields") and docs/06-validation.md.
- src/lottie-tools/inspect.ts, src/cli/gertie.ts, and how the existing commands return JSON with --json.

Build:
1. Add "Phase 10: quality" to docs/14-build-plan.md, after phase 9. One task per section of docs/17-quality-tuning.md, with the acceptance checks copied from that document. Update the row for 17-quality-tuning.md in docs/00-index.md so it no longer says "not yet scheduled".
2. Add an optional top-level scene field "tier" with the values "icon", "character" and "scene". Types, parser, linter (an unknown value is an error that names the three allowed values), and docs/03-scene-spec.md.
3. A pure function that takes compiled Lottie JSON and returns the profile: canvas size, frame rate, duration, layers (including those inside precompositions), path count, vertices, vertices per path, distinct solid colours, gradient count, animated properties, keyframes, keyframes per second, eased share of segments, distinct easing curves (handles rounded to one decimal), median keys per animated property, share of animated properties that start on a frame no other property starts on, share that end on their starting value, and which structural features are used. Put it in src/lottie-tools/.
4. The three tier bands from the table in section 1 of docs/17-quality-tuning.md as data in one file, and a function that marks each measure inside, below or above the band for a given tier.
5. A command: gertie profile <scene or lottie file> [--tier <tier>] [--json]. A scene file is compiled first and its own tier is used unless --tier is given. With no tier, it prints the measures against all three tiers. It always exits 0 unless the input cannot be read or compiled.
6. Add the profile to the JSON that validate and qa already return.
7. Unit tests: the profile of a small compiled scene matches numbers you counted by hand, and band marking for a value below, inside and above. Add profile to the CLI tests.
8. A short section in skills/gertie/SKILL.md or the fitting file under skills/gertie/references/ that tells the agent the command exists and what the tiers mean.

Check, and fix until all pass:
- npx tsc --noEmit
- node --import tsx src/cli/gertie.ts profile examples/candle.gertie.json --json  and the same for night-sky. Count layers, keyframes and colours in each scene by hand and confirm the profile agrees. Put both counts in your report.
- npm test
- npm run build, then node skills/gertie/scripts/gertie.mjs profile examples/candle.gertie.json

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON. Every Lottie file comes from the compiler.
- Do not download, copy or trace any animation from the reference site. docs/16-quality-benchmark.md is the only source of reference numbers.
- Anything marked "Verify during build" in the documents is untested. Test it, and write the result into the document.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, the result of each check with numbers, anything you changed from the design, and anything not verified.
```

---

## Prompt 2: artwork guidance and artwork warnings

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build section 2 of docs/17-quality-tuning.md ("Artwork"), and nothing else. Section 1 is already done.

Read in full before writing code:
- docs/17-quality-tuning.md section 2, and docs/16-quality-benchmark.md.
- docs/06-validation.md, and the file under src/ where the existing scene warnings such as W-STATIC and W-TINY are produced. Copy their form.
- skills/gertie/SKILL.md, skills/gertie/references/scene.md, and docs/13-skill-packaging.md.
- tests/agent-eval/ to see how an agent evaluation is recorded.

Build:
1. Lint warning W-ART-PRIMITIVE: more than 8 shape nodes and no path node whose d contains a curve command. Lint warning W-ART-FLAT: more than 12 shape nodes, 3 or fewer distinct fill colours and no gradient. Each message names the counts and the fix, in the form the other warnings use. Neither fires when "tier" is "icon".
2. A triggering and a non-triggering test for each. Add both codes to docs/06-validation.md.
3. Run the linter over every file in examples/. If either warning fires on an existing example, do not change the example to silence it: report which ones, and raise the floor only if the example is plainly a legitimate small piece.
4. Artwork guidance for the agent, in a new file skills/gertie/references/artwork.md linked from SKILL.md: the build order (silhouette, large interior shapes, shading, details), 6 to 10 vertices per path, when to use primitives, the three-step shading recipe with clip, one light direction, the palette recipe (three or four hues, each with a base, a shade and a tint), outlined against flat style, miter joins for geometric artwork, canvas 512 for icons and 1024 for characters and scenes, fps 60 only for short fast pieces, setting "tier", and using import or trace when the user supplies artwork. Keep it under 120 lines. Mirror the same points briefly in docs/13-skill-packaging.md.
5. One new corpus example drawn by following artwork.md: examples/potted-plant.gertie.json, tier "character", a potted plant swaying. At least 15 paths, at least 6 colours, at least one gradient, shading on the pot and leaves.

Check, and fix until all pass:
- npx tsc --noEmit
- node --import tsx src/cli/gertie.ts qa examples/potted-plant.gertie.json --json  must report zero errors and zero warnings.
- node --import tsx src/cli/gertie.ts profile examples/potted-plant.gertie.json  and report which measures are inside the "character" band. The artwork measures (paths, vertices per path, colours) must be inside. The motion measures are the next prompt's work.
- Open the contact sheet and look at it. It should read as a drawn plant, not as a stack of rectangles. If you cannot read images, say so in your report.
- npm run golden:update, then confirm only the new example's golden differs.
- npm test
- npm run build

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON. Every Lottie file comes from the compiler.
- Do not download, copy or trace any animation from the reference site. All artwork is original.
- Anything marked "Verify during build" in the documents is untested. Test it, and write the result into the document.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, the result of each check with numbers, anything you changed from the design, and anything not verified.
```

---

## Prompt 3: motion

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build section 3 of docs/17-quality-tuning.md ("Motion"), and nothing else. Sections 1 and 2 are already done.

Read in full before writing code:
- docs/17-quality-tuning.md section 3.
- docs/09-motion-presets-and-rigs.md in full, and "Phase 5b: living motion" in docs/14-build-plan.md.
- docs/03-scene-spec.md ("Easing", "Repeating a property").
- src/presets/expand.ts, src/presets/library.ts, src/presets/ease-expand.ts, tests/unit/presets.test.ts.

First, find out what phase 5b has already built. Check the code, not only the documents, for: the ambient presets, moving holds in rig-idle, and W-SYNC. Do not rebuild anything that exists. If W-SYNC is still only planned, build it as docs/09-motion-presets-and-rigs.md describes before extending it in step 5 below. List what you found in your report.

Build:
1. Named easings smooth (0.7, 0, 0.3, 1), gentle (0.2, 0, 0.8, 1), snap (0.8, 0, 0.3, 1) and settle (0.3, 1, 0.7, 1). Add them to the easing table in code and in docs/03-scene-spec.md. The default ease does not change.
2. A "settle" option on a keyframe move, which the expander turns into extra keys: past the target, back under by a smaller amount, then to rest. Design the scene syntax so it fits the existing long keyframe form, and write it into docs/03-scene-spec.md. The name must not collide with the settle easing: if it does, name the option "overshoot" and say so in the document. Defaults are yours to choose by looking at contact sheets; record them.
3. A "follow" relation: a node repeats its parent group's rotation or position animation, delayed and scaled, written as plain keys by the expander. Syntax and defaults into docs/09-motion-presets-and-rigs.md.
4. Lint warnings W-MOTION-SPARSE (duration over 3 seconds and fewer than 3 keyframes per second across the scene) and W-EASE-UNIFORM (more than 20 eased segments, all with the same curve). Neither fires when "tier" is "icon".
5. Extend W-SYNC to starts: more than 6 animated properties and over 80% beginning on the same frame. The fix it suggests is a stagger of 0.03 to 0.1 seconds on the parent group.
6. Unit tests on the expanded keys for the settle option and follow. A triggering and a non-triggering test for each warning. All codes into docs/06-validation.md.
7. Run the linter over every file in examples/ and report which warnings fire on existing examples. Do not edit an example to silence a warning without saying so.
8. Motion guidance in skills/gertie/references/motion.md: density (anticipation, overshoot, moving holds, secondary motion), at least three eases chosen by weight, no effort on easing between keys closer than 100 milliseconds, offsets, loop lengths of 4 to 8 seconds for characters with sub-loops whose periods divide the duration, arcs from separate x and y timing. In docs/03-scene-spec.md, move "Motion along a path" to the bottom of the list of omissions with the reason from section 3.5.
9. Animate examples/potted-plant.gertie.json with these features, and add one corpus example each for the settle option and follow.

Check, and fix until all pass:
- npx tsc --noEmit
- node --import tsx src/cli/gertie.ts qa <each new or changed example> --json  must report zero errors and zero warnings.
- node --import tsx src/cli/gertie.ts profile examples/potted-plant.gertie.json  must now be inside every measure of the "character" band. Report the numbers.
- Open each contact sheet and look at it. If you cannot read images, say so in your report.
- npm run golden:update, then confirm only the goldens of new and changed examples differ.
- npm test
- npm run test:browser
- npm run build

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON. Every Lottie file comes from the compiler.
- Do not download, copy or trace any animation from the reference site.
- Anything marked "Verify during build" in the documents is untested. Test it, and write the result into the document.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, the result of each check with numbers, anything you changed from the design, and anything not verified.
```

---

## Prompt 4: GIF and video quality

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build section 6 of docs/17-quality-tuning.md ("GIF and video output"), and nothing else. Sections 1 to 3 are already done. This task does not touch the scene format or the emitters.

Read in full before writing code:
- docs/17-quality-tuning.md section 6.
- docs/07-render-and-export.md in full.
- src/export/ in full, src/render/lottie.ts, tests/browser/export.spec.ts.

Run node --import tsx src/cli/gertie.ts doctor first. If ffmpeg or a browser is missing, stop and report it.

Every setting in section 6 is marked "Verify during build". For each one, export with and without it, compare, and keep it only if it is better. Use examples/potted-plant.gertie.json and examples/gradient-orb.gertie.json as the test scenes.

Build:
1. Default render size for mp4, webm, prores and hevc: the longer side at least 1080 pixels, through the existing scale mechanism. Raise or make per-format the 4x ceiling as needed. Even dimensions for yuv420p by rounding up and padding. --scale still overrides. Destinations with their own size rules are unchanged.
2. GIF keeps the authored size, capped at 640 pixels on the longer side by default.
3. --quality high: render at twice the output size and scale down with lanczos. Measure the render time on a 6 second scene at 30 and at 60 fps and put the numbers in the document. Make it the default for video formats only if the time is acceptable; say what you decided and why.
4. GIF frame rate for a 60 fps scene: 50 or 25, chosen by a size budget.
5. Encoder settings from the table in 6.4: -tune animation for H.264, crf 24 for VP9 outside size-limited destinations, and a per-frame GIF palette tested against the global one on the gradient scene.
6. Colour tagging as BT.709. Compare the colour values of a rendered PNG frame with the first decoded frame of the video, before and after.
7. Export checks from 6.5: decoded first, middle and last frames compared with the rendered frames against a threshold, a fringe check on transparent formats, and a last-to-first comparison for loops. A failed check gives exit code 1, like the existing alpha verification.
8. Tests in tests/browser/export.spec.ts for the new defaults and checks.
9. Rewrite the affected parts of docs/07-render-and-export.md and skills/gertie/references/export.md: the settings kept, the settings rejected and why, and measured file sizes.

Check, and fix until all pass:
- npx tsc --noEmit
- Export potted-plant and gradient-orb to mp4, webm and gif. Report the dimensions, frame rate, file size and frame-difference figure of each, read back with ffprobe.
- Extract one frame from each mp4 and gif and look at it at full size for banding in the gradient and for jagged edges. If you cannot read images, say so in your report.
- npm test
- npm run test:browser
- npm run build

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON. Every Lottie file comes from the compiler.
- Do not download, copy or trace any animation from the reference site.
- Anything marked "Verify during build" in the documents is untested. Test it, and write the result into the document.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking. Put temporary exports in a temporary directory, not in the repository.
- Finish with a short report: what was built, the result of each check with numbers, anything you changed from the design, and anything not verified.
```

---

## Prompt 5: markers and animated gradient geometry

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build sections 4.4 and 4.5 of docs/17-quality-tuning.md (animated gradients, markers) and the matching part of section 5, and nothing else. Mattes are the next prompt.

Read in full before writing code:
- docs/17-quality-tuning.md sections 4 and 5.
- docs/03-scene-spec.md, docs/04-lottie-emitter.md, docs/05-svg-emitter.md in full.
- src/emit-lottie/index.ts, src/emit-svg/index.ts, and tests/browser/parity.spec.ts.

Build:
1. Markers: a top-level "markers" object mapping a name to [start, end] in seconds. Lint: names follow the id rules, start is less than end, both within the duration. Written to the Lottie markers array. No SVG form. Confirm the emitted file still passes schema validation with no warnings.
2. Animatable gradient geometry: fill.from and fill.to on a linear gradient, fill.center and fill.radius on a radial one, as flat dotted keys like the existing animated sub-properties. Stops stay static. Lint errors for the wrong gradient type or value shape.
3. Lottie: keyframes on the gradient start and end points.
4. SVG: CSS cannot animate gradient attributes, so use SMIL on the gradient element, as the emitter already does for morphs. Verify during build that it plays in Chrome, Firefox and Safari where you have them, including when the SVG is loaded through an img tag, and record the result in docs/05-svg-emitter.md.
5. Also add gradient strokes only if the emitters make it a small change. If not, leave it and say so.
6. Unit tests on the emitted Lottie and SVG, lint tests with a triggering and a non-triggering case, one corpus example for each feature, golden files, and a passing parity check for the gradient example.
7. Update docs/03-scene-spec.md (fields, animatable properties, the list of omissions), docs/04-lottie-emitter.md, docs/05-svg-emitter.md, docs/06-validation.md and skills/gertie/references/scene.md.

Check, and fix until all pass:
- npx tsc --noEmit
- node --import tsx src/cli/gertie.ts qa <each new example> --json  must report zero errors and zero warnings.
- Open each contact sheet and look at it. If you cannot read images, say so in your report.
- npm run golden:update, then confirm only the new examples' goldens differ.
- npm test
- npm run test:browser  including parity.
- npm run build

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON. Every Lottie file comes from the compiler.
- Do not download, copy or trace any animation from the reference site.
- Anything marked "Verify during build" in the documents is untested. Test it, and write the result into the document.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, the result of each check with numbers, anything you changed from the design, and anything not verified.
```

---

## Prompt 6: mattes

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build sections 4.1 and 4.2 of docs/17-quality-tuning.md (the precomposition check, then mattes) and the matching part of section 5, and nothing else.

Read in full before writing code:
- docs/17-quality-tuning.md sections 4 and 5.
- docs/04-lottie-emitter.md in full, especially the rules that decide when a group becomes a precomposition and how layers are split.
- docs/05-svg-emitter.md in full, especially "What survives inside an image".
- src/emit-lottie/index.ts, src/emit-svg/index.ts, tests/browser/parity.spec.ts.

Do the two "Verify during build" experiments first, and write the results into the documents before building:
A. Section 4.1: write a scene with 30 clipped nodes. Measure the compiled file size and the frame time in lottie-web and in the dotLottie player. Report whether the precompositions are a problem.
B. Section 4.2: a hand-made test SVG (not a Lottie file) with a CSS-animated shape inside a mask element. Confirm the animation runs in the browsers you have, both inline and through an img tag.

If experiment B fails in a browser the project supports, stop and report. Do not build a Lottie-only matte without asking.

Build:
1. A node field "matte": { "by": <sibling id>, "mode": "alpha" | "alpha-inverted" }. The node named by "by" is not drawn itself.
2. Lint errors, each with a triggering and a non-triggering test: "by" missing, not a sibling, or the same source used with two different modes. Add the codes to docs/06-validation.md.
3. Lottie: the source becomes a layer with td 1 directly above the matted layer, which gets tt 1 or tt 2. A matted node forces layer splitting the way a time window does. Confirm the file passes schema validation with no warnings and plays the same in lottie-web and the dotLottie player.
4. SVG: a mask element holding the source, with mask-type alpha; for the inverted mode, a white rectangle with the source drawn in black and luminance type.
5. If experiment A showed a problem, emit clipped shapes that have no other reason to be a precomposition as a matte pair instead, and update docs/04-lottie-emitter.md. If it showed no problem, change nothing there.
6. Unit tests on the emitted Lottie and SVG, two corpus examples (a shine sweep across a badge with "alpha", and a reveal with "alpha-inverted"), golden files, and a passing parity check for both.
7. Update docs/03-scene-spec.md (the field, and remove mattes from the list of omissions), docs/04-lottie-emitter.md, docs/05-svg-emitter.md, skills/gertie/references/scene.md, and add a short "when to use a matte instead of a clip" note to skills/gertie/references/artwork.md. State in the skill that merge paths do not exist and what to use instead (section 4.6).

Check, and fix until all pass:
- npx tsc --noEmit
- node --import tsx src/cli/gertie.ts qa <each new example> --json  must report zero errors and zero warnings.
- Open each contact sheet and look at it. The matte source itself must not be visible. If you cannot read images, say so in your report.
- npm run golden:update, then confirm only the new examples' goldens differ, plus any changed by step 5, which you list.
- npm test
- npm run test:browser  including parity.
- npm run build

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON. Every Lottie file comes from the compiler.
- Do not download, copy or trace any animation from the reference site.
- Anything marked "Verify during build" in the documents is untested. Test it, and write the result into the document.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, the result of each check with numbers, anything you changed from the design, and anything not verified.
```

---

## Prompt 7: the benchmark corpus

This prompt needs a model that can read images. It draws eleven original pieces, so use the strongest model you have for it. It can be split: run it once per brief, naming the brief, if a single session runs out of room.

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build section 7 of docs/17-quality-tuning.md ("Benchmark corpus") and the size and smoothness checks of section 5, and nothing else. Sections 1 to 6 are already done.

Read in full before writing anything:
- docs/16-quality-benchmark.md and docs/17-quality-tuning.md.
- skills/gertie/SKILL.md and every file under skills/gertie/references/. Work the way an agent using the skill would: write scene files, never Lottie.
- docs/09-motion-presets-and-rigs.md for rigs and presets.

Build:
1. The eleven briefs in the table in section 7, each as examples/benchmark/<name>.gertie.json with the right "tier". Do them one at a time, simplest first: the three icons and loader, the two interface pieces, the two characters, then the three scenes.
2. For each piece, loop until it passes: write the scene, run qa, run profile, open the contact sheet and look at it, fix what is wrong. Judge the sheet honestly: does it read as a finished illustration with shading, and does the motion have anticipation, overshoot, offsets and a clean loop? A piece that passes the numbers but looks like a test file is not done.
3. Wire examples/benchmark/ into the golden tests and the Lottie-to-SVG parity test.
4. For each piece, record in a table at the end of docs/17-quality-tuning.md: tier, every profile measure, Lottie JSON size, SVG size, and the mp4 and gif sizes.
5. Section 5 checks: confirm each SVG is under the size given for its tier, and check whether baked segments at 30 fps show stepping on fast motion. If they do, apply the fix section 5 names. If an SVG is over the size, try the levers section 5 lists (coordinate precision, shared keyframe blocks, class reuse) and report what each saved.
6. If writing these pieces showed that the skill guidance is wrong or missing something, fix the guidance in skills/gertie/references/ and say what you changed. This is the most useful output of the task.

Check, and fix until all pass:
- npx tsc --noEmit
- node --import tsx src/cli/gertie.ts qa <each benchmark scene> --json  must report zero errors and zero warnings, including none of W-ART-PRIMITIVE, W-ART-FLAT, W-MOTION-SPARSE, W-EASE-UNIFORM and W-SYNC.
- node --import tsx src/cli/gertie.ts profile <each benchmark scene>  must be inside every measure of its tier's band.
- node --import tsx src/cli/gertie.ts export <each benchmark scene> --to mp4,gif  into a temporary directory must pass the export checks.
- npm run golden:update, then confirm only the benchmark goldens differ.
- npm test
- npm run test:browser  including parity for all eleven.
- npm run build

Rules:
- All artwork is original. Do not download, copy, trace or imitate any specific animation from the reference site. The subjects are generic on purpose.
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON. Every Lottie file comes from the compiler.
- Anything marked "Verify during build" in the documents is untested. Test it, and write the result into the document.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- The side-by-side review against reference animations is done by the user, not by you. Leave a heading for its result in docs/17-quality-tuning.md and do not fill it in.
- Finish with a short report: the table from step 4, which pieces you are least satisfied with and why, what you changed in the skill guidance, and anything not verified.
```
