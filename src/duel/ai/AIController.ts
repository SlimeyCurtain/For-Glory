import type { CombatController } from '../combat/CombatController';

const DEFEND_CHANCE = 0.55;
const BLOCK_VS_DODGE_CHANCE = 0.55; // of the defends taken, how many are a block vs a dodge
const CHAIN_CONTINUE_CHANCE: readonly number[] = [0.85, 0.7, 0.55]; // indexed by (comboStep - 1) just landed

interface PendingReaction {
  at: number;
  kind: 'block' | 'dodge';
  dir: -1 | 1;
}

/**
 * Drives the goblin under the exact same control constraints as the player:
 * discrete attack taps that must land in the 0.9-1.1s combo window to chain,
 * a single dodge/block gesture at a time, and a forced rest after a 4-hit
 * combo. Nothing here reaches into CombatController internals -- it only
 * calls the same public attackInput/dodgeInput/setBlocking API the touch
 * layer uses for the player.
 */
export class AIController {
  private clock = 0;
  private nextIdleActionAt = 0.9 + Math.random() * 1.2;
  private pendingChainAt: number | null = null;
  private reactionPending: PendingReaction | null = null;
  private blockReleaseAt: number | null = null;
  private prevPlayerAttacking = false;

  update(dt: number, player: CombatController, enemy: CombatController) {
    this.clock += dt;
    if (enemy.state === 'dead' || player.state === 'dead') return;

    this.updateDefense(dt, player, enemy);
    this.updateOffense(enemy);
  }

  private updateDefense(_dt: number, player: CombatController, enemy: CombatController) {
    const playerAttackingNow = player.state === 'attacking';
    if (playerAttackingNow && !this.prevPlayerAttacking && Math.random() < DEFEND_CHANCE) {
      const delay = 0.07 + Math.random() * 0.13;
      const kind: PendingReaction['kind'] = Math.random() < BLOCK_VS_DODGE_CHANCE ? 'block' : 'dodge';
      this.reactionPending = { at: this.clock + delay, kind, dir: Math.random() < 0.5 ? -1 : 1 };
    }
    this.prevPlayerAttacking = playerAttackingNow;

    if (this.reactionPending && this.clock >= this.reactionPending.at) {
      if (this.reactionPending.kind === 'block') {
        enemy.setBlocking(true);
        this.blockReleaseAt = this.clock + 0.3 + Math.random() * 0.15;
      } else {
        enemy.dodgeInput(this.reactionPending.dir);
      }
      this.reactionPending = null;
    }

    if (this.blockReleaseAt !== null && this.clock >= this.blockReleaseAt) {
      enemy.setBlocking(false);
      this.blockReleaseAt = null;
    }
  }

  private updateOffense(enemy: CombatController) {
    if (enemy.state === 'idle') {
      if (this.clock >= this.nextIdleActionAt) {
        enemy.attackInput();
        this.scheduleChainDecision(enemy);
      }
    } else if (enemy.state === 'comboWait') {
      if (this.pendingChainAt !== null) {
        if (this.clock >= this.pendingChainAt) {
          enemy.attackInput();
          this.pendingChainAt = null;
          this.scheduleChainDecision(enemy);
        }
      } else if (this.clock >= this.nextIdleActionAt) {
        // Deliberately outside the window -- CombatController will read this
        // as a mistimed follow-up and restart the combo at the opener.
        enemy.attackInput();
        this.scheduleChainDecision(enemy);
      }
    } else if (enemy.state === 'resting') {
      this.pendingChainAt = null;
      this.nextIdleActionAt = this.clock + 0.5 + Math.random() * 1.0;
    }
  }

  private scheduleChainDecision(enemy: CombatController) {
    const step = enemy.comboStep;
    if (step <= 0 || step >= 4) {
      this.pendingChainAt = null;
      this.nextIdleActionAt = this.clock + 0.6 + Math.random() * 1.3;
      return;
    }
    const continueChance = CHAIN_CONTINUE_CHANCE[step - 1] ?? 0.5;
    if (Math.random() < continueChance) {
      this.pendingChainAt = this.clock + 0.93 + Math.random() * 0.12;
    } else {
      this.pendingChainAt = null;
      this.nextIdleActionAt = this.clock + 0.75 + Math.random() * 1.3;
    }
  }
}
