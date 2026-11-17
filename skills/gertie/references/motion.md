# Motion: presets, easing and rigs

Read this before you write any `animate` keyframes by hand for something that is not a plain spin or slide. Keyframes placed by guesswork look stiff: even timing, linear movement, nothing that anticipates or settles. A preset writes well-tuned keyframes for you. Use a preset whenever one fits and write `animate` only for what no preset covers.

## Using a preset

    { "id": "badge", "type": "ellipse", "r": 60, "x": 256, "y": 256, "fill": "#22c55e",
      "motion": [
        { "preset": "pop-in", "at": 0.2, "duration": 0.5 },
        { "preset": "pulse", "at": 1.0, "duration": 0.8, "repeat": "loop" }
      ] }

| Field | Meaning |
|---|---|
| `preset` | A name from the tables below |
| `at` | Start time in seconds. Default 0 |
| `duration` | Length in seconds. Every preset has a default |
| `repeat` | `"loop"` or `"pingpong"`. Only for the emphasis presets and the looping rig presets |
| `phase` | 0 up to 1, only with `repeat: "loop"`. Starts the loop that far into its cycle. See "Loops out of phase" |
| other fields | The preset's own parameters, named in the tables |

Rules that matter:

- A preset is relative to the node's own static values. `slide-in` ends at the node's `x` and `y`. A `scale` of 2 on the node makes `pop-in` end at 2.
- Entrances start from the hidden state and end at rest. Exits start at rest. Emphasis presets start and end at rest, so they loop cleanly.
- A preset must fit in the scene: `at` plus `duration` cannot pass the scene `duration` (`E-PRESET-RANGE`).
- Two presets, or a preset and an `animate` entry, that write the same property at the same time are `E-PRESET-OVERLAP`. Put them at different times, or on different nodes. Presets that touch the same property at separate times merge in time order.
- `repeat` repeats whole cycles from `at` until the end of the scene. To offset several looping presets from each other, choose `at` and `duration` so that the time left (scene duration minus `at`) is a whole number of cycles: in a 2.4 second scene, `at` 0.4 with `duration` 1.0 gives two cycles, and `at` 0 with `duration` 0.8 gives three. Otherwise you get `W-REPEAT-FIT`. If a whole number of cycles does not fill the scene you get `W-REPEAT-FIT` and the loop will not be seamless. Choose `duration` so it divides evenly: a 0.8 second pulse in a 2.4 second scene.
- Scale pivots at the node's `pivot`. For `grow-in` on a bar, set `pivot` to the bar's base. For `swing`, `wave` and `rig-wave`, set `pivot` to the joint.

## Entrances

| Preset | Writes | Parameters | Default length |
|---|---|---|---|
| `fade-in` | opacity | | 0.4 |
| `pop-in` | scale, opacity | `overshoot` 1.15 | 0.5 |
| `slide-in` | x or y, opacity | `from` left, right, top, bottom; `distance` 80 | 0.5 |
| `drop-in` | y, scale, opacity | `distance` 120. Lands with a squash | 0.6 |
| `draw-on` | trim.end | The node needs a stroke | 0.8 |
| `grow-in` | scale | `axis` x, y or both | 0.5 |
| `spin-in` | rotation, scale, opacity | `turns` 0.5 | 0.6 |

## Exits

| Preset | Writes | Parameters | Default length |
|---|---|---|---|
| `fade-out` | opacity | | 0.4 |
| `pop-out` | scale, opacity | Grows slightly, then shrinks | 0.4 |
| `slide-out` | x or y, opacity | `to` left, right, top, bottom; `distance` 80 | 0.5 |
| `draw-off` | trim.end | The node needs a stroke | 0.8 |
| `shrink-out` | scale, opacity | | 0.4 |

## Emphasis and loops

