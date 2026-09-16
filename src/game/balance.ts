export type TerrainType =
  | 'plains'
  | 'forest'
  | 'hills'
  | 'mountains'
  | 'river'
  | 'desert'
  | 'castleGround';

export interface TerrainDef {
  /** Multiplier on tile-crossing time. >1 = slower, <1 = faster. Infinity = impassable. */
  moveTimeMult: number;
  /** Multiplier on attack/defense stats while a troop stands on this tile. */
  combatStatMult: number;
  /** Only troops with canFly or canBoat (for river) may enter. */
  requiresBoatOrBridge?: boolean;
  impassableForGroundTroops?: boolean;
  color: number;
}

export const TERRAIN: Record<TerrainType, TerrainDef> = {
  plains: { moveTimeMult: 0.8, combatStatMult: 1, color: 0x8fbf5a },
  forest: { moveTimeMult: 2.0, combatStatMult: 1, color: 0x2f6b3a },
  hills: { moveTimeMult: 1.333, combatStatMult: 1, color: 0xa98b57 },
  mountains: { moveTimeMult: 3.0, combatStatMult: 1, impassableForGroundTroops: true, color: 0x8a8a8a },
  river: { moveTimeMult: Infinity, combatStatMult: 1, requiresBoatOrBridge: true, color: 0x3b82c4 },
  desert: { moveTimeMult: 2.0, combatStatMult: 0.75, color: 0xdccb7a },
  castleGround: { moveTimeMult: 1, combatStatMult: 1, color: 0xb0a99f },
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
  incomeGoldPer5s?: number;
  incomeFoodPer5s?: number;
}

export const BUILDINGS: Record<BuildingType, BuildingDef> = {
  castle: { name: 'Castle', goldCost: 0, foodCost: 0, buildTimeMs: 0, maxHp: 600 },
  farm: {
    name: 'Farm',
    goldCost: 50,
    foodCost: 0,
    buildTimeMs: 6000,
    maxHp: 100,
    incomeFoodPer5s: 5,
    unlocks: ['barracks'],
  },
  barracks: {
    name: 'Barracks',
    goldCost: 90,
    foodCost: 30,
    buildTimeMs: 9000,
    maxHp: 150,
  },
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
}

export const TROOPS: Record<TroopType, TroopDef> = {
  swordsman: {
    name: 'Swordsman',
    goldCost: 25,
    foodCost: 15,
    trainTimeMs: 8000,
    maxHp: 100,
    attack: 16,
    defense: 8,
    isSiege: false,
    canCrossMountains: false,
  },
};

export const STARTING_GOLD = 60;
export const STARTING_FOOD = 0;
export const INCOME_TICK_MS = 5000;
export const BASE_GOLD_PER_TICK = 12;

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
