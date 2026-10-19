// Optionale Claude-Anbindung: Text-Prompt -> kompletter Track (oder Teile davon) als JSON.
// Der API-Key bleibt im Browser und geht nur direkt an die Anthropic API.

import { STEPS, TRACKS, DRUM_IDS, PATTERN_NAMES, PARAM_DEFS, clampParams, emptyPattern } from './state.js';
import { NOTE_NAMES, SCALES } from './theory.js';

const SDK_URL = 'https://cdn.jsdelivr.net/npm/@anthropic-ai/sdk@0.131.0/+esm';

export const MODELS = [
  { id: 'claude-opus-5-5', name: 'Claude Opus 5.5 (beste Qualität)' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5 (schneller)' },
  { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5 (am günstigsten)' },
];

export const SCOPES = {
  song: 'Ganzer Track (alle Patterns, Sounds, Arrangement)',
  pattern: 'Nur aktuelles Pattern',
  sounds: 'Nur Sound-Design',
  vocals: 'Nur Vocal-Texte',
};

function paramList(id) {
  return PARAM_DEFS[id]
    .map((d) => (d.type === 'select' ? `${d.key} (${d.options.join('|')})` : `${d.key} (${d.min}-${d.max})`))
    .join(', ');
}

const SYSTEM = `Du bist ein erfahrener Hardcore-Techno-Produzent (Gabber, Frenchcore, Uptempo, Industrial, Terror, Happy Hardcore, Rawstyle) und steuerst einen Browser-Step-Sequencer.
Du bekommst den aktuellen Projektzustand als JSON und eine Anweisung des Nutzers. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt (kein Markdown, kein Text davor oder danach) im selben Format.

FORMAT:
{
  "explanation": "1-2 Sätze auf Deutsch, was du gemacht hast",
  "bpm": 150-300,
  "root": "C" | "C#" | ... | "B",
  "scale": ${Object.keys(SCALES).map((s) => `"${s}"`).join(' | ')},
  "swing": 0-0.5,
  "sounds": { <spur>: { <param>: wert } },
  "patterns": [ { "name": "A", "kick": "...", "snare": "...", "clap": "...", "hat": "...", "openhat": "...", "bass": [[step, deg, len], ...], "lead": [[step, deg, len], ...], "vocal": "..." } ],
  "arrangement": "AABBDDDDCCDD",
  "vocals": ["TEXT SLOT 1", "TEXT SLOT 2", "TEXT SLOT 3", "TEXT SLOT 4"]
}

REGELN:
- Jedes Pattern hat ${STEPS} Steps (2 Takte à 16 Sechzehntel). Steps 0,4,8,... sind Viertel (Kick-Positionen bei Four-on-the-floor).
- Drum-Strings sind genau ${STEPS} Zeichen: "." = aus, "g" = leise (Ghost), "x" = normal, "X" = Akzent.
- "vocal" ist ein ${STEPS}-Zeichen-String: "." = nichts, "1"-"4" = spielt Vocal-Slot 1-4 ab diesem Step.
- bass/lead: Liste von [step 0-${STEPS - 1}, deg, len 1-8]. deg = Skalenstufe relativ zum Grundton (0 = Grundton, 7 = Oktave höher, negative Werte tiefer). Monophon: max. eine Note pro Step. Lead sinnvoll -3..14, Bass -9..7.
- Bis zu 4 Patterns (A-D). Ein typischer Aufbau: A = Intro, B = Build, C = Break (ohne Kick, Melodie im Fokus, Snare-Roll), D = Drop (alles). Gib in jedem zurückgegebenen Pattern ALLE 8 Spuren an.
- arrangement: String aus A-D, 4-32 Blöcke; jeder Block = ein Pattern (2 Takte).
- vocals: kurze, kraftvolle Shouts/Phrasen (1-4 Wörter, GROSSBUCHSTABEN). Sie werden von einer Robo-Stimme gesprochen.
- Sounds: nur Parameter aus der Liste unten, Werte im angegebenen Bereich.
- Felder, die du nicht ändern willst, darfst du weglassen.

SOUND-PARAMETER:
${TRACKS.map((t) => `${t.id}: ` + (paramList(t.id))).join('\n')}`;

let sdkPromise = null;

function encodeDrums(arr) {
  return arr.map((v) => (v <= 0 ? '.' : v <= 0.45 ? 'g' : v <= 0.85 ? 'x' : 'X')).join('');
}

function decodeDrums(str) {
  const out = new Array(STEPS).fill(0);
  if (typeof str !== 'string') return null;
  for (let i = 0; i < STEPS && i < str.length; i++) {
    out[i] = { g: 0.4, x: 0.8, X: 1 }[str[i]] || 0;
  }
  return out;
}

function encodeNotes(arr) {
  const out = [];
  arr.forEach((n, i) => n && out.push([i, n.deg, n.len]));
  return out;
}

function decodeNotes(list, lo, hi) {
  if (!Array.isArray(list)) return null;
  const out = new Array(STEPS).fill(null);
  for (const item of list) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const step = Math.round(Number(item[0]));
    const deg = Math.round(Number(item[1]));
    const len = Math.round(Number(item[2] ?? 1));
    if (!(step >= 0 && step < STEPS) || !Number.isFinite(deg)) continue;
    out[step] = { deg: Math.max(lo, Math.min(hi, deg)), len: Math.max(1, Math.min(8, len || 1)) };
  }
  return out;
}

function encodeVocal(arr) {
  return arr.map((v) => (v >= 0 ? String(v + 1) : '.')).join('');
}

function decodeVocal(str) {
  if (typeof str !== 'string') return null;
  const out = new Array(STEPS).fill(-1);
  for (let i = 0; i < STEPS && i < str.length; i++) {
    const n = parseInt(str[i], 10);
    if (n >= 1 && n <= 4) out[i] = n - 1;
  }
  return out;
}

export function encodeProject(project) {
  return {
    bpm: project.bpm,
    root: NOTE_NAMES[project.root],
    scale: project.scale,
    swing: project.swing,
    sounds: project.sounds,
    patterns: project.patterns.map((p, i) => {
      const o = { name: PATTERN_NAMES[i] };
      for (const id of DRUM_IDS) o[id] = encodeDrums(p[id]);
      o.bass = encodeNotes(p.bass);
      o.lead = encodeNotes(p.lead);
      o.vocal = encodeVocal(p.vocal);
      return o;
    }),
    arrangement: project.arrangement.map((i) => PATTERN_NAMES[i]).join(''),
    vocals: project.vocals.map((v) => v.text),
  };
}

function decodePattern(src, base) {
  const p = base ? JSON.parse(JSON.stringify(base)) : emptyPattern();
  for (const id of DRUM_IDS) {
    const d = decodeDrums(src[id]);
    if (d) p[id] = d;
  }
  const b = decodeNotes(src.bass, -14, 10);
  if (b) p.bass = b;
  const l = decodeNotes(src.lead, -7, 16);
  if (l) p.lead = l;
  const v = decodeVocal(src.vocal);
  if (v) p.vocal = v;
  return p;
}

function extractJson(text) {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('Claude hat kein JSON geliefert.');
  return JSON.parse(text.slice(start, end + 1));
}

// Wendet das Claude-Ergebnis auf eine Kopie des Projekts an. Gibt {project, explanation, vocalsChanged} zurück.
export function applyResult(project, res, scope, currentPattern) {
  const p = JSON.parse(JSON.stringify({ ...project, vocals: project.vocals.map((v) => ({ ...v, buffer: null })) }));
  p.vocals.forEach((v, i) => { v.buffer = project.vocals[i].buffer; });
  let vocalsChanged = [];

  if (scope === 'song') {
    if (Number.isFinite(res.bpm)) p.bpm = Math.round(Math.max(100, Math.min(320, res.bpm)));
    if (typeof res.root === 'string' && NOTE_NAMES.includes(res.root.toUpperCase())) p.root = NOTE_NAMES.indexOf(res.root.toUpperCase());
    if (SCALES[res.scale]) p.scale = res.scale;
    if (Number.isFinite(res.swing)) p.swing = Math.max(0, Math.min(0.5, res.swing));
  }

  if ((scope === 'song' || scope === 'sounds') && res.sounds && typeof res.sounds === 'object') {
    for (const t of TRACKS) {
      if (res.sounds[t.id]) Object.assign(p.sounds[t.id], clampParams(t.id, res.sounds[t.id]));
    }
  }

  if (Array.isArray(res.patterns)) {
    if (scope === 'song') {
      res.patterns.slice(0, 4).forEach((src, i) => {
        const idx = PATTERN_NAMES.indexOf(String(src.name || '').toUpperCase());
        const target = idx >= 0 ? idx : i;
        p.patterns[target] = decodePattern(src, p.patterns[target]);
      });
    } else if (scope === 'pattern' && res.patterns.length) {
      const src = res.patterns.find((x) => String(x.name || '').toUpperCase() === PATTERN_NAMES[currentPattern]) || res.patterns[0];
      p.patterns[currentPattern] = decodePattern(src, p.patterns[currentPattern]);
    }
  }

  if (scope === 'song' && typeof res.arrangement === 'string') {
    const arr = [...res.arrangement.toUpperCase()].map((c) => PATTERN_NAMES.indexOf(c)).filter((i) => i >= 0);
    if (arr.length) p.arrangement = arr.slice(0, 64);
  }

  if ((scope === 'song' || scope === 'vocals') && Array.isArray(res.vocals)) {
    res.vocals.slice(0, 4).forEach((txt, i) => {
      if (typeof txt === 'string' && txt.trim() && txt.trim() !== p.vocals[i].text) {
        p.vocals[i].text = txt.trim().slice(0, 60);
        vocalsChanged.push(i);
      }
    });
  }

  return { project: p, explanation: typeof res.explanation === 'string' ? res.explanation : '', vocalsChanged };
}

async function loadSdk() {
  if (!sdkPromise) sdkPromise = import(SDK_URL);
  return (await sdkPromise).default;
}

export async function askClaude({ apiKey, model, prompt, project, scope, currentPattern }) {
  const Anthropic = await loadSdk();
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });

  const userText = `AKTUELLER PROJEKTZUSTAND:
${JSON.stringify(encodeProject(project))}

UMFANG: ${SCOPES[scope]}${scope === 'pattern' ? ` (Pattern ${PATTERN_NAMES[currentPattern]}; gib genau dieses eine Pattern zurück)` : ''}

ANWEISUNG DES NUTZERS:
${prompt || 'Überrasche mich mit einem fetten Hardcore-Track.'}`;

  const params = {
    model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: 'medium' },
    messages: [{ role: 'user', content: userText }],
  };

  let resp;
  try {
    // Server-seitiger Fallback auf ein anderes Modell, falls eine Anfrage fälschlich abgelehnt wird
    resp = model === 'claude-haiku-5-5'
      ? await client.messages.create(params)
      : await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new Error('API-Key ungültig. Bitte prüfen.');
    if (e instanceof Anthropic.RateLimitError) throw new Error('Rate-Limit erreicht – kurz warten und nochmal versuchen.');
    if (e instanceof Anthropic.APIConnectionError) throw new Error('Keine Verbindung zur Anthropic API.');
    if (e instanceof Anthropic.APIError) throw new Error(`API-Fehler ${e.status ?? ''}: ${e.message}`);
    throw e;
  }

  if (resp.stop_reason === 'refusal') throw new Error('Claude hat die Anfrage abgelehnt. Formuliere sie anders.');
  const text = resp.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  if (resp.stop_reason === 'max_tokens' && !text.includes('}')) throw new Error('Antwort wurde abgeschnitten – versuche einen kleineren Umfang.');
  return extractJson(text);
}
