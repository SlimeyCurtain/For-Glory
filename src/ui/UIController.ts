import { BUILDINGS, CLEAR_RUBBLE_COST, CLEAR_RUBBLE_COST_ENEMY, FISHING_BOAT_HUT_GOLD_BONUS, MATCH_DURATION_MS, TERRAIN, TROOPS } from '../game/balance';
import type { ResourceKey, TerrainType, TroopType } from '../game/balance';
import { GameState } from '../game/GameState';
import { hexDistance } from '../game/hex';
import type { Offset } from '../game/hex';
import type { MapView } from '../scenes/MainScene';
import type { Building, Troop } from '../game/types';
import { shouldFlashTimer } from './GameFlow';

const HUMAN = 1 as const;

const RESOURCES: { key: ResourceKey; label: string }[] = [
  { key: 'gold', label: 'Gold' },
  { key: 'food', label: 'Food' },
  { key: 'straw', label: 'Straw' },
  { key: 'wood', label: 'Wood' },
  { key: 'stone', label: 'Stone' },
];

/** Short suffix used when listing a resource cost inline, e.g. "10g + 25 straw". */
const RESOURCE_SUFFIX: Record<ResourceKey, string> = {
  gold: 'g',
  food: 'f',
  straw: ' straw',
  wood: ' wood',
  stone: ' stone',
};

function formatCost(cost: Partial<Record<ResourceKey, number>>): string {
  const parts = RESOURCES.filter((r) => cost[r.key]).map((r) => `${cost[r.key]}${RESOURCE_SUFFIX[r.key]}`);
  return parts.length > 0 ? parts.join(' + ') : 'Free';
}

export class UIController {
  private el: {
    resources: Record<ResourceKey, { value: HTMLElement; rate: HTMLElement }>;
    timer: HTMLElement;
    scoreYou: HTMLElement;
    scoreOpp: HTMLElement;
    panel: HTMLElement;
    panelTitle: HTMLElement;
    panelBody: HTMLElement;
    banner: HTMLElement;
  };

  private selectedTile: Offset | null = null;
  private selectedTroopId: string | null = null;
  private selectedBuildingId: string | null = null;
  private mode: 'none' | 'tileInfo' | 'build' | 'buildingInfo' | 'troop' | 'pathTrace' | 'interceptList' | 'boatPlacement' = 'none';

  /** Path the player has traced by hand for the selected troop, and the enemy
   * building (if any) it currently ends next to. */
  private tracedPath: Offset[] = [];
  private pendingAttackTargetId: string | null = null;
  private lastLiveSignature: string | null = null;
  /** The Fisher's Hut whose eligible river tiles are currently glowing on the map, while `mode === 'boatPlacement'`. */
  private boatPlacementHutId: string | null = null;

  private state: GameState;
  private mapView: MapView;

  constructor(state: GameState, root: HTMLElement, mapView: MapView) {
    this.state = state;
    this.mapView = mapView;
    root.innerHTML = `
      <div id="hud">
        ${RESOURCES.map(
          (r) =>
            `<div class="hud-group"><span class="hud-label">${r.label}</span><span id="hud-${r.key}" class="hud-value">0</span><span id="hud-${r.key}-rate" class="hud-rate"></span></div>`
        ).join('')}
        <div class="hud-group"><span class="hud-label">You</span><span id="hud-score-you">0</span></div>
        <div class="hud-group"><span class="hud-label">Foe</span><span id="hud-score-opp">0</span></div>
        <div class="hud-group hud-timer"><span id="hud-timer">5:00</span></div>
      </div>
      <div id="banner"></div>
      <div id="panel" class="hidden">
        <div id="panel-title"></div>
        <div id="panel-body"></div>
        <button id="panel-close">Close</button>
      </div>
    `;
    this.el = {
      resources: Object.fromEntries(
        RESOURCES.map((r) => [
          r.key,
          { value: document.getElementById(`hud-${r.key}`)!, rate: document.getElementById(`hud-${r.key}-rate`)! },
        ])
      ) as Record<ResourceKey, { value: HTMLElement; rate: HTMLElement }>,
      timer: document.getElementById('hud-timer')!,
      scoreYou: document.getElementById('hud-score-you')!,
      scoreOpp: document.getElementById('hud-score-opp')!,
      panel: document.getElementById('panel')!,
      panelTitle: document.getElementById('panel-title')!,
      panelBody: document.getElementById('panel-body')!,
      banner: document.getElementById('banner')!,
    };
    document.getElementById('panel-close')!.addEventListener('click', () => this.closePanel());
  }

