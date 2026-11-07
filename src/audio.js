// Procedural sound — tiny WebAudio synth, zero asset files.
// Everything is a short enveloped oscillator so the whole game stays self-contained.

let ctx = null;
let master = null;
let muted = false;

export function initAudio() {
  if (ctx) { ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.35;
  return muted;
}

export function isMuted() { return muted; }

function blip({ type = 'sine', freq = 440, to = freq, dur = 0.12, gain = 0.5, delay = 0 }) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g); g.connect(master);
  osc.start(t0); osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.15, gain = 0.4 }) {
  if (!ctx || muted) return;
  const t0 = ctx.currentTime;
  const n = Math.floor(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, n, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = ctx.createBufferSource(); src.buffer = buf;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 900;
  src.connect(hp); hp.connect(g); g.connect(master);
  src.start(t0); src.stop(t0 + dur);
}

export const sfx = {
  shoot: () => blip({ type: 'square', freq: 880, to: 220, dur: 0.09, gain: 0.28 }),
  hit:   () => blip({ type: 'triangle', freq: 520, to: 180, dur: 0.1, gain: 0.3 }),
  kill:  () => { blip({ type: 'sawtooth', freq: 300, to: 60, dur: 0.22, gain: 0.3 }); noise({ dur: 0.18, gain: 0.18 }); },
  jump:  () => blip({ type: 'sine', freq: 300, to: 620, dur: 0.14, gain: 0.22 }),
  launch:() => blip({ type: 'sine', freq: 200, to: 900, dur: 0.3, gain: 0.3 }),
  hurt:  () => { blip({ type: 'sawtooth', freq: 160, to: 70, dur: 0.22, gain: 0.32 }); noise({ dur: 0.1, gain: 0.12 }); },
  wave:  () => { blip({ type: 'sine', freq: 440, dur: 0.14, gain: 0.25 }); blip({ type: 'sine', freq: 660, dur: 0.18, gain: 0.25, delay: 0.12 }); },
  over:  () => { blip({ type: 'sawtooth', freq: 300, to: 60, dur: 0.6, gain: 0.3 }); blip({ type: 'sawtooth', freq: 220, to: 40, dur: 0.8, gain: 0.25, delay: 0.1 }); },
  portal:   () => blip({ type: 'sine', freq: 420, to: 1100, dur: 0.18, gain: 0.28 }),
  teleport: () => { blip({ type: 'sine', freq: 900, to: 300, dur: 0.22, gain: 0.3 }); blip({ type: 'triangle', freq: 1400, to: 500, dur: 0.18, gain: 0.18 }); },
  eshoot:   () => blip({ type: 'triangle', freq: 300, to: 160, dur: 0.14, gain: 0.18 }),
  swap:     () => blip({ type: 'square', freq: 500, to: 700, dur: 0.06, gain: 0.16 }),
  blink:    () => blip({ type: 'sine', freq: 700, to: 1200, dur: 0.1, gain: 0.14 }),
  zip:      () => { blip({ type: 'sawtooth', freq: 180, to: 1200, dur: 0.22, gain: 0.26 }); noise({ dur: 0.12, gain: 0.1 }); },
  snipe:    () => { blip({ type: 'square', freq: 320, to: 70, dur: 0.18, gain: 0.34 }); noise({ dur: 0.22, gain: 0.26 }); },
  heal:     () => { blip({ type: 'sine', freq: 660, to: 990, dur: 0.14, gain: 0.26 }); blip({ type: 'sine', freq: 990, to: 1320, dur: 0.16, gain: 0.22, delay: 0.1 }); },
  slice:    () => { noise({ dur: 0.16, gain: 0.2 }); blip({ type: 'triangle', freq: 1950, to: 480, dur: 0.13, gain: 0.14 }); blip({ type: 'sine', freq: 2900, to: 1000, dur: 0.1, gain: 0.07, delay: 0.02 }); },
  gat:      () => blip({ type: 'square', freq: 210, to: 120, dur: 0.045, gain: 0.12 }),
  missile:  () => { blip({ type: 'sawtooth', freq: 300, to: 900, dur: 0.26, gain: 0.2 }); noise({ dur: 0.14, gain: 0.12 }); },
  lock:     () => blip({ type: 'sine', freq: 1500, dur: 0.04, gain: 0.08 }),
  locked:   () => { blip({ type: 'square', freq: 1200, dur: 0.05, gain: 0.12 }); blip({ type: 'square', freq: 1600, dur: 0.06, gain: 0.12, delay: 0.05 }); },
};
