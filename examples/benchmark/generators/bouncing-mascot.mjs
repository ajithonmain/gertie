import { blob, curve, oval, P, S, G, save, fillEase } from "./lib.mjs";
const D = 4.4;
const mx = (pts) => pts.map(([x, y, c]) => (c ? [-x, y, c] : [-x, y]));
const headPts = [[0, -600], [90, -585], [160, -520], [178, -440], [150, -365], [80, -322], [0, -312], [-80, -322], [-150, -365], [-178, -440], [-160, -520], [-90, -585]];
const head = blob(headPts);
const earPts = [[-150, -530], [-196, -610], [-176, -676], [-112, -640], [-84, -580]];
const earIn = [[-146, -556], [-176, -612], [-164, -648], [-124, -626], [-104, -586]];
const armPts = [[-92, -300], [-128, -290], [-160, -232], [-174, -182], [-152, -154], [-126, -170], [-122, -222], [-94, -258]];
const armShade = [[-122, -222], [-126, -170], [-152, -154], [-172, -176], [-150, -172], [-138, -196]];
const legPts = [[-84, -170], [-36, -170], [-34, -70], [-42, -22], [-80, -22], [-86, -70]];
const footPts = [[-104, -34], [-62, -48], [-26, -32], [-18, -10], [-48, 0], [-98, 0], [-116, -12]];
const footShade = [[-116, -12], [-98, 0], [-48, 0], [-18, -10], [-50, -8], [-96, -8]];
const leg = (s, pts = (p) => p) => G(`mascot-leg-${s}`, [
  P(`leg-${s}-shape`, blob(pts(legPts)), "$teal-shade"),
  P(`foot-${s}`, blob(pts(footPts)), "$orange"),
  P(`foot-${s}-shade`, blob(pts(footShade)), "$orange-shade"),
], { pivot: [s === "l" ? -60 : 60, -160] });
const arm = (s, pts = (p) => p) => G(`mascot-arm-${s}-ctl`, [G(`mascot-arm-${s}`, [
  P(`arm-${s}-shape`, blob(pts(armPts)), "$teal"),
  P(`arm-${s}-shade`, blob(pts(armShade)), "$teal-shade"),
], { pivot: [s === "l" ? -108 : 108, -286] })], { pivot: [s === "l" ? -108 : 108, -286] });
const eye = (s, x) => G(`mascot-eye-${s}`, [
  { id: `eye-${s}-white`, type: "ellipse", rx: 34, ry: 40, fill: "$white" },
  { id: `pupil-${s}`, type: "ellipse", rx: 17, ry: 21, x: 4, y: 4, fill: "$ink",
    animate: { x: [[0, 4], [1.7 + (s === "l" ? 0 : 0.04), 4], [1.92, -8, "snap"], [3.7, -8], [3.96, 4, "snap"], [D, 4]] } },
  { id: `glint-${s}`, type: "ellipse", r: 7, x: -6, y: -10, fill: "$white" },
], { x, y: -452 });
const blade = (id, pts, fill) => P(id, blob(pts, 0.2), fill);
const tuft = (id, x, y, sc, ph) => G(id, [
  blade(`${id}-a`, [[-8, 0], [-22, -22], [-34, -50], [-44, -86], [-26, -58], [-10, -28], [6, 0]], "$grass-shade"),
  blade(`${id}-b`, [[-6, 0], [-7, -34], [-2, -74], [10, -112], [14, -74], [14, -34], [12, 0]], "$grass"),
  blade(`${id}-c`, [[4, 0], [16, -20], [34, -44], [52, -70], [36, -52], [26, -30], [18, 0]], "$grass-shade"),
], { x, y, scale: sc, motion: [{ preset: "sway", angle: 4, duration: D, repeat: "loop", phase: ph }] });
const star = (id, x, y, r, ph) => P(id, blob([[0, -r, 1], [r * 0.22, -r * 0.22], [r, 0, 1], [r * 0.22, r * 0.22], [0, r, 1], [-r * 0.22, r * 0.22], [-r, 0, 1], [-r * 0.22, -r * 0.22]], 0.1), "$cream", { x, y,
  animate: { scale: [[0, [1, 1]], [ph, [1, 1]], [ph + 0.3, [0.35, 0.35], "smooth"], [ph + 0.62, [1.15, 1.15], "settle"], [ph + 1.0, [1, 1]], [D, [1, 1]]] } });
