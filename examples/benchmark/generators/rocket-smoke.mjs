import { blob, curve, oval, rrect, P, S, G, save, fillEase, tally } from "./lib.mjs";
const D = 8, W = 810, H = 1080, GY = 880, IGN = 1.6, LIFT = 2.3;
const mx = (pts) => pts.map(([x, y, c]) => (c ? [-x, y, c] : [-x, y]));
const star = (id, x, y, r, t) => P(id, blob([[0, -r, 1], [r * 0.22, -r * 0.22], [r, 0, 1], [r * 0.22, r * 0.22], [0, r, 1], [-r * 0.22, r * 0.22], [-r, 0, 1], [-r * 0.22, -r * 0.22]], 0.1), "$yellow", { x, y,
  ...(t === undefined ? {} : { animate: { scale: [[0, [1, 1]], [t, [1, 1]], [t + 0.4, [0.3, 0.3]], [t + 0.9, [1.2, 1.2], "settle"], [t + 1.5, [1, 1], "gentle"], [D, [1, 1]]] } }) });
// a billow of smoke: eight points round a centre; the same eight points at three sizes give a morph
const billow = (r, seed, flat = 1) => blob(Array.from({ length: 8 }, (_, i) => {
  const a = (i / 8) * Math.PI * 2, k = 1 + 0.22 * Math.sin(seed * 3.1 + i * 2.4);
  return [Math.cos(a) * r * k * 1.15, Math.sin(a) * r * k * flat];
}), 0.2);
const smoke = (id, x, dx, r, i) => {
  const t = IGN + i * 0.07;
  return G(id, [
    P(`${id}-cloud`, billow(r * 0.35, i), "$smoke", { animate: { d: [[0, billow(r * 0.35, i)], [t, billow(r * 0.35, i)], [t + 0.9, billow(r, i + 0.6), "settle"], [t + 2.6, billow(r * 1.25, i + 1.3, 0.8), "gentle"], [D, billow(r * 1.4, i + 2, 0.7), "gentle"]] } }),
    P(`${id}-shade`, blob([[-r * 0.5, r * 0.3], [0, r * 0.12], [r * 0.6, r * 0.3], [r * 0.5, r * 0.62], [0, r * 0.74], [-r * 0.5, r * 0.6]], 0.2), "$smoke-shade", { opacity: 0.7 }),
  ], { x, y: GY - 16, from: t, opacity: 0,
    animate: {
      x: [[t + 1 / 30, x], [t + 1.3, x + dx, "settle"], [D, x + dx * 1.5, "gentle"]],
      opacity: [[t, 0], [t + 0.16, 0.96, "settle"], [4.6 + i * 0.12, 0.9], [6.5, 0.25, "gentle"], [D, 0.25]],
      scale: [[t + 2 / 30, [0.4, 0.4]], [t + 1.0, [1, 1], "settle"], [D, [1.12, 1.05], "gentle"]],
    } });
};
const trail = (id, y, t, r) => P(id, billow(r, y), "$smoke", { x: 405 + (GY - y) * 0.02, y, from: t, to: t + 2, opacity: 0,
  animate: { opacity: [[t, 0], [t + 0.14, 0.8, "settle"], [t + 2, 0, "gentle"]], scale: [[t + 1 / 30, [0.5, 0.5]], [t + 2, [1.7, 1.7], "settle"]] } });
