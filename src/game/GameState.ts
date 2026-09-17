import {
  BARRACKS_FARM_ADJACENCY_TRAIN_DISCOUNT_MS,
  BASE_GOLD_PER_TICK,
  BUILDING_MOVE_PENALTY_MULT,
  BUILDINGS,
  CASTLE_ATTACK,
  CLEAR_RUBBLE_COST,
  CLEAR_RUBBLE_COST_ENEMY,
  FARM_FOOD,
  FARM_STRAW,
  FISHERS_HUT_GOLD,
  FISHING_BOAT_FOOD,
  FISHING_BOAT_HUT_GOLD_BONUS,
  HOUSE_FOREST_WOOD,
  HOUSE_GOLD_BASE,
  HOUSE_HILLS_ENEMY_DEBUFF_MULT,
  HOUSE_MOUNTAIN_BONUS_GOLD,
  HOUSE_MOUNTAIN_BONUS_STONE_UPKEEP,
  INSOLVENCY_DAMAGE_PER_TICK,
  LUMBER_MILL_WOOD_INTERVAL_MS,
  LUMBER_MILL_WOOD_PER_FOREST,
  MATCH_DURATION_MS,
  MIN_BUILD_TIME_MS,
  QUARRY_STONE_INTERVAL_MS,
  QUARRY_STONE_PER_MOUNTAIN,
  REPAIR_HP_PER_SEC,
  RESOURCE_TICK_MS,
  roadAdjustedMoveMult,
  SCORE,
  STARTING_FOOD,
  STARTING_GOLD,
  STARTING_STONE,
  STARTING_STRAW,
  STARTING_WOOD,
  TERRAIN,
  TROOPS,
} from './balance';
import type { BuildingType, ResourceKey, SpeedRange, TerrainType, TroopType } from './balance';
import { key, neighborsOf, hexDistance } from './hex';
import type { Offset } from './hex';
import { generateMap } from './mapGen';
import type { TileMap } from './mapGen';
import { findPath, tileCrossMs } from './pathfinding';
import type { PathOptions } from './pathfinding';
import type { Building, PlayerId, PlayerState, ProductionFeed, ScoreEvent, Training, Troop, TroopOrder } from './types';

let nextId = 1;
const genId = (prefix: string) => `${prefix}${nextId++}`;

/** A fresh random cooldown within a speed range -- deliberately non-deterministic, so e.g. two archers trading blows don't always land in lockstep. */
function rollRange(range: SpeedRange): number {
  return range.min + Math.random() * (range.max - range.min);
}

export type GameOverReason = 'castle' | 'time' | null;

/** Granted when a building is destroyed; consumed by the next build of that type for that owner. */
interface RebuildCredit {
  ownerId: PlayerId;
  type: BuildingType;
  cost: Partial<Record<ResourceKey, number>>;
  buildTimeMs: number;
}

export class GameState {
  tiles: TileMap;
  players: Record<PlayerId, PlayerState>;
  buildings: Map<string, Building> = new Map();
  troops: Map<string, Troop> = new Map();
  matchElapsedMs = 0;
  private resourceAccumMs: Record<ResourceKey, number> = { gold: 0, food: 0, straw: 0, wood: 0, stone: 0 };
  private rebuildCredits: RebuildCredit[] = [];
  /** `${ownerId}:${type}` entries that have already scored their one-time first-construction point. */
  private firstConstructionScored = new Set<string>();
  gameOver = false;
  winner: PlayerId | 0 | null = null;
  gameOverReason: GameOverReason = null;
  pendingScoreEvents: ScoreEvent[] = [];
  /** Castle shots fired this frame, for the scene to render a quick visual and then discard. */
  pendingCastleShots: { from: Offset; to: Offset }[] = [];
  /** How many troop-vs-troop swings landed this tick -- read (and reset) each frame by the scene for the clash-of-metal cue. */
  pendingCombatSwings = 0;

