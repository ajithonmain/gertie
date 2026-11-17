# Validation

Gertie checks every animation at three gates. A file must pass all three before the agent presents it to the user.

| Gate | Checks | Catches |
|---|---|---|
| 1. Scene lint | The scene file itself | Mistakes in what the agent wrote |
| 2. Output validation | The emitted Lottie JSON against the official schema, plus a semantic lint | Compiler bugs, out-of-subset features |
| 3. Render checks | Actual rendered frames | Things that are valid but look wrong |

Gate 1 gives the agent feedback in terms of its own file. Gates 2 and 3 exist because a file can be schema-valid and still render incorrectly; the published research on model-generated Lottie found exactly that.

Gate 3 is described in `08-testing.md` under "Runtime QA". This document covers the diagnostic format and gates 1 and 2.

## Diagnostics

Every check produces diagnostics in one format. This format is the main interface between Gertie and the agent, so it is designed for a model to act on without guessing.

```json
{
  "code": "E-KEY-ORDER",
  "severity": "error",
  "node": "dot-2",
  "path": "nodes[1].animate.y[3]",
  "message": "Keyframe time 0.40 is not after the previous keyframe time 0.45.",
  "fix": "Keyframe times must increase. Change this time to a value greater than 0.45, or reorder the keyframes."
}
```

| Field | Meaning |
|---|---|
| `code` | Stable identifier. `E-` error, `W-` warning |
| `severity` | `"error"` blocks output. `"warning"` does not |
| `node` | The node id, when the problem belongs to a node |
| `path` | A JSON path into the scene file |
| `message` | What is wrong, with the actual values |
| `fix` | What to change. Always present for errors |

Rules for writing diagnostics:

- State the actual value and the allowed values. "Unknown easing 'easeOutBounce'. Valid names: linear, easeIn, ..." is useful. "Invalid easing" is not.
- For an unknown name, suggest the closest valid name by edit distance.
- One problem produces one diagnostic. Do not cascade: after an unknown node type, skip the checks that depend on the type.
- Report all independent problems in one run, so the agent can fix them together.
- Diagnostics from gate 2 are traced back to a node through the Lottie `nm` field, so they also carry `node`.

With `--json`, commands print:

```json
{ "ok": false, "errors": 2, "warnings": 1, "diagnostics": [ ] }
```

## Gate 1: scene lint

### Structure

| Code | Rule |
|---|---|
| `E-JSON` | The file is not valid JSON. Report line and column |
| `E-VERSION` | `gertie` is missing or not a supported version |
| `E-FIELD-MISSING` | A required field is absent |
| `E-FIELD-UNKNOWN` | An unknown field is present. Suggest the closest valid field |
| `E-FIELD-TYPE` | A field has the wrong type |
| `E-CANVAS` | Canvas size is not a positive integer, or exceeds 4096 |
| `E-FPS` | `fps` is not one of 24, 25, 30, 50, 60 |
| `E-DURATION` | `duration` is not within 0 to 30 seconds |

### Nodes

| Code | Rule |
|---|---|
| `E-ID-FORMAT` | An id is not lowercase letters, digits and hyphens starting with a letter |
| `E-ID-DUPLICATE` | Two nodes share an id |
| `E-TYPE-UNKNOWN` | Unknown node type |
| `E-SHAPE-INVISIBLE` | A shape has neither fill nor stroke |
| `E-TRIM-NO-STROKE` | `trim` on a shape without a stroke |
| `E-GROUP-STYLE` | `fill` or `stroke` on a group |
| `E-GROUP-EMPTY` | A group with no children |
| `E-COLOR` | A colour is not valid hex or a known palette name |
| `E-PATH-SYNTAX` | A path string does not parse. Report the character position |
| `E-USE-REF` | A `use` node references a missing definition |
| `E-IMAGE-MISSING` | An image file does not exist |
| `E-GRADIENT` | Fewer than two stops, or stop offsets out of order or outside 0 to 1 |
| `E-MATTE-FIELD` | `matte` is not an object, or has a field other than `by` and `mode` |
| `E-MATTE-BY` | `matte.by` is missing or is not a string |
| `E-MATTE-MODE` | `matte.mode` is not `"alpha"` or `"alpha-inverted"`. The message says luma mattes are not supported |
| `E-MATTE-SIBLING` | `matte.by` names no node in the same list: missing, the node itself, in a different group, or (on a definition) any node. The message lists the siblings and suggests the closest id |
| `E-MATTE-CONFLICT` | One source is used by two nodes in different modes |
| `E-MATTE-CHAIN` | The source of a matte has a matte of its own |
| `E-MARKER` | A `markers` entry has a name that fails the id rules, a value that is not `[start, end]`, a start that is not less than the end, or a time outside 0 to the duration. `markers` itself must be an object |
| `W-OFFSCREEN` | A node is outside the canvas for the whole duration |
| `W-TINY` | A node's bounding box is smaller than 2 pixels |
| `W-NODE-COUNT` | More than 200 nodes |
| `W-ART-PRIMITIVE` | More than 8 shape nodes and no `path` whose `d` contains a curve command (C, S, Q, T or A). Silent when `tier` is `icon` |
| `W-ART-FLAT` | More than 12 shape nodes, 3 or fewer distinct fill colours (palette names resolved, alpha ignored, animated fill values included) and no gradient fill. Silent when `tier` is `icon` |

