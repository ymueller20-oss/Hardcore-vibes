// Synthese aller Instrumente mit der Web Audio API.
// Jede Funktion bekommt (ctx, out, zeit, velocity, params, ...) und funktioniert
// sowohl mit dem Live-AudioContext als auch mit dem OfflineAudioContext (WAV-Export).

import { midiToFreq } from './theory.js';

const caches = new WeakMap();

function cacheFor(ctx) {
  let c = caches.get(ctx);
  if (!c) {
    c = { curves: new Map(), noise: null };
    caches.set(ctx, c);
  }
  return c;
}

export function noiseBuffer(ctx) {
  const c = cacheFor(ctx);
  if (!c.noise) {
    const len = ctx.sampleRate * 2;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    c.noise = b;
  }
  return c.noise;
}

// tanh-Sättigung; amount 0..1 -> von leicht warm bis brutal geclippt
export function driveCurve(ctx, amount) {
  const c = cacheFor(ctx);
  const key = Math.round(amount * 100);
  if (!c.curves.has(key)) {
    const k = 1 + key * 0.6;
    const n = 2048;
    const curve = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(k * x) / norm;
    }
    c.curves.set(key, curve);
  }
  return c.curves.get(key);
}

function shaper(ctx, amount) {
  const s = ctx.createWaveShaper();
  s.curve = driveCurve(ctx, amount);
  s.oversample = '2x';
  return s;
}

function noiseSource(ctx, t) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  src.loopStart = Math.random() * 1.5;
  return src;
}

// Choke: neue Note schneidet die vorherige Stimme derselben Gruppe ab (Kick, Open Hat, Vocals)
function choke(voices, group, ctx, out, t) {
  if (voices && voices[group]) {
    const g = voices[group];
    try {
      g.gain.setValueAtTime(1, t);
      g.gain.linearRampToValueAtTime(0, t + 0.006);
    } catch (e) { /* bereits abgeschlossen */ }
  }
  const cg = ctx.createGain();
  cg.connect(out);
  if (voices) voices[group] = cg;
  return cg;
}

export function playKick(ctx, out, t, vel, p, voices) {
  const dest = choke(voices, 'kick', ctx, out, t);
  const end = t + p.decay;

  const osc = ctx.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(p.pitch, t);
  osc.frequency.exponentialRampToValueAtTime(p.end, t + p.sweep);
  osc.frequency.exponentialRampToValueAtTime(p.end * 0.85, end);

  // Amplitude VOR der Verzerrung: hoher Drive hält den Tail laut -> typischer Gabber-/Frenchcore-Kick
  const amp = ctx.createGain();
  amp.gain.setValueAtTime(0.0001, t);
  amp.gain.linearRampToValueAtTime(1, t + 0.002);
  amp.gain.exponentialRampToValueAtTime(0.22, t + p.decay * 0.75);
  amp.gain.linearRampToValueAtTime(0, end);

  const pre = ctx.createGain();
  pre.gain.value = 1 + p.drive * 22;
  const sh = shaper(ctx, p.drive);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = p.tone;
  lp.Q.value = 0.9;
  const post = ctx.createGain();
  post.gain.setValueAtTime(vel * 0.85, t);
  post.gain.setValueAtTime(vel * 0.85, end - 0.01);
  post.gain.linearRampToValueAtTime(0, end + 0.01);

  osc.connect(amp).connect(pre).connect(sh).connect(lp).connect(post).connect(dest);
  osc.start(t);
  osc.stop(end + 0.03);

  if (p.click > 0) {
    const n = noiseSource(ctx, t);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const g = ctx.createGain();
    g.gain.setValueAtTime(p.click * vel * 0.7, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    n.connect(hp).connect(g).connect(dest);
    n.start(t);
    n.stop(t + 0.02);
  }
}

export function playSnare(ctx, out, t, vel, p) {
  const sh = shaper(ctx, p.drive);
  const post = ctx.createGain();
  post.gain.value = vel * 0.8;
  sh.connect(post).connect(out);

  const osc = ctx.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(p.tone * 1.7, t);
  osc.frequency.exponentialRampToValueAtTime(p.tone, t + 0.03);
  const og = ctx.createGain();
  og.gain.setValueAtTime(1 - p.snappy * 0.5, t);
  og.gain.exponentialRampToValueAtTime(0.001, t + p.decay * 0.6);
  osc.connect(og).connect(sh);
  osc.start(t);
  osc.stop(t + p.decay);

  const n = noiseSource(ctx, t);
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = 1400;
  const ng = ctx.createGain();
  ng.gain.setValueAtTime(p.snappy, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + p.decay);
  n.connect(hp).connect(ng).connect(sh);
  n.start(t);
  n.stop(t + p.decay + 0.02);
}

export function playClap(ctx, out, t, vel, p) {
  const n = noiseSource(ctx, t);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = p.tone;
  bp.Q.value = 1.4;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, t);
  for (let i = 0; i < 3; i++) {
    const s = t + i * p.spread;
    g.gain.setValueAtTime(vel, s);
    g.gain.exponentialRampToValueAtTime(0.1, s + p.spread * 0.9);
  }
  const tail = t + 3 * p.spread;
  g.gain.setValueAtTime(vel * 0.8, tail);
  g.gain.exponentialRampToValueAtTime(0.001, tail + p.decay);
  n.connect(bp).connect(g).connect(out);
  n.start(t);
  n.stop(tail + p.decay + 0.02);
}

