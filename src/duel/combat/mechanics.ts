import type { Pose } from './pose';

/**
 * A cheap stand-in for the kinetic chain a real swing or sidestep actually
 * uses: power (and a dodge's push-off) comes from the hips and legs first,
 * with the torso and arm as the last links, not the arm alone. There's no
 * real physics simulation backing this -- no mass, force, or momentum, and
 * still no collision between the blade and anything it swings at -- this is
 * just deriving a bit of hip/knee/weight-shift motion from values the pose
 * already carries (the torso's twist, the dodge's sideways arc), so the
 * lower body reads as *participating* in the movement instead of standing
 * planted while the top half does all the work.
 */
export function applyBodyMechanics(pose: Pose, dodgeDir: -1 | 0 | 1, dodgeArc: number): Pose {
  const twist = pose.torso[1]; // rotation about the vertical axis driving a swing
  // Knee flexion is negative (see pose.ts's REST_POSE comment -- a knee bends
  // toward the back of the leg, the opposite sense from an elbow), so
  // "bend the knees more" subtracts here, not adds.
  const crouch = Math.abs(twist) * 0.22 + dodgeArc * 0.18; // load into a swing, push off into a dodge
  const weightShift = twist * 0.18; // torso rotating one way plants weight on the opposite leg
  const dodgeLean = dodgeDir * dodgeArc;

  return {
    ...pose,
    hips: [pose.hips[0], pose.hips[1] + twist * 0.5, pose.hips[2] + dodgeLean * 0.12],
    torso: [pose.torso[0], pose.torso[1], pose.torso[2] - dodgeLean * 0.15],
    rKnee: [pose.rKnee[0] - crouch, pose.rKnee[1], pose.rKnee[2]],
    lKnee: [pose.lKnee[0] - crouch, pose.lKnee[1], pose.lKnee[2]],
    rHip: [pose.rHip[0] + weightShift - dodgeLean * 0.15, pose.rHip[1], pose.rHip[2]],
    lHip: [pose.lHip[0] - weightShift + dodgeLean * 0.15, pose.lHip[1], pose.lHip[2]],
  };
}
