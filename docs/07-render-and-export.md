# Rendering and export

Every raster and video output goes through one pipeline:

```
Lottie JSON or SVG  ->  browser, seek frame by frame  ->  RGBA PNG frames  ->  ffmpeg  ->  output file
```

The same frames feed the automatic checks and the contact sheet the agent looks at.

Read this together with `research_notes/Free Lottie animation agent skill/raster_video_gif_export.md`. The ffmpeg commands in this document were run during research and again in phase 4 on ffmpeg 7.1.1 on macOS arm64. The rendering code was verified in phases 2 and 3.

## The frame renderer

### Browser

Playwright drives a headless Chromium. To avoid a large download when possible:

1. If the environment variable `GERTIE_BROWSER` is set, use that executable.
2. Otherwise try Playwright's `channel: "chrome"`, which uses an installed Google Chrome.
3. Otherwise use Playwright's own Chromium, and if it is missing, exit with code 2 and the exact command to install it: `npx playwright install chromium`.

`gertie doctor` reports which of these applies.

Playwright itself is not bundled into the scripts. It is loaded with a dynamic `import("playwright")`. If the import fails, print the install command (`npm install playwright` in the skill directory) and exit with code 2.

### Rendering Lottie

**Verified in phase 2** (Chrome via `channel: "chrome"`, lottie-web 5.13.0):

- The page loads from a `file://` URL with lottie-web as a local script. Animation data is passed in with `page.evaluate`.
- `goToAndStop(frame, true)` is exact and repeatable: the same frame renders byte for byte identically, even after seeking elsewhere.
- Fractional frames work. A frame at exactly `op` renders **empty** (layers live from `ip` up to but not including `op`), so the frame that closes a loop is rendered at `op - 0.001`, which equals frame 0 for a seamless loop.
- `omitBackground: true` gives alpha 0 where nothing is drawn.
- lottie-web can fire `DOMLoaded` before a listener is attached. The page checks `anim.isLoaded` first. Without that, loading some files hangs.
- Playwright's own Chromium was not installed on the development machine, and the Chrome fallback worked as designed.

A bundled HTML page (`skills/gertie/assets/render.html`) loads a bundled copy of lottie-web (MIT) from a local file. No network is used.

```js
// inside the page
const anim = lottie.loadAnimation({
  container, renderer: "svg", loop: false, autoplay: false, animationData
});
window.seek = (frame) => anim.goToAndStop(frame, true);
window.totalFrames = anim.totalFrames;
```

```js
// in Node
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale });
await page.goto(fileUrl);
for (let f = 0; f < totalFrames; f++) {
  await page.evaluate((n) => window.seek(n), f);
  await page.screenshot({ path: framePath(f), omitBackground: true, clip: { x: 0, y: 0, width, height } });
}
```

- `omitBackground: true` produces transparent PNGs.
- Use lottie-web's `svg` renderer. It is the reference renderer and the most complete.
- `--scale 2` renders at double resolution through `deviceScaleFactor`.

### Rendering animated SVG

The SVG must be seeked, not recorded in real time. Real-time recording drops frames and is not repeatable.

The page embeds the SVG inline. Then, for each frame:

```js
window.seek = (seconds) => {
  // CSS animations
  for (const a of document.getAnimations()) {
    a.pause();
    a.currentTime = seconds * 1000;
  }
  // SMIL animations
  const svg = document.querySelector("svg");
  svg.pauseAnimations();
  svg.setCurrentTime(seconds);
};
```

**Verified in phase 3:** the script runs as written, inside `loadSvg` in `render.html`, and is exact for both CSS and SMIL in Chromium and WebKit. A looping CSS animation seeked to `duration` shows the same frame as at 0, and seeking one frame twice gives identical pixels. One thing to know: Chromium shows the value from before a `step-end` keyframe when seeked to exactly that keyframe's time; the SVG emitter compensates (see `05-svg-emitter.md`). `document.getAnimations()` returns CSS animations only; SMIL is driven by `setCurrentTime`. The SVG is parsed with `DOMParser` as `image/svg+xml` before it is inserted, so a file that is not well-formed XML is reported as an error instead of being silently repaired. **Firefox is untested:** it would not start on the development machine (see `05-svg-emitter.md`).

A second mode embeds the SVG through `<img>` to test that it animates there. That mode cannot be seeked, so it is used only by the "does it move" test in `08-testing.md`.

