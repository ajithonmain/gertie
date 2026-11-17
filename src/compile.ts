import { hasErrors, makeDiagnostic, type Diagnostic } from "./spec/diagnostics.ts";
import { lintScene, type LintOptions } from "./spec/lint.ts";
import { normalizeScene } from "./spec/normalize.ts";
import { resolveIncludes } from "./import/include.ts";
import { parseScene } from "./spec/parse.ts";
import { emitLottie, type EmitOptions, type Json } from "./emit-lottie/index.ts";
import { emitSvg, type SvgResult } from "./emit-svg/index.ts";
import { validateLottie } from "./validate/index.ts";
import { validateSvg } from "./validate/svg.ts";
import type { NNode, NScene } from "./spec/types.ts";

function containsLottie(nodes: readonly NNode[]): boolean {
  return nodes.some((n) => n.type === "lottie" || (n.type === "group" && containsLottie(n.children)));
}

export interface CompileOptions extends LintOptions, EmitOptions {
  /** `false` skips the SVG. `true` asks for it and makes a scene with `lottie` nodes an error. Unset: the SVG is made unless the scene has `lottie` nodes. */
  svg?: boolean;
}

export interface CompileResult {
  diagnostics: Diagnostic[];
  scene?: NScene;
  lottie?: { [key: string]: Json };
  svg?: SvgResult;
  /** Why there is no SVG: it was not asked for, or the scene places a Lottie file. */
  svgSkipped?: "off" | "lottie";
}

/** The whole pure pipeline: parse, lint, normalize, emit, validate. No file access. */
export function compileSceneText(text: string, opts: CompileOptions = {}): CompileResult {
  const parsed = parseScene(text);
  if (!parsed.ok) return { diagnostics: [parsed.diagnostic] };
  return compileSceneValue(parsed.value, opts);
}

export function compileSceneValue(raw: unknown, opts: CompileOptions = {}): CompileResult {
  const diagnostics = lintScene(raw, opts);
  if (hasErrors(diagnostics)) return { diagnostics };
  const scene = normalizeScene(resolveIncludes(raw, opts.loadFragment).scene);
  const lottie = emitLottie(scene, opts);
  diagnostics.push(...validateLottie(lottie, "gertie"));
  const hasLottie = containsLottie(scene.nodes) || Object.values(scene.defs).some((d) => containsLottie([d]));
  if (opts.svg === false) return { diagnostics, scene, lottie, svgSkipped: "off" };
  if (hasLottie) {
    if (opts.svg === true) diagnostics.push(makeDiagnostic("E-SVG-LOTTIE", "The scene places a Lottie file, and the SVG output cannot show one.", "Compile only the Lottie output (gertie compile --lottie), or replace the lottie node with artwork from an SVG (gertie import).", {}));
    return { diagnostics, scene, lottie, svgSkipped: "lottie" };
  }
  const svg = emitSvg(scene, opts);
  diagnostics.push(...validateSvg(svg.svg));
  return { diagnostics, scene, lottie, svg };
}