const METAL_RATIOS = [2, 3, 4.16, 5.43, 6.79, 8.21];

function hatVoice(ctx, out, t, vel, p) {
  const hp = ctx.createBiquadFilter();
  hp.type = 'highpass';
  hp.frequency.value = p.tone;
  const g = ctx.createGain();
  g.gain.setValueAtTime(vel, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + p.decay);
  hp.connect(g).connect(out);

  const n = noiseSource(ctx, t);
  const ng = ctx.createGain();
  ng.gain.value = 1 - p.metal * 0.6;
  n.connect(ng).connect(hp);
  n.start(t);
  n.stop(t + p.decay + 0.02);

  if (p.metal > 0.02) {
    const mg = ctx.createGain();
    mg.gain.value = p.metal * 0.35;
    mg.connect(hp);
    for (const r of METAL_RATIOS) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 40 * r * 1.37;
      o.connect(mg);
      o.start(t);
      o.stop(t + p.decay + 0.02);
    }
  }
}

export function playHat(ctx, out, t, vel, p, voices) {
  // Closed Hat würgt die Open Hat ab
  if (voices && voices.openhat) {
    try {
      voices.openhat.gain.setValueAtTime(1, t);
      voices.openhat.gain.linearRampToValueAtTime(0, t + 0.01);
    } catch (e) { /* ignore */ }
    voices.openhat = null;
  }
  hatVoice(ctx, out, t, vel, p);
}

export function playOpenHat(ctx, out, t, vel, p, voices) {
  const dest = choke(voices, 'openhat', ctx, out, t);
  hatVoice(ctx, dest, t, vel, p);
}

export function playBass(ctx, out, t, vel, midi, dur, p) {
  const f = midiToFreq(midi);
  const osc = ctx.createOscillator();
  osc.type = p.wave;
  osc.frequency.value = f;
  const sub = ctx.createOscillator();
  sub.type = 'sine';
  sub.frequency.value = f / 2;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = p.reso;
  const peak = Math.min(18000, p.cutoff + p.env * 5000);
  lp.frequency.setValueAtTime(peak, t);
  lp.frequency.exponentialRampToValueAtTime(Math.max(60, p.cutoff), t + p.decay);

  const amp = ctx.createGain();
  const rel = 0.04;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(vel, t + 0.004);
  amp.gain.setTargetAtTime(vel * 0.55, t + 0.01, p.decay);
  amp.gain.setValueAtTime(vel * 0.55, t + dur);
  amp.gain.linearRampToValueAtTime(0, t + dur + rel);

  const pre = ctx.createGain();
  pre.gain.value = 1 + p.drive * 8;
  const sh = shaper(ctx, p.drive);
  const post = ctx.createGain();
  post.gain.value = 0.6;

  const subG = ctx.createGain();
  subG.gain.value = 0.5;
  osc.connect(lp);
  sub.connect(subG).connect(lp);
  lp.connect(amp).connect(pre).connect(sh).connect(post).connect(out);
  for (const o of [osc, sub]) {
    o.start(t);
    o.stop(t + dur + rel + 0.02);
  }
}

const SUPERSAW = [-1, -0.62, -0.3, 0, 0.3, 0.62, 1];

