import { blob, curve, oval, rrect, poly, P, S, G, save, fillEase, scroll, tally } from "./lib.mjs";
const D = 6, W = 1080, H = 810, HZ = 640;
const tF = 1.5, tR = tF + 325 / 360; // the bump reaches the front wheel, then the rear wheel
// ---------- scrolling street blocks, one house, one tree and one bush each; the pattern repeats every two blocks
const houseA = (i, ox) => [
  P(`a${i}-wall`, rrect(ox + 44, 474, 216, 170, 6), "$wall"),
  P(`a${i}-wall-shade`, blob([[ox + 44, 480, 1], [ox + 260, 480, 1], [ox + 260, 506], [ox + 150, 498], [ox + 44, 506]], 0.2), "$wall-shade"),
  P(`a${i}-roof`, blob([[ox + 18, 484, 1], [ox + 84, 430], [ox + 150, 378, 1], [ox + 216, 430], [ox + 282, 484, 1], [ox + 150, 484]], 0.05), "$red"),
  P(`a${i}-roof-shade`, blob([[ox + 150, 378, 1], [ox + 216, 430], [ox + 282, 484, 1], [ox + 216, 484], [ox + 150, 484, 1], [ox + 150, 430]], 0.05), "$ink", { opacity: 0.16 }),
  P(`a${i}-chimney`, rrect(ox + 206, 388, 28, 56, 5), "$wall-shade"),
  P(`a${i}-door`, rrect(ox + 132, 562, 46, 82, 8), "$brown"),
  P(`a${i}-win-l`, rrect(ox + 64, 520, 50, 52, 7), "$glass"),
  P(`a${i}-win-r`, rrect(ox + 196, 520, 50, 52, 7), "$glass"),
  S(`a${i}-win-shine`, `M ${ox + 74} 560 L ${ox + 100} 530 M ${ox + 206} 560 L ${ox + 232} 530`, "$white", 5, { opacity: 0.7 }),
];
const houseB = (i, ox) => [
  P(`b${i}-wall`, rrect(ox + 50, 432, 200, 212, 6), "$grey"),
  P(`b${i}-cap`, rrect(ox + 38, 420, 224, 24, 8), "$kerb"),
  P(`b${i}-sign`, rrect(ox + 86, 462, 128, 36, 10), "$cream"),
  S(`b${i}-sign-line`, `M ${ox + 104} 480 L ${ox + 160} 480 M ${ox + 172} 480 L ${ox + 196} 480`, "$red", 7),
  P(`b${i}-awning`, blob([[ox + 58, 516, 1], [ox + 242, 516, 1], [ox + 254, 552], [ox + 222, 564], [ox + 190, 552], [ox + 158, 564], [ox + 126, 552], [ox + 94, 564], [ox + 62, 552], [ox + 46, 552]], 0.2), "$red"),
  P(`b${i}-window`, rrect(ox + 66, 576, 96, 52, 7), "$glass"),
  P(`b${i}-door`, rrect(ox + 180, 570, 52, 74, 8), "$brown"),
  S(`b${i}-shine`, `M ${ox + 78} 618 L ${ox + 108} 586 M ${ox + 98} 618 L ${ox + 128} 586`, "$white", 5, { opacity: 0.7 }),
  P(`b${i}-shade`, blob([[ox + 198, 444, 1], [ox + 250, 444, 1], [ox + 250, 644, 1], [ox + 236, 644, 1], [ox + 232, 560], [ox + 214, 500]], 0.15), "$ink", { opacity: 0.1 }),
];
const tree = (i, x, sc) => {
  const y = 508, r = 62 * sc;
  return [
    P(`tree${i}-trunk`, rrect(x - 9, y + 30, 18, HZ - y - 26, 6), "$brown"),
    P(`tree${i}-crown`, blob([[x, y - r], [x + r * 0.7, y - r * 0.72], [x + r, y], [x + r * 0.72, y + r * 0.7], [x, y + r * 0.86], [x - r * 0.72, y + r * 0.7], [x - r, y], [x - r * 0.7, y - r * 0.72]], 0.2), "$green"),
    P(`tree${i}-shade`, blob([[x + r * 0.5, y - r * 0.6], [x + r * 0.96, y], [x + r * 0.7, y + r * 0.68], [x, y + r * 0.84], [x - r * 0.5, y + r * 0.72], [x + r * 0.1, y + r * 0.5], [x + r * 0.5, y + r * 0.1]], 0.2), "$green-shade"),
    P(`tree${i}-shine`, blob([[x - r * 0.6, y - r * 0.2], [x - r * 0.4, y - r * 0.56], [x - r * 0.05, y - r * 0.7], [x - r * 0.3, y - r * 0.46], [x - r * 0.48, y - r * 0.16]], 0.2), "$leaf-tint"),
  ];
};
const bush = (i, x) => [
  P(`bush${i}`, blob([[x - 48, HZ + 2], [x - 40, HZ - 30], [x - 10, HZ - 46], [x + 16, HZ - 34], [x + 40, HZ - 42], [x + 54, HZ - 14], [x + 52, HZ + 2]], 0.2), "$green-shade"),
  P(`bush${i}-tint`, blob([[x - 34, HZ - 24], [x - 12, HZ - 40], [x + 8, HZ - 32], [x - 10, HZ - 28], [x - 26, HZ - 14]], 0.2), "$green"),
];
const block = (i) => {
  const ox = i * 540;
  return G(`street-${i + 1}`, [...(i % 2 === 0 ? houseA(i, ox) : houseB(i, ox)), ...tree(i, ox + 392, i % 2 === 0 ? 1 : 0.86), ...bush(i, ox + 478)], { animate: { x: scroll(-1080, D) } });
};
// ---------- far hills, one per 270 pixels
const hill = (i) => {
  const ox = i * 270;
  return [
    P(`hill-${i}`, blob([[ox - 30, HZ, 1], [ox + 30, 580], [ox + 110, 520], [ox + 190, 556], [ox + 250, 530], [ox + 300, HZ, 1]], 0.2), "$hill"),
    P(`hill-tree-${i}`, blob([[ox + 150, 546], [ox + 160, 512], [ox + 172, 490], [ox + 184, 512], [ox + 194, 546]], 0.2), "$green", { opacity: 0.55 }),
  ];
};
// ---------- kerb-side lamp posts and road dashes; the pattern repeats every 1080 pixels and travels 2160
const post = (i) => {
  const x = 150 + i * 1080;
  return [
    P(`post-${i}-pole`, rrect(x - 5, 402, 10, 244, 5), "$kerb"),
    S(`post-${i}-arm`, curve([[x, 408], [x + 14, 384], [x + 46, 380]], 0.25), "$kerb", 8),
    P(`post-${i}-lamp`, blob([[x + 36, 378], [x + 64, 378], [x + 72, 390], [x + 60, 400], [x + 40, 400], [x + 30, 390]], 0.2), "$cream"),
  ];
};
const dash = (i) => P(`dash-${i}`, rrect(40 + i * 270, 716, 130, 12, 6), "$cream");
const wheel = (id, x, t) => G(id, [
  P(`${id}-tyre`, oval(x, 622, 46), "$ink"),
  P(`${id}-hub`, oval(x, 622, 25), "$grey"),
  S(`${id}-spokes`, `M ${x} 603 L ${x} 641 M ${x - 19} 622 L ${x + 19} 622`, "$kerb", 6),
  P(`${id}-cap`, oval(x, 622, 8), "$ink"),
], { pivot: [x, 622],
  animate: {
    rotation: [[0, 0], [D, 2880, "linear"]],
    y: [[0, 0], [t - 0.04, 0], [t + 0.06, -9, "snap"], [t + 0.2, 2], [t + 0.38, 0, "settle"], [D, 0]],
  } });
