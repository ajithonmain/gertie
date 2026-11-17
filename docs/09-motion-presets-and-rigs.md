# Motion presets and rigs

Presets are what make generated animation look smooth and intentional. Without them, a model places keyframes by guesswork: motion is linear, timing is even, nothing anticipates or settles. With them, the model picks a named motion and the normalizer writes well-tuned keyframes.

Presets are expanded during normalization into ordinary `animate` entries. The emitters never see them.

## Using a preset

```json
{ "id": "badge", "type": "ellipse", "r": 60, "x": 256, "y": 256, "fill": "#22c55e",
  "motion": [
    { "preset": "pop-in", "at": 0.2, "duration": 0.5 },
    { "preset": "pulse", "at": 1.0, "duration": 0.8, "repeat": "loop" }
  ] }
```

| Field | Meaning |
|---|---|
| `preset` | Name from the tables below |
| `at` | Start time in seconds. Default 0 |
| `duration` | Length in seconds. Each preset has a default |
| `repeat` | `"loop"` or `"pingpong"`, for looping presets |
| `phase` | A fraction of a cycle, 0 up to but not including 1. Only with `repeat: "loop"`. The loop starts that far into its cycle, see "Loops out of phase" |
| other fields | Preset parameters, such as `distance`, `angle`, `amount` |

A preset writes keyframes for specific properties. If two presets on one node, or a preset and an `animate` entry, write the same property over overlapping time ranges, the linter reports `E-PRESET-OVERLAP`. Over separate time ranges they are merged in time order.

Preset values are relative to the node's static values. `slide-in` from the left ends at the node's own `x`.

## Entrances

| Preset | Properties | Parameters | Default duration |
|---|---|---|---|
| `fade-in` | opacity | | 0.4 |
| `pop-in` | scale, opacity | `overshoot` (default 1.15) | 0.5 |
| `slide-in` | x or y, opacity | `from`: left, right, top, bottom; `distance` | 0.5 |
| `drop-in` | y, scale | `distance`; lands with a squash | 0.6 |
| `draw-on` | trim.end | For stroked shapes | 0.8 |
| `grow-in` | scale | `axis`: x, y or both; set `pivot` for the growth origin | 0.5 |
| `spin-in` | rotation, scale, opacity | `turns` (default 0.5) | 0.6 |

## Exits

`fade-out`, `pop-out`, `slide-out`, `draw-off`, `shrink-out`. Each mirrors its entrance.

## Emphasis and loops

| Preset | Properties | Parameters | Default duration |
|---|---|---|---|
| `pulse` | scale | `amount` (default 1.08) | 0.8 |
| `breathe` | scale, slight y | Slow and subtle, for characters | 3.0 |
| `float` | y, slight rotation | `distance` (default 12) | 2.4 |
| `wiggle` | rotation | `angle` (default 8) | 0.6 |
| `shake` | x | `distance` (default 8), `count` | 0.5 |
| `spin` | rotation | `turns`, `direction` | 1.0 |
| `swing` | rotation | `angle`; decays unless repeated. Needs `pivot` at the hanging point | 1.2 |
| `bounce` | y, scale | `height`; squash on landing | 0.8 |
| `lid-blink` | scale y | An eyelid drawn over an eye, flat at rest: closes over the eye and lifts. Pivot at the top of the eye. Added with cutout animation | 0.3 |
| `blink` | scale y | For eyelids and eyes. Closes in about a third of its length, stays shut briefly, reopens more slowly | 0.3 |
| `wave` | rotation | Several back-and-forth swings about `pivot` | 1.2 |
| `heartbeat` | scale | Two quick beats and a pause | 1.0 |
| `flash` | opacity | `count` | 0.4 |
| `sway` | rotation | `angle` (default 3). Slow ambient lean for plants and hanging things. Pivot at the base | 4.0 |
| `flicker` | rotation, scale | `lean` (default 3), `stretch` (default 0.05). Two rhythms that do not line up. Pivot at the base of the flame | 2.2 |
| `jiggle` | scale, x | `amount` (default 0.02), `shift` (default 2). Two beats, for something waiting to be pressed. Pivot at the bottom edge | 0.54 |
| `twinkle` | scale, opacity | `dip` (default 0.5). Rests, dips, rests; give each star its own `phase` | 1.6 |
| `rise` | y, opacity, scale | `distance` (default 40), `grow` (default 0.3). For smoke, steam and bubbles: drifts up, grows and fades in and out, hidden at both ends. Does not end where it starts in y and scale, which is fine because it is invisible there | 3.0 |

## The principles built into the presets

Each preset encodes one or more classic animation principles. Keep these in mind when adding or tuning presets.