### Rendering dense ASCII: the canvas renderer

An ASCII animation of more than 400,000 cells in total (phase 8b) has no SVG. Its frames are drawn by `skills/gertie/assets/ascii-render.html`, a page with one `<canvas>` and a `draw(frame, style)` function that uses the SVG emitter's own geometry, and are captured eight at a time with `canvas.toBlob` instead of a screenshot per frame. `openCanvasFrames` in `src/render/ascii-canvas.ts` wraps it as an ordinary frame renderer whose frames must be asked for in order, so the exporter below uses it unchanged through `openFrames`. See `12-ascii.md`, part 3, for the measurements and the test that the two renderers agree.

`decodeImages` sends decoded pixels from the page to Node as base64 made by the browser's `FileReader` (phase 8b); building the string by hand took most of the time for large pictures. The bytes are the same.

### Speed

Frame-by-frame screenshots take roughly 30 to 100 milliseconds each. A 3 second animation at 30 frames per second is 90 frames, a few seconds in total. For the QA loop, render only the sampled frames (see `08-testing.md`). Render all frames only for export.

Possible later optimization: `@napi-rs/canvas` includes a Skia-based Lottie renderer that needs no browser. Verify during build before adopting it; if it works it can replace the browser for Lottie-only rendering.

### Pixel analysis and the contact sheet in the page

`render.html` also holds `analyzeFrames` (content fraction, share of the canvas border covered, pairwise differences with a bounding box of what changed) and `makeSheet`. Both decode PNGs onto a canvas inside the browser, so no image library is needed. A pixel is "content" when it differs from the scene's empty colour (transparent, or the background).

### Contact sheet

The contact sheet is one PNG showing sampled frames in a grid, each labelled with its time. It is what a vision-capable agent looks at to judge the animation.

- Default: 8 frames evenly spaced, in a 4 by 2 grid, each cell 256 pixels wide.
- Draw the frames on a checkerboard so transparency is visible.
- Build it in the browser: load the frame PNGs into a page that lays them out, then screenshot the page. This avoids an image library dependency.
- `--sheet-frames 16` gives more temporal detail when the agent is debugging timing.

## Export

`gertie export <scene> --to <formats>` renders all frames once, then runs one ffmpeg command per format.

**Status after phase 4.** Implemented in `src/export/`. Format names for `--to`: `lottie`, `svg`, `lottie-zip` (the `.lottie` archive; named this way because the project does not use LottieFiles product names in command names), `gif`, `apng`, `webp`, `webm`, `prores`, `hevc`, `mp4`. Other flags: `--for <destination>` (not combinable with `--to`), `--bg <colour>`, `--scale <n>`, `--quality standard|high`, `--loops <n>`, `--keep-frames <dir>`, `--out <dir>`, `--json`. Not implemented: `--matte` and the optional gifski call (both described under GIF limits). Frames are rendered with lottie-web at the enlargement the largest output needs, then fitted with ffmpeg's scaler (see "Output size and quality" below), so a 512 pixel Telegram sticker from a 256 pixel canvas is rendered at 2x, not stretched. A destination with a fixed size renders at the next whole multiple. Exit codes: 0 all written; 1 a limit could not be met, alpha verification failed or a decoded-frame check failed; 2 a usage error, or a format could not be made because ffmpeg or an encoder is missing (the other formats are still written).

**Verified in phase 4** (ffmpeg 7.1.1, macOS arm64, `spinner-ring`, 256 pixels, 30 frames): every recipe below runs and produces a file ffprobe reads with the expected size and frame count (GIF is 25 frames because it is resampled to 25 fps). Whether the same holds on the latest ffmpeg release was not checked; this machine has 7.1.1 only.

In the commands below, `frames/f_%04d.png` is the frame sequence and `30` is the frame rate.

### Transparent GIF

```bash
ffmpeg -y -framerate 30 -i frames/f_%04d.png -filter_complex \
 "[0:v]fps=25,split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=full[p];[b][p]paletteuse=dither=bayer:bayer_scale=5:alpha_threshold=128" \
 -gifflags -offsetting -loop 0 out.gif
```

### Opaque GIF

Used with `--bg`, and also for any scene that has its own solid background (phase 10): the transparent recipe's bayer dither and reserved palette slot are wrong for a gradient, and its PSNR against the source was 41.6 dB against 45.5 dB for this recipe's sierra dither.