const J1 = 0.4, d1 = 1.2, J2 = 2.5, d2 = 1.08; // jump starts and lengths
const land1 = J1 + d1 / 1.2, land2 = J2 + d2 / 1.2, peak1 = J1 + d1 / 2, peak2 = J2 + d2 / 2; // rig-jump lands at five sixths of its length
const puff = (id, x, dx, at) => P(id, blob([[-22, 0], [-26, -18], [-8, -30], [14, -26], [26, -8], [18, 4]], 0.22), "$cream", { x, y: 884, opacity: 0, pivot: [-dx, 10],
  animate: {
    opacity: [[0, 0], [at, 0], [at + 0.14, 0.85, "settle"], [at + 0.56, 0], [D, 0]],
    scale: [[0, [0.5, 0.5]], [at + 0.04, [0.5, 0.5]], [at + 0.56, [1.6, 1.6], "settle"], [D, [0.5, 0.5]]],
  } });
const ear = (s, pts, rot) => G(`ear-${s}`, [P(`ear-${s}-outer`, blob(pts(earPts)), "$teal"), P(`ear-${s}-inner`, blob(pts(earIn)), "$pink")], {
  pivot: [s === "l" ? -116 : 116, -552],
  animate: { rotation: rot } });
const k = (s) => (s === "l" ? 1 : -1);
// ears flop down in the crouch, trail back on the way up, and fold forward on landing
const earKeys = (s, lag) => [[0, 0], [J1 + 0.06 + lag, 0], [J1 + 0.24 + lag, 8 * k(s)], [peak1 - 0.1 + lag, -16 * k(s), "snap"], [land1 + 0.14 + lag, 15 * k(s)], [land1 + 0.42 + lag, -5 * k(s)], [land1 + 0.7 + lag, 0],
  [J2 + 0.22 + lag, 6 * k(s)], [peak2 - 0.08 + lag, -11 * k(s), "snap"], [land2 + 0.14 + lag, 10 * k(s)], [land2 + 0.42 + lag, -3 * k(s)], [land2 + 0.64 + lag, 0], [D, 0]];
