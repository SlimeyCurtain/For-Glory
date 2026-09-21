import { fillPose, lerpPose, type Pose, type PartialPose } from './pose';

export interface Keyframe {
  t: number; // fraction of clip duration, 0..1
  pose: Pose;
}

export interface AttackClip {
  /** Seconds. Kept well under the 0.9-1.1s combo window so there's always a hold beat before the next input can land. */
  duration: number;
  /** Fraction of duration at which damage is resolved against the defender's current state. */
  impactFrac: number;
  keyframes: Keyframe[];
  minDamage: number;
  maxDamage: number;
  /** Human label surfaced nowhere but useful for debugging. */
  name: string;
}

function kf(t: number, pose: PartialPose, base?: Pose): Keyframe {
  return { t, pose: fillPose(pose, base) };
}

// --- Attack 1: opener -- horizontal swing, sword right -> left. -----------
const ATTACK_1: AttackClip = {
  duration: 0.5,
  impactFrac: 0.55,
  minDamage: 11,
  maxDamage: 16,
  name: 'opener-horizontal-rl',
  keyframes: [
    kf(0, { rShoulder: [1.55, 0.3, -1.45], rElbow: [-0.9, 0, 0], torso: [0.05, 0.35, 0.05] }),
    kf(0.55, { rShoulder: [1.45, -0.2, 1.05], rElbow: [-0.55, 0, 0], torso: [0.02, -0.35, 0] }),
    kf(1, { rShoulder: [1.35, -0.15, 1.2], rElbow: [-0.6, 0, 0], torso: [0.02, -0.25, 0] }),
  ],
};

// --- Attack 2: horizontal swing, sword left -> right, settles on the right. --
const ATTACK_2: AttackClip = {
  duration: 0.48,
  impactFrac: 0.5,
  minDamage: 14,
  maxDamage: 19,
  name: 'combo2-horizontal-lr',
  keyframes: [
    kf(0, { rShoulder: [1.35, -0.15, 1.2], rElbow: [-0.6, 0, 0], torso: [0.02, -0.25, 0] }),
    kf(0.5, { rShoulder: [1.45, 0.15, -0.9], rElbow: [-0.55, 0, 0], torso: [0.03, 0.3, 0] }),
    kf(1, { rShoulder: [1.55, 0.3, -1.35], rElbow: [-0.75, 0, 0], torso: [0.05, 0.35, 0.03] }),
  ],
};

// --- Attack 3: grab the sword two-handed, thrust forward -- a stab. -------
const ATTACK_3: AttackClip = {
  duration: 0.46,
  impactFrac: 0.6,
  minDamage: 17,
  maxDamage: 22,
  name: 'combo3-thrust',
  keyframes: [
    kf(0, { rShoulder: [1.55, 0.3, -1.35], rElbow: [-0.75, 0, 0], torso: [0.05, 0.35, 0.03] }),
    kf(0.3, {
      rShoulder: [1.4, 0.1, -0.5],
      rElbow: [-1.4, 0, 0],
      lShoulder: [1.3, -0.3, -0.15],
      lElbow: [-1.3, 0, 0],
      torso: [0.02, 0.1, 0],
    }),
    kf(0.6, {
      rShoulder: [1.55, 0, -0.1],
      rElbow: [-0.15, 0, 0],
      lShoulder: [1.5, 0, -0.1],
      lElbow: [-0.2, 0, 0],
      torso: [0.16, 0, 0],
    }),
    kf(1, {
      rShoulder: [1.45, 0.05, -0.25],
      rElbow: [-0.55, 0, 0],
      lShoulder: [1.0, -0.2, 0.3],
      lElbow: [-0.8, 0, 0],
      torso: [0.06, 0, 0],
    }),
  ],
};

// --- Attack 4: pull back, one hand, diagonal slash upper-right -> lower-left. --
const ATTACK_4: AttackClip = {
  duration: 0.52,
  impactFrac: 0.55,
  minDamage: 20,
  maxDamage: 25,
  name: 'combo4-diagonal-finisher',
  keyframes: [
    kf(0, {
      rShoulder: [1.45, 0.05, -0.25],
      rElbow: [-0.55, 0, 0],
      lShoulder: [1.0, -0.2, 0.3],
      lElbow: [-0.8, 0, 0],
      torso: [0.06, 0, 0],
    }),
    kf(0.22, { rShoulder: [1.7, 0.4, -1.1], rElbow: [-1.1, 0, 0], torso: [0.1, 0.3, 0.05] }),
    kf(0.55, { rShoulder: [0.5, -0.5, 0.9], rElbow: [-0.3, 0, 0], torso: [0.05, -0.3, -0.05] }),
    kf(1, { rShoulder: [0.65, -0.35, 0.8], rElbow: [-0.45, 0, 0], torso: [0.04, -0.2, -0.03] }),
  ],
};

export const COMBO_CLIPS: readonly AttackClip[] = [ATTACK_1, ATTACK_2, ATTACK_3, ATTACK_4];

export function evaluateClip(clip: AttackClip, elapsed: number): Pose {
  const t = Math.min(Math.max(elapsed / clip.duration, 0), 1);
  const frames = clip.keyframes;
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].t < t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const span = b.t - a.t;
  const localT = span > 1e-6 ? (t - a.t) / span : 0;
  const eased = localT < 0.5 ? 2 * localT * localT : 1 - Math.pow(-2 * localT + 2, 2) / 2;
  return lerpPose(a.pose, b.pose, eased);
}
