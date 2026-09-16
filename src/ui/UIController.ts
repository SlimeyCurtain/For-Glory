import { BUILDINGS, MATCH_DURATION_MS, TERRAIN, TROOPS } from '../game/balance';
import type { BuildingType, TerrainType } from '../game/balance';
import { GameState } from '../game/GameState';
import { hexDistance } from '../game/hex';
import type { Offset } from '../game/hex';
import type { MapView } from '../scenes/MainScene';
import type { Building, Troop } from '../game/types';

const HUMAN = 1 as const;

export class UIController {
  private el: {
    gold: HTMLElement;
    food: HTMLElement;
    straw: HTMLElement;
    timer: HTMLElement;
    scoreYou: HTMLElement;
    scoreOpp: HTMLElement;
    panel: HTMLElement;
    panelTitle: HTMLElement;
    panelBody: HTMLElement;
    banner: HTMLElement;
    gameOver: HTMLElement;
    gameOverText: HTMLElement;
  };

  private selectedTile: Offset | null = null;
  private selectedTroopId: string | null = null;
  private selectedBuildingId: string | null = null;
  private mode: 'none' | 'tileInfo' | 'build' | 'buildingInfo' | 'troop' | 'pathTrace' | 'interceptList' = 'none';

  /** Path the player has traced by hand for the selected troop, and the enemy
   * building (if any) it currently ends next to. */
  private tracedPath: Offset[] = [];
  private pendingAttackTargetId: string | null = null;
  private lastLiveSignature: string | null = null;

  private state: GameState;
  private mapView: MapView;

  constructor(state: GameState, root: HTMLElement, mapView: MapView) {
    this.state = state;
    this.mapView = mapView;
    root.innerHTML = `
      <div id="hud">
        <div class="hud-group"><span class="hud-label">Gold</span><span id="hud-gold">0</span></div>
        <div class="hud-group"><span class="hud-label">Food</span><span id="hud-food">0</span></div>
        <div class="hud-group"><span class="hud-label">Straw</span><span id="hud-straw">0</span></div>
        <div class="hud-group hud-timer"><span id="hud-timer">5:00</span></div>
        <div class="hud-group"><span class="hud-label">You</span><span id="hud-score-you">0</span></div>
        <div class="hud-group"><span class="hud-label">Foe</span><span id="hud-score-opp">0</span></div>
      </div>
      <div id="banner"></div>
      <div id="panel" class="hidden">
        <div id="panel-title"></div>
        <div id="panel-body"></div>
        <button id="panel-close">Close</button>
      </div>
      <div id="game-over" class="hidden">
        <div id="game-over-text"></div>
      </div>
    `;
    this.el = {
      gold: document.getElementById('hud-gold')!,
      food: document.getElementById('hud-food')!,
      straw: document.getElementById('hud-straw')!,
      timer: document.getElementById('hud-timer')!,
      scoreYou: document.getElementById('hud-score-you')!,
      scoreOpp: document.getElementById('hud-score-opp')!,
      panel: document.getElementById('panel')!,
      panelTitle: document.getElementById('panel-title')!,
      panelBody: document.getElementById('panel-body')!,
      banner: document.getElementById('banner')!,
      gameOver: document.getElementById('game-over')!,
      gameOverText: document.getElementById('game-over-text')!,
    };
    document.getElementById('panel-close')!.addEventListener('click', () => this.closePanel());
  }

  onTileClick(tile: Offset) {
    if (this.mode === 'pathTrace') {
      this.handlePathTraceTile(tile);
      return;
    }
    const existing = this.state.tileOccupiedByBuilding(tile);
    if (existing && existing.ownerId === HUMAN) {
      this.onBuildingClick(existing);
      return;
    }
    this.selectedTile = tile;
    this.mode = 'tileInfo';
    this.renderTileInfo();
  }

