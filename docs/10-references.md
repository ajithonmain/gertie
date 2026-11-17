# Working from references

Users often supply something to work from: a logo, an illustration, an existing animation, a video whose motion they like. This document says what Gertie does with each kind and how.

The guiding fact: language models draw simple shapes well and detailed artwork poorly. Results are far better when the artwork comes from the user and the model only decides how it moves.

## What works with what

| Reference | Supported | Method | Result |
|---|---|---|---|
| SVG file | Yes | Import | Exact artwork, animated |
| Lottie JSON or `.lottie` | Yes, limited editing | Inspect and wrap | Original kept; recolour, retime, combine |
| Flat image: logo, icon, flat illustration | Yes | Trace to vectors | Good; small loss of detail |
| Painterly or textured illustration | Yes | Cutout | Artwork kept exactly; only subtle motion |
| Photograph | Only as a moving picture | Image node | The photo can slide, scale and fade |
| GIF or video, as a motion reference | Partly | Frame study | Similar timing and feel, not a copy |
| Hand sketch | Partly | The agent redraws it | Likeness varies |
| 3D render | No | | Lottie is two-dimensional |
| After Effects or Rive project | No | | Closed formats |

A model with vision is needed for every row except SVG and Lottie.

## SVG import

`gertie import artwork.svg --out fragment.json` converts an SVG into scene nodes.

### What the importer does

1. Parse the SVG. A small purpose-written XML parser is enough; SVG from design tools is well-formed.
2. Read the `viewBox` and set the canvas size.
3. Walk the element tree. `<g>` becomes a group. `<path>`, `<rect>`, `<circle>`, `<ellipse>`, `<line>`, `<polyline>`, `<polygon>` become shape nodes.
4. Resolve styles from presentation attributes, `style` attributes and simple `<style>` rules (class and id selectors only).
5. Flatten each element's `transform` attribute into its geometry, so that all coordinates are in canvas space and node transforms start at identity. This makes pivots easy to reason about.
6. Convert `<linearGradient>` and `<radialGradient>` to scene gradients. Convert `<clipPath>` to `clip`.
7. Give every node an id. Use the element's own `id` if it has one, otherwise the nearest Figma or Illustrator layer name, otherwise a generated name such as `path-7`.
8. Report anything it could not convert: filters, masks, patterns, text, embedded scripts. Text should be converted to outlines in the design tool first.

### What the importer reports

The agent needs to understand the artwork before animating it. The import command prints a summary:

```json
{
  "canvas": { "w": 400, "h": 400 },
  "nodes": [
    { "id": "body", "type": "path", "bbox": [120, 150, 160, 200], "fill": "#e8590c", "children": 0 },
    { "id": "arm-left", "type": "group", "bbox": [90, 180, 50, 120], "children": 3 }
  ],
  "unsupported": [ { "element": "filter", "id": "shadow", "note": "Drop shadow removed" } ]
}
```

It also renders a labelled preview: the artwork with each top-level node outlined and its id written beside it. A vision model looks at this to learn which id is which part.

### Animating imported artwork

The agent then writes a scene that includes the fragment and adds `pivot`, `animate` and `motion` to the nodes it wants to move. A scene can include a fragment by reference so the artwork is not copied into the scene file:

```json
{ "id": "character", "type": "group", "include": "fragment.json",
  "overrides": {
    "arm-left": { "pivot": [135, 190], "animate": { "rotation": { "keys": [[0, -10], [0.6, 20], [1.2, -10]], "repeat": "loop" } } }
  } }
```

`include` and `overrides` are resolved before anything else, by `resolveIncludes` (see `03-scene-spec.md`).

The quality of the result depends on how the SVG is layered. If an arm is a separate group, it can swing. If the whole character is one merged path, nothing can move independently. The summary makes this visible, and `SKILL.md` tells the agent to say so to the user and ask for a layered file when needed.

### Implementation notes (phase 6, step 1)

