// Audio-Graph: Spuren -> Mixer (Volume, Sends) -> Master (Drive, Kompressor, Limiter)
// buildGraph() funktioniert mit AudioContext und OfflineAudioContext.

import { TRACKS } from './state.js';
import { driveCurve } from './instruments.js';

const DUCKED = ['bass', 'lead', 'vocal'];

function makeImpulse(ctx, seconds = 2.2, decay = 3) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
  }
  return ir;
}

export function buildGraph(ctx, project, destination = ctx.destination) {
  const bus = ctx.createGain();

  const drive = ctx.createWaveShaper();
  drive.oversample = '2x';
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -12;
  comp.ratio.value = 4;
  comp.attack.value = 0.005;
  comp.release.value = 0.12;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1.5;
  limiter.knee.value = 0;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.001;
  limiter.release.value = 0.06;
  const masterGain = ctx.createGain();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  bus.connect(drive).connect(comp).connect(limiter).connect(masterGain);
  masterGain.connect(analyser);
  masterGain.connect(destination);

  const reverb = ctx.createConvolver();
  reverb.buffer = makeImpulse(ctx);
  const revReturn = ctx.createGain();
  reverb.connect(revReturn).connect(bus);

  const delay = ctx.createDelay(2);
  const fb = ctx.createGain();
  fb.gain.value = 0.38;
  const dlp = ctx.createBiquadFilter();
  dlp.type = 'lowpass';
  dlp.frequency.value = 3500;
  delay.connect(dlp).connect(fb).connect(delay);
  const dlyReturn = ctx.createGain();
  dlyReturn.gain.value = 0.7;
  dlp.connect(dlyReturn).connect(bus);

  // Sidechain-Ducking für Bass/Lead/Vocals bei jedem Kick (das typische "Pumpen")
  const duckGain = ctx.createGain();
  duckGain.connect(bus);

  const inputs = {};
  const vols = {};
  const revSends = {};
  const dlySends = {};
  for (const t of TRACKS) {
    const input = ctx.createGain();
    const vol = ctx.createGain();
    const rs = ctx.createGain();
    const ds = ctx.createGain();
    input.connect(vol);
    vol.connect(DUCKED.includes(t.id) ? duckGain : bus);
    vol.connect(rs).connect(reverb);
    vol.connect(ds).connect(delay);
    inputs[t.id] = input;
    vols[t.id] = vol;
    revSends[t.id] = rs;
    dlySends[t.id] = ds;
  }

  const graph = {
    ctx,
    inputs,
    analyser,
    voices: {},
    duck(time, amount) {
      if (amount <= 0) return;
      duckGain.gain.setValueAtTime(1 - amount * 0.75, time);
      duckGain.gain.linearRampToValueAtTime(1, time + 0.13);
    },
    isAudible(id) {
      return audible(project, id);
    },
    update(proj) {
      project = proj;
      const m = proj.master;
      const now = ctx.currentTime;
      masterGain.gain.setTargetAtTime(m.vol, now, 0.02);
      drive.curve = driveCurve(ctx, m.drive * 0.6);
      revReturn.gain.setTargetAtTime(m.reverb, now, 0.02);
      delay.delayTime.setTargetAtTime((60 / proj.bpm) * 0.75, now, 0.02);
      for (const t of TRACKS) {
        const mx = proj.mixer[t.id];
        vols[t.id].gain.setTargetAtTime(audible(proj, t.id) ? mx.vol : 0, now, 0.01);
        revSends[t.id].gain.setTargetAtTime(mx.rev, now, 0.02);
        dlySends[t.id].gain.setTargetAtTime(mx.dly, now, 0.02);
      }
    },
  };
  graph.update(project);
  return graph;
}

export function audible(project, id) {
  const mx = project.mixer;
  const anySolo = TRACKS.some((t) => mx[t.id].solo);
  if (mx[id].mute) return false;
  if (anySolo && !mx[id].solo) return false;
  return true;
}

export class Engine {
  constructor() {
    this.ctx = null;
    this.graph = null;
  }

  ensure(project) {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.graph = buildGraph(this.ctx, project);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }

  update(project) {
    if (this.graph) this.graph.update(project);
  }
}