### Animation

| Code | Rule |
|---|---|
| `E-PROP-UNKNOWN` | The property is not animatable on this node type. For gradient geometry: `fill.from` and `fill.to` need a linear gradient, `fill.center` and `fill.radius` a radial one; the message names the pair that fits the node's fill |
| `E-KEY-SHAPE` | A keyframe is not `[time, value]` or `[time, value, ease]` |
| `E-KEY-ORDER` | Keyframe times do not strictly ascend |
| `E-KEY-RANGE` | A keyframe time is negative or beyond `duration` |
| `E-KEY-VALUE` | A value has the wrong shape for the property |
| `E-KEY-COLLIDE` | Two keyframes land on the same frame after conversion |
| `E-KEY-SINGLE` | An animated property has only one keyframe |
| `E-EASE-UNKNOWN` | Unknown easing name |
| `E-EASE-RANGE` | A custom bezier has x1 or x2 outside 0 to 1 |
| `E-MORPH-MISMATCH` | Morph keyframes have different path structure. Report the first difference |
| `E-RANGE-OPACITY` | An opacity value outside 0 to 1 |
| `E-RANGE-TRIM` | A trim value outside 0 to 1 |
| `W-EASE-FIRST` | An ease on the first keyframe, which has no effect |
| `W-LOOP-JUMP` | `loop` is true and a property's last value differs from its first. Not for a rotation that differs by a multiple of 360 degrees, and not for a scroll: an `x` or `y` with exactly two keys, at 0 and at the duration, the second `linear` |
| `W-REPEAT-FIT` | A repeat period does not divide the duration evenly |
| `W-STATIC` | The scene has no animated property |
| `W-KEY-COUNT` | More than 2,000 keyframes after normalization |
| `W-FAST` | A property changes by a large amount within one or two frames, which usually flickers |

Codes added during the build:

