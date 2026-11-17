import { blob, curve, oval, rrect, P, S, G, save, fillEase, scroll, tally } from "./lib.mjs";
const D = 8, W = 1080, H = 810;
const mx = (pts) => pts.map(([x, y, c]) => (c ? [-x, y, c] : [-x, y]));
const loop = (keys) => ({ keys, repeat: "loop" });
const cloud = (id, x, y, s, fill, shade) => [
  P(`${id}-shape`, blob([[x, y + 30 * s], [x + 24 * s, y - 6 * s], [x + 70 * s, y - 28 * s], [x + 116 * s, y - 8 * s], [x + 160 * s, y - 18 * s], [x + 198 * s, y + 12 * s], [x + 188 * s, y + 36 * s], [x + 12 * s, y + 38 * s]], 0.2), fill),
  P(`${id}-shade`, blob([[x + 8 * s, y + 28 * s], [x + 70 * s, y + 16 * s], [x + 130 * s, y + 24 * s], [x + 192 * s, y + 12 * s], [x + 188 * s, y + 36 * s], [x + 12 * s, y + 38 * s]], 0.2), shade),
  P(`${id}-shine`, blob([[x + 40 * s, y - 6 * s], [x + 56 * s, y - 18 * s], [x + 78 * s, y - 20 * s], [x + 62 * s, y - 10 * s], [x + 48 * s, y + 2 * s]], 0.2), "$white", { opacity: 0.7 }),
];
// a cloud layer: the listed clouds, repeated every `period` pixels `count` times
const layer = (id, period, count, list, fill, shade) => Array.from({ length: count }, (_, i) => list.flatMap(([x, y, s], j) => cloud(`${id}-${i}${j}`, x + i * period, y, s, fill, shade))).flat();
const env = [[0, -112], [70, -92], [104, -30], [92, 40], [50, 100], [22, 130], [-22, 130], [-50, 100], [-92, 40], [-104, -30], [-70, -92]];
const envD = blob(env, 0.18);
const side = [[-84, -84], [-58, -104], [-70, -30], [-60, 50], [-40, 112], [-62, 104], [-98, 40], [-110, -30]];
const balloon = (id, x, y, s, a, b, bob, sway, drift) => G(id, [
  P(`${id}-env`, envD, a),
  G(`${id}-gores`, [
    P(`${id}-gore-c`, blob([[-26, -116], [26, -116], [40, -30], [30, 60], [14, 134], [-14, 134], [-30, 60], [-40, -30]], 0.18), b),
    P(`${id}-gore-l`, blob(side, 0.18), b), P(`${id}-gore-r`, blob(mx(side), 0.18), b),
    P(`${id}-shade`, blob([[40, -116], [104, -80], [118, -20], [100, 50], [50, 110], [10, 136], [44, 60], [58, -20]], 0.18), "$ink", { opacity: 0.16 }),
  ], { clip: { type: "path", d: envD } }),
  P(`${id}-shine`, blob([[-70, -50], [-54, -80], [-30, -96], [-44, -72], [-58, -44], [-68, -22]], 0.2), "$white", { opacity: 0.45 }),
  P(`${id}-skirt`, blob([[-22, 128], [0, 132], [22, 128], [16, 146], [0, 148], [-16, 146]], 0.14), "$basket-dark"),
  S(`${id}-ropes`, "M -17 146 L -14 166 L -12 188 M 17 146 L 14 166 L 12 188", "$ink", 3),
  P(`${id}-basket`, rrect(-16, 186, 32, 26, 6), "$basket"),
  P(`${id}-band`, rrect(-18, 184, 36, 9, 4), "$basket-dark"),
], { x, y, scale: s, pivot: [0, 200], animate: { y: loop(bob), rotation: loop(sway), x: drift } });
const bird = (id, x, y, s, period) => S(id, curve([[-14, -3], [-7, -8], [0, 0], [7, -8], [14, -3]], 0.25), "$ink", 4, { x, y, scale: s, opacity: 0.8,
  animate: { scale: loop([[0, [s, s]], [period * 0.5, [s, -s * 0.5], "gentle"], [period, [s, s], "gentle"]]) } });
