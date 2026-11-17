// Browser stand-in for node:path. The compiler only uses posix.dirname, normalize and join.
function normalize(p: string): string {
  const abs = p.startsWith("/");
  const out: string[] = [];
  for (const part of p.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") { if (out.length && out[out.length - 1] !== "..") out.pop(); else if (!abs) out.push(".."); continue; }
    out.push(part);
  }
  return (abs ? "/" : "") + out.join("/") || (abs ? "/" : ".");
}
export const posix = {
  dirname(p: string): string { const i = p.lastIndexOf("/"); return i < 0 ? "." : i === 0 ? "/" : p.slice(0, i); },
  normalize,
  join(...parts: string[]): string { return normalize(parts.filter(Boolean).join("/")); },
};
