// Step-Sequencer mit Lookahead-Scheduling + Offline-Render für den WAV-Export

import { STEPS, DRUM_IDS } from './state.js';
import { degreeToMidi, BASE_OCTAVE } from './theory.js';
import * as inst from './instruments.js';
import { buildGraph } from './audio.js';

const DRUM_FN = {
  kick: inst.playKick,
  snare: inst.playSnare,
  clap: inst.playClap,
  hat: inst.playHat,
  openhat: inst.playOpenHat,
};

export function stepDuration(bpm) {
  return 60 / bpm / 4;
}

function chordMidis(project, deg, base, chord) {
  const m = (d) => degreeToMidi(project.root, project.scale, d, base);
  switch (chord) {
    case 'fifth': return [m(deg), m(deg + 4)];
    case 'octave': return [m(deg), m(deg) + 12];
    case 'triad': return [m(deg), m(deg + 2), m(deg + 4)];
    default: return [m(deg)];
  }
}

// Spielt alle Events eines Steps zur Zeit `time` ab
export function triggerStep(graph, project, pattern, step, time) {
  const ctx = graph.ctx;
  const s = project.sounds;
  const sd = stepDuration(project.bpm);

  for (const id of DRUM_IDS) {
    const v = pattern[id][step];
    if (v > 0 && graph.isAudible(id)) {
      DRUM_FN[id](ctx, graph.inputs[id], time, v, s[id], graph.voices);
    }
    if (id === 'kick' && v > 0) graph.duck(time, project.master.duck ?? 0.5);
  }

  const b = pattern.bass[step];
  if (b && graph.isAudible('bass')) {
    const midi = degreeToMidi(project.root, project.scale, b.deg, BASE_OCTAVE.bass);
    inst.playBass(ctx, graph.inputs.bass, time, 0.9, midi, b.len * sd * 0.92, s.bass);
  }

  const l = pattern.lead[step];
  if (l && graph.isAudible('lead')) {
    const midis = chordMidis(project, l.deg, BASE_OCTAVE.lead, s.lead.chord);
    inst.playLead(ctx, graph.inputs.lead, time, 0.8, midis, l.len * sd * 0.95, s.lead);
  }

  const slot = pattern.vocal[step];
  if (slot >= 0 && graph.isAudible('vocal')) {
    const vs = project.vocals[slot];
    if (vs && vs.buffer) {
      inst.playVocal(ctx, graph.inputs.vocal, time, vs.buffer, s.vocal, s.vocal.gate * sd, graph.voices);
    }
  }
}

function swingOffset(project, step) {
  return step % 2 === 1 ? project.swing * stepDuration(project.bpm) * 0.5 : 0;
}

export class Sequencer {
  constructor(engine, getProject) {
    this.engine = engine;
    this.getProject = getProject;
    this.playing = false;
    this.mode = 'pattern'; // pattern | song
    this.editPattern = 0;
    this.queue = [];
    this.timer = null;
  }

  start(mode) {
    const project = this.getProject();
    const ctx = this.engine.ensure(project);
    this.mode = mode || this.mode;
    this.step = 0;
    this.block = 0;
    this.nextTime = ctx.currentTime + 0.08;
    this.queue = [];
    this.playing = true;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 25);
    this.tick();
  }

  stop() {
    this.playing = false;
    clearInterval(this.timer);
    this.queue = [];
  }

  currentPatternIndex() {
    const p = this.getProject();
    if (this.mode === 'song' && p.arrangement.length) return p.arrangement[this.block % p.arrangement.length];
    return this.editPattern;
  }

  tick() {
    const ctx = this.engine.ctx;
    const project = this.getProject();
    while (this.nextTime < ctx.currentTime + 0.12) {
      const pi = this.currentPatternIndex();
      const time = this.nextTime + swingOffset(project, this.step);
      triggerStep(this.engine.graph, project, project.patterns[pi], this.step, time);
      this.queue.push({ time, step: this.step, pattern: pi, block: this.block });
      this.nextTime += stepDuration(project.bpm);
      this.step++;
      if (this.step >= STEPS) {
        this.step = 0;
        if (this.mode === 'song') this.block = (this.block + 1) % Math.max(1, project.arrangement.length);
      }
    }
  }

  // Liefert das zuletzt hörbare Event (für den Playhead im UI)
  poll() {
    if (!this.playing || !this.engine.ctx) return null;
    const now = this.engine.ctx.currentTime;
    let cur = null;
    while (this.queue.length && this.queue[0].time <= now) cur = this.queue.shift();
    return cur;
  }
}

// Rendert das komplette Arrangement (oder ein Pattern) offline in einen AudioBuffer
export async function renderOffline(project, { patternOnly = null, loops = 1 } = {}) {
  const sr = 44100;
  const blocks = patternOnly !== null
    ? new Array(loops).fill(patternOnly)
    : project.arrangement.length ? project.arrangement : [0];
  const sd = stepDuration(project.bpm);
  const total = blocks.length * STEPS * sd + 3;
  const ctx = new OfflineAudioContext(2, Math.ceil(total * sr), sr);
  const graph = buildGraph(ctx, project);
  let t = 0.05;
  for (const pi of blocks) {
    for (let step = 0; step < STEPS; step++) {
      triggerStep(graph, project, project.patterns[pi], step, t + swingOffset(project, step));
      t += sd;
    }
  }
  return ctx.startRendering();
}

export function encodeWav(buffer) {
  const ch = buffer.numberOfChannels;
  const len = buffer.length;
  const data = new DataView(new ArrayBuffer(44 + len * ch * 2));
  const w = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF');
  data.setUint32(4, 36 + len * ch * 2, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  data.setUint32(16, 16, true);
  data.setUint16(20, 1, true);
  data.setUint16(22, ch, true);
  data.setUint32(24, buffer.sampleRate, true);
  data.setUint32(28, buffer.sampleRate * ch * 2, true);
  data.setUint16(32, ch * 2, true);
  data.setUint16(34, 16, true);
  w(36, 'data');
  data.setUint32(40, len * ch * 2, true);
  const chans = [];
  for (let c = 0; c < ch; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < len; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, chans[c][i]));
      data.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true);
      o += 2;
    }
  }
  return new Blob([data], { type: 'audio/wav' });
}
