import * as THREE from 'three';
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

/**
 * Anatomically-plausible per-axis rotation limits, in radians. Applied to
 * every pose right before it reaches the rig (see Fighter.applyPose) as a
 * hard backstop against broken-looking joints -- no hand-tuned keyframe or
 * mid-blend value, however extreme, can bend a limb past what a real joint
 * could do. Elbows and knees are near-pure hinges (very little allowance on
 * y/z) rather than free-swinging balls, which is most of what reads as
 * "stiff" instead of "floppy".
 */
export const JOINT_LIMITS: Record<JointName, readonly [Angles, Angles]> = {
  hips: [
    [-0.25, -0.4, -0.3],
    [0.25, 0.4, 0.3],
  ],
  torso: [
    [-0.2, -0.5, -0.3],
    [0.4, 0.5, 0.3],
  ],
  head: [
    [-0.35, -0.6, -0.35],
    [0.35, 0.6, 0.35],
  ],
  rShoulder: [
    [-0.4, -0.7, -1.8],
    [2.0, 0.7, 1.8],
  ],
  lShoulder: [
    [-0.4, -0.7, -1.8],
    [2.0, 0.7, 1.8],
  ],
  rElbow: [
    [-2.2, -0.12, -0.12],
    [0.15, 0.12, 0.12],
  ],
  lElbow: [
    [-2.2, -0.12, -0.12],
    [0.15, 0.12, 0.12],
  ],
  rHip: [
    [-0.6, -0.25, -0.35],
    [0.6, 0.25, 0.35],
  ],
  lHip: [
    [-0.6, -0.25, -0.35],
    [0.6, 0.25, 0.35],
  ],
  rKnee: [
    [-1.3, -0.08, -0.08],
    [0.05, 0.08, 0.08],
  ],
  lKnee: [
    [-1.3, -0.08, -0.08],
    [0.05, 0.08, 0.08],
  ],
};

// Scratch objects reused across calls so blending 10 joints every frame doesn't
// allocate a fresh Quaternion/Euler per joint per frame.
const scratchEulerA = new THREE.Euler();
const scratchEulerB = new THREE.Euler();
const scratchQuatA = new THREE.Quaternion();
const scratchQuatB = new THREE.Quaternion();

/**
 * Blends two joint orientations along the shortest rotational path (quaternion
 * slerp) rather than interpolating the three Euler numbers independently.
 * Lerping Euler angles directly makes a limb sweep through visibly wrong
 * intermediate orientations whenever more than one axis changes at once --
 * exactly the "arms flailing at the joints" look -- because there's no
 * guarantee the straight-line path in angle-space is a sane path in
 * rotation-space. Slerping through quaternions always is.
 */
function slerpAngles(a: Angles, b: Angles, t: number): Angles {
  if (t <= 0) return a;
  if (t >= 1) return b;
  scratchEulerA.set(a[0], a[1], a[2]);
  scratchEulerB.set(b[0], b[1], b[2]);
  scratchQuatA.setFromEuler(scratchEulerA);
  scratchQuatB.setFromEuler(scratchEulerB);
  scratchQuatA.slerp(scratchQuatB, t);
  scratchEulerA.setFromQuaternion(scratchQuatA);
  return [scratchEulerA.x, scratchEulerA.y, scratchEulerA.z];
}

export function lerpPose(a: Pose, b: Pose, t: number): Pose {
  const out = {} as Pose;
  for (const name of JOINT_NAMES) {
    out[name] = slerpAngles(a[name], b[name], t);
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
