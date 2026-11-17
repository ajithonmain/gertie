import { blob, curve, oval, rrect, P, S, G, save, fillEase, tally } from "./lib.mjs";
const D = 8, W = 1080, H = 810, GY = 600;
let lit = 0;
// one building: body, a shaded side, a parapet, and a grid of windows. Every third window changes during the loop.
const building = (id, x, w, top, fill, cols, rows, extra = []) => {
  const gap = (w - cols * 34) / (cols + 1), wins = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const n = r * cols + c, wx = x + gap + c * (34 + gap), wy = top + 42 + r * 74;
    const on = (n * 7 + id.length + r) % 5 < 2, warm = n % 2 === 0 ? "$win-on" : "$win-warm";
    let animate;
    if ((n + id.charCodeAt(1)) % 3 === 0) {
      const t = 0.5 + ((lit * 0.47) % 3.4) + (lit % 2) * 0.1, t2 = Math.min(t + 3 + ((lit * 0.31) % 1.2), 7.3);
      animate = { fill: on ? [[0, warm], [t, warm], [t + 0.3, "$win-off"], [t2, "$win-off"], [t2 + 0.2, warm, "settle"], [D, warm]] : [[0, "$win-off"], [t, "$win-off"], [t + 0.2, warm, "settle"], [t2, warm], [t2 + 0.3, "$win-off"], [D, "$win-off"]] };
      lit++;
    }
    wins.push(P(`${id}-w${r}${c}`, rrect(wx, wy, 34, 44, 5), on ? warm : "$win-off", animate ? { animate } : {}));
  }
  return G(id, [
    P(`${id}-body`, rrect(x, top, w, GY - top + 8, 6), fill),
    P(`${id}-side`, blob([[x + w * 0.8, top + 2, 1], [x + w - 4, top + 2], [x + w, top + 8], [x + w, GY + 8, 1], [x + w * 0.74, GY + 8, 1], [x + w * 0.78, (top + GY) / 2]], 0.1), "$ink", { opacity: 0.22 }),
    P(`${id}-cap`, rrect(x - 6, top - 10, w + 12, 18, 5), "$shade"),
    ...wins, ...extra,
  ]);
};
const far = (i, x, w, top, step) => P(`far-${i}`, blob([[x, GY, 1], [x, top + step, 1], [x + w * 0.3, top + step, 1], [x + w * 0.3, top, 1], [x + w * 0.75, top, 1], [x + w * 0.75, top + step * 0.5, 1], [x + w, top + step * 0.5, 1], [x + w, GY, 1]], 0), "$far");
const star = (id, x, y, r, t) => P(id, blob([[0, -r, 1], [r * 0.22, -r * 0.22], [r, 0, 1], [r * 0.22, r * 0.22], [0, r, 1], [-r * 0.22, r * 0.22], [-r, 0, 1], [-r * 0.22, -r * 0.22]], 0.1), "$cream", { x, y,
  animate: { scale: [[0, [1, 1]], [t, [1, 1]], [t + 0.4, [0.3, 0.3]], [t + 0.9, [1.2, 1.2], "settle"], [t + 1.5, [1, 1], "gentle"], [D, [1, 1]]] } });