const parcel = (id, x, y, w, h, fill, delay, scale) => G(id, [
  P(`${id}-box`, rrect(x, y, w, h, 6), fill),
  P(`${id}-side`, blob([[x + w * 0.62, y, 1], [x + w - 4, y + 1], [x + w, y + 8], [x + w, y + h - 6], [x + w - 6, y + h], [x + w * 0.62, y + h, 1]], 0.1), "$ink", { opacity: 0.12 }),
  S(`${id}-tape`, `M ${x + w * 0.36} ${y + 2} L ${x + w * 0.36} ${y + h - 2}`, "$cream", 8, { strokeExtra: { cap: "butt" } }),
], { animate: { y: [[0, 0], [tF + delay, 0], [tF + delay + 0.12, -6 * scale, "snap"], [tF + delay + 0.34, 2], [tF + delay + 0.52, 0, "settle"],
  [tR + delay, 0], [tR + delay + 0.12, -5 * scale, "snap"], [tR + delay + 0.34, 2], [tR + delay + 0.52, 0, "settle"], [D, 0]] } });
const windowD = blob([[632, 448, 1], [678, 448], [708, 458], [732, 500], [728, 512, 1], [632, 512, 1]], 0.2);
const speed = (id, x, y, len, t) => S(id, `M ${x} ${y} L ${x + len * 0.5} ${y} L ${x + len} ${y}`, "$white", 7, { opacity: 0,
  animate: { opacity: [[0, 0], [t, 0], [t + 0.16, 0.85, "settle"], [t + 0.5, 0.85], [t + 0.8, 0], [D, 0]] } });
