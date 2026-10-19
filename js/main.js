// UI & App-Logik: verbindet Sequencer, Sound-Engine, lokale KI, Claude und Vocals

import {
  STEPS, TRACKS, DRUM_IDS, PATTERN_NAMES, PARAM_DEFS, SOUND_PRESETS, VOCAL_SLOTS,
  newProject, emptyPattern, defaultSounds, defaultMixer, defaultVocalSlots, clonePattern,
} from './state.js';
import { NOTE_NAMES, SCALES, BASE_OCTAVE, degreeToMidi, midiName } from './theory.js';
import { Engine } from './audio.js';
import { Sequencer, renderOffline, encodeWav, stepDuration } from './sequencer.js';
import * as inst from './instruments.js';
import * as ai from './ai.js';
import { renderVoice, VOICE_STYLES, MicRecorder, decodeFile, bufferToData, dataToBuffer } from './voice.js';
import { MODELS, SCOPES, askClaude, applyResult } from './claude.js';

const $ = (s, el = document) => el.querySelector(s);
const STORE_KEY = 'hcv-project-v1';
const KEY_STORE = 'hcv-claude-key';

const engine = new Engine();
let project = hydrate(loadLocal()) || newProject();
const seq = new Sequencer(engine, () => project);

const ui = {
  editPattern: 0,
  rollTrack: 'lead',
  rollLen: 2,
  soundTab: 'kick',
  lastDeg: { bass: -7, lead: 0 },
  playStep: -1,
  playPattern: -1,
  recorder: null,
  recordingSlot: -1,
};

// ---------------------------------------------------------------- Persistenz

function safeGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function safeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function safeDel(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }

function serialize(p, withAudio) {
  return {
    ...p,
    vocals: p.vocals.map((v) => ({
      text: v.text,
      voice: v.voice,
      source: v.source,
      audio: withAudio && v.source === 'recorded' && v.buffer ? bufferToData(v.buffer) : undefined,
    })),
  };
}

function loadLocal() {
  const raw = safeGet(STORE_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch (e) { return null; }
}

let saveTimer = null;
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!safeSet(STORE_KEY, JSON.stringify(serialize(project, true)))) {
      safeSet(STORE_KEY, JSON.stringify(serialize(project, false)));
    }
  }, 800);
}

// Ergänzt fehlende Felder (ältere Speicherstände, KI-Ausgaben, Dateien)
function hydrate(p) {
  if (!p || typeof p !== 'object' || !Array.isArray(p.patterns)) return null;
  const base = newProject();
  const out = { ...base, ...p };
  out.sounds = defaultSounds();
  for (const t of TRACKS) Object.assign(out.sounds[t.id], (p.sounds || {})[t.id] || {});
  out.mixer = defaultMixer();
  for (const t of TRACKS) Object.assign(out.mixer[t.id], (p.mixer || {})[t.id] || {});
  out.master = { ...base.master, ...(p.master || {}) };
  out.patterns = PATTERN_NAMES.map((_, i) => {
    const src = p.patterns[i] || {};
    const e = emptyPattern();
    for (const k of Object.keys(e)) if (Array.isArray(src[k]) && src[k].length === STEPS) e[k] = src[k];
    return e;
  });
  out.arrangement = (Array.isArray(p.arrangement) && p.arrangement.length ? p.arrangement : [0]).filter((i) => i >= 0 && i < 4);
  const slots = defaultVocalSlots();
  out.vocals = slots.map((s, i) => {
    const v = (p.vocals || [])[i] || {};
    return { ...s, text: v.text ?? s.text, voice: v.voice || s.voice, source: v.source || s.source, buffer: null, _audio: v.audio };
  });
  return out;
}

// ---------------------------------------------------------------- Undo/Redo

const undoStack = [];
const redoStack = [];
const snap = () => JSON.stringify(serialize(project, false));

function commit() {
  undoStack.push(snap());
  if (undoStack.length > 80) undoStack.shift();
  redoStack.length = 0;
}

function restore(json) {
  const p = JSON.parse(json);
  p.vocals.forEach((v, i) => {
    const old = project.vocals[i];
    v.buffer = old.buffer;
    v.bufferText = old.bufferText;
    v.bufferVoice = old.bufferVoice;
    if (v.source === 'robot' && (v.bufferText !== v.text || v.bufferVoice !== v.voice)) v.buffer = null;
  });
  project = p;
  changed(true);
  renderMissingVoices();
}

function undo() {
  if (!undoStack.length) return toast('Nichts zum Rückgängigmachen');
  redoStack.push(snap());
  restore(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snap());
  restore(redoStack.pop());
}

function changed(full = false) {
  engine.update(project);
  if (full) renderAll();
  scheduleSave();
}

// ---------------------------------------------------------------- Helfer

let toastTimer = null;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v !== null && v !== undefined) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined) e.append(c);
  return e;
}

const pat = () => project.patterns[ui.editPattern];
const track = (id) => TRACKS.find((t) => t.id === id);

function aiOpts() {
  const lock = $('#ai-seed-lock').checked;
  let seed = parseInt($('#ai-seed').value, 10);
  if (!lock || !Number.isFinite(seed)) {
    seed = Math.floor(Math.random() * 1e6);
    $('#ai-seed').value = seed;
  }
  return ai.makeOpts({
    style: $('#ai-style').value,
    intensity: parseFloat($('#ai-intensity').value),
    complexity: parseFloat($('#ai-complexity').value),
    seed,
  });
}

