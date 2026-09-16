import Phaser from 'phaser';
import { TERRAIN } from '../game/balance';
import { GameState } from '../game/GameState';
import { AIController } from '../game/AIController';
import { hexCorners, offsetToPixel } from '../game/hex';
import type { Offset } from '../game/hex';
import type { Building, Troop } from '../game/types';

export const MARGIN = 60;
const PLAYER_COLOR: Record<1 | 2, number> = { 1: 0x2563eb, 2: 0xdc2626 };

export interface SceneCallbacks {
  onTileClick(tile: Offset): void;
  onBuildingClick(building: Building): void;
  onTroopClick(troop: Troop): void;
  onTick(): void;
}

/** What the UI layer needs to draw a player-traced movement path on the map. */
export interface MapView {
  setPathPreview(startTile: Offset, path: Offset[]): void;
  clearPathPreview(): void;
}

export class MainScene extends Phaser.Scene implements MapView {
  private buildingSprites = new Map<string, { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text; hpBar: Phaser.GameObjects.Rectangle }>();
  private troopSprites = new Map<string, { circle: Phaser.GameObjects.Arc; hpBar: Phaser.GameObjects.Rectangle }>();
  private pathPreviewGraphics!: Phaser.GameObjects.Graphics;

  private state: GameState;
  private ai: AIController;
  private callbacks: SceneCallbacks;

  constructor(state: GameState, ai: AIController, callbacks: SceneCallbacks) {
    super('main');
    this.state = state;
    this.ai = ai;
    this.callbacks = callbacks;
  }

