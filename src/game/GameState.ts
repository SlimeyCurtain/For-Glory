import {
  BASE_GOLD_PER_TICK,
  BUILDINGS,
  BUILDING_DAMAGE_PER_SEC,
  INCOME_TICK_MS,
  MATCH_DURATION_MS,
  PILLAGE_PER_SEC,
  REPAIR_HP_PER_SEC,
  SCORE,
  STARTING_FOOD,
  STARTING_GOLD,
  TERRAIN,
  TROOPS,
} from './balance';
import type { BuildingType, TroopType } from './balance';
import { key, neighborsOf, hexDistance } from './hex';
import type { Offset } from './hex';
import { generateMap, ownerOfCol, P1_CASTLE, P2_CASTLE } from './mapGen';
import type { TileMap } from './mapGen';
import { findPath, tileCrossMs } from './pathfinding';
import type { Building, PlayerId, PlayerState, ScoreEvent, Training, Troop, TroopOrder } from './types';

let nextId = 1;
const genId = (prefix: string) => `${prefix}${nextId++}`;

export type GameOverReason = 'castle' | 'time' | null;

export class GameState {
  tiles: TileMap;
  players: Record<PlayerId, PlayerState>;
  buildings: Map<string, Building> = new Map();
  troops: Map<string, Troop> = new Map();
  matchElapsedMs = 0;
  incomeAccumMs = 0;
  gameOver = false;
  winner: PlayerId | 0 | null = null;
  gameOverReason: GameOverReason = null;
  pendingScoreEvents: ScoreEvent[] = [];

  constructor() {
    this.tiles = generateMap();
    const castle1 = this.spawnBuilding(1, 'castle', P1_CASTLE, true);
    const castle2 = this.spawnBuilding(2, 'castle', P2_CASTLE, true);
    this.players = {
      1: { id: 1, gold: STARTING_GOLD, food: STARTING_FOOD, score: 0, castleId: castle1.id },
      2: { id: 2, gold: STARTING_GOLD, food: STARTING_FOOD, score: 0, castleId: castle2.id },
    };
  }

  // ---------- queries ----------

  opponentOf(p: PlayerId): PlayerId {
    return p === 1 ? 2 : 1;
  }

  buildingsOf(owner: PlayerId): Building[] {
    return [...this.buildings.values()].filter((b) => b.ownerId === owner && b.state !== 'destroyed');
  }

  troopsOf(owner: PlayerId): Troop[] {
    return [...this.troops.values()].filter((t) => t.ownerId === owner);
  }

  tileOccupiedByBuilding(o: Offset): Building | null {
    for (const b of this.buildings.values()) {
      if (b.state === 'destroyed') continue;
      if (b.tile.col === o.col && b.tile.row === o.row) return b;
    }
    return null;
  }

  canBuildAt(owner: PlayerId, tile: Offset): { ok: boolean; reason?: string } {
    if (ownerOfCol(tile.col) !== owner) return { ok: false, reason: 'Outside your territory' };
    const t = this.tiles.get(key(tile));
    if (!t) return { ok: false, reason: 'Invalid tile' };
    if (t.terrain === 'mountains' || t.terrain === 'river')
      return { ok: false, reason: 'Cannot build on this terrain' };
    if (this.tileOccupiedByBuilding(tile)) return { ok: false, reason: 'Tile occupied' };
    return { ok: true };
  }

  availableBuildingsFor(owner: PlayerId): BuildingType[] {
    const opts: BuildingType[] = ['farm'];
    const hasFarm = this.buildingsOf(owner).some((b) => b.type === 'farm' && b.state === 'active');
    if (hasFarm) opts.push('barracks');
    return opts;
  }

  attackableBuildings(attacker: PlayerId): Building[] {
    const opp = this.opponentOf(attacker);
    // castle excluded: only siege units may target it (not yet implemented)
    return this.buildingsOf(opp).filter((b) => b.type !== 'castle');
  }

  /** Enemy troops currently moving toward / pillaging one of `owner`'s buildings. */
  incomingThreatsFor(owner: PlayerId): Troop[] {
    const opp = this.opponentOf(owner);
    return this.troopsOf(opp).filter((t) => {
      if (t.order.kind === 'moveToAttack' || t.order.kind === 'pillaging') {
        const b = this.buildings.get(t.order.targetBuildingId);
        return !!b && b.ownerId === owner && b.state !== 'destroyed';
      }
      return false;
    });
  }

  // ---------- commands ----------

