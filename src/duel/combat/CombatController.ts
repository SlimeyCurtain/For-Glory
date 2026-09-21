import type { Fighter } from '../entities/Fighter';
import { COMBO_CLIPS, evaluateClip } from './clips';
import { BLOCK_POSE_SHIELD, BLOCK_POSE_SWORD, REST_POSE, lerpPose, type Pose } from './pose';

export const COMBO_WINDOW_MIN = 0.9;
export const COMBO_WINDOW_MAX = 1.1;
const REST_RECOVERY = 0.4;
const DODGE_DURATION = 0.42;
const DODGE_AMPLITUDE = 0.85;
// How fast the rig actually chases whatever pose the state machine wants this
// frame (a critically-damped spring, not an instant snap). This is the "give"
// that keeps limbs from teleporting between keyframes -- combined with
// quaternion slerp (see pose.ts) and the hard joint-angle clamps in
// Fighter.applyPose, it's what turns "flailing" into "stiff, controlled
// motion". Higher = snappier/more rigid, lower = heavier/laggier.
const JOINT_STIFFNESS = 22;

export type FighterState = 'idle' | 'attacking' | 'comboWait' | 'resting' | 'dead';

export interface CombatEvents {
  onAttackStart?: (comboStep: number) => void;
  onHit?: (finalDamage: number, wasBlocked: boolean) => void;
  onEvade?: () => void;
  onHpChange?: (hp: number, maxHp: number) => void;
  onDeath?: () => void;
}

function randInt(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}

export class CombatController {
  readonly fighter: Fighter;
  readonly maxHp = 100;
  hp = 100;
  state: FighterState = 'idle';
  comboStep = 0;
  isBlocking = false;
  opponent!: CombatController;

  private attackElapsed = 0;
  private impactResolved = false;
  private restTimer = 0;
  /** What the state machine wants the pose to be *this frame*, before the stiffness spring. */
  private targetPose: Pose = REST_POSE;
  /** What's actually pushed to the rig -- eases toward targetPose at JOINT_STIFFNESS rather than snapping to it. */
  private appliedPose: Pose = REST_POSE;
  private dodgeDir: -1 | 0 | 1 = 0;
  private dodgeElapsed = DODGE_DURATION;
  private laneX = 0;
  private deathElapsed = 0;
  /** Internal seconds clock, advanced only by update(dt). All combo-window timing is measured
   *  against this rather than any timestamp the caller supplies, so attackInput() and update()
   *  can never drift apart onto two different clocks. */
  private clock = 0;
  private lastAttackClockTime = -Infinity;
  private readonly events: CombatEvents;

  constructor(fighter: Fighter, events: CombatEvents = {}) {
    this.fighter = fighter;
    this.events = events;
    this.targetPose = REST_POSE;
    this.appliedPose = REST_POSE;
    fighter.applyPose(REST_POSE);
  }

  get isDodging(): boolean {
    return this.dodgeElapsed < DODGE_DURATION;
  }

  get laneOffset(): number {
    return this.laneX;
  }

  /** Right-half tap. */
  attackInput() {
    if (this.state === 'dead' || this.state === 'attacking' || this.state === 'resting') return;
    if (this.isBlocking) return;

    let nextStep: number;
    if (this.state === 'comboWait' && this.comboStep > 0 && this.comboStep < 4) {
      const delta = this.clock - this.lastAttackClockTime;
      nextStep = delta >= COMBO_WINDOW_MIN && delta <= COMBO_WINDOW_MAX ? this.comboStep + 1 : 1;
    } else {
      nextStep = 1;
    }

    this.comboStep = nextStep;
    this.state = 'attacking';
    this.attackElapsed = 0;
    this.impactResolved = false;
    this.lastAttackClockTime = this.clock;
    this.events.onAttackStart?.(nextStep);
  }