const tree = (i, x, y, s) => P(`pine-${i}`, blob([[x, y - 60 * s, 1], [x + 10 * s, y - 34 * s], [x + 20 * s, y - 8 * s], [x + 12 * s, y], [x, y + 2], [x - 12 * s, y], [x - 20 * s, y - 8 * s], [x - 10 * s, y - 34 * s]], 0.14), "$green-dark");
const star = (id, x, y, r, t) => P(id, blob([[0, -r, 1], [r * 0.22, -r * 0.22], [r, 0, 1], [r * 0.22, r * 0.22], [0, r, 1], [-r * 0.22, r * 0.22], [-r, 0, 1], [-r * 0.22, -r * 0.22]], 0.1), "$white", { x, y,
  animate: { scale: [[0, [1, 1]], [t, [1, 1]], [t + 0.4, [0.3, 0.3]], [t + 0.9, [1.25, 1.25], "settle"], [t + 1.5, [1, 1], "gentle"], [D, [1, 1]]] } });
// monoline letters on a baseline at y = 0; each is a white stroke over a soft shadow copy
const glyphs = {
  h: "M 0 -150 L 0 -75 L 0 0 M 96 -150 L 96 -75 L 96 0 M 0 -75 L 48 -75 L 96 -75",
  e: "M 6 -50 L 46 -50 L 86 -50 C 86 -112 6 -112 6 -48 C 6 10 66 12 84 -18",
  l: "M 0 -150 L 0 -75 L 0 0",
  o: oval(44, -48, 42, 48),
  bang: "M 0 -150 L 0 -100 L 0 -48",
};
const letter = (id, g, x, i) => {
  const a = 1.0 + i * 0.1, b = 5.0 + i * 0.1;
  const hop = (t, h) => [[t, 470], [t + 0.2, 470 - h, "settle"], [t + 0.44, 475], [t + 0.62, 470, "settle"]];
  const squash = (t) => [[t + 1 / 30, [1, 1]], [t + 0.2, [0.94, 1.08], "settle"], [t + 0.44, [1.06, 0.93]], [t + 0.64, [1, 1], "settle"]];
  return G(id, [
    S(`${id}-shadow`, glyphs[g], "$ink", 28, { x: 6, y: 8, opacity: 0.2 }),
    S(`${id}-stroke`, glyphs[g], "$white", 28),
    ...(g === "bang" ? [P("bang-dot", oval(0, -2, 15), "$white")] : []),
  ], { x, y: 470, animate: { y: [[0, 470], ...hop(a, 34), ...hop(b, 22), [D, 470]], scale: [[0, [1, 1]], ...squash(a), ...squash(b), [D, [1, 1]]] } });
};
const ray = (i) => {
  const a = (i / 8) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a), px = -s, py = c;
  return P(`ray-${i}`, blob([[c * 88, s * 88], [c * 110 + px * 9, s * 110 + py * 9], [c * 136, s * 136], [c * 110 - px * 9, s * 110 - py * 9]], 0.2), "$ray");
};
const nodes = fillEase([
  { id: "sky", type: "rect", w: W, h: H, x: W / 2, y: H / 2, fill: { type: "linear", from: [0, -405], to: [0, 405], stops: [[0, "#4aa8f0"], [0.6, "#9bd6fb"], [1, "#e4f6ff"]] } },
  { id: "sun-glow", type: "ellipse", r: 200, x: 180, y: 150, fill: { type: "radial", center: [0, 0], radius: 200, stops: [[0, "#fff3b0aa"], [0.5, "#fff3b033"], [1, "#fff3b000"]] },
    animate: { scale: [[0, [1, 1]], [4, [1.1, 1.1], "gentle"], [D, [1, 1], "gentle"]] } },
  G("sun-rays", Array.from({ length: 8 }, (_, i) => ray(i)), { x: 180, y: 150, animate: { rotation: [[0, -8], [4, 8, "gentle"], [D, -8, "gentle"]], scale: [[0, [1, 1]], [0.5, [1, 1]], [4.2, [1.08, 1.08], "gentle"], [D, [1, 1], "gentle"]] } }),
  P("sun-disc", oval(180, 150, 70), "$sun"),
  G("clouds-far", layer("far", 540, 3, [[40, 262, 0.5], [320, 318, 0.62]], "$cloud-far", "$cloud-shade"), { opacity: 0.85, animate: { x: scroll(-540, D) } }),
  balloon("balloon-c", 640, 150, 0.34, "$purple", "$pink", [[0, 150], [4, 138, "gentle"], [8, 150, "gentle"]], [[0, -2], [4, 2, "gentle"], [8, -2, "gentle"]], [[0, 640], [0.4, 640], [4.4, 668, "gentle"], [D, 640, "gentle"]]),
  G("clouds-mid", layer("mid", 1080, 2, [[70, 110, 0.9], [470, 214, 0.8], [800, 84, 1]], "$white", "$cloud-shade"), { animate: { x: scroll(-1080, D) } }),
  G("flock", [bird("bird-a", 0, 0, 1, 1.6), bird("bird-b", 44, 22, 0.8, 1), bird("bird-c", -40, 30, 0.7, 2), bird("bird-d", 86, -6, 0.6, 1.6), bird("bird-e", 20, 54, 0.6, 2)], { x: 760, y: 330,
    animate: { x: [[0, 760], [0.2, 760], [4, 700, "gentle"], [D, 760, "gentle"]], y: [[0, 330], [0.6, 330], [3, 306, "gentle"], [5.6, 338, "gentle"], [D, 330, "gentle"]] } }),
  balloon("balloon-b", 150, 420, 0.6, "$orange", "$teal", [[0, 420], [1, 408, "gentle"], [2, 420, "gentle"]], [[0, 2.5], [2, -2.5, "gentle"], [4, 2.5, "gentle"]], [[0, 150], [0.8, 150], [4.6, 176, "gentle"], [D, 150, "gentle"]]),
  balloon("balloon-a", 952, 300, 0.92, "$red", "$cream", [[0, 300], [2, 284, "gentle"], [4, 300, "gentle"]], [[0, -2], [4, 2, "gentle"], [8, -2, "gentle"]], [[0, 952], [1.2, 952], [5, 930, "gentle"], [D, 952, "gentle"]]),
  G("hills-far", [
    P("hill-a", blob([[-30, 830, 1], [-30, 700, 1], [120, 650], [300, 690], [470, 660], [640, 830, 1]], 0.18), "$green-far"),
    P("hill-b", blob([[460, 830, 1], [620, 690], [800, 640], [980, 680], [1110, 660, 1], [1110, 830, 1]], 0.18), "$green-far"),
  ]),
  G("clouds-near", layer("near", 1080, 3, [[60, 600, 1.3], [620, 640, 1.5]], "$white", "$cloud-shade"), { animate: { x: scroll(-2160, D) } }),
  G("hills-near", [
    P("hill-c", blob([[-30, 830, 1], [-30, 760, 1], [150, 720], [360, 752], [560, 730], [700, 830, 1]], 0.18), "$green"),
    P("hill-d", blob([[380, 830, 1], [560, 770], [760, 734], [960, 760], [1110, 740, 1], [1110, 830, 1]], 0.18), "$green"),
    P("hill-shade", blob([[-30, 800, 1], [260, 786], [560, 800], [860, 782], [1110, 796, 1], [1110, 830, 1], [-30, 830, 1]], 0.18), "$green-dark", { opacity: 0.5 }),
    tree(0, 110, 726, 1), tree(1, 160, 730, 0.7), tree(2, 760, 736, 1.1), tree(3, 820, 742, 0.8), tree(4, 960, 760, 0.9), tree(5, 430, 748, 0.7),
  ]),
  S("swash", curve([[300, 536], [420, 520], [540, 540], [660, 520], [780, 534]], 0.25), "$white", 12, { opacity: 0.85, trim: { start: 0, end: 1 },
    animate: { "trim.end": [[0, 1], [0.7, 1], [1.0, 0, "snap"], [2.0, 1, "settle"], [D, 1]] } }),
  letter("letter-h", "h", 294, 0), letter("letter-e", "e", 434, 1), letter("letter-l1", "l", 560, 2), letter("letter-l2", "l", 604, 3), letter("letter-o", "o", 648, 4), letter("letter-bang", "bang", 786, 5),
  star("spark-a", 250, 330, 14, 1.7), star("spark-b", 830, 520, 11, 2.6), star("spark-c", 560, 250, 9, 3.6), star("spark-d", 240, 548, 8, 5.8),
], "smooth");
console.error(tally(nodes));
save({
  gertie: 1, name: "sky-greeting", canvas: { w: W, h: H, background: "#4aa8f0" }, duration: D, tier: "scene", poster: 0,
  palette: { ink: "#27356b", white: "#ffffff", "cloud-shade": "#cfe6f8", "cloud-far": "#e3f3ff", sun: "#ffd75e", ray: "#ffe89a", "green-far": "#a4dcb4", green: "#6cc082", "green-dark": "#3f9a63",
    red: "#f0616d", cream: "#fff6dd", orange: "#ffa544", teal: "#36b3a8", purple: "#8a6ff0", pink: "#ff9cc2", basket: "#a56a3f", "basket-dark": "#7c4c2a" },
  nodes,
});
