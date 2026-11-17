import type { Diagnostic } from "../spec/diagnostics.ts";

const key = (d: Diagnostic): string => `${d.code}|${d.path ?? ""}`;

/**
 * Diagnostics in `after` that were not in `before`, matched by code and location.
 * A third-party file usually has diagnostics already (an omitted end keyframe, an expression); an edit is correct when it adds none.
 */
export function introduced(before: readonly Diagnostic[], after: readonly Diagnostic[]): Diagnostic[] {
  const seen = new Map<string, number>();
  for (const d of before) seen.set(key(d), (seen.get(key(d)) ?? 0) + 1);
  const out: Diagnostic[] = [];
  for (const d of after) {
    const n = seen.get(key(d)) ?? 0;
    if (n > 0) seen.set(key(d), n - 1);
    else out.push(d);
  }
  return out;
}