function ctx() {
  return engine.ensure(project);
}

// ---------------------------------------------------------------- Vorhören

function previewTrack(id, deg = null) {
  const c = ctx();
  const g = engine.graph;
  const t = c.currentTime + 0.02;
  const s = project.sounds;
  const sd = stepDuration(project.bpm);
  if (DRUM_IDS.includes(id)) {
    const fn = { kick: inst.playKick, snare: inst.playSnare, clap: inst.playClap, hat: inst.playHat, openhat: inst.playOpenHat }[id];
    fn(c, g.inputs[id], t, 0.9, s[id], g.voices);
  } else if (id === 'bass' || id === 'lead') {
    const d = deg ?? ui.lastDeg[id];
    const midi = degreeToMidi(project.root, project.scale, d, BASE_OCTAVE[id]);
    if (id === 'bass') inst.playBass(c, g.inputs.bass, t, 0.9, midi, sd * 2, s.bass);
    else inst.playLead(c, g.inputs.lead, t, 0.8, [midi], sd * 2, s.lead);
  } else if (id === 'vocal') {
    const slot = project.vocals.find((v) => v.buffer);
    if (slot) inst.playVocal(c, g.inputs.vocal, t, slot.buffer, s.vocal, 0, g.voices);
  }
}

function previewVocal(i) {
  const v = project.vocals[i];
  if (!v.buffer) return toast('Slot ist leer');
  const c = ctx();
  inst.playVocal(c, engine.graph.inputs.vocal, c.currentTime + 0.02, v.buffer, project.sounds.vocal, 0, engine.graph.voices);
}

// ---------------------------------------------------------------- Header

function initHeader() {
  const root = $('#root');
  NOTE_NAMES.forEach((n, i) => root.append(el('option', { value: i }, n)));
  const scale = $('#scale');
  for (const [id, s] of Object.entries(SCALES)) scale.append(el('option', { value: id }, s.name));

  $('#bpm').addEventListener('change', (e) => {
    commit();
    project.bpm = Math.max(100, Math.min(320, parseInt(e.target.value, 10) || 190));
    changed(true);
  });
  root.addEventListener('change', (e) => { commit(); project.root = parseInt(e.target.value, 10); changed(true); });
  scale.addEventListener('change', (e) => { commit(); project.scale = e.target.value; changed(true); });
  bindSlider($('#swing'), (v) => { project.swing = v; });
  bindSlider($('#master-vol'), (v) => { project.master.vol = v; });

  $('#btn-play').addEventListener('click', () => togglePlay('pattern'));
  $('#btn-song').addEventListener('click', () => togglePlay('song'));
  $('#btn-stop').addEventListener('click', stop);
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);
  $('#btn-export').addEventListener('click', exportWav);
  $('#btn-save').addEventListener('click', saveFile);
  $('#file-load').addEventListener('change', loadFile);
  $('#btn-new').addEventListener('click', () => {
    commit();
    const keep = project.vocals.map((v) => v.buffer);
    project = newProject();
    project.vocals.forEach((v, i) => { v.buffer = keep[i]; v.source = keep[i] ? 'robot' : 'none'; });
    ui.editPattern = 0;
    changed(true);
    renderMissingVoices();
    toast('Neues Projekt (↶ holt das alte zurück)');
  });
}

function renderHeader() {
  $('#bpm').value = project.bpm;
  $('#root').value = project.root;
  $('#scale').value = project.scale;
  $('#swing').value = project.swing;
  $('#master-vol').value = project.master.vol;
}

// Slider: ein Undo-Schritt pro Zug, Live-Update während des Ziehens
function bindSlider(input, apply, after) {
  let dragging = false;
  input.addEventListener('input', () => {
    if (!dragging) { commit(); dragging = true; }
    apply(parseFloat(input.value));
    changed();
    if (after) after();
  });
  input.addEventListener('change', () => { dragging = false; });
}

function togglePlay(mode) {
  if (seq.playing && seq.mode === mode) return stop();
  seq.editPattern = ui.editPattern;
  seq.start(mode);
  $('#btn-play').classList.toggle('on', mode === 'pattern');
  $('#btn-song').classList.toggle('on', mode === 'song');
}

function stop() {
  seq.stop();
  $('#btn-play').classList.remove('on');
  $('#btn-song').classList.remove('on');
  setPlayStep(-1);
  document.querySelectorAll('.arr-block.playing, .pat-btn.playing').forEach((e) => e.classList.remove('playing'));
}

// ---------------------------------------------------------------- KI-Studio

