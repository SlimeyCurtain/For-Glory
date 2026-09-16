import {
  BARRACKS_FARM_ADJACENCY_TRAIN_DISCOUNT_MS,
  BASE_GOLD_PER_TICK,
  BUILDINGS,
  BUILDING_DAMAGE_PER_SEC,
  CASTLE_ATTACK,
  FARM_FOOD,
  FARM_STRAW,
  FISHERS_HUT_FARM_FOOD_BONUS,
  FISHERS_HUT_GOLD,
  HOUSE_FOREST_WOOD,
  HOUSE_GOLD_BASE,
  HOUSE_HILLS_ENEMY_DEBUFF_MULT,
  HOUSE_MOUNTAIN_BONUS_GOLD,
  HOUSE_MOUNTAIN_BONUS_STONE_UPKEEP,
  LUMBER_MILL_WOOD_INTERVAL_MS,
  LUMBER_MILL_WOOD_PER_FOREST,
  MATCH_DURATION_MS,
  MIN_BUILD_TIME_MS,
  PILLAGE_PER_SEC,
  QUARRY_STONE_INTERVAL_MS,
  QUARRY_STONE_PER_MOUNTAIN,
  REBUILD_TIME_DISCOUNT_MS,
  REPAIR_HP_PER_SEC,
  RESOURCE_TICK_MS,
  SCORE,
  STARTING_FOOD,
  STARTING_GOLD,
  STARTING_STONE,
  STARTING_STRAW,
  STARTING_WOOD,
  TERRAIN,
  TROOPS,
} from './balance';
import type { BuildingType, ResourceKey, TerrainType, TroopType } from './balance';
import { key, neighborsOf, hexDistance } from './hex';
import type { Offset } from './hex';
import { generateMap } from './mapGen';
import type { TileMap } from './mapGen';
import { findPath, tileCrossMs } from './pathfinding';
import type { PathOptions } from './pathfinding';
import type { Building, PlayerId, PlayerState, ProductionFeed, ScoreEvent, Training, Troop, TroopOrder } from './types';

let nextId = 1;
const genId = (prefix: string) => `${prefix}${nextId++}`;

export type GameOverReason = 'castle' | 'time' | null;

export class GameState {
  tiles: TileMap;
  players: Record<PlayerId, PlayerState>;
  buildings: Map<string, Building> = new Map();
  troops: Map<string, Troop> = new Map();
  matchElapsedMs = 0;
  private resourceAccumMs: Record<ResourceKey, number> = { gold: 0, food: 0, straw: 0, wood: 0, stone: 0 };
  gameOver = false;
  winner: PlayerId | 0 | null = null;
  gameOverReason: GameOverReason = null;
  pendingScoreEvents: ScoreEvent[] = [];
  /** Castle shots fired this frame, for the scene to render a quick visual and then discard. */
  pendingCastleShots: { from: Offset; to: Offset }[] = [];

