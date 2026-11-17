# Video from a storyboard

Read this when the user wants a video made of several animated scenes: an intro, an explainer, a social reel, an ad. A single looping animation does not need it.

A video is a few scenes in sequence, with captions, transitions and optional music. You write each scene as its own `.gertie.json`, then a storyboard (`.story.json`) that orders them, and run `gertie story`.

## Procedure

1. **Agree a short outline with the user.** Scenes, what each shows, how long, the caption for each, the shape of the video (1080 by 1920 for reels and shorts, 1920 by 1080 landscape, 1080 by 1080 square). Keep it short: six scenes of three to five seconds is the comfortable upper size for one request.
2. **Write each scene** as its own scene file and get it through `qa` with zero errors (see `scene.md`). Make each scene's canvas the same shape as the video, or the scene is letterboxed (see `fit`).
3. **Write the storyboard** (below).
4. **Build the video:**

       node scripts/gertie.mjs story <name>.story.json --out out/<name>.mp4 --json

   It checks the storyboard, runs `qa` on every scene (and stops if any scene fails), renders the scenes, joins them, burns in the captions, mixes the audio and writes an H.264 MP4. It also writes `<name>.sheet.png` beside the video.
5. **Look at the contact sheet.** It has one frame from the middle of each scene and one from the middle of each transition, labelled. Check the captions are readable and inside the picture, the transitions look as intended, and nothing is cut off. Fix and rebuild. Stop after three rounds.
6. **Deliver** the MP4, the storyboard and the scene files. Say what was checked. Do not claim the video was watched: you saw still frames.

`node scripts/gertie.mjs story <file> --lint-only` checks the storyboard (and compiles the scenes) without rendering, which is quick.

## The storyboard

```json
{
  "story": 1,
  "name": "app-intro",
  "canvas": { "w": 1080, "h": 1920, "background": "#0b0f19" },
  "fps": 30,
  "audio": { "src": "music.mp3", "volume": 0.6, "fadeOut": 1.0 },
  "scenes": [
    { "id": "hook", "src": "scenes/hook.gertie.json", "duration": 3.0,
      "caption": "Tired of spreadsheets?",
      "transition": { "type": "fade", "duration": 0.4 } },
    { "id": "demo", "src": "scenes/demo.gertie.json", "duration": 5.0,
      "caption": "Meet Tally.",
      "transition": { "type": "slide-left", "duration": 0.5 } },
    { "id": "cta", "src": "scenes/cta.gertie.json", "duration": 3.0 }
  ],
  "captions": { "position": "bottom", "size": 56, "color": "#ffffff", "font": "fonts/Inter-Bold.ttf", "box": true }
}
```

Paths are relative to the storyboard file.

| Field | Meaning |
|---|---|
| `story` | Always 1 |
| `name` | Letters, digits, `-` and `_`. Names the output file |
| `canvas` | `w`, `h` (even numbers, 64 to 3840) and a solid `background` (MP4 has no transparency) |
| `fps` | 24, 25, 30, 50 or 60. Default 30 |
| `scenes[].id` | Unique short name |
| `scenes[].src` | A scene file. It must compile and pass `qa` |
| `scenes[].duration` | Seconds the scene is shown. Optional only if the linter can read the scene's own length (it then uses that) |
| `scenes[].fit` | `contain` (default, whole scene visible, bars if the shape differs), `cover` (fills the frame, edges cropped), `none` (original size, centred) |
| `scenes[].caption` | Text shown during the scene. Long text wraps. Use `\n` for a line break |
| `scenes[].transition` | How this scene gives way to the next: `type` is `cut` (default), `fade`, `slide-left`, `slide-right`, `slide-up` or `wipe`; `duration` in seconds (default 0.5) |
| `audio` | One background track: `src`, `volume` (default 1), `fadeIn`, `fadeOut` in seconds. Cut or padded with silence to the video length |
| `captions` | `position` (`bottom`, `center`, `top`), `size` in pixels, `color`, `font` (a .ttf, .otf or .ttc file), `box` (true draws a dark box behind the text). Without `font` a system bold sans-serif is used |

### Timing rules

- A scene longer than its own animation **repeats** if the scene has `"loop": true` (the default) and **holds its last frame** if `"loop": false`. Set `loop` in the scene file for what you want.
- A transition **overlaps** the end of one scene with the start of the next. The video's length is the sum of the durations minus the sum of the transition durations. A 3 s scene, a 0.4 s fade, a 5 s scene is 7.6 s.
- Each scene must be long enough for the transition into it plus the transition out of it. The linter reports it as `E-STORY-TRANSITION`.
- Captions are shown while the scene is on screen alone, not during its transitions.
- Times are rounded to whole frames at the video's frame rate.

## Diagnostics

`gertie story` reports the same way as the other commands: a `code`, a `path`, a `message` and a `fix`. The codes are `E-STORY-UNKNOWN`, `-TYPE`, `-RANGE`, `-ENUM`, `-MISSING`, `-VERSION`, `-NAME`, `-COLOR`, `-DUPLICATE`, `-FILE` (a scene, font or audio file is missing), `-TRANSITION`, `-LENGTH`, `-SCENE` (a scene does not compile), `-QA` (a scene failed qa), and the warnings `W-STORY-ASPECT` (bars), `W-STORY-SCENE-CUT` (the scene is longer than its slot), `W-STORY-LONG`, `W-STORY-TRANSITION-LAST`, `W-STORY-CUT-DURATION` and `W-STORY-FADE`. Fix errors, then read the warnings.

If the command exits with code 2, a tool is missing. It says which and how to fix it; `node scripts/gertie.mjs doctor` lists what the video builder needs (ffmpeg with libx264, the `xfade` filter for transitions, the `drawtext` filter for captions, an AAC encoder for audio).

## What the built-in sequencer cannot do

One scene at a time, one caption per scene, one audio track, no voiceover, no subtitle files. For anything beyond that (several animations on screen at once, animated typography, charts, screen recordings), generate a HyperFrames project and edit it.

## Richer videos: HyperFrames

    node scripts/gertie.mjs story <name>.story.json --engine hyperframes --out project/

writes a project directory for HyperFrames (a separate open-source tool, Apache 2.0, that renders HTML to video): `index.html` with the timeline, one composition per scene that plays the scene's Lottie, the compiled Lottie files, the Lottie player, the caption font and the audio. Transitions and captions are HTML and GSAP. Gertie does not bundle HyperFrames. If `hyperframes` is not installed the command says how to install it (`npm install -g hyperframes`); with `--render` it runs `hyperframes render` for you.

The generated project was checked with HyperFrames 0.9.43: it lints clean and renders unmodified. Still run `hyperframes lint` in the project after any edit, and look at the result. Storyboards at a frame rate other than 30 have not been tried on this route. The project's HTML is then yours to edit freely. The GSAP library is loaded from a CDN, so rendering needs network access unless you vendor it. A scene that is shorter than its slot holds its last frame there, it does not loop.

## Remotion

Gertie's Lottie output plays in Remotion through its `@remotion/lottie` package with no adapter. Remotion's licence is free for individuals and companies of up to three people and paid for larger ones, so Gertie does not depend on it; tell the user the condition if they choose it.
