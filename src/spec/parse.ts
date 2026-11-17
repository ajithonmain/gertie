import { makeDiagnostic, type Diagnostic } from "./diagnostics.ts";

export type ParseResult = { ok: true; value: unknown } | { ok: false; diagnostic: Diagnostic };

function lineColumn(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let i = 0; i < position && i < text.length; i++) {
    if (text[i] === "\n") {
      line++;
      column = 1;
    } else column++;
  }
  return { line, column };
}

/** Parses scene text as JSON. A failure reports the line and column. */
export function parseScene(text: string): ParseResult {
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    let line: number | undefined;
    let column: number | undefined;
    const lc = /line (\d+) column (\d+)/.exec(msg);
    const pos = /position (\d+)/.exec(msg);
    if (lc) {
      line = Number(lc[1]);
      column = Number(lc[2]);
    } else if (pos) {
      ({ line, column } = lineColumn(text, Number(pos[1])));
    } else if (/end of JSON input|Unexpected end/i.test(msg)) {
      ({ line, column } = lineColumn(text, text.length));
    }
    const where = line !== undefined ? ` at line ${line}, column ${column}` : "";
    return {
      ok: false,
      diagnostic: makeDiagnostic("E-JSON", `The file is not valid JSON${where}: ${msg}`, "Fix the JSON syntax at that position. Common causes: a trailing comma, a missing comma or quote, a comment, single quotes.", {
        path: line !== undefined ? `line ${line}:${column}` : "",
      }),
    };
  }
}
