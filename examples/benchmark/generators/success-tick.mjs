import { blob, oval, P, S, G, save, fillEase } from "./lib.mjs";
const c = 256, D = 3;
// a tapered petal pointing away from the centre, between radius r0 and r1
const spark = (id, ang, r0, r1, fill) => {
  const a = (ang * Math.PI) / 180, ux = Math.sin(a), uy = -Math.cos(a), px = -uy, py = ux, w = 7;
  const m = (r0 + r1) / 2;
  return P(id, blob([[ux * r0, uy * r0], [ux * m + px * w, uy * m + py * w], [ux * r1, uy * r1], [ux * m - px * w, uy * m - py * w]], 0.2), fill);
};
const burst = (id, list, at, fill) => G(id, list.map(([ang, r0, r1], i) => spark(`${id}-${i + 1}`, ang, r0, r1, fill)), { x: c, y: c, opacity: 0,
  animate: {
    scale: [[0, [0.72, 0.72]], [at, [0.72, 0.72]], [at + 0.3, [1, 1], "settle"], [at + 0.75, [1.1, 1.1], "smooth"], [D, [0.72, 0.72]]],
    opacity: [[0, 0], [at, 0], [at + 0.14, 1, "settle"], [at + 0.4, 1], [at + 0.75, 0, "smooth"], [D, 0]],
  } });
save({
  gertie: 1, name: "success-tick", canvas: { w: 512, h: 512 }, duration: D, tier: "icon", poster: 1.5,
  palette: { track: "#dbe3ec", green: "#22c55e", shade: "#15994a", tint: "#9be8b6", white: "#ffffff" },
  nodes: fillEase([
    S("track", oval(c, c, 150), "$track", 14),
    S("ring", oval(c, c, 150), "$green", 14, {
      trim: { start: 0, end: 0 },
      animate: { "trim.end": [[0, 0], [0.2, 0], [0.8, 1, "smooth"], [2.2, 1], [2.75, 0, "smooth"], [D, 0]] },
    }),
    G("badge", [
      P("disc", oval(0, 0, 118), "$track", { animate: { fill: [[0, "$track"], [0.32, "$track"], [0.58, "$green", "smooth"], [2.25, "$green"], [2.65, "$track", "smooth"], [D, "$track"]] } }),
      G("shading", [
        P("disc-shade", blob([[-104, 56], [-40, 96], [40, 96], [104, 56], [70, 96], [0, 118], [-70, 96]], 0.2), "$shade"),
        P("disc-shine", blob([[-88, -40], [-60, -82], [-14, -104], [-30, -84], [-66, -52], [-80, -22]], 0.2), "$tint"),
      ], { opacity: 0, animate: { opacity: [[0, 0], [0.4, 0], [0.66, 1, "smooth"], [2.2, 1], [2.55, 0, "smooth"], [D, 0]] } }),
    ], { x: c, y: c,
      animate: { scale: [[0, [1, 1]], [0.12, [1, 1]], [0.32, [0.9, 0.9], "smooth"],
        { t: 0.58, v: [1, 1], ease: "settle", overshoot: { past: 0.9, back: 0.25, time: 0.36 } },
        [1.4, [1, 1]], [1.75, [1.035, 1.035], "smooth"], [2.1, [1, 1], "smooth"], [D, [1, 1]]] } }),
    S("tick", "M 198 260 L 240 302 L 318 216", "$white", 26, {
      trim: { start: 0, end: 0 }, pivot: [256, 262],
      animate: {
        "trim.end": [[0, 0], [0.58, 0], [0.94, 1, "settle"], [2.2, 1], [2.5, 0, "smooth"], [D, 0]],
        scale: [[0, [1, 1]], [0.8, [1, 1]], [0.96, [1.12, 1.12], "settle"], [1.16, [1, 1], "smooth"], [D, [1, 1]]],
      } }),
    burst("sparks-a", [[0, 180, 218], [128, 180, 212], [232, 180, 216]], 0.7, "$green"),
    burst("sparks-b", [[52, 182, 208], [180, 182, 206], [308, 182, 210]], 0.8, "$tint"),
  ], "smooth"),
});
