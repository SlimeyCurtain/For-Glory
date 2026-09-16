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
    effectText: 'Impassable to swordsmen',
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

export const BASE_TILE_CROSS_MS = 900; // baseline ms to cross one plains-neutral tile

export type BuildingType = 'castle' | 'farm' | 'barracks';

export interface BuildingDef {
  name: string;
  goldCost: number;
  foodCost: number;
  buildTimeMs: number;
  maxHp: number;
  unlocks?: BuildingType[];
  /** Which tiles this building may be constructed on. Omitted = anywhere buildable. */
  allowedTerrain?: TerrainType[];
  /** Flat gold contribution (positive or negative) applied at the shared 5s income tick per active instance. */
  goldUpkeepPer5s?: number;
  /** Flat damage this building deals to a non-siege troop actively pillaging it, ignoring the troop's defense. */
  counterDamage?: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  castle: { name: 'Castle', goldCost: 0, foodCost: 0, buildTimeMs: 0, maxHp: 500 },
  farm: {
    name: 'Farm',
    goldCost: 50,
    foodCost: 0,
    buildTimeMs: 6000,
    maxHp: 15,
    allowedTerrain: ['plains'],
    unlocks: ['barracks'],
  },
  barracks: {
    name: 'Barracks',
    goldCost: 90,
    foodCost: 30,
    buildTimeMs: 9000,
    maxHp: 25,
    allowedTerrain: ['plains', 'hills'],
    goldUpkeepPer5s: -2,
    counterDamage: 4,
  },
};

/** Farm food income: the base rate, or the boosted rate for a plains farm built next to a river/lake tile. */
export const FARM_INCOME = {
  base: { amount: 2, intervalMs: 5000 },
  waterAdjacent: { amount: 3, intervalMs: 2500 },
};

export type TroopType = 'swordsman';

export interface TroopDef {
  name: string;
  goldCost: number;
  foodCost: number;
  trainTimeMs: number;
  maxHp: number;
  attack: number;
  defense: number;
  isSiege: boolean;
  canCrossMountains: boolean;
  /** Upkeep applied at the shared 5s income tick per living unit (negative = drains resources). */
  goldUpkeepPer5s: number;
  foodUpkeepPer5s: number;
}

export const TROOPS: Record<TroopType, TroopDef> = {
  swordsman: {
    name: 'Swordsman',
    goldCost: 30,
    foodCost: 12,
    trainTimeMs: 8000,
    maxHp: 20,
    attack: 15,
    defense: 10,
    isSiege: false,
    canCrossMountains: false,
    goldUpkeepPer5s: -1,
    foodUpkeepPer5s: -1,
  },
};

/** The castle's passive ranged defense: auto-fires at the nearest enemy troop within range. Placeholder numbers, tunable. */
export const CASTLE_ATTACK = {
  range: 2,
  damage: 20, // ignores defense entirely -- comfortably kills a 20hp swordsman in one shot
  cooldownMs: 1500,
};

export const STARTING_GOLD = 60;
export const STARTING_FOOD = 0;
export const INCOME_TICK_MS = 5000;
export const BASE_GOLD_PER_TICK = 5;

export const MATCH_DURATION_MS = 5 * 60 * 1000;

export const SCORE = {
  buildingDestroyed: 1,
  unitDestroyed: 0.5,
  constructOrRepair: 0.25,
};

/** Pillage: gold/food drained from an enemy building per second while being pillaged, granted to attacker. */
export const PILLAGE_PER_SEC = { gold: 4, food: 2 };

export const BUILDING_DAMAGE_PER_SEC = 20; // troop damage output vs buildings
export const REPAIR_HP_PER_SEC = 15;