  constructor() {
    const map = generateMap();
    this.tiles = map.tiles;
    const castle1 = this.spawnBuilding(1, 'castle', map.p1Castle, true);
    const castle2 = this.spawnBuilding(2, 'castle', map.p2Castle, true);
    const base = { gold: STARTING_GOLD, food: STARTING_FOOD, straw: STARTING_STRAW, wood: STARTING_WOOD, stone: STARTING_STONE };
    this.players = {
      1: { id: 1, ...base, score: 0, castleId: castle1.id },
      2: { id: 2, ...base, score: 0, castleId: castle2.id },
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

  terrainAt(tile: Offset): TerrainType | null {
    return this.tiles.get(key(tile))?.terrain ?? null;
  }

  tileOccupiedByBuilding(o: Offset): Building | null {
    for (const b of this.buildings.values()) {
      if (b.state === 'destroyed') continue;
      if (b.tile.col === o.col && b.tile.row === o.row) return b;
    }
    return null;
  }

  /** A tile is a player's territory once they own a building on it, or on any neighboring tile. */
  isOwnedTerritory(owner: PlayerId, tile: Offset): boolean {
    const ownsTile = (o: Offset) => this.tileOccupiedByBuilding(o)?.ownerId === owner;
    return ownsTile(tile) || neighborsOf(tile).some(ownsTile);
  }

  /** All tiles currently inside a player's territory -- used by the build-menu UI and the AI. */
  ownedTerritoryTiles(owner: PlayerId): Offset[] {
    const result = new Map<string, Offset>();
    for (const b of this.buildingsOf(owner)) {
      result.set(key(b.tile), b.tile);
      for (const n of neighborsOf(b.tile)) result.set(key(n), n);
    }
    return [...result.values()];
  }

  canBuildAt(owner: PlayerId, tile: Offset): { ok: boolean; reason?: string } {
    const t = this.tiles.get(key(tile));
    if (!t) return { ok: false, reason: 'Invalid tile' };
    if (t.terrain === 'mountains' || t.terrain === 'river')
      return { ok: false, reason: 'Cannot build on this terrain' };
    if (this.tileOccupiedByBuilding(tile)) return { ok: false, reason: 'Tile occupied' };
    if (!this.isOwnedTerritory(owner, tile)) return { ok: false, reason: 'Outside your territory' };
    return { ok: true };
  }

  /** Building types buildable on this specific tile: unlocked for the player, and terrain/adjacency-compatible. */
  availableBuildingsFor(owner: PlayerId, tile: Offset): BuildingType[] {
    const t = this.tiles.get(key(tile));
    if (!t) return [];
    const hasFarm = this.buildingsOf(owner).some((b) => b.type === 'farm' && b.state === 'active');
    const candidates: BuildingType[] = ['farm', 'lumberMill', 'quarry', 'fishersHut', 'house'];
    if (hasFarm) candidates.push('barracks');

    return candidates.filter((type) => {
      const def = BUILDINGS[type];
      if (def.allowedTerrain && !def.allowedTerrain.includes(t.terrain)) return false;
      if (def.requiresAdjacentTerrain) {
        const hasNeighborMatch = neighborsOf(tile).some((n) => {
          const nt = this.tiles.get(key(n));
          return !!nt && def.requiresAdjacentTerrain!.includes(nt.terrain);
        });
        if (!hasNeighborMatch) return false;
      }
      if (def.maxConcurrent != null) {
        const count = this.buildingsOf(owner).filter((b) => b.type === type).length;
        if (count >= def.maxConcurrent) return false;
      }
      return true;
    });
  }

  /** Full resource cost for this player's next instance of `type` (farms escalate; UI shows this instead of the static def cost). */
  previewBuildCost(owner: PlayerId, type: BuildingType): Partial<Record<ResourceKey, number>> {
    const def = BUILDINGS[type];
    const cost: Partial<Record<ResourceKey, number>> = { gold: this.goldCostFor(owner, type) };
    if (def.foodCost) cost.food = def.foodCost;
    if (def.strawCost) cost.straw = def.strawCost;
    if (def.woodCost) cost.wood = def.woodCost;
    if (def.stoneCost) cost.stone = def.stoneCost;
    return cost;
  }

  /**
   * Net per-second rate of `resource` for `owner`, combining upkeep (resolved
   * on that resource's own global cadence) and production (resolved per
   * building instance) -- lets the HUD show a live rate and flag it red when
   * the player is burning through reserves.
   */
  netResourceRatePerSec(owner: PlayerId, resource: ResourceKey): number {
    let upkeepDelta = resource === 'gold' ? BASE_GOLD_PER_TICK : 0;
    for (const b of this.buildingsOf(owner)) {
      if (b.state !== 'active') continue;
      upkeepDelta += (BUILDINGS[b.type].upkeep?.[resource] ?? 0) + (b.extraUpkeep?.[resource] ?? 0);
    }
    for (const t of this.troopsOf(owner)) {
      upkeepDelta += TROOPS[t.type].upkeep[resource] ?? 0;
    }
    const upkeepPerSec = upkeepDelta / (RESOURCE_TICK_MS[resource] / 1000);

    let productionPerSec = 0;
    for (const b of this.buildingsOf(owner)) {
      if (b.state !== 'active') continue;
      for (const feed of b.production) {
        if (feed.resource !== resource) continue;
        let amount = feed.amount;
        if (b.type === 'farm' && feed.resource === 'food' && this.hasAdjacentActiveFishersHut(b)) {
          amount += FISHERS_HUT_FARM_FOOD_BONUS;
        }
        productionPerSec += amount / (feed.intervalMs / 1000);
      }
    }
    return upkeepPerSec + productionPerSec;
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
    if (!this.availableBuildingsFor(owner, tile).includes(type))
      return { ok: false, reason: 'Cannot build that here' };
    const def = BUILDINGS[type];
    const player = this.players[owner];
    const goldCost = this.goldCostFor(owner, type);
    const foodCost = def.foodCost;
    const strawCost = def.strawCost ?? 0;
    const woodCost = def.woodCost ?? 0;
    const stoneCost = def.stoneCost ?? 0;
    if (
      player.gold < goldCost ||
      player.food < foodCost ||
      player.straw < strawCost ||
      player.wood < woodCost ||
      player.stone < stoneCost
    )
      return { ok: false, reason: 'Not enough resources' };
    player.gold -= goldCost;
    player.food -= foodCost;
    player.straw -= strawCost;
    player.wood -= woodCost;
    player.stone -= stoneCost;
    this.spawnBuilding(owner, type, tile, false, this.buildTimeFor(owner, type));
    return { ok: true };
  }

  /** Gold cost for the next instance of `type` this player builds (farms escalate; everything else is flat). */
  private goldCostFor(owner: PlayerId, type: BuildingType): number {
    const def = BUILDINGS[type];
    if (!def.goldCostForNth) return def.goldCost;
    const everBuilt = [...this.buildings.values()].filter((b) => b.ownerId === owner && b.type === type).length;
    return def.goldCostForNth(everBuilt + 1);
  }

  /** Rebuilding a type of which every prior instance was destroyed is faster than building it fresh. */
  private buildTimeFor(owner: PlayerId, type: BuildingType): number {
    const priors = [...this.buildings.values()].filter((b) => b.ownerId === owner && b.type === type);
    const isRebuild = priors.length > 0 && priors.every((b) => b.state === 'destroyed');
    const base = BUILDINGS[type].buildTimeMs;
    return isRebuild ? Math.max(MIN_BUILD_TIME_MS, base - REBUILD_TIME_DISCOUNT_MS) : base;
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
    if (def.requiresWoodProduction) {
      const hasWood = this.buildingsOf(owner).some((x) => x.type === 'lumberMill' && x.state === 'active');
      if (!hasWood) return { ok: false, reason: 'Requires wood production' };
    }
    const player = this.players[owner];
    const woodCost = def.woodCost ?? 0;
    if (player.gold < def.goldCost || player.food < def.foodCost || player.wood < woodCost)
      return { ok: false, reason: 'Not enough resources' };
    player.gold -= def.goldCost;
    player.food -= def.foodCost;
    player.wood -= woodCost;
    const trainTimeMs = this.trainTimeFor(b, def.trainTimeMs);
    b.training = { troopType: type, remainingMs: trainTimeMs, totalMs: trainTimeMs };
    return { ok: true };
  }

  /** A Barracks directly next to an active Farm trains troops 3s faster. */
  private trainTimeFor(barracks: Building, baseMs: number): number {
    const hasAdjacentFarm = neighborsOf(barracks.tile).some((n) => {
      const nb = this.tileOccupiedByBuilding(n);
      return nb?.type === 'farm' && nb.state === 'active' && nb.ownerId === barracks.ownerId;
    });
    return hasAdjacentFarm ? Math.max(500, baseMs - BARRACKS_FARM_ADJACENCY_TRAIN_DISCOUNT_MS) : baseMs;
  }

  issueAttackOrder(troopId: string, targetBuildingId: string): { ok: boolean; reason?: string } {
    const troop = this.troops.get(troopId);
    const target = this.buildings.get(targetBuildingId);
    if (!troop || !target || target.state === 'destroyed') return { ok: false, reason: 'Invalid target' };
    if (target.ownerId === troop.ownerId) return { ok: false, reason: 'Cannot attack own building' };
    if (target.type === 'castle') return { ok: false, reason: 'Castle requires siege units' };
    if (!TROOPS[troop.type].canAttackBuildings) return { ok: false, reason: 'This troop cannot attack buildings' };

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
      if (!TROOPS[troop.type].canAttackBuildings) return { ok: false, reason: 'This troop cannot attack buildings' };
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

  /** Defend: doubles the troop's defense and holds it in place until moved, attacked, or killed. */
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

  private spawnBuilding(owner: PlayerId, type: BuildingType, tile: Offset, instant: boolean, buildTimeMs?: number): Building {
    const def = BUILDINGS[type];
    const totalMs = buildTimeMs ?? def.buildTimeMs;
    const b: Building = {
      id: genId('b'),
      ownerId: owner,
      type,
      tile,
      hp: instant ? def.maxHp : Math.max(1, Math.round(def.maxHp * 0.15)),
      maxHp: def.maxHp,
      state: instant ? 'active' : 'constructing',
      buildRemainingMs: instant ? 0 : totalMs,
      buildTotalMs: totalMs,
      training: null,
      repairing: false,
      pillagedBy: null,
      production: [],
    };

    const mkFeed = (resource: ResourceKey, amount: number, intervalMs: number): ProductionFeed => ({
      resource,
      amount,
      intervalMs,
      accumMs: 0,
    });
    const neighborTerrains = () => neighborsOf(tile).map((n) => this.tiles.get(key(n))?.terrain);

    if (type === 'farm') {
      const nearWater = neighborTerrains().includes('river');
      const food = nearWater ? FARM_FOOD.waterAdjacent : FARM_FOOD.base;
      const straw = nearWater ? FARM_STRAW.waterAdjacent : FARM_STRAW.base;
      b.production.push(mkFeed('food', food.amount, food.intervalMs));
      b.production.push(mkFeed('straw', straw.amount, straw.intervalMs));
    } else if (type === 'lumberMill') {
      const forestCount = neighborTerrains().filter((t) => t === 'forest').length;
      b.production.push(mkFeed('wood', forestCount * LUMBER_MILL_WOOD_PER_FOREST, LUMBER_MILL_WOOD_INTERVAL_MS));
    } else if (type === 'quarry') {
      const mountainCount = neighborTerrains().filter((t) => t === 'mountains').length;
      b.production.push(mkFeed('stone', mountainCount * QUARRY_STONE_PER_MOUNTAIN, QUARRY_STONE_INTERVAL_MS));
    } else if (type === 'fishersHut') {
      b.production.push(mkFeed('gold', FISHERS_HUT_GOLD.amount, FISHERS_HUT_GOLD.intervalMs));
    } else if (type === 'house') {
      b.production.push(mkFeed('gold', HOUSE_GOLD_BASE.amount, HOUSE_GOLD_BASE.intervalMs));
      const siteTerrain = this.tiles.get(key(tile))?.terrain;
      const adjacentMountain = neighborTerrains().includes('mountains');
      if (siteTerrain === 'forest') {
        b.production.push(mkFeed('wood', HOUSE_FOREST_WOOD.amount, HOUSE_FOREST_WOOD.intervalMs));
      }
      if (adjacentMountain) {
        b.production.push(mkFeed('gold', HOUSE_MOUNTAIN_BONUS_GOLD.amount, HOUSE_MOUNTAIN_BONUS_GOLD.intervalMs));
        b.extraUpkeep = { stone: HOUSE_MOUNTAIN_BONUS_STONE_UPKEEP };
      }
    } else if (type === 'castle') {
      b.attackCooldownMs = 0;
    }

    this.buildings.set(b.id, b);
    return b;
  }

  private pathFor(troop: Troop, dest: Offset): Offset[] | null {
    const blocked = new Set<string>();
    for (const b of this.buildings.values()) {
      if (b.state === 'destroyed') continue;
      if (b.tile.col === dest.col && b.tile.row === dest.row) continue;
      blocked.add(key(b.tile));
    }
    return findPath(troop.tile, dest, this.tiles, this.pathOptionsFor(troop, blocked));
  }

  private pathOptionsFor(troop: Troop, blocked: Set<string> = new Set()): PathOptions {
    const def = TROOPS[troop.type];
    return {
      canCrossMountains: def.canCrossMountains,
      canCrossRiver: false,
      blocked,
      speedMultiplierFor: (o) => this.hillsSpeedMultiplierFor(troop.ownerId, o),
    };
  }

  /**
   * A House built on hills removes that tile's slowdown for its own owner,
   * but doubles the hills slowdown on every surrounding hills tile for
   * anyone else -- a defensive home-turf effect.
   */
  private hillsSpeedMultiplierFor(troopOwnerId: PlayerId, tile: Offset): number {
    if (this.terrainAt(tile) !== 'hills') return 1;
    const onTile = this.tileOccupiedByBuilding(tile);
    if (onTile?.type === 'house' && onTile.ownerId === troopOwnerId) {
      return 1 / TERRAIN.hills.moveTimeMult; // cancels the hills penalty entirely for the owner
    }
    for (const n of neighborsOf(tile)) {
      if (this.terrainAt(n) !== 'hills') continue;
      const nb = this.tileOccupiedByBuilding(n);
      if (nb?.type === 'house' && nb.ownerId !== troopOwnerId) {
        return HOUSE_HILLS_ENEMY_DEBUFF_MULT;
      }
    }
    return 1;
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
    this.tickResources(dtMs);
    this.tickConstruction(dtMs);
    this.tickTraining(dtMs);
    this.tickRepair(dtMs);
    this.tickMovement(dtMs);
    this.tickPillage(dtMs);
    this.tickHealing(dtMs);
    this.tickCombat(dtMs);
    this.tickCastleDefense(dtMs);
    this.checkWinConditions();
  }

  private tickResources(dtMs: number) {
    for (const resource of Object.keys(RESOURCE_TICK_MS) as ResourceKey[]) {
      this.resourceAccumMs[resource] += dtMs;
      const interval = RESOURCE_TICK_MS[resource];
      while (this.resourceAccumMs[resource] >= interval) {
        this.resourceAccumMs[resource] -= interval;
        this.resolveUpkeepTick(resource);
      }
    }
    this.tickProduction(dtMs);
  }

  /**
   * Each resource resolves its own upkeep on its own cadence (gold every 5s,
   * food/straw every 3s, wood every 8s, stone every 6s) -- base gold income
   * lands here too. If a player can't cover this tick's draw even from
   * their full reserve, consumers of that resource (troops first, then
   * buildings) are destroyed one at a time until the shortfall clears.
   */
  private resolveUpkeepTick(resource: ResourceKey) {
    for (const player of Object.values(this.players)) {
      let delta = resource === 'gold' ? BASE_GOLD_PER_TICK : 0;
      const buildingConsumers: { id: string; amount: number }[] = [];
      const troopConsumers: { id: string; amount: number }[] = [];

      for (const b of this.buildingsOf(player.id)) {
        if (b.state !== 'active') continue;
        const amount = (BUILDINGS[b.type].upkeep?.[resource] ?? 0) + (b.extraUpkeep?.[resource] ?? 0);
        if (amount !== 0) {
          delta += amount;
          buildingConsumers.push({ id: b.id, amount });
        }
      }
      for (const t of this.troopsOf(player.id)) {
        const amount = TROOPS[t.type].upkeep[resource] ?? 0;
        if (amount !== 0) {
          delta += amount;
          troopConsumers.push({ id: t.id, amount });
        }
      }

      const newBalance = player[resource] + delta;
      if (newBalance >= 0) {
        player[resource] = newBalance;
        continue;
      }

      let deficit = -newBalance;
      for (const c of troopConsumers) {
        if (deficit <= 0) break;
        if (!this.troops.has(c.id)) continue;
        this.troops.delete(c.id);
        deficit += c.amount; // amount is negative, so this shrinks the deficit
      }
      for (const c of buildingConsumers) {
        if (deficit <= 0) break;
        const b = this.buildings.get(c.id);
        if (!b || b.state === 'destroyed') continue;
        b.state = 'destroyed';
        deficit += c.amount;
      }
      player[resource] = 0;
    }
  }

  private tickProduction(dtMs: number) {
    for (const b of this.buildings.values()) {
      if (b.state !== 'active') continue;
      for (const feed of b.production) {
        feed.accumMs += dtMs;
        while (feed.accumMs >= feed.intervalMs) {
          feed.accumMs -= feed.intervalMs;
          let amount = feed.amount;
          if (b.type === 'farm' && feed.resource === 'food' && this.hasAdjacentActiveFishersHut(b)) {
            amount += FISHERS_HUT_FARM_FOOD_BONUS;
          }
          this.players[b.ownerId][feed.resource] += amount;
        }
      }
    }
  }

  private hasAdjacentActiveFishersHut(farm: Building): boolean {
    return neighborsOf(farm.tile).some((n) => {
      const nb = this.tileOccupiedByBuilding(n);
      return nb?.type === 'fishersHut' && nb.state === 'active' && nb.ownerId === farm.ownerId;
    });
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
        // Only ever scores on a building type's true first-ever completion --
        // not extra copies, and not rebuilding one that was destroyed.
        const hasAnyPriorOfType = [...this.buildings.values()].some(
          (other) => other.id !== b.id && other.ownerId === b.ownerId && other.type === b.type
        );
        if (!hasAnyPriorOfType) this.awardScore(b.ownerId, SCORE.constructOrRepair, 'construct');
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
        troop.segmentDurationMs = tileCrossMs(nextTile, this.tiles, this.pathOptionsFor(troop));
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
    const dtSec = dtMs / 1000;

    for (const troop of this.troops.values()) {
      if (troop.order.kind !== 'pillaging') continue;
      const b = this.buildings.get(troop.order.targetBuildingId);
      if (!b || b.state === 'destroyed') {
        troop.order = { kind: 'idle' };
        continue;
      }
      b.pillagedBy = troop.id;
      b.hp = Math.max(0, b.hp - BUILDING_DAMAGE_PER_SEC * dtSec);
      this.players[troop.ownerId].gold += PILLAGE_PER_SEC.gold * dtSec;
      this.players[troop.ownerId].food += PILLAGE_PER_SEC.food * dtSec;

      // Some buildings shoot back -- flat damage that ignores the attacker's defense.
      const counter = BUILDINGS[b.type].counterDamage;
      if (counter && !TROOPS[troop.type].isSiege) {
        troop.hp -= counter * dtSec;
      }

      if (b.hp <= 0) {
        b.state = 'destroyed';
        troop.order = { kind: 'idle' };
        this.awardScore(troop.ownerId, SCORE.buildingDestroyed, 'building');
      }
    }

    // A troop killed by a building's counterattack (the building itself
    // survived this tick) credits the defender, same as any other kill.
    for (const troop of [...this.troops.values()]) {
      if (troop.hp <= 0 && troop.order.kind === 'pillaging') {
        const b = this.buildings.get(troop.order.targetBuildingId);
        this.troops.delete(troop.id);
        if (b) this.awardScore(b.ownerId, SCORE.unitDestroyed, 'unit');
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

  /** Whether `attacker` (given its current stance) can strike a target at `targetTile` this tick. */
  private canStrike(attacker: Troop, targetTile: Offset): boolean {
    const def = TROOPS[attacker.type];
    const dist = hexDistance(attacker.tile, targetTile);
    if (dist > def.attackRange) return false;
    if (dist === 1 && def.meleeRequiresDefend && attacker.order.kind !== 'defend') return false;
    return true;
  }

  private combatDamage(attacker: Troop, defender: Troop): number {
    const atk = attacker.attack * this.terrainMultAt(attacker.tile);
    let def = defender.defense * this.terrainMultAt(defender.tile);
    if (defender.order.kind === 'defend') def *= 2; // Defend: double defense while immobile
    return Math.max(2, atk - def * 0.5);
  }

  private tickCombat(dtMs: number) {
    const dtSec = dtMs / 1000;
    const troopList = [...this.troops.values()];
    const kills: { victimId: string; killerOwnerId: PlayerId }[] = [];

    for (let i = 0; i < troopList.length; i++) {
      const a = troopList[i];
      if (a.hp <= 0) continue;
      for (let j = i + 1; j < troopList.length; j++) {
        const b = troopList[j];
        if (b.hp <= 0) continue;
        if (a.ownerId === b.ownerId) continue;

        const aCan = this.canStrike(a, b.tile);
        const bCan = this.canStrike(b, a.tile);
        if (!aCan && !bCan) continue;

        // Defend is a stance the player chose to hold -- combat doesn't
        // knock a defending troop out of it into generic 'fighting'.
        if (a.order.kind !== 'defend') {
          a.order = { kind: 'fighting', targetTroopId: b.id };
          a.path = null;
        }
        if (b.order.kind !== 'defend') {
          b.order = { kind: 'fighting', targetTroopId: a.id };
          b.path = null;
        }

        if (aCan) {
          const dmg = this.combatDamage(a, b);
          b.hp -= dmg * dtSec;
          if (b.hp <= 0) kills.push({ victimId: b.id, killerOwnerId: a.ownerId });
        }
        if (bCan) {
          const dmg = this.combatDamage(b, a);
          a.hp -= dmg * dtSec;
          if (a.hp <= 0) kills.push({ victimId: a.id, killerOwnerId: b.ownerId });
        }
      }
    }

    // A mutual kill records both directions above, so both owners get
    // credited even though only one deletion "wins" per victim id.
    const processed = new Set<string>();
    for (const k of kills) {
      if (processed.has(k.victimId)) continue;
      processed.add(k.victimId);
      if (this.troops.delete(k.victimId)) {
        this.awardScore(k.killerOwnerId, SCORE.unitDestroyed, 'unit');
      }
    }
  }

  private tickCastleDefense(dtMs: number) {
    this.pendingCastleShots = [];
    for (const castle of this.buildings.values()) {
      if (castle.type !== 'castle' || castle.state === 'destroyed') continue;
      castle.attackCooldownMs = Math.max(0, (castle.attackCooldownMs ?? 0) - dtMs);
      if (castle.attackCooldownMs > 0) continue;

      const targets = this.troopsOf(this.opponentOf(castle.ownerId)).filter(
        (t) => hexDistance(t.tile, castle.tile) <= CASTLE_ATTACK.range
      );
      if (targets.length === 0) continue;
      targets.sort((a, b) => hexDistance(a.tile, castle.tile) - hexDistance(b.tile, castle.tile));
      const target = targets[0];

      target.hp -= CASTLE_ATTACK.damage; // ignores defense entirely -- an archer volley, not a melee trade
      castle.attackCooldownMs = CASTLE_ATTACK.cooldownMs;
      this.pendingCastleShots.push({ from: castle.tile, to: target.tile });

      if (target.hp <= 0) {
        this.troops.delete(target.id);
        this.awardScore(castle.ownerId, SCORE.unitDestroyed, 'unit');
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
