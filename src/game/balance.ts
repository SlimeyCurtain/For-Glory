export type TerrainType = 'plains' | 'forest' | 'hills' | 'mountains' | 'river' | 'castleGround';

export interface TerrainDef {
  /** Multiplier on tile-crossing time. >1 = slower, <1 = faster. Infinity = impassable. */
  moveTimeMult: number;
  /** Multiplier on attack/defense stats while a troop stands on this tile. */
  combatStatMult: number;
  /** Only troops with canFly or canBoat (for river) may enter. */
  requiresBoatOrBridge?: boolean;
  impassableForGroundTroops?: boolean;
  /** Short player-facing description of this terrain's movement/combat effect. */
  effectText: string;
  color: number;
}

export const TERRAIN: Record<TerrainType, TerrainDef> = {
  plains: { moveTimeMult: 0.8, combatStatMult: 1, effectText: '+25% movement speed', color: 0x8fbf5a },
  forest: { moveTimeMult: 2.0, combatStatMult: 1, effectText: '-50% movement speed', color: 0x2f6b3a },
  hills: { moveTimeMult: 1.333, combatStatMult: 1, effectText: '-25% movement speed', color: 0xa98b57 },
  mountains: {
    moveTimeMult: 3.0,
    combatStatMult: 1,
    impassableForGroundTroops: true,
    effectText: 'Impassable to ground troops',
    color: 0x8a8a8a,
  },
  river: {
    moveTimeMult: Infinity,
    combatStatMult: 1,
    requiresBoatOrBridge: true,
    effectText: 'Impassable without a boat or bridge',
    color: 0x3b82c4,
  },
  castleGround: { moveTimeMult: 1, combatStatMult: 1, effectText: 'No movement penalty', color: 0xb0a99f },
};

export const BASE_TILE_CROSS_MS = 2000; // baseline ms to cross one plains-neutral tile

/** Doubles the hills speed penalty for enemy troops near an opponent's hills House. */
export const HOUSE_HILLS_ENEMY_DEBUFF_MULT = 2;

// ---------- resources ----------

export type ResourceKey = 'gold' | 'food' | 'straw' | 'wood' | 'stone';

/** Each resource resolves production/upkeep on its own game-wide cadence. */
export const RESOURCE_TICK_MS: Record<ResourceKey, number> = {
  gold: 5000,
  food: 3000,
  straw: 3000,
  wood: 8000,
  stone: 6000,
};

export const STARTING_GOLD = 60;
export const STARTING_FOOD = 0;
export const STARTING_STRAW = 0;
export const STARTING_WOOD = 0;
export const STARTING_STONE = 0;
export const BASE_GOLD_PER_TICK = 5;

// ---------- buildings ----------

export type BuildingType =
  | 'castle'
  | 'farm'
  | 'barracks'
  | 'lumberMill'
  | 'quarry'
  | 'fishersHut'
  | 'house'
  | 'road'
  | 'stoneRoad'
  | 'fishingBoat'
  | 'bridge';

