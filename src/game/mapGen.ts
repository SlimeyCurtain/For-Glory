import type { TerrainType } from './balance';
import { key, neighborsOf, offsetNeighbor, hexDistance } from './hex';
import type { Offset } from './hex';

export const MAP_COLS = 24; // even, so the two mirrored halves split cleanly with no leftover center column
export const MAP_ROWS = 13;
export const HALF_WIDTH = MAP_COLS / 2;
export const CASTLE_COL = 4; // pulled in from the map edge -- a hub, not a back wall
export const CASTLE_ROW_MARGIN = 4; // castles must be at least this many rows from the top/bottom edge

export interface Tile {
  offset: Offset;
  terrain: TerrainType;
}

export type TileMap = Map<string, Tile>;

export interface GeneratedMap {
  tiles: TileMap;
  p1Castle: Offset;
  p2Castle: Offset;
}

// ---------- seeded RNG ----------

function mulberry32(seed: number) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rng = () => number;
const randInt = (rng: Rng, min: number, max: number) => min + Math.floor(rng() * (max - min + 1));
const pick = <T,>(rng: Rng, arr: T[]): T => arr[Math.floor(rng() * arr.length)];

// ---------- half-map terrain generation (player 1's side; mirrored for player 2) ----------

const inHalf = (o: Offset) => o.col >= 0 && o.col < HALF_WIDTH && o.row >= 0 && o.row < MAP_ROWS;

function growBlob(rng: Rng, seed: Offset, targetSize: number, eligible: (o: Offset) => boolean): Offset[] {
  const chosenKeys = new Set([key(seed)]);
  const chosen: Offset[] = [seed];
  const frontier: Offset[] = [seed];
  while (chosen.length < targetSize && frontier.length > 0) {
    const idx = randInt(rng, 0, frontier.length - 1);
    const tile = frontier[idx];
    const candidates = neighborsOf(tile).filter((n) => inHalf(n) && eligible(n) && !chosenKeys.has(key(n)));
    if (candidates.length === 0) {
      frontier.splice(idx, 1);
      continue;
    }
    const next = pick(rng, candidates);
    chosenKeys.add(key(next));
    chosen.push(next);
    frontier.push(next);
  }
  return chosen;
}

