// Lokale "KI": ein regelbasierter, probabilistischer Komponist für Hardcore-Stile.
// Läuft komplett im Browser, offline, ohne API-Key. Mit Seed reproduzierbar.

import { STEPS, emptyPattern, SOUND_PRESETS, defaultSounds } from './state.js';

export function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const STYLES = {
  gabber: {
    name: 'Gabber / Early Hardcore', bpm: [175, 195], scales: ['minor', 'phrygian'], kick: 'Gabber',
    leads: ['Hoover', 'Dark Square'], bass: 'Rumble Square', offbeatBass: 0.15, hat: 'offbeat', clap: 0.7,
    snare: 0.3, roll: 0.4, melody: 0.45,
    words: ['HARDCORE', 'ROTTERDAM', 'GABBER', 'HEY', 'NO MERCY', 'TERMINATE', 'FASTER', 'MOTHER EARTH'],
  },
  frenchcore: {
    name: 'Frenchcore', bpm: [195, 210], scales: ['harmonic', 'minor'], kick: 'Frenchcore',
    leads: ['Supersaw Anthem', 'Hoover'], bass: 'Offbeat Saw', offbeatBass: 1, hat: '16th', clap: 0.4,
    snare: 0.5, roll: 0.6, melody: 0.65,
    words: ['FRENCHCORE', 'ALLEZ', 'JUMP', 'LOUDER', 'FEEL THE KICK', 'HEY', 'C EST LA VIE', 'BASS'],
  },
  uptempo: {
    name: 'Uptempo', bpm: [200, 220], scales: ['phrygian', 'freygish'], kick: 'Uptempo',
    leads: ['Screech', 'Dark Square'], bass: 'Offbeat Saw', offbeatBass: 0.35, hat: 'offbeat', clap: 0.5,
    snare: 0.6, roll: 0.7, melody: 0.5,
    words: ['UPTEMPO', 'DESTROY', 'NO LIMITS', 'HEY', 'MADNESS', 'RAGE', 'FULL POWER', 'GO'],
  },
  industrial: {
    name: 'Industrial Hardcore', bpm: [150, 175], scales: ['phrygian', 'minor'], kick: 'Industrial',
    leads: ['Dark Square', 'Screech'], bass: 'Rumble Square', offbeatBass: 0.2, hat: '16th', clap: 0.3,
    snare: 0.4, roll: 0.3, melody: 0.3,
    words: ['INDUSTRIAL', 'MACHINE', 'DARKNESS', 'SYSTEM ERROR', 'OBEY', 'STEEL', 'NO SIGNAL', 'DOOM'],
  },
  terror: {
    name: 'Terror / Speedcore', bpm: [230, 280], scales: ['phrygian', 'freygish'], kick: 'Uptempo',
    leads: ['Screech', 'Dark Square'], bass: 'Rumble Square', offbeatBass: 0.1, hat: '16th', clap: 0.3,
    snare: 1, roll: 1, melody: 0.35,
    words: ['TERROR', 'SPEEDCORE', 'KILL', 'CHAOS', 'FASTER', 'NO REST', 'DIE HARD', 'HEY'],
  },
  happy: {
    name: 'Happy Hardcore', bpm: [165, 180], scales: ['major'], kick: 'Gabber',
    leads: ['Happy Pluck', 'Supersaw Anthem'], bass: 'Offbeat Saw', offbeatBass: 1, hat: 'offbeat', clap: 1,
    snare: 0.4, roll: 0.6, melody: 0.75,
    words: ['EVERYBODY', 'HANDS UP', 'TONIGHT', 'HAPPY', 'JUMP', 'FOREVER', 'RAVE ON', 'YEAH'],
  },
  rawstyle: {
    name: 'Rawstyle / Hardstyle', bpm: [150, 160], scales: ['minor', 'harmonic'], kick: 'Rawstyle',
    leads: ['Screech', 'Supersaw Anthem'], bass: 'Offbeat Saw', offbeatBass: 0, hat: 'offbeat', clap: 0.8,
    snare: 0.4, roll: 0.5, melody: 0.55,
    words: ['RAWSTYLE', 'WARRIOR', 'UNLEASH', 'POWER', 'HEY', 'THE CROWD', 'ENERGY', 'RISE UP'],
  },
};

