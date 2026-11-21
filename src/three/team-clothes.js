import { BufferAttribute, BufferGeometry, LatheGeometry, Path, Shape, Vector2 } from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

function spun(profile) {
  return new LatheGeometry(profile.getPoints(18), 64);
}

export function torsoCut(style) {
  const base = style === "suit" ? -0.105 : -0.06;
  const depth = style === "glasses" ? 0.63 : 0.66;
  const cut = new Path();
  cut.moveTo(0.384, base);
  cut.quadraticCurveTo(0.415, base + 0.01, 0.416, base + 0.055);
  if (style === "long" || style === "glasses") {
    cut.bezierCurveTo(0.406, 0.14, 0.311, 0.23, 0.326, 0.37);
    cut.bezierCurveTo(0.336, 0.49, 0.418, 0.55, 0.412, 0.71);
    cut.quadraticCurveTo(0.402, 0.87, 0.248, 0.939);
  } else {
    cut.bezierCurveTo(0.388, 0.19, 0.422, 0.41, 0.455, 0.62);
    cut.bezierCurveTo(0.488, 0.81, 0.411, 0.89, 0.264, 0.947);
  }
  cut.quadraticCurveTo(0.202, 0.976, 0.145, 1.02);
  const contour = cut.getPoints(24);

  function radiusAt(y) {
    const next = contour.findIndex(point => point.y >= y);
    if (next <= 0) return contour[next < 0 ? contour.length - 1 : 0].x;
    const from = contour[next - 1];
    const to = contour[next];
    return from.x + (to.x - from.x) * (y - from.y) / (to.y - from.y);
  }

  const geometry = new LatheGeometry([new Vector2(0, base), ...contour, new Vector2(0, 1.02)], 64);
  geometry.scale(1, 1, depth);
  return {
    geometry,
    front(x, y) {
      const radius = radiusAt(y);
      return Math.sqrt(Math.max(0, radius * radius - x * x)) * depth;
    },
    band(bottom, top) {
      const profile = [bottom, (bottom + top) / 2, top].map(y => new Vector2(radiusAt(y) + 0.008, y));
      return new LatheGeometry(profile, 64).scale(1, 1, depth);
    },
  };
}

// Sew the panels over the curved torso so the facing and lapels share its silhouette.
export function sewnPanel(cut, rows, offset) {
  const positions = [];
  const triangles = [];
  const lanes = 12;
  function addRow(y, left, right) {
    for (let lane = 0; lane <= lanes; lane++) {
      const x = left + (right - left) * lane / lanes;
      positions.push(x, y, cut.front(x, y) + offset);
    }
  }
  for (let row = 0; row < rows.length - 1; row++) {
    for (let step = 0; step < 6; step++) {
      const fraction = step / 6;
      addRow(...rows[row].map((value, k) => value + (rows[row + 1][k] - value) * fraction));
    }
  }
  addRow(...rows.at(-1));
  for (let row = 0; row < (rows.length - 1) * 6; row++) {
    for (let lane = 0; lane < lanes; lane++) {
      const a = row * (lanes + 1) + lane;
      const b = a + lanes + 1;
      triangles.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const patch = new BufferGeometry();
  patch.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  patch.setIndex(triangles);
  patch.computeVertexNormals();
  return patch;
}

export function skirtGeometry() {
  const profile = new Shape();
  profile.moveTo(0, 0.984);
  profile.lineTo(0.352, 0.984);
  profile.quadraticCurveTo(0.369, 0.989, 0.369, 1.028);
  profile.bezierCurveTo(0.376, 1.25, 0.429, 1.56, 0.433, 1.72);
  profile.quadraticCurveTo(0.43, 1.84, 0.408, 1.892);
  profile.bezierCurveTo(0.398, 1.933, 0.285, 1.937, 0.26, 1.99);
  profile.lineTo(0, 1.99);
  return spun(profile);
}

export function skirtWaistband() {
  const band = new LatheGeometry([
    new Vector2(0.416, 1.859),
    new Vector2(0.425, 1.868),
    new Vector2(0.421, 1.909),
    new Vector2(0.411, 1.918),
  ], 64);
  return band.scale(1, 1, 0.68);
}

let pantsGeometry;

// Extract both legs and the seat from one field so the crotch and waist share a surface.
export function trousersGeometry(finish) {
  if (pantsGeometry) return pantsGeometry;
  const size = 48;
  const half = size / 2;
  const width = 0.56;
  const height = 1.11;
  const depth = 0.39;
  const waist = 1.14;
  const surface = new MarchingCubes(size, finish, false, false, 18000);
  surface.isolation = 0;
  for (let z = 0; z < size; z++) {
    const pz = (z / half - 1) * depth;
    for (let y = 0; y < size; y++) {
      const py = (y / half - 1) * height + waist;
      const t = Math.max(0, Math.min(1, (py - 0.16) / 1.69));
      const radius = 0.087 + t * 0.102;
      for (let x = 0; x < size; x++) {
        const px = (x / half - 1) * width;
        const seat = (Math.hypot(px / 0.393, (py - 1.874) / 0.206, pz / 0.258) - 1) * 0.202;
        const leg = Math.hypot(
          Math.abs(px) - (0.288 - t * 0.081),
          (pz - (1 - t) * 0.044) * 1.06,
          py - (0.16 + t * 1.69),
        ) - radius;
        const blend = Math.max(0, 0.109 - Math.abs(seat - leg)) / 0.109;
        surface.setCell(x, y, z, -(Math.min(seat, leg) - blend * blend * 0.02725));
      }
    }
  }
  surface.update();
  pantsGeometry = surface.geometry;
  pantsGeometry.scale(width, height, depth);
  pantsGeometry.translate(0, waist, 0);
  return pantsGeometry;
}
