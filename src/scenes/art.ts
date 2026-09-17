import Phaser from 'phaser';
import { TERRAIN } from '../game/balance';
import type { BuildingType, TerrainType } from '../game/balance';

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

export function drawBuildingIcon(g: G, type: BuildingType, x: number, y: number, ownerColor: number) {
  switch (type) {
    case 'castle':
      return drawCastleIcon(g, x, y, ownerColor);
    case 'farm':
      return drawFarmIcon(g, x, y, ownerColor);
    case 'barracks':
      return drawBarracksIcon(g, x, y, ownerColor);
    case 'lumberMill':
      return drawLumberMillIcon(g, x, y, ownerColor);
    case 'quarry':
      return drawQuarryIcon(g, x, y, ownerColor);
    case 'fishersHut':
      return drawFishersHutIcon(g, x, y, ownerColor);
    case 'house':
      return drawHouseIcon(g, x, y, ownerColor);
    case 'road':
      return drawRoadIcon(g, x, y, ownerColor);
    case 'fishingBoat':
      return drawFishingBoatIcon(g, x, y, ownerColor);
    case 'bridge':
      return drawBridgeIcon(g, x, y, ownerColor);
  }
}

/** A pile of rubble marking a destroyed building's tile -- deliberately owner-colorless debris, distinct from every live building icon. */
export function drawRubbleIcon(g: G, x: number, y: number) {
  const stoneLight = 0x8a8378;
  const stoneMid = 0x6b6459;
  const stoneDark = 0x4d473e;

  g.fillStyle(stoneDark, 1);
  g.fillEllipse(x, y + 8, 18, 6);

  g.lineStyle(1, 0x2e2a24, 1);
  g.fillStyle(stoneMid, 1);
  g.fillRect(x - 11, y + 1, 8, 6);
  g.strokeRect(x - 11, y + 1, 8, 6);
  g.fillStyle(stoneLight, 1);
  g.fillRect(x - 1, y - 3, 9, 7);
  g.strokeRect(x - 1, y - 3, 9, 7);
  g.fillStyle(stoneMid, 1);
  g.fillRect(x + 3, y + 2, 7, 5);
  g.strokeRect(x + 3, y + 2, 7, 5);
  g.fillStyle(stoneLight, 1);
  g.fillTriangle(x - 8, y + 1, x - 3, y - 6, x + 1, y + 1);
  g.strokeTriangle(x - 8, y + 1, x - 3, y - 6, x + 1, y + 1);

  g.lineStyle(1, 0x2e2a24, 0.6);
  g.beginPath();
  g.moveTo(x - 6, y - 2);
  g.lineTo(x - 4, y + 1);
  g.strokePath();
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

function drawLumberMillIcon(g: G, x: number, y: number, ownerColor: number) {
  // stacked logs beside the shed
  for (let i = 0; i < 3; i++) {
    const lx = x - 17;
    const ly = y + 4 - i * 4.2;
    g.fillStyle(i % 2 === 0 ? 0x8a5a30 : 0x9c6a3a, 1);
    g.fillCircle(lx, ly, 4.4);
    g.lineStyle(1, 0x5a3a1c, 1);
    g.strokeCircle(lx, ly, 4.4);
    g.fillStyle(0xc9a06a, 1);
    g.fillCircle(lx, ly, 1.6);
  }

  g.fillStyle(0x8b5e34, 1);
  g.fillRect(x - 8, y - 1, 22, 12);
  g.lineStyle(2, ownerColor, 1);
  g.strokeRect(x - 8, y - 1, 22, 12);

  g.fillStyle(0x5a3a1c, 1);
  g.beginPath();
  g.moveTo(x - 10, y - 1);
  g.lineTo(x + 3, y - 11);
  g.lineTo(x + 16, y - 1);
  g.closePath();
  g.fillPath();

  // circular saw blade on the shed face
  g.fillStyle(0xb8bec7, 1);
  g.fillCircle(x + 3, y + 5, 4);
  g.lineStyle(1, 0x6b7280, 1);
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI / 4) * i;
    g.lineBetween(x + 3, y + 5, x + 3 + Math.cos(a) * 5, y + 5 + Math.sin(a) * 5);
  }
}