  /** Left-half swipe. */
  dodgeInput(dir: -1 | 1) {
    if (this.state === 'dead') return;
    this.dodgeDir = dir;
    this.dodgeElapsed = 0;
  }

  setBlocking(active: boolean) {
    if (this.state === 'dead') return;
    this.isBlocking = active;
  }

  /** Called on the DEFENDER by the attacker at the attack's impact frame. Returns final damage applied. */
  resolveIncomingHit(rawDamage: number): number {
    if (this.state === 'dead') return 0;

    if (this.isDodging) {
      this.events.onEvade?.();
      return 0;
    }

    const canBlock = this.isBlocking && this.state !== 'attacking';
    const final = canBlock ? Math.round(rawDamage * 0.5) : rawDamage;
    this.hp = Math.max(0, this.hp - final);
    this.events.onHit?.(final, canBlock);
    this.events.onHpChange?.(this.hp, this.maxHp);

    if (this.hp <= 0) {
      this.state = 'dead';
      this.deathElapsed = 0;
      this.events.onDeath?.();
    }

    return final;
  }

  update(dt: number) {
    this.clock += dt;
    this.updateDodgePosition(dt);

    if (this.state === 'dead') {
      this.updateDeath(dt);
      return;
    }

    if (this.state === 'attacking') {
      this.updateAttacking(dt);
    } else if (this.state === 'resting') {
      this.restTimer -= dt;
      this.targetPose = REST_POSE;
      if (this.restTimer <= 0) {
        this.state = 'idle';
        this.comboStep = 0;
      }
    } else if (this.state === 'comboWait') {
      // Holds the just-finished attack's follow-through pose (targetPose is
      // simply left as whatever updateAttacking last set it to) until either
      // the next tap fires a new clip, or the combo window lapses and the
      // fighter eases back down to a neutral stance on its own.
      const sinceInput = this.clock - this.lastAttackClockTime;
      if (sinceInput > COMBO_WINDOW_MAX + 0.35) {
        this.targetPose = REST_POSE;
      }
    } else if (this.state === 'idle') {
      this.targetPose = REST_POSE;
    }

    if (this.isBlocking && this.state !== 'attacking') {
      this.targetPose = this.fighter.kind === 'knight' ? BLOCK_POSE_SWORD : BLOCK_POSE_SHIELD;
    }

    this.appliedPose = lerpPose(this.appliedPose, this.targetPose, Math.min(1, dt * JOINT_STIFFNESS));
    this.fighter.applyPose(this.appliedPose);
  }

  private updateAttacking(dt: number) {
    this.attackElapsed += dt;
    const clip = COMBO_CLIPS[this.comboStep - 1];

    if (!this.impactResolved && this.attackElapsed >= clip.duration * clip.impactFrac) {
      this.impactResolved = true;
      const raw = randInt(clip.minDamage, clip.maxDamage);
      this.opponent.resolveIncomingHit(raw);
    }

    this.targetPose = evaluateClip(clip, this.attackElapsed);

    if (this.attackElapsed >= clip.duration) {
      if (this.comboStep >= 4) {
        this.state = 'resting';
        this.restTimer = REST_RECOVERY;
        this.comboStep = 0;
      } else {
        this.state = 'comboWait';
      }
    }
  }

  private updateDodgePosition(dt: number) {
    this.dodgeElapsed = Math.min(this.dodgeElapsed + dt, DODGE_DURATION);
    const t = Math.min(this.dodgeElapsed / DODGE_DURATION, 1);
    const arc = Math.sin(Math.PI * t); // 0 -> 1 -> 0
    this.laneX = this.dodgeDir * DODGE_AMPLITUDE * arc;
  }

  private updateDeath(dt: number) {
    this.deathElapsed += dt;
    const t = Math.min(this.deathElapsed / 0.7, 1);
    this.fighter.group.rotation.x = t * 1.35;
    this.fighter.group.position.y = -t * 0.15;
  }
}