function initAI() {
  const st = $('#ai-style');
  for (const [id, s] of Object.entries(ai.STYLES)) st.append(el('option', { value: id }, s.name));
  st.value = project.style || 'gabber';
  st.addEventListener('change', () => { project.style = st.value; scheduleSave(); });
  const outs = [['#ai-intensity', '#ai-int-out'], ['#ai-complexity', '#ai-cpx-out']];
  for (const [i, o] of outs) {
    const upd = () => { $(o).textContent = Math.round($(i).value * 100) + '%'; };
    $(i).addEventListener('input', upd);
    upd();
  }

  $('#ai-song').addEventListener('click', async () => {
    commit();
    const o = aiOpts();
    const keepMixer = project.mixer;
    const texts = ai.genVocalTexts(o);
    project = { ...ai.genSong(o, project), mixer: keepMixer };
    project.vocals.forEach((v, i) => {
      if (v.source !== 'recorded') { v.text = texts[i]; v.source = 'robot'; v.buffer = null; }
    });
    ui.editPattern = 3;
    changed(true);
    await renderMissingVoices();
    toast(`${o.st.name} generiert: ${project.bpm} BPM, ${NOTE_NAMES[project.root]} ${SCALES[project.scale].name}`);
  });

  $('#ai-pattern').addEventListener('click', () => {
    commit();
    const o = aiOpts();
    const prog = ai.randomProgression(o, project.scale);
    const p = emptyPattern();
    p.kick = ai.genKick(o);
    p.snare = ai.genSnare(o);
    p.clap = ai.genClap(o);
    p.hat = ai.genHat(o);
    p.openhat = ai.genOpenHat(o);
    p.bass = ai.genBass(o, prog);
    p.lead = ai.genLead(o, prog);
    p.vocal = ai.genVocal(o);
    project.patterns[ui.editPattern] = p;
    changed(true);
    toast(`Pattern ${PATTERN_NAMES[ui.editPattern]} neu generiert`);
  });

  $('#ai-vary').addEventListener('click', () => {
    commit();
    const o = aiOpts();
    const amt = parseFloat($('#ai-vary-amt').value);
    for (const t of TRACKS) ai.mutateTrack(o, pat(), t.id, amt);
    changed(true);
    toast('Variation erstellt');
  });

  // Claude
  const scope = $('#claude-scope');
  for (const [id, name] of Object.entries(SCOPES)) scope.append(el('option', { value: id }, name));
  const model = $('#claude-model');
  for (const m of MODELS) model.append(el('option', { value: m.id }, m.name));
  const saved = safeGet(KEY_STORE);
  if (saved) { $('#claude-key').value = saved; $('#claude-remember').checked = true; }
  $('#claude-remember').addEventListener('change', (e) => {
    if (e.target.checked) safeSet(KEY_STORE, $('#claude-key').value.trim());
    else safeDel(KEY_STORE);
  });
  $('#claude-key').addEventListener('change', () => {
    if ($('#claude-remember').checked) safeSet(KEY_STORE, $('#claude-key').value.trim());
  });
  $('#claude-go').addEventListener('click', () => runClaude(scope.value));
  $('#voc-ai').addEventListener('click', () => {
    if ($('#claude-key').value.trim()) return runClaude('vocals');
    commit();
    const texts = ai.genVocalTexts(aiOpts());
    project.vocals.forEach((v, i) => { if (v.source !== 'recorded') { v.text = texts[i]; v.source = 'robot'; v.buffer = null; } });
    changed(true);
    renderMissingVoices();
  });
}