| Preset | Writes | Parameters | Default length |
|---|---|---|---|
| `pulse` | scale | `amount` 1.08 | 0.8 |
| `breathe` | scale, y | `amount` 0.03. Slow and subtle, for characters | 3.0 |
| `float` | y, rotation | `distance` 12 | 2.4 |
| `wiggle` | rotation | `angle` 8 | 0.6 |
| `sway` | rotation | `angle` 3. Slow ambient lean. Set `pivot` at the base | 4.0 |
| `flicker` | rotation, scale | `lean` 3, `stretch` 0.05. Two rhythms that do not line up. Set `pivot` at the base of the flame | 2.2 |
| `jiggle` | scale, x | `amount` 0.02, `shift` 2. Two beats, for something waiting to be pressed. Set `pivot` at the bottom edge | 0.54 |
| `twinkle` | scale, opacity | `dip` 0.5. Rests, dips, rests. Give each star its own `phase` | 1.6 |
| `rise` | y, opacity, scale | `distance` 40, `grow` 0.3. For smoke, steam and bubbles. Drifts up, grows, fades in and out. Several wisps: use `repeat: "loop"` with different `phase` values, none of them 0 | 3.0 |
| `shake` | x | `distance` 8, `count` 3. Decays | 0.5 |
| `spin` | rotation | `turns` 1, `direction` cw or ccw. With `repeat` it keeps turning | 1.0 |
| `swing` | rotation | `angle` 20. Decays. Set `pivot` at the hanging point | 1.2 |
| `bounce` | y, scale | `height` 60. Squashes on landing | 0.8 |
| `blink` | scale | Closes the node's height quickly, holds, reopens more slowly. For eyes. Do not shorten it below 0.25: the closed eye would last one frame and flicker | 0.3 |
| `wave` | rotation | `angle` 20, `count` 3. Set `pivot` at the joint | 1.2 |
| `lid-blink` | scale | An eyelid shape drawn over an eye: flat (hidden) at rest, drops over the eye and lifts. Put the node's `pivot` at the top of the eye, `[0, -ry]`. See `cutout.md` | 0.3 |
| `heartbeat` | scale | `amount` 1.15. Two beats and a pause | 1.0 |
| `flash` | opacity | `count` 2 | 0.4 |

## Loops out of phase

Loops that start together with the same length move as one block, and that looks mechanical. Do not fix it with `at`: a later start leaves a part cycle at the end and the loop jumps. Use `phase`, which shifts a loop inside its cycle and keeps it seamless:

    { "id": "cloud-a", ..., "motion": [ { "preset": "float", "repeat": "loop" } ] },
    { "id": "cloud-b", ..., "motion": [ { "preset": "float", "repeat": "loop", "phase": 0.4 } ] }

For the children of a group, `stagger` with `phase` makes each child trail the one before it by that fraction of a cycle, so a wave travels along them:

    { "id": "blades", "type": "group",
      "stagger": { "phase": 0.12 },
      "motion": [ { "preset": "wiggle", "angle": 5, "duration": 4, "repeat": "loop", "applyTo": "children" } ],
      "children": [ ... ] }

Pick a phase that lands on one of the preset's own keys when you can: 0.25, 0.5 or 0.75 for `sway`, `wiggle` and `jiggle`; 0.35, 0.5 or 0.65 for `twinkle`. Any other phase cuts a segment in two, which adds two keyframes and two easing curves to every loop it is on. That is harmless in a character, but it takes an icon over its band for easing curves (2 to 4) and adds up in a scene with many loops.

