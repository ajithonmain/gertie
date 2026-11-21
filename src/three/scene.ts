import ThreeAjv, { type ValidateFunction } from "ajv/dist/2020.js";

type Vector = [number, number, number];
type MotionKey = { at: number; offset: Vector; turn: Vector };
type ThreeObject = { shape: string; image?: string; depthMap?: string; motion?: MotionKey[] };
type ThreeScene = { camera: Vector; duration: number; objects: ThreeObject[] };
const ThreeAjvClass = (ThreeAjv.default ?? ThreeAjv) as typeof ThreeAjv.default;
let validateThreeScene: ValidateFunction<ThreeScene> | undefined;

const boundedNumber = (minimum: number, maximum: number) => ({ type: "number", minimum, maximum });
const vectorSchema = (item: object) => ({ type: "array", minItems: 3, maxItems: 3, items: item });
const hexColorSchema = { type: "string", pattern: "^#[0-9a-fA-F]{6}$" };

const threeSceneSchema = {
  type: "object",
  additionalProperties: false,
  required: ["objects"],
  properties: {
    width: { type: "integer", minimum: 64, maximum: 2048, default: 640 },
    height: { type: "integer", minimum: 64, maximum: 2048, default: 480 },
    orbit: { type: "boolean" },
    duration: { ...boundedNumber(0.25, 120), default: 4 },
    background: { ...hexColorSchema, default: "#171427" },
    camera: { ...vectorSchema(boundedNumber(-30, 30)), default: [0, 2, 7] },
    objects: {
      type: "array",
      minItems: 1,
      maxItems: 64,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["shape"],
        properties: {
          shape: { enum: ["box", "sphere", "cylinder", "crystal", "knot", "robot", "team", "relief"] },
          image: { type: "string", pattern: "^[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*[.]png$" },
          depthMap: { type: "string", pattern: "^[a-zA-Z0-9_-]+(?:/[a-zA-Z0-9_-]+)*[.]png$" },
          depth: { ...boundedNumber(0, 2), default: 1.05 },
          color: { ...hexColorSchema, default: "#ff9e8a" },
          position: { ...vectorSchema(boundedNumber(-30, 30)), default: [0, 0, 0] },
          rotation: { ...vectorSchema(boundedNumber(-Math.PI * 2, Math.PI * 2)), default: [0, 0, 0] },
          scale: { anyOf: [boundedNumber(0.01, 10), vectorSchema(boundedNumber(0.01, 10))], default: 1 },
          pivot: vectorSchema(boundedNumber(-30, 30)),
          motion: {
            type: "array", minItems: 2, maxItems: 64,
            items: {
              type: "object", additionalProperties: false, required: ["at"],
              properties: {
                at: boundedNumber(0, 120),
                offset: { ...vectorSchema(boundedNumber(-30, 30)), default: [0, 0, 0] },
                turn: { ...vectorSchema(boundedNumber(-Math.PI * 16, Math.PI * 16)), default: [0, 0, 0] },
              },
            },
          },
          metalness: { ...boundedNumber(0, 1), default: 0.15 },
          roughness: { ...boundedNumber(0, 1), default: 0.36 },
          spin: { ...vectorSchema({ ...boundedNumber(-8, 8), type: "integer" }), default: [0, 1, 0] },
          bob: { ...boundedNumber(0, 10), default: 0 },
          phase: { ...boundedNumber(0, 1), default: 0 },
        },
      },
    },
  },
};

export function parseThreeScene(source: string): ThreeScene {
  const scene: unknown = JSON.parse(source);
  validateThreeScene ??= new ThreeAjvClass({ allErrors: true, useDefaults: true }).compile<ThreeScene>(threeSceneSchema);
  if (!validateThreeScene(scene)) {
    throw new Error(validateThreeScene.errors?.map((error) => `${error.instancePath || "/"} ${error.message}`).join("\n"));
  }
  for (const [index, spec] of scene.objects.entries()) {
    if (spec.motion) {
      const motion = spec.motion;
      const first = motion[0]!;
      const last = motion.at(-1)!;
      if (first.at !== 0 || last.at !== scene.duration || motion.some((key, i) => i > 0 && key.at <= motion[i - 1]!.at)) {
        throw new Error(`/objects/${index}/motion needs increasing times from 0 to the scene duration`);
      }
      if (first.offset.some((v, i) => v !== last.offset[i]) || first.turn.some((v, i) => v !== last.turn[i])) {
        throw new Error(`/objects/${index}/motion needs matching opening and closing poses`);
      }
    }
    if (spec.shape === "relief" && (!spec.image || !spec.depthMap)) {
      throw new Error(`/objects/${index} requires image and depthMap PNG files for a relief`);
    }
    if (spec.shape !== "relief" && (spec.image || spec.depthMap)) {
      throw new Error(`/objects/${index} image and depthMap require shape relief`);
    }
  }
  const { camera } = scene;
  if (Math.hypot(...camera) <= 0.1) throw new Error("/camera must be more than 0.1 units from the origin");
  return scene;
}
