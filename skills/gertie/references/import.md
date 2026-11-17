# Animating an SVG the user supplied

When the user gives you an SVG (a logo, an illustration, an icon set, an export from Figma, Illustrator, Inkscape or Sketch), do not redraw it. Import it, so the artwork stays exact, and decide only how it moves.

## Steps

1. **Import.**

       node scripts/gertie.mjs import artwork.svg --json

   This writes `artwork.fragment.json` and `artwork.preview.png` next to the SVG, and prints a summary.
2. **Read the summary** (`summary` in the JSON). It lists every group and the largest shapes with their id, type, bounding box `[x, y, width, height]` in canvas pixels, and fill. `advice` says in plain words what the layering allows. `unsupported` lists what could not be imported.
3. **Look at the preview image.** It shows the artwork with the parts outlined and their ids written beside them, so you can tell which id is which part. If the file wraps everything in one or two groups, the preview outlines the first level that splits into parts.
4. **Write a scene** that includes the fragment and adds motion to the parts you want to move:

       { "gertie": 1, "name": "demo", "canvas": { "w": 500, "h": 387 }, "duration": 2.4,
         "nodes": [
           { "id": "scene", "type": "group", "include": "artwork.fragment.json",
             "overrides": {
               "group-34": { "motion": [{ "preset": "float", "distance": 8, "repeat": "loop" }] },
               "group-5":  { "pivot": [120, 270], "motion": [{ "preset": "wiggle", "angle": 3, "duration": 1.2, "repeat": "loop" }] }
             } }
         ] }

   Use the fragment's canvas size for the scene canvas. Then run `qa` as usual.

## include and overrides

- `include` goes on a group with no `children`. The path is relative to the scene file. The artwork is not copied into the scene.
- `overrides` maps a node id (at any depth) to fields to add or change: `pivot`, `x`, `y`, `rotation`, `scale`, `opacity`, `animate`, `motion`, `from`, `to`, fill and the like. `animate` merges per property and `motion` is appended. An override cannot change `id`, `type` or `children`.
- A wrong id is `E-INCLUDE-OVERRIDE`. It suggests the nearest id and lists some that exist.
- The included group can itself be moved, scaled or animated like any group.

## What the importer does

- Every transform is flattened into the coordinates, so nodes sit in canvas pixels and a group has no transform of its own. To rotate a part, set its `pivot` to the joint in canvas pixels.
- Rectangles and ellipses that are only moved or scaled stay `rect` and `ellipse` nodes. Everything else (rotated shapes, polygons, lines) becomes a `path`. A `rect` or `ellipse` node is centred on its own `x`, `y`.
- Styles come from attributes, `style` attributes and `<style>` rules (tag, class and id selectors). Opacity, fill and stroke opacity, dashes, caps and joins are kept. Linear and radial gradients are kept.
- `<use>` is copied out. A `clip-path` becomes a `clip`. A `<mask>` made of plain white shapes becomes a clip too.
- Ids come from the element's `id`, then the Inkscape label, then a generated name such as `path-7`. They are lowercased and made safe.

## What it cannot do, and what to tell the user

- **Text** is not imported. Ask for the text converted to outlines.
- **Filters** (blur, drop shadow), **blend modes**, **patterns** and **images** inside the SVG are left out. The `unsupported` list names them. Say what is missing.
- **Masks that are not plain white shapes** (soft masks) are removed.
- **A radial gradient stretched into an ellipse** is imported as a circle, so its falloff differs a little. It is reported.
- **A gradient on a stroke** becomes a solid colour.
- **Layering decides what can move.** An arm can swing only if it is its own group. If the summary says the artwork is flat (many loose shapes, few groups) or one merged shape, say so, and ask the user for a layered file (separate layers for the parts that should move) if the motion needs it. You can still move loose shapes one by one by id, or wrap several in a group by hand.

## Large files

A detailed illustration can have hundreds of nodes. The scene then raises `W-NODE-COUNT` and `W-L-SIZE`. That is only a warning about file size. If the user needs a small file, ask for a simpler SVG.