const GENERIC_WORDS = ['HARDCORE', 'FEEL THE KICK', 'HEY', 'LOUDER', 'JUMP', 'BASS', 'GO', 'ARE YOU READY', 'MAKE SOME NOISE', 'LAUTER', 'BIS ZUM ENDE'];

const PROGRESSIONS = {
  minor: [[0, 5], [0, 6], [0, 3], [0, 4], [5, 6], [0, 2], [3, 4], [5, 4]],
  major: [[0, 4], [0, 3], [5, 3], [0, 5], [3, 4], [5, 4]],
};

function pick(r, arr) {
  return arr[Math.floor(r() * arr.length)];
}

function chance(r, p) {
  return r() < p;
}

export function makeOpts({ style = 'gabber', intensity = 0.7, complexity = 0.5, seed = Date.now() } = {}) {
  return { style, st: STYLES[style] || STYLES.gabber, intensity, complexity, r: makeRng(seed), seed };
}

export function randomProgression(o, scale) {
  return pick(o.r, scale === 'major' ? PROGRESSIONS.major : PROGRESSIONS.minor).slice();
}

// Leitet die Akkordfolge (pro Takt) aus vorhandenem Bass/Lead ab, sonst zufällig
export function inferProgression(o, pattern, scale) {
  const prog = [];
  for (let bar = 0; bar < 2; bar++) {
    const counts = {};
    for (const src of [pattern.bass, pattern.lead]) {
      for (let i = bar * 16; i < bar * 16 + 16; i++) {
        const n = src[i];
        if (n) {
          const d = ((n.deg % 7) + 7) % 7;
          counts[d] = (counts[d] || 0) + n.len * (src === pattern.bass ? 2 : 1);
        }
      }
    }
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    prog.push(best ? Number(best[0]) : null);
  }
  if (prog[0] === null || prog[1] === null) {
    const rnd = randomProgression(o, scale);
    return [prog[0] ?? rnd[0], prog[1] ?? rnd[1]];
  }
  return prog;
}

// ---------- Drums ----------

export function genKick(o, { fills = true } = {}) {
  const { r, st, complexity, intensity } = o;
  const k = new Array(STEPS).fill(0);
  for (let i = 0; i < STEPS; i += 4) k[i] = 1;
  if (o.style === 'terror' && intensity > 0.5) {
    for (let i = 2; i < STEPS; i += 4) if (chance(r, intensity * 0.5)) k[i] = 0.85;
  }
  if (fills) {
    const fillTypes = ['none', 'double', 'roll', 'gap', 'offkick', 'stutter'];
    const pickFill = () => (chance(r, 0.3 + complexity * 0.6) ? pick(r, fillTypes.slice(1)) : 'none');
    for (const [barEnd, p] of [[16, 0.35], [32, 1]]) {
      if (!chance(r, p)) continue;
      const s = barEnd - 4;
      switch (pickFill()) {
        case 'double': k[s + 2] = 0.85; k[s + 3] = 0.9; break;
        case 'roll': k[s + 1] = 0.8; k[s + 2] = 0.85; k[s + 3] = 0.95; break;
        case 'gap': k[s] = 0; k[s + 2] = 1; break;
        case 'offkick': k[s - 2] = 0.85; break;
        case 'stutter': k[s + 3] = 0.9; k[s - 1] = 0.8; break;
        default: break;
      }
    }
    if (st.offbeatBass === 0 && chance(r, complexity * 0.3)) k[14] = 0.8;
  }
  return k;
}

export function genSnare(o, { roll = true } = {}) {
  const { r, st, complexity, intensity } = o;
  const s = new Array(STEPS).fill(0);
  if (chance(r, st.snare * 0.6)) for (const i of [4, 12, 20, 28]) s[i] = 0.55;
  for (let i = 0; i < STEPS; i++) if (!s[i] && i % 2 === 1 && chance(r, complexity * 0.07)) s[i] = 0.3;
  if (roll && chance(r, st.roll * (0.4 + complexity * 0.6))) {
    const len = pick(r, [4, 8, 8, 16]);
    const step = len >= 8 && chance(r, 0.4) ? 2 : 1;
    for (let i = STEPS - len; i < STEPS; i += step) s[i] = 0.35 + 0.65 * ((i - (STEPS - len)) / len);
  }
  if (o.style === 'terror') for (let i = 2; i < STEPS; i += 4) if (chance(r, intensity * 0.6)) s[i] = 0.8;
  return s;
}

