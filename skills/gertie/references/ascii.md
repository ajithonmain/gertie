# ASCII animation

Read this when the user wants text-character animation: a README banner, a terminal loader, a retro look, a dense colourful clip made of characters or dots for a social post, or something that imitates an ASCII clip they show you. It is a separate engine from the vector pipeline, with its own scene file (`.ascii.json`). There is no Lottie output, because Lottie has no portable text. Outputs are animated SVG (plays in a README, no JavaScript), GIF and video, terminal playback, a shell script and a small JavaScript module.

Every command below was run on the files in `examples/ascii/` of the Gertie repository. Run them from the folder that holds your files, with `node scripts/gertie.mjs` pointing at this skill's script.

## Playbook 1: from scratch

1. **Small and simple** (a rocket, a face, a logo, at most 40 columns by 15 rows): write the frames yourself in a text file, 8 to 16 frames. See "Writing frames yourself".
2. **A standard effect** (spinner, progress bar, scrolling text, bouncing ball, rain, starfield, wave): generate it. It is exact and loops cleanly. Generators are `spinner`, `bar`, `scroll`, `ball`, `rain`, `stars` and `wave`, with `--cols`, `--rows`, `--frames`, `--fps`, `--text`, `--style`, `--seed`, `--fg` and `--bg`.

       node scripts/gertie.mjs ascii gen spinner --text "Loading" --style dots --out loading.ascii.json
       node scripts/gertie.mjs ascii gen stars --cols 60 --rows 24 --frames 20 --out stars.ascii.json

3. **Smooth motion, many parts, or more than about 60 columns**: never draw a large picture in characters. Build it as a vector scene with bold shapes and flat or gradient colours (read `scene.md` and `motion.md`), pass `qa`, then convert it to a **recipe** of 120 to 200 columns with a look from the table below and one effect:

       node scripts/gertie.mjs qa bouquet.gertie.json --sheet-frames 16
       node scripts/gertie.mjs ascii from bouquet.gertie.json --recipe --cols 180 --fps 24 --ramp long --palette "#5cae3c,#f48fb1,#f5f5f5" --glow 0.4 --font-size 8 --out bouquet.ascii.json
       node scripts/gertie.mjs ascii fx bouquet.ascii.json --effect reveal --by rows-up --at 0 --duration 1.5

4. **Several things moving independently** (fish in a pond, a caption over a picture): use **layers**. Draw or convert each sprite once and move it with keyframes of three numbers. See "Layers".

## Playbook 2: from a reference

- **A picture or a video to turn into ASCII.** Convert it with `ascii from`. Video and images are normalised by default, so a dark clip does not come out as mostly dots; `--key auto` turns the background into spaces. Then choose the look (ramp, `--chars`, dots) and one effect.

      node scripts/gertie.mjs ascii from sunflower.png --cols 80 --key auto --color --out photo.ascii.json

  A still picture is one frame long, so it has no time for an effect. Put it in a layer of a scene with a `duration` and give the scene the effect, as `halftone.ascii.json` does (see the table of looks).

- **An ASCII clip to imitate.** Measure it, then build the same structure (grid, look, timing) with your own vector art rather than converting the clip's pictures. The "Rights" rules in `motion-reference.md` apply.
  1. `ascii probe` reads the grid, the colours, the frame rate and whether the cells are characters or dots:

         node scripts/gertie.mjs ascii probe bouquet.mp4 --time 5

     It prints the columns and rows, the cell size in pixels and the `cellAspect` to use, the background (and a gradient, when the top and bottom differ), the five main colours with their shares, the frame rate and how many times a second the picture actually changes (a 10 fps animation exported at 30 fps shows about 10). Add `--json` for all of it as data. By default it reads the middle of the clip; pick a frame where the picture is full with `--time`.
  2. When the grid is `null` (a nearly empty frame, or no grid), or the glyph is unknown (cells under 8 pixels cannot be told apart), count the cells and read the character set on an enlarged crop of a frame with a labelled grid drawn on it (the `grid` command in `cutout.md`).
  3. `study` gives the timing of the motion (see `motion-reference.md`).
  4. Build it with Playbook 1: a vector scene of your own, converted with the probed `cols`, `cellAspect` and colours as a `--palette`.

