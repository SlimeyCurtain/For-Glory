import { ownerOfCol } from './mapGen';
import { GameState } from './GameState';
import type { PlayerId } from './types';

/**
 * Very simple scripted opponent so the core loop is testable solo.
 * Not meant to be "smart" -- just active enough to exercise build,
 * train, attack, and intercept flows.
 */
export class AIController {
  private decisionCooldownMs = 0;
  private state: GameState;
  private me: PlayerId;

  constructor(state: GameState, me: PlayerId) {
    this.state = state;
    this.me = me;
  }

  update(dtMs: number) {
    this.decisionCooldownMs -= dtMs;
    if (this.decisionCooldownMs > 0) return;
    this.decisionCooldownMs = 1200;

    this.maybeBuild();
    this.maybeTrain();
    this.maybeAttack();
    this.maybeIntercept();
    this.maybeRepair();
  }

  private myTiles(): { col: number; row: number }[] {
    const tiles: { col: number; row: number }[] = [];
    for (const t of this.state.tiles.values()) {
      if (ownerOfCol(t.offset.col) === this.me) tiles.push(t.offset);
    }
    return tiles;
  }

  private maybeBuild() {
    const player = this.state.players[this.me];
    const options = this.state.availableBuildingsFor(this.me);
    // prefer barracks once unlocked and affordable, otherwise farm
    const priority = options.includes('barracks') ? ['barracks', 'farm'] as const : ['farm'] as const;

    for (const type of priority) {
      const cost = type === 'farm' ? 50 : 90;
      if (player.gold < cost) continue;
      const farmCount = this.state.buildingsOf(this.me).filter((b) => b.type === type).length;
      if (type === 'farm' && farmCount >= 2) continue;
      if (type === 'barracks' && farmCount >= 1) continue;

      const spot = this.myTiles().find((tile) => this.state.canBuildAt(this.me, tile).ok);
      if (spot) {
        this.state.issueBuild(this.me, spot, type);
        return;
      }
    }
  }

  private maybeTrain() {
    const barracks = this.state.buildingsOf(this.me).find((b) => b.type === 'barracks' && b.state === 'active' && !b.training);
    if (!barracks) return;
    const player = this.state.players[this.me];
    if (player.gold >= 25 && player.food >= 15) {
      this.state.issueTrain(this.me, barracks.id, 'swordsman');
    }
  }

  private maybeAttack() {
    const idleTroops = this.state.troopsOf(this.me).filter((t) => t.order.kind === 'idle');
    if (idleTroops.length === 0) return;
    // only commit to an attack once we have a small force, so the AI isn't suicidal
    if (idleTroops.length < 2) return;
    const targets = this.state.attackableBuildings(this.me);
    if (targets.length === 0) return;
    const target = targets[Math.floor(Math.random() * targets.length)];
    for (const troop of idleTroops) {
      this.state.issueAttackOrder(troop.id, target.id);
    }
  }

  private maybeIntercept() {
    const threats = this.state.incomingThreatsFor(this.me);
    if (threats.length === 0) return;
    const idleTroops = this.state.troopsOf(this.me).filter((t) => t.order.kind === 'idle');
    for (const threat of threats) {
      const defender = idleTroops.pop();
      if (!defender) break;
      this.state.issueInterceptOrder(defender.id, threat.id);
    }
  }

  private maybeRepair() {
    const damaged = this.state
      .buildingsOf(this.me)
      .find((b) => b.state === 'active' && !b.repairing && b.hp < b.maxHp * 0.6);
    if (!damaged) return;
    const player = this.state.players[this.me];
    const cost = Math.ceil((damaged.maxHp - damaged.hp) * 0.5);
    if (player.gold >= cost + 20) {
      this.state.issueRepair(this.me, damaged.id);
    }
  }
}
