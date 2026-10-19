// Musiktheorie-Helfer: Skalen, Notennamen, Umrechnung Skalenstufe -> MIDI

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export const SCALES = {
  minor: { name: 'Moll (natürlich)', steps: [0, 2, 3, 5, 7, 8, 10] },
  harmonic: { name: 'Harmonisch Moll', steps: [0, 2, 3, 5, 7, 8, 11] },
  phrygian: { name: 'Phrygisch', steps: [0, 1, 3, 5, 7, 8, 10] },
  freygish: { name: 'Phrygisch-Dominant', steps: [0, 1, 4, 5, 7, 8, 10] },
  major: { name: 'Dur', steps: [0, 2, 4, 5, 7, 9, 11] },
};

// Basis-Oktaven pro Spur (MIDI-Note der Stufe 0 ohne Grundton)
export const BASE_OCTAVE = { bass: 36, lead: 60 };

export function degreeToMidi(root, scaleId, degree, base) {
  const steps = (SCALES[scaleId] || SCALES.minor).steps;
  const len = steps.length;
  const oct = Math.floor(degree / len);
  const idx = ((degree % len) + len) % len;
  return base + root + oct * 12 + steps[idx];
}

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

export function midiName(m) {
  return NOTE_NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
