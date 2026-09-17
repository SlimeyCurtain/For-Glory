import Phaser from 'phaser';
import { GameState } from '../game/GameState';
import { AIController } from '../game/AIController';
import { hexCorners, offsetToPixel } from '../game/hex';
import type { Offset } from '../game/hex';
import type { Building, Troop } from '../game/types';
import { drawArcherIcon, drawBuildingIcon, drawHexTile, drawMilitiaIcon, drawRubbleIcon, drawSpearmanIcon, seededRng, tileSeed } from './art';

export const MARGIN = 60;
const PLAYER_COLOR: Record<1 | 2, number> = { 1: 0x2563eb, 2: 0xdc2626 };
const SHOT_EFFECT_LIFE_MS = 250;
/**
 * A backgrounded tab (phone screen lock, app switch) stops rAF entirely,
 * then resumes with one frame whose `delta` covers the whole gap -- possibly
 * minutes. Feeding that straight into the sim would spin every `while`
 * catch-up loop in GameState (production ticks, upkeep ticks) thousands of
 * times in one synchronous burst, freezing the frame and then dumping a
 * chaotic pile of changes at once. Clamping here sacrifices perfectly
 * accounting for backgrounded time in exchange for never doing that.
 */
const MAX_DT_MS = 250;

export interface SceneCallbacks {
  onTileClick(tile: Offset): void;
  onBuildingClick(building: Building): void;
  onTroopClick(troop: Troop): void;
  onTick(): void;
  /** Fires the instant any troop (either player's) enters the Defend stance. */
  onTroopDefend(): void;
  /** Fires once per frame that had at least one troop-vs-troop swing land. */
  onCombatHit(): void;
  /** Fires the instant a building begins construction, a repair, or a rebuild. */
  onBuildingWorkStart(): void;
  /** Fires the instant a building is destroyed. */
  onBuildingDestroyed(): void;
}

/** What the UI layer needs to draw a player-traced movement path on the map. */
export interface MapView {
  setPathPreview(startTile: Offset, path: Offset[]): void;
  clearPathPreview(): void;
  /** Pulses a glowing outline around each tile a pending building action (currently: Fishing Boat placement) can be confirmed on. */
  setBuildableHighlight(tiles: Offset[]): void;
  clearBuildableHighlight(): void;
}

interface BuildingSprite {
  hit: Phaser.GameObjects.Rectangle;
  icon: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Rectangle;
  lastRepairing: boolean;
  lastState: Building['state'];
}

interface TroopSprite {
  hit: Phaser.GameObjects.Arc;
  ring: Phaser.GameObjects.Graphics;
  icon: Phaser.GameObjects.Graphics;
  hpBar: Phaser.GameObjects.Rectangle;
  lastOrderKind: string;
}

interface ShotEffect {
  from: Offset;
  to: Offset;
  life: number;
}

export class MainScene extends Phaser.Scene implements MapView {
  private buildingSprites = new Map<string, BuildingSprite>();
  private troopSprites = new Map<string, TroopSprite>();
  private pathPreviewGraphics!: Phaser.GameObjects.Graphics;
  private shotGraphics!: Phaser.GameObjects.Graphics;
  private buildHighlightGraphics!: Phaser.GameObjects.Graphics;
  private buildHighlightTiles: Offset[] = [];
  private activeShotEffects: ShotEffect[] = [];

  private state: GameState;
  private ai: AIController;
  private callbacks: SceneCallbacks;
  /** While true, the sim clock is held still -- used during the intro countdown before "BEGIN". */
  private frozen = true;

  constructor(state: GameState, ai: AIController, callbacks: SceneCallbacks) {
    super('main');
    this.state = state;
    this.ai = ai;
    this.callbacks = callbacks;
  }

  setFrozen(frozen: boolean) {
    this.frozen = frozen;
  }