  issueBuild(owner: PlayerId, tile: Offset, type: BuildingType): { ok: boolean; reason?: string } {
    const check = this.canBuildAt(owner, tile);
    if (!check.ok) return check;
    if (!this.availableBuildingsFor(owner).includes(type)) return { ok: false, reason: 'Locked' };
    const def = BUILDINGS[type];
    const player = this.players[owner];
    if (player.gold < def.goldCost || player.food < def.foodCost)
      return { ok: false, reason: 'Not enough resources' };
    player.gold -= def.goldCost;
    player.food -= def.foodCost;
    this.spawnBuilding(owner, type, tile, false);
    return { ok: true };
  }

  issueRepair(owner: PlayerId, buildingId: string): { ok: boolean; reason?: string } {
    const b = this.buildings.get(buildingId);
    if (!b || b.ownerId !== owner || b.state !== 'active') return { ok: false, reason: 'Invalid target' };
    if (b.hp >= b.maxHp) return { ok: false, reason: 'Already full health' };
    const cost = Math.ceil((b.maxHp - b.hp) * 0.5);
    const player = this.players[owner];
    if (player.gold < cost) return { ok: false, reason: 'Not enough gold' };
    player.gold -= cost;
    b.repairing = true;
    return { ok: true };
  }

  issueTrain(owner: PlayerId, barracksId: string, type: TroopType): { ok: boolean; reason?: string } {
    const b = this.buildings.get(barracksId);
    if (!b || b.ownerId !== owner || b.type !== 'barracks' || b.state !== 'active')
      return { ok: false, reason: 'Invalid barracks' };
    if (b.training) return { ok: false, reason: 'Already training' };
    const def = TROOPS[type];
    const player = this.players[owner];
    if (player.gold < def.goldCost || player.food < def.foodCost)
      return { ok: false, reason: 'Not enough resources' };
    player.gold -= def.goldCost;
    player.food -= def.foodCost;
    b.training = { troopType: type, remainingMs: def.trainTimeMs, totalMs: def.trainTimeMs };
    return { ok: true };
  }

  issueAttackOrder(troopId: string, targetBuildingId: string): { ok: boolean; reason?: string } {
    const troop = this.troops.get(troopId);
    const target = this.buildings.get(targetBuildingId);
    if (!troop || !target || target.state === 'destroyed') return { ok: false, reason: 'Invalid target' };
    if (target.ownerId === troop.ownerId) return { ok: false, reason: 'Cannot attack own building' };
    if (target.type === 'castle') return { ok: false, reason: 'Castle requires siege units' };

    const dest = this.bestApproachTile(troop.tile, target.tile, troop);
    if (!dest) return { ok: false, reason: 'No path available' };
    const path = this.pathFor(troop, dest);
    if (!path) return { ok: false, reason: 'No path available' };

    troop.path = path;
    troop.pathIndex = 0;
    troop.segmentElapsedMs = 0;
    troop.segmentDurationMs = 0;
    troop.order = { kind: 'moveToAttack', targetBuildingId };
    return { ok: true };
  }

  issueInterceptOrder(troopId: string, targetTroopId: string): { ok: boolean; reason?: string } {
    const troop = this.troops.get(troopId);
    const target = this.troops.get(targetTroopId);
    if (!troop || !target) return { ok: false, reason: 'Invalid target' };
    if (target.ownerId === troop.ownerId) return { ok: false, reason: 'Cannot intercept ally' };

    const path = this.pathFor(troop, target.tile);
    if (!path) return { ok: false, reason: 'No path available' };
    troop.path = path;
    troop.pathIndex = 0;
    troop.segmentElapsedMs = 0;
    troop.segmentDurationMs = 0;
    troop.order = { kind: 'moveToIntercept', targetTroopId, repathCooldownMs: 700 };
    return { ok: true };
  }

  /**
   * Whether `troop` could take one more step onto `to`, given the tiles
   * already queued in `pathSoFar` (stepping from its last entry, or from the
   * troop's current tile if the path is still empty). Used to validate a
   * player-traced path one tap at a time.
   */
  isValidNextStep(troop: Troop, pathSoFar: Offset[], to: Offset): boolean {
    const from = pathSoFar.length > 0 ? pathSoFar[pathSoFar.length - 1] : troop.tile;
    if (hexDistance(from, to) !== 1) return false;
    return this.isTilePassableFor(troop, to);
  }