function drawQuarryIcon(g: G, x: number, y: number, ownerColor: number) {
  // rocky pile
  const rocks: [number, number, number][] = [
    [-10, 6, 8],
    [2, 8, 9],
    [12, 6, 7],
    [-2, 2, 7],
  ];
  for (const [dx, dy, s] of rocks) {
    g.fillStyle(0x8a8a8a, 1);
    g.fillCircle(x + dx, y + dy, s * 0.6);
    g.lineStyle(1, 0x5f5f5f, 1);
    g.strokeCircle(x + dx, y + dy, s * 0.6);
  }
  g.fillStyle(0xd6d6d6, 0.8);
  g.fillCircle(x - 3, y + 3, 2.4);

  // pickaxe
  g.lineStyle(2, 0x6b4423, 1);
  g.lineBetween(x - 2, y - 4, x + 8, y - 12);
  g.lineStyle(2.4, 0x8a8a8a, 1);
  g.lineBetween(x + 3, y - 10, x + 11, y - 15);
  g.lineBetween(x + 3, y - 10, x + 8, y - 4);

  g.lineStyle(1.5, 0x3a3a3a, 1);
  g.lineBetween(x - 16, y + 9, x - 16, y - 6);
  g.fillStyle(ownerColor, 1);
  g.beginPath();
  g.moveTo(x - 16, y - 6);
  g.lineTo(x - 9, y - 3.5);
  g.lineTo(x - 16, y - 1);
  g.closePath();
  g.fillPath();
}

function drawFishersHutIcon(g: G, x: number, y: number, ownerColor: number) {
  // dock planks
  g.fillStyle(0x6b4a2a, 1);
  for (let i = -1; i <= 1; i++) {
    g.fillRect(x - 14, y + 6 + i * 3.4, 30, 2.2);
  }

  g.fillStyle(0x8b6a44, 1);
  g.fillRect(x - 9, y - 4, 18, 11);
  g.lineStyle(2, ownerColor, 1);
  g.strokeRect(x - 9, y - 4, 18, 11);
  g.fillStyle(0x5a3a1c, 1);
  g.beginPath();
  g.moveTo(x - 11, y - 4);
  g.lineTo(x, y - 13);
  g.lineTo(x + 11, y - 4);
  g.closePath();
  g.fillPath();

  // a fish resting on the dock
  g.fillStyle(0x4a90c4, 1);
  g.fillEllipse(x + 12, y + 8, 8, 3.6);
  g.beginPath();
  g.moveTo(x + 17, y + 8);
  g.lineTo(x + 21, y + 5.5);
  g.lineTo(x + 21, y + 10.5);
  g.closePath();
  g.fillPath();
}

function drawHouseIcon(g: G, x: number, y: number, ownerColor: number) {
  g.fillStyle(0xcdbfa0, 1);
  g.fillRect(x - 11, y - 3, 22, 13);
  g.lineStyle(2, ownerColor, 1);
  g.strokeRect(x - 11, y - 3, 22, 13);

  g.fillStyle(0x8a3b2e, 1);
  g.beginPath();
  g.moveTo(x - 14, y - 3);
  g.lineTo(x, y - 14);
  g.lineTo(x + 14, y - 3);
  g.closePath();
  g.fillPath();
  g.lineStyle(1, 0x5c2620, 1);
  g.strokePath();

  // door
  g.fillStyle(0x5a3a1c, 1);
  g.fillRect(x - 2.5, y + 2, 5, 8);
  // window
  g.fillStyle(0xbfe3f0, 1);
  g.fillRect(x + 3, y - 1, 4.5, 4.5);
  g.lineStyle(0.8, 0x5a3a1c, 1);
  g.strokeRect(x + 3, y - 1, 4.5, 4.5);
}

/** A short paved strip with a dashed centerline, in the owner's color so a Road reads as claimed ground rather than a neutral path. */
function drawRoadIcon(g: G, x: number, y: number, ownerColor: number) {
  g.fillStyle(0x8a8478, 1);
  g.fillRect(x - 15, y - 6, 30, 12);
  g.lineStyle(1.5, shade(ownerColor, -0.2), 1);
  g.strokeRect(x - 15, y - 6, 30, 12);

  g.lineStyle(1.8, 0xe8e2d0, 0.9);
  for (const dx of [-9, -1, 7]) {
    g.lineBetween(x + dx, y, x + dx + 4, y);
  }
}

