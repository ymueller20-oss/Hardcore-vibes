// Datenmodell: Projekt, Patterns, Sound-Parameter, Presets

export const STEPS = 32; // 2 Takte à 16 Sechzehntel
export const PATTERN_NAMES = ['A', 'B', 'C', 'D'];
export const VOCAL_SLOTS = 4;

export const TRACKS = [
  { id: 'kick', name: 'Kick', type: 'drum', color: '#ff2a4f' },
  { id: 'snare', name: 'Snare', type: 'drum', color: '#ff8a2a' },
  { id: 'clap', name: 'Clap', type: 'drum', color: '#ffd02a' },
  { id: 'hat', name: 'Hi-Hat', type: 'drum', color: '#9dff2a' },
  { id: 'openhat', name: 'Open Hat', type: 'drum', color: '#2affb0' },
  { id: 'bass', name: 'Bass', type: 'melodic', color: '#2ad4ff' },
  { id: 'lead', name: 'Melodie', type: 'melodic', color: '#8a5bff' },
  { id: 'vocal', name: 'Vocals', type: 'vocal', color: '#ff4fd8' },
];

export const DRUM_IDS = TRACKS.filter((t) => t.type === 'drum').map((t) => t.id);

// Parameter-Definitionen: steuern sowohl die Regler im UI als auch das Clamping von KI-Ausgaben
export const PARAM_DEFS = {
  kick: [
    { key: 'pitch', label: 'Start-Pitch', min: 120, max: 700, step: 1, unit: 'Hz' },
    { key: 'end', label: 'End-Pitch', min: 30, max: 90, step: 1, unit: 'Hz' },
    { key: 'sweep', label: 'Pitch-Sweep', min: 0.01, max: 0.25, step: 0.005, unit: 's' },
    { key: 'decay', label: 'Länge/Tail', min: 0.08, max: 1.2, step: 0.01, unit: 's' },
    { key: 'drive', label: 'Distortion', min: 0, max: 1, step: 0.01 },
    { key: 'click', label: 'Punch/Click', min: 0, max: 1, step: 0.01 },
    { key: 'tone', label: 'Tone (LP)', min: 300, max: 12000, step: 10, unit: 'Hz' },
  ],
  snare: [
    { key: 'tone', label: 'Tonhöhe', min: 100, max: 400, step: 1, unit: 'Hz' },
    { key: 'snappy', label: 'Rauschen', min: 0, max: 1, step: 0.01 },
    { key: 'decay', label: 'Decay', min: 0.04, max: 0.6, step: 0.01, unit: 's' },
    { key: 'drive', label: 'Distortion', min: 0, max: 1, step: 0.01 },
  ],
  clap: [
    { key: 'tone', label: 'Filter', min: 600, max: 4000, step: 10, unit: 'Hz' },
    { key: 'decay', label: 'Decay', min: 0.05, max: 0.6, step: 0.01, unit: 's' },
    { key: 'spread', label: 'Spread', min: 0.005, max: 0.03, step: 0.001, unit: 's' },
  ],
  hat: [
    { key: 'tone', label: 'Highpass', min: 3000, max: 12000, step: 50, unit: 'Hz' },
    { key: 'decay', label: 'Decay', min: 0.01, max: 0.2, step: 0.005, unit: 's' },
    { key: 'metal', label: 'Metallisch', min: 0, max: 1, step: 0.01 },
  ],
  openhat: [
    { key: 'tone', label: 'Highpass', min: 3000, max: 12000, step: 50, unit: 'Hz' },
    { key: 'decay', label: 'Decay', min: 0.1, max: 0.8, step: 0.01, unit: 's' },
    { key: 'metal', label: 'Metallisch', min: 0, max: 1, step: 0.01 },
  ],
  bass: [
    { key: 'wave', label: 'Wellenform', type: 'select', options: ['sawtooth', 'square', 'sine'] },
    { key: 'cutoff', label: 'Cutoff', min: 80, max: 6000, step: 10, unit: 'Hz' },
    { key: 'reso', label: 'Resonanz', min: 0, max: 20, step: 0.1 },
    { key: 'env', label: 'Filter-Env', min: 0, max: 1, step: 0.01 },
    { key: 'decay', label: 'Decay', min: 0.03, max: 0.6, step: 0.01, unit: 's' },
    { key: 'drive', label: 'Distortion', min: 0, max: 1, step: 0.01 },
  ],
  lead: [
    { key: 'wave', label: 'Synth-Typ', type: 'select', options: ['supersaw', 'hoover', 'screech', 'square', 'pluck'] },
    { key: 'chord', label: 'Akkord', type: 'select', options: ['none', 'fifth', 'octave', 'triad'] },
    { key: 'detune', label: 'Detune', min: 0, max: 60, step: 1, unit: 'ct' },
    { key: 'cutoff', label: 'Cutoff', min: 200, max: 14000, step: 10, unit: 'Hz' },
    { key: 'reso', label: 'Resonanz', min: 0, max: 20, step: 0.1 },
    { key: 'attack', label: 'Attack', min: 0.001, max: 0.3, step: 0.001, unit: 's' },
    { key: 'release', label: 'Release', min: 0.02, max: 1, step: 0.01, unit: 's' },
    { key: 'drive', label: 'Distortion', min: 0, max: 1, step: 0.01 },
    { key: 'vibrato', label: 'Vibrato', min: 0, max: 1, step: 0.01 },
  ],
  vocal: [
    { key: 'pitch', label: 'Pitch', min: -12, max: 12, step: 1, unit: 'st' },
    { key: 'cutoff', label: 'Filter', min: 300, max: 16000, step: 10, unit: 'Hz' },
    { key: 'drive', label: 'Distortion', min: 0, max: 1, step: 0.01 },
    { key: 'gate', label: 'Gate (Steps, 0=voll)', min: 0, max: 16, step: 1 },
  ],
};