async function runClaude(scope) {
  const status = $('#claude-status');
  const key = $('#claude-key').value.trim();
  if (!key) {
    status.className = 'status err';
    status.textContent = 'Bitte zuerst einen Anthropic API-Key eintragen (console.anthropic.com). Ohne Key funktioniert die lokale KI links.';
    return;
  }
  const btn = $('#claude-go');
  btn.disabled = true;
  status.className = 'status';
  status.textContent = 'Claude komponiert … (das kann 20–60 Sekunden dauern)';
  try {
    const res = await askClaude({
      apiKey: key,
      model: $('#claude-model').value,
      prompt: $('#claude-prompt').value.trim(),
      project,
      scope,
      currentPattern: ui.editPattern,
    });
    commit();
    const { project: next, explanation, vocalsChanged } = applyResult(project, res, scope, ui.editPattern);
    project = next;
    for (const i of vocalsChanged) {
      if (project.vocals[i].source !== 'recorded') { project.vocals[i].source = 'robot'; project.vocals[i].buffer = null; }
    }
    changed(true);
    await renderMissingVoices();
    status.className = 'status ok';
    status.textContent = explanation || 'Fertig! Mit ↶ kannst du es rückgängig machen.';
  } catch (e) {
    status.className = 'status err';
    status.textContent = e.message || String(e);
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- Patterns

function renderPatternBar() {
  const bar = $('#pattern-bar');
  bar.replaceChildren(...PATTERN_NAMES.map((n, i) => el('button', {
    class: 'btn pat-btn' + (i === ui.editPattern ? ' active' : ''),
    'aria-pressed': i === ui.editPattern ? 'true' : 'false',
    title: `Pattern ${n} bearbeiten (Taste ${i + 1})`,
    onclick: () => selectPattern(i),
  }, n)));
  const ct = $('#copy-target');
  ct.replaceChildren(...PATTERN_NAMES.map((n, i) => el('option', { value: i, disabled: i === ui.editPattern }, `→ ${n}`)));
  ct.value = String((ui.editPattern + 1) % 4);
}

function selectPattern(i) {
  ui.editPattern = i;
  seq.editPattern = i;
  renderPatternBar();
  renderGrid();
  renderRoll();
}

function initPatternActions() {
  $('#btn-copy').addEventListener('click', () => {
    const to = parseInt($('#copy-target').value, 10);
    if (to === ui.editPattern) return;
    commit();
    project.patterns[to] = clonePattern(pat());
    changed();
    toast(`Pattern ${PATTERN_NAMES[ui.editPattern]} → ${PATTERN_NAMES[to]} kopiert`);
  });
  $('#btn-clear').addEventListener('click', () => {
    commit();
    project.patterns[ui.editPattern] = emptyPattern();
    changed(true);
  });
}

function renderArrangement() {
  const box = $('#arrangement');
  const blocks = project.arrangement.map((pi, i) => el('button', {
    class: `btn arr-block p${pi}`,
    'data-i': i,
    title: `Block ${i + 1}: Pattern ${PATTERN_NAMES[pi]}`,
    onclick: () => { commit(); project.arrangement[i] = (pi + 1) % 4; changed(); renderArrangement(); },
    oncontextmenu: (e) => {
      e.preventDefault();
      if (project.arrangement.length <= 1) return;
      commit();
      project.arrangement.splice(i, 1);
      changed();
      renderArrangement();
    },
  }, el('span', { class: 'num' }, i + 1), PATTERN_NAMES[pi]));
  const add = el('button', {
    class: 'btn arr-block',
    title: 'Block hinzufügen',
    onclick: () => { commit(); project.arrangement.push(project.arrangement.at(-1) ?? 0); changed(); renderArrangement(); },
  }, '+');
  const del = el('button', {
    class: 'btn btn-small',
    onclick: () => {
      if (project.arrangement.length <= 1) return;
      commit();
      project.arrangement.pop();
      changed();
      renderArrangement();
    },
  }, 'Letzten löschen');
  const sd = stepDuration(project.bpm) * STEPS * project.arrangement.length;
  const len = el('span', { class: 'hint' }, `Länge: ${Math.floor(sd / 60)}:${String(Math.round(sd % 60)).padStart(2, '0')} min`);
  box.replaceChildren(...blocks, add, del, len);
}

// ---------------------------------------------------------------- Grid

function cellState(id, v) {
  const t = track(id);
  if (t.type === 'drum') {
    if (v <= 0) return { cls: '', txt: '' };
    return { cls: v > 0.9 ? 'on accent' : v < 0.5 ? 'ghost' : 'on', txt: '' };
  }
  if (t.type === 'vocal') return v >= 0 ? { cls: 'on', txt: String(v + 1) } : { cls: '', txt: '' };
  return null;
}

function melodicCells(id, arr) {
  // Liefert pro Step: {cls, txt} inkl. Haltedauer
  const res = new Array(STEPS).fill(null).map(() => ({ cls: '', txt: '' }));
  arr.forEach((n, i) => {
    if (!n) return;
    const midi = degreeToMidi(project.root, project.scale, n.deg, BASE_OCTAVE[id]);
    res[i] = { cls: 'on', txt: midiName(midi).replace('#', '♯') };
    for (let k = 1; k < n.len && i + k < STEPS; k++) if (!arr[i + k]) res[i + k] = { cls: 'tail', txt: '' };
  });
  return res;
}

function stepClasses(i) {
  return (i % 4 === 0 ? ' beat' : '') + (i === 16 ? ' bar' : '');
}

function renderGrid() {
  const grid = $('#grid');
  const rows = [];
  const nums = el('div', { class: 'track-row step-numbers' },
    el('div', { class: 'track-head' }),
    el('div', { class: 'cells' }, Array.from({ length: STEPS }, (_, i) => el('div', { class: 'cell' + stepClasses(i) }, i % 4 === 0 ? String(i / 4 + 1) : ''))));
  rows.push(nums);

  for (const t of TRACKS) {
    const mx = project.mixer[t.id];
    const head = el('div', { class: 'track-head' },
      el('span', { class: 'track-name', style: `--c:${t.color}`, title: 'Klick: vorhören' , onclick: () => previewTrack(t.id) }, t.name),
      el('button', { class: 'mini' + (mx.mute ? ' m-on' : ''), title: 'Stumm', 'aria-pressed': String(mx.mute), onclick: () => { mx.mute = !mx.mute; changed(); renderGrid(); } }, 'M'),
      el('button', { class: 'mini' + (mx.solo ? ' s-on' : ''), title: 'Solo', 'aria-pressed': String(mx.solo), onclick: () => { mx.solo = !mx.solo; changed(); renderGrid(); } }, 'S'),
      el('button', { class: 'mini', title: `${t.name} per KI neu generieren`, onclick: () => aiTrack(t.id) }, 'KI'),
      el('button', { class: 'mini opt', title: `${t.name} leicht variieren`, onclick: () => varyTrack(t.id) }, '~'),
      el('button', { class: 'mini opt', title: `${t.name} leeren`, onclick: () => clearTrack(t.id) }, '×'),
    );
    const arr = pat()[t.id];
    const states = t.type === 'melodic' ? melodicCells(t.id, arr) : arr.map((v) => cellState(t.id, v));
    const cells = el('div', { class: 'cells', 'data-track': t.id, style: `--c:${t.color}` },
      states.map((s, i) => el('div', { class: `cell${stepClasses(i)} ${s.cls}`, 'data-i': i }, s.txt)));
    rows.push(el('div', { class: 'track-row', 'data-row': t.id }, head, cells));
  }
  grid.replaceChildren(...rows);
  if (ui.playStep >= 0) setPlayStep(ui.playStep, true);
}

function refreshRow(id) {
  const t = track(id);
  const row = $(`.cells[data-track="${id}"]`);
  if (!row) return;
  const arr = pat()[id];
  const states = t.type === 'melodic' ? melodicCells(id, arr) : arr.map((v) => cellState(id, v));
  [...row.children].forEach((c, i) => {
    c.className = `cell${stepClasses(i)} ${states[i].cls}${i === ui.playStep && ui.playPattern === ui.editPattern ? ' play' : ''}`;
    c.textContent = states[i].txt;
  });
}

function aiTrack(id) {
  commit();
  const o = aiOpts();
  pat()[id] = ai.genTrack(o, id, pat(), project.scale);
  changed();
  refreshRow(id);
  if (id === ui.rollTrack) renderRoll();
}

function varyTrack(id) {
  commit();
  ai.mutateTrack(aiOpts(), pat(), id, parseFloat($('#ai-vary-amt').value));
  changed();
  refreshRow(id);
  if (id === ui.rollTrack) renderRoll();
}

function clearTrack(id) {
  commit();
  pat()[id] = emptyPattern()[id];
  changed();
  refreshRow(id);
  if (id === ui.rollTrack) renderRoll();
}

let paint = null;

function applyCell(id, i, mode) {
  const t = track(id);
  const p = pat();
  if (t.type === 'drum') {
    if (mode === 'cycle') {
      const v = p[id][i];
      p[id][i] = v <= 0 ? 0.8 : v > 0.9 ? 0.4 : v < 0.5 ? 0.8 : 1;
    } else {
      p[id][i] = mode;
    }
  } else if (t.type === 'vocal') {
    p.vocal[i] = mode === 'cycle' ? -1 : p.vocal[i] >= VOCAL_SLOTS - 1 ? -1 : p.vocal[i] + 1;
  } else {
    if (mode === 'cycle') {
      p[id][i] = null;
    } else if (p[id][i]) {
      p[id][i] = null;
    } else {
      p[id][i] = { deg: ui.lastDeg[id], len: ui.rollLen };
    }
  }
  refreshRow(id);
  if (id === ui.rollTrack) renderRoll();
}

function initGridEvents() {
  const grid = $('#grid');
  grid.addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cells[data-track] .cell');
    if (!cell || e.button !== 0) return;
    const id = cell.parentElement.dataset.track;
    const i = parseInt(cell.dataset.i, 10);
    commit();
    const t = track(id);
    if (t.type === 'drum') {
      const val = pat()[id][i] > 0 ? 0 : 0.8;
      applyCell(id, i, val);
      if (val > 0 && !seq.playing) previewTrack(id);
      if (e.pointerType === 'mouse') paint = { id, val };
    } else {
      applyCell(id, i, 'toggle');
      if (t.type === 'melodic' && pat()[id][i] && !seq.playing) previewTrack(id, pat()[id][i].deg);
      if (t.type === 'vocal' && pat().vocal[i] >= 0 && !seq.playing) previewVocal(pat().vocal[i]);
    }
    changed();
  });
  grid.addEventListener('pointermove', (e) => {
    if (!paint) return;
    const cell = document.elementFromPoint(e.clientX, e.clientY)?.closest('.cells[data-track] .cell');
    if (!cell || cell.parentElement.dataset.track !== paint.id) return;
    const i = parseInt(cell.dataset.i, 10);
    if (pat()[paint.id][i] !== paint.val) applyCell(paint.id, i, paint.val);
  });
  window.addEventListener('pointerup', () => { if (paint) { paint = null; changed(); } });
  grid.addEventListener('contextmenu', (e) => {
    const cell = e.target.closest('.cells[data-track] .cell');
    if (!cell) return;
    e.preventDefault();
    const id = cell.parentElement.dataset.track;
    const i = parseInt(cell.dataset.i, 10);
    commit();
    applyCell(id, i, 'cycle');
    changed();
  });
}

