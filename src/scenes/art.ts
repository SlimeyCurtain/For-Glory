import Phaser from 'phaser';
import { TERRAIN } from '../game/balance';
import type { TerrainType } from '../game/balance';

type Point = { x: number; y: number };
type G = Phaser.GameObjects.Graphics;

// ---------- deterministic per-tile randomness (static art, no flicker) ----------

export function tileSeed(col: number, row: number, salt = 0): number {
  let h = (col * 374761393 + row * 668265263 + salt * 2246822519) >>> 0;
  h = (Math.imul(h ^ (h >>> 13), 1274126177)) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

export function seededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

/** Lighten (percent > 0) or darken (percent < 0) a 0xRRGGBB color. */
export function shade(color: number, percent: number): number {
  const r = (color >> 16) & 0xff;
  const g = (color >> 8) & 0xff;
  const b = color & 0xff;
  const adj = (c: number) => (percent >= 0 ? c + (255 - c) * percent : c * (1 + percent));
  return (clamp255(adj(r)) << 16) | (clamp255(adj(g)) << 8) | clamp255(adj(b));
}

function fillTriangleUp(g: G, cx: number, topY: number, halfW: number, h: number) {
  g.beginPath();
  g.moveTo(cx, topY);
  g.lineTo(cx - halfW, topY + h);
  g.lineTo(cx + halfW, topY + h);
  g.closePath();
  g.fillPath();
}

// ---------- hex tile rendering ----------

export function drawHexTile(g: G, terrain: TerrainType, center: Point, corners: Point[], rng: () => number) {
  const base = TERRAIN[terrain].color;
  const light = shade(base, 0.16);
  const dark = shade(base, -0.16);

  g.fillGradientStyle(light, light, dark, dark, 1);
  pathHex(g, corners);
  g.fillPath();

  // inner bevel -- reads as a softly domed tile rather than a flat sticker
  const inset = corners.map((c) => ({ x: center.x + (c.x - center.x) * 0.9, y: center.y + (c.y - center.y) * 0.9 }));
  g.lineStyle(2, shade(base, -0.35), 0.3);
  pathHex(g, inset);
  g.strokePath();

  g.lineStyle(1, 0x000000, 0.18);
  pathHex(g, corners);
  g.strokePath();

  drawTerrainProps(g, terrain, center, rng);
}

function pathHex(g: G, corners: Point[]) {
  g.beginPath();
  g.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y);
  g.closePath();
}

function drawTerrainProps(g: G, terrain: TerrainType, center: Point, rng: () => number) {
  switch (terrain) {
    case 'forest':
      drawTrees(g, center, rng, 3 + Math.floor(rng() * 2));
      break;
    case 'hills':
      drawHillBumps(g, center, rng);
      break;
    case 'mountains':
      drawMountainPeaks(g, center, rng);
      break;
    case 'river':
      drawWaterRipples(g, center, rng);
      break;
    case 'plains':
      drawWheatTufts(g, center, rng);
      break;
    case 'castleGround':
      drawCobblestones(g, center, rng);
      break;
  }
}

function drawTrees(g: G, center: Point, rng: () => number, count: number) {
  for (let i = 0; i < count; i++) {
    const x = center.x + (rng() - 0.5) * 34;
    const y = center.y + (rng() - 0.5) * 30;
    const s = 5 + rng() * 3.5;
    g.fillStyle(0x4a3018, 1);
    g.fillRect(x - 1.4, y + s * 0.5, 2.8, s * 0.7);
    g.fillStyle(0x1f4d28, 1);
    fillTriangleUp(g, x, y - s * 0.95, s * 0.95, s * 1.15);
    g.fillStyle(0x2f6b39, 1);
    fillTriangleUp(g, x, y - s * 0.35, s * 0.72, s * 0.9);
  }
}

function drawHillBumps(g: G, center: Point, rng: () => number) {
  const base = TERRAIN.hills.color;
  for (let i = 0; i < 3; i++) {
    const x = center.x + (rng() - 0.5) * 30;
    const y = center.y + (rng() - 0.5) * 22 + 4;
    const rx = 9 + rng() * 5;
    const ry = rx * 0.55;
    g.fillStyle(shade(base, -0.12), 0.8);
    g.fillEllipse(x, y + 2, rx, ry);
    g.fillStyle(shade(base, 0.12), 0.9);
    g.fillEllipse(x, y, rx, ry);
  }
}

