import {
  CanvasTexture, CapsuleGeometry, CylinderGeometry, ExtrudeGeometry, Group, Mesh,
  MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, Shape, SphereGeometry, TorusGeometry, Vector3,
} from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { sculptedHand, teamHairGeometry, taperedForm } from "./team-forms.js";
import { sewnPanel, skirtGeometry, skirtWaistband, torsoCut, trousersGeometry } from "./team-clothes.js";

const tau = 2 * Math.PI;
const material = (color, metalness = 0) => new MeshStandardMaterial({ color, roughness: 0.47, metalness });
const sphere = new SphereGeometry(1, 32, 24);

function mesh(parent, geometry, finish, position) {
  const part = new Mesh(geometry, finish);
  part.position.set(...position);
  parent.add(part);
  return part;
}

function oval(parent, finish, position, scale) {
  const part = mesh(parent, sphere, finish, position);
  part.scale.set(...scale);
  return part;
}

function pill(parent, finish, from, to, radius) {
  const start = new Vector3(...from);
  const end = new Vector3(...to);
  const bar = mesh(parent, new CapsuleGeometry(radius, start.distanceTo(end), 8, 16), finish,
    start.clone().lerp(end, 0.5).toArray());
  bar.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.sub(start).normalize());
  return bar;
}

function box(parent, finish, position, size, radius) {
  return mesh(parent, new RoundedBoxGeometry(...size, 4, radius), finish, position);
}

const dark = material("#392a2b");
const white = material("#fff7ee");
const smile = material("#724039");
const glassesFrame = material("#344d62");

