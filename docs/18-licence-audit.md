# Licence audit

Audited 17 November 2026 against `15-licences-and-naming.md`. This is a practical reading by the project's authors, not legal advice. The licence file in each package was read, not a registry summary.

## Result

Clean. Nothing GPL, AGPL or commercially restricted is bundled, imported or required. Every bundled third-party file has its notice in `skills/gertie/assets/THIRD-PARTY-LICENSES.txt`.

## Runtime dependencies

`package.json` has no `dependencies`. `npm ls --omit=dev` is empty.

## Bundled into `skills/gertie/scripts/gertie.mjs`

| Package | Licence | Notice shipped |
|---|---|---|
| ajv | MIT | yes |
| fast-deep-equal | MIT | yes |
| fast-uri | BSD-3-Clause | yes |
| json-schema-traverse | MIT | yes |
| @lottie-animation-community/lottie-specs (validator code) | MIT | yes |

`playwright` and `playwright-core` are marked external in `scripts/build.mjs` and are not bundled. The user installs Playwright (Apache-2.0).

## Shipped as files in `skills/gertie/assets/`

| File | Source | Licence | Notice |
|---|---|---|---|
| `lottie.min.js` | lottie-web 5.13.0 | MIT | yes, plus `lottie.LICENSE.md` |
| `lottie.schema.json` | lottie-specs | MIT | yes |
| `render.html`, `ascii-render.html` | written for this project | MIT | not applicable |

## Development and test dependencies (not shipped)

| Package | Licence |
|---|---|
| @playwright/test, playwright | Apache-2.0 |
| @lottiefiles/dotlottie-web | MIT |
| hyperframes | Apache-2.0 |
| esbuild, tsx, @types/node | MIT |
| typescript | Apache-2.0 |

## External programs called, never bundled

- ffmpeg. Its licence depends on the user's build (LGPL or GPL). Gertie calls it as a separate program.
- HyperFrames, optional video route. Apache-2.0.
- Not used: gifski (AGPL), gifsicle (GPL), potrace (GPL), python-lottie (AGPL).

## Content

- Every file in `examples/` and `assets/header.svg` is original work made for this project; the SVG is compiler output.
- No animation is taken from LottieFiles or any marketplace.

## Names

No product, package, script or command name uses a LottieFiles name. The README carries the non-affiliation line.

## Automated check

`npm run check:licences` (`scripts/check-licences.mjs`) walks every installed package, including nested ones, and fails on any licence outside the allowed list. It runs in CI after the type check. At the time of audit it passed over 94 packages.

One reviewed exception: the libvips that sharp loads, which is LGPL-3.0-or-later. It comes as `@img/sharp-libvips-*` (prebuilt native builds) and, on Linux, as `@img/sharp-wasm32` (a WebAssembly build licensed Apache-2.0 AND LGPL-3.0-or-later AND MIT, installed as an optional dependency, so the check only meets it in CI). Both arrive only through hyperframes, an optional external tool, as a dev dependency. They are not bundled, not shipped and not imported by Gertie.

## Not yet done

- Transitive dependencies are covered by the check, but the licence files of the permissive ones were not read one by one.
- No trademark register was searched for "Gertie".