function generateHalf(rng: Rng, castle: Offset): Map<string, TerrainType> {
  const terrain = new Map<string, TerrainType>();
  const setT = (o: Offset, t: TerrainType) => {
    if (o.col === castle.col && o.row === castle.row) return;
    terrain.set(key(o), t);
  };
  const isPlains = (o: Offset) => (terrain.get(key(o)) ?? 'plains') === 'plains';
  const farEnough = (o: Offset, min: number) => hexDistance(o, castle) >= min;

  // --- mountain ranges: wandering ridgelines, not single blocks ---
  const rangeCount = randInt(rng, 1, 2);
  for (let i = 0; i < rangeCount; i++) {
    let start: Offset | null = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const c = { col: randInt(rng, 0, HALF_WIDTH - 1), row: randInt(rng, 0, MAP_ROWS - 1) };
      if (isPlains(c) && farEnough(c, 3)) {
        start = c;
        break;
      }
    }
    if (!start) continue;
    let cur = start;
    let dir = randInt(rng, 0, 5);
    const length = randInt(rng, 4, 8);
    for (let step = 0; step < length; step++) {
      setT(cur, 'mountains');
      if (rng() < 0.35) dir = (dir + (rng() < 0.5 ? -1 : 1) + 6) % 6;
      let next = offsetNeighbor(cur, dir);
      if (!inHalf(next) || !farEnough(next, 2)) {
        let found = false;
        for (let t = 0; t < 6; t++) {
          dir = (dir + 1) % 6;
          next = offsetNeighbor(cur, dir);
          if (inHalf(next) && farEnough(next, 2)) {
            found = true;
            break;
          }
        }
        if (!found) break;
      }
      cur = next;
    }
  }

  // --- lone standalone peaks ---
  const loneCount = randInt(rng, 2, 4);
  for (let i = 0; i < loneCount; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const c = { col: randInt(rng, 0, HALF_WIDTH - 1), row: randInt(rng, 0, MAP_ROWS - 1) };
      if (isPlains(c) && farEnough(c, 3)) {
        setT(c, 'mountains');
        break;
      }
    }
  }

  // --- dense forest clusters ---
  const forestBlobCount = randInt(rng, 1, 2);
  for (let i = 0; i < forestBlobCount; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const seedTile = { col: randInt(rng, 0, HALF_WIDTH - 1), row: randInt(rng, 0, MAP_ROWS - 1) };
      if (!isPlains(seedTile) || !farEnough(seedTile, 2)) continue;
      const blob = growBlob(rng, seedTile, randInt(rng, 7, 13), isPlains);
      for (const t of blob) setT(t, 'forest');
      break;
    }
  }

  // --- stray lone forest tiles ---
  const strayForest = randInt(rng, 4, 7);
  for (let i = 0; i < strayForest; i++) {
    for (let attempt = 0; attempt < 20; attempt++) {
      const c = { col: randInt(rng, 0, HALF_WIDTH - 1), row: randInt(rng, 0, MAP_ROWS - 1) };
      if (isPlains(c)) {
        setT(c, 'forest');
        break;
      }
    }
  }

  // --- a modest hills cluster ---
  for (let attempt = 0; attempt < 20; attempt++) {
    const seedTile = { col: randInt(rng, 0, HALF_WIDTH - 1), row: randInt(rng, 0, MAP_ROWS - 1) };
    if (!isPlains(seedTile)) continue;
    const blob = growBlob(rng, seedTile, randInt(rng, 4, 7), isPlains);
    for (const t of blob) setT(t, 'hills');
    break;
  }

  // --- a winding river from the top edge to the bottom edge of the half ---
  const riverNotMountain = (o: Offset) => terrain.get(key(o)) !== 'mountains';
  const startCol = randInt(rng, 1, HALF_WIDTH - 2);
  let cur: Offset = { col: startCol, row: 0 };
  const riverPath: Offset[] = [cur];
  const visited = new Set([key(cur)]);
  let guard = 0;
  while (cur.row < MAP_ROWS - 1 && guard < 150) {
    guard++;
    const neighbors = neighborsOf(cur).filter((n) => inHalf(n) && riverNotMountain(n) && !visited.has(key(n)));
    if (neighbors.length === 0) break;
    const downhill = neighbors.filter((n) => n.row > cur.row);
    const lateral = neighbors.filter((n) => n.row === cur.row);
    const pool = downhill.length > 0 && rng() < 0.72 ? downhill : lateral.length > 0 ? lateral : downhill.length > 0 ? downhill : neighbors;
    const next = pick(rng, pool);
    visited.add(key(next));
    riverPath.push(next);
    cur = next;
  }
  for (let i = 0; i < riverPath.length; i++) {
    setT(riverPath[i], 'river');
    // widen roughly a third of the banks so it reads as a real river, not a hairline
    if (i > 1 && i < riverPath.length - 2 && rng() < 0.35) {
      const bankOptions = neighborsOf(riverPath[i]).filter((n) => inHalf(n) && riverNotMountain(n));
      if (bankOptions.length > 0) setT(pick(rng, bankOptions), 'river');
    }
  }
  // a couple of natural fords -- guarantees crossing points and gives attackers
  // an actual route choice instead of one straight front line
  const fordCount = Math.min(2, Math.floor(riverPath.length / 4));
  for (let i = 0; i < fordCount; i++) {
    const idx = randInt(rng, 2, riverPath.length - 3);
    setT(riverPath[idx], 'plains');
  }

  // --- a lake: a real body of water, not a puddle ---
  const lakeEligible = (o: Offset) => (terrain.get(key(o)) ?? 'plains') === 'plains';
  let lakeTiles: Offset[] = [];
  for (let attempt = 0; attempt < 25; attempt++) {
    const seedTile = { col: randInt(rng, 0, HALF_WIDTH - 1), row: randInt(rng, 0, MAP_ROWS - 1) };
    if (!lakeEligible(seedTile) || !farEnough(seedTile, 3)) continue;
    if (riverPath.some((r) => hexDistance(r, seedTile) < 2)) continue;
    const blob = growBlob(rng, seedTile, randInt(rng, 5, 7), lakeEligible);
    if (blob.length >= 4) {
      lakeTiles = blob;
      break;
    }
  }
  for (const t of lakeTiles) setT(t, 'river'); // lakes use the same impassable-without-boat terrain

  return terrain;
}

