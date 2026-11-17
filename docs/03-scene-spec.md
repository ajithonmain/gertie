# The scene file

The scene file is the only thing the agent writes. It is JSON, uses the extension `.gertie.json`, and describes a canvas, a tree of named shapes and how their properties change over time.

Design goals, in order:

1. Hard to write an invalid one. Most Lottie mistakes cannot be expressed.
2. Close to what models already know: SVG shapes and path strings, CSS colours, CSS easing names, seconds.
3. Small. A typical icon animation is 30 to 80 lines.
4. Neutral. Nothing in it is specific to Lottie or to SVG, so both emitters can consume it.

## A complete example

```json
{
  "gertie": 1,
  "name": "bouncing-dots",
  "canvas": { "w": 512, "h": 512 },
  "fps": 30,
  "duration": 1.2,
  "loop": true,
  "palette": { "blue": "#3b82f6" },
  "nodes": [
    {
      "id": "dot-1", "type": "ellipse", "r": 28, "x": 156, "y": 256, "fill": "$blue",
      "animate": {
        "y": [[0, 256], [0.3, 176, "easeOutQuad"], [0.6, 256, "easeInQuad"], [1.2, 256]]
      }
    },
    {
      "id": "dot-2", "type": "ellipse", "r": 28, "x": 256, "y": 256, "fill": "$blue",
      "animate": {
        "y": [[0, 256], [0.15, 256], [0.45, 176, "easeOutQuad"], [0.75, 256, "easeInQuad"], [1.2, 256]]
      }
    },
    {
      "id": "dot-3", "type": "ellipse", "r": 28, "x": 356, "y": 256, "fill": "$blue",
      "animate": {
        "y": [[0, 256], [0.3, 256], [0.6, 176, "easeOutQuad"], [0.9, 256, "easeInQuad"], [1.2, 256]]
      }
    }
  ]
}
```

## Top-level fields

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `gertie` | number | yes | | Format version. Currently `1` |
| `name` | string | yes | | Lowercase letters, digits, hyphens. Used for file names |
| `canvas.w`, `canvas.h` | number | yes | | Size in pixels. Integers |
| `canvas.background` | colour or null | no | null | null means transparent |
| `fps` | number | no | 30 | One of 24, 25, 30, 50, 60 |
| `duration` | number | yes | | Seconds, greater than 0, at most 30 |
| `loop` | boolean | no | true | Whether the animation repeats |
| `poster` | number | no | 0 | Second shown when animation is off: reduced motion, and previews that do not play. Used by the SVG output (see `05-svg-emitter.md`). Choose the moment that best represents the animation, for example the end of a reveal |
| `markers` | object | no | none | Named spans of the timeline for players and interactive wrappers that play a segment: a name mapped to `[start, end]` in seconds, for example `{ "intro": [0, 1], "loop": [1, 3] }`. Names follow the id rules. Both times are within `0` to `duration` and `start` is less than `end`; otherwise `E-MARKER`. Written to the Lottie `markers` array (`cm`, `tm`, `dr` in frames). The SVG output has no form for them and ignores them |
| `tier` | string | no | none | The quality tier the animation aims for: `"icon"` (an icon or loader), `"character"` (a character or illustration) or `"scene"` (a full scene). `gertie profile` marks the measured profile against that tier's band (`17-quality-tuning.md` section 1). Without it, the profile is marked against all three. It does not change the output. Any other value is `E-TIER` |
| `palette` | object | no | {} | Named colours, referenced as `$name` |
| `defs` | object | no | {} | Reusable nodes, referenced by `use` nodes |
| `nodes` | array | yes | | The scene tree. At least one node |

## Coordinates, units and order

- The origin is the top-left corner of the canvas. X grows right, Y grows down. This matches SVG.
- Lengths are pixels. Angles are degrees, clockwise positive. Time is seconds.
- `scale` is a multiplier: `1` is normal size. It may be one number or `[sx, sy]`.
- `opacity` runs from 0 to 1.
- **Drawing order is painter's order: later nodes in an array draw on top of earlier ones.** This matches SVG. The Lottie emitter reverses it, because Lottie draws the first item on top.

