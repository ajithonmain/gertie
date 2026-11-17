# Quality benchmark

This document records what professionally made Lottie animations look like when measured, and how far Gertie's own corpus is from them. It is the evidence for `17-quality-tuning.md`, which turns the gaps into work.

The quality bar is the free animation listing at `https://lottiefiles.com/free-animations/`. The goal is that an animation an agent makes with Gertie, exported as SVG or video, can sit next to those without looking like a programmer's test file.

## How the reference was measured

- **Date:** 14 November 2026.
- **Sample:** two runs. The first was the 39 animations on the first page of the listing, measured in the most detail. The second was 415 more from later listing pages and from searches for complex scenes; see "The wider sample". All files were read successfully.
- **Method:** each animation's archive was fetched and parsed in the browser, and a script walked every layer, shape and animated property. Nothing was saved to disk, and no reference file is in this repository. Only counts and distributions were kept.
- **Subjects in the sample:** character loops (a jumping mascot, a walking turkey, a footballer), illustrated scenes (travel booking, delivery, a snow globe), interface pieces (a navigation bar, a checkout button, a volume control, a coupon reveal), icons and loaders (a success tick, triple dots, a cloud logo), and text stickers.

Limits of this measurement, so it is not over-read:

- 454 files on one day, chosen by the site's own ordering. Treat the numbers as bands, not exact targets.
- Counts taken per keyframe or per stroke are dominated by a few very large files. One file alone holds 7,279 keyframes. Per-file medians are the more reliable figures and are the ones used for targets.
- Easing handles were rounded to one decimal place before counting.
- The reference site's GIF and video downloads were not measured. They are rendered from the same Lottie files, so video quality is a matter of render size, frame rate and encoder settings, covered in `17-quality-tuning.md` section 6. **Verify during build.**

## Do not copy the reference files

The reference animations belong to their authors. They are a measuring stick only. Do not download them into `examples/`, `tests/` or anywhere else in this repository, do not trace them, and do not use them as fixtures. Every Lottie file in this repository is produced by the compiler from a scene file, as `CLAUDE.md` requires.

## Reference numbers: the first page

Each cell is the 10th percentile / median / 90th percentile across the 39 files.

### Size and timing

| Measure | p10 / median / p90 |
|---|---|
| Canvas width | 512 / 1022 / 1440 |
| Canvas height | 510 / 928 / 1184 |
| Duration, seconds | 2 / 5.5 / 14.5 |
| JSON size, kB | 19 / 87 / 1214 |
| Archive size, kB | 3 / 15 / 312 |

Frame rate: 60 fps in 23 files, 30 fps in 13, 25 fps in 2, 24 fps in 1.

### Artwork

| Measure | p10 / median / p90 |
|---|---|
| Layers, including those inside precompositions | 6 / 23 / 154 |
| Path shapes | 6 / 53 / 348 |
| Path vertices in total | 40 / 370 / 3014 |
| Vertices per path | 3.1 / 7.1 / 12.8 |
| Distinct solid colours | 2 / 7 / 28 |

Share of files that use each shape feature:

| Feature | Files |
|---|---|
| Free-form paths | 97% |
| Strokes | 74% |
| Ellipses | 59% |
| Rectangles | 54% |
| Gradient fills | 51% |
| Merge paths | 33% |
| Gradient strokes | 31% |
| Trim paths | 26% |
| Rounded-corner modifier | 10% |
| Star or polygon primitive | 10% |
| Offset path | 5% |
| Repeater, pucker, zig-zag, twist | 0% |

Gradients have 3 stops at the median and 5 at the 90th percentile. Stroke caps are butt in 58% of strokes and round in 42%; joins are miter in 79% and round in 21%.

### Motion

| Measure | p10 / median / p90 |
|---|---|
| Animated properties | 6 / 40 / 346 |
| Keyframes | 12 / 186 / 7279 |
| Keyframes per second of animation | 3.1 / 38.9 / 777 |
| Share of keyframe segments with a non-linear ease | 0.19 / 0.77 / 1.0 |
| Distinct easing curves in one file | 1 / 9 / 115 |
| Animated path shapes (morphs) | 0 / 1 / 24 |
| Share of layers that have a parent | 0 / 0.32 / 0.75 |

Across all animated properties in the sample:

| Measure | p10 / p25 / median / p75 / p90 |
|---|---|
| Keyframes on one animated property | 2 / 4 / 13 / 18 / 26 |
| Time between neighbouring keyframes, milliseconds | 17 / 67 / 150 / 286 / 400 |
| Share of a file's animated properties that start on a frame no other property starts on | 0.03 / 0.18 / 0.38 / 0.54 / 0.77 |