function person({ x, z, height, skin, hair, top, pants, shoes, style, yaw }) {
  const root = new Group();
  root.position.set(x, -2.08, z);
  root.scale.setScalar(height);
  root.rotation.y = yaw;
  const complexion = material(skin);
  const hairColor = material(hair);
  const shirt = material(top);
  const trousers = material(pants);
  const footwear = material(shoes);
  const torso = new Group();
  torso.position.y = 1.93;
  root.add(torso);

  for (const side of [-1, 1]) {
    const ankle = [side * 0.29, 0.205, 0.05];
    if (style === "glasses") {
      const points = [[side * 0.24, 1.15, 0], [side * 0.25, 0.93, 0.016], ankle]
        .map((position) => new Vector3(...position));
      const leg = taperedForm(points, [0.091, 0.084, 0.057]);
      mesh(root, leg.geometry, complexion, [0, 0, 0]);
    }
    oval(root, footwear, [ankle[0], 0.114, 0.148], [0.153, 0.105, 0.264]);
    box(root, white, [ankle[0], 0.049, 0.148], [0.27, 0.059, 0.456], 0.025);
  }
  if (style === "glasses") {
    mesh(root, skirtGeometry(), trousers, [0, 0, 0]).scale.z = 0.68;
  } else {
    mesh(root, trousersGeometry(trousers), trousers, [0, 0, 0]);
  }

  const cut = torsoCut(style);
  mesh(torso, cut.geometry, shirt, [0, 0, 0]);
  function panel(finish, rows, offset = 0.004) {
    return mesh(torso, sewnPanel(cut, rows, offset), finish, [0, 0, 0]);
  }
  function pair(finish, rows, offset) {
    panel(finish, rows, offset);
    panel(finish, rows.map(([y, inner, outer]) => [y, -outer, -inner]), offset);
  }
  if (style === "suit") {
    panel(white, [[0.33, -0.012, 0.012], [0.52, -0.079, 0.079], [0.76, -0.13, 0.13], [0.91, -0.137, 0.137], [1.009, -0.105, 0.105]]);
    const lapel = material("#2b5782");
    pair(lapel, [[0.27, 0.008, 0.031], [0.48, 0.042, 0.091], [0.66, 0.093, 0.171],
      [0.766, 0.116, 0.215], [0.791, 0.107, 0.178], [0.852, 0.122, 0.213], [0.955, 0.138, 0.168]], 0.013);
    panel(material("#d74759"), [[0.435, -0.002, 0.002], [0.485, -0.039, 0.046], [0.64, -0.024, 0.031],
      [0.832, -0.018, 0.022], [0.884, -0.031, 0.032], [0.923, -0.018, 0.019]], 0.014);
    for (const y of [0.245, 0.43]) {
      oval(torso, dark, [0.025, y, cut.front(0.025, y) + 0.01], [0.022, 0.022, 0.012]);
    }
    pair(material("#203c56"), [[0.164, 0.16, 0.283], [0.205, 0.153, 0.289]], 0.008);
  } else if (style === "long") {
    panel(white, [[-0.046, -0.29, 0.29], [0.05, -0.236, 0.243], [0.22, -0.16, 0.168], [0.38, -0.104, 0.114],
      [0.59, -0.114, 0.124], [0.77, -0.166, 0.17], [0.93, -0.154, 0.154], [1.009, -0.106, 0.106]]);
    pair(material("#6089b4"), [[0.14, 0.169, 0.215], [0.40, 0.106, 0.145], [0.64, 0.123, 0.195],
      [0.752, 0.166, 0.226], [0.80, 0.148, 0.207], [0.91, 0.158, 0.204], [0.958, 0.142, 0.165]], 0.009);
  } else if (style === "wave") {
    const trim = material("#91b9ca");
    panel(trim, [[0.081, -0.018, 0.018], [0.925, -0.019, 0.019]], 0.005);
    pair(trim, [[0.795, 0.07, 0.085], [0.902, 0.019, 0.13], [1.001, 0.075, 0.126]], 0.01);
    for (const y of [0.21, 0.37, 0.53, 0.69, 0.83]) {
      oval(torso, white, [0, y, cut.front(0, y) + 0.006], [0.014, 0.014, 0.009]);
    }
    panel(trim, [[0.55, 0.194, 0.268], [0.579, 0.174, 0.292], [0.708, 0.174, 0.292]], 0.008);
  } else {
    panel(complexion, [[0.808, -0.01, 0.01], [0.829, -0.079, 0.079], [0.879, -0.141, 0.141],
      [0.952, -0.151, 0.151], [1.015, -0.112, 0.112]], 0.007);
  }
  if (style === "wave") {
    const buckle = material("#c3a181", 0.24);
    mesh(torso, cut.band(-0.047, 0.028), material("#714936"), [0, 0, 0]);
    box(torso, buckle, [0, -0.01, cut.front(0, -0.01) + 0.012], [0.103, 0.074, 0.026], 0.012);
  } else if (style === "glasses") {
    mesh(root, skirtWaistband(), material("#c88c40"), [0, 0, 0]);
    box(root, material("#e6ac4f", 0.24), [0, 1.889, 0.292], [0.098, 0.063, 0.025], 0.012);
  }

  pill(torso, complexion, [0, 0.9, 0], [0, 1.13, 0], 0.14);
  const head = new Group();
  head.position.set(0, 1.39, 0.025);
  torso.add(head);
  if (style === "long") {
    oval(head, hairColor, [0, -0.29, -0.13], [0.365, 0.82, 0.24]);
  }
  oval(head, complexion, [0, 0, 0], [0.325, 0.405, 0.29]);
  if (style === "suit") oval(head, hairColor, [0, -0.18, 0.046], [0.298, 0.257, 0.262]);
  if (style === "glasses" || style === "wave") {
    mesh(head, teamHairGeometry(style === "glasses" ? "bob" : "short"), hairColor, [0, 0, 0]);
  } else {
    const hairCap = oval(head, hairColor, [0, 0.24, -0.049], [0.335, 0.225, 0.272]);
    hairCap.rotation.z = -0.12;
  }
  if (style === "long" || style === "suit") {
    const fringe = oval(head, hairColor, [-0.062, 0.28, 0.149], [0.254, 0.104, 0.159]);
    fringe.rotation.z = style === "suit" ? 0.47 : -0.32;
  }

  const eyes = [];
  for (const side of [-1, 1]) {
    oval(head, complexion, [side * 0.315, -0.024, 0.006], [0.062, 0.093, 0.068]);
    const eye = new Group();
    eye.position.set(side * 0.118, 0.044, 0.266);
    head.add(eye);
    oval(eye, white, [0, 0, 0], [0.047, 0.045, 0.021]);
    oval(eye, dark, [0.004, 0, 0.016], [0.025, 0.032, 0.014]);
    oval(eye, white, [0.012, 0.012, 0.026], [0.009, 0.009, 0.006]);
    eyes.push(eye);
    const brow = oval(head, hairColor, [side * 0.121, 0.119, 0.266], [0.064, 0.017, 0.02]);
    brow.rotation.z = side * -0.1;
    if (style === "glasses") {
      const rim = mesh(head, new TorusGeometry(0.076, 0.011, 10, 32), glassesFrame, [side * 0.123, 0.039, 0.293]);
      rim.scale.y = 0.83;
      rim.rotation.y = side * 0.18;
    }
  }
  if (style === "glasses") pill(head, dark, [-0.044, 0.048, 0.297], [0.044, 0.048, 0.297], 0.009);
  oval(head, complexion, [0, -0.044, 0.293], [0.066, 0.076, 0.063]);
  oval(head, smile, [0, -0.16, style === "suit" ? 0.305 : 0.259], [0.096, 0.046, 0.025]);
  oval(head, white, [0, -0.148, style === "suit" ? 0.323 : 0.278], [0.069, 0.017, 0.012]);

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new Group();
    shoulder.position.set(side * 0.38, 0.79, -0.01);
    torso.add(shoulder);
    const waving = style === "wave" && side === -1;
    const folded = style === "long";
    const hip = style === "suit";
    const adjustsGlasses = style === "glasses" && side === -1;
    let elbow = [side * 0.20, -0.34, 0.033];
    let wrist = [side * 0.23, -0.76, 0.10];
    if (waving) {
      elbow = [-0.37, 0.04, 0.024];
      wrist = [-0.47, 0.5, 0.04];
    } else if (folded) {
      elbow = [side * 0.105, side === -1 ? -0.49 : -0.37, 0.11];
      wrist = [-side * 0.55, side === -1 ? -0.41 : -0.22, side === -1 ? 0.30 : 0.37];
    } else if (hip) {
      elbow = [side * 0.29, -0.29, 0.027];
      wrist = [side * 0.01, -0.60, 0.175];
    }
    const forearm = new Group();
    forearm.position.set(...elbow);
    shoulder.add(forearm);
    const wristOffset = wrist.map((coordinate, index) => coordinate - elbow[index]);
    const hand = new Group();
    hand.position.set(...wristOffset);
    forearm.add(hand);

    const sleevePoints = [
      new Vector3(-side * 0.16, -0.008, 0),
      new Vector3(...elbow),
      new Vector3(...wrist),
    ];
    const sleeve = taperedForm(sleevePoints, [0.154, 0.128, 0.106, 0.072]);
    mesh(shoulder, sleeve.geometry, shirt, [0, 0, 0]);
    const handPose = waving ? "wave" : adjustsGlasses ? "glasses" : "relaxed";
    const palm = mesh(hand, sculptedHand(handPose, complexion), complexion, [0, 0, 0]);
    if (side === 1) palm.scale.x = -1;
    const direction = new Vector3(...wristOffset);
    if (hip) direction.set(-side * 0.87, -0.19, 0.25);
    const up = new Vector3(0, 1, 0);
    palm.quaternion.setFromUnitVectors(up, direction.normalize());
    palm.rotateY(waving ? -0.19 : hip ? -side * 0.52 : side * 0.32);

    const restWrist = new Vector3(...wrist);
    const glassesWrist = new Vector3(0.058, 0.485, 0.283);
    const reach = new Vector3();
    const pole = new Vector3();
    const palmUp = new Vector3(0.28, 0.94, -0.08).normalize();
    arms.push({
      shoulder, forearm, hand,
      reachForGlasses(weight) {
        // Solve for the elbow with fixed upper- and lower-arm lengths.
        reach.copy(restWrist).lerp(glassesWrist, weight);
        reach.x -= 0.19 * Math.sin(Math.PI * weight);
        reach.z += 0.20 * Math.sin(Math.PI * weight);
        const distance = reach.length();
        direction.copy(reach).divideScalar(distance);
        pole.set(-1, 0, 0.12).addScaledVector(direction, direction.x - 0.12 * direction.z).normalize();
        const along = (0.43 ** 2 - 0.46 ** 2 + distance ** 2) / (2 * distance);
        forearm.position.copy(direction).multiplyScalar(along)
          .addScaledVector(pole, Math.sqrt(Math.max(0, 0.43 ** 2 - along ** 2)));
        hand.position.copy(reach).sub(forearm.position);
        direction.copy(hand.position).normalize().lerp(palmUp, weight).normalize();
        palm.quaternion.setFromUnitVectors(up, direction);
        palm.rotateY(-0.32 - 0.43 * weight);
      },
      updateSleeve() {
        sleevePoints[1].copy(forearm.position);
        sleevePoints[2].copy(hand.position).applyQuaternion(forearm.quaternion).add(forearm.position);
        sleeve.update();
      },
    });
  }
  if (style === "glasses") {
    const hand = arms[1].hand;
    const notebook = new Group();
    notebook.position.set(0.057, -0.056, 0.055);
    notebook.rotation.set(-0.06, -0.30, 0.12);
    hand.add(notebook);
    const cover = material("#e8ac39");
    box(notebook, white, [0, 0, 0], [0.26, 0.38, 0.055], 0.018);
    for (const z of [-0.034, 0.034]) {
      box(notebook, cover, [0, 0, z], [0.29, 0.41, 0.026], 0.012);
    }
    box(notebook, cover, [-0.138, 0, 0], [0.035, 0.41, 0.079], 0.015);
  }
  return { root, torso, head, eyes, arms };
}