## Nodes

Every node has these fields:

| Field | Type | Default | Meaning |
|---|---|---|---|
| `id` | string | required | Unique in the scene. Lowercase letters, digits, hyphens; starts with a letter |
| `type` | string | required | See the table below |
| `x`, `y` | number | 0 | Translation of the node in its parent's coordinates |
| `rotation` | number | 0 | Degrees |
| `scale` | number or pair | 1 | |
| `opacity` | number | 1 | |
| `pivot` | pair | `[0, 0]` | The point, in the node's own coordinates, that rotation and scale happen around. Not animatable |
| `from`, `to` | number | 0, duration | The node exists only between these times |
| `animate` | object | {} | Property animations, see below |
| `motion` | array | [] | Preset applications, see `09-motion-presets-and-rigs.md` |
| `clip` | shape | none | A shape that clips this node, see below |
| `matte` | object | none | The node is shown only where a sibling is drawn (or, inverted, only where it is not). See "Mattes" |
| `follow` | object or `true` | none | The node repeats its parent group's `rotation`, `x` or `y` animation, later and scaled. See "Following a parent" |

How `x`, `y` and `pivot` interact: the node's geometry is defined in its own coordinates. `x` and `y` move the whole node. `pivot` only chooses the centre of rotation and scale. With rotation 0 and scale 1, changing `pivot` does not move anything.

Two common patterns:

- **A shape centred on its own origin.** `{"type": "rect", "w": 100, "h": 60, "x": 256, "y": 256}`. The rectangle is centred at (256, 256) and rotates about its centre. No pivot needed.
- **Artwork in absolute coordinates.** A path imported from an SVG has its `d` in canvas coordinates, so `x` and `y` stay 0. To swing an arm from the shoulder at (120, 200), set `"pivot": [120, 200]`.

### Mattes

`matte` uses the alpha of one node to reveal another: a shine sweeping across a badge, a reveal through a growing hole, shading that stays inside a moving shape.

```json
{ "id": "shine", "type": "rect", "w": 40, "h": 300, "fill": "#ffffff66",
  "matte": { "by": "badge-shape", "mode": "alpha" } }
```

