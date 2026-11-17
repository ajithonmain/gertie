# Product

## What Gertie is

Gertie is an agent skill: a folder containing instructions (`SKILL.md`), reference material and scripts. An agent such as Claude Code, Codex CLI, Gemini CLI, Cursor or GitHub Copilot loads it when a user asks for an animation. The agent does the creative work (deciding what to draw and how it should move). Gertie does the mechanical work (producing valid files, checking them, rendering and exporting).

It is a free alternative to Lottie AI, the paid text-to-animation product LottieFiles launched in November 2026 at $19.99 per user per month with 60 generations. Gertie costs nothing beyond the model the user already has.

## Who it is for

- Developers who want an animated icon, loader or illustration without opening a motion design tool.
- Content creators who want short animated videos, stickers and reels.
- Designers who have artwork (an SVG, a flat illustration) and want it to move.
- Anyone using an AI agent that can run shell commands.

## What a user can ask for

| Request | What Gertie produces |
|---|---|
| "A loading spinner with three bouncing dots, blue, two second loop" | Lottie JSON, animated SVG |
| "Animate this logo SVG: draw the outline, then pop the fill" | Lottie, SVG, transparent WebM |
| "Make this illustration blink and sway, export for Instagram" | 9:16 MP4 |
| "A sticker pack of five emoji-style reactions for Telegram" | WebM within Telegram's limits |
| "A 30 second explainer with three scenes and captions" | MP4 through a storyboard |
| "An ASCII animation of a rocket launch for my README" | Animated SVG, GIF |

## Output formats

| Format | Use | Transparency |
|---|---|---|
| Lottie JSON (`.json`) | Apps, websites with a Lottie player | Yes |
| dotLottie (`.lottie`) | Same, smaller file | Yes |
| Animated SVG (`.svg`) | `<img>` tags, READMEs, no JavaScript | Yes |
| GIF | Email, chat, legacy | 1-bit only |
| APNG | Discord stickers, web | Full alpha |
| Animated WebP | Web, WhatsApp stickers | Full alpha |
| WebM VP9 | Web video, Telegram stickers | Full alpha |
| ProRes 4444 MOV | Video editors | Full alpha |
| HEVC MOV | Safari and iOS video (macOS only to encode) | Full alpha |
| MP4 H.264 | Everywhere | No, solid background |

## What Gertie is good at

- Icons, loaders, logo reveals, user-interface micro-interactions.
- Flat vector illustration with moving parts.
- Line drawing effects, shape morphs, staggered sequences.
- Simple characters built from parts: blink, wave, bounce, breathe.
- Animating artwork the user supplies.

## What Gertie cannot do

These limits are stated in `SKILL.md` so that the agent tells the user instead of producing a bad result.

- **New poses from one drawing.** If the user supplies a single illustration, Gertie can move the existing parts (eyes, head tilt, hair, background) but cannot make the character walk or turn. That requires AI video generation, which is a different kind of tool.
- **Photorealism.** Vector animation is flat shapes. A photograph can be placed as an image layer and moved, nothing more.
- **Three dimensions.** Lottie is two-dimensional.
- **Complex characters from text alone.** Language models draw detailed characters poorly. Good character animation starts from supplied artwork. LottieFiles says the same about its own product.
- **Painterly texture as vectors.** Grain, brush strokes and soft shading are lost when an image is traced. The cutout method (see `10-references.md`) keeps them by animating image pieces instead.
- **Smooth edges in transparent GIF.** The GIF format has one bit of transparency. Gertie recommends a better format whenever the destination accepts one.

## How Gertie differs from what exists

| | Lottie AI (paid) | diffusionstudio/lottie (free skill) | Gertie |
|---|---|---|---|
| Price | $19.99 per month, 60 generations | Free | Free |
| Model | Theirs | Yours | Yours |
| Model writes | Private animation language | Raw Lottie JSON | Open scene file |
| Validation | Self-repair (their claim) | None documented | Schema, lint, render |
| Animated SVG output | No | No | Yes |
| Transparent video and GIF | Yes | Not documented | Yes |
| Painterly references | No | No | Cutout engine |
| Multi-scene video | No | No | Storyboard |
| Commercial use | Team plan and above, per their policy page | MIT | MIT |

## Requirements for the user

- Node 22 or newer.
- ffmpeg, for any raster or video export.
- A Chromium browser, installed automatically by Playwright or found on the system, for rendering and checks.
- An agent that can run shell commands. A model with vision gives much better results because it can look at the rendered frames.

Agents without shell access can still use the scene format reference to write a scene file, which the user compiles themselves.

## Success measure

Gertie publishes a pass rate: the share of a fixed set of prompts for which an agent using Gertie produces a file that passes all checks on the first attempt and within three repair rounds. No such number exists yet for any tool-assisted approach. Publishing one is part of the product.
