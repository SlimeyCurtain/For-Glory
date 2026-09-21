import { JOINT_NAMES, type JointName } from '../entities/rig';

export type Angles = readonly [number, number, number];
export type Pose = Record<JointName, Angles>;
export type PartialPose = Partial<Record<JointName, Angles>>;

/** Neutral fighting-ready stance: knees slightly bent, sword arm raised and forward, off-arm relaxed/guarding. */
export const REST_POSE: Pose = {
  hips: [0, 0, 0],
  torso: [0, 0, 0.02],
  head: [0.05, 0, 0],
  rShoulder: [1.25, 0, -0.35],
  rElbow: [-0.7, 0, 0],
  lShoulder: [0.55, 0, 0.5],
  lElbow: [-0.55, 0, 0],
  lHip: [0.12, 0, 0.05],
  lKnee: [-0.28, 0, 0],
  rHip: [-0.1, 0, -0.05],
  rKnee: [-0.22, 0, 0],
};

export const BLOCK_POSE_SWORD: Pose = {
  ...REST_POSE,
  torso: [0.08, 0, 0],
  rShoulder: [1.55, 0.5, -0.15],
  rElbow: [-1.65, 0, 0],
  lShoulder: [1.0, -0.3, 0.9],
  lElbow: [-1.0, 0, 0],
};

export const BLOCK_POSE_SHIELD: Pose = {
  ...REST_POSE,
  torso: [0.1, 0.05, 0],
  lShoulder: [1.5, 0, 0.25],
  lElbow: [-1.35, 0, 0],
  rShoulder: [0.9, 0, -0.55],
  rElbow: [-0.9, 0, 0],
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose;
  for (const name of JOINT_NAMES) {
    const av = a[name];
    const bv = b[name];
    out[name] = [lerp(av[0], bv[0], t), lerp(av[1], bv[1], t), lerp(av[2], bv[2], t)];
  }
  return out;
}

/** Fills any joints missing from a partial pose with REST_POSE's values, so clip keyframes only need to specify what moves. */
export function fillPose(partial: PartialPose, base: Pose = REST_POSE): Pose {
  const out = {} as Pose;
  for (const name of JOINT_NAMES) {
    out[name] = partial[name] ?? base[name];
  }
  return out;
}

export const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
export const easeInQuad = (t: number) => t * t;