- **Ease, never linear.** Objects accelerate and decelerate. Only continuous rotation and scrolling backgrounds are linear.
- **Anticipation.** Before a big move, a small move the opposite way. `drop-in` rises slightly before falling; `pop-out` grows slightly before shrinking.
- **Overshoot and settle.** Things arriving go a little past their target and come back. `pop-in` scales to 1.15, then 0.95, then 1.
- **Squash and stretch.** A falling object stretches along its direction of travel and squashes on impact, keeping its area: scale `[1.2, 0.8]` on landing, then back. This is the single biggest contributor to a cartoon feel.
- **Follow-through and overlap.** Parts do not all stop at once. Hair and clothing keep moving after the body stops. Achieved with `stagger` and `delay` on child parts.
- **Arcs.** Natural motion follows curves. A thrown object animates `x` linearly and `y` with ease-out then ease-in, which produces a parabola.
- **Timing gives weight.** Heavy things start slowly and take longer. Light things are quick.
- **Offset, do not synchronize.** Several elements animating at exactly the same time look mechanical. Offsetting each by 0.03 to 0.1 seconds looks alive.

Typical durations: micro-interactions 0.15 to 0.3 seconds; entrances 0.3 to 0.6; emphasis 0.5 to 1; ambient loops 2 to 4.

These principles also go, in shorter form, into `skills/gertie/references/motion.md`, so the agent applies them when it writes keyframes by hand.

## Loops out of phase

Several loops that start together and share a period move as one block, which reads as mechanical. Starting one later with `at` breaks the loop, because the time left is no longer a whole number of cycles (`W-REPEAT-FIT`). `phase` shifts a loop inside its cycle instead, so it still starts at `at`, still fills the scene, and still closes.

```json
{ "preset": "breathe", "repeat": "loop", "phase": 0.4 }
```

- `phase: 0.25` means the node is, at the preset's start, where it would otherwise be a quarter of a cycle later. The motion is the same curve, cut at that point with the two pieces swapped.
- It needs `repeat: "loop"`. With `pingpong`, or without `repeat`, it is `E-PRESET-PARAM`. `spin` rejects it too, since a phase on a continuous turn is only a starting angle.
- It works on rig presets that loop (`rig-idle`, `rig-walk-in-place`).

`stagger` takes the same idea for the children of a group: `"stagger": { "phase": 0.12 }` makes each child trail the one before it by 12 percent of a cycle, in the stagger's `order`. This is how a wave travels along a row of grass blades, a flag cut into strips, or the segments of a tail. `each` may be left out when `phase` is given. `stagger.phase` applies only to entries with `repeat: "loop"`; other entries in the same group ignore it and use `each`.

**Decision.** Phase is a fraction of a cycle and not seconds, so one value keeps working when the preset's `duration` changes. The idea of giving every repeated or neighbouring thing its own phase comes from the rossark-motion-skill (see `15-licences-and-naming.md`); that project computes motion at run time from a clock, which Gertie cannot do, so here the shift is made once, at compile time, on the keyframes.

## Bounce, elastic and spring easings

These cannot be expressed as one bezier curve. When a keyframe's ease is one of these names, the normalizer replaces that one segment with several keyframes.

- `bounce`: the value reaches the target, then rebounds three times with decreasing height (about 25%, 10% and 3% of the distance). Each fall uses ease-in and each rise uses ease-out.
- `elastic`: the value overshoots the target and oscillates about it with decaying amplitude: about +30%, -15%, +7%, -3%, then rest.
- `spring`: like elastic with one visible overshoot: about +12%, -4%, then rest.

Implement each as a function from start value, end value, start frame and end frame to a list of keyframes. Generate them by sampling the analytic curve (a damped cosine for elastic and spring) at its turning points, with ease-in-out sine between turning points. Check them by eye on the contact sheet with `--sheet-frames 16`.

## Stagger

`stagger` applies a time offset to the children of a group, so one motion ripples through them.

```json
{ "id": "bars", "type": "group",
  "stagger": { "each": 0.08, "order": "forward" },
  "motion": [ { "preset": "grow-in", "axis": "y", "applyTo": "children" } ],
  "children": [ ] }
```

- `each`: seconds between consecutive children.
- `phase`: for looping presets, the fraction of a cycle by which each child trails the one before. See "Loops out of phase".
- `order`: `"forward"`, `"reverse"`, `"center-out"`, `"edges-in"`, `"random"` (with a fixed `seed` so output is repeatable).
- A `motion` entry with `"applyTo": "children"` is copied to every child with its offset added to `at`.

## Rigs

A rig is a character built from parts in nested groups, with pivots at the joints. Rigs are not a separate feature; they are a convention over groups, plus presets that understand the convention.

### Building a rig