function setPlayStep(step, force = false, patternIdx = ui.playPattern) {
  if (step === ui.playStep && patternIdx === ui.playPattern && !force) return;
  document.querySelectorAll('.cell.play').forEach((c) => c.classList.remove('play'));
  ui.playStep = step;
  ui.playPattern = patternIdx;
  if (step < 0 || patternIdx !== ui.editPattern) return;
  document.querySelectorAll(`#grid .cells[data-track] .cell[data-i="${step}"], #roll .cell[data-i="${step}"]`).forEach((c) => c.classList.add('play'));
}

// ---------------------------------------------------------------- Piano-Roll

const ROLL_RANGE = { lead: [14, -3], bass: [3, -10] };

function initRoll() {
  const tr = $('#roll-track');
  for (const id of ['lead', 'bass']) {
    tr.append(el('button', { class: 'btn btn-small', 'data-id': id, onclick: () => { ui.rollTrack = id; renderRoll(); } }, track(id).name));
  }
  const lens = $('#roll-len');
  for (const l of [1, 2, 3, 4, 8]) {
    lens.append(el('button', { class: 'btn btn-small', 'data-len': l, onclick: () => { ui.rollLen = l; renderRoll(); } }, String(l)));
  }
  document.querySelectorAll('[data-roll]').forEach((b) => b.addEventListener('click', () => {
    const id = ui.rollTrack;
    const arr = pat()[id];
    const act = b.dataset.roll;
    commit();
    if (act === 'ai') pat()[id] = ai.genTrack(aiOpts(), id, pat(), project.scale);
    else if (act === 'clear') pat()[id] = new Array(STEPS).fill(null);
    else {
      const d = { 'oct-up': 7, 'oct-down': -7, up: 1, down: -1 }[act];
      arr.forEach((n) => { if (n) n.deg += d; });
    }
    changed();
    refreshRow(id);
    renderRoll();
  }));

  $('#roll').addEventListener('pointerdown', (e) => {
    const cell = e.target.closest('.cell[data-i]');
    if (!cell || e.button !== 0) return;
    const id = ui.rollTrack;
    const i = parseInt(cell.dataset.i, 10);
    const deg = parseInt(cell.parentElement.dataset.deg, 10);
    const arr = pat()[id];
    commit();
    if (e.shiftKey) {
      for (let k = i - 1; k >= 0; k--) {
        if (arr[k]) { arr[k].len = Math.min(8, i - k + 1); break; }
      }
    } else if (arr[i] && arr[i].deg === deg) {
      arr[i] = null;
    } else if (arr[i]) {
      arr[i].deg = deg;
    } else {
      arr[i] = { deg, len: ui.rollLen };
    }
    if (arr[i] && !e.shiftKey) {
      ui.lastDeg[id] = deg;
      if (!seq.playing) previewTrack(id, deg);
    }
    changed();
    refreshRow(id);
    renderRoll();
  });
}