Built in `src/import/`: `xml.ts` (parser), `matrix.ts`, `style.ts` (colours, cascade), `svg.ts` (the converter), `summary.ts` (summary and preview labels), `include.ts` (`include` and `overrides`). The command is `gertie import <file.svg> [--out fragment.json] [--preview preview.png] [--no-preview] [--json]`. Where the build settled things the design left open:

- **Fragment format.** `{ "gertie-fragment": 1, "source", "canvas", "nodes" }`. Ordinary scene nodes in canvas pixels. No separate palette or defs: `<use>` is copied out, gradients are written onto each node.
- **Rect and ellipse survive.** An axis-aligned rect or ellipse (translate and scale only) stays a `rect` or `ellipse` node, so an agent can still animate `w`, `h` and `r`. Anything else is a `path`. A `rect` with different `rx` and `ry` takes the smaller radius.
- **Gradients.** Linear and radial, with `href` inheritance, `gradientTransform`, both unit systems and stop opacity. Written in the node's own coordinates (relative to its centre for rect and ellipse nodes). A scene gradient is circular, so an elliptical SVG radial gradient is imported as a circle and reported. A gradient stroke becomes its middle colour.
- **Clips and masks.** `clip-path` shapes are concatenated into one path clip. A `<mask>` whose content is opaque white shapes is converted to a clip (this is what Sketch emits for rounded or cropped shapes); any other mask is removed and reported.
- **Ids.** `id`, then `inkscape:label`, then `data-name`, then a generated `kind-N`; lowercased, Illustrator `_x31_` escapes decoded, made unique. A `<use>` with an id gives that id to the node it instantiates.
- **Groups are kept** even when they have no id, because an anonymous Illustrator group is often exactly the part that should move. Empty groups are dropped. A node with neither fill nor stroke is dropped.
- **Summary.** All groups plus the largest shapes, at most 80 entries, with `advice` sentences about layering (flat, one shape, layered). The fragment file always has everything.
- **Preview.** The artwork with an outline and id for each node at the first level that splits into parts (it looks through single-child wrapper groups), groups first, then large shapes, at most 24 labels. Rendered at 2x when the canvas is under 800 pixels.
- **Not done:** text, filters, patterns, images, `<symbol>` viewBoxes, `clipPathUnits="objectBoundingBox"`, `spreadMethod` other than pad, dash offsets, CSS selectors beyond tag, class and id (each is reported).
- **Acceptance so far.** See `14-build-plan.md`.

## Lottie as a reference

A supplied Lottie file was made by another tool and may use any feature. Gertie does not try to convert it back into a scene.

- `gertie validate file.json` reports whether it is valid and which features fall outside the portable subset.
- `gertie render file.json` produces a contact sheet so the agent can see it.
- `gertie inspect file.json` lists layers, colours used, duration and frame rate.
- `gertie recolor file.json --map "#ff0000=#3b82f6"` replaces colours throughout.
- `gertie retime file.json --speed 1.5` or `--duration 2` rescales all keyframe times.
- A scene can place a Lottie file as a node of type `lottie` with `src`, `x`, `y`, `scale`. In the Lottie output it becomes a precomposition. In the SVG output it is not supported and produces an error.

These are edits on the Lottie JSON directly, which is the one exception to the rule that Lottie is only ever produced by the compiler. Each edit is followed by validation and a render.

### Implementation notes (phase 6, step 2)

Built in `src/lottie-tools/` (all pure): `inspect.ts`, `colors.ts` (find, list and replace colours), `time.ts` (`mapTimes`, `retimeLottie`), `embed.ts` (placing a file in a scene), `compare.ts` (`introduced`). Commands: `inspect`, `recolor`, `retime`, `render`, plus the existing `validate`. Where the build settled things the design left open:

- **"Still validates" means "adds nothing".** Real After Effects exports are not portable: the three third-party files used for acceptance (`ripple`, `starfish`, `lights`, shipped in the MIT `lottie-web` package) have 11 to 29 validation errors before any edit (an omitted final keyframe value, expressions, effects, time remapping, layers ending after the animation). So each edit is compared with its input: `introduced(before, after)` matches diagnostics by code and location, and an edit is correct when it adds none. The commands report `validation.introduced`.
- **Recolor.** Finds fills, strokes, gradient stops (fill and stroke), animated colours (both `s` and the old `e` arrays) and solid-layer `sc` strings. Matches on the 0 to 255 value of each channel, exactly or within `--tolerance`. Alpha is kept. Not covered: effect colours, text colours, colours computed by expressions. A recolor changes only colour numbers (a unit test compares the documents with all colours blanked).
- **Retime.** Rescales about the in point: layer `ip`, `op` and `st`, every keyframe `t` (including precompositions, time remap, shape and gradient keyframes) and marker times. Frame rate is kept. A layer boundary equal to the old animation boundary becomes the new one, so a layer that ended with the animation still does; the animation end is rounded up. Expressions that read time are not changed and are reported.
- **After an edit** the file is drawn in lottie-web and the command fails if every sampled frame is blank or the player writes to the console. `--no-render` skips this.
- **The `lottie` node.** The file is rescaled to the scene's frame rate and shifted so its in point is time zero, its assets are copied with ids prefixed by the node id, and its layers become one precomposition. Gertie pads its own precompositions by a margin, so an embedded file's layer is built without that compensation; a first version that used the margin drew nothing. A precomposition asset may not carry `w` and `h` in the schema, only the layer does. A scene with a `lottie` node produces no SVG; `E-SVG-LOTTIE` only when it was asked for. The placed file must itself pass the portable subset, so a third-party file with expressions or effects is reported as `E-L-SUBSET` when placed, not silently accepted.
- **Not done:** `.lottie` archives as input (unzip first), recolouring effects and text, fonts and glyphs of a placed file, an `--only-layer` option, merging two files.

### Implementation notes (phase 6, step 3)

Commands: `gertie trace <image> [--colors n] [--speckle n] [--drop #fff,...] [--seam n] [--detail n] [--out] [--keep-svg] [--no-preview]` and `gertie group <fragment> <groups.json> [--out]`. Built in `src/trace/` (`quantize.ts`, `regions.ts`, `contour.ts`, `fit.ts`, `trace.ts`, `group.ts`), all pure, plus `src/render/image.ts` to decode PNG, JPEG, GIF and WebP through the browser that already renders animations. A traced image goes through the same pipeline as an imported SVG (`finishImport`), so it gets the same fragment, summary and labelled preview.

- **VTracer was not used.** Its licence was checked (crates.io lists `MIT OR Apache-2.0`, current release `1.0.0-alpha.4`), but installing it (`cargo install`) was refused by the permission system in this session, and its command-line options could not be checked without running it. Integration code that could not be run would have been unverified, so Gertie has its own tracer instead, in pure TypeScript with no dependency. If VTracer is wanted later, it can be added as an alternative behind a `--tracer` flag; the output is plain SVG and goes through the same importer.
- **Method.** k-means palette (seeded, so output is repeatable) of up to 16 colours, a 3 by 3 mode filter that removes anti-aliasing lines, connected regions, small regions merged into the neighbour they share most border with, then for each region an outline by marching squares on a lightly blurred mask, smoothed (corners held), simplified (Douglas-Peucker) and fitted with lines and cubic curves. Regions are drawn **stacked**, largest first by the area inside their outer outline (so a ring is drawn before the disk it holds), and a hole is kept only where it shows the transparent background; otherwise the region above covers it.
- **Edges.** A region that reaches the image edge is traced past it and cut at the edge, so it is square to the edge with square corners. Same-colour outlines of 0.6 px (`--seam`) close the hairline between neighbouring regions.
- **Fidelity.** Drawn and compared with the source bitmap (24 levels per channel): the logo and a flat illustration differ in 0.05 to 0.07 percent of pixels; a gradient illustration (bands of flat colour) in 0.04 percent; the two real third-party illustrations drawn to bitmaps differ in 2.2 percent (W3C, fine detail) and 0.4 percent (Pinegrow). A 1000 by 774 illustration traces in about 0.2 seconds.
- **Grouping.** `groupNodes` puts a group where its first member was and keeps members in original order. It does not reorder what is between members, which can change the stacking of a non-member sitting between two members; the documentation says so.
- **Not done:** VTracer; layered (cut-out) colour mode; gradient recovery; text; `--tracer`.