Other motion facts:

- 64% of animated properties end on the value they started with, which is how the loops close.
- 54% of layers are visible for only part of the timeline.
- Hold keyframes are close to absent. The median file has none.
- Only 0.6% of eased segments have a handle outside the 0 to 1 range. Overshoot is almost never done with a "back" curve. It is done with an extra keyframe past the target.
- Only 2% of position keyframes follow a curved spatial path. Arcs come from separate timing on x and y, or from parent rotation.

Which properties are animated, by count of animated properties:

| Property | Count |
|---|---|
| Layer position | 573 |
| Shape group position | 471 |
| Shape group scale | 430 |
| Path shape (morph) | 418 |
| Layer scale | 385 |
| Layer rotation | 355 |
| Shape group rotation | 343 |
| Fill colour | 309 |
| Fill opacity | 192 |
| Layer opacity | 119 |
| Ellipse position | 102 |
| Shape group opacity | 93 |
| Gradient start or end point | 64 |
| Ellipse size | 40 |
| Trim start, trim end | 29 each |
| Layer anchor | 22 |
| Rectangle size, rectangle position | 8, 6 |
| Stroke width | 3 |
| Gradient colours | 1 |

The most common easing curves, as `cubic-bezier(x1, y1, x2, y2)`, by count of segments:

| Curve | Segments | Character |
|---|---|---|
| 0.7, 0, 0.3, 1 | 9732 | Strong ease in and out |
| 0.2, 0, 0.8, 1 | 3764 | Gentle ease in and out |
| 0.3, 0, 0.7, 1 | 2295 | Ease in and out |
| 0.2, 0, 1, 1 | 1918 | Slight ease in, no ease out |
| 0.3, 1, 0.7, 1 | 1488 | Fast start, long settle |
| 0.8, 0, 0.3, 1 | 1283 | Very strong ease in and out |
| 0.2, 0.2, 0.8, 0.9 | 1241 | Near linear, used between closely spaced keys |
| 0.2, 0.1, 0.8, 0.8 | 1095 | Near linear, used between closely spaced keys |
| 0.4, 0, 0.8, 1 | 958 | Ease in |

### Structure

Share of files that use each structural feature:

| Feature | Files |
|---|---|
| Layer parenting | 87% |
| Precompositions | 64% |
| Track mattes | 62% |
| Path morphing | 59% |
| Null layers as controllers | 44% |
| Named markers | 44% |
| Layer effects | 33% |
| Masks | 15% |
| Blend modes | 15% |
| Embedded images | 10% |
| Expressions | 10% |
| Text layers | 8% |
| Solid layers | 8% |
| Time remapping | 5% |

## The wider sample

The first page is small, so the same script was run on 415 more animations on the same date. Together with the first page that is 454 files. The second run kept its own list of files already seen, so a few first-page files may be counted in both.

| Group | Files | Where from |
|---|---|---|
| Featured | 90 | Pages 2 to 4 of the featured listing |
| Popular | 90 | Pages 1 to 3 of the popular listing |
| Search | 235 | Up to 30 results each for `character`, `illustration`, `city`, `landscape`, `isometric`, `walk-cycle`, `scene` and `3d` |
| Complex tier | 104 | The quarter of the 415 with the most paths. This is the reference for full scenes |

The detailed easing, property and stroke counts above were taken on the first page only. The second run measured the per-file figures below.

### Per-file figures by group

Each cell is 10th percentile / median / 90th percentile.

