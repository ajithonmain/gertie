# Scene file reference

A scene is a JSON file named `<name>.gertie.json`. This is everything you can write. Do not use fields that are not listed here: the compiler rejects them and suggests the closest valid name.

## Conventions

- Origin is the top-left corner. X grows right, Y grows down.
- Lengths are pixels, angles are degrees (clockwise positive), time is seconds.
- Later nodes draw on top of earlier ones.
- Colours: `#rgb`, `#rrggbb`, `#rrggbbaa`, or `$name` for a `palette` entry.

## Top level

| Field | Required | Meaning |
|---|---|---|
| `gertie` | yes | Always `1` |
| `name` | yes | Lowercase letters, digits, hyphens |
| `canvas` | yes | `{ "w": 512, "h": 512, "background": "#000" }`. Integers up to 4096. Omit `background` for transparent |
| `fps` | no | 24, 25, 30 (default), 50 or 60 |
| `duration` | yes | Seconds, above 0 and at most 30 |
| `loop` | no | Default `true`. A looping scene should end where it starts |
| `poster` | no | Default `0`. The second to show as a still when animation is off (SVG under reduced motion). Pick the most representative moment, for example the end of a reveal |
| `markers` | no | Named spans for players: `{ "intro": [0, 1], "loop": [1, 3] }`, seconds, start before end, names like ids. Lottie only; the SVG ignores them |
| `tier` | no | `"icon"`, `"character"` or `"scene"`: the quality band this animation aims for. `profile` marks the measures against it (see "Quality tiers" in `SKILL.md`). It changes nothing in the output |
| `palette` | no | `{ "blue": "#3b82f6" }`, used as `"$blue"` |
| `defs` | no | Reusable nodes, placed with `use` nodes |
| `nodes` | yes | The scene tree, at least one node |

## Nodes

Every node has `id` (unique, lowercase letters, digits, hyphens, starts with a letter) and `type`. All other fields are optional:

| Field | Default | Meaning |
|---|---|---|
| `x`, `y` | 0 | Move the node |
| `rotation` | 0 | Degrees |
| `scale` | 1 | A number or `[sx, sy]` |
| `opacity` | 1 | 0 to 1 |
| `pivot` | `[0, 0]` | Centre of rotation and scale, in the node's own coordinates. Not animatable |
| `from`, `to` | 0, duration | The node exists only between these times |
| `animate` | none | Keyframes, see below |
| `matte` | none | `{ "by": "<sibling id>", "mode": "alpha" }`: show this node only where the sibling is drawn, or with `"alpha-inverted"` only where it is not. The sibling is not drawn itself, so draw a second copy if it should show. Same list only (same group, or both top level). One mode per source |
| `clip` | none | A shape that clips the node: `{ "type": "rect", "w": 100, "h": 100 }`, or `ellipse`, or `path`, with optional `x`, `y`. Not animatable |

Pivot rule: geometry is defined in the node's own coordinates, `x` and `y` move the whole node, `pivot` only picks the centre of rotation and scale. Shapes are centred on their own origin, so a `rect` or `ellipse` placed with `x`, `y` rotates about its centre with no pivot. To swing an arm from its end, give the rect a `pivot` at that end, for example `"pivot": [-40, 0]` for a rect 80 wide.

| Type | Fields |
|---|---|
| `group` | `children`: array of nodes. A group has no fill or stroke; style its children |
| `rect` | `w`, `h`, `radius` |
| `ellipse` | `rx`, `ry`, or `r` for a circle |
| `path` | `d`: SVG path string. All commands M L H V C S Q T A Z, absolute or relative |
| `line` | `x1`, `y1`, `x2`, `y2`. Needs a stroke |
| `polygon` | `points` (3 or more), `r`. Regular polygon, first point at the top |
| `star` | `points`, `r`, `innerR` |
| `image` | `src` (file path relative to the scene), `w`, `h`. Top-left at the node origin |
| `use` | `ref`: a key in `defs` |

Shape nodes (`rect`, `ellipse`, `path`, `line`, `polygon`, `star`) also take:

- `fill`: a colour, a gradient, or `null`.
- `fillRule`: `"nonzero"` (default) or `"evenodd"`.
- `stroke`: `{ "color", "width" (2), "cap" ("round"), "join" ("round"), "dash": [8, 6] }`. `cap` is `butt`, `round` or `square`. `join` is `miter`, `round` or `bevel`.
- `trim`: `{ "start": 0, "end": 1, "offset": 0 }`, each 0 to 1. Draws part of the stroke. Animate `trim.end` from 0 to 1 to draw a line on.

A shape with neither fill nor stroke is an error, because it would be invisible.

Gradients, in the node's own coordinates:

    { "type": "linear", "from": [0, -50], "to": [0, 50], "stops": [[0, "#ff8a00"], [1, "#e52e71"]] }
    { "type": "radial", "center": [0, 0], "radius": 80, "stops": [[0, "#fff"], [1, "#3b82f6"]] }

Gradient geometry animates, stops do not. Linear: `fill.from` and `fill.to`, each `[x, y]`. Radial: `fill.center` (`[x, y]`) and `fill.radius` (a number above 0). Write them in `animate` like any property, for example a shine that travels along a bar:

    "animate": { "fill.from": [[0, [-120, 0]], [1, [40, 0]]], "fill.to": [[0, [-40, 0]], [1, [120, 0]]] }

The wrong pair for the gradient type is `E-PROP-UNKNOWN`. Gradient strokes do not exist.

## Animation

    "animate": {
      "rotation": [[0, 0], [1.0, 360, "linear"]],
      "opacity":  [[0, 0], [0.4, 1, "easeOut"]]
    }

A keyframe is `[time, value]` or `[time, value, ease]`. **The ease describes how the value arrives at that keyframe from the previous one.** The default is `easeInOut`. An ease on the first keyframe does nothing and raises a warning.

- Times must strictly increase and stay within 0 and `duration`.
- Before the first keyframe the value holds; after the last it holds.
- When a property is animated, the static value on the node is ignored.
- A property needs at least two keyframes.
- A keyframe can be written `{ "t": 0.5, "v": 100, "ease": "easeOut" }`.

Animatable properties:

| Property | Value | On |
|---|---|---|
| `x`, `y`, `rotation`, `opacity` | number | all nodes |
| `scale` | number or `[sx, sy]` | all nodes |
| `fill` | colour | shapes with a solid colour fill |
| `stroke.color`, `stroke.width` | colour, number | shapes with a stroke |
| `trim.start`, `trim.end`, `trim.offset` | number | shapes with a stroke |
| `d` | path string | `path`. Every keyframe needs the same commands structure: same subpaths, same segment count, same open or closed state |
| `w`, `h`, `radius` | number | `rect` |
| `rx`, `ry`, `r` | number | `ellipse` |

`polygon`, `star` and `line` cannot animate their geometry. Use a `path` to morph.

Easing names: `linear`, `hold` (keep the previous value, jump at this key), `easeIn`, `easeOut`, `easeInOut`, and the families `Sine`, `Quad`, `Cubic`, `Quart`, `Expo`, `Back`, each as `easeIn<Family>`, `easeOut<Family>`, `easeInOut<Family>`, for example `easeOutBack` (overshoots). Four more are named by character: `smooth` (a deliberate move), `gentle` (a drift), `snap` (a fast start) and `settle` (arrive quickly, ease to rest). A custom curve is `[x1, y1, x2, y2]` with `x1` and `x2` from 0 to 1.

## Making a loop

If `loop` is true, every animated property's last keyframe value must equal its first, otherwise the loop jumps and the compiler warns with `W-LOOP-JUMP`. A rotation that ends 360 degrees past its start is fine. So is a scroll: an `x` or `y` with exactly two keys, at 0 and at `duration`, the second with `linear`, that moves a repeating pattern by a whole number of its repeats (`references/motion.md`, "A background that scrolls"). For a one-shot animation, set `"loop": false`.

## Motion presets, repeat and special easings

`motion` presets, `{ "keys", "repeat" }`, the easings `bounce`, `elastic` and `spring`, the `overshoot` option on a long-form keyframe and the `follow` field are available. Read `references/motion.md` before using them. It also covers characters (rigs).