const cloud = (id, x, y, s, t, dx) => G(id, [
  P(`${id}-shape`, blob([[x, y + 30 * s], [x + 24 * s, y - 6 * s], [x + 70 * s, y - 26 * s], [x + 116 * s, y - 8 * s], [x + 160 * s, y - 16 * s], [x + 196 * s, y + 12 * s], [x + 186 * s, y + 34 * s], [x + 12 * s, y + 36 * s]], 0.2), "$white"),
  P(`${id}-shade`, blob([[x + 8 * s, y + 26 * s], [x + 70 * s, y + 16 * s], [x + 130 * s, y + 22 * s], [x + 190 * s, y + 12 * s], [x + 186 * s, y + 34 * s], [x + 12 * s, y + 36 * s]], 0.2), "$hill", { opacity: 0.5 }),
], { animate: { x: [[0, 0], [t, 0], [t + 2.6, dx, "gentle"], [D, 0, "gentle"]] } });
// an exhaust puff: appears at the pipe, drifts back and up, grows and fades; it returns while invisible
const puff = (id, x, y, sc, dx, t1, t2) => P(id, blob([[-20, 0], [-22, -18], [-4, -28], [16, -22], [24, -4], [12, 10], [-8, 12]], 0.22), "$white", { x, y, opacity: 0,
  animate: {
    opacity: [[0, 0], [t1, 0], [t1 + 0.2, 0.8, "settle"], [t1 + 1.1, 0], [t2, 0], [t2 + 0.2, 0.8, "settle"], [t2 + 1.1, 0], [D, 0]],
    x: [[0, x], [t1 + 1 / 30, x], [t1 + 1.1, x + dx, "settle"], [t2 - 0.2, x], [t2 + 1 / 30, x], [t2 + 1.1, x + dx, "settle"], [D, x]],
    scale: [[0, [sc * 0.5, sc * 0.5]], [t1 + 3 / 30, [sc * 0.5, sc * 0.5]], [t1 + 1.1, [sc * 1.5, sc * 1.5], "settle"], [t2 - 0.2, [sc * 0.5, sc * 0.5]], [t2 + 3 / 30, [sc * 0.5, sc * 0.5]], [t2 + 1.1, [sc * 1.5, sc * 1.5], "settle"], [D, [sc * 0.5, sc * 0.5]]],
  } });
