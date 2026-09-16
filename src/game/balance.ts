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

export type BuildingType = 'castle' | 'farm' | 'barracks' | 'lumberMill' | 'quarry' | 'fishersHut' | 'house';

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
    allowedTerrain: ['hills'],
    requiresAdjacentTerrain: ['mountains'],
    upkeep: { gold: -2, wood: -2, straw: -4 },
    specialTrait: '+1 Stone per adjacent Mountain tile, every 8s.',
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
    specialTrait: '+2 Food to any directly adjacent Farm.',
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
};

export const MIN_BUILD_TIME_MS = 1000;

/** Flat gold cost to clear a destroyed building's rubble before anything new can go up on that tile. */
export const CLEAR_RUBBLE_COST = 5;

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
export const FISHERS_HUT_FARM_FOOD_BONUS = 2;

export const HOUSE_GOLD_BASE = { amount: 1, intervalMs: 5000 };
export const HOUSE_FOREST_WOOD = { amount: 1, intervalMs: 6000 };
export const HOUSE_MOUNTAIN_BONUS_GOLD = { amount: 1, intervalMs: 5000 };
export const HOUSE_MOUNTAIN_BONUS_STONE_UPKEEP = -1;

export const BARRACKS_FARM_ADJACENCY_TRAIN_DISCOUNT_MS = 3000;

// ---------- troops ----------

export type TroopType = 'militia' | 'archer';

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
  /** Milliseconds between this troop's discrete attacks, re-rolled after every swing. */
  attackSpeedMs: SpeedRange;
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

export const MATCH_DURATION_MS = 5 * 60 * 1000;

export const SCORE = {
  buildingDestroyed: 1,
  unitDestroyed: 0.5,
  constructOrRepair: 0.25,
};

export const REPAIR_HP_PER_SEC = 15;

/** Flat HP damage dealt every insolvent tick to every troop/building that consumes a resource whose reserve just ran dry. */
export const INSOLVENCY_DAMAGE_PER_TICK = 10;
