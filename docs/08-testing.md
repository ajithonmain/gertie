# Automated testing

Gertie has two kinds of automated testing, and both matter.

1. **Runtime QA.** Every time an agent makes an animation, Gertie tests that animation automatically and reports the result. This is a feature of the skill. The command is `gertie qa`.
2. **The project test suite.** Tests that prove Gertie's own code is correct. Developers and continuous integration run these.

Both use Playwright for anything that involves rendering.

## Part 1: runtime QA

`gertie qa <scene.gertie.json>` is the single command the agent runs after writing or editing a scene. It does everything and returns one report.

### What it runs

1. Parse and lint the scene (gate 1).
2. Compile to Lottie JSON and to SVG.
3. Validate the Lottie output (gate 2).
4. Render sampled frames from the Lottie output and from the SVG output.
5. Run the render checks below (gate 3).
6. Write the contact sheet.
7. Print the report.

If gate 1 fails, it stops there. An invalid scene is not compiled.

### Render checks

All checks work on the rendered PNG frames. Pixel reading is done in the browser page with a canvas (`getImageData`), so no image library is needed.

| Code | Check | How |
|---|---|---|
| `E-R-BLANK` | The animation is not empty | At least one sampled frame has more than 0.1% non-transparent pixels |
| `E-R-STATIC` | Something moves | At least two sampled frames differ in more than 0.05% of pixels |
| `E-R-PARITY` | Lottie and SVG agree | For each sampled frame, the Lottie render and the SVG render differ in fewer than 2% of pixels. Colour is weighted by alpha, and a pixel counts as different only when no pixel within one pixel of it in the other image matches (anti-aliasing is not a difference) |
| `W-R-LOOP` | The loop is seamless | When `loop` is true, the first frame and the frame at `duration` differ in fewer than 0.5% of pixels |
| `W-R-CLIPPED` | Nothing important is cut off | Artwork covers at most 1% of the canvas border (the outermost pixel ring) in any frame. Skipped when the scene has a background. *Changed in phase 2:* the original metric, edge pixels as a share of content pixels, missed a thin bar cut off at both ends (it scored exactly 1%)|
| `W-R-EMPTY-FRAMES` | No accidental blank moments | No sampled frame is fully transparent while its neighbours are not |
| `W-R-FLICKER` | No single-frame flashes | No frame differs strongly from both its neighbours while the neighbours resemble each other. Needs consecutive frames; run with `--thorough` |
| `W-R-CONSOLE` | The player is happy | No error or warning was written to the browser console while lottie-web loaded and played the file |

Thresholds are starting values. In phase 2 they were checked against the corpus: all 13 examples pass with no diagnostics, and each deliberately broken render in `examples/broken-render/` fails with exactly its check. The values live in `THRESHOLDS` in `src/qa/checks.ts`: blank 0.1%, static 0.05%, loop 0.5%, clipped 1% of the border, flicker 5% against neighbours that differ by under 1%.

`E-R-PARITY` arrived in phase 3: `qa` renders the sampled frames from both outputs. `W-R-LOOP` compares frame 0 with the frame at `op - 0.001` (see `07-render-and-export.md`). `W-R-EMPTY-FRAMES` looks only at the sampled frames, so a gap shorter than the sampling interval that falls between samples is not seen; `--thorough` sees every frame. `E-R-PLAYER` is added: lottie-web could not load the file, or the browser could not parse the SVG.

`E-R-PARITY` is the most powerful check. The Lottie emitter and the SVG emitter are separate code written from the same scene. If their renders match, both are very likely correct. If they differ, the report includes the frame number and a diff image (`<name>.parity-f<frame>.png`, differing pixels in red over a faded copy of the Lottie frame), and names the node whose shape rectangle overlaps the differing area most. The report also carries `parity.worst` and `parity.worstFrame` when the check passes, so a creeping difference is visible before it fails.

**Found by the parity check in phase 3:** a Lottie precomposition clipped content at negative local coordinates (see `04-lottie-emitter.md`), `<use>` instances did not animate in the SVG (see `05-svg-emitter.md`), and a hold landed one frame late in Chromium. All three passed every Phase 1 and 2 check.