  onTileClick(tile: Offset) {
    if (this.mode === 'boatPlacement') {
      this.handleBoatPlacementTile(tile);
      return;
    }
    if (this.mode === 'pathTrace') {
      this.handlePathTraceTile(tile);
      return;
    }
    const existing = this.state.tileOccupiedByBuilding(tile);
    if (existing && (existing.ownerId === HUMAN || existing.state === 'destroyed')) {
      this.onBuildingClick(existing);
      return;
    }
    this.selectedTile = tile;
    this.mode = 'tileInfo';
    this.renderTileInfo();
  }

  /**
   * A tap while a Fisher's Hut's eligible river tiles are glowing: builds a
   * boat there if it's one of them, otherwise cancels placement mode and
   * re-dispatches the tap as an ordinary click (so tapping away, or another
   * building/tile, behaves exactly as it would outside placement mode).
   */
  private handleBoatPlacementTile(tile: Offset) {
    const hut = this.boatPlacementHutId ? this.state.buildings.get(this.boatPlacementHutId) : null;
    if (!hut) {
      this.exitBoatPlacement();
      this.closePanel();
      return;
    }
    const eligible = this.state.eligibleFishingBoatTiles(hut);
    const isEligible = eligible.some((t) => t.col === tile.col && t.row === tile.row);
    if (!isEligible) {
      this.exitBoatPlacement();
      this.mode = 'none';
      this.onTileClick(tile);
      return;
    }
    const res = this.state.issueBuildFishingBoat(HUMAN, hut.id, tile);
    if (!res.ok) {
      this.flashBanner(res.reason ?? 'Failed');
      return;
    }
    const remaining = this.state.eligibleFishingBoatTiles(hut);
    if (remaining.length > 0) {
      this.mapView.setBuildableHighlight(remaining);
    } else {
      this.exitBoatPlacement();
      this.selectedBuildingId = hut.id;
      this.mode = 'buildingInfo';
      this.renderBuildingInfo();
    }
  }

  private exitBoatPlacement() {
    this.boatPlacementHutId = null;
    this.mapView.clearBuildableHighlight();
  }

  onBuildingClick(building: Building) {
    if (this.mode === 'boatPlacement') this.exitBoatPlacement();
    if (this.mode === 'pathTrace') {
      this.handlePathTraceBuilding(building);
      return;
    }
    if (building.state === 'destroyed') {
      // Rubble gets its own panel (with a Clear Tile option) regardless of
      // whose it is -- clearing an opponent's is a real, if pricier, action.
      this.selectedBuildingId = building.id;
      this.mode = 'buildingInfo';
      this.renderBuildingInfo();
      return;
    }
    if (building.ownerId !== HUMAN) {
      // enemy buildings are only targeted by tracing a path to them; a plain
      // tap just shows what's known about that tile, same as empty terrain
      this.selectedTile = building.tile;
      this.mode = 'tileInfo';
      this.renderTileInfo();
      return;
    }
    this.selectedBuildingId = building.id;
    this.mode = 'buildingInfo';
    this.renderBuildingInfo();
  }

  onTroopClick(troop: Troop) {
    if (troop.ownerId !== HUMAN) return;
    if (this.mode === 'boatPlacement') this.exitBoatPlacement();
    // Tapping the same troop again while its menu is already open swaps the
    // panel to the tile it's standing on instead -- a second tap on the
    // troop sprite is otherwise a dead click, and this gives a quick way to
    // check the ground under it without hunting for empty space to tap.
    if (this.mode === 'troop' && this.selectedTroopId === troop.id) {
      this.selectedTile = troop.tile;
      this.mode = 'tileInfo';
      this.renderTileInfo();
      return;
    }
    this.selectedTroopId = troop.id;
    this.mode = 'troop';
    this.endPathTrace();
    this.renderTroopMenu();
  }

