# Drawing the artwork

Read this before you draw anything that is more than a few shapes: a character, an illustration, a scene. Professional animations are illustrations first. Draw the picture, then animate it. Set the scene's `"tier"` before you start (see "Quality tiers" in `SKILL.md`): it tells you how much drawing the piece needs.

If the user supplies a logo, icon or character, do not redraw it. Use `import` for an SVG and `trace` for a PNG or JPEG (`references/import.md`, `references/trace.md`).

## Build order

1. Silhouette: the outer shape of each object, one `path` node each.
2. Large interior shapes: body parts, panels, the big areas inside the silhouette.
3. Shading: shadow and highlight shapes (see below).
4. Details last: eyes, buttons, texture, small marks.

Check the contact sheet after step 2. If it already reads as the subject, add shading. If not, fix the silhouette first.

## Paths, not primitives

- Draw with `path` nodes and the curve commands `C`, `S` and `Q`. Aim for 6 to 10 vertices per path. Fewer looks like a polygon. More costs file size and makes morphing hard.
- A path made only of `L` segments reads as low-polygon. Use that only when it is the chosen style.
- Keep `rect`, `ellipse`, `star` and `polygon` for what is truly that shape: wheels, eyes, buttons, screens, dots.
- Trace the shape with a few well-placed points, then pull the handles. Do not add points to fix a bad curve; move the handles.

`W-ART-PRIMITIVE` fires when a scene has more than 8 shape nodes and no path with a curve in it. It stays quiet for `"tier": "icon"`.

## Shading in three steps

A flat shape becomes a finished one with three additions, each its own node drawn after the base:

1. Shadow: a darker tone of the base, on the side away from the light.
2. Highlight: a lighter tone, small, on the side toward the light.
3. Ground shadow: a flat dark `ellipse` under the object at low opacity (for example `#00000033`).

Use `clip` to keep the shadow or highlight inside its base shape: `"clip": { "type": "path", "d": "<the base path>" }`, with the clip placed like the base. The shading shape can then be a rough blob that overshoots the silhouette. The clip trims it. This is what makes shading cheap to draw.

Pick one light direction for the whole piece (say, upper left) and keep every shadow and highlight consistent with it.

Use a gradient where a surface is large or curved (a sky, a sphere, a glow), with 3 stops. Do not put a gradient on everything: one or two per scene.

## Palette

Choose three or four hues. For each, define a base, a shade and a tint in `palette`, so a character has 6 to 12 colours and a full scene adds one or two background hues to reach 12 to 20. Name them by role (`leaf`, `leaf-shade`, `leaf-tint`) and use `$names` everywhere. A scene of many shapes in 3 colours or fewer, with no gradient, raises `W-ART-FLAT`.

## Outlined or flat

Decide once per scene and keep to it:

- Outlined: every shape has a stroke of one width and one colour.
- Flat: no outlines. Use strokes only for lines (stems, whiskers, trim-path draws) and small details.

Mixing the two looks unfinished.

Strokes default to round caps and round joins, which suit line icons and hand-drawn art. For geometric and interface artwork set `"join": "miter"` so corners stay sharp.

## Clip or matte

Use `clip` when the trimming shape is fixed and hard-edged, which is almost all shading: a rough blob clipped to its base silhouette. Use `matte` when the shape that decides what shows is itself animated or must be a shape of its own: a shine that sweeps across a badge, a reveal through a growing hole, a liquid level inside a moving cup. The source of a matte is a sibling node and is not drawn, so draw the visible copy as a separate node, and put the matted node and its source in the same list. `"alpha-inverted"` shows the node where the source is not. Merge paths do not exist; use an even-odd path for a hole, and a clip or a matte for an intersection. See `references/scene.md`.

## Canvas and frame rate

