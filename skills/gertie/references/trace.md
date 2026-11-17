# Animating a PNG or JPEG logo, icon or flat illustration

For a flat image (a logo, an icon, a flat-colour illustration), trace it to vector shapes, group the shapes into parts, then animate the parts. The artwork is the user's; you decide only how it moves.

If the file is already an SVG, do not trace it: use `references/import.md`. If it is a painting or a photo with texture and soft shading, tracing destroys it: use `references/cutout.md`.

## Steps

1. **Trace.**

       node scripts/gertie.mjs trace logo.png --json

   This decodes the image (PNG, JPEG, GIF or WebP), reduces it to a few flat colours, and writes `logo.fragment.json` (the shapes, ids `region-1`, `region-2`, ... drawn largest first) and `logo.preview.png` next to it. Options:
   - `--colors 16`: most colours kept (2 to 64). Raise it for artwork with many colours.
   - `--speckle 6`: regions smaller than this many pixels are merged into their neighbours. Raise it to drop dust.
   - `--drop #ffffff`: make this background colour transparent (several, separated by commas). Use it for a logo on a white page.
   - `--seam 0.6`: width of a same-colour outline that closes hairline gaps between neighbouring regions. `0` removes it.
   - `--detail 0.45`: simplification in pixels. Smaller keeps more detail and makes a bigger file.
   - `--keep-svg traced.svg`: also keep the traced SVG.
2. **Read the summary and look at the preview.** Each region is listed with its id, size, bounding box and colour. The preview draws the outline and id of the largest regions on the artwork. Say what each region is (the bolt, the ring, the left star).
3. **Group the regions into parts.** A traced image is a flat list. To move a part as one, write a small grouping file mapping a new group id to the region ids it holds:

       { "bolt": ["region-3", "region-5"], "star-a": ["region-6", "region-10"] }

       node scripts/gertie.mjs group logo.fragment.json groups.json --out logo.grouped.fragment.json

   A group sits where its first member was in the stack and keeps its members in their original order. Anything you do not group stays as it is.
   - To find the **pivot** of a group (the point it turns or scales around), use the centre of its bounding box from the summary: `x + width / 2`, `y + height / 2`. For a part that hangs or swings, use the joint instead.
   - **Small odd regions** (a sliver of a slightly different colour at an edge or inside a shape) are anti-aliasing and shading. Group each with the object it sits in or against: look at the preview to see which one.
4. **Write a scene** that includes the grouped fragment and animates the groups, exactly as for an imported SVG (`references/import.md`): `include`, `overrides`, `pivot` in canvas pixels, `motion` presets. Then run `qa`.

## What to tell the user

- Gradients and soft shading become bands of flat colour. Texture and grain are lost.
- Tracing finds regions of colour, not objects. A hand resting on a table is regions you assign to one or the other.
- The background is a region too (the first one, largest). Animate it, drop it with `--drop`, or leave it.
- Small details (thin lines, tiny text) may be lost or lumpy. If the logo has text, say so.
