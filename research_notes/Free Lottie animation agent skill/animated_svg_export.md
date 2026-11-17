# Animated SVG export: free routes from Lottie JSON or direct LLM authoring (state as of 2026-11-13)

Method note: registry facts (npm, PyPI) were read live on 2026-11-13 with `npm view` and the PyPI JSON API. Items marked "(search snippet only)" come from a search-result summary of the page, not from a full read of the page, and deserve lower confidence. Nothing was installed or executed, so no converter output was inspected first-hand.

## 1. The three ways an SVG can animate, and where each works

### Takeaway
SMIL and embedded CSS keyframes both survive in "image contexts" (img tag, CSS background), embedded JavaScript does not; SMIL is not deprecated in any current browser and caniuse reports 97.4% global support. For a single self-animating .svg file the only safe mechanisms are SMIL and a `<style>` block with `@keyframes`; script is only viable when the SVG is opened directly or embedded via object / iframe / inline.

### Cited Findings
- caniuse "SVG SMIL animation": W3C status "rec"; global usage with full support 97.4%, partial 0%. Supported in Chrome 5+ (latest listed 160: yes), Edge 79+ (legacy Edge 12-18 unsupported/polyfill only), Firefox 4+ (latest 163: yes), Safari 6+ (latest 27.3: yes), iOS Safari 6+ (latest 27.x: yes), Android browser 3+, Samsung Internet 4+, Opera 9+; IE 6-11 no native support. Only caveat note: "Partial support in older Safari versions refers to not working in HTML files or CSS background images" (Safari 4-5.1, iOS 3.2-5.1). — [caniuse svg-smil data](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/svg-smil.json) ([caniuse page](https://caniuse.com/svg-smil))
- Chromium posted "Intent to deprecate: SMIL" in 2015 in favour of CSS animations and Web Animations. — [blink-dev thread](https://groups.google.com/a/chromium.org/g/blink-dev/c/5o0yiO440LM/m/ckrkswShl2sJ)
- That deprecation was suspended in 2016 and a Chromium SVG status write-up describes SMIL as remaining supported indefinitely; MDN browser-compat-data marks SMIL elements as not deprecated (search snippet only). — [Grida: Chromium SVG migration status](https://canary.grida.co/docs/wg/research/chromium/svg/migration-status)
- MDN, SVG used as an image (img, background-image): "JavaScript is disabled"; "External resources (e.g., images, stylesheets) cannot be loaded, though they can be used if inlined through data: URLs"; `:visited` styles are not rendered; platform-native widget styling is disabled. The page lists no restriction on animation. These restrictions "don't apply when SVG content is viewed directly, or when it's embedded as a document via the iframe, object, or embed elements". — [MDN: SVG as an image](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image)
- GitHub READMEs: `<style>` and `<script>` tags written directly in README markdown "just get stripped", but an SVG file referenced as an image can carry its own `<style>` block and "even stuff like animations within them play". A commenter reports an animated SVG with a plain `<style>` (no foreignObject) working. — [CSS-Tricks: Custom Styles in GitHub Readme Files](https://css-tricks.com/custom-styles-in-github-readmes/)
- GitHub READMEs: a commenter on the same article reports using the SVG-as-image trick to get `prefers-color-scheme` working inside README images; another source says this does not work as expected in the GitHub Android and iOS apps, which always report light (second part is search snippet only). — [CSS-Tricks](https://css-tricks.com/custom-styles-in-github-readmes/); [prefers-color-scheme-hack repo](https://redirect.github.com/RodrigoTomeES/prefers-color-scheme-hack)
- Conflict on CSS inside img: one article states embedded JS will not run in an img-loaded SVG but CSS animations work fine and SMIL also works (search snippet only) — [DEV: Animating SVGs without a library](https://dev.to/alphashark/animating-svgs-without-a-library-what-actually-works-2508); a different recent guide claims CSS does not run inside img / background-image SVG (search snippet only) — [intro-web-tech SVG animation tutorial](https://intro-web-tech.pages.dev/media/svg/tutorials/13_animation.html). The CSS-Tricks GitHub evidence above and the MDN restriction list (which omits animation) support the first claim. The likely reconciliation: CSS in the host page cannot reach into an img SVG, but a `<style>` block inside the SVG file does run.
- Email (search snippet only, mixed-age sources): Apple Mail, Thunderbird and HEY render SVG fully; Gmail handles inline SVG only partly and strips attributes; Outlook for Windows does not render SVG at all, inline or via img. CSS animation in email is supported by Apple Mail, iOS Mail and Outlook for macOS; Gmail and Windows Outlook / Outlook.com are generally listed as unsupported. Standard advice is a static PNG or GIF fallback and to check caniemail.com for current data. — [allsvgicons: SVG in email 2026](https://www.allsvgicons.com/blog/email-svg-icons/); [Campaign Monitor: CSS animation in email](https://www.campaignmonitor.com/resources/guides/css-animation-in-email-keyframes-transitions-and-sample-code/)
- LottieFiles' own docs caveat their SMIL export: "browser and host support for SMIL must be verified". — [LottieFiles docs: Choosing an output format](https://docs.lottiefiles.com/en/integrations/vscode/05_integrate/choosing-an-output-format.md)
- Smashing Magazine published a SMIL-focused article in August 2026 ("Timing Charts: A Blueprint For SMIL Animations"), evidence SMIL is still treated as a live authoring technique (search snippet only; article not read). — [Smashing Magazine](https://smashingmagazine.com/2026/08/timing-charts-blueprint-smil-animations/)

### Inferences
- Compatibility matrix the skill can rely on (derived from the findings above; rows marked * are inference, not directly sourced):

| Context | SMIL | CSS `@keyframes` in the SVG's own `<style>` | `<script>` in SVG |
|---|---|---|---|
| Opened directly / object / iframe / embed | yes | yes | yes (MDN: image restrictions do not apply) |
| Inline `<svg>` in HTML | yes | yes (and page CSS can also target it) | page JS can drive it |
| `<img src>` | yes | yes (conflicting low-quality source says no) | no (MDN) |
| CSS `background-image` | yes (old Safari 4-5.1 no) | yes* | no (MDN) |
| GitHub README via `![]()` / img | yes (secondary sources) | yes (CSS-Tricks) | no |
| Email | only Apple Mail-class clients; assume no | same | no |
| iOS / Android WebView | follows Safari / Chrome engine* | same* | only if not in image context* |

- For a "works anywhere an image works" deliverable, everything must be inside the one file: no external fonts, images or stylesheets (inline as data: URLs), no script.
- Native non-browser SVG renderers (React Native SVG libraries, Android VectorDrawable, most design tools, rasterizers such as resvg / librsvg) generally do not run SMIL or CSS animation; a skill should state that animated SVG is a browser-engine deliverable. (Background knowledge, not verified in this research.)

### Gaps
- No official GitHub documentation was found describing exactly what its SVG sanitizer / image proxy permits; all GitHub claims are from blogs and comments.
- No first-hand test of CSS-animated SVG in img / background-image across Safari, Chrome and Firefox was run. The conflict above should be settled by a 5-minute browser test before the skill hard-codes guidance.
- No reliable current source for iOS WKWebView / Android WebView specifics, nor for whether animations in img SVGs pause off-screen or restart per instance.
- caniemail.com was not consulted directly; email data here is second-hand and partly from 2017-2018.

## 2. Free tools that convert Lottie JSON to a standalone animated SVG

### Takeaway
There are only two real open-source converters that emit truly animated (SMIL) SVG: Glaxnimate (GPLv3+, actively released, also the engine behind python-lottie's `--animated` SVG option) and bodymovin-to-smil (JS library, basic feature set, stale). No open-source Lottie-to-CSS-keyframes converter was found, and the popular `lottie-to-svg` npm package only renders a single static frame.

### Cited Findings

**python-lottie (mattbas)**
- License AGPLv3+; latest PyPI release 0.7.2 uploaded 2025-05-01 (0.7.1 on 2024-10-16, 0.7.0 on 2022-09-11); requires Python >= 3. — [PyPI lottie](https://pypi.org/project/lottie/) (read via PyPI JSON API)
- README format table (master) lists SVG and SVGz as supporting import, import animated, export and export animated; also lottie, tgs, Synfig, WebP, dotLottie, GIF, TIFF, MP4/AVI/WebM and HTML with animated export. CLI entry point is `lottie_convert.py`. Install: `pip install lottie` or `pip install lottie[all]`. — [python-lottie README](https://gitlab.com/mattbas/python-lottie/-/raw/master/README.md)
- Conflict: older PyPI pages (0.6.x) show SVG "Export Animated" as unsupported (search snippet only) — [PyPI lottie 0.6.6](https://pypi.org/project/lottie/0.6.6). The current source resolves this: the SVG exporter signature is `export_svg(animation, file, frame=0, pretty=True, animated=False)` with a CLI option `animated` ("Export animated svg"), present both on master and at tag v0.7.2. — [exporters/svg.py master](https://gitlab.com/mattbas/python-lottie/-/raw/master/lib/lottie/exporters/svg.py); [exporters/svg.py v0.7.2](https://gitlab.com/mattbas/python-lottie/-/raw/v0.7.2/lib/lottie/exporters/svg.py)
- Critical detail: python-lottie does not generate SMIL itself. With `animated=True`, `to_svg` runs `data = glaxnimate_helpers.convert(animation, "svg")` and returns that; the animated path is entirely delegated to the Glaxnimate Python module. Without `animated`, its own `SvgBuilder(time)` snapshots every property at one frame (static SVG). — [parsers/svg/builder.py](https://gitlab.com/mattbas/python-lottie/-/raw/master/lib/lottie/parsers/svg/builder.py)
- The static builder does handle, per frame: trim paths (applied geometrically by cutting the bezier, not via stroke-dasharray), masks (nested `<g mask>`), track mattes (`mask-type` luminance or alpha), linear/radial gradients, precomps with time remapping, repeaters (as `<use>` copies), rounded corners, and layer in/out points. — [parsers/svg/builder.py](https://gitlab.com/mattbas/python-lottie/-/raw/master/lib/lottie/parsers/svg/builder.py)
- README dependency table: the `glaxnimate` package is required for PNG export, GIF / animated WebP export and tracing; `cairosvg` for PDF/PS. — [python-lottie README](https://gitlab.com/mattbas/python-lottie/-/raw/master/README.md)

**Glaxnimate**
- "Glaxnimate can load and export SMIL animations for SVG" (added in 0.3.1); Lottie "can be opened and saved, not all features are implemented"; TGS, dotLottie (since 0.3.0), animated WebP and GIF also supported. — [Glaxnimate docs: Supported Formats](https://docs.glaxnimate.org/en/formats.html); [Glaxnimate CHANGELOG](https://lxr.kde.org/source/graphics/glaxnimate/CHANGELOG.md)
- Changelog entries relevant to fidelity: 0.4.0 animated SVG export honours layer first/last frames, tracks parent transforms, trims excess frames, handles animated opacity; Lottie masks and mattes support added. 0.4.5 SVG export supports hold frames. 0.4.4 Trim Path and Repeater modifiers added; 0.5.0-0.5.1 trim path fixes; 0.5.4 fixed SVG export of precomps with stretched/offset timing, gradient highlight import, `animateMotion` import. 0.4.2 Lottie text import. No entry mentions CSS-animation export. — [Glaxnimate CHANGELOG](https://lxr.kde.org/source/graphics/glaxnimate/CHANGELOG.md)
- Headless use: 0.4.6 "files can be converted or rendered from the command line"; 0.5.2 CLI options render images without starting the GUI; 0.5.1 migrated to Qt6; 0.5.5 integrated with KDE Frameworks. — [Glaxnimate CHANGELOG](https://lxr.kde.org/source/graphics/glaxnimate/CHANGELOG.md)
- Python module `glaxnimate` on PyPI: latest 0.6.0.3, uploaded 2026-03-03, GPLv3+, development status "3 - Alpha". The only release file is `glaxnimate-0.6.0.3-py3-none-manylinux1_x86_64.whl` (54.9 MB): Linux x86-64 only, no macOS wheel. System libraries listed: Qt widgets/xml, potrace, ffmpeg/libav, libarchive (`apt install libqt5widgets5 libqt5xml5 potrace ffmpeg libarchive13`). — [PyPI glaxnimate](https://pypi.org/project/glaxnimate/)
- Documented headless conversion pattern (shown for SVG to Lottie; reverse the extensions for Lottie to SVG): `with glaxnimate.environment.Headless():`, `document = glaxnimate.model.Document("")`, `glaxnimate.io.registry.from_extension("svg").load(document, input_file.read())`, `output_file.write(glaxnimate.io.registry.from_extension("json").save(document))`. — [PyPI glaxnimate](https://pypi.org/project/glaxnimate/)
- Known quality issue: KDE bug 499670 "SVG Output not working OK" reports that SVG export improved in 0.5.8 but problems remained (search snippet only). — [KDE bug 499670](https://bugs.kde.org/show_bug.cgi?id=499670)

**bodymovin-to-smil (by the lottie-web author's org)**
- JS library with a Node API (pass parsed Lottie JSON, get a promise resolving to SVG markup); no CLI. Output is SMIL-animated SVG. README lists "basic" support for masks (additive and intersect), shapes, solids, texts, precomps, transforms, opacity, and warns "not all browsers support SMIL". GitHub: 42 stars, 30 commits, 3 open issues, 4 open PRs, MIT per GitHub. — [bodymovin/bodymovin-to-smil](https://github.com/bodymovin/bodymovin-to-smil)
- npm registry: version 1.1.0, license field "ISC" (conflicts with MIT shown on GitHub), registry `time.modified` 2022-04-12. — [npm bodymovin-to-smil](https://www.npmjs.com/package/bodymovin-to-smil) (read via `npm view`)
- Described by a third party as "not super well maintained" and supporting limited animation features (search snippet only). — [HN thread mirror](https://brios-git-crit-brianlovin.vercel.app/hn/44088216)

**bm2smil (AndreyChayko)**
- MIT; thin wrapper around bodymovin-to-smil with an Angular UI and an Express server exposing `POST /api/convert` (file, URL or raw JSON); 5 stars, 5 commits; no CLI. Same feature list as bodymovin-to-smil. — [AndreyChayko/bm2smil](https://github.com/AndreyChayko/bm2smil)

**lottie-to-svg (chadly)**
- npm 1.1.0, MIT, registry modified 2022-05-08. "Convert a frame of a Lottie animation into an SVG": static single-frame output, not animated. — [npm lottie-to-svg](https://www.npmjs.com/package/lottie-to-svg)

**LottieFiles**
- The LottieFiles VS Code extension offers "Animated SVG (SMIL)" as an output format alongside .lottie and Lottie JSON; it drops dotLottie-only features (multi-animation, themes, tokens, state machines). The docs mention no CLI or API for it; "optimized" variants are plan-dependent. — [LottieFiles docs: Choosing an output format](https://docs.lottiefiles.com/en/integrations/vscode/05_integrate/choosing-an-output-format.md)
- Lottie Creator also lists Animated SVG (SMIL) among export options (search snippet only). — [LottieFiles Creator export formats](https://docs.lottiefiles.com/en/creator/10_exporting/formats.md)
- relottie (`@lottiefiles/relottie-cli` 1.16.0, MIT, modified 2026-08-04) is "Command line interface to inspect and change Lottie files": a Lottie AST toolchain, not an SVG exporter. No relottie plugin for SVG output was found. — [npm @lottiefiles/relottie-cli](https://www.npmjs.com/package/@lottiefiles/relottie-cli)

### Inferences
- Summary table:

| Tool | License | Maintained (Nov 2026) | Output | Headless CLI | Notes |
|---|---|---|---|---|---|
| Glaxnimate (app / Python module) | GPLv3+ | Yes (PyPI 0.6.0.3, Mar 2026) | SMIL animated SVG | Yes on Linux x86-64 via pip; CLI convert since 0.4.6 | Best fidelity candidate; Lottie import "not all features" |
| python-lottie `lottie_convert.py --animated` | AGPLv3+ | Slow (0.7.2, May 2025) | SMIL, but only via Glaxnimate | Yes, if `glaxnimate` module importable | Without glaxnimate: static frame only |
| bodymovin-to-smil | MIT (GitHub) / ISC (npm) | Stale (2022) | SMIL | Node API only; trivial to wrap in a 10-line script | "Basic" features; no trim path / matte / gradient claims |
| bm2smil | MIT | Tiny hobby repo | SMIL | HTTP API only | Wrapper of the above |
| lottie-to-svg | MIT | Stale (2022) | Static frame | Yes | Not animated |
| LottieFiles VS Code / Creator SMIL export | Proprietary, free tier | Yes | SMIL | No (GUI) | Fails the headless constraint |

- Licensing for a publicly shared skill: invoking Glaxnimate (GPL) or python-lottie (AGPL) as an external command-line tool does not by itself impose their licence on the skill's own text or on generated SVG files, but bundling or importing their code into the skill would. This is a general licensing reading, not legal advice and not sourced; the report writer should flag it as such.
- macOS is the weak spot for the "headless on macOS and Linux" constraint: the pip wheel is Linux-only, so on macOS the agent would need a Glaxnimate app install (and its bundled CLI) or a Linux container. This makes a pure-JS route (bodymovin-to-smil, or a custom converter) or direct SVG authoring more portable.
- Because every animated route emits SMIL and none emits CSS keyframes, a skill wanting CSS output from Lottie has to write its own converter (sample keyframes from the Lottie JSON and emit `@keyframes`), or skip Lottie and author CSS directly.

### Gaps
- No converter was executed, so actual fidelity for trim paths, mattes, gradients and bezier easing (keySplines) in Glaxnimate's and bodymovin-to-smil's output is unverified. Glaxnimate's docs say only "not all features are implemented" without a list. A test matrix on 5-10 sample Lotties is needed.
- Exact Glaxnimate CLI flags for export were not found in documentation; run `glaxnimate --help` on an installed copy.
- The lxr.kde.org CHANGELOG copy tops out at 0.5.5 while PyPI has 0.6.0.3, so changes in 0.5.6-0.6.x (including any SVG export fixes) were not reviewed.
- Whether a Homebrew formula/cask or official macOS build of Glaxnimate with a usable CLI exists in November 2026 was not verified.
- npm `time.modified` values from 2022 may reflect registry-wide metadata touches rather than last publish; the real last-publish dates for bodymovin-to-smil and lottie-to-svg could be older.
- ThorVG, rlottie, Skottie and dotlottie-rs were not checked for SVG export; no search result suggested any of them emit animated SVG.

## 3. lottie-web's SVG renderer versus a standalone animated SVG

### Takeaway
lottie-web's "SVG renderer" is a JavaScript runtime that rewrites SVG DOM attributes every frame; the SVG it produces is not self-animating. Inlining the player in a `<script>` inside an .svg file is technically a single file but dies in every image context because scripts are disabled there.

### Cited Findings
- lottie-web (npm 5.13.0, MIT, registry modified 2025-05-21) describes itself as "After Effects plugin for exporting animations to SVG + JavaScript or canvas + JavaScript": JS is part of the deliverable. — [npm lottie-web](https://www.npmjs.com/package/lottie-web)
- SVG used as an image has JavaScript disabled and cannot load external resources; SVG opened directly or embedded via iframe / object / embed is not restricted. — [MDN: SVG as an image](https://developer.mozilla.org/en-US/docs/Web/SVG/Guides/SVG_as_an_image)
- GitHub strips `<script>` from README content. — [CSS-Tricks](https://css-tricks.com/custom-styles-in-github-readmes/)
- A GreenSock forum thread asking whether a standalone SVG with embedded GSAP is possible exists, indicating the same script-in-SVG pattern is known for other JS engines (search snippet only; answers not read). — [GSAP forum: Standalone SVG with GSAP](https://greensock.com/forums/topic/35663-standalone-svg-with-gsap/)
- A 2026 skill guide positions `@lottiefiles/dotlottie-web` (canvas + WASM) as superseding lottie-web, with lottie-web suitable "only for legacy .json + SVG renderer needs" (search snippet only). — [ui-skills: lottie-animation](https://www.ui-skills.com/skills/iart-ai/lottie-animation/)

### Inferences
- A script-embedded SVG (player source plus animation JSON inlined in a CDATA `<script>`) should play when the .svg is opened directly in a browser tab or loaded through `<object>` / `<iframe>`, and should render as an empty or static image in `<img>`, CSS backgrounds, GitHub READMEs, email, and any host with a Content-Security-Policy that blocks inline script. This follows from the MDN restrictions; it was not tested.
- It also carries the whole player (hundreds of KB minified for lottie-web; exact size not sourced here) in every file, which defeats the size argument for SVG.
- Therefore the skill should treat "Lottie plus runtime inside SVG" as a non-option for the stated deliverable (must animate inside an img tag) and use it at most as an HTML-preview technique.
- The lottie-to-svg static-frame tools work by running lottie-web in a DOM shim and serialising one frame; sampling many frames the same way and emitting a frame-by-frame SMIL/CSS visibility flipbook is possible but produces very large files.

### Gaps
- No source was found that documents an inlined lottie-web-in-SVG file end to end; behaviour described is inferred.
- Minified size of lottie-web / lottie_light builds was not looked up.

## 4. Direct authoring of SVG plus CSS keyframes or SMIL by an LLM: reliability and best practices

### Takeaway
For icon- and illustration-scale motion, direct authoring avoids the weakest link (the thin, SMIL-only, partly stale converter layer) and uses features with years of cross-browser support, so it is the more dependable primary path; Lottie remains better for complex, designer-grade motion (mattes, trim paths with offsets, expressions, time remapping, runtime control). One hard limit to encode in the skill: CSS `d` path morphing does not work in Safari, so morphs must use SMIL `<animate attributeName="d">`.

### Cited Findings
- CSS `d` property: applies only to `<path>`; value `path("...")`; overrides the `d` attribute; MDN labels it "Limited availability ... not Baseline because it does not work in some of the most widely-used browsers". Its animation example notes the target path "has the same number of data points as the default state, making the path animatable". — [MDN: d](https://developer.mozilla.org/en-US/docs/Web/CSS/d)
- CSS `d` support in browser-compat-data: Chrome 52, Edge (mirrors Chrome), Firefox 97, Safari: not supported, with the note "The property parses, but has no effect"; iOS Safari mirrors Safari. — [MDN browser-compat-data css/properties/d.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/d.json)
- `transform-box`: supported Chrome 64, Edge 64 (as mirrored), Firefox 55, Safari 11, iOS Safari 11; values `fill-box` and `view-box` from those versions; `stroke-box` and `content-box` only from Chrome 118, Firefox 125, Safari 13.1. — [MDN browser-compat-data css/properties/transform-box.json](https://raw.githubusercontent.com/mdn/browser-compat-data/main/css/properties/transform-box.json)
- SMIL (the mechanism needed for `d` morphing in Safari and for `animateMotion`) has 97.4% global support. — [caniuse svg-smil data](https://raw.githubusercontent.com/Fyrd/caniuse/main/features-json/svg-smil.json)
- Lottie feature portability problems reported by other tools, which indicate what does not map cleanly onto plain SVG: SVGator lists trim path as supported on export but repeater and merge paths as not supported; other compatibility guides say luma mattes are inconsistent and alpha is preferred, expressions are only partially supported, and complex gradients may be simplified (all search snippet only). — [SVGator: Lottie support](https://www.svgator.com/help/export-and-file-formats/lottie-support-in-svgator); [LottieFiles: Lottie compatibility](https://docs.lottiefiles.com/en/integrations/after-effects/09_lottie-compatibility.md)
- Animated SVG (SMIL) export from Lottie loses themes, state machines, multi-animation and "Lottie runtime controls". — [LottieFiles docs](https://docs.lottiefiles.com/en/integrations/vscode/05_integrate/choosing-an-output-format.md)
- A third-party guide's rule of thumb: use SMIL for a self-contained asset, GSAP for coordinated, scrubbable, scroll-tied work, and inline the SVG in the DOM (not img) when CSS/JS from the page must reach its internals (search snippet only). — [ui-skills: svg-animation](https://www.ui-skills.com/skills/iart-ai/svg-animation/)
- Published agent skills for SVG animation already exist (for example EpicenterHQ "svg-animations", iart-ai "svg-animation"), which is prior art for the skill being designed (search snippet only; contents not reviewed). — [tessl registry: svg-animations](https://tessl.io/registry/skills/github/EpicenterHQ/epicenter/svg-animations)

### Inferences
The practices below are standard SVG/CSS technique from background knowledge, cross-checked against the compatibility data above where possible; apart from the cited support data they were not individually sourced in this research and should be validated by rendering tests.
- Transforms: put `transform-box: fill-box; transform-origin: center;` on every element that rotates or scales, otherwise the origin is the SVG viewport origin. `fill-box` is safe everywhere current; avoid `stroke-box` if old Safari matters. Animate a wrapping `<g>` rather than an element that already has a `transform` attribute, since a CSS transform replaces the attribute transform.
- Line drawing (the trim-path substitute): set `pathLength="1"` on the path, `stroke-dasharray: 1; stroke-dashoffset: 1`, animate dashoffset to 0. This covers a simple trim start/end; simultaneous start, end and offset animation needs dasharray plus dashoffset keyframes and is where Lottie is easier.
- Morphing: use SMIL `<animate attributeName="d" values="A;B;A" dur=".." repeatCount="indefinite"/>` because CSS `d` is dead in Safari. Both paths must have identical command sequences and point counts; an LLM should generate morph targets by perturbing coordinates of one path, never by writing two independent paths.
- Easing: CSS uses `animation-timing-function: cubic-bezier(x1,y1,x2,y2)` per keyframe interval; SMIL needs `calcMode="spline"` plus `keyTimes` and one `keySplines` entry per interval (n values need n-1 splines), a frequent source of silently non-running animations when counts mismatch. Lottie's per-keyframe bezier handles map directly onto either.
- Looping and sequencing: CSS `animation-iteration-count: infinite` with `animation-delay` staggering; for multi-step choreography, give all animations the same total duration and place motion inside percentage ranges so loops stay in sync. SMIL can chain with `begin="other.end"` but that is easier to get wrong.
- Reduced motion: include `@media (prefers-reduced-motion: reduce) { * { animation: none !important; } }` inside the SVG `<style>`. This only stops CSS animations; SMIL has no media-query switch, which is an accessibility argument for CSS-first authoring with SMIL only where required (morphs, motion along a path if `offset-path` is not used).
- Self-containment rules: one file, `viewBox` set, unique id / class prefixes (inline SVGs share the page namespace), no external fonts or images, no script, no `:hover`-dependent behaviour if the target is img.
- What Lottie can do that CSS/SMIL SVG cannot do, or only awkwardly: runtime control (seek, speed, segments, interactivity, state machines, theming); expressions; time remapping of nested precomps; track mattes with animated content and inverted/luma modes (SVG masks exist but get heavy); trim paths with offset on multi-shape groups; repeaters, merge paths, rounded-corner and other shape modifiers as live animated operators; per-vertex animated bezier shapes with arbitrary easing per keyframe (SVG requires matching path structure); animated gradients (SMIL can animate stops, CSS cannot animate gradient geometry); consistent rendering on native iOS/Android via native players; and the dotLottie container (compression, multiple animations).
- What direct SVG does better: zero runtime, works in img / README / CSS background, trivially diffable and LLM-inspectable text, system `prefers-color-scheme` and `prefers-reduced-motion` handling, `currentColor` theming when inlined.
- Reliability argument: an LLM writing Lottie JSON must get a deeply nested, index-heavy schema right and then pass through a lossy SMIL converter; an LLM writing SVG plus CSS is producing the final artifact directly in a format heavily represented in training data. For the specific deliverable "animated .svg", direct authoring removes two failure points. For a deliverable that must also ship as .json / .lottie, authoring in Lottie and converting is the only single-source route.

### Gaps
- No empirical study comparing LLM success rates on Lottie JSON versus SVG+CSS was found; the reliability claim is reasoned, not measured.
- MDN pages for `transform-origin` on SVG, `stroke-dashoffset`, `keySplines`, `offset-path` and `prefers-reduced-motion` inside SVG images were not fetched; the practices above need citations added or testing.
- Whether `prefers-reduced-motion` and `prefers-color-scheme` media queries evaluate correctly inside img-embedded SVG in all three engines was not verified (one commenter reports color-scheme working on GitHub web, not in its mobile apps).
- Safari's lack of CSS `d` is per browser-compat-data as fetched on 2026-11-13; confirm against the latest Safari release notes if morphing via CSS is important.

## 5. Free tools going the other way: SVG to Lottie

### Takeaway
Glaxnimate and python-lottie are the open-source options that import animated (SMIL) SVG and write Lottie JSON headlessly; LottieFiles' free web converter is built on python-lottie; the JS options are static-only or experimental. CSS-keyframe-animated SVG input is poorly covered: only a Flutter package claims it.

### Cited Findings
- python-lottie README lists SVG / SVGz with both "Import" and "Import Animated" supported, and lottie / tgs / dotLottie animated export; conversion via `lottie_convert.py`. — [python-lottie README](https://gitlab.com/mattbas/python-lottie/-/raw/master/README.md)
- Glaxnimate loads SMIL animations from SVG (0.3.1), added `animateMotion` loading in 0.5.4, supports most Inkscape extra attributes, and saves Lottie, TGS and dotLottie. — [Glaxnimate docs: formats](https://docs.glaxnimate.org/en/formats.html); [Glaxnimate CHANGELOG](https://lxr.kde.org/source/graphics/glaxnimate/CHANGELOG.md)
- The Glaxnimate PyPI page's own example is exactly "convert animated SVG to Lottie" in a headless environment (code lines quoted in section 2). — [PyPI glaxnimate](https://pypi.org/project/glaxnimate/)
- LottieFiles hosts free "SVG to Lottie" and "Animated SVG to Lottie" web tools; the converter source is based on python-lottie under AGPL, and the tool "does not support advanced animation presets with complex interactions" (search snippet only). — [LottieFiles animated SVG to Lottie](https://lottiefiles.com/tools/animated-svg-to-lottie); [LottieFiles SVG to Lottie](https://lottiefiles.com/svg-to-lottie)
- npm `svg-to-lottie` (stepancar): version 0.0.1, MIT, registry modified 2025-11-07, "JavaScript library for converting SVG files to Lottie animation format". — [npm svg-to-lottie](https://www.npmjs.com/package/svg-to-lottie)
- No `@lottiefiles/svg-to-lottie` package exists on npm (404 on 2026-11-13). — [npm registry lookup](https://www.npmjs.com/package/@lottiefiles/svg-to-lottie)
- `anim_svg` (Flutter/Dart, pub.dev): reads animated SVG with SMIL, CSS `@keyframes` and motion paths and emits a Lottie 5.7 document at runtime for the ThorVG renderer; marked experimental with unstable API (search snippet only). — [pub.dev anim_svg](https://pub.dev/documentation/anim_svg/latest/)

### Inferences
- For a headless agent: static SVG to Lottie is dependable with python-lottie alone (pure Python); SMIL-animated SVG to Lottie is best attempted with Glaxnimate (Linux wheel) or python-lottie's importer; CSS-animated SVG to Lottie has no dependable free CLI route, so an SVG-first skill that also wants Lottie output should author the animation in SMIL, or keep a neutral keyframe description and emit both formats from it.
- A dual-output design (one internal timeline spec, two emitters: Lottie JSON and SVG+CSS/SMIL) avoids depending on any converter in either direction.

### Gaps
- Quality of SMIL import in python-lottie versus Glaxnimate (which SMIL attributes, `keySplines`, `begin` chaining, `animateMotion`) was not tested or documented in sources read.
- `svg-to-lottie` 0.0.1's handling of animation was not checked; at version 0.0.1 assume static only.
- The claim that LottieFiles' converter is python-lottie-based comes from a search summary and was not confirmed on a LottieFiles page.

## 6. Free optimizers for animated SVG, and size comparisons

### Takeaway
SVGO (MIT, v4.1.0, August 2026) is the standard free optimizer, but its default preset includes several plugins that can break animation and must be overridden. No trustworthy like-for-like size comparison of animated SVG against Lottie JSON / dotLottie was found; only Lottie JSON versus dotLottie numbers exist, mostly vendor-reported.

### Cited Findings
- SVGO: npm version 4.1.0, MIT, registry modified 2026-08-24; "Node.js library and command-line application for optimizing vector images". — [npm svgo](https://www.npmjs.com/package/svgo)
- `preset-default` includes, in order: removeDoctype, removeXMLProcInst, removeComments, removeMetadata, removeEditorsNSData, cleanupAttrs, mergeStyles, inlineStyles, minifyStyles, cleanupIds, removeUselessDefs, cleanupNumericValues, convertColors, removeUnknownsAndDefaults, removeNonInheritableGroupAttrs, removeUselessStrokeAndFill, cleanupEnableBackground, removeHiddenElems, removeEmptyText, convertShapeToPath, convertEllipseToCircle, moveElemsAttrsToGroup, moveGroupAttrsToElems, collapseGroups, convertPathData, convertTransform, removeEmptyAttrs, removeEmptyContainers, removeUnusedNS, mergePaths, sortAttrs, sortDefsChildren, removeDesc. `removeViewBox` is not in the default preset. Plugins are disabled with `overrides: { cleanupIds: false }` inside the `preset-default` entry. — [SVGO docs: preset-default](https://svgo.dev/docs/preset-default/)
- `removeHiddenElems` removes elements with zero width/height or hidden via CSS/attributes. — [SVGO docs: removeHiddenElems](https://svgo.dev/docs/plugins/removeHiddenElems/)
- SVGOMG's guide advises keeping `cleanupIds` off when animations or external stylesheets depend on fixed ID values, and recommends disabling risky plugins then re-enabling one at a time (search snippet only). — [SVGOMG guide: cleanupIds](https://svgomg.net/plugins/cleanup-ids/); [SVGOMG: high-risk transforms](https://svgomg.net/guides/high-risk-transforms/)
- Lottie JSON versus dotLottie, LottieFiles' example: 291.4 KB JSON, 227.8 KB optimized JSON, 24 KB dotLottie, 20.3 KB optimized dotLottie. A separate small-animation example quoted from a Rive article: 10.5 KB JSON, 1.8 KB dotLottie, 1.4 KB optimized dotLottie. Blog estimate for a typical 2-second UI animation: 40-120 KB JSON versus 15-50 KB dotLottie (all search snippet only; vendor or promotional sources). — [LottieFiles: optimize Lottie files](https://lottiefiles.com/blog/working-with-lottie-animations/optimize-lottie-files-for-faster-page-load-speeds.md); [DEV: dotLottie vs Lottie JSON](https://dev.to/fazalshah/dotlottie-vs-lottie-json-which-should-you-use-in-2025-1a2)

### Inferences
- Suggested animation-safe SVGO config for the skill (to be validated by rendering before/after): keep `preset-default` but override to false `cleanupIds` (SMIL `href="#id"`, `begin="id.end"` and CSS `#id` selectors), `removeHiddenElems` (elements that start at opacity 0 / display none / zero size and are revealed by animation), `inlineStyles` and `minifyStyles` (could move or drop `@keyframes` and rules it judges unused), `mergePaths`, `collapseGroups`, `moveGroupAttrsToElems` / `moveElemsAttrsToGroup` (destroy the per-element or per-group structure that animations and `transform-box` rely on), `convertShapeToPath` (breaks animating `r`, `cx`, `width`), `convertPathData` (can change command structure so SMIL `d` morph values no longer match), `convertTransform`, `removeUnknownsAndDefaults` and `removeUselessStrokeAndFill` (may delete attributes that are animation start values). Safe gains remain from comment/metadata removal, numeric precision and colour shortening. The specific breakage mechanisms are reasoned from plugin behaviour, not from documented bug reports.
- Hand-authored SVG+CSS icon animations are usually a few KB before gzip and need no runtime, whereas Lottie needs a player on the page in addition to the JSON; so for simple icons total bytes shipped favour SVG. For long or shape-keyframe-heavy animation converted to SMIL, SVG size grows with every keyframe value written as text and can exceed dotLottie. This is reasoning, not measurement.
- SVG is served as text and benefits from gzip/brotli transfer compression, narrowing the gap with dotLottie's zip container. (Background knowledge.)

### Gaps
- No measured comparison of the same animation as animated SVG, Lottie JSON and dotLottie was found; the skill author should measure on a few sample animations.
- SVGO's documentation was not searched for an official "animation-safe" recommendation; the override list above is conservative inference.
- Other optimizers (svgcleaner, scour, oxvg) were not researched for animation safety.

## 7. Tools that record or flatten a JS-driven animation (GSAP, anime.js, Motion) into standalone SMIL/CSS SVG

### Takeaway
No established open-source tool was found that bakes a GSAP / anime.js / Motion timeline into a self-contained SMIL or CSS animated SVG. Existing exporters target video or GIF; the adjacent SVG tools convert between SMIL and CSS or are commercial.

### Cited Findings
- `gsap-video-export` is an npm command-line tool that exports GSAP animations to video, not SVG (search snippet only). — [npm gsap-video-export](https://www.npmjs.com/package/gsap-video-export)
- A GreenSock forum thread asks whether a standalone SVG with GSAP animations is possible; no finished tool is evident from the summary (search snippet only). — [GSAP forum](https://greensock.com/forums/topic/35663-standalone-svg-with-gsap/)
- `smil2css` (npm 0.1.0, registry modified 2022-06-26) converts SMIL to CSS but "only frame-by-frame animations are converted". — [npm smil2css](https://www.npmjs.com/package/smil2css)
- `port-smil-to-css` is a small ISC-licensed demo for porting SMIL to CSS (search snippet only). — [ecosyste.ms: port-smil-to-css](https://awesome.ecosyste.ms/projects/github.com%2Fdotnetcarpenter%2Fport-smil-to-css)
- Other names surfaced but not evaluated: PrimmR/SMILer (GitHub), CSSVG (a product converting SVG animations into CSS), a DEV post on an SVG animation tool that "ships zero JavaScript" (search snippet only; licences and scope unknown). — [PrimmR/SMILer](https://github.com/PrimmR/SMILer); [Indie Hackers: CSSVG](https://www.indiehackers.com/product/cssvg); [DEV: SVG animation tool that ships zero JavaScript](https://dev.to/harijn72/why-i-built-an-svg-animation-tool-that-ships-zero-javascript-5e96)
- Rive users have an open feature request for animated SVG (SMIL) export, indicating that tool does not offer it (search snippet only). — [Rive community feature request](https://rive.app/community/forums/feature-requests/fsyCzA4A9Yar/ability-to-export-animated-svg-smil/ftn0m8jxL51j)
- Related raster fallbacks: `svg2gifpy` renders animated SVG to GIF via headless Chromium; `resnbl/svg2apng` converts animated SVG to APNG (search snippet only). — [PyPI svg2gifpy](https://pypi.org/project/svg2gifpy/); [resnbl/svg2apng](https://github.com/resnbl/svg2apng)

### Inferences
- A generic "flattener" is feasible for an agent to build with free parts: run the JS animation in headless Chromium (Playwright), sample each animated element's attributes / computed transform at N steps across the timeline, then emit per-element CSS `@keyframes` (percent = sample time) or SMIL `values` / `keyTimes` lists with linear interpolation. Cost: file size scales with sample count times element count, and structural DOM changes cannot be captured. This is a design sketch, not an existing tool.
- Since tweens in GSAP / anime.js / Motion are just property, from/to, duration, delay and ease, an LLM can more cheaply write the CSS keyframes directly than record a JS run; flattening only pays off for physics, stagger functions or procedural motion.
- Playwright-based frame sampling is also the right verification harness for the skill: render the produced SVG in headless Chromium and WebKit, screenshot at several timestamps, and check that frames differ (animation actually runs).

### Gaps
- PrimmR/SMILer, CSSVG and the "zero JavaScript" tool were not opened; one of them may be a usable open-source flattener. Worth a follow-up look.
- No search was made specifically for anime.js or Motion (motion.dev) exporters; the negative finding is based mainly on GSAP-oriented queries.
- Web Animations API `getKeyframes()` based exporters were not searched for.
