import {
  Color, ExtrudeGeometry, Group, Mesh, MeshPhysicalMaterial, Shape,
  SphereGeometry, TetrahedronGeometry,
} from 'three';

const sphere = new SphereGeometry(1, 64, 40);
const facet = new TetrahedronGeometry(1);
const material = (color, roughness = .53) => new MeshPhysicalMaterial({
  color: new Color(color), roughness, metalness: 0, clearcoat: .15,
});
const lavender = material('#a27be9');
const plum = material('#7147c0');
const rim = material('#d4baef');
const screen = material('#e7faff');
const white = material('#f6fcff');
const gold = material('#ffd550', .39);
const ink = material('#422026', .75);
const tongue = material('#ff557f');
const magenta = material('#e338e8', .45);
const pink = material('#ff489d', .44);

function mesh(parent, geometry, surface, x = 0, y = 0, z = 0) {
  const item = new Mesh(geometry, surface);
  item.position.set(x, y, z);
  parent.add(item);
  return item;
}
function ball(parent, surface, x, y, z, sx, sy = sx, sz = sx) {
  const item = mesh(parent, sphere, surface, x, y, z);
  item.scale.set(sx, sy, sz);
  return item;
}
function solid(parent, shape, surface, depth, bevel, x, y, z) {
  return mesh(parent, new ExtrudeGeometry(shape, {
    depth, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel,
    bevelSegments: 4, curveSegments: 24, steps: 1,
  }), surface, x, y, z);
}
function panel(parent, surface, w, h, radius, depth, x = 0, y = 0, z = 0, bevel = .012) {
  const shape = new Shape();
  const a = -w / 2, b = -h / 2, c = w / 2, d = h / 2;
  shape.moveTo(a + radius, b);
  shape.lineTo(c - radius, b);
  shape.quadraticCurveTo(c, b, c, b + radius);
  shape.lineTo(c, d - radius);
  shape.quadraticCurveTo(c, d, c - radius, d);
  shape.lineTo(a + radius, d);
  shape.quadraticCurveTo(a, d, a, d - radius);
  shape.lineTo(a, b + radius);
  shape.quadraticCurveTo(a, b, a + radius, b);
  return solid(parent, shape, surface, depth, bevel, x, y, z);
}
function star(parent, x, y, z, r) {
  const shape = new Shape();
  for (let i = 0; i < 10; i++) {
    const a = i * Math.PI / 5 + Math.PI / 2;
    const d = r * (i % 2 ? .53 : 1);
    const point = [Math.cos(a) * d, Math.sin(a) * d];
    if (i === 0) shape.moveTo(...point);
    else shape.lineTo(...point);
  }
  shape.closePath();
  return solid(parent, shape, gold, .06, .026, x, y, z);
}
function place(parent, x, y, z) {
  const item = new Group();
  const scale = 2 * (9 - z) * Math.tan(19 * Math.PI / 180) / 417;
  item.position.set((x - 313) * scale, (208.5 - y) * scale, z);
  parent.add(item);
  return item;
}
function face(parent, radius, closed) {
  ball(parent, gold, 0, 0, 0, radius);
  const eyes = new Group();
  const eyeY = radius * .29, eyeZ = radius * .91;
  eyes.position.y = eyeY;
  parent.add(eyes);
  const openEyes = new Group();
  openEyes.position.copy(eyes.position);
  if (closed) {
    parent.add(openEyes);
    openEyes.visible = false;
  }
  for (const sign of [-1, 1]) {
    const x = sign * radius * .32;
    if (closed) {
      ball(openEyes, ink, x, 0, eyeZ, .046, .067, .025);
      for (const stroke of [-1, 1]) {
        const bar = panel(eyes, ink, radius * .25, .035, .015, .009,
          x, stroke * .037, eyeZ + .018, .005);
        bar.rotation.z = sign * stroke * .48;
      }
    } else {
      ball(eyes, ink, x, 0, eyeZ, .056, .083, .025);
    }
  }
  const mouth = new Group();
  mouth.position.set(0, -radius * .22, radius * .99);
  parent.add(mouth);
  const d = radius * .57;
  const smile = new Shape();
  smile.moveTo(-d, .075);
  smile.quadraticCurveTo(0, .038, d, .075);
  smile.bezierCurveTo(d * .92, -d * .64, d * .53, -d * .76, 0, -d * .76);
  smile.bezierCurveTo(-d * .53, -d * .76, -d * .92, -d * .64, -d, .075);
  solid(mouth, smile, ink, .020, .011, 0, 0, .015);
  const lip = new Shape();
  lip.moveTo(-d * .76, -d * .41);
  lip.quadraticCurveTo(0, d * .23, d * .76, -d * .41);
  lip.quadraticCurveTo(d * .51, -d * .74, 0, -d * .75);
  lip.quadraticCurveTo(-d * .51, -d * .74, -d * .76, -d * .41);
  solid(mouth, lip, tongue, .010, .005, 0, 0, .049);
  return { eyes, openEyes, mouth };
}
const ease = (x) => {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
};
const pulse = (t, inStart, peak, outEnd) =>
  t < peak ? ease((t - inStart) / (peak - inStart)) : ease((outEnd - t) / (outEnd - peak));

