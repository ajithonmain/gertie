# Quality tuning

This document turns the gaps measured in `16-quality-benchmark.md` into work. Read that document first; every target here comes from a number there.

This is the plan for phase 10 in `14-build-plan.md`. Every section is built; each has an "As built" or "Result" part that says what was done and what was found. The benchmark corpus and its measurements are in section 7. Anything still marked **Verify during build** is untested.

## What "the same quality" means

An animation made by an agent with Gertie reaches the bar when:

1. Its measured profile falls inside the reference band (section 1).
2. Its SVG output matches its Lottie output frame for frame, as the existing parity check requires.
3. Its GIF and video exports are sharp at 1080 pixels and smooth, with no banding in gradients and no fringe on transparent edges.
4. A person shown it next to five reference animations of the same kind cannot pick it out as the machine-made one more often than chance. This is a manual check and is the final word; the numbers only make it likely.

## Order of work

The sections are ordered by how much each closes the gap for its cost.

| Order | Section | Kind of work | Why this position |
|---|---|---|---|
| 1 | Quality profile and targets | Tool | Without a measurement, every later change is a guess |
| 2 | Artwork | Skill guidance, linter | The largest gap. Needs no new format features |
| 3 | Motion | Skill guidance, presets, linter | The second largest gap. Mostly uses features that exist |
| 4 | Format features | Scene format, both emitters | Mattes and animated gradients unlock looks that guidance cannot. Needed for featured-level work, not for icons |
| 5 | SVG output | Emitter | Must follow section 4 feature by feature |
| 6 | GIF and video output | Export | Independent of the rest; can be done at any time |
| 7 | Benchmark corpus | Examples, tests | Proves the earlier sections worked |

---

## 1. Quality profile and targets

### What to build

A command, `gertie profile <scene or lottie file>`, that prints the same measurements as `16-quality-benchmark.md` for one file and marks each one as inside or outside the reference band. It reads compiled Lottie, so it also works on the output of any other tool. The walking code in `src/lottie-tools/inspect.ts` is the starting point.

The measurements: canvas size, frame rate, duration, layers, path count, vertices, vertices per path, distinct colours, gradient count, animated properties, keyframes, keyframes per second, eased share, distinct easing curves, keys per animated property, share of properties with their own start frame, share of properties that close the loop, and which structural features are used.

### Target bands

There are three tiers, because the wider sample in `16-quality-benchmark.md` shows three different kinds of file. Each aim is taken from the median of the matching reference group: the popular group for icons and loaders, the featured group and the `character` search for characters and illustrations, and the complex tier for full scenes. A scene is "inside the band" when each measure is within the range given for its tier.

| Measure | Icon or loader | Character or illustration | Full scene |
|---|---|---|---|
| Canvas, longer side | 512 | 800 to 1024 | 1080 |
| Frame rate | 30 or 60 | 30 or 60 | 30 |
| Duration, seconds | 1.5 to 3 | 2 to 6 | 5 to 10 |
| Layers | 4 to 15 | 15 to 40 | 30 to 80 |
| Path shapes | 5 to 20 | 40 to 80 | 120 to 250 |
| Vertices per path | 4 to 8 | 6 to 10 | 5 to 9 |
| Distinct solid colours | 2 to 5 | 6 to 12 | 12 to 20 |
| Animated properties | 5 to 25 | 20 to 60 | 30 to 60 |
| Keyframes per second | 10 to 25 | 25 to 60 | 15 to 35 |
| Eased share of segments | 0.75 or more | 0.75 or more | 0.75 or more |
| Distinct easing curves | 2 to 4 | 4 to 10 | 4 to 8 |
| Properties with their own start frame | 0.25 or more | 0.25 or more | 0.25 or more |

Two things in this table are easy to get wrong:

- A full scene needs far more drawing than a character, but not more motion. In the reference, complex scenes have six times the paths of the median file and about the same keyframes per second. Spend the effort on the artwork and animate a few things well.
- An icon is not a lesser target. The most downloaded reference files are icons with a median of 13 paths and 4 colours. What makes them good is timing: every segment eased, overshoot and settle, a clean loop.

The scene declares its tier in an optional top-level field, `"tier": "icon" | "character" | "scene"`, so the profile and the lint warnings know which band to apply. If it is absent, the profile reports all three and applies no warnings.

### How the bands are used

- `gertie profile` reports them. It does not fail a build.
- The profile is added to the JSON that `validate` and `qa` already return, under `profile`, so the agent sees it in its normal loop and can act on it.
- New lint warnings in sections 2 and 3 fire on the clearest cases only. A warning that fires on every small icon would be ignored, so each one has a floor below which it stays quiet.

**Decision:** the tier is declared in the scene, not guessed from the path count. It is one field, and it tells the agent what it is aiming for before it starts drawing.

### As built

- `gertie profile <scene or lottie file> [--tier <tier>] [--json]`. A scene is compiled first (nothing is written) and its own `tier` is used unless `--tier` is given. With no tier, every measure is marked against all three bands. Exit code 0 whenever the file can be read and compiled, warnings included; 1 when the scene has errors; 2 when the file cannot be read or `--tier` is unknown.
- The measuring is a pure function, `profileLottie` in `src/lottie-tools/profile.ts`. The bands are data in `src/lottie-tools/bands.ts`, copied from the table above; change the table first, then the file. `markProfile` marks each measure `inside`, `below` or `above`. The frame rate band is a set of values, so a frame rate between two of them (50 against 30 or 60) is marked `outside`.
- An unknown `tier` is the lint error `E-TIER`, which names the three values.

How each measure is taken, where a literal reading of the reference needed a choice:

| Measure | Taken as |
|---|---|
| Layers | Layers of the main composition and of every precomposition. Gertie's background is a layer and counts |
| Paths, vertices | `sh` items only; rectangles, ellipses and stars are not paths. An animated path's vertices come from its first keyframe |
| Distinct solid colours | Fills, strokes and solid layers, compared as `#rrggbb` (alpha ignored), static or keyframed. Gradient stops are not counted |
| Gradients | Gradient fills and gradient strokes |
| Animated properties, keyframes | Every property whose value is a keyframe list, wherever it sits. A split position counts as two |
| Eased share | Non-hold segments whose handles are not linear (`o.x = o.y` and `i.x = i.y`), over all segments. Hold segments count as not eased. Only the first dimension of a handle is read |
| Distinct easing curves | Every non-hold segment with handles, linear ones included, with the four handle values rounded to one decimal, as the reference was |
| Own start frame | A property's start is the time of the first keyframe whose value differs from the next one, not its first keyframe: Gertie writes a key at frame 0 for every property, so the first keyframe would put every start on frame 0. Times inside a precomposition are not shifted by the layer's start time |
| Closes the loop | The last keyframe's value equals the first, within 0.001 |