| Measure | Featured | Popular | Search | All 415 | Complex tier |
|---|---|---|---|---|---|
| Canvas, longer side | 358 / 868 / 1500 | 250 / 512 / 1200 | 262 / 960 / 1920 | 256 / 800 / 1920 | 500 / 1080 / 1821 |
| Duration, seconds | 1.8 / 5.0 / 12 | 1.1 / 3 / 6 | 1.0 / 4 / 10 | 1.1 / 4 / 10 | 3.1 / 6 / 10 |
| Layers | 9 / 23 / 110 | 3 / 12 / 63 | 5 / 18 / 71 | 4 / 18 / 79 | 11 / 40 / 119 |
| Path shapes | 4 / 53 / 244 | 0 / 13 / 101 | 0 / 38 / 280 | 0 / 33 / 234 | 117 / 209 / 502 |
| Path vertices | 28 / 447 / 2711 | 0 / 72 / 713 | 0 / 212 / 2024 | 0 / 192 / 1925 | 687 / 1580 / 3962 |
| Vertices per path | 4 / 7.7 / 15 | 0 / 5.3 / 11 | 0 / 5.4 / 11 | 0 / 5.7 / 12 | 4.3 / 7.1 / 11 |
| Distinct solid colours | 1 / 6 / 23 | 1 / 4 / 11 | 0 / 6 / 25 | 1 / 6 / 22 | 6 / 17 / 39 |
| Animated properties | 6 / 25 / 107 | 3 / 22 / 124 | 2 / 17 / 67 | 3 / 20 / 96 | 8 / 37 / 108 |
| Keyframes | 18 / 132 / 1638 | 6 / 64 / 477 | 6 / 50 / 404 | 6 / 65 / 618 | 30 / 149 / 1180 |
| Keyframes per second | 3.2 / 33 / 201 | 1.9 / 18 / 115 | 0.9 / 17 / 134 | 1.5 / 20 / 135 | 5.5 / 25 / 159 |
| Eased share of segments | 0 / 0.70 / 0.98 | 0.03 / 0.82 / 1 | 0 / 0.78 / 1 | 0 / 0.78 / 1 | 0.08 / 0.79 / 0.99 |
| Distinct easing curves | 0 / 7 / 38 | 1 / 4 / 18 | 0 / 2 / 12 | 0 / 3 / 22 | 1 / 5 / 31 |
| Properties with their own start frame | 0.05 / 0.25 / 0.6 | 0.06 / 0.29 / 0.83 | 0.03 / 0.25 / 0.67 | 0.03 / 0.25 / 0.67 | 0.08 / 0.25 / 0.58 |
| Properties that close the loop | 0 / 0.53 / 0.98 | 0 / 0.33 / 1 | 0 / 0.53 / 1 | 0 / 0.49 / 1 | 0.06 / 0.70 / 0.97 |
| JSON size, kB | 16 / 107 / 373 | 5 / 31 / 191 | 11 / 79 / 468 | 8 / 71 / 392 | 127 / 272 / 664 |
| Archive size, kB | 2.5 / 16 / 823 | 1.2 / 3.8 / 28 | 2.2 / 15 / 168 | 1.8 / 12 / 112 | 16 / 30 / 103 |

Frame rate across the 415: 30 fps in 194 files, 60 fps in 151, 25 fps in 27, 24 fps in 26, and 17 files at other rates. In the complex tier: 30 fps in 55 files, 60 fps in 36.

### Feature use by group

Share of files, in percent.

| Feature | Featured | Popular | Search | All 415 | Complex tier |
|---|---|---|---|---|---|
| Free-form paths | 96 | 83 | 85 | 87 | 100 |
| Strokes | 67 | 77 | 65 | 68 | 71 |
| Layer parenting | 69 | 42 | 57 | 56 | 74 |
| Precompositions | 80 | 39 | 46 | 52 | 63 |
| Path morphing | 50 | 34 | 50 | 47 | 51 |
| Ellipses | 47 | 43 | 23 | 33 | 28 |
| Null layers | 40 | 24 | 28 | 30 | 34 |
| Trim paths | 22 | 44 | 26 | 29 | 31 |
| Rectangles | 41 | 24 | 23 | 27 | 31 |
| Track mattes | 46 | 17 | 21 | 26 | 41 |
| Gradient fills | 42 | 12 | 17 | 21 | 38 |
| Merge paths | 19 | 4 | 15 | 14 | 26 |
| Layer effects | 28 | 9 | 11 | 14 | 18 |
| Markers | 39 | 2 | 6 | 13 | 22 |
| Embedded images | 17 | 3 | 16 | 13 | 9 |
| Masks | 11 | 4 | 15 | 12 | 23 |
| Expressions | 3 | 10 | 10 | 8 | 8 |
| Gradient strokes | 23 | 4 | 2 | 7 | 13 |
| Blend modes | 21 | 3 | 2 | 6 | 13 |
| Time remapping | 4 | 1 | 4 | 4 | 4 |
| Text layers | 1 | 2 | 2 | 2 | 4 |
| Repeater | 0 | 0 | 1 | 0 | 1 |

### By search term

Medians, with 10th and 90th percentile where the spread matters.

| Term | Path shapes | Colours | Keyframes per second | Duration, seconds | Files with a morph |
|---|---|---|---|---|---|
| `character` | 9 / 44 / 138 | 12 | 33 | 2.3 | 77% |
| `illustration` | 2 / 77 / 420 | 8 | 27 | 5.4 | 57% |
| `city` | 18 / 148 / 710 | 14 | 8.6 | 7.7 | 17% |
| `landscape` | 4 / 51 / 322 | 7 | 12 | 6 | 50% |
| `isometric` | 10 / 36 / 207 | 2 | 25 | 2 | 80% |
| `walk-cycle` | 10 / 31 / 112 | 8 | 81 | 1.3 | not recorded |

