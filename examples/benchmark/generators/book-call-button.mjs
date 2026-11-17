import { blob, oval, rrect, poly, P, S, G, save, fillEase } from "./lib.mjs";
const D = 3, k = 0.74, base = 21;
const n = (v) => Math.round(v * 10) / 10;
// Monoline letters. Each is drawn from its left edge x on the baseline, x-height 44 and ascender 70 before scaling by k.
const X = (x, v) => n(x + v * k), Y = (v) => n(base + v * k);
const L = {
  B: (x) => `M ${X(x, 0)} ${Y(0)} L ${X(x, 0)} ${Y(-70)} L ${X(x, 16)} ${Y(-70)} C ${X(x, 42)} ${Y(-70)} ${X(x, 42)} ${Y(-38)} ${X(x, 16)} ${Y(-38)} L ${X(x, 0)} ${Y(-38)} M ${X(x, 16)} ${Y(-38)} C ${X(x, 48)} ${Y(-38)} ${X(x, 48)} ${Y(0)} ${X(x, 16)} ${Y(0)} L ${X(x, 0)} ${Y(0)}`,
  o: (x) => oval(X(x, 20), Y(-22), 20 * k, 22 * k),
  k: (x) => `M ${X(x, 0)} ${Y(-70)} L ${X(x, 0)} ${Y(0)} M ${X(x, 32)} ${Y(-44)} L ${X(x, 2)} ${Y(-17)} M ${X(x, 13)} ${Y(-27)} L ${X(x, 34)} ${Y(0)}`,
  a: (x) => `${oval(X(x, 20), Y(-22), 20 * k, 22 * k)} M ${X(x, 40)} ${Y(-44)} L ${X(x, 40)} ${Y(0)}`,
  c: (x) => `M ${X(x, 36)} ${Y(-34)} C ${X(x, 28)} ${Y(-50)} ${X(x, 0)} ${Y(-48)} ${X(x, 0)} ${Y(-22)} C ${X(x, 0)} ${Y(4)} ${X(x, 28)} ${Y(6)} ${X(x, 36)} ${Y(-10)}`,
  l: (x) => `M ${X(x, 0)} ${Y(-70)} L ${X(x, 0)} ${Y(0)} M ${X(x, 16)} ${Y(-70)} L ${X(x, 16)} ${Y(0)}`,
};
const adv = { B: 60, o: 52, k: 48, a: 54, c: 48, l: 32, " ": 30 };
const text = "Book a cal";
const total = [...text].reduce((s, ch) => s + adv[ch], 0) - 16;
let pen = (-total * k) / 2;
const letters = [];
[...text].forEach((ch, i) => {
  if (ch !== " ") letters.push(S(`glyph-${i + 1}-${ch.toLowerCase()}`, L[ch](pen), "$white", 8.5));
  pen += adv[ch] * k;
});
const body = rrect(-200, -62, 400, 124, 62);
const hov = 0.85, press = 1.75;
save({
  gertie: 1, name: "book-call-button", canvas: { w: 512, h: 512 }, duration: D, tier: "icon", poster: 1.2,
  palette: { blue: "#4f46e5", shade: "#3a31b8", tint: "#8f8cf5", white: "#ffffff", ink: "#16133d" },
  nodes: fillEase([
    { id: "shadow", type: "ellipse", rx: 186, ry: 18, x: 256, y: 338, fill: "$ink", opacity: 0.25,
      animate: {
        scale: [[0, [1, 1]], [hov + 0.04, [1, 1]], [hov + 0.3, [1.05, 1.25], "settle"], [press + 0.03, [1.05, 1.25]], [press + 0.13, [0.96, 0.8], "snap"], [press + 0.4, [1.05, 1.25], "settle"], [2.3, [1.05, 1.25]], [2.65, [1, 1]], [D, [1, 1]]],
        opacity: [[0, 0.25], [hov + 0.04, 0.25], [hov + 0.3, 0.16, "settle"], [press + 0.03, 0.16], [press + 0.13, 0.3, "snap"], [press + 0.4, 0.16, "settle"], [2.3, 0.16], [2.65, 0.25], [D, 0.25]],
      } },
    G("button", [
      P("button-body", body, "$blue"),
      P("button-shade", blob([[-196, 10], [-150, 38], [0, 44], [150, 38], [196, 10], [176, 46], [140, 62], [-140, 62], [-176, 46]], 0.2), "$shade"),
      P("button-shine", rrect(-150, -50, 300, 10, 5), "$tint"),
      P("sweep-mask", body, "$white"),
      G("sweep", [P("sweep-wide", poly([[-10, -80], [60, -80], [10, 80], [-60, 80]]), "$white", { opacity: 0.34 })], {
        x: -300, matte: { by: "sweep-mask", mode: "alpha" },
        animate: { x: [[0, -300], [hov + 0.12, -300], [hov + 0.8, 300], [press + 0.24, 300], [press + 0.8, -300], [D, -300]] } }),
      G("label", letters),
    ], { x: 256, y: 256,
      animate: {
        scale: [[0, [1, 1]], [hov, [1, 1]], { t: hov + 0.22, v: [1.05, 1.05], ease: "settle", overshoot: { past: 0.4, back: 0.12, time: 0.3 } },
          [press, [1.05, 1.05]], [press + 0.1, [0.96, 0.95], "snap"], { t: press + 0.3, v: [1.05, 1.05], ease: "settle", overshoot: { past: 0.5, back: 0.15, time: 0.3 } }, [2.3, [1.05, 1.05]], [2.62, [1, 1]], [D, [1, 1]]],
        y: [[0, 256], [hov + 0.02, 256], [hov + 0.26, 249, "settle"], [press + 0.02, 249], [press + 0.12, 258, "snap"], [press + 0.36, 249, "settle"], [2.34, 249], [2.68, 256], [D, 256]],
      } }),
    P("cursor", poly([[0, 0], [0, 60], [15, 47], [26, 71], [38, 66], [27, 43], [47, 43]]), "$white", { stroke: { color: "$ink", width: 6 }, x: 436, y: 414, opacity: 0,
      animate: {
        opacity: [[0, 0], [0.16, 0], [0.4, 1], [2.5, 1], [2.8, 0], [D, 0]],
        x: [[0, 436], [0.2, 436], [0.86, 404, "settle"], [press - 0.05, 400, "smooth"], [2.12, 404], [2.75, 436, "snap"], [D, 436]],
        y: [[0, 414], [0.24, 414], [0.9, 286, "settle"], [press - 0.02, 290, "smooth"], [2.16, 286], [2.78, 414, "snap"], [D, 414]],
        scale: [[0, [1, 1]], [press, [1, 1]], [press + 0.1, [0.84, 0.84], "snap"], [press + 0.32, [1, 1], "settle"], [D, [1, 1]]],
      } }),
  ], "smooth"),
});
