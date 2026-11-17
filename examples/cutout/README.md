# Cutout example

A synthetic painterly portrait (`tests/fixtures/cutout/painting.png`, made by `make-painting.ts` in that folder) is cut into layers along hand-drawn outlines and animated: a blink, a head tilt and a slow background drift.

    node skills/gertie/scripts/gertie.mjs cutout tests/fixtures/cutout/painting.png examples/cutout/painting.parts.json --out examples/cutout/painting.cutout
    node skills/gertie/scripts/gertie.mjs group examples/cutout/painting.cutout/fragment.json examples/cutout/painting.groups.json --out examples/cutout/painting.cutout/grouped.fragment.json
    node skills/gertie/scripts/gertie.mjs qa examples/cutout/portrait.gertie.json

The layer images are generated, so they are not committed.