function renderRoll() {
  const id = ui.rollTrack;
  document.querySelectorAll('#roll-track .btn').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  document.querySelectorAll('#roll-len .btn').forEach((b) => b.classList.toggle('active', Number(b.dataset.len) === ui.rollLen));
  const arr = pat()[id];
  const [hi, lo] = ROLL_RANGE[id];
  const cover = new Array(STEPS).fill(null);
  arr.forEach((n, i) => {
    if (!n) return;
    for (let k = 0; k < n.len && i + k < STEPS; k++) {
      if (k > 0 && arr[i + k]) break;
      cover[i + k] = { deg: n.deg, start: k === 0 };
    }
  });
  // Noten außerhalb des sichtbaren Bereichs trotzdem anzeigen
  const degs = arr.filter(Boolean).map((n) => n.deg);
  const top = Math.max(hi, ...degs);
  const bottom = Math.min(lo, ...degs);
  const rows = [];
  const color = track(id).color;
  for (let d = top; d >= bottom; d--) {
    const midi = degreeToMidi(project.root, project.scale, d, BASE_OCTAVE[id]);
    const isRoot = ((d % 7) + 7) % 7 === 0;
    rows.push(el('div', { class: 'track-row' + (isRoot ? ' row-root' : '') },
      el('div', { class: 'track-head' + (isRoot ? ' root' : '') }, midiName(midi)),
      el('div', { class: 'cells', 'data-deg': d, style: `--c:${color}` },
        Array.from({ length: STEPS }, (_, i) => {
          const c = cover[i];
          const cls = c && c.deg === d ? (c.start ? ' on' : ' tail') : '';
          return el('div', { class: `cell${stepClasses(i)}${cls}`, 'data-i': i });
        }))));
  }
  $('#roll').replaceChildren(...rows);
  if (ui.playStep >= 0) setPlayStep(ui.playStep, true);
}

// ---------------------------------------------------------------- Sound-Design

function renderSoundTabs() {
  const tabs = $('#sound-tabs');
  const all = [...TRACKS.map((t) => ({ id: t.id, name: t.name, color: t.color })), { id: 'master', name: 'Master', color: 'var(--accent)' }];
  tabs.replaceChildren(...all.map((t) => el('button', {
    class: 'btn btn-small tab',
    role: 'tab',
    style: `--c:${t.color}`,
    'aria-selected': String(ui.soundTab === t.id),
    onclick: () => { ui.soundTab = t.id; renderSoundTabs(); renderSound(); },
  }, t.name)));
}

function knob(def, value, onInput) {
  const fmt = (raw) => {
    const v = Number(raw);
    if (def.unit) return `${def.step >= 1 ? Math.round(v) : v.toFixed(def.step < 0.01 ? 3 : 2)} ${def.unit}`;
    if (def.max <= 1.5) return `${Math.round(v * 100)}%`;
    return def.step >= 1 ? String(Math.round(v)) : v.toFixed(1);
  };
  if (def.type === 'select') {
    const s = el('select', { id: `k-${ui.soundTab}-${def.key}` }, def.options.map((o) => el('option', { value: o }, o)));
    s.value = value;
    s.addEventListener('change', () => { commit(); onInput(s.value); changed(); });
    return el('label', { class: 'knob' }, el('span', { class: 'lbl' }, def.label), s);
  }
  const val = el('span', { class: 'val' }, fmt(value));
  const input = el('input', { type: 'range', min: def.min, max: def.max, step: def.step, value, id: `k-${ui.soundTab}-${def.key}` });
  bindSlider(input, (v) => { onInput(v); val.textContent = fmt(v); });
  return el('label', { class: 'knob' }, el('span', { class: 'lbl' }, def.label, val), input);
}