const tree = (id, x, s, t, lean) => G(id, [
  P(`${id}-trunk`, rrect(x - 5 * s, GY - 44 * s, 10 * s, 50 * s, 4), "$ink"),
  P(`${id}-crown`, blob([[x, GY - 150 * s, 1], [x + 22 * s, GY - 104 * s], [x + 40 * s, GY - 58 * s], [x + 30 * s, GY - 38 * s], [x, GY - 34 * s], [x - 30 * s, GY - 38 * s], [x - 40 * s, GY - 58 * s], [x - 22 * s, GY - 104 * s]], 0.14), "$tree"),
  P(`${id}-shade`, blob([[x + 4 * s, GY - 140 * s], [x + 22 * s, GY - 104 * s], [x + 40 * s, GY - 58 * s], [x + 30 * s, GY - 38 * s], [x + 6 * s, GY - 36 * s], [x + 14 * s, GY - 70 * s]], 0.14), "$ink", { opacity: 0.3 }),
], { pivot: [x, GY], animate: { rotation: [[0, 0], [t, 0], [t + 0.3, lean, "snap"], [t + 1.0, -lean * 0.3], [D, 0, "gentle"]] } });
const brace = (i) => S(`brace-${i}`, `M 268 ${500 + i * 76} L 300 ${538 + i * 76} L 332 ${576 + i * 76} M 332 ${500 + i * 76} L 300 ${538 + i * 76} L 268 ${576 + i * 76}`, "$steel-dark", 5);
const booster = (s, f) => [
  P(`booster-${s}`, rrect(f * 66 - 14, -176, 28, 150, 12), "$hull-shade"),
  P(`booster-${s}-nose`, blob([[f * 66, -206, 1], [f * 66 + 12, -182], [f * 66 + 14, -160], [f * 66, -156], [f * 66 - 14, -160], [f * 66 - 12, -182]], 0.18), "$red"),
  P(`booster-${s}-nozzle`, blob([[f * 66 - 9, -28], [f * 66 + 9, -28], [f * 66 + 13, -10], [f * 66 + 10, -6], [f * 66 - 10, -6], [f * 66 - 13, -10]], 0.12), "$steel-dark"),
];
const fA = [[-26, 0], [-36, 52], [-18, 116], [0, 178], [18, 116], [36, 52], [26, 0]], fB = [[-26, 0], [-42, 44], [-12, 98], [6, 146], [24, 104], [32, 46], [26, 0]], fC = [[-26, 0], [-32, 58], [-22, 108], [-4, 164], [14, 122], [40, 50], [26, 0]];
const iA = [[-14, 0], [-18, 36], [-8, 78], [0, 116], [8, 78], [18, 36], [14, 0]], iB = [[-14, 0], [-22, 30], [-4, 66], [4, 96], [12, 70], [16, 32], [14, 0]];
// a flame flickers by morphing between shapes with the same seven points. The loop starts at 0 and fills the scene, so the morph has no
// hold segment and the SVG keeps it as one native animation; the node's own "from" hides it until ignition.
const flick = (shapes, period) => ({ keys: shapes.map((s, i) => [(i * period) / (shapes.length - 1), blob(s, 0.2), "gentle"]).map((k, i) => (i === 0 ? [k[0], k[1]] : k)), repeat: "loop" });
const sideFlame = (s, f) => P(`flame-${s}`, blob([[f * 66 - 9, -6], [f * 66 - 13, 26], [f * 66, 74], [f * 66 + 13, 26], [f * 66 + 9, -6]], 0.2), "$orange");
const nodes = fillEase([
  { id: "sky", type: "rect", w: W, h: 900, x: W / 2, y: 450, fill: { type: "linear", from: [0, -450], to: [0, 450], stops: [[0, "#0d1330"], [0.55, "#27336b"], [1, "#9d94cf"]] } },
  { id: "moon-glow", type: "ellipse", r: 150, x: 640, y: 170, fill: { type: "radial", center: [0, 0], radius: 150, stops: [[0, "#dfe6f555"], [0.5, "#dfe6f522"], [1, "#dfe6f500"]] },
    animate: { scale: [[0, [1, 1]], [3.5, [1.08, 1.08], "gentle"], [D, [1, 1], "gentle"]] } },
  G("moon", [P("moon-disc", oval(640, 170, 58), "$smoke"), P("crater-a", oval(620, 152, 14, 12), "$smoke-shade"), P("crater-b", oval(662, 186, 10, 9), "$smoke-shade"), P("crater-c", oval(632, 200, 7, 6), "$smoke-shade"),
    P("moon-shade", blob([[672, 122], [694, 150], [698, 184], [682, 214], [656, 228], [676, 196], [682, 160]], 0.2), "$smoke-shade", { opacity: 0.5 })]),
  star("star-a", 90, 110, 10, 0.5), star("star-b", 230, 60, 7), star("star-c", 330, 190, 8), star("star-d", 470, 90, 6), star("star-e", 740, 60, 8, 1.4), star("star-f", 760, 330, 7), star("star-g", 130, 300, 6), star("star-h", 520, 300, 5),
  star("star-i", 60, 430, 5), star("star-j", 700, 470, 6, 5.2), star("star-k", 410, 420, 5), star("star-l", 250, 380, 6), star("star-m", 590, 420, 5), star("star-n", 30, 210, 6),
  P("cloud-a", blob([[40, 520], [110, 500], [200, 506], [280, 496], [330, 512], [250, 526], [120, 528]], 0.2), "$mount-far", { opacity: 0.7, animate: { x: [[0, 0], [0.3, 0], [D, 40, "gentle"]] } }),
  P("cloud-b", blob([[500, 590], [570, 574], [660, 580], [740, 568], [790, 584], [700, 598], [570, 600]], 0.2), "$mount-far", { opacity: 0.6, animate: { x: [[0, 0], [0.7, 0], [D, -34, "gentle"]] } }),
  G("mountains", [
    P("mount-a", blob([[-20, GY, 1], [60, 760], [150, 660, 1], [230, 740], [300, 700], [380, GY, 1]], 0.12), "$mount-far"),
    P("mount-b", blob([[330, GY, 1], [450, 720], [560, 620, 1], [660, 720], [740, 690], [830, GY, 1]], 0.12), "$mount-far"),
    P("snow-a", blob([[150, 660, 1], [176, 688], [162, 700], [150, 690], [136, 704], [124, 690]], 0.1), "$hull"),
    P("snow-b", blob([[560, 620, 1], [592, 652], [576, 668], [560, 654], [542, 670], [528, 654]], 0.1), "$hull"),
    P("mount-c", blob([[-20, GY, 1], [-20, 800, 1], [70, 770], [160, 810], [250, 790], [340, GY, 1]], 0.14), "$mount-near"),
    P("mount-d", blob([[470, GY, 1], [570, 800], [660, 776], [750, 800], [830, 780, 1], [830, GY, 1]], 0.14), "$mount-near"),
  ]),
  G("ground", [
    P("ground-base", blob([[-20, GY - 6, 1], [200, GY - 12], [405, GY - 4], [620, GY - 12], [830, GY - 6, 1], [830, 1100, 1], [-20, 1100, 1]], 0.2), "$ground"),
    P("ground-shade", blob([[-20, 980, 1], [220, 960], [520, 978], [830, 956, 1], [830, 1100, 1], [-20, 1100, 1]], 0.2), "$ground-shade"),
    P("ground-path", blob([[330, GY + 6], [480, GY + 6], [560, 1090], [520, 1100], [300, 1100], [260, 1090]], 0.12), "$mount-near", { opacity: 0.6 }),
  ], { animate: { y: [[0, 0], [IGN + 0.04, 0], [IGN + 0.14, 3, "snap"], [IGN + 0.26, -2], [IGN + 0.42, 2], [LIFT + 0.4, 1, "gentle"], [LIFT + 1.2, 0, "settle"], [D, 0]] } }),
  tree("tree-a", 60, 1.0, IGN + 0.5, -7), tree("tree-b", 132, 0.74, IGN + 0.4, -6), tree("tree-c", 706, 0.8, IGN + 0.46, 6), tree("tree-d", 770, 1.05, IGN + 0.56, 8),
  G("bunker", [
    P("bunker-body", rrect(588, GY - 70, 132, 76, 10), "$steel-dark"), P("bunker-roof", rrect(578, GY - 84, 152, 22, 8), "$steel"),
    P("bunker-window", rrect(606, GY - 52, 54, 22, 6), "$yellow", { animate: { fill: [[0, "$yellow"], [IGN - 0.3, "$yellow"], [IGN - 0.1, "$orange", "snap"], [LIFT + 2, "$orange"], [LIFT + 2.5, "$yellow"], [D, "$yellow"]] } }),
    P("bunker-door", rrect(676, GY - 50, 28, 54, 6), "$ink"),
    P("bunker-shade", blob([[700, GY - 68, 1], [714, GY - 68], [720, GY - 60], [720, GY + 6, 1], [694, GY + 6, 1], [698, GY - 30]], 0.1), "$ink", { opacity: 0.25 }),
    S("dish-mast", "M 700 796 L 700 780 L 700 762", "$steel", 6),
    G("dish", [P("dish-bowl", blob([[676, 746], [688, 762], [706, 768], [724, 760], [730, 744], [712, 754], [694, 754]], 0.2), "$hull-shade")], { pivot: [702, 762],
      animate: { rotation: [[0, -30], [LIFT + 0.2, -30], [5.2, 34, "smooth"], [D, 40, "gentle"]] } }),
  ]),
  G("tanks", [
    P("tank-a", rrect(196, GY - 96, 46, 100, 16), "$hull-shade"), P("tank-a-band", rrect(196, GY - 60, 46, 12, 4), "$red"), P("tank-a-shade", blob([[226, GY - 92], [240, GY - 80], [242, GY - 10], [234, GY + 2], [222, GY + 2], [228, GY - 40]], 0.14), "$steel", { opacity: 0.6 }),
    P("tank-b", rrect(146, GY - 70, 40, 74, 14), "$hull-shade"), P("tank-b-band", rrect(146, GY - 44, 40, 10, 4), "$red"),
    P("tank-b-shade", blob([[172, GY - 66], [184, GY - 56], [186, GY - 8], [180, GY + 2], [168, GY + 2], [174, GY - 30]], 0.14), "$steel", { opacity: 0.6 }),
    S("tank-pipe", curve([[242, GY - 30], [256, GY - 30], [262, GY - 18], [262, GY - 2]], 0.3), "$steel", 6),
  ]),
  G("pad", [
    P("pad-leg-l", blob([[268, GY - 8, 1], [296, GY - 8, 1], [290, GY + 10], [262, GY + 10]], 0.1), "$ink"), P("pad-leg-r", blob([[514, GY - 8, 1], [542, GY - 8, 1], [548, GY + 10], [520, GY + 10]], 0.1), "$ink"),
    P("pad-deck", rrect(246, GY - 30, 318, 26, 8), "$steel"), P("pad-base", blob([[262, GY - 6, 1], [548, GY - 6, 1], [572, GY + 16], [560, GY + 22], [250, GY + 22], [238, GY + 16]], 0.1), "$steel-dark"),
    ...[0, 1, 2, 3].map((i) => P(`hazard-${i}`, blob([[270 + i * 74, GY - 28, 1], [296 + i * 74, GY - 28, 1], [282 + i * 74, GY - 8, 1], [256 + i * 74, GY - 8, 1]], 0), "$yellow")),
  ]),
  G("tower", [
    P("rail-l", rrect(262, 486, 12, GY - 512, 5), "$steel"), P("rail-r", rrect(326, 486, 12, GY - 512, 5), "$steel"),
    ...[0, 1, 2, 3].map(brace),
    ...[0, 1, 2, 3, 4].map((i) => P(`bar-${i}`, rrect(262, 494 + i * 76, 76, 9, 4), "$steel-dark")),
    P("tower-top", blob([[258, 488, 1], [342, 488, 1], [334, 470], [312, 456], [288, 456], [266, 470]], 0.14), "$steel-dark"),
    S("cable-a", curve([[262, 500], [226, 680], [200, GY - 10]], 0.2), "$steel-dark", 3), S("cable-b", curve([[266, 640], [246, 770], [232, GY - 8]], 0.2), "$steel-dark", 3),
    S("tower-mast", "M 300 456 L 300 436 L 300 416", "$steel", 5),
    P("tower-lamp", oval(300, 410, 8), "$red", { animate: { opacity: { keys: [[0, 1], [0.6, 0.2, "snap"], [1.6, 1, "settle"]], repeat: "loop" } } }),
    G("arm", [P("arm-beam", rrect(332, 590, 62, 12, 6), "$steel"), P("arm-clamp", blob([[386, 580], [400, 584], [402, 596], [400, 608], [386, 612], [392, 596]], 0.2), "$red")], { pivot: [334, 596],
      animate: { rotation: [[0, 0], [0.9, 0], [1.0, 5], { t: 1.5, v: -72, ease: "snap", overshoot: { past: 0.06, back: 0.02, time: 0.3 } }, [D, -72]] } }),
  ]),
  P("steam-a", billow(16, 1), "$smoke", { x: 360, y: GY - 34, from: 0.2, to: IGN + 0.2, opacity: 0, animate: { opacity: [[0.2, 0], [0.5, 0.7, "settle"], [IGN + 0.2, 0, "gentle"]], x: [[0.2 + 1 / 30, 360], [IGN + 0.2, 316, "gentle"]], scale: [[0.3, [0.5, 0.5]], [IGN + 0.2, [1.5, 1.5], "settle"]] } }),
  trail("trail-a", 680, 3.56, 34), trail("trail-b", 470, 4.06, 28),
  G("rocket", [
    G("flames", [
      sideFlame("l", -1), sideFlame("r", 1),
      P("flame-outer", blob(fA, 0.2), { type: "linear", from: [0, 0], to: [0, 170], stops: [[0, "#ffd75e"], [0.5, "#ff9a3c"], [1, "#e5484d00"]] }, { animate: { d: flick([fA, fB, fC, fA], 1.6) } }),
      P("flame-inner", blob(iB, 0.2), "$yellow", { animate: { d: flick([iB, iA, iB], 1) } }),
      P("flame-core", blob([[-7, 0], [-8, 20], [0, 54], [8, 20], [7, 0]], 0.2), "$hull"),
    ], { from: IGN, pivot: [0, -6],
      animate: { scale: [[IGN, [0.6, 0.1]], [IGN + 0.2, [1.1, 0.7], "snap"], [LIFT, [1, 0.8], "gentle"], [LIFT + 0.5, [1, 1.25], "smooth"], [5.2, [0.9, 1.5], "gentle"]] } }),
    G("hull", [
      P("fin-l", blob([[-44, -112], [-64, -84], [-82, -48], [-86, -6], [-60, -22], [-44, -42]], 0.16), "$red"),
      P("fin-r", blob(mx([[-44, -112], [-64, -84], [-82, -48], [-86, -6], [-60, -22], [-44, -42]]), 0.16), "$red-shade"),
      ...booster("l", -1), ...booster("r", 1),
      P("nozzle", blob([[-22, -20], [22, -20], [30, -4], [26, 0], [-26, 0], [-30, -4]], 0.12), "$steel-dark"),
      P("body", blob([[0, -330], [26, -300], [42, -250], [46, -180], [46, -40], [36, -18], [-36, -18], [-46, -40], [-46, -180], [-42, -250], [-26, -300]], 0.16), "$hull"),
      P("body-shade", blob([[16, -314], [40, -252], [46, -180], [46, -40], [36, -18], [8, -18], [20, -60], [22, -180], [14, -262]], 0.16), "$hull-shade"),
      P("nose", blob([[0, -334], [24, -304], [39, -262], [0, -252], [-39, -262], [-24, -304]], 0.16), "$red"),
      P("nose-shade", blob([[6, -328], [24, -304], [39, -262], [14, -254], [18, -290]], 0.16), "$red-shade"),
      P("stripe", blob([[-46, -122], [0, -112], [46, -122], [46, -100], [0, -90], [-46, -100]], 0.12), "$red"),
      P("fin-c", rrect(-5, -92, 10, 80, 5), "$red-shade"),
      P("port-ring", oval(0, -200, 25), "$steel"), P("port-glass", oval(0, -200, 17), "$glass"),
      P("port-glint", blob([[-10, -204], [-6, -212], [2, -214], [-3, -208], [-7, -200]], 0.2), "$hull"),
      S("panel-a", curve([[-44, -156], [-20, -150], [0, -148]], 0.2), "$hull-shade", 4), S("panel-b", curve([[-40, -246], [-18, -240], [0, -238]], 0.2), "$hull-shade", 4),
    ]),
  ], { x: 405, y: GY - 30,
    animate: {
      y: [[0, GY - 30], [LIFT, GY - 30], [LIFT + 0.3, GY - 36, "gentle"], [5.3, -320, "easeInCubic"], [D, -320]],
      x: [[0, 405], [IGN + 0.1, 405], [IGN + 0.2, 408, "snap"], [IGN + 0.34, 402], [IGN + 0.5, 407], [LIFT + 0.4, 405, "gentle"], [5.3, 440, "easeInCubic"], [D, 440]],
      rotation: [[0, 0], [LIFT + 0.6, 0], [5.3, 4, "easeInCubic"], [D, 4]],
    } }),
  smoke("smoke-a", 300, -150, 86, 0), smoke("smoke-b", 510, 150, 92, 1), smoke("smoke-c", 360, -70, 70, 2), smoke("smoke-d", 452, 74, 74, 3),
], "smooth");
console.error(tally(nodes));
save({
  gertie: 1, name: "rocket-smoke", canvas: { w: W, h: H, background: "#0d1330" }, duration: D, loop: false, tier: "scene", poster: 3,
  palette: { ink: "#121a30", yellow: "#ffd75e", orange: "#ff9a3c", smoke: "#e6e9f2", "smoke-shade": "#b8bfd2", "mount-far": "#39457a", "mount-near": "#2c3963", ground: "#23304f", "ground-shade": "#1a2440",
    steel: "#8a93ad", "steel-dark": "#5b6480", hull: "#f6f8fc", "hull-shade": "#cfd6e6", red: "#e5484d", "red-shade": "#b8343b", glass: "#6ec5f0", tree: "#1f5a52" },
  nodes,
});
