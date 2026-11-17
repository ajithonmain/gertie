export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  severity: Severity;
  node?: string;
  path?: string;
  message: string;
  fix?: string;
}

export interface Report {
  ok: boolean;
  errors: number;
  warnings: number;
  diagnostics: Diagnostic[];
}

export function makeDiagnostic(
  code: string,
  message: string,
  fix: string | undefined,
  where: { node?: string; path?: string } = {},
): Diagnostic {
  const d: Diagnostic = { code, severity: code.startsWith("W-") ? "warning" : "error", message };
  if (where.node !== undefined) d.node = where.node;
  if (where.path !== undefined) d.path = where.path;
  if (fix !== undefined) d.fix = fix;
  return d;
}

export function report(diagnostics: Diagnostic[], strict = false): Report {
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.length - errors;
  return { ok: errors === 0 && !(strict && warnings > 0), errors, warnings, diagnostics };
}

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === "error");
}

/** Levenshtein distance, used to suggest the closest valid name. */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0] ?? 0;
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j] ?? 0;
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      prev[j] = Math.min(up + 1, (prev[j - 1] ?? 0) + 1, diag + cost);
      diag = up;
    }
  }
  return prev[b.length] ?? 0;
}

export function closest(name: string, options: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestDistance = Infinity;
  const lower = name.toLowerCase();
  for (const option of options) {
    const d = editDistance(lower, option.toLowerCase());
    if (d < bestDistance) {
      bestDistance = d;
      best = option;
    }
  }
  const limit = Math.max(2, Math.floor(name.length / 3));
  return bestDistance <= limit ? best : undefined;
}

export function didYouMean(name: string, options: readonly string[]): string {
  const c = closest(name, options);
  return c === undefined ? "" : ` Did you mean '${c}'?`;
}