export function createTeam() {
  const root = new Group();
  const people = [
    { x: -1.61, z: -0.21, height: 1.07, skin: "#a76649", hair: "#30373b", top: "#a8cfdf", pants: "#bd894d", shoes: "#f4ede2", style: "wave", yaw: 0.13 },
    { x: -0.56, z: 0.22, height: 0.97, skin: "#f1b18b", hair: "#df9e53", top: "#466b99", pants: "#3f618e", shoes: "#d65364", style: "long", yaw: -0.19 },
    { x: 0.6, z: 0.29, height: 1.02, skin: "#edaa86", hair: "#714633", top: "#234c77", pants: "#254567", shoes: "#794c40", style: "suit", yaw: 0.12 },
    { x: 1.73, z: -0.15, height: 0.96, skin: "#d99470", hair: "#473536", top: "#fff4eb", pants: "#55749f", shoes: "#4d648a", style: "glasses", yaw: -0.18 },
  ].map(person);
  const shadowCanvas = document.createElement("canvas");
  shadowCanvas.width = shadowCanvas.height = 64;
  const ctx = shadowCanvas.getContext("2d");
  const fade = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  fade.addColorStop(0, "rgba(68, 58, 50, 0.22)");
  fade.addColorStop(0.45, "rgba(68, 58, 50, 0.12)");
  fade.addColorStop(1, "rgba(49, 37, 28, 0)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, 64, 64);
  const shadow = new MeshBasicMaterial({ map: new CanvasTexture(shadowCanvas), transparent: true, depthWrite: false });
  const shadowPlane = new PlaneGeometry(1.18, 0.83);
  for (const { root: figure } of people) {
    root.add(figure);
    mesh(root, shadowPlane, shadow, [figure.position.x, -2.058, figure.position.z + 0.1]).rotation.x = -Math.PI / 2;
  }

  const heart = new Shape();
  heart.moveTo(0, -0.22);
  heart.bezierCurveTo(-0.2, -0.06, -0.34, 0.093, -0.19, 0.216);
  heart.bezierCurveTo(-0.12, 0.27, -0.038, 0.233, 0, 0.164);
  heart.bezierCurveTo(0.038, 0.233, 0.12, 0.27, 0.19, 0.216);
  heart.bezierCurveTo(0.34, 0.093, 0.2, -0.06, 0, -0.22);
  const like = new Group();
  oval(like, material("#407ee0"), [0, 0, 0], [0.275, 0.275, 0.15]);
  box(like, white, [0.041, -0.022, 0.145], [0.16, 0.131, 0.046], 0.022);
  pill(like, white, [0.021, 0.028, 0.163], [0.062, 0.113, 0.157], 0.034);
  box(like, white, [-0.089, -0.029, 0.129], [0.063, 0.134, 0.035], 0.013);
  like.position.set(2.43, 1.84, 0.07);
  root.add(like);
  const gold = material("#eab13d", 0.33);
  const coins = [[-2.53, -0.56, 0.25], [2.56, -0.31, 0.14]].map((position) => {
    const coin = new Group();
    mesh(coin, new CylinderGeometry(0.18, 0.18, 0.064, 40), gold, [0, 0, 0]).rotation.x = Math.PI / 2;
    mesh(coin, new CylinderGeometry(0.135, 0.135, 0.071, 40), material("#ffd171", 0.26), [0, 0, 0]).rotation.x = Math.PI / 2;
    coin.position.set(...position);
    root.add(coin);
    return coin;
  });
  const love = mesh(root, new ExtrudeGeometry(heart, {
    depth: 0.075, bevelEnabled: true, bevelThickness: 0.045, bevelSize: 0.038, bevelSegments: 5, curveSegments: 20,
  }), material("#ea545e"), [-1.66, 2.19, 0.27]);
  const smallLike = like.clone();
  smallLike.position.set(-2.39, -1.35, 0.25);
  smallLike.scale.setScalar(0.64);
  root.add(smallLike);
  const reactions = [love, like, smallLike, ...coins];
  const anchors = reactions.map((reaction) => reaction.position.clone());

  return {
    root,
    pose(progress) {
      const angle = progress * tau;
      for (const [i, { torso, head, eyes }] of people.entries()) {
        const beat = angle * 2 + i * 1.3;
        torso.position.y = 1.93 + 0.036 * Math.sin(beat);
        torso.rotation.z = 0.062 * Math.sin(beat);
        torso.rotation.x = 0.035 * Math.cos(beat);
        head.rotation.y = 0.22 * Math.sin(angle + i * 1.5);
        head.rotation.z = 0.08 * Math.sin(beat + 0.8);
        head.rotation.x = 0.12 * pulse(progress, 0.18 + i * 0.028, 0.065);
        const blink = pulse(progress, 0.22 + i * 0.13, 0.023);
        for (const eye of eyes) eye.scale.y = 1 - 0.92 * blink;
      }

      const wave = pulse(progress, 0.18, 0.17);
      const waveBeat = angle * 6;
      const { shoulder, forearm, hand } = people[0].arms[0];
      shoulder.rotation.set(0.10 * wave, -0.14 * wave, -0.13 * wave);
      forearm.rotation.z = wave * (0.12 + 0.48 * Math.sin(waveBeat));
      hand.rotation.z = 0.29 * wave * Math.sin(waveBeat - 0.85);
      hand.rotation.y = 0.22 * wave * Math.cos(waveBeat);
      people[0].head.rotation.y -= 0.16 * wave;

      const nod = Math.max(pulse(progress, 0.36, 0.07), 0.55 * pulse(progress, 0.45, 0.056));
      const second = people[1];
      second.head.rotation.x += 0.27 * nod;
      second.head.rotation.y += 0.28 * pulse(progress, 0.44, 0.16);
      second.torso.rotation.z -= 0.08 * nod;
      second.arms[1].forearm.rotation.x = -0.08 * nod;
      second.arms[0].forearm.rotation.y = 0.10 * nod;

      const confidence = pulse(progress, 0.57, 0.17);
      const third = people[2];
      third.head.rotation.x -= 0.15 * confidence;
      third.head.rotation.y += 0.14 * confidence;
      third.torso.rotation.z += 0.045 * confidence;

      const glasses = pulse(progress, 0.77, 0.20);
      const fourth = people[3];
      fourth.arms[0].reachForGlasses(glasses);
      fourth.head.rotation.x += 0.10 * glasses;
      fourth.head.rotation.y -= 0.10 * glasses;

      for (const figure of people) {
        for (const arm of figure.arms) arm.updateSleeve();
      }

      for (const [i, reaction] of reactions.entries()) {
        const orbit = angle * (i < 3 ? 2 : 1) + i * 1.4;
        reaction.position.set(
          anchors[i].x + 0.23 * Math.cos(orbit),
          anchors[i].y + (i < 3 ? 0.21 : 0.31) * Math.sin(orbit),
          anchors[i].z + 0.29 * Math.sin(orbit + 0.7),
        );
        reaction.rotation.y = i < 3 ? 0.65 * Math.sin(orbit) : angle * 2 + i;
        reaction.rotation.z = (i % 2 ? 0.18 : -0.19) + 0.21 * Math.sin(orbit + 0.4);
      }
    },
  };
}

function pulse(progress, center, halfWidth) {
  const distance = Math.min(1, Math.abs(progress - center) / halfWidth);
  return (1 + Math.cos(Math.PI * distance)) * 0.5;
}
