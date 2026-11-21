import {
  AmbientLight, BoxGeometry, Color, CylinderGeometry, DirectionalLight, Group, IcosahedronGeometry,
  Mesh, MeshStandardMaterial, PerspectiveCamera, Scene, SphereGeometry,
  TorusKnotGeometry, WebGLRenderer,
} from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createRobot } from "./robot.js";
import { createTeam } from "./team.js";
import { createRelief } from "./relief.js";

const rigs = { robot: (_, material) => createRobot(material), team: createTeam, relief: createRelief };

const canvas = document.querySelector("canvas");
const status = document.querySelector("#status");
const toggle = document.querySelector("button");

async function startPlayer() {
  const config = JSON.parse(document.querySelector("#scene").textContent);
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(config.width, config.height, false);

  const scene = new Scene();
  scene.background = new Color(config.background);
  const camera = new PerspectiveCamera(38, config.width / config.height, 0.1, 100);
  camera.position.set(...config.camera);
  camera.lookAt(0, 0, 0);
  const controls = config.orbit ? new OrbitControls(camera, canvas) : undefined;
  if (controls) {
    controls.enablePan = false;
    controls.minDistance = 4;
    controls.maxDistance = 16;
    controls.minPolarAngle = Math.PI * 0.16;
    controls.maxPolarAngle = Math.PI * 0.52;
    canvas.tabIndex = 0;
    canvas.style.cursor = "grab";
    canvas.setAttribute("aria-label", "3D animation. Drag or use arrow keys to orbit. Scroll to zoom.");
    // OrbitControls uses arrow keys to pan by default. Map arrows to rotation.
    canvas.addEventListener("keydown", (event) => {
      const rotation = { ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24] }[event.key];
      if (!rotation) return;
      event.preventDefault();
      const [x, y] = rotation;
      if (x) controls.rotateLeft(x * Math.PI / 360);
      else controls.rotateUp(y * Math.PI / 360);
    });
  }

  scene.add(new AmbientLight(0xffffff, 0.8));
  const key = new DirectionalLight(0xffedd5, 2.6);
  key.position.set(4, 6, 5);
  const fill = new DirectionalLight(0x9db9ff, 1.8);
  fill.position.set(-4, 1, -3);
  scene.add(key, fill);

  const geometry = {
    box: () => new BoxGeometry(1.5, 1.5, 1.5),
    cylinder: () => new CylinderGeometry(0.75, 0.75, 1.5, 48),
    sphere: () => new SphereGeometry(1, 48, 32),
    crystal: () => new IcosahedronGeometry(1),
    knot: () => new TorusKnotGeometry(0.75, 0.24, 128, 24),
  };
  const objects = await Promise.all(config.objects.map(async (spec) => {
    const pivot = new Group();
    const origin = spec.pivot ?? spec.position;
    pivot.position.set(...origin);
    const material = new MeshStandardMaterial({
      color: spec.color,
      metalness: spec.metalness,
      roughness: spec.roughness,
    });
    const rig = await rigs[spec.shape]?.(spec, material);
    const mesh = rig?.root ?? new Mesh(geometry[spec.shape](), material);
    mesh.rotation.set(...spec.rotation);
    if (Array.isArray(spec.scale)) mesh.scale.set(...spec.scale);
    else mesh.scale.setScalar(spec.scale);
    if (spec.pivot) {
      const offset = new Group();
      offset.position.set(...spec.position).sub(pivot.position);
      offset.add(mesh);
      pivot.add(offset);
    } else {
      pivot.add(mesh);
    }
    scene.add(pivot);
    return { pivot, origin, spec, pose: rig?.pose };
  }));

  const turn = Math.PI * 2;
  let renderedTime = 0;
  function sampleMotion(keys, seconds) {
    const nextIndex = keys.findIndex(key => key.at > seconds);
    const previous = keys[nextIndex - 1];
    const next = keys[nextIndex];
    const progress = (seconds - previous.at) / (next.at - previous.at);
    const eased = progress * progress * (3 - 2 * progress);
    return {
      offset: previous.offset.map((value, axis) => value + (next.offset[axis] - value) * eased),
      turn: previous.turn.map((value, axis) => value + (next.turn[axis] - value) * eased),
    };
  }
  function draw(seconds) {
    renderedTime = seconds;
    const localTime = Math.max(0, seconds) % config.duration;
    const progress = localTime / config.duration;
    const angle = progress * turn;
    for (const { pivot, origin, spec, pose } of objects) {
      pose?.(progress);
      const [x, y, z] = spec.spin;
      pivot.rotation.set(x * angle, y * angle, z * angle);
      pivot.position.set(origin[0], origin[1] + spec.bob * Math.sin(angle + spec.phase * turn), origin[2]);
      if (spec.motion) {
        const sample = sampleMotion(spec.motion, localTime);
        pivot.position.x += sample.offset[0];
        pivot.position.y += sample.offset[1];
        pivot.position.z += sample.offset[2];
        pivot.rotation.x += sample.turn[0];
        pivot.rotation.y += sample.turn[1];
        pivot.rotation.z += sample.turn[2];
      }
    }
    renderer.render(scene, camera);
  }

  controls?.addEventListener("change", () => draw(renderedTime));

  // Evaluate motion from elapsed time so playback is independent of refresh rate.
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let elapsed = 0;
  let started = 0;
  let frame;
  function tick(now) {
    draw(elapsed + (now - started) / 1000);
    frame = requestAnimationFrame(tick);
  }
  function play() {
    started = performance.now();
    frame = requestAnimationFrame(tick);
    toggle.textContent = "Pause";
  }
  function pause() {
    if (frame !== undefined) {
      elapsed = (elapsed + (performance.now() - started) / 1000) % config.duration;
      cancelAnimationFrame(frame);
      frame = undefined;
    }
    toggle.textContent = "Play";
  }
  toggle.addEventListener("click", () => frame === undefined ? play() : pause());
  reducedMotion.addEventListener("change", (event) => {
    if (event.matches) pause();
  });
  draw(0);
  toggle.hidden = false;
  status.hidden = true;
  if (!reducedMotion.matches) play();
}

startPlayer().catch((error) => {
  status.textContent = "Could not render this 3D animation.";
  console.error(error);
});