Composite onto the background colour first, then build the palette without reserving transparency:

```bash
ffmpeg -y -f lavfi -i "color=c=white:s=512x512:r=30" -framerate 30 -i frames/f_%04d.png -filter_complex \
 "[0:v][1:v]overlay=shortest=1,fps=25,split[a][b];[a]palettegen=stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a" \
 -loop 0 out.gif
```

**Verified in phase 4:** the combined command runs and the first pixel of the result is the background colour (a GIF palette may round a channel by one or two steps).

### APNG

```bash
ffmpeg -y -framerate 30 -i frames/f_%04d.png -plays 0 -pred mixed out.apng
```

### Animated WebP

```bash
ffmpeg -y -framerate 30 -i frames/f_%04d.png -c:v libwebp_anim -lossless 0 -q:v 80 -loop 0 out.webp
```

Do not set `-compression_level 6`. In testing it ran for more than three minutes on 90 frames; the default finishes in about one second.

### WebM with alpha (VP9)

```bash
ffmpeg -y -framerate 30 -i frames/f_%04d.png \
 -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuva420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv" \
 -c:v libvpx-vp9 -b:v 0 -crf 30 -row-mt 1 -auto-alt-ref 0 -an out.webm
```

Plays with transparency in Chrome, Firefox and Edge. Not in Safari.

### ProRes 4444 with alpha

```bash
ffmpeg -y -framerate 30 -i frames/f_%04d.png \
 -vf "scale=out_color_matrix=bt709:out_range=tv,format=yuva444p10le,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv" \
 -c:v prores_ks -profile:v 4444 -alpha_bits 16 -vendor apl0 -an out.mov
```

For video editors: Premiere, DaVinci Resolve, Final Cut, After Effects.

### HEVC with alpha

```bash
ffmpeg -y -framerate 30 -i frames/f_%04d.png -c:v hevc_videotoolbox -allow_sw 1 -alpha_quality 0.75 -q:v 65 -tag:v hvc1 -pix_fmt bgra -an out_hevc.mov
```

For Safari and iOS. **This works only on macOS**, because it needs Apple's VideoToolbox encoder. On Linux, skip it and tell the user to use APNG or animated WebP for Safari.

### MP4 on a solid background

```bash
ffmpeg -y -f lavfi -i "color=c=white:s=1080x1080:r=30" -framerate 30 -i frames/f_%04d.png \
 -filter_complex "[0:v][1:v]overlay=shortest=1:format=rgb,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p,setparams=colorspace=bt709:color_primaries=bt709:color_trc=bt709:range=tv" \
 -c:v libx264 -crf 18 -preset slow -tune animation -movflags +faststart -an out.mp4
```

H.264 needs even dimensions. If the width or height is odd, the frame is scaled to the wanted size and then padded up to even, never cut down.

### Looping video

Video files do not loop by themselves. `--loops 3` repeats the frame sequence that many times before encoding, for platforms that do not auto-loop.

## Output size and quality (phase 10)

Settings were each tried against the alternative on `potted-plant` (1024 pixels, 6 seconds, transparent) and `gradient-orb` (256 pixels, 2 seconds, gradient background), ffmpeg 7.1.1, macOS arm64. Quality is the mean absolute difference or PSNR between the decoded output and the rendered frames, both laid on the background.

**Kept**

| Setting | Result |
|---|---|
| Video size: longer side at least 1080 (mp4, webm, prores, hevc), through a render scale of output over canvas, with no fixed ceiling (the render side is capped at 4320 pixels) | A 256 pixel icon exports at 1080, a 1024 scene at 1080. Odd sizes are scaled to the wanted size, then padded up to even. `--scale` overrides it |
| GIF at the authored size, capped at 640 on the longer side | Potted plant: 14.0 MB at 1024 before, 6.7 MB at 640 |
| Frames shrunk by 1.5 or more use ffmpeg's `area` scaler, not lanczos | Lanczos shrinking by 2 left a light halo along every edge; `area` did not. The orb GIF, rendered at 4.2x and shrunk, was 534 KB with lanczos and 475 KB with area (480 KB before, rendered at 1x) |
| BT.709 matrix and tags on mp4, webm and prores | Decoded as a player does for HD, untagged H.264 scored 34.3 dB (orb) and 34.7 dB (plant); tagged scored 38.7 and 38.5. WebM mean difference 1.72 to 0.72, ProRes 1.42 to 0.01. The tags are written with `setparams` in the filter chain: the `-colorspace` and `-color_primaries` output options wrote only the matrix |
| `-tune animation` for H.264 | 12 to 15% smaller at the same quality: orb 97 KB to 85 KB, plant 573 KB to 488 KB, PSNR unchanged or higher |
| Global GIF palette | See rejected |
| Opaque (sierra) GIF recipe for scenes with their own background | See the opaque GIF section |
| GIF 50 fps for 60 fps scenes, 25 fps when over 6 MB | The budget fired on the potted plant |

