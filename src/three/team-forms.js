import { BufferAttribute, BufferGeometry, CatmullRomCurve3, Vector3 } from "three";
import { MarchingCubes } from "three/addons/objects/MarchingCubes.js";

const rings = 26;
const sides = 16;
const forward = new Vector3(0, 0, 1);

// Use one continuous surface through the shoulder, elbow and wrist.
export function taperedForm(points, radii) {
  const geometry = new BufferGeometry();
  const positions = new Float32Array((rings + 1) * sides * 3);
  const normals = new Float32Array(positions.length);
  const indices = [];
  for (let ring = 0; ring < rings; ring++) {
    for (let side = 0; side < sides; side++) {
      const start = ring * sides;
      const a = start + side;
      const b = start + (side + 1) % sides;
      indices.push(a, b, a + sides, b, b + sides, a + sides);
    }
  }
  // Close both ends. The caps hide inside the chest and hand or shoe.
  const last = rings * sides;
  for (let side = 1; side < sides - 1; side++) {
    indices.push(0, side + 1, side, last, last + side, last + side + 1);
  }
  geometry.setIndex(indices);
  geometry.setAttribute("position", new BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new BufferAttribute(normals, 3));

  const curve = new CatmullRomCurve3(points);
  const center = new Vector3();
  const tangent = new Vector3();
  const right = new Vector3();
  const perpendicular = new Vector3();
  const normal = new Vector3();
  const crossSections = Array.from({ length: sides }, (_, side) => {
    const angle = side / sides * 2 * Math.PI;
    return [Math.cos(angle), Math.sin(angle)];
  });

  function update() {
    for (let ring = 0; ring <= rings; ring++) {
      const progress = ring / rings;
      curve.getPoint(progress, center);
      curve.getTangent(progress, tangent);
      right.crossVectors(tangent, forward).normalize();
      perpendicular.crossVectors(tangent, right);
      const segment = progress * (radii.length - 1);
      const index = Math.min(Math.floor(segment), radii.length - 2);
      const fraction = segment - index;
      const radius = radii[index] * (1 - fraction) + radii[index + 1] * fraction;
      for (const [side, [x, y]] of crossSections.entries()) {
        normal.copy(right).multiplyScalar(x).addScaledVector(perpendicular, y);
        const offset = (ring * sides + side) * 3;
        normals[offset] = normal.x;
        normals[offset + 1] = normal.y;
        normals[offset + 2] = normal.z;
        positions[offset] = center.x + normal.x * radius;
        positions[offset + 1] = center.y + normal.y * radius;
        positions[offset + 2] = center.z + normal.z * radius;
      }
    }
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.normal.needsUpdate = true;
    geometry.computeBoundingSphere();
  }

  update();
  return { geometry, update };
}

const handMeshes = new Map();

function finger(segments, points, radius) {
  for (let index = 0; index < points.length - 1; index++) {
    const [x, y, z] = points[index];
    const [endX, endY, endZ] = points[index + 1];
    const dx = endX - x;
    const dy = endY - y;
    const dz = endZ - z;
    segments.push({ x, y, z, dx, dy, dz, lengthSquared: dx * dx + dy * dy + dz * dz,
      radius: radius * (1 - index * 0.13) });
  }
}

function handDigits(pose) {
  const digits = [];
  const fingerCenters = [-0.063, -0.026, 0.012, 0.049];
  for (const [index, x] of fingerCenters.entries()) {
    const radius = [0.016, 0.018, 0.018, 0.017][index];
    if (pose === "glasses" && index >= 2) {
      const tip = index === 3 ? 0.238 : 0.211;
      finger(digits, [[x, 0.11, 0.001], [x + 0.006, tip - 0.047, 0.016], [x + 0.013, tip, 0.049]], radius);
    } else if (pose === "wave") {
      const tipY = [0.214, 0.265, 0.287, 0.258][index];
      const spread = [0.019, 0.008, -0.005, -0.018][index];
      finger(digits, [[x, 0.116, 0.001], [x - spread * 0.7, tipY - 0.049, -0.01],
        [x - spread, tipY, 0.002]], radius);
    } else {
      const bend = [0.151, 0.172, 0.183, 0.171][index];
      finger(digits, [[x, 0.108, 0], [x, bend, 0.019], [x + 0.004, bend - 0.029, 0.050],
        [x + 0.008, bend - 0.052, 0.056]], radius);
    }
  }
  if (pose === "wave") {
    finger(digits, [[0.047, 0.052, 0.013], [0.083, 0.082, 0.023], [0.121, 0.122, 0.031]], 0.026);
  } else {
    finger(digits, [[0.05, 0.056, 0.013], [0.079, 0.091, 0.031], [0.054, 0.122, 0.061]], 0.026);
  }
  return digits;
}