function drawFishingBoatIcon(g: G, x: number, y: number, ownerColor: number) {
  // a small rowboat hull sitting on the river tile's own water
  g.fillStyle(0x6b4423, 1);
  g.beginPath();
  g.moveTo(x - 11, y + 2);
  g.lineTo(x + 11, y + 2);
  g.lineTo(x + 6, y + 8);
  g.lineTo(x - 6, y + 8);
  g.closePath();
  g.fillPath();
  g.lineStyle(1.2, shade(ownerColor, -0.2), 1);
  g.strokeRect(x - 11, y - 1, 22, 3);
  g.fillStyle(ownerColor, 1);
  g.fillRect(x - 11, y - 1, 22, 3);

  // mast + net, owner-colored pennant
  g.lineStyle(1.5, 0x8a5a2a, 1);
  g.lineBetween(x, y - 1, x, y - 10);
  g.fillStyle(ownerColor, 1);
  g.beginPath();
  g.moveTo(x, y - 10);
  g.lineTo(x + 6, y - 8);
  g.lineTo(x, y - 6);
  g.closePath();
  g.fillPath();
}

function drawBridgeIcon(g: G, x: number, y: number, ownerColor: number) {
  // planks spanning the river tile, with pilings dipping into the water below
  g.fillStyle(0x8a5a2a, 1);
  g.fillRect(x - 15, y - 5, 30, 10);
  g.lineStyle(1.5, shade(ownerColor, -0.2), 1);
  g.strokeRect(x - 15, y - 5, 30, 10);

  g.lineStyle(1.2, 0x5c3a1a, 0.9);
  for (const dx of [-10, -3, 4, 11]) {
    g.lineBetween(x + dx, y - 5, x + dx, y + 5);
  }

  g.fillStyle(0x5c3a1a, 1);
  g.fillRect(x - 13, y + 5, 3, 4);
  g.fillRect(x + 10, y + 5, 3, 4);
}

// ---------- troop icons ----------

export function drawMilitiaIcon(g: G, x: number, y: number, ownerColor: number) {
  g.fillStyle(ownerColor, 1);
  g.fillCircle(x, y + 2, 6.5);
  g.lineStyle(1, shade(ownerColor, -0.4), 1);
  g.strokeCircle(x, y + 2, 6.5);

  g.fillStyle(0xe8b98a, 1);
  g.fillCircle(x, y - 5, 3.2);

  // a crude club, not a proper sword -- a levy, not a knight
  g.lineStyle(2, 0x6b4423, 1);
  g.beginPath();
  g.moveTo(x + 3, y - 1);
  g.lineTo(x + 8, y - 8);
  g.strokePath();
  g.fillStyle(0x7a5230, 1);
  g.fillCircle(x + 8.5, y - 8.5, 2.1);
}

export function drawArcherIcon(g: G, x: number, y: number, ownerColor: number) {
  g.fillStyle(ownerColor, 1);
  g.fillCircle(x, y + 2, 6);
  g.lineStyle(1, shade(ownerColor, -0.4), 1);
  g.strokeCircle(x, y + 2, 6);

  g.fillStyle(0xe8b98a, 1);
  g.fillCircle(x, y - 5, 3);

  // quiver on the back
  g.fillStyle(0x6b4423, 1);
  g.fillRect(x - 7, y - 4, 3, 7);
  g.lineStyle(1, 0xd8dce2, 1);
  g.lineBetween(x - 7, y - 4, x - 5.5, y - 8);
  g.lineBetween(x - 5, y - 4, x - 3.5, y - 8);

  // bow, held out front
  g.lineStyle(1.6, 0x8a5a2a, 1);
  g.beginPath();
  g.arc(x + 3, y, 6.5, Math.PI * 0.35, Math.PI * 1.65, false);
  g.strokePath();
  g.lineStyle(0.8, 0xd8dce2, 0.9);
  g.lineBetween(x + 7.5, y - 4.5, x + 7.5, y + 4.5);
}

export function drawSpearmanIcon(g: G, x: number, y: number, ownerColor: number) {
  g.fillStyle(ownerColor, 1);
  g.fillCircle(x, y + 2, 6.5);
  g.lineStyle(1, shade(ownerColor, -0.4), 1);
  g.strokeCircle(x, y + 2, 6.5);

  g.fillStyle(0xe8b98a, 1);
  g.fillCircle(x, y - 5, 3.2);

  // a long spear held diagonally, well past the body on both ends -- reads
  // as a reach weapon at a glance, distinct from the Militia's short club
  g.lineStyle(2, 0x8a5a2a, 1);
  g.beginPath();
  g.moveTo(x - 8, y + 9);
  g.lineTo(x + 9, y - 11);
  g.strokePath();
  g.fillStyle(0xc7cdd6, 1);
  g.fillTriangle(x + 9, y - 11, x + 6, y - 6, x + 11, y - 6.5);
}