save({
  gertie: 1, name: "bouncing-mascot", canvas: { w: 1024, h: 1024 }, duration: D, tier: "character", poster: 0,
  palette: { teal: "#2bb3a3", "teal-shade": "#1c877d", "teal-tint": "#86e3d6", cream: "#fff1d6", "cream-shade": "#efd0a0", orange: "#f59e42", "orange-shade": "#d6781c",
    pink: "#f58fa8", white: "#ffffff", ink: "#23303d", grass: "#5cb86b", "grass-shade": "#3b8f4f" },
  nodes: fillEase([
    star("spark-a", 170, 300, 26, 0.2), star("spark-b", 850, 380, 20, 1.5), star("spark-c", 790, 200, 16, 2.9),
    tuft("tuft-a", 150, 892, 1.15, 0.25), tuft("tuft-b", 286, 906, 0.8, 0.75), tuft("tuft-c", 770, 904, 0.9, 0.5), tuft("tuft-d", 892, 890, 1.2, 0),
    { id: "ground-shadow", type: "ellipse", rx: 190, ry: 26, x: 512, y: 884, fill: "$ink", opacity: 0.22,
      animate: {
        scale: [[0, [1, 1]], [J1 + 0.02, [1, 1]], [J1 + d1 / 6, [1.1, 1.1]], [peak1, [0.56, 0.56], "easeOutQuad"], [land1, [1.12, 1.12], "easeInQuad"], [land1 + 0.3, [1, 1], "settle"],
          [J2 + 0.02, [1, 1]], [J2 + d2 / 6, [1.08, 1.08]], [peak2, [0.7, 0.7], "easeOutQuad"], [land2, [1.1, 1.1], "easeInQuad"], [land2 + 0.3, [1, 1], "settle"], [D, [1, 1]]],
        opacity: [[0, 0.22], [J1 + d1 / 6, 0.22], [peak1, 0.1, "easeOutQuad"], [land1, 0.24, "easeInQuad"], [J2 + d2 / 6, 0.22], [peak2, 0.13, "easeOutQuad"], [land2, 0.24, "easeInQuad"], [D, 0.22]],
      } },
    puff("puff-a", 392, -60, land1), puff("puff-b", 632, 60, land2 + 0.02),
    G("mascot", [
      G("mascot-tail", [
        P("tail-shape", blob([[96, -150], [162, -168], [204, -228], [194, -292], [160, -300], [166, -250], [140, -204], [92, -192]]), "$teal-shade"),
        P("tail-tip", blob([[196, -286], [180, -302], [160, -300], [158, -278], [166, -260], [190, -258]], 0.2), "$cream"),
      ], { pivot: [100, -166], motion: [{ preset: "sway", angle: 7, duration: 2.2, repeat: "loop", phase: 0.25 }] }),
      leg("l"), leg("r", mx),
      G("mascot-body", [
        G("torso", [
          P("body-shape", blob([[0, -344], [70, -322], [118, -244], [126, -172], [92, -118], [0, -100], [-92, -118], [-126, -172], [-118, -244], [-70, -322]]), "$teal"),
          P("body-shade", blob([[70, -320], [116, -244], [124, -172], [92, -120], [10, -102], [70, -140], [94, -200], [90, -270]]), "$teal-shade"),
          P("belly", blob([[0, -292], [56, -264], [72, -202], [50, -142], [0, -126], [-50, -142], [-72, -202], [-56, -264]]), "$cream"),
          P("belly-shade", blob([[62, -244], [72, -202], [50, -144], [0, -128], [34, -158], [54, -202]]), "$cream-shade"),
        ]),
        arm("l"), arm("r", mx),
        G("scarf", [
          G("scarf-tail", [P("scarf-tail-shape", blob([[36, -318], [72, -322], [90, -246], [62, -226], [46, -262]]), "$orange-shade")], { pivot: [54, -316],
            animate: { rotation: [[0, 0], [J1 + 0.18, 0], [peak1 - 0.16, -14, "snap"], [land1 - 0.1, 18], [land1 + 0.22, -9], [land1 + 0.6, 0, "settle"],
              [J2 + 0.16, 0], [peak2 - 0.14, -10, "snap"], [land2 - 0.1, 13], [land2 + 0.22, -6], [land2 + 0.56, 0, "settle"], [D, 0]] } }),
          P("scarf-band", blob([[-98, -344], [0, -322], [98, -344], [104, -314], [0, -290], [-104, -314]]), "$orange"),
          P("scarf-fold", blob([[20, -320], [60, -330], [98, -344], [104, -314], [74, -302], [40, -294]], 0.2), "$orange-shade"),
        ]),
        G("mascot-head-ctl", [G("mascot-head", [
          ear("l", (p) => p, earKeys("l", 0)), ear("r", mx, earKeys("r", 0.05)),
          P("head-base", head, "$teal"),
          P("head-shade", blob([[190, -500], [200, -380], [120, -300], [-40, -296], [40, -330], [116, -372], [150, -440]]), "$teal-shade", { clip: { type: "path", d: head } }),
          P("head-shine", blob([[-124, -520], [-84, -562], [-32, -578], [-62, -552], [-102, -514], [-130, -478]], 0.2), "$teal-tint"),
          G("face", [
            P("cheek-l", blob([[-140, -408], [-116, -420], [-96, -402], [-112, -384], [-136, -388]], 0.22), "$pink"),
            P("cheek-r", blob([[140, -408], [116, -420], [96, -402], [112, -384], [136, -388]], 0.22), "$pink"),
            eye("l", -64), eye("r", 64),
            S("brow-l", curve([[-98, -512], [-68, -524], [-38, -514]], 0.25), "$ink", 9),
            S("brow-r", curve([[40, -516], [68, -526], [98, -512]], 0.25), "$ink", 9),
            P("nose", blob([[-12, -412], [0, -418], [12, -412], [8, -404], [0, -400], [-8, -404]], 0.22), "$ink"),
            P("mouth", blob([[-36, -390], [0, -380], [36, -390], [24, -360], [0, -350], [-24, -360]], 0.2), "$ink"),
            P("tongue", blob([[-16, -364], [0, -370], [16, -364], [12, -356], [0, -352], [-12, -356]], 0.22), "$pink"),
          ]),
          G("tuft", [
            G("leaf-a", [P("leaf-a-shape", blob([[-8, -596], [-40, -640], [-64, -690], [-30, -664], [6, -600]], 0.2), "$grass-shade")], { pivot: [0, -598], motion: [{ preset: "sway", angle: 6, duration: D, repeat: "loop", phase: 0.25 }] }),
            G("leaf-b", [P("leaf-b-shape", blob([[-10, -598], [-6, -660], [8, -716], [18, -660], [10, -598]], 0.2), "$grass")], { pivot: [0, -598], motion: [{ preset: "sway", angle: 5, duration: 2.2, repeat: "loop", phase: 0.5 }] }),
            G("leaf-c", [P("leaf-c-shape", blob([[-4, -600], [34, -636], [62, -678], [38, -640], [10, -596]], 0.2), "$grass-shade")], { pivot: [0, -598], motion: [{ preset: "sway", angle: 7, duration: D, repeat: "loop", phase: 0.75 }] }),
          ]),
        ], { pivot: [0, -330] })], { pivot: [0, -330] }),
      ], { pivot: [0, -110] }),
    ], { x: 512, y: 880, scale: 0.86,
      motion: [
        { preset: "rig-idle", duration: 2.2, repeat: "loop", armSway: 4 },
        { preset: "rig-blink", every: 1.9, seed: 5 },
        { preset: "rig-jump", at: J1, duration: d1, height: 150 },
        { preset: "rig-jump", at: J2, duration: d2, height: 90 },
      ] }),
  ], "smooth"),
});
