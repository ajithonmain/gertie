import { blob, oval, P, G, save, fillEase } from "./lib.mjs";
const D = 2.2, floor = 356, r = 46, H = 120;
const sq = [1.13, 0.86], st = [0.92, 1.1];
const dot = (i, x, o) => {
  const first = o === 0 ? [] : [[o, floor]];
  const firstS = o === 0 ? [] : [[o, [1, 1]]];
  return [
    { id: `shadow-${i}`, type: "ellipse", rx: 44, ry: 9, x, y: floor + 6, fill: "$ink", opacity: 0.22,
      animate: { scale: [[0, [1, 1]], [o + 0.16, [1.12, 1]], [o + 0.52, [0.5, 0.5], "easeOutQuad"], [o + 0.88, [1.14, 1], "easeInQuad"], [D, [1, 1]]] } },
    G(`dot-${i}`, [
      P(`dot-${i}-body`, oval(0, -r, r), "$base"),
      P(`dot-${i}-shade`, blob([[-36, -18], [-12, -4], [18, -6], [40, -26], [45, -52], [36, -30], [14, -16], [-14, -14]], 0.2), "$shade"),
      P(`dot-${i}-shine`, blob([[-28, -64], [-16, -78], [0, -82], [-12, -72], [-22, -58]], 0.2), "$tint"),
    ], { x, y: floor,
      animate: {
        y: [[0, floor], ...first, [o + 0.16, floor], [o + 0.52, floor - H, "easeOutQuad"], [o + 0.88, floor, "easeInQuad"], [D, floor]],
        scale: [[0, [1, 1]], ...firstS, [o + 0.16, sq], [o + 0.32, st], [o + 0.96, sq, "easeInQuad"], [o + 1.2, [1, 1]], [D, [1, 1]]],
      } }),
  ];
};
save({
  gertie: 1, name: "dot-loader", canvas: { w: 512, h: 512 }, duration: D, tier: "icon",
  palette: { base: "#6366f1", shade: "#4338ca", tint: "#c7d2fe", ink: "#1e1b4b" },
  nodes: fillEase([...dot(1, 136, 0), ...dot(2, 256, 0.3), ...dot(3, 376, 0.6)], "smooth"),
});
