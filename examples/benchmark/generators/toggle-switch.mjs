import { blob, oval, rrect, P, S, G, save, fillEase } from "./lib.mjs";
const D = 3, off = 176, on = 336, a = 0.45, b = 1.85;
const os = { past: 0.07, back: 0.02, time: 0.32 };
save({
  gertie: 1, name: "toggle-switch", canvas: { w: 512, h: 512 }, duration: D, tier: "icon", poster: 1.4,
  palette: { off: "#c3ccd9", on: "#22c58b", white: "#ffffff", ink: "#0f172a", dim: "#e3e8ef" },
  nodes: fillEase([
    { id: "ground", type: "ellipse", rx: 150, ry: 12, x: 256, y: 372, fill: "$ink", opacity: 0.12 },
    S("glow", rrect(-160, -80, 320, 160, 80), "$on", 10, { x: 256, y: 256, opacity: 0,
      animate: {
        scale: [[0, [1, 1]], [a + 0.36, [1, 1]], [a + 0.95, [1.16, 1.22], "settle"], [D, [1, 1]]],
        opacity: [[0, 0], [a + 0.36, 0], [a + 0.5, 0.7, "settle"], [a + 0.95, 0], [D, 0]],
      } }),
    G("track", [
      P("track-base", rrect(-160, -80, 320, 160, 80), "$off", {
        animate: { fill: [[0, "$off"], [a + 0.16, "$off"], [a + 0.44, "$on"], [b + 0.16, "$on"], [b + 0.44, "$off"], [D, "$off"]] } }),
      P("track-shadow", blob([[-150, -18], [-128, -58], [-80, -74], [80, -74], [128, -58], [150, -18], [118, -44], [76, -54], [-76, -54], [-118, -44]], 0.2), "$ink", { opacity: 0.13 }),
      P("track-shine", rrect(-96, 56, 192, 9, 4.5), "$white", { opacity: 0.45 }),
    ], { x: 256, y: 256,
      animate: { scale: [[0, [1, 1]], [a + 0.04, [1, 1]], [a + 0.12, [0.97, 0.97]], [a + 0.42, [1.02, 1.02], "snap"], [a + 0.7, [1, 1]],
        [b + 0.04, [1, 1]], [b + 0.12, [0.97, 0.97]], [b + 0.42, [1.02, 1.02], "snap"], [b + 0.7, [1, 1]], [D, [1, 1]]] } }),
    G("knob", [
      { id: "knob-shadow", type: "ellipse", rx: 60, ry: 60, y: 9, fill: "$ink", opacity: 0.2 },
      P("knob-body", oval(0, 0, 62), "$white"),
      P("knob-shade", blob([[-50, 30], [-22, 50], [14, 54], [46, 34], [58, 6], [40, 44], [8, 62], [-30, 54]], 0.2), "$dim"),
      S("knob-tick", "M -22 2 L -6 18 L 24 -16", "$on", 12, { trim: { start: 0, end: 0 },
        animate: { "trim.end": [[0, 0], [a + 0.34, 0], [a + 0.62, 1, "snap"], [b, 1], [b + 0.16, 0], [D, 0]] } }),
    ], { x: off, y: 256,
      animate: {
        x: [[0, off], [a, off], [a + 0.1, off - 7], { t: a + 0.4, v: on, ease: "snap", overshoot: os }, [b, on], [b + 0.1, on + 7], { t: b + 0.4, v: off, ease: "snap", overshoot: os }, [D, off]],
        scale: [[0, [1, 1]], [a + 0.12, [1, 1]], [a + 0.27, [1.2, 0.9], "snap"], [a + 0.46, [0.95, 1.04]], [a + 0.66, [1, 1]],
          [b + 0.12, [1, 1]], [b + 0.27, [1.2, 0.9], "snap"], [b + 0.46, [0.95, 1.04]], [b + 0.66, [1, 1]], [D, [1, 1]]],
      } }),
  ], "smooth"),
});
