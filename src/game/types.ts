import type { BuildingType, TroopType } from './balance';
import type { Offset } from './hex';

export type PlayerId = 1 | 2;

export interface PlayerState {
  id: PlayerId;
  gold: number;
  food: number;
  straw: number;
  score: number;
  castleId: string;
}

export type BuildingState = 'constructing' | 'active' | 'destroyed';

export interface Training {
  troopType: TroopType;
  remainingMs: number;
  totalMs: number;
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
  /** Farm-only: this instance's income rates, which depend on whether it was built next to water. */
  foodPerTick?: number;
  foodTickIntervalMs?: number;
  foodTickAccumMs?: number;
  strawPerTick?: number;
  strawTickIntervalMs?: number;
  strawTickAccumMs?: number;
  /** Castle-only: cooldown remaining before its next ranged shot. */
  attackCooldownMs?: number;
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