## Using supplied artwork

A group can include artwork imported from an SVG: `{ "id": "art", "type": "group", "include": "art.fragment.json", "overrides": { "<node id>": { "pivot": [x, y], "motion": [...] } } }`. Read `references/import.md`.

A scene can also place another Lottie file: `{ "id": "x", "type": "lottie", "src": "file.json", "x": 0, "y": 0 }`. This produces Lottie only, with no SVG. Read `references/lottie.md`.

## Mattes and merge paths

`matte` is in the node table above. Merge paths (boolean union, subtract, intersect) do not exist: several players do not implement them, so Gertie leaves them out. Get the same result at drawing time: a holed shape is one path with `"fillRule": "evenodd"` and two subpaths; an intersection is a `clip` (hard edge, fixed) or a `matte` (the shape may move); a subtraction that moves is a matte with `"alpha-inverted"`. Examples: `examples/matte-shine.gertie.json` (a shine inside a badge) and `examples/matte-reveal.gertie.json` (a reveal through a growing hole).

## Not available

Do not use animated clips, text, animated gradient stops or gradient strokes. The compiler reports `E-NOT-IMPLEMENTED` for an animated clip and an unknown field for the others.

## Example 1: keyframes with easing

Three dots bounce in turn. Each dot moves on `y` only; the first and last keyframe values match, so the loop is seamless.

    {
      "gertie": 1, "name": "bouncing-dots",
      "canvas": { "w": 512, "h": 512 }, "duration": 1.2,
      "palette": { "blue": "#3b82f6" },
      "nodes": [
        { "id": "dot-1", "type": "ellipse", "r": 28, "x": 156, "y": 256, "fill": "$blue",
          "animate": { "y": [[0, 256], [0.3, 176, "easeOutQuad"], [0.6, 256, "easeInQuad"], [1.2, 256]] } },
        { "id": "dot-2", "type": "ellipse", "r": 28, "x": 256, "y": 256, "fill": "$blue",
          "animate": { "y": [[0, 256], [0.15, 256], [0.45, 176, "easeOutQuad"], [0.75, 256, "easeInQuad"], [1.2, 256]] } }
      ]
    }

## Example 2: a stroke that rotates

A loading spinner: a partial ring turning once per second.

    {
      "gertie": 1, "name": "spinner-ring",
      "canvas": { "w": 256, "h": 256 }, "duration": 1,
      "nodes": [
        { "id": "track", "type": "ellipse", "r": 60, "x": 128, "y": 128, "stroke": { "color": "#1e293b", "width": 12 } },
        { "id": "arc", "type": "ellipse", "r": 60, "x": 128, "y": 128,
          "stroke": { "color": "#38bdf8", "width": 12 }, "trim": { "start": 0, "end": 0.3 },
          "animate": { "rotation": [[0, 0], [1, 360, "linear"]] } }
      ]
    }

## Example 3: a group with pivots

A windmill. The group rotates about its origin at (128, 128). Each blade is a rect centred 45 pixels above the group origin, with its pivot at the group origin so that its own `rotation` fans the blades out.

    {
      "gertie": 1, "name": "windmill",
      "canvas": { "w": 256, "h": 256 }, "duration": 3,
      "nodes": [
        { "id": "rotor", "type": "group", "x": 128, "y": 128,
          "animate": { "rotation": [[0, 0], [3, 360, "linear"]] },
          "children": [
            { "id": "blade-1", "type": "rect", "w": 18, "h": 90, "y": -45, "pivot": [0, 45], "fill": "#f8fafc" },
            { "id": "blade-2", "type": "rect", "w": 18, "h": 90, "y": -45, "pivot": [0, 45], "rotation": 120, "fill": "#f8fafc" },
            { "id": "blade-3", "type": "rect", "w": 18, "h": 90, "y": -45, "pivot": [0, 45], "rotation": 240, "fill": "#f8fafc" }
          ] }
      ]
    }

More complete examples are in `examples/` in the Gertie repository: gradients, morphing, clipping, reusable `defs`, timed nodes.
