# Contributing

Most contributions are motion presets, rig presets and example scenes. Read `docs/00-index.md` first, then the document for the area you are changing.

## Setup

```bash
npm ci
npm run typecheck
npm test
npm run test:browser
```

Node 22 or newer. Browser tests need Playwright browsers (`npx playwright install`) and ffmpeg.

## Rules

- TypeScript strict mode. No `any` without a comment saying why.
- No emojis in code, comments, documents, commit messages or CLI output.
- Icons are inline SVG only.
- Never hand-write Lottie JSON. Every Lottie file here comes from the compiler.
- Error messages name the node id, the property, the problem and the fix.
- Do not add a dependency without reading its licence file and following `docs/15-licences-and-naming.md`. GPL and AGPL code is never bundled or imported.
- Do not use the names LottieFiles, Lottie AI, Lottie Creator, dotLottie or Motion Copilot in any product, package, script or command name.

## The corpus and golden tests

Every file in `examples/*.gertie.json` is part of the test corpus. Each is compiled, compared with its golden output, validated against the Lottie schema, rendered, and checked for Lottie and SVG parity on every sampled frame.

To add an example: write the scene, run `node skills/gertie/scripts/gertie.mjs qa <scene>` until it has no errors, then `npm run golden:update` and review the golden diff. Examples must be original work.

To add a preset: add it with a unit test of its start and end state, and an example that uses it.

## Bundled scripts

`skills/gertie/scripts/` holds the bundled output. Run `npm run build` and commit the result; CI fails if it differs from a fresh build.

## Pull requests

Describe what changed and which tests cover it. If a design document disagrees with reality, fix the document in the same change.