### Frame sampling

- Default: 8 frames evenly spaced, plus the frame at `duration` for the loop check.
- `--thorough`: every frame. Slower; used before final export and for the flicker check.
- The frames at keyframe times are always included, so that extremes of motion are seen.

### The report

```json
{
  "ok": true,
  "scene": "bouncing-dots",
  "duration": 1.2,
  "fps": 30,
  "frames": 36,
  "outputs": {
    "lottie": "out/bouncing-dots.json",
    "svg": "out/bouncing-dots.svg",
    "sheet": "out/bouncing-dots.sheet.png"
  },
  "sizes": { "lottie": 2140, "svg": 1876 },
  "baked": [],
  "errors": 0,
  "warnings": 1,
  "diagnostics": [
    { "code": "W-R-LOOP", "severity": "warning",
      "message": "First and last frames differ in 3.1% of pixels. The loop will jump.",
      "fix": "Make each animated property end on its starting value, or set loop to false." }
  ]
}
```

### What the agent does with it

This procedure goes into `SKILL.md`:

1. Run `gertie qa scene.gertie.json --json`.
2. If there are errors, fix the scene as each `fix` says, and run again.
3. If there are no errors, open the contact sheet image and look at it. Check that it matches what the user asked for: the right objects, the right colours, sensible motion between frames, nothing overlapping or cut off.
4. If it does not look right, edit the scene and go back to step 1.
5. Stop after three rounds of visual revision, or when it looks right. Show the user the result and say what was checked.

A model without vision skips step 3 and relies on the automatic checks. It should tell the user that the result was checked automatically but not looked at.

### What was measured in phase 2

- `gertie qa` on one corpus example takes about 1.3 seconds, including starting the browser.
- lottie-web and dotlottie-web agree on every corpus example within 1.7% of pixels (anti-aliasing between two rasterizers). The browser test allows 3%. A real disagreement, such as a missing layer, scores 4% or more: the first run of `clip-reveal` scored 38% and `timed-nodes` 100%, and both were emitter bugs.

### Without a browser

If Playwright or a browser is unavailable, `gertie qa` runs gates 1 and 2 only, marks the render checks as skipped in the report, and says how to enable them. Compilation never depends on a browser.

## Part 2: the project test suite

### Layers

| Layer | Runner | Speed | Runs |
|---|---|---|---|
| Unit | `node:test` | Milliseconds | On every change |
| Golden | `node:test` | Under a second | On every change |
| Schema | `node:test` | Seconds | On every change |
| Browser | Playwright | A minute or two | Before every merge |
| Export | Playwright and ffmpeg | A few minutes | Before every release |
| Agent evaluation | A scripted agent run | Long, costs tokens | Before every release |

### Unit tests

Pure functions, tested directly. The lists at the end of `04-lottie-emitter.md` and `05-svg-emitter.md` name the required cases. Also:

- The normalizer: each step in isolation.
- The path parser: every SVG command, checked by sampling points along the parsed curve and comparing with reference points.
- The easing sampler: known values for each named easing at t = 0, 0.25, 0.5, 0.75, 1.
- Every lint rule: one scene that triggers it and one that does not. A table-driven test keeps this compact.

### The corpus

`examples/` holds scene files that are both documentation and tests. Start with these twenty and add more as features land.

| Example | Exercises |
|---|---|
| `bouncing-ball` | y position, easing |
| `bouncing-dots` | staggered timing, loop |
| `spinner-arc` | rotation, trim offset |
| `checkmark-draw` | trim end, stroke |
| `pulse-ring` | scale and opacity together |
| `heart-pop` | overshoot easing |
| `hamburger-to-close` | several lines rotating about pivots |
| `play-to-pause-morph` | path morph |
| `progress-bar` | rect width |
| `toggle-switch` | fill colour change |
| `staggered-list` | many nodes, offset timing |
| `logo-reveal` | clip, group |
| `gradient-orb` | gradients |
| `wave-hand` | pivot rotation, pingpong repeat |
| `blinking-eyes` | hold keyframes |
| `rocket-launch` | nested groups, time windows |
| `confetti` | many `use` instances |
| `typing-dots` | opacity loop |
| `swinging-sign` | elastic easing expansion |
| `image-float` | image node |

