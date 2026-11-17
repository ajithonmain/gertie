# Gertie

Gertie is an open-source agent skill that lets any LLM or coding agent create vector animations for free. It is positioned as a free alternative to Lottie AI. The agent writes a small scene file; Gertie compiles it to Lottie JSON and animated SVG, validates and renders it, and exports GIF, transparent video and other formats.

This repository is at the design stage. The documents in `docs/` are the source of truth for what to build. Read `docs/00-index.md` first, then the document for the phase you are working on.

## How to work in this repository

- Follow `docs/14-build-plan.md` phase by phase. Do not start a phase until the previous phase's acceptance checks pass.
- Before writing code for a module, read its design document in full. The documents contain rules that were learned from research and are easy to get wrong (Lottie render order, easing handle mapping, transform order, SVG animation limits).
- Anything marked "Verify during build" in the documents is a claim that has not been tested yet. Test it before depending on it, and update the document with the result.
- When a document and reality disagree, fix the document in the same change as the code.
- Never hand-write Lottie JSON in examples or tests. Every Lottie file in this repository is produced by the compiler from a scene file.

## Technology decisions

- Language: TypeScript in strict mode, source in `src/`.
- Runtime baseline: Node 22 or newer. No Python in the core path.
- Distribution: `src/` is bundled with esbuild into single-file `.mjs` scripts under `skills/gertie/scripts/`. The bundled scripts are committed so that an agent can run them with `node` and no build step.
- The compiler, validator and SVG emitter have zero runtime dependencies. Rendering depends on Playwright and export depends on ffmpeg; both are detected at run time and reported clearly when missing.
- Tests use the built-in `node:test` runner. Browser tests use Playwright.
- Licence: MIT. Do not import, vendor or bundle AGPL or GPL code. See `docs/15-licences-and-naming.md`.

## Code style

- TypeScript strict mode always. No `any` unless a comment explains why.
- No emojis anywhere: code, comments, documents, commit messages, CLI output.
- Icons are inline SVG only. No icon libraries.
- Any user interface (the preview page, the website) is minimal and dark-themed.
- Prefer small pure functions. The compiler pipeline is a chain of pure transforms from scene to output; keep file and process access at the edges in `src/cli/`.
- Error messages are written for an LLM to act on: they name the node id, the property, the problem and the fix.

## Safety rules

- Confirm with the user before any destructive operation (deleting files, rewriting history, force pushing).
- Do not commit or push unless the user asks.
- Do not use the names "Lottie AI", "LottieFiles", "dotLottie", "Lottie Creator" or "Motion Copilot" as part of any product, package, script or command name. Descriptive use in documentation is fine.

## Naming

- Project and skill name: `gertie`
- GitHub repository: `<owner>/gertie`
- Website: `askgertie.pages.dev` (Cloudflare Pages)
- npm, only if a CLI package is published later: `gertie-cli`
- Scene file extension: `.gertie.json`
- Storyboard file extension: `.story.json`

## Where things are

- `docs/` design documents
- `reports/` and `research_notes/` the research the design is based on, with sources
- `src/` TypeScript source (to be created in phase 1)
- `skills/gertie/` the distributable skill (to be created in phase 1)
- `examples/` scene files that double as the test corpus
- `tests/` unit, golden and browser tests
- `site/` the landing page for Cloudflare Pages
