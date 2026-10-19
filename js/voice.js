// Robo-Voice: kleiner Formant-Synthesizer, der Text in eine Hardcore-MC-artige
// Roboterstimme verwandelt (offline gerendert in einen AudioBuffer).
// Dazu: Mikrofon-Aufnahme und Datei-Import für echte Vocals.

import { noiseBuffer, driveCurve } from './instruments.js';

const VOWELS = {
  a: [800, 1200, 2600], e: [450, 1900, 2600], i: [300, 2300, 3000], o: [480, 850, 2600],
  u: [330, 750, 2400], y: [300, 1900, 2500], 'ä': [650, 1700, 2500], 'ö': [420, 1500, 2400], 'ü': [300, 1700, 2300],
};
const VOICED = {
  m: [280, 1000, 2300], n: [280, 1500, 2500], l: [360, 1300, 2700], r: [450, 1200, 1700],
  w: [300, 700, 2300], j: [300, 2200, 3000], v: [300, 1300, 2400],
};
const FRICATIVE = { s: 6500, z: 5500, f: 3500, h: 1600, c: 4500, x: 4500, sch: 2800, sh: 2800, ch: 3600, 'ß': 6500 };
const PLOSIVE = { t: 4200, k: 2200, p: 900, d: 3600, g: 1900, b: 700, q: 2200, ck: 2200 };

export const VOICE_STYLES = {
  shout: { name: 'MC Shout', wave: 'sawtooth', base: 52, speed: 1, contour: 4, drive: 0.55, double: false },
  robot: { name: 'Roboter', wave: 'square', base: 48, speed: 0.9, contour: 0, drive: 0.35, double: false },
  deep: { name: 'Dämon (tief)', wave: 'sawtooth', base: 38, speed: 0.75, contour: 2, drive: 0.6, double: true },
  hype: { name: 'Hype (hoch & schnell)', wave: 'sawtooth', base: 62, speed: 1.35, contour: 5, drive: 0.4, double: false },
};

function tokenize(text) {
  const s = text.toLowerCase();
  const out = [];
  let wordStart = true;
  const push = (tok) => {
    if (tok.kind === 'gap') wordStart = true;
    else { tok.wordStart = wordStart; wordStart = false; }
    out.push(tok);
  };
  let i = 0;
  while (i < s.length) {
    const tri = s.slice(i, i + 3);
    const di = s.slice(i, i + 2);
    const ch = s[i];
    if (tri === 'sch') { push({ kind: 'fric', f: FRICATIVE.sch }); i += 3; }
    else if (di === 'sh' || di === 'ch') { push({ kind: 'fric', f: FRICATIVE[di] }); i += 2; }
    else if (di === 'ck') { push({ kind: 'plos', f: PLOSIVE.ck }); i += 2; }
    else if (di === 'ei' || di === 'ai') { push({ kind: 'vowel', f: VOWELS.a }); push({ kind: 'vowel', f: VOWELS.i, glide: true }); i += 2; }
    else if (di === 'ee' || di === 'ie') { push({ kind: 'vowel', f: VOWELS.i, long: true }); i += 2; }
    else if (di === 'oo' || di === 'ou') { push({ kind: 'vowel', f: VOWELS.u, long: true }); i += 2; }
    else if (VOWELS[ch]) { push({ kind: 'vowel', f: VOWELS[ch] }); i++; }
    else if (VOICED[ch]) { push({ kind: 'voiced', f: VOICED[ch] }); i++; }
    else if (FRICATIVE[ch]) { push({ kind: 'fric', f: FRICATIVE[ch], voiced: ch === 'z' }); i++; }
    else if (PLOSIVE[ch]) { push({ kind: 'plos', f: PLOSIVE[ch] }); i++; }
    else if (ch === ' ' || ch === '-') { push({ kind: 'gap', dur: 0.07 }); i++; }
    else if (',.!?'.includes(ch)) { push({ kind: 'gap', dur: 0.16 }); i++; }
    else i++;
  }
  // letzter Vokal pro Wort wird gedehnt (Shout-Charakter)
  for (let k = 0; k < out.length; k++) {
    const next = out.slice(k + 1).find((t) => t.kind !== 'fric' && t.kind !== 'plos');
    if (out[k].kind === 'vowel' && (!next || next.kind === 'gap')) out[k].last = true;
  }
  return out;
}