export interface BuildingDef {
  name: string;
  goldCost: number;
  foodCost: number;
  strawCost?: number;
  woodCost?: number;
  stoneCost?: number;
  buildTimeMs: number;
  maxHp: number;
  /** Subtracted from an attacker's attack stat to find hit damage; if the attacker's attack doesn't exceed this, it isn't allowed to attack this building at all. */
  defense: number;
  unlocks?: BuildingType[];
  /** Which tiles this building may be constructed on. Omitted = anywhere buildable. */
  allowedTerrain?: TerrainType[];
  /** Must additionally be adjacent to at least one tile of this terrain. */
  requiresAdjacentTerrain?: TerrainType[];
  /** Player-wide cap on simultaneously standing/constructing instances. */
  maxConcurrent?: number;
  /** Flat per-resource contribution (usually negative) applied on that resource's own tick, once active. */
  upkeep?: Partial<Record<ResourceKey, number>>;
  /** Flat damage this building deals to a non-siege troop actively pillaging it, ignoring the troop's defense. */
  counterDamage?: number;
  /** Gold cost for the Nth instance ever built (1-indexed), overriding goldCost when present. */
  goldCostForNth?: (n: number) => number;
  /** Short description of this building's unique behavior, shown in its info panel. */
  specialTrait?: string;
  /** Can never be targeted by an attack order, siege or otherwise (currently: the Road). */
  unattackable?: boolean;
  /** Can only be targeted by a troop with isSiege (currently: the Bridge). No troop is siege yet, so this is functionally unattackable today -- future-proofing for siege units. */
  requiresSiegeToAttack?: boolean;
  /** Skips the usual "first-ever construction of this type" score (currently: the Road). */
  noFirstConstructionScore?: boolean;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  // defense is never actually consulted for the castle -- only siege units may target it, and those aren't implemented yet.
  castle: { name: 'Castle', goldCost: 0, foodCost: 0, buildTimeMs: 0, maxHp: 500, defense: 999 },
  farm: {
    name: 'Farm',
    goldCost: 10,
    foodCost: 0,
    buildTimeMs: 5000,
    maxHp: 10,
    defense: 2,
    allowedTerrain: ['plains'],
    unlocks: ['barracks'],
    goldCostForNth: (n) => 10 + n * (n - 1),
  },
  barracks: {
    name: 'Barracks',
    goldCost: 25,
    foodCost: 0,
    strawCost: 25,
    buildTimeMs: 8000,
    maxHp: 20,
    defense: 10,
    allowedTerrain: ['plains', 'hills'],
    maxConcurrent: 1,
    upkeep: { gold: -2 },
    counterDamage: 4,
    specialTrait: 'Training is 3s faster when a Farm is directly adjacent. Any attacker that lands a hit takes 4 damage back.',
  },
  lumberMill: {
    name: 'Lumber Mill',
    goldCost: 30,
    foodCost: 0,
    strawCost: 35,
    buildTimeMs: 10000,
    maxHp: 20,
    defense: 3,
    allowedTerrain: ['plains', 'hills'],
    requiresAdjacentTerrain: ['forest'],
    upkeep: { gold: -1, straw: -2 },
    specialTrait: '+2 Wood per adjacent Forest tile, every 6s.',
  },
  quarry: {
    name: 'Quarry',
    goldCost: 20,
    foodCost: 0,
    woodCost: 30,
    strawCost: 40,
    buildTimeMs: 10000,
    maxHp: 25,
    defense: 4,
    // Any Hills tile qualifies outright; a Plains tile only qualifies next
    // to a Mountain (enforced as a special case in availableBuildingsFor,
    // since it's conditional on which of the two allowed terrains the site
    // actually is, not a blanket adjacency requirement).
    allowedTerrain: ['plains', 'hills'],
    upkeep: { gold: -2, wood: -2, straw: -4 },
    specialTrait: '+1 Stone per adjacent Mountain tile, every 8s. Buildable on any Hills tile, or a Plains tile next to a Mountain.',
  },
  fishersHut: {
    name: "Fisher's Hut",
    goldCost: 20,
    foodCost: 0,
    woodCost: 40,
    strawCost: 30,
    buildTimeMs: 8000,
    maxHp: 20,
    defense: 2,
    allowedTerrain: ['plains', 'hills'],
    requiresAdjacentTerrain: ['river'],
    upkeep: { wood: -4, straw: -4 },
    specialTrait: 'Build a Fishing Boat on any adjacent river tile from this panel. +2 Gold production per adjacent active Fishing Boat.',
  },
  house: {
    name: 'House',
    goldCost: 0,
    foodCost: 0,
    woodCost: 20,
    stoneCost: 30,
    strawCost: 40,
    buildTimeMs: 12000,
    maxHp: 20,
    defense: 3,
    allowedTerrain: ['plains', 'forest', 'hills'],
    upkeep: { stone: -1, wood: -2, straw: -4 },
    specialTrait:
      'On Hills: removes its own hills slowdown for you, doubles it for enemies nearby. On Forest: +1 Wood/6s. Near Mountains: +1 Gold/5s for -1 more Stone upkeep (Forest is immune to Mountain suppression).',
  },
  road: {
    name: 'Road',
    goldCost: 0,
    foodCost: 0,
    woodCost: 4,
    buildTimeMs: 2000,
    maxHp: 10,
    defense: 999,
    allowedTerrain: ['plains', 'forest', 'hills'],
    unattackable: true,
    noFirstConstructionScore: true,
    upkeep: { wood: -1 },
    specialTrait:
      "Cuts whatever movement penalty its terrain would otherwise cost by a quarter, and boosts a Plains speed buff by a matching amount. Applies to any troop crossing it, friendly or enemy. Nothing else may be built on a Road tile. Upgrade to a Stone Road (once you have an active Quarry) for the full effect. Demolishing a Road costs 5 gold and clears it instantly -- no rubble left behind.",
  },
  // Never offered directly in the build menu -- the only way to get one is
  // upgrading an existing, active Road (see GameState.issueUpgradeRoad) once
  // a Quarry is active. Its own BuildingDef still drives the upgrade's cost
  // (via previewBuildCost) and its own upkeep/stats once built.
  stoneRoad: {
    name: 'Stone Road',
    goldCost: 0,
    foodCost: 0,
    woodCost: 2,
    stoneCost: 2,
    buildTimeMs: 4000,
    maxHp: 10,
    defense: 999,
    allowedTerrain: ['plains', 'forest', 'hills'],
    unattackable: true,
    noFirstConstructionScore: true,
    upkeep: { wood: -1, stone: -1 },
    specialTrait:
      "Halves whatever movement penalty its terrain would otherwise cost, and boosts a Plains speed buff by half again -- a Road's original, full-strength effect. Demolishing a Stone Road costs 8 gold and clears it instantly -- no rubble left behind.",
  },
  // Not offered in the general build menu -- only placeable from an owned,
  // active Fisher's Hut's own panel, on a river tile adjacent to it (see
  // GameState.issueBuildFishingBoat). maxHp/defense are our own placeholders,
  // since the user's spec didn't give this building combat stats.
  fishingBoat: {
    name: 'Fishing Boat',
    goldCost: 2,
    foodCost: 0,
    woodCost: 8,
    buildTimeMs: 4000,
    maxHp: 8,
    defense: 2,
    allowedTerrain: ['river'],
    upkeep: { wood: -2 },
    specialTrait: '+2 Food/3s. Also gives its parent Fisher\'s Hut +2 Gold production per adjacent active Fishing Boat.',
  },
  bridge: {
    name: 'Bridge',
    goldCost: 0,
    foodCost: 0,
    woodCost: 2,
    stoneCost: 4,
    buildTimeMs: 10000,
    // Bridges have no defense stat of their own -- the user's spec ties
    // destruction entirely to a percentage chance rolled by the attacking
    // siege unit's type (e.g. "a cannon has a 78.3% chance..."), which is
    // explicitly out of scope for now since no siege unit exists yet. HP/
    // defense are unreachable placeholders until that combat model exists.
    maxHp: 10,
    defense: 0,
    allowedTerrain: ['river'],
    requiresSiegeToAttack: true,
    specialTrait:
      "Acts like a Road (lets troops cross), but grants no movement buff of its own -- it only allows the crossing. Unlike a Road, its first construction scores normally, and it can be targeted by siege units (none exist yet). Can be built outside your own territory with a troop standing adjacent to the site -- even in enemy territory. Demolishing one (10 gold) or a siege unit destroying one both leave rubble in the water instead of clearing instantly, and neither grants a rebuild credit: whoever wants a crossing there again pays full price. Either player can pay to clear that rubble with an adjacent troop.",
  },
};