export function genBreakRoll(o) {
  // Snare-Build im Break: erst Viertel, dann Achtel, dann Sechzehntel
  const s = new Array(STEPS).fill(0);
  for (let i = 0; i < STEPS; i++) {
    const v = 0.25 + 0.75 * (i / STEPS);
    if (i < 16 ? i % 4 === 0 : i < 24 ? i % 2 === 0 : true) s[i] = v;
  }
  return s;
}

export function genClap(o) {
  const { r, st, complexity } = o;
  const c = new Array(STEPS).fill(0);
  if (chance(r, st.clap)) for (const i of [4, 12, 20, 28]) c[i] = 0.9;
  if (chance(r, complexity * 0.5)) c[pick(r, [14, 30, 15, 31])] = 0.6;
  return c;
}

export function genHat(o) {
  const { r, st, complexity } = o;
  const h = new Array(STEPS).fill(0);
  if (st.hat === '16th') {
    for (let i = 0; i < STEPS; i++) h[i] = i % 4 === 2 ? 0.9 : i % 2 === 1 ? 0.45 : 0.3;
    for (let i = 0; i < STEPS; i++) if (i % 4 !== 2 && chance(r, 0.25 - complexity * 0.15)) h[i] = 0;
  } else {
    for (let i = 2; i < STEPS; i += 4) h[i] = 0.85;
    for (let i = 0; i < STEPS; i++) if (!h[i] && i % 2 === 1 && chance(r, complexity * 0.35)) h[i] = 0.4;
  }
  return h;
}

export function genOpenHat(o) {
  const { r, st, complexity } = o;
  const h = new Array(STEPS).fill(0);
  if (st.hat === '16th' && chance(r, 0.6)) {
    for (let i = 2; i < STEPS; i += 4) h[i] = 0.7;
  } else {
    for (const i of [14, 30]) if (chance(r, 0.3 + complexity * 0.5)) h[i] = 0.7;
  }
  return h;
}

// ---------- Melodisch ----------

export function genBass(o, prog, { force = false } = {}) {
  const { r, st, complexity } = o;
  const b = new Array(STEPS).fill(null);
  let mode = chance(r, st.offbeatBass) ? 'offbeat' : chance(r, 0.4) ? 'rumble' : 'none';
  if (force && mode === 'none') mode = chance(r, 0.6) ? 'offbeat' : 'rumble';
  for (let bar = 0; bar < 2; bar++) {
    const root = prog[bar] - 7; // eine Oktave tiefer
    for (let q = 0; q < 4; q++) {
      const s = bar * 16 + q * 4;
      if (mode === 'offbeat') {
        let deg = root;
        if (chance(r, complexity * 0.3)) deg = root + 7;
        else if (chance(r, complexity * 0.2)) deg = root + 4;
        b[s + 2] = { deg, len: chance(r, 0.5) ? 2 : 1 };
        if (chance(r, complexity * 0.25)) b[s + 3] = { deg: root, len: 1 };
      } else if (mode === 'rumble') {
        b[s + 1] = { deg: root, len: 1 };
        b[s + 2] = { deg: root, len: 1 };
        b[s + 3] = { deg: root, len: 1 };
      }
    }
  }
  return b;
}

function chordTones(root) {
  return [root, root + 2, root + 4, root + 7];
}

function clampDeg(d, lo = -3, hi = 12) {
  while (d < lo) d += 7;
  while (d > hi) d -= 7;
  return d;
}

