# The Lottie emitter

The Lottie emitter turns a normalized scene into a Lottie JSON object. It targets the Lottie Animation Community specification version 1.0.1 and stays inside the subset of features that every major player supports.

Specification: https://lottie.github.io/lottie-spec/latest/

Read this document together with `research_notes/Free Lottie animation agent skill/lottie_format_and_generation.md`, which records which statements were read from the specification and which are background knowledge.

## The safe subset

The emitter may produce only these Lottie features.

| Feature | Lottie form |
|---|---|
| Shape layer | layer `ty: 4` |
| Precomposition layer | layer `ty: 0`, with an asset |
| Image layer | layer `ty: 2`, with an asset |
| Null layer | layer `ty: 3` |
| Rectangle, ellipse, path | shapes `rc`, `el`, `sh` |
| Group and its transform | shapes `gr`, `tr` |
| Fill, stroke | shapes `fl`, `st` |
| Gradient fill, gradient stroke | shapes `gf`, `gs` |
| Trim path | shape `tm` |
| Layer transform | `ks` with anchor, position, scale, rotation, opacity |
| Keyframes | bezier and hold |
| Masks | mode add (`"a"`) only |
| Alpha track mattes | `tt` 1 or 2 on the matted layer, `td: 1` on the source layer |

The emitter must never produce: expressions, effects, text layers, merge paths, repeaters, polystars (`sr`), luma mattes (`tt` 3 and 4), auto-orient, mask modes other than add, mask feather, blend modes other than normal, time remapping, 3D layers.

Reason: expressions work only in the web player; merge paths fail on iOS and web; luma mattes fail on Android, iOS and Windows; polystar is missing on Windows; the rest are patchy. Stars and polygons are converted to paths during normalization for this reason.

## Root object

```json
{
  "nm": "<scene name>",
  "fr": 30,
  "ip": 0,
  "op": 36,
  "w": 512,
  "h": 512,
  "assets": [],
  "layers": []
}
```

- `op` is `totalFrames`. `ip` is always 0.
- If the scene has `markers`, the emitter writes a top-level `markers` array in scene order: `{ "cm": "<name>", "tm": <start frame>, "dr": <end frame - start frame> }`, frames from `round(seconds * fps)`. A scene without markers has no `markers` key. The schema validator accepts the array with no warning (checked on `examples/markers-demo.gertie.json`).
- There is no `v` and no `ddd`. **Verified in phase 1:** the schema validator warns `Animation has unknown property 'v'` and `'ddd'`, so both are dropped. Phase 2 must confirm that lottie-web and dotlottie-web play the file without them.
- If the scene has a `canvas.background`, the emitter adds a bottom-most shape layer containing a canvas-sized rectangle with that fill. Lottie has no background field in the safe subset.

## From nodes to layers

Lottie has a flat list of layers. The scene is a tree. The mapping:

1. Each **top-level node** becomes one layer.
2. A top-level shape node becomes a shape layer (`ty: 4`) whose `ks` carries the node's transform and whose `shapes` holds one group with the geometry and styles.
3. A top-level group whose whole subtree is plain shapes becomes **one shape layer**. Child nodes become nested `gr` groups, and each child's transform becomes that group's `tr`.
4. A group is **not** plain if any node in its subtree is an `image`, a `use`, has a `clip`, has a `matte`, is a matte source, or has `from`/`to` different from the whole duration. A group that is not plain becomes a **precomposition**: an asset holding its children as layers (by these same rules, recursively), plus a layer with `ty: 0` that references it. The precomposition is larger than the canvas by one canvas side (the larger of width and height) on every side, and its content sits that far in from the corner. The layer anchor and any masks compensate, so child coordinates are unchanged. **Found in phase 3 by the SVG parity check:** a precomposition clips its content to its own rectangle, and the layer position moves that rectangle, so with a canvas-sized composition anything at a negative local coordinate was cut off (a `use` instance of a shape centred on its origin lost its upper half). The margin keeps content up to one canvas side outside the origin visible. Content further out is still clipped; that is a limit of the format, not something the scene can express around.
5. A `use` node becomes a precomposition layer referencing an asset built once from the definition.
6. An `image` node becomes an image layer (`ty: 2`) referencing an image asset.