**Finding.** Both corpus files checked score 0 on "own start frame", for two different reasons. In `candle` every one of the 12 properties loops with a phase offset and so changes value from frame 0: all 12 start on frame 0, although nothing moves in step. In `night-sky` each star starts at its own frame, but its scale and its opacity start together, so every start is shared by exactly two properties. Both follow from the definition in `16-quality-benchmark.md` read literally, and the measure is kept as it is. Whether the reference script treated a phase-offset loop the same way is not recorded there; **Verify during build** when the benchmark corpus (section 7) is profiled, by checking that a piece that looks unsynchronised does not fail only on this measure.

**Result (benchmark corpus).** It does happen. The first version of `bouncing-mascot` had every loop on its own phase and looked unsynchronised on the sheet, and scored 0.122, below the band, with the other motion measures inside or above. A looping preset changes value from frame 0 whatever its phase, so every loop is counted as starting together. The eleven pieces pass (0.286 to 0.61) because each also has moves placed in time: one-shot reactions and hand-keyed parts with a held lead-in, a frame or more apart. The measure is kept as it is, since those timed moves are what the reference files have too, and the skill now says where the share comes from (`references/motion.md`, "Writing keys so the profile reads them as you meant"). A scene made only of phased loops will still read below the band on this one measure; treat that as a prompt to add a timed reaction, not as proof that it looks mechanical.

### Acceptance

- `gertie profile` on a compiled corpus file prints every measure and matches a hand count on `candle` and `night-sky`.
- Run on the benchmark corpus of section 7, every file is inside every band.

---

## 2. Artwork

The reference files are illustrations. The agent must draw one before it animates one. This section is mostly about what `SKILL.md` and `references/scene.md` teach, and what the linter asks for.

### 2.1 Draw with paths, not primitives

Reference: 87% of files use free-form paths. The median is 33 paths across the wider sample, 53 in featured files and 209 in complex scenes, with 6 to 8 vertices per path. Gertie's corpus median is 0 paths.

- Teach a build order in the skill: silhouette first, then large interior shapes, then shading, then small details. Each is one or more `path` nodes.
- Aim for 6 to 10 vertices per path. Fewer looks like a polygon. More costs size and makes morphing hard.
- Use smooth curve commands (`C`, `S`, `Q`) for organic shapes. A path made only of `L` segments reads as low-polygon, which is right only when that is the chosen style.
- Keep `rect`, `ellipse`, `star` and `polygon` for what is truly that shape: wheels, eyes, buttons, screens.
- For anything the agent cannot draw well freehand, the existing `import` and `trace` commands (`10-references.md`) bring in real artwork. The skill should say this plainly: when the user supplies a logo or a character, import it, do not redraw it.

New lint warning `W-ART-PRIMITIVE`: the scene has more than 8 shape nodes and no `path` node with a curve in it. Message names the count and suggests paths for the silhouette.

### 2.2 Shade in layers

Reference: median 6 distinct colours, and 17 in complex scenes. Gradient fills are in 21% of all files and about 40% of featured and complex ones, typically with 3 stops.

A flat shape becomes a finished one with three additions, each a separate node on top of the base:

1. A shadow shape in a darker tone of the base colour, on the side away from the light.
2. A highlight shape in a lighter tone, small, on the side toward the light.
3. A ground shadow under the object: a flat dark ellipse at low opacity.

Guidance for the skill:

- Pick one light direction for the whole scene and keep every shadow and highlight consistent with it.
- Build the palette as three or four hues, each with a base, a shade and a tint. That gives 6 to 12 colours, which is the character band. A full scene adds one or two more hues for the background and reaches 12 to 20. Put them in `palette` so they stay consistent.
- Use a gradient where a surface is curved or large (a sky, a sphere, a screen glow), with 3 stops. Do not put a gradient on everything.
- Use `clip` to keep a shadow or highlight inside its base shape. This is what makes shading cheap to draw: the shading shape can be a rough blob, and the clip trims it to the silhouette.

New lint warning `W-ART-FLAT`: the scene has more than 12 shape nodes, 3 or fewer distinct fill colours and no gradient.

### 2.3 Strokes

Reference: about 70% of files use strokes. On the first page, caps are butt 58%, round 42%, and joins are miter 79%, round 21%.

- Decide per scene: outlined style (every shape has a stroke of one consistent width and colour) or flat style (no outlines, strokes only for lines and details). Mixing the two looks unfinished.
- Gertie's stroke defaults are round caps and round joins, which suits line icons and hand-drawn styles. Keep the defaults. Tell the agent to choose `miter` joins for geometric and interface artwork.
- Trim paths (29% of reference files, 44% of the popular group) are the standard way to draw a line on. `draw-check` already shows it.

### 2.4 Canvas size and frame rate

Reference: median canvas 800 pixels, 1080 for complex scenes. Frame rate is split: 30 fps in 47% of files and 60 fps in 36%.

- Skill guidance: author at 512 for icons and 1024 for characters and scenes. Coordinates at this size leave room for detail without decimals.
- **Decision:** the default `fps` stays at 30. The wider sample has more files at 30 than at 60, and complex scenes are mostly 30. The skill tells the agent to set 60 only for short pieces with fast motion (interface transitions, a walk cycle) that will be shown as Lottie, SVG or video.

### Acceptance

- The skill text contains the build order, the shading recipe, the palette recipe and the two style choices.
- An agent given the brief "a potted plant swaying" produces a scene with at least 15 paths, at least 6 colours and at least one gradient, in two attempts or fewer. This goes into `tests/agent-eval/` beside the existing phase 5 and 6 evaluations.

---

## 3. Motion

### 3.1 Density: keep things alive between poses

Reference: 20 keyframes per second in the median file, 33 for characters and 81 for walk cycles. On the first page a typical animated property has 13 keyframes about 150 milliseconds apart. Gertie's corpus median is 4 keyframes in the whole file.

The extra keyframes are not noise. They are:

- **Anticipation** before a move, and **overshoot and settle** after it. Each adds 2 or 3 keys to a move.
- **Moving holds.** A character that has arrived keeps drifting a few pixels or a degree, so it never freezes. `09-motion-presets-and-rigs.md` already designs this for `rig-idle`; it should be general.
- **Secondary motion.** When a body moves, attached parts (hair, a tail, an antenna, a held object) follow a few frames later and swing past.
- **Squash and stretch** on contact.

What to build:

- A general overshoot option on any keyframe move (built as `overshoot`, not `settle`, so it does not collide with the `settle` easing), which the expander turns into overshoot keys: past the target by a set fraction, back under by a smaller one, then to rest. This matches how the reference does overshoot (extra keys, not a curve outside 0 to 1: only 0.6% of reference segments use such a curve). The existing `spring` and `elastic` easings already expand to keys and stay.
- An ambient preset family that adds a small continuous drift to position, rotation or scale, with a period that divides the duration so the loop closes. The design is in `09-motion-presets-and-rigs.md` under "Living motion".
- A `follow` relation: a node repeats its parent group's rotation or position animation, delayed by a few frames and scaled up. The expander writes it as plain keys.

New lint warning `W-MOTION-SPARSE`: duration over 3 seconds and fewer than 3 keyframes per second across the scene (the reference 10th percentile is 1.5 to 3). The existing `W-STATIC` covers the case of nothing moving at all.

### 3.2 Easing

Reference: 78% of segments eased in the median file. The dominant curves are pronounced ease in and out. Holds are close to absent.

Gertie's named easings already cover the range, and the default `easeInOut` (0.65, 0, 0.35, 1) sits between the two most common reference curves. Three small changes:

- Add named easings for the reference's most used curves, so the agent can ask for them by character instead of by number. **Settled** on the proposed names:

| Proposed name | Bezier | Use |
|---|---|---|
| `smooth` | 0.7, 0, 0.3, 1 | The default for a deliberate move from one pose to another |
| `gentle` | 0.2, 0, 0.8, 1 | Small drifts and moving holds |
| `snap` | 0.8, 0, 0.3, 1 | Fast interface transitions |
| `settle` | 0.3, 1, 0.7, 1 | Arriving quickly and easing to rest |

- Skill guidance: use at least three different eases in any scene longer than 2 seconds (the reference median is 3 to 7 distinct curves), and choose by weight. Heavy things get stronger ease in. Light things start fast.
- When two keyframes are closer than about 100 milliseconds, the ease between them barely shows. The reference uses near-linear curves there. The agent should not spend effort on easing those segments.

New lint warning `W-EASE-UNIFORM`: more than 20 eased segments and every one uses the same curve.

### 3.3 Offsets

Reference: in the median file, a quarter or more of animated properties start on a frame no other property starts on.

`stagger` and `delay` exist. `W-SYNC` is designed in `09-motion-presets-and-rigs.md` for loops that run in step. Extend the same idea to starts: warn when more than 6 animated properties exist and over 80% begin on the same frame. The fix the message suggests is a `stagger` of 0.03 to 0.1 seconds on the parent group.

### 3.4 Loops

Reference: about half of animated properties end on their starting value (70% in complex scenes), and the median duration is 4 seconds, 6 for complex scenes.

- `W-LOOP-JUMP` already catches a loop that does not close. No new rule is needed. **Changed with the benchmark corpus:** one exception was needed. A scrolling background moves a repeating pattern by a whole number of its repeats, so its `x` ends far from where it starts and the loop is still seamless; the rule reported it, and no looping scene could have a scrolling background and zero warnings. An `x` or `y` with exactly two keys, at 0 and at the duration, the second `linear`, is now left to the render check `W-R-LOOP` (`06-validation.md`).
- Skill guidance on length: a loop under 2 seconds reads as a spinner. A character or scene loop should run 4 to 8 seconds, with sub-loops of different periods inside it (a 2 second bob, a 4 second blink cycle, an 8 second look around) so the repeat is hard to spot. The periods must all divide the duration.

### 3.5 Motion along a path

Reference: only 2% of position keyframes follow a curved spatial path.

This stays out. Arcs are made as the reference makes them: separate keyframe timing on `x` and `y`, or rotation of a parent group about a distant pivot. `03-scene-spec.md` lists motion along a path as a candidate for a later version; move it to the bottom of that list.

### Acceptance

- `overshoot`, the ambient presets and `follow` each have a unit test on the expanded keys and a corpus example.
- The agent evaluation brief "a mascot that waves and then idles" produces a scene with at least 25 keyframes per second, at least 4 distinct eases, and no `W-MOTION-SPARSE`, `W-EASE-UNIFORM` or `W-SYNC`.

### As built (phase 10, task 3)

- **Already there from phase 5b:** the ambient presets, the moving holds in `rig-idle`, and `W-SYNC` for loops in step. Not rebuilt. Details in `09-motion-presets-and-rigs.md`, "Implementation notes (phase 10, section 3)".
- **Easings:** `smooth`, `gentle`, `snap` and `settle` are in `EASINGS` in `src/presets/easing.ts` and in the table in `03-scene-spec.md`. The default is unchanged.
- **`overshoot`, not `settle`:** the option on a long-form keyframe is named `overshoot`, because `settle` is now an easing name and the two would be confused. The key's time is the peak and its value is the rest; defaults are `past` 0.1, `back` 0.03 and `time` 0.3 seconds, chosen on the contact sheet of `examples/overshoot-badge` (a scale from 0.5 to 1, a rotation and a slide). Syntax in `03-scene-spec.md`.
- **`follow`:** a node field with `props`, `delay` (default 0.1) and `scale` (default 1.5). Syntax and rules in `03-scene-spec.md`; checked on the contact sheet of `examples/follow-chain`, where four links trail and whip past one another. A chain with the default scale 1.5 would swing too far because angles add, so the example uses 1.3 and the guidance says so.
- **Warnings:** `W-MOTION-SPARSE` and `W-EASE-UNIFORM` as designed, silent for `tier: "icon"`. `W-SYNC` now has the start rule, in the expander, with phased loops and delayed followers counted as their own start (section 3.3 did not allow for loops that cannot be moved with `at`). All codes are in `06-validation.md`. **Changed with the benchmark corpus:** the start rule took a property's first key as its start, where `profile` takes the first key whose value differs from the next. A scene had to key every property from 0 to keep padded hold segments out of its eased share, and then every property "started" on frame 0. The rule now uses the first value change, as the profile does (`firstChange` in `src/presets/expand.ts`).
- **Potted plant, `gertie profile --tier character`:** 22 animated properties (band 20 to 60), 199 keyframes in 6 seconds, 33.2 per second (25 to 60), median 9 keys per property, eased share 0.774 (0.75 or more), 5 distinct easing curves (4 to 10), own-start share 0.455 (0.25 or more). The artwork measures from section 2 stay inside. **Layers is 55, above the band of 15 to 40, and is not met.** The cause is the emitter, not the motion: each of the seven leaves and the pot has a `clip` for its shading, so each becomes a precomposition, and every shape inside it is its own layer (4 main, 9 in the pot, 14 in the plant, 4 in each leaf). The measure in the reference counts layers where Gertie draws shapes inside groups; the two bands for path count (40 to 80) and layers (15 to 40) cannot both hold for a clip-shaded character with one shape per layer. Left for the precomposition check of section 4.1, which asks whether clipped shapes should be emitted another way, and for a decision on the band; nothing was changed in the artwork to hit the number.
- **Not done:** the agent evaluation brief "a mascot that waves and then idles" was not run, because it needs an agent given only the skill files. The unit tests and the examples cover each feature; the 25-keyframe, 4-curve and no-warning check is open and belongs with prompt 7.