  onTick() {
    const you = this.state.players[HUMAN];
    const opp = this.state.players[this.state.opponentOf(HUMAN)];
    for (const r of RESOURCES) {
      const rate = this.state.netResourceRatePerSec(HUMAN, r.key);
      const negative = rate < 0;
      const els = this.el.resources[r.key];
      els.value.textContent = Math.floor(you[r.key]).toString();
      els.rate.textContent = Math.abs(rate) < 0.05 ? '' : `${rate > 0 ? '+' : ''}${rate.toFixed(1)}/s`;
      els.value.classList.toggle('negative', negative);
      els.rate.classList.toggle('negative', negative);
    }
    this.el.scoreYou.textContent = you.score.toFixed(2);
    this.el.scoreOpp.textContent = opp.score.toFixed(2);

    const remainingMs = Math.max(0, MATCH_DURATION_MS - this.state.matchElapsedMs);
    const totalSec = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    this.el.timer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    // Flashes in the closing 10s of a running clock; frozen (and un-flashed)
    // the instant the match ends, win-by-time or win-by-castle alike.
    this.el.timer.classList.toggle('flashing', shouldFlashTimer(remainingMs, this.state.gameOver));

    this.refreshLivePanel();
  }

  /**
   * Keep open panels live (hp bars, resource affordability, disappearing
   * targets) without rebuilding their buttons every animation frame -- doing
   * that unconditionally would destroy and recreate the DOM nodes ~60
   * times/sec, which is wasteful and can swallow a real tap/click that lands
   * between two rebuilds. Only re-render when something the panel actually
   * shows has changed.
   */
  private refreshLivePanel() {
    const signature = this.computeLiveSignature();
    if (signature === this.lastLiveSignature) return;
    this.lastLiveSignature = signature;

    if (this.mode === 'tileInfo') this.renderTileInfo();
    if (this.mode === 'buildingInfo') this.renderBuildingInfo();
    if (this.mode === 'interceptList') this.renderInterceptList();
    if (this.mode === 'troop') this.renderTroopMenu();
    if (this.mode === 'pathTrace') {
      const t = this.state.troops.get(this.selectedTroopId ?? '');
      if (t) this.renderPathTracePanel(t);
      else this.closePanel();
    }
  }

  private computeLiveSignature(): string {
    const b = this.selectedBuildingId ? this.state.buildings.get(this.selectedBuildingId) : null;
    const t = this.selectedTroopId ? this.state.troops.get(this.selectedTroopId) : null;
    const threats = this.mode === 'troop' || this.mode === 'pathTrace' ? this.state.incomingThreatsFor(HUMAN).length : 0;
    const player = this.state.players[HUMAN];
    const tileOwner = this.selectedTile ? this.state.tileOccupiedByBuilding(this.selectedTile)?.ownerId ?? null : null;
    const tileIsYours = this.selectedTile ? this.state.isOwnedTerritory(HUMAN, this.selectedTile) : null;
    const hasAdjacentTroop =
      b?.state === 'destroyed' && b.ownerId !== HUMAN
        ? this.state.troopsOf(HUMAN).some((troop) => hexDistance(troop.tile, b.tile) === 1)
        : null;
    const eligibleBoatTiles = b?.type === 'fishersHut' ? this.state.eligibleFishingBoatTiles(b).length : null;
    return JSON.stringify([
      this.mode,
      this.tracedPath.length,
      this.pendingAttackTargetId,
      b ? Math.ceil(b.hp) : null,
      b?.state,
      b?.training ? Math.ceil(b.training.remainingMs / 500) : null,
      b?.repairing,
      hasAdjacentTroop,
      eligibleBoatTiles,
      t ? Math.ceil(t.hp) : null,
      t?.order.kind,
      threats,
      tileOwner,
      tileIsYours,
      Math.floor(player.gold),
      Math.floor(player.food),
      Math.floor(player.straw),
      Math.floor(player.wood),
      Math.floor(player.stone),
    ]);
  }

