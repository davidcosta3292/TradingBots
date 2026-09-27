// Small synthesized sounds for office events: no audio files. Off until
// someone turns them on; browsers only allow sound after a click or tap.

const KEY = 'trading-office-sound';
let on = false;
let ctx = null;

try { on = localStorage.getItem(KEY) === '1'; } catch { /* private window */ }

// A remembered "on" still needs one click on the page before sound can play.
document.addEventListener('pointerdown', () => { if (on) wake(); }, { once: true });

function wake() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(freq, start, length, { type = 'sine', gain = 0.1 } = {}) {
  const t0 = ctx.currentTime + start;
  const osc = ctx.createOscillator();
  const volume = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  volume.gain.setValueAtTime(0.0001, t0);
  volume.gain.exponentialRampToValueAtTime(gain, t0 + 0.015);
  volume.gain.exponentialRampToValueAtTime(0.0001, t0 + length);
  osc.connect(volume).connect(ctx.destination);
  osc.start(t0);
  osc.stop(t0 + length + 0.05);
}

const SOUNDS = {
  confirm: () => tone(1320, 0, 0.1, { type: 'triangle', gain: 0.06 }),
  open: () => { tone(660, 0, 0.18); tone(990, 0.12, 0.3); },
  profit: () => { tone(988, 0, 0.09, { type: 'square', gain: 0.04 }); tone(1319, 0.08, 0.4, { type: 'square', gain: 0.04 }); },
  loss: () => { tone(440, 0, 0.22, { type: 'triangle' }); tone(330, 0.18, 0.4, { type: 'triangle' }); },
  alert: () => { tone(880, 0, 0.14, { type: 'sawtooth', gain: 0.04 }); tone(880, 0.22, 0.14, { type: 'sawtooth', gain: 0.04 }); },
};

export function soundOn() {
  return on;
}

export function setSound(next) {
  on = !!next;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* private window */ }
  if (on) {
    wake();
    SOUNDS.confirm();
  }
}

export function play(name) {
  if (!on || !SOUNDS[name]) return;
  wake();
  SOUNDS[name]();
}