### Implementation notes (phase 6, step 4)

Command: `gertie study <clip> [--fps 8] [--cols 8] [--cell 192] [--max-seconds 20] [--background median|border] [--out file-or-folder] [--json]`. Built in `src/study/analyze.ts` (pure) and the command in `src/cli/lib/commands.ts`; it needs ffmpeg and ffprobe, which are detected and reported.

- **The design said** to make a contact sheet with `ffmpeg ... tile`. The sheet is drawn by the renderer instead (the same one as `qa`), because it needs no font support in ffmpeg and gives labelled frames. Frames are extracted at up to 30 per second (the contact sheet takes every n-th), because 8 per second is too coarse to read timing from.
- **Measurements, which the design did not have.** For each frame the moving subject is found as what differs from the background, where the background is the per-pixel median over time (so a floor or a wall that never moves is background); `--background border` uses the edge colour instead. Its centre, width and height give four channels. `analyzeMotion` finds, per channel, stretches between turning points with when they start and end, how far they go (as fractions of the frame), and a speed profile read as `starts slow`, `starts fast`, `slow at both ends` or `even`; plus holds (at least 0.15 s without movement) and `loopGap` between the first and last frames.
- **Limits.** One silhouette: two subjects moving apart are measured as one; a camera move or scrolling background defeats the background estimate; shapes and bending are not seen. The documentation tells the agent to read the contact sheet for those.
- **Accuracy.** On a clip made from a scene with known keyframes, hold and move times match the keyframes to within 0.1 s (tests) and an agent reproduced the clip's timing to within one frame at 30 fps.

### Implementation notes (phase 6, step 5)

Command: `gertie cutout <image> <parts.json> [--out folder] [--json]`. Built in `src/cutout/` (`png.ts` a lossless PNG encoder, `raster.ts` polygon coverage with anti-aliasing, grow and shrink, fill, edge padding; `build.ts` the layer builder and the parts file check).