  private closePanel() {
    this.mode = 'none';
    this.selectedTile = null;
    this.selectedBuildingId = null;
    this.selectedTroopId = null;
    this.lastLiveSignature = null;
    this.endPathTrace();
    this.exitBoatPlacement();
    this.el.panel.classList.add('hidden');
  }

  private openPanel(title: string) {
    this.el.panel.classList.remove('hidden');
    this.el.panelTitle.textContent = title;
  }

  private flashBanner(text: string) {
    this.el.banner.textContent = text;
    this.el.banner.classList.add('show');
    window.setTimeout(() => this.el.banner.classList.remove('show'), 1600);
  }

  /** A titled callout box for a building/troop's Special Trait, when it has one. */
  private renderSpecialTrait(text?: string) {
    if (!text) return;
    const box = document.createElement('div');
    box.className = 'special-trait';
    const title = document.createElement('div');
    title.className = 'special-trait-title';
    title.textContent = 'Special Trait';
    const body = document.createElement('div');
    body.className = 'special-trait-text';
    body.textContent = text;
    box.appendChild(title);
    box.appendChild(body);
    this.el.panelBody.appendChild(box);
  }

  // ---------- path tracing (player-drawn movement/attack routes) ----------

  private endPathTrace() {
    this.tracedPath = [];
    this.pendingAttackTargetId = null;
    this.mapView.clearPathPreview();
  }

  private handlePathTraceTile(tile: Offset) {
    const t = this.state.troops.get(this.selectedTroopId ?? '');
    if (!t) {
      this.closePanel();
      return;
    }

    if (tile.col === t.tile.col && tile.row === t.tile.row) {
      this.tracedPath = [];
      this.pendingAttackTargetId = null;
      this.refreshPathTrace(t);
      return;
    }

    const idxInPath = this.tracedPath.findIndex((p) => p.col === tile.col && p.row === tile.row);
    if (idxInPath !== -1) {
      this.tracedPath = this.tracedPath.slice(0, idxInPath + 1);
      this.pendingAttackTargetId = null;
      this.refreshPathTrace(t);
      return;
    }

    if (this.state.isValidNextStep(t, this.tracedPath, tile)) {
      this.tracedPath.push(tile);
      this.pendingAttackTargetId = null;
      this.refreshPathTrace(t);
      return;
    }

    this.flashBanner('Tap an adjacent open tile to extend the path');
  }

  private handlePathTraceBuilding(building: Building) {
    const t = this.state.troops.get(this.selectedTroopId ?? '');
    if (!t) {
      this.closePanel();
      return;
    }
    if (building.ownerId === HUMAN) {
      this.flashBanner("That's your own building");
      return;
    }
    if (building.type === 'castle') {
      this.flashBanner('Castle requires siege units');
      return;
    }
    if (!TROOPS[t.type].canAttackBuildings) {
      this.flashBanner(`${TROOPS[t.type].name} cannot attack buildings`);
      return;
    }
    const pathEnd = this.tracedPath.length > 0 ? this.tracedPath[this.tracedPath.length - 1] : t.tile;
    if (hexDistance(pathEnd, building.tile) !== 1) {
      this.flashBanner('Trace your path next to that building first');
      return;
    }
    this.pendingAttackTargetId = building.id;
    this.refreshPathTrace(t);
  }

  private refreshPathTrace(t: Troop) {
    this.mapView.setPathPreview(t.tile, this.tracedPath);
    this.renderPathTracePanel(t);
  }