function drawMountainPeaks(g: G, center: Point, rng: () => number) {
  const peaks = [
    { dx: -8, s: 15 },
    { dx: 9, s: 12 },
  ];
  for (const p of peaks) {
    const x = center.x + p.dx + (rng() - 0.5) * 4;
    const topY = center.y - p.s * 0.9;
    g.fillStyle(0x6b6b6b, 1);
    fillTriangleUp(g, x, topY, p.s, p.s * 1.5);
    g.fillStyle(0x4d4d4d, 1);
    fillTriangleUp(g, x - p.s * 0.35, topY + p.s * 0.55, p.s * 0.4, p.s * 0.95);
    // snow cap
    g.fillStyle(0xf1f5f9, 0.95);
    fillTriangleUp(g, x, topY, p.s * 0.4, p.s * 0.55);
  }
}

function drawWaterRipples(g: G, center: Point, rng: () => number) {
  g.lineStyle(1.6, shade(TERRAIN.river.color, 0.35), 0.6);
  for (let i = 0; i < 3; i++) {
    const y = center.y + (i - 1) * 9 + (rng() - 0.5) * 4;
    const w = 16 + rng() * 6;
    g.beginPath();
    g.arc(center.x - w * 0.2, y, w * 0.5, Math.PI * 0.15, Math.PI * 0.85, false);
    g.strokePath();
  }
}

function drawWheatTufts(g: G, center: Point, rng: () => number) {
  g.lineStyle(1.4, shade(TERRAIN.plains.color, -0.3), 0.55);
  for (let i = 0; i < 5; i++) {
    const x = center.x + (rng() - 0.5) * 36;
    const y = center.y + (rng() - 0.5) * 28;
    g.beginPath();
    g.moveTo(x - 3, y + 4);
    g.lineTo(x, y - 4);
    g.lineTo(x + 3, y + 4);
    g.strokePath();
  }
}

function drawCobblestones(g: G, center: Point, rng: () => number) {
  g.fillStyle(shade(TERRAIN.castleGround.color, -0.2), 0.5);
  for (let row = -1; row <= 1; row++) {
    for (let col = -1; col <= 1; col++) {
      const x = center.x + col * 10 + (rng() - 0.5) * 3;
      const y = center.y + row * 9 + (rng() - 0.5) * 3;
      g.fillCircle(x, y, 2.6);
    }
  }
}

// ---------- building icons ----------

export function drawBuildingIcon(g: G, type: 'castle' | 'farm' | 'barracks', x: number, y: number, ownerColor: number) {
  if (type === 'castle') drawCastleIcon(g, x, y, ownerColor);
  else if (type === 'farm') drawFarmIcon(g, x, y, ownerColor);
  else drawBarracksIcon(g, x, y, ownerColor);
}

function drawCastleIcon(g: G, x: number, y: number, ownerColor: number) {
  const stone = 0x9a958c;
  const stoneDark = 0x726d64;
  g.lineStyle(2, ownerColor, 1);
  g.fillStyle(stone, 1);
  g.fillRect(x - 13, y - 3, 26, 13);
  g.strokeRect(x - 13, y - 3, 26, 13);

  for (const tx of [-13, 6]) {
    g.fillStyle(stoneDark, 1);
    g.fillRect(x + tx, y - 12, 7, 12);
    g.strokeRect(x + tx, y - 12, 7, 12);
    g.fillRect(x + tx, y - 15, 2.2, 3);
    g.fillRect(x + tx + 4.8, y - 15, 2.2, 3);
  }

  g.lineStyle(1.5, 0x3a3a3a, 1);
  g.beginPath();
  g.moveTo(x, y - 3);
  g.lineTo(x, y - 12);
  g.strokePath();
  g.fillStyle(ownerColor, 1);
  g.beginPath();
  g.moveTo(x, y - 12);
  g.lineTo(x + 7, y - 9.5);
  g.lineTo(x, y - 7);
  g.closePath();
  g.fillPath();
}