export async function renderVoice(text, styleId = 'shout', sampleRate = 44100) {
  const st = VOICE_STYLES[styleId] || VOICE_STYLES.shout;
  const toks = tokenize(text || 'hardcore');
  const sp = 1 / st.speed;
  const segs = [];
  let t = 0.02;
  for (const tok of toks) {
    let dur;
    switch (tok.kind) {
      case 'vowel': dur = (tok.last ? 0.3 : tok.long ? 0.2 : 0.13) * sp; break;
      case 'voiced': dur = 0.07 * sp; break;
      case 'fric': dur = 0.09 * sp; break;
      case 'plos': dur = 0.05 * sp; break;
      default: dur = tok.dur * sp;
    }
    segs.push({ ...tok, t, dur });
    t += dur;
  }
  const total = t + 0.25;
  const ctx = new OfflineAudioContext(1, Math.ceil(total * sampleRate), sampleRate);

  const out = ctx.createGain();
  const sh = ctx.createWaveShaper();
  sh.curve = driveCurve(ctx, st.drive);
  const pre = ctx.createGain();
  pre.gain.value = 1 + st.drive * 4;
  out.connect(pre).connect(sh).connect(ctx.destination);

  // Stimmquelle(n)
  const voicedAmp = ctx.createGain();
  voicedAmp.gain.value = 0;
  const srcs = [];
  const mk = (mult, gain) => {
    const o = ctx.createOscillator();
    o.type = st.wave;
    const g = ctx.createGain();
    g.gain.value = gain;
    o.connect(g).connect(voicedAmp);
    srcs.push({ o, mult });
  };
  mk(1, 1);
  if (st.double) mk(0.5, 0.8);
  mk(1.006, 0.5);

  const noise = ctx.createBufferSource();
  noise.buffer = noiseBuffer(ctx);
  noise.loop = true;
  const noiseAmp = ctx.createGain();
  noiseAmp.gain.value = 0;
  const noiseBp = ctx.createBiquadFilter();
  noiseBp.type = 'bandpass';
  noiseBp.Q.value = 1.2;
  noise.connect(noiseBp).connect(noiseAmp).connect(out);

  // drei parallele Formantfilter
  const formants = [0, 1, 2].map((k) => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = [7, 11, 14][k];
    const g = ctx.createGain();
    g.gain.value = [1, 0.7, 0.35][k] * 6;
    voicedAmp.connect(f).connect(g).connect(out);
    return f;
  });
  const body = ctx.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = 900;
  const bodyG = ctx.createGain();
  bodyG.gain.value = 0.25;
  voicedAmp.connect(body).connect(bodyG).connect(out);

  // Tonhöhe: pro Wort leichter Anstieg und Abfall (Shout-Kontur)
  const baseHz = 440 * Math.pow(2, (st.base - 69) / 12);
  let wordT = 0;
  for (const s of segs) {
    if (s.wordStart) wordT = s.t;
    const rel = s.t - wordT;
    const semis = st.contour * (rel < 0.12 ? rel / 0.12 : Math.max(-0.6, 1 - (rel - 0.12) * 2.5));
    const hz = baseHz * Math.pow(2, semis / 12);
    for (const { o, mult } of srcs) o.frequency.setTargetAtTime(hz * mult, s.t, 0.03);
  }

  for (const s of segs) {
    const end = s.t + s.dur;
    switch (s.kind) {
      case 'vowel':
      case 'voiced': {
        const amp = s.kind === 'vowel' ? 1 : 0.45;
        voicedAmp.gain.setTargetAtTime(amp, s.t, 0.012);
        noiseAmp.gain.setTargetAtTime(0.02, s.t, 0.01);
        s.f.forEach((hz, k) => formants[k].frequency.setTargetAtTime(hz, s.t, s.glide ? 0.05 : 0.018));
        break;
      }
      case 'fric':
        voicedAmp.gain.setTargetAtTime(s.voiced ? 0.3 : 0, s.t, 0.01);
        noiseBp.frequency.setValueAtTime(s.f, s.t);
        noiseAmp.gain.setTargetAtTime(s.f < 2000 ? 0.35 : 0.6, s.t, 0.01);
        noiseAmp.gain.setTargetAtTime(0, end - 0.015, 0.01);
        break;
      case 'plos':
        voicedAmp.gain.setTargetAtTime(0, s.t, 0.005);
        noiseBp.frequency.setValueAtTime(s.f, s.t);
        noiseAmp.gain.setValueAtTime(0, s.t);
        noiseAmp.gain.setValueAtTime(0.9, s.t + s.dur * 0.45);
        noiseAmp.gain.setTargetAtTime(0, s.t + s.dur * 0.5, 0.008);
        break;
      default:
        voicedAmp.gain.setTargetAtTime(0, s.t, 0.015);
        noiseAmp.gain.setTargetAtTime(0, s.t, 0.01);
    }
  }
  voicedAmp.gain.setTargetAtTime(0, t, 0.03);
  noiseAmp.gain.setTargetAtTime(0, t, 0.01);

  for (const { o } of srcs) { o.start(0); o.stop(total); }
  noise.start(0);
  noise.stop(total);

  const buf = await ctx.startRendering();
  return normalize(buf);
}

