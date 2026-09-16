import type Phaser from 'phaser';
import { MAP_COLS } from '../game/mapGen';
import type { GameState } from '../game/GameState';
import type { MainScene } from '../scenes/MainScene';
import { playFanfare } from './sound';

const FADE_MS = 600;
const TIMER_FLY_MS = 900;
const COUNTDOWN_STEP_MS = 2000;
const DARKEN_MS = 700;
const SCORE_COUNT_MS = 1800;
const FLASH_WINDOW_MS = 10000;

export interface MatchHandles {
  game: Phaser.Game;
  state: GameState;
  scene: MainScene;
  /** Cleans up anything `destroyMatch`'s `game.destroy()` can't reach itself (e.g. window-level listeners). */
  dispose?: () => void;
}

export interface GameFlowOptions {
  createMatch: () => MatchHandles;
  destroyMatch: (handles: MatchHandles) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`Missing #${id}`);
  return found as T;
}

/** Eases 0..1 the same shape for every count-up, win or lose. */
function animateCountUp(target: HTMLElement, finalValue: number, durationMs: number): Promise<void> {
  return new Promise((resolve) => {
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - (1 - t) * (1 - t);
      target.textContent = (finalValue * eased).toFixed(2);
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        target.textContent = finalValue.toFixed(2);
        resolve();
      }
    };
    requestAnimationFrame(step);
  });
}

/**
 * Owns everything outside the moment-to-moment match sim: the title screen,
 * the start/countdown intro, and the end-of-match victory sequence. A
 * "match" (GameState + Phaser instance) is created and torn down each time
 * through, so replaying doesn't leak the previous game's state.
 */
export class GameFlow {
  private current: MatchHandles | null = null;
  private endSequenceStarted = false;

  private titleScreen = el('title-screen');
  private startBtn = el<HTMLButtonElement>('title-start');
  private fadeOverlay = el('fade-overlay');
  private countdownTimerFly = el('countdown-timer-fly');
  private countdownWord = el('countdown-word');
  private victoryOverlay = el('victory-overlay');
  private victoryLeft = el('victory-num-left');
  private victoryRight = el('victory-num-right');
  private victoryText = el('victory-text');
  private victoryExit = el<HTMLButtonElement>('victory-exit');
  private opts: GameFlowOptions;

  constructor(opts: GameFlowOptions) {
    this.opts = opts;
    document.body.classList.add('title-screen');
    this.startBtn.addEventListener('click', () => void this.beginMatch());
    this.victoryExit.addEventListener('click', () => void this.exitToTitle());
  }

  /** Called once per animation frame by the active match's scene. */
  onTick() {
    if (!this.current || this.endSequenceStarted) return;
    if (this.current.state.gameOver) {
      this.endSequenceStarted = true;
      void this.runEndSequence(this.current.state);
    }
  }

  private async beginMatch() {
    this.fadeOverlay.classList.add('visible');
    await sleep(FADE_MS);

    this.titleScreen.classList.add('hidden');
    document.body.classList.remove('title-screen');

    const handles = this.opts.createMatch();
    this.current = handles;
    this.endSequenceStarted = false;
    await new Promise<void>((resolve) => {
      if (handles.game.isBooted) resolve();
      else handles.game.events.once('ready', () => resolve());
    });

    document.body.classList.add('match-active');
    this.fadeOverlay.classList.remove('visible');
    await sleep(FADE_MS);

    await this.runCountdown();
    handles.scene.setFrozen(false);
  }