## Looks

Each look is one of the examples in `examples/ascii/`. The command or the fields given are exactly what makes it.

| Look | What makes it | Example |
|---|---|---|
| CRT bouquet: dense small glyphs, a colour per part, a soft glow, growing from the bottom | `ascii from bouquet.gertie.json --recipe --cols 180 --fps 24 --ramp long --palette "#5cae3c,#f48fb1,#f5f5f5" --glow 0.4 --font-size 8 --out bouquet.ascii.json`, then `ascii fx bouquet.ascii.json --effect reveal --by rows-up --at 0 --duration 1.5`. The scene animates underneath: stems with `draw-on`, flowers with `pop-in`, staggered | `bouquet.ascii.json` from `bouquet.gertie.json` |
| Halftone: coloured dots whose size is the brightness, on square cells, appearing a few at a time | `"style": {"glyph":"dot","ramp":" .:-=+*#%@","cellAspect":1}`, a layer `{"source": {"file":"sunflower.png","cols":120,"color":true}}`, scene `fx` `reveal` `by` `scatter` (and a `hide` at the end so it loops) | `halftone.ascii.json` |
| Letter field: a shape made of a chosen set of letters, coloured per cell, flickering, on a gradient, with a typed caption | a layer `{"source": {"file":"star-flower.gertie.json","cols":120,"chars":"CZ*o+^","seed":3,"shimmer":0.08}}`, `"style": {"background":{"from":"#070b1f","to":"#23356e","angle":180},"glow":0.3}`, and a text layer with `{"effect":"type","at":0.3,"cps":14}` | `letter-field.ascii.json` |
| Bands: brightness split into four shapes (`/`, `1`, `X`, `●`) with an accent along the edges | `ascii from orb.gertie.json --recipe --cols 80 --fps 24 --ramp bands --edge-color "#ff7a2f" --font-size 12 --out bands.ascii.json`, with `"gamma": 1.8` added to the source so the bright band does not swallow the rest | `bands.ascii.json` |
| Pond: sprites moving over one another on a moving background | a `source` layer for the water (`"ramp":"dots","tint":"#62c6c6","gamma":0.6`), then four `framesFile` sprite layers, each with a `color` and `at` keyframes | `pond.ascii.json` |

Two more controls change the look of any of these. `--cell-bg 0.35` fills each cell behind its glyph with its own colour at 35 percent, so shapes read as solid. `--glyph square` draws filled squares in place of dots.

## Conversion controls

All are flags of `ascii from`, and the same names in camel case in a recipe's `source` (`--edge-color` is `"edgeColor"`, `--cell-bg` is `"cellBg"`). Only these go in `style` instead: `color`, `background`, `fontSize`, `fontFamily`, `glyph`, `ramp`, `cellAspect` and `glow`; everything else in this list belongs in `source`.

- Ramps (`--ramp`): `standard` (the default ` .:-=+*#%@`), `long` (69 characters, fine tones), `blocks`, `dots`, `binary`, `digits`, `bands`, or any literal string ordered dark to light. `--invert` flips it.
- Colour: `--color` keeps the source colours; `--palette #a,#b,#c` snaps every cell to the nearest of a few colours; `--tint #hex` gives one hue scaled by brightness; `--color-levels n` with `--color`. `--tint` and `--palette` exclude each other.
- Tone: `--normalize` or `--no-normalize` (on by default for video and images, off for scenes), `--gamma n` (above 1 darkens the middle tones, below 1 lifts them), `--threshold n` (cells under it become spaces), `--key auto|#hex` (the background colour becomes spaces), `--crop x,y,w,h`, `--dither ordered`.
- Characters: `--chars CZ*o+^ --seed n [--shimmer 0.08]` uses a fixed set of characters, chosen per cell, in place of a ramp; brightness then shows only through colour. `--edge-color #hex` colours cells where the brightness steps, which is the outline and the boundaries between bands.
- Cells: `--glyph text|dot|square`, `--cell-aspect n` (1 gives square cells, which dots want), `--cell-bg n`, `--glow n` (0 to 1), `--font-size n`.

