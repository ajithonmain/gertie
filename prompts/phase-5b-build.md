# Prompts for building phase 5b

Run these one at a time, in order, each in a fresh session opened in the repository root. Do not start a prompt until the one before it reports all checks passing. Prompts 1 to 4 and 6 suit a faster model. Prompt 5 needs a model that can read images.

Every prompt ends with the same rules, so each one stands alone.

---

## Prompt 1: ambient presets

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 1 of "Phase 5b: living motion" in docs/14-build-plan.md, and nothing else.

Read in full before writing code:
- docs/09-motion-presets-and-rigs.md, especially "Loops out of phase", "Adding a preset", "Implementation notes (phase 5b, part 1)" and "Living motion: design for the rest of phase 5b" (the "Ambient presets" table is the specification).
- src/presets/library.ts and src/presets/types.ts, to copy the form of the existing presets.
- tests/unit/presets.test.ts, to see how every preset is tested and how the test finds presets in examples.

Build:
1. Add the presets sway, flicker, jiggle and twinkle to src/presets/library.ts exactly as the "Ambient presets" table specifies: names, properties written, parameters with defaults and ranges, default lengths, and keyframes as fractions of the length. Do not build rise; it is the next task.
2. Unit tests in tests/unit/presets.test.ts: each preset starts and ends at rest, its parameters change the result, and it accepts repeat "loop" with a phase.
3. Corpus examples in examples/: candle.gertie.json (a candle with flicker on the flame; no smoke yet), night-sky.gertie.json (stars with twinkle under a group with "stagger": { "phase": 0.17, "order": "random" }), gift-box.gertie.json (jiggle). Change examples/grass-sway.gertie.json to use sway instead of wiggle.
4. Add a row for each preset to the "Emphasis and loops" table in skills/gertie/references/motion.md, and to the same table in docs/09-motion-presets-and-rigs.md.

Check, and fix until all pass:
- npx tsc --noEmit
- node --import tsx src/cli/gertie.ts qa <each new or changed example> --json  must report zero errors and zero warnings.
- Open each example's contact sheet (the path is in outputs.sheet) and look at it. If you cannot read images, say so in your report.
- npm run golden:update, then confirm only the goldens of the new and changed examples differ.
- npm test must pass.
- npm run build

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON. Every Lottie file comes from the compiler.
- Defaults in the design are marked "Verify during build". If a default looks wrong on the contact sheet, change it, and change the document in the same edit, saying what you changed and why.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, the result of each check with numbers, anything you changed from the design, and anything not verified.
```

---

## Prompt 2: presets that reset while hidden, and `rise`

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 2 of "Phase 5b: living motion" in docs/14-build-plan.md, and nothing else. Task 1 is already done.

Read in full before writing code:
- docs/09-motion-presets-and-rigs.md: "Implementation notes (phase 5b, part 1)", then "Phase for presets that reset while hidden" and the `rise` row of the "Ambient presets" table.
- src/presets/repeat.ts (rotateCycle and unroll), src/presets/expand.ts (the `put` method), src/presets/types.ts.

Build:
1. Add `resets?: true` to PresetDef in src/presets/types.ts.
2. Give rotateCycle in src/presets/repeat.ts an `open` flag, as the design section describes: when the first and last values differ and `open` is true, the rotated cycle contains the wrap as a one-frame-later `hold` key carrying the first value; a cut within one frame of the wrap returns the keys unchanged. Without `open`, behaviour is unchanged.
3. In src/presets/expand.ts, pass the preset's `resets` through to `put` and on to rotateCycle.
4. Add the `rise` preset to src/presets/library.ts with `resets: true`, as specified.
5. Unit tests: rotateCycle with `open` for a numeric property and a scale pair, at phases 0.25, 0.5 and one within a frame of the wrap; `rise` hidden at both ends; `rise` with repeat "loop" and phase 0.5 produces no diagnostics. `rise` needs an entry beside HIDDEN_AT_REST in the table-driven test.
6. Add two wisps of smoke to examples/candle.gertie.json using `rise` with phases 0 and 0.5.
7. Add the `rise` row to both preset tables (skills/gertie/references/motion.md and docs/09), and change the "Smoke, steam" row of the recipes table in motion.md to use `rise`.
8. Add an implementation note to docs/09 saying what was built and anything that differs from the design.

Check, and fix until all pass:
- npx tsc --noEmit
- node --import tsx src/cli/gertie.ts qa examples/candle.gertie.json --sheet-frames 16 --json  zero errors, zero warnings. Look at the sheet: the smoke must show no visible jump.
- npm run golden:update, then confirm only candle's goldens differ.
- npm test, then npm run build.

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, each check's result, changes from the design, and anything not verified.
```

