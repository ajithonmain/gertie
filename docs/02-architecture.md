# Architecture

## The pipeline

```
user request
    |
    v
agent writes  scene.gertie.json          (see 03-scene-spec.md)
    |
    v
normalize     defaults, palette, presets expanded, times to frames
    |
    +--> lint (scene level)              (see 06-validation.md)
    |
    +--> emit Lottie JSON                (see 04-lottie-emitter.md)
    |        |
    |        +--> schema validation
    |        +--> semantic lint
    |
    +--> emit animated SVG               (see 05-svg-emitter.md)
    |
    v
render frames in a browser               (see 07-render-and-export.md)
    |
    +--> automatic checks                (see 08-testing.md)
    +--> contact sheet for the agent to look at
    |
    v
agent fixes the scene and repeats, or accepts
    |
    v
export GIF, APNG, WebP, WebM, MOV, MP4, .lottie
```

Every stage after "agent writes" is deterministic code. The agent's only artefact is the scene file. When something is wrong, the agent edits the scene file and runs the pipeline again. It never edits Lottie JSON or SVG output by hand.

## Modules

| Module | Input | Output | Dependencies |
|---|---|---|---|
| `spec` | Scene JSON | Typed, normalized scene | None |
| `presets` | Normalized scene with preset references | Scene with plain keyframes | None |
| `emit-lottie` | Normalized scene | Lottie JSON object | None |
| `emit-svg` | Normalized scene | SVG string | None |
| `validate` | Scene, Lottie JSON | List of diagnostics | Lottie JSON Schema file (bundled) |
| `render` | Lottie JSON or SVG | PNG frames, contact sheet | Playwright, lottie-web (bundled asset) |
| `qa` | Frames, outputs | QA report JSON | None beyond render |
| `export` | PNG frames | Raster and video files | ffmpeg |
| `intake` | SVG, image, Lottie, video | Scene fragments | Optional tools per source |
| `story` | Storyboard JSON | Composed video | ffmpeg, optional HyperFrames |
| `ascii` | ASCII scene | SVG, frames | None |
| `cli` | Command line arguments | Calls the modules | All of the above |

The first five modules are pure: no file access, no processes, no network. They take values and return values. This is what makes them easy to test and easy to run inside other tools later (a website, an MCP server). All file and process access lives in `cli`, `render` and `export`.

## Command line

One entry point with subcommands. Each subcommand is also bundled as its own script so an agent can call it directly.

```
gertie compile <scene.gertie.json> [--out dir] [--lottie] [--svg] [--dotlottie]   (no flag: Lottie and SVG; the .lottie archive is `export --to lottie-zip`)
gertie validate <scene.gertie.json | lottie.json>
gertie render <scene.gertie.json | lottie.json | file.svg> [--frames dir] [--sheet sheet.png]
gertie qa <scene.gertie.json>            compile + validate + render + checks, one report
gertie export <scene.gertie.json> (--to gif,webm,mp4,lottie-zip,... | --for telegram) [--bg #ffffff] [--scale n] [--loops n]
gertie import <file.svg> [--out fragment.json]      SVG to a fragment, with a summary and a labelled preview
gertie trace <image.png> [--colors n] [--out fragment.json]     flat PNG or JPEG to shapes (built-in tracer)
gertie group <fragment.json> <groups.json>           wrap regions of a fragment in named groups
gertie cutout <painting.png> <parts.json> [--out folder]        cut a painting into layers along hand-drawn outlines
gertie grid <image.png> [--step n]                   a labelled grid on an image, for reading coordinates
gertie study <clip.mp4|gif> [--fps 8]                measure the motion in a video and draw a contact sheet
gertie inspect | recolor | retime | render <lottie.json>     tools for supplied Lottie files
gertie story <video.story.json> [--out video.mp4] [--engine builtin|hyperframes] [--render] [--lint-only] [--no-qa]
gertie ascii lint|export|render|from|gen|play     text-character animation (see 12-ascii.md)
gertie doctor                            reports Node, ffmpeg, browser availability
```

Rules for every command:

- Exit code 0 on success, 1 on validation or check failure, 2 on usage or environment error.
- With `--json`, print one JSON object to standard output and nothing else. Agents use this mode.
- Without `--json`, print short human-readable lines.
- Never prompt for input.
- Write outputs next to the scene file in an `out/` directory unless `--out` is given.

`gertie qa` is the command the agent runs most. It is the whole inner loop in one call.

## Process cleanup

Rendering starts a headless browser and export starts ffmpeg. These must never outlive the command, because a leftover Chromium keeps using CPU and memory on the user's machine. `src/shutdown.ts` is the single place that owns this:

- `launchBrowser()` registers every browser. Its `close()` is idempotent and gives up waiting after 5 seconds.
- Async ffmpeg spawns are wrapped in `trackChild()` and killed with SIGKILL if still running at shutdown.
- The CLI entry calls `shutdown()` in a `finally` block after every command, then exits after 2 seconds if some handle still keeps Node alive.
- SIGINT, SIGTERM and SIGHUP run the same shutdown, then exit with 130, 143 or 129.
- A SIGKILL of Node cannot run any handler, so each `launchBrowser()` first reaps orphans: headless processes with a Playwright temporary profile whose parent is PID 1. `gertie cleanup` runs the same reaper on demand. POSIX only; `GERTIE_KEEP_ORPHANS=1` turns it off.

Every external process also has a time limit, so a stuck child cannot hang Gertie or the agent waiting on it. Limits live in `processLimitMs()` in `src/shutdown.ts`:

| Kind | Limit | Used for |
|---|---|---|
| `quick` | 60 s | version checks, capability lists, ffprobe, one decoded frame, the orphan scan |
| `decode` | 5 min | decoding a clip into frames (`study`, `rawFrame`, ascii `rawFrames`) |
| `encode` | 30 min | one ffmpeg export encode (`runFfmpeg`) |
| `render` | 60 min | a full `hyperframes render` |

A child past its limit is killed with SIGKILL and the command fails with a message that names the step and the fix. `GERTIE_TIMEOUT_SCALE` multiplies every limit (for example `GERTIE_TIMEOUT_SCALE=4` on a slow machine). Blocking `spawnSync` calls still delay signal handlers until the child returns, but now at most until its limit. The live ascii `streamFrames` decode has no limit, because playback length is chosen by the user and ends when the stream is stopped.

## Repository layout

```
gertie/
  CLAUDE.md
  README.md
  LICENSE
  package.json
  tsconfig.json
  docs/                       these documents
  reports/, research_notes/   research with sources
  src/
    spec/                     types, parsing, normalization
    presets/                  motion presets, easing table
    emit-lottie/
    emit-svg/
    validate/
    render/
    qa/
    export/
    import/                   SVG import, include and overrides (pure)
    lottie-tools/             inspect, recolor, retime, embed a Lottie file (pure)
    trace/                    image tracing and grouping (pure)
    study/                    motion measurement (pure)
    cutout/                   layers from outlines: masks, fill, PNG encoder (pure)
    intake/
    story/                    storyboard lint, timeline plan, sequencer, HyperFrames adapter (lint, plan, captions pure)
    ascii/                    ASCII scene parse and lint, SVG emitter, converters, generators, terminal output (pure; media.ts runs ffmpeg)
    cli/                      one file per bundled entry point; helpers live in cli/lib/
    compile.ts                the pure pipeline: parse, lint, normalize, emit, validate
  skills/
    gertie/                   the distributable skill
      SKILL.md
      references/
      scripts/                bundled .mjs built from src, committed
      assets/                 preview page, lottie-web build, schema
  examples/                   scene files, also the test corpus
  tests/
    unit/
    golden/                   expected outputs for the corpus
    browser/                  Playwright tests
  site/                       landing page for Cloudflare Pages
```

## Build

- Dev dependencies beyond the four named in the build plan: `tsx` (runs TypeScript tests on Node 22), `@lottie-animation-community/lottie-specs` and its dependency Ajv (bundled into the output; they are build-time only, so the shipped scripts still have no runtime dependencies).
- `npm run build` runs TypeScript type checking, then esbuild bundles each CLI entry into `skills/gertie/scripts/<name>.mjs`, one file per command, with no external imports except `playwright`, which is resolved at run time.
- `npm test` runs unit and golden tests with `node:test`.
- `npm run test:browser` runs the Playwright tests.
- A check in continuous integration fails if the committed bundles differ from a fresh build.

## Decisions

**Decision: a JSON scene file, not a builder script.** A script is more expressive, but a data file can be validated before anything runs, produces precise error locations, cannot execute arbitrary code, and is easier for weaker models to write correctly. Presets and helpers cover the expressiveness gap.

**Decision: TypeScript bundled to committed `.mjs`.** An agent must be able to run the skill immediately after installation with only Node present. A build step at install time would fail in restricted environments.

**Decision: Playwright is the single renderer.** It renders Lottie (through lottie-web), animated SVG and HTML with the same code, and the user asked for Playwright-based testing. A faster browserless renderer (`@napi-rs/canvas` with Skia Skottie) is a possible later addition for Lottie only. Verify during build that it works before adding it.

**Decision: lottie-web is the reference player.** It is MIT licensed, it is the most widely deployed player, and it runs in the same browser used for SVG capture. A second player (dotlottie-web, which uses ThorVG) is used in tests as a cross-check.

**Decision: time in seconds in the scene file, frames inside the compiler.** Models reason well about seconds. Lottie needs frames. The conversion happens once, in normalization.