function makeMotif(o, root, density) {
  const { r } = o;
  const onsets = [0];
  for (let i = 1; i < 8; i++) {
    const p = i % 2 === 0 ? density * 0.85 : density * 0.55;
    if (chance(r, p)) onsets.push(i);
  }
  const notes = [];
  let prev = root + pick(r, [0, 2, 4, 7]);
  for (let n = 0; n < onsets.length; n++) {
    const next = n + 1 < onsets.length ? onsets[n + 1] : 8;
    let len = next - onsets[n];
    if (len > 1 && chance(r, 0.35)) len = 1; // Stakkato-Stabs
    let deg;
    if (chance(r, 0.6)) {
      // Akkordton nahe am vorherigen Ton
      const cands = chordTones(root).flatMap((d) => [d - 7, d, d + 7]);
      cands.sort((a, b) => Math.abs(a - prev) - Math.abs(b - prev));
      deg = cands[Math.floor(r() * 3)];
    } else {
      deg = prev + pick(r, [-2, -1, 1, 2, 1, -1]);
    }
    deg = clampDeg(deg);
    notes.push({ step: onsets[n], deg, len: Math.min(len, 4) });
    prev = deg;
  }
  return notes;
}

export function genLead(o, prog, { density = null, half = false } = {}) {
  const { r, st, complexity } = o;
  const l = new Array(STEPS).fill(null);
  const dens = density ?? Math.min(1, st.melody * (0.6 + complexity * 0.8));
  const motif = makeMotif(o, prog[0], dens);
  const place = (notes, offset, shift) => {
    for (const n of notes) l[offset + n.step] = { deg: clampDeg(n.deg + shift), len: n.len };
  };
  // Takt 1: Motiv + Wiederholung mit verändertem Ende (Call)
  place(motif, 0, 0);
  const variant = motif.map((n, i) => (i >= motif.length - 2 && chance(r, 0.6) ? { ...n, deg: clampDeg(n.deg + pick(r, [-2, -1, 1, 2])) } : n));
  place(variant, 8, 0);
  if (half) return l;
  // Takt 2: auf zweiten Akkord transponiert, Ende löst auf Grundton auf (Response)
  const shift = prog[1] - prog[0];
  place(motif, 16, shift);
  const resp = motif.map((n, i) => (i === motif.length - 1 ? { ...n, deg: prog[1] + (chance(r, 0.5) ? 0 : 7) } : n));
  place(resp, 24, shift);
  // letzte Note auf Grundton der Folge-Wiederholung
  return l;
}

export function genVocal(o, { sparse = false } = {}) {
  const { r, complexity } = o;
  const v = new Array(STEPS).fill(-1);
  if (chance(r, 0.8)) v[0] = 0;
  if (!sparse) {
    if (chance(r, 0.6)) v[16] = 1;
    if (chance(r, 0.3 + complexity * 0.5)) {
      v[28] = 2;
      v[30] = 2;
      if (chance(r, complexity)) v[31] = 2;
    }
    if (chance(r, complexity * 0.3)) v[8] = 3;
  }
  return v;
}

export function genVocalTexts(o) {
  const pool = [...o.st.words, ...GENERIC_WORDS];
  const out = [];
  while (out.length < 4) {
    const w = pick(o.r, pool);
    if (!out.includes(w)) out.push(w);
  }
  out[2] = pick(o.r, ['HEY', 'OI', 'GO', 'YEAH']);
  return out;
}

// ---------- Sounds ----------

function jitter(o, v, amt) {
  return v * (1 + (o.r() * 2 - 1) * amt);
}

export function genSounds(o) {
  const { st, intensity } = o;
  const s = defaultSounds();
  const kick = { ...SOUND_PRESETS.kick[st.kick] };
  kick.pitch = jitter(o, kick.pitch, 0.1);
  kick.decay = jitter(o, kick.decay, 0.12);
  kick.drive = Math.min(1, kick.drive * (0.85 + intensity * 0.3));
  kick.tone = jitter(o, kick.tone, 0.15);
  s.kick = kick;
  s.lead = { ...SOUND_PRESETS.lead[pick(o.r, st.leads)] };
  s.lead.detune = Math.round(jitter(o, s.lead.detune, 0.25));
  s.bass = { ...SOUND_PRESETS.bass[st.bass] };
  s.snare.drive = Math.min(1, 0.2 + intensity * 0.6);
  s.hat.metal = o.style === 'industrial' ? 0.85 : jitter(o, 0.4, 0.4);
  s.vocal.drive = 0.2 + intensity * 0.4;
  return s;
}

// ---------- Kompletter Song ----------

