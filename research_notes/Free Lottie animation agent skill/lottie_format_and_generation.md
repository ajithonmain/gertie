# Lottie format internals and free programmatic generation routes for LLMs / agents (state as of November 2026)

Research note on method: findings under "Cited Findings" were read from the linked page during this session (13 Nov 2026). Items under "Inferences" marked "(background knowledge, not verified this session)" come from the researcher's prior knowledge and should be treated as lower confidence. Several GitHub pages did not expose release dates to the fetcher; those are listed under Gaps rather than guessed.

## 1. Structure of Lottie JSON and the official spec (LAC), version, JSON schema

### Takeaway
Lottie is a JSON scene graph: a root animation (`w`, `h`, `fr`, `ip`, `op`, `layers`, optional `assets`) containing layers (`ty` 0-4 in the official spec), each with a transform `ks` and, for shape layers, a `shapes` array of geometry / style / modifier / group items; every animatable value is a `{a, k}` property whose keyframes carry `t`, `s`, and cubic-bezier easing handles `o` / `i`. The official standard is the Lottie Animation Community (LAC) spec at lottie.github.io, currently 1.0.1, which ships a JSON Schema (draft 2020-12) usable for validation, but it standardises only a conservative subset (no text, no expressions, no effects, no repeater/merge paths).

### Cited Findings