- `by` is the id of a **sibling**: a node in the same list (the same parent group, or both at the top level). The node named by `by` is the matte source. It is not drawn itself; draw a second node if the shape should also be visible.
- `mode` is `"alpha"` (default: the node shows where the source is drawn, in proportion to the source's opacity) or `"alpha-inverted"` (it shows where the source is not). Luma mattes are not supported.
- The source keeps its own transform, animation and `from` and `to` in the coordinates of the shared parent, so it can move, grow or change shape independently of the matted node. Only its alpha matters; its colour does not.
- One source may matte several nodes, in one mode only. A source cannot itself be matted. A node may have both a `clip` and a `matte`.
- Use `clip` for a hard-edged, static shape. Use a matte when the shape moves or changes, or when the reveal should follow an animated or soft-edged node.
- Errors: `E-MATTE-FIELD`, `E-MATTE-BY`, `E-MATTE-MODE`, `E-MATTE-SIBLING`, `E-MATTE-CONFLICT`, `E-MATTE-CHAIN` (`06-validation.md`).
- In `alpha-inverted` mode the SVG output draws the source in black, so an `image` inside the source, or an instance (`use`) of a definition, keeps its own colours there and the two outputs differ. Build an inverted source from shapes.

### Node types

| Type | Geometry fields | Notes |
|---|---|---|
| `group` | `children`: array of nodes | Has no fill or stroke of its own |
| `rect` | `w`, `h`, `radius` (default 0) | Centred on the node origin |
| `ellipse` | `rx`, `ry`, or `r` for a circle | Centred on the node origin |
| `path` | `d`: SVG path string | Any SVG path commands, absolute or relative |
| `line` | `x1`, `y1`, `x2`, `y2` | Needs a stroke |
| `polygon` | `points` (3 or more), `r` | Regular polygon centred on the origin |
| `star` | `points`, `r`, `innerR` | Centred on the origin |
| `image` | `src` (file path), `w`, `h` | Top-left at the node origin |
| `use` | `ref`: a key in `defs` | An instance of a reusable node |
| `lottie` | `src`: path of a Lottie JSON file | Another Lottie animation. Top-left at the node origin. Lottie output only, see below |

`polygon`, `star` and `line` are compiled to paths. They exist because models place them more reliably than hand-computed path strings.

### Style fields

Shape nodes (everything except `group`, `image` and `use`) accept:

| Field | Type | Meaning |
|---|---|---|
| `fill` | colour, gradient or null | Default null |
| `fillRule` | `"nonzero"` or `"evenodd"` | Default `"nonzero"` |
| `stroke` | object or null | `{ "color", "width", "cap", "join", "dash" }` |
| `trim` | object | `{ "start", "end", "offset" }`, each 0 to 1. Draws only part of the stroke |

A shape with neither fill nor stroke is a lint error, because it would be invisible.

Colours are `#rgb`, `#rrggbb`, `#rrggbbaa`, or `$name` for a palette entry.

Stroke defaults: `width` 2, `cap` `"round"`, `join` `"round"`. `cap` is `"butt"`, `"round"` or `"square"`. `join` is `"miter"`, `"round"` or `"bevel"`. `dash` is an array of lengths, for example `[8, 6]`.

Gradients:

```json
{ "type": "linear", "from": [0, -50], "to": [0, 50],
  "stops": [[0, "#ff8a00"], [1, "#e52e71"]] }

{ "type": "radial", "center": [0, 0], "radius": 80,
  "stops": [[0, "#ffffff"], [1, "#3b82f6"]] }
```

Gradient coordinates are in the node's own coordinates. The geometry animates, the colour stops do not: a linear gradient animates `fill.from` and `fill.to` (each an `[x, y]` pair), a radial one `fill.center` (a pair) and `fill.radius` (a number above 0). They are flat dotted keys in `animate`, like `stroke.width`. Asking for the radial pair on a linear gradient, or the reverse, or any of them on a solid fill, is `E-PROP-UNKNOWN`, and the message names the pair that fits. A moving highlight is the common use: animate `fill.from` and `fill.to` together by the same amount.

```json
"fill": { "type": "linear", "from": [-120, 0], "to": [-40, 0], "stops": [[0, "#1e3a8a"], [0.5, "#7dd3fc"], [1, "#1e3a8a"]] },
"animate": {
  "fill.from": [[0, [-120, 0]], [1, [40, 0], "easeInOut"], [2, [-120, 0], "easeInOut"]],
  "fill.to":   [[0, [-40, 0]], [1, [120, 0], "easeInOut"], [2, [-40, 0], "easeInOut"]]
}
```

Gradient strokes are not supported (stroke colour is a solid colour). See `examples/gradient-sweep.gertie.json` and `examples/markers-demo.gertie.json`.

### Clipping

`clip` holds a shape description without an id: `{ "type": "rect", "w": 200, "h": 200 }` or `{ "type": "path", "d": "..." }`, optionally with `x`, `y`. The node is visible only inside the shape. The clip shape is in the node's own coordinates and moves with it. A clip may have its own `animate` block for its geometry.

## Animation

`animate` maps a property name to keyframes.

```json
"animate": {
  "rotation": [[0, 0], [1.0, 360, "linear"]],
  "opacity":  [[0, 0], [0.4, 1, "easeOut"]]
}
```

### Keyframes

A keyframe is `[time, value]` or `[time, value, ease]`. The long form `{ "t": time, "v": value, "ease": ease }` is also accepted.

**The ease describes how the property arrives at that keyframe from the previous one.** In `[0.4, 1, "easeOut"]` the value travels to 1, decelerating, and gets there at 0.4 seconds. An ease on the first keyframe has no meaning and is a lint warning. If the ease is omitted it is `"easeInOut"`.

Rules, all enforced by the linter:

- Times ascend strictly.
- The first keyframe may be later than 0; the property holds its first value until then. The last keyframe may be earlier than `duration`; the property holds its last value after.
- Values have the right shape for the property (number, pair, colour, path string).
- When a property is animated, its static value on the node is ignored.

### Animatable properties

| Property | Value | Applies to |
|---|---|---|
| `x`, `y` | number | all |
| `rotation` | number | all |
| `scale` | number or pair | all |
| `opacity` | number | all |
| `fill` | colour | shapes with a solid fill |
| `fill.from`, `fill.to` | pair | shapes with a linear gradient fill |
| `fill.center` | pair | shapes with a radial gradient fill |
| `fill.radius` | number above 0 | shapes with a radial gradient fill |
| `stroke.color` | colour | shapes with a stroke |
| `stroke.width` | number | shapes with a stroke |
| `trim.start`, `trim.end`, `trim.offset` | number | shapes with a stroke |
| `d` | path string | `path` |
| `w`, `h`, `radius` | number | `rect` |
| `rx`, `ry`, `r` | number | `ellipse` |

Path morphing (`d`) requires every keyframe's path to have the same sequence of commands after normalization: the same number of subpaths, the same number of segments in each, and the same open or closed state. The linter reports the first position where two paths differ.

### Easing

Named easings map to cubic bezier curves. The same four numbers are used for Lottie handles and for CSS `cubic-bezier()`.

| Name | Bezier |
|---|---|
| `linear` | 0, 0, 1, 1 |
| `easeIn` | 0.32, 0, 0.67, 0 |
| `easeOut` | 0.33, 1, 0.68, 1 |
| `easeInOut` | 0.65, 0, 0.35, 1 |
| `easeInSine` | 0.12, 0, 0.39, 0 |
| `easeOutSine` | 0.61, 1, 0.88, 1 |
| `easeInOutSine` | 0.37, 0, 0.63, 1 |
| `easeInQuad` | 0.11, 0, 0.5, 0 |
| `easeOutQuad` | 0.5, 1, 0.89, 1 |
| `easeInOutQuad` | 0.45, 0, 0.55, 1 |
| `easeInCubic` | 0.32, 0, 0.67, 0 |
| `easeOutCubic` | 0.33, 1, 0.68, 1 |
| `easeInOutCubic` | 0.65, 0, 0.35, 1 |
| `easeInQuart` | 0.5, 0, 0.75, 0 |
| `easeOutQuart` | 0.25, 1, 0.5, 1 |
| `easeInOutQuart` | 0.76, 0, 0.24, 1 |
| `easeInExpo` | 0.7, 0, 0.84, 0 |
| `easeOutExpo` | 0.16, 1, 0.3, 1 |
| `easeInOutExpo` | 0.87, 0, 0.13, 1 |
| `easeInBack` | 0.36, 0, 0.66, -0.56 |
| `easeOutBack` | 0.34, 1.56, 0.64, 1 |
| `easeInOutBack` | 0.68, -0.6, 0.32, 1.6 |
| `smooth` | 0.7, 0, 0.3, 1 |
| `gentle` | 0.2, 0, 0.8, 1 |
| `snap` | 0.8, 0, 0.3, 1 |
| `settle` | 0.3, 1, 0.7, 1 |

The last four are named by character. `smooth` is a deliberate move from one pose to another, `gentle` a small drift or a moving hold, `snap` a fast interface transition, `settle` an arrival that is quick and eases to rest. The default, `easeInOut`, does not change. Do not confuse the `settle` easing with the `overshoot` option on a keyframe (see "Overshoot on a keyframe").

Other accepted values:

- `"hold"`: the property keeps the previous value and jumps at this keyframe's time.
- `[x1, y1, x2, y2]`: a custom cubic bezier. `x1` and `x2` must be within 0 to 1.
- `"bounce"`, `"elastic"`, `"spring"`: these cannot be one bezier curve. The normalizer replaces the single segment with several keyframes that approximate the curve. See `09-motion-presets-and-rigs.md`.

### Overshoot on a keyframe

A long-form keyframe may carry an `overshoot` option. The expander replaces the key by the keys of an overshoot, so the emitters see plain keyframes. This is how the reference does overshoot: extra keys, not an easing curve that leaves the 0 to 1 range.

```json
"x": [[0, 100], { "t": 0.5, "v": 300, "ease": "easeOut", "overshoot": true }]
"x": [[0, 100], { "t": 0.5, "v": 300, "ease": "easeOut", "overshoot": { "past": 0.15, "back": 0.05, "time": 0.4 } }]
```

- **`t` is the time of the peak, and `v` is where the value comes to rest.** The move runs from the previous key to a peak `past` of the distance beyond `v`, arriving at `t` with the key's own `ease`. It then dips `back` of the distance under `v`, and rests on `v` `time` seconds after the peak. The turning points use `easeInOutSine`. A move that arrives at the peak with `easeOut` stops there, so the peak is a real turning point and there is no stall on the way.
- `past` (default 0.1) is a fraction of the distance travelled, greater than 0 and at most 1. `back` (default 0.03) is a fraction from 0 to 1; 0 skips the dip. `time` (default 0.3) is seconds from the peak to rest, from 0.05 to 3. `true` means all defaults.
- Works on numbers and on scale pairs (each component by its own distance). Values are clamped for properties with a fixed range (opacity, trim, sizes).
- Keys land on whole frames. If the next key is too close, `time` is shortened so the rest is at least one frame before it. It needs at least 3 frames between this key and the next (or the end of the scene).
- It cannot go on the first key, on a `hold` key, with `bounce`, `elastic` or `spring`, on a colour or a path, or on a move that does not change the value. Each is `E-OVERSHOOT`, which names the node, the property and the key.
- Inside `{ "keys", "repeat" }` the overshoot is expanded first, so every repeat carries it.

The option is called `overshoot`, not `settle`, so it cannot be confused with the `settle` easing, which is a curve name. **Defaults** were chosen on contact sheets of `examples/overshoot-badge`: 0.1 past gives a visible but quiet pop on a scale from 0.5 to 1 (5 percent of the size), and 0.3 seconds is 9 frames at 30 fps, long enough to read the dip. Raise `past` to 0.2 or 0.25 for a rotation or a heavier thing.

### Following a parent

`follow` makes a node repeat its parent group's animation, later and larger. It is how hair, a tail, leaves on a stem or an antenna trail a body. The expander writes plain keys.

```json
{ "id": "tip", "type": "group", "pivot": [256, 190],
  "follow": { "props": ["rotation"], "delay": 0.1, "scale": 1.5 },
  "children": [ ] }
```

| Field | Default | Meaning |
|---|---|---|
| `props` | `["rotation"]` | Any of `rotation`, `x`, `y` |
| `delay` | 0.1 | Seconds the node trails its parent, 0 to 3, rounded to whole frames |
| `scale` | 1.5 | Multiplier on how far the parent moves from its first value, a non-zero number from -10 to 10 |

- The node's value is its own static value plus `scale` times the parent's movement from the parent's first value. A leaf resting at -160 degrees whose parent leans 3 degrees leans 4.5.
- The node must be directly inside a group, the group must animate each property named, and the node must not animate it itself. All are `E-FOLLOW`.
- When the parent's keys span the whole scene, end where they start and the scene loops, the node's keys are the same cycle shifted by `delay`, so the loop still closes (`rotateCycle`). Otherwise the keys are shifted later and any past the end of the scene are dropped.
- A follower can have followers: `follow` is read in tree order, so a chain (a tail of segments, each inside the last) trails further at each step. Rotations add up down a chain, so keep `scale` near 1 to 1.3 there.
- A follower with a `delay` counts as having its own start for `W-SYNC`. For every other property the start is the first key whose value differs from the next one, so a key that holds the resting value until the move begins does not count as the start.

### Repeating a property

Lottie has no built-in way to loop one property, so the normalizer unrolls repeats into plain keyframes.

```json
"animate": {
  "rotation": { "keys": [[0, -8], [0.5, 8], [1.0, -8]], "repeat": "loop" }
}
```

`repeat` is `"loop"` (restart) or `"pingpong"` (play forward then backward). Whole cycles are written, starting at the first key, until `duration`. If the repeat period does not divide the time that remains evenly, the linter warns with `W-REPEAT-FIT`, because the scene will not loop seamlessly. With `loop`, when the last value differs from the first, the restart happens one frame after the period ends, as a `hold`.

## Placing a Lottie file

A `lottie` node places another Lottie animation (see `10-references.md`). `src` is a path relative to the scene file. The file's times are rescaled to the scene's frame rate (`embedLottie` in `src/lottie-tools/embed.ts`), its layers become a precomposition, and its own assets are copied in with prefixed ids. The node takes the usual transform fields and `animate`. The file is read at the edge (`src/cli`), like images, and passed to the compiler as `lotties`. In the SVG output it is not supported: a scene with a `lottie` node produces no SVG, and asking for one is `E-SVG-LOTTIE`. Errors: `E-LOTTIE-MISSING`, `E-LOTTIE-INVALID`, `E-LOTTIE-IMAGES`; warning: `W-LOTTIE-DURATION`.

## Including imported artwork

A group can hold artwork made by `gertie import` (see `10-references.md`) without copying it into the scene:

```json
{ "id": "character", "type": "group", "include": "character.fragment.json",
  "overrides": {
    "arm-left": { "pivot": [135, 190], "animate": { "rotation": { "keys": [[0, -10], [0.6, 20], [1.2, -10]], "repeat": "loop" } } }
  } }
```

`include` is the path of a fragment file, relative to the scene file. A fragment is `{ "gertie-fragment": 1, "source", "canvas": { "w", "h" }, "nodes": [...] }`, with ordinary scene nodes in canvas coordinates. `include` and `overrides` are resolved before anything else, by `resolveIncludes` in `src/import/include.ts`; the file is read at the edge (`src/cli`), so the compiler stays pure. The group takes the fragment's nodes as its `children` (it cannot have its own). An override merges into the node with that id at any depth: `animate` per property, `motion` appended, any other field replaced; `id`, `type`, `children`, `include` and `overrides` cannot be overridden. Errors: `E-INCLUDE-LOAD`, `E-INCLUDE-OVERRIDE`.

## Reusable nodes

`defs` holds nodes by name. A `use` node places an instance. Each instance has its own transform and animation; the definition's internal animation plays inside it.

```json
"defs": {
  "leaf": { "id": "leaf", "type": "path", "d": "M0 0 C10 -20 30 -20 40 0 C30 20 10 20 0 0 Z", "fill": "#2f9e44" }
},
"nodes": [
  { "id": "leaf-a", "type": "use", "ref": "leaf", "x": 100, "y": 300 },
  { "id": "leaf-b", "type": "use", "ref": "leaf", "x": 180, "y": 320, "rotation": 25 }
]
```

## Normalization

The normalizer turns a parsed scene into the form both emitters consume. It runs these steps in order, and each step is a pure function.

1. Apply defaults.
2. Resolve palette references to hex colours.
3. Convert `line`, `polygon` and `star` to `path`.
4. Parse every path string into a list of subpaths of cubic bezier segments (see `04-lottie-emitter.md` for the conversion rules).
5. Expand `motion` presets into `animate` entries.
6. Expand `repeat` into plain keyframes.
7. Expand `bounce`, `elastic` and `spring` segments into several bezier keyframes.
8. Convert every keyframe time to a frame number: `frame = round(time * fps)`. If two keyframes of one property land on the same frame, report an error.
9. Pad each animated property so it has a keyframe at frame 0 and at the last frame, using hold segments.
10. Compute `totalFrames = round(duration * fps)`.

After normalization there are no presets, no repeats, no named easings (only bezier numbers and hold), and no seconds.

## Lint rules at scene level

The full list with codes is in `06-validation.md`. The important ones:

- Duplicate or malformed ids.
- Unknown node type, unknown property, unknown easing name. The message lists the valid options.
- A shape with no fill and no stroke.
- `trim` on a shape with no stroke.
- Keyframe times out of order or beyond `duration`.
- Morph paths with mismatched structure.
- `loop` is true and an animated property's last value differs from its first. This is a warning: the loop will jump. Two cases are not reported: a rotation that differs by whole turns, and a scroll, which is an `x` or `y` with exactly two keys, at 0 and at `duration`, the second with the `linear` ease. A scroll moves a repeating pattern by a whole number of its repeats, so the last frame is the first; the linter cannot see the pattern, and the render check `W-R-LOOP` reports a scroll that does not line up.
- A node placed entirely outside the canvas for the whole duration. Warning.
- More than 200 nodes or more than 2,000 keyframes. Warning about file size.

## Implementation status

Phases 1 and 5 implement everything in this document except one thing, which the linter rejects with `E-NOT-IMPLEMENTED`:

- An `animate` block on a `clip`.

A looping preset can also take `phase`, and a group's `stagger` can take `phase`, to shift a loop inside its cycle without breaking it; see "Loops out of phase" in `09-motion-presets-and-rigs.md`. `phase` is not available on `{ "keys", "repeat" }`.

Phase 5 added `motion` presets, `stagger`, `{ "keys", "repeat" }` and the easings `bounce`, `elastic` and `spring`. They are expanded by one pure function, `expandScene` in `src/presets/expand.ts`, which turns a scene into a scene with plain keyframes in seconds. Both the linter and the normalizer call it first, so every lint rule sees exactly what the emitters see, and the normalizer's steps 5 to 7 are that function. It never throws: a scene it cannot read is returned unchanged for the linter to describe.

Other details settled during the build:

- Animated sub-properties are written as flat dotted keys: `"stroke.color"`, `"stroke.width"`, `"trim.end"`. They are not nested objects.
- Animating `r` on an ellipse animates both radii together.
- A `fill` colour can be animated only when it is a solid colour; a gradient fill animates its geometry (`fill.from`, `fill.to`, `fill.center`, `fill.radius`) and its stops stay static. Animating a colour changes its red, green and blue. The alpha of the first keyframe is used for the whole animation.
- Every definition in `defs` needs an `id`, like any node. It need not equal the key. Ids are unique across `nodes` and `defs`.
- `from` and `to` must satisfy `from < to`, both within the duration.
- Keyframe times are converted with `round(time * fps)`. Two keys on one frame are `E-KEY-COLLIDE`.
- Padding (normalizer step 9) puts a hold key at frame 0 when the first key is later, and at `totalFrames` when the last key is earlier. The Lottie file therefore always spans the whole animation.

## JSON Schema

A JSON Schema for the scene file is to be generated from the TypeScript types and shipped at `skills/gertie/assets/gertie-scene.schema.json`. It does not exist yet; it is not needed until the skill is packaged in phase 9. It gives editors completion and lets a text-only model check its own output. The linter is still the authority, because several rules (unique ids, morph structure, keyframe order) are beyond what a schema expresses.

## What version 1 leaves out

These are deliberate omissions. Each is a candidate for a later version.

- Text nodes. Fonts are not portable across players. Planned as text converted to paths from a font file.
- Animated gradient stops, and gradient strokes. Gradient geometry animates (`fill.from`, `fill.to`, `fill.center`, `fill.radius`).
- Blend modes, effects, expressions. These are not supported consistently across Lottie players.
- Motion along a path. This stays out for good, not only for version 1. Only 2 percent of position keyframes in the 454 reference files follow a curved spatial path. Arcs are made the way the reference makes them: separate keyframe timing on `x` and `y`, or rotation of a parent group about a distant pivot (`17-quality-tuning.md` section 3.5).