  constructor() {
    const map = generateMap();
    this.tiles = map.tiles;
    const castle1 = this.spawnBuilding(1, 'castle', map.p1Castle, true, undefined, {});
    const castle2 = this.spawnBuilding(2, 'castle', map.p2Castle, true, undefined, {});
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

  /**
   * A destroyed building still counts as "occupying" its tile -- it leaves
   * rubble behind rather than vanishing, and that rubble physically blocks
   * new construction (and troop movement) until someone pays to clear it.
   * Once cleared, `issueClearRubble` removes the building from `buildings`
   * entirely, so this naturally goes back to returning null for that tile.
   */
  tileOccupiedByBuilding(o: Offset): Building | null {
    for (const b of this.buildings.values()) {
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
    // Mountains take no building at all; river is now valid ground for a
    // Bridge specifically, so that terrain-vs-type match is left entirely to
    // availableBuildingsFor's per-type allowedTerrain check below.
    if (t.terrain === 'mountains') return { ok: false, reason: 'Cannot build on this terrain' };
    const occupant = this.tileOccupiedByBuilding(tile);
    if (occupant) {
      return occupant.state === 'destroyed'
        ? { ok: false, reason: 'Rubble here -- clear it first' }
        : { ok: false, reason: 'Tile occupied' };
    }
    if (!this.isOwnedTerritory(owner, tile)) return { ok: false, reason: 'Outside your territory' };
    return { ok: true };
  }

  /** Building types buildable on this specific tile: unlocked for the player, and terrain/adjacency-compatible. */
  availableBuildingsFor(owner: PlayerId, tile: Offset): BuildingType[] {
    const t = this.tiles.get(key(tile));
    if (!t) return [];
    const hasFarm = this.buildingsOf(owner).some((b) => b.type === 'farm' && b.state === 'active');
    const candidates: BuildingType[] = ['farm', 'lumberMill', 'quarry', 'fishersHut', 'house', 'road', 'bridge'];
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
      // Quarry is the one building whose adjacency requirement depends on
      // which of its two allowed terrains the site actually is: any Hills
      // tile qualifies outright, but a Plains tile only counts next to a
      // Mountain -- not a blanket rule, so it can't live in
      // requiresAdjacentTerrain above.
      if (type === 'quarry' && t.terrain === 'plains') {
        const hasMountainNeighbor = neighborsOf(tile).some((n) => this.tiles.get(key(n))?.terrain === 'mountains');
        if (!hasMountainNeighbor) return false;
      }
      if (def.maxConcurrent != null) {
        const count = this.buildingsOf(owner).filter((b) => b.type === type).length;
        if (count >= def.maxConcurrent) return false;
      }
      return true;
    });
  }