export const MIN_BUILD_TIME_MS = 1000;

/** Flat gold cost to clear a destroyed building's rubble before anything new can go up on that tile. */
export const CLEAR_RUBBLE_COST = 5;
/** Clearing someone else's rubble costs more, and additionally requires a troop of yours adjacent to it. */
export const CLEAR_RUBBLE_COST_ENEMY = 10;

/** Flat gold cost to demolish your own Road/Stone Road/Bridge -- the one demolish case that isn't free, since these are what let anyone (friend or foe) cross faster at all. */
export const ROAD_DEMOLISH_COST = 5;
export const STONE_ROAD_DEMOLISH_COST = 8;
export const BRIDGE_DEMOLISH_COST = 10;

/**
 * A destroyed Bridge (by its owner's own Demolish, or by a siege unit) is
 * the one piece of infrastructure that leaves rubble sitting in the water
 * instead of vanishing or clearing instantly -- and unlike ordinary rubble,
 * clearing it isn't cheaper for the owner: either player can pay the exact
 * same price, since the whole point is that whoever wants the crossing back
 * has to pay a real toll for it, not just whichever side happens to own it.
 */
export const BRIDGE_RUBBLE_CLEAR_COST: { gold: number; wood: number; straw: number } = { gold: 5, wood: 10, straw: 20 };
export const BRIDGE_RUBBLE_CLEAR_TIME_MS = 15000;