```json
{ "id": "robot", "type": "group", "x": 256, "y": 300, "children": [
  { "id": "robot-legs", "type": "group", "children": [ ] },
  { "id": "robot-body", "type": "group", "children": [
    { "id": "robot-torso", "type": "rect", "w": 120, "h": 140, "radius": 20, "fill": "#94a3b8" },
    { "id": "robot-arm-l", "type": "group", "pivot": [-60, -50], "children": [ ] },
    { "id": "robot-arm-r", "type": "group", "pivot": [60, -50], "children": [ ] },
    { "id": "robot-head", "type": "group", "pivot": [0, -70], "children": [
      { "id": "robot-face", "type": "rect", "w": 90, "h": 70, "y": -110, "radius": 16, "fill": "#cbd5e1" },
      { "id": "robot-eye-l", "type": "ellipse", "r": 8, "x": -20, "y": -112, "fill": "#0f172a" },
      { "id": "robot-eye-r", "type": "ellipse", "r": 8, "x": 20, "y": -112, "fill": "#0f172a" }
    ] }
  ] }
] }
```

Rules for a good rig:

- A child moves with its parent. The hand is inside the forearm group, the forearm inside the arm group.
- Each moving part's `pivot` is at its joint: shoulder for the arm, neck for the head, hip for the leg.
- Order children so that nearer parts come later: far arm, body, head, near arm.
- Overlap parts at joints so no gap opens when they rotate. Round the ends.
- Name parts with a common prefix and a standard suffix: `-head`, `-body`, `-arm-l`, `-arm-r`, `-leg-l`, `-leg-r`, `-eye-l`, `-eye-r`, `-mouth`.

### Rig presets

A rig preset is applied to the rig's root group and finds parts by suffix.

| Preset | Parts used | Motion |
|---|---|---|
| `rig-idle` | body, head; arm-l and arm-r when present | Breathing, slight head sway, and a small outward arm sway (`armSway` 2 degrees, 0 turns it off) with the two arms out of phase |
| `rig-blink` | eye-l, eye-r | Blink at irregular intervals |
| `rig-wave` | arm-r or arm-l | Raise arm, wave three times, lower |
| `rig-nod` | head | Two nods |
| `rig-shake-head` | head | Side to side |
| `rig-jump` | root, legs, arms | Anticipation crouch, jump with stretch, land with squash |
| `rig-look` | eye-l, eye-r | Eyes shift toward `direction` |
| `rig-walk-in-place` | leg-l, leg-r, arm-l, arm-r, body | Opposed leg and arm swings, body bob |

If a preset needs a part the rig does not have, the linter reports `E-RIG-PART` naming the missing suffix.

`rig-walk-in-place` gives a readable stylized walk for simple characters. It is not realistic locomotion; legs are single rotating parts without knees unless the rig has `-shin` parts. Be honest about this in the reference text.

### Layering rig motion

Several rig presets usually run together: idle for the whole duration, a blink every few seconds, one wave. Idle and blink write different parts or properties, so they combine without conflict. Where two would write the same property (idle head sway and a nod, or idle arm sway and a wave on that arm), put the transient motion on an extra wrapper group around the part, so each has its own node. The rig convention reserves a `-ctl` suffix for such wrappers: `robot-head-ctl` contains `robot-head`.

## Adding a preset

Ordinary presets are entries in the table in `src/presets/library.ts`; rig presets are in `src/presets/rigs.ts`. Each entry has a name, a default duration, a parameter specification (type, default, range), whether it loops, and a `build` function:

```ts
build: (s: Statics, p: Params, d: number) => Record<string, PKey[]>
```

`s` is the node's static transform, `p` the validated parameters and `d` the length in seconds. It returns keyframes by property with `t` from 0 to `d`; the expander adds `at`, applies `repeat`, snaps times to frames, and merges. A rig `build` also receives the parts it found and returns absolute times. Parameter checking, error messages, overlap detection and merging live in `src/presets/expand.ts` and are shared.

