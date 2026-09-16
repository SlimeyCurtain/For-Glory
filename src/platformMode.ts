export type DisplayMode = 'mobile' | 'desktop';

const STORAGE_KEY = 'settlementClash.displayMode';

function loadStoredMode(): DisplayMode | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === 'mobile' || v === 'desktop' ? v : null;
  } catch {
    return null; // private browsing / storage disabled -- fall back to detection
  }
}

function saveMode(mode: DisplayMode) {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // nothing we can do; the choice just won't persist across reloads
  }
}

/** A coarse (touch) primary pointer is the standard signal for "this is a phone/tablet, not a mouse-driven desktop." */
function detectIsMobile(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

export function detectInitialMode(): DisplayMode {
  return loadStoredMode() ?? (detectIsMobile() ? 'mobile' : 'desktop');
}

/** Sets the body class and button label for `mode`. Safe to call before the button/game exist. */
export function applyDisplayMode(mode: DisplayMode) {
  document.body.classList.toggle('mobile-mode', mode === 'mobile');
  document.body.classList.toggle('desktop-mode', mode === 'desktop');
  const button = document.getElementById('platform-toggle');
  if (button) button.textContent = mode === 'mobile' ? 'Desktop' : 'Mobile';
}

/** Wires the corner button to flip modes. `onChange` runs after the new mode's CSS is applied. */
export function onDisplayModeToggle(initial: DisplayMode, onChange: (mode: DisplayMode) => void) {
  let current = initial;
  const button = document.getElementById('platform-toggle');
  button?.addEventListener('click', () => {
    current = current === 'mobile' ? 'desktop' : 'mobile';
    saveMode(current);
    applyDisplayMode(current);
    onChange(current);
  });
}