## Recipes: dense animation

`--recipe` writes a small `.ascii.json` that names its source and its controls instead of storing frames; frames are computed when it is rendered or exported. Edit it and render again to try another look. It is chosen automatically above 240 columns, 120 rows, or 400,000 cells in total (cols times rows times frames). A recipe allows up to 400 columns, 200 rows and 3600 frames. Above 400,000 cells there is no SVG (`E-ASCII-TOOMANY`): export to mp4, webm or gif. This is the bouquet:

    {
      "ascii": 1,
      "name": "bouquet",
      "fps": 24,
      "loop": false,
      "style": {"color":"#22c55e","background":"#000000","fontSize":8,"glow":0.4},
      "source": {
        "file": "bouquet.gertie.json",
        "cols": 180,
        "ramp": "long",
        "palette": ["#5cae3c","#f48fb1","#f5f5f5"]
      },
      "fx": [
        {"effect":"reveal","by":"rows-up","at":0,"duration":1.5}
      ]
    }

A 180 column, 24 fps, 8 second recipe exports to MP4 in about 20 to 30 seconds at the default scale. `--scale 2` makes four times the pixels and takes several times longer, and a GIF of a dense recipe at that scale can pass 20 MB: for a social post, deliver the MP4 and keep the GIF for small grids.

## Effects in time

`fx` is a list on the scene (or on a layer), applied in order. Each entry has `effect`, `at` (seconds, default 0) and `duration` (seconds). `ascii fx` adds one to a file and lints it; `--duration` defaults to the rest of the animation.

| Effect | Parameters | What it does |
|---|---|---|
| `reveal` | `by`: `scatter`, `rows-up`, `rows-down`, `cols-right`, `cols-left`, `radial`, `bright-first`; `seed` | Cells appear in that order; nothing shows before `at` |
| `hide` | the same `by` values | Cells disappear in that order; use it at the end of a loop |
| `decode` | `chars`, `seed` | Each cell shows random characters, then settles on its own |
| `shimmer` | `amount` (default 0.1), `chars`, `seed` | That fraction of cells shows a different character each frame |
| `type` | `cps` (default 30) | Only on a text layer: the text types itself with a block cursor |

Effects never change colours, and the same file and seed give the same frames every time.

## Layers

A scene with `layers` has `cols`, `rows` and `duration` (seconds), and no frames of its own. For a source layer that fills the scene, the rows are the source's height over its width, times `cols`, divided by `cellAspect` (2 by default), rounded; or run `ascii from` on the source once with the same `--cols` and read the grid it prints. Each layer has exactly one of `source` (a recipe source), `framesFile`, `frames` or `text` (rows of a still caption), plus optional `id`, `color` (for cells with no colour of their own), `at`, `fx`, `from` and `to` (seconds it exists), and `loop` (default true: a short layer repeats). Layers draw in order, later on top. A space is transparent, so a sprite that should look solid needs characters in place of its inner spaces.

`at` is keyframes `[seconds, column, row, ease]` of the layer's top-left cell; the ease is optional (linear by default; any easing name from `scene.md`, or `hold`) and applies from that key to the next. Positions may be off the grid, so a sprite can swim in from the edge. There is no rotation or scaling: a sprite that turns is converted from a vector scene in which it turns. All times in a layer, its `fx` included, are scene seconds. A fish from `pond.ascii.json`:

    { "id": "koi-a", "framesFile": "koi-right.txt", "color": "#ff7a3d",
      "at": [[0, -24, 10], [3, 40, 16, "easeInOutSine"], [5.5, 80, 12, "easeInOutSine"], [8, 124, 15, "easeInOutSine"]] }

## Writing frames yourself

Do not put frames in JSON: every backslash would have to be doubled, and models get that wrong. Put them in a text file, frames separated by a line containing only `---`, and name it:

    {
      "ascii": 1,
      "name": "rocket",
      "fps": 8,
      "loop": false,
      "style": { "color": "#22c55e", "background": "#0b0f19", "fontSize": 16 },
      "framesFile": "rocket.txt"
    }