- **Parts file.** `parts` from back to front, each with `id`, `polygon` and an optional `pivot`; `lids` for vector eyelids; `bleed`, `grow`, `inset`. Points are image pixels. Errors are listed with what to fix (`E-CUTOUT`).
- **Layers.** The background is the whole picture with every part's area filled in, padded by `bleed` pixels of repeated edge. Each part is the pixels inside its outline (alpha from an anti-aliased, one-pixel-softened mask), with the area behind the parts in front of it filled from its own pixels, so a part can move without showing a copy of what was in front of it. The area filled is the part's outline grown by `grow` pixels, which removes the fringe of old background colour at an edge; `inset` pulls a part's edge in.
- **The fill.** Ring by ring from the edge of the hole, then relaxed towards a smooth surface (in-place averaging of neighbours), then grain of the same strength as the pixels beside it is added back. This is cheap edge extension, as the design allowed, not a reconstruction: it is for small movements. LaMa was not used.
- **Blink.** A lid is an image cut from a patch of the picture's own skin (`sample` is the centre of a patch the size of the lid, `tone` optionally recolours it to a skin point), with a soft elliptical edge and its pivot at the top; the new preset `lid-blink` (scale y 0, then 1, then 0) makes it close and lift and keeps it flat at rest. The first version used a flat colour; an agent test showed that a flat lid reads as a patch, so the patch is the default and `flat: true` keeps the old behaviour.
- **Edges.** The picture is padded by `bleed` pixels by **mirroring** (a first version repeated the edge pixels and an agent found smeared streaks at the drift extremes), and the whole pipeline runs on the padded picture, so a part whose outline runs past the edge (up to `bleed` plus 8 pixels) has real pixels there instead of showing a strip of background when it moves.
- **Seeing what was cut.** `cutout` writes `outlines.png` (polygons, pivots, lid patches drawn on the picture). `gertie grid` draws a labelled grid for reading coordinates, and `gertie render --times` draws full-size frames at chosen times, because the contact sheet's few evenly spaced frames miss a blink and the extreme of a tilt.
- **Includes with images.** A fragment's `src` paths are relative to the fragment file; `resolveIncludes` rewrites them relative to the scene, and the CLI collects image files after includes are resolved, so a scene can include a cutout from another folder.
- **Check at rest.** `cutout` draws the layers back together and reports how much they differ from the picture (0.9 percent on the test painting) and writes `rest.png`.
- **Result on the test painting** (synthetic: gradients, brush strokes and grain): at twice the motion of the example (a 6 degree tilt, a 26 pixel drift each way, the face sliding 70 pixels, a blink) no frame has a transparent pixel, and the place a part left holds hair, not a copy of the face.
- **Known artefacts.** The fill behind a part is smooth and grainy, not detailed; a lid is a flat patch of skin colour; a small notch can appear where a part's outline did not follow the painted edge. A 640 by 480 cutout scene is about 1 MB of embedded images.
- **Not done:** model-assisted segmentation (step 6, see the build plan), feathered lids, per-part `inset`, a `.lottie` export that compresses the images by default.


## Tracing a flat image

For logos, icons and flat illustrations supplied as PNG or JPEG.

### Method

1. Trace the image to SVG with VTracer, which handles colour images and is MIT licensed. It is a separate program the user installs (`cargo install vtracer` or a release binary); Gertie calls it if present and explains how to get it if not.
2. Import the resulting SVG as above.
3. A traced image is a flat list of colour regions with no meaningful names or grouping. The agent looks at the labelled preview and groups regions into parts by writing a small grouping file: which region ids belong to "head", which to "arm".
4. Animate as with any imported SVG.

Verify during build: VTracer's licence, current install method and command-line options. Compare its output with potrace (which is GPL and limited to two colours) only as a quality reference; do not depend on potrace.

### Limits

- Gradients and soft shading become bands of flat colour.
- Texture and grain are lost or become hundreds of tiny shapes. Use the `--filter-speckle` option to drop them.
- Parts that touch in the image are not separated. A hand resting on a table traces as regions that the agent must assign to one or the other.
- Tracing suits images like a clean flat illustration with clear shapes. It does not suit painterly artwork; use the cutout method for that.

## Cutout animation for painterly artwork

Some artwork gets its quality from texture: brush strokes, grain, soft shading. Tracing destroys that. The cutout method keeps the pixels and animates pieces of the image, like a paper puppet.

### What it can do

Blink, eye direction, head tilt, breathing, hair sway, a hand lifting slightly, background parallax, drifting leaves, a ticking clock. Small motions of parts that already exist in the picture.

### What it cannot do

Walking, turning, new facial expressions, a new pose. There is only one drawing, and nothing can show what is not in it. `SKILL.md` must tell the agent to explain this and suggest AI video generation for those requests.

### Method

1. **Plan the parts.** The agent looks at the image and lists the parts worth moving, back to front: background, body, head, hair, eyes.
2. **Segment.** For each part, produce a mask. Segment Anything (Apache-2.0) does this from a point or a box that the agent chooses by looking at the image. It is a large model that runs locally through Python.
3. **Cut.** Each part becomes its own PNG with transparency, cropped to its bounding box.
4. **Fill the holes.** When the head moves, what was behind it shows. The layer underneath needs those pixels filled. An inpainting model such as LaMa (Apache-2.0) does this. A cheaper alternative that works for small motions: extend the part's edge pixels outward by a few pixels and keep the motion within that margin.
5. **Assemble.** The agent writes a scene with one `image` node per part, in back-to-front order, with pivots at natural joints (the neck for the head).
6. **Animate.** Small rotations and translations with gentle easing, usually looping.

