# Agent evaluation and cross-agent testing

Results of the release checks on 17 November 2026: the Agent Skills validator, installs in coding agents, the agent evaluation, and a clean-machine run of the README.

## Skill validation

`npx skills-ref validate skills/gertie` prints `Valid skill`. Run from the specification's reference tool (npm package `skills-ref`).

## Cross-agent installs

| Agent | Folder used | Result |
|---|---|---|
| Claude Code 2.1.321 | `.claude/skills/gertie` | Works. The agent found the skill from the description, wrote a scene, ran `qa`, installed Playwright itself when the renderer was missing, and reported the contact sheet. Relative script paths worked. |
| Codex CLI 0.169.0 | `.agents/skills/gertie` | Works. The agent found the skill, wrote and validated the scene and exported Lottie and SVG. Its sandbox had no network, so Playwright could not be installed; the agent said the render checks were skipped, which is the behaviour the skill asks for. |
| Gemini CLI 0.68.0 | `.agents/skills/` or `.gemini/skills/` | Not tested. The CLI starts but has no authentication on the test machine. |
| Cursor | `.agents/skills/`, `.cursor/skills/` | Not tested. Cursor is not installed on the test machine. |

Both tested agents resolved `scripts/gertie.mjs` relative to the skill folder, so the wording in `SKILL.md` needed no change. The two untested rows stay open until someone with those tools runs the steps in "Run it yourself" below and records the result here.

### Run it yourself

1. Copy `skills/gertie` to the agent's skills folder in a scratch project.
2. Ask: "make a loading spinner and save it as spinner.gertie.json, then check it".
3. Pass if the agent reads the skill, runs `qa`, and reports zero errors, or says plainly that the render checks could not run.

## Agent evaluation

The harness is `tests/eval/run.mjs` with the 30 prompts in `tests/eval/prompts.json` (6 icons, 6 loaders, 5 interface pieces, 3 transitions, 4 characters, 3 scenes, 3 reference-based requests).

Method:

- Each prompt runs in a fresh folder holding only the skill, using Claude Code in non-interactive mode with the tools Bash, Read, Write and Edit.
- The renderer is provisioned in advance by linking `node_modules`, so the score measures the skill and not an npm install.
- **First pass**: the first `qa` run the agent made had zero errors. An agent that never ran `qa` counts as a failure here.
- **Within three**: one of its first three `qa` runs had zero errors.
- **Final**: the harness runs `qa` on the scene left in the folder. This is lenient, because it passes scenes the agent never checked itself.
- API failures (usage limit, crash) are excluded and the prompt is rerun with `--resume`. An earlier pass lost 25 runs to a usage limit; none of those numbers are used.
- One run per prompt per model. Differences of a few points are noise. Passing means valid and moving, not beautiful; the contact sheets in `tests/eval/results/<model>/<prompt>/sheet.png` and on the website let a reader judge.

Results (Claude Code, 30 prompts each):

| Model | First pass | Within three | Final |
|---|---|---|---|
| haiku (small) | 80% | 87% | 100% |
| opus (strong) | 87% | 87% | 100% |

What the numbers show:

- All 60 final scenes pass `qa`. The skill's compile and validate loop reliably yields a valid scene.
- The small model's misses were mostly skipping `qa` (four prompts ran no `qa` at all), which breaks rule 2 of `SKILL.md`. The strong model never skipped it.
- The strong model's misses were all in the three scene prompts, which needed repair rounds (2 to 7 `qa` runs). Complex scenes are where the checks matter most.
- The gap between models is small, which is the aim of the design.

Not measured: Codex CLI and Gemini CLI pass rates (no harness adapter yet), and any model other than the two above.

Rerun with `node tests/eval/run.mjs --model <name>`. The website's benchmark page is built from `tests/eval/results/*/results.json`.

## Clean-machine run

On a clean `node:22` Linux container with only ffmpeg installed, following the README: copying the skill, `doctor` (reported Playwright missing), compile with Node alone (worked), `npm install playwright` and `npx playwright install --with-deps chromium` in the skill folder, `doctor` (all ok), `qa`, `export --to gif,webm` and `export --for telegram` (all produced files with alpha and passing checks). HEVC with alpha was reported unavailable, as documented. The run found one README gap: the browser download step was missing when Chrome is not installed. The README now includes it.