| Code | Rule |
|---|---|
| `E-NODE-TIME` | A node's `from` is not less than its `to` |
| `E-USE-CYCLE` | Definitions in `defs` use each other in a loop |
| `E-NOT-IMPLEMENTED` | The scene uses a feature planned for a later phase. Since phase 5 that is only an animated `clip` |
| `E-INCLUDE-LOAD` | An `include` file is missing, unreadable, not JSON, not a fragment, or there is no way to read files in this context |
| `E-INCLUDE-OVERRIDE` | An override names a node the fragment does not have (the message suggests the nearest id and lists some), or tries to change `id`, `type` or `children` |
| `E-LOTTIE-MISSING` | A `lottie` node's file does not exist |
| `E-LOTTIE-INVALID` | The file is not a Lottie animation (not an object, or `fr`, `ip`, `op`, `w`, `h` or `layers` missing or unusable) |
| `E-LOTTIE-IMAGES` | The file uses image files stored outside it, which a scene cannot carry |
| `E-SVG-LOTTIE` | The SVG output was asked for (`--svg`) and the scene has a `lottie` node |
| `W-LOTTIE-DURATION` | The placed file and its node last different times: it ends early, or its end is cut off |
| `E-GROUP` | A grouping file names a node that does not exist or is not top-level, puts a node in two groups, or reuses an id. `group` command only |
| `E-CUTOUT` | A parts file is unusable: a bad or duplicate id, a polygon with fewer than 3 points or less than 16 square pixels or far outside the image, a bad pivot, lid or number, an unknown field. `cutout` command only |
| `W-CUTOUT-REST` | The cutout layers put back together differ from the picture in more than 2 percent of pixels: the outlines do not follow the parts |
| `E-IMPORT` | `gertie import` could not read the file as SVG, or it has nothing drawable. Import command only |
| `W-IMPORT-UNSUPPORTED` | Part of the SVG was left out or approximated: text, filters, blend modes, images, soft masks, stretched radial gradients, gradient strokes. One per kind. Import command only |
| `E-PRESET-UNKNOWN` | A `motion` entry names a preset that does not exist. The message suggests the closest name |
| `E-PRESET-PARAM` | A preset field has a bad value: `at`, `duration`, `repeat`, `phase`, `applyTo`, or one of the preset's own parameters. `repeat` on a preset that does not loop is also this code, and so is `phase` without `repeat: "loop"`, on `spin`, or on a property whose cycle does not end where it starts. A bad `stagger.phase` is `E-FIELD-TYPE`, like the other stagger fields |
| `E-PRESET-TARGET` | The preset cannot act on this node: `draw-on` and `draw-off` without a stroke, `applyTo: "children"` on something that is not a group or on a rig preset, a rig preset on a node that is not a group |
| `E-PRESET-RANGE` | The preset's `at` plus `duration` is past the end of the scene |
| `E-PRESET-OVERLAP` | Two presets, or a preset and an `animate` entry, write the same property of the same node over overlapping time. The message names both and the time range |
| `E-RIG-PART` | A rig preset needs a part whose id ends in a suffix the rig does not have. One error per missing suffix, and the fix names the id to add |
| `E-EASE-TARGET` | `bounce`, `elastic` or `spring` on a property whose values are not numbers (a colour or a path) |
| `W-STAGGER-UNUSED` | A group has `stagger` but no motion entry with `applyTo: "children"` |
| `W-SYNC` | Two rules, one code. **Loops in step:** three or more direct children of one group run the same looping preset in step: the same `duration`, `at`, `repeat` and phase after stagger. One warning per group and preset, on the group. Never for `spin`, and never for entries from `applyTo: "children"` on a group whose stagger has a non-zero `each` or `phase`. **Starts:** more than 6 animated properties in the scene and over 80 percent of them begin on one frame; the warning has no node, and its fix suggests a `stagger` of 0.03 to 0.1 seconds on the parent group. A property starts at the first key whose value differs from the next one, as `profile` counts it, so a key that only holds the resting value until the move begins is not the start (changed with the benchmark corpus: counted from the first key, a scene that keyed every property at 0 to avoid padded hold segments could not pass). A loop that carries a `phase` and a node with `follow` and a `delay` each count as their own start, because they begin part of the way through their motion (a loop cannot be moved with `at` without breaking it, see `W-REPEAT-FIT`). Applies to every tier. See `09-motion-presets-and-rigs.md` |
| `W-MOTION-SPARSE` | The scene is longer than 3 seconds and has fewer than 3 keyframes per second across all animated properties (the keyframes after presets, repeats and overshoot are expanded). Silent when `tier` is `icon`. The fix names anticipation, `overshoot`, moving holds and `follow` |
| `W-EASE-UNIFORM` | More than 20 segments are eased and every one uses the same curve. A segment is eased when its ease is a curve other than `linear` and `hold`; a missing ease counts as the default `easeInOut`. Silent when `tier` is `icon`. The fix names the eases by weight |
| `E-OVERSHOOT` | An `overshoot` option on a keyframe cannot be used: it is on the first key, on a `hold` key or with `bounce`, `elastic` or `spring`; the values are not numbers; the move does not change the value; the next key is less than 3 frames away; or an option is unknown or out of range. One error per key, naming the node, the property and the key |
| `E-FOLLOW` | A `follow` cannot be used: the node has no parent group, the parent does not animate a named property, the node animates that property itself, the delay pushes the parent's keys past the end of the scene, or an option is unknown or out of range |
| `E-TIER` | The top-level `tier` is not `"icon"`, `"character"` or `"scene"`. The message names the three and suggests the closest |
| `E-USAGE` | A command was called wrongly (JSON output only; the exit code is 2) |
| `E-R-PLAYER` | lottie-web could not load the compiled file at all. Always a Gertie bug |

Notes on how the rules are applied:

- `W-OFFSCREEN` and `W-TINY` are conservative. They check only top-level rectangles, ellipses, polygons and stars with static placement, no pivot and no `from` or `to`. Anything else is skipped rather than risk a false warning.
- `W-FAST` checks `opacity` (change above 0.5), `rotation` (above 90 degrees), `x` and `y` (above half the canvas) within 2.5 frames, and ignores `hold` segments.
- `W-LOOP-JUMP` treats a rotation that differs by a multiple of 360 degrees as equal, and checks only nodes that live for the whole duration. It also stays quiet for a scroll: an `x` or `y` with exactly two keys, at 0 and at the duration, the second with the `linear` ease. A repeating pattern that travels a whole number of its periods closes exactly, and the linter cannot see the pattern, so the render check `W-R-LOOP` decides instead. Added with the benchmark corpus (`17-quality-tuning.md`, section 7): without it no looping scene could have a scrolling background and zero warnings.
- `W-REPEAT-FIT` applies to `{ keys, repeat }` and to presets with `repeat`.
- The preset codes come from the expander, before the rules above run. When the expander reports an error, `W-STATIC` is suppressed, because a scene whose presets failed to expand only looks static because of that failure.
- `W-NODE-COUNT` and `W-KEY-COUNT` are tested with generated scenes in `tests/unit/lint.test.ts`, not as files in `examples/broken/`.