`phase` needs `repeat: "loop"` and does not work on `spin` (set the node's `rotation` instead) or on `{ "keys", "repeat" }`. With `order: "random"` and a `seed`, `stagger.phase` scatters the children, which suits stars, bubbles and leaves.

## Easings that need several keyframes

`bounce`, `elastic` and `spring` are easing names you can put on any keyframe of a number or a scale. Gertie replaces the one segment with several keyframes.

    "y": [[0.1, 40], [1.1, 220, "bounce"]]

- `bounce` reaches the target, then rebounds to 25, 10 and 3 percent of the distance.
- `elastic` overshoots by 30 percent, undershoots by 15, then settles. Good for a sign or a button.
- `spring` overshoots by 12 percent once, then settles.

They do not work on colours or paths (`E-EASE-TARGET`). Give them a segment of at least 0.3 seconds; a shorter one gets a plain ease. The first keyframe of a property cannot have an ease, so put the easing on the keyframe that arrives.

## Overshoot on a keyframe

For a move that should arrive with a little life, add `overshoot` to a long-form keyframe. Gertie writes the extra keys: past the target, back under it by less, then rest.

    "x": [[0, 100], { "t": 0.5, "v": 300, "ease": "easeOut", "overshoot": true }]
    "scale": [[0, [0.5, 0.5]], { "t": 0.45, "v": [1, 1], "ease": "easeOut", "overshoot": { "past": 0.15, "back": 0.05, "time": 0.4 } }]

- **`t` is the peak and `v` is where it rests.** The value reaches the peak at `t` and is back on `v` `time` seconds later (default 0.3). Plan the next key after `t + time`; if it is closer, `time` is shortened, and under 3 frames is `E-OVERSHOOT`.
- `past` 0.1 and `back` 0.03 are fractions of the distance moved. A pop on a scale wants 0.1 to 0.15, a rotation or a heavy thing 0.2 to 0.25. `back` 0 skips the dip.
- Use `easeOut` or `snap` on the key so the value slows into the peak.
- It is not for first keys, `hold`, colours or paths. It replaces `easeOutBack` where you want control, and it is not combined with `bounce`, `elastic` or `spring`.
- The option is named `overshoot` so it is not mistaken for the `settle` easing, which is only a curve.

## Following a parent

Parts attached to something that moves (hair, a tail, an antenna, leaves on a stem, a held object) should trail it and swing past. Put each part in a group inside the moving group and give it `follow`:

    { "id": "leaf-3", "type": "group", "x": 430, "y": 280, "rotation": -110,
      "follow": { "delay": 0.3, "scale": 2 }, "children": [ ... ] }

The part repeats its parent's `rotation` (or `x`, `y`, with `props`) `delay` seconds later (default 0.1) and `scale` times as far (default 1.5), on top of its own resting value. Give neighbours different `delay` and `scale`, so a row of leaves does not move as one. A chain of groups, each with `follow` inside the last, trails further each step; keep `scale` near 1 to 1.3 down a chain because the angles add. The part must not animate the same property itself. The parent must be the group the part sits in directly, and it must animate that property itself: a part two groups down gets `E-FOLLOW`.

When the parent's keys run from 0 to the end of a looping scene, the follower's copy is cut at the loop seam so it still closes, and the cut adds two easing curves. If the parent only moves for part of the scene, leave its resting keys at 0 and at the end off (start at the first key that moves, end at the last), and the follower is simply shifted later with no cut.

## Choosing easing by weight

Eight named curves cover most moves:

| Curve | Use |
|---|---|
| `smooth` | A deliberate move from one pose to another |
| `gentle` | Small drifts and moving holds |
| `snap` | Fast transitions and sharp starts |
| `settle` | Arriving quickly and easing to rest |
| `easeOutCubic` | Light things that start fast |
| `easeInCubic`, `easeInQuad` | Heavy things that start slowly, and falls |
| `easeInOutSine` | Ambient loops |
| `linear` | Continuous turns and scrolling only |

Use at least three different curves in any scene longer than 2 seconds, and choose by weight: heavy things take a stronger ease in, light things start fast. `W-EASE-UNIFORM` fires when more than 20 segments are eased and every one is the same curve.

When two keys are closer than about 100 milliseconds the ease between them hardly shows. Do not spend effort choosing a curve there.

## Density, offsets and loop length

A scene that moves only between poses reads as stiff. In the reference set a typical animated property has about 13 keyframes about 150 milliseconds apart, and a character scene has about 33 keyframes per second. Aim for 25 or more per second in a character or scene, and at least 3 (`W-MOTION-SPARSE` fires below that in anything over 3 seconds). The extra keys are these:

- **Anticipation** before a move: a small move the other way, 2 or 3 frames.
- **Overshoot** after it: `overshoot` on the arriving key.
- **Moving holds.** A part that has arrived keeps drifting a few pixels or a degree, so it never freezes. Use `gentle` between the drift keys.
- **Secondary motion.** Attached parts follow the body with `follow`.
- **Squash and stretch** on contact.

Offsets: do not start everything on one frame. When more than 6 properties animate and over 80 percent start on the same frame you get `W-SYNC`. Give the parts a `stagger` of 0.03 to 0.1 seconds on their group, a different `at`, or `follow` with a `delay`. For loops use `phase` (a loop cannot be moved with `at`), and a phased loop counts as having its own start.

Loop length: under 2 seconds reads as a spinner. A character or a scene loop runs 4 to 8 seconds, with sub-loops of different periods inside it (a 2 second bob, a 4 second blink cycle, a 6 second look around) so the repeat is hard to spot. Every period must divide the scene duration: in a 6 second scene use 6, 3 or 2.

Arcs: for a path that is not a straight line, give `x` and `y` different timing, or rotate a parent group about a distant pivot. There is no motion along a path.

## Writing keys so the profile reads them as you meant

Four things about how keys are counted are easy to get wrong, and each one cost a round when the benchmark scenes were written.

- **Span the scene.** Give every hand-keyed property a key at 0 and a key at `duration`, both holding the resting value: `"y": [[0, 300], [0.6, 300], [0.9, 220, "settle"], [1.3, 300], [3, 300]]`. If the first key is later than 0 or the last is earlier than the end, the compiler pads the gap with a hold segment, and hold segments count as not eased. A scene of short moves with padded ends measured an eased share of 0.46; the same scene keyed from 0 to the end measured 1.
- **A held lead-in is still an offset.** A property starts where its value first changes, not at its first key. `[[0, 0], [0.4, 0], [0.7, 30]]` starts at 0.4, for `W-SYNC` and for the profile alike. Make the starts differ by at least one frame; two properties that start on the same frame both count as synchronised.
- **Name the ease on every key in an icon.** A key with no ease uses `easeInOut`, which is a curve of its own. An icon's band is 2 to 4 curves, so pick two or three (`smooth` for holds and returns, `settle` or `snap` for the arrival) and write one on every key. `overshoot` adds one more curve for its settle.
- **There is a ceiling as well as a floor.** Keyframes per second is a band: 10 to 25 for an icon, 25 to 60 for a character, 15 to 35 for a scene. Count before you write. A loop repeats its keys every cycle, so a 0.5 second flap in an 8 second scene is 16 cycles and about 33 keyframes for one property; a 3 second icon has room for about 75 keyframes in all, which is 8 properties of 9 keys. When you are over, lengthen the short loops, drop a property that duplicates another (a shadow's opacity when its scale already moves), or lengthen the scene.

Looping presets, with or without a `phase`, all begin to change on frame 0, so they add nothing to the profile's share of properties with their own start frame. That share comes from the moves you place in time: the one-shot reactions, the staggered entrances, the hand-keyed parts with a held lead-in. A character built only from loops will read as synchronised by that measure even when it does not look it; give it a few timed reactions (an ear flick after a landing, a glance, a tail that settles late).

## A background that scrolls

For a subject that travels in place (a walk cycle, a vehicle), move the scenery instead. Draw a pattern that repeats every so many pixels, put it in a group, and move the group by a whole number of pattern lengths over the whole scene with two keys and the `linear` ease:

    { "id": "street", "type": "group", "animate": { "x": [[0, 0], [6, -1080, "linear"]] }, "children": [ ... ] }

- The content must cover the canvas width plus the distance travelled. A pattern 540 pixels long that travels 1080 on a 1080 canvas needs four repeats (0 to 2160).
- Exactly two keys, at 0 and at `duration`, with `linear`. In this form the linter does not report `W-LOOP-JUMP`, because the picture at the end is the picture at the start. Any other form does. The render check `W-R-LOOP` still fails the scene if the pattern does not line up.
- Use two or three layers at different distances: far hills travel one short pattern length, the street two longer ones, the kerb and road marks further still. The speeds differ and the loop still closes, because each layer travels a whole number of its own pattern.
- Something the subject meets on the way (a bump in the road) goes in the fastest layer. Work out when it arrives from the layer's speed, and key the reaction to that time: front wheel first, rear wheel a wheelbase later.
- Wheels turn a whole number of times: `"rotation": [[0, 0], [6, 2880, "linear"]]`.

## Morphs and time windows

A morph (`d` keyframes) should have keys from 0 to `duration` with a curve on every segment and no `hold`. When a morphing node appears part of the way through (`from`), still start its `d` keys at 0: the node is hidden until `from`, and the morph stays one native animation in the SVG. A morph whose keys start later is padded with a hold, and a morph that mixes hold and curve segments is written into the SVG frame by frame. On the benchmark's rocket scene that was 470 kB of SVG against 63 kB after the keys were moved to 0. The same applies to a `{ "keys", "repeat" }` morph: start the cycle at 0 with a period that divides the scene.

## Repeating one property

For a property no preset covers, repeat its keyframes instead of writing them out:

    "rotation": { "keys": [[0, -8], [0.6, 8, "easeInOut"], [1.2, -8, "easeInOut"]], "repeat": "loop" }
    "x": { "keys": [[0, 60], [1.2, 452, "easeInOut"]], "repeat": "pingpong" }

`loop` restarts the keys. `pingpong` plays them forward, then backward. Whole cycles only; the same `W-REPEAT-FIT` rule applies.

## Several things moving in turn: stagger

Put the things in a group. `stagger` offsets each child, and a motion entry with `"applyTo": "children"` is given to every child.

    { "id": "bars", "type": "group",
      "stagger": { "each": 0.08, "order": "center-out" },
      "motion": [ { "preset": "grow-in", "axis": "y", "at": 0.1, "applyTo": "children" } ],
      "children": [ ... ] }

`each` is for presets that play once. For looping presets use `"stagger": { "phase": 0.12 }` instead (see "Loops out of phase"). `order` is `forward`, `reverse`, `center-out`, `edges-in` or `random`. `random` takes a `seed` so the result is repeatable. Children must be shapes the preset can animate: `draw-on` needs strokes.

## The principles, for when you do write keyframes

- **Ease, never linear.** Things accelerate and slow down. Only continuous rotation and scrolling are linear.
- **Anticipation.** Before a big move, a small move the other way.
- **Overshoot and settle.** Arrivals go a little past and come back: the `overshoot` option, `easeOutBack`, `spring`.
- **Squash and stretch.** A falling thing stretches along its path and squashes on landing: scale `[1.2, 0.8]`, then back. This is the biggest contributor to a cartoon feel.
- **Follow-through.** Parts do not stop together. Use `follow`, or stagger or delay the parts that trail.
- **Arcs.** A thrown thing moves `x` linearly and `y` with ease-out then ease-in.
- **Weight is timing.** Heavy things start slowly and take longer. Light things are quick.
- **Offset, do not synchronize.** Offset several things by 0.03 to 0.1 seconds.

Typical lengths: small feedback 0.15 to 0.3 seconds, entrances 0.3 to 0.6, emphasis 0.5 to 1, ambient loops 2 to 4.

## Making a scene feel alive

Use this for an illustration, a mascot or a scene that should feel alive without being busy. For a sticker or an icon that should pop, the bouncy presets are right and this section matters less.

- **One main action, plus two or three idle loops.** The main action tells the story: the bell rings, the chart draws on. The loops only say that the place is alive. Everything else stays still.
- **Small amounts.** Idle motion is subtle: a breath of 1 to 3 percent, a sway of 2 to 4 degrees, a float of a few pixels. When unsure, halve it.
- **Nothing in step.** Give every looping thing its own `phase`, and neighbours slightly different `duration`s that still divide the scene (2 and 4 seconds in a 4 second scene).
- **Tips trail roots.** Along a chain (a tail, a branch, a row of blades) each part moves later than the one before: `stagger` with `phase`, or nested groups with growing `phase`.
- **Rotate about a joint, do not slide.** Each moving part is its own node with `pivot` at its base, hinge or neck.
- **Left and right are never mirror images.** Different angles or phases for two arms, two ears, two leaves.
- **Opacity is for appearing and disappearing** (steam, a sparkle), not for dimming something halfway.
- **Fast moves need frames.** At 30 fps anything under 0.1 seconds is two or three frames and flickers. Use `"fps": 60` in the scene for quick motion that must stay crisp.
- **The first frame is a good drawing.** A loop is shown frozen under reduced motion; for a reveal, set the scene's `poster` to the end.

Starting points by subject. Amounts are in canvas pixels and degrees for a 512 canvas.

| Subject | What moves | How |
|---|---|---|
| Character | breath, eyes, head | A rig with `rig-idle`, `rig-blink` (`every` 3 to 4), and one `rig-look` or `rig-nod`. Blink at the moment the head turns |
| Tail, ears, hair | trail the body | Segments as nested groups with `pivot` at each root, each with `sway` (`angle` 4 to 10, `duration` 2 to 4, loop) and `phase` 0.1 to 0.2 later than its parent |
| Plant, tree, grass | sway | `sway` with `angle` 2 to 4 and `duration` 3 to 6, loop, `pivot` at the base. Leaves or blades in a group with `stagger` `phase` |
| Flag, curtain | a travelling wave | Vertical strips in a group, each with `float` (`distance` growing away from the pole), `stagger` `phase` 0.1 to 0.15 |
| Flame | flicker | `flicker` (`lean` 3, `stretch` 0.05, `duration` 2 in a 4 second scene, loop) on the flame with `pivot` at its base, and a second `flicker` with a `phase` of about 0.3 on the inner core, so the two never line up |
| Smoke, steam | rise | `rise` with `repeat: "loop"` on each wisp, a small `distance` of 40 to 80, `duration` 2 to 3. Give two or three wisps different `phase` values (for example 0.25, 0.75) and slightly different `x`, so they do not rise together. A phase of 0 leaves the last cycle unclosed in a looping scene, so use a non-zero one |
| Floating thing, bubble, boat | bob | `float` with `distance` 4 to 8, loop. Rock a boat with `sway` `angle` 2 on a parent group |
| Clouds | drift | A row of clouds that repeats, in a group that scrolls a whole number of repeats with two `linear` keys (see "A background that scrolls"); far clouds are smaller and travel a shorter pattern. One lone cloud: a slow `gentle` drift of 20 to 40 pixels out and back |
| Stars, lights | twinkle, glow | `pulse` with `amount` 1.03 to 1.05 and `duration` 2 to 4 for a glow. Stars: `twinkle` (`dip` 0.5, loop) in a group with `stagger` `phase` 0.17 and `order` `random` |
| Gears, fans | mechanism | `spin` with `repeat`, linear. Meshed gears turn opposite ways, at speeds in the ratio of their teeth |
| Phone, bell, alarm | bursts | `shake` or `wave` for about 0.5 seconds, then stillness, then again. Not a continuous shake |
| Something waiting to be pressed | a small jiggle | `jiggle` (`amount` 0.02, `shift` 2, `duration` 0.5 in a 4 second scene, loop), `pivot` at its bottom edge. |
| Icon, logo | one moment | Play once (`draw-on`, `pop-in`, one `wiggle`), then rest. No endless loop |
| Chart | draw on | `draw-on` for lines; bars with `grow-in` `axis` y, `pivot` at the base, `stagger` `each` 0.04 to 0.08. The last frame is the data |

Before you call a character or a scene alive, check on the contact sheet (`--sheet-frames 16`):

- While the subject is on screen, no frame has everything still, and no two neighbouring loops move in step.
- The head and the ends of limbs arrive after the body.
- Left and right differ.
- A landing squashes and a jump stretches.
- The loop closes: the first and last frames match, and `qa` shows no `W-LOOP-JUMP` or `W-R-LOOP`.

## Characters: rigs

A rig is a character built from nested groups with a pivot at every joint, plus rig presets that find the parts by name. For anything with a head, arms or eyes, build a rig and use rig presets. Do not hand-keyframe a character.

### Building a rig

Name every part with the rig root's id as a prefix and a standard suffix: `-head`, `-body`, `-arm-l`, `-arm-r`, `-leg-l`, `-leg-r`, `-eye-l`, `-eye-r`, `-mouth`. Left and right are the character's own left and right.

    { "id": "robot", "type": "group", "x": 160, "y": 340, "children": [
      { "id": "robot-leg-l", "type": "group", "pivot": [-22, -50], "children": [ ... ] },
      { "id": "robot-leg-r", "type": "group", "pivot": [22, -50], "children": [ ... ] },
      { "id": "robot-body", "type": "group", "pivot": [0, -50], "children": [
        { "id": "robot-torso", "type": "rect", ... },
        { "id": "robot-arm-l", "type": "group", "pivot": [-62, -112], "children": [ ... ] },
        { "id": "robot-arm-r", "type": "group", "pivot": [62, -112], "children": [ ... ] },
        { "id": "robot-head", "type": "group", "pivot": [0, -152], "children": [
          { "id": "robot-face", "type": "rect", ... },
          { "id": "robot-eye-l", "type": "ellipse", ... },
          { "id": "robot-eye-r", "type": "ellipse", ... }
        ] }
      ] }
    ] }

Rules for a rig that moves well:

- The root's origin is at the character's feet, and the parts are drawn above it with negative `y`. Then the root can jump and squash from the floor.
- A child moves with its parent: the hand is inside the arm group, the head inside the body group.
- Each moving part is a group whose `pivot` is its joint: shoulder, neck, hip. Draw the part's shapes in the same coordinates as the pivot.
- Eyes are ellipses centred on their own origin, so `blink` closes them about their centre.
- Order children so nearer parts come later: far arm, body, head, near arm.
- Overlap the parts at the joints and round the ends, so no gap opens when a part rotates.

### Rig presets

Put rig presets in the `motion` of the rig root. They write keyframes on the parts.

| Preset | Parts needed | Parameters | Default length |
|---|---|---|---|
| `rig-idle` | body, head; arm-l and arm-r if present | `armSway` 2 degrees (0 to 20, 0 turns it off). Breathing, a slight head sway, and hanging arms that drift outward and back, out of phase with each other. Use `repeat: "loop"` | 3.0 |
| `rig-blink` | eye-l, eye-r | `every` 2.6 seconds on average, `seed`. Blinks at irregular times from `at` to the end of the scene | |
| `rig-wave` | arm-r or arm-l | `arm` r or l, `raise` 140, `angle` 24, `count` 3 waves. Raises the arm, waves, lowers it | 2.2 |
| `rig-nod` | head | `distance` 8. Two nods | 1.0 |
| `rig-shake-head` | head | `angle` 10 | 1.0 |
| `rig-jump` | the root | `height` 80. Crouch, stretch, land with a squash. Swings arm-l and arm-r if present | 1.0 |
| `rig-look` | eye-l, eye-r | `direction` left, right, up, down; `amount` 5 pixels | 1.2 |
| `rig-walk-in-place` | leg-l, leg-r, arm-l, arm-r, body | `swing` 24 degrees. Use `repeat: "loop"` | 1.0 |

`rig-jump` timing, for anything you key to it by hand (a ground shadow, dust on landing, ears or a scarf that trail): the crouch ends one sixth of the way through its `duration`, the top of the jump is at one half, and the feet land at five sixths. A jump with `at` 0.4 and `duration` 1.2 peaks at 1.0 and lands at 1.4.

If a needed part is missing you get `E-RIG-PART` naming the suffix. `rig-walk-in-place` is a stylized walk: single rotating legs, no knees.

`raise` for `rig-wave` is degrees from the hanging position, outward. About 100 to 130 puts the hand beside the head. Above about 140 the arm can sweep through the head or the face, depending on where the shoulder is: look at the contact sheet and lower `raise` if the hand crosses the face. A wider `angle` and a higher `count` make a more energetic wave.

### Layering rig presets

Idle and blink run together without conflict, because each writes different parts or properties. When two presets would write the same property of the same part at the same time (idle sway and a nod both move the head; idle arm sway and a wave both rotate the arm), wrap that part in a group whose id is the part's id plus `-ctl`, with the same `pivot`, and put the part inside:

    { "id": "robot-head-ctl", "type": "group", "children": [ { "id": "robot-head", ... } ] }

Transient presets write to the `-ctl` wrapper when it exists: `rig-nod`, `rig-shake-head`, `rig-wave`, and the arms of `rig-jump`. Continuous presets (`rig-idle`, `rig-walk-in-place`, `rig-blink`, `rig-look`) write to the part itself. The wrapper needs the same `pivot` as the part when the transient preset rotates it (`rig-wave`, `rig-shake-head`, the arms of `rig-jump`).

A friendly waving robot is: one rig with `-ctl` wrappers around the head and the waving arm, `rig-idle` with `repeat: "loop"` for the whole scene, `rig-blink`, one `rig-wave`, and a `rig-nod` near the end. Without the arm wrapper the idle's arm sway and the wave collide and you get `E-PRESET-OVERLAP`. Choose a scene `duration` that is a whole number of idle cycles, such as 6 seconds for the 3 second idle.
