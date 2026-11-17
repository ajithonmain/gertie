import { writeZip } from "./zip.ts";

/**
 * A `.lottie` archive: a ZIP with a manifest and the animation JSON. Version 2 of the container format.
 * Zero dependencies; see `writeZip`.
 */
export function buildLottieArchive(name: string, lottieJson: string, version: string, layout: "v2" | "v1" = "v2"): Buffer {
  const manifest =
    layout === "v2"
      ? { version: "2", generator: `gertie ${version}`, animations: [{ id: name }] }
      : { version: "1", generator: `gertie ${version}`, animations: [{ id: name, speed: 1, loop: true }] };
  const path = layout === "v2" ? `a/${name}.json` : `animations/${name}.json`;
  return writeZip([
    { name: "manifest.json", data: Buffer.from(JSON.stringify(manifest)) },
    { name: path, data: Buffer.from(lottieJson) },
  ]);
}
