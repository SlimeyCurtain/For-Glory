import type { BuildingType, ResourceKey, TroopType } from './balance';
import type { Offset } from './hex';

export type PlayerId = 1 | 2;

export interface PlayerState {
  id: PlayerId;
  gold: number;
  food: number;
  straw: number;
  wood: number;
  stone: number;
  score: number;
  castleId: string;
}

export type BuildingState = 'constructing' | 'active' | 'destroyed';

export interface Training {
  troopType: TroopType;
  remainingMs: number;
  totalMs: number;
}

export interface ProductionFeed {
  resource: ResourceKey;
  amount: number;
  intervalMs: number;
  accumMs: number;
  /** A credit-rebuilt building's first few completed ticks on each feed produce nothing, counted down here. */
  skipTicksRemaining: number;
}

export interface Building {
  id: string;
  ownerId: PlayerId;
  type: BuildingType;
  tile: Offset;
  hp: number;
  maxHp: number;
  state: BuildingState;
  buildRemainingMs: number;
  buildTotalMs: number;
  training: Training | null;
  repairing: boolean;
  pillagedBy: string | null; // troop id currently pillaging this building
  /** This instance's production, computed once at construction from its tile/adjacency context. */
  production: ProductionFeed[];
  /** Extra per-resource upkeep beyond the building type's base (e.g. House's mountain-adjacency bonus). */
  extraUpkeep?: Partial<Record<ResourceKey, number>>;
  /** Castle-only: cooldown remaining before its next ranged shot. */
  attackCooldownMs?: number;
  /** The exact resource cost and build time this instance was actually built for -- destroying it grants a rebuild credit at half of each. */
  paidCost: Partial<Record<ResourceKey, number>>;
  paidBuildTimeMs: number;
}

export type TroopOrder =
  | { kind: 'idle' }
  | { kind: 'moveToAttack'; targetBuildingId: string }
  | { kind: 'pillaging'; targetBuildingId: string }
  | { kind: 'moveToIntercept'; targetTroopId: string; repathCooldownMs: number }
  | { kind: 'fighting'; targetTroopId: string }
  | { kind: 'defend' }
  | { kind: 'heal' }
  | { kind: 'moveToReposition' };

export interface Troop {
  id: string;
  ownerId: PlayerId;
  type: TroopType;
  hp: number;
  maxHp: number;
  attack: number;
  defense: number;
  tile: Offset; // last confirmed tile
  path: Offset[] | null;
  pathIndex: number;
  segmentElapsedMs: number;
  segmentDurationMs: number;
  order: TroopOrder;
}

export interface ScoreEvent {
  playerId: PlayerId;
  amount: number;
  reason: string;
}