`W-LOOP-JUMP` is the most valuable warning in practice. A loop that jumps is the most common visible flaw in generated animations.

## Gate 2: output validation

### Schema validation

The Lottie Animation Community publishes a JSON Schema (draft 2020-12) for specification version 1.0.1. The MIT-licensed package `@lottie-animation-community/lottie-specs` wraps it in a `LottieValidator` that returns schema errors and also warnings for unknown object types and unknown properties.

- Repository: https://github.com/lottie/lottie-specs-js
- Schema: https://lottie.github.io/lottie-spec/latest/specs/schema/

How Gertie uses it:

- **Decision: treat every warning as an error.** An unknown property means the emitter has stepped outside the specification. Since the emitter is our own code, any such warning is a bug to fix, not noise to ignore.
- Bundle the schema file in `skills/gertie/assets/` so validation works offline.
- **Verified in phase 1:** the schema ships inside the npm package at `src/data/lottie.schema.json` (also served by jsDelivr under `@lottie-animation-community/lottie-specs/src/data/`). The package version 0.3.2 carries schema `$id` `https://lottie.github.io/lottie-spec/1.0/specs/schema/` and `$version` 10000, which is older than the 1.0.1 schema described in the research notes. The package depends on Ajv 8. The validator, Ajv and the schema bundle into one script with esbuild.
- **Tolerated warnings:** three properties that lottie-web needs (layer `st`, layer `hasMask`, mask `x`) are reported as unknown by the validator. Phase 2 confirmed by rendering that each is required. They are listed in `TOLERATED_UNKNOWN_PROPERTIES` and ignored. All other warnings are errors, as decided above.

A schema failure on a file Gertie produced is always a compiler bug. The diagnostic says so, with code `E-INTERNAL-SCHEMA`, and asks the user to report it. The agent cannot fix it by editing the scene, except by removing the feature that triggered it.

For a Lottie file from elsewhere (`gertie validate lottie.json`) there is no compiler to blame. A schema failure is `E-L-SCHEMA`, an error. An unknown property is `W-L-UNKNOWN-PROP`, a warning, because most players ignore unknown properties.

### Semantic lint on the Lottie output

These checks run on the emitted JSON. They overlap with what the compiler guarantees on purpose: they are a second, independent implementation, and they also let `gertie validate` check Lottie files that came from somewhere else.

| Code | Rule |
|---|---|
| `E-L-KEY-ORDER` | Keyframe `t` values ascend within every animated property |
| `E-L-KEY-HANDLES` | Every keyframe except the last has `o` and `i`, or `h: 1` |
| `E-L-EASE-X` | Easing `x` values are within 0 to 1 |
| `E-L-GROUP-TR` | Every group's last item is a transform, and it has exactly one |
| `E-L-STYLE-SCOPE` | Every geometry item has a fill or stroke after it in its group |
| `E-L-REF` | Every `refId` matches an asset id; every `parent` matches a layer `ind` |
| `E-L-IND-UNIQUE` | Layer `ind` values are unique within a composition |
| `E-L-COLOR-RANGE` | Colour components are within 0 to 1 |
| `E-L-PCT-RANGE` | Opacity is within 0 to 100; trim start and end within 0 to 100 |
| `E-L-LAYER-TIME` | Layer `ip` is less than `op`, both within the composition range |
| `E-L-PATH-ARRAYS` | In every bezier, `v`, `i` and `o` have the same length |
| `E-L-SUBSET` | A feature outside the safe subset is present (expressions, effects, text, merge paths, repeater, polystar, luma matte, non-add mask). Alpha mattes (`tt` 1 and 2) are allowed |
| `E-L-MATTE-ORDER` | A layer has `tt` 1 or 2 and the layer directly above it is not a matte source (`td: 1`) |
| `W-L-SIZE` | The file exceeds 200 KB |
| `E-L-SCHEMA` | A Lottie file from elsewhere fails the schema |
| `W-L-UNKNOWN-PROP` | A Lottie file from elsewhere has a property the schema does not know |

`E-L-SUBSET` matters when validating files from elsewhere, for example a Lottie the user supplies as a reference. It tells the agent which features will not play everywhere.

## Exit codes

- `0`: no errors.
- `1`: at least one error.
- `2`: the command could not run (missing file, bad arguments, missing dependency).

Warnings never change the exit code. `--strict` turns warnings into errors for continuous integration.
