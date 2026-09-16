import Phaser from 'phaser';
import { GameState } from './game/GameState';
import { AIController } from './game/AIController';
import { MainScene, MARGIN } from './scenes/MainScene';
import { UIController } from './ui/UIController';
import { GameFlow } from './ui/GameFlow';
import type { MatchHandles } from './ui/GameFlow';
import { MAP_COLS, MAP_ROWS } from './game/mapGen';
import { HEX_SIZE, offsetToPixel } from './game/hex';
import { applyDisplayMode, detectInitialMode, onDisplayModeToggle } from './platformMode';

// Apply the mobile/desktop body class before Phaser ever measures
// #game-container, so the very first frame is already sized correctly.
const initialDisplayMode = detectInitialMode();
applyDisplayMode(initialDisplayMode);

const uiRoot = document.getElementById('ui-root')!;

const width = Math.ceil(HEX_SIZE * Math.sqrt(3) * (MAP_COLS - 1) + MARGIN * 2 + HEX_SIZE);
const height = Math.ceil(HEX_SIZE * 1.5 * (MAP_ROWS - 1) + MARGIN * 2 + HEX_SIZE);

/** Re-bound each time a match is (re)created, so the platform toggle always resizes the live match. */
let activeSyncFn: (() => void) | null = null;
let activeGame: Phaser.Game | null = null;

function createMatch(): MatchHandles {
  uiRoot.innerHTML = '';

  const state = new GameState();
  const ai = new AIController(state, 2);

  let ui!: UIController;
  const scene = new MainScene(state, ai, {
    onTileClick: (tile) => ui.onTileClick(tile),
    onBuildingClick: (b) => ui.onBuildingClick(b),
    onTroopClick: (t) => ui.onTroopClick(t),
    onTick: () => {
      ui.onTick();
      gameFlow.onTick();
    },
  });
  ui = new UIController(state, uiRoot, scene);

  const game = new Phaser.Game({
    type: Phaser.AUTO,
    width,
    height,
    backgroundColor: '#14181f',
    parent: 'game-container',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    input: {
      activePointers: 2,
    },
    scene: [scene],
  });

  // Phaser's FIT mode scales/letterboxes the canvas to the viewport while
  // keeping its aspect ratio -- it is never stretched to a monitor's ratio.
  // The DOM UI has to track that same rect and scale factor exactly, or the
  // HUD/panels would drift away from the canvas whenever it's letterboxed.
  function syncUiRootToCanvas() {
    const rect = game.canvas.getBoundingClientRect();
    const scale = rect.width / width;
    uiRoot.style.left = `${rect.left}px`;
    uiRoot.style.top = `${rect.top}px`;
    uiRoot.style.width = `${width}px`;
    uiRoot.style.height = `${height}px`;
    uiRoot.style.transform = `scale(${scale})`;
    uiRoot.style.transformOrigin = 'top left';
  }
  game.events.once(Phaser.Core.Events.READY, syncUiRootToCanvas);
  game.scale.on(Phaser.Scale.Events.RESIZE, syncUiRootToCanvas);
  const onWindowResize = () => syncUiRootToCanvas();
  const onOrientationChange = () => window.setTimeout(syncUiRootToCanvas, 50);
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('orientationchange', onOrientationChange);

  activeSyncFn = syncUiRootToCanvas;
  activeGame = game;

  if (import.meta.env.DEV) {
    (window as unknown as { __state: GameState }).__state = state;
    (window as unknown as { __debug: unknown }).__debug = { offsetToPixel, MARGIN, gameWidth: width, gameHeight: height };
  }

  return {
    game,
    state,
    scene,
    dispose: () => {
      window.removeEventListener('resize', onWindowResize);
      window.removeEventListener('orientationchange', onOrientationChange);
    },
  };
}

function destroyMatch(handles: MatchHandles) {
  handles.dispose?.();
  activeSyncFn = null;
  activeGame = null;
  handles.game.destroy(true);
  uiRoot.innerHTML = '';
}

const gameFlow = new GameFlow({ createMatch, destroyMatch });

onDisplayModeToggle(initialDisplayMode, () => {
  // The mode switch just changed #game-container's CSS size, but that alone
  // doesn't reliably make Phaser re-measure its parent -- dispatching a
  // resize event drives it through the same path a real window resize
  // already uses. Deferred a frame so the new layout has actually painted
  // before anything measures it. A no-op while no match is active (title screen).
  requestAnimationFrame(() => {
    window.dispatchEvent(new Event('resize'));
    activeGame?.scale.refresh();
    activeSyncFn?.();
  });
});