function renderSound() {
  const body = $('#sound-body');
  const id = ui.soundTab;
  if (id === 'master') {
    const defs = [
      { key: 'vol', label: 'Lautstärke', min: 0, max: 1, step: 0.01 },
      { key: 'drive', label: 'Master-Drive', min: 0, max: 1, step: 0.01 },
      { key: 'reverb', label: 'Reverb-Return', min: 0, max: 1.5, step: 0.01 },
      { key: 'duck', label: 'Sidechain-Pumpen', min: 0, max: 1, step: 0.01 },
    ];
    body.replaceChildren(
      el('div', { class: 'knobs' }, defs.map((d) => knob(d, project.master[d.key], (v) => { project.master[d.key] = v; if (d.key === 'vol') $('#master-vol').value = v; }))),
      el('p', { class: 'hint' }, 'Sidechain duckt Bass, Melodie und Vocals bei jedem Kick – das typische Pumpen.'),
    );
    return;
  }
  const s = project.sounds[id];
  const children = [];
  const actions = el('div', { class: 'btn-row' },
    el('button', { class: 'btn btn-small', onclick: () => previewTrack(id) }, '▶ Vorhören'),
    el('button', { class: 'btn btn-small', onclick: () => aiSound(id) }, 'KI-Sound'),
  );
  if (SOUND_PRESETS[id]) {
    const sel = el('select', { id: `preset-${id}`, 'aria-label': 'Preset' },
      el('option', { value: '' }, 'Preset wählen …'),
      Object.keys(SOUND_PRESETS[id]).map((n) => el('option', { value: n }, n)));
    sel.addEventListener('change', () => {
      if (!sel.value) return;
      commit();
      Object.assign(project.sounds[id], SOUND_PRESETS[id][sel.value]);
      changed();
      renderSound();
      previewTrack(id);
    });
    actions.prepend(sel);
  }
  children.push(actions);
  children.push(el('div', { class: 'knobs' }, PARAM_DEFS[id].map((d) => knob(d, s[d.key], (v) => {
    s[d.key] = v;
    if (id === 'lead' || id === 'bass') { refreshRow(id); }
  }))));
  const mx = project.mixer[id];
  children.push(el('div', { class: 'sub-title' }, 'Mixer'));
  children.push(el('div', { class: 'knobs' },
    knob({ key: 'vol', label: 'Lautstärke', min: 0, max: 1.2, step: 0.01 }, mx.vol, (v) => { mx.vol = v; }),
    knob({ key: 'rev', label: 'Reverb-Send', min: 0, max: 1, step: 0.01 }, mx.rev, (v) => { mx.rev = v; }),
    knob({ key: 'dly', label: 'Delay-Send', min: 0, max: 1, step: 0.01 }, mx.dly, (v) => { mx.dly = v; }),
  ));
  body.replaceChildren(...children);
}

function aiSound(id) {
  commit();
  const o = aiOpts();
  const s = ai.genSounds(o)[id];
  for (const d of PARAM_DEFS[id]) {
    if (d.type === 'select') {
      if (id === 'lead' && d.key === 'chord') s[d.key] = d.options[Math.floor(o.r() * d.options.length)];
      continue;
    }
    const span = d.max - d.min;
    const v = s[d.key] + (o.r() * 2 - 1) * span * 0.12;
    s[d.key] = Math.min(d.max, Math.max(d.min, d.step >= 1 ? Math.round(v) : v));
  }
  project.sounds[id] = s;
  changed();
  renderSound();
  previewTrack(id);
}

// ---------------------------------------------------------------- Vocals

async function renderSlotVoice(i) {
  const v = project.vocals[i];
  if (!v.text.trim()) return;
  v.buffer = await renderVoice(v.text, v.voice);
  v.bufferText = v.text;
  v.bufferVoice = v.voice;
  v.source = 'robot';
}

async function renderMissingVoices() {
  const c = engine.ctx; // kann null sein – renderVoice nutzt OfflineAudioContext
  for (let i = 0; i < project.vocals.length; i++) {
    const v = project.vocals[i];
    if (v.buffer) continue;
    if (v._audio && c) {
      try { v.buffer = dataToBuffer(c, v._audio); } catch (e) { /* ignore */ }
      continue;
    }
    if (v._audio) {
      // AudioBuffer lässt sich auch ohne laufenden Context bauen
      try { v.buffer = dataToBuffer(new OfflineAudioContext(1, 1, v._audio.sr), v._audio); continue; } catch (e) { /* ignore */ }
    }
    if (v.source !== 'recorded') {
      try { await renderSlotVoice(i); } catch (e) { console.warn(e); }
    }
  }
  renderVocals();
}

function renderVocals() {
  const box = $('#vocal-slots');
  box.replaceChildren(...project.vocals.map((v, i) => {
    const text = el('input', { type: 'text', id: `voc-text-${i}`, value: v.text, 'aria-label': `Text Slot ${i + 1}`, maxlength: 60 });
    const autoRender = async () => {
      if (v.source === 'recorded') return;
      await renderSlotVoice(i);
      renderVocals();
      previewVocal(i);
    };
    text.addEventListener('change', () => { commit(); v.text = text.value; changed(); autoRender(); });
    const voice = el('select', { id: `voc-voice-${i}`, 'aria-label': 'Stimme' }, Object.entries(VOICE_STYLES).map(([k, s]) => el('option', { value: k }, s.name)));
    voice.value = v.voice;
    voice.addEventListener('change', () => { commit(); v.voice = voice.value; changed(); autoRender(); });
    const dur = v.buffer ? `${v.buffer.duration.toFixed(2)} s` : 'leer';
    const src = { robot: 'Robo-Voice', recorded: 'Aufnahme/Sample', none: '' }[v.source] || '';
    const file = el('input', { type: 'file', accept: 'audio/*', hidden: true });
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        v.buffer = await decodeFile(ctx(), f);
        v.source = 'recorded';
        changed();
        renderVocals();
        previewVocal(i);
      } catch (e) {
        toast('Datei konnte nicht gelesen werden');
      }
    });
    const recording = ui.recordingSlot === i;
    return el('div', { class: 'vslot' },
      el('div', { class: 'vslot-num' }, String(i + 1)),
      el('div', { class: 'vslot-top' }, text, voice),
      el('div', { class: 'vslot-actions' },
        el('button', {
          class: 'btn btn-small btn-hot',
          onclick: async (e) => {
            v.text = text.value;
            e.target.disabled = true;
            try { await renderSlotVoice(i); changed(); renderVocals(); previewVocal(i); } finally { e.target.disabled = false; }
          },
        }, 'Robo-Voice'),
        el('button', { class: 'btn btn-small rec' + (recording ? ' on' : ''), onclick: () => toggleRecord(i) }, recording ? '■ Stopp' : '● Aufnehmen'),
        el('label', { class: 'btn btn-small file-btn' }, 'Sample laden', file),
        el('button', { class: 'btn btn-small', onclick: () => previewVocal(i), 'aria-label': `Slot ${i + 1} abspielen` }, '▶'),
        el('span', { class: 'vslot-info' }, [src, dur].filter(Boolean).join(' · ')),
      ));
  }));
}

