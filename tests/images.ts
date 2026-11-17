import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";

/** Data URIs for the image nodes named in a scene text, resolved against `dir`. */
export function imagesFor(dir: string, text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of text.matchAll(/"src"\s*:\s*"([^"]+)"/g)) {
    const src = m[1] as string;
    const p = join(dir, src);
    const ext = extname(p).slice(1).toLowerCase();
    if (existsSync(p)) out[src] = `data:image/${ext === "svg" ? "svg+xml" : ext};base64,${readFileSync(p).toString("base64")}`;
  }
  return out;
}