  create() {
    this.drawTerrain();
    this.pathPreviewGraphics = this.add.graphics();
    this.buildHighlightGraphics = this.add.graphics();
    this.shotGraphics = this.add.graphics();
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

  setBuildableHighlight(tiles: Offset[]) {
    this.buildHighlightTiles = tiles;
  }

  clearBuildableHighlight() {
    this.buildHighlightTiles = [];
    this.buildHighlightGraphics.clear();
  }

  /** Redrawn every frame (see `update`) so the glow can pulse rather than sit static. */
  private drawBuildHighlight(time: number) {
    const g = this.buildHighlightGraphics;
    g.clear();
    if (this.buildHighlightTiles.length === 0) return;
    const pulse = 0.5 + 0.5 * Math.sin(time / 220);
    const glowColor = 0x38f2c8;
    for (const tile of this.buildHighlightTiles) {
      const center = this.toScreen(offsetToPixel(tile));
      const corners = hexCorners(center);
      g.lineStyle(9, glowColor, 0.18 + pulse * 0.18);
      this.strokeHexPath(g, corners);
      g.lineStyle(3.5, glowColor, 0.7 + pulse * 0.3);
      this.strokeHexPath(g, corners);
    }
  }

  private strokeHexPath(g: Phaser.GameObjects.Graphics, corners: { x: number; y: number }[]) {
    g.beginPath();
    g.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < corners.length; i++) g.lineTo(corners[i].x, corners[i].y);
    g.closePath();
    g.strokePath();
  }

  private strokeHex(tile: Offset, color: number, width: number) {
    const center = this.toScreen(offsetToPixel(tile));
    const corners = hexCorners(center);
    const g = this.pathPreviewGraphics;
    g.lineStyle(width, color, 1);
    this.strokeHexPath(g, corners);
  }

  update(time: number, delta: number) {
    this.drawBuildHighlight(time);
    if (!this.state.gameOver && !this.frozen) {
      const dtMs = Math.min(delta, MAX_DT_MS);
      // A sim tick throwing (an edge case we haven't hit in testing, but
      // can't fully rule out on a live device) would otherwise propagate out
      // of Phaser's step and silently stop every future frame from ever
      // running -- exactly the "stalls out and just stops" failure mode.
      // Skipping the one bad frame keeps the game alive instead.
      try {
        this.state.update(dtMs);
        this.ai.update(dtMs);
      } catch (err) {
        console.error('Sim tick failed, skipping this frame:', err);
      }
    }
    this.syncBuildings();
    this.syncTroops();
    this.syncShotEffects(delta);
    this.callbacks.onTick();
  }

