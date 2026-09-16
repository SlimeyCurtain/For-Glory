import { BUILDINGS, TROOPS } from './balance';
import type { BuildingType } from './balance';
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

  private maybeBuild() {
    const player = this.state.players[this.me];
    const priority: BuildingType[] = ['barracks', 'farm'];
    const territory = this.state.ownedTerritoryTiles(this.me);

    for (const type of priority) {
      const def = BUILDINGS[type];
      if (player.gold < def.goldCost || player.food < def.foodCost) continue;
      const countOfType = this.state.buildingsOf(this.me).filter((b) => b.type === type).length;
      if (type === 'farm' && countOfType >= 2) continue;
      if (type === 'barracks' && countOfType >= 1) continue;

      const spot = territory.find(
        (tile) => this.state.canBuildAt(this.me, tile).ok && this.state.availableBuildingsFor(this.me, tile).includes(type)
      );
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
    const def = TROOPS.swordsman;
    if (player.gold >= def.goldCost && player.food >= def.foodCost) {
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