---

## Prompt 3: arm sway in `rig-idle`

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 3 of "Phase 5b: living motion" in docs/14-build-plan.md, and nothing else.

Read in full before writing code:
- docs/09-motion-presets-and-rigs.md: "Rigs", "Layering rig motion", "Implementation notes (phase 5)" (rig directions and the -ctl wrapper), and "Moving holds in rig-idle".
- src/presets/rigs.ts and the rig tests in tests/unit/presets.test.ts.
- examples/robot-wave.gertie.json and examples/robot-walk.gertie.json.

Build:
1. In src/presets/rigs.ts, give rig-idle the optional parts arm-l and arm-r and the parameter armSway (default 2, range 0 to 20, 0 turns it off), exactly as the design section says: outward sway, the left arm's cycle rotated by 0.35 with rotateCycle so the arms never mirror each other. The arms are not transient parts.
2. Unit tests: with arms present both get rotation keys and the two key lists differ; armSway 0 writes nothing to the arms; a rig without arms is unchanged; rig-idle with rig-wave on an arm that has a -ctl wrapper produces no overlap error.
3. Update the rig-idle row in skills/gertie/references/motion.md and docs/09, and add an implementation note to docs/09.

Check, and fix until all pass:
- npx tsc --noEmit
- node --import tsx src/cli/gertie.ts qa examples/robot-wave.gertie.json --json  and the same for robot-walk: zero errors. If either now reports E-PRESET-OVERLAP, the example needs an arm -ctl wrapper as the reference text already tells users; add it to the example, do not weaken the check.
- Look at both contact sheets.
- npm run golden:update, then confirm only robot-wave and robot-walk goldens differ.
- npm test, then npm run build.

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Never hand-write Lottie JSON.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, each check's result, changes from the design, and anything not verified.
```

---

## Prompt 4: the `W-SYNC` warning

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 4 of "Phase 5b: living motion" in docs/14-build-plan.md, and nothing else.

Read in full before writing code:
- docs/09-motion-presets-and-rigs.md: "A warning for loops in step: W-SYNC".
- docs/06-validation.md, for how diagnostics are worded and listed.
- src/presets/expand.ts, especially `motion`, `entry` and how diagnostics are added with `this.add`.

Build:
1. In src/presets/expand.ts, report one W-SYNC per group and preset when three or more direct children of that group run the same looping preset with the same duration, the same `at` and the same phase after stagger. Use the message and fix text from the design section. Exceptions, each with its own unit test: `spin` never warns; entries that came from applyTo "children" on a group whose stagger has a non-zero `each` or `phase` never warn.
2. Unit tests: five children in step give exactly one W-SYNC; two children give none; the same five with stagger.phase give none; five spins give none; children with different durations give none.
3. In docs/06-validation.md change the W-SYNC row from planned to built. In skills/gertie/SKILL.md, workflow step 4, add W-SYNC to the warnings that are explained, in one sentence. Add an implementation note to docs/09.

Check, and fix until all pass:
- npx tsc --noEmit
- npm test. No existing example may gain a W-SYNC: run `for f in examples/*.gertie.json; do node --import tsx src/cli/gertie.ts compile "$f" --json; done` and confirm. If an example is in step by accident, give it a stagger phase and regenerate its golden; if it is in step on purpose, widen the exceptions and write down why in docs/09.
- npm run build.

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- Error and warning messages are written for a language model to act on: they name the node id, the problem and the fix.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, each check's result, changes from the design, and anything not verified.
```

---

## Prompt 5: small motion in `study`, and `sample` (needs vision)

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 5 of "Phase 5b: living motion" in docs/14-build-plan.md, and nothing else.

Read in full before writing code:
- docs/10-references.md: "Video or GIF as a motion reference" and "Small motion: design for phase 5b".
- src/study/analyze.ts, the `study` and `grid` commands in src/cli/, tests/unit/study.test.ts.
- skills/gertie/references/motion-reference.md.

Build:
1. `study --crop x,y,w,h` in source pixels, applied by ffmpeg before analysis. A crop outside the frame is E-USAGE.
2. `study --rate source`: analyse at the clip's own frame rate, capped at 60. First find out and write down in docs/10 what the current analysis rate is, and check memory use at 60 fps for 20 seconds.
3. The `idle` list in the output, as the design section defines it. Keep the analysis a pure function in src/study/analyze.ts; ffmpeg stays in src/cli.
4. Make the test clip with Gertie itself: a scene with a circle that uses `breathe` with repeat "loop", exported to mp4. Tune the two thresholds on it and on a clip with no idle motion. Add both as unit tests.
5. `gertie sample <image-or-clip> --at x,y [--at x,y ...] [--time seconds]`: prints the colour at each point as hex, the mean of a 3 by 3 block. Add it to the command list in skills/gertie/SKILL.md.
6. Rewrite the small-motion paragraph in skills/gertie/references/motion-reference.md to use --crop, --rate source, the idle list and `sample`.
7. Record in docs/10-references.md what was built, the thresholds you settled on, and anything that differs from the design.

Check, and fix until all pass:
- npx tsc --noEmit, npm test, npm run build.
- `study --crop` on the breathe clip reports an idle entry whose period is within 10 percent of the preset's duration.
- Open the cropped contact sheet and confirm it shows the crop.

Rules:
- TypeScript strict, no `any` without a comment that explains why. No emojis anywhere.
- No new dependency. ffmpeg is detected at run time and its absence reported clearly.
- When a document and the code disagree, fix the document in the same change.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: what was built, each check's result with numbers, changes from the design, and anything not verified.
```

---

## Prompt 6: close the phase

```text
You are working in the Gertie repository. Read CLAUDE.md first and follow it.

Task: build task 6 of "Phase 5b: living motion" in docs/14-build-plan.md and close the phase. Tasks 1 to 5 are done. Write no new features.

Do:
1. npm run build, npm test, npm run test:browser. Fix failures that come from phase 5b; report any other failure without changing it.
2. Store the contact sheets the browser tests produce for the new and changed examples, the way the existing ones are stored (see docs/08-testing.md).
3. In skills/gertie/references/motion.md, update the "Starting points by subject" table so that every row that says to adapt `wiggle` or `pulse` names the new preset instead (sway, flicker, jiggle, twinkle, rise). Compile a small scene for each changed row and confirm zero errors and zero warnings.
4. Go through the acceptance list of phase 5b in docs/14-build-plan.md. For each item write "Met" or "Not met" with the evidence, in a "Result (phase 5b)" paragraph in the same style as the other phases. Do not mark an item met without having run its check.
5. For every "Verify during build" item in the phase 5b sections of docs/09 and docs/10, write what was found.
6. Add the phase 5b examples to the corpus status in docs/08-testing.md.

Rules:
- No emojis anywhere.
- Report results as they are. A failing check is a finding to write down, not something to hide.
- Do not commit or push. Do not delete files without asking.
- Finish with a short report: each acceptance item and its status, and what is still open.
```