  private drawTerrain() {
    const g = this.add.graphics();
    for (const tile of this.state.tiles.values()) {
      const center = this.toScreen(offsetToPixel(tile.offset));
      const corners = hexCorners(center);
      const rng = seededRng(tileSeed(tile.offset.col, tile.offset.row));
      drawHexTile(g, tile.terrain, center, corners, rng);

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
      // Destroyed buildings stay on the board as rubble (rendered below)
      // instead of vanishing -- a cleared tile is a deliberate, paid action
      // now, not an automatic side effect of the building dying. The sprite
      // only actually disappears once `issueClearRubble` removes it from
      // `state.buildings`, which shows up here as it dropping out of `seen`.
      seen.add(b.id);
      const center = this.toScreen(offsetToPixel(b.tile));
      let entry = this.buildingSprites.get(b.id);
      if (!entry) {
        const hit = this.add.rectangle(center.x, center.y, 34, 34, 0x000000, 0);
        hit.setInteractive();
        hit.on('pointerdown', () => this.callbacks.onBuildingClick(b));
        const icon = this.add.graphics();
        const label = this.add.text(center.x, center.y + 17, '', { fontSize: '10px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5);
        const hpBar = this.add.rectangle(center.x, center.y - 22, 30, 4, 0x22c55e).setOrigin(0.5);
        entry = { hit, icon, label, hpBar, lastRepairing: b.repairing, lastState: b.state };
        this.buildingSprites.set(b.id, entry);
        // A building's very first appearance is exactly the moment it starts
        // construction (fresh build or credit-funded rebuild alike, since
        // both go through the same spawnBuilding path) -- the ideal, single
        // hook for the "beginning construction" hammering cue.
        this.callbacks.onBuildingWorkStart();
      }
      if (b.repairing && !entry.lastRepairing) this.callbacks.onBuildingWorkStart();
      if (b.state === 'destroyed' && entry.lastState !== 'destroyed') this.callbacks.onBuildingDestroyed();
      entry.lastRepairing = b.repairing;
      entry.lastState = b.state;
      entry.icon.clear();
      if (b.state === 'destroyed') {
        drawRubbleIcon(entry.icon, center.x, center.y);
      } else {
        drawBuildingIcon(entry.icon, b.type, center.x, center.y, PLAYER_COLOR[b.ownerId]);
      }
      entry.icon.setAlpha(b.state === 'constructing' ? 0.6 : 1);
      entry.label.setText(b.type === 'barracks' && b.training ? `${Math.ceil(b.training.remainingMs / 1000)}s` : '');
      const pct = Math.max(0, b.hp / b.maxHp);
      entry.hpBar.width = 30 * pct;
      entry.hpBar.x = center.x - (30 * (1 - pct)) / 2;
      entry.hpBar.fillColor = pct > 0.5 ? 0x22c55e : pct > 0.25 ? 0xf59e0b : 0xef4444;
      entry.hpBar.setVisible(b.state !== 'destroyed' && (b.hp < b.maxHp || b.state === 'constructing'));
    }
    for (const [id, entry] of this.buildingSprites) {
      if (!seen.has(id)) {
        entry.hit.destroy();
        entry.icon.destroy();
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
        const hit = this.add.circle(pixel.x, pixel.y, 10, 0x000000, 0);
        hit.setInteractive();
        hit.on('pointerdown', () => this.callbacks.onTroopClick(t));
        const ring = this.add.graphics();
        const icon = this.add.graphics();
        const hpBar = this.add.rectangle(pixel.x, pixel.y - 16, 20, 3, 0x22c55e).setOrigin(0.5);
        entry = { hit, ring, icon, hpBar, lastOrderKind: 'idle' };
        this.troopSprites.set(t.id, entry);
      }
      if (t.order.kind === 'defend' && entry.lastOrderKind !== 'defend') {
        this.callbacks.onTroopDefend();
      }
      entry.lastOrderKind = t.order.kind;
      entry.hit.setPosition(pixel.x, pixel.y);
      entry.ring.clear();
      entry.ring.lineStyle(2, orderRingColor(t), 1);
      entry.ring.strokeCircle(pixel.x, pixel.y, 9);
      entry.icon.clear();
      const drawTroopIcon = t.type === 'archer' ? drawArcherIcon : t.type === 'spearman' ? drawSpearmanIcon : drawMilitiaIcon;
      drawTroopIcon(entry.icon, pixel.x, pixel.y, PLAYER_COLOR[t.ownerId]);
      entry.hpBar.setPosition(pixel.x - (20 * (1 - t.hp / t.maxHp)) / 2, pixel.y - 16);
      entry.hpBar.width = 20 * Math.max(0, t.hp / t.maxHp);
    }
    for (const [id, entry] of this.troopSprites) {
      if (!seen.has(id)) {
        entry.hit.destroy();
        entry.ring.destroy();
        entry.icon.destroy();
        entry.hpBar.destroy();
        this.troopSprites.delete(id);
      }
    }
  }

  /** A brief flash + impact burst for the castle's ranged attack, since it's an instant hit with no travel time. */
  private syncShotEffects(delta: number) {
    for (const shot of this.state.pendingCastleShots) {
      this.activeShotEffects.push({ from: shot.from, to: shot.to, life: SHOT_EFFECT_LIFE_MS });
    }
    if (this.state.pendingCombatSwings > 0) this.callbacks.onCombatHit();
    this.activeShotEffects = this.activeShotEffects.filter((e) => {
      e.life -= delta;
      return e.life > 0;
    });

    this.shotGraphics.clear();
    for (const e of this.activeShotEffects) {
      const from = this.toScreen(offsetToPixel(e.from));
      const to = this.toScreen(offsetToPixel(e.to));
      const alpha = Math.max(0, e.life / SHOT_EFFECT_LIFE_MS);
      this.shotGraphics.lineStyle(2, 0xfbbf24, alpha);
      this.shotGraphics.lineBetween(from.x, from.y, to.x, to.y);
      this.shotGraphics.fillStyle(0xfbbf24, alpha);
      this.shotGraphics.fillCircle(to.x, to.y, 3 + 4 * alpha);
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
    case 'moveToReposition':
      return 0xffffff;
    default:
      return 0x000000;
  }
}