Official spec, version, schema
- The LAC spec site lists sections Values, Properties, Composition, Layers, Shapes, Assets, Enumerations, Helpers, Glossary, JSON Schema. — [lottie-spec latest](https://lottie.github.io/lottie-spec/latest/)
- The published schema has `$id` `https://lottie.github.io/lottie-spec/1.0.1/specs/schema/`, uses JSON Schema draft 2020-12, and carries `$version` 10001 (= 1.0.1). The file-level `ver` field is an integer encoded MMmmpp with minimum 10000. — [lottie-spec schema page](https://lottie.github.io/lottie-spec/latest/specs/schema/)
- Required top-level fields per schema: `w`, `h`, `fr`, `op`, `ip` (Animation) plus `layers` (Composition). — [lottie-spec schema page](https://lottie.github.io/lottie-spec/latest/specs/schema/)
- The schema page links the raw file as `../../lottie.schema.json` (resolves to `https://lottie.github.io/lottie-spec/1.0.1/lottie.schema.json`; the fetcher inferred this from a relative link, so verify before hard-coding). — [lottie-spec schema page](https://lottie.github.io/lottie-spec/latest/specs/schema/)
- GitHub releases for lottie/lottie-spec show two releases: 1.0 (23 Sep, year not rendered) and v1.0.1 (26 Jun, heading says "April 2025"), with 1.0.1 adding pucker/bloat modifier definitions and clarifying gradients and stroke dashes. — [lottie-spec releases](https://github.com/lottie/lottie-spec/releases)
- The repo contains `schema/`, `docs/`, `tests/`, `tools/` and the work is governed by the Community Specification License. — [lottie/lottie-spec](https://github.com/lottie/lottie-spec)

Layers
- Layer types in the official spec: `ty` 0 Precomposition, 1 Solid, 2 Image, 3 Null, 4 Shape. Schema `$defs`: `precomposition-layer`, `image-layer`, `null-layer`, `solid-layer`, `shape-layer`, `unknown-layer`. — [lottie-spec layers](https://lottie.github.io/lottie-spec/latest/specs/layers/); [schema page](https://lottie.github.io/lottie-spec/latest/specs/schema/)
- Common layer fields: `nm` name, `hd` hidden, `ty`, `ind` (index used for parenting), `parent` (the `ind` of the parent), `ip` (frame the layer becomes visible), `op` (frame it becomes invisible). — [lottie-spec layers](https://lottie.github.io/lottie-spec/latest/specs/layers/)
- Visual layer fields: `ks` transform, `ao` auto-orient (0/1), `tt` matte mode, `tp` (`ind` of the matte layer; if omitted the layer above is used), `masksProperties` (array of Mask). — [lottie-spec layers](https://lottie.github.io/lottie-spec/latest/specs/layers/)
- Type-specific: Shape layer `shapes`; Image layer `refId`; Solid layer `sw`, `sh`, `sc` (hex colour); Precomp layer `refId`, `w`, `h`, `sr` (time stretch), `st` (start time), `tm` (time remap). — [lottie-spec layers](https://lottie.github.io/lottie-spec/latest/specs/layers/)
- Matte modes named in the spec: Normal, Alpha, Inverted Alpha, Luma, Inverted Luma. — [lottie-spec layers](https://lottie.github.io/lottie-spec/latest/specs/layers/)

Shapes
- Geometry: `el` Ellipse (`d`, `p`, `s`), `rc` Rectangle (`d`, `p` centre, `s` size, `r` roundness), `sh` Path (`d`, `ks` bezier), `sr` PolyStar (`p`, `or`, `os`, `r`, `pt`, `sy`, `ir`, `is`). — [lottie-spec shapes](https://lottie.github.io/lottie-spec/latest/specs/shapes/)
- Grouping: `gr` Group (`np`, `it` array); `tr` Transform (`a` anchor, `p` position, `r` rotation, `s` scale, `o` opacity, `sk` skew, `sa` skew axis). — [lottie-spec shapes](https://lottie.github.io/lottie-spec/latest/specs/shapes/)
- Styles: `fl` Fill (`o`, `c`, `r` fill rule); `st` Stroke (`o`, `lc`, `lj`, `ml`, `ml2`, `w`, `d` dashes, `c`); `gf` Gradient Fill (`o`, `g`, `s`, `e`, `t`, `h`, `a`, `r`); `gs` Gradient Stroke. — [lottie-spec shapes](https://lottie.github.io/lottie-spec/latest/specs/shapes/)
- Modifier documented on the shapes page: `tm` Trim Path (`s` start, `e` end, `o` offset, `m` multiple: 1 Parallel, 2 Sequential). — [lottie-spec shapes](https://lottie.github.io/lottie-spec/latest/specs/shapes/)
- Rendering rules: shapes render in reverse array order (first item draws on top); styles and modifiers apply to all preceding shapes in their scope including sub-groups; a Transform must be present in every group and must be the last item in `it`; shapes with no applicable style are not rendered; group opacity applies to the composited group. — [lottie-spec shapes](https://lottie.github.io/lottie-spec/latest/specs/shapes/)

Properties and keyframes
- Every property has `a` (0/1 animated flag) and `k` (the value when static, an array of keyframes when animated). — [lottie-spec properties](https://lottie.github.io/lottie-spec/latest/specs/properties/)
- Keyframe fields: `t` frame number, `s` value, `h` hold (0/1), `o` out easing handle (first bezier control point), `i` in easing handle (second control point). — [lottie-spec properties](https://lottie.github.io/lottie-spec/latest/specs/properties/)
- Keyframe rules: ascending `t`; at most two keyframes may share a `t`; `i` and `o` are required except on the last keyframe or when `h` is 1; before the first keyframe the first value is used and after the last keyframe the last value is held. — [lottie-spec properties](https://lottie.github.io/lottie-spec/latest/specs/properties/)
- Easing handles are objects `{x, y}`; numbers for scalar properties, arrays (one per dimension) for vector properties. They define a cubic bezier from [0,0] to [1,1]; `x` (time) is clamped to 0..1, `y` (interpolation factor) is not clamped and may overshoot. Linear = `o {x:0,y:0}`, `i {x:1,y:1}`; ease in-out example = `o {x:0.333,y:0}`, `i {x:0.667,y:1}`. — [lottie-spec properties](https://lottie.github.io/lottie-spec/latest/specs/properties/)
- Animated scalar keyframes store `s` as a single-element array. Position keyframes add spatial tangents `ti` / `to`. Split position is `{s: true, x: <scalar prop>, y: <scalar prop>}`. Gradient property is `{p: <stop count>, k: {a, k}}`. Properties can carry `sid` (slot ID) for theming. — [lottie-spec properties](https://lottie.github.io/lottie-spec/latest/specs/properties/)

### Inferences
- The official 1.0.1 spec deliberately omits text layers (`ty` 5), expressions (`x` on properties), layer effects (`ef`), repeater (`rp`), merge paths (`mm`), rounded-corners modifier (`rd`), layer styles and 3D/camera. Those exist in the de-facto bodymovin format documented at lottiefiles.github.io/lottie-docs (background knowledge, not verified this session). An LLM skill that restricts itself to the LAC 1.0.1 subset gets a machine-checkable target and the widest player coverage.
- Other commonly used fields not confirmed this session (background knowledge): top-level `v` (bodymovin version string such as "5.7.4"), `nm`, `ddd` (3D flag), `markers`, `meta`; `assets` entries with `id` + `layers` for precomps or `id`, `w`, `h`, `u`, `p`, `e` for images; mask objects with `mode` ("a" add, "s" subtract, "i" intersect, "n" none), `pt` (bezier path), `o` (opacity), `inv`, `x` (expansion); matte `tt` values 1 alpha, 2 inverted alpha, 3 luma, 4 inverted luma with legacy `td: 1` marking the matte source layer; bezier value `{c: closed, v: [[x,y]...], i: [[dx,dy]...], o: [[dx,dy]...]}` where `i` / `o` tangents are relative to their vertex; colours are RGB(A) floats 0..1; opacity and scale are 0..100; rotation in degrees; Y axis points down.
- A frequent source of blank renders is the shape-layer rule set: geometry must be followed (in the same group scope) by a `fl` or `st`, and each group needs a trailing `tr`. These rules are explicit in the spec, so a builder or linter can enforce them mechanically.
- `fr` multiplied by seconds gives frame numbers; duration = (`op` - `ip`) / `fr`. Layer `ip` / `op` must cover the frames in which the layer should be visible, otherwise it silently disappears.

### Gaps
- Exact years of the lottie-spec 1.0 and 1.0.1 releases were not rendered by the fetcher (LottieFiles blog title references "Lottie Specification v1.0", and the 1.0.1 release heading says April 2025). Whether a newer version (1.1 / 2.0) has been released between mid-2025 and November 2026 could not be confirmed; `latest` still resolved to 1.0.1 on 13 Nov 2026.
- The Enumerations and Helpers (Mask) pages of the spec were not fetched; numeric enum values for matte mode, mask mode, line cap/join, fill rule, shape direction are not source-verified here.
- lottiefiles.github.io/lottie-docs (the broader unofficial reference covering text, effects, expressions) was not fetched this session.

## 2. dotLottie (.lottie): container, versions, theming, state machines, free tooling

### Takeaway
dotLottie is a Deflate ZIP archive (`.lottie`, MIME `application/zip+dotlottie`) bundling one or more Lottie JSON animations with a `manifest.json` plus optional images, fonts, themes and state machines; v2 adds theming via Lottie slot IDs and interactive state machines. MIT-licensed LottieFiles libraries create it for free, and because it is plain ZIP an agent can also build one with any zip library.

### Cited Findings
- Format: ZIP archive compressed with Deflate, `.lottie` extension, MIME `application/zip+dotlottie`. — [dotLottie 2.0 spec](https://dotlottie.io/spec/2.0/)
- Layout: `manifest.json` (required, root); `a/` animations (required, at least one Lottie JSON); `i/` images; `f/` fonts; `t/` themes; `s/` state machines (all optional). — [dotLottie 2.0 spec](https://dotlottie.io/spec/2.0/)
- Manifest fields: `version` ("2", required), `generator`, `animations` (required; each with `id`, optional `initialTheme`, `background`, scoped `themes`), `themes`, `stateMachines`, `initial` (animation or state machine to load first). — [dotLottie 2.0 spec](https://dotlottie.io/spec/2.0/)
- Theming: theme JSON files in `t/` contain rules targeting Lottie slot IDs (case-sensitive). Rule types: Color, Scalar, Vector, Position, Gradient, Image, Text; each rule gives a static `value` or `keyframes`. — [dotLottie 2.0 spec](https://dotlottie.io/spec/2.0/)
- State machines: files in `s/` define `states` (PlaybackState / GlobalState), `transitions`, `guards` (Numeric, String, Boolean, Event), `actions`, `interactions` (pointer events, click, completion), and `inputs`. — [dotLottie 2.0 spec](https://dotlottie.io/spec/2.0/)
- dotlottie-web is MIT licensed, plays both `.json` and `.lottie` (v2), and uses a Rust + WASM core (dotlottie-rs) with ThorVG as renderer; backends are software Canvas2D (default), WebGL2, and experimental WebGPU. It supports state machines and themes (`setTheme()`, `setThemeData()`), and runs in Node.js 18+. — [LottieFiles/dotlottie-web](https://github.com/LottieFiles/dotlottie-web)
- dotlottie-web packages: `@lottiefiles/dotlottie-web`, `-react`, `-vue`, `-svelte`, `-solid`, `-wc`. A jsDelivr path shows `@lottiefiles/dotlottie-web@0.72.1` exists. — [LottieFiles/dotlottie-web](https://github.com/LottieFiles/dotlottie-web); [jsDelivr package.json](https://cdn.jsdelivr.net/npm/@lottiefiles/dotlottie-web@0.72.1/package.json)
- Creation library: `@dotlottie/dotlottie-js` (MIT) creates, reads and manipulates `.lottie` archives (create a `DotLottie` instance, add animation, `build()`, `toArrayBuffer()` in Node). LottieFiles docs now label dotlottie-js "legacy" and state it is being superseded by the Rust-powered `@lottiefiles/dotlottie-io` with Node bindings and a migration guide. — [dotlottie-js docs (legacy)](https://docs.lottiefiles.com/en/tools/dotlottie-js.md); [dotlottie-io docs](https://docs.lottiefiles.com/en/tools/dotlottie-io.md); [migration guide](https://docs.lottiefiles.com/en/tools/dotlottie-io/guides/migrating-from-dotlottie-js.md); [npm @dotlottie/dotlottie-js](https://npmjs.com/package/%40dotlottie%2Fdotlottie-js)
- python-lottie lists dotLottie as both an import and export format. — [python-lottie docs](https://mattbas.gitlab.io/python-lottie/index.html)
- A third-party MIT CLI `delottie` can create simple `.lottie` files. — [stefnnn/delottie](https://github.com/stefnnn/delottie)

### Inferences
- For an agent skill, emitting plain Lottie JSON is the portable baseline; packaging to `.lottie` is an optional last step (zip `manifest.json` + `a/<id>.json`). Since the container is ordinary Deflate ZIP with a small manifest, a dependency-free implementation with Python `zipfile` or Node zip libraries is feasible and avoids licensing questions entirely.
- Theming depends on `sid` slot IDs on properties (present in the LAC property definitions), so a generator that wants themeable output should attach `sid` to colours it expects to be overridden.
- State machines and theming are dotLottie-player features (dotlottie-web / dotlottie-rs). Classic lottie-web, lottie-ios and lottie-android consume the JSON only; do not rely on `.lottie` interactivity for universal playback.

### Gaps
- Differences between dotLottie v1 and v2 were not read from the v1 page; only the v2 structure is verified.
- Version / date of the dotLottie 2.0 spec, the license and current version of `@lottiefiles/dotlottie-io`, and the existence of an official dotLottie CLI were not confirmed (the search result mentioned a CLI on lottiefiles.com without package details).
- Latest version of `@dotlottie/dotlottie-js` is unclear (npm page showed 1.3.0, a third-party index 1.6.3).

## 3. Cross-player feature support: what is safe, what to avoid

### Takeaway
The safe intersection across lottie-web, lottie-android, lottie-ios, lottie-windows, ThorVG/dotLottie and rlottie is: shape layers with rect / ellipse / path / group, solid and gradient fills and strokes, transforms with parenting, linear / bezier / hold keyframes, precomps, masks in add / subtract mode, alpha mattes, and trim paths. Expressions, layer effects, merge paths, text, luma mattes, auto-orient, and exotic mask modes are the main things an LLM should avoid.

### Cited Findings

Airbnb supported-features table (Android / iOS Core Animation / iOS Main Thread / Windows / Web SVG / Web Canvas / Web HTML) — [airbnb/lottie supported-features.md](https://raw.githubusercontent.com/airbnb/lottie/master/supported-features.md)
- Supported everywhere: Shape (path), Ellipse, Rectangle, Rounded Rectangle, Group; fill colour / opacity / fill rule; linear and radial gradients; stroke colour / opacity / width / line cap / line join / miter limit / dashes / gradient stroke; Position (including separated X/Y), Scale, Rotation, Anchor Point, Opacity, Parenting; Linear, Bezier, Hold, Spatial Bezier interpolation and Rove Across Time; Mask Path, Mask Opacity, mask Add and Subtract; Alpha Matte; Images; Precomps; Markers.
- Polystar: unsupported on Windows. Repeater: unsupported on iOS Main Thread. Trim Path (individually): unsupported on Windows. Trim Path (simultaneously): unsupported on iOS Core Animation.
- Auto Orient: web only (unsupported on Android, both iOS engines, Windows). Skew: unknown on Android and Windows.
- Masks: Intersect is unsupported on Windows and all three web renderers; Lighten, Darken, Difference and Feather unsupported everywhere; Expansion only on Web Canvas / HTML.
- Mattes: Alpha Inverted unsupported on Windows; Luma and Luma Inverted unsupported on Android, iOS and Windows (unknown on web).
- Merge Paths: Android (KitKat+) and Windows only; unsupported on iOS and web.
- Layer effects: Fill, Stroke, Tint, Tritone are web only; Gaussian blur is Android 4.1+ only; Drop Shadow is Android 4.1+ and iOS.
- Text: glyphs unsupported on iOS and Windows; all text unsupported on Windows; range selectors, text path, per-character 3D are web only.
- Expressions: web only (unsupported on Android, iOS, Windows). Time Stretch and Time Remap: unsupported on Windows only.

ThorVG (engine behind dotlottie-web / dotlottie-rs) — [ThorVG wiki: Lottie Support](https://github.com/thorvg/thorvg/wiki/Lottie-Support)
- Lists as supported: Ellipse, Group, Path, Polystar, Rectangle; stroke dashes / miter / cap / join / width; solid and gradient fills; embedded and external images (JPG, PNG, WebP); Anchor, Auto Orient, Opacity, Parenting, Position, Scale, Skew; all interpolators; modifiers Offset Path, Pucker/Bloat, Repeater, Roundness, Trim Path, ZigZag; masks Add, Subtract, Intersect, Lighten, Darken, Difference, Expansion; Alpha and Luma mattes including inverted; effects Fill, Drop Shadow, Gaussian Blur, Stroke, Tint, Tritone; text (fonts, glyphs, range selector, text path, tracking); Markers, Precomps, Time Remap, Time Stretch, Slots.
- Expressions are partial: the wiki reports 75% coverage (72% full, 3% partial), with unsupported items including `velocity`, `speed`, `smooth()`, `lookAt()`, `posterizeTime`, `createPath`, `sampleImage`; only `cycle` and `pingpong` loop modes work.

rlottie (Samsung) — [Samsung/rlottie](https://github.com/Samsung/rlottie)
- The repository is archived and "no longer maintained", with no security support or releases.
- Its table lists as supported: shapes, trim paths, fills / strokes / gradients, transforms with parenting and auto-orient, masks Add / Subtract / Intersect, alpha and luma mattes, images, precomps, time stretch / remap. Unsupported: skew, masks Lighten / Darken / Difference / Expansion / Feather, all merge paths, all layer effects, all text, expressions. It builds a `lottie2gif` tool.

Other
- A LottieFiles article describes Skottie (Skia) as the leader in Lottie feature support per canilottie.com, a site documenting per-player feature support. — [LottieFiles blog](https://lottiefiles.com/blog/working-with-lottie-animations/explore-lottie-animation-format-lottie-players-latest-tools-and-features)

### Inferences
- Recommended "safe subset" allow-list for an LLM skill, derived from the tables above: layer types 4 (shape), 3 (null, for parenting rigs), 0 (precomp), optionally 1 (solid); shape items `rc`, `el`, `sh`, `gr`, `tr`, `fl`, `st`, `gf`, `gs`, and `tm`; transforms with `a`, `p`, `s`, `r`, `o` and parenting; keyframes with bezier / linear / hold easing; masks only in add / subtract modes; mattes only alpha (and inverted alpha if Windows is not a target).
- Deny-list: expressions (`x`), layer effects (`ef`), merge paths (`mm`), text layers (`ty` 5; convert text to paths instead), luma mattes, auto-orient (`ao`), mask modes other than add / subtract, mask feather / expansion, layer styles, 3D / camera layers, audio, embedded base64 raster images (token bloat, defeats vector purpose). Use with caution: polystar `sr` (no Windows), repeater `rp` (no iOS Main Thread; also outside LAC 1.0.1), skew, time remap, trim path with multiple shapes (iOS Core Animation vs Windows disagree on individual / simultaneous modes, so apply a trim to a single path per group).
- This safe subset coincides almost exactly with the LAC 1.0.1 schema scope, so "validates against the LAC schema with zero unknown-property warnings" is a good proxy for cross-player portability.
- Since rlottie is archived, ThorVG is the practical open-source native / headless C++ renderer going forward.

### Gaps
- canilottie.com and Skottie's own feature matrix were not fetched; no primary Skottie data here.
- lottie-ios / lottie-android repositories were not checked individually; the Airbnb table's last-updated date is unknown, so newer gains (for example newer effects support) may be missing.
- ThorVG wiki page did not mention merge paths, the ThorVG license, or its CLI tools (lottie2gif); those are unverified.

## 4. Open-source libraries that generate / manipulate Lottie JSON

### Takeaway
There is no single well-maintained, permissively licensed, high-level Lottie builder: python-lottie is the most capable (builder objects, SVG import, raster / video export) but is AGPLv3+; `@lottiefiles/lottie-js` is MIT but has not been published since July 2023; relottie (MIT) is an AST toolchain rather than an authoring API. For a publicly shared skill, the cleanest licensing route is a small purpose-written builder script (the format subset needed is small) validated with the MIT `lottie-specs` validator.

### Cited Findings

| Library | License | Status / latest | Notes for headless agent use | Source |
|---|---|---|---|---|
| python-lottie (PyPI `lottie`) | AGPLv3+ | 0.7.2 uploaded 2025-05-01; docs show 0.7.2+dev snapshot | Pure Python core with no required deps; object model (`lottie.Animation()` then `to_dict()`); `lottie_convert.py` CLI; imports lottie, TGS, SVG, SVGz, raster, Synfig, dotLottie; exports lottie, TGS, SVG, dotLottie, GIF, WebP, MP4/AVI/WebM, HTML, PNG, PDF; optional extras (cairosvg, pillow, glaxnimate, fonttools, numpy/OpenCV) | [PyPI JSON](https://pypi.org/pypi/lottie/json); [docs](https://mattbas.gitlab.io/python-lottie/index.html) |
| @lottiefiles/lottie-js | MIT | 0.4.2, last published 2023-07-24; not flagged deprecated | "Lottie JSON model for Javascript/Typescript"; no release in over three years | [npm registry](https://registry.npmjs.org/@lottiefiles/lottie-js) |
| relottie (LottieFiles) | MIT | 240 commits, Dependabot active; release date not visible | unified-ecosystem processor: `last` (AST types), `last-builder` (functions for building syntax trees), `relottie-parse`, `relottie-stringify`, `relottie-cli`, `relottie-extract-features`, `relottie-metadata`. No lint package listed | [LottieFiles/relottie](https://github.com/LottieFiles/relottie) |
| @lottie-animation-community/lottie-specs (lottie-specs-js) | MIT | v0.3.2 per third-party index | Official LAC JS bindings: bundled schema + `LottieValidator` (Ajv 2020); Node and browser | [lottie/lottie-specs-js](https://github.com/lottie/lottie-specs-js); [pkgstats](https://www.pkgstats.com/pkg:@lottie-animation-community/lottie-specs) |
| Glaxnimate (KDE) | GPLv3+ (per older PyPI / Arch listings) | 0.6.0 released March 2026, first stable release under KDE | GUI vector animation editor with Lottie import/export; Python bindings (`glaxnimate` on PyPI) with a `glaxnimate.environment.Headless()` context used to convert animated SVG to Lottie and render Lottie to GIF (examples from 0.4.x / 0.5.x) | [KDE announce](https://mail.kde.org/pipermail/kde-announce/2026-March/000496.html); [PyPI glaxnimate 0.5.0.3](https://pypi.org/project/glaxnimate/0.5.0.3/); [glaxnimate.org](https://glaxnimate.org/) |
| lottie-web / bodymovin (airbnb) | MIT (background knowledge; not verified this session) | 5.13.0 dated 21 May 2025 per Snyk | Reference JS player; bodymovin AE exporter requires Adobe After Effects (paid), so the export route is not a free path | [Snyk lottie-web](https://security.snyk.io/package/npm/lottie-web); [aescripts bodymovin](https://aescripts.com/bodymovin/) |
| dotlottie-js / dotlottie-io | MIT (dotlottie-js) | dotlottie-js labelled legacy; dotlottie-io is the successor | Packaging to `.lottie`, not authoring | [docs](https://docs.lottiefiles.com/en/tools/dotlottie-js.md) |
| rlottie | not shown | Archived, unmaintained | Renderer only; `lottie2gif` | [Samsung/rlottie](https://github.com/Samsung/rlottie) |
| lottie-tools (Rust crate) | not verified | 0.1.0 | Contains a schema-based validator module | [docs.rs lottie-tools](https://docs.rs/crate/lottie-tools/latest/source/src/validator.rs) |
| lottie-lint (npm) | not verified | not verified | Lint rules for compatibility warnings (gradients, fonts) | [npm lottie-lint](https://npmjs.com/package/lottie-lint) |

- LottieFiles' own web SVG-to-Lottie converter states its source is based on python-lottie and available under the AGPL. — [lottiefiles.com/svg-to-lottie](https://lottiefiles.com/svg-to-lottie)

### Inferences
- License risk for a public skill: instructing an agent to `pip install lottie` and run a user-side script does not by itself place AGPL obligations on the skill text, but bundling or modifying python-lottie code inside the skill, or exposing it as a hosted service, triggers AGPL source-availability terms. A skill that wants to be MIT / Apache-clean should treat python-lottie and Glaxnimate as optional external tools, not vendored dependencies. (Licensing interpretation, not legal advice.)
- Because the safe Lottie subset is small (about ten shape item types, one transform object, one keyframe shape), a self-contained builder of a few hundred lines in Python or TypeScript with zero dependencies is realistic and avoids both the AGPL question and the unmaintained `lottie-js` problem.
- relottie's `last-builder` builds AST nodes, which is lower-level than an authoring API; it is better suited to post-processing (feature extraction, metadata, transforms) than to an LLM writing animations.
- python-lottie remains the best free "Swiss-army" tool for the render step (Lottie to GIF / PNG / MP4) and SVG import when AGPL is acceptable as a separately installed CLI.

### Gaps
- `lottie-types` (npm TypeScript typings) was not found in searches; license, version and status unverified.
- No Rust or Go Lottie builder library with meaningful adoption was identified; only the Rust `lottie-tools` 0.1.0 crate surfaced. Absence in search is not proof of absence.
- Latest release dates for relottie packages, lottie-specs-js, dotlottie-web, and whether Glaxnimate 0.6 shipped matching Python bindings or a documented headless CLI export were not confirmed.
- Whether python-lottie has had any release after 0.7.2 (May 2025) is unconfirmed beyond the PyPI JSON showing 0.7.2 as latest on 13 Nov 2026; maintenance appears slow but alive (dev snapshot docs).
- lottie-web's license and whether it has had releases after 5.13.0 were not verified from a primary source.

## 5. LLMs generating Lottie: research, failure modes, mitigations

### Takeaway
Two CVPR 2026 papers (OmniLottie, LottieGPT) show that general LLMs hand-writing raw Lottie JSON fail often (GPT-5 around 9-13% success on OmniLottie's benchmark, small models 0%), and both fix this by replacing raw JSON with a compact command / parameter token sequence, cutting length about 5x. The transferable lesson for a zero-cost skill is: do not have the model emit raw Lottie JSON; have it emit a compact DSL or builder script that is compiled to JSON, then validate and render.

### Cited Findings

OmniLottie
- "OmniLottie: Generating Vector Animations via Parameterized Lottie Tokens", Yang et al., arXiv 2603.02138, submitted 2 March 2026, accepted to CVPR 2026. Tokenises Lottie JSON into command + parameter sequences on top of a pretrained VLM; introduces the MMLottie-2M dataset. — [arXiv abs](https://arxiv.org/abs/2603.02138)
- Token counts: raw Lottie JSON averages about 2,562 tokens per animation, intermediate structured text about 884, final command tokens about 486 (about 81% reduction, 5.3x). — [arXiv HTML](https://arxiv.org/html/2603.02138v1)
- Text-to-Lottie results (Table 1): DeepSeek V3 9.3% success; Qwen2.5-VL 3B 0.0%; GPT-5 12.7%; Recraft 77.3%; OmniLottie 88.3% (FVD 202.14). Text-image-to-Lottie: GPT-5 9.2%, OmniLottie 93.3%. Video-to-Lottie: Gemini 3.1 Pro 0.0%, GPT-5 7.4-8.8%, OmniLottie 80.7-88.1%. The appendix reports different figures for some rows (for example DeepSeek 29.3%), an internal inconsistency. — [arXiv HTML](https://arxiv.org/html/2603.02138v1)
- Reported failure modes of general LLMs: Qwen2.5-VL schema hallucination (for example emitting `"version": "2.0"` instead of `v`); DeepSeek attribute hallucination (colour attributes placed on shape nodes instead of separate fill nodes; text layers without font definitions); GPT-5 and Gemini produce schema-valid JSON with rendering errors including collapsed bezier control points, incorrect transform nesting, and non-monotonic keyframe times. Recraft output is valid Lottie but 22.7% fails to render to video (unsupported features, timeouts on deep hierarchies, format mismatches). — [arXiv HTML](https://arxiv.org/html/2603.02138v1); [CVPR supplemental](https://openaccess.thecvf.com/content/CVPR2026/supplemental/Yang_OmniLottie_Generating_Vector_CVPR_2026_supplemental.pdf)
- Ablation: CLIP 0.41 with the Lottie tokenizer versus 0.24 when training on raw JSON (as reported by a search summary of the paper). — [arXiv PDF](https://arxiv.org/pdf/2603.02138)
- Tokenizer scope: layer types 0, 1, 3, 4, 5; base64 images, audio, camera, expressions, 3D / data layers are discarded. Dataset: about 2M animations (about 1.2M crawled from LottieFiles, IconScout, Flaticon, Iconfont, Icons8; remainder SVG-derived), normalised to a 512x512 canvas; shape layers are 86.8% of all layers; web files average 8.6 layers. — [arXiv HTML](https://arxiv.org/html/2603.02138v1)
- Stated limitations: autoregressive decoding can still yield invalid sequences; complex / long animations remain hard; future work proposes constrained decoding and renderability rewards. — [arXiv HTML](https://arxiv.org/html/2603.02138v1)
- Release: code Apache-2.0; weights `OmniLottie/OmniLottie` on Hugging Face (about 8.46 GB, 4B params); needs about 15.2 GB GPU memory; inference 8.34 s (256 tokens) to 133.49 s (4096 tokens); `python inference_hf.py --model_path OmniLottie/OmniLottie --text "A bouncing ball" --output output.json`; HF Spaces demo; MMLottie-2M dataset is CC BY-NC-SA 4.0 (research / non-commercial); MMLottieBench has 900 samples; training code not yet released as of the README. — [OpenVGLab/OmniLottie](https://github.com/OpenVGLab/OmniLottie)

LottieGPT
- "LottieGPT: Tokenizing Vector Animation for Autoregressive Generation", Chen et al., arXiv 2604.11792, submitted 13 April 2026, CVPR 2026. Claims to be the first framework for tokenising and autoregressively generating vector animations; custom Lottie tokenizer encoding primitives, transforms and keyframe motion; fine-tunes Qwen-VL; LottieAnimation-660K dataset (660k animations plus 15M static Lottie images) and LottieBench benchmark; project page lottiegpt.github.io. — [arXiv abs](https://arxiv.org/abs/2604.11792); [CVPR poster](https://cvpr.thecvf.com/virtual/2026/poster/38557)

Agent-skill prior art
- `diffusionstudio/lottie` is an MIT-licensed "text-to-lottie" skill for Claude Code / Codex (install `npx skills add diffusionstudio/lottie`), 5.7k stars, 93 commits. The agent sets up a workspace with an included web player; each scene is written to `public/projects/<project>/<scene>/lottie.json` and live-updates in the player as the agent edits. Its README advises grounding in concrete assets (SVGs, data, screenshots: "Results are significantly better when the animation is based on concrete assets"), using motion-design vocabulary (ease-in / ease-out), and specifying FPS and total frame count. — [diffusionstudio/lottie](https://github.com/diffusionstudio/lottie)
- Other listed "Lottie skills" (iart-ai/web-animation-skills, freshtechbro/claudedesignskills `lottie-animations`, dylantarre `lottie-bodymovin`) are about integrating or playing existing Lottie files, not authoring them. — [typingmind listing](https://www.typingmind.com/skills/iart-ai-lottie-animation); [claudemarketplaces listing](https://claudemarketplaces.com/plugins/freshtechbro-claudedesignskills/lottie-animations)

### Inferences
- Failure-mode checklist a skill's linter should catch (each maps to a cited failure or a spec rule): wrong top-level keys (`version` instead of `v`); colour on geometry instead of a separate `fl` / `st`; missing or misplaced group `tr`; geometry with no style in scope; keyframe `t` not ascending; missing `o` / `i` on non-final keyframes; easing `x` outside 0..1; `a: 1` with a non-array `k` or `a: 0` with keyframe array; scalar keyframe `s` not wrapped in an array; bezier `v` / `i` / `o` arrays of unequal length or tangents collapsed to absolute coordinates; layer `ip` / `op` not covering the animation; `parent` / `refId` / `tp` pointing to non-existent `ind` / asset ids; colours given as 0..255 or hex instead of 0..1 floats; opacity / scale given as 0..1 instead of 0..100; text layers without fonts.
- The papers' 5x token compression supports a compact DSL in the skill for two independent reasons: fewer output tokens (cost, truncation risk) and a smaller, more regular surface that removes whole classes of structural error. A builder script gives the same benefit plus loops / functions for repeated elements.
- The published benchmark numbers for GPT-5 / DeepSeek measure single-shot raw JSON generation with no tools. They do not measure a coding agent with a builder, validator and render feedback loop, so they are a lower bound, not a ceiling, for the skill approach. The popularity of diffusionstudio/lottie (5.7k stars) is weak evidence that agentic generation with a live preview is practically useful, but no quantitative evaluation of it was found.
- Specialised models (OmniLottie, LottieGPT) are free to download but need about 15 GB of GPU memory, so they do not fit a "portable skill for any LLM at zero cost" unless the user has a local GPU or uses the free HF Space demo; MMLottie-2M's non-commercial license also limits reuse of the data.
- Render-and-look loop options that are free: python-lottie export to PNG / GIF (AGPL, CLI use), dotlottie-web / ThorVG in Node 18+ (MIT player), headless browser with lottie-web taking screenshots at chosen frames, Glaxnimate headless bindings (GPL). Sampling a handful of frames (start, middle, end, and each keyframe time) as a contact sheet is enough for a vision-capable agent to self-critique.

### Gaps
- LottieGPT's quantitative results, code / weights release status and license were not available from the abstract page; whether a public checkpoint exists is unverified.
- The internal instruction files of diffusionstudio/lottie were not read, so whether it has the agent write raw JSON or use a helper, and what rules it enforces, is unknown. Its last commit date was not visible.
- No benchmark was found that evaluates frontier LLMs (Claude, GPT-5.x, Gemini) with tool-assisted loops on Lottie generation; no published data on Claude's raw Lottie success rate (Claude 3.5 Sonnet was used only as a judge in OmniLottie).
- A June 2026 "Show HN" claim that Claude Code generates production-grade Lottie was noted by a search summary as unverified. — [dev.to summary](https://dev.to/gentic_news/claude-code-generates-production-lottie-animations-via-show-hn-165n)

## 6. Raw JSON vs builder script vs SVG-to-Lottie conversion: which is most reliable?

### Takeaway
Evidence favours an indirect route: raw JSON is the least reliable (low measured success rates and about 5x more tokens), while a builder script or compact DSL compiled deterministically to JSON removes structural errors; SVG-to-Lottie is a useful complement for the static artwork (LLMs write SVG well, and concrete assets improve results) but converters only give geometry, and the mature free converters are AGPL / GPL.

### Cited Findings
- Single-shot raw Lottie JSON from general LLMs succeeds rarely in the OmniLottie benchmark (GPT-5 12.7% text-to-Lottie; DeepSeek 9.3%; Qwen2.5-VL 0%), with errors in bezier control points, transform nesting and keyframe ordering even when the JSON is schema-valid. — [arXiv HTML 2603.02138](https://arxiv.org/html/2603.02138v1)
- Replacing raw JSON with a compact command representation cut average length from about 2,562 to about 486 tokens and raised CLIP from 0.24 to 0.41 in the paper's ablation. — [arXiv HTML 2603.02138](https://arxiv.org/html/2603.02138v1); [arXiv PDF](https://arxiv.org/pdf/2603.02138)
- About 40-52% of MMLottie-2M was produced by deriving Lottie from SVG, i.e. SVG-to-Lottie plus added motion is an established pipeline at research scale. — [arXiv HTML 2603.02138](https://arxiv.org/html/2603.02138v1)
- python-lottie imports SVG / SVGz and exports Lottie via `lottie_convert.py` (AGPLv3+). — [python-lottie docs](https://mattbas.gitlab.io/python-lottie/index.html)
- Glaxnimate's Python bindings document converting animated SVG to Lottie through a headless document (GPLv3+ on older listings). — [PyPI glaxnimate 0.5.0.3](https://pypi.org/project/glaxnimate/0.5.0.3/)
- LottieFiles' hosted SVG-to-Lottie converter is free to use on the web and is based on python-lottie (AGPL source). — [lottiefiles.com/svg-to-lottie](https://lottiefiles.com/svg-to-lottie)
- The diffusionstudio skill README reports that results are "significantly better" when based on concrete assets such as SVGs. — [diffusionstudio/lottie](https://github.com/diffusionstudio/lottie)

### Inferences
- Reliability ranking for a tool-using agent (reasoned from the above, not directly benchmarked): (1) builder script / compact DSL compiled to JSON, with validation and render feedback; (2) SVG artwork converted to Lottie shapes and then animated through the same builder (transform keyframes per group / layer); (3) hand-written raw JSON, acceptable only for very small animations (one or two layers) or for surgical edits of an existing file.
- A builder can make invalid states unrepresentable: it always appends the group `tr`, always emits `a` / `k` consistently, sorts keyframes, fills easing handles from named presets (linear, easeIn, easeOut, easeInOut, overshoot), converts hex colours to 0..1 floats, assigns `ind` values, and sets `ip` / `op` from the composition. That directly targets every failure mode listed in the OmniLottie supplement.
- Named easing presets remove the most error-prone numeric detail. CSS-style `cubic-bezier(x1, y1, x2, y2)` maps to Lottie `o = {x: x1, y: y1}`, `i = {x: x2, y: y2}` (follows from the spec definition of `o` as first and `i` as second control point of a [0,0]-[1,1] bezier).
- SVG-path-to-Lottie-bezier conversion is the non-trivial part of the SVG route (absolute cubic control points must become vertex-relative `i` / `o` tangents; arcs and quadratics must be converted to cubics). A permissively licensed skill would need its own small path converter or would shell out to python-lottie as an external AGPL tool.
- SVG converters do not invent motion; "SVG to Lottie" alone yields a static Lottie. Animated SVG (SMIL) to Lottie via Glaxnimate exists but pushes the LLM back to hand-authoring animation in another verbose format.

### Gaps
- No head-to-head study comparing raw JSON vs builder script vs SVG conversion for LLM agents was found; the ranking above is inference.
- Quality / fidelity data for python-lottie's and Glaxnimate's SVG importers (gradients, clip paths, text, CSS styles) was not found; no permissively licensed (MIT / Apache) SVG-to-Lottie converter was identified in this session.

## 7. Free validators, linters and optimizers

### Takeaway
The authoritative free validator is the LAC JSON Schema (draft 2020-12) used directly with any JSON Schema library, or through the MIT `@lottie-animation-community/lottie-specs` package whose `LottieValidator` also warns about unknown types and properties. Beyond schema checks there is little maintained linting or optimisation tooling; relottie provides an AST and feature extraction rather than a linter, so a skill should ship its own semantic lint rules.

### Cited Findings
- `@lottie-animation-community/lottie-specs` (repo lottie/lottie-specs-js, MIT) provides JS tooling for schema processing and validation. Usage shown in README: create `new LottieValidator(ajv2020.Ajv2020, schema)` with the bundled schema (`get_schema_path()`), then `validator.validate(data)`. Results include entries of `type: "error"` (schema errors) and `type: "warning"` with `warning: "type"` (unknown object type) or `"property"` (unknown property); warnings can be suppressed by passing `false` as the second argument. Each entry has `message`, `path`, `name`, `docs`. Also loadable in browsers from jsDelivr. — [lottie/lottie-specs-js](https://github.com/lottie/lottie-specs-js); [pkgstats](https://www.pkgstats.com/pkg:@lottie-animation-community/lottie-specs)
- The raw schema is published by the LAC and uses JSON Schema draft 2020-12, so any 2020-12-capable validator (Ajv 2020 in JS, `jsonschema` in Python) can be used. — [lottie-spec schema page](https://lottie.github.io/lottie-spec/latest/specs/schema/)
- The schema defines `unknown-layer` and `unknown-shape`, meaning files with unrecognised `ty` values can still pass schema validation; the validator's warnings are what surface them. — [lottie-spec schema page](https://lottie.github.io/lottie-spec/latest/specs/schema/); [lottie/lottie-specs-js](https://github.com/lottie/lottie-specs-js)
- relottie (MIT) offers `relottie-cli` for inspecting and changing Lottie files, `relottie-extract-features` (lists Lottie features used in a file) and `relottie-metadata`; no lint package is listed in the repo. — [LottieFiles/relottie](https://github.com/LottieFiles/relottie)
- `lottie-lint` on npm provides lint rules for compatibility warnings (for example gradients, fonts). — [npm lottie-lint](https://npmjs.com/package/lottie-lint)
- Rust crate `lottie-tools` 0.1.0 includes a schema-based validator module. — [docs.rs lottie-tools](https://docs.rs/crate/lottie-tools/latest/source/src/validator.rs)
- python-lottie ships `tgs_check.py`, which reports warnings for Telegram sticker constraints. — [python-lottie docs](https://mattbas.gitlab.io/python-lottie/index.html)
- A browser-based "Lottie JSON Validator" exists at lottietools-app.pages.dev (claims unverified). — [lottietools-app](https://lottietools-app.pages.dev/json-validator/)

### Inferences
- Schema validity is necessary but not sufficient: the OmniLottie supplement shows GPT-5 / Gemini outputs that are schema-valid yet render wrongly. A skill needs three gates: (1) LAC schema validation with unknown-property warnings treated as errors (catches hallucinated keys and out-of-subset features); (2) semantic lint (keyframe monotonicity, easing ranges, reference integrity, style-in-scope, `tr` last, value ranges, `ip` / `op` coverage); (3) an actual render of sample frames.
- `relottie-extract-features` output could be compared against the safe-subset allow-list from section 3 to implement a portability check without writing a parser.
- Optimisation for generated files is mostly numeric: round floats to 2-3 decimals, drop `nm` names and default-valued fields, collapse static properties to `a: 0`, minify whitespace. These are easy to do in the compile step of a builder, so a separate optimiser dependency is not needed.
- In Python, validation with the `jsonschema` package (MIT) against the downloaded `lottie.schema.json` avoids any Node dependency; this assumes the schema is self-contained (the page presents it as a single bundled file).

### Gaps
- No dedicated, maintained open-source Lottie optimiser was verified this session; none appeared in search results. LottieFiles' optimiser is a hosted product, not confirmed open source.
- `lottie-lint` license, maintenance status and rule set were not inspected. CLI availability of lottie-specs-js (a `bin` folder exists) is undocumented.
- Whether the lottie-spec repo's own `tools/` directory includes a standalone validator script was not confirmed.