  onBuildingClick(building: Building) {
    if (this.mode === 'pathTrace') {
      this.handlePathTraceBuilding(building);
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
    this.selectedTroopId = troop.id;
    this.mode = 'troop';
    this.endPathTrace();
    this.renderTroopMenu();
  }

  onTick() {
    const you = this.state.players[HUMAN];
    const opp = this.state.players[this.state.opponentOf(HUMAN)];
    this.el.gold.textContent = Math.floor(you.gold).toString();
    this.el.food.textContent = Math.floor(you.food).toString();
    this.el.straw.textContent = Math.floor(you.straw).toString();
    this.el.scoreYou.textContent = you.score.toFixed(2);
    this.el.scoreOpp.textContent = opp.score.toFixed(2);

    const remainingMs = Math.max(0, MATCH_DURATION_MS - this.state.matchElapsedMs);
    const totalSec = Math.ceil(remainingMs / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    this.el.timer.textContent = `${m}:${s.toString().padStart(2, '0')}`;

    if (this.state.gameOver) this.renderGameOver();

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
    return JSON.stringify([
      this.mode,
      this.tracedPath.length,
      this.pendingAttackTargetId,
      b ? Math.ceil(b.hp) : null,
      b?.state,
      b?.training ? Math.ceil(b.training.remainingMs / 500) : null,
      b?.repairing,
      t ? Math.ceil(t.hp) : null,
      t?.order.kind,
      threats,
      tileOwner,
      tileIsYours,
      Math.floor(player.gold),
      Math.floor(player.food),
      Math.floor(player.straw),
    ]);
  }

  private closePanel() {
    this.mode = 'none';
    this.selectedTile = null;
    this.selectedBuildingId = null;
    this.selectedTroopId = null;
    this.lastLiveSignature = null;
    this.endPathTrace();
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
      b.textContent = `${labelName(existingBuilding)} — ${Math.ceil(existingBuilding.hp)}/${existingBuilding.maxHp} HP`;
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
    for (const type of options) {
      const def = BUILDINGS[type as BuildingType];
      const player = this.state.players[HUMAN];
      const affordable = player.gold >= def.goldCost && player.food >= def.foodCost;
      const btn = document.createElement('button');
      btn.className = 'action-btn';
      btn.disabled = !affordable;
      btn.textContent = `${def.name} — ${def.goldCost}g${def.foodCost ? ` + ${def.foodCost}f` : ''}`;
      btn.addEventListener('click', () => {
        const res = this.state.issueBuild(HUMAN, tile, type as BuildingType);
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

  private renderBuildingInfo() {
    if (!this.selectedBuildingId) return;
    const b = this.state.buildings.get(this.selectedBuildingId);
    if (!b || b.state === 'destroyed') {
      this.closePanel();
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

    if (b.type === 'farm' && b.foodPerTick != null && b.strawPerTick != null) {
      const p = document.createElement('p');
      p.className = 'hint';
      const foodSec = (b.foodTickIntervalMs ?? 5000) / 1000;
      const strawSec = (b.strawTickIntervalMs ?? 5000) / 1000;
      p.textContent = `+${b.foodPerTick} food / ${foodSec}s, +${b.strawPerTick} straw / ${strawSec}s`;
      this.el.panelBody.appendChild(p);
    }

    if (b.type === 'barracks') {
      if (b.training) {
        const p = document.createElement('p');
        p.textContent = `Training ${TROOPS[b.training.troopType].name}… ${Math.ceil(b.training.remainingMs / 1000)}s`;
        this.el.panelBody.appendChild(p);
      } else {
        const def = TROOPS.swordsman;
        const player = this.state.players[HUMAN];
        const affordable = player.gold >= def.goldCost && player.food >= def.foodCost;
        const btn = document.createElement('button');
        btn.className = 'action-btn';
        btn.disabled = !affordable;
        btn.textContent = `Train ${def.name} — ${def.goldCost}g + ${def.foodCost}f`;
        btn.addEventListener('click', () => {
          const res = this.state.issueTrain(HUMAN, b.id, 'swordsman');
          if (!res.ok) this.flashBanner(res.reason ?? 'Failed');
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

  private renderTroopMenu() {
    if (!this.selectedTroopId) return;
    const t = this.state.troops.get(this.selectedTroopId);
    if (!t) {
      this.closePanel();
      return;
    }
    this.openPanel(`${TROOPS[t.type].name} — ${Math.ceil(t.hp)}/${t.maxHp} HP (${orderLabel(t)})`);
    this.el.panelBody.innerHTML = '';

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
      btn.textContent = `Enemy swordsman → ${targetBuilding ? labelName(targetBuilding) : 'unknown'}`;
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

  private renderGameOver() {
    this.el.gameOver.classList.remove('hidden');
    const you = this.state.players[HUMAN];
    const opp = this.state.players[this.state.opponentOf(HUMAN)];
    let text: string;
    if (this.state.gameOverReason === 'castle') {
      text = this.state.winner === HUMAN ? 'Victory! Enemy castle destroyed.' : 'Defeat. Your castle was destroyed.';
    } else if (this.state.winner === 0) {
      text = `Time's up — draw (${you.score.toFixed(2)} – ${opp.score.toFixed(2)})`;
    } else {
      text =
        this.state.winner === HUMAN
          ? `Time's up — you win on points! (${you.score.toFixed(2)} – ${opp.score.toFixed(2)})`
          : `Time's up — you lose on points. (${you.score.toFixed(2)} – ${opp.score.toFixed(2)})`;
    }
    this.el.gameOverText.textContent = text;
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
