import { Arena, ENEMY_HUB, PLAYER_HUB } from './scene/Arena';
import { Fighter, type FighterKind } from './entities/Fighter';
import { CombatController } from './combat/CombatController';
import { TouchInput } from './input/TouchInput';
import { AIController } from './ai/AIController';
import { playFleshHit, playGrunt, playShieldBlock, playSwoosh, playSwordBlock, unlockAudio } from './audio/sound';

const canvas = document.getElementById('duel-canvas') as HTMLCanvasElement;
const arena = new Arena(canvas);

const playerFighter = new Fighter('knight');
playerFighter.group.position.copy(PLAYER_HUB);
playerFighter.group.rotation.y = 0; // faces -Z, into the arena
arena.scene.add(playerFighter.group);

const enemyFighter = new Fighter('goblin');
enemyFighter.group.position.copy(ENEMY_HUB);
enemyFighter.group.rotation.y = Math.PI; // faces +Z, back toward the player
arena.scene.add(enemyFighter.group);

const hpPlayerEl = document.getElementById('duel-hp-player') as HTMLElement;
const hpEnemyEl = document.getElementById('duel-hp-enemy') as HTMLElement;
const comboIndicatorEl = document.getElementById('duel-combo-indicator') as HTMLElement;
const hintEl = document.getElementById('duel-controls-hint') as HTMLElement;
const endOverlayEl = document.getElementById('duel-end-overlay') as HTMLElement;
const endTextEl = document.getElementById('duel-end-text') as HTMLElement;
const endRestartBtn = document.getElementById('duel-end-restart') as HTMLButtonElement;
const titleScreenEl = document.getElementById('duel-title-screen') as HTMLElement;
const titleStartBtn = document.getElementById('duel-title-start') as HTMLButtonElement;
const touchLeftEl = document.getElementById('duel-touch-left') as HTMLElement;
const touchRightEl = document.getElementById('duel-touch-right') as HTMLElement;

for (let i = 0; i < 4; i++) {
  const pip = document.createElement('div');
  pip.className = 'duel-combo-pip';
  comboIndicatorEl.appendChild(pip);
}
const pips = Array.from(comboIndicatorEl.querySelectorAll<HTMLElement>('.duel-combo-pip'));

let playerCombat!: CombatController;
let enemyCombat!: CombatController;
let matchOver = false;
let running = false;
let aiEnabled = true;
const ai = new AIController();

function updateHpBar(el: HTMLElement, hp: number, maxHp: number) {
  el.style.width = `${Math.max(0, (hp / maxHp) * 100)}%`;
}

function showEnd(playerWon: boolean) {
  matchOver = true;
  endTextEl.textContent = playerWon ? 'Victory' : 'Defeat';
  endTextEl.className = playerWon ? 'win' : 'lose';
  window.setTimeout(() => endOverlayEl.classList.add('visible'), 750);
}

/** Shared sound wiring for either fighter -- only the HP-bar/win-loss callbacks differ per side. */
function soundEvents(kind: FighterKind) {
  return {
    onAttackStart: () => playGrunt(kind, 'effort'),
    onEvade: () => playSwoosh(),
    onHit: (_final: number, wasBlocked: boolean) => {
      if (wasBlocked) {
        // The block sound reflects what *this* fighter (the defender) is
        // carrying -- the goblin's round shield vs. the knight's own blade.
        if (kind === 'goblin') playShieldBlock();
        else playSwordBlock();
      } else {
        playFleshHit();
        playGrunt(kind, 'pain');
      }
    },
  };
}

function buildControllers() {
  playerCombat = new CombatController(playerFighter, {
    ...soundEvents('knight'),
    onHpChange: (hp, max) => updateHpBar(hpPlayerEl, hp, max),
    onDeath: () => {
      playGrunt('knight', 'death');
      showEnd(false);
    },
  });
  enemyCombat = new CombatController(enemyFighter, {
    ...soundEvents('goblin'),
    onHpChange: (hp, max) => updateHpBar(hpEnemyEl, hp, max),
    onDeath: () => {
      playGrunt('goblin', 'death');
      showEnd(true);
    },
  });
  playerCombat.opponent = enemyCombat;
  enemyCombat.opponent = playerCombat;
}

function resetMatch() {
  playerFighter.group.rotation.set(0, 0, 0);
  playerFighter.group.position.copy(PLAYER_HUB);
  enemyFighter.group.rotation.set(0, Math.PI, 0);
  enemyFighter.group.position.copy(ENEMY_HUB);
  buildControllers();
  updateHpBar(hpPlayerEl, 100, 100);
  updateHpBar(hpEnemyEl, 100, 100);
  matchOver = false;
  endOverlayEl.classList.remove('visible');
  hintEl.classList.remove('faded');
  window.setTimeout(() => hintEl.classList.add('faded'), 100);
}

buildControllers();

new TouchInput(touchLeftEl, touchRightEl, {
  onDodge: (dir) => {
    if (matchOver) return;
    playerCombat.dodgeInput(dir);
  },
  onBlockStart: () => {
    if (matchOver) return;
    playerCombat.setBlocking(true);
  },
  onBlockEnd: () => {
    playerCombat.setBlocking(false);
  },
  onAttack: () => {
    if (matchOver) return;
    playerCombat.attackInput();
  },
});

function updateComboPips() {
  const step = playerCombat.state === 'attacking' || playerCombat.state === 'comboWait' ? playerCombat.comboStep : 0;
  pips.forEach((pip, i) => pip.classList.toggle('lit', i < step));
}

let lastTime = performance.now();
function frame(now: number) {
  const dt = Math.min((now - lastTime) / 1000, 1 / 20);
  lastTime = now;

  if (running) {
    playerCombat.update(dt);
    enemyCombat.update(dt);
    if (aiEnabled) ai.update(dt, playerCombat, enemyCombat);

    playerFighter.group.position.x = PLAYER_HUB.x + playerCombat.laneOffset;
    enemyFighter.group.position.x = ENEMY_HUB.x + enemyCombat.laneOffset;

    updateComboPips();
    arena.updateCamera(playerFighter.group.position.x, dt);
  }

  arena.render();
  requestAnimationFrame(frame);
}

titleStartBtn.addEventListener('click', () => {
  unlockAudio(); // must happen inside this user-gesture handler or the browser blocks audio entirely
  titleScreenEl.classList.add('hidden');
  running = true;
  window.setTimeout(() => hintEl.classList.add('faded'), 2600);
});

endRestartBtn.addEventListener('click', () => {
  resetMatch();
});

requestAnimationFrame((t) => {
  lastTime = t;
  requestAnimationFrame(frame);
});

if (import.meta.env.DEV) {
  (window as unknown as { __duel: unknown }).__duel = {
    get player() {
      return playerCombat;
    },
    get enemy() {
      return enemyCombat;
    },
    setAiEnabled: (v: boolean) => {
      aiEnabled = v;
    },
    setRunning: (v: boolean) => {
      running = v;
    },
  };
}