export const SOUND_PRESETS = {
  kick: {
    Gabber: { pitch: 380, end: 52, sweep: 0.07, decay: 0.42, drive: 0.85, click: 0.5, tone: 4200 },
    Frenchcore: { pitch: 300, end: 48, sweep: 0.09, decay: 0.75, drive: 0.95, click: 0.35, tone: 3200 },
    Uptempo: { pitch: 450, end: 58, sweep: 0.05, decay: 0.32, drive: 1, click: 0.7, tone: 6000 },
    Industrial: { pitch: 240, end: 44, sweep: 0.11, decay: 0.55, drive: 0.7, click: 0.2, tone: 1800 },
    Rawstyle: { pitch: 330, end: 50, sweep: 0.08, decay: 0.6, drive: 0.9, click: 0.45, tone: 2600 },
    Clean: { pitch: 200, end: 50, sweep: 0.06, decay: 0.3, drive: 0.15, click: 0.3, tone: 9000 },
  },
  lead: {
    'Supersaw Anthem': { wave: 'supersaw', chord: 'octave', detune: 28, cutoff: 7000, reso: 2, attack: 0.005, release: 0.25, drive: 0.2, vibrato: 0.1 },
    Hoover: { wave: 'hoover', chord: 'none', detune: 40, cutoff: 5000, reso: 3, attack: 0.03, release: 0.35, drive: 0.35, vibrato: 0.25 },
    Screech: { wave: 'screech', chord: 'none', detune: 15, cutoff: 9000, reso: 8, attack: 0.002, release: 0.1, drive: 0.9, vibrato: 0.05 },
    'Dark Square': { wave: 'square', chord: 'fifth', detune: 10, cutoff: 2200, reso: 6, attack: 0.002, release: 0.12, drive: 0.5, vibrato: 0 },
    'Happy Pluck': { wave: 'pluck', chord: 'triad', detune: 18, cutoff: 6000, reso: 3, attack: 0.001, release: 0.18, drive: 0.1, vibrato: 0 },
  },
  bass: {
    'Offbeat Saw': { wave: 'sawtooth', cutoff: 900, reso: 6, env: 0.6, decay: 0.14, drive: 0.6 },
    'Rumble Square': { wave: 'square', cutoff: 400, reso: 3, env: 0.3, decay: 0.25, drive: 0.4 },
    'Sub Sine': { wave: 'sine', cutoff: 2000, reso: 0, env: 0, decay: 0.3, drive: 0.1 },
  },
};