Reason for rule 4: in Lottie, parenting passes on transforms but not opacity, and masks apply to whole layers. A precomposition applies its transform, opacity and mask to everything inside it, which is what a group means in the scene file.

**Order.** The scene uses painter's order (last on top). Lottie draws the first layer on top and the first shape item on top. The emitter reverses node order when writing `layers` and when writing the items of each group.

## Layer fields

```json
{
  "ty": 4,
  "nm": "<node id>",
  "ind": 1,
  "ip": 0,
  "op": 36,
  "st": 0,
  "sr": 1,
  "ddd": 0,
  "ks": { },
  "shapes": [ ]
}
```

- `ind` is a unique integer per layer within its composition, starting at 1.
- `ip` and `op` come from the node's `from` and `to`, converted to frames. `st` is 0.
- Precomposition layers add `refId`, `w`, `h`. Image layers add `refId`.
- `st` is written even though the validator reports them as unknown on a shape layer. See "Validator findings" below.
- `nm` is the node id. This keeps the output readable and lets error messages from validators be traced back to a node.

## Transform

The scene transform maps to Lottie like this:

| Lottie | Value |
|---|---|
| `a` (anchor) | `pivot` |
| `p` (position) | `[pivot.x + x, pivot.y + y]` |
| `s` (scale) | `[scale.x * 100, scale.y * 100]` |
| `r` (rotation) | `rotation` |
| `o` (opacity) | `opacity * 100` |

Lottie applies these in the order: move anchor to origin, scale, rotate, translate to position.

When `x` or `y` is animated, the emitter writes a split position so each axis keeps its own keyframes and easing:

```json
"p": { "s": true, "x": { "a": 1, "k": [ ] }, "y": { "a": 0, "k": 256 } }
```

Remember to add the pivot to every keyframe value.

**Verified in phase 2:** split position on a layer renders identically in lottie-web and dotlottie-web. In a shape group's `tr` it does not render in lottie-web, so groups use a single combined position (see "Validator findings").

Position keyframes in a non-split position must not carry spatial tangents (`ti`, `to`). Leave them out so the path between keyframes is a straight line.

For a nested group, the same mapping fills the group's `tr` item:

```json
{ "ty": "tr", "a": {"a":0,"k":[0,0]}, "p": {"a":0,"k":[0,0]}, "s": {"a":0,"k":[100,100]},
  "r": {"a":0,"k":0}, "o": {"a":0,"k":100} }
```

## Properties and keyframes

A static property:

```json
{ "a": 0, "k": 100 }
```

An animated property:

```json
{ "a": 1, "k": [
  { "t": 0,  "s": [256], "o": {"x":[0.5],"y":[1]}, "i": {"x":[0.89],"y":[1]} },
  { "t": 9,  "s": [176], "o": {"x":[0.11],"y":[0]}, "i": {"x":[0.5],"y":[0]} },
  { "t": 18, "s": [256] }
] }
```

Rules:

- `t` is a frame number. Times ascend strictly.
- `s` is always an array, even for a single number.
- **Easing lives on the keyframe where the segment starts.** The scene file puts the ease on the keyframe where the segment ends. So the easing written on Lottie keyframe `n` comes from scene keyframe `n + 1`.
- For a bezier `[x1, y1, x2, y2]`: `o` is `{ "x": [x1], "y": [y1] }` and `i` is `{ "x": [x2], "y": [y2] }`.
- The last keyframe has only `t` and `s`.
- A hold segment is written as `"h": 1` on the starting keyframe, with no `o` or `i`.
- Multi-dimensional values (scale, colour) use one easing for all dimensions: the `x` and `y` arrays still have one element.

## Shapes

### Group

Each shape node becomes a group:

```json
{ "ty": "gr", "nm": "<node id>", "it": [ <geometry>, <trim>, <stroke>, <fill>, <transform> ] }
```

