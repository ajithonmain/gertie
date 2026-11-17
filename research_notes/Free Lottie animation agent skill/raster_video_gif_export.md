# Raster / video / GIF export of Lottie, animated SVG and HTML animations (free, headless, state as of 2026-11-13)

Conventions used in these notes:
- "LOCAL TEST" = command executed by the researcher on 2026-11-13 on macOS arm64 with Homebrew ffmpeg 7.1.1 and libwebp `img2webp`, against a synthetic 512x512, 30 fps, 3 s (90 frame) RGBA PNG sequence (anti-aliased moving gradient disc on transparent background). Homebrew's current ffmpeg is 9.0.2, so option behaviour should be re-checked on newer builds.
- "REGISTRY" = value read directly from the npm registry JSON, Homebrew formula JSON API or GitHub REST API on 2026-11-13.
- Frame naming assumed in commands: `frames/f_%04d.png` (RGBA PNG), `FPS=30`.

## 1. What free renderers turn Lottie into frames or video headlessly?

### Takeaway
The most robust free pipeline in late 2026 is "renderer writes RGBA PNG frames, ffmpeg encodes": either lottie-web inside current Puppeteer/Playwright with `goToAndStop(frame, true)` + `omitBackground` screenshots (highest After Effects feature fidelity, slowest), or a browserless native renderer in Node (`@napi-rs/canvas` Skottie `LottieAnimation`, or `@lottiefiles/dotlottie-web` ThorVG on a `@napi-rs/canvas` canvas). The old one-command wrappers (puppeteer-lottie, puppeteer-lottie-cli, timecut/timesnap) are pinned to Puppeteer 2.x from 2020-2022 and should be treated as unmaintained; rlottie is declared deprecated; python-lottie and gifski are AGPL; Remotion needs a paid company licence above 3 people.

### Cited Findings

Comparison table (dates/versions are REGISTRY values unless a link says otherwise):

| Tool | Licence | Latest release / status | Install | Outputs | Alpha |
|---|---|---|---|---|---|
| puppeteer-lottie | MIT | npm 1.1.2, 2020-07-18; depends on `puppeteer ^2.1.1`, `lottie-web ^5.7.0`; repo last pushed 2023-07-25 | `npm i puppeteer-lottie` | PNG/JPG still, PNG sequence (`frame-%d.png`), GIF (needs gifski), MP4 (needs ffmpeg) | PNG frames transparent; GIF/MP4 paths opaque by design |
| puppeteer-lottie-cli | MIT | npm 1.0.9, 2020-03-29 | `npm i -g puppeteer-lottie-cli` | same as above | `-b` background defaults to transparent |
| lottie-web (driven by own Puppeteer/Playwright script) | MIT | lottie-web 5.13.0 (2025-05-21); puppeteer 25.17.0 (2026-11-10, Node >=22.12); playwright 1.65.0 (2026-11-05, Node >=20) | `npm i lottie-web playwright && npx playwright install chromium` | PNG sequence -> anything via ffmpeg | yes (`omitBackground: true`) |
| @napi-rs/canvas `LottieAnimation` (Skia Skottie) | MIT | 1.1.1, 2026-11-12 | `npm i @napi-rs/canvas` | canvas -> PNG frames | yes (do not fill the canvas) |
| @lottiefiles/dotlottie-web (ThorVG WASM) in Node | MIT | 0.83.2, 2026-11-12, Node >=18.17 | `npm i @lottiefiles/dotlottie-web @napi-rs/canvas` | canvas pixels -> PNG/GIF | yes |
| dotlottie-rs | MIT | v0.1.60, 2026-10-28 | Rust crate / C API | library only, no CLI documented | n/a |
| ThorVG `tvg-lottie2gif`, `tvg-svg2png` | MIT | thorvg v1.1.3, 2026-10-15; cli-tools repo pushed 2026-11-06, no tagged release | build from source with Meson | GIF only (Lottie), PNG (SVG) | not documented |
| rlottie `lottie2gif` | repo LICENSE (GitHub reports no single SPDX id) | v0.2, 2020-08-19; README says deprecated | build from source (cmake/meson) | GIF | not documented |
| ed-asriyan/lottie-converter | MIT | v1.2.0, 2026-02-02; pushed 2026-10-14 | Docker `edasriyan/lottie-to-*` or release binaries | GIF, PNG, APNG, WebP, WebM from .json/.lottie/.tgs | `--background` replaces transparent pixels; default behaviour per format not documented |
| python-lottie (`lottie` on PyPI) | AGPL-3.0-or-later | 0.7.2, 2025-05-01 | `pip install "lottie[all]"` | PNG, GIF, WebP, MP4, AVI, WebM, SVG, TGS, dotLottie, HTML, TIFF | not documented |
| Remotion + @remotion/lottie | Remotion Licence (not OSI) | 4.0.543, 2026-11-11 | `npx create-video@latest`, `npm i @remotion/lottie` | MP4, WebM (alpha), ProRes 4444 (alpha), GIF, PNG sequence | yes |
| lotio | MIT | 1.1.76, 2026-01-28 | `npm i lotio` | PNG frames, pipe to ffmpeg | not verified |
| canvaskit-wasm (Skottie) | BSD-3-Clause | 0.42.0, 2026-08-18 | `npm i canvaskit-wasm` | surface pixels | yes (not tested) |
| skia-canvas | MIT | 4.0.0, 2026-10-12 | `npm i skia-canvas` | canvas | no Lottie API found |