**Rejected**

| Setting | Why |
|---|---|
| `--quality high` as the default for video | Rendering at twice the size cost 2.2 to 2.3 times the time (6 seconds at 30 fps: 26 s to 59 s; at 60 fps: 47 s to 111 s, mp4 only, 1024 scene) and the file sizes and differences matched the standard render. With lanczos it also added an edge halo; the option now uses `area`, which looks marginally smoother than standard on thin curves. It stays available as `--quality high` |
| VP9 `-crf 24` as the default | Mean difference 0.69 against 0.72 at crf 30, for 46 to 50% more bytes (plant 1.65 MB against 1.13 MB over 60 frames; orb 59 KB against 39 KB over 40 frames). The ladder keeps starting at 30 |
| H.264 `-crf 16` | 20% larger than crf 18 for 0.06 dB |
| Per-frame GIF palette (`stats_mode=single`, `new=1`) | 36% larger than the global palette (668 KB against 491 KB) for 0.04 dB. The `diff` palette mode saved 0.8% and was not worth a second recipe |
| BT.709 tags on HEVC | `hevc_videotoolbox` ignored them (ffprobe reported unknown either way) and HEVC with alpha cannot be decoded to compare |

Render times above are one run each on one machine, with other work running, so read them as a ratio.

**Frames are rendered once** at the largest scale any requested format needs and shared; each format scales to its own size.

## Decoded-frame checks

After encoding a video format (mp4, webm, prores, hevc), the file is decoded again, as a player does (BT.709, limited range), and compared with the rendered frames, both laid on the `--bg` colour. A failure deletes the file, reports it and exits 1. The thresholds in `src/export/checks.ts` come from the measurements:

| Check | Fails when | Measured on good files |
|---|---|---|
| frames: first, middle and last | mean difference over 6 of 255, or over 5% of pixels off by more than 48 | mp4 2.5 to 3.6, webm 0.7 to 2.5, prores 0.01 |
| fringe: transparent webm and prores, soft edge pixels | mean luminance error under -6 over white, or over 6 over black | -0.3, ProRes -0.01 |
| loop: scene has `loop` | decoded last-to-first difference exceeds the rendered one by more than 3 | 0.05 to 0.4 against 0.00 to 0.02 |

Not checked, and the report says why: any file whose frame rate was lowered (frames no longer line up), transparent HEVC (ffmpeg drops its alpha layer), opaque files for the fringe check. The 6 and 5% limits were set after a transparent WebM of eight tiny characters of ASCII text reached 2.9% of pixels off, which is what a lossy codec does to one-pixel strokes. A hue shift of 120 degrees and a file cut after 20 frames each fail, in `tests/browser/export.spec.ts`.

## GIF limits

State these in `references/export.md` and have the export command print a one-line note when the user asks for transparent GIF.

- GIF has one bit of transparency. A pixel is fully transparent or fully opaque. Curved edges become jagged.
- One palette slot is used for transparency, leaving 255 colours.
- Frame delays are whole hundredths of a second. Exact frame rates are 50, 25, 20, 12.5 and 10. A 30 fps animation is resampled to 25, which is why the commands above contain `fps=25`. A 60 fps scene is written at 50 fps, or at 25 when the 50 fps file is over a 6 MB budget (phase 10; the potted plant at 640 pixels went to 25 fps and 3.5 MB).
- `--matte <colour>` blends edges toward a chosen colour before thresholding. The edges look smooth on that background colour and show a halo on any other.
- gifski makes better GIFs but is AGPL licensed. Gertie does not bundle or require it. If the user has it installed, `--gif-encoder gifski` may call it as an external program.

Whenever the destination accepts APNG, WebP or WebM, recommend that instead.

## Destinations