  /**
   * Nearest tile of the given terrain, reachable by walking the map from
   * anywhere the player currently owns a building -- used by the AI to find
   * a direction to expand in when it wants a terrain-adjacency building
   * (Lumber Mill/Quarry/Fisher's Hut) but no qualifying spot exists in its
   * territory yet.
   */
  nearestTerrainTile(owner: PlayerId, terrain: TerrainType): Offset | null {
    const starts = this.buildingsOf(owner).map((b) => b.tile);
    if (starts.length === 0) return null;
    const seen = new Set(starts.map(key));
    const queue: Offset[] = [...starts];
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i];
      for (const n of neighborsOf(cur)) {
        const k = key(n);
        if (seen.has(k)) continue;
        seen.add(k);
        const t = this.tiles.get(k);
        if (!t) continue;
        if (t.terrain === terrain) return n;
        queue.push(n);
      }
    }
    return null;
  }

  /**
   * The player's own buildable, unoccupied territory tile that's closest to
   * `target` -- claiming it (with anything) pushes their territory one ring
   * nearer a resource they don't have access to yet.
   */
  closestBuildableTerritoryTile(owner: PlayerId, target: Offset): Offset | null {
    let best: Offset | null = null;
    let bestDist = Infinity;
    for (const tile of this.ownedTerritoryTiles(owner)) {
      if (!this.canBuildAt(owner, tile).ok) continue;
      const d = hexDistance(tile, target);
      if (d < bestDist) {
        bestDist = d;
        best = tile;
      }
    }
    return best;
  }

  /**
   * Full resource cost for this player's next instance of `type`. A pending
   * rebuild credit (half of whatever a just-destroyed instance of this type
   * actually cost) always takes priority over the normal price -- including
   * the farm's escalating gold cost, which the credit deliberately bypasses.
   */
  previewBuildCost(owner: PlayerId, type: BuildingType): Partial<Record<ResourceKey, number>> {
    const credit = this.rebuildCredits.find((c) => c.ownerId === owner && c.type === type);
    if (credit) return credit.cost;
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
        if (b.type === 'fishersHut' && feed.resource === 'gold') {
          amount += this.adjacentActiveFishingBoatCount(b) * FISHING_BOAT_HUT_GOLD_BONUS;
        }
        productionPerSec += amount / (feed.intervalMs / 1000);
      }
    }
    return upkeepPerSec + productionPerSec;
  }

  attackableBuildings(attacker: PlayerId): Building[] {
    const opp = this.opponentOf(attacker);
    const hasSiege = this.troopsOf(attacker).some((t) => TROOPS[t.type].isSiege);
    // castle excluded: only siege units may target it (not yet implemented). Anything unattackable (the Road) is excluded too, as is anything requiring siege (the Bridge) when this player has none.
    return this.buildingsOf(opp).filter(
      (b) => b.type !== 'castle' && !BUILDINGS[b.type].unattackable && (!BUILDINGS[b.type].requiresSiegeToAttack || hasSiege)
    );
  }

  // ---------- commands ----------

  issueBuild(owner: PlayerId, tile: Offset, type: BuildingType): { ok: boolean; reason?: string } {
    const check = this.canBuildAt(owner, tile);
    if (!check.ok) return check;
    if (!this.availableBuildingsFor(owner, tile).includes(type))
      return { ok: false, reason: 'Cannot build that here' };
    const player = this.players[owner];
    const credit = this.takeRebuildCredit(owner, type);
    const cost = credit ? credit.cost : this.previewBuildCost(owner, type);
    const buildTimeMs = credit ? credit.buildTimeMs : BUILDINGS[type].buildTimeMs;
    for (const resource of Object.keys(cost) as ResourceKey[]) {
      if (player[resource] < (cost[resource] ?? 0)) {
        if (credit) this.rebuildCredits.push(credit); // don't burn the discount on a failed attempt
        return { ok: false, reason: 'Not enough resources' };
      }
    }
    for (const resource of Object.keys(cost) as ResourceKey[]) {
      player[resource] -= cost[resource] ?? 0;
    }
    this.spawnBuilding(owner, type, tile, false, buildTimeMs, cost, !!credit);
    return { ok: true };
  }

  /**
   * River tiles adjacent to this Fisher's Hut with nothing standing on them
   * -- a Fishing Boat can only go up on one of these, and only from this
   * specific hut's own panel (not the general build menu).
   */
  eligibleFishingBoatTiles(hut: Building): Offset[] {
    return neighborsOf(hut.tile).filter((n) => {
      const t = this.tiles.get(key(n));
      return !!t && t.terrain === 'river' && !this.tileOccupiedByBuilding(n);
    });
  }

  issueBuildFishingBoat(owner: PlayerId, fishersHutId: string, tile: Offset): { ok: boolean; reason?: string } {
    const hut = this.buildings.get(fishersHutId);
    if (!hut || hut.ownerId !== owner || hut.type !== 'fishersHut' || hut.state !== 'active')
      return { ok: false, reason: "Invalid Fisher's Hut" };
    if (!this.eligibleFishingBoatTiles(hut).some((t) => t.col === tile.col && t.row === tile.row))
      return { ok: false, reason: 'Must be an empty river tile adjacent to this Fisher\'s Hut' };

    const def = BUILDINGS.fishingBoat;
    const cost: Partial<Record<ResourceKey, number>> = { gold: def.goldCost, wood: def.woodCost };
    const player = this.players[owner];
    for (const resource of Object.keys(cost) as ResourceKey[]) {
      if (player[resource] < (cost[resource] ?? 0)) return { ok: false, reason: 'Not enough resources' };
    }
    for (const resource of Object.keys(cost) as ResourceKey[]) {
      player[resource] -= cost[resource] ?? 0;
    }
    this.spawnBuilding(owner, 'fishingBoat', tile, false, def.buildTimeMs, cost, false);
    return { ok: true };
  }

  /** Gold cost for the next fresh (non-credit) instance of `type` (farms escalate; everything else is flat). */
  private goldCostFor(owner: PlayerId, type: BuildingType): number {
    const def = BUILDINGS[type];
    if (!def.goldCostForNth) return def.goldCost;
    const everBuilt = [...this.buildings.values()].filter((b) => b.ownerId === owner && b.type === type).length;
    return def.goldCostForNth(everBuilt + 1);
  }

  /** Pops (consumes) a pending rebuild credit for this owner+type, if one exists. */
  private takeRebuildCredit(owner: PlayerId, type: BuildingType): RebuildCredit | null {
    const idx = this.rebuildCredits.findIndex((c) => c.ownerId === owner && c.type === type);
    if (idx === -1) return null;
    return this.rebuildCredits.splice(idx, 1)[0];
  }

  /**
   * Any destroyed building (not just ones capped at one-at-a-time) grants a
   * standing credit good for half of whatever that specific instance
   * actually cost and how long it actually took -- the next build of that
   * type consumes it instead of paying full/fresh price.
   */
  private grantRebuildCredit(b: Building) {
    if (b.type === 'castle') return; // castles are never rebuilt
    const halvedCost: Partial<Record<ResourceKey, number>> = {};
    for (const resource of Object.keys(b.paidCost) as ResourceKey[]) {
      halvedCost[resource] = Math.ceil((b.paidCost[resource] ?? 0) / 2);
    }
    this.rebuildCredits.push({
      ownerId: b.ownerId,
      type: b.type,
      cost: halvedCost,
      buildTimeMs: Math.max(MIN_BUILD_TIME_MS, Math.round(b.paidBuildTimeMs / 2)),
    });
  }

  /** Marks a building destroyed and grants its owner a rebuild credit for it -- the single place any building dies. */
  private destroyBuilding(b: Building) {
    if (b.state === 'destroyed') return;
    b.state = 'destroyed';
    this.grantRebuildCredit(b);
  }

  /**
   * Pays to clear a destroyed building's rubble, freeing its tile for new
   * construction (and, since rubble also blocks foot traffic, for movement
   * again too). Clearing your own rubble is a flat 5 gold. Clearing an
   * opponent's costs 10 gold instead, and requires one of your troops to
   * currently be standing adjacent to it -- you're paying to send soldiers
   * to physically dig it out, not waving a wand from across the map.
   */
  issueClearRubble(owner: PlayerId, buildingId: string): { ok: boolean; reason?: string } {
    const b = this.buildings.get(buildingId);
    if (!b || b.state !== 'destroyed') return { ok: false, reason: 'Invalid target' };
    const isOwn = b.ownerId === owner;
    if (!isOwn) {
      const hasAdjacentTroop = this.troopsOf(owner).some((t) => hexDistance(t.tile, b.tile) === 1);
      if (!hasAdjacentTroop) return { ok: false, reason: 'Need a troop adjacent to clear enemy rubble' };
    }
    const cost = isOwn ? CLEAR_RUBBLE_COST : CLEAR_RUBBLE_COST_ENEMY;
    const player = this.players[owner];
    if (player.gold < cost) return { ok: false, reason: 'Not enough gold' };
    player.gold -= cost;
    this.buildings.delete(b.id);
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
    if (def.requiresWoodProduction) {
      const hasWood = this.buildingsOf(owner).some((x) => x.type === 'lumberMill' && x.state === 'active');
      if (!hasWood) return { ok: false, reason: 'Requires wood production' };
    }
    if (def.requiresStoneProduction) {
      const hasStone = this.buildingsOf(owner).some((x) => x.type === 'quarry' && x.state === 'active');
      if (!hasStone) return { ok: false, reason: 'Requires an active Quarry' };
    }
    const player = this.players[owner];
    const woodCost = def.woodCost ?? 0;
    const stoneCost = def.stoneCost ?? 0;
    if (player.gold < def.goldCost || player.food < def.foodCost || player.wood < woodCost || player.stone < stoneCost)
      return { ok: false, reason: 'Not enough resources' };
    player.gold -= def.goldCost;
    player.food -= def.foodCost;
    player.wood -= woodCost;
    player.stone -= stoneCost;
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

  /**
   * Send a troop toward any tile on the board -- the simplest route there is
   * pathfound automatically (see `pathFor`), rather than requiring the
   * player to trace it tile by tile. There's no separate "attack" intent to
   * declare here: since buildings no longer block movement, walking onto an
   * enemy building's tile (or, for a ranged siege unit, merely coming within
   * its own attack range) is itself what starts the fight -- see
   * `autoBuildingTargetFor`, checked automatically every tick regardless of
   * how the troop got there. Calling this again for a troop already en
   * route re-plans a fresh path from wherever it currently stands, which is
   * what lets a player redirect it mid-movement just by tapping elsewhere.
   */
  issueMoveTo(troopId: string, destination: Offset): { ok: boolean; reason?: string } {
    const troop = this.troops.get(troopId);
    if (!troop) return { ok: false, reason: 'Invalid troop' };
    const path = this.pathFor(troop, destination);
    if (!path) return { ok: false, reason: 'No path available' };
    troop.path = path.length > 0 ? path : null;
    troop.pathIndex = 0;
    troop.segmentElapsedMs = 0;
    troop.segmentDurationMs = 0;
    troop.order = path.length > 0 ? { kind: 'moveToReposition' } : { kind: 'idle' };
    return { ok: true };
  }

  /**
   * Defend: doubles the troop's defense and holds it in place until moved,
   * attacked, or killed. Also refreshes a Spearman's one-shot spear throw --
   * each activation of Defend earns it back, regardless of whether the last
   * one used it.
   */
  issueDefendOrder(troopId: string) {
    const troop = this.troops.get(troopId);
    if (!troop) return;
    troop.path = null;
    troop.order = { kind: 'defend' };
    troop.spearThrown = false;
  }

  issueHealOrder(troopId: string) {
    const troop = this.troops.get(troopId);
    if (!troop) return;
    troop.path = null;
    troop.order = { kind: 'heal' };
  }

  // ---------- internal helpers ----------

  private spawnBuilding(
    owner: PlayerId,
    type: BuildingType,
    tile: Offset,
    instant: boolean,
    buildTimeMs?: number,
    paidCost: Partial<Record<ResourceKey, number>> = {},
    isRebuildCredit = false
  ): Building {
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
      paidCost,
      paidBuildTimeMs: totalMs,
    };

    const mkFeed = (resource: ResourceKey, amount: number, intervalMs: number): ProductionFeed => ({
      resource,
      amount,
      intervalMs,
      accumMs: 0,
      skipTicksRemaining: isRebuildCredit ? 3 : 0,
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
    } else if (type === 'fishingBoat') {
      b.production.push(mkFeed('food', FISHING_BOAT_FOOD.amount, FISHING_BOAT_FOOD.intervalMs));
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
    // findPath always lets a route land on the goal tile even if that tile
    // is in `blocked` (that exemption exists so a path can end adjacent-to
    // or directly on an occupied tile in general) -- but rubble specifically
    // must never be enterable at all, so a rubble destination is refused
    // outright rather than relying on that exemption not applying here.
    if (this.tileOccupiedByBuilding(dest)?.state === 'destroyed') return null;
    const blocked = new Set<string>();
    for (const b of this.buildings.values()) {
      if (b.state !== 'destroyed') continue;
      blocked.add(key(b.tile));
    }
    return findPath(troop.tile, dest, this.tiles, this.pathOptionsFor(troop, blocked));
  }

  private pathOptionsFor(troop: Troop, blocked: Set<string> = new Set()): PathOptions {
    const def = TROOPS[troop.type];
    return {
      canCrossMountains: def.canCrossMountains,
      canCrossRiver: false,
      canCrossRiverAt: (o) => this.hasActiveBridge(o),
      blocked,
      speedMultiplierFor: (o) => this.terrainSpeedMultiplierFor(troop.ownerId, o),
    };
  }

  /** An active Bridge on `tile` lets any troop (friendly or enemy) cross the river there. */
  private hasActiveBridge(tile: Offset): boolean {
    const occ = this.tileOccupiedByBuilding(tile);
    return occ?.type === 'bridge' && occ.state === 'active';
  }

  /**
   * Combines every per-tile movement modifier beyond raw terrain: a House on
   * Hills removes that tile's slowdown for its own owner but doubles it on
   * every surrounding Hills tile for anyone else; a Road halves whatever
   * penalty its terrain would otherwise cost (or boosts a speed buff by half
   * again), for any troop regardless of who owns it; and any tile with a
   * building at all -- Road included -- is a little slower to pass through
   * on top of that, since it's still physically in the way even though it
   * no longer blocks movement outright. Returned as a plain multiplier on
   * top of the terrain's own `moveTimeMult` (which `tileCrossMs` applies
   * separately), so 1 means "no change from terrain alone".
   */
  private terrainSpeedMultiplierFor(troopOwnerId: PlayerId, tile: Offset): number {
    const terrain = this.terrainAt(tile);
    if (!terrain) return 1;
    const occupant = this.tileOccupiedByBuilding(tile);
    const activeOccupant = occupant?.state === 'active' ? occupant : null;

    if (activeOccupant?.type === 'bridge') {
      // River's own moveTimeMult is Infinity, which tileCrossMs neutralizes
      // to a plain 1x base the instant an active Bridge allows the crossing
      // (see pathfinding.ts) -- a Bridge grants no speed buff of its own, so
      // the only modifier left to apply here is the universal building tax.
      return BUILDING_MOVE_PENALTY_MULT;
    }

    const baseMult = TERRAIN[terrain].moveTimeMult;
    let effectiveMult = baseMult;
    if (activeOccupant?.type === 'road') {
      effectiveMult = roadAdjustedMoveMult(baseMult);
    } else if (terrain === 'hills' && activeOccupant?.type === 'house' && activeOccupant.ownerId === troopOwnerId) {
      effectiveMult = 1; // cancels the hills penalty entirely for the owner
    }
    if (activeOccupant) effectiveMult *= BUILDING_MOVE_PENALTY_MULT;

    if (terrain === 'hills') {
      for (const n of neighborsOf(tile)) {
        if (this.terrainAt(n) !== 'hills') continue;
        const nb = this.tileOccupiedByBuilding(n);
        if (nb?.type === 'house' && nb.state === 'active' && nb.ownerId !== troopOwnerId) {
          effectiveMult *= HOUSE_HILLS_ENEMY_DEBUFF_MULT;
          break;
        }
      }
    }

    return effectiveMult / baseMult;
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
   * lands here too. Running a net deficit is fine on its own: it just draws
   * the reserve down tick by tick, same as it would build up from a surplus.
   * Only once the reserve can no longer cover a tick's full draw does it
   * clamp to zero and start punishing -- every troop/building that consumes
   * this specific resource takes flat HP damage, every tick, for as long as
   * the shortfall persists.
   */
  private resolveUpkeepTick(resource: ResourceKey) {
    for (const player of Object.values(this.players)) {
      let delta = resource === 'gold' ? BASE_GOLD_PER_TICK : 0;
      const buildingConsumers: Building[] = [];
      const troopConsumers: Troop[] = [];

      for (const b of this.buildingsOf(player.id)) {
        if (b.state !== 'active') continue;
        const amount = (BUILDINGS[b.type].upkeep?.[resource] ?? 0) + (b.extraUpkeep?.[resource] ?? 0);
        if (amount !== 0) {
          delta += amount;
          buildingConsumers.push(b);
        }
      }
      for (const t of this.troopsOf(player.id)) {
        const amount = TROOPS[t.type].upkeep[resource] ?? 0;
        if (amount !== 0) {
          delta += amount;
          troopConsumers.push(t);
        }
      }

      const newBalance = player[resource] + delta;
      if (newBalance >= 0) {
        player[resource] = newBalance;
        continue;
      }

      player[resource] = 0;
      // Starvation isn't a kill by the opponent -- no score changes hands,
      // just steady attrition until the player fixes their economy.
      for (const t of troopConsumers) {
        t.hp -= INSOLVENCY_DAMAGE_PER_TICK;
        if (t.hp <= 0) this.troops.delete(t.id);
      }
      for (const b of buildingConsumers) {
        b.hp -= INSOLVENCY_DAMAGE_PER_TICK;
        if (b.hp <= 0) this.destroyBuilding(b);
      }
    }
  }

  private tickProduction(dtMs: number) {
    for (const b of this.buildings.values()) {
      if (b.state !== 'active') continue;
      for (const feed of b.production) {
        feed.accumMs += dtMs;
        while (feed.accumMs >= feed.intervalMs) {
          feed.accumMs -= feed.intervalMs;
          // A credit-rebuilt instance's first few completed ticks on each
          // feed are the trade-off for its cheaper/faster reconstruction --
          // the tick still happens, it just yields nothing.
          if (feed.skipTicksRemaining > 0) {
            feed.skipTicksRemaining--;
            continue;
          }
          let amount = feed.amount;
          if (b.type === 'fishersHut' && feed.resource === 'gold') {
            amount += this.adjacentActiveFishingBoatCount(b) * FISHING_BOAT_HUT_GOLD_BONUS;
          }
          this.players[b.ownerId][feed.resource] += amount;
        }
      }
    }
  }

  /** Number of active Fishing Boats standing on tiles adjacent to this Fisher's Hut -- each contributes its own gold bonus. Public: the UI displays the live bonus in the hut's info panel. */
  adjacentActiveFishingBoatCount(hut: Building): number {
    return neighborsOf(hut.tile).filter((n) => {
      const nb = this.tileOccupiedByBuilding(n);
      return nb?.type === 'fishingBoat' && nb.state === 'active' && nb.ownerId === hut.ownerId;
    }).length;
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
        // not extra copies, and not rebuilding one that was destroyed. This
        // has to be tracked explicitly rather than inferred from "does
        // another building of this type exist right now": two of the same
        // type can be under construction at once (nothing stops queuing a
        // second Farm before the first finishes), and checking the map at
        // completion time would see that sibling and wrongly conclude
        // neither one is "first" -- losing the point entirely.
        const key = `${b.ownerId}:${b.type}`;
        if (!BUILDINGS[b.type].noFirstConstructionScore && !this.firstConstructionScored.has(key)) {
          this.firstConstructionScored.add(key);
          this.awardScore(b.ownerId, SCORE.constructOrRepair, 'construct');
        }
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
      attackCooldownMs: rollRange(def.attackSpeedMs),
      spearThrown: false,
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
          // Arriving doesn't need its own "start attacking" branch anymore --
          // tickPillage (right after this) checks every troop's tile against
          // every enemy building fresh each tick, so landing on one takes
          // effect there regardless of what order got it here.
          if (troop.order.kind === 'moveToReposition') {
            troop.order = { kind: 'idle' };
          }
        }
      }
    }
  }

  /**
   * The enemy building `troop` should be fighting right now, purely from its
   * current position -- no order needs to declare this in advance. A troop
   * without `canAttackBuildings` (most ranged units, e.g. the Archer) never
   * qualifies at all, so it just walks through an enemy building's tile like
   * any other empty ground. Everyone else has to be standing exactly on the
   * building's own tile (distance 0) to engage it, mirroring "occupying the
   * tile" -- except a siege unit (none exist yet), which can reach out to
   * its own `attackRange` instead, same as a ranged troop already can
   * against another troop, without needing to occupy anything.
   */
  private autoBuildingTargetFor(troop: Troop): Building | null {
    const def = TROOPS[troop.type];
    if (!def.canAttackBuildings) return null;
    const opponent = this.opponentOf(troop.ownerId);
    const maxRange = def.isSiege ? def.attackRange : 0;
    let best: Building | null = null;
    let bestDist = Infinity;
    for (const b of this.buildingsOf(opponent)) {
      if (b.type === 'castle') continue; // only siege units may ever target it (not yet implemented)
      if (BUILDINGS[b.type].unattackable) continue;
      if (BUILDINGS[b.type].requiresSiegeToAttack && !def.isSiege) continue;
      if (def.attack <= BUILDINGS[b.type].defense) continue;
      const dist = hexDistance(troop.tile, b.tile);
      if (dist > maxRange) continue;
      if (dist < bestDist) {
        bestDist = dist;
        best = b;
      }
    }
    return best;
  }

  private tickPillage(dtMs: number) {
    for (const b of this.buildings.values()) b.pillagedBy = null;
    const dtSec = dtMs / 1000;

    for (const troop of this.troops.values()) {
      if (troop.hp <= 0) continue;
      const target = this.autoBuildingTargetFor(troop);
      if (!target) {
        // Walked (or was redirected) away before finishing it off -- the
        // fight ends the instant it's no longer in range, same as troop-vs-
        // troop combat does when the pair drifts apart.
        if (troop.order.kind === 'pillaging') troop.order = { kind: 'idle' };
        continue;
      }

      if (troop.order.kind !== 'pillaging' || troop.order.targetBuildingId !== target.id) {
        troop.order = { kind: 'pillaging', targetBuildingId: target.id };
        troop.path = null; // engaging halts movement, same as tickCombat entering 'fighting'
      }
      target.pillagedBy = troop.id;

      // autoBuildingTargetFor already refused any target this troop's attack
      // can't beat, so diff should always be positive here -- the guard just
      // keeps a stray edge case from ever dealing negative damage.
      const atk = troop.attack * this.terrainMultAt(troop.tile);
      const diff = atk - BUILDINGS[target.type].defense;
      if (diff > 0) target.hp -= diff * dtSec;

      // Some buildings shoot back -- flat damage that ignores the attacker's defense.
      const counter = BUILDINGS[target.type].counterDamage;
      if (counter && !TROOPS[troop.type].isSiege) {
        troop.hp -= counter * dtSec;
      }

      if (target.hp <= 0) {
        troop.order = { kind: 'idle' };
        this.awardScore(troop.ownerId, SCORE.buildingDestroyed, 'building');
        this.grantPillageBonus(troop.ownerId, target);
        this.destroyBuilding(target);
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

  /** Successfully pillaging a building down grants a one-time copy of everything it was actively producing. */
  private grantPillageBonus(attackerId: PlayerId, building: Building) {
    const player = this.players[attackerId];
    for (const feed of building.production) {
      player[feed.resource] += feed.amount;
    }
  }

  private tickHealing(dtMs: number) {
    for (const troop of this.troops.values()) {
      if (troop.order.kind !== 'heal') continue;
      if (troop.hp >= troop.maxHp) continue;
      troop.hp = Math.min(troop.maxHp, troop.hp + (troop.maxHp * 0.08 * dtMs) / 1000);
    }
  }

  /**
   * Whether `attacker` (given its current stance) can strike a target at
   * `targetTile` this tick. Beyond its normal `attackRange`, a troop with a
   * `spearThrow` (the Spearman) can still reach out to that ability's own
   * range, but only while Defending and only if it hasn't already thrown
   * this activation -- `tickCombat` is what actually consumes that one
   * throw once it fires.
   */
  private canStrike(attacker: Troop, targetTile: Offset): boolean {
    const def = TROOPS[attacker.type];
    const dist = hexDistance(attacker.tile, targetTile);
    if (dist <= def.attackRange) {
      if (dist === 1 && def.meleeRequiresDefend && attacker.order.kind !== 'defend') return false;
      return true;
    }
    if (def.spearThrow && attacker.order.kind === 'defend' && !attacker.spearThrown && dist <= def.spearThrow.range) {
      return true;
    }
    return false;
  }

  /**
   * A strike's outcome is a straight attack-minus-defense diff: a positive
   * result damages the defender, same as always. A negative result only
   * backfires onto the attacker at melee range (distance 1) -- losing a
   * fight you had no business picking up close costs you. A ranged miss
   * (fired from beyond melee range) is simply harmless: the attacker is far
   * enough away that a target's higher defense can't hurt back. Zero does
   * nothing to either side either way. Returns a kill record for whichever
   * side's HP ran out, or null if neither did.
   */
  private resolveStrike(
    attacker: Troop,
    defender: Troop,
    isRanged: boolean,
    attackMult: number = 1
  ): { victimId: string; killerOwnerId: PlayerId } | null {
    const atk = attacker.attack * attackMult * this.terrainMultAt(attacker.tile);
    const defMult = defender.order.kind === 'defend' ? 2 : 1; // Defend: double defense while immobile
    const def = defender.defense * this.terrainMultAt(defender.tile) * defMult;
    const diff = atk - def;

    if (diff > 0) {
      defender.hp -= diff;
      if (defender.hp <= 0) return { victimId: defender.id, killerOwnerId: attacker.ownerId };
    } else if (diff < 0 && !isRanged) {
      attacker.hp -= -diff;
      if (attacker.hp <= 0) return { victimId: attacker.id, killerOwnerId: defender.ownerId };
    }
    return null;
  }

  private tickCombat(dtMs: number) {
    this.pendingCombatSwings = 0;
    const troopList = [...this.troops.values()];
    const kills: { victimId: string; killerOwnerId: PlayerId }[] = [];

    // Attack cooldowns recharge continuously, engaged or not -- a troop
    // that hasn't fought in a while is simply ready the instant it does.
    for (const t of troopList) {
      t.attackCooldownMs = Math.max(0, t.attackCooldownMs - dtMs);
    }

    for (let i = 0; i < troopList.length; i++) {
      const a = troopList[i];
      if (a.hp <= 0) continue;
      for (let j = i + 1; j < troopList.length; j++) {
        const b = troopList[j];
        if (b.hp <= 0) continue;
        if (a.ownerId === b.ownerId) continue;

        const dist = hexDistance(a.tile, b.tile);
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

        if (aCan && a.attackCooldownMs <= 0) {
          const aDef = TROOPS[a.type];
          const aIsSpearThrow = dist > aDef.attackRange && !!aDef.spearThrow;
          if (aIsSpearThrow) a.spearThrown = true;
          const k = this.resolveStrike(a, b, dist > 1, aIsSpearThrow ? aDef.spearThrow!.damageMult : 1);
          a.attackCooldownMs = rollRange(aDef.attackSpeedMs);
          this.pendingCombatSwings++;
          if (k) kills.push(k);
        }
        if (b.hp > 0 && bCan && b.attackCooldownMs <= 0) {
          const bDef = TROOPS[b.type];
          const bIsSpearThrow = dist > bDef.attackRange && !!bDef.spearThrow;
          if (bIsSpearThrow) b.spearThrown = true;
          const k = this.resolveStrike(b, a, dist > 1, bIsSpearThrow ? bDef.spearThrow!.damageMult : 1);
          b.attackCooldownMs = rollRange(bDef.attackSpeedMs);
          this.pendingCombatSwings++;
          if (k) kills.push(k);
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

  /** Level 1 castle defense is mechanically a stationed Archer: same attack, same attack speed, same range. */
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

      const defMult = target.order.kind === 'defend' ? 2 : 1;
      const def = target.defense * this.terrainMultAt(target.tile) * defMult;
      const diff = CASTLE_ATTACK.attack - def;
      if (diff > 0) target.hp -= diff;
      castle.attackCooldownMs = rollRange(CASTLE_ATTACK.attackSpeedMs);
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