---

## 4. Format features

Ordered by how often the reference uses each, against what it costs in both emitters.

The "reference use" column gives the share of all 415 files in the wider sample, then the share of the complex tier.

| Feature | Reference use | Gertie today | Decision |
|---|---|---|---|
| Parenting | 56%, 74% | Groups nest. A plain group becomes shape groups; others become precompositions | Keep. See 4.1 |
| Mattes | 26%, 41% | Left out. `clip` covers hard-edged cases | Add. See 4.2 |
| Path morphing | 47%, 51% | Supported, with the same-structure rule | Keep. Improve guidance, see 4.3 |
| Gradient fills | 21%, 38% | Supported, static | Add animated end points. See 4.4 |
| Markers | 13%, 22% | Not written | Add, small. See 4.5 |
| Merge paths | 14%, 26% | Not supported | Leave out. See 4.6 |
| Effects | 14%, 18% | Left out | Leave out. Player support is inconsistent |
| Gradient strokes | 7%, 13% | Not supported | Add with 4.4 if cheap |
| Blend modes | 6%, 13% | Left out | Leave out |
| Expressions | 8%, 8% | Left out | Leave out. Not supported by most players |
| Text layers | 2%, 4% | Left out, planned as text converted to paths | Keep the plan. Low priority |

### 4.1 Parenting

The scene's `group` already gives the agent hierarchy, which is what parenting is for. The reference's use of parenting is the equivalent of "uses groups". No scene format change.

One thing to check: `04-lottie-emitter.md` rule 4 turns any group containing a `clip`, a `use`, an `image` or a time window into a precomposition with a margin of one canvas side. Shading as described in section 2.2 puts a `clip` on many nodes, so a well-drawn scene may produce many large precompositions. **Verify during build:** compile a scene with 30 clipped nodes, and measure file size and frame time in lottie-web and in the dotLottie player. If either is poor, clipped shapes that have no other reason to be a precomposition should be emitted another way (a matte pair of shape layers, once 4.2 exists).

**Result (phase 10, section 4.1, experiment A).** A scene of 30 groups on a 1024 pixel canvas, each with three ellipses of which the shading one has a `clip` (so each group becomes a precomposition), against the same scene with no clips. Measured in Chrome 157 with lottie-web 5.13.0 and dotlottie-web 0.83.2, 120 frame changes each:

| | No clips (0 precompositions) | 30 clips (30 precompositions) |
|---|---|---|
| Lottie JSON | 38 584 bytes, 1 138 gzipped | 64 445 bytes, 1 932 gzipped |
| lottie-web, JavaScript per frame | 0.07 to 0.15 ms | 0.08 to 0.17 ms |
| lottie-web, frame change plus screenshot | 44 ms | 41 ms |
| dotlottie-web, `setFrame` per frame | 1.2 to 1.6 ms | 1.4 to 1.9 ms |

The size grows by two thirds as JSON but stays under 2 kB compressed, and the frame time does not change beyond measurement noise (the screenshot figure is dominated by the capture itself). **The precompositions are not a problem, so the emitter is unchanged:** clipped shapes keep their precompositions and are not emitted as matte pairs. A clip on a node that is not inside a group is a mask on a shape layer and never made a precomposition; only a clip on a node inside a group does. The layer count that the `potted-plant` profile reports above its band (section 3, "As built") is real but is a counting question, not a cost: the band for layers is left as it is.

### 4.2 Mattes

A matte uses one node's alpha, or its inverse, to reveal another. The reference uses mattes for soft-edged reveals, shine sweeps across a surface, liquid fills and shading that stays inside a moving shape.

Proposed scene form: a node field `matte`, holding the id of a sibling node and a mode.

```json
{ "id": "shine", "type": "rect", "w": 40, "h": 300, "fill": "#ffffff66",
  "matte": { "by": "badge-shape", "mode": "alpha" } }
```

- `mode` is `"alpha"` or `"alpha-inverted"`. Luma mattes are left out.
- The node named by `by` is not drawn itself. Lint error if it is missing, is not a sibling, or is used by two nodes with different modes.
- Lottie: the matte source becomes a layer with `td: 1` directly above the matted layer, which gets `tt: 1` or `tt: 2`. Both must be their own layers, so a matted node forces layer splitting in the same way a time window does.
- SVG: a `<mask>` holding the source node, referenced by `mask` on the matted node, with `mask-type: alpha`. For the inverted mode, a white rectangle with the source drawn in black, luminance type. **Verify during build:** that CSS animation on elements inside a `<mask>` runs in Chrome, Firefox and Safari when the SVG is loaded through an `<img>` tag. `05-svg-emitter.md` records which mechanisms survive there.

**Result (phase 10, section 4.2, experiment B).** A hand-written SVG (no Lottie involved) with a circle inside a `<mask>`, moved by a CSS `@keyframes` animation of `transform`, masking a red rectangle. Checked by sampling the alpha of two pixels at 0.15 s and at 1.65 s, for `mask-type: alpha`, for the inverted form (white rectangle, source in black, luminance), and for a SMIL `<animate>` of `cx` inside the mask, each inline and through an `<img>`:

| Browser | Alpha, CSS | Inverted, CSS | Alpha, SMIL | Inline | Through `<img>` |
|---|---|---|---|---|---|
| Chromium (Chrome 157) | animates | animates | animates | yes | yes |
| WebKit (Playwright 27.2) | animates | animates | animates | yes | yes |
| Firefox | not run: the browser does not start on the development machine | | | | |

In every case the mask followed the animation, so the matte is built in both emitters. Firefox is untested here, as for the rest of the SVG output (`05-svg-emitter.md`); that is not a test, so do not claim Firefox support for mattes until `GERTIE_BROWSERS=firefox npm run test:browser` has run.
- The parity test covers it like any other feature.

### 4.3 Path morphing

Supported today. The barrier is the rule that every keyframe's path has the same structure, which agents break often.

- Skill guidance: write the first shape, copy it, and move points. Never redraw the second shape from scratch.
- Consider a helper in the normalizer that makes two paths compatible by subdividing segments of the one with fewer, when the subpath counts already match. **Verify during build** that the resulting morphs look acceptable; an automatic match can twist. If it does, keep the strict rule and improve the error message only.

### 4.4 Animated gradients

Reference, first page: 64 animated gradient start or end points, against 1 animated set of gradient colours. So animate the geometry, not the stops.

- Make `fill.from`, `fill.to` (linear) and `fill.center`, `fill.radius` (radial) animatable.
- Lottie: keyframes on the gradient's `s` and `e`.
- SVG: CSS cannot animate gradient attributes. Use SMIL `<animate>` on `x1`, `y1`, `x2`, `y2`, or on `gradientTransform`. `05-svg-emitter.md` already uses SMIL for morphs, so the mechanism is in place.
- Gradient stops stay static in this version.

### 4.5 Markers

Named points on the timeline (`intro`, `loop-start`, `loop-end`). Players and interactive wrappers use them to play a segment. Proposed: a top-level `markers` object mapping a name to `[start, end]` in seconds, written to the Lottie `markers` array. No SVG form. Small and independent.

### As built (phase 10, sections 4.4, 4.5 and the matching part of 5)

- **Markers:** top-level `markers`, `{ name: [start, end] }` in seconds, written to the Lottie `markers` array as `{ cm, tm, dr }` in frames. `E-MARKER` covers a bad name (the id rules), a value that is not a pair, a start that is not less than the end, and a time outside the duration. No SVG form. The generated file passes schema validation with no warnings and no tolerated-property exception.
- **Animated gradient geometry:** `fill.from` and `fill.to` on a linear gradient, `fill.center` and `fill.radius` on a radial one, as flat dotted keys. Stops stay static. The wrong pair, or a solid fill, is `E-PROP-UNKNOWN`, with a message that names the pair that fits; a value of the wrong shape is `E-KEY-VALUE`.
- **Lottie:** keyframes on `s` and `e` of the `gf` item. For a radial gradient `e` is the centre plus the radius, so when `fill.center` and `fill.radius` have different key times `e` is baked per frame; otherwise it is keyed directly.
- **SVG:** SMIL on the gradient element, as the design said. It plays in Chromium and in WebKit including through an `<img>`. Firefox is untested (it does not launch here). Details in `05-svg-emitter.md`.
- **Gradient strokes:** not built. The stroke is a plain colour in the scene, the normalized form, both emitters and the profile, so a gradient stroke touches all of them and is not the small change the design asked for. Left for later.
- **Corpus:** `examples/gradient-sweep.gertie.json` (a shine travelling along a bar, and a radial highlight that moves and swells) and `examples/markers-demo.gertie.json`. Both pass `qa` with no diagnostics; parity worst case 0.13 and 0.16 percent of pixels. Sizes: gradient-sweep 2457 bytes of Lottie and 1649 of SVG; markers-demo 1414 and 752.

### As built (phase 10, sections 4.1, 4.2 and the matching part of 5)

- **4.1:** measured and left unchanged (see the result under 4.1). No golden changed because of it.
- **Mattes:** the node field `matte: { by, mode }`, `mode` defaulting to `"alpha"`. Lint errors `E-MATTE-FIELD`, `E-MATTE-BY`, `E-MATTE-MODE`, `E-MATTE-SIBLING` (also for a source in another group, and for a matte on a definition), `E-MATTE-CONFLICT` and `E-MATTE-CHAIN` (a source that is itself matted; not in the design, added because the Lottie layer order cannot express it). Lottie: `td: 1` source layer directly above the matted layer, `tt` 1 or 2, a shared source written again above each user, a group holding a pair becomes a precomposition. The validator knows `tt` but not `td`, so `td` joins the tolerated unknown properties, and the semantic check now allows alpha mattes and reports `E-L-MATTE-ORDER` for a `tt` without a source above it. SVG: a `<mask>` outside the node's transforms; the inverted form needed a scoped recolouring rule (the first version recoloured its own white rectangle, found by the parity check).
- **Corpus:** `examples/matte-shine.gertie.json` (a shine across a badge, `alpha`) and `examples/matte-reveal.gertie.json` (a cover revealed through a growing hole, `alpha-inverted`). Both pass `qa` with no diagnostics. Parity worst case 0.07 and 0.10 percent of pixels. The contact sheets show no source shape.
- **Not verified:** Firefox. The behaviour of a Lottie matte in players other than lottie-web and dotlottie-web.

### 4.6 Merge paths

Left out. Merge paths are boolean operations done by the player, and several players do not implement them. The same result is available at authoring time: a compound path with `fillRule: "evenodd"` for holes, and `clip` or a matte for intersections. State this in the skill so the agent does not look for it.

### Acceptance

- Mattes and animated gradient geometry each have: scene lint rules with a triggering and non-triggering case, unit tests on the emitted Lottie, a corpus example, a golden file, and a passing Lottie-to-SVG parity check.
- `03-scene-spec.md` section "What version 1 leaves out" is updated in the same change.

---

## 5. SVG output

The SVG emitter is correct for what it supports. Quality work here is keeping it level with section 4 and keeping it small.