Rules the Lottie format imposes:

- The transform (`tr`) must be present and must be the last item.
- A style applies to the geometry that comes before it in the same group.
- Items earlier in the list draw on top. Writing stroke before fill puts the stroke on top of the fill, which matches SVG.
- Geometry with no style after it is not drawn.

When the group is the only content of a top-level shape layer, the layer's `ks` carries the node transform and the group's `tr` is the identity.

### Rectangle

```json
{ "ty": "rc", "p": {"a":0,"k":[0,0]}, "s": {"a":0,"k":[w,h]}, "r": {"a":0,"k":radius} }
```

`p` is the centre.

### Ellipse

```json
{ "ty": "el", "p": {"a":0,"k":[0,0]}, "s": {"a":0,"k":[2*rx, 2*ry]} }
```

`s` is the full width and height, not the radii.

### Path

```json
{ "ty": "sh", "ks": { "a": 0, "k": {
  "c": true,
  "v": [[0,0],[40,0]],
  "i": [[10,20],[-10,-20]],
  "o": [[10,-20],[-10,20]]
} } }
```

- `v` holds the vertices.
- `o[n]` is the outgoing control point of vertex `n`, **relative to that vertex**.
- `i[n]` is the incoming control point of vertex `n`, relative to that vertex.
- `c` is whether the path is closed.

One SVG subpath becomes one `sh` item. A path with several subpaths becomes several `sh` items in the same group, before the styles.

### Converting an SVG path string

The normalizer converts every `d` string to subpaths of cubic segments. Support all SVG commands: `M m L l H h V v C c S s Q q T t A a Z z`.

1. Track the current point and resolve relative commands to absolute coordinates.
2. A line from P0 to P1 is a cubic with both control points on its endpoints: tangents are `[0, 0]`.
3. A quadratic with control point Q from P0 to P1 becomes a cubic with control points `P0 + 2/3 (Q - P0)` and `P1 + 2/3 (Q - P1)`.
4. `S` and `T` reflect the previous control point about the current point.
5. An arc is converted with the standard endpoint-to-centre parameterization from the SVG specification, then split into pieces of at most 90 degrees, each approximated by one cubic.
6. For each cubic from P0 with control points C1, C2 to P1: `o[P0] = C1 - P0`, `i[P1] = C2 - P1`.
7. On `Z`: mark the subpath closed. If the last vertex equals the first vertex (within 0.001), remove the last vertex and move its incoming tangent to the first vertex.

Write unit tests for each command type, comparing against sampled points on the original path.

### Fill

```json
{ "ty": "fl", "c": {"a":0,"k":[0.231,0.510,0.965]}, "o": {"a":0,"k":100}, "r": 1 }
```

- Colour components are 0 to 1. Divide each hex channel by 255 and round to three decimals.
- `r` is the fill rule: 1 nonzero, 2 even-odd.
- A colour with alpha (`#rrggbbaa`) puts the alpha into `o` multiplied by 100, not into the colour array.

### Stroke

```json
{ "ty": "st", "c": {"a":0,"k":[0,0,0]}, "o": {"a":0,"k":100}, "w": {"a":0,"k":4},
  "lc": 2, "lj": 2, "ml": 4 }
```

- `lc` line cap: 1 butt, 2 round, 3 square.
- `lj` line join: 1 miter, 2 round, 3 bevel.
- Dashes: `"d": [ {"n":"d","v":{"a":0,"k":8}}, {"n":"g","v":{"a":0,"k":6}}, {"n":"o","v":{"a":0,"k":0}} ]`.

### Gradient fill

```json
{ "ty": "gf", "t": 1, "s": {"a":0,"k":[0,-50]}, "e": {"a":0,"k":[0,50]},
  "g": { "p": 2, "k": {"a":0,"k":[0, 1,0.54,0, 1, 0.9,0.18,0.44]} },
  "o": {"a":0,"k":100}, "r": 1 }
```

