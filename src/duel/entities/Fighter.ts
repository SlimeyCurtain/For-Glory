import * as THREE from 'three';
import { JOINT_NAMES, makeSegment, type JointName } from './rig';
import { JOINT_LIMITS } from '../combat/pose';

export type FighterKind = 'knight' | 'goblin';

interface Proportions {
  legLen: number;
  legRadius: number;
  torsoHeight: number;
  torsoWidth: number;
  torsoDepth: number;
  armLen: number;
  armRadius: number;
  headSize: number;
  hunch: number; // forward torso tilt, goblin > knight
}

const KNIGHT_PROPORTIONS: Proportions = {
  legLen: 0.86,
  legRadius: 0.09,
  torsoHeight: 0.62,
  torsoWidth: 0.5,
  torsoDepth: 0.3,
  armLen: 0.37,
  armRadius: 0.075,
  headSize: 0.26,
  hunch: 0.02,
};

const GOBLIN_PROPORTIONS: Proportions = {
  legLen: 0.62,
  legRadius: 0.08,
  torsoHeight: 0.46,
  torsoWidth: 0.4,
  torsoDepth: 0.26,
  armLen: 0.34,
  armRadius: 0.065,
  headSize: 0.22,
  hunch: 0.22,
};

function buildKnightMaterials() {
  return {
    armor: new THREE.MeshStandardMaterial({ color: 0x9aa4b0, metalness: 0.55, roughness: 0.45 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2b3a5c, metalness: 0.2, roughness: 0.6 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3c3f46, metalness: 0.4, roughness: 0.5 }),
    plume: new THREE.MeshStandardMaterial({ color: 0x8c2c2c, roughness: 0.8 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 0.9 }),
    blade: new THREE.MeshStandardMaterial({ color: 0xd7dbe0, metalness: 0.85, roughness: 0.25 }),
    gold: new THREE.MeshStandardMaterial({ color: 0xc7a23a, metalness: 0.7, roughness: 0.4 }),
  };
}

function buildGoblinMaterials() {
  return {
    skin: new THREE.MeshStandardMaterial({ color: 0x5a7a32, roughness: 0.85 }),
    skinDark: new THREE.MeshStandardMaterial({ color: 0x496526, roughness: 0.9 }),
    leather: new THREE.MeshStandardMaterial({ color: 0x5b3a22, roughness: 0.95 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.95 }),
    blade: new THREE.MeshStandardMaterial({ color: 0x6b6a5f, metalness: 0.5, roughness: 0.55 }),
    wood: new THREE.MeshStandardMaterial({ color: 0x7a5233, roughness: 0.9 }),
    boss: new THREE.MeshStandardMaterial({ color: 0x8a8f99, metalness: 0.6, roughness: 0.4 }),
    eye: new THREE.MeshStandardMaterial({ color: 0xd8e030, emissive: 0x4a4a08, roughness: 0.6 }),
  };
}

function buildSword(mats: ReturnType<typeof buildKnightMaterials>): THREE.Group {
  const sword = new THREE.Group();

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.16, 8), mats.grip);
  grip.position.y = -0.08;
  sword.add(grip);

  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 6), mats.gold);
  pommel.position.y = -0.165;
  sword.add(pommel);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.03, 0.05), mats.gold);
  guard.position.y = 0.005;
  sword.add(guard);

  const bladeLen = 0.66;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.055, bladeLen, 0.014), mats.blade);
  blade.position.y = bladeLen / 2 + 0.02;
  sword.add(blade);

  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.033, 0.09, 4), mats.blade);
  tip.position.y = bladeLen + 0.02 + 0.045;
  tip.rotation.y = Math.PI / 4;
  sword.add(tip);

  sword.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
    }
  });
  return sword;
}

function buildJaggedBlade(mats: ReturnType<typeof buildGoblinMaterials>): THREE.Group {
  const weapon = new THREE.Group();

  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.024, 0.14, 6), mats.grip);
  grip.position.y = -0.07;
  weapon.add(grip);

  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.025, 0.04), mats.leather);
  weapon.add(guard);

  // A jagged silhouette: extrude a zigzag-edged shape flat, then thicken it.
  const shape = new THREE.Shape();
  const bladeLen = 0.5;
  const w = 0.09;
  shape.moveTo(0, 0);
  shape.lineTo(-w * 0.5, 0);
  const teeth = 4;
  for (let i = 0; i < teeth; i++) {
    const t0 = (i / teeth) * bladeLen;
    const t1 = ((i + 0.5) / teeth) * bladeLen;
    const t2 = ((i + 1) / teeth) * bladeLen;
    shape.lineTo(-w * 0.5 - 0.02, t0 + bladeLen / teeth / 3);
    shape.lineTo(-w * 0.5, t1);
    shape.lineTo(-w * 0.5, t2);
  }
  shape.lineTo(0, bladeLen + 0.08);
  shape.lineTo(w * 0.35, bladeLen * 0.6);
  shape.lineTo(w * 0.4, 0);
  shape.lineTo(0, 0);

  // The shape above is authored with its length along its own local Y (grip
  // end at y=0, tip at y=bladeLen+0.08) -- deliberately the same convention
  // buildSword uses, so it needs no extra rotation to stand the blade up
  // away from the grip. (center() recenters the mesh on that Y range, so the
  // position offset below has to restore the same half-length it just
  // removed, plus a small grip gap, rather than reusing bladeLen directly.)
  const bladeGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false });
  bladeGeo.center();
  const blade = new THREE.Mesh(bladeGeo, mats.blade);
  blade.position.y = (bladeLen + 0.08) / 2 + 0.05;
  weapon.add(blade);

  weapon.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  return weapon;
}