const lamp = (id, x, t) => [
  P(`${id}-cone`, blob([[x + 30, 410, 1], [x + 62, 410, 1], [x + 150, GY + 30], [x + 46, GY + 44], [x - 58, GY + 30]], 0.12), { type: "linear", from: [x + 46, 410], to: [x + 46, GY + 40], stops: [[0, "#fff1c2aa"], [0.5, "#fff1c244"], [1, "#fff1c200"]] }, { opacity: 0,
    animate: { opacity: [[0, 0], [t, 0], [t + 0.1, 0.9, "snap"], [t + 0.2, 0.25], [t + 0.36, 1, "settle"], [7.2 + (t - 1) * 0.3, 1], [7.5 + (t - 1) * 0.3, 0], [D, 0]] } }),
  P(`${id}-pole`, rrect(x - 5, 412, 10, GY - 404, 5), "$ink"),
  S(`${id}-arm`, curve([[x, 418], [x + 10, 396], [x + 44, 392]], 0.25), "$ink", 8),
  P(`${id}-head`, blob([[x + 28, 392], [x + 64, 392], [x + 72, 402], [x + 62, 412], [x + 30, 412], [x + 20, 402]], 0.2), "$win-off",
    { animate: { fill: [[0, "$win-off"], [t - 1 / 30, "$win-off"], [t + 0.12, "$cream", "snap"], [7.2 + (t - 1) * 0.3, "$cream"], [7.46 + (t - 1) * 0.3, "$win-off"], [D, "$win-off"]] } }),
];
const tree = (id, x, ph) => G(id, [
  P(`${id}-trunk`, rrect(x - 7, 520, 14, 86, 5), "$ink"),
  G(`${id}-top`, [
    P(`${id}-crown`, blob([[x, 430], [x + 40, 440], [x + 56, 486], [x + 40, 530], [x, 544], [x - 40, 530], [x - 56, 486], [x - 40, 440]], 0.2), "$tree"),
    P(`${id}-shade`, blob([[x + 30, 446], [x + 54, 486], [x + 40, 528], [x, 542], [x - 30, 532], [x + 6, 516], [x + 28, 486]], 0.2), "$tree-shade"),
  ], { pivot: [x, 540], motion: [{ preset: "sway", angle: 2.5, duration: D, repeat: "loop", phase: ph }] }),
]);
const wheel = (id, x) => G(id, [P(`${id}-tyre`, oval(x, -22, 22), "$ink"), P(`${id}-hub`, oval(x, -22, 10), "$stripe"), S(`${id}-spoke`, `M ${x - 8} -22 L ${x} -22 L ${x + 8} -22`, "$ink", 4)], {
  pivot: [x, -22], animate: { rotation: [[0, 0], [2.4, 0], [5.6, 1800, "linear"], [D, 1800]] } });
