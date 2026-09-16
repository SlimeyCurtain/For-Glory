interface Note {
  freq: number;
  start: number;
  dur: number;
}

function playNotes(notes: Note[], type: OscillatorType, peakGain: number, closeAfterMs: number) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.value = note.freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = now + note.start;
      const t1 = t0 + note.dur;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(peakGain, t0 + 0.05);
      gain.gain.linearRampToValueAtTime(0, t1);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    }
    window.setTimeout(() => ctx.close(), closeAfterMs);
  } catch {
    // Audio isn't available in every environment (autoplay policies, headless
    // test runs) -- the victory sequence still works fine without sound.
  }
}

/** A short triumphant fanfare for a win, synthesized with Web Audio so the game doesn't need to ship an audio asset. */
export function playFanfare() {
  playNotes(
    [
      { freq: 523.25, start: 0, dur: 0.16 }, // C5
      { freq: 659.25, start: 0.16, dur: 0.16 }, // E5
      { freq: 783.99, start: 0.32, dur: 0.16 }, // G5
      { freq: 1046.5, start: 0.48, dur: 0.55 }, // C6, held
    ],
    'triangle',
    0.35,
    1400
  );
}

/** A low, mournful descending horn call for a loss -- the same medieval-horn register as the fanfare, just minor and sinking instead of major and rising. */
export function playDefeatHorn() {
  playNotes(
    [
      { freq: 196.0, start: 0, dur: 0.42 }, // G3
      { freq: 174.61, start: 0.38, dur: 0.42 }, // F3
      { freq: 155.56, start: 0.76, dur: 0.42 }, // Eb3
      { freq: 130.81, start: 1.14, dur: 1.3 }, // C3, held low and mournful
    ],
    'sawtooth',
    0.28,
    2800
  );
}

/**
 * A quick metallic shield-clang for a troop entering Defend -- deliberately
 * audible to both players (not just whoever ordered it), since noticing it
 * is the whole point: an attacker who keeps swinging at a now-doubled
 * defense is about to shred their own troop for nothing.
 */
export function playDefendClang() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    // A handful of close, inharmonic high partials struck at once and left
    // to ring out reads as "metal", where a single clean tone would just
    // sound like a beep.
    const partials = [1180, 1390, 1660, 2350];
    for (const freq of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.16, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
      osc.start(now);
      osc.stop(now + 0.36);
    }
    window.setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio isn't available in every environment -- Defend still works fine without the cue.
  }
}
