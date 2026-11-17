import { blob, curve, oval, rrect, P, S, G, save, fillEase, scroll } from "./lib.mjs";
const D = 2.4, T = 1.2, step = 0.6, GY = 822;
const loop = (keys) => ({ keys, repeat: "loop" });
const leg = (id, hx, hy, far) => {
  const col = far ? "$orange-shade" : "$orange";
  const th = far ? [[0, 24], [0.3, 4, "easeInQuad"], [0.6, -24, "easeOutQuad"], [T, 24, "gentle"]] : [[0, -24], [0.6, 24, "gentle"], [0.9, 4, "easeInQuad"], [T, -24, "easeOutQuad"]];
  const sh = far ? [[0, 12], [0.26, 58], [0.6, 4], [T, 12, "gentle"]] : [[0, 4], [0.6, 12, "gentle"], [0.86, 58], [T, 4]];
  const ft = far ? [[0, -36], [0.26, -30], [0.6, 20], [T, -36, "gentle"]] : [[0, 20], [0.6, -36, "gentle"], [0.86, -30], [T, 20]];
  const ay = hy + 170;
  return G(id, [
    P(`${id}-thigh`, rrect(hx - 8, hy - 4, 16, 100, 8), col),
    G(`${id}-shin`, [
      P(`${id}-shin-bone`, rrect(hx - 7, hy + 84, 14, 92, 7), col),
      G(`${id}-foot`, [
        P(`${id}-toe-back`, blob([[hx - 2, ay - 6], [hx - 18, ay - 2], [hx - 34, ay + 4], [hx - 32, ay + 10], [hx - 16, ay + 9], [hx, ay + 8]], 0.2), col),
        P(`${id}-toe-up`, blob([[hx - 4, ay - 6], [hx + 22, ay - 10], [hx + 52, ay - 12], [hx + 56, ay - 5], [hx + 26, ay + 2], [hx, ay + 6]], 0.2), col),
        P(`${id}-toe-front`, blob([[hx - 6, ay - 4], [hx + 28, ay - 2], [hx + 66, ay + 3], [hx + 66, ay + 10], [hx + 26, ay + 10], [hx - 6, ay + 9]], 0.2), col),
      ], { pivot: [hx, ay], animate: { rotation: loop(ft) } }),
    ], { pivot: [hx, hy + 90], animate: { rotation: loop(sh) } }),
    P(`${id}-pants`, blob([[hx - 34, hy - 30], [hx + 30, hy - 34], [hx + 34, hy + 6], [hx + 14, hy + 34], [hx - 4, hy + 26], [hx - 24, hy + 34], [hx - 38, hy + 4]], 0.2), far ? "$blue-shade" : "$blue"),
  ], { pivot: [hx, hy], animate: { rotation: loop(th) } });
};
const feather = (id, pts, fill, piv, rot) => G(id, [P(`${id}-shape`, blob(pts, 0.2), fill)], { pivot: piv, animate: { rotation: rot } });
const headD = blob([[640, 276], [700, 296], [726, 356], [704, 420], [640, 444], [578, 420], [556, 356], [580, 296]], 0.2);
const bodyD = blob([[356, 512], [398, 440], [486, 402], [588, 420], [652, 488], [656, 572], [598, 644], [496, 668], [408, 626]], 0.19);
// decor that scrolls: a pattern that repeats every `period` pixels, shifted by whole periods over the scene
const strip = (id, period, count, make) => Array.from({ length: count }, (_, i) => make(i, i * period)).flat();
const tuft = (i, ox) => [
  P(`grass-${i}-a`, blob([[ox + 60, GY + 6], [ox + 52, GY - 14], [ox + 40, GY - 40], [ox + 56, GY - 22], [ox + 66, GY - 6], [ox + 70, GY + 6]], 0.2), "$green-shade"),
  P(`grass-${i}-b`, blob([[ox + 68, GY + 6], [ox + 72, GY - 22], [ox + 86, GY - 52], [ox + 86, GY - 26], [ox + 82, GY - 8], [ox + 80, GY + 6]], 0.2), "$green-shade"),
  P(`pebble-${i}`, blob([[ox + 190, GY + 30], [ox + 200, GY + 20], [ox + 220, GY + 18], [ox + 234, GY + 26], [ox + 228, GY + 36], [ox + 204, GY + 38]], 0.2), "$white"),
];
const bush = (i, ox) => [
  P(`bush-${i}`, blob([[ox + 20, GY], [ox + 30, GY - 46], [ox + 70, GY - 78], [ox + 112, GY - 60], [ox + 150, GY - 84], [ox + 190, GY - 44], [ox + 200, GY]], 0.2), "$green-shade", { opacity: 0.55 }),
];
// crest feathers lag the head: they tip back on each thrust and swing forward after it
const crestKeys = (lag, a) => [[0, 0], [lag, 0], [lag + 0.5, -a, "snap"], [lag + 0.8, a * 0.7, "gentle"], [lag + 1.1, -a * 0.9, "snap"], [lag + 1.4, a * 0.7, "gentle"], [lag + 1.7, -a * 0.7, "snap"], [D, 0, "settle"]];
save({
  gertie: 1, name: "walking-bird", canvas: { w: 1024, h: 1024, background: "#dff3ff" }, duration: D, tier: "character", poster: 0.3,
  palette: { blue: "#4aa3df", "blue-shade": "#2b7bb8", "blue-tint": "#a5d8f6", navy: "#1f5688", orange: "#f79a3e", "orange-shade": "#d8741d",
    white: "#ffffff", ink: "#1d2733", pink: "#f59ab0", green: "#86cc7f", "green-shade": "#55a463" },
  nodes: fillEase([
    { id: "sun", type: "ellipse", r: 70, x: 200, y: 210, fill: { type: "radial", center: [0, 0], radius: 70, stops: [[0, "#fff6c9"], [0.7, "#ffe27a"], [1, "#ffd24d"]] } },
    G("cloud", [
      P("cloud-shape", blob([[690, 230], [716, 190], [770, 176], [816, 196], [862, 190], [896, 220], [884, 250], [706, 252]], 0.2), "$white"),
      P("cloud-shade", blob([[700, 240], [760, 232], [830, 238], [890, 228], [884, 250], [706, 252]], 0.2), "$blue-tint", { opacity: 0.6 }),
    ], { animate: { x: [[0, 0], [T, 14, "gentle"], [D, 0, "gentle"]] } }),
    G("far", strip("far", 256, 6, bush), { animate: { x: scroll(-256, D) } }),
    P("ground", blob([[-40, GY - 4, 1], [260, GY - 10], [520, GY - 2], [780, GY - 10], [1064, GY - 4, 1], [1064, 1040, 1], [-40, 1040, 1]], 0.2), "$green"),
    P("ground-shade", blob([[-40, 930, 1], [300, 914], [620, 934], [1064, 910, 1], [1064, 1040, 1], [-40, 1040, 1]], 0.2), "$green-shade", { opacity: 0.45 }),
    G("near", strip("near", 288, 6, tuft), { animate: { x: scroll(-576, D) } }),
    { id: "shadow", type: "ellipse", rx: 170, ry: 22, x: 500, y: GY + 12, fill: "$ink", opacity: 0.2,
      animate: { scale: loop([[0, [1.06, 1.06]], [0.3, [0.94, 0.94], "easeOutQuad"], [step, [1.06, 1.06], "easeInQuad"]]) } },
    G("bird", [
      leg("leg-far", 528, 636, true),
      G("bird-body", [
        G("tail", [
          feather("tail-a", [[392, 500], [330, 470], [262, 420], [240, 396], [262, 446], [316, 500], [386, 532]], "$navy", [388, 516], [[0, 0], [0.2, 0], [0.5, -7, "gentle"], [0.8, 3, "gentle"], [1.1, -6, "gentle"], [1.4, 3, "gentle"], [1.7, -5, "gentle"], [D, 0, "settle"]]),
          feather("tail-b", [[392, 510], [322, 500], [246, 474], [220, 458], [250, 500], [316, 532], [388, 542]], "$blue-shade", [388, 524], [[0, 0], [4 / 30, 0], [0.44, 5, "gentle"], [0.74, -2, "gentle"], [1.04, 5, "gentle"], [1.34, -2, "gentle"], [1.64, 4, "gentle"], [D, 0, "settle"]]),
        ]),
        G("torso", [
          P("neck", blob([[556, 440], [586, 392], [640, 380], [694, 408], [672, 480], [610, 500]], 0.2), "$blue"),
          P("body-shape", bodyD, "$blue"),
          P("body-shade", blob([[362, 540], [410, 600], [500, 632], [600, 612], [654, 560], [636, 628], [560, 668], [470, 668], [398, 626]], 0.2), "$blue-shade"),
          P("belly", blob([[560, 470], [620, 462], [652, 500], [654, 566], [612, 620], [560, 640], [600, 580], [606, 520]], 0.2), "$white"),
          P("body-shine", blob([[400, 470], [440, 432], [500, 414], [470, 440], [430, 470], [404, 500]], 0.2), "$blue-tint"),
        ]),
        G("wing", [
          P("wing-shape", blob([[560, 486], [520, 472], [450, 492], [400, 540], [384, 600], [440, 596], [520, 574], [566, 530]], 0.2), "$blue-shade"),
          P("wing-tip", blob([[440, 552], [400, 572], [372, 612], [420, 612], [470, 590], [500, 566]], 0.2), "$navy"),
          S("wing-line-a", curve([[540, 508], [490, 520], [442, 548]], 0.25), "$navy", 6),
          S("wing-line-b", curve([[536, 536], [498, 546], [468, 566]], 0.25), "$navy", 6),
        ], { pivot: [552, 494],
          animate: { rotation: [[0, 0], [5 / 30, 0], [0.5, 4, "gentle"], [0.9, 0, "gentle"], [1.3, 3, "gentle"], [1.5, 26, "snap"], [1.66, -4], [1.82, 16], [D, 0, "settle"]] } }),
        G("head", [
          G("crest", [
            feather("crest-a", [[620, 290], [596, 250], [570, 206], [560, 190], [590, 214], [622, 248], [640, 284]], "$navy", [626, 286], crestKeys(2 / 30, 9)),
            feather("crest-b", [[636, 284], [628, 238], [634, 190], [640, 172], [654, 204], [658, 244], [654, 284]], "$blue-shade", [644, 284], crestKeys(0.1, 7)),
          ]),
          P("head-base", headD, "$blue"),
          P("head-shade", blob([[540, 400], [600, 430], [660, 430], [720, 380], [740, 330], [760, 460], [640, 480], [540, 460]], 0.2), "$blue-shade", { clip: { type: "path", d: headD } }),
          P("head-shine", blob([[588, 318], [612, 296], [648, 288], [624, 304], [600, 326], [588, 346]], 0.2), "$blue-tint"),
          G("face", [
            P("cheek", blob([[640, 392], [660, 380], [682, 386], [686, 402], [668, 412], [646, 408]], 0.2), "$pink"),
            G("eye", [
              { id: "eye-white", type: "ellipse", rx: 26, ry: 30, fill: "$white" },
              { id: "pupil", type: "ellipse", rx: 13, ry: 16, x: 8, y: 2, fill: "$ink" },
              { id: "glint", type: "ellipse", r: 5, x: 3, y: -6, fill: "$white" },
            ], { x: 664, y: 344, motion: [{ preset: "blink", at: 1.03 }] }),
            S("brow", curve([[644, 304], [668, 296], [692, 306]], 0.25), "$ink", 7),
          ]),
          G("beak-lower", [P("beak-lower-shape", blob([[708, 374], [744, 376], [778, 380], [770, 390], [740, 396], [712, 394]], 0.2), "$orange-shade")], { pivot: [712, 380],
            animate: { rotation: [[0, 0], [0.5, 0], [0.6, 16, "snap"], [0.72, 2], [0.84, 13, "snap"], [1.0, 0, "settle"], [D, 0]] } }),
          P("beak-upper", blob([[706, 352], [740, 352], [776, 366], [796, 378], [760, 382], [708, 380]], 0.2), "$orange"),
        ], { pivot: [612, 448],
          animate: {
            x: loop([[0, 8], [0.42, -10, "gentle"], [step, 8, "snap"]]),
            rotation: [[0, 0], [0.34, 0], [0.62, -7], [1.5, -6, "gentle"], [1.86, 0], [D, 0]],
          } }),
      ], { pivot: [500, 640], animate: { rotation: loop([[0, 2], [0.6, -2, "gentle"], [T, 2, "gentle"]]) } }),
      leg("leg-near", 476, 640, false),
    ], { animate: { y: loop([[0, 14], [0.3, 0, "easeOutQuad"], [step, 14, "easeInQuad"]]) } }),
  ], "smooth"),
});