### Blink without redrawing

A blink needs closed eyes, which the picture does not contain. The standard trick: draw an eyelid as a vector shape in the surrounding skin colour (sampled from the image), and animate its `scale` in Y from 0 to 1 and back over about 0.3 seconds, closing faster than it lifts. This mixes a vector node into the cutout scene and works well at small sizes.

### Output

A cutout scene contains images, so:

- The Lottie file embeds PNG data and is typically 300 KB to 2 MB. Export as `.lottie` to compress it.
- The SVG output embeds the same images.
- Raster and video export work as usual.
- The result does not scale beyond the source image resolution.

### Dependencies and packaging

Segmentation and inpainting need Python, PyTorch and model weights of one to two gigabytes. This is far heavier than the rest of Gertie.

**Decision: the cutout engine is an optional add-on.** It lives in `skills/gertie/extras/cutout/` with its own setup script and is installed only when the user asks for cutout animation. The core skill never requires Python.

Verify during build, before starting this phase:

- Current licences of the Segment Anything code and each set of weights, and of LaMa. Model weights sometimes carry different terms from the code.
- Whether a lighter segmentation path is good enough: a background-removal model for the main subject plus agent-drawn polygon masks for the parts. Agent-drawn polygons need no model at all and may be sufficient for simple pictures. Try this first.
- Running time on a laptop without a dedicated GPU.

Build the manual-polygon version first. It establishes the whole pipeline with no heavy dependency. Add model-based segmentation only if the manual version's quality is the limiting factor.

## Video or GIF as a motion reference

The user shows an animation and says "make it move like this".

1. Extract frames with ffmpeg at a low rate, for example 8 frames per second, into a contact sheet: `ffmpeg -i ref.mp4 -vf "fps=8,scale=256:-1,tile=8x4" sheet.png`.
2. The agent studies the sheet and describes the motion in words: what moves, how far, how long each phase takes, where it eases, whether it overshoots.
3. The agent writes a scene that reproduces that motion with its own shapes or the user's artwork.

This is an approximation by eye. It captures timing and character, not exact paths. Say so to the user.

### Small motion: design for phase 5b

Built; see "Implementation notes (phase 5b, task 5)" below for what was found and what differs. The `study` command treats any change under about 0.03 of the frame as noise. That is right for a full-frame clip, and it also hides the motion that makes a subject feel alive: a breath, a float or a jiggle is 1 to 5 percent of the subject's own size, and less of the frame. The rossark-motion-skill makes the same point and measures edges of a cropped subject at the source frame rate. Three additions bring that to `study`, all in `src/study/analyze.ts` with the ffmpeg call staying in `src/cli`:

1. **`--crop x,y,w,h`** in pixels of the source. Frames are cropped by ffmpeg (`crop=w:h:x:y`) before analysis, so every fraction in the output is of the crop, and the contact sheet shows the crop. Reject a crop outside the frame with `E-USAGE`. The agent gets the numbers from `gertie grid` on one extracted frame.
2. **`--rate source`** analyses at the clip's own frame rate (capped at 60) instead of the default analysis rate. The contact sheet keeps `--fps`. **Verify during build:** what the current analysis rate is and whether memory holds at 60 fps for 20 seconds with the default cell size. **Found:** the rate was the source rate capped at 30; memory holds (peak resident set 427 MB for 20 s at 60 fps, 280 by 280 crop). Details in the task 5 notes below.
3. **An `idle` list in the output.** For each channel (`x`, `y`, `width`, `height`), over every span that `holds` reports and over the whole clip when there are no `moves`: if the value crosses its own mean at least four times and its peak-to-peak size is between 0.004 and 0.03, report `{ "channel", "start", "end", "amplitude", "period" }`, where `amplitude` is half the peak-to-peak size and `period` is twice the mean time between crossings. Below 0.004 it is noise from the silhouette's edge. **Verify during build:** tune both thresholds on a synthetic clip made with Gertie itself (a circle with `breathe`, exported to mp4), which gives a known answer; add it as the unit test. **Found:** both thresholds were kept; on the breathe clip `height`, `width` and `y` report periods of 3.00, 3.01 and 3.00 s for a 3 s preset. Crossing counting and span choice had to change, and a regularity test was added. Details in the task 5 notes below.

