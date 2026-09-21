export interface InputHandlers {
  onDodge: (dir: -1 | 1) => void;
  onBlockStart: () => void;
  onBlockEnd: () => void;
  onAttack: () => void;
}

const SWIPE_THRESHOLD_PX = 26;
const HOLD_DELAY_MS = 150;

/**
 * Left half: swipe left/right = dodge, hold-without-swiping = block.
 * Right half: any tap = attack input (combo chaining/timing lives in CombatController).
 */
export class TouchInput {
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private startX = 0;
  private startY = 0;
  private swiped = false;
  private holding = false;
  private activePointerId: number | null = null;
  private readonly handlers: InputHandlers;

  constructor(leftEl: HTMLElement, rightEl: HTMLElement, handlers: InputHandlers) {
    this.handlers = handlers;
    leftEl.addEventListener('pointerdown', this.onLeftDown);
    leftEl.addEventListener('pointermove', this.onLeftMove);
    leftEl.addEventListener('pointerup', this.onLeftUp);
    leftEl.addEventListener('pointercancel', this.onLeftUp);

    rightEl.addEventListener('pointerdown', this.onRightDown);
  }

  private onLeftDown = (e: PointerEvent) => {
    e.preventDefault();
    if (this.activePointerId !== null) return;
    this.activePointerId = e.pointerId;
    this.startX = e.clientX;
    this.startY = e.clientY;
    this.swiped = false;
    this.holding = false;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);

    this.holdTimer = setTimeout(() => {
      if (this.swiped || this.activePointerId !== e.pointerId) return;
      this.holding = true;
      this.handlers.onBlockStart();
    }, HOLD_DELAY_MS);
  };

  private onLeftMove = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointerId || this.swiped) return;
    const dx = e.clientX - this.startX;
    const dy = e.clientY - this.startY;
    if (Math.abs(dx) > SWIPE_THRESHOLD_PX && Math.abs(dx) > Math.abs(dy) * 1.2) {
      this.swiped = true;
      if (this.holdTimer) clearTimeout(this.holdTimer);
      if (this.holding) {
        this.holding = false;
        this.handlers.onBlockEnd();
      }
      this.handlers.onDodge(dx > 0 ? 1 : -1);
    }
  };

  private onLeftUp = (e: PointerEvent) => {
    if (e.pointerId !== this.activePointerId) return;
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    if (this.holding) {
      this.holding = false;
      this.handlers.onBlockEnd();
    }
    this.activePointerId = null;
  };

  private onRightDown = (e: PointerEvent) => {
    e.preventDefault();
    this.handlers.onAttack();
  };
}