**Status after phase 3:** 21 examples exist. The names above are the plan; the corpus in `examples/` uses these names where a scene was built to match (`blinking-eyes`, `progress-bar`, `hamburger-to-close`, `wave-hand`, `confetti`, `typing-dots`) and otherwise its own (`bouncing-dots`, `clip-reveal`, `clock-hand`, `color-shift`, `draw-check`, `gradient-orb`, `leaf-instances`, `morph-triangle`, `pulse-circle`, `rocket-launch`, `image-float`, `spinner-ring`, `star-spin`, `timed-nodes`, `windmill`). `wave-hand` still uses explicit keyframes, and `swinging-sign` is covered by `easing-expansion`. The other plan names are not built yet; the features they target are each covered by an existing example.

**Status after phase 5:** nine examples were added for presets and rigs: `preset-entrances`, `preset-exits`, `preset-emphasis-a`, `preset-emphasis-b` (between them all 24 presets), `easing-expansion` (bounce, elastic, spring), `repeat-forms` (loop and pingpong), `stagger-bars` (all five stagger orders are unit-tested; the example uses `center-out` and `random`), `robot-wave` and `robot-walk` (all eight rig presets, and the `-ctl` wrapper convention). A unit test fails if a preset appears in no example. `lid-blink` was added later with cutout animation and has the example `lid-blink`.

**Status after phase 5b, part 1:** `grass-sway` was added for `phase` and `stagger.phase`. The goldens of `lid-blink`, `preset-emphasis-b` and `robot-wave` were regenerated for the new blink timing; no other golden changed. The browser tests were not rerun for these four at that point.

**Status after phase 5b (closed):** the corpus is 35 examples, including the new `candle` (flicker and rise), `night-sky` (twinkle with `stagger.phase`) and `gift-box` (jiggle) added; `grass-sway` now uses `sway` and `robot-wave` gained the `robot-arm-r-ctl` wrapper. `npm run test:browser` was rerun: 438 passed, and the contact sheets of `candle`, `night-sky`, `gift-box` and `grass-sway` were stored as darwin baselines in `tests/browser/sheets.spec.ts-snapshots/`. The whole sheet spec passes (35 of 35). One test, the no-fault mutation scan, failed once in the full run and passed alone; see the result of phase 5b in `14-build-plan.md`.

**ASCII corpus (phase 8 and 8b).** `examples/ascii/` holds the ASCII examples. `tests/unit/ascii.test.ts` lints every `.ascii.json` there with `--strict` (for a recipe or layers this opens the sources), and the vector scenes in that folder are sources for the recipes, each passing `qa` with 0 errors and 0 warnings; they are not part of the golden corpus above, which reads only `examples/*.gertie.json`.

| Example | Exercises |
|---|---|
| `rocket`, `bouncing-ball`, `loading`, `pulse-circle`, `starfield` (phase 8) | inline frames, `framesFile`, generators, conversion of a vector scene, SVG export |
| `bouquet` (from `bouquet.gertie.json`) | a recipe of 180 columns at 24 fps, `long` ramp, three-colour palette, glow, `reveal` `rows-up`; the scene uses `draw-on` and `pop-in` with `stagger` |
| `halftone` (from `sunflower.png`, rendered from `sunflower.gertie.json`) | dots on square cells with colour, a picture in a `source` layer of a scene with a `duration`, `reveal` and `hide` `scatter` |
| `letter-field` (from `star-flower.gertie.json`) | `chars` with `shimmer`, a gradient background, glow, a `text` layer with `type` |
| `bands` (from `orb.gertie.json`) | the `bands` ramp, `edgeColor`, `gamma` |
| `pond` (from `water.gertie.json`, `koi-right.txt`, `koi-left.txt`, `lily.txt`) | a background `source` layer with `dots` and `tint`, four `framesFile` sprite layers with eased `at` paths, off-grid entry and exit |