- `t`: 1 linear, 2 radial.
- `s` and `e` are the start and end points. For radial, `s` is the centre and `e` is a point on the edge.
- `s` and `e` are animatable. A linear gradient's `fill.from` is the keyframed `s` and `fill.to` the keyframed `e`. A radial gradient's `fill.center` is `s`, and `e` is the centre moved right by the radius, so it depends on `fill.center` and `fill.radius`. When only one of those two is animated, or both share key times and easings, `e` is keyed directly. When they differ, `e` is baked at every frame. The easing of scene key n+1 goes on Lottie keyframe n, as for every property.
- `g.p` is the number of colour stops. The stops are never animated.
- `g.k.k` is a flat array: for each stop, `offset, r, g, b`. If any stop has alpha below 1, append `offset, alpha` for every stop after all the colour entries.

### Trim path

```json
{ "ty": "tm", "s": {"a":0,"k":0}, "e": {"a":0,"k":100}, "o": {"a":0,"k":0}, "m": 1 }
```

- `s` and `e` are percentages, 0 to 100. Multiply the scene values by 100.
- `o` is in degrees: multiply the scene offset by 360.
- Place it after the geometry and before the styles.

**Verified in phase 2:** the draw-on test (trim end from 0 to 1 on a stroked path) grows the stroke from the path's start in lottie-web and dotlottie-web, and a browser test keeps it that way.

## Mattes

A node with `matte: { by, mode }` and its source become two layers in the same composition. The source is written **directly above** the matted layer, with `td: 1`; the matted layer gets `tt: 1` for `alpha` and `tt: 2` for `alpha-inverted`. The source is not written at its own place in the order. A source shared by several nodes is written again above each of them (each copy has its own `ind`), which is also why a source may have only one mode. Matting is between layers of one composition, so a matted node forces layer splitting as a time window does (rule 4): a group that contains a pair becomes a precomposition. A matted node and its source are often shapes, and a group at the top level that is matted becomes one shape layer.

`tp` (the matte parent index) is not written; both players use the layer above, which is what the specification assumes when it is omitted. **Verified in phase 10:** the schema knows `tt` and `tp` but not `td`, and lottie-web needs `td: 1` to hide the source, so `td` is written and listed in `TOLERATED_UNKNOWN_PROPERTIES` with `st`, `hasMask` and mask `x`. lottie-web and dotlottie-web agree on `examples/matte-shine` and `examples/matte-reveal` (the second-player test in `tests/browser/player.spec.ts`).

**Precompositions for clips were checked and left alone** (`17-quality-tuning.md`, 4.1): 30 clipped groups as 30 precompositions cost 26 kB more JSON (under 2 kB compressed) and no measurable frame time in either player, so clipped shapes are not emitted as matte pairs.

## Clip to mask

A node with `clip` must be its own layer (rule 4 above ensures this). The clip shape, converted to a path, becomes a mask on that layer:

```json
"hasMask": true,
"masksProperties": [
  { "mode": "a",
    "pt": { "a": 0, "k": { "c": true, "v": [], "i": [], "o": [] } },
    "o": { "a": 0, "k": 100 } }
]
```

Rectangles and ellipses used as clips are converted to bezier paths first. An ellipse is four cubic segments with control distance `0.5523 * radius`.

**Verified in phase 1** against the schema: a mask has `mode`, `pt` and `o`. The fields `inv`, `nm` and `x` are reported as unknown and are not written. `hasMask` on the layer is also reported as unknown but is still written; see "Validator findings".

## Assets

Precomposition asset:

```json
{ "id": "comp-<name>", "nm": "<name>", "layers": [ ] }
```

Image asset, embedded:

```json
{ "id": "img-<name>", "w": 400, "h": 300, "e": 1, "u": "", "p": "data:image/png;base64,..." }
```

Images are embedded as data URIs by default so the output is one file. With `--external-images`, write `"e": 0`, `"u": "images/"`, `"p": "<file>"` and copy the files.

## Output formatting

- Round every number to three decimals. This cuts file size substantially with no visible effect.
- Emit keys in a fixed order so output is stable across runs. Golden tests depend on this.
- Default output is minified. `--pretty` indents it.