// Blend palm, wrist, and curved digits into one rounded surface for each pose.
export function sculptedHand(pose, finish) {
  if (handMeshes.has(pose)) return handMeshes.get(pose);
  const digits = handDigits(pose);
  const resolution = 48;
  const half = resolution / 2;
  const width = 0.165;
  const height = 0.224;
  const depth = 0.105;
  const verticalCenter = 0.128;
  const surface = new MarchingCubes(resolution, finish, false, false, 14000);
  surface.isolation = 0;
  for (let z = 0; z < resolution; z++) {
    const pz = (z / half - 1) * depth;
    for (let y = 0; y < resolution; y++) {
      const py = (y / half - 1) * height + verticalCenter;
      for (let x = 0; x < resolution; x++) {
        const px = (x / half - 1) * width;
        const palm = (Math.hypot(px / 0.074, (py - 0.069) / 0.086, pz / 0.042) - 1) * 0.042;
        const wrist = (Math.hypot(px / 0.048, (py + 0.02) / 0.051, pz / 0.037) - 1) * 0.037;
        let distance = Math.min(palm, wrist);
        for (const part of digits) {
          const dx = px - part.x;
          const dy = py - part.y;
          const dz = pz - part.z;
          const t = Math.max(0, Math.min(1, (dx * part.dx + dy * part.dy + dz * part.dz) / part.lengthSquared));
          const digit = Math.hypot(dx - t * part.dx, dy - t * part.dy, dz - t * part.dz) - part.radius;
          const blend = Math.max(0, 0.009 - Math.abs(distance - digit)) / 0.009;
          distance = Math.min(distance, digit) - blend * blend * 0.00225;
        }
        surface.setCell(x, y, z, -distance);
      }
    }
  }
  surface.update();
  const geometry = surface.geometry;
  geometry.scale(width, height, depth);
  geometry.translate(0, verticalCenter, 0);
  handMeshes.set(pose, geometry);
  return geometry;
}

export function teamHairGeometry(style) {
  const bob = style === "bob";
  const around = 80;
  const crown = 32;
  const positions = [];
  const indices = [];
  for (let row = 0; row <= crown + 2; row++) {
    const fraction = Math.min(1, row / crown);
    for (let column = 0; column < around; column++) {
      const theta = column / around * 2 * Math.PI;
      const front = Math.cos(theta);
      const transition = Math.max(0, Math.min(1, (0.78 - front) / 0.93));
      const sides = transition * transition * (3 - 2 * transition);
      const back = Math.max(0, -front);
      const sweep = Math.sin(theta) * (1 - sides);
      const hairline = bob
        ? 1.29 + 0.94 * sides + 0.26 * back + 0.19 * sweep
        : 1.05 + 0.49 * sides + 0.72 * back + 0.07 * sweep;
      const phi = Math.max(0.001, fraction * hairline);
      const flare = bob ? 1 + 0.21 * sides * fraction ** 7 : 1;
      const sweptRidges = bob ? 0.004 * Math.sin(7 * theta + 3 * phi) * Math.sin(phi)
        : 0.0045 * Math.sin(17 * theta + 9 * phi) * Math.sin(phi) ** 2;
      const rolled = row === crown + 1;
      const underside = row === crown + 2;
      const edgeThickness = bob ? 0.08 + 0.23 * sides : 0.09;
      const inset = underside ? 1 - edgeThickness : rolled ? 0.978 : 1;
      positions.push(
        (0.35 + sweptRidges) * Math.sin(theta) * Math.sin(phi) * flare * inset,
        0.022 + (0.429 + sweptRidges) * Math.cos(phi) + (underside ? 0.012 : rolled ? -0.009 : 0),
        -0.012 + (0.318 + sweptRidges) * front * Math.sin(phi) * flare * inset,
      );
      if (row === crown + 2) continue;
      const a = row * around + column;
      const b = row * around + (column + 1) % around;
      indices.push(a, a + around, b, b, a + around, b + around);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