  /**
   * Move a troop along a path the player traced by hand, tile by tile,
   * instead of an auto-computed shortest route -- this is what lets a
   * player pick a flanking approach through gaps in terrain rather than
   * always taking the optimal line. If `attackTargetBuildingId` is given,
   * the final path tile must be adjacent to that building and the troop
   * starts pillaging on arrival; otherwise it's a plain reposition order.
   */
  issueManualMove(troopId: string, path: Offset[], attackTargetBuildingId?: string): { ok: boolean; reason?: string } {
    const troop = this.troops.get(troopId);
    if (!troop) return { ok: false, reason: 'Invalid troop' };
    if (path.length === 0) return { ok: false, reason: 'No path drawn' };

    let from = troop.tile;
    for (const step of path) {
      if (hexDistance(from, step) !== 1) return { ok: false, reason: 'Path is broken' };
      if (!this.isTilePassableFor(troop, step)) return { ok: false, reason: 'Path crosses impassable terrain' };
      from = step;
    }

    if (attackTargetBuildingId) {
      const target = this.buildings.get(attackTargetBuildingId);
      if (!target || target.state === 'destroyed') return { ok: false, reason: 'Invalid target' };
      if (target.ownerId === troop.ownerId) return { ok: false, reason: 'Cannot attack own building' };
      if (target.type === 'castle') return { ok: false, reason: 'Castle requires siege units' };
      if (hexDistance(path[path.length - 1], target.tile) !== 1)
        return { ok: false, reason: 'Path does not reach that building' };
    }

    troop.path = path;
    troop.pathIndex = 0;
    troop.segmentElapsedMs = 0;
    troop.segmentDurationMs = 0;
    troop.order = attackTargetBuildingId
      ? { kind: 'moveToAttack', targetBuildingId: attackTargetBuildingId }
      : { kind: 'moveToReposition' };
    return { ok: true };
  }

  issueDefendOrder(troopId: string) {
    const troop = this.troops.get(troopId);
    if (!troop) return;
    troop.path = null;
    troop.order = { kind: 'defend' };
  }

  issueHealOrder(troopId: string) {
    const troop = this.troops.get(troopId);
    if (!troop) return;
    troop.path = null;
    troop.order = { kind: 'heal' };
  }

  // ---------- internal helpers ----------

  private spawnBuilding(owner: PlayerId, type: BuildingType, tile: Offset, instant: boolean): Building {
    const def = BUILDINGS[type];
    const b: Building = {
      id: genId('b'),
      ownerId: owner,
      type,
      tile,
      hp: instant ? def.maxHp : Math.max(1, Math.round(def.maxHp * 0.15)),
      maxHp: def.maxHp,
      state: instant ? 'active' : 'constructing',
      buildRemainingMs: instant ? 0 : def.buildTimeMs,
      buildTotalMs: def.buildTimeMs,
      training: null,
      repairing: false,
      pillagedBy: null,
    };
    this.buildings.set(b.id, b);
    return b;
  }

  private pathFor(troop: Troop, dest: Offset): Offset[] | null {
    const def = TROOPS[troop.type];
    const blocked = new Set<string>();
    for (const b of this.buildings.values()) {
      if (b.state === 'destroyed') continue;
      if (b.tile.col === dest.col && b.tile.row === dest.row) continue;
      blocked.add(key(b.tile));
    }
    return findPath(troop.tile, dest, this.tiles, {
      canCrossMountains: def.canCrossMountains,
      canCrossRiver: false,
      blocked,
    });
  }

