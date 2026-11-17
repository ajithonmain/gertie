# Making something move like a video or GIF the user showed you

The user shows a clip and says "make it move like this". Gertie measures the clip and draws a contact sheet. You then describe the motion and build a scene that reproduces its timing. It captures timing, distance and character. It does not copy the exact paths, and you should say so to the user.

## Study the clip

    node scripts/gertie.mjs study clip.mp4 --json

It needs ffmpeg. It works on mp4, webm, mov, gif and animated webp or apng. It writes `clip.study.png` next to the clip and prints (in `--json`) what it measured. `--out` is a file name or a folder for the contact sheet. Options: `--fps 8` is the rate of the contact sheet, `--max-seconds 20`, `--cell 192` is the size of each frame, `--background border` uses the colour around the edge of the frame as the background instead of what stays put, `--crop x,y,w,h` studies only that part of the frame (in pixels of the clip) and `--rate source` analyses at the clip's own frame rate, up to 60. Both are described under "Small motion" below.

Open the contact sheet first. It shows frames in order, each labelled with its time. Then read the numbers.

## What the numbers mean

The moving subject is everything that differs from the background, where the background is whatever stays put during the clip (a floor, a wall, a logo). For each frame Gertie finds its centre, width and height, as fractions of the frame. From these:

- `holds`: spans where nothing moves, with start and end in seconds. A pause before or between moves is part of the motion's character, so keep it.
- `moves`: each is one stretch of movement on one channel, with when it starts and ends, how far it goes, and how the speed varies:
  - channels are `x` (right is positive), `y` (down is positive), `width` and `height`;
  - `ease` is `starts slow` (use `easeIn`, `easeInQuad`, or `easeInCubic`), `starts fast` (`easeOut`, `easeOutQuad`), `slow at both ends` (`easeInOut`), or `even` (`linear`);
  - several channels moving over the same time are one motion: a ball that falls and slides at once has a `y` move and an `x` move.
- Ignore moves that change by less than about 0.03 of the frame. They are noise: a bounding box that shifts by a pixel, or a long "settle" that is really a change of 0.001.
- That limit hides real small motion from `moves`. A breath, a float or a jiggle is 1 to 5 percent of the subject's size and is often what makes the reference feel alive. `idle` reports it: see "Small motion" below.
- `loopGap`: the share of pixels that differ between the first and last frame. Under 0.01 means the clip loops. If it is higher, decide whether to loop yours.
- `samples`: one row per analysed frame, `[seconds, centre x, centre y, width, height]`, for when you need the exact curve.

## Small motion

A subject that looks still during a `hold` is often not still. Find out in three steps.

1. Study the whole clip first, as above, to learn what moves and when.
2. Find the subject's pixels with a grid (`node scripts/gertie.mjs grid frame.png --step 50` on one frame; extract a frame with `ffmpeg -ss 1 -i clip.mp4 -frames:v 1 frame.png`), then crop to it with a little margin and study again at the clip's own rate:

        node scripts/gertie.mjs study clip.mp4 --crop 100,100,280,280 --rate source --background border --json

   Every fraction in the output is now a fraction of the crop, and the contact sheet shows the crop. Use `--background border` when the subject sits on a plain colour, which is nearly always the case in a crop: the default background is what stays put, and a subject that only breathes mostly stays put, so it would be thrown away with the background. A crop outside the frame is an error that says what the frame size is.
3. Read `idle`. Each entry is `{ "channel", "start", "end", "amplitude", "period" }`: that channel swings by `amplitude` (as a fraction of the crop, either side of its middle) once every `period` seconds, over the span from `start` to `end`. Channels are measured outside their own moves, so a clip that slides and then breathes reports the breath.

Turn each `idle` entry into a looping preset with that period (`duration: <period>`, `repeat: "loop"`):

| `idle` channel | Preset |
|---|---|
| `y` | `float` |
| `x` | `sway` for a plant or a flame, otherwise a small `wiggle` |
| `width` and `height` together | `breathe`; `jiggle` if the period is under a second |
| `width` or `height` alone | `pulse` |