export function createReview() {
  const root = new Group();
  const phone = place(root, 304, 225, 0);
  phone.position.set(-.130, -.207, 0);
  phone.scale.set(1.90, .913, 1);
  panel(phone, plum, 1.39, 3.66, .20, .16, 0, 0, -.16, .051);
  panel(phone, lavender, 1.38, 3.65, .19, .092, 0, 0, .014, .034);
  panel(phone, rim, 1.306, 3.54, .17, .023, 0, 0, .117, .024);
  panel(phone, lavender, 1.255, 3.49, .15, .027, 0, 0, .147, .014);
  panel(phone, screen, 1.12, 3.12, .13, .018, 0, -.045, .178, .012);
  panel(phone, plum, .24, .037, .015, .008, -.02, 1.665, .18, .004);
  ball(phone, plum, .192, 1.666, .184, .025);
  panel(phone, rim, .26, .046, .013, .012, -.71, .52, -.012).rotation.z = Math.PI / 2;
  const ratings = [-.32, 0, .32].map(x => star(phone, x, -.87, .206, .125));
  const card = place(root, 333, 196, .70);
  card.position.set(.207, .152, .70);
  card.scale.set(1.457, 1.01, 1);
  panel(card, rim, 1.30, 1.00, .12, .087, 0, 0, -.016, .032);
  panel(card, white, 1.27, .98, .11, .034, 0, 0, .077, .022);
  panel(card, lavender, 1.27, .27, .09, .024, 0, .36, .116, .019);
  for (const x of [-.49, -.393, -.29]) ball(card, white, x, .362, .154, .022);
  const lines = [.66, .58, .31].map((w, i) =>
    panel(card, plum, w, .069, .03, .014, 0, .095 - i * .20, .128, .009));
  const message = place(root, 220, 80, .28);
  const tail = new Shape();
  tail.moveTo(.10, -.19); tail.lineTo(.52, -.18);
  tail.quadraticCurveTo(.57, -.62, .46, -.49); tail.closePath();
  solid(message, tail, pink, .10, .025, 0, 0, 0);
  panel(message, pink, 1.36, .48, .21, .12, 0, 0, .01, .037);
  const dots = [-.36, 0, .36].map(x => ball(message, white, x, 0, .17, .084));
  const laugh = place(root, 328, 101, .49);
  const laughY = laugh.position.y;
  const laughing = face(laugh, .57, true);
  const happy = place(root, 461, 289, .27);
  const smiling = face(happy, .50, false);
  const badges = [[157, 185, -.44], [477, 170, .42]].map(([x,y,angle]) => {
    const badge = place(root, x, y, .18);
    for (const [z, surface, r] of [[-.12, plum, .55], [.014, lavender, .52]]) {
      const disc = new Shape();
      disc.absarc(0, 0, r, 0, Math.PI * 2, false);
      solid(badge, disc, surface, .10, .032, 0, 0, z);
    }
    star(badge, 0, 0, .162, .36);
    const reverse = new Group();
    reverse.rotation.y = Math.PI;
    badge.add(reverse);
    star(reverse, 0, 0, .17, .29);
    badge.rotation.z = angle;
    return badge;
  });
  const avatar = place(root, 222, 295, 1.12);
  const head = ball(avatar, magenta, 0, .59, 0, .28);
  const torso = new Shape();
  torso.moveTo(-.46, -.48);
  torso.bezierCurveTo(-.54, .11, -.23, .28, 0, .28);
  torso.bezierCurveTo(.35, .28, .49, .05, .46, -.48);
  torso.quadraticCurveTo(.34, -.61, -.34, -.61);
  torso.quadraticCurveTo(-.45, -.57, -.46, -.48);
  solid(avatar, torso, magenta, .18, .078, 0, .05, -.1);
  const sparkles = [[170,252,.22],[393,148,.145]].map(([x,y,r]) => {
    const anchor = place(root,x,y,.20);
    star(anchor,0,0,0,r);
    return anchor;
  });
  const shards = [[153,113,.28],[429,111,.227],[234,350,.23],[284,49,.14],[454,225,.13]].map(([x,y,r],i) => {
    const shard = place(root,x,y,.06);
    const piece = mesh(shard,facet,material(i % 2 ? '#ffbd4c' : '#ff8c55'));
    piece.scale.set(r*.68,r*1.38,r*.74);
    piece.rotation.z = [-.9,.68,.61,.05,-1.2][i];
    return shard;
  });
  const bubbles = [[228,187,.28],[386,203,.37]].map(([x,y,r]) =>
    ball(place(root,x,y,-.39),material('#ff91b5',.85),0,0,0,r));
  return { root, pose(progress) {
    const t = progress * 8, a = progress * Math.PI * 2;
    // Each action has a separate timing and returns to its initial pose.
    phone.rotation.set(-.830 + .065 * Math.sin(a), .884 + .095 * Math.sin(a), .772 + .037 * Math.sin(a * 2));
    phone.position.y = -.207 + .073 * Math.sin(a);
    const lift = pulse(t,.55,2.25,4.45);
    card.position.z = .70 + .60 * lift;
    card.position.y = .152 + .38 * lift;
    card.rotation.set(-.685 + .16 * lift, .862 - .22 * lift, .694 - .09 * lift);
    lines.forEach((line,i) => {
      const write = pulse(t,1.1+i*.19,1.38+i*.19,2.0+i*.18);
      line.scale.x = 1 - .76 * write;
    });
    ratings.forEach((item,i) => item.scale.setScalar(1 + .42 * pulse(t,4.2+i*.22,4.55+i*.22,5.15+i*.22)));
    message.rotation.set(.04, -.14 -.26*pulse(t,.15,.72,1.55), .018 + .1*Math.sin(2*a));
    dots.forEach((dot,i) => { dot.position.y = .11 * pulse(t,.35+i*.19,.57+i*.19,.87+i*.19); });
    laugh.position.y = laughY + .20*pulse(t,1.85,2.72,3.55) + .10*pulse(t,3.08,3.42,3.90);
    laugh.rotation.set(.06,-.12*Math.sin(a),-.06*Math.sin(2*a));
    laughing.mouth.scale.y = 1 + .24*pulse(t,2,2.65,3.4);
    const opens = pulse(t,3.25,3.65,4.15);
    laughing.openEyes.visible = opens > .08;
    laughing.eyes.visible = !laughing.openEyes.visible;
    laughing.openEyes.scale.y = Math.max(.03, opens);
    happy.rotation.set(.07,-.07-.22*pulse(t,4.1,4.9,5.8),-.08+.17*pulse(t,4.25,5.2,6.25));
    smiling.eyes.scale.y = 1-.94*(pulse(t,1.30,1.40,1.53)+pulse(t,4.77,4.87,4.99)+pulse(t,6.18,6.26,6.37));
    smiling.mouth.scale.y = 1+.27*pulse(t,4.55,5.2,6.1);
    badges[0].rotation.set(-.66,.25+Math.PI*2*ease((t-.75)/2.1),-.40);
    badges[1].rotation.set(-.60,-.24-Math.PI*2*ease((t-4.55)/2.25),.39);
    const nod = pulse(t,3.0,3.55,4.16);
    head.position.y = .59-.13*nod+.09*pulse(t,3.5,3.86,4.42);
    avatar.rotation.z = -.04+.15*pulse(t,3.12,3.95,4.80);
    sparkles.forEach((item,i) => {
      const shine = pulse(t,2.6+i*2.34,2.95+i*2.34,3.49+i*2.34);
      item.scale.setScalar(1+.31*shine);
      item.rotation.z = (i ? -.33 : .19)+.45*shine;
    });
    shards.forEach((item,i) => {
      item.rotation.x = .15+Math.sin(a+i*.84)*.58;
      item.rotation.y = a*(i % 2 ? -1 : 1);
    });
    bubbles.forEach((item,i) => item.scale.setScalar((i ? .37 : .28)*(1+.09*Math.sin(a+i))));
  }};
}