- puppeteer-lottie renders via lottie-web in Puppeteer to image, image sequence (sprintf pattern such as `frame-%d.png`), GIF ("requires Gifski") or MP4 ("requires FFmpeg"); options include `width`, `height`, `renderer` (default `svg`), `rendererSettings`, `deviceScaleFactor`, `jpegQuality`, `ffmpegOptions` (crf, profileVideo, preset), `gifskiOptions`, `style`, `inject`, `puppeteerOptions`, `browser`; licence MIT — [puppeteer-lottie README](https://github.com/transitive-bullshit/puppeteer-lottie)
- puppeteer-lottie latest npm version is 1.1.2 published 2020-07-18 and it depends on `puppeteer ^2.1.1` and `lottie-web ^5.7.0` — [npm registry](https://registry.npmjs.org/puppeteer-lottie)
- puppeteer-lottie-cli usage: `puppeteer-lottie -i anim.json -o out.mp4`, `puppeteer-lottie -i anim.json -o out.gif --width 640`, `puppeteer-lottie -i anim.json -o 'frame-%d.png' --width 1024 --height 1024`; `-b, --background` is a CSS colour that defaults to transparent — [puppeteer-lottie-cli README](https://github.com/transitive-bullshit/puppeteer-lottie-cli)
- puppeteer-lottie-cli latest npm version is 1.0.9, published 2020-03-29 — [npm registry](https://registry.npmjs.org/puppeteer-lottie-cli)
- Current Puppeteer is 25.17.0 (2026-11-10) and requires Node >= 22.12; current Playwright is 1.65.0 (2026-11-05) and requires Node >= 20 — [npm puppeteer](https://registry.npmjs.org/puppeteer), [npm playwright](https://registry.npmjs.org/playwright)
- lottie-web latest is 5.13.0, published 2025-05-21, MIT — [npm registry](https://registry.npmjs.org/lottie-web)
- `@napi-rs/canvas` ships a `LottieAnimation` class backed by Skia's Skottie: `LottieAnimation.loadFromFile('animation.json')`, `loadFromData(json, { resourcePath })`, properties `duration`, `fps`, `frames`, `width`, `height`, methods `seekFrame(n)`, `seek(seconds)`, `render(ctx)` or `render(ctx, {x, y, width, height})`; it supports embedded base64 images, embedded fonts, external assets and dotLottie `.lottie` files; the README claims zero system dependencies and has an `example/lottie-to-video.ts` — [Brooooooklyn/canvas README](https://github.com/Brooooooklyn/canvas)
- `@napi-rs/canvas` latest is 1.1.1 (2026-11-12), MIT — [npm registry](https://registry.npmjs.org/@napi-rs/canvas)
- LottieFiles states dotlottie-web is isomorphic (browser and Node) thanks to ThorVG, and recommends `@napi-rs/canvas` as the Node canvas; its tutorial builds a GIF by listening to `load`, `frame` and `complete` events with `useFrameInterpolation: false`, `loop: false`, reading `ctx.getImageData()` per frame (tutorial pins the very old 0.11.1) — [LottieFiles blog](https://lottiefiles.com/blog/working-with-lottie-animations/converting-dotlottie-animations-to-gifs-with-dotlottie-web-player.md)
- `@lottiefiles/dotlottie-web` latest is 0.83.2 (2026-11-12), MIT, Node >= 18.17 — [npm registry](https://registry.npmjs.org/@lottiefiles/dotlottie-web)
- dotlottie-rs is the MIT Rust runtime (ThorVG vendored) behind the official dotLottie players, with a C API and wasm-bindgen bindings; its README documents no CLI or frame-export command — [dotlottie-rs README](https://github.com/LottieFiles/dotlottie-rs); latest release v0.1.60 on 2026-10-28 — [GitHub API](https://api.github.com/repos/LottieFiles/dotlottie-rs/releases/latest)
- ThorVG CLI tools live in a separate repo: `tvg-lottie2gif [Lottie file] or [Lottie folder] [-r resolution] [-f fps] [-b background color]` (`-r 600x600`, `-b fa7410`; if `-b` is omitted "the background follows the original content"), and `tvg-svg2png [SVG files] [-r resolution] [-b bgColor]`; build needs Meson, Ninja, a C++14 compiler and an installed ThorVG with Lottie loader and GIF saver; MIT — [thorvg.cli-tools README](https://github.com/thorvg/thorvg.cli-tools)
- ThorVG is MIT, latest release v1.1.3 (2026-10-15), and is in Homebrew core as a library formula (1.1.3) — [GitHub API](https://api.github.com/repos/thorvg/thorvg/releases/latest), [Homebrew formula](https://formulae.brew.sh/formula/thorvg)
- Samsung/rlottie's README states the project is deprecated, "is no longer maintained", with no security support, patches or releases; its example tool usage is only `lottie2gif [lottie file name]`; it builds with `meson build && ninja -C build` or CMake — [rlottie README](https://github.com/Samsung/rlottie); the GitHub API still reports `archived=false`, last push 2026-09-30, latest release v0.2 from 2020-08-19 — [GitHub API](https://api.github.com/repos/Samsung/rlottie)
- ed-asriyan/lottie-converter converts `.json`, `.lottie` and Telegram `.tgs` to GIF, PNG, APNG, WebP and WebM. Docker: `docker run --rm -v <dir>:/source edasriyan/lottie-to-gif` (also `lottie-to-png`, `lottie-to-apng`, `lottie-to-webp`, `lottie-to-webm`) with env vars `WIDTH` (512), `HEIGHT` (512), `FPS` (60 for APNG/PNG/WebP, 50 for GIF), `QUALITY` (90), `THREADS`, `BACKGROUND` ("Background color to replace transparent pixels"). Binaries: `./bin/lottie_to_gif.sh [--output OUTPUT] [--height H] [--width W] [--threads N] [--fps FPS] [--quality Q] [--background BG] path`; prebuilt executables need gifski (GIF), ffmpeg (APNG/WebM) and img2webp (WebP) on PATH — [lottie-converter README](https://github.com/ed-asriyan/lottie-converter)
- lottie-converter latest release is v1.2.0 (2026-02-02), MIT, last push 2026-10-14 — [GitHub API](https://api.github.com/repos/ed-asriyan/lottie-converter/releases/latest)
- python-lottie (`lottie` on PyPI) is AGPLv3+, latest 0.7.2 uploaded 2025-05-01; extras: `gif` = glaxnimate + pillow, `png` = glaxnimate, `pdf` = cairosvg, `video` = opencv-python + pillow + numpy, `all` = everything — [PyPI JSON](https://pypi.org/pypi/lottie/json)
- python-lottie docs: animated export supported for lottie, tgs, SVG, WebP, dotLottie, GIF, TIFF, MP4, AVI, WebM, HTML; PNG is still-only. Requirements table: glaxnimate "To export PNG"; cairosvg "To export PNG / PDF / PS"; glaxnimate + pillow "To export GIF and animated WebP"; cairosvg + numpy + Python OpenCV 2 "To export video". Usage: `lottie_convert.py input.json output.webp`, `lottie_convert.py input.json output.png --frame 30`, `lottie_convert.py AnimatedSticker.tgs output.webp`, `lottie_convert.py input.json output.tgs`, `tgs_check.py AnimatedSticker.tgs`; output format follows the file extension — [python-lottie docs](https://mattbas.gitlab.io/python-lottie/index.html)
- Conflict inside python-lottie's own material: the docs quick-start says `pip install lottie[GIF]` installs cairosvg and pillow, while the PyPI metadata for 0.7.2 lists the `gif` extra as glaxnimate + pillow — [python-lottie docs](https://mattbas.gitlab.io/python-lottie/index.html); contradicted by [PyPI JSON](https://pypi.org/pypi/lottie/json)
- Glaxnimate's formats page lists Lottie, TGS (with Telegram validation on save), SVG (SMIL export since 0.3.1) and raster frame rendering; it documents no command-line or headless export — [Glaxnimate formats](https://docs.glaxnimate.org/en/formats.html). Glaxnimate is not in Homebrew core — [Homebrew API](https://formulae.brew.sh/api/formula/glaxnimate.json)
- Remotion's free licence is for "individuals and companies of up to 3 people"; otherwise a Company Licence is required: "Remotion for Automators" at $0.01 per render with a $100/month minimum, or "Remotion for Creators" at $25/month per seat; Enterprise from $500/month — [Remotion pricing](https://www.remotion.dev/docs/license/pricing)
- Remotion's npm package declares `SEE LICENSE IN LICENSE.md` (not an OSI licence); latest 4.0.543 on 2026-11-11; `@remotion/lottie` depends on `lottie-web ^5` — [npm remotion](https://registry.npmjs.org/remotion), [npm @remotion/lottie](https://registry.npmjs.org/@remotion/lottie)
- `@remotion/lottie` usage is `<Lottie animationData={animationData} />` with props `loop`, `direction`, `playbackRate`, `renderer` (`svg` default, `canvas`, `html`), `assetsPath` — [Remotion Lottie docs](https://www.remotion.dev/docs/lottie/lottie)
- Remotion transparent render commands: `remotion render --image-format=png --pixel-format=yuva420p --codec=vp8 my-video video-transparent.webm` (vp9 also allowed) and `--image-format=png --pixel-format=yuva444p10le --codec=prores --prores-profile=4444` — [Remotion transparent videos](https://www.remotion.dev/docs/transparent-videos)
- lotio (npm, MIT, 1.1.76 published 2026-01-28) is described as a Skia-based tool that writes PNG frames from Lottie JSON and can pipe to ffmpeg — [socket.dev lotio](https://socket.dev/npm/package/lotio), [npm registry](https://registry.npmjs.org/lotio)
- skia-canvas 4.0.0 (2026-10-12, MIT) and canvaskit-wasm 0.42.0 (2026-08-18, BSD-3-Clause) are current — [npm skia-canvas](https://registry.npmjs.org/skia-canvas), [npm canvaskit-wasm](https://registry.npmjs.org/canvaskit-wasm)

### Inferences
- puppeteer-lottie / puppeteer-lottie-cli will pull Puppeteer 2.x (2020 Chromium r7xx download) on install. That is 23 major versions behind Puppeteer 25 and should be presented in the skill as "legacy, may fail to download or launch Chromium on Apple Silicon / current Linux", not as the default. This breakage is inferred from the dependency pin; it was not reproduced in this session.
- Recommended default for the skill (highest fidelity, fully free, MIT/Apache): a ~40-line script using lottie-web + Playwright or Puppeteer. Untested sketch (API names are standard but this exact script was NOT executed in this session):

```js
// render-lottie.mjs  usage: node render-lottie.mjs anim.json frames 512 512
import { chromium } from 'playwright';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const [,, src, outDir = 'frames', W = 512, H = 512] = process.argv;
const data = JSON.parse(fs.readFileSync(src, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 });
await page.setContent(`<style>html,body{margin:0;background:transparent}#a{width:${W}px;height:${H}px}</style><div id="a"></div>`);
await page.addScriptTag({ path: require.resolve('lottie-web/build/player/lottie.min.js') });
const total = await page.evaluate((animationData) => new Promise((res) => {
  const anim = window.anim = lottie.loadAnimation({ container: document.getElementById('a'),
    renderer: 'svg', loop: false, autoplay: false, animationData });
  anim.addEventListener('DOMLoaded', () => res(anim.totalFrames));
}), data);
for (let f = 0; f < total; f++) {
  await page.evaluate((f) => window.anim.goToAndStop(f, true), f);   // true = value is a frame number
  await page.locator('#a').screenshot({ path: `${outDir}/f_${String(f).padStart(4, '0')}.png`, omitBackground: true });
}
console.log(JSON.stringify({ frames: total, fps: data.fr, w: data.w, h: data.h }));
await browser.close();
```
  Then `ffmpeg -framerate <data.fr> -i frames/f_%04d.png ...` using the commands in section 2. Puppeteer equivalent: `page.screenshot({ path, omitBackground: true })` or `elementHandle.screenshot(...)`.
- Fastest browserless option that is still MIT: `@napi-rs/canvas` `LottieAnimation` (Skottie). Untested sketch based on the README API: `const a = LottieAnimation.loadFromFile(src); const c = createCanvas(W, H); const ctx = c.getContext('2d'); for (let f = 0; f < a.frames; f++) { ctx.clearRect(0,0,W,H); a.seekFrame(f); a.render(ctx, {x:0,y:0,width:W,height:H}); fs.writeFileSync(name(f), c.toBuffer('image/png')); }`. Skipping the white `fillRect` shown in the README example should keep alpha. Skottie does not support every lottie-web feature (notably expressions), so fidelity must be checked per file.
- ThorVG-based renderers (dotlottie-web, tvg-lottie2gif) and Skottie are native and avoid a 150 MB+ Chromium download; lottie-web in Chromium is the reference implementation for Bodymovin exports, so it is the fallback when a native renderer mis-renders.
- For a publicly shared skill, avoid making python-lottie (AGPL), gifski (AGPL) or Remotion (commercial licence above 3 people) hard dependencies; offer them as optional paths with the licence stated. Calling an AGPL CLI as a separate process does not by itself relicense the skill, but that is a legal judgement the skill author should confirm, not something these sources settle.

### Gaps
- Relative speed numbers (frames/second) for lottie-web-in-Chromium vs Skottie vs ThorVG vs rlottie: no benchmark source found and none measured here.
- Whether ThorVG `tvg-lottie2gif` and rlottie `lottie2gif` emit transparent GIFs when no background is given: neither README states it.
- Whether lottie-converter keeps alpha by default in APNG/WebP/WebM output: README only documents `BACKGROUND` as a replacement colour. Its underlying renderer is not named in the README (commonly reported to be rlottie; unverified here).
- Glaxnimate CLI rendering flags: no documentation found for a headless `--render`-style export; the search returned nothing authoritative.
- skia-canvas: no evidence of a Skottie/Lottie API; only `@napi-rs/canvas` and canvaskit-wasm were confirmed to expose Skottie. canvaskit-wasm `MakeManagedAnimation` usage in Node was not verified this session.
- dotlottie-web current (0.83.x) Node API for explicit frame stepping (`setFrame`, `buffer`) was only seen on a secondary page; verify against the package README before use.
- "ed's lottie-to-gif style npm packages": no distinct maintained npm package identified beyond ed-asriyan/lottie-converter (Docker/binaries) and lottie-nodejs (1.1.5, 2022-05-13, stale).
- Actual install failure of puppeteer-lottie on current macOS/Linux was not reproduced.

## 2. Exact ffmpeg commands (PNG sequence with alpha -> each target format)

### Takeaway
All eleven recipes below ran successfully in a LOCAL TEST on ffmpeg 7.1.1 (macOS arm64) except where marked; the two real traps found were (a) `libwebp_anim` with `-compression_level 6` ran for more than 3 minutes at 100% CPU on 90 frames and had to be killed, while the default level finished in 1 s, and (b) ffprobe reports VP9-alpha and HEVC-alpha files as `yuv420p`, so alpha must be verified another way.

### Cited Findings

Option reference (from `ffmpeg -h` on the local 7.1.1 build, matching the official filter/codec docs at [ffmpeg-filters](https://ffmpeg.org/ffmpeg-filters.html#palettegen) and [ffmpeg-codecs](https://ffmpeg.org/ffmpeg-codecs.html)):
- `palettegen`: `max_colors` 2-256 (default 256), `reserve_transparent` (default true), `transparency_color` (default "lime"), `stats_mode` full/diff/single (default full) — LOCAL `ffmpeg -h filter=palettegen`; docs at [ffmpeg-filters palettegen](https://ffmpeg.org/ffmpeg-filters.html#palettegen)
- `paletteuse`: `dither` (default `sierra2_4a`), `bayer_scale` 0-5 (default 2), `diff_mode` (default none; `rectangle` available), `new` (default false), `alpha_threshold` 0-255 (default 128) — LOCAL `ffmpeg -h filter=paletteuse`; docs at [ffmpeg-filters paletteuse](https://ffmpeg.org/ffmpeg-filters.html#paletteuse)
- gif encoder: `-gifflags` default `offsetting+transdiff`; gif muxer `-loop` 0 = infinite (default 0), -1 = no loop; `-final_delay` in centiseconds — LOCAL `ffmpeg -h encoder=gif` / `-h muxer=gif`; docs at [ffmpeg-codecs](https://ffmpeg.org/ffmpeg-codecs.html)
- apng muxer: `-plays` 0 = infinite, 1 = no loop (default 1); encoder `-pred` 0-5 (default none) — LOCAL `ffmpeg -h muxer=apng`
- `libwebp_anim` accepts `bgra yuv420p yuva420p`; `-lossless` 0/1 (default 0) — LOCAL `ffmpeg -h encoder=libwebp_anim`
- `prores_ks` accepts `yuv422p10le yuv444p10le yuva444p10le`; profiles `4444` = 4, `4444xq` = 5; `-alpha_bits` 0-16 (default 16) — LOCAL `ffmpeg -h encoder=prores_ks`
- `hevc_videotoolbox` accepts `videotoolbox_vld nv12 yuv420p bgra p010le`; `-alpha_quality` "Compression quality for the alpha channel (from 0 to 1) (default 0)" — LOCAL `ffmpeg -h encoder=hevc_videotoolbox`
- The FFmpeg commit that added HEVC alpha uses the "HEVC Video with Alpha" profile only when `-alpha_quality` is non-zero, and only for BGRA input — [FFmpeg commit mirror](https://git.kx.studio/falkTX/FFmpeg/commit/4892060f50cc91ae6b1b5a3c28346fb9a829c757)
- `-tag:v hvc1` is required for Safari; community recipe `ffmpeg -i input%03d.png -c:v hevc_videotoolbox -allow_sw 1 -alpha_quality 0.75 -vtag hvc1 output.mov` — [StackOverflow mirror](https://kiwix.lema.org/stackoverflow.com_en_all_2023-11/questions/61661140/convert-webm-to-hevc-with-alpha)
- Jake Archibald's HEVC-alpha recipe uses `-c:v hevc_videotoolbox -require_sw 1 -alpha_quality 0.1 -tag:v hvc1 -q:v 35` with `-vf "premultiply=inplace=1"`, and his VP9 recipe uses `-c:v libvpx-vp9 -crf "$CRF" -b:v 0 -deadline best|good -lag-in-frames 25 -row-mt 1` with `-pix_fmt yuva420p` — [jakearchibald.com](https://jakearchibald.com/2024/video-with-transparency/)
- An ffmpeg trac ticket reports "ghosting around a transparent video encoded with hevc_videotoolbox"; premultiply is the usual workaround — [FFmpeg trac #9531](https://trac.ffmpeg.org/ticket/9531)
- Only VideoToolbox (Apple hardware/OS) can encode HEVC with alpha in ffmpeg — [FFmpeg trac #7965](https://trac.ffmpeg.org/ticket/7965)

Copy-pasteable commands (all LOCAL TEST unless noted). Set `FPS` to the Lottie `fr` value.

```bash
# (a) High-quality opaque GIF over a solid colour (white) - two-pass palette in one command
ffmpeg -y -f lavfi -i "color=c=white:s=512x512:r=30" -framerate 30 -i frames/f_%04d.png \
  -filter_complex "[0:v][1:v]overlay=shortest=1,fps=25,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle" \
  -loop 0 opaque.gif
#   NOTE: the GIF variant actually executed had the inputs in the other order (PNG sequence first,
#   colour source second, graph starting "[1:v][0:v]overlay=shortest=1:format=auto,fps=25,split...").
#   The colour-first ordering shown here was executed for the MP4 recipe (h). overlay=shortest=1 is
#   required either way because the lavfi colour source is infinite.

# (b) Transparent GIF (1-bit alpha)
ffmpeg -y -framerate 30 -i frames/f_%04d.png \
  -filter_complex "[0:v]fps=25,split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:alpha_threshold=128" \
  -gifflags -offsetting -loop 0 transparent.gif
#   variant with no dithering (cleaner flat-colour icons) and inter-frame transparency optimisation off:
#   ...paletteuse=dither=none:alpha_threshold=128" -gifflags -offsetting-transdiff -loop 0 out.gif

# (b2) Transparent GIF with a matte: pre-blend semi-transparent edge pixels toward the page colour
#      (NOT locally tested; standard technique) - composite on the matte colour for RGB, keep original alpha:
#   -filter_complex "color=c=0xFFFFFF:s=512x512:r=30[bg];[bg][0:v]overlay=shortest=1[rgb];[0:v]alphaextract[al];[rgb][al]alphamerge,fps=25,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse=alpha_threshold=128"

# (c) APNG (lossless, full 8-bit alpha, infinite loop)
ffmpeg -y -framerate 30 -i frames/f_%04d.png -plays 0 -pred mixed out.apng

# (d) Animated WebP with alpha - ffmpeg
ffmpeg -y -framerate 30 -i frames/f_%04d.png -c:v libwebp_anim -lossless 0 -q:v 80 -loop 0 out.webp
ffmpeg -y -framerate 30 -i frames/f_%04d.png -c:v libwebp_anim -lossless 1 -loop 0 out_lossless.webp
# (d2) Animated WebP with alpha - libwebp's img2webp (-d is per-frame duration in ms: 1000/FPS)
img2webp -loop 0 -d 33 -lossy -q 80 -m 4 frames/f_*.png -o out.webp
img2webp -loop 0 -d 33 -lossless -q 75 -m 4 frames/f_*.png -o out_lossless.webp

# (e) WebM VP9 with alpha (Chrome, Firefox, Edge; Telegram video stickers)
ffmpeg -y -framerate 30 -i frames/f_%04d.png -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 \
  -row-mt 1 -auto-alt-ref 0 -an alpha.webm

# (f) ProRes 4444 with alpha (Premiere, DaVinci Resolve, Final Cut, After Effects, Keynote)
ffmpeg -y -framerate 30 -i frames/f_%04d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le \
  -alpha_bits 16 -vendor apl0 -an alpha_prores.mov

# (g) HEVC with alpha for Safari / iOS - macOS ONLY (VideoToolbox)
ffmpeg -y -framerate 30 -i frames/f_%04d.png -c:v hevc_videotoolbox -allow_sw 1 -alpha_quality 0.75 \
  -q:v 65 -tag:v hvc1 -pix_fmt bgra -an alpha_hevc.mov
#   variant used when edges show dark fringing/ghosting:
#   ... -vf "premultiply=inplace=1" -c:v hevc_videotoolbox -require_sw 1 -alpha_quality 0.75 -q:v 65 -tag:v hvc1 ...

# (h) Plain MP4 H.264 over a solid background colour (universal)
ffmpeg -y -f lavfi -i "color=c=white:s=512x512:r=30" -framerate 30 -i frames/f_%04d.png \
  -filter_complex "[0:v][1:v]overlay=shortest=1,format=yuv420p" -c:v libx264 -crf 18 -preset slow \
  -movflags +faststart -an solid.mp4
```

Verification results from the LOCAL TEST:
- Transparent GIF (b): every one of 75 frames had Graphic Control Extension disposal = 2 (restore to background), transparency flag = 1, delay = 4 cs; this was true both with `-gifflags -offsetting` and with `-gifflags -offsetting-transdiff`. The opaque GIF (a) used disposal = 1 — LOCAL TEST (byte-level parse of the GCE blocks)
- VP9 alpha (e): `ffprobe` shows `pix_fmt=yuv420p` plus stream tag `alpha_mode=1`; decoding with the libvpx decoder forced (`ffmpeg -c:v libvpx-vp9 -i alpha.webm -frames:v 1 chk.png`) yielded an `rgba` PNG, confirming alpha is stored — LOCAL TEST
- ProRes (f): ffprobe reports codec tag `ap4h`, `yuva444p12le` — LOCAL TEST
- HEVC alpha (g): ffprobe reports `hevc, hvc1, yuv420p, profile Main` (ffmpeg does not expose the alpha layer on decode), but the file with `-alpha_quality 0.75` was 83,863 bytes versus 20,159 bytes for the same encode without `-alpha_quality`, consistent with an extra alpha layer being written — LOCAL TEST
- `libwebp_anim` with `-compression_level 6 -pix_fmt yuva420p -q:v 80` did not finish within 3 minutes on 90 frames at 512x512; removing `-compression_level` (default 4) and `-pix_fmt` finished in about 1 s — LOCAL TEST
- A filtergraph that declares an output pad it never consumes fails with "Filter 'split:output0' has output 1 unconnected"; every label must be used — LOCAL TEST

### Inferences
- When reading a VP9-alpha WebM back in ffmpeg (for example to convert to another alpha format) force the decoder with `-c:v libvpx-vp9` before `-i`; the native decoder drops alpha. This follows from the ffprobe/`-c:v libvpx-vp9` behaviour seen in the local test.
- `-auto-alt-ref 0` is the widely used safety flag for VP9/VP8 alpha encodes; the local encode succeeded with it. Whether current libvpx still requires it for VP9 was not tested.
- HEVC alpha cannot be produced on Linux with free tools; a Linux agent should emit WebM-alpha + APNG/WebP and document that the Safari video asset needs a macOS step. A cross-platform alternative is the "stacked alpha" trick (colour on top, alpha matte below, composited with WebGL/canvas) described by Jake Archibald, which uses ordinary AV1/H.265 encoders.
- Piping frames instead of writing PNGs is possible (`-f image2pipe -c:v png -i -`) and avoids disk I/O; not tested here.
- For animated WebP, `img2webp` is the more controllable tool (per-frame `-d`, `-lossy/-lossless`, `-min_size`, `-kmin/-kmax`); ffmpeg's `libwebp_anim` is simpler when ffmpeg is already a dependency.

### Gaps
- The palettegen/paletteuse and encoder sections of the official ffmpeg HTML docs were too large for the fetch tool to reach, so option semantics above come from the local `ffmpeg -h` output rather than quoted doc text.
- Animated AVIF with alpha: `ffmpeg ... -c:v libaom-av1 -pix_fmt yuva420p out.avif` produced a 4.7 KB file with two `yuv420p` AV1 streams; alpha preservation was NOT confirmed. No verified ffmpeg recipe for alpha animated AVIF; `avifenc` (libavif) is the usual tool but was not researched.
- The matte variant (b2) and gifski/gifsicle commands were not executed (neither tool installed locally).
- Behaviour on ffmpeg 8.x/9.x (current Homebrew is 9.0.2) was not tested.
- `-q:v` scale for `hevc_videotoolbox` (constant quality 1-100 on Apple Silicon) is taken from community recipes, not official docs.

## 3. Hard limits of transparent GIF; what gifski and gifsicle add; licences

### Takeaway
GIF gives 256 colours per palette, 1-bit transparency and centisecond frame delays, so anti-aliased Lottie edges become either jagged (threshold) or haloed (matted); use it only where the destination accepts nothing better. gifski gives the best GIF quality but is AGPL-3.0 and capped at 50 fps for browsers; gifsicle (GPL-2.0) is the lossy optimiser.

### Cited Findings
- GIF supports only binary transparency ("Gif does not support 8-bit transparency. It only allows binary transparency"), which produces aliased/jagged edges on transparent backgrounds — [ImageMagick forum](https://imagemagick.com/discourse-server/viewtopic.php?p=146825)
- ffmpeg's `paletteuse` exposes this as `alpha_threshold` (0-255, default 128): pixels with alpha below the threshold become fully transparent, the rest fully opaque; `palettegen` reserves one palette entry for transparency (`reserve_transparent`, default true), leaving 255 colours, and `transparency_color` (default lime) is the RGB stored in that entry — LOCAL `ffmpeg -h`; docs [ffmpeg-filters](https://ffmpeg.org/ffmpeg-filters.html#paletteuse)
- Frame timing: ffmpeg wrote a delay of 4 centiseconds for 25 fps; GIF delays are integers in centiseconds, so exact rates are 100/n: 100, 50, 33.3, 25, 20, 16.7, 12.5, 10 fps. 30 fps (3.33 cs) and 60 fps (1.67 cs) cannot be represented exactly — LOCAL TEST (GCE delay field parse)
- gifski's CLI accepts `--fps` up to 100 ("100 fps is maximum") and prints "warning: web browsers support max 50 fps" above 50 — [gifski CLI source](https://raw.githubusercontent.com/ImageOptim/gifski/main/src/bin/gifski.rs)
- gifski flags: `--fps`, `--fast-forward`, `--fast` ("50% faster encoding, but 10% worse quality and larger file size"), `--extra` ("50% slower encoding, but 1% better quality"), `--quality 1-100` (default 90), `--motion-quality`, `--lossy-quality`, `-W/--width` ("By default anims are limited to about 800x600"), `-H/--height`, `--no-sort`, `--repeat` (-1 none, 0 forever), `--matte <RGBHEX>` ("Background color for semitransparent pixels"), `--bounce`, `--fixed-color` — [gifski CLI source](https://raw.githubusercontent.com/ImageOptim/gifski/main/src/bin/gifski.rs)
- gifski usage: `gifski -o anim.gif frame*.png`; from video: `ffmpeg -i video.mp4 -f yuv4mpegpipe - | gifski -o anim.gif -`; install `brew install gifski` or `cargo install gifski` — [gifski README](https://github.com/ImageOptim/gifski)
- gifski licence: "AGPL 3 or later", with the author offering "alternative licensing options, including commercial licenses"; Homebrew lists it as AGPL-3.0-only, version 1.34.0; latest GitHub release 1.34.0 on 2025-07-13 — [gifski README](https://github.com/ImageOptim/gifski), [Homebrew API](https://formulae.brew.sh/api/formula/gifski.json), [GitHub API](https://api.github.com/repos/ImageOptim/gifski/releases/latest)
- gifsicle: Homebrew version 1.98, licence GPL-2.0-only, "GIF image/animation creator/editor"; repo last pushed 2026-10-15 — [Homebrew API](https://formulae.brew.sh/api/formula/gifsicle.json), [GitHub API](https://api.github.com/repos/kohler/gifsicle)
- Slack limits animated GIF emoji to 50 frames and recommends files under 128 KB — [Slack help](https://slack.com/help/articles/206870177-Add-custom-emoji-and-aliases-to-your-workspace)

### Inferences
- gifski supports transparency in the sense that PNG frames with alpha produce a GIF with transparent pixels, and `--matte` exists precisely to choose the colour that semi-transparent edge pixels are blended against (the "matte colour trick"). Matte the edge to the destination background (white for light UIs, #1a1d21-ish for dark) and the halo becomes invisible on that background but visible on any other.
- Disposal: transparent GIF frames must use disposal method 2 (restore to background); with method 1 (do not dispose) earlier frames show through transparent areas ("ghosting"). ffmpeg 7.1.1 set disposal 2 automatically on all transparent frames in the local test, so `-gifflags -transdiff` is a belt-and-braces flag rather than a requirement on that version; older ffmpeg builds may differ.
- Practical rule for the skill: choose GIF fps from {50, 25, 20, 12.5, 10}; for a 30 fps Lottie use `fps=25` (or 50 for a 60 fps source) and accept resampling, or keep all frames and accept a slightly changed duration.
- Dither choice for transparent GIF: `dither=none` or `bayer` (ordered, stable across frames) for flat-colour icons; error-diffusion (`sierra2_4a`, `floyd_steinberg`) for gradients, at the cost of larger files and frame-to-frame shimmer.
- Suggested optional commands (NOT executed here): `gifski --fps 25 --quality 90 --matte ffffff -W 512 -o out.gif frames/f_*.png` and `gifsicle -O3 --lossy=80 --colors 128 in.gif -o out.gif`.

### Gaps
- No primary source fetched for the GIF89a specification text (centisecond delay field, disposal method definitions); the statements above rest on the local byte-level test plus common knowledge. Spec URL for reference, not fetched: https://www.w3.org/Graphics/GIF/spec-gif89a.txt
- The widely repeated claim that browsers clamp delays of 0-1 cs to 10 cs (10 fps) appears only in the search-result summary of the gifski readme ("browsers throttle frame rates above 50 FPS, playing them at 10 FPS"); exact per-browser thresholds were not verified.
- gifski's exact alpha handling (threshold value, behaviour without `--matte`) is not documented in the sources read.
- gifsicle `--lossy` semantics and current version features were not fetched from its manual.

## 4. Which transparent format for which destination; browser support

### Takeaway
For web pages ship WebM VP9-alpha plus HEVC-alpha (`<video>` with two sources) for longer or larger pieces, and animated WebP or APNG in `<img>` for small icons; for chat platforms follow their fixed specs (Telegram WebM VP9 512 px / 3 s / 30 fps / 256 KB, Discord APNG 320x320 / 512 KB, Slack GIF under 128 KB and 50 frames, WhatsApp animated WebP 512x512 / 500 KB); for video editors use ProRes 4444.

### Cited Findings

Browser support:
- APNG: 97.39% global; Chrome 59+, Firefox 3+, Safari 8+, iOS Safari 8+, Edge 79+ — [caniuse apng](https://caniuse.com/apng)
- WebP: 97.32% global; Chrome 32+, Firefox 65+, Safari 16.0+ (macOS), iOS Safari 14+, Edge 18+ — [caniuse webp](https://caniuse.com/webp)
- AVIF: 96.71% global; Chrome 85+, Firefox 93+, Safari 16.4+ (16.1-16.3 partial), iOS Safari 16.0+, Edge 121+ — [caniuse avif](https://caniuse.com/avif)
- VP9-alpha WebM works in Chrome and Firefox; Safari plays VP9 but not VP9 transparency, so it needs HEVC with alpha; Chrome Android gets the alpha channel wrong and Firefox Android often stalls (2024 observations) — [jakearchibald.com](https://jakearchibald.com/2024/video-with-transparency/)
- HEVC with alpha is supported by Safari on iOS 13+ and macOS Catalina+ — [Apple WWDC19 session 506](https://developer.apple.com/wwdc19/506)
- Safari "doesn't correctly support transparency in an animated AVIF", and animated AVIF playback is slow in all browsers (2024) — [jakearchibald.com](https://jakearchibald.com/2024/video-with-transparency/)
- Size comparison for one transparent clip: animated AVIF 504 kB, VP9-alpha 1.1 MB, HEVC-alpha 3.4 MB, stacked AV1 460 kB, stacked HEVC 1.14 MB; ffmpeg's VideoToolbox HEVC output was roughly double Apple Compressor's — [jakearchibald.com](https://jakearchibald.com/2024/video-with-transparency/)
- Remotion docs: Chrome and Firefox support WebM alpha; render an opaque fallback as well and select with `<source>` — [Remotion transparent videos](https://www.remotion.dev/docs/transparent-videos)
- A vendor blog updated August 2026 says WebM transparency "is coming to Safari 27 beta"; single source, not confirmed against Apple release notes — [rotato.app](https://rotato.app/blog/transparent-videos-for-the-web)

Platform specs:
- Telegram animated stickers (.TGS): 512x512 canvas, max 3 s, 60 FPS, max 64 KB, must loop, objects must not leave the canvas; no expressions, masks, layer effects, text layers, 3D layers or time remapping — [Telegram stickers](https://core.telegram.org/stickers)
- Telegram video stickers: `.WEBM` encoded with VP9, one side exactly 512 px (other <= 512), max 3 s, up to 30 FPS, max 256 KB, no audio stream; video and static custom emoji must be exactly 100x100 px — [Telegram stickers](https://core.telegram.org/stickers)
- Discord stickers: "Animated File types: APNG, Static File type: PNG, Max File size: 512KB, Dimensions: 320px x 320px (exact)" — [Discord support](https://support.discord.com/hc/articles/4402687377815); Discord's blog also lists Lottie as a sticker format — [Discord blog](https://discord.com/blog/unleash-your-creativity-with-stickers-on-discord)
- Slack custom emoji: "Square images under 128 KB and with transparent backgrounds work best"; JPG, PNG, GIF accepted; animated GIFs up to 50 frames — [Slack help](https://slack.com/help/articles/206870177-Add-custom-emoji-and-aliases-to-your-workspace)
- WhatsApp animated stickers: WebP, 512x512, max 500 KB (static 100 KB), max 10 s loop, transparent background supported/recommended (third-party help-centre sources) — [Superchat help](https://help.superchat.com/en/articles/701423-whatsapp-media-sizes-formats), [Vonage docs](https://developer.vonage.com/en/messages/concepts/whatsapp-stickers)
- Keynote converts imported movies in ProRes or other unsupported formats to HEVC on import — [Apple Keynote guide](https://support.apple.com/en-ge/guide/keynote/tan12af068f9/mac)
- PowerPoint for Mac can itself export ProRes 4444 MOV with "make background transparent", and a user reported Premiere Pro 25.3 failing to import that file — [Adobe community](https://community.adobe.com/questions-729/apple-prores-4444-mov-won-t-import-to-premiere-file-contains-more-than-one-image-descriptor-1419872)

Recommended mapping (synthesis of the above; rows without a cited spec are flagged in Gaps):

| Destination | First choice | Fallback |
|---|---|---|
| Web page, small icon in `<img>` | animated WebP (alpha) | APNG; GIF last |
| Web page, larger/longer `<video>` | WebM VP9-alpha + HEVC-alpha `.mov` (Safari source listed first) | opaque MP4 on matching background |
| iOS / macOS Safari | HEVC with alpha (`hvc1`) or APNG/WebP in `<img>` | opaque MP4 |
| Telegram | `.tgs` (if the Lottie passes restrictions, 64 KB) | WebM VP9-alpha 512 px, <= 3 s, <= 30 fps, <= 256 KB |
| Discord sticker | APNG 320x320 <= 512 KB | static PNG |
| Slack emoji | transparent GIF, square, < 128 KB, <= 50 frames | static PNG |
| WhatsApp sticker | animated WebP 512x512 <= 500 KB | - |
| Premiere / DaVinci / Final Cut / After Effects | ProRes 4444 MOV (alpha) | PNG sequence |
| Email | GIF (opaque or 1-bit transparent) | static PNG |

### Inferences
- Order `<source>` tags HEVC first (`type='video/mp4; codecs="hvc1"'`), WebM second: Chrome/Firefox skip the HEVC-alpha source they cannot use for alpha only if listed with the codec string, while Safari would otherwise pick the WebM and show a black background.
- For a 512x512 2-3 s icon the Telegram 256 KB and Discord 512 KB limits are comfortably reachable with VP9 CRF 30 and APNG respectively only if the artwork is flat-colour; APNG of gradient-heavy content can exceed 512 KB (the synthetic gradient test was 769 KB at 512x512), so downscale to 320x320 and reduce fps for Discord.
- Slack's 50-frame limit means a 3 s animation must be at most ~16 fps (use 12.5 fps = 8 cs delay, 37 frames) or a 2 s animation at 25 fps.

### Gaps
- PowerPoint, Keynote and Google Slides: no authoritative source found on which transparent animated formats (transparent GIF, APNG, animated WebP, HEVC alpha, ProRes 4444) each accepts and plays in 2026. Commonly reported practice (transparent GIF works in all three; Keynote plays alpha MOV) could not be sourced this session.
- CapCut alpha-import support (ProRes 4444 / WebM alpha): no source found.
- Email client support for APNG/WebP animation: no source fetched; GIF recommendation for email is conventional wisdom.
- Animated WebP per-browser first versions are not broken out on caniuse; Safari WebM-alpha status in Safari 27 is single-sourced.
- Discord emoji 256 KB limit and whether Discord stickers accept GIF: only third-party guides, conflicting; Discord's own support page was not directly fetchable (HTTP 403) so its sticker spec above comes from the search-result excerpt of that page.
- WhatsApp's official sticker documentation (GitHub WhatsApp/stickers) was not fetched; minimum frame duration (often quoted as 8 ms) unverified.

## 5. Deterministic frame capture from animated SVG / CSS / JS in a headless browser

### Takeaway
Real-time screen recorders (Playwright `recordVideo`, puppeteer-screen-recorder) are not frame-accurate; deterministic capture means pausing every animation clock and seeking it explicitly per frame, then screenshotting with `omitBackground`. The timecut/timesnap/timeweb family automates this for JS-driven animation only (it explicitly does not handle CSS animations/transitions) and is pinned to Puppeteer 2.x.

### Cited Findings
- timecut records "smooth videos of web pages that use JavaScript animations" using puppeteer + timeweb + timesnap and pipes frames to ffmpeg; timesnap uses `page.evaluateOnNewDocument` to overwrite time functions (`Date`, `performance.now`, `requestAnimationFrame`, `setTimeout`, ...) with a virtual timeline — [timecut README](https://github.com/tungs/timecut)
- timecut CLI: `timecut index.html --viewport="800,600" --fps=60 --duration=5 --frame-cache --pix-fmt=yuv420p --output=video.mp4`; `-S "canvas,svg"` crops to a selector; `--transparent-background` works only if the output format supports transparency; `--pipe-mode` (experimental), `--output-options`, `--launch-arguments`; defaults 800x600, 60 fps, 5 s, `video.mp4` — [timecut README](https://github.com/tungs/timecut)
- Limitation stated by the authors: timeweb, timesnap and timecut "only overwrites JavaScript functions and video playback", so pages changed by other means such as CSS transitions or animations "will likely not render as intended" — [timecut README](https://github.com/tungs/timecut)
- timecut 0.3.3 and timesnap 0.3.3 were both published 2022-04-03; timesnap depends on `puppeteer ^2.1.1`; timeweb 0.3.2 published 2023-05-01; all BSD-3-Clause — [npm timecut](https://registry.npmjs.org/timecut), [npm timesnap](https://registry.npmjs.org/timesnap), [npm timeweb](https://registry.npmjs.org/timeweb)
- puppeteer-screen-recorder 3.0.6 (2024-10-27, MIT) pins `puppeteer 19.0.0` — [npm registry](https://registry.npmjs.org/puppeteer-screen-recorder)
- Playwright `recordVideo: { dir: 'videos/' }` saves the video only when the browser context closes; "The video size defaults to the viewport size scaled down to fit 800x800"; the docs page gives no control over frame rate, codec or quality — [Playwright videos docs](https://playwright.dev/docs/videos)

### Inferences
(The API names below are standard web-platform / CDP APIs known from prior knowledge; their reference pages were NOT successfully fetched this session, see Gaps.)
- CSS animations, CSS transitions and Web Animations: pause and seek every animation per frame:
  ```js
  // in page.evaluate, t in milliseconds
  for (const a of document.getAnimations({ subtree: true })) { a.pause(); a.currentTime = t; }
  ```
  Call once to pause at load, then per frame set `currentTime = frameIndex * 1000 / fps`, wait one `requestAnimationFrame`, screenshot.
- SMIL (animated SVG with `<animate>`, `<animateTransform>`, `<animateMotion>`): on each root `<svg>` call `svg.pauseAnimations()` once, then `svg.setCurrentTime(seconds)` per frame. Load the SVG inline in an HTML wrapper (or navigate to the `.svg` directly and use `document.documentElement`); an SVG referenced through `<img>` is not scriptable.
- JS-driven animation (requestAnimationFrame loops, GSAP, anime.js, canvas): either drive the library's own timeline (`gsap.globalTimeline.pause(); tl.seek(t)`, lottie `goToAndStop`) or inject a virtual clock before page scripts run (timeweb's approach via `evaluateOnNewDocument` / Playwright `addInitScript`, or Playwright's built-in `page.clock.install()` + `page.clock.runFor(ms)` / `pauseAt`).
- Chrome DevTools Protocol virtual time: `Emulation.setVirtualTimePolicy({ policy: 'pause' | 'advance' | 'pauseIfNetworkFetchesPending', budget: <ms> })` with the `Emulation.virtualTimeBudgetExpired` event lets a script advance the whole page clock (including CSS animations) by exactly one frame interval between screenshots; it is an experimental CDP method and Chromium-only. `HeadlessExperimental.beginFrame` existed for the old headless mode and should not be relied on.
- Transparent capture: Puppeteer `page.screenshot({ omitBackground: true })`, Playwright `locator.screenshot({ omitBackground: true })`; the page/body background must itself be transparent.
- Why `recordVideo` and screen recorders are unsuitable: they capture in real time at whatever cadence the compositor delivers (frames drop or duplicate under load), the output is an opaque lossy WebM scaled to fit 800x800 by default, there is no alpha, and the first frames include page load. Use them only for previews.
- Because timesnap pins Puppeteer 2.x and ignores CSS animations, a new skill should implement its own ~50-line "pause + seek + screenshot" script on current Playwright/Puppeteer rather than depend on timecut.
- A combined seek function covering all three clocks (WAAPI/CSS, SMIL, lottie/GSAP if present) makes one script work for animated SVG, HTML/CSS and Lottie pages alike.

### Gaps
- MDN pages for `Document.getAnimations()`, `Animation.currentTime`, `SVGSVGElement.setCurrentTime()` / `pauseAnimations()` were not fetched; reference URLs (unverified this session): https://developer.mozilla.org/en-US/docs/Web/API/Document/getAnimations , https://developer.mozilla.org/en-US/docs/Web/API/Animation/currentTime , https://developer.mozilla.org/en-US/docs/Web/API/SVGSVGElement
- The CDP `Emulation.setVirtualTimePolicy` reference page returned only a redirect stub, so parameter names and experimental status above are from prior knowledge, not a fetched source: https://chromedevtools.github.io/devtools-protocol/tot/Emulation/
- Playwright Clock API (`page.clock`) docs and Playwright `recordVideo` frame-rate/codec internals were not fetched; the "not frame-accurate" conclusion is an inference from the docs' lack of any fps/quality control plus general knowledge of screencast capture.
- None of the seek-and-screenshot scripts were executed in this session.
- Whether timecut/timesnap still install and run on Node 22+/Apple Silicon was not tested.

## 6. Sensible defaults and typical file sizes (2-3 s, 512x512 icon animation)

### Takeaway
Default to the Lottie's own `w`/`h`/`fr`/duration, capped at 512x512, 30 fps (25 fps for GIF) and one loop; expect roughly tens of KB for alpha video (VP9, HEVC), hundreds of KB for GIF / animated WebP / APNG, and around 1 MB for ProRes 4444 on gradient-heavy content. Flat-colour icons will be much smaller for the image formats.

### Cited Findings
- Measured sizes, LOCAL TEST (synthetic 512x512, 3 s, 90 frames at 30 fps, smooth multi-colour gradient disc with anti-aliased edge on transparent background; commands as in section 2):

| Output | Settings | Size |
|---|---|---|
| RGBA PNG sequence (90 files) | ffmpeg png default | ~1,080 KB on disk |
| WebM VP9 + alpha | CRF 30, `-b:v 0` | 39.8 KB |
| MP4 H.264 on white | CRF 18, preset slow | 64.5 KB |
| HEVC + alpha (VideoToolbox) | `-q:v 65 -alpha_quality 0.75` | 81.9 KB |
| HEVC + alpha, premultiplied, `-require_sw 1` | same quality | 121.5 KB |
| Transparent GIF, 25 fps (75 frames) | bayer_scale 5 / no dither | 143.7 KB / 142.3 KB |
| Opaque GIF on white, 25 fps | sierra2_4a, diff_mode rectangle | 283.9 KB |
| Animated WebP lossless | ffmpeg / img2webp `-m 4` | 301.6 KB |
| Animated WebP lossy q80 | ffmpeg / img2webp `-m 4` | 311.3 KB |
| APNG | `-pred mixed` | 769.3 KB |
| ProRes 4444 + alpha | prores_ks, alpha_bits 16 | 1,160.1 KB |

- Encode time for every command above was 0-4 s on Apple Silicon — LOCAL TEST
- Platform ceilings that defaults must respect: Telegram TGS 512x512, <= 3 s, 60 fps, 64 KB; Telegram WebM 512 px side, <= 3 s, <= 30 fps, 256 KB — [Telegram stickers](https://core.telegram.org/stickers); Discord sticker 320x320 exact, 512 KB — [Discord support](https://support.discord.com/hc/articles/4402687377815); Slack emoji under 128 KB and <= 50 GIF frames — [Slack help](https://slack.com/help/articles/206870177-Add-custom-emoji-and-aliases-to-your-workspace); WhatsApp animated WebP 512x512, 500 KB — [Superchat help](https://help.superchat.com/en/articles/701423-whatsapp-media-sizes-formats)
- lottie-converter's defaults are 512x512, 60 fps for APNG/PNG/WebP and 50 fps for GIF, quality 90 — [lottie-converter README](https://github.com/ed-asriyan/lottie-converter)
- gifski limits output to about 800x600 unless `--width` is given, default quality 90, and warns above 50 fps — [gifski CLI source](https://raw.githubusercontent.com/ImageOptim/gifski/main/src/bin/gifski.rs)
- timecut defaults: 800x600 viewport, 60 fps, 5 s — [timecut README](https://github.com/tungs/timecut)

### Inferences
- Suggested skill defaults: size = Lottie `w` x `h` scaled to fit 512x512 (render vector at target size rather than upscaling PNGs; for crisp edges render at 2x with `deviceScaleFactor: 2` and downscale with `-vf scale=512:-1:flags=lanczos`); fps = Lottie `fr` capped at 30 for video/WebP/APNG, 25 (or 50 for 60 fps sources) for GIF; duration = `(op - ip) / fr` seconds, exactly one loop, with `-loop 0` / `-plays 0` for infinite looping; even dimensions for H.264/HEVC/VP9 (`yuv420p` needs width and height divisible by 2).
- The lossy WebP result being larger than lossless in the local test is an artefact of the synthetic smooth-gradient content; do not generalise it. Always encode both and keep the smaller when size matters.
- Real Lottie icons (flat fills, few colours) compress far better in GIF, lossless WebP and APNG than the gradient test; treat the table as an upper-range indication for 512x512 / 3 s, not a typical value.
- Size levers in order of effect: reduce dimensions (320 or 256 px), reduce fps (15-20), reduce palette (`max_colors=64-128` for GIF), raise CRF (VP9 30 -> 40), then lossy optimisers (gifsicle `--lossy`, gifski `--lossy-quality`).

### Gaps
- No published benchmark of typical per-format sizes for real Lottie icon animations was found; the only numbers are the single synthetic local test above and Jake Archibald's unrelated video clip. Sizes for a representative flat-colour Lottie icon were not measured.
- gifski / gifsicle output sizes were not measured (tools not installed locally).
- No authoritative source recommends a specific default fps for Lottie-to-raster conversion; the defaults above are a judgement based on platform limits.
