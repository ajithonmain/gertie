import Ajv2020 from "ajv/dist/2020.js";
import { LottieValidator } from "@lottie-animation-community/lottie-specs/src/validator.js";
import schema from "../../skills/gertie/assets/lottie.schema.json" with { type: "json" };
import { makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";

/**
 * Properties the validator reports as unknown but that lottie-web relies on.
 * Each entry is a "Verify during build" item for phase 2: render with and without it.
 * See docs/04-lottie-emitter.md, "Validator findings".
 */
export const TOLERATED_UNKNOWN_PROPERTIES: readonly string[] = ["st", "hasMask", "td", "Mask.x"];

const AjvClass = ((Ajv2020 as unknown as { default?: unknown }).default ?? Ajv2020) as new (opts?: object) => object;

let validator: LottieValidator | undefined;

function getValidator(): LottieValidator {
  validator ??= new LottieValidator(AjvClass, schema as object, { name_paths: false });
  return validator;
}

function nodeAt(data: unknown, pointer: string): string | undefined {
  let cur: unknown = data;
  let nm: string | undefined;
  for (const part of pointer.split("/")) {
    if (part === "") continue;
    if (cur === null || typeof cur !== "object") break;
    cur = (cur as Record<string, unknown>)[part];
    // Only layers (numeric ty) name a scene node. Shape items carry their own nm.
    const o = cur as { ty?: unknown; nm?: unknown } | null;
    if (o !== null && typeof o === "object" && typeof o.ty === "number" && typeof o.nm === "string") nm = o.nm;
  }
  return nm;
}

/**
 * Validates a Lottie object against the official JSON Schema.
 * With origin "gertie", every problem is a compiler bug (E-INTERNAL-SCHEMA).
 * With origin "external", unknown properties are warnings and schema failures are E-L-SCHEMA.
 */
export function validateSchema(lottie: unknown, origin: "gertie" | "external"): Diagnostic[] {
  const out: Diagnostic[] = [];
  const results = getValidator().validate(lottie as object, true);
  for (const r of results) {
    const unknown = /^(.+?) has unknown property '([^']+)'/.exec(r.message);
    if (unknown && (TOLERATED_UNKNOWN_PROPERTIES.includes(unknown[2] as string) || TOLERATED_UNKNOWN_PROPERTIES.includes(`${unknown[1]}.${unknown[2]}`))) continue;
    const node = nodeAt(lottie, r.path);
    const where: { node?: string; path?: string } = { path: r.path };
    if (node !== undefined) where.node = node;
    if (origin === "gertie") {
      out.push(makeDiagnostic("E-INTERNAL-SCHEMA", `The generated Lottie fails the schema: ${r.message} at ${r.path || "root"}.`, "This is a Gertie bug. Report it with the scene file. You can work around it by removing the feature that triggered it.", where));
    } else if (r.type === "warning") {
      out.push(makeDiagnostic("W-L-UNKNOWN-PROP", `${r.message} at ${r.path || "root"}.`, "Players may ignore this property.", where));
    } else {
      out.push(makeDiagnostic("E-L-SCHEMA", `${r.message} at ${r.path || "root"}.`, "Fix the Lottie file so it matches the specification.", where));
    }
  }
  return out;
}
