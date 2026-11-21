import {
  CircleGeometry, CylinderGeometry, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, SphereGeometry,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const tau = Math.PI * 2;

export function createRobot(shell) {
  const root = new Group();
  const character = new Group();
  const body = new Group();
  const head = new Group();
  body.position.y = -0.45;
  head.position.set(0, 1.04, 0.025);
  root.add(character);
  character.add(body);
  body.add(head);

  const graphite = new MeshStandardMaterial({ color: "#26303e", roughness: 0.52 });
  const screen = new MeshStandardMaterial({ color: "#091829", roughness: 0.38 });
  const trim = new MeshStandardMaterial({ color: "#efa967", metalness: 0.25, roughness: 0.4 });
  const deck = new MeshStandardMaterial({ color: "#435875", roughness: 0.64 });
  const light = new MeshBasicMaterial({ color: "#a5fff0" });
  const mutedLight = new MeshBasicMaterial({ color: "#51bac0" });

  function part(parent, geometry, material, x, y, z) {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(x, y, z);
    parent.add(mesh);
    return mesh;
  }

  function box(parent, material, x, y, z, width, height, depth, radius) {
    return part(parent, new RoundedBoxGeometry(width, height, depth, 4, radius), material, x, y, z);
  }

  // The platform stays fixed while the character crosses it.
  part(root, new CylinderGeometry(1.32, 1.43, 0.17, 64), deck, 0, -1.2, 0);
  part(root, new CylinderGeometry(1.37, 1.32, 0.044, 64), trim, 0, -1.277, 0);
  const contact = part(root, new CircleGeometry(1, 48), new MeshBasicMaterial({
    color: "#202d43", transparent: true, opacity: 0.48, depthWrite: false,
  }), 0, -1.114, 0.05);
  contact.rotation.x = -Math.PI / 2;
  contact.scale.set(0.81, 0.5, 1);
  box(root, graphite, 1.06, -1.067, 0.29, 0.39, 0.105, 0.41, 0.045);
  box(root, deck, 1.15, -0.81, 0.29, 0.15, 0.46, 0.19, 0.06);
  box(root, graphite, 1.17, -0.57, 0.29, 0.45, 0.15, 0.43, 0.066);
  const signal = new MeshBasicMaterial({ color: "#4a827e" });
  const consoleKey = box(root, signal, 1.255, -0.484, 0.46, 0.15, 0.055, 0.19, 0.025);
  box(root, trim, 1.04, -0.484, 0.3, 0.085, 0.061, 0.12, 0.026);
  const display = box(root, screen, 1.35, -0.32, 0.29, 0.095, 0.32, 0.39, 0.044);
  display.rotation.z = -0.24;
  for (const z of [0.2, 0.29, 0.38]) {
    const indicator = box(root, signal, 1.307, -0.30, z, 0.025, 0.08, 0.045, 0.009);
    indicator.rotation.z = display.rotation.z;
  }

  const legs = [-0.32, 0.32].map((x) => {
    const leg = new Group();
    leg.position.set(x, -0.9, 0);
    character.add(leg);
    const shin = box(leg, graphite, 0, 0.006, 0, 0.26, 0.31, 0.28, 0.07);
    box(leg, shell, 0, -0.105, 0.15, 0.46, 0.22, 0.66, 0.105);
    return { leg, shin };
  });

  box(body, shell, 0, 0, 0, 1.12, 0.88, 0.76, 0.19);
  box(body, graphite, 0, 0.015, -0.38, 0.68, 0.48, 0.16, 0.075);
  for (const y of [-0.105, 0.015, 0.135]) {
    box(body, deck, 0, y, -0.465, 0.33, 0.039, 0.027, 0.013);
  }
  box(body, graphite, 0, -0.02, 0.373, 0.56, 0.33, 0.073, 0.035);
  for (const x of [-0.145, 0, 0.145]) {
    box(body, x === 0 ? light : mutedLight, x, -0.016, 0.419, 0.057, 0.079, 0.02, 0.009);
  }
  part(body, new CylinderGeometry(0.22, 0.25, 0.32, 32), graphite, 0, 0.49, 0);

  box(head, shell, 0, 0, 0, 1.61, 1.22, 0.95, 0.24);
  box(head, graphite, 0, -0.015, 0.435, 1.37, 0.96, 0.19, 0.094);
  box(head, screen, 0, -0.015, 0.526, 1.22, 0.81, 0.085, 0.042);
  const eyes = [-0.26, 0.26].map((x) =>
    box(head, light, x, 0.07, 0.58, 0.135, 0.245, 0.045, 0.022));
  for (const x of [-0.42, 0.42]) {
    box(head, mutedLight, x, -0.14, 0.58, 0.105, 0.031, 0.024, 0.011);
  }
  box(head, light, 0, -0.185, 0.58, 0.112, 0.029, 0.023, 0.011);
  for (const side of [-1, 1]) {
    const ear = part(head, new CylinderGeometry(0.223, 0.223, 0.15, 32), trim, side * 0.805, 0, 0);
    ear.rotation.z = Math.PI / 2;
  }
  const antenna = new Group();
  antenna.position.set(-0.35, 0.55, -0.06);
  antenna.rotation.z = 0.17;
  head.add(antenna);
  part(antenna, new CylinderGeometry(0.031, 0.044, 0.3, 16), graphite, 0, 0.16, 0);
  part(antenna, new SphereGeometry(0.098, 24, 16), trim, 0, 0.345, 0);

  function makeArm(side) {
    const shoulder = new Group();
    const elbow = new Group();
    shoulder.position.set(side * 0.56, 0.2, 0.025);
    shoulder.rotation.z = side * 0.14;
    elbow.position.y = -0.37;
    body.add(shoulder);
    shoulder.add(elbow);
    part(shoulder, new SphereGeometry(0.17, 24, 16), trim, 0, 0, 0);
    box(shoulder, shell, 0, -0.19, 0, 0.24, 0.35, 0.28, 0.11);
    part(elbow, new SphereGeometry(0.119, 24, 16), graphite, 0, 0, 0);
    box(elbow, shell, 0, -0.15, 0, 0.22, 0.25, 0.25, 0.1);
    box(elbow, trim, 0, -0.31, 0.025, 0.29, 0.18, 0.23, 0.083);
    return { shoulder, elbow };
  }

  const arms = [-1, 1].map(makeArm);

  function pose(progress) {
    const breath = Math.sin(progress * tau * 2);
    const outbound = ease(progress, 0.18, 0.34);
    const inbound = ease(progress, 0.62, 0.78);
    const walking = progress < 0.5 ? outbound : inbound;
    const weight = ease(walking, 0, 0.16) * (1 - ease(walking, 0.84, 1));
    const cycles = walking * 2;
    const stride = 0.62;
    const swing = Math.cos(cycles * tau) * weight;
    const bounce = 0.038 * weight * (1 - Math.cos(cycles * tau * 2));
    const yaw = Math.PI * (
      0.5 * ease(progress, 0.12, 0.18)
      + ease(progress, 0.50, 0.62)
      + 0.5 * ease(progress, 0.78, 0.87)
    );

    character.position.x = -stride + stride * 2 * (outbound - inbound);
    character.rotation.y = yaw === tau ? 0 : yaw;
    contact.position.x = character.position.x;
    contact.rotation.z = character.rotation.y;

    body.position.y = -0.45 + breath * 0.023 + bounce;
    body.scale.y = 1 + breath * 0.018;
    body.rotation.z = swing * 0.045;
    body.rotation.x = weight * 0.065;

    for (const [index, { leg, shin }] of legs.entries()) {
      const step = (cycles + index * 0.5) % 1;
      // During stance, the foot travels backward by the distance the body advances.
      const swingTime = Math.max(0, step * 2 - 1);
      const offset = stride * (0.25 - step + ease(swingTime, 0, 1));
      const lift = weight * 0.13 * Math.sin(Math.PI * swingTime) ** 2;
      leg.position.y = -0.9 + lift;
      leg.position.z = weight * offset;
      shin.scale.y = 1 + (bounce - lift) * 2.4;
      shin.rotation.x = -leg.position.z * 1.8;
      arms[index].shoulder.rotation.x = weight * 0.52 * Math.cos(step * tau);
      arms[index].elbow.rotation.x = -0.08 - 0.2 * weight;
    }

    const reach = ease(progress, 0.345, 0.378) * (1 - ease(progress, 0.465, 0.495));
    const press = Math.max(pulse(progress, 0.403, 0.017), pulse(progress, 0.445, 0.017));
    arms[0].shoulder.rotation.x -= reach * (1.25 - 0.20 * press);
    arms[0].elbow.rotation.x -= reach * 0.22;
    consoleKey.position.y = -0.484 - 0.035 * press;
    const power = ease(progress, 0.402, 0.415) * (1 - ease(progress, 0.90, 0.99));
    signal.color.set("#4a827e").lerp(light.color, power);

    const wave = ease(progress, 0.875, 0.903) * (1 - ease(progress, 0.964, 0.995));
    arms[1].shoulder.rotation.z = 0.14 + 1.4 * wave;
    arms[1].elbow.rotation.z = wave * (0.82 + 0.34 * Math.sin(tau * (progress - 0.903) / 0.028));
    const blink = Math.max(pulse(progress, 0.14, 0.018), pulse(progress, 0.92, 0.018));
    for (const eye of eyes) eye.scale.y = 1 - 0.92 * blink;
    const glance = -0.6 * pulse(progress, 0.046, 0.043) + 0.58 * pulse(progress, 0.106, 0.035);
    const lookBack = -0.23 * pulse(progress, 0.83, 0.11);
    head.rotation.set(-0.025 * breath + 0.27 * reach, glance + lookBack, -0.035 * swing - 0.09 * wave);
  }

  return { root, pose };
}

// A cosine pulse has zero velocity at the edges and at the closed blink.
function pulse(progress, center, halfWidth) {
  const distance = Math.min(1, Math.abs(progress - center) / halfWidth);
  return (1 + Math.cos(Math.PI * distance)) * 0.5;
}

function ease(value, start, end) {
  const t = Math.max(0, Math.min(1, (value - start) / (end - start)));
  return t * t * (3 - 2 * t);
}
