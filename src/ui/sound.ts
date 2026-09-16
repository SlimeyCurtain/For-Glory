/** A short triumphant fanfare, synthesized with Web Audio so the game doesn't need to ship an audio asset. */
export function playFanfare() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const now = ctx.currentTime;
    const notes: { freq: number; start: number; dur: number }[] = [
      { freq: 523.25, start: 0, dur: 0.16 }, // C5
      { freq: 659.25, start: 0.16, dur: 0.16 }, // E5
      { freq: 783.99, start: 0.32, dur: 0.16 }, // G5
      { freq: 1046.5, start: 0.48, dur: 0.55 }, // C6, held
    ];
    for (const note of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = note.freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const t0 = now + note.start;
      const t1 = t0 + note.dur;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.35, t0 + 0.02);
      gain.gain.linearRampToValueAtTime(0, t1);
      osc.start(t0);
      osc.stop(t1 + 0.02);
    }
    window.setTimeout(() => ctx.close(), 1400);
  } catch {
    // Audio isn't available in every environment (autoplay policies, headless
    // test runs) -- the victory sequence still works fine without sound.
  }
}