async function toggleRecord(i) {
  if (ui.recordingSlot === i) {
    try {
      const buf = await ui.recorder.stop(ctx());
      project.vocals[i].buffer = buf;
      project.vocals[i].source = 'recorded';
      changed();
      previewVocal(i);
    } catch (e) {
      toast('Aufnahme fehlgeschlagen');
    }
    ui.recordingSlot = -1;
    ui.recorder = null;
    renderVocals();
    return;
  }
  if (ui.recorder) return toast('Es läuft schon eine Aufnahme');
  try {
    ctx();
    ui.recorder = new MicRecorder();
    await ui.recorder.start();
    ui.recordingSlot = i;
    renderVocals();
    toast('Aufnahme läuft – shout it!');
  } catch (e) {
    ui.recorder = null;
    toast('Kein Mikrofon-Zugriff möglich');
  }
}

// ---------------------------------------------------------------- Datei / Export

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

function fileBase() {
  return (project.name || 'hardcore-track').replace(/[^\w\-äöüÄÖÜß ]+/g, '').trim().replace(/\s+/g, '-') || 'track';
}

async function exportWav() {
  const btn = $('#btn-export');
  btn.disabled = true;
  const mode = $('#export-mode').value;
  toast('Rendere WAV …');
  try {
    const buf = await renderOffline(project, mode === 'loop' ? { patternOnly: ui.editPattern, loops: 4 } : {});
    download(encodeWav(buf), `${fileBase()}${mode === 'loop' ? '-pattern-' + PATTERN_NAMES[ui.editPattern] : ''}.wav`);
    toast(`WAV exportiert (${buf.duration.toFixed(1)} s)`);
  } catch (e) {
    console.error(e);
    toast('Export fehlgeschlagen: ' + e.message);
  } finally {
    btn.disabled = false;
  }
}

function saveFile() {
  const blob = new Blob([JSON.stringify(serialize(project, true))], { type: 'application/json' });
  download(blob, `${fileBase()}.hcv.json`);
}

async function loadFile(e) {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const p = hydrate(JSON.parse(await f.text()));
    if (!p) throw new Error('Ungültige Datei');
    commit();
    project = p;
    ui.editPattern = 0;
    changed(true);
    await renderMissingVoices();
    toast('Projekt geladen');
  } catch (err) {
    toast('Datei konnte nicht geladen werden');
  }
}

// ---------------------------------------------------------------- Loop / Visualizer

function frame() {
  const ev = seq.poll();
  if (ev) {
    setPlayStep(ev.step, false, ev.pattern);
    if (ev.step === 0) {
      document.querySelectorAll('.arr-block.playing, .pat-btn.playing').forEach((e) => e.classList.remove('playing'));
      if (seq.mode === 'song') {
        $(`.arr-block[data-i="${ev.block}"]`)?.classList.add('playing');
        if (ev.pattern !== ui.editPattern) selectPattern(ev.pattern); // Ansicht folgt dem Song
      }
      $('#pattern-bar').children[ev.pattern]?.classList.add('playing');
    }
  }
  drawScope();
  requestAnimationFrame(frame);
}

const scopeData = new Uint8Array(1024);
function drawScope() {
  const cv = $('#scope');
  const c = cv.getContext('2d');
  const w = cv.width;
  const h = cv.height;
  c.clearRect(0, 0, w, h);
  c.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent') || '#ffcf1a';
  c.lineWidth = 2;
  c.beginPath();
  if (engine.graph && seq.playing) {
    engine.graph.analyser.getByteTimeDomainData(scopeData);
    for (let i = 0; i < scopeData.length; i++) {
      const x = (i / scopeData.length) * w;
      const y = (scopeData[i] / 255) * h;
      if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
  } else {
    c.moveTo(0, h / 2);
    c.lineTo(w, h / 2);
  }
  c.stroke();
}

// ---------------------------------------------------------------- Init

function renderAll() {
  renderHeader();
  renderPatternBar();
  renderGrid();
  renderRoll();
  renderArrangement();
  renderSoundTabs();
  renderSound();
  renderVocals();
  $('#ai-style').value = project.style || $('#ai-style').value;
}

function initKeys() {
  window.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.code === 'Space') { e.preventDefault(); togglePlay(seq.playing ? seq.mode : 'pattern'); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (['1', '2', '3', '4'].includes(e.key)) selectPattern(parseInt(e.key, 10) - 1);
  });
}

initHeader();
initAI();
initPatternActions();
initGridEvents();
initRoll();
initKeys();
renderAll();
renderMissingVoices();
requestAnimationFrame(frame);