/** Any tile with a building on it (including a Road) is a little slower to pass through, on top of whatever terrain/Road math already applies. */
export const BUILDING_MOVE_PENALTY_MULT = 1.125;

/** How much of a terrain's movement penalty (or Plains's speed buff) a plain Road cuts, versus a Stone Road's full-strength effect. */
export const ROAD_STRENGTH = 0.25;
export const STONE_ROAD_STRENGTH = 0.5;

/**
 * A Road (and, more strongly, a Stone Road) eases whatever penalty a terrain
 * tile would otherwise cost (e.g. at `strength` 0.5, Forest's 2.0x becomes
 * 1.5x), and boosts a terrain's speed *buff* (a sub-1.0 multiplier,
 * currently only Plains) by the same fraction again in the other direction
 * (0.8x becomes 0.7x at strength 0.5). Neutral terrain (1.0x) is untouched.
 */
export function roadAdjustedMoveMult(baseMult: number, strength: number): number {
  if (baseMult > 1) return 1 + (baseMult - 1) * (1 - strength);
  if (baseMult < 1) return 1 - (1 - baseMult) * (1 + strength);
  return baseMult;
}

// ---------- building production rates ----------

export const FARM_FOOD = {
  base: { amount: 2, intervalMs: 3000 },
  waterAdjacent: { amount: 4, intervalMs: 3000 },
};
export const FARM_STRAW = {
  base: { amount: 5, intervalMs: 3000 },
  waterAdjacent: { amount: 8, intervalMs: 3000 },
};

export const LUMBER_MILL_WOOD_PER_FOREST = 2;
export const LUMBER_MILL_WOOD_INTERVAL_MS = 6000;

export const QUARRY_STONE_PER_MOUNTAIN = 1;
export const QUARRY_STONE_INTERVAL_MS = 8000;

export const FISHERS_HUT_GOLD = { amount: 3, intervalMs: 5000 };

export const FISHING_BOAT_FOOD = { amount: 2, intervalMs: 3000 };
/** Each adjacent active Fishing Boat adds this much to its parent Fisher's Hut's gold-per-tick. */
export const FISHING_BOAT_HUT_GOLD_BONUS = 2;

export const HOUSE_GOLD_BASE = { amount: 1, intervalMs: 5000 };
export const HOUSE_FOREST_WOOD = { amount: 1, intervalMs: 6000 };
export const HOUSE_MOUNTAIN_BONUS_GOLD = { amount: 1, intervalMs: 5000 };
export const HOUSE_MOUNTAIN_BONUS_STONE_UPKEEP = -1;

export const BARRACKS_FARM_ADJACENCY_TRAIN_DISCOUNT_MS = 3000;

// ---------- troops ----------

export type TroopType = 'militia' | 'archer' | 'spearman';

/** A randomized window an attack cooldown is rolled from, so e.g. two archers trading blows don't always land in lockstep. */
export interface SpeedRange {
  min: number;
  max: number;
}