Each of the five phase 8b examples was exported to MP4 and GIF and its 16 frame contact sheet looked at (see `14-build-plan.md`, phase 8b).

Each feature in the scene specification must appear in at least one example. A test enforces this by collecting the features each example uses and comparing with the full list.

There is also a `examples/broken/` directory: one scene per lint rule, each expected to fail with exactly that rule's code.

### Golden tests

For each corpus example, the expected Lottie JSON and SVG are stored in `tests/golden/`. The test compiles the example and compares byte for byte. Output is deterministic (fixed key order, fixed rounding), so any difference is a real change.

`npm run golden:update` rewrites the golden files. A change to golden files in a pull request is reviewed like code: the browser tests must still pass, and the reviewer looks at the new contact sheets.

### Schema tests

Every corpus example's Lottie output validates against the official schema with zero errors and zero warnings.

### Browser tests

These use Playwright Test. Each runs across the whole corpus.

**Parity.** The same check as runtime `E-R-PARITY`, on every frame instead of a sample (`tests/browser/parity.spec.ts`). This is the main acceptance test for both emitters.

**Second player.** Render each Lottie output with dotlottie-web (MIT, uses the ThorVG engine) as well as lottie-web, and compare. Agreement between two independent players is strong evidence the file is portable. Differences are recorded per feature in a compatibility table in the documentation.

**Cross-browser SVG.** Render each SVG output in Chromium, Firefox and WebKit and compare each with the Chromium render (`tests/browser/svg.spec.ts`). Playwright installs all three with `npx playwright install`. This is where the Safari-specific risks (path morphing, transform origin) are caught. Chromium runs every spec; to add the other engines run `npx playwright install firefox webkit` and then `GERTIE_BROWSERS=chromium,firefox,webkit npm run test:browser`, which runs the SVG spec in each. See `05-svg-emitter.md` for browser coverage and SVG behavior.

**SVG inside `<img>`.** Load each SVG through an `<img>` tag, take a screenshot, wait 400 milliseconds, take another. The two must differ. This settles the open research question of whether in-file CSS animation plays inside an image, in all three browsers. Record the result in `05-svg-emitter.md`.

**SVG self-containment.** Load each SVG with network access blocked and assert that no request is attempted.

**Reduced motion.** With `prefers-reduced-motion: reduce` emulated, two screenshots 400 milliseconds apart are identical and match the configured poster frame.

**Lottie console.** No console errors or warnings from lottie-web for any corpus file.

**Visual regression.** Contact sheets for the corpus are stored as snapshots. Playwright's `toHaveScreenshot` flags unexpected visual changes. Snapshots are per platform because text and anti-aliasing differ.

### Export tests

**Status after phase 4:** `tests/browser/export.spec.ts` (17 cases) and `tests/unit/export.test.ts`. They run on one example (`spinner-ring`) and skip when ffmpeg is missing; HEVC is produced only where the encoder exists. The WebM test places the file in a `<video>` over a magenta page and requires a transparent corner to be magenta. The `.lottie` test requires dotlottie-web to load it and draw. Limit values in the tests are written out separately from the destination table in `src/export/destinations.ts` so one checks the other. A test deliberately encodes a WebM without alpha and requires the alpha check to reject it.

For one small example (to keep it fast), run every export format and assert:

- The file exists and is not empty.
- `ffprobe` reports the expected dimensions, frame count within one frame, and duration within 5%.
- For each transparent format, the alpha check from `07-render-and-export.md` passes.
- For each `--for` destination, the output is within that platform's size and dimension limits.

Skip HEVC with alpha on Linux.

### Story tests

