# Working from a Lottie file the user supplied

A Lottie file made by another tool may use any feature. Gertie does not convert it back into a scene. It looks at it, makes small edits to the JSON, and can place it inside a scene.

All commands take a Lottie JSON file. A `.lottie` archive must be unzipped first (it is a zip file; use the animation JSON inside it).

## Look at it first

    node scripts/gertie.mjs inspect animation.json --json
    node scripts/gertie.mjs render animation.json            # contact sheet, written next to the file

`inspect` prints the size, frame rate, length, layers, precompositions, every colour with how often it is used, and which features the file uses: expressions, effects, masks, mattes, time remapping, text, images. It also says whether the file is **portable** (`validation.portable`). Most files exported from After Effects are not: expressions and effects only run in the web player, and many files omit the last keyframe value the schema asks for. That is normal. Tell the user when a file is not portable, and what it means (it may look wrong in a mobile player).

Look at the contact sheet before editing. It shows what the file really draws.

## Change the colours

    node scripts/gertie.mjs recolor animation.json --map "#3d3d3d=#ff00ff,#0c9cf8=#22c55e"

`--map` takes pairs of `old=new` hex colours separated by commas. Take the old colours from `inspect`. They match exactly unless you pass `--tolerance 6` (each of red, green and blue within 6 of 255). Alpha is kept. Fills, strokes, gradient stops, animated colours and solid layers are changed. Colours that come from effects, text or expressions are not. The result goes to `animation.recolored.json` (or `--out`). If nothing matched, the command lists the file's most used colours.

## Change the speed

    node scripts/gertie.mjs retime animation.json --speed 1.5        # 1.5 times as fast
    node scripts/gertie.mjs retime animation.json --duration 2       # exactly 2 seconds

Every keyframe time, layer range and the length are rescaled. The frame rate stays. The result goes to `animation.retimed.json`. Expressions that read the clock are not changed, and the command says how many there are.

## Every edit is checked

After recolor and retime, Gertie validates the result and compares it with the original. A file that was not portable before stays not portable; what matters is that the edit **adds no new diagnostics** (`validation.introduced` is 0). It also draws the edited file in a browser and fails if it is blank or the player complains. Pass `--no-render` to skip the drawing. Look at the result with `render`.

## Put it in a scene

A scene can place a Lottie file as a node:

    { "id": "spinner", "type": "lottie", "src": "spinner.json", "x": 100, "y": 60, "scale": 0.5 }

- `src` is relative to the scene file. The node has `x`, `y`, `scale`, `rotation`, `opacity`, `pivot`, `from`, `to` and `animate` like any node. Its top-left corner is at `x`, `y`, like an image.
- The file is rescaled to the scene's frame rate and becomes a precomposition. It plays once from the start of the node; it does not loop by itself. If the file and the node last different times you get `W-LOTTIE-DURATION` (retime the file, or set the node's `from` and `to`).
- **The SVG output cannot show a Lottie file.** A scene with a `lottie` node is compiled to Lottie only, and `qa` and `compile` say so. Asking for the SVG is `E-SVG-LOTTIE`.
- The result must pass the portable subset like any scene. A file with expressions or effects is reported as `E-L-SUBSET`; recolor and retime it first only if that fixes it (it will not), or choose another file.
- Images inside the file must be embedded. A file that points at separate image files is `E-LOTTIE-IMAGES`.
