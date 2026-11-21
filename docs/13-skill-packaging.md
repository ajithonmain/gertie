# Skill packaging and distribution

Gertie is distributed as an Agent Skill: a folder with a `SKILL.md` file that agents discover and load on demand. This format is an open standard supported by many agents.

Specification: https://agentskills.io/specification

Read this together with `research_notes/Free Lottie animation agent skill/market_and_skill_packaging.md`.

## The skill folder

```
skills/gertie/
  SKILL.md
  references/
    scene.md            the scene format, compact
    motion.md           motion principles and the preset list
    export.md           formats, destinations, GIF limits
    references.md       working from SVG, images, Lottie, video
    video.md            storyboards
    ascii.md            ASCII animation
    limits.md           what Gertie cannot do, and what to tell the user
  scripts/
    gertie.mjs          the full command line
    qa.mjs, compile.mjs, export.mjs, ...   one bundle per command
  assets/
    render.html         the rendering page
    lottie.min.js       lottie-web, MIT, with its licence file
    lottie-schema.json  the official Lottie schema
    gertie-scene.schema.json
    examples/           five small scene files
```

## Format rules

From the specification:

- `name` in the frontmatter: at most 64 characters, lowercase letters, digits and hyphens, and it must equal the folder name. So the folder is `gertie` and the name is `gertie`.
- `description`: at most 1,024 characters. It is the only text an agent sees before deciding to load the skill, so it must say what the skill does and when to use it.
- Keep the body of `SKILL.md` under 500 lines. Put detail in `references/` and tell the agent when to read each file. This is called progressive disclosure: the agent loads only what the task needs.
- Validate with the `skills-ref validate` tool from the specification's repository.

Do not rely on the experimental `allowed-tools` frontmatter field. Not all agents honour it.

## SKILL.md

This is a draft. Refine the wording during the build by watching real agents use it; when an agent goes wrong, fix the instruction that misled it.

```markdown
---
name: gertie
description: Create vector animations and export them as Lottie JSON, animated SVG, GIF, transparent video or MP4. Use when the user asks for an animation, animated icon, loader, spinner, logo animation, animated illustration, sticker, motion graphic, ASCII animation or a short animated video, or asks to animate an SVG or image they supply. Free alternative to paid AI animation tools. Requires Node 22 and a shell.
---

# Gertie

Gertie turns a small scene file that you write into finished animations. You decide what to draw and how it moves. Gertie compiles, checks, renders and exports.

## Rules

1. Never write Lottie JSON or animated SVG by hand. Write a scene file and compile it.
2. Never show the user a result that has not passed `qa`.
3. If the request is something Gertie cannot do, say so before starting. See `references/limits.md`.

## Workflow

1. **Understand the request.** Settle the subject, the motion, the size, whether it loops, and where it will be used. Ask only if a missing answer would change the result. Otherwise choose sensible defaults: 512 by 512, 30 fps, 2 to 3 seconds, looping, transparent background.
2. **If the user supplied artwork or a reference**, read `references/references.md` first.
3. **Write the scene** as `<name>.gertie.json`. Read `references/scene.md` for the format and `references/motion.md` for presets and how to make motion look good. Prefer presets to hand-placed keyframes.
4. **Check it.** Run:

       node scripts/qa.mjs <name>.gertie.json --json

   Fix every error as its `fix` field says and run again.
5. **Look at it.** Open the contact sheet image named in the report. Check that the right things are present, the colours are right, the motion between frames makes sense and nothing is cut off. If it is not right, edit the scene and return to step 4. Revise at most three times.
6. **Export** what the user needs. Read `references/export.md` to choose formats. For example:

       node scripts/export.mjs <name>.gertie.json --to gif,webm
       node scripts/export.mjs <name>.gertie.json --for telegram

7. **Deliver.** Tell the user which files were made, what each is for, and anything they should know (for example that a transparent GIF has rough edges and a WebM is also provided).

## Other tasks

- A video with several scenes: read `references/video.md`.
- ASCII animation: read `references/ascii.md`.
- First use, or a command fails to start: run `node scripts/gertie.mjs doctor` and follow what it says.

## If you cannot see images

Skip step 5. Rely on the automatic checks, and tell the user the result was checked automatically but not viewed.

## If you cannot run commands

Write the scene file following `references/scene.md` and give it to the user with the commands to run.
```

Notes on this draft:

- Script paths in `SKILL.md` are relative to the skill folder. Different agents resolve this differently; some provide the skill's base directory to the model. Verify during build how each target agent resolves relative script paths, and word the instruction so it works in all of them (for example "run the script at `scripts/qa.mjs` inside this skill's folder").
- The description lists many trigger words on purpose. Agents match on it.
- The three rules at the top are the ones that, when broken, produce bad results.

## The reference files

Each reference file is written for the agent, not for a developer. It is the compact, practical version of a design document.

