import { makeDiagnostic, type Diagnostic } from "../spec/diagnostics.ts";

/**
 * Gate 2 for SVG output: the file must be self-contained. No script, no external reference, no import.
 * Only `data:` URIs and `#fragment` references are allowed.
 */
export function validateSvg(svg: string): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!svg.startsWith("<svg ")) out.push(makeDiagnostic("E-S-ROOT", "The SVG output does not start with an <svg> element.", "This is a Gertie bug. Report it."));
  if (/<script[\s>]/i.test(svg) || /\bon[a-z]+\s*=/i.test(svg)) out.push(makeDiagnostic("E-S-SCRIPT", "The SVG output contains a script or an event handler.", "This is a Gertie bug. SVG that runs scripts does not work inside <img> and is not allowed."));
  if (/@import/i.test(svg)) out.push(makeDiagnostic("E-S-EXTERNAL", "The SVG output contains an @import rule.", "This is a Gertie bug. Everything must be inline."));
  for (const m of svg.matchAll(/\b(?:xlink:)?href="([^"]*)"/g)) {
    const url = m[1] as string;
    if (url !== "" && !url.startsWith("#") && !url.startsWith("data:")) out.push(makeDiagnostic("E-S-EXTERNAL", `The SVG output references '${url.slice(0, 60)}', which is outside the file.`, "Images must be embedded as data URIs. Check the image 'src' paths in the scene."));
  }
  for (const m of svg.matchAll(/url\(\s*["']?([^)"']*)/g)) {
    const url = m[1] as string;
    if (!url.startsWith("#") && !url.startsWith("data:")) out.push(makeDiagnostic("E-S-EXTERNAL", `The SVG output contains url(${url.slice(0, 60)}), which is outside the file.`, "This is a Gertie bug. Report it."));
  }
  return out;
}