  create() {
    this.drawTerrain();
    this.pathPreviewGraphics = this.add.graphics();
    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, objects: Phaser.GameObjects.GameObject[]) => {
      if (objects.length === 0) return;
      const obj = objects[0];
      const data = obj.getData('tile') as Offset | undefined;
      if (data) this.callbacks.onTileClick(data);
    });
  }

  setPathPreview(startTile: Offset, path: Offset[]) {
    const g = this.pathPreviewGraphics;
    g.clear();
    this.strokeHex(startTile, 0xffffff, 3);
    let prev = this.toScreen(offsetToPixel(startTile));
    for (const tile of path) {
      const center = this.toScreen(offsetToPixel(tile));
      g.lineStyle(4, 0xfacc15, 0.95);
      g.lineBetween(prev.x, prev.y, center.x, center.y);
      this.strokeHex(tile, 0xfacc15, 3);
      prev = center;
    }
  }

  clearPathPreview() {
    this.pathPreviewGraphics.clear();
  }

  private strokeHex(tile: Offset, color: number, width: number) {
    const center = this.toScreen(offsetToPixel(tile));
    const corners = hexCorners(center);
    const g = this.pathPreviewGraphics;
    g.lineStyle(width, color, 1);
    g.beginPath();
    g.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y);
    g.closePath();
    g.strokePath();
  }

  update(_time: number, delta: number) {
    if (!this.state.gameOver) {
      this.state.update(delta);
      this.ai.update(delta);
    }
    this.syncBuildings();
    this.syncTroops();
    this.callbacks.onTick();
  }

  private drawTerrain() {
    const g = this.add.graphics();
    for (const tile of this.state.tiles.values()) {
      const center = this.toScreen(offsetToPixel(tile.offset));
      const corners = hexCorners(center);
      const def = TERRAIN[tile.terrain];
      g.fillStyle(def.color, 1);
      g.beginPath();
      g.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y);
      g.closePath();
      g.fillPath();
      g.lineStyle(1, 0x000000, 0.15);
      g.strokePath();

      const zone = this.add.zone(center.x, center.y, 60, 60);
      zone.setInteractive(new Phaser.Geom.Polygon(corners.map((c) => ({ x: c.x - center.x + 30, y: c.y - center.y + 30 }))), Phaser.Geom.Polygon.Contains);
      zone.setData('tile', tile.offset);
    }
  }

  private toScreen(p: { x: number; y: number }) {
    return { x: p.x + MARGIN, y: p.y + MARGIN };
  }

  private syncBuildings() {
    const seen = new Set<string>();
    for (const b of this.state.buildings.values()) {
      if (b.state === 'destroyed') continue;
      seen.add(b.id);
      const center = this.toScreen(offsetToPixel(b.tile));
      let entry = this.buildingSprites.get(b.id);
      if (!entry) {
        const rect = this.add.rectangle(center.x, center.y, 30, 30, PLAYER_COLOR[b.ownerId], 0.95);
        rect.setStrokeStyle(2, 0x000000, 0.5);
        rect.setInteractive();
        rect.on('pointerdown', () => this.callbacks.onBuildingClick(b));
        const label = this.add.text(center.x, center.y, labelFor(b), { fontSize: '13px', color: '#ffffff' }).setOrigin(0.5);
        const hpBar = this.add.rectangle(center.x, center.y - 22, 30, 4, 0x22c55e).setOrigin(0.5);
        entry = { rect, label, hpBar };
        this.buildingSprites.set(b.id, entry);
      }
      entry.label.setText(labelFor(b));
      entry.rect.setAlpha(b.state === 'constructing' ? 0.6 : 1);
      const pct = Math.max(0, b.hp / b.maxHp);
      entry.hpBar.width = 30 * pct;
      entry.hpBar.x = center.x - (30 * (1 - pct)) / 2;
      entry.hpBar.fillColor = pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xf59e0b : 0xef4444;
      entry.hpBar.setVisible(b.hp < b.maxHp || b.state === 'constructing');
    }
    for (const [id, entry] of this.buildingSprites) {
      if (!seen.has(id)) {
        entry.rect.destroy();
        entry.label.destroy();
        entry.hpBar.destroy();
        this.buildingSprites.delete(id);
      }
    }
  }

  private syncTroops() {
    const seen = new Set<string>();
    for (const t of this.state.troops.values()) {
      seen.add(t.id);
      const pixel = this.troopScreenPos(t);
      let entry = this.troopSprites.get(t.id);
      if (!entry) {
        const circle = this.add.circle(pixel.x, pixel.y, 9, PLAYER_COLOR[t.ownerId]);
        circle.setStrokeStyle(2, orderRingColor(t), 1);
        circle.setInteractive();
        circle.on('pointerdown', () => this.callbacks.onTroopClick(t));
        const hpBar = this.add.rectangle(pixel.x, pixel.y - 16, 20, 3, 0x22c55e).setOrigin(0.5);
        entry = { circle, hpBar };
        this.troopSprites.set(t.id, entry);
      }
      entry.circle.setPosition(pixel.x, pixel.y);
      entry.circle.setStrokeStyle(2, orderRingColor(t), 1);
      entry.hpBar.setPosition(pixel.x - (20 * (1 - t.hp / t.maxHp)) / 2, pixel.y - 16);
      entry.hpBar.width = 20 * Math.max(0, t.hp / t.maxHp);
    }
    for (const [id, entry] of this.troopSprites) {
      if (!seen.has(id)) {
        entry.circle.destroy();
        entry.hpBar.destroy();
        this.troopSprites.delete(id);
      }
    }
  }

  private troopScreenPos(t: Troop): { x: number; y: number } {
    const from = this.toScreen(offsetToPixel(t.tile));
    if (!t.path || t.pathIndex >= t.path.length || t.segmentDurationMs === 0) return from;
    const to = this.toScreen(offsetToPixel(t.path[t.pathIndex]));
    const progress = Math.min(1, t.segmentElapsedMs / t.segmentDurationMs);
    return { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress };
  }
}

function labelFor(b: Building): string {
  if (b.type === 'castle') return 'C';
  if (b.type === 'farm') return 'F';
  return b.training ? 'B…' : 'B';
}

function orderRingColor(t: Troop): number {
  switch (t.order.kind) {
    case 'pillaging':
      return 0xf59e0b;
    case 'fighting':
      return 0xef4444;
    case 'defend':
      return 0x38bdf8;
    case 'heal':
      return 0x22c55e;
    case 'moveToAttack':
    case 'moveToIntercept':
    case 'moveToReposition':
      return 0xffffff;
    default:
      return 0x000000;
  }
}
