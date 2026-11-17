# Market landscape for AI-generated Lottie / motion graphics, and Agent Skill packaging (state as of 13 November 2026)

All pages were accessed on 2026-11-13 unless noted. Prices use a "$" sign on vendor pages; vendors do not name the currency, US dollars is assumed. GitHub star counts, licenses and "last push" dates come from the GitHub REST API (`api.github.com/repos/<owner>/<repo>`) queried on 2026-11-13; "last push" is the `pushed_at` field, which is a proxy for last commit.

## 1. What AI products has LottieFiles launched, and what do the plans cost?

### Takeaway
The claim "Lottie introduced its own AI with a roughly 20 USD/month plan" is essentially verified: LottieFiles launched a standalone text-to-Lottie product called **Lottie AI** (lottie.ai) on Product Hunt in the week of 12 November 2026, and the cheapest paid LottieFiles plan (Individual) is **$19.99 per user/month billed annually**, including up to 60 Lottie AI generations per month. The exact paid prices shown on lottie.ai/pricing itself could not be read (JavaScript-rendered), so the $19.99 figure is from lottiefiles.com/pricing, which lottie.ai links to for plan comparison.

### Cited Findings

Pricing (lottiefiles.com/pricing, accessed 2026-11-13):
- Individual: "$19.99 per user/month, billed annually"; 1 editor seat; 300 AI credits per month (pool); 10 GB CDN / 2 GB DAM storage; described as "For solo designers & freelancers". Per-tool caps: Lottie AI up to 60 generations, Motion Copilot up to 100 uses, Raster to Vector up to 60, Prompt to Vector up to 60. — [LottieFiles pricing](https://lottiefiles.com/pricing)
- Team (marked "Recommended"): "$24.99 per user/month, billed annually"; 2+ editors, unlimited viewers; 600 AI credits per month (pool); Lottie AI up to 120, Motion Copilot up to 200, Raster to Vector up to 120, Prompt to Vector up to 120; described as "For teams working on commercial projects". — [LottieFiles pricing](https://lottiefiles.com/pricing)
- Team+ (5+ editors, 10+ developer seats, custom AI credits, 500 GB CDN) and Enterprise (25+ editors) are contact-sales. — [LottieFiles pricing](https://lottiefiles.com/pricing)
- Credit top-ups: "Top up at 20¢ a credit, packs of 50 or 100" (Individual and Team). MCP is "free to try during beta". — [LottieFiles pricing](https://lottiefiles.com/pricing)
- The pricing page shows only annual-billed prices; no month-to-month price is displayed, and no watermark policy is stated. Exports listed include GIF, MP4, transparent WebM and MOV. — [LottieFiles pricing](https://lottiefiles.com/pricing)
- Free tier, as shown on lottie.ai/pricing: "Starter Plan ... $0 Free, for life"; "Lottie AI: free generations"; "MCP: free to try during beta"; "Motion Copilot: 5 uses"; "Raster to Vector: 5 uses"; "Prompt to Vector: 10 uses"; "Everything in LottieFiles Free plan"; "5 file uploads"; "20 MB asset storage"; "Export to Lottie JSON, dotLottie and more". Paid plans: "One workspace, one pool of credits. Lottie AI plus the rest of LottieFiles." — [Lottie AI pricing](https://lottie.ai/pricing) (static HTML extracted with curl; paid-plan prices are loaded by JavaScript and were not readable)
- A search-result summary of third-party coverage reports the free Starter plan as "10 generations to use over time"; the lottie.ai page itself only says "free generations". — [Easy With AI listing](https://easywithai.com/ai-design-tools/lottie-ai/) (secondary, unverified)
- Free workspaces are limited to 5 files and 20 MB of DAM storage per the LottieFiles Figma plugin docs (updated June 2026). — [LottieFiles docs: plans and limits](https://docs.lottiefiles.com/en/integrations/figma/03_workspace/plans-and-limits)
- Commercial use (LottieFiles Commercial Use Policies, "Last updated: November 10, 2026"): Starter: not allowed; Individual: not allowed; Team: allowed; Enterprise: allowed. "This applies to work you create, edit, or customize using LottieFiles services." "Using LottieFiles services commercially on a Starter or Individual plan breaks our terms". Free public library animations are under the Lottie Simple License and can be used commercially. — [LottieFiles commercial use guide](https://help.lottiefiles.com/commercial-use-guide)
- Conflict: the Lottie AI landing page says "Everything you generate belongs to you, and all content comes with a full commercial AI license", while the commercial-use guide bars commercial use on Starter and Individual. The commercial-use guide does not address AI-generated content specifically. — [Lottie AI](https://lottie.ai/); contradicted by [commercial use guide](https://help.lottiefiles.com/commercial-use-guide)
- Lottie AI "has its own plans and credits", "separate from your LottieFiles plan", and a paid LottieFiles plan is not required to use it. — [Lottie AI](https://lottie.ai/). This sits awkwardly with lottie.ai/pricing saying "One workspace, one pool of credits" and with lottiefiles.com/pricing listing Lottie AI generations inside Individual/Team; the two pages may have been written at different times.

Product launches and dates:
- Lottie AI: Product Hunt tagline "Editable vector animations from a text prompt"; listed as "Launched this week" with the daily leaderboard link dated 2026/11/12 (exact date not explicitly stated). Maker comment: "It's free to try". — [Product Hunt: LottieFiles](https://www.producthunt.com/products/lottiefiles?launch=lottie-ai)
- Lottie Creator 2.0: Product Hunt launch 28 July 2026, tagline "After Effects for the web, built on Lottie". — [Product Hunt: LottieFiles](https://www.producthunt.com/products/lottiefiles)
- Motion Copilot 2.0: blog byline 22 July 2026; "originally published on 12 June 2024 and has been updated on 22 July 2026 to reflect new releases" (12 June 2024 is the earliest verified Motion Copilot article date; the page does not state it as the launch date). — [LottieFiles blog: Motion Copilot 2.0](https://lottiefiles.com/blog/working-with-lottie-animations/introducing-motion-copilot-on-lottie-creator)
- Lottie Creator MCP: blog "Lottie Creator Now Speaks MCP" dated 15 April 2026; names Claude, Cursor, Codex and "any MCP-compatible AI". — [LottieFiles blog: MCP](https://lottiefiles.com/blog/working-with-lottie-animations/your-ai-can-now-control-lottie-creator-heres-what-that-actually-means)
- Lottie Creator WebMCP tutorial dated 16 September 2026 (prompting from the ChatGPT desktop app, result opened in app.lottiefiles.com). — [LottieFiles blog: WebMCP](https://lottiefiles.com/blog/working-with-lottie-animations/how-to-create-animations-with-ai-using-lottie-creator-webmcp)
- Two official MCP servers exist. (1) Hosted "LottieFiles MCP" at `https://mcp.lottiefiles.com/mcp`: account/workspace/library access with four GraphQL tools (`operations_list`, `schema_search`, `schema_details`, `graphql_execute`), no API keys, sign in with LottieFiles account; install with `claude mcp add --transport http lottiefiles https://mcp.lottiefiles.com/mcp`. (2) Local "Lottie Creator MCP": `claude mcp add lottiefiles-creator -- npx -y @lottiefiles/creator-mcp@latest`, needs Node.js 18+ and an open Lottie Creator browser tab with MCP enabled. — [LottieFiles MCP docs](https://docs.lottiefiles.com/en/platform/mcp); [lottiefiles.com/mcp](https://lottiefiles.com/mcp)
- LottieFiles also publishes agent skills: `LottieFiles/motion-design-skill` (2,990 stars, MIT, last push 2026-05-18; "Universal motion design principles for AI agents — timing, easing, choreography, and Disney animation principles adapted for UI"), recommended alongside the Creator MCP via lottie.link/motion-design-skill; and `LottieFiles/creator-plugin-skills` (1 star, no license detected, last push 2026-11-05), installed with `npx skills add LottieFiles/creator-plugin-skills --skill '*'`. — [GitHub: motion-design-skill](https://github.com/LottieFiles/motion-design-skill); [LottieFiles docs: AI Agent Skills](https://docs.lottiefiles.com/en/creator-plugins/01_getting-started/ai-agent-skills)
- Other AI features on lottiefiles.com/ai: Motion Copilot, Prompt to State Machines, Prompt to Themes, Prompt to Vector, Raster to Vector, MCP/WebMCP. Data statement: "our Groq AI engine ensures that we never use any of your data to train AI models." — [LottieFiles AI](https://lottiefiles.com/ai)

### Inferences
- The "about 20 dollars a month" figure maps to the Individual plan at $19.99/user/month billed annually (about $240 charged per year). A true month-to-month price was not found and is likely higher.
- On the Individual plan, 60 Lottie AI generations for $19.99 is roughly $0.33 per generation; top-ups at $0.20 per credit against a 300-credit pool and a 60-generation cap suggest a Lottie AI generation costs about 5 credits (300/60), that is about $1.00 per extra generation at top-up rates. This is arithmetic from the page figures, not a stated price.
- The Individual plan is sold to freelancers but, per the commercial-use guide, does not permit commercial use; commercial rights effectively start at Team ($24.99/user/month with a 2-editor minimum, so about $50/month). This is a strong differentiator for a free, MIT-licensed skill whose output carries no such restriction.

### Gaps
- Exact paid-plan prices as displayed on lottie.ai/pricing (JavaScript-rendered; only the $0 Starter block was readable).
- Month-to-month (non-annual) price for Individual and Team.
- Credits consumed per Lottie AI generation in Turbo versus Quality mode; exact number of free generations on Starter.
- Whether free-plan exports are watermarked (no statement found on official pages).
- Exact launch date of the original Motion Copilot and of Prompt to Vector / Raster to Vector / Prompt to State Machines.

## 2. What does the LottieFiles AI do technically, and what are the reported quality limits?

### Takeaway
Lottie AI does not have the model emit raw Lottie JSON; per maker comments it writes "a small animation language" that a LottieFiles compiler turns into Lottie, with an automatic self-repair step and a multi-agent "Quality" mode. Motion Copilot and the Creator MCP instead drive the Lottie Creator editor (shapes, keyframes, easing) through tool actions. Independent quality reviews are thin; the vendor itself warns that from-scratch illustration is unreliable.

### Cited Findings
- Lottie AI inputs: a written description, optional duration and canvas size, optional imported SVG, image or Lottie JSON, and an optional custom color palette. Outputs: vector animation with named, grouped layers plus a per-animation control panel (color, size, timing, text) that changes output without regenerating. Modes: Turbo (single pass) and Quality (multi-agent plan-and-critique). Exports: dotLottie, Lottie JSON, GIF, MP4, WebM, MOV, plus SwiftUI or Jetpack Compose code. — [Lottie AI](https://lottie.ai/)
- Maker comments on Product Hunt (vendor statements): "It writes a small animation language that our compiler turns into clean, lightweight Lottie"; "Under the hood, Lottie AI doesn't push keyframes around"; "The AI repairs its own code before you ever see it"; control changes need "no new prompt, no credit, no waiting". — [Product Hunt: Lottie AI launch](https://www.producthunt.com/products/lottiefiles?launch=lottie-ai)
- Motion Copilot (inside Lottie Creator): "Describe what you want and Lottie Creator's built-in AI builds it; shapes, keyframes, easing, and loops, all editable and undoable in one click." Reads current selection and scene state, supports a model picker with "Auto" default, prompts in "14+ languages", and for bigger or destructive edits will "show a plan first and wait for your approval". — [LottieFiles AI](https://lottiefiles.com/ai)
- Motion Copilot 2.0 builds complete animations including shapes, text, gradients and drop shadows, streams its reasoning, and is undoable in a single undo; underlying models are not named. — [LottieFiles blog: Motion Copilot 2.0](https://lottiefiles.com/blog/working-with-lottie-animations/introducing-motion-copilot-on-lottie-creator)
- Prompt to Vector generates SVG from text; Raster to Vector converts PNG/JPG to SVG with "AI-powered smart grouping and accurately named layers"; Prompt to State Machines generates states, transitions and triggers and "often builds the full logic in a single shot". — [LottieFiles AI](https://lottiefiles.com/ai)
- Vendor-acknowledged limit (Creator MCP): "AI can be unpredictable generating illustration shapes from scratch"; LottieFiles recommends importing your own SVGs first and using the strongest model available. — [LottieFiles blog: MCP](https://lottiefiles.com/blog/working-with-lottie-animations/your-ai-can-now-control-lottie-creator-heres-what-that-actually-means)
- Vendor-acknowledged limits (WebMCP): "This process can take some time because the prompt first needs to be interpreted"; "the first generation doesn't have to be the final result"; quality "depends heavily on the quality and level of detail in your prompt". — [LottieFiles blog: WebMCP](https://lottiefiles.com/blog/working-with-lottie-animations/how-to-create-animations-with-ai-using-lottie-creator-webmcp)
- Anecdotal (Product Hunt launch-thread comments, several from people who appear to be LottieFiles staff): one commenter made a "pretty decent" owl in Quality mode without animation skills; another liked adjusting with controls, "No keyframes needed". General LottieFiles reviews (4.8 rating, 20 reviews) mention confusing editing and incomplete color controls, not tied to Lottie AI. — [Product Hunt: LottieFiles](https://www.producthunt.com/products/lottiefiles?launch=lottie-ai)
- Anecdotal (third-party review, search-result summary only, not read in full): the AI "works well for simple icons, loaders and interface motion", while complex character work and long story-driven pieces still need a skilled animator. — [vijaytalksai LottieFiles review 2026](https://vijaytalksai.com/lottiefiles-review/)

### Inferences
- The "intermediate animation language + compiler + self-repair + critique loop" architecture is the notable design signal: LottieFiles apparently found direct LLM emission of Lottie JSON too error-prone. A free skill can copy the pattern with a small builder library or DSL, a validator, and a render-and-inspect loop.
- The per-animation "control panel" (parameters exposed for tweak without regeneration) is a product differentiator a skill could approximate with Lottie slots/theming or a parameters file plus a rebuild script.
- Lottie AI launched about one day before this research, so the absence of independent reviews is expected rather than meaningful.

### Gaps
- No Reddit, Hacker News or X threads on Lottie AI or Motion Copilot quality or pricing were found; searches returned only vendor pages, Product Hunt and SEO review sites.
- Underlying models for Lottie AI and Motion Copilot are not disclosed (only "Groq AI engine" for data handling).
- No independent benchmark of Lottie AI output validity, file size or renderer compatibility.

## 3. Competing AI motion-graphics tools with vector output

### Takeaway
Rive is the best-documented competitor with agent features (AI Agent credits, a CLI usable from Claude Code); Jitter, SVGator and LottieLab are the main Lottie-exporting editors, at roughly $12 to $35 per editor per month. Coverage here is partial: only Rive figures trace to an official page, and several named tools were not researched.

### Cited Findings
- Rive (official pricing page, via search summary): Free and Cadet plans include limited AI Agent use; Voyager adds $20 and Enterprise $40 in AI credits per seat per month; top-up credits never expire. The Rive CLI is free to build, preview and test with from your own coding agent (for example Claude Code); only publishing or pushing a file to the editor draws on the allowance. — [Rive pricing](https://rive.app/pricing)
- Rive tier prices (third-party sites, consistent with each other): Cadet $9 per seat/month billed yearly (up to 3 seats, removes splash screen), Voyager $32 (up to 25 seats, advanced AI models), Enterprise $120 (companies with $10M+ revenue). One third-party site lists different AI credit amounts ($5 Cadet, $16 Voyager), conflicting with Rive's own page. — [aistackpicks Rive pricing 2026](https://aistackpicks.com/reviews/rive-pricing-2026/); [comparetiers Rive](https://comparetiers.com/tools/rive)
- Rive's native output is the .riv runtime format, not Lottie. Third-party Rive tooling for agents exists: Polymation ("Multi-Format Animation MCP", 30-day pass $15 once or $10/month, no Rive subscription needed) and `obeskay/rive-animator-skill` (4 stars, MIT, last push 2026-10-24; "Code-first Rive toolkit for AI agents ... SVG/Lottie to RML"). — [Polymation](https://rivemcp.stunning.gg/); [GitHub: rive-animator-skill](https://github.com/obeskay/rive-animator-skill)
- Jitter (secondary sources, conflicting): free plan with 720p 30fps video/GIF/Lottie export and limited AI credits; Pro reported variously at $8, $15 or about $16 per editor/month; AI-heavy tiers Max $35 and Ultra $59 per editor. One review notes Jitter renders prices dynamically. — [NTSOT Jitter review 2026](https://ntsot.com/jitter-review/); [kinoviz Jitter alternatives](https://kinoviz.com/alternatives/jitter)
- SVGator (secondary source, September 2026 annual rates): free plan exports static SVG only; Starter $20/month adds watermark-free animated SVG, Lottie, mobile exports and Player API; Pro $24; Team $27 per seat with a three-seat minimum. — [yespress SVGator](https://yespress.io/svgator)
- LottieLab (secondary sources agree): Free; Pro $12 per editor/month billed yearly or $18 month to month; free tier includes Figma import and GIF/MP4 export, with watermarked export noted by one source; described as a manual editor without text-to-animation. — [toolradar LottieLab pricing](https://toolradar.com/tools/lottie-lab/pricing); [iart.ai best AI motion graphics tools 2026](https://www.iart.ai/blog/best-ai-motion-graphics-tools-2026)
- Hosted OmniLottie endpoint: fal.ai serves the open OmniLottie model as `fal-ai/omnilottie` (pay-per-use API). — [fal.ai OmniLottie](https://fal.ai/models/fal-ai/omnilottie/llms.txt)
- Other text-to-Lottie sites surfaced: lotiqlab.com "AI Lottie Generator: Text to Lottie Animation, Free" and Vanikya AI (image, video, vector and Lottie generation with a Claude Code plugin). Not evaluated. — [Lotiq Lab](https://lotiqlab.com/ai-lottie-generator); [GitHub: vanikya-ai-mcp](https://github.com/vanikya/vanikya-ai-mcp)

### Inferences
- The paid cluster sits at about $12 to $35 per editor per month, with AI usage metered by credits everywhere. A free skill that runs on the user's existing LLM subscription has no per-generation fee; Rive's own framing ("your own coding agent runs on your own plan") shows incumbents already concede this model.
- Lottie JSON is the only output accepted across Jitter, SVGator, LottieLab and LottieFiles; Rive is a separate ecosystem.

### Gaps
- Not researched (no sources gathered): Recraft, Kittl, Phase, Fable, Linearity Move, Figma motion features, Canva, Adobe tools, Hera, Higgsfield-style tools. Their pricing and Lottie/SVG/transparent-video export support remain open.
- Jitter, SVGator and LottieLab prices are from secondary sites and should be confirmed on vendor pricing pages; transparency support for their GIF/MP4/WebM exports was not verified.

## 4. Open-source projects that already let an LLM or agent create animations for free

### Takeaway
A direct free alternative already exists and is popular: `diffusionstudio/lottie` (text-to-lottie skill, 5,736 stars, MIT, released 8 June 2026). Any new skill must differentiate from it (for example validation/render loop, SVG-grounded input, transparent video export, non-coding-agent portability) rather than assume an empty field. An open model (OmniLottie, CVPR 2026, Apache-2.0) also exists.

### Cited Findings

Lottie-generating skills, CLIs and models (GitHub API, 2026-11-13):

| Project | Stars | License | Last push | Approach / output |
|---|---|---|---|---|
| [diffusionstudio/lottie](https://github.com/diffusionstudio/lottie) | 5,736 | MIT | 2026-07-25 | Agent Skill `text-to-lottie`; agent writes raw Lottie JSON into `public/projects/<project>/<scene>/lottie.json`, live-reloading bundled player; outputs Lottie JSON |
| [OpenVGLab/OmniLottie](https://github.com/OpenVGLab/OmniLottie) | 813 | Apache-2.0 | 2026-04-06 | Fine-tuned VLM (Qwen2.5-VL) emitting parameterized Lottie tokens; text, text+image, video to Lottie JSON |
| [LottieFiles/motion-design-skill](https://github.com/LottieFiles/motion-design-skill) | 2,990 | MIT | 2026-05-18 | Knowledge-only skill (timing, easing, choreography); pairs with Creator MCP |
| [iart-ai/motion-skills](https://github.com/iart-ai/motion-skills) | 1,425 | MIT | 2026-11-11 | "56 open-source skills" for motion graphics, animation and video |
| [freshtechbro/claudedesignskills](https://github.com/freshtechbro/claudedesignskills) | 1,341 | MIT | 2025-11-20 | Collection incl. `lottie-animations` skill (web integration) |
| [iart-ai/web-animation-skills](https://github.com/iart-ai/web-animation-skills) | 89 | MIT | 2026-11-11 | GSAP, SVG, Lottie integration skills (playback, not generation) |
| [frankxai/awesome-motion-design-agent-skills](https://github.com/frankxai/awesome-motion-design-agent-skills) | 110 | CC0-1.0 | 2026-11-12 | Curated list: GSAP, Motion, Remotion, Lottie, Rive skills |
| [affromero/kin3o](https://github.com/affromero/kin3o) | 29 | none detected | 2026-04-15 | CLI: prompt to Lottie JSON using existing Claude or Codex subscription |
| [obeskay/lottie-animator-skill](https://github.com/obeskay/lottie-animator-skill) | 24 | MIT | 2026-11-01 | Skill: "Generate professional Lottie animations from SVGs using AI" |
| [srk0102/animtoon](https://github.com/srk0102/animtoon) | 23 | MIT | 2026-04-11 | Model: SVG to animated Lottie, claims 3-4x fewer tokens than OmniLottie |
| [lybeen/skill-create-lottie](https://github.com/lybeen/skill-create-lottie) | 2 | none | 2026-02-06 | Claude Code skill generating Lottie JSON from text |

- diffusionstudio text-to-lottie details: README calls it an "open-source framework for generating production ready Lottie animations"; install `npx skills add diffusionstudio/lottie`; works with Claude Code, Codex and "any other coding agent supporting skills"; documents playback in lottie-web, React Native Skia (Skottie), iOS, Android, Flutter; no validation loop described; default outputs expose only a background color control. Changelog says it suits short, single-scene animations and was released 8 June 2026. A third-party guide says its SKILL.md teaches the Lottie JSON dialect that Skia's Skottie renderer accepts. — [GitHub: diffusionstudio/lottie](https://github.com/diffusionstudio/lottie); [Diffusion Studio changelog](https://diffusion.studio/changelog/text-to-lottie); [mcp.directory guide](https://mcp.directory/blog/claude-text-to-lottie-skill-guide)
- OmniLottie: paper arXiv 2603.02138 (CVPR 2026); weights at huggingface.co/OmniLottie/OmniLottie; CLI example `python inference_hf.py --model_path OmniLottie/OmniLottie --text "A bouncing ball" --output output.json`; code Apache-2.0, MMLottie-2M dataset CC BY-NC-SA 4.0; CVPR supplement reports success rates of 97.3% (text), 92.0% (text+image), 90.7% (video). — [GitHub: OmniLottie](https://github.com/OpenVGLab/OmniLottie); [arXiv 2603.02138](https://arxiv.org/abs/2603.02138); [CVPR 2026 supplemental](https://openaccess.thecvf.com/content/CVPR2026/supplemental/Yang_OmniLottie_Generating_Vector_CVPR_2026_supplemental.pdf)

MCP servers and agent-driven editors:

| Project | Stars | License | Last push | Notes |
|---|---|---|---|---|
| [junmer/mcp-server-lottiefiles](https://github.com/junmer/mcp-server-lottiefiles) | 19 | MIT | 2025-04-29 | Community MCP: search/retrieve existing LottieFiles animations, no generation |
| [thisisprabhat/lumetrope](https://github.com/thisisprabhat/lumetrope) | 10 | MIT | 2026-10-26 | Open-source Lottie/dotLottie editor (Tauri/Rust) with MCP server; GIF/WebP/WebM export |
| [khanhnkq/codex-lottie-creator](https://github.com/khanhnkq/codex-lottie-creator) | 3 | MIT | 2026-08-09 | Codex plugin wrapping the official Lottie Creator MCP bridge |
| [vibecoderkz/raveanima](https://github.com/vibecoderkz/raveanima) | 1 | MIT | 2026-10-26 | Open 2D vector animation editor driven via MCP and CLI; exports Lottie |
| [martinsbrezauckis/shellx-motion](https://github.com/martinsbrezauckis/shellx-motion) | 1 | MIT | 2026-10-11 | Local render of HTML/JSON/Lottie to video, agent-driven |
| [hacimertgokhan/geomotion](https://github.com/hacimertgokhan/geomotion) | 6 | MIT | 2026-10-07 | Morphing line animations; JS engine, CLI, MCP server |

Adjacent code-to-video / animation skills (not Lottie output):

| Project | Stars | License | Last push | Approach |
|---|---|---|---|---|
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | 83,592 | Apache-2.0 | 2026-11-13 | "Write HTML. Render video. Built for agents."; includes a Lottie embedding skill |
| [remotion-dev/remotion](https://github.com/remotion-dev/remotion) | 72,859 | custom (NOASSERTION; Remotion has its own company license) | 2026-11-13 | React to video |
| [remotion-dev/skills](https://github.com/remotion-dev/skills) | 6,926 | none detected | 2026-11-11 | Official Remotion Agent Skills |
| [greensock/gsap-skills](https://github.com/greensock/gsap-skills) | 18,379 | MIT | 2026-07-29 | Official GSAP skills for coding agents |
| [ManimCommunity/manim](https://github.com/ManimCommunity/manim) | 42,459 | MIT | 2026-11-12 | Python math animation to video |
| [adithya-s-k/manim_skill](https://github.com/adithya-s-k/manim_skill) | 1,311 | MIT | 2026-01-23 | Agent skills for Manim |
| [Yusuke710/manim-skill](https://github.com/Yusuke710/manim-skill) | 200 | MIT | 2026-10-07 | SKILL.md for Manim |
| [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas) | 19,792 | MIT | 2026-07-02 | TypeScript generator-based animation to video |

Players and format tooling a skill could depend on:
- `airbnb/lottie-web` 32,401 stars, MIT, last push 2025-09-01; `LottieFiles/dotlottie-web` 944 stars, MIT, 2026-11-12; `LottieFiles/dotlottie-rs` 289 stars, MIT, 2026-11-12; `LottieFiles/lottie-player` 1,658 stars, MIT, 2026-04-08; `LottieFiles/relottie` (Lottie processor/AST) 69 stars, MIT, 2026-10-12; `Samsung/rlottie` 1,448 stars, mixed license (NOASSERTION), 2026-09-30; `lottie/lottie-spec` 119 stars, license not auto-detected, 2026-06-23. — [lottie-web](https://github.com/airbnb/lottie-web); [dotlottie-web](https://github.com/LottieFiles/dotlottie-web); [dotlottie-rs](https://github.com/LottieFiles/dotlottie-rs); [relottie](https://github.com/LottieFiles/relottie); [rlottie](https://github.com/Samsung/rlottie); [lottie-spec](https://github.com/lottie/lottie-spec)

### Inferences
- The leading open skill (diffusionstudio) uses raw JSON authoring plus a live preview player and documents no automated validation, schema check or headless render-to-frames loop; LottieFiles' own product, by contrast, advertises compile-and-self-repair. A validating builder/CLI with a render check is the clearest technical gap for a new free skill.
- None of the surfaced open skills clearly advertises transparent WebM/MOV/GIF export from generated Lottie; LottieFiles lists those exports as a paid-product feature. Bundling a headless render script would match a paid feature.
- lottie-web has had no push since September 2025; the actively maintained MIT players are LottieFiles' dotlottie-web / dotlottie-rs.

### Gaps
- No dedicated Motion Canvas agent skill or Cursor-rules file for Lottie was found.
- SKILL.md contents and output quality of the listed Lottie skills were not read or tested; stars are not a quality measure.
- kin3o and several small skills have no detected license, so reuse rights are unclear.
- No agent skill focused specifically on animated SVG (SMIL/CSS) generation was verified beyond the SVG sections of general web-animation skill packs.

## 5. Agent Skills format, client support, directories, and the most portable way to ship

### Takeaway
An Agent Skill is a folder with a `SKILL.md` (YAML frontmatter `name` + `description`, then Markdown) plus optional `scripts/`, `references/`, `assets/`; it is an open standard at agentskills.io, originated by Anthropic, and is read by Claude Code, Codex, Gemini CLI, Cursor, GitHub Copilot and dozens more. The `.agents/skills/` directory (project) and `~/.agents/skills/` (user) is the closest thing to a universal location, and `npx skills add <owner>/<repo>` (Vercel's skills CLI, registry skills.sh) is the de facto installer.

### Cited Findings

Format (agentskills.io specification):
- "At its core, a skill is a folder containing a `SKILL.md` file." The format "was originally developed by Anthropic, released as an open standard"; spec repo is `agentskills/agentskills` (27,240 stars, Apache-2.0, last push 2026-11-04). — [agentskills.io](https://agentskills.io/home); [GitHub: agentskills](https://github.com/agentskills/agentskills)
- Frontmatter: `name` (required; max 64 chars; lowercase letters, numbers, hyphens; no leading/trailing or consecutive hyphens; "Must match the parent directory name"); `description` (required; max 1024 chars; what it does and when to use it); optional `license`, `compatibility` (max 500 chars), `metadata` (string map), `allowed-tools` (space-separated, experimental). — [Agent Skills specification](https://agentskills.io/specification)
- Progressive disclosure: metadata (~100 tokens) loaded at startup for all skills; full SKILL.md body (< 5000 tokens recommended) on activation; resources on demand. "Keep your main `SKILL.md` under 500 lines." "Keep file references one level deep from `SKILL.md`." Validate with `skills-ref validate ./my-skill`. — [Agent Skills specification](https://agentskills.io/specification)
- `scripts/` should "be self-contained or clearly document dependencies"; "Supported languages depend on the agent implementation. Common options include Python, Bash, and JavaScript." — [Agent Skills specification](https://agentskills.io/specification)
- Timeline (secondary sources): Anthropic shipped skills for Claude on 16 October 2025 and published the open standard at agentskills.io on 18 December 2025. — [Codex blog (Daniel Vaughan): Agent Skills open standard](https://codex.danielvaughan.com/2026/05/05/agent-skills-open-standard-portable-skills-codex-cli-cross-agent/)
- Reference skills repo: `anthropics/skills` 193,842 stars, last push 2026-11-06. — [GitHub: anthropics/skills](https://github.com/anthropics/skills)

Client support and directories (official docs):
- OpenAI Codex (CLI, IDE extension, ChatGPT): skills "build on the open agent skills standard". Scans `.agents/skills` in every directory from CWD up to the repo root; user `$HOME/.agents/skills`; admin `/etc/codex/skills`; plus bundled system skills. Optional `agents/openai.yaml` for UI metadata, `allow_implicit_invocation`, and tool dependencies such as MCP servers. Invoke with `$` or `/skills`. Wider distribution via plugins: "Plugins distribute reusable skills and connectors through the universal plugin directory shared by ChatGPT and Codex." — [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills)
- Gemini CLI: "Based on the Agent Skills open standard". Workspace `.gemini/skills/` or `.agents/skills/` alias; user `~/.gemini/skills/` or `~/.agents/skills/`; also extension-bundled skills. `.agents/skills/` takes precedence within a tier. Install with `gemini skills install <git-url-or-local-path>` (`--scope user|workspace`, `--path`). — [Gemini CLI docs: skills](https://geminicli.com/docs/cli/skills/)
- Cursor: project `.agents/skills/` and `.cursor/skills/`; user `~/.agents/skills/` and `~/.cursor/skills/`; compatibility dirs `.claude/skills/`, `.codex/skills/`, `~/.claude/skills/`, `~/.codex/skills/`. "Skills work across any agent that supports the Agent Skills standard." — [Cursor docs: skills](https://cursor.com/docs/context/skills)
- GitHub Copilot: supported in the Copilot app, Copilot CLI, Copilot cloud agent and code review on GitHub.com, and "Agent mode in Visual Studio Code, Visual Studio, and JetBrains IDEs". Project skills in `.github/skills`, `.claude/skills`, or `.agents/skills`; personal skills in `~/.copilot/skills` or `~/.agents/skills`. "The Agent Skills specification is an open standard". — [GitHub Docs: about agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
- Claude Code: project `.claude/skills`, user `~/.claude/skills` (per skills CLI agent table and the diffusionstudio install notes). — [vercel-labs/skills agents.ts](https://github.com/vercel-labs/skills/blob/main/src/agents.ts)
- Paths used by the `skills` CLI for other agents (project / global), from its source: Goose `.goose/skills` / `~/.config/goose/skills`; OpenCode `.agents/skills` / `~/.config/opencode/skills`; Amp `.agents/skills` / `~/.config/agents/skills`; Cline `.agents/skills` / `~/.agents/skills`; Roo Code `.roo/skills` / `~/.roo/skills`; Kilo Code `.agents/skills` / `~/.kilo/skills`; Junie `.junie/skills`; Continue `.continue/skills`; Qwen Code `.qwen/skills`; Kiro CLI `.kiro/skills`; Antigravity `.agents/skills` / `~/.gemini/config/skills`; Droid `.agents/skills` / `~/.factory/skills`; OpenHands `.openhands/skills`; Mistral Vibe `.vibe/skills`; Replit `.agents/skills`. — [vercel-labs/skills agents.ts](https://github.com/vercel-labs/skills/blob/main/src/agents.ts)

Distribution:
- `vercel-labs/skills` ("The open agent skills tool - npx skills"; 39,190 stars, MIT, last push 2026-11-12) supports "OpenCode, Claude Code, Codex, Cursor, and 75 more"; requires Node.js 22.20+; `npx skills add <owner>/<repo>`, `--skill <name>`, `-a <agent>`, `-g` for global; `npx skills find`, `npx skills init`. skills.sh is the associated discovery directory. — [GitHub: vercel-labs/skills](https://github.com/vercel-labs/skills)
- Other channels: Codex/ChatGPT plugin directory (bundles skills + MCP connections), Gemini CLI extensions, Claude Code plugins; third-party indexes such as claudemarket.ai, claudeskills.info, vibeindex.ai, mcp.directory list Lottie skills. — [OpenAI: Build skills](https://learn.chatgpt.com/docs/build-skills); [claudemarket.ai listing](https://www.claudemarket.ai/skills/iart-ai/web-animation-skills/lottie-animation)
- Secondary reports describe an "Agent Plugins 1.0.0" packaging standard bundling Skills and MCP servers, with coalition membership reported inconsistently (Amazon/Microsoft/OpenAI/Vercel/Cursor versus GitHub/Cursor/AWS/Vercel) and Anthropic reported absent. Unverified against a primary source. — [Composio: What are Agent Plugins](https://composio.dev/blog/what-are-agent-plugins); [forkast.news](https://forkast.news/industry-shipped-agent-plugins-1-0-while-the-standards-body-debated/)

Relation to AGENTS.md and MCP (secondary sources):
- AGENTS.md is always-on, project-scoped context; Agent Skills are on-demand procedures loaded by description match; MCP standardizes connections to live tools and external systems. AGENTS.md is reported as governed by the Agentic AI Foundation under the Linux Foundation, alongside MCP. — [DEV: Top AI agent standards 2026](https://dev.to/ialijr/top-ai-agent-standards-to-know-in-2026-31gm); [env.dev: Agent Skills](https://env.dev/ai/agent-skills)
- LottieFiles' own stack illustrates the split: MCP server supplies editor tools, while the separate motion-design skill supplies "the judgment to use them well". — [lottiefiles.com/mcp](https://lottiefiles.com/mcp)

### Inferences
- Most portable packaging for one capability, derived from the directory rules above: (1) a spec-compliant skill folder whose `name` equals its directory name, placed in a public GitHub repo under `skills/<name>/` so `npx skills add owner/repo` works; (2) all real work in plain CLI scripts under `scripts/` (Node or Python, self-contained, no agent-specific APIs) so any agent with a shell, or a human, can run them; (3) instruct manual installs to use `.agents/skills/<name>/` (read natively by Codex, Gemini CLI, Cursor, Copilot) and `.claude/skills/<name>/` for Claude Code (Cursor and Copilot also read `.claude/skills`); (4) an optional thin MCP server exposing the same scripts as tools for chat clients without a filesystem/shell (and declared in `agents/openai.yaml` for Codex); (5) a short AGENTS.md snippet or plain "paste this prompt" fallback for LLMs with no skill support.
- Avoid relying on `allowed-tools` (experimental) or client-specific frontmatter; keep SKILL.md under 500 lines with Lottie schema details in `references/`.
- For Claude apps (claude.ai / desktop), skills are uploaded as a packaged folder rather than read from a repo directory; this was not verified from Anthropic documentation in this research.

### Gaps
- The agentskills.io client showcase page is JavaScript-rendered; the official list of supporting clients could not be extracted. Secondary sources claim "30+" to "40+" tools.
- Windsurf, VS Code (standalone setting names), Goose and OpenCode official docs were not fetched; paths above for those come from the skills CLI source or were not obtained (Windsurf path not captured).
- Anthropic's own documentation for Claude apps / API skill upload limits was not fetched.
- No primary source for the "Agent Plugins 1.0" standard was read.

## 6. Licensing and trademark considerations for an open skill that says "Lottie"

### Takeaway
Lottie is an open format stewarded by the Lottie Animation Community (LAC), a Linux Foundation / Joint Development Foundation project; no published trademark policy for the word "Lottie" as an animation format was found, and no registration owner could be verified. "LottieFiles", "dotLottie", "Lottie Creator" and now "Lottie AI" are LottieFiles (Design Barn Inc.) product names and should be avoided in a third-party product name; descriptive use ("generates Lottie animations") is what existing MIT projects do.

### Cited Findings
- LAC is "a non-profit open source project hosted by The Linux Foundation" and "a project under the governance of the Joint Development Foundation"; the site carries no trademark statement about the Lottie name or logo. — [lottie.github.io](https://lottie.github.io/)
- LAC was announced on 30 January 2024 and released the Lottie v1.0 specification on 17 September 2024. — [Linux Foundation: Announcing LAC](https://www.linuxfoundation.org/press/announcing-lottie-animation-community); [Linux Foundation: Lottie v1.0](https://www.linuxfoundation.org/press/lottie-animation-community-announces-lottie-v1.0-specification)
- Linux Foundation general trademark guidance (applies to LF marks; not confirmed to cover "Lottie"): a trademark should be used as an adjective followed by a generic noun and "should not be used as part of your product name". — [Linux Foundation trademark usage](https://www.linuxfoundation.org/legal/trademark-usage)
- LottieFiles brand page covers only logo rules ("Changing LottieFiles logo color is strictly prohibited"; wordmark "must only be shown as provided"); it says nothing about the word "Lottie" or naming third-party products. — [LottieFiles brand assets](https://lottiefiles.com/brand-assets)
- lottie.ai footer reads "© 2026 Design Barn Inc.", confirming Design Barn Inc. as the LottieFiles legal entity operating Lottie AI. — [Lottie AI pricing](https://lottie.ai/pricing)
- dotLottie (.lottie) is a superset container format developed by LottieFiles, distinct from the LAC Lottie JSON spec. — [lottie.github.io](https://lottie.github.io/)
- An unrelated UK company (Lottie Organisation Ltd, lottie.org, elder-care sector) states in its terms that "Lottie" is its trademark; a USPTO search surfaced no animation/software "Lottie" registration owned by Airbnb, LottieFiles or Design Barn (search was shallow, not a USPTO database query). — [lottie.org terms](https://lottie.org/terms-of-platform-use/)
- Licenses of players/tooling: lottie-web MIT; dotlottie-web MIT; dotlottie-rs MIT; lottie-player MIT; relottie MIT; rlottie mixed (not auto-detected); OmniLottie code Apache-2.0 with a non-commercial dataset (CC BY-NC-SA 4.0). — [lottie-web](https://github.com/airbnb/lottie-web); [dotlottie-web](https://github.com/LottieFiles/dotlottie-web); [OmniLottie](https://github.com/OpenVGLab/OmniLottie)
- Precedent: many independent MIT projects use "lottie" descriptively in names (diffusionstudio/lottie with skill `text-to-lottie`, obeskay/lottie-animator-skill, lottie-mcp servers), and competitor LottieLab uses "Lottie" in its company name. — [GitHub: diffusionstudio/lottie](https://github.com/diffusionstudio/lottie); [LottieLab blog](https://lottielab.com/blog/lottie-joins-linux-foundation)
- Free public animations on LottieFiles are under the "Lottie Simple License" (commercial use allowed); premium animations have their own license. Relevant only if a skill fetches or bundles library assets. — [LottieFiles commercial use guide](https://help.lottiefiles.com/commercial-use-guide)

### Inferences
- Lowest-risk naming: a distinct project name with "Lottie" used descriptively (for example "X: text-to-Lottie skill"), no LottieFiles logo or colors, an explicit "not affiliated with LottieFiles or the Lottie Animation Community" line, and avoiding the exact strings "Lottie AI", "LottieFiles", "Lottie Creator", "Motion Copilot" and "dotLottie" as product names. This is practical guidance from precedent, not legal advice.
- A skill that only emits spec-conformant Lottie JSON and bundles MIT players (lottie-web or dotlottie-web) has no copyleft or non-commercial obligations; avoid bundling OmniLottie's dataset or LottieFiles library assets.

### Gaps
- Who, if anyone, holds a registered trademark for "Lottie" in software/animation classes (USPTO/EUIPO not queried directly); whether Airbnb transferred any mark to the LAC/JDF.
- Whether the LAC has a formal trademark or conformance-mark policy; license text of the lottie-spec repository (not auto-detected by GitHub).
- LottieFiles Terms of Service clauses on automated/third-party use of its MCP or API were not read.
