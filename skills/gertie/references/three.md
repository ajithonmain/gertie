# Three.js animation

Use a `.three.json` scene for true 3D loops such as a product-style turntable,
a floating sculpture, or spinning geometric shapes. Gertie builds a standalone
HTML player with Three.js bundled inside it. Open it in a WebGL 2 browser.
Playback uses the browser's refresh rate, includes a Pause button, and starts
paused when the viewer prefers reduced motion.

```sh
node skills/gertie/scripts/gertie.mjs three validate examples/three-turntable.three.json
node skills/gertie/scripts/gertie.mjs three build examples/three-turntable.three.json --out out/turntable.html
```

Open the HTML and inspect one full loop for framing, lighting, and motion at
the seam. The example uses a knot with two floating crystals. Use `--json`
to get the validation result or output path programmatically. By default,
the HTML is written to an `out/` folder beside the scene.

| Scene field | Meaning | Default |
|---|---|---|
| `width`, `height` | Canvas dimensions, 64–2048 pixels each | 640 × 480 |
| `orbit` | Enable drag and arrow-key orbit and scroll zoom | Off |
| `duration` | Loop length in seconds, 0.25–120 | 4 |
| `background` | Six-digit hex color | `#171427` |
| `camera` | Camera position [x, y, z], aimed at the origin | `[0, 2, 7]` |
| `objects` | Array of 1–64 objects | Required |

| Object field | Meaning | Default |
|---|---|---|
| `shape` | `box`, `sphere`, `cylinder`, `crystal`, `knot`, `robot`, `team`, or `relief` | Required |
| `color` | Six-digit hex color | `#ff9e8a` |
| `position` | Position [x, y, z] | `[0, 0, 0]` |
| `rotation` | Initial [x, y, z] orientation in radians | `[0, 0, 0]` |
| `scale` | Uniform multiplier or [x, y, z] multipliers, 0.01–10 per axis | 1 |
| `pivot` | Optional world position [x, y, z] around which the object spins. Use the same pivot and spin on multiple objects to turn them together. | Object position |
| `metalness`, `roughness` | Material controls, 0–1 | 0.15 and 0.36 |
| `spin` | Signed whole turns per loop on [x, y, z], −8 to 8 | `[0, 1, 0]` |
| `bob` | Vertical sine-wave amplitude, 0–10 units | 0 |
| `phase` | Bob offset as a fraction of one loop, 0–1 | 0 |
| `motion` | Eased keys such as `{"at": 1.2, "offset": [0, 1, 0], "turn": [0, 0.5, 0]}`. Times are seconds. Offset is a position delta and turn is a rotation delta in radians. | No keys |

Motion keys must begin at 0 and end at the scene duration with the same opening
and closing pose. Use repeated poses at different times for a hold. Both offset
and turn default to zero at each key. Set spin to zero for keyframed motion without
a continuous turn.

For gentle turntables, use one turn on the Y axis and a duration of 4–8
seconds. Whole turns and one full bob cycle keep the loop continuous.
Use `spin: [0, 0, 0]` to keep an object's orientation fixed.

For a desktop mascot, use `shape: "robot"`. Its built-in loop breathes,
blinks, looks both ways, walks to a console, taps its controls, and waves
after walking back. Set
`spin: [0, 0, 0]` to use the robot’s own turns, and use `color` to customize
the shell. Try `examples/desktop-robot.three.json` for a 13-second loop.

Use `shape: "team"` for a four-person portrait with a wave, blinks, and
floating reactions and a steady front view. See `examples/community-team.three.json`.

Use `shape: "relief"` to turn an image and a matching grayscale depth map
into a textured mesh for slight camera-angle changes. Set `image` and
`depthMap` to local PNG paths relative to the scene. Lighter values are nearer.
`depth` controls the displacement from 0 to 2 scene units and defaults to
1.05. Use `spin: [0, 0, 0]` for the built-in shallow turn. Try
`examples/community-team-relief.three.json`.

The HTML workflow supports built-in geometry and textured reliefs. Model import and still
or video export are outside the current 3D workflow.
