import { BASE_TILE_CROSS_MS, TERRAIN } from './balance';
import { key, neighborsOf, hexDistance, offsetToAxial } from './hex';
import type { Offset } from './hex';
import type { TileMap } from './mapGen';

export interface PathOptions {
  canCrossMountains: boolean;
  canCrossRiver: boolean; // true if unit has boat, or a bridge exists (future feature)
  /** tiles currently occupied by buildings/blocking troops, other than start/goal */
  blocked: Set<string>;
  /** Extra per-tile time multiplier (e.g. a House's hills effect); defaults to 1. */
  speedMultiplierFor?: (o: Offset) => number;
}

export function tileCrossMs(o: Offset, tiles: TileMap, opts: PathOptions): number {
  const tile = tiles.get(key(o));
  if (!tile) return Infinity;
  const def = TERRAIN[tile.terrain];
  if (def.impassableForGroundTroops && !opts.canCrossMountains) return Infinity;
  if (def.requiresBoatOrBridge && !opts.canCrossRiver) return Infinity;
  if (def.moveTimeMult === Infinity) return Infinity;
  const extra = opts.speedMultiplierFor ? opts.speedMultiplierFor(o) : 1;
  return BASE_TILE_CROSS_MS * def.moveTimeMult * extra;
}

/**
 * A* search over the hex grid. Cost is time-in-ms to traverse, so terrain
 * slow/fast modifiers are respected. Returns a list of tiles from (but not
 * including) start to goal, or null if unreachable.
 */
export function findPath(
  start: Offset,
  goal: Offset,
  tiles: TileMap,
  opts: PathOptions
): Offset[] | null {
  const startKey = key(start);
  const goalKey = key(goal);
  if (startKey === goalKey) return [];

  const gScore = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, Offset>();
  const open = new Map<string, Offset>([[startKey, start]]);
  const closed = new Set<string>();

  const heuristic = (o: Offset) =>
    hexDistance(o, goal) * BASE_TILE_CROSS_MS * 0.8; // admissible-ish, uses cheapest plains cost

  const fScore = new Map<string, number>([[startKey, heuristic(start)]]);

  while (open.size > 0) {
    let currentKey = '';
    let current: Offset | null = null;
    let bestF = Infinity;
    for (const [k, o] of open) {
      const f = fScore.get(k) ?? Infinity;
      if (f < bestF) {
        bestF = f;
        currentKey = k;
        current = o;
      }
    }
    if (!current) break;

    if (currentKey === goalKey) {
      const path: Offset[] = [];
      let ck = currentKey;
      let c = current;
      while (ck !== startKey) {
        path.unshift(c);
        const prev = cameFrom.get(ck);
        if (!prev) break;
        c = prev;
        ck = key(prev);
      }
      return path;
    }

    open.delete(currentKey);
    closed.add(currentKey);

    for (const n of neighborsOf(current)) {
      const nKey = key(n);
      if (closed.has(nKey)) continue;
      if (opts.blocked.has(nKey) && nKey !== goalKey) continue;
      const crossMs = tileCrossMs(n, tiles, opts);
      if (crossMs === Infinity) continue;

      const tentativeG = (gScore.get(currentKey) ?? Infinity) + crossMs;
      if (tentativeG < (gScore.get(nKey) ?? Infinity)) {
        cameFrom.set(nKey, current);
        gScore.set(nKey, tentativeG);
        fScore.set(nKey, tentativeG + heuristic(n));
        if (!open.has(nKey)) open.set(nKey, n);
      }
    }
  }

  return null; // unreachable
}

export function pathTotalMs(path: Offset[], tiles: TileMap, opts: PathOptions): number {
  let total = 0;
  for (const o of path) {
    const ms = tileCrossMs(o, tiles, opts);
    total += ms === Infinity ? 0 : ms;
  }
  return total;
}

export { offsetToAxial };