function drawFarmIcon(g: G, x: number, y: number, ownerColor: number) {
  // plowed plot
  g.fillStyle(0x7a5c34, 1);
  g.fillRoundedRect(x - 14, y - 7, 28, 19, 3);
  g.lineStyle(2, ownerColor, 1);
  g.strokeRoundedRect(x - 14, y - 7, 28, 19, 3);

  // furrow lines in the soil
  g.lineStyle(1, 0x63481f, 0.6);
  for (const fy of [y - 1, y + 5]) {
    g.beginPath();
    g.moveTo(x - 12, fy);
    g.lineTo(x + 12, fy);
    g.strokePath();
  }

  // rows of wheat stalks
  const wheatGold = 0xe0b03c;
  const wheatDark = 0xc4922a;
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      const sx = x - 10 + col * 6.6;
      const sy = y - 3 + row * 6.5;
      g.lineStyle(1.2, 0x8a6a2a, 1);
      g.beginPath();
      g.moveTo(sx, sy + 3.5);
      g.lineTo(sx, sy - 3);
      g.strokePath();
      g.fillStyle(row === 0 ? wheatGold : wheatDark, 1);
      g.fillEllipse(sx, sy - 4, 2, 3.6);
    }
  }

  // fence posts framing the plot
  g.fillStyle(0x5a3a1c, 1);
  g.fillRect(x - 16, y - 9, 2.2, 7);
  g.fillRect(x + 13.8, y - 9, 2.2, 7);
}

function drawBarracksIcon(g: G, x: number, y: number, ownerColor: number) {
  // second, smaller tent peeking out behind -- reads as a camp, not one tent
  g.fillStyle(0x62623c, 1);
  g.beginPath();
  g.moveTo(x - 17, y + 8);
  g.lineTo(x - 9, y - 3);
  g.lineTo(x - 2, y + 8);
  g.closePath();
  g.fillPath();

  g.fillStyle(0x7a7a4a, 1);
  g.beginPath();
  g.moveTo(x - 14, y + 9);
  g.lineTo(x, y - 12);
  g.lineTo(x + 14, y + 9);
  g.closePath();
  g.fillPath();
  g.lineStyle(2, ownerColor, 1);
  g.strokePath();

  g.fillStyle(0x5b5b34, 1);
  g.beginPath();
  g.moveTo(x - 4, y + 9);
  g.lineTo(x, y - 1);
  g.lineTo(x + 4, y + 9);
  g.closePath();
  g.fillPath();

  // campfire out front
  g.fillStyle(0x8a8a8a, 1);
  g.fillCircle(x + 8, y + 9, 1.8);
  g.fillCircle(x + 11.5, y + 9.5, 1.4);
  g.fillStyle(0xf59e0b, 1);
  fillTriangleUp(g, x + 9.5, y + 3.5, 1.8, 4.5);
  g.fillStyle(0xef4444, 0.85);
  fillTriangleUp(g, x + 9.5, y + 5.2, 1.1, 2.6);

  g.lineStyle(1.5, 0x3a3a3a, 1);
  g.beginPath();
  g.moveTo(x + 16, y + 9);
  g.lineTo(x + 16, y - 10);
  g.strokePath();
  g.fillStyle(ownerColor, 1);
  g.beginPath();
  g.moveTo(x + 16, y - 10);
  g.lineTo(x + 23, y - 7.5);
  g.lineTo(x + 16, y - 5);
  g.closePath();
  g.fillPath();
}

// ---------- troop icon ----------

export function drawSwordsmanIcon(g: G, x: number, y: number, ownerColor: number) {
  g.fillStyle(ownerColor, 1);
  g.fillCircle(x, y + 2, 6.5);
  g.lineStyle(1, shade(ownerColor, -0.4), 1);
  g.strokeCircle(x, y + 2, 6.5);

  g.fillStyle(0xe8b98a, 1);
  g.fillCircle(x, y - 5, 3.2);

  g.lineStyle(1.6, 0xd8dce2, 1);
  g.beginPath();
  g.moveTo(x + 4, y - 3);
  g.lineTo(x + 9, y - 9);
  g.strokePath();
  g.lineStyle(1.6, 0x8a5a2a, 1);
  g.beginPath();
  g.moveTo(x + 3, y - 1);
  g.lineTo(x + 5.5, y - 3.5);
  g.strokePath();
}