export function normalize(buf, target = 0.9) {
  let peak = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
  }
  if (peak > 0) {
    const g = target / peak;
    for (let c = 0; c < buf.numberOfChannels; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < d.length; i++) d[i] *= g;
    }
  }
  return buf;
}

// Stille am Anfang abschneiden, damit Vocals exakt auf dem Step sitzen
export function trimStart(ctx, buf, threshold = 0.02) {
  const d = buf.getChannelData(0);
  let start = 0;
  while (start < d.length && Math.abs(d[start]) < threshold) start++;
  start = Math.max(0, start - Math.floor(buf.sampleRate * 0.005));
  if (start === 0) return buf;
  const len = buf.length - start;
  if (len <= 0) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, len, buf.sampleRate);
  for (let c = 0; c < buf.numberOfChannels; c++) out.copyToChannel(buf.getChannelData(c).subarray(start), c);
  return out;
}

export async function decodeFile(ctx, file) {
  const arr = await file.arrayBuffer();
  const buf = await ctx.decodeAudioData(arr);
  return normalize(trimStart(ctx, buf));
}

export class MicRecorder {
  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream);
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
  }

  stop(ctx) {
    return new Promise((resolve, reject) => {
      this.rec.onstop = async () => {
        this.stream.getTracks().forEach((t) => t.stop());
        try {
          const blob = new Blob(this.chunks, { type: this.rec.mimeType });
          const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
          resolve(normalize(trimStart(ctx, buf)));
        } catch (e) {
          reject(e);
        }
      };
      this.rec.stop();
    });
  }
}

// Serialisierung (für Speichern/Laden): Mono, 16 Bit, Base64
export function bufferToData(buf) {
  const d = buf.getChannelData(0);
  const i16 = new Int16Array(d.length);
  for (let i = 0; i < d.length; i++) i16[i] = Math.max(-1, Math.min(1, d[i])) * 0x7fff;
  const bytes = new Uint8Array(i16.buffer);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return { sr: buf.sampleRate, data: btoa(bin) };
}

export function dataToBuffer(ctx, obj) {
  const bin = atob(obj.data);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const i16 = new Int16Array(bytes.buffer);
  const buf = ctx.createBuffer(1, i16.length, obj.sr);
  const d = buf.getChannelData(0);
  for (let i = 0; i < i16.length; i++) d[i] = i16[i] / 0x7fff;
  return buf;
}