- **Mattes and animated gradients** as described in 4.2 and 4.4.
- **Smoothness.** CSS and SMIL animation runs at the display's refresh rate whatever `fps` says, so SVG output is already as smooth as a 60 fps Lottie. Baked properties are the exception: they are sampled at `fps`. **Verify during build** that baked segments at 30 fps do not show stepping on fast motion; if they do, bake at 60 regardless of the scene's `fps`.
- **Size.** A scene at the section 1 aim will produce a much larger SVG than today's examples: 50 paths for a character, 200 for a full scene. Measure it. Reference Lottie files have a median of 71 kB as JSON and 12 kB compressed, and 272 kB and 30 kB for complex scenes. A comparable SVG should stay under about 60 kB before compression for a character and 250 kB for a full scene. The levers are coordinate precision (one decimal at a 1024 canvas is enough), shared keyframe blocks for identical animations, and class reuse.
- **Crisp edges.** Check `shape-rendering` and that no node ends up on a half-pixel after normalization at common canvas sizes.
- **Poster frame.** With longer, richer scenes the `poster` time matters more. The skill should tell the agent to set it to the most complete pose.

### Result (benchmark corpus)

- **Size.** Every benchmark SVG is under the size for its tier, with nothing changed in the emitter: the two characters are 30.1 and 38.6 kB against 60, and the four scenes are 56.5 to 61.3 kB against 250. The five icons are 7.6 to 10.8 kB. The SVG is smaller than the Lottie JSON in every case (table in section 7). The three levers (coordinate precision, shared keyframe blocks, class reuse) were therefore not tried; there is no measured saving to report for them.
- **One size problem was found, and it was in the scene, not the emitter.** The first version of `rocket-smoke` compiled to 469.9 kB of SVG, over the limit. Seven morphs were baked frame by frame, because their `d` keys began at the moment the node appears and the padding before that is a hold: a morph that mixes hold and bezier segments cannot be one SMIL animation. Starting each morph's keys at 0, with the node's own `from` hiding it until then, removed all seven bakes and the file is 61.3 kB. The rule is now in `skills/gertie/references/motion.md` ("Morphs and time windows"). None of the eleven pieces bakes anything.
- **Smoothness of baked segments.** Tested and not a problem, so baking stays at the scene's `fps`. A baked property is written as one sample per frame with linear interpolation between samples (CSS `linear`, SMIL without `calcMode`), not as steps. Checked on a scratch scene at 30 fps with two baked properties moving fast: a trim whose start and end are on different timelines sweeping a full ring in 0.3 seconds, and a morph with a hold and a bezier segment travelling 300 pixels in 0.2 seconds. At frames 2, 4, 7 and 9 the SVG rendered half a frame later differed from the frame before and from the frame after by the same share of pixels (0.54 and 0.53, 0.55 and 0.54, 1.35 and 1.36, 1.01 and 1.01 percent), and from the Lottie rendered at the same half frame by 0.00 to 0.01 percent. So between samples the SVG moves, and moves where the Lottie does. Chromium only.
- **Parity.** All eleven pass on the sampled frames of `qa` (worst case 0.59 percent of pixels, `book-call-button`) and on every frame in `npm run test:browser`.
- **Not checked:** crisp edges and half-pixel placement.

### Acceptance

- Every benchmark corpus scene passes the parity check.
- Each benchmark SVG is under the size given above for its tier, or the reason is recorded.

---

## 6. GIF and video output

Vector quality is decided by the scene. Raster quality is decided here, and it can be raised without touching the rest.

The reference site's rendered downloads were not measured. The settings below come from general encoding practice and from the recipes already verified in `07-render-and-export.md`.

**As built (phase 10, task 6).** Each setting was tried against its alternative and the results are in `07-render-and-export.md`, "Output size and quality". Kept: the 1080 video size, the 640 GIF cap, BT.709 tagging, `-tune animation`, 50 or 25 fps GIFs by a 6 MB budget, the global GIF palette, the checks. Rejected: `--quality high` as the default (it costs 2.3 times the time for no measured gain; it stays an option and uses the `area` scaler, because lanczos left an edge halo), VP9 crf 24, H.264 crf 16, the per-frame GIF palette, and tags on HEVC. Two additions the section did not name: frames shrunk by 1.5 or more use `area`, and a scene with its own background gets the opaque GIF recipe.

### 6.1 Render size

- Today a 256 pixel scene exports at 256 pixels unless `--scale` or a destination says otherwise. Proposed default for `mp4`, `webm`, `prores` and `hevc`: render so the longer side is at least 1080 pixels, using the existing scale mechanism. A scene authored at 1024 exports near 1:1; a 256 icon exports at 4x or 5x. This needs the 4x ceiling in the exporter raised or made per-format.
- H.264 with `yuv420p` needs even dimensions. Round up and pad, do not round down.
- GIF stays at the authored size, capped at 640 pixels on the longer side by default, because GIF size grows quickly.

### 6.2 Supersampling

Render frames at twice the output size and scale down with the lanczos filter the exporter already uses. This removes the stair-stepping on thin strokes and small text that single-sample rendering leaves. Cost: four times the pixels per frame. Offer it as `--quality high` and make it the default for video formats only if render time on a 6 second, 60 fps scene stays acceptable. **Verify during build.**

### 6.3 Frame rate

- Video formats export at the scene's `fps`. Section 2.4 allows 60 for fast motion, so check each recipe at 60 fps as well as 30.
- GIF frame delays are whole hundredths of a second, so the usable rates are 50, 25 and 20. A 60 fps scene should be resampled to 50 or 25, chosen by a size budget. Today the recipes fix 25.

### 6.4 Encoder settings

| Format | Today | Proposed |
|---|---|---|
| MP4 (H.264) | `-crf 18 -preset slow`, `yuv420p` | Keep. Add `-tune animation`. For flat-colour artwork consider `-crf 16` |
| WebM (VP9, alpha) | `-crf 30 -b:v 0` | Lower to `-crf 24` for the default; keep 30 for size-limited destinations such as Telegram |
| GIF | Global palette, bayer dither when transparent, sierra dither when opaque | For scenes with gradients, test a per-frame palette (`stats_mode=single` with `paletteuse=new=1`) against the global one. Gradients are in about 40% of the richer reference files and are where GIF banding shows |
| ProRes 4444, HEVC with alpha | As documented | Keep |

Colour: frames are sRGB PNG. Tag video output as BT.709 with the matching transfer and primaries so players do not shift the colours. **Verify during build** by comparing a rendered frame's colour values with the first decoded video frame.

### 6.5 Checks

Add to the export verification that already exists for alpha:

- Decode the first, middle and last frame of each video and compare with the rendered PNG frames. Fail above a set difference, which catches colour shift and heavy compression.
- For transparent formats, check edge pixels for a dark or light fringe (premultiplication errors).
- For loops, compare the last frame with the first, as `W-R-LOOP` does for rendered frames.