export function playLead(ctx, out, t, vel, midis, dur, p) {
  const end = t + dur;
  const stopAt = end + p.release + 0.05;

  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.Q.value = p.reso;
  if (p.wave === 'pluck') {
    lp.frequency.setValueAtTime(Math.min(18000, p.cutoff * 2), t);
    lp.frequency.exponentialRampToValueAtTime(Math.max(200, p.cutoff * 0.25), t + 0.25);
  } else {
    lp.frequency.value = p.cutoff;
  }

  const amp = ctx.createGain();
  const sus = p.wave === 'pluck' ? 0.35 : 0.85;
  amp.gain.setValueAtTime(0, t);
  amp.gain.linearRampToValueAtTime(vel, t + p.attack);
  amp.gain.setTargetAtTime(vel * sus, t + p.attack, 0.08);
  amp.gain.setValueAtTime(vel * sus, end);
  amp.gain.setTargetAtTime(0, end, p.release / 4);

  const pre = ctx.createGain();
  pre.gain.value = 1 + p.drive * 6;
  const sh = shaper(ctx, p.drive);
  const post = ctx.createGain();
  lp.connect(amp).connect(pre).connect(sh).connect(post).connect(out);

  // Vibrato-LFO auf die Verstimmung (Cent) aller Oszillatoren
  let lfoGain = null;
  if (p.vibrato > 0.01) {
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 5.6;
    lfoGain = ctx.createGain();
    lfoGain.gain.setValueAtTime(0, t);
    lfoGain.gain.linearRampToValueAtTime(p.vibrato * 45, t + 0.15);
    lfo.connect(lfoGain);
    lfo.start(t);
    lfo.stop(stopAt);
  }

  const oscs = [];
  const addOsc = (type, freq, detune, gain) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    o.detune.value = detune;
    if (lfoGain) lfoGain.connect(o.detune);
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(lp);
    oscs.push(o);
    return o;
  };

  for (const midi of midis) {
    const f = midiToFreq(midi);
    switch (p.wave) {
      case 'supersaw':
        for (const d of SUPERSAW) addOsc('sawtooth', f, d * p.detune, d === 0 ? 0.35 : 0.22);
        break;
      case 'hoover': {
        // Hoover: breite Saws mit Pitch-Bend von unten + Sub-Oktave
        for (const d of [-1, 0, 1]) {
          const o = addOsc('sawtooth', f, d * p.detune, 0.35);
          o.frequency.setValueAtTime(f * 0.7, t);
          o.frequency.exponentialRampToValueAtTime(f, t + 0.09);
        }
        const s = addOsc('square', f / 2, 0, 0.25);
        s.frequency.setValueAtTime(f * 0.35, t);
        s.frequency.exponentialRampToValueAtTime(f / 2, t + 0.09);
        break;
      }
      case 'screech': {
        // FM-Screech: Modulator auf die Frequenz eines Saws
        const car = addOsc('sawtooth', f, 0, 0.5);
        addOsc('square', f * 1.005, p.detune, 0.3);
        const mod = ctx.createOscillator();
        mod.frequency.value = f * 2.01;
        const mg = ctx.createGain();
        mg.gain.setValueAtTime(f * 3, t);
        mg.gain.exponentialRampToValueAtTime(f * 0.8, t + Math.max(0.05, dur));
        mod.connect(mg).connect(car.frequency);
        oscs.push(mod);
        break;
      }
      case 'square':
        addOsc('square', f, -p.detune / 2, 0.4);
        addOsc('square', f, p.detune / 2, 0.4);
        break;
      default: // pluck
        for (const d of [-1, 0, 1]) addOsc('sawtooth', f, d * p.detune, 0.35);
    }
  }
  post.gain.value = 0.7 / Math.sqrt(Math.max(1, oscs.length / 2));
  for (const o of oscs) {
    o.start(t);
    o.stop(stopAt);
  }
}

export function playVocal(ctx, out, t, buffer, p, gateDur, voices) {
  const dest = choke(voices, 'vocal', ctx, out, t);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = Math.pow(2, p.pitch / 12);
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = p.cutoff;
  const pre = ctx.createGain();
  pre.gain.value = 1 + p.drive * 6;
  const sh = shaper(ctx, p.drive);
  const g = ctx.createGain();
  g.gain.value = 0.8;
  src.connect(lp).connect(pre).connect(sh).connect(g).connect(dest);
  src.start(t);
  if (gateDur > 0) {
    g.gain.setValueAtTime(0.8, t + gateDur);
    g.gain.linearRampToValueAtTime(0, t + gateDur + 0.01);
    src.stop(t + gateDur + 0.02);
  }
}