- Icons: author at 512 by 512.
- Characters and scenes: author at 1024. Coordinates at that size leave room for detail without decimals.
- Leave `fps` at 30. Set 60 only for short, fast pieces (interface transitions, a walk cycle) that will be shown as Lottie, SVG or video.
- Set `poster` to the most complete pose, so the still image under reduced motion looks finished.

## Declare the tier

Set `"tier": "icon"`, `"character"` or `"scene"` at the top of the scene, then run `profile`. A `below` on paths, vertices per path or colours means the drawing is too thin. Read `references/motion.md` for the motion measures.

## What the profile counts

The bands are measured on the compiled file, and a few of the counts are not what you would guess from the scene.

- **Paths are `path` nodes only.** A `rect`, `ellipse`, `star` or `polygon` is not a path. An icon needs 5 to 20 paths, so in a small icon draw the main shapes as paths (a circle is four curve segments) and keep primitives for eyes, dots and soft shadows.
- **Vertices per path is an average.** Two-point lines and three-point ticks pull it down. A tapered dash drawn as a four-point shape counts better than a stroked line, and looks better.
- **Colours** are every distinct fill and stroke colour, including each value a `fill` animates through and the canvas `background`. Gradient stops are not counted, and neither is opacity: a shadow drawn in the darkest palette colour at 15 to 25 percent opacity adds no colour. An icon has 5 colours at most, so shade with one darker tone, one tint and that overlay.
- **Layers.** Each top-level node is one layer. A group of plain shapes is one layer however many shapes it holds. A group that holds a `clip`, a `matte`, a `use`, an `image` or a node with `from` or `to` becomes a precomposition, and each of its children is a layer of its own. To raise the count, keep separate things at the top level, or clip one shading shape. To lower it, wrap plain shapes that belong together in a group.

## Full scenes

- **Budget the nodes.** A scene needs 120 to 250 paths, but `W-NODE-COUNT` fires above 200 nodes, groups included, and `W-L-SIZE` above 200 kB of Lottie. Aim for 125 to 165 paths and few groups: the benchmark scenes have 122 to 166 paths in 140 to 180 nodes and compile to 94 to 104 kB.
- **Repeat with variation.** A street is one building recipe run five times with different widths, heights and window counts; a sky is one cloud recipe at three sizes. Detail that repeats (windows, road marks, cross braces, stars) is what carries a scene to 120 paths.
- **Give a full-bleed scene a canvas `background`.** Without one the render check sees artwork on the canvas border and reports `W-R-CLIPPED`. Put a gradient `rect` over it for the sky.
- **Few things move.** Thirty to sixty animated properties, most of them small: windows that light, a lamp that flickers on, one vehicle that passes, a tail that sways.

## Text

There is no text node. For a word or two, draw each letter as a stroked path with round caps, on a shared baseline: a stem is `M 0 -150 L 0 0`, a bowl is an ellipse drawn as a path, and one stroke width for the whole word keeps it even. Give each letter its own node so the letters can move in turn. `examples/benchmark/book-call-button.gertie.json` and `sky-greeting.gertie.json` in the Gertie repository show a label and a greeting made this way. For more than a few words, ask the user for the text as outlines in an SVG and import it.

## Worked pattern: one shaded leaf

    { "id": "leaf", "type": "group", "x": 520, "y": 400, "children": [
      { "id": "leaf-base", "type": "path", "fill": "$leaf",
        "d": "M 0 0 C 40 -60 110 -90 190 -80 C 170 -10 100 40 0 0 Z" },
      { "id": "leaf-shade", "type": "path", "fill": "$leaf-shade",
        "clip": { "type": "path", "d": "M 0 0 C 40 -60 110 -90 190 -80 C 170 -10 100 40 0 0 Z" },
        "d": "M -10 20 C 60 -10 130 -30 200 -30 L 200 60 L -10 60 Z" },
      { "id": "leaf-vein", "type": "path", "fill": null,
        "stroke": { "color": "$leaf-tint", "width": 4 },
        "d": "M 10 -4 C 70 -30 120 -50 170 -70" }
    ] }