  private renderPathTracePanel(t: Troop) {
    const targetBuilding = this.pendingAttackTargetId ? this.state.buildings.get(this.pendingAttackTargetId) : null;
    this.openPanel(targetBuilding ? `Attack ${labelName(targetBuilding)}?` : 'Trace a path');
    this.el.panelBody.innerHTML = '';

    const hint = document.createElement('p');
    hint.className = 'hint';
    const steps = this.tracedPath.length;
    if (targetBuilding) {
      hint.textContent = `Route drawn (${steps} tile${steps === 1 ? '' : 's'}). Confirm to march in and pillage ${labelName(targetBuilding)}.`;
    } else if (steps === 0) {
      hint.textContent = 'Tap adjacent tiles to draw a route for this troop. Tap an enemy building once your path reaches next to it.';
    } else {
      hint.textContent = `Route drawn (${steps} tile${steps === 1 ? '' : 's'}). Keep tapping to extend it, tap a drawn tile to rewind, or confirm to move here.`;
    }
    this.el.panelBody.appendChild(hint);

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'action-btn';
    confirmBtn.disabled = this.tracedPath.length === 0;
    confirmBtn.textContent = targetBuilding ? 'Confirm Attack' : 'Confirm Move';
    confirmBtn.addEventListener('click', () => {
      const res = this.state.issueManualMove(t.id, this.tracedPath, this.pendingAttackTargetId ?? undefined);
      if (!res.ok) this.flashBanner(res.reason ?? 'Failed');
      this.closePanel();
    });
    this.el.panelBody.appendChild(confirmBtn);

    const undoBtn = document.createElement('button');
    undoBtn.className = 'action-btn secondary';
    undoBtn.textContent = 'Undo last step';
    undoBtn.disabled = this.tracedPath.length === 0;
    undoBtn.addEventListener('click', () => {
      this.tracedPath.pop();
      this.pendingAttackTargetId = null;
      this.refreshPathTrace(t);
    });
    this.el.panelBody.appendChild(undoBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      this.endPathTrace();
      this.mode = 'troop';
      this.renderTroopMenu();
    });
    this.el.panelBody.appendChild(cancelBtn);
  }

  // ---------- panels ----------

  private renderTileInfo() {
    if (!this.selectedTile) return;
    const tile = this.selectedTile;
    const terrain = this.state.terrainAt(tile);
    if (!terrain) {
      this.closePanel();
      return;
    }
    const def = TERRAIN[terrain];
    const existingBuilding = this.state.tileOccupiedByBuilding(tile);

    let territoryLabel: 'Yours' | 'Enemy' | 'Unoccupied';
    if (existingBuilding) {
      territoryLabel = existingBuilding.ownerId === HUMAN ? 'Yours' : 'Enemy';
    } else if (this.state.isOwnedTerritory(HUMAN, tile)) {
      territoryLabel = 'Yours';
    } else if (this.state.isOwnedTerritory(this.state.opponentOf(HUMAN), tile)) {
      territoryLabel = 'Enemy';
    } else {
      territoryLabel = 'Unoccupied';
    }

    this.openPanel(terrainName(terrain));
    this.el.panelBody.innerHTML = '';

    const effect = document.createElement('p');
    effect.className = 'hint';
    effect.textContent = def.effectText;
    this.el.panelBody.appendChild(effect);

    const territory = document.createElement('p');
    territory.className = 'hint';
    territory.textContent = `Territory: ${territoryLabel}`;
    this.el.panelBody.appendChild(territory);

    if (existingBuilding) {
      const b = document.createElement('p');
      b.className = 'hint';
      b.textContent =
        existingBuilding.state === 'destroyed'
          ? `Rubble (was ${BUILDINGS[existingBuilding.type].name})`
          : `${labelName(existingBuilding)} — ${Math.ceil(existingBuilding.hp)}/${existingBuilding.maxHp} HP`;
      this.el.panelBody.appendChild(b);
    }

    if (territoryLabel === 'Yours' && !existingBuilding) {
      const buildBtn = document.createElement('button');
      buildBtn.className = 'action-btn';
      buildBtn.textContent = 'Build';
      buildBtn.addEventListener('click', () => {
        this.mode = 'build';
        this.renderBuildMenu();
      });
      this.el.panelBody.appendChild(buildBtn);
    }
  }

  private renderBuildMenu() {
    if (!this.selectedTile) return;
    this.openPanel('Build');
    const tile = this.selectedTile;
    const options = this.state.availableBuildingsFor(HUMAN, tile);
    this.el.panelBody.innerHTML = '';
    const player = this.state.players[HUMAN];
    for (const type of options) {
      const def = BUILDINGS[type];
      const cost = this.state.previewBuildCost(HUMAN, type);
      const affordable = RESOURCES.every((r) => (cost[r.key] ?? 0) <= player[r.key]);
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.disabled = !affordable;
      btn.textContent = `${def.name} — ${formatCost(cost)}`;
      btn.addEventListener('click', () => {
        const res = this.state.issueBuild(HUMAN, tile, type);
        if (!res.ok) this.flashBanner(res.reason ?? 'Failed');
        this.closePanel();
      });
      this.el.panelBody.appendChild(btn);
    }
    if (options.length === 0) {
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = 'Nothing buildable on this terrain yet.';
      this.el.panelBody.appendChild(p);
    }
    const backBtn = document.createElement('button');
    backBtn.className = 'action-btn secondary';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => {
      this.mode = 'tileInfo';
      this.renderTileInfo();
    });
    this.el.panelBody.appendChild(backBtn);
  }

  private renderRubbleInfo(b: Building) {
    const isOwn = b.ownerId === HUMAN;
    this.openPanel(`${isOwn ? 'Rubble' : 'Enemy Rubble'} (was ${BUILDINGS[b.type].name})`);
    this.el.panelBody.innerHTML = '';

    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Blocks construction and movement until cleared.';
    this.el.panelBody.appendChild(hint);

    const player = this.state.players[HUMAN];
    const cost = isOwn ? CLEAR_RUBBLE_COST : CLEAR_RUBBLE_COST_ENEMY;
    const hasAdjacentTroop = this.state.troopsOf(HUMAN).some((troop) => hexDistance(troop.tile, b.tile) === 1);
    if (!isOwn && !hasAdjacentTroop) {
      const need = document.createElement('p');
      need.className = 'hint';
      need.textContent = 'Needs one of your troops standing adjacent to it.';
      this.el.panelBody.appendChild(need);
    }
    const btn = document.createElement('button');
    btn.className = 'action-btn';
    btn.textContent = `Clear Tile — ${cost}g`;
    btn.disabled = player.gold < cost || (!isOwn && !hasAdjacentTroop);
    btn.addEventListener('click', () => {
      const res = this.state.issueClearRubble(HUMAN, b.id);
      if (!res.ok) this.flashBanner(res.reason ?? 'Failed');
      else this.closePanel();
    });
    this.el.panelBody.appendChild(btn);
  }

  private renderBuildingInfo() {
    if (!this.selectedBuildingId) return;
    const b = this.state.buildings.get(this.selectedBuildingId);
    if (!b) {
      this.closePanel();
      return;
    }
    if (b.state === 'destroyed') {
      this.renderRubbleInfo(b);
      return;
    }
    this.openPanel(`${labelName(b)} — ${Math.ceil(b.hp)}/${b.maxHp} HP`);
    this.el.panelBody.innerHTML = '';

    if (b.state === 'constructing') {
      const p = document.createElement('p');
      p.textContent = 'Under construction…';
      this.el.panelBody.appendChild(p);
      return;
    }

    if (b.production.length > 0) {
      const boatBonus = b.type === 'fishersHut' ? this.state.adjacentActiveFishingBoatCount(b) * FISHING_BOAT_HUT_GOLD_BONUS : 0;
      const p = document.createElement('p');
      p.className = 'hint';
      p.textContent = b.production
        .map((feed) => `+${feed.amount + (feed.resource === 'gold' ? boatBonus : 0)} ${feed.resource} / ${feed.intervalMs / 1000}s`)
        .join(', ');
      this.el.panelBody.appendChild(p);
    }

    this.renderSpecialTrait(BUILDINGS[b.type].specialTrait);

    const player = this.state.players[HUMAN];

    if (b.type === 'barracks') {
      if (b.training) {
        const p = document.createElement('p');
        p.textContent = `Training ${TROOPS[b.training.troopType].name}… ${Math.ceil(b.training.remainingMs / 1000)}s`;
        this.el.panelBody.appendChild(p);
      } else {
        const hasWood = this.state.buildingsOf(HUMAN).some((x) => x.type === 'lumberMill' && x.state === 'active');
        const hasQuarry = this.state.buildingsOf(HUMAN).some((x) => x.type === 'quarry' && x.state === 'active');
        const trainable: TroopType[] = ['militia'];
        if (hasWood) trainable.push('archer');
        if (hasQuarry) trainable.push('spearman');
        for (const type of trainable) {
          const def = TROOPS[type];
          const cost: Partial<Record<ResourceKey, number>> = { gold: def.goldCost, food: def.foodCost };
          if (def.woodCost) cost.wood = def.woodCost;
          if (def.stoneCost) cost.stone = def.stoneCost;
          const affordable = RESOURCES.every((r) => (cost[r.key] ?? 0) <= player[r.key]);
          const btn = document.createElement('button');
          btn.className = 'action-btn';
          btn.disabled = !affordable;
          btn.textContent = `Train ${def.name} — ${formatCost(cost)}`;
          btn.addEventListener('click', () => {
            const res = this.state.issueTrain(HUMAN, b.id, type);
            if (!res.ok) this.flashBanner(res.reason ?? 'Failed');
          });
          this.el.panelBody.appendChild(btn);
        }
      }
    }

    if (b.type === 'fishersHut') {
      const eligible = this.state.eligibleFishingBoatTiles(b);
      if (eligible.length > 0) {
        const def = BUILDINGS.fishingBoat;
        const cost: Partial<Record<ResourceKey, number>> = { gold: def.goldCost, wood: def.woodCost };
        const affordable = RESOURCES.every((r) => (cost[r.key] ?? 0) <= player[r.key]);
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.disabled = !affordable;
        btn.textContent = `Build Fishing Boat — ${formatCost(cost)}`;
        btn.addEventListener('click', () => {
          this.mode = 'boatPlacement';
          this.boatPlacementHutId = b.id;
          this.mapView.setBuildableHighlight(this.state.eligibleFishingBoatTiles(b));
          this.renderBoatPlacementPanel(b);
        });
        this.el.panelBody.appendChild(btn);
      }
    }

    if (b.hp < b.maxHp && !b.repairing) {
      const cost = Math.ceil((b.maxHp - b.hp) * 0.5);
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.textContent = `Repair — ${cost}g`;
      btn.disabled = this.state.players[HUMAN].gold < cost;
      btn.addEventListener('click', () => {
        const res = this.state.issueRepair(HUMAN, b.id);
        if (!res.ok) this.flashBanner(res.reason ?? 'Failed');
      });
      this.el.panelBody.appendChild(btn);
    } else if (b.repairing) {
      const p = document.createElement('p');
      p.textContent = 'Repairing…';
      this.el.panelBody.appendChild(p);
    }
  }

  /** Shown while a Fisher's Hut's eligible river tiles are glowing on the map, waiting for a tap to confirm where the next Fishing Boat goes. */
  private renderBoatPlacementPanel(hut: Building) {
    this.openPanel("Build Fishing Boat");
    this.el.panelBody.innerHTML = '';
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.textContent = 'Tap a glowing river tile to build a Fishing Boat there.';
    this.el.panelBody.appendChild(hint);
    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'action-btn secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      this.exitBoatPlacement();
      this.selectedBuildingId = hut.id;
      this.mode = 'buildingInfo';
      this.renderBuildingInfo();
    });
    this.el.panelBody.appendChild(cancelBtn);
  }

  private renderTroopMenu() {
    if (!this.selectedTroopId) return;
    const t = this.state.troops.get(this.selectedTroopId);
    if (!t) {
      this.closePanel();
      return;
    }
    this.openPanel(`${TROOPS[t.type].name} — ${Math.ceil(t.hp)}/${t.maxHp} HP (${orderLabel(t)})`);
    this.el.panelBody.innerHTML = '';
    const speed = TROOPS[t.type].attackSpeedMs;
    const speedHint = document.createElement('p');
    speedHint.className = 'hint';
    speedHint.textContent = `Attacks every ${(speed.min / 1000).toFixed(1)}–${(speed.max / 1000).toFixed(1)}s`;
    this.el.panelBody.appendChild(speedHint);
    this.renderSpecialTrait(TROOPS[t.type].specialTrait);

    const moveBtn = document.createElement('button');
    moveBtn.className = 'action-btn';
    moveBtn.textContent = 'Move / Attack';
    moveBtn.addEventListener('click', () => {
      this.mode = 'pathTrace';
      this.tracedPath = [];
      this.pendingAttackTargetId = null;
      this.refreshPathTrace(t);
    });
    this.el.panelBody.appendChild(moveBtn);

    const defendBtn = document.createElement('button');
    defendBtn.className = 'action-btn';
    defendBtn.textContent = 'Defend';
    defendBtn.addEventListener('click', () => {
      this.state.issueDefendOrder(t.id);
      this.closePanel();
    });
    this.el.panelBody.appendChild(defendBtn);

    const healBtn = document.createElement('button');
    healBtn.className = 'action-btn';
    healBtn.textContent = 'Heal';
    healBtn.addEventListener('click', () => {
      this.state.issueHealOrder(t.id);
      this.closePanel();
    });
    this.el.panelBody.appendChild(healBtn);

    const threats = this.state.incomingThreatsFor(HUMAN);
    if (threats.length > 0) {
      const interceptBtn = document.createElement('button');
      interceptBtn.className = 'action-btn intercept-btn';
      interceptBtn.textContent = `Intercept (${threats.length} incoming)`;
      interceptBtn.addEventListener('click', () => {
        this.mode = 'interceptList';
        this.renderInterceptList();
      });
      this.el.panelBody.appendChild(interceptBtn);
    }
  }

  private renderInterceptList() {
    if (!this.selectedTroopId) return;
    const t = this.state.troops.get(this.selectedTroopId);
    if (!t) {
      this.closePanel();
      return;
    }
    this.openPanel('Choose a threat to intercept');
    this.el.panelBody.innerHTML = '';
    const threats = this.state.incomingThreatsFor(HUMAN);
    if (threats.length === 0) {
      this.closePanel();
      return;
    }
    for (const enemy of threats) {
      const targetBuildingId = enemy.order.kind === 'moveToAttack' || enemy.order.kind === 'pillaging' ? enemy.order.targetBuildingId : null;
      const targetBuilding = targetBuildingId ? this.state.buildings.get(targetBuildingId) : null;
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.textContent = `Enemy ${TROOPS[enemy.type].name} → ${targetBuilding ? labelName(targetBuilding) : 'unknown'}`;
      btn.addEventListener('click', () => {
        const res = this.state.issueInterceptOrder(t.id, enemy.id);
        if (!res.ok) this.flashBanner(res.reason ?? 'Failed');
        this.closePanel();
      });
      this.el.panelBody.appendChild(btn);
    }
    const backBtn = document.createElement('button');
    backBtn.className = 'action-btn secondary';
    backBtn.textContent = 'Back';
    backBtn.addEventListener('click', () => {
      this.mode = 'troop';
      this.renderTroopMenu();
    });
    this.el.panelBody.appendChild(backBtn);
  }

}

function labelName(b: Building): string {
  return BUILDINGS[b.type].name;
}

function terrainName(t: TerrainType): string {
  switch (t) {
    case 'plains':
      return 'Plains';
    case 'forest':
      return 'Forest';
    case 'hills':
      return 'Hills';
    case 'mountains':
      return 'Mountains';
    case 'river':
      return 'River / Lake';
    case 'castleGround':
      return 'Castle Grounds';
  }
}

function orderLabel(t: Troop): string {
  switch (t.order.kind) {
    case 'idle':
      return 'idle';
    case 'moveToAttack':
      return 'marching to attack';
    case 'pillaging':
      return 'pillaging';
    case 'moveToIntercept':
      return 'intercepting';
    case 'fighting':
      return 'in combat';
    case 'defend':
      return 'defending';
    case 'heal':
      return 'healing';
    case 'moveToReposition':
      return 'moving';
  }
}
