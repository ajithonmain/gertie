/** Red, green, blue as 0 to 255, alpha as 0 to 1. */
export type Rgba = [number, number, number, number];

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function isHexColor(s: string): boolean {
  return HEX.test(s);
}

export function parseHex(s: string): Rgba | null {
  const m = HEX.exec(s);
  if (!m) return null;
  let h = m[1] as string;
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
  const a = h.length === 8 ? n(6) / 255 : 1;
  return [n(0), n(2), n(4), a];
}