const tl = (id, y, fill, keys) => P(id, oval(636, y, 9), fill, { animate: { fill: keys } });
const nodes = fillEase([
  { id: "sky", type: "rect", w: W, h: 640, x: W / 2, y: 320, fill: { type: "linear", from: [0, -320], to: [0, 300], stops: [[0, "#241d4a"], [0.45, "#5d3f86"], [0.8, "#e87f6c"], [1, "#ffcf8a"]] } },
  { id: "sun-glow", type: "ellipse", rx: 420, ry: 240, x: 380, y: 610, fill: { type: "radial", center: [0, 0], radius: 420, stops: [[0, "#ffe7a8cc"], [0.5, "#ffb37a55"], [1, "#ff9a7a00"]] },
    animate: { opacity: [[0, 1], [4, 0.82, "gentle"], [D, 1, "gentle"]] } },
  star("star-a", 120, 90, 11, 0.4), star("star-b", 330, 60, 8, 2.1), star("star-c", 560, 110, 10, 3.7), star("star-d", 700, 50, 7, 1.2), star("star-e", 1000, 190, 9, 5.2), star("star-f", 220, 190, 6, 6.0),
  P("moon", blob([[872, 60], [912, 86], [918, 132], [884, 166], [842, 162], [876, 142], [890, 106]], 0.2), "$cream"),
  P("cloud-a", blob([[90, 300], [160, 284], [260, 290], [360, 280], [420, 296], [330, 308], [180, 310]], 0.2), "$win-off", { opacity: 0.55, animate: { x: [[0, 0], [0.3, 0], [4.2, 46, "gentle"], [D, 0, "gentle"]] } }),
  P("cloud-b", blob([[610, 236], [690, 222], [800, 228], [900, 216], [960, 232], [860, 244], [700, 246]], 0.2), "$neon", { opacity: 0.35, animate: { x: [[0, 0], [0.8, 0], [4.8, -38, "gentle"], [D, 0, "gentle"]] } }),
  G("skyline", [far(1, -20, 150, 330, 60), far(2, 150, 130, 270, 80), far(3, 300, 170, 360, 40), far(4, 520, 120, 250, 90), far(5, 700, 160, 340, 50), far(6, 900, 200, 290, 70)]),
  building("b1", 28, 200, 250, "$wall-a", 3, 3, [
    P("b1-door", rrect(108, 532, 44, 76, 6), "$shade"),
    P("tank", rrect(70, 188, 70, 46, 10), "$shade"), S("tank-legs", "M 80 234 L 80 242 M 105 234 L 105 242 M 130 234 L 130 242", "$ink", 6), P("tank-cap", blob([[66, 190], [84, 176], [105, 170], [126, 176], [144, 190]], 0.2), "$ink"),
  ]),
  building("b2", 240, 160, 330, "$wall-b", 2, 2, [
    P("b2-shop", rrect(258, 520, 124, 70, 6), "$win-warm", { animate: { fill: [[0, "$win-warm"], [3.3, "$win-warm"], [3.42, "$win-on", "snap"], [3.6, "$win-warm"], [D, "$win-warm"]] } }),
    P("b2-awning", blob([[250, 488, 1], [390, 488, 1], [398, 512], [374, 522], [350, 512], [326, 522], [302, 512], [278, 522], [254, 512], [242, 512]], 0.2), "$car"),
    P("chimney", rrect(350, 286, 26, 40, 4), "$shade"),
  ]),
  building("b3", 410, 240, 180, "$wall-c", 3, 4, [
    P("b3-door", rrect(506, 528, 48, 80, 6), "$ink"),
    S("mast", "M 530 170 L 530 130 L 530 92 M 516 124 L 530 124 L 544 124", "$ink", 6),
    P("beacon", oval(530, 88, 7), "$car", { animate: { opacity: { keys: [[0, 1], [0.5, 0.15, "snap"], [1.2, 0.15], [1.4, 1, "settle"], [2, 1]], repeat: "loop" } } }),
  ]),
  building("b4", 660, 160, 300, "$wall-a", 2, 2, [
    P("b4-door", rrect(766, 530, 40, 78, 6), "$shade"),
    G("neon", [P("neon-frame", rrect(676, 470, 82, 40, 12), "$ink"), S("neon-tube", curve([[690, 498], [704, 480], [718, 498], [732, 480], [746, 498]], 0.3), "$neon", 7)], {
      animate: { opacity: [[0, 1], [1.7, 1], [1.8, 0.3, "snap"], [1.9, 1], [2.0, 0.4, "snap"], [2.14, 1, "settle"], [5.9, 1], [6.0, 0.35, "snap"], [6.16, 1, "settle"], [D, 1]] } }),
    P("b4-window", rrect(676, 528, 76, 60, 6), "$win-on"),
  ]),
  building("b5", 830, 222, 230, "$wall-b", 3, 3, [
    P("b5-door", rrect(918, 530, 46, 78, 6), "$ink"),
    G("cat", [
      G("cat-tail", [S("cat-tail-line", curve([[962, 222], [990, 216], [1002, 190], [990, 168]], 0.3), "$ink", 9)], { pivot: [962, 222], motion: [{ preset: "sway", angle: 9, duration: 4, repeat: "loop", phase: 0.25 }] }),
      P("cat-body", blob([[920, 222], [918, 190], [934, 170], [956, 176], [968, 200], [968, 222]], 0.2), "$ink"),
      G("cat-head", [P("cat-face", blob([[914, 172], [914, 144], [924, 154], [938, 154], [948, 144], [948, 172], [931, 182]], 0.16), "$ink")], { pivot: [931, 178],
        animate: { rotation: [[0, 0], [2.7, 0], [3.0, -14, "snap"], [5.4, -12, "gentle"], [5.8, 0], [D, 0]] } }),
    ]),
  ]),
  P("sidewalk", rrect(-20, GY, 1120, 46, 8), "$sidewalk"),
  P("road", blob([[-20, 640, 1], [540, 638], [1100, 640, 1], [1100, 830, 1], [540, 830], [-20, 830, 1]], 0.1), "$road"),
  G("crossing", Array.from({ length: 5 }, (_, i) => P(`stripe-${i}`, rrect(604 + i * 44, 660, 24, 134, 6), "$stripe", { opacity: 0.85 }))),
  G("lane", Array.from({ length: 4 }, (_, i) => P(`lane-${i}`, rrect(30 + i * 150, 722, 84, 10, 5), "$stripe", { opacity: 0.6 }))),
  ...lamp("lamp-a", 120, 1.0), ...lamp("lamp-b", 470, 1.4), ...lamp("lamp-c", 890, 1.9),
  tree("tree-a", 322, 0.25), tree("tree-b", 800, 0.75),
  G("bench", [P("bench-seat", rrect(396, 566, 96, 12, 5), "$shade"), P("bench-back", rrect(400, 540, 88, 14, 5), "$shade"), S("bench-legs", "M 408 578 L 408 604 M 444 578 L 444 604 M 480 578 L 480 604", "$ink", 6)]),
  G("hydrant", [P("hydrant-body", rrect(1008, 566, 24, 40, 7), "$car"), P("hydrant-cap", blob([[1004, 568], [1010, 556], [1020, 550], [1030, 556], [1036, 568]], 0.2), "$car-shade"), P("hydrant-arm", rrect(1000, 578, 40, 10, 5), "$car-shade")]),
  G("signal", [
    P("signal-pole", rrect(631, 470, 10, 136, 5), "$ink"), P("signal-box", rrect(620, 396, 32, 84, 10), "$ink"),
    tl("signal-red", 414, "$car", [[0, "$car"], [2.0, "$car"], [2.12, "$shade", "snap"], [6.5, "$shade"], [6.62, "$car", "snap"], [D, "$car"]]),
    tl("signal-amber", 438, "$shade", [[0, "$shade"], [5.9, "$shade"], [6.02, "$win-warm", "snap"], [6.5 + 1 / 30, "$win-warm"], [6.66, "$shade", "snap"], [D, "$shade"]]),
    tl("signal-green", 462, "$shade", [[0, "$shade"], [2.0 + 2 / 30, "$shade"], [2.2, "$green", "snap"], [5.9 + 1 / 30, "$green"], [6.06, "$shade", "snap"], [D, "$shade"]]),
  ]),
  G("car", [
    P("car-beam", blob([[118, -52, 1], [330, -84], [350, -20], [330, -4], [118, -34, 1]], 0.12), { type: "linear", from: [118, -44], to: [340, -44], stops: [[0, "#fff1c2bb"], [0.5, "#fff1c255"], [1, "#fff1c200"]] }),
    P("car-body", blob([[-126, -30], [-122, -58], [-86, -66], [-58, -96], [28, -98], [66, -66], [112, -58], [126, -42], [124, -26, 1], [-124, -26, 1]], 0.18), "$car"),
    P("car-shade", blob([[-124, -44], [-40, -38], [60, -40], [126, -44], [124, -26, 1], [-124, -26, 1]], 0.15), "$car-shade"),
    P("car-window", blob([[-50, -68, 1], [-38, -88], [-4, -90], [22, -90], [48, -68, 1], [0, -68]], 0.12), "$stripe"),
    P("car-head", blob([[108, -56], [120, -54], [126, -44], [118, -40], [108, -44]], 0.2), "$cream"),
    P("car-tail", rrect(-128, -56, 10, 16, 4), "$win-warm"),
    wheel("car-wheel-rear", -72), wheel("car-wheel-front", 72),
  ], { x: -420, y: 772,
    animate: {
      x: [[0, -420], [2.4, -420], [5.6, 1500, "gentle"], [5.7, -420, "hold"], [D, -420]],
      y: [[0, 772], [3.3, 772], [3.42, 768, "snap"], [3.6, 773], [3.8, 772, "settle"], [D, 772]],
    } }),
], "smooth");
console.error(tally(nodes));
save({
  gertie: 1, name: "city-dusk", canvas: { w: W, h: H, background: "#241d4a" }, duration: D, tier: "scene", poster: 4,
  palette: { ink: "#17132e", far: "#4d3f7d", "wall-a": "#3a3066", "wall-b": "#46356f", "wall-c": "#302957", shade: "#262048", "win-off": "#63559a", "win-on": "#ffd77a", "win-warm": "#ffb35c",
    sidewalk: "#3d3462", road: "#231d3d", stripe: "#cfc6e8", cream: "#fff1c2", car: "#e2556b", "car-shade": "#b03a52", tree: "#2f6b5e", "tree-shade": "#23514a", neon: "#ff6fa8", green: "#5fd38d" },
  nodes,
});