### Acceptance

- A benchmark scene with a gradient background exports to MP4 at 1080 pixels with no visible banding and a first-frame difference under the threshold.
- The same scene's GIF is under the size budget and its gradient is not visibly banded at 100% zoom.
- `07-render-and-export.md` is updated with the settings that were kept and the ones that were rejected, with the reason.

---

## 7. Benchmark corpus

Eleven briefs that cover the kinds of animation in the reference sample. Each is written as a scene file by an agent using only the skill, compiled, profiled and reviewed. They live in `examples/benchmark/` and are part of the golden and parity tests.

| Brief | Kind | What it exercises |
|---|---|---|
| Success tick in a circle | Icon | Trim path, overshoot and settle, colour change |
| Three-dot loader | Loader | Stagger, squash and stretch, clean loop |
| Notification bell with badge | Icon | Rotation about a pivot, follow-through on the clapper, pop-in |
| Toggle switch | Interface | Position and colour together, strong ease in and out |
| "Book a call" button with hover sweep | Interface | Matte for the shine sweep, text as paths |
| Bouncing mascot | Character | Rig, squash and stretch, ambient idle, blink |
| Walking bird | Character | Walk cycle, parented limbs, secondary motion |
| Delivery scene with a van | Scene | Many paths, shading, scrolling background, layered loops |
| City street at dusk | Scene | The full-scene tier: 120 or more paths, 12 or more colours, few moving parts |
| Rocket launch with smoke | Scene | Path morphing, time windows, gradients |
| Sky with drifting clouds and a greeting | Scene and text | Gradient background, sub-loops of different periods |

Rules:

- Original artwork only. None of these may copy a reference animation's design. The subjects are generic on purpose.
- Every file is produced by the compiler from a scene file.

### As built

The eleven scenes are in `examples/benchmark/`. Each compiles with no diagnostics, is inside every measure of its tier's band, and was looked at on its contact sheet (and, for the scenes, on a full-size frame) before it was accepted. The two interface pieces use the icon tier.

| Brief | File | Tier |
|---|---|---|
| Success tick in a circle | `success-tick` | icon |
| Three-dot loader | `dot-loader` | icon |
| Notification bell with badge | `bell-badge` | icon |
| Toggle switch | `toggle-switch` | icon |
| "Book a call" button with hover sweep | `book-call-button` | icon |
| Bouncing mascot | `bouncing-mascot` | character |
| Walking bird | `walking-bird` | character |
| Delivery scene with a van | `delivery-van` | scene |
| City street at dusk | `city-dusk` | scene |
| Rocket launch with smoke | `rocket-smoke` | scene |
| Sky with drifting clouds and a greeting | `sky-greeting` | scene |

How they were written: as scene files, from the skill's references, with a small script per piece that holds the drawing helpers (a smooth closed shape through a list of points, a rounded rectangle and a circle as paths) and writes the JSON. The scripts are in `examples/benchmark/generators/` (run `node examples/benchmark/generators/<name>.mjs` to rewrite a scene); the scene files are what the compiler and the tests read. `rocket-smoke` is a one-shot (`"loop": false`); the other ten loop.

**Tests.** `tests/unit/golden.test.ts` reads `examples/benchmark/` as well as `examples/`, with one golden folder, and checks that no scene name is used twice. `tests/browser/parity.spec.ts` scans every frame of each benchmark scene. No existing golden file changed.

**Changes outside the corpus that the pieces forced.** Both are in the linter and both are described where the rule is (sections 3.3 and 3.4, and `06-validation.md`): the start rule of `W-SYNC` now counts a property from its first value change, and `W-LOOP-JUMP` leaves a two-key linear `x` or `y` scroll to the render check.

**What the skill guidance gained** (`skills/gertie/references/`), each from a round lost while drawing:

- `motion.md`, "Writing keys so the profile reads them as you meant": key every property from 0 to the end (padded ends are hold segments and sank one icon's eased share to 0.46); a held lead-in is still an offset; name the ease on every key in an icon; keyframes per second has a ceiling, and how to count loops against it; where the own-start share comes from.
- `motion.md`, "A background that scrolls": the two-key linear form, how much content to draw, layers at different speeds, timing a reaction to something in the fastest layer, whole wheel turns.
- `motion.md`, "Morphs and time windows": start a morph's keys at 0 even when the node appears later.
- `motion.md`: choose a `phase` that lands on one of the preset's keys (any other phase adds two keyframes and two curves per loop); `follow` needs the direct parent to animate the property, and cuts a curve when the parent is keyed across the whole loop; the crouch, peak and landing times of `rig-jump`; the clouds row no longer suggests a form that reported `W-LOOP-JUMP`.
- `artwork.md`, "What the profile counts": only `path` nodes are paths; vertices per path is an average; what counts as a colour and what does not; which nodes become layers.
- `artwork.md`, "Full scenes": the node and size limits against the path floor, repetition with variation, a canvas `background` for full-bleed scenes.
- `artwork.md`, "Text": letters as stroked paths.
- `scene.md`: the scroll exception under "Making a loop".

### Results

Profile of each piece (`gertie profile`). Every value is inside its tier's band in section 1.

| Piece | Tier | Canvas | fps | Seconds | Layers | Paths | Vertices per path | Colours | Animated properties | Keyframes per second | Eased share | Easing curves | Own start share |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `success-tick` | icon | 512 x 512 | 30 | 3 | 6 | 12 | 4.33 | 5 | 10 | 20.33 | 1 | 3 | 0.5 |
| `dot-loader` | icon | 512 x 512 | 30 | 2.2 | 6 | 9 | 5.67 | 4 | 9 | 23.64 | 1 | 3 | 0.556 |
| `bell-badge` | icon | 512 x 512 | 30 | 3 | 4 | 13 | 5.23 | 5 | 7 | 17.67 | 0.913 | 2 | 0.286 |
| `toggle-switch` | icon | 512 x 512 | 30 | 3 | 4 | 7 | 7 | 5 | 7 | 17.67 | 1 | 4 | 0.571 |
| `book-call-button` | icon | 512 x 512 | 30 | 3 | 9 | 20 | 4.25 | 5 | 9 | 23.67 | 1 | 4 | 0.556 |
| `bouncing-mascot` | character | 1024 x 1024 | 30 | 4.4 | 28 | 53 | 6.47 | 12 | 33 | 57.5 | 0.909 | 10 | 0.424 |
| `walking-bird` | character | 1024 x 1024 | 30 | 2.4 | 23 | 60 | 6.47 | 12 | 21 | 58.75 | 0.958 | 8 | 0.381 |
| `delivery-van` | scene | 1080 x 810 | 30 | 6 | 58 | 166 | 5.95 | 20 | 35 | 33.67 | 0.946 | 6 | 0.429 |
| `city-dusk` | scene | 1080 x 810 | 30 | 8 | 40 | 143 | 6.9 | 20 | 41 | 31.88 | 0.986 | 6 | 0.61 |
| `rocket-smoke` | scene | 810 x 1080 | 30 | 8 | 40 | 122 | 6.31 | 18 | 44 | 30.88 | 0.862 | 6 | 0.5 |
| `sky-greeting` | scene | 1080 x 810 | 30 | 8 | 46 | 134 | 6.03 | 18 | 39 | 33.88 | 0.987 | 5 | 0.538 |

Sizes. Lottie JSON and SVG are the files `qa` writes. MP4 and GIF are from `gertie export --to mp4,gif` with default settings; the checks are those of section 6.5 (decoded frames against rendered frames, and the loop).

| Piece | Lottie JSON, kB | SVG, kB | SVG limit for the tier, kB | MP4, kB | MP4 size | GIF, kB | GIF size | Export checks |
|---|---|---|---|---|---|---|---|---|
| `success-tick` | 10.3 | 9.7 | none given | 153.3 | 1080 x 1080 | 515.5 | 512 x 512, 75 frames | pass (frames, loop) |
| `dot-loader` | 9.5 | 7.6 | none given | 118.2 | 1080 x 1080 | 243.0 | 512 x 512, 55 frames | pass (frames, loop) |
| `bell-badge` | 10.1 | 8.2 | none given | 165.6 | 1080 x 1080 | 523.3 | 512 x 512, 75 frames | pass (frames, loop) |
| `toggle-switch` | 8.2 | 7.8 | none given | 117.5 | 1080 x 1080 | 390.5 | 512 x 512, 75 frames | pass (frames, loop) |
| `book-call-button` | 13.6 | 10.8 | none given | 254.0 | 1080 x 1080 | 647.9 | 512 x 512, 75 frames | pass (frames, loop) |
| `bouncing-mascot` | 50.7 | 38.6 | 60 | 686.8 | 1080 x 1080 | 1544.6 | 640 x 640, 110 frames | pass (frames, loop) |
| `walking-bird` | 46.4 | 30.1 | 60 | 336.5 | 1080 x 1080 | 1346.1 | 640 x 640, 59 frames | pass (frames, loop) |
| `delivery-van` | 100.4 | 56.5 | 250 | 424.3 | 1080 x 810 | 2596.7 | 640 x 480, 149 frames | pass (frames, loop) |
| `city-dusk` | 93.6 | 57.1 | 250 | 210.9 | 1080 x 810 | 1144.8 | 640 x 480, 199 frames | pass (frames, loop) |
| `rocket-smoke` | 91.7 | 61.3 | 250 | 570.4 | 810 x 1080 | 3370.4 | 480 x 640, 199 frames | pass (frames) |
| `sky-greeting` | 92.3 | 60.3 | 250 | 750.7 | 1080 x 810 | 5419.8 | 640 x 480, 199 frames | pass (frames, loop) |

`rocket-smoke` does not loop, so it has no loop check. The ten transparent pieces' GIFs also passed the alpha read-back. The GIF of `sky-greeting` is 5.4 MB, close to the 6 MB budget that decides the GIF frame rate; a full-canvas gradient with layers scrolling at three speeds is the worst case for GIF.

**Not verified.**

- Firefox, as everywhere in the SVG output.
- Playback. Every piece was judged on still frames: contact sheets of 8 or 16 frames and single full-size frames. None was watched playing, so timing that only shows in motion (the bird's walk, the mascot's landing, the van's bump) is unconfirmed.
- The agent evaluations of sections 2 and 3 ("a potted plant swaying", "a mascot that waves and then idles"). They need an agent given only the skill files. `bouncing-mascot` meets the numbers that evaluation asks for (57.5 keyframes per second, 10 easing curves, no warnings), but it was written with the design documents open.
- Lottie playback in players other than lottie-web and dotlottie-web.

### Side-by-side review against reference animations

To be filled in by the user. Show at least five of the eleven pieces next to five reference animations of the same kind and record, for each, whether it can be picked out as the machine-made one.

### Acceptance for the whole quality phase

- All eleven scenes compile and validate with no errors, and with none of the new warnings from sections 2 and 3.
- `gertie profile` puts all eleven inside the band for their tier in section 1.
- All eleven pass the Lottie-to-SVG parity check.
- All eleven export to MP4 and GIF and pass the checks in section 6.5.
- The manual side-by-side review described at the top of this document is done for at least five of them, and the result is written into this document.

---

## Open decisions for the user

1. Whether a scene declares its tier in a `tier` field (section 1). **Settled: yes**, built in phase 10 task 1.
2. Names for the four new easings (section 3.2). **Settled: `smooth`, `gentle`, `snap`, `settle`**, built in phase 10 task 3.
3. Whether mattes are in scope for the first quality phase or the one after (section 4.2). They are in 26% of all reference files and 41% of complex ones, so they matter for featured-level work and hardly at all for icons. Recommended: second. Artwork, motion and export (sections 1 to 3 and 6) reach most of the bar without any format change; mattes and animated gradients follow.
4. Default video render size of 1080 pixels on the longer side (section 6.1).

## Documents to update when this is built

- `03-scene-spec.md`: `matte`, animatable gradient geometry, `markers`, new easing names, the reordered list of omissions.
- `04-lottie-emitter.md` and `05-svg-emitter.md`: emission rules for the above.
- `06-validation.md`: the new warnings `W-ART-PRIMITIVE`, `W-ART-FLAT`, `W-MOTION-SPARSE`, `W-EASE-UNIFORM`, and the extension of `W-SYNC` to starts.
- `07-render-and-export.md`: section 6 results.
- `09-motion-presets-and-rigs.md`: `settle`, `follow`, ambient presets.
- `13-skill-packaging.md` and `skills/gertie/references/`: the artwork and motion guidance.
- `14-build-plan.md`: a quality phase with the acceptance checks above.
