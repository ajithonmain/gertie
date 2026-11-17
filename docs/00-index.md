# Gertie design documents

These documents describe what Gertie is and how to build it. They are written for a developer or a coding agent who has not seen the earlier discussion.

## Reading order

| Document | Read it when |
|---|---|
| [01-product.md](01-product.md) | First. What Gertie is, who it is for, what it can and cannot do |
| [02-architecture.md](02-architecture.md) | First. The pipeline, the modules, the repository layout |
| [03-scene-spec.md](03-scene-spec.md) | Before writing any compiler code. The scene file format |
| [04-lottie-emitter.md](04-lottie-emitter.md) | Phase 1. How a scene becomes Lottie JSON |
| [05-svg-emitter.md](05-svg-emitter.md) | Phase 3. How a scene becomes animated SVG |
| [06-validation.md](06-validation.md) | Phase 1. The three validation gates and the error format |
| [07-render-and-export.md](07-render-and-export.md) | Phases 2 and 4. Frame rendering and every export format |
| [08-testing.md](08-testing.md) | Every phase. Automated testing, including the runtime self-check |
| [09-motion-presets-and-rigs.md](09-motion-presets-and-rigs.md) | Phase 5. Presets and character rigs |
| [10-references.md](10-references.md) | Phase 6. Working from SVG, image, Lottie and video references |
| [11-video-composition.md](11-video-composition.md) | Phase 7. Storyboards and full videos |
| [12-ascii.md](12-ascii.md) | Phase 8, and phase 8b (dense and styled ASCII, designed, not built). ASCII animation |
| [13-skill-packaging.md](13-skill-packaging.md) | Phase 9. SKILL.md, installation, the website |
| [14-build-plan.md](14-build-plan.md) | Always. Phases, tasks and acceptance checks. Ready-made prompts for phases 5b and 8b and for the quality phase are in `prompts/` |
| [15-licences-and-naming.md](15-licences-and-naming.md) | Before adding any dependency |
| [16-quality-benchmark.md](16-quality-benchmark.md) | Before any quality work. Measurements of 454 professionally made Lottie animations, and of Gertie's corpus, taken the same way |
| [17-quality-tuning.md](17-quality-tuning.md) | Before any quality work. The plan that closes the gap: artwork, motion, format features, SVG, GIF and video. Scheduled as phase 10 in the build plan; section 1 (the profile) is built, the rest is designed, not built |
| [18-licence-audit.md](18-licence-audit.md) | Phase 9. What is bundled, under which licence, and what is still open |
| [19-agent-evaluation.md](19-agent-evaluation.md) | Phase 9. Validator, cross-agent installs, agent pass rates, clean-machine run |
| [20-release-checklist.md](20-release-checklist.md) | Phase 9. Publishing, the website deploy and directory submissions |

## Research behind the design

The design follows a research pass done on 13 November 2026. The synthesis is in `reports/Free Lottie animation agent skill.md`. The raw notes with sources are in `research_notes/Free Lottie animation agent skill/`:

- `lottie_format_and_generation.md` the format, the safe subset, libraries, published results on LLM generation
- `animated_svg_export.md` SVG animation mechanisms, converters, browser limits
- `raster_video_gif_export.md` renderers, ffmpeg recipes, platform limits
- `market_and_skill_packaging.md` the paid product, existing free skills, the Agent Skills format

When a design document states a fact about a third-party tool or format, the source is in those notes.

## Status markers used in these documents

- **Verified** means the claim was tested during research (for example the ffmpeg recipes).
- **Verify during build** means the claim comes from documentation or reasoning and has not been run. Test it before depending on it.
- **Decision** means a choice was made between alternatives; the reason is given so it can be revisited.

## Three ideas the whole design rests on

1. **The model never writes Lottie JSON.** It writes a compact scene file. A compiler produces the Lottie. In the one published benchmark, general models writing raw Lottie in one shot succeeded about one time in ten. Every common failure in that study is something a compiler can make impossible.
2. **One scene, two emitters.** The same scene file compiles to Lottie JSON and to animated SVG. There is no conversion between the two, because the free converters are weak.
3. **Every output is checked by rendering it.** A file that passes the schema can still look wrong. Gertie renders frames in a real browser and both the tool and the agent inspect them.