`tests/unit/story.test.ts` (22 cases) covers the storyboard linter, the timeline plan, the `xfade` offsets, caption wrapping, the filter strings, the contact-sheet frame choice and the HyperFrames project text, with no browser or ffmpeg. `tests/browser/story.spec.ts` (8 cases) builds real videos. The boundary test uses three solid-colour scenes (red, green, blue) with a 0.4 s fade and a 0.5 s slide, and reads one pixel from the decoded MP4 at the first frame, the last frame before a transition, mid-transition and the first frame after each: scenes start at frames 0, 18 and 33, the video has 63 frames, frame 17 is pure red, frame 30 is the first pure green, frame 48 the first pure blue, and mid-slide the left edge is green while the right edge is blue. Other cases check hold versus loop, that a caption appears only in its scene's clean window, the example storyboard end to end with music (303 frames, AAC audio of the right length, a contact sheet), that a scene failing `qa` stops the build and names the scene, that `--engine hyperframes` writes a project and says how to install HyperFrames, and that a generated scene composition loads in lottie-web and registers its player. They skip when ffmpeg lacks `xfade` or `drawtext`. The HyperFrames output is not run through HyperFrames by any test (see `11-video-composition.md`).

**ASCII (phase 8).** `tests/unit/ascii.test.ts` (31 cases) covers the parser and every lint rule, the SVG text and keyframe arithmetic, conversion, every generator (determinism, and that the looping ones come back to frame 0 exactly), terminal playback with an injected clock, the shell script (run with a stub `sleep`) and the JavaScript module (imported and driven with a fake stream), and the command line. `tests/browser/ascii.spec.ts` runs in Chromium and WebKit (and Firefox where it starts): grid alignment per character with `getStartPositionOfChar`, the visible frame at every interval and mid-interval at 5, 7, 8, 12, 24 and 30 fps with uneven holds, wrap and hold, `<img>` playback by comparing screenshots over time, and the canvas size. Mutation check: with the frame-boundary shift set to zero the timing test fails in both browsers. `tests/browser/ascii-export.spec.ts` (Chromium) exports the rocket to eight formats and reads the decoded MP4 to check that the drawing rises, and covers destinations, transparency and the conversions.

### Agent evaluation

This measures the thing that matters: can an agent with Gertie produce a good animation from a prompt.

- `tests/eval/prompts.json` holds a fixed set of prompts. Start with 30 covering icons, loaders, transitions, simple characters and reference-based requests.
- A script runs an agent on each prompt with the skill installed, and records: whether the first scene passed `gertie qa`, how many repair rounds were needed, and whether it passed within three rounds.
- The headline numbers are first-pass rate and pass-within-three rate, reported per model.
- Contact sheets from the run are published as a gallery, so people can judge quality themselves. Passing the checks means valid and moving, not beautiful.

Run it with at least one strong model and one small model. The gap between them shows how much the skill's structure helps weaker models, which is the point of the design.

The research found one public benchmark, MMLottieBench, with 900 samples. Check its licence before using it.

### Continuous integration

GitHub Actions, on every pull request:

1. Install, type check, build.
2. Fail if the committed bundles in `skills/gertie/scripts/` differ from the fresh build.
3. Unit, golden and schema tests.
4. Browser tests on Linux with Chromium, Firefox and WebKit.
5. Export tests on Linux. A macOS job runs the HEVC case.

Upload contact sheets and diff images as artefacts when a browser test fails, so the failure can be seen without reproducing it.

## Mutation check

To prove the render checks actually catch faults, keep a small set of deliberate faults that can be switched on in the emitters through a test-only flag: skip the order reversal, attach easing to the wrong keyframe, drop the pivot. With each fault on, the parity test must fail. If a fault goes unnoticed, the tests are too weak.

**Done in phase 3.** `src/spec/fault.ts` lists six faults: `lottie-no-reverse`, `lottie-ease-shift`, `lottie-no-pivot`, `svg-reverse-order`, `svg-ease-shift`, `svg-no-pivot`. They are passed as the `fault` compile option and are not reachable from the command line. `tests/browser/mutation.spec.ts` compiles the corpus with each fault and requires the parity scan to fail on at least one example, and requires the same scan to pass with no fault. All six are caught.