export function defaultSounds() {
  return {
    kick: { ...SOUND_PRESETS.kick.Gabber },
    snare: { tone: 190, snappy: 0.7, decay: 0.18, drive: 0.4 },
    clap: { tone: 1400, decay: 0.2, spread: 0.012 },
    hat: { tone: 7500, decay: 0.045, metal: 0.4 },
    openhat: { tone: 6500, decay: 0.3, metal: 0.5 },
    bass: { ...SOUND_PRESETS.bass['Offbeat Saw'] },
    lead: { ...SOUND_PRESETS.lead.Hoover },
    vocal: { pitch: 0, cutoff: 9000, drive: 0.3, gate: 0 },
  };
}

export function defaultMixer() {
  const vol = { kick: 0.9, snare: 0.55, clap: 0.5, hat: 0.35, openhat: 0.3, bass: 0.45, lead: 0.42, vocal: 0.7 };
  const rev = { kick: 0, snare: 0.15, clap: 0.25, hat: 0.05, openhat: 0.1, bass: 0, lead: 0.3, vocal: 0.25 };
  const dly = { kick: 0, snare: 0, clap: 0.05, hat: 0, openhat: 0, bass: 0, lead: 0.2, vocal: 0.2 };
  const m = {};
  for (const t of TRACKS) m[t.id] = { vol: vol[t.id], rev: rev[t.id], dly: dly[t.id], mute: false, solo: false };
  return m;
}

export function emptyPattern() {
  const p = {};
  for (const id of DRUM_IDS) p[id] = new Array(STEPS).fill(0);
  p.bass = new Array(STEPS).fill(null); // {deg, len}
  p.lead = new Array(STEPS).fill(null);
  p.vocal = new Array(STEPS).fill(-1); // Slot-Index oder -1
  return p;
}

export function defaultVocalSlots() {
  return Array.from({ length: VOCAL_SLOTS }, (_, i) => ({
    text: ['HARDCORE', 'FEEL THE KICK', 'HEY', 'LOUDER'][i],
    voice: 'shout',
    source: 'none', // none | robot | recorded
    buffer: null, // AudioBuffer (nicht serialisiert, außer als data)
  }));
}

export function newProject() {
  const patterns = PATTERN_NAMES.map(() => emptyPattern());
  const p = patterns[0];
  for (let i = 0; i < STEPS; i += 4) p.kick[i] = 1;
  for (let i = 2; i < STEPS; i += 4) p.hat[i] = 0.8;
  return {
    version: 1,
    name: 'Mein Hardcore Track',
    bpm: 190,
    swing: 0,
    root: 9, // A
    scale: 'minor',
    style: 'gabber',
    patterns,
    arrangement: [0, 0, 0, 0],
    sounds: defaultSounds(),
    mixer: defaultMixer(),
    master: { vol: 0.8, drive: 0.3, reverb: 0.5, duck: 0.5 },
    vocals: defaultVocalSlots(),
  };
}

export function clampParams(trackId, params) {
  const out = {};
  for (const def of PARAM_DEFS[trackId] || []) {
    const v = params[def.key];
    if (v === undefined) continue;
    if (def.type === 'select') {
      if (def.options.includes(v)) out[def.key] = v;
    } else {
      const n = Number(v);
      if (Number.isFinite(n)) out[def.key] = Math.min(def.max, Math.max(def.min, n));
    }
  }
  return out;
}

export function clonePattern(p) {
  return JSON.parse(JSON.stringify(p));
}
