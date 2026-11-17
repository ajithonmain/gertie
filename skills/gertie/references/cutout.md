# Animating a painting or photo with cutouts

For artwork whose quality is in its texture (brush strokes, grain, soft shading), tracing would destroy it. Instead keep the pixels and animate pieces of the picture, like a paper puppet. You outline each part as a polygon; Gertie cuts the layers and fills in what each part leaves behind.

## What it can and cannot do

It can do small motions of parts that already exist in the picture: a blink, an eye that looks to one side, a head tilt, breathing, hair swaying, a hand lifting a little, a background that drifts, drifting leaves, a ticking clock.

It cannot walk, turn the head, change the expression or make a new pose. There is one drawing, and nothing can show what is not in it. If the user asks for those, say so, and suggest AI video generation. Keep motions small: a tilt of a few degrees, a drift of a few pixels. The area a part leaves is a smooth guess, good for small movements only.

## Steps

1. **Look at the image** and decide which parts are worth moving, back to front. Every point you write is in image pixels, with the origin at the top-left. To read coordinates by eye, draw a grid on the picture:

       node scripts/gertie.mjs grid painting.png --step 50

   It writes `painting.grid.png` with lines every 50 pixels labelled with their coordinates. Use a smaller `--step` for fine detail.
2. **Write the parts file**, `parts.json`:

       { "bleed": 30, "grow": 2, "inset": 1,
         "parts": [
           { "id": "hair-back", "polygon": [[x, y], ...], "pivot": [x, y] },
           { "id": "body",      "polygon": [...] },
           { "id": "head",      "polygon": [...], "pivot": [320, 345] },
           { "id": "eye-l",     "polygon": [...] }
         ],
         "lids": [ { "id": "lid-l", "ellipse": [cx, cy, rx, ry], "sample": [x, y] } ] }

   - `parts` go **from back to front**. The picture itself is the background behind them all.
   - A `polygon` outlines the part. 24 to 60 points on a smooth shape is plenty. Follow the edge closely; points just inside the edge are better than points outside.
   - A part that touches the edge of the picture (the body, the sky) needs its polygon to run **past the edge**, by up to the `bleed` plus 8 pixels, so it has pixels to show when it moves. Past the edge the picture is mirrored.
   - `pivot` is where the part turns, in image pixels: the neck for a head, the shoulder for an arm.
   - `bleed` adds that many pixels around the picture (its edge mirrored, so the texture continues), so the background can drift without showing its edge and parts can extend past it. Use the largest drift you will animate, plus a little. A drift of 6 to 12 pixels looks natural; the mirrored margin is a copy of the picture, so very large drifts look odd.
   - `grow` (default 2) enlarges the area filled behind a part, to remove the thin fringe of old background colour along its edge. `inset` pulls a part's edge in by that many pixels. Raise `inset` to 1 or 2 if a part shows a rim of the colour behind it.
   - `lids` make a blink. A picture has no closed eyes, so a lid is a patch of skin that drops over the eye. `ellipse` is `[centre x, centre y, radius x, radius y]` of the eye: measure the eye's visible width and height and add about 2 pixels to each radius, or a sliver of the eye shows. `sample` is the centre of a patch of skin of the same size as the lid, next to the eye (it must not touch the eye, a brow or the mouth): the lid is cut from it, so it has the painting's grain. If the patch has the right grain but the wrong tone (a cheek that blushes), add `"tone": [x, y]`, a point of skin whose colour the lid should have, such as the nose bridge between the eyes. `"flat": true` makes a plain one-colour lid instead.
3. **Cut.**

       node scripts/gertie.mjs cutout painting.png parts.json --out painting.cutout --json

   It writes `background.png`, `parts/<id>.png`, `lids/<id>.png` and `fragment.json` into the folder, `outlines.png`, your outlines, pivots and lid patches drawn on the picture, and `rest.png`, the layers put back together. **Open `outlines.png` first** and check that every outline follows its part. It prints how much `rest.png` differs from the picture. Under 2 percent is good, but it cannot see a poor lid, so look at `rest.png` too. Errors in the parts file are listed with what to fix.
4. **Group the parts that move together.** The head, the hair in front of it, the eyes and the lids turn as one: write `{ "face": ["head", "fringe", "eye-l", "eye-r", "lid-l", "lid-r"] }` and run `node scripts/gertie.mjs group painting.cutout/fragment.json groups.json --out painting.cutout/grouped.fragment.json`.
5. **Write a scene** that includes the grouped fragment and animates it, as in `references/import.md`. Use the canvas size of the picture, and give the canvas a `background` colour so the checks know the picture fills it:

       { "id": "portrait", "type": "group", "include": "painting.cutout/grouped.fragment.json",
         "overrides": {
           "background": { "animate": { "x": [[0, -22], [2.4, -38, "easeInOutSine"], [4.8, -22, "easeInOutSine"]] } },
           "face": { "pivot": [320, 345], "motion": [{ "preset": "wiggle", "angle": 2.5, "duration": 2.4, "repeat": "loop" }] },
           "lid-l": { "motion": [{ "preset": "lid-blink", "at": 1.0 }, { "preset": "lid-blink", "at": 3.6 }] },
           "lid-r": { "motion": [{ "preset": "lid-blink", "at": 1.0 }, { "preset": "lid-blink", "at": 3.6 }] } } }

   - The background node sits at `x` and `y` equal to minus the `bleed`, so animate around that value and keep within the bleed.
   - `lid-blink` closes the lid over the eye for a moment and leaves it flat (hidden) the rest of the time. Offset the two lids by a frame or two if you like.
   - For a body that breathes, use `pulse` with a pivot on its bottom edge, so its lower edge stays put.
6. **Run `qa` and look at full-size frames at the moments that matter.** The contact sheet has few, evenly spaced frames and will probably miss a blink and the extreme of a tilt. Draw those frames:

       node scripts/gertie.mjs render out/portrait.lottie.json --times 0.6,1.08,1.8 --out frames

   Pick times from your scene: the peak of a tilt, a point inside each blink (the lid is closed from 0.11 to 0.15 s after the blink starts), the extreme of the drift. Check for: a rim of old colour along a part, a gap where a part has moved, a copy of a part where it was. Fix the outline, `inset` or `grow` and cut again.

## Notes

- The layer images are PNG files next to the fragment, and the Lottie and SVG outputs embed them. A cutout scene is typically 300 KB to 2 MB, so `qa` warns about size. Export `.lottie` to compress it.
- The result does not scale beyond the resolution of the picture.
- Only the picture itself is used. Gertie does not fetch or generate artwork.
