import * as THREE from 'three';

/**
 * A tapered limb segment. `pivot` is the rotating joint at the segment's
 * TOP (rotating it swings the whole segment); the mesh hangs straight down
 * from the pivot when unrotated, so rotation (0,0,0) always means "limb
 * relaxed, hanging down" -- a convenient rest pose for free. `end` is a
 * group at the segment's bottom, used both as the attach point for the next
 * segment in the chain and, when rotated directly, as that joint's own bend
 * (e.g. the elbow, sitting between the upper arm and forearm segments).
 */
export interface Segment {
  pivot: THREE.Group;
  mesh: THREE.Mesh;
  end: THREE.Group;
}

export function makeSegment(length: number, radiusTop: number, radiusBottom: number, material: THREE.Material, sides = 6): Segment {
  const pivot = new THREE.Group();
  const geo = new THREE.CylinderGeometry(radiusTop, radiusBottom, length, sides);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = -length / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  pivot.add(mesh);
  const end = new THREE.Group();
  end.position.y = -length;
  pivot.add(end);
  return { pivot, mesh, end };
}

export type JointName =
  | 'hips'
  | 'torso'
  | 'head'
  | 'lShoulder'
  | 'lElbow'
  | 'rShoulder'
  | 'rElbow'
  | 'lHip'
  | 'lKnee'
  | 'rHip'
  | 'rKnee';

export const JOINT_NAMES: JointName[] = [
  'hips',
  'torso',
  'head',
  'lShoulder',
  'lElbow',
  'rShoulder',
  'rElbow',
  'lHip',
  'lKnee',
  'rHip',
  'rKnee',
];