### What the wider sample changes

- **The first page was richer than the average.** It was close to the featured group. Across everything, the median file has 33 paths, 6 colours and 20 keyframes per second. The popular group, which is what people download most, is simpler still: 13 paths, 4 colours, 3 seconds, 512 pixels. A clean, small, well-timed icon is a large part of what "this quality" means.
- **Mattes and gradients are features of the richer work.** Mattes are in 26% of all files, but 46% of featured and 41% of the complex tier. Gradient fills are in 21% of all files, but 42% of featured and 38% of the complex tier. Trim paths go the other way: 44% of popular files, because line icons use them.
- **30 fps is as common as 60.** 194 files against 151. The first page's lean toward 60 did not hold.
- **Complex scenes are complex in artwork, not in motion.** The complex tier has about six times the paths of the median file (209 against 33) and three times the colours (17 against 6), but nearly the same keyframes per second (25 against 20) and the same eased share. City scenes are the extreme: 148 paths and under 9 keyframes per second. A big scene is a detailed drawing with a few things moving well.
- **Characters are where motion is dense.** `character` has 33 keyframes per second and a morph in 77% of files. `walk-cycle` has 81 keyframes per second in loops of about 1.3 seconds.
- **Even complex files stay small.** The complex tier's median archive is 30 kB.

## Gertie's corpus, measured the same way

The 17 compiled files in `examples/out/` on the same date. The larger scenes (`robot-walk`, `robot-wave`, `rocket-launch`) had no compiled output there and are not included.

| Measure | All 415, median | Complex tier, median | Gertie corpus median | Gertie corpus maximum |
|---|---|---|---|---|
| Canvas, longer side | 800 | 1080 | 256 | 512 |
| Frame rate | 30 | 30 | 30 | 30 |
| Duration, seconds | 4 | 6 | 2 | 4.4 |
| Layers | 18 | 40 | 2 | 7 |
| Path shapes | 33 | 209 | 0 | 2 |
| Path vertices | 192 | 1580 | 0 | 16 |
| Distinct solid colours | 6 | 17 | 2 | 6 |
| Animated properties | 20 | 37 | 2 | 16 |
| Keyframes | 65 | 149 | 4 | 92 |
| Distinct easing curves | 3 | 5 | 1 | 14 |
| Files with a gradient fill | 21% | 38% | 6% | |
| Files with a matte | 26% | 41% | 0% | |
| Files with a mask | 12% | 23% | 6% | |
| Files with a path morph | 47% | 51% | 6% | |
| Files with parenting | 56% | 74% | 0% as Lottie parenting | |

The corpus was written to test the compiler one feature at a time, so small files are expected. The table still shows the size of the step from "a feature works" to "an animation looks finished".

## What the numbers say

1. **The gap is mostly artwork.** A typical reference file is an illustration of 30 to 50 hand-drawn paths in about six colours, and a full scene has around 200 paths in 17 colours. Gertie's examples are one to seven primitives. No amount of easing makes three circles look like a mascot. This is the first thing to fix, and it is mainly a matter of what the agent is taught to draw and what the linter asks for, not of new compiler features.
2. **Motion is dense and continuous.** A reference file has 20 to 40 keyframes for each second, and on the first page a typical animated property has 13 keyframes about 150 milliseconds apart. Things keep moving a little after they arrive. Gertie's examples move from A to B and stop.
3. **Easing is strong, and overshoot is drawn by hand.** Three quarters of segments are eased, mostly with pronounced ease in and out. Overshoot comes from an extra keyframe, not from a curve that leaves the 0 to 1 range. Gertie's default `easeInOut` (0.65, 0, 0.35, 1) is already close to the most common curve.
4. **Starts are offset.** In the median file, 25% to 38% of animated properties begin on a frame of their own. This matches the "offset, do not synchronize" principle in `09-motion-presets-and-rigs.md`.
5. **Three structural features matter and three do not.** Across the wider sample, parenting (56% of files, 74% of complex ones), path morphing (47%) and mattes (26%, 41% of complex ones) are common. Curved motion paths (2% of position keys on the first page), text layers (2%) and expressions (8%) are rare. The list of omissions in `03-scene-spec.md` should be reordered to match: mattes move up, motion along a path moves down.
6. **Output is authored large.** 800 to 1080 pixels on the longer side, against 256 here. Frame rate is split between 30 and 60 fps, so Gertie's default of 30 is not a gap. For Lottie and SVG the canvas size hardly matters because they are vectors. For GIF and video it decides the quality directly.
7. **Files stay small anyway.** The median archive is 12 kB, and 30 kB for complex scenes. Quality at this level does not require heavy files.