const nodes = fillEase([
  { id: "haze", type: "rect", w: W, h: 360, x: W / 2, y: 470, fill: { type: "linear", from: [0, -180], to: [0, 180], stops: [[0, "#ffffff00"], [0.7, "#ffffff99"], [1, "#fff7dcd0"]] } },
  { id: "sun", type: "ellipse", r: 62, x: 900, y: 150, fill: { type: "radial", center: [0, 0], radius: 62, stops: [[0, "#fffbe0"], [0.7, "#ffe680"], [1, "#ffd24d"]] },
    animate: { scale: [[0, [1, 1]], [3, [1.06, 1.06], "gentle"], [D, [1, 1], "gentle"]] } },
  cloud("cloud-a", 120, 120, 1, 0.2, -34), cloud("cloud-b", 560, 80, 0.74, 0.6, -22), cloud("cloud-c", 700, 230, 0.9, 1.0, 28),
  G("far", [0, 1, 2, 3, 4].flatMap(hill), { animate: { x: scroll(-270, D) } }),
  P("verge", blob([[-20, 628, 1], [280, 622], [560, 630], [820, 622], [1100, 628, 1], [1100, 660, 1], [-20, 660, 1]], 0.2), "$green"),
  block(0), block(1), block(2), block(3),
  P("road", blob([[-20, 648, 1], [540, 646], [1100, 648, 1], [1100, 830, 1], [540, 830], [-20, 830, 1]], 0.1), "$road"),
  P("kerb-strip", rrect(-20, 640, 1120, 14, 6), "$kerb"),
  P("road-shade", blob([[-20, 772, 1], [360, 764], [760, 772], [1100, 762, 1], [1100, 830, 1], [-20, 830, 1]], 0.2), "$ink", { opacity: 0.22 }),
  G("dashes", Array.from({ length: 12 }, (_, i) => dash(i)), { animate: { x: scroll(-2160, D) } }),
  G("kerbside", [...[0, 1, 2].flatMap(post), P("bump", blob([[1210, 668, 1], [1222, 660], [1245, 656], [1268, 660], [1280, 668, 1]], 0.2), "$kerb")], { animate: { x: scroll(-2160, D) } }),
  { id: "van-shadow", type: "ellipse", rx: 290, ry: 16, x: 545, y: 672, fill: "$ink", opacity: 0.3,
    animate: { scale: [[0, [1, 1]], [tF + 0.03, [1, 1]], [tF + 0.14, [0.95, 0.9], "snap"], [tF + 0.4, [1, 1], "settle"], [tR + 0.02, [1, 1]], [tR + 0.14, [0.96, 0.9], "snap"], [tR + 0.4, [1, 1], "settle"], [D, [1, 1]]] } },
  speed("speed-a", 96, 452, 150, 0.4), speed("speed-b", 60, 512, 190, 2.9), speed("speed-c", 110, 566, 130, 4.3),
  puff("puff-a", 256, 598, 0.9, -34, 0.3, 3.2), puff("puff-b", 240, 606, 0.7, -52, 1.7, 4.7),
  G("van", [
    G("van-body", [
      P("exhaust", rrect(266, 594, 34, 10, 5), "$grey"),
      parcel("parcel-a", 326, 316, 72, 48, "$kraft", 2 / 30, 1.6), parcel("parcel-b", 406, 298, 86, 66, "$wall", 3 / 30, 2.2), parcel("parcel-c", 500, 324, 58, 40, "$red", 4 / 30, 3),
      P("rack-bar", rrect(308, 362, 270, 10, 5), "$kerb"),
      G("antenna", [S("antenna-rod", "M 598 374 L 595 336 L 590 298", "$ink", 4), P("antenna-ball", oval(590, 296, 7), "$red")], { pivot: [598, 374], follow: { delay: 0.1, scale: 5 } }),
      P("box", rrect(290, 372, 332, 236, 20), "$yellow"),
      P("box-shade", blob([[290, 556, 1], [400, 570], [520, 570], [622, 556, 1], [622, 592], [610, 608], [302, 608], [290, 592]], 0.15), "$yellow-shade"),
      P("box-shine", rrect(312, 386, 288, 10, 5), "$yellow-tint"),
      S("box-seam", "M 456 400 L 456 500 L 456 594", "$yellow-shade", 4),
      P("logo-box", rrect(326, 432, 74, 62, 9), "$red"),
      S("logo-tape", "M 363 434 L 363 462 L 363 492 M 328 456 L 363 456 L 398 456", "$cream", 7, { strokeExtra: { cap: "butt" } }),
      P("logo-bar-a", rrect(478, 436, 118, 16, 8), "$red"),
      P("logo-bar-b", rrect(478, 462, 84, 12, 6), "$yellow-shade"),
      S("logo-swoosh", curve([[478, 510], [514, 496], [556, 500], [596, 480]], 0.25), "$red", 8),
      P("cab", blob([[606, 430, 1], [676, 430], [716, 444], [748, 500], [784, 520], [800, 548], [800, 598], [790, 608], [606, 608, 1]], 0.16), "$yellow"),
      P("cab-shade", blob([[606, 566, 1], [700, 576], [800, 562], [800, 598], [790, 608], [606, 608, 1]], 0.15), "$yellow-shade"),
      P("window", windowD, "$glass"),
      G("driver", [
        P("driver-body", blob([[640, 520], [648, 502], [664, 494], [684, 496], [698, 506], [704, 520]], 0.2), "$kerb"),
        G("driver-head", [P("driver-face", oval(672, 484, 16), "$wall"), P("driver-cap", blob([[654, 478], [660, 466], [674, 462], [688, 468], [702, 480], [690, 482], [656, 482]], 0.2), "$red")], {
          pivot: [672, 498], animate: { rotation: [[0, 0], [tF + 0.1, 0], [tF + 0.26, 9, "snap"], [tF + 0.5, -3], [tF + 0.76, 0, "settle"], [tR + 0.1, 0], [tR + 0.26, -7, "snap"], [tR + 0.52, 0, "settle"], [D, 0]] } }),
      ], { clip: { type: "path", d: windowD } }),
      S("window-shine", "M 644 504 L 668 456 M 660 504 L 684 456", "$white", 6, { opacity: 0.6 }),
      S("door-seam", "M 624 440 L 624 520 L 624 598", "$yellow-shade", 4),
      P("door-handle", rrect(638, 528, 24, 8, 4), "$ink"),
      P("mirror", rrect(722, 472, 13, 28, 6), "$yellow-shade"),
      P("headlight", blob([[778, 536], [792, 536], [800, 548], [800, 562], [788, 564], [778, 554]], 0.2), "$cream",
        { animate: { opacity: [[0, 1], [4.1, 1], [4.24, 0.35, "snap"], [4.5, 1, "settle"], [D, 1]] } }),
      P("tail-light", rrect(288, 540, 10, 28, 5), "$red"),
      P("skirt", rrect(284, 594, 522, 20, 9), "$road"),
      P("bumper-front", rrect(786, 584, 28, 24, 9), "$grey"),
      P("bumper-rear", rrect(278, 584, 22, 24, 9), "$grey"),
      P("arch-rear", blob([[322, 624, 1], [330, 584], [380, 562], [430, 584], [438, 624, 1]], 0.22), "$ink"),
      P("arch-front", blob([[647, 624, 1], [655, 584], [705, 562], [755, 584], [763, 624, 1]], 0.22), "$ink"),
    ], { pivot: [542, 622],
      animate: {
        y: [[0, 0], [tF, 0], [tF + 0.12, -9, "snap"], [tF + 0.32, 4], [tF + 0.52, -1.5], [tF + 0.74, 0, "settle"], [tR, 0], [tR + 0.12, -8, "snap"], [tR + 0.32, 4], [tR + 0.54, 0, "settle"], [D, 0]],
        rotation: [[0, 0], [tF + 1 / 30, 0], [tF + 0.14, -1.5, "snap"], [tF + 0.36, 0.7], [tF + 0.6, 0, "settle"], [tR + 1 / 30, 0], [tR + 0.14, 1.4, "snap"], [tR + 0.36, -0.6], [tR + 0.6, 0, "settle"], [D, 0]],
      } }),
    wheel("wheel-rear", 380, tR), wheel("wheel-front", 705, tF),
  ]),
  G("horn", [S("horn-a", curve([[822, 520], [836, 536], [824, 554]], 0.3), "$red", 7), S("horn-b", curve([[846, 506], [868, 536], [848, 568]], 0.3), "$red", 7)], { pivot: [800, 538], opacity: 0,
    animate: {
      opacity: [[0, 0], [4.06, 0], [4.2, 1, "settle"], [4.62, 1], [4.9, 0], [D, 0]],
      scale: [[0, [0.7, 0.7]], [4.1, [0.7, 0.7]], [4.3, [1.08, 1.08], "settle"], [4.9, [1.14, 1.14]], [D, [0.7, 0.7]]],
    } }),
], "smooth");
console.error(tally(nodes));
save({
  gertie: 1, name: "delivery-van", canvas: { w: W, h: H, background: "#cdeaf8" }, duration: D, tier: "scene", poster: 1,
  palette: { ink: "#262b36", road: "#555b6b", kerb: "#77809a", cream: "#fff4d6", white: "#ffffff", yellow: "#ffc533", "yellow-shade": "#e39a12", "yellow-tint": "#ffe392",
    glass: "#8fd0ee", red: "#e8503a", grey: "#c9cfda", green: "#6fbf73", "green-shade": "#4c9a5a", "leaf-tint": "#a6dc9c", brown: "#8a5a3c", wall: "#f2d7b6", "wall-shade": "#d9b48c", hill: "#a9d7c3", kraft: "#cf9c62" },
  nodes,
});