function buildRoundShield(mats: ReturnType<typeof buildGoblinMaterials>): THREE.Group {
  const shield = new THREE.Group();
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 0.05, 14), mats.wood);
  face.rotation.x = Math.PI / 2;
  face.castShadow = true;
  shield.add(face);

  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.26, 0.018, 6, 14), mats.boss);
  rim.rotation.x = Math.PI / 2;
  shield.add(rim);

  const boss = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 8), mats.boss);
  boss.position.z = 0.03;
  shield.add(boss);

  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const plank = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.5, 0.052), mats.leather);
    plank.rotation.z = a;
    shield.add(plank);
  }
  return shield;
}

export class Fighter {
  readonly kind: FighterKind;
  readonly group: THREE.Group;
  readonly joints: Record<JointName, THREE.Object3D>;
  readonly weapon: THREE.Group;
  readonly offhand: THREE.Group | null;
  readonly proportions: Proportions;

  constructor(kind: FighterKind) {
    this.kind = kind;
    this.proportions = kind === 'knight' ? KNIGHT_PROPORTIONS : GOBLIN_PROPORTIONS;
    this.group = new THREE.Group();
    this.joints = {} as Record<JointName, THREE.Object3D>;

    const p = this.proportions;
    const hips = new THREE.Group();
    hips.position.y = p.legLen;
    this.group.add(hips);
    this.joints.hips = hips;

    const kMat = kind === 'knight' ? buildKnightMaterials() : null;
    const gMat = kind === 'goblin' ? buildGoblinMaterials() : null;
    const bodyMat = (kMat?.armor ?? gMat?.skin)!;
    const darkMat = (kMat?.dark ?? gMat?.leather)!;

    const pelvis = new THREE.Mesh(new THREE.BoxGeometry(p.torsoWidth * 0.85, 0.16, p.torsoDepth * 0.95), darkMat);
    pelvis.castShadow = true;
    hips.add(pelvis);

    // torso
    const torso = new THREE.Group();
    torso.rotation.x = p.hunch;
    hips.add(torso);
    this.joints.torso = torso;

    const torsoMesh = new THREE.Mesh(new THREE.BoxGeometry(p.torsoWidth, p.torsoHeight, p.torsoDepth), bodyMat);
    torsoMesh.position.y = p.torsoHeight / 2;
    torsoMesh.castShadow = true;
    torsoMesh.receiveShadow = true;
    torso.add(torsoMesh);

    if (kMat) {
      const belt = new THREE.Mesh(new THREE.BoxGeometry(p.torsoWidth + 0.02, 0.07, p.torsoDepth + 0.02), kMat.trim);
      belt.position.y = 0.05;
      torso.add(belt);
      const chest = new THREE.Mesh(new THREE.BoxGeometry(p.torsoWidth * 0.5, 0.08, p.torsoDepth + 0.01), kMat.gold);
      chest.position.y = p.torsoHeight * 0.68;
      torso.add(chest);
    } else if (gMat) {
      const strap = new THREE.Mesh(new THREE.BoxGeometry(p.torsoWidth + 0.02, 0.06, p.torsoDepth + 0.02), gMat.leather);
      strap.position.y = p.torsoHeight * 0.6;
      strap.rotation.z = 0.5;
      torso.add(strap);
    }

    // head
    const head = new THREE.Group();
    head.position.y = p.torsoHeight;
    torso.add(head);
    this.joints.head = head;

    if (kMat) {
      const helmet = new THREE.Mesh(new THREE.BoxGeometry(p.headSize, p.headSize * 1.05, p.headSize * 0.95), kMat.armor);
      helmet.position.y = p.headSize * 0.55;
      helmet.castShadow = true;
      head.add(helmet);
      const visor = new THREE.Mesh(new THREE.BoxGeometry(p.headSize * 1.01, 0.035, 0.02), kMat.dark);
      visor.position.set(0, p.headSize * 0.55, p.headSize * 0.48);
      head.add(visor);
      const plumeGeo = new THREE.ConeGeometry(0.05, 0.22, 6);
      const plume = new THREE.Mesh(plumeGeo, kMat.plume);
      plume.position.set(0, p.headSize * 1.15, -0.02);
      head.add(plume);
    } else if (gMat) {
      const skull = new THREE.Mesh(new THREE.BoxGeometry(p.headSize * 0.9, p.headSize * 0.85, p.headSize * 0.95), gMat.skin);
      skull.position.y = p.headSize * 0.5;
      skull.castShadow = true;
      head.add(skull);
      const jaw = new THREE.Mesh(new THREE.BoxGeometry(p.headSize * 0.7, p.headSize * 0.3, p.headSize * 0.8), gMat.skinDark);
      jaw.position.set(0, p.headSize * 0.2, p.headSize * 0.05);
      head.add(jaw);
      for (const side of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.14, 4), gMat.skin);
        ear.position.set(side * p.headSize * 0.52, p.headSize * 0.58, 0);
        ear.rotation.z = side * 0.9;
        ear.rotation.x = 0.3;
        head.add(ear);
      }
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 6), gMat.eye);
        eye.position.set(side * p.headSize * 0.22, p.headSize * 0.55, p.headSize * 0.46);
        head.add(eye);
      }
    }

    // arms
    const shoulderY = p.torsoHeight * 0.86;
    const shoulderX = p.torsoWidth / 2 + 0.03;
    const limbMat = kMat?.armor ?? gMat!.skin;
    const foreMat = kMat?.dark ?? gMat!.skinDark;

    const buildArm = (side: -1 | 1) => {
      const upper = makeSegment(p.armLen, p.armRadius, p.armRadius * 0.85, limbMat);
      upper.pivot.position.set(shoulderX * side, shoulderY, 0);
      torso.add(upper.pivot);

      const fore = makeSegment(p.armLen * 0.92, p.armRadius * 0.8, p.armRadius * 0.6, foreMat);
      upper.end.add(fore.pivot);

      const hand = new THREE.Mesh(new THREE.SphereGeometry(p.armRadius * 0.9, 8, 6), limbMat);
      fore.end.add(hand);

      return { shoulder: upper.pivot, elbow: upper.end, hand: fore.end };
    };

    const rArm = buildArm(1);
    this.joints.rShoulder = rArm.shoulder;
    this.joints.rElbow = rArm.elbow;
    const lArm = buildArm(-1);
    this.joints.lShoulder = lArm.shoulder;
    this.joints.lElbow = lArm.elbow;

    // weapon in right hand
    if (kind === 'knight') {
      this.weapon = buildSword(kMat!);
    } else {
      this.weapon = buildJaggedBlade(gMat!);
    }
    // Both builders lay the blade out toward local +Y and the grip toward -Y.
    // A hand attach point (any segment's `end`, see rig.ts) has local +Y
    // pointing back up the limb toward the elbow -- the segment's mesh itself
    // hangs the other way, in *its own* local -Y, and `end` inherits that
    // same unrotated frame. So without this flip the blade end sits back
    // toward the elbow and the pommel end sticks out past the fingers: the
    // sword held backwards. Rotating the whole weapon 180 degrees swaps
    // which local half maps to "away from the hand".
    this.weapon.rotation.x = Math.PI + Math.PI * 0.06;
    rArm.hand.add(this.weapon);

    // offhand (shield for goblin, empty for knight)
    if (kind === 'goblin') {
      this.offhand = buildRoundShield(gMat!);
      this.offhand.rotation.y = Math.PI / 2;
      lArm.hand.add(this.offhand);
    } else {
      this.offhand = null;
    }

    // legs
    const hipY = 0;
    const hipX = p.torsoWidth * 0.28;
    const buildLeg = (side: -1 | 1) => {
      const upper = makeSegment(p.legLen * 0.52, p.legRadius, p.legRadius * 0.9, darkMat);
      upper.pivot.position.set(hipX * side, hipY, 0);
      hips.add(upper.pivot);

      const lower = makeSegment(p.legLen * 0.48, p.legRadius * 0.85, p.legRadius * 0.65, limbMat);
      upper.end.add(lower.pivot);

      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.22), darkMat);
      foot.position.set(0, -0.02, 0.05);
      foot.castShadow = true;
      lower.end.add(foot);

      return { hip: upper.pivot, knee: upper.end };
    };

    const rLeg = buildLeg(1);
    this.joints.rHip = rLeg.hip;
    this.joints.rKnee = rLeg.knee;
    const lLeg = buildLeg(-1);
    this.joints.lHip = lLeg.hip;
    this.joints.lKnee = lLeg.knee;

    for (const name of JOINT_NAMES) {
      if (!this.joints[name]) throw new Error(`Fighter rig missing joint ${name}`);
    }
  }

  /**
   * Applies an Euler-angle pose (radians) to every joint present in `pose`;
   * joints not mentioned are left untouched. Every value is clamped to
   * JOINT_LIMITS first -- a hard backstop so no pose, however it was
   * produced, can ever bend a joint past what a real one could do.
   */
  applyPose(pose: Partial<Record<JointName, readonly [number, number, number]>>) {
    for (const name of JOINT_NAMES) {
      const rot = pose[name];
      if (!rot) continue;
      const [lo, hi] = JOINT_LIMITS[name];
      const x = rot[0] < lo[0] ? lo[0] : rot[0] > hi[0] ? hi[0] : rot[0];
      const y = rot[1] < lo[1] ? lo[1] : rot[1] > hi[1] ? hi[1] : rot[1];
      const z = rot[2] < lo[2] ? lo[2] : rot[2] > hi[2] ? hi[2] : rot[2];
      this.joints[name].rotation.set(x, y, z);
    }
  }
}