| File | Source | Length target |
|---|---|---|
| `scene.md` | `03-scene-spec.md` | 200 lines. All fields, all node types, the easing names, three worked examples |
| `artwork.md` | `17-quality-tuning.md` section 2 | 120 lines. Build order (silhouette, interior, shading, details), 6 to 10 vertices per path, shading with `clip`, one light direction, a palette of base, shade and tint per hue, outlined or flat, miter joins for geometric art, canvas 512 for icons and 1024 otherwise, fps 60 only for short fast pieces, setting `tier`, import or trace for supplied artwork. Added with the benchmark corpus (`17-quality-tuning.md` section 7): what the profile counts as a path, a colour and a layer, the node and size budget of a full scene, and text as stroked paths |
| `motion.md` | `09-motion-presets-and-rigs.md` | 330 lines. The principles in brief, the preset tables, rig naming. Added with the benchmark corpus: how to write keys so the profile reads them as meant, a scrolling background, morphs with time windows, phases that land on a preset's keys, and the timing of `rig-jump` |
| `export.md` | `07-render-and-export.md` | 80 lines. The destination table, GIF limits. No ffmpeg commands; the scripts hold those |
| `references.md` | `10-references.md` | 150 lines |
| `video.md` | `11-video-composition.md` | 80 lines |
| `ascii.md` | `12-ascii.md` | 60 lines |
| `limits.md` | `01-product.md` | 40 lines. Each limit with a suggested sentence to tell the user |

Worked examples in `scene.md` matter more than prose. Models imitate examples. Choose three that together show: a preset-driven icon, hand-written keyframes with easing, and a group with pivots.

## Where agents look for skills

| Agent | Project folder | User folder |
|---|---|---|
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| OpenAI Codex CLI | `.agents/skills/` | `~/.agents/skills/` |
| Gemini CLI | `.gemini/skills/` or `.agents/skills/` | |
| Cursor | `.agents/skills/`, `.cursor/skills/`, also reads `.claude/skills/` | |
| GitHub Copilot | `.github/skills/`, `.claude/skills/`, `.agents/skills/` | `~/.copilot/skills/` |

These were read from each vendor's documentation on 13 November 2026. Verify during build; they change.

Two folders cover nearly everything: `.agents/skills/gertie/` and `.claude/skills/gertie/`.

## Installation

### With the skills installer

```bash
npx skills add ajithonmain/gertie
```

This uses the open-source `skills` command from Vercel, which detects the installed agents and copies the skill to the right folders. It needs Node 22.20 or newer. The repository must have the skill at `skills/gertie/`.

### By hand

```bash
git clone https://github.com/ajithonmain/gertie
cp -r gertie/skills/gertie ~/.claude/skills/
```

### First run

`node scripts/gertie.mjs doctor` checks the environment and prints what is missing with the command to fix each:

```
Node          26.4.0     ok
ffmpeg        7.1.1      ok   (libvpx-vp9, libwebp_anim, prores_ks, libx264, hevc_videotoolbox)
Playwright    not found  run: npm install playwright   (in the skill folder)
Browser       Chrome     ok   (system Chrome)
```

Compiling and validating work with Node alone. Rendering needs Playwright and a browser. Export needs ffmpeg. The skill degrades in that order and always says what is unavailable.

## For agents without a shell

Chat applications that cannot run commands cannot use the scripts. Two options:

1. **A paste-in prompt.** `site/prompt.txt` contains `scene.md` and `motion.md` joined into one block. A user pastes it into any chat model, asks for an animation, receives a scene file, and compiles it on the website (below) or locally.
2. **An MCP server**, later. A thin wrapper exposing `qa`, `export` and `import` as tools, calling the same code. It lets desktop chat applications with MCP support use Gertie. Not part of the first release.

## The website

Address: `gertiestudio.pages.dev`, hosted on Cloudflare Pages, built from the `site/` folder of the repository.

Because the compiler and validator are pure code with no dependencies, they run in a browser. The site uses that.

Pages:

- **Home.** One sentence on what Gertie is, the install command, and a gallery of example animations playing live.
- **Playground.** A text editor with a scene file on the left and the live result on the right, with lint messages below. Buttons download the Lottie JSON and the SVG. This is also how a user compiles a scene written by a chat model without a shell.
- **Gallery.** Every corpus example with its scene source and outputs.
- **Docs.** The reference files, rendered.
- **Benchmark.** The published pass rates and the contact-sheet gallery from the latest evaluation run.

Technology: Vite and TypeScript, importing the compiler straight from `src/`. Minimal dark theme. Inline SVG for icons, no icon library. No analytics that need a consent banner. No emojis.

The page must state: "Gertie is not affiliated with LottieFiles or the Lottie Animation Community."

Cloudflare Pages settings: build command `npm run build:site`, output directory `site/dist`, production branch `main`.

The playground does not export video or GIF; that needs ffmpeg. It says so and points to the skill.

## The GitHub repository

- Name: `ajithonmain/gertie`. Public. MIT licence.
- Topics: `agent-skills`, `lottie`, `svg-animation`, `animation`, `claude-code`, `codex`, `motion-graphics`.
- The README opens with an animated SVG made by Gertie. It plays on GitHub with no JavaScript, which demonstrates the SVG output in the first second.
- `CONTRIBUTING.md` explains the corpus and golden tests, since most contributions will be presets and examples.
- Issue templates: bug report (asks for the scene file and the `qa` report), preset request.
- Releases are tagged. Each release notes the pass rate from the evaluation run.

## Listing

After the first release, submit the skill to the public directories that index Agent Skills (for example skills.sh). Verify the current submission process at the time.

## Versioning

- The scene format has its own version number (`"gertie": 1`). A breaking change to the format increases it, and the compiler keeps reading older versions.
- The skill uses semantic versioning. The version is printed by `gertie --version` and recorded in each output file's metadata (`"generator": "gertie x.y.z"` in the dotLottie manifest, a comment in the SVG).
