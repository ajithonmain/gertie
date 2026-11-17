import type { Diagnostic } from "../spec/diagnostics.ts";
import { semanticLint } from "./semantic.ts";
import { validateSchema } from "./schema.ts";

/** Gate 2: schema validation plus semantic lint of a Lottie document. */
export function validateLottie(lottie: unknown, origin: "gertie" | "external"): Diagnostic[] {
  return [...validateSchema(lottie, origin), ...semanticLint(lottie)];
}

export { semanticLint, validateSchema };
