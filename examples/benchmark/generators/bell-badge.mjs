import { blob, curve, oval, rrect, P, S, G, save, fillEase } from "./lib.mjs";
const D = 3, sw = "easeInOutSine";
const arcs = (id, pts1, pts2, at) => G(id, [S(`${id}-near`, curve(pts1, 0.25), "$shade", 11), S(`${id}-far`, curve(pts2, 0.25), "$tint", 11)], {
  pivot: [256, 260], opacity: 0,
  animate: {
    opacity: [[0, 0], [at, 0], [at + 0.15, 1, "settle"], [at + 0.7, 1], [at + 1.05, 0], [D, 0]],
    scale: [[0, [0.86, 0.86]], [at, [0.86, 0.86]], [at + 0.3, [1, 1], "settle"], [at + 1.05, [1.08, 1.08]], [D, [0.86, 0.86]]],
  } });
save({
  gertie: 1, name: "bell-badge", canvas: { w: 512, h: 512 }, duration: D, tier: "icon", poster: 1.2,
  palette: { gold: "#f6b521", shade: "#cf8a0b", tint: "#ffe29a", red: "#ef4444", white: "#ffffff" },
  nodes: fillEase([
    arcs("ring-l", [[100, 214], [86, 262], [100, 310]], [[62, 194], [40, 262], [62, 330]], 0.5),
    arcs("ring-r", [[412, 244], [424, 280], [412, 316]], [[448, 226], [468, 280], [448, 334]], 0.62),
    G("bell", [
      G("clapper", [P("clapper-ball", oval(256, 408, 26), "$shade")], { pivot: [256, 330], follow: { delay: 0.1, scale: 1.7 } }),
      P("bell-loop", oval(256, 122, 20), "$shade"),
      P("bell-body", blob([[256, 130], [304, 150], [330, 214], [338, 286], [356, 338], [386, 368, 1], [126, 368, 1], [156, 338], [174, 286], [182, 214], [208, 150]], 0.2), "$gold"),
      P("bell-shade", blob([[296, 150], [326, 214], [334, 286], [352, 338], [380, 366, 1], [318, 366, 1], [316, 300], [308, 220]], 0.2), "$shade", { opacity: 0.55 }),
      P("bell-shine", blob([[204, 176], [214, 170], [208, 230], [198, 292], [186, 292], [190, 230]], 0.2), "$tint"),
      P("bell-rim", rrect(112, 356, 288, 32, 16), "$shade"),
      P("rim-shine", rrect(132, 362, 96, 9, 4.5), "$tint"),
    ], { pivot: [256, 112],
      animate: { rotation: [[0.24, 0], [0.36, 3], [0.52, -15], [0.72, 12], [0.92, -9], [1.12, 6], [1.32, -3], [1.6, 0]] } }),
    G("badge", [
      P("badge-disc", oval(0, 0, 46), "$red", { stroke: { color: "$white", width: 9 } }),
      S("badge-one", "M -11 -10 L 3 -20 L 3 22", "$white", 11),
    ], { x: 356, y: 166,
      animate: { scale: [[0, [0, 0]], [0.62, [0, 0]], { t: 0.86, v: [1, 1], ease: "settle", overshoot: { past: 0.2, back: 0.06, time: 0.4 } },
        [1.9, [1, 1]], [2.2, [1.08, 1.08]], [2.5, [1, 1]], [2.62, [1.1, 1.1], "settle"], [2.86, [0, 0]], [D, [0, 0]]] } }),
  ], sw),
});