Convert the amplitude to your canvas: a `height` amplitude of 0.01 on a crop that is 280 pixels tall is 2.8 pixels either side of the middle, a swing of 5.6 pixels, which on a subject 140 pixels tall is a `breathe` `amount` of about 0.03 (the swing is 1.4 times `amount` times the subject's height, so `amount` = swing / (1.4 x height)). Keep it that small. Several channels with the same period are one motion, so use one preset for them. Give two repeating parts different `phase` values unless the reference moves them together.

`idle` is conservative. A swing smaller than 0.004 of the crop is treated as the edge of the silhouette flickering. A swing of 0.03 or more is a move and appears in `moves` instead, so crop wider when a real breath shows up as a move. A swing has to cross its middle at least four times at even intervals, so a clip of two seconds or less will not report one: read the sheet and `samples` instead. Not every channel is found: a `height` swing of under about 0.01 may be missing while the `width` one is reported.

### Colours

Read colours from the pixels, never by guessing from the sheet:

    node scripts/gertie.mjs sample frame.png --at 240,240 --at 5,5
    node scripts/gertie.mjs sample clip.mp4 --at 240,240 --time 1.5 --json

It prints each point as hex, the mean of a 3 by 3 block so that an antialiased edge does not skew it. Points are in pixels of the image (use `grid` to read them); `--time` picks the frame of a clip. A point on a transparent pixel comes with an `alpha` below 1.

## Turn it into a scene

1. Write down the motion in words first: what moves, in what order, how long each phase takes, where it pauses, where it speeds up or slows down, whether it overshoots or squashes. Go part by part: for the feet, the hands, the head, the eyes, the shadow and the background, ask what the reference does with each one. A part that does nothing while the rest moves reads as dead. Say the result to the user in a line or two.
2. Convert fractions to your canvas. A shape's size is its `width` and `height` fractions times the canvas size, so a ball 0.094 wide in a 480 pixel frame is about 45 pixels across; when width and height disagree slightly, use the larger for a circle's diameter, and read `samples` at a moment when the subject is not squashed. `x = fraction of the frame width * canvas width`. The subject's centre is where your node's `x`, `y` should be (shapes are centred on their origin).
3. Use the times from `moves` and `holds` for your keyframes. A `moves` entry is one stretch between turning points. If a move reads `even` but its end looks slower, or a hold starts later than your version's, look at `samples` for the last second of that move: a linear travel that then eases to a stop is two keyframe segments (linear, then an ease-out). Keep each move's start and end, and use the ease it names. A fall that `starts slow` is `easeInQuad`; the rise after a bounce `starts fast`, so `easeOutQuad`.
4. A change of `width` and `height` at the moment of an impact is squash and stretch: add a `scale` keyframe pair such as `[1.3, 0.7]` and back. The numbers show it as a quick `width` rise with a `height` fall.
5. Run `qa`, then `study` your own exported clip (export it with `export --to mp4`) and compare the `moves` and `holds` with the reference's. Adjust times until they agree to about a tenth of a second.

## Limits to tell the user

- This is a measurement of one silhouette. It does not know what the subject is, so it cannot see a limb bending or a face changing. Use the contact sheet for those, and describe them in your own words.
- If the whole picture moves (a camera move, a scrolling background), the background estimate is wrong and the numbers do not apply. Read the contact sheet and use `--background border` only if the edge colour is steady.
- Several subjects at once are measured as one silhouette. If the clip has two things moving apart, describe each from the contact sheet.

## Rights

A reference is someone's work.

- Using a reference for style, timing or inspiration is normal practice.
- Animating artwork the user owns or has licensed is fine.
- If the artwork clearly belongs to someone else (a watermark, a known character, a brand logo that is not the user's), mention once that they need the right to use it, then do what they asked. Do not refuse and do not lecture.
- Gertie never downloads artwork or animations from libraries or marketplaces. Work from what the user gives you.
