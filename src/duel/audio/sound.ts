import type { FighterKind } from '../entities/Fighter';

let sharedCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  try {
    if (!sharedCtx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      sharedCtx = new Ctx();
    }
    return sharedCtx;
  } catch {
    return null; // Audio isn't available in every environment (headless test runs, etc).
  }
}

/**
 * Must be called from inside a real user-gesture handler (the Start Duel
 * tap) -- browsers refuse to start an AudioContext before one fires. Combat
 * fires many short sounds in quick succession, so unlike the RTS's
 * one-context-per-cue approach, the duel keeps a single shared context alive
 * for the whole match instead of paying context-creation latency on every
 * swing.
 */
export function unlockAudio() {
  const ctx = getCtx();
  if (ctx && ctx.state === 'suspended') void ctx.resume();
}

function noiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * durationSec)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

/** A fast, pitch-falling bandpassed noise burst -- a blade cutting empty air. Fired when a dodge evades an attack entirely. */
export function playSwoosh() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const dur = 0.24;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, dur);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.Q.value = 0.9;
    bandpass.frequency.setValueAtTime(2800, now);
    bandpass.frequency.exponentialRampToValueAtTime(450, now + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.32, now + 0.025);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(bandpass);
    bandpass.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur + 0.02);
  } catch {
    // ignore
  }
}

/** A dull wooden thud plus a short knock -- a blade caught on the goblin's round shield. */
export function playShieldBlock() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const dur = 0.17;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, dur);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 650;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.45, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(lowpass);
    lowpass.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur + 0.02);

    for (const freq of [380, 610]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.13, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.1);
    }
  } catch {
    // ignore
  }
}

/** A sharp metallic clang -- the knight's sword catching an incoming blade on its own. */
export function playSwordBlock() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const partials = [1500, 2000, 2650, 3400];
    for (const freq of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq * (0.97 + Math.random() * 0.06);
      const decay = 0.18 + Math.random() * 0.08;
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + decay + 0.02);
    }
  } catch {
    // ignore
  }
}

/** A heavy, muffled thwack -- a clean unblocked hit landing. */
export function playFleshHit() {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const dur = 0.22;
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, dur);
    const lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(2400, now);
    lowpass.frequency.exponentialRampToValueAtTime(220, now + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.5, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur + 0.02);

    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = 'sine';
    thump.frequency.setValueAtTime(150, now);
    thump.frequency.exponentialRampToValueAtTime(55, now + 0.16);
    thumpGain.gain.setValueAtTime(0.4, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    thump.connect(thumpGain);
    thumpGain.connect(ctx.destination);
    thump.start(now);
    thump.stop(now + 0.2);
  } catch {
    // ignore
  }
}

export type GruntVariant = 'effort' | 'pain' | 'death';

/**
 * A short vocal-ish grunt/groan: a pitch-dropping sawtooth (the "voiced"
 * part) layered under bandpassed noise (the "breath"), synthesized rather
 * than recorded since there's no audio asset pipeline here. `kind` sets the
 * register -- the knight sits low and gruff, the goblin higher and rougher
 * with more noise mixed in -- and `variant` sets the shape: a quick "hup" on
 * swinging, a sharper "ugh" on taking a clean hit, or a long low collapse on
 * death.
 */
export function playGrunt(kind: FighterKind, variant: GruntVariant) {
  const ctx = getCtx();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const basePitch = (kind === 'knight' ? 128 : 195) * (0.92 + Math.random() * 0.16);

    let dur: number;
    let pitchDropRatio: number;
    let noiseMix: number;
    let peak: number;
    if (variant === 'effort') {
      dur = 0.16;
      pitchDropRatio = 0.8;
      noiseMix = 0.3;
      peak = 0.16;
    } else if (variant === 'pain') {
      dur = 0.3;
      pitchDropRatio = 0.55;
      noiseMix = 0.42;
      peak = 0.26;
    } else {
      dur = 0.9;
      pitchDropRatio = 0.4;
      noiseMix = 0.48;
      peak = 0.24;
    }

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(basePitch, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(35, basePitch * pitchDropRatio), now + dur);
    const oscFilter = ctx.createBiquadFilter();
    oscFilter.type = 'lowpass';
    oscFilter.frequency.value = kind === 'knight' ? 900 : 1350;
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(0, now);
    oscGain.gain.linearRampToValueAtTime(peak * (1 - noiseMix), now + 0.03);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    osc.connect(oscFilter);
    oscFilter.connect(oscGain);
    oscGain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);

    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx, dur);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = kind === 'knight' ? 550 : 850;
    bandpass.Q.value = 0.8;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(peak * noiseMix, now + 0.03);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur + 0.02);
  } catch {
    // ignore
  }
}