  /** Pick the passable neighbor tile of `target` closest to `from`. */
  private bestApproachTile(from: Offset, target: Offset, troop: Troop): Offset | null {
    const candidates = neighborsOf(target).filter((n) => this.isTilePassableFor(troop, n));
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => hexDistance(from, a) - hexDistance(from, b));
    return candidates[0];
  }

  private isTilePassableFor(troop: Troop, tile: Offset): boolean {
    const t = this.tiles.get(key(tile));
    if (!t) return false;
    const def = TROOPS[troop.type];
    const terrain = TERRAIN[t.terrain];
    if (terrain.impassableForGroundTroops && !def.canCrossMountains) return false;
    if (terrain.requiresBoatOrBridge) return false;
    if (this.tileOccupiedByBuilding(tile)) return false;
    return true;
  }

  private awardScore(playerId: PlayerId, amount: number, reason: string) {
    this.players[playerId].score += amount;
    this.pendingScoreEvents.push({ playerId, amount, reason });
  }

  private terrainMultAt(o: Offset): number {
    const t = this.tiles.get(key(o));
    return t ? TERRAIN[t.terrain].combatStatMult : 1;
  }

  // ---------- main update loop ----------

  update(dtMs: number) {
    if (this.gameOver) return;

    this.matchElapsedMs += dtMs;
    this.tickIncome(dtMs);
    this.tickConstruction(dtMs);
    this.tickTraining(dtMs);
    this.tickRepair(dtMs);
    this.tickMovement(dtMs);
    this.tickPillage(dtMs);
    this.tickHealing(dtMs);
    this.tickCombat(dtMs);
    this.checkWinConditions();
  }

  private tickIncome(dtMs: number) {
    this.incomeAccumMs += dtMs;
    while (this.incomeAccumMs >= INCOME_TICK_MS) {
      this.incomeAccumMs -= INCOME_TICK_MS;
      for (const p of Object.values(this.players)) {
        p.gold += BASE_GOLD_PER_TICK;
      }
      for (const b of this.buildings.values()) {
        if (b.state !== 'active') continue;
        const def = BUILDINGS[b.type];
        if (def.incomeFoodPer5s) this.players[b.ownerId].food += def.incomeFoodPer5s;
        if (def.incomeGoldPer5s) this.players[b.ownerId].gold += def.incomeGoldPer5s;
      }
    }
  }

  private tickConstruction(dtMs: number) {
    for (const b of this.buildings.values()) {
      if (b.state !== 'constructing') continue;
      b.buildRemainingMs -= dtMs;
      const progress = 1 - Math.max(0, b.buildRemainingMs) / b.buildTotalMs;
      b.hp = Math.max(1, Math.round(b.maxHp * Math.max(progress, 0.15)));
      if (b.buildRemainingMs <= 0) {
        b.state = 'active';
        b.hp = b.maxHp;
        this.awardScore(b.ownerId, SCORE.constructOrRepair, 'construct');
      }
    }
  }

  private tickTraining(dtMs: number) {
    for (const b of this.buildings.values()) {
      if (b.state !== 'active' || !b.training) continue;
      b.training.remainingMs -= dtMs;
      if (b.training.remainingMs <= 0) {
        this.spawnTroop(b.ownerId, b.training.troopType, b.tile);
        b.training = null;
      }
    }
  }

  private spawnTroop(owner: PlayerId, type: TroopType, near: Offset) {
    const def = TROOPS[type];
    const spot = neighborsOf(near).find((n) => {
      const t = this.tiles.get(key(n));
      if (!t) return false;
      if (TERRAIN[t.terrain].moveTimeMult === Infinity) return false;
      if (TERRAIN[t.terrain].impassableForGroundTroops) return false;
      return !this.tileOccupiedByBuilding(n);
    }) ?? near;
    const troop: Troop = {
      id: genId('t'),
      ownerId: owner,
      type,
      hp: def.maxHp,
      maxHp: def.maxHp,
      attack: def.attack,
      defense: def.defense,
      tile: spot,
      path: null,
      pathIndex: 0,
      segmentElapsedMs: 0,
      segmentDurationMs: 0,
      order: { kind: 'idle' },
    };
    this.troops.set(troop.id, troop);
  }

  private tickRepair(dtMs: number) {
    for (const b of this.buildings.values()) {
      if (!b.repairing) continue;
      b.hp = Math.min(b.maxHp, b.hp + (REPAIR_HP_PER_SEC * dtMs) / 1000);
      if (b.hp >= b.maxHp) {
        b.repairing = false;
        this.awardScore(b.ownerId, SCORE.constructOrRepair, 'repair');
      }
    }
  }

  private tickMovement(dtMs: number) {
    const def = (t: Troop) => TROOPS[t.type];
    for (const troop of this.troops.values()) {
      if (troop.order.kind === 'moveToIntercept') {
        troop.order.repathCooldownMs -= dtMs;
        if (troop.order.repathCooldownMs <= 0) {
          const target = this.troops.get(troop.order.targetTroopId);
          if (!target) {
            troop.order = { kind: 'idle' };
            troop.path = null;
            continue;
          }
          if (hexDistance(troop.tile, target.tile) > 1) {
            const path = this.pathFor(troop, target.tile);
            troop.path = path;
            troop.pathIndex = 0;
            troop.order.repathCooldownMs = 700;
          }
        }
      }

      if (!troop.path || troop.pathIndex >= troop.path.length) continue;

      if (troop.segmentDurationMs === 0) {
        const nextTile = troop.path[troop.pathIndex];
        const canCrossRiver = false;
        troop.segmentDurationMs = tileCrossMs(nextTile, this.tiles, {
          canCrossMountains: def(troop).canCrossMountains,
          canCrossRiver,
          blocked: new Set(),
        });
        troop.segmentElapsedMs = 0;
      }

      troop.segmentElapsedMs += dtMs;
      if (troop.segmentElapsedMs >= troop.segmentDurationMs) {
        troop.tile = troop.path[troop.pathIndex];
        troop.pathIndex++;
        troop.segmentElapsedMs = 0;
        troop.segmentDurationMs = 0;

        if (troop.pathIndex >= troop.path.length) {
          troop.path = null;
          if (troop.order.kind === 'moveToAttack') {
            troop.order = { kind: 'pillaging', targetBuildingId: troop.order.targetBuildingId };
          } else if (troop.order.kind === 'moveToIntercept' || troop.order.kind === 'moveToReposition') {
            troop.order = { kind: 'idle' };
          }
        }
      }
    }
  }

  private tickPillage(dtMs: number) {
    for (const b of this.buildings.values()) b.pillagedBy = null;
    for (const troop of this.troops.values()) {
      if (troop.order.kind !== 'pillaging') continue;
      const b = this.buildings.get(troop.order.targetBuildingId);
      if (!b || b.state === 'destroyed') {
        troop.order = { kind: 'idle' };
        continue;
      }
      b.pillagedBy = troop.id;
      const dtSec = dtMs / 1000;
      b.hp = Math.max(0, b.hp - BUILDING_DAMAGE_PER_SEC * dtSec);
      this.players[troop.ownerId].gold += PILLAGE_PER_SEC.gold * dtSec;
      this.players[troop.ownerId].food += PILLAGE_PER_SEC.food * dtSec;
      if (b.hp <= 0) {
        b.state = 'destroyed';
        troop.order = { kind: 'idle' };
        this.awardScore(troop.ownerId, SCORE.buildingDestroyed, 'building');
      }
    }
  }

  private tickHealing(dtMs: number) {
    for (const troop of this.troops.values()) {
      if (troop.order.kind !== 'heal') continue;
      if (troop.hp >= troop.maxHp) continue;
      troop.hp = Math.min(troop.maxHp, troop.hp + (troop.maxHp * 0.08 * dtMs) / 1000);
    }
  }

  private tickCombat(dtMs: number) {
    const dtSec = dtMs / 1000;
    const troopList = [...this.troops.values()];
    const engagedThisTick = new Set<string>();

    for (let i = 0; i < troopList.length; i++) {
      const a = troopList[i];
      if (engagedThisTick.has(a.id)) continue;
      for (let j = i + 1; j < troopList.length; j++) {
        const b = troopList[j];
        if (a.ownerId === b.ownerId) continue;
        if (engagedThisTick.has(b.id)) continue;
        if (hexDistance(a.tile, b.tile) > 1) continue;

        engagedThisTick.add(a.id);
        engagedThisTick.add(b.id);
        a.order = { kind: 'fighting', targetTroopId: b.id };
        b.order = { kind: 'fighting', targetTroopId: a.id };
        a.path = null;
        b.path = null;

        const aDefendBonus = 1; // placeholder for future garrison bonuses
        const bDefendBonus = 1;
        const aAtk = a.attack * this.terrainMultAt(a.tile);
        const bAtk = b.attack * this.terrainMultAt(b.tile);
        const aDef = a.defense * this.terrainMultAt(a.tile) * aDefendBonus;
        const bDef = b.defense * this.terrainMultAt(b.tile) * bDefendBonus;

        const dmgToB = Math.max(2, aAtk - bDef * 0.5);
        const dmgToA = Math.max(2, bAtk - aDef * 0.5);
        b.hp -= dmgToB * dtSec;
        a.hp -= dmgToA * dtSec;
        break;
      }
    }

    // Resolve deaths from the pre-tick snapshot (not the live map) so that a
    // mutual kill -- both troops dropping to 0 hp in the same tick -- credits
    // both owners instead of only whichever troop happens to be deleted first.
    for (const t of troopList) {
      if (t.hp <= 0 && this.troops.has(t.id)) {
        this.troops.delete(t.id);
        if (t.order.kind === 'fighting') {
          const order = t.order;
          const foe = troopList.find((x) => x.id === order.targetTroopId);
          if (foe) {
            this.awardScore(foe.ownerId, SCORE.unitDestroyed, 'unit');
            if (foe.hp > 0) foe.order = { kind: 'idle' };
          }
        }
      }
    }
  }

  private checkWinConditions() {
    for (const p of Object.values(this.players)) {
      const castle = this.buildings.get(p.castleId);
      if (castle && castle.state === 'destroyed') {
        this.gameOver = true;
        this.winner = this.opponentOf(p.id);
        this.gameOverReason = 'castle';
        return;
      }
    }
    if (this.matchElapsedMs >= MATCH_DURATION_MS) {
      this.gameOver = true;
      this.gameOverReason = 'time';
      const s1 = this.players[1].score;
      const s2 = this.players[2].score;
      this.winner = s1 === s2 ? 0 : s1 > s2 ? 1 : 2;
    }
  }
}

export type { Training, TroopOrder };
