export interface Args {
  command: string | undefined;
  positional: string[];
  flags: Map<string, string | true>;
  /** Every value given for a flag, in order, for flags that may repeat such as `--at`. Missing when built by hand. */
  all?: Map<string, string[]>;
}

const VALUE_FLAGS = new Set(["out", "sheet-frames", "to", "for", "bg", "scale", "loops", "keep-frames", "preview", "map", "tolerance", "speed", "duration", "colors", "speckle", "drop", "seam", "detail", "keep-svg", "cols", "cell", "max-seconds", "background", "times", "step", "engine", "keep-work", "rows", "fps", "frames", "text", "seed", "ramp", "fg", "style", "frame", "name", "crop", "rate", "at", "time", "gamma", "threshold", "key", "color-levels", "palette", "tint", "chars", "shimmer", "dither", "edge-color", "glyph", "cell-aspect", "cell-bg", "glow", "font-size", "effect", "by", "amount", "tier", "quality"]);

export function parseArgs(argv: readonly string[]): Args {
  const flags = new Map<string, string | true>();
  const all = new Map<string, string[]>();
  const positional: string[] = [];
  let command: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      const name = eq === -1 ? a.slice(2) : a.slice(2, eq);
      let value: string | undefined;
      if (eq !== -1) value = a.slice(eq + 1);
      else if (VALUE_FLAGS.has(name) && i + 1 < argv.length) value = argv[++i] as string;
      if (value === undefined) flags.set(name, true);
      else {
        flags.set(name, value);
        all.set(name, [...(all.get(name) ?? []), value]);
      }
    } else if (a === "-v") flags.set("version", true);
    else if (command === undefined) command = a;
    else positional.push(a);
  }
  return { command, positional, flags, all };
}
