interface Note {
  freq: number;
  start: number;
  dur: number;
}

function getAudioContext(): AudioContext {
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  return new Ctx();
}

/** A buffer of pure white noise, the raw material for anything that should sound like rumble/roar/hiss rather than a tone. */
function whiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
  const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * durationSec)), ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function playNotes(notes: Note[], type: OscillatorType, peakGain: number, closeAfterMs: number) {
  try {
    const ctx = getAudioContext();
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

/** A single flat, monotonous beep for each of the "3, 2, 1" countdown ticks -- deliberately identical every time. */
export function playCountdownTick() {
  playNotes([{ freq: 440, start: 0, dur: 0.16 }], 'sine', 0.22, 350);
}

/** The "BEGIN" tone -- same shape as a countdown tick, just louder and pitched up so it reads as the payoff. */
export function playCountdownGo() {
  playNotes([{ freq: 880, start: 0, dur: 0.3 }], 'sine', 0.4, 550);
}

/**
 * A quick metallic shield-clang for a troop entering Defend -- deliberately
 * audible to both players (not just whoever ordered it), since noticing it
 * is the whole point: an attacker who keeps swinging at a now-doubled
 * defense is about to shred their own troop for nothing.
 */
export function playDefendClang() {
  try {
    const ctx = getAudioContext();
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

/**
 * A single clash of blades -- fired for every discrete swing that lands in
 * troop-vs-troop combat. Slightly randomized pitch per call so a real
 * exchange (several troops swinging on their own independent cooldowns)
 * reads as a scuffle rather than a metronome repeating one identical hit.
 */
export function playSwordClash() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const partials = [1450, 1900, 2600];
    for (const freq of partials) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = freq * (0.94 + Math.random() * 0.12);
      osc.connect(gain);
      gain.connect(ctx.destination);
      const decay = 0.1 + Math.random() * 0.06;
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + decay);
      osc.start(now);
      osc.stop(now + decay + 0.02);
    }
    window.setTimeout(() => ctx.close(), 400);
  } catch {
    // Audio isn't available in every environment -- combat still resolves fine without the cue.
  }
}

/** A few quick hammer knocks -- fired whenever a building begins construction, repair, or a rebuild. */
export function playHammering() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const strikes = 3;
    for (let i = 0; i < strikes; i++) {
      const t0 = now + i * 0.14;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = 300 - i * 20;
      osc.connect(gain);
      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.22, t0);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.09);
      osc.start(t0);
      osc.stop(t0 + 0.1);
    }
    window.setTimeout(() => ctx.close(), 700);
  } catch {
    // Audio isn't available in every environment -- construction still works fine without the cue.
  }
}

/** A descending, lowpass-filtered rumble of noise -- a building coming down. */
export function playCrumble() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const dur = 0.9;
    const noise = ctx.createBufferSource();
    noise.buffer = whiteNoiseBuffer(ctx, dur);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, now);
    filter.frequency.exponentialRampToValueAtTime(150, now + dur);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);
    window.setTimeout(() => ctx.close(), (dur + 0.3) * 1000);
  } catch {
    // Audio isn't available in every environment -- destruction still works fine without the cue.
  }
}

/**
 * A crowd of soldiers cheering -- a soft filtered-noise roar with a handful
 * of short upward "hooray" whoops scattered on top. Meant to layer under
 * `playFanfare()`, not replace it -- the horn is still the actual "you won"
 * cue, this just adds the sense of a settlement celebrating behind it.
 */
export function playVictoryCheer() {
  try {
    const ctx = getAudioContext();
    const now = ctx.currentTime;
    const dur = 1.8;

    const noise = ctx.createBufferSource();
    noise.buffer = whiteNoiseBuffer(ctx, dur);
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 900;
    bandpass.Q.value = 0.6;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0, now);
    noiseGain.gain.linearRampToValueAtTime(0.18, now + 0.3);
    noiseGain.gain.linearRampToValueAtTime(0.1, now + 1.1);
    noiseGain.gain.linearRampToValueAtTime(0, now + dur);
    noise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);

    const shoutCount = 5;
    for (let i = 0; i < shoutCount; i++) {
      const t0 = now + 0.1 + Math.random() * 1.0;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      const startFreq = 260 + Math.random() * 120;
      osc.frequency.setValueAtTime(startFreq, t0);
      osc.frequency.linearRampToValueAtTime(startFreq * 1.6, t0 + 0.25);
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.08, t0 + 0.05);
      gain.gain.linearRampToValueAtTime(0, t0 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    }

    window.setTimeout(() => ctx.close(), (dur + 0.4) * 1000);
  } catch {
    // Audio isn't available in every environment -- victory still works fine without the cue.
  }
}

let ambientCtx: AudioContext | null = null;
let ambientDrone: OscillatorNode | null = null;
let ambientTimer: number | null = null;

/**
 * A soft, generative medieval-flavored background bed: a very quiet low
 * drone plus occasional plucked notes from a minor/dorian scale, scheduled
 * at randomized intervals so it doesn't loop in an obviously mechanical way.
 * Runs for the whole match; `stopAmbientLoop` tears it down. Kept deliberately
 * quiet (peak ~0.08) so it sits behind every other sound cue rather than
 * competing with them.
 */
export function startAmbientLoop() {
  stopAmbientLoop();
  try {
    const ctx = getAudioContext();
    ambientCtx = ctx;
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.09;
    masterGain.connect(ctx.destination);

    const drone = ctx.createOscillator();
    const droneGain = ctx.createGain();
    drone.type = 'sine';
    drone.frequency.value = 98.0; // G2
    droneGain.gain.value = 0.35;
    drone.connect(droneGain);
    droneGain.connect(masterGain);
    drone.start();
    ambientDrone = drone;

    // G dorian-ish, low register -- reads as modal/medieval rather than major/pop.
    const scale = [196.0, 220.0, 233.08, 261.63, 293.66, 329.63, 349.23];

    const scheduleNext = () => {
      if (!ambientCtx) return;
      const base = scale[Math.floor(Math.random() * scale.length)];
      const freq = Math.random() < 0.3 ? base : base / 2;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(masterGain);
      const t0 = ctx.currentTime;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(1, t0 + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, t0 + 2.2);
      osc.start(t0);
      osc.stop(t0 + 2.3);
      ambientTimer = window.setTimeout(scheduleNext, 1800 + Math.random() * 1600);
    };
    scheduleNext();
  } catch {
    // Audio isn't available in every environment -- the match still plays fine in silence.
  }
}

/** Stops and fully tears down the ambient background bed, if one is running. */
export function stopAmbientLoop() {
  if (ambientTimer !== null) {
    window.clearTimeout(ambientTimer);
    ambientTimer = null;
  }
  if (ambientDrone) {
    try {
      ambientDrone.stop();
    } catch {
      // already stopped
    }
    ambientDrone = null;
  }
  if (ambientCtx) {
    void ambientCtx.close();
    ambientCtx = null;
  }
}