`gertie export --for <destination>` picks the format and enforces the platform's limits, re-encoding at lower quality or frame rate until the file fits.

| `--for` | Format | Limits |
|---|---|---|
| `web-img` | Animated WebP, with APNG and GIF alternatives | |
| `web-video` | WebM with alpha, plus HEVC with alpha on macOS | |
| `telegram` | WebM VP9 | One side exactly 512 pixels, at most 3 seconds, 30 fps, 256 KB |
| `discord-sticker` | APNG | Exactly 320 by 320, at most 512 KB |
| `slack-emoji` | GIF | Square, under 128 KB, at most 50 frames |
| `whatsapp` | Animated WebP | 512 by 512, at most 500 KB |
| `editor` | ProRes 4444 MOV | |
| `email` | GIF on a solid background (`--bg`, white by default) | |
| `reel` | MP4 | 1080 by 1920, solid background |
| `readme` | Animated SVG, with GIF alternative | |

The Telegram, Discord and Slack limits come from those platforms' documentation. The WhatsApp limit comes from third-party sources. Which transparent formats PowerPoint, Keynote and Google Slides accept was not established; do not claim support.

## Verifying alpha

`ffprobe` reports VP9 and HEVC files with alpha as `yuv420p`, so the pixel format cannot be trusted. After encoding a transparent format, the export command verifies alpha by decoding frame 0 back and checking pixels whose whole 5 by 5 neighbourhood is fully transparent in the source (anti-aliasing cannot move them) and pixels that are fully opaque. A file where a clear pixel came back opaque, or an opaque pixel came back clear, is deleted and reported as an error. The method differs by format. **Verified in phase 4:**

| Format | How alpha is read back | Notes |
|---|---|---|
| GIF, APNG, ProRes | `ffmpeg` default decoder to RGBA | works |
| WebM (VP9) | `ffmpeg -c:v libvpx-vp9` | the default decoder returns alpha 255 for the same file, a test keeps that fact |
| Animated WebP | in the browser: `createImageBitmap` and a canvas | ffmpeg cannot decode animated WebP (`image data not found`), and ffprobe cannot read it, so size and frame count are read from the RIFF container |
| HEVC with alpha | structural: the `hvcC` box lists four parameter-set arrays instead of three (the alpha layer) | ffmpeg's decoder drops the alpha layer and there is no `auxC` box. This does not prove Safari shows transparency; confirm once in Safari |

A scene with a solid background has nothing transparent to check, and the export says so.

For VP9, the decoder must be forced: `ffmpeg -c:v libvpx-vp9 -i out.webm -frames:v 1 check.png`. Without `-c:v libvpx-vp9` the default decoder drops the alpha channel.

If verification fails, the command exits with an error instead of delivering a file with a black background.

## ffmpeg availability

- `gertie doctor` checks that ffmpeg exists and lists whether `libvpx-vp9`, `libwebp_anim`, `prores_ks`, `libx264` and `hevc_videotoolbox` are available, by parsing `ffmpeg -encoders`.
- If an encoder is missing, the export command names the format that cannot be produced and suggests the nearest alternative.
- The recipes were verified on ffmpeg 7.1.1 (phase 4). `gertie doctor --json` carries a `formats` list: for each export format whether it can be produced here and, if not, why and what to use instead. The check is the encoder list, so a build with the encoder but a broken codec library is not detected until export fails; the error then comes with the ffmpeg message.

## Typical file sizes

From one test at 512 by 512, 30 fps, 3 seconds, with gradient content. Flat-colour icons are much smaller in the image formats.

| Format | Size |
|---|---|
| WebM VP9 with alpha | 40 KB |
| MP4 H.264 | 65 KB |
| HEVC with alpha | 82 KB |
| Transparent GIF, 25 fps | 144 KB |
| Opaque GIF, 25 fps | 284 KB |
| Animated WebP | 300 KB |
| APNG | 769 KB |
| ProRes 4444 | 1.16 MB |

Phase 10 defaults, one run each: `gradient-orb` (256 px, 2 s, 30 fps) mp4 1080 px 81 KB, webm 1080 px 52 KB, GIF 256 px 464 KB. `potted-plant` (1024 px, 6 s, 30 fps, transparent, on `#101820`) mp4 1080 px 517 KB, webm 1080 px 3.1 MB, GIF 640 px 6.7 MB (25 fps), ProRes 1080 px 245 MB.
