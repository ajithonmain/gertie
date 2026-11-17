# Licences and naming

Gertie is MIT licensed and is meant to be usable by anyone, including commercially. That promise depends on what it bundles and what it requires. This document is the rule book.

This is a practical reading by the project's authors, not legal advice.

## The rule

- **Bundled or imported code** must be MIT, Apache-2.0, BSD or ISC.
- **Copyleft tools** (GPL, AGPL) are never bundled, imported or required. They may be called as separate programs when the user has installed them, as an optional improvement, and the documentation states their licence.
- **Tools with commercial restrictions** are never required.
- Every bundled third-party file ships with its licence notice.

## Dependencies

### Allowed in the core

| Item | Licence | Role |
|---|---|---|
| lottie-web | MIT | Reference player, bundled in `assets/` |
| Lottie JSON Schema and `lottie-specs` | MIT | Validation |
| Playwright | Apache-2.0 | Rendering and tests, installed by the user |
| dotlottie-web | MIT | Second player in tests |
| esbuild, TypeScript | MIT, Apache-2.0 | Build only |
| SVGO | MIT | Optional SVG optimization |
| opentype.js | MIT | Text to outlines, later |
| ffmpeg | LGPL or GPL depending on build | External program the user installs. Not bundled |

ffmpeg is called as a separate program and is never distributed with Gertie, so its licence does not affect Gertie's. Some of the encoders used (libx264) make a given ffmpeg build GPL; that is a property of the user's ffmpeg, not of Gertie.

### Optional external tools only

| Item | Licence | Rule |
|---|---|---|
| gifski | AGPL-3.0 | May be called if installed, for better GIFs. Never bundled |
| gifsicle | GPL-2.0 | Same |
| VTracer | Reported MIT. Verify during build | External program for image tracing |
| Segment Anything, LaMa | Code reported Apache-2.0. Verify code and weights separately | Optional cutout add-on only |
| HyperFrames | Reported Apache-2.0. Verify during build | External program, optional video route |

### Not used

| Item | Reason |
|---|---|
| python-lottie | AGPL-3.0. Do not import or vendor. Do not copy code from it |
| Glaxnimate | GPL-3.0, and no macOS build of its Python module |
| potrace | GPL |
| Remotion | Paid licence for companies above three people. An optional adapter, if ever added, must print this condition |
| puppeteer-lottie, timecut, timesnap | Unmaintained, pinned to a 2020 browser driver |
| rlottie | Declared unmaintained by its authors |
| OmniLottie training data | Non-commercial licence. The model itself is impractical for most users (about 15 GB of GPU memory) |

### Ideas adapted from other projects

- **rossark-motion-skill** (github.com/rossark0/rossark-motion-skill, MIT). A method for idle and character motion with run-time templates for React Native and SwiftUI. Gertie took ideas and starting numbers from its text: loops out of phase, a blink that closes faster than it opens, recipes by subject, the check list for a character that feels alive, and measuring small motion in a reference clip. No code, template, tool or demo file was copied, and the text in Gertie's documents is written fresh, so no notice needs to ship. What was taken and what was left out is recorded in `09-motion-presets-and-rigs.md` and `10-references.md`.

### Content

- Do not download or bundle animations from LottieFiles or any marketplace. Their free animations carry their own licence.
- Every example in `examples/` is original work made for this project.
- Fonts bundled later for text outlines must be under the SIL Open Font Licence or similar, with the notice included.

## Adding a dependency

Before adding anything:

1. Read the licence file in its repository, not a summary on a registry page.
2. Check its own dependencies the same way.
3. Add a row to the tables above in the same change.
4. If it will be bundled, add its notice to `skills/gertie/assets/THIRD-PARTY-LICENSES.txt`.

A continuous integration step runs a licence checker over the dependency tree and fails on anything outside the allowed list.

## Naming

### The word Lottie

Lottie is an open animation format maintained by the Lottie Animation Community, a project under the Linux Foundation. Many independent open-source projects use the word descriptively, as in "exports Lottie" or "text-to-Lottie". The research found no published trademark policy for the word, but it did not search any trademark register.

**What Gertie does:** uses "Lottie" only to describe the file format. "Gertie exports Lottie JSON" is fine.

### LottieFiles product names

These belong to LottieFiles (Design Barn Inc.): LottieFiles, Lottie AI, Lottie Creator, dotLottie, Motion Copilot.

**What Gertie does:**

- Never uses them in the project name, package names, command names, domain names or the skill's `name` field.
- May refer to them in prose where needed for accuracy: "a free alternative to Lottie AI", "writes `.lottie` files in the dotLottie format".
- Never uses their logos, colours or visual style.
- States on the website and in the README: "Gertie is not affiliated with LottieFiles or the Lottie Animation Community."

### Comparative statements

Saying Gertie is an alternative to a named paid product is ordinary comparative description. Keep such statements factual and dated: prices and limits change. The comparison table in `01-product.md` reflects what was published on 13 November 2026. Recheck before each release, and link to the source.

Do not claim that Gertie's output quality equals or exceeds the paid product. Publish the benchmark and let people compare.

### The name Gertie

Gertie the Dinosaur is a 1914 animated film by Winsor McCay, one of the first cartoons with a character. It is in the public domain. The name was chosen because it echoes Lottie (which is named after the animator Lotte Reiniger) and has its own place in animation history.

Checked on 13 November 2026:

| Where | Status |
|---|---|
| npm `gertie` | Taken by an empty package from 2014. Not needed; installation is through GitHub |
| npm `gertie-cli`, `gertie-skill` | Free |
| PyPI `gertie` | Free |
| GitHub user `gertie` | Taken. The repository lives under the owner's account as `<owner>/gertie` |
| `gertie.pages.dev` | Taken |
| `askgertie.pages.dev`, `getgertie.pages.dev` | No site responding; likely free. Confirmed only when the Pages project is created |
| Existing software named Gertie | A few small unrelated repositories. None in animation |

No trademark register was searched. Do this before investing in the name commercially.

A drawing of Gertie the dinosaur makes a natural mascot. Draw an original one for the project; do not copy frames from restorations of the film, which may carry their own rights.

## Output licence

Gertie claims no rights over what it produces. Animations made with Gertie belong to the person who made them, subject to the rights in any artwork they supplied. State this in the README. It is a real advantage over the paid product, whose published terms restrict commercial use on its lower plans.

## Privacy

Gertie runs entirely on the user's machine. It makes no network requests: lottie-web and the schema are bundled, and the renderer loads local files only. A test asserts that rendering performs no network access. There is no telemetry. State this in the README.
