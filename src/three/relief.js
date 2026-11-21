import {
  Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, TextureLoader,
} from "three";

export async function createRelief(spec) {
  const loader = new TextureLoader();
  const [texture, depth] = await Promise.all([
    loader.loadAsync(spec.image), loader.loadAsync(spec.depthMap),
  ]);
  texture.colorSpace = SRGBColorSpace;
  const canvas = document.createElement("canvas");
  const columns = 192;
  const width = 5;
  const height = width * texture.image.height / texture.image.width;
  const rows = Math.max(1, Math.min(256, Math.round(columns * height / width)));
  canvas.width = columns + 1;
  canvas.height = rows + 1;
  const context = canvas.getContext("2d");
  context.drawImage(depth.image, 0, 0, canvas.width, canvas.height);
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
  const surface = new PlaneGeometry(width, height, columns, rows);
  const positions = surface.attributes.position;
  for (let index = 0; index < positions.count; index++) {
    positions.setZ(index, spec.depth * (data[index * 4] / 255 - 0.5));
  }
  surface.computeBoundingSphere();
  const root = new Mesh(surface, new MeshBasicMaterial({ map: texture, alphaTest: 0.35 }));
  return {
    root,
    pose(progress) {
      const angle = progress * Math.PI * 2;
      root.rotation.y = spec.rotation[1] + Math.sin(angle) * 0.20;
      root.rotation.x = spec.rotation[0] + Math.sin(angle * 2) * 0.045;
    },
  };
}
