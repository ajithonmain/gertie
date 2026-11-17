# Exporting

Gertie writes the formats below from one scene. Use `export` after `qa` passes.

    node scripts/gertie.mjs export <scene>.gertie.json --to webm,gif --json
    node scripts/gertie.mjs export <scene>.gertie.json --for telegram --json

Use `--to` for formats you choose, or `--for` for a destination that has rules. Not both. Files go to `out/` next to the scene.

## Choosing a format

| `--to` | Use it for | Transparency |
|---|---|---|
| `lottie` | apps and websites with a Lottie player | full |
| `lottie-zip` | the same animation as a smaller `.lottie` file | full |
| `svg` | `<img>` tags and READMEs, no JavaScript | full |
| `apng` | web, Discord stickers | full |
| `webp` | web, WhatsApp stickers | full |
| `webm` | web video, Telegram stickers. **Safari does not show its transparency** | full |
| `hevc` | Safari and iOS video. macOS only | full |
| `prores` | video editors (Premiere, Resolve, Final Cut, After Effects) | full |
| `gif` | email, chat, old tools | one bit: edges are jagged |
| `mp4` | video anywhere, on a solid background | none |

If the destination accepts APNG, WebP or WebM, prefer them to GIF.

## Destinations

| `--for` | Writes | Limits Gertie enforces |
|---|---|---|
| `web-img` | webp, apng, gif | none |
| `web-video` | webm, and hevc on macOS | none |
| `telegram` | webm | one side exactly 512, at most 3 seconds, 30 fps, 256 KB |
| `discord-sticker` | apng | exactly 320 by 320, 512 KB |
| `slack-emoji` | gif | 128 by 128, under 128 KB, at most 50 frames |
| `whatsapp` | webp | 512 by 512, 500 KB (third-party figure) |
| `editor` | prores | none |
| `email` | gif on a solid background | none |
| `reel` | mp4 | 1080 by 1920, solid background |
| `readme` | svg and gif | none |

When a file is over its size limit, Gertie lowers the frame rate, the palette and the quality step by step and says what it did (`fit` in the report). If nothing fits it writes nothing and reports the smallest size it reached. Then shorten the animation, use fewer shapes (gradients and many moving parts cost most) or lower the canvas size.

## Default sizes

With no `--scale`: `mp4`, `webm`, `prores` and `hevc` are written with the longer side at least 1080 pixels, so a 256 pixel icon becomes a 1080 pixel video and a 1024 pixel scene is close to 1:1. `gif` keeps the authored size, up to 640 pixels on the longer side. `apng`, `webp`, `svg` and `lottie` keep the authored size. A GIF of a 60 fps scene is written at 50 fps, or at 25 when the 50 fps file is over 6 MB; the report says so under `fit`.

Video is tagged BT.709 so players show the colours the scene has. Do not re-encode it with another tool without keeping the tag.

## Options

- `--bg #rrggbb` solid background for formats that need one (mp4, reel, email) or to make a GIF opaque. Default white for those.
- `--scale 2` sets the output to double the canvas size, for every format. It overrides the defaults below. Destinations scale for themselves.
- `--quality high` renders the frames at twice the output size and scales them down. It costs about 2.3 times the render time and the gain over the default is small, so use it only for thin strokes or small text that look rough.
- `--loops 3` repeats the animation before encoding, for platforms that do not loop video.
- `--keep-frames <dir>` keeps the rendered PNG frames.

## Checks and exit codes

Transparent formats are decoded again and a pixel that is clear in the source must still be clear, and an opaque one must still be opaque. A file that fails is deleted and reported. A scene with a solid background has nothing to check and the report says so. HEVC is checked by structure only; tell the user to confirm it once in Safari.

Video files (`mp4`, `webm`, `prores`, `hevc`) are also decoded again and three things are checked: the first, middle and last frame match the rendered frames; a transparent file has no dark or light fringe on soft edges; and a looping scene still ends where it starts. Each result is in `checks` in the JSON. A file that fails is deleted and reported. Checks that cannot apply say why (a lowered frame rate, HEVC alpha that ffmpeg cannot decode, an opaque file).

Exit 0: everything was written. 1: a limit could not be met, alpha was lost or a decoded-frame check failed. 2: a bad command, or ffmpeg or an encoder is missing: the other formats are still written and the failure has a `fix`. Run `node scripts/gertie.mjs doctor` to see which formats this machine can make.

## What to tell the user

- Transparent GIF has one bit of transparency. Say so when you deliver one, and offer APNG, WebP or WebM.
- WebM transparency does not show in Safari.
- Telegram, Discord and Slack limits come from those platforms' documentation; the WhatsApp limit comes from third-party sources and may change.