Each preset has: a unit test of its keyframes (`tests/unit/presets.test.ts` checks every preset's start and end state), an entry in the reference table (`skills/gertie/references/motion.md`), and a corpus example that uses it. A unit test fails if a preset is in no example.

## Implementation notes (phase 5)

Where the build settled something the design left open:

- **Where expansion happens.** One pure function, `expandScene`, runs on the parsed scene before the linter and before the normalizer, and returns a scene with plain keyframes in seconds. This is why the lint rules run on preset output and why `E-KEY-COLLIDE` and the range rules apply to it. Preset keys are snapped to frame times; user keys are never changed, so the linter still sees them as written.
- **Merging.** A preset's first key is a `hold` when something comes before it on the same property, so the value does not tween across the gap. Where two blocks touch on one frame, the later block's first key is dropped.
- **`repeat`.** `loop` restarts the keys. If the last value differs from the first, the restart is one frame late and held; `spin` instead continues from the last value (`cumulative`), so `repeat` on a spin keeps turning. `pingpong` reverses the keys and mirrors each bezier. Only whole cycles are written, from `at` to the end of the scene. `W-REPEAT-FIT` reports a remainder.
- **Special easings.** `bounce`, `elastic` and `spring` work on numbers and scale pairs, clamp the result for properties with a fixed range (opacity, trim, sizes), and need at least two frames between the keys, otherwise the segment gets a plain `easeOut`. Leg times of a bounce grow with the square root of the rebound height. The easing on the first key of a property is not an error, only the existing `W-EASE-FIRST` warning.
- **Colour and path keyframes** cannot take these easings (`E-EASE-TARGET`).
- **Rig parts** are found as the first descendant whose id ends in `-<suffix>`. For presets listed as transient (`rig-wave`, `rig-nod`, `rig-shake-head`, and the arms of `rig-jump`), a descendant with the id `<part>-ctl` is used instead when it exists. The wrapper must carry the pivot the rotation needs. Without a wrapper, overlapping rig presets on one part are `E-PRESET-OVERLAP`, and the message suggests the wrapper.
- **Rig directions.** Rotation is clockwise positive, so a right arm hanging from its shoulder rises outward with a negative angle and a left arm with a positive one. `rig-wave` and `rig-jump` handle this.
- **`rig-jump` needs no parts.** It animates the root and swings `arm-l` and `arm-r` when they exist. The root's origin should be at the feet.
- **`rig-blink`** ignores its own `duration` as a window: it places blinks of 0.3 seconds from `at` to the end of the scene at irregular intervals around `every`, from a `seed`, so output is repeatable.
- **Stagger** offsets are `rank * each`. `center-out` ranks children by distance from the middle, `edges-in` is the reverse, and `random` is a shuffle from `seed`.
- **Not done:** presets are not given as separate files (the design suggested one file each); the table form keeps the shared checks in one place. `stagger` applies only to presets, not to `animate` entries.

## Implementation notes (phase 5b, part 1: phase and blink timing)

Built ahead of the rest of phase 5b (see `14-build-plan.md`).

- **`phase`.** `rotateCycle` in `src/presets/repeat.ts` takes one cycle of keys and a phase, and returns one cycle with the same start time and length. It runs in `put` in `src/presets/expand.ts`, before `unroll`, so repeat, frame snapping, overlap detection and merging are unchanged. It applies to ordinary and rig presets. It does not apply to `{ "keys", "repeat" }` in `animate`: user keys are never rewritten.
- **Cutting a segment.** When the cut falls inside a segment, the segment's easing is split with de Casteljau's construction (`splitBezier` in `src/presets/easing.ts`) into two beziers that trace the same curve, and a key with the interpolated value is written at both ends of the cycle. Values may be numbers or number lists (scale pairs). A `hold` segment is cut without interpolation. The handles are rounded to four decimals; a unit test checks both pieces against the original to within 0.002 of progress.
- **Cuts near a key.** A cut within three quarters of a frame of an existing key uses that key instead of splitting, so that frame snapping can never put two keys on one frame (`E-KEY-COLLIDE`). The phase is therefore accurate to within one frame.
- **What cannot be phased.** A property whose cycle does not end on its first value, or a segment whose easing is `bounce`, `elastic` or `spring`, returns no result and the entry gets `E-PRESET-PARAM` naming the property. No current looping preset has either, apart from `spin`, which is rejected earlier by name (`cumulative`). Presets that reset while hidden are handled by the `open` flag, see "Implementation notes (phase 5b, part 2)".
- **`stagger.phase`.** A child of rank `r` gets the phase `entry phase - r * stagger.phase`, wrapped into 0 to 1. Trailing by a fraction is the same as having started that much earlier, hence the minus sign. Ranks come from `staggerOffsets` with `each` 1, so every `order` works, including `random` with its `seed`.
- **Blink timing.** `blink`, `lid-blink` and `rig-blink` now last 0.3 seconds: shut at 35 percent (about 0.1 s, three frames at 30 fps), held to 50 percent, reopened with `easeOut` over the remaining half. The constants are `BLINK_SECONDS`, `BLINK_SHUT` and `BLINK_OPEN` in `src/presets/library.ts`. Before, a blink was 0.15 seconds split evenly, which at 30 fps left the closed eye on screen for one frame. **Verify during build:** the new timing was checked on contact sheets and by the unit test, not by watching playback beside the old one. Watch `examples/blinking-eyes` and `examples/robot-wave` play before the release. **Found at phase close (phase 5b):** still not watched playing. Both contact sheets were regenerated and `robot-wave` and `blinking-eyes` match their stored sheets in `npm run test:browser`; the timing is checked by the unit test, so the item stays open for a person to watch.
- **Corpus.** `examples/grass-sway.gertie.json` uses `stagger.phase` and an entry `phase`.

## Implementation notes (phase 5b, part 2: presets that reset while hidden)

- **`resets`.** `PresetDef` has `resets?: true`, set on `rise` only. `put` in `src/presets/expand.ts` passes it to `rotateCycle` as `open`. Rig presets never pass it.
- **`rotateCycle(keys, phase, fps, open)`.** With `open` and a cycle whose first and last values differ, the rotated cycle is: the interpolated value at the cut, the rest of the cycle to its last key, a `hold` key carrying the first value, then the start of the cycle up to the cut, ending on the cut value. The cycle is therefore closed in value, so `unroll` repeats it without adding anything. A cut within one frame of either end returns the keys unchanged. A cycle that is already closed is rotated exactly as before. Without `open`, behaviour is unchanged.
- **Differs from the design: where the reset key goes.** The design puts the `hold` key "one frame later". Written as the last key time plus 1/fps, it landed on the same frame as that key after frame snapping whenever the cut was not on a frame (a phase of 0.25 on 2.2 seconds is 16.5 frames), and the merge dropped it, so the reset vanished and the wisp glided back down. The key is now at the frame after the last key counted on the frame grid, `(round(t * fps) + 1) / fps`. If the next real key snaps to that same frame, the merge drops that key; `rise` has no key that close.
- **Differs from the design: smoke phases.** The candle's two wisps use phases 0.25 and 0.75, not 0 and 0.5. A looping preset with no phase (or phase 0) is not rotated, so its last cycle ends at the top of the rise, and the scene then reports `W-LOOP-JUMP` on `y` and `scale` although the wisp is invisible there. Any non-zero phase closes the cycle. The two still sit half a cycle apart. A phase-0 `rise` in a looping scene will report that warning; the linter does not know the node is hidden at the seam. Not changed here.
- **Defaults.** `distance` 40, `grow` 0.3 and 3.0 seconds were kept. The candle first used `distance` 70 and 2.2 seconds so the wisps clear the flame; looked at on the 16-frame sheet, no wisp jumps at its reset. (The candle later changed to the values in the Corpus item below.)
- **Corpus.** `examples/candle.gertie.json` has two wisps, `smoke-a` and `smoke-b`. Each sits in a wrapper group (`smoke-a-wave`, `smoke-b-wave`) whose `x` sways about 12 and 9 pixels in opposite directions over the 4.4 second loop, so the wisp climbs in an S-shaped path. `rise` has no sideways motion of its own. The wisps use `duration` 4.4, `distance` 90, `grow` 1.2 and opacity 0.4, which reads as smoke where the earlier 2.2 second, straight, opaque version read as floating dots.

## Implementation notes (phase 5b, part 3: arm sway in `rig-idle`)

- **What was built.** `rig-idle` in `src/presets/rigs.ts` has the optional parts `arm-l` and `arm-r` and the parameter `armSway` (default 2, range 0 to 20). Each arm that exists gets rotation keys: rest, `armSway` degrees outward at half the cycle, rest at the end, `easeInOutSine`. With `armSway` 0 nothing is written to the arms. A rig without arms gets exactly the keys it got before. The arms are not transient, so the sway is written to the arm itself and never to its `-ctl` wrapper.
- **Out of phase.** The left arm's cycle is passed through `rotateCycle` with a phase of 0.35 (`ARM_LAG`) inside the preset, so it starts part of the way out (about 1.3 degrees with the default) and reaches its widest point at 0.15 of the cycle, while the right arm reaches it at 0.5. `RigContext` gained `fps` for this, because `rotateCycle` needs the frame rate. A `phase` on the `rig-idle` entry still applies on top, to every part alike, so the lag between the arms is kept. Because the left arm's first key is not its rest angle, the arm sits at that angle before an idle that starts later than 0 and after one that does not loop; with 2 degrees this is not visible.
- **Differs from the design: the sign.** The design said `+armSway` for the right arm and the flipped sign for the left. Rotation is clockwise positive, so that would have swung both arms inward, through the body. The code follows the stated intent, outward: negative for `arm-r`, positive for `arm-l`, the same convention as `rig-wave` and `rig-jump`. The design section above was corrected.
- **Layering.** `rig-idle` now writes `rotation` on the arms, so `rig-wave` layered on it needs a `-ctl` wrapper around the waving arm, with the shoulder `pivot`; without one the scene gets `E-PRESET-OVERLAP`, whose fix text names the wrapper. The check was not changed. `rig-jump` over an idle needs wrappers on both arms for the same reason. `rig-walk-in-place` and `rig-idle` on one rig already overlapped on the body's `y` and still do.
- **Corpus.** `examples/robot-wave.gertie.json` gained `robot-arm-r-ctl` around `robot-arm-r`, with the pivot `[62, -112]`; the wave goes to the wrapper and the sway to the arm. Its golden was regenerated. `examples/robot-walk.gertie.json` does not use `rig-idle`, so neither the example nor its golden changed, contrary to what the design expected.
- **Default.** `armSway` 2 was kept. **Verify during build:** it was looked at on the contact sheet of `robot-wave`, where 2 degrees is a shift of about two pixels at the hand and the arms do not cross the body; it was not watched playing. **Found at phase close (phase 5b):** the `robot-wave` sheet still matches its stored baseline in the browser test, so 2 degrees stays below the visual-regression threshold; it has still not been watched playing, so the item stays open.

## Implementation notes (phase 5b, part 4: `W-SYNC`)

- **What was built.** `Expander` in `src/presets/expand.ts` notes every looping motion entry as it is read (`noteLoop`), by the group the node is a direct child of, and reports after all entries are read (`sync`). Entries are in step when the preset name, the `repeat` mode, the `duration`, the `at` and the phase after stagger are all the same. Three or more children in step give one `W-SYNC` on the group, with the message and fix text of the design section. The diagnostic's `node` is the group and its `path` is the group's `children`.
- **What counts as looping.** An entry with `repeat` (`loop` or `pingpong`). A looping preset played once is not counted. Rig presets with `repeat` on three rigs in one group are counted like any other.
- **One per group and preset.** When several sets of children are in step with different timings (three at 2 seconds, three at 1 second), the group still gets one warning for that preset, and the count in the message is the size of the largest set. Two presets in step on the same children give one warning each.
- **Exceptions.** `spin` never warns (any preset marked `cumulative`). Entries from `applyTo: "children"` never warn when the group's stagger has a non-zero `each` or `phase`, even when the phase step happens to put several children on the same phase (a step of 0.5 over five children): the stagger is the author's choice. A stagger of `{ "each": 0 }` offsets nothing and is no exception. Each exception has a unit test.
- **Differs from the design: nothing in the rule.** Left out on purpose: nodes at the top level of the scene are not children of a group, so five top-level nodes in step get no warning. The design names groups only, and the fix text needs a group to put the stagger on.
- **Corpus.** No example gained a `W-SYNC`: all 35 compile with zero errors and zero warnings, so no example was changed and no exception was widened.

## Living motion: design for the rest of phase 5b

Not built, except where an item says so. Each item below is specified closely enough to implement from this section alone; the task list and acceptance checks are in `14-build-plan.md`, phase 5b. The source of the ideas is the rossark-motion-skill, a method for idle and character motion written for run-time engines. Its numbers are taken as starting points and are marked **Verify during build**: look at each preset playing before fixing its defaults. **Found at phase close (phase 5b):** every default was looked at on contact sheets (`candle`, `night-sky`, `gift-box`, `grass-sway`, and a scratch scene of `rise` with phase 0.5 on a 16 frame sheet, which fades out at the top, resets while dark and shows no jump). None was watched playing; the part 2 note records the one default that was changed (the candle's smoke). Watching them play is still open.

### Ambient presets

Subjects that are not characters need idle motion too: plants, flames, smoke, lights, things waiting to be pressed. Today an agent has to adapt `wiggle` or `pulse` and guess the amounts. These presets carry the amounts. All are `category: "emphasis"`, `loops: true`, end where they start unless stated, and go in `src/presets/library.ts` in the same form as the existing ones.

| Preset | Writes | Parameters | Default length | Keyframes, as fractions of the length |
|---|---|---|---|---|
| `sway` | rotation | `angle` 3 (0 to 45) | 4.0 | The same shape as `wiggle`: rest, `+angle` at 0.25, rest at 0.5, `-angle` at 0.75, rest at 1, all `easeInOutSine`. It exists as a separate name because the defaults differ by an order of magnitude and models pick presets by name. Needs `pivot` at the base |
| `flicker` | rotation, scale | `lean` 3 degrees (0 to 20), `stretch` 0.05 (0 to 0.5) | 2.2 | Two rhythms that do not line up inside one cycle. Rotation makes 2 full swings of `±lean`: keys at 0, 0.125, 0.375, 0.5, 0.625, 0.875, 1 with values 0, +lean, -lean, 0, +lean x 0.7, -lean x 0.7, 0. Scale makes 3 stretches: at 0, 1/6, 2/6, 3/6, 4/6, 5/6, 1 with values rest, `[1 - stretch x 0.4, 1 + stretch]`, rest, `[1 - stretch x 0.3, 1 + stretch x 0.7]`, rest, `[1 - stretch x 0.4, 1 + stretch]`, rest. All `easeInOutSine`. Needs `pivot` at the base of the flame |
| `jiggle` | scale, x | `amount` 0.02 (0 to 0.2), `shift` 2 pixels (0 to 40) | 0.54 | For something waiting to be pressed. Two beats. Scale: rest, `[1 + amount, 1 - amount]` at 0.25, rest at 0.5, `[1 + amount, 1 - amount]` at 0.75, rest at 1. `x`: rest, `x + shift` at 0.25, rest at 0.5, `x - shift` at 0.75, rest at 1. All `easeInOutSine`. Needs `pivot` at the bottom edge |
| `twinkle` | scale, opacity | `dip` 0.5 (0 to 1) | 1.6 | Rest until 0.35, then scale to `1 - dip x 0.5` and opacity to `opacity x (1 - dip)` at 0.5 with `easeInOutSine`, back to rest at 0.65, rest until 1. The still parts are what let many stars with different phases look irregular |
| `rise` | y, opacity, scale | `distance` 40 (0 and up), `grow` 0.3 (0 to 3) | 3.0 | For smoke, steam and bubbles. `y` goes linearly from `y` to `y - distance`. Opacity is 0 at 0, the node's opacity at 0.3 (`easeOut`), the same at 0.6, and 0 at 1 (`easeIn`). Scale goes linearly from rest to `1 + grow`. It does not end where it starts in `y` and scale, which is fine because it is invisible at both ends: see "Phase for presets that reset while hidden" |

Each needs: a unit test in `tests/unit/presets.test.ts` (the existing table-driven test of start and end state picks new presets up from `PRESET_NAMES`; `rise` needs an entry like `HIDDEN_AT_REST`), a row in `skills/gertie/references/motion.md`, and a corpus example. Suggested examples: `candle` (`flicker` on a flame, `rise` on two wisps of smoke with phases 0 and 0.5), `night-sky` (`twinkle` on stars under a group with `stagger: { "phase": 0.17, "order": "random" }`), `gift-box` (`jiggle`). `sway` can replace `wiggle` in `examples/grass-sway.gertie.json`.

### Phase for presets that reset while hidden

`rise` restarts from a different value than it ends on, so `rotateCycle` refuses it. Extend `rotateCycle` with an optional flag `open`: when the first and last values differ and `open` is true, treat the wrap as a jump. The rotated cycle is: the interpolated value at the cut; the rest of the cycle up to its last key; one frame later, a `hold` key with the first value; the start of the cycle up to the cut. If the cut is within one frame of the wrap, do not rotate (return the keys unchanged). `PresetDef` gets `resets?: true`, set on `rise`, and `put` passes it as `open`. The jump is invisible only because opacity is 0 there, so `resets` is for presets that are hidden at both ends, and nothing else.

### Moving holds in `rig-idle`

A character whose body breathes while its arms hang perfectly still reads as a mannequin. `rig-idle` gains two optional parts, `arm-l` and `arm-r` (add them to `optional`; they are not `transient`, so they write to the part, not the `-ctl` wrapper, like the rest of the idle). When present, each arm's rotation sways outward by `armSway` degrees (new parameter, default 2, range 0 to 20; 0 turns it off): rest, `armSway` outward at 0.5, rest at 1, `easeInOutSine`. Outward is a negative angle for the right arm and a positive one for the left (see "Rig directions" in the phase 5 notes), so both move outward together, and with the left arm's cycle rotated by 0.35 using `rotateCycle`, so the arms are never mirror images. A rig with `rig-wave` on an arm must have that arm's `-ctl` wrapper, as it already must for any layered transient; otherwise the existing `E-PRESET-OVERLAP` fires, and its message already suggests the wrapper. Changing `rig-idle` changes the golden of `robot-wave`; `robot-walk` does not use `rig-idle`, so its golden stays as it was. Built: see "Implementation notes (phase 5b, part 3)".

### A warning for loops in step: `W-SYNC`

In `src/presets/expand.ts`, after all entries of a group are read: if three or more direct children of one group each have a looping motion entry with the same preset name, the same `duration`, the same `at` and the same phase (after stagger), report one `W-SYNC` on the group. Message: "N nodes in 'id' run 'preset' in step, which looks mechanical." Fix: "Give the group a stagger with a phase, for example \"stagger\": { \"phase\": 0.15 } with \"applyTo\": \"children\" on the group, or give each entry its own \"phase\"." Do not report it for `spin` (gears and loaders turn together on purpose) or when the entries came from `applyTo: "children"` on a group whose stagger has a non-zero `each` or `phase`. One warning per group and preset, never one per child. Add the code to `06-validation.md`. Built: see "Implementation notes (phase 5b, part 4)".

### What was looked at and left out

- **A run-time clock, `wave` and `flow` functions, seeded random per frame.** They need code running in the player. Lottie expressions are outside Gertie's safe subset and SVG has none. Compile-time keyframes with `phase` cover the looping cases.
- **Follow-through by reading the parent a moment earlier.** The same reason. The compile-time form is a child with the parent's preset and a `stagger.phase` or its own `phase`.
- **Two-segment limbs with an elbow, weight shift, 2.5D head turns, hanging feet, height-linked shadows.** These are a second, larger rig convention (`-forearm`, `-shin`, `-shadow` parts and presets that drive them). Worth a design of its own after the release; the principles are in `skills/gertie/references/motion.md` so an agent can apply them by hand.
- **"Calm by default, no bouncy overshoot" and "nothing appears from scale 0".** These are interface rules. Gertie's `pop-in` and `bounce` are for stickers and icons, where a cartoon feel is wanted. The reference text tells the agent when to prefer the calm presets.
- **The SwiftUI and React Native templates and the phone-frame renderer.** Platform code; Gertie's outputs are files.

## Implementation notes (phase 10, section 3: motion)

- **What phase 5b had already built.** Checked in the code before starting: the ambient presets `sway`, `flicker`, `jiggle`, `twinkle` and `rise` (`src/presets/library.ts`), the moving hold in `rig-idle` (arm sway, `armSway`, in `src/presets/rigs.ts`), and `W-SYNC` for loops in step (`Expander.sync` in `src/presets/expand.ts`). None of it was rebuilt. This phase added the four named easings, the `overshoot` keyframe option, `follow`, `W-MOTION-SPARSE`, `W-EASE-UNIFORM`, and the start rule of `W-SYNC`.
- **Where the code is.** `src/presets/motion-extras.ts` holds the pure helpers (`readOvershoot`, `expandOvershoot`, `readFollow`, `followKeys`, `isEasedCurve`). `Expander.overshoots` and `Expander.follow` in `src/presets/expand.ts` call them; `W-MOTION-SPARSE` and `W-EASE-UNIFORM` are in `Linter.motionChecks` in `src/spec/lint.ts`, and the start rule of `W-SYNC` is `Expander.syncStarts`, next to the rule for loops in step.
- **`follow`: syntax.** A node field, not a motion entry: `"follow": true` or `{ "props": ["rotation"], "delay": 0.1, "scale": 1.5 }`. `props` is any of `rotation`, `x`, `y`; `delay` is seconds, rounded to frames; `scale` multiplies the parent's movement away from its first value. The full text is in `03-scene-spec.md`, "Following a parent".
- **`follow`: how it is written.** It runs after every node's own animation and presets are merged, in tree order, so a chain of followers reads keys already written. A parent whose keys span the whole scene, end where they start and sit in a looping scene is cut with `rotateCycle` (phase `1 - delay / period`), so the loop closes. Any other parent gets its keys shifted later by `delay`, and keys past the end are dropped. The node's own `animate` for the same property is an error rather than a merge, because a merge would hide which of the two was meant.
- **Differs from the design: the start rule is in the expander, and phase is exempt.** The design put "more than 6 animated properties and over 80 percent beginning on the same frame" in the linter. Measured on the corpus, that rule flagged `candle`, `night-sky` and `grass-sway`, which are correctly built with `phase`: a phase keeps the first key on the preset's start frame, because moving the start with `at` breaks the loop (`W-REPEAT-FIT`), so the only fix the rule could suggest was one that does not exist. The rule therefore lives next to the loop rule in the expander, which knows which blocks carry a phase, and counts a phased loop and a follower with a delay as their own start. The scene-level warning has no node. It applies to every tier.
- **`W-EASE-UNIFORM` counts repeats.** A preset that loops through a long scene repeats one cycle, and every cycle of `jiggle`, `wiggle` or `sway` uses `easeInOutSine`, so a scene made only of one such loop with 21 or more segments gets the warning. That is the rule as designed; the fix is a second motion with a different curve (the lid wobble added to `examples/gift-box.gertie.json`). Not exempted, because a scene that is only one repeated loop is the thing the rule is meant to catch.
- **Corpus effect.** Linting every example: `confetti` (11 of 11 starts on frame 0), `gift-box` (32 eased segments of one curve), `potted-plant` (both, before it was animated) and `preset-emphasis-a` (both) had the new warnings. Each was changed, and each change is a small edit, listed here because the rule is to say so: `confetti` pieces now start falling 0 to 0.36 seconds apart (they start off screen, so frame 0 looks the same); `gift-box` gained a lid wobble with `gentle` and `smooth` on a repeat loop; `preset-emphasis-a` gained a `phase` on `pulse`, `wiggle` and `shake` and a slow sideways drift (`gentle`, `smooth`) on `float`. `candle`, `night-sky` and `grass-sway` had no warning once phases counted.
- **Tests.** `tests/unit/presets.test.ts` has unit tests on the expanded keys of `overshoot` and `follow`, a triggering and a non-triggering test for `W-MOTION-SPARSE`, `W-EASE-UNIFORM` and the start rule of `W-SYNC`, the error cases of `E-OVERSHOOT` and `E-FOLLOW`, and a test of the four easings. The shared scene helper there sets `tier: "icon"` so the whole-scene motion warnings stay out of tests about preset keys.
- **Corpus.** `examples/overshoot-badge.gertie.json` (overshoot on scale, rotation and x), `examples/follow-chain.gertie.json` (four links, each following the one above) and `examples/potted-plant.gertie.json` (one gust with an overshoot, seven leaves following the stem with their own delays and scales, and moving holds).