export interface TroopDef {
  name: string;
  goldCost: number;
  foodCost: number;
  woodCost?: number;
  stoneCost?: number;
  trainTimeMs: number;
  maxHp: number;
  attack: number;
  defense: number;
  isSiege: boolean;
  canCrossMountains: boolean;
  /** Max hex distance this troop can strike at. 1 = melee only. */
  attackRange: number;
  /** If true, this troop can only fight at range 1 while in the Defend stance. */
  meleeRequiresDefend?: boolean;
  canAttackBuildings: boolean;
  /** Flat per-resource contribution (usually negative) applied on that resource's own tick, once trained. */
  upkeep: Partial<Record<ResourceKey, number>>;
  /** Player must have active wood production to train this troop. */
  requiresWoodProduction?: boolean;
  /** Player must have an active Quarry to train this troop. */
  requiresStoneProduction?: boolean;
  /** Milliseconds between this troop's discrete attacks, re-rolled after every swing. */
  attackSpeedMs: SpeedRange;
  /**
   * A one-shot ranged attack usable only once per Defend activation (see
   * `Troop.spearThrown`) -- currently just the Spearman. `damageMult`
   * multiplies its own `attack` stat for that single throw only.
   */
  spearThrow?: { range: number; damageMult: number };
  /** Short description of this troop's unique behavior, shown in its info panel. */
  specialTrait?: string;
}

export const TROOPS: Record<TroopType, TroopDef> = {
  militia: {
    name: 'Militia',
    goldCost: 2,
    foodCost: 2,
    trainTimeMs: 3000,
    maxHp: 10,
    attack: 5,
    defense: 5,
    isSiege: false,
    canCrossMountains: false,
    attackRange: 1,
    canAttackBuildings: true,
    upkeep: { gold: -1, food: -1 },
    attackSpeedMs: { min: 1300, max: 1700 },
  },
  archer: {
    name: 'Archer',
    goldCost: 4,
    foodCost: 2,
    woodCost: 5,
    trainTimeMs: 5000,
    maxHp: 15,
    attack: 10,
    defense: 7,
    isSiege: false,
    canCrossMountains: false,
    attackRange: 2,
    meleeRequiresDefend: true,
    canAttackBuildings: false,
    upkeep: { gold: -2, food: -1, wood: -1 },
    requiresWoodProduction: true,
    attackSpeedMs: { min: 2000, max: 2600 },
    specialTrait: 'Strikes at range 2 always. Cannot fight at range 1 unless Defending.',
  },
  spearman: {
    name: 'Spearman',
    goldCost: 4,
    foodCost: 0,
    woodCost: 4,
    stoneCost: 2,
    trainTimeMs: 6000,
    maxHp: 10,
    attack: 20,
    defense: 10,
    isSiege: false,
    canCrossMountains: false,
    attackRange: 1,
    canAttackBuildings: true,
    upkeep: { gold: -2, stone: -1 },
    requiresStoneProduction: true,
    attackSpeedMs: { min: 1800, max: 2500 },
    spearThrow: { range: 3, damageMult: 4 / 3 },
    specialTrait: 'While Defending, can throw its spear once at range 3 for 1/3 more damage than its melee attack.',
  },
};

/**
 * The castle's passive ranged defense at level 1: mechanically a stationed
 * Archer -- same attack stat, same attack speed range, same range.
 */
export const CASTLE_ATTACK = {
  range: 2,
  attack: TROOPS.archer.attack,
  attackSpeedMs: TROOPS.archer.attackSpeedMs,
};

export const MATCH_DURATION_MS = 10 * 60 * 1000;

export const SCORE = {
  buildingDestroyed: 1,
  unitDestroyed: 0.5,
  constructOrRepair: 0.25,
};

export const REPAIR_HP_PER_SEC = 15;

/** Flat HP damage dealt every insolvent tick to every troop/building that consumes a resource whose reserve just ran dry. */
export const INSOLVENCY_DAMAGE_PER_TICK = 10;