## dotLottie

A `.lottie` file is a ZIP archive with Deflate compression containing:

```
manifest.json
a/<name>.json
```

Manifest for version 2:

```json
{ "version": "2", "generator": "gertie", "animations": [ { "id": "<name>" } ] }
```

Writing a ZIP needs no dependency: Node's `zlib.deflateRawSync` plus a small central-directory writer is about 80 lines. Specification: https://dotlottie.io/spec/2.0/

**Verified in phase 4:** dotlottie-web 0.83.2 loads this archive (version 2 manifest, `a/<name>.json`) and reports the right frame count, and a test checks that it draws. It also loads the older layout (version 1 manifest, `animations/<name>.json`), so either works in that player. The writer is `src/export/zip.ts` (about 100 lines, no dependency, fixed timestamps so output is stable). The archive is produced by `gertie export <scene> --to lottie-zip`; the format is not called `dotlottie` in any command because the project does not use LottieFiles product names in command names.

## Validator findings

Recorded in phase 1 by running the official validator (`@lottie-animation-community/lottie-specs` 0.3.2, schema `$version` 10000, bundled at `skills/gertie/assets/lottie.schema.json`) over the emitter's output, and corrected in phase 2 by rendering in lottie-web 5.13.0 and dotlottie-web 0.83.2.

| Question | Result |
|---|---|
| Is a three-component colour accepted? | Yes |
| Is a split position accepted by the schema? | Yes, on a layer and in a group transform |
| Does a split position render? | **On a layer: yes, identically in lottie-web and dotlottie-web. In a shape group's `tr`: no. lottie-web draws nothing for the whole animation.** Group transforms therefore get a combined two-dimensional position (exact when one axis moves, or both share times and eases; baked per frame otherwise) |
| Does a precomposition asset take `fr`? | No (unknown to the schema); not needed by either player. Not written |
| Does the root take `v` or `ddd`? | No (unknown to the schema); both players play without them. Not written |
| Does a layer need `sr`? | No difference in lottie-web, with or without it, including precompositions. Not written |
| Does a layer need `st`? | **Yes.** Without it lottie-web renders blank frames. Written, and reported as unknown by the schema |
| Does a masked layer need `hasMask`? | **Yes.** Without it lottie-web ignores the mask. Written, and reported as unknown by the schema |
| Does a mask need `x` (expansion)? | **Yes.** Without it lottie-web draws nothing for the whole layer. Written as `{ "a": 0, "k": 0 }`, and reported as unknown by the schema |
| Do masks take `inv` and `nm`? | Reported as unknown, and lottie-web does not need them. Not written |
| Do dash entries need `nm`? | **Yes.** Without `nm` lottie-web draws nothing for the whole animation. Written as `dash`, `gap`, `offset`; the schema accepts it |
| Does the trim path order (geometry, `tm`, stroke, fill) draw correctly? | Yes. The stroke grows from the path start in lottie-web and dotlottie-web, and the two renders agree |

Three properties are written although the schema does not know them: layer `st`, layer `hasMask` and mask `x`. They are listed in `TOLERATED_UNKNOWN_PROPERTIES` in `src/validate/schema.ts` and the validator warnings about them are ignored. Every other warning is an error.

lottie-web fails silently. A single unsupported construct can make the whole animation blank with nothing in the console. This is why Gertie checks rendered output and does not rely on the schema alone, and it is how all four "Yes" rows above were found: the corpus passed the schema with zero warnings and two examples rendered blank.

The validator bundles into a single script with esbuild (about 370 KB with Ajv), so no hand-written fallback is needed.

## Unit tests this module needs

- Each shape type: scene node in, expected Lottie fragment out.
- Transform mapping including pivot, with and without animation.
- Easing shift: a three-keyframe scene property produces the right `o` and `i` on the right keyframes.
- Hold segments.
- Order reversal for layers and for group items.
- Path conversion for every SVG command.
- Group to shape-layer versus group to precomposition decision.
- Colour conversion, including alpha.
- Every corpus example passes schema validation with zero errors and zero warnings.
