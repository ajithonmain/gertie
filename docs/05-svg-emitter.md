# The SVG emitter

The SVG emitter turns a normalized scene into one self-contained SVG file that animates by itself. It needs no JavaScript and no player. It works when the file is opened directly, used in an `<img>` tag, used as a CSS background, or embedded in a GitHub README.

Read this together with `research_notes/Free Lottie animation agent skill/animated_svg_export.md`.

## Why a second emitter instead of a converter

The free tools that convert Lottie to animated SVG are weak: one is GPL and has no macOS build, one is unmaintained with basic feature support, and the popular npm package produces a single static frame. Emitting SVG directly from the scene avoids all of them.

## What survives inside an image

When an SVG is used as an image, browsers disable scripts and block external resources. Two animation mechanisms still work:

- **CSS animations** defined in a `<style>` element inside the SVG.
- **SMIL** elements such as `<animate>`.

So the emitter uses only those two. It never emits `<script>`, never references external files, fonts or stylesheets, and embeds images as data URIs.

**Verified in phase 3:** CSS animation inside an SVG plays when the SVG is used in an `<img>` tag in Chromium (Chrome 157) and WebKit (Playwright's WebKit 27.2). A browser test loads every corpus SVG in an `<img>`, takes screenshots 400 milliseconds apart and requires them to differ. **Not verified in Firefox:** Playwright's Firefox (build 1572) would not start on the development machine, with or without the sandbox (`Could not find profile folder`), so the same test has not run there. The test is ready: `GERTIE_BROWSERS=firefox npm run test:browser`. Until it has run, do not state in `SKILL.md` that the SVG animates in an `<img>` in Firefox.

## Which mechanism for which property

| Property | Mechanism | Reason |
|---|---|---|
| `x`, `y`, `rotation`, `scale` | CSS `transform` | Widest support, bezier easing with overshoot |
| `opacity` | CSS `opacity` | |
| `fill`, `stroke.color` | CSS `fill`, `stroke` | |
| `stroke.width` | CSS `stroke-width` | |
| `trim.*` | CSS `stroke-dasharray`, `stroke-dashoffset` | |
| `d` (morph) | SMIL `<animate attributeName="d">` | CSS `d` has no effect in Safari |
| `w`, `h`, `radius`, `rx`, `ry` | SMIL `<animate>` on the attribute | CSS geometry properties are not consistent |
| `fill.from`, `fill.to` | SMIL `<animate>` on `x1`, `y1`, `x2`, `y2` of the `<linearGradient>` | CSS cannot animate gradient attributes |
| `fill.center`, `fill.radius` | SMIL `<animate>` on `cx`, `cy`, `r` of the `<radialGradient>` | Same |

## Document skeleton

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <style>
    /* keyframes and rules */
  </style>
  <defs>
    <!-- gradients, clip paths, reusable nodes -->
  </defs>
  <!-- scene nodes in painter's order -->
</svg>
```

- `viewBox` always starts at `0 0`.
- If the scene has a background colour, emit a full-size `<rect>` first.
- Every id and class name is prefixed with a short token derived from the scene name (for example `g7k-`). When several Gertie SVGs are inlined into one HTML page, unprefixed names would collide.

## Node structure

SVG draws later elements on top, which is the scene's own order. No reversal is needed.

Each node becomes a chain of nested `<g>` wrappers, one per transform channel, with the shape innermost:

```xml
<g class="g7k-arm-t">            <!-- translate: pivot + x, y -->
  <g class="g7k-arm-r">          <!-- rotate -->
    <g class="g7k-arm-s">        <!-- scale -->
      <g transform="translate(-120 -200)">   <!-- move pivot to origin -->
        <path class="g7k-arm" d="..." fill="#e8590c"/>
      </g>
    </g>
  </g>
</g>
```

This reproduces Lottie's transform order exactly: move the pivot to the origin, scale, rotate, translate to position.

Rules:

- Emit a wrapper only if that channel is non-default or animated. A node with no rotation and no rotation animation has no rotate wrapper.
- A static channel is written as a `transform` attribute. An animated channel gets a CSS animation on the wrapper and also a static `transform` attribute holding its poster value (see reduced motion below).
- All wrappers use `transform-origin: 0 0`. Because the translate wrapper has already moved the origin to the pivot, rotation and scale about `0 0` are rotation and scale about the pivot. Do not use `transform-box: fill-box`; the nested-wrapper approach does not need it and behaves identically in all browsers.
- When `x` and `y` are both animated with different keyframe times, use two translate wrappers, one with `translateX` and one with `translateY`. A single `transform` keyframe list cannot hold two independent timelines.
- Opacity goes on the innermost element for a shape, and on the outermost wrapper for a group.

Children of a group are emitted inside the group's innermost wrapper, so they inherit its transform and opacity, exactly as in the scene.

## Shapes

| Scene | SVG |
|---|---|
| `rect` | `<rect x="-w/2" y="-h/2" width="w" height="h" rx="radius"/>` |
| `ellipse` | `<ellipse cx="0" cy="0" rx="rx" ry="ry"/>` |
| `path` | `<path d="..."/>` rebuilt from the normalized segments |
| `image` | `<image href="data:..." width="w" height="h"/>` |
| `use` | `<use href="#prefix-name"/>` with the definition in `<defs>` |

Rebuild path strings from the normalized cubic segments instead of copying the user's original `d`. This guarantees that morph keyframes have identical command structure (every segment is a `C`).

Style attributes: `fill`, `fill-rule`, `stroke`, `stroke-width`, `stroke-linecap`, `stroke-linejoin`, `stroke-dasharray`. A shape with no fill gets `fill="none"`.

Gradients go in `<defs>` with `gradientUnits="userSpaceOnUse"` so their coordinates are in the node's own space, matching the scene.

**Animated gradient geometry.** The `<animate>` elements are children of the gradient element, after the stops, written by the same function as morphs (`smil` in `src/emit-svg/index.ts`), so the same rules apply: one `keySplines` entry per segment, overshoot easings and mixed hold and bezier segments are baked, and a loop that is off uses `repeatCount="1"` and `fill="freeze"`. A pair is split into its two attributes (`x1` and `y1`), and an axis whose value never changes gets no element. The static attributes hold the poster value. Because the gradient has its own id per node (and per instance, for an animated `use` definition), nothing is shared between nodes.

**Verified in phase 10 (`examples/gradient-sweep.gertie.json`):** the animated gradients play and match lottie-web frame for frame (parity worst case 0.13 percent of pixels, limit 2) in Chromium (Chrome 157), and in WebKit (Playwright's WebKit) the frames match the Chromium render, seeking is exact, the loop closes, and the animation plays when the SVG is loaded through an `<img>` (the sweep is the only motion in that example, so two screenshots differing proves the SMIL on the gradient runs there). **Not verified in Firefox:** the browser still does not start on the development machine (`Failed to launch the browser process`), so the same specs have not run there. Do not claim Firefox support for animated gradients until `GERTIE_BROWSERS=firefox npm run test:browser` has run.

**Mattes.** A node with `matte` is wrapped in `<g mask="url(#...)">`, outermost, in the coordinate space of its parent, which is the space its source is also in. The mask is written once in `<defs>`, with `maskUnits="userSpaceOnUse"` and a region one canvas side larger on every side (the same margin as a Lottie precomposition) so the default bounding-box region does not cut off animated content. It holds the source node, written by the ordinary node code, so the source keeps its wrappers, animation and time window. The source is not drawn at its own place.

- `alpha`: `mask-type="alpha"` and `style="mask-type:alpha"` (both are written).
- `alpha-inverted`: a luminance mask (the default type) holding a white rectangle and then the source in a `<g class="...__src">`. A style rule scoped to that class recolours the source: `fill:#000!important` on elements whose `fill` is not `none`, and `stroke:#000!important` on elements that have a `stroke`. `!important` beats the source's own fills and their CSS animations. Black over white gives luminance `1 - alpha`, which is the inverted alpha, including partly transparent sources. An `image` in the source, or a `use` of a shared definition, is not recoloured (a selector does not reach into a `use`, and an image has no fill), so build an inverted source from shapes.
- Several nodes with the same source and mode share one mask.

**Verified in phase 10:** before this was built, a hand-written SVG with a CSS-animated shape and with a SMIL-animated shape inside a `<mask>`, for the alpha type and for the inverted form, animated in Chromium (Chrome 157) and WebKit (Playwright's WebKit), inline and through an `<img>` (`17-quality-tuning.md`, experiment B). The two corpus examples `matte-shine` and `matte-reveal` match lottie-web on every frame (parity worst case 0.07 and 0.10 percent of pixels, limit 2). **Found by the parity check:** the first version of the inverted mask recoloured every filled element in the mask, including its own white rectangle, so the mask was black and the matted node vanished; the rule is now scoped to the source. **Not verified in Firefox**, which does not start on the development machine.

Clips: `<clipPath id="...">` in `<defs>` and `clip-path="url(#...)"` on the node's innermost wrapper.

## CSS keyframes

For each animated CSS property of each node, emit one `@keyframes` block and one rule.

```css
@keyframes g7k-dot1-ty {
  0%   { transform: translateY(256px); animation-timing-function: cubic-bezier(0.5,1,0.89,1); }
  25%  { transform: translateY(176px); animation-timing-function: cubic-bezier(0.11,0,0.5,0); }
  50%  { transform: translateY(256px); }
  100% { transform: translateY(256px); }
}
.g7k-dot1-ty { animation: g7k-dot1-ty 1.2s linear infinite both; }
```

Rules:

- The percentage is `frame / totalFrames * 100`, rounded to four decimals.
- **CSS, like Lottie, puts the easing on the keyframe where the segment starts.** The scene puts it on the keyframe where the segment ends. So the timing function on CSS keyframe `n` comes from scene keyframe `n + 1`. This is the same shift as in the Lottie emitter; share the code.
- The rule's own timing function is `linear`. Per-segment easing comes only from the keyframes.
- A hold segment uses `animation-timing-function: step-end` on its starting keyframe.
- CSS `cubic-bezier` allows the second and fourth numbers outside 0 to 1, so overshoot easings such as `easeOutBack` work directly.
- If `loop` is true the iteration count is `infinite`. If false it is `1` and the fill mode `both` keeps the final state.
- Normalization has already padded every property to cover frame 0 through the last frame, so every block has 0% and 100%.

## Trim paths

Set `pathLength="1"` on the element so dash values are fractions of the path.

- Visible length is `end - start`. Write `stroke-dasharray: <end - start> 1`.
- The dash starts at `start + offset`. Write `stroke-dashoffset: <-(start + offset)>`.

If only `trim.end` is animated (the common draw-on effect), animate `stroke-dasharray`. If only `trim.offset` is animated, animate `stroke-dashoffset`. If `start` and `end` are both animated with different keyframes, the two CSS properties are coupled and cannot each carry their own easing; in that case bake (see below).

**Verified in phase 3:** with `pathLength="1"` and a round or square cap, a dash of length 0 still draws a dot of the cap's size in Chromium (72 bright pixels for a 10 pixel stroke, the same as a dash of 0.0001). So the emitter hides the stroke while the visible length is zero: a static zero-length trim gets `stroke-opacity="0"`, and an animated one gets a second animation (`__guard`) that holds `stroke-opacity` at 0 with `step-end` from the zero-length keyframe until a moment later (0.0001 percent), then restores it. It is a separate `@keyframes` block because `animation-timing-function` applies to every property of a keyframe and the dash values need the real easing. Butt caps draw nothing at zero length and need no guard.

**Dash period.** The dash pattern is `visible gap`. On a path that is closed (a rect, an ellipse, a path whose subpaths are all closed) the gap is `1 - visible`, so the pattern repeats once per path length and a dash pushed past the end by `trim.offset` wraps round to the start, as Lottie does. On an open path the gap is 1, so nothing wraps, which also matches Lottie. Trim on several subpaths treats them as one path of length 1; Lottie trims each subpath on its own. The difference is not covered by the corpus.

**Rect and ellipse with trim** are emitted as `<path>` from the same four-curve construction used for clips, starting at the top and running clockwise. The parity test on `spinner-ring` (an ellipse) agrees with lottie-web; a trimmed rect is not in the corpus.

## SMIL for morphs and geometry

```xml
<path d="M...">
  <animate attributeName="d" dur="1.2s" repeatCount="indefinite"
    values="M0 0 C...; M0 0 C...; M0 0 C..."
    keyTimes="0; 0.5; 1"
    calcMode="spline"
    keySplines="0.65 0 0.35 1; 0.65 0 0.35 1"/>
</path>
```

Rules:

- `keyTimes` are fractions of the duration, starting at 0 and ending at 1.
- There is one `keySplines` entry per segment: one fewer than the number of values.
- **`keySplines` values must all be within 0 to 1.** Overshoot easings are not allowed in SMIL. When a morph or geometry animation uses an easing with a value outside that range, bake it.
- A hold segment needs `calcMode="discrete"`, which applies to the whole element. If a property mixes hold and bezier segments, bake it.
- If `loop` is false, use `repeatCount="1"` and `fill="freeze"`.

## Baking

Baking is the universal fallback. When a property cannot be expressed natively (the cases named above), the emitter samples its value at every frame and writes plain linear keyframes, one per frame. The result is larger but always correct.

Share one sampling function between the emitter, the tests and the QA checks: given a normalized property and a frame number, return the value. It evaluates the cubic bezier easing by solving for the curve parameter with a few Newton iterations, then interpolates.

The emitter reports which properties were baked, so the agent can simplify the scene if file size matters.

## Reduced motion and the poster frame

Add this rule to the style block:

```css
@media (prefers-reduced-motion: reduce) {
  * { animation: none !important; }
}
```

With animations off, each element shows its static attributes. The emitter therefore writes every animated property's **poster value** as the static attribute. The poster frame defaults to frame 0. A scene may set `"poster": <seconds>` at the top level to choose a more representative moment, for example the end of a reveal animation.

SMIL animations are not affected by this media query. This is acceptable; morphs keep running.

## Size

- Round coordinates to two decimals and percentages to four.
- Reuse identical `@keyframes` blocks: if two nodes have the same keyframes for the same property, emit one block and reference it from both rules.
- Optional post-processing with SVGO (MIT) is allowed, but its default preset breaks animated files. Ship a config that disables `cleanupIds`, `removeHiddenElems`, `inlineStyles`, `minifyStyles`, `mergePaths`, `collapseGroups`, `convertShapeToPath` and `convertPathData`. Verify during build that the parity test still passes after SVGO runs. **Not done in phase 3:** the emitter already writes compact output (merged static wrappers, shared keyframes, rounded numbers), the largest corpus file is 3.6 KB, and SVGO would be a new dependency. Revisit if a real scene produces a file where size matters.

## Findings from phase 3

These were found by building the emitter and running the parity test. Each is covered by a test.

**Seeking.** The script in `07-render-and-export.md` is exact in Chromium and WebKit: seeking the same frame twice gives identical pixels, and for a looping scene the frame at `duration` equals frame 0. A looping CSS animation set to `currentTime = duration` shows iteration 2 at progress 0, which is frame 0. Firefox is untested (see above).

**A step lands one frame late at the exact keyframe time.** In Chromium, setting `currentTime` to exactly a `step-end` keyframe's time still gives the value from before the step (at 600.000 ms a keyframe at 37.5 percent of 1.6 s shows the old value; at 600.001 ms the new one). Lottie shows the new value on that frame, so the parity test failed on the first frame of every hold and every time window. The emitter writes the keyframe that follows a `step-end` segment 0.001 percent early (microseconds), which leaves every frame boundary on the new value. The last keyframe is never moved, so every block still ends at 100 percent.

**`<use>` does not animate the content it points at in Chromium.** An instance of a definition with CSS animations inside it stayed at its first frame while the Lottie output animated, so the parity test failed on `leaf-instances`. The emitter now writes an animated definition once per instance, with class names made unique per instance (`<prefix>-<instance>_<node>__<suffix>`); identical `@keyframes` blocks are still written once, so the cost is the markup, not the CSS. A definition that cannot change over time stays a shared `<use>` in `<defs>`. Animation on the instance itself (position, rotation of the `use` node) is on wrappers outside the `<use>` and always worked. The statement below that nodes inside a definition share one timeline is therefore replaced: each instance has its own copy of the timeline.

**Colour noise in nearly transparent pixels.** Chromium returns un-premultiplied colour for pixels with a very low alpha, so two correct renders can differ by 14 or more in a colour channel there. The comparison weights colour by alpha, and counts a pixel as different only when no pixel within one pixel of it in the other image matches. The same rule gives the diff image. See `08-testing.md`.

**Baking is rare.** The SVG output bakes only when a property cannot be written natively: trim start, end and offset on different timelines; SMIL geometry or morph with an overshoot easing or a mix of hold and bezier segments. None of the 21 corpus examples bakes. The compile command prints a note naming the baked properties.

**Parity.** All 21 corpus examples agree with lottie-web on every frame, with at most 0.9 percent of pixels different on any frame (the worst is `clock-hand` frame 18; the limit is 2 percent). The remaining differences are anti-aliasing and the small difference between lottie-web's 0.5519 circle constant and the true circle used by the browser.

**Fault injection.** Six deliberate faults, three in each emitter (drop the pivot, put easing on the wrong keyframe, reverse the drawing order), are built in behind a test-only option. Each makes the parity test fail on at least one corpus example. See `08-testing.md`.

## What the SVG output cannot do

State these in `SKILL.md` so the agent sets expectations.

- It runs only in browser engines. Native mobile apps need the Lottie output.
- It cannot be paused, scrubbed or driven by user interaction without adding JavaScript.
- `from` and `to` time windows have no direct SVG form. They are written as an opacity wrapper that steps between 0 and 1, so a node outside its window is transparent, not removed.

## Unit tests this module needs

- Wrapper chain for each combination of animated and static transform channels.
- Easing shift onto the correct CSS keyframe.
- Hold to `step-end`.
- Trim to dash values.
- Morph to SMIL, including the bake fallback when easing overshoots.
- Id prefixing: two different scenes produce no shared ids.
- No `<script>`, no external `href`, no `@import` in any output. This is a hard assertion over the whole corpus.
- The parity test in `08-testing.md` is the real acceptance test for this module.
