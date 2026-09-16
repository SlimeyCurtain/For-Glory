// Pointy-top hex grid, "odd-r" offset storage, axial coords for math.
// Reference: redblobgames.com/grids/hexagons

export interface Offset {
  col: number;
  row: number;
}

export interface Axial {
  q: number;
  r: number;
}

export const HEX_SIZE = 34; // pixel radius of a hex

export function key(a: Offset): string {
  return `${a.col},${a.row}`;
}

export function offsetToAxial(o: Offset): Axial {
  const q = o.col - (o.row - (o.row & 1)) / 2;
  const r = o.row;
  return { q, r };
}

export function axialToOffset(a: Axial): Offset {
  const col = a.q + (a.r - (a.r & 1)) / 2;
  const row = a.r;
  return { col, row };
}

export function axialToPixel(a: Axial): { x: number; y: number } {
  const x = HEX_SIZE * Math.sqrt(3) * (a.q + a.r / 2);
  const y = HEX_SIZE * 1.5 * a.r;
  return { x, y };
}

export function offsetToPixel(o: Offset): { x: number; y: number } {
  return axialToPixel(offsetToAxial(o));
}

export const AXIAL_DIRECTIONS: Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function neighborsOf(o: Offset): Offset[] {
  const a = offsetToAxial(o);
  return AXIAL_DIRECTIONS.map((d) => axialToOffset({ q: a.q + d.q, r: a.r + d.r }));
}

/** Neighbor in a specific compass direction (0-5), for directional random walks. */
export function offsetNeighbor(o: Offset, dirIndex: number): Offset {
  const a = offsetToAxial(o);
  const d = AXIAL_DIRECTIONS[((dirIndex % 6) + 6) % 6];
  return axialToOffset({ q: a.q + d.q, r: a.r + d.r });
}

export function axialDistance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

export function hexDistance(a: Offset, b: Offset): number {
  return axialDistance(offsetToAxial(a), offsetToAxial(b));
}

export function hexCorners(center: { x: number; y: number }): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i - 30); // pointy-top offset
    pts.push({
      x: center.x + HEX_SIZE * Math.cos(angle),
      y: center.y + HEX_SIZE * Math.sin(angle),
    });
  }
  return pts;
}