`cols` and `rows` are optional; they default to the widest row and the tallest frame. If you give them, a row wider than `cols` or a frame taller than `rows` is an error that names the frame and row. To hold a frame longer, use inline frames: `{"text": ["row", "row"], "hold": 3}`, or `{"file": "frames/01.txt", "hold": 3}`. Per-row or per-cell colour: `"colors": ["#ff0000", [null, "#00ff00"]]` on a frame (a row is one colour or a list with one entry per cell, `null` for the style colour); `"backgrounds"` has the same shape and fills behind the cell. Allowed characters are anything printable that is one cell wide: ASCII, box-drawing and block characters work in every font. Do not use emoji or CJK (they take two cells and break the grid; the linter warns).

## Check it

    node scripts/gertie.mjs ascii lint pond.ascii.json --strict
    node scripts/gertie.mjs ascii render pond.ascii.json --sheet-frames 16
    node scripts/gertie.mjs ascii play rocket.ascii.json --frame 3

`lint` reports errors (exit 1) and warnings, each with a `fix`; for a recipe or layers it opens the sources and prints the grid, length and renderer. `render` writes a contact sheet to `out/<name>.sheet.png`: look at it before delivering, and revise at most three times. When the recipe and its vector scene share a name, `qa` and `render` write the same sheet path; give `render` an `--out` to keep both. On a sheet of a dense grid the glyphs are too small to read; take one frame of the exported MP4 at full size with ffmpeg to see them. `W-ASCII-LOOP-JUMP` means the last frame does not lead back into the first. `play --frame n` prints one frame as plain text, a quick check if you cannot see images.

## Frame rate

Small grids (under 80 columns): keep it low. Eight frames per second reads as deliberate; thirty looks like noise (the linter warns above 15). Dense grids converted from smooth scenes look right at 24 to 30. For GIF, prefer 10 or 25 fps: GIF delays are whole hundredths of a second, so rates like 8, 12 or 24 are rounded and the timing wobbles slightly (a 24 fps clip becomes 25 fps GIF). SVG and video keep the exact rate.

## Export

    node scripts/gertie.mjs ascii export bouquet.ascii.json --to mp4,gif
    node scripts/gertie.mjs ascii export rocket.ascii.json --to svg,gif,webp,mp4,sh,js --scale 2
    node scripts/gertie.mjs ascii export bouncing-ball.ascii.json --for readme

`--to` accepts `svg` and every frame format from `export.md` (gif, apng, webp, webm, prores, hevc, mp4), plus `sh` and `js`. `--for` accepts the destinations in `export.md` and enforces their limits (a 3.3 second animation is refused for Telegram, with the fix). Use `--scale 2` for small grids so the text is sharp. A transparent background (`"background": "transparent"`) gives a transparent APNG, WebP or WebM. A GIF export without `--bg` prints a note about transparent GIF even when the background is solid; with a solid `style.background` the GIF is opaque and the note can be ignored.

- **svg** plays in an `<img>` tag and in a README, with no JavaScript. It never embeds a font: every run of text has a fixed length, so the grid stays aligned in whatever monospace font the viewer has. As a standalone document it shows the first frame under `prefers-reduced-motion`; inside an `<img>` browsers do not pass that setting, so it keeps playing. Large animations (above 400,000 cells) have no SVG, `sh` or `js`.
- **sh** is a self-contained shell script that plays in a terminal: `sh name.sh`, Ctrl-C to stop. **js** is a module exporting `frames`, `delays`, `fps` and a `start(stream)` function that draws the animation until the function it returns is called, for a command-line tool's loading indicator.
- `ascii play <file>` plays directly in a terminal (`--once`, `--loops n`, `--no-color`). Without a terminal it prints frame 0 and says so.

Deliver the `.ascii.json` with its source files (scene, picture, sprite text files), the exported formats asked for, and say what was checked. Do not claim the animation was watched: you saw still frames.