  private async runCountdown() {
    const hudTimer = document.getElementById('hud-timer');

    this.countdownTimerFly.textContent = '05:00';
    this.countdownTimerFly.style.removeProperty('--dx');
    this.countdownTimerFly.style.removeProperty('--dy');
    this.countdownTimerFly.style.removeProperty('--scale');
    this.countdownTimerFly.classList.add('show-center');
    await sleep(400);

    if (hudTimer) {
      const hudRect = hudTimer.getBoundingClientRect();
      const flyRect = this.countdownTimerFly.getBoundingClientRect();
      const dx = hudRect.left + hudRect.width / 2 - (flyRect.left + flyRect.width / 2);
      const dy = hudRect.top + hudRect.height / 2 - (flyRect.top + flyRect.height / 2);
      const scale = flyRect.height > 0 ? hudRect.height / flyRect.height : 0.3;
      this.countdownTimerFly.style.setProperty('--dx', `${dx}px`);
      this.countdownTimerFly.style.setProperty('--dy', `${dy}px`);
      this.countdownTimerFly.style.setProperty('--scale', scale.toString());
    }
    this.countdownTimerFly.classList.add('fly');
    await sleep(TIMER_FLY_MS);
    this.countdownTimerFly.classList.remove('show-center', 'fly');

    for (const word of ['3', '2', '1', 'BEGIN']) {
      await this.playCountdownWord(word);
    }
  }

  private playCountdownWord(text: string): Promise<void> {
    return new Promise((resolve) => {
      this.countdownWord.textContent = text;
      this.countdownWord.classList.remove('grow-shrink');
      void this.countdownWord.offsetWidth; // force reflow so the animation restarts
      this.countdownWord.classList.add('grow-shrink');
      window.setTimeout(() => {
        this.countdownWord.classList.remove('grow-shrink');
        this.countdownWord.textContent = '';
        resolve();
      }, COUNTDOWN_STEP_MS);
    });
  }

  private async runEndSequence(state: GameState) {
    document.body.classList.add('darken', 'hud-hidden');
    await sleep(DARKEN_MS);

    const castle = state.buildings.get(state.players[1].castleId);
    const humanOnLeft = !castle || castle.tile.col < MAP_COLS / 2;
    const [leftEl, rightEl] = [this.victoryLeft, this.victoryRight];
    const leftPlayerId = humanOnLeft ? 1 : 2;
    const rightPlayerId = humanOnLeft ? 2 : 1;

    leftEl.className = `victory-num ${leftPlayerId === 1 ? 'blue' : 'red'}`;
    rightEl.className = `victory-num ${rightPlayerId === 1 ? 'blue' : 'red'}`;
    leftEl.textContent = '0';
    rightEl.textContent = '0';
    this.victoryText.textContent = '';
    this.victoryText.className = '';
    this.victoryExit.classList.remove('exit-visible');
    this.victoryOverlay.classList.add('visible');

    await Promise.all([
      animateCountUp(leftEl, state.players[leftPlayerId].score, SCORE_COUNT_MS),
      animateCountUp(rightEl, state.players[rightPlayerId].score, SCORE_COUNT_MS),
    ]);

    if (state.winner === 0 || state.winner === null) {
      this.victoryText.textContent = 'THE BATTLE ENDS IN A DRAW!';
    } else {
      const winnerEl = state.winner === leftPlayerId ? leftEl : rightEl;
      winnerEl.classList.add('gold');
      playFanfare();
      const sideWord = state.winner === 1 ? 'BLUE' : 'RED';
      this.victoryText.textContent = `${sideWord} SETTLEMENT HAS WON THE GAME!`;
      this.victoryText.classList.add(state.winner === 1 ? 'blue' : 'red');
    }
    this.victoryExit.classList.add('exit-visible');
  }

  private async exitToTitle() {
    this.fadeOverlay.classList.add('visible');
    await sleep(FADE_MS);

    this.victoryOverlay.classList.remove('visible');
    document.body.classList.remove('darken', 'hud-hidden', 'match-active');

    if (this.current) {
      this.opts.destroyMatch(this.current);
      this.current = null;
    }

    this.titleScreen.classList.remove('hidden');
    document.body.classList.add('title-screen');
    await sleep(400);

    this.fadeOverlay.classList.remove('visible');
    await sleep(FADE_MS);
  }
}

/** Whether the match clock should be flashing red/white -- last 10s, still running. */
export function shouldFlashTimer(remainingMs: number, gameOver: boolean): boolean {
  return !gameOver && remainingMs > 0 && remainingMs <= FLASH_WINDOW_MS;
}
