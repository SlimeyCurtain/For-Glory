import Phaser from 'phaser';
import { GameState } from './game/GameState';
import { AIController } from './game/AIController';
import { MainScene, MARGIN } from './scenes/MainScene';
import { UIController } from './ui/UIController';
import { MAP_COLS, MAP_ROWS } from './game/mapGen';
import { HEX_SIZE, offsetToPixel } from './game/hex';

const state = new GameState();
const ai = new AIController(state, 2);

const uiRoot = document.getElementById('ui-root')!;

const width = Math.ceil(HEX_SIZE * Math.sqrt(3) * (MAP_COLS - 1) + MARGIN * 2 + HEX_SIZE);
const height = Math.ceil(HEX_SIZE * 1.5 * (MAP_ROWS - 1) + MARGIN * 2 + HEX_SIZE);

// scene and UI reference each other (scene forwards input to the UI, the UI
// draws path previews back onto the scene), so wire the scene's callbacks to
// a forward reference and assign `ui` once both exist.
let ui!: UIController;
const scene = new MainScene(state, ai, {
  onTileClick: (tile) => ui.onTileClick(tile),
  onBuildingClick: (b) => ui.onBuildingClick(b),
  onTroopClick: (t) => ui.onTroopClick(t),
  onTick: () => ui.onTick(),
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
window.addEventListener('resize', syncUiRootToCanvas);
window.addEventListener('orientationchange', () => window.setTimeout(syncUiRootToCanvas, 50));

if (import.meta.env.DEV) {
  (window as unknown as { __state: GameState }).__state = state;
  (window as unknown as { __debug: unknown }).__debug = { offsetToPixel, MARGIN, gameWidth: width, gameHeight: height };
}