export function genSong(o, base) {
  const { r, st } = o;
  const bpm = Math.round(st.bpm[0] + r() * (st.bpm[1] - st.bpm[0]));
  const scale = pick(r, st.scales);
  const root = scale === 'major' ? pick(r, [0, 2, 7, 5, 9]) : pick(r, [9, 2, 4, 5, 7, 0, 11, 1]);
  const prog = randomProgression(o, scale);

  const kickFull = genKick(o);
  const lead = genLead(o, prog);
  const bass = genBass(o, prog);
  const hat = genHat(o);
  const openhat = genOpenHat(o);
  const clap = genClap(o);

  const intro = emptyPattern();
  intro.kick = genKick(o, { fills: false });
  intro.hat = hat.slice();
  intro.vocal = genVocal(o, { sparse: true });

  const build = emptyPattern();
  build.kick = kickFull.slice();
  build.hat = hat.slice();
  build.clap = clap.slice();
  build.snare = genSnare(o);
  build.bass = bass.slice();
  build.lead = genLead(o, prog, { half: true });
  build.vocal = genVocal(o);

  const brk = emptyPattern();
  brk.snare = genBreakRoll(o);
  brk.lead = lead.map((n) => (n ? { ...n } : null));
  brk.vocal = genVocal(o, { sparse: true });
  brk.openhat = new Array(STEPS).fill(0).map((_, i) => (i % 8 === 6 ? 0.5 : 0));

  const drop = emptyPattern();
  drop.kick = kickFull.slice();
  drop.hat = hat.slice();
  drop.openhat = openhat;
  drop.clap = clap.slice();
  drop.snare = genSnare(o);
  drop.bass = bass.slice();
  drop.lead = lead.map((n) => (n ? { ...n } : null));
  drop.vocal = genVocal(o);

  return {
    ...base,
    bpm,
    scale,
    root,
    style: o.style,
    patterns: [intro, build, brk, drop],
    arrangement: [0, 0, 1, 1, 3, 3, 3, 3, 2, 2, 2, 2, 3, 3, 3, 3, 1, 0],
    sounds: genSounds(o),
  };
}

// ---------- Variation ----------

export function mutateTrack(o, pattern, trackId, amount, scaleRoot = 0) {
  const { r } = o;
  const arr = pattern[trackId];
  if (trackId === 'bass' || trackId === 'lead') {
    for (let i = 0; i < STEPS; i++) {
      const n = arr[i];
      if (n && chance(r, amount * 0.35)) {
        if (chance(r, 0.2)) arr[i] = null;
        else n.deg = clampDeg(n.deg + pick(r, [-2, -1, 1, 2]), trackId === 'bass' ? -9 : -3, trackId === 'bass' ? 7 : 12);
      } else if (!n && chance(r, amount * 0.06)) {
        const prev = arr.slice(0, i).reverse().find(Boolean);
        arr[i] = { deg: prev ? prev.deg : scaleRoot, len: 1 };
      }
    }
  } else if (trackId === 'vocal') {
    for (let i = 0; i < STEPS; i++) {
      if (chance(r, amount * 0.08)) arr[i] = arr[i] >= 0 ? -1 : Math.floor(r() * 4);
    }
  } else {
    for (let i = 0; i < STEPS; i++) {
      if (trackId === 'kick' && i % 4 === 0) continue; // Four-on-the-floor bleibt
      if (chance(r, amount * 0.12)) arr[i] = arr[i] > 0 ? 0 : 0.5 + r() * 0.4;
      else if (arr[i] > 0 && chance(r, amount * 0.2)) arr[i] = Math.min(1, Math.max(0.2, arr[i] + (r() - 0.5) * 0.4));
    }
  }
}

export function genTrack(o, trackId, pattern, scale) {
  const prog = inferProgression(o, pattern, scale);
  switch (trackId) {
    case 'kick': return genKick(o);
    case 'snare': return genSnare(o);
    case 'clap': return genClap(o);
    case 'hat': return genHat(o);
    case 'openhat': return genOpenHat(o);
    case 'bass': return genBass(o, prog, { force: true });
    case 'lead': return genLead(o, prog);
    case 'vocal': return genVocal(o);
    default: return pattern[trackId];
  }
}
