import { BUILDINGS, RESOURCE_TICK_MS, TROOPS } from './balance';
import type { BuildingType, ResourceKey, TroopType } from './balance';
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

  /**
   * Whether taking on this much more per-resource upkeep would still leave
   * every affected resource's net rate non-negative -- the actual thing
   * that starves an economy isn't the one-time cost (issueBuild/issueTrain
   * already refuse what isn't affordable), it's stacking recurring drain
   * faster than production grows to cover it.
   */
  private canSustainUpkeep(upkeep: Partial<Record<ResourceKey, number>>): boolean {
    for (const resource of Object.keys(upkeep) as ResourceKey[]) {
      const perTick = upkeep[resource] ?? 0;
      if (perTick === 0) continue;
      const perSecond = perTick / (RESOURCE_TICK_MS[resource] / 1000);
      if (this.state.netResourceRatePerSec(this.me, resource) + perSecond < 0.1) return false;
    }
    return true;
  }

  private maybeBuild() {
    // Farms are pure income (one-time gold, no ongoing upkeep) so they're
    // always worth adding while territory and the escalating price allow.
    // Upkeep-bearing buildings only get attempted once the economy could
    // actually absorb their recurring drain.
    const territory = this.state.ownedTerritoryTiles(this.me);

    const priority: BuildingType[] = ['farm', 'barracks', 'lumberMill'];

    for (const type of priority) {
      const countOfType = this.state.buildingsOf(this.me).filter((b) => b.type === type).length;
      if (type === 'farm' && countOfType >= 4) continue;
      if (type === 'lumberMill' && countOfType >= 1) continue;
      const upkeep = BUILDINGS[type].upkeep;
      if (upkeep && !this.canSustainUpkeep(upkeep)) continue;

      const spot = territory.find(
        (tile) => this.state.canBuildAt(this.me, tile).ok && this.state.availableBuildingsFor(this.me, tile).includes(type)
      );
      if (spot && this.state.issueBuild(this.me, spot, type).ok) return;
    }
  }

  private maybeTrain() {
    const barracks = this.state.buildingsOf(this.me).find((b) => b.type === 'barracks' && b.state === 'active' && !b.training);
    if (!barracks) return;
    const hasWood = this.state.buildingsOf(this.me).some((b) => b.type === 'lumberMill' && b.state === 'active');
    const type: TroopType = hasWood && TROOPS.archer.requiresWoodProduction ? 'archer' : 'militia';
    // A new troop is permanent extra upkeep -- only commit to one if the
    // economy can actually absorb it, so the army doesn't grow faster than
    // the production backing it (which is exactly what starves it out).
    if (!this.canSustainUpkeep(TROOPS[type].upkeep)) return;
    this.state.issueTrain(this.me, barracks.id, type);
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
