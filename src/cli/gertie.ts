import { readFileSync } from "node:fs";
import { parseArgs } from "./lib/args.ts";
import { storyCommand } from "./lib/story-command.ts";
import { asciiCommand } from "./lib/ascii-command.ts";
import { compileCommand, doctorCommand, emit, EXIT_USAGE, exportCommand, cutoutCommand, gridCommand, groupCommand, importCommand, inspectCommand, profileCommand, qaCommand, recolorCommand, renderCommand, retimeCommand, sampleCommand, studyCommand, traceCommand, validateCommand } from "./lib/commands.ts";

declare const __GERTIE_VERSION__: string;

const VERSION: string =
  typeof __GERTIE_VERSION__ === "string"
    ? __GERTIE_VERSION__
    : (JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { version: string }).version;

const USAGE = `gertie ${VERSION}

Usage:
  gertie compile <scene.gertie.json> [--lottie] [--svg] [--out dir] [--pretty] [--json] [--strict]
  gertie validate <scene.gertie.json | lottie.json> [--json] [--strict]
  gertie qa <scene.gertie.json> [--thorough] [--sheet-frames n] [--out dir] [--json] [--strict]
  gertie export <scene.gertie.json> (--to <formats> | --for <destination>) [--bg #rrggbb] [--scale n] [--quality standard|high] [--loops n] [--out dir] [--json]
  gertie import <artwork.svg> [--out fragment.json] [--preview preview.png] [--no-preview] [--json]
  gertie trace <image.png> [--colors n] [--speckle n] [--drop #fff,...] [--seam n] [--detail n] [--out fragment.json] [--keep-svg traced.svg] [--no-preview] [--json]
  gertie group <fragment.json> <groups.json> [--out grouped.fragment.json]
  gertie cutout <painting.png> <parts.json> [--out folder] [--json]
  gertie study <clip.mp4|clip.gif> [--crop x,y,w,h] [--rate source] [--fps 8] [--cols 8] [--cell 192] [--max-seconds 20] [--background median|border] [--out sheet.png] [--json]
  gertie sample <image-or-clip> --at x,y [--at x,y ...] [--time seconds] [--json]
  gertie story <video.story.json> [--out video.mp4] [--engine builtin|hyperframes] [--render] [--lint-only] [--no-qa] [--keep-work dir] [--no-sheet] [--json] [--strict]
  gertie ascii <lint|export|render|from|gen|play> ...   text-character animation; run gertie ascii for the options
  gertie profile <scene.gertie.json | lottie.json> [--tier icon|character|scene] [--json]
  gertie inspect <animation.json> [--json]
  gertie recolor <animation.json> --map "#ff0000=#3b82f6,..." [--tolerance n] [--out file] [--no-render] [--json]
  gertie retime <animation.json> (--speed n | --duration seconds) [--out file] [--no-render] [--json]
  gertie render <animation.json> [--sheet-frames n] [--times 0.6,1.1] [--out sheet.png | folder] [--json]
  gertie grid <image> [--step 50] [--out grid.png]
  gertie doctor [--json]
  gertie --version`;

async function main(argv: readonly string[]): Promise<number> {
  const args = parseArgs(argv.slice(2));
  if (args.flags.has("version")) {
    console.log(VERSION);
    return 0;
  }
  if (args.flags.has("help") && args.command !== "ascii") {
    const lines = USAGE.split("\n").filter((l) => args.command !== undefined && l.trimStart().startsWith(`gertie ${args.command} `));
    console.log(lines.length > 0 ? lines.map((l) => l.trim()).join("\n") : USAGE);
    return 0;
  }
  const json = args.flags.has("json");
  switch (args.command) {
    case "compile": {
      const o = compileCommand(args);
      emit(o, json);
      return o.code;
    }
    case "validate": {
      const o = validateCommand(args);
      emit(o, json);
      return o.code;
    }
    case "qa": {
      const o = await qaCommand(args);
      emit(o, json);
      return o.code;
    }
    case "export": {
      const o = await exportCommand(args);
      emit(o, json);
      return o.code;
    }
    case "import": {
      const o = await importCommand(args);
      emit(o, json);
      return o.code;
    }
    case "trace": {
      const o = await traceCommand(args);
      emit(o, json);
      return o.code;
    }
    case "group": {
      const o = groupCommand(args);
      emit(o, json);
      return o.code;
    }
    case "grid": {
      const o = await gridCommand(args);
      emit(o, json);
      return o.code;
    }
    case "cutout": {
      const o = await cutoutCommand(args);
      emit(o, json);
      return o.code;
    }
    case "study": {
      const o = await studyCommand(args);
      emit(o, json);
      return o.code;
    }
    case "sample": {
      const o = sampleCommand(args);
      emit(o, json);
      return o.code;
    }
    case "story": {
      const o = await storyCommand(args);
      emit(o, json);
      return o.code;
    }
    case "ascii": {
      const o = await asciiCommand(args);
      emit(o, json);
      return o.code;
    }
    case "profile": {
      const o = profileCommand(args);
      emit(o, json);
      return o.code;
    }
    case "inspect": {
      const o = inspectCommand(args);
      emit(o, json);
      return o.code;
    }
    case "recolor": {
      const o = await recolorCommand(args);
      emit(o, json);
      return o.code;
    }
    case "retime": {
      const o = await retimeCommand(args);
      emit(o, json);
      return o.code;
    }
    case "render": {
      const o = await renderCommand(args);
      emit(o, json);
      return o.code;
    }
    case "doctor": {
      const o = await doctorCommand();
      emit(o, json);
      return o.code;
    }
    default:
      console.error(USAGE);
      return EXIT_USAGE;
  }
}

process.exitCode = await main(process.argv);