`references/motion-reference.md` then tells the agent: study the whole clip first, crop to the subject and study again at `--rate source`, and turn each `idle` entry into a looping preset with that period and amplitude (`y` is `float`, `width` and `height` together are `breathe` or `jiggle`).

A separate small command, **`gertie sample <image-or-clip> --at x,y [--at x,y ...] [--time seconds]`**, prints the colour at each point as hex (the mean of a 3 by 3 block, to step over antialiasing), so colours are read from pixels and not guessed. One ffmpeg call extracts the frame as raw RGB; no new dependency.

### Implementation notes (phase 5b, task 5)

- **`--crop x,y,w,h`.** Four whole numbers in source pixels. ffmpeg applies `crop=w:h:x:y` first, so the analysis frames, the contact sheet and every fraction in the output are of the crop; `analysis.crop` in the JSON repeats it. A crop with a negative origin, a side under 8 pixels, a non-integer, the wrong number of parts, or extending past the frame is `E-USAGE`, and the message gives the frame size and points to `gertie grid`.
- **`--rate source`.** The only accepted value; anything else is `E-USAGE`. **Found: the analysis rate was** the source rate rounded and capped at 30, and never below the sheet rate (`--fps`, 8 by default). Frames are scaled to at most 256 pixels wide (of the crop when there is one). `--rate source` uses the source rate rounded and capped at 60 and ignores the sheet rate; the sheet still picks every `afps / fps` frame. `analysis.rate` in the JSON says which. A clip with a fractional rate (29.97) is resampled to the rounded one by ffmpeg's `fps` filter.
- **Memory at 60 fps for 20 seconds: holds.** A 480 by 480 clip, 20 s at 60 fps (1200 frames), cropped to 280 by 280 and analysed with `--rate source`: peak resident set 427 MB (peak footprint 527 MB), 56 s wall time on an Apple silicon laptop, no failure. Every frame is held twice, as a PNG for the sheet and as decoded pixels for the analysis. The cap is `--max-seconds` (default 20, at most 120), so a 120 s clip at 60 fps would not fit in memory this way; this was not tried.
- **`idle`.** `findIdle` in `src/study/analyze.ts` is a pure function and `analyzeMotion` returns it as `idle`. Constants: `IDLE_MIN` 0.004 and `IDLE_MAX` 0.03 (peak to peak, as the design said), `IDLE_CROSSINGS` 4. Each entry is `{ channel, start, end, amplitude, period }`; `amplitude` is half the peak-to-peak size of the smoothed value.
- **Differs from the design: which spans.** The design measures over the spans `holds` reports. On a breathing clip `holds` is useless for this, because the per-frame stillness test fails for a pixel or two now and then and the clip comes out as five holds (0.2 to 2.7 s) with gaps between them, none long enough to cross its middle four times. Instead each channel is measured over the stretches outside that channel's own `moves` (the whole clip when there are none). This includes every hold, so it is a superset of the design's spans.
- **Differs from the design: how crossings are counted.** The design says to count crossings of the mean and take twice the mean time between them. Measured on pixel-rounded data this was wrong in two ways, both fixed. (1) The series is smoothed twice (as `moves` already does) and the middle is the middle of the range, with a dead band of 15 percent of the swing, because a value resting on the edge of two pixel levels flipped back and forth and produced extra crossings (a height swing was missed entirely). (2) The period is the mean time between crossings in the same direction (whole cycles), not twice the mean half-cycle: a value rounded to three or four pixel levels spends unequal time above and below its middle, which skewed the half-cycle estimate to 3.29 s for a 3 s breath (9.7 percent off, too near the 10 percent limit). Whole cycles gave 3.00 s.
- **Added to the design: a regularity test.** The cycle lengths must vary by less than 35 percent of their mean (`IDLE_REGULARITY`). Without it a random one-to-two pixel flicker of the silhouette's edge, which is above 0.004 on a clip that was compressed, would be reported with a meaningless period. A unit test uses such a flicker.
- **Thresholds, tuned on clips made with Gertie** (a circle of 140 pixels with `breathe` and `repeat: "loop"`, 9 s, exported with `export --to mp4`, cropped 100,100,280,280 with `--background border`): the thresholds were kept as designed. With the default `amount` 0.03 the clip reports `height` (amplitude 0.010, period 3.00 s), `width` (0.008, 3.01 s) and `y` (0.005, 3.00 s), all within 1 percent of the 3 s preset. A sweep of `amount`: at 0.005 and 0.01 `width` and `y` are found and `height` is not (its swing is under 0.008 and too rounded); at 0.02 all three; at 0.05 and 0.1 `width` and `height` become `moves` (0.031 and above), which is the upper threshold working, and `y` stays an idle. A clip of the same circle with no motion, and one that slides in and then holds for 8 seconds, report no `idle`. At 60 fps and 2 s (`duration: 2`) the periods are 2.00, 2.00 and 2.00 s.
- **`--background median` does not suit idle studies.** The default background is what stays put, and a breathing subject mostly stays put, so only a ring of edge pixels is left and the centre jitters by 0.03 of the crop. On the same clip it reports spurious `moves` and no idle, and on a clip with no motion it finds no subject at all. `references/motion-reference.md` tells the agent to use `--background border` for a cropped idle study. Not changed in the code.
- **Limits.** A clip of 2 s or less cannot give four crossings of a 1 s cycle with any confidence and gets no `idle`; a swing in a channel can be missed while another channel of the same motion is found (see the sweep). An idle that starts partway through a clip is reported over the whole span outside moves, with the start and end of that span, not of the swing.
- **`gertie sample`.** `sampleColours` and `parsePoint` in `src/study/sample.ts` are pure; the ffmpeg call is in `src/cli/lib/commands.ts`. One ffmpeg call writes the frame as raw pixels. **Differs from the design:** the pixels are RGBA, not RGB, so a transparent pixel is not mistaken for black; each sample has `alpha` (0 to 1) only when the block is not opaque. The block is 3 by 3, clipped at the edges of the frame. `--at` may repeat (the argument parser now keeps every value of a flag in `Args.all`); `--time` seeks a clip and is an error beyond its end. A point outside the frame, a bad point, no points, or a missing ffmpeg is `E-USAGE`. No new dependency.
- **Tests.** `tests/unit/study.test.ts` has pure tests of `findIdle` (a swing, pixel rounding, both thresholds, the random flicker, idle outside moves) and of `sampleColours` and `parsePoint`, and three tests that export `tests/fixtures/study/breathe-circle.gertie.json` and `slide-then-hold.gertie.json` with Gertie and run `study` and `sample` on the clips. Those three are skipped when ffmpeg or a browser is missing and take about two minutes together.
- **Not verified.** Real footage: all tuning used synthetic clips of one shape on a flat background. A clip with video noise, shadows or a moving camera has not been tried, and the 0.004 floor may be too low for noisy footage.

## Rights

A reference is someone's work. `SKILL.md` includes this guidance for the agent:

- Using a reference for style, timing or inspiration is normal practice.
- Animating artwork the user owns or has licensed is fine.
- If the artwork clearly belongs to someone else (a watermark, a known character, a brand logo that is not the user's), mention once that the user needs the right to use it, then proceed with what they asked. Do not refuse and do not lecture.
- Gertie itself never downloads artwork or animations from libraries or marketplaces.