/** BFS reachability for a plain ground unit (no mountains, no water) between the two castles. */
function isConnected(fullTerrain: Map<string, TerrainType>, from: Offset, to: Offset): boolean {
  const goal = key(to);
  const seen = new Set([key(from)]);
  const queue: Offset[] = [from];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (key(cur) === goal) return true;
    for (const n of neighborsOf(cur)) {
      if (n.col < 0 || n.col >= MAP_COLS || n.row < 0 || n.row >= MAP_ROWS) continue;
      const k = key(n);
      if (seen.has(k)) continue;
      const t = fullTerrain.get(k) ?? 'plains';
      if (t === 'mountains' || t === 'river') continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return false;
}

function ensureConnectivity(fullTerrain: Map<string, TerrainType>, from: Offset, to: Offset) {
  let guard = 0;
  while (!isConnected(fullTerrain, from, to) && guard < 200) {
    guard++;
    // BFS to find the reachable frontier, then clear the nearest blocking obstacle to it
    const seen = new Set([key(from)]);
    const queue: Offset[] = [from];
    const blockers: Offset[] = [];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const n of neighborsOf(cur)) {
        if (n.col < 0 || n.col >= MAP_COLS || n.row < 0 || n.row >= MAP_ROWS) continue;
        const k = key(n);
        if (seen.has(k)) continue;
        const t = fullTerrain.get(k) ?? 'plains';
        if (t === 'mountains' || t === 'river') {
          blockers.push(n);
          continue;
        }
        seen.add(k);
        queue.push(n);
      }
    }
    if (blockers.length === 0) break; // nothing left to clear; bail rather than loop forever
    blockers.sort((a, b) => hexDistance(a, from) - hexDistance(b, from));
    fullTerrain.set(key(blockers[0]), 'plains');
  }
}

export function generateMap(seed: number = Math.floor(Math.random() * 2 ** 31)): GeneratedMap {
  const rng = mulberry32(seed);

  // Castles sit a fixed distance in from their side's edge, but roll a random
  // row (kept at least CASTLE_ROW_MARGIN from the top/bottom) so the map
  // isn't the same shape every match. Both castles share that row so the
  // map stays fair and symmetric.
  const castleRow = randInt(rng, CASTLE_ROW_MARGIN, MAP_ROWS - 1 - CASTLE_ROW_MARGIN);
  const p1Castle: Offset = { col: CASTLE_COL, row: castleRow };
  const p2Castle: Offset = { col: MAP_COLS - 1 - CASTLE_COL, row: castleRow };

  const p1Half = generateHalf(rng, p1Castle);

  const full = new Map<string, TerrainType>();
  for (let row = 0; row < MAP_ROWS; row++) {
    for (let col = 0; col < MAP_COLS; col++) {
      const o = { col, row };
      if (col < HALF_WIDTH) {
        full.set(key(o), p1Half.get(key(o)) ?? 'plains');
      } else {
        const mirrored = { col: MAP_COLS - 1 - col, row };
        full.set(key(o), p1Half.get(key(mirrored)) ?? 'plains');
      }
    }
  }
  full.set(key(p1Castle), 'castleGround');
  full.set(key(p2Castle), 'castleGround');

  ensureConnectivity(full, p1Castle, p2Castle);

  const tiles: TileMap = new Map();
  for (const [k, terrain] of full) {
    const [col, row] = k.split(',').map(Number);
    tiles.set(k, { offset: { col, row }, terrain });
  }
  return { tiles, p1Castle, p2Castle };
}
