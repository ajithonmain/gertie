import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const cli = here('../skills/gertie/scripts/gertie.mjs');
const source = here('geometry.three.json');
const output = process.argv[2] ?? here('floating-reviews.html');
const playerPath = here('../src/three/player.js');

execFileSync(process.execPath, [cli, 'three', 'validate', source], { stdio: 'inherit' });
execFileSync(process.execPath, [cli, 'three', 'build', source, '--out', output], { stdio: 'inherit' });

const player = readFileSync(playerPath, 'utf8')
  .replace('const rigs =', "import { createReview } from '../../floating-reviews/review-model.js';\n\nconst rigs =")
  .replace('team: createTeam', 'team: createReview')
  .replace('canvas, antialias: true', 'canvas, antialias: true, alpha: true')
  .replace('renderer.setSize(config.width, config.height, false);',
    'renderer.setPixelRatio(Math.max(1.5, Math.min(devicePixelRatio, 2)));\n  renderer.setSize(config.width, config.height, false);')
  .replace('scene.background = new Color(config.background);', 'scene.background = null;')
  .replace('new AmbientLight(0xffffff, 0.8)', 'new AmbientLight(0xffffff, 1.26)')
  .replace('new DirectionalLight(0xffedd5, 2.6)', 'new DirectionalLight(0xfff5df, 2.65)')
  .replace('key.position.set(4, 6, 5)', 'key.position.set(-3.2, 6, 6)')
  .replace('new DirectionalLight(0x9db9ff, 1.8)', 'new DirectionalLight(0xc7d5ff, 1.45)')
  .replace('fill.position.set(-4, 1, -3)', 'fill.position.set(5, 2, -1)');
const [{ text: bundle }] = (await build({
  stdin: { contents: player, sourcefile: 'review-player.js', resolveDir: here('../src/three') },
  bundle: true, minify: true, write: false, format: 'iife',
})).outputFiles;
const sky = `canvas {
    width: min(1000px, 100vw, calc((100vh - 4rem) * 1.499));
    height: auto;
    aspect-ratio: 1000 / 667;
    background:
      radial-gradient(ellipse at 0% 5%, #e5fcffcc, transparent 11%),
      radial-gradient(ellipse 13% 9% at 17% 26%, #e1f9ff, transparent),
      radial-gradient(ellipse 13% 7% at 60% 13%, #edfeffdc, transparent),
      radial-gradient(ellipse 20% 13% at 96% 26%, #dffbff, transparent),
      radial-gradient(ellipse 20% 20% at 90% 77%, #eeffff, transparent),
      radial-gradient(ellipse 15% 21% at 13% 102%, #e4f9ff, transparent),
      radial-gradient(ellipse 16% 11% at 64% 106%, #e7fbff, transparent),
      linear-gradient(105deg, #59c4e6, #9ae0ed 63%, #b6f5ef);
  }`;
const html = readFileSync(output, 'utf8')
  .replace('<title>Gertie 3D animation</title>', '<title>Floating Reviews · Gertie</title>')
  .replace('</style>', `${sky}\n</style>`)
  .replace(/<script>[\s\S]*<\/script>/, () => `<script>${bundle.replace(/<\/script/gi, '<\\/script')}</script>`);
writeFileSync(output, html);
