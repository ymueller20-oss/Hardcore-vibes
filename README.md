# HARDCORE VIBES 🔊

KI-gestütztes Browser-Studio für **Hardcore Techno** – Gabber, Frenchcore, Uptempo, Industrial, Terror, Happy Hardcore, Rawstyle.
Alles (Drums, Snare, Hi-Hats, Bass, Melodie, Vocals) lässt sich per KI erzeugen **und** danach komplett von Hand bearbeiten.
Keine Samples, kein Server: alle Sounds werden live mit der Web Audio API synthetisiert.

## Starten

ES-Module brauchen einen lokalen Webserver (Doppelklick auf `index.html` reicht nicht):

```bash
npm start            # öffnet http://localhost:8080
# oder
python3 -m http.server 8080
```

Dann im Browser (Chrome, Edge, Firefox, Safari) `http://localhost:8080` öffnen.

## Was die App kann

### KI
| Funktion | Was passiert |
|---|---|
| **Kompletten Track generieren** | Lokale KI baut je nach Stil BPM, Tonart, 4 Patterns (Intro / Build / Break / Drop), Arrangement, Sounds und Vocal-Texte inkl. Robo-Stimme |
| **Aktuelles Pattern neu** | Nur das gerade bearbeitete Pattern neu komponieren |
| **Variation** | Mutiert das Pattern behutsam (Stärke einstellbar) – gut gegen Monotonie |
| **KI-Button pro Spur** | Nur Kick, Snare, Clap, Hats, Bass, Melodie oder Vocals neu generieren – passend zur Akkordfolge der anderen Spuren |
| **KI-Sound** | Neues Sound-Design für ein Instrument im gewählten Stil |
| **Claude** (optional) | Beschreib den Track in Worten („düsterer Frenchcore, epische Melodie im Break …“). Claude sieht den aktuellen Projektzustand und kann den ganzen Track, nur das aktuelle Pattern, nur die Sounds oder nur die Vocal-Texte ändern |

Die lokale KI läuft offline und kostenlos (Regeln + Wahrscheinlichkeiten + Seed, d. h. Ergebnisse sind mit „Seed sperren“ reproduzierbar).
Für Claude brauchst du einen API-Key von [console.anthropic.com](https://console.anthropic.com). Der Key bleibt in deinem Browser und geht nur direkt an die Anthropic API (nur gespeichert, wenn du „merken“ anhakst).

**Jede KI-Aktion ist mit ↶ (Strg+Z) rückgängig zu machen.**

### Manuelle Kontrolle
- **Step-Sequencer**, 32 Steps (2 Takte) × 8 Spuren, 4 Patterns (A–D)
  - Klick = an/aus, mit der Maus ziehen = malen, Rechtsklick / langes Drücken = Velocity (normal → Akzent → Ghost)
  - Mute / Solo pro Spur
- **Piano-Roll** für Bass und Melodie: Tonhöhe, Notenlänge, Shift+Klick verlängert, Oktave/Stufe transponieren
  - Noten werden als Skalenstufen gespeichert → Tonart/Skala wechseln transponiert alles automatisch passend
- **Sound-Design** mit Reglern und Presets:
  - Kick: Start-/End-Pitch, Sweep, Tail, Distortion, Punch, Tone (Presets Gabber, Frenchcore, Uptempo, Industrial, Rawstyle …)
  - Snare, Clap, Hi-Hat, Open Hat (Choke), Bass (Offbeat-Saw, Rumble …)
  - Melodie: Supersaw, Hoover, Screech, Square, Pluck + Akkord-Modus (Quinte, Oktave, Dreiklang)
- **Mixer**: Lautstärke, Reverb- und Delay-Send pro Spur; Master-Drive, Kompressor/Limiter, Sidechain-Pumpen
- **Arrangement**: Blöcke aneinanderreihen, Song-Modus spielt alles ab
- **Vocals** (4 Slots): Text → Robo-Stimme (MC Shout, Roboter, Dämon, Hype), eigene Aufnahme per Mikrofon oder Sample-Datei laden; Pitch, Filter, Distortion, Gate

### Export & Speichern
- **WAV-Export** des ganzen Songs oder eines Pattern-Loops (offline gerendert, 44,1 kHz / 16 Bit)
- Projekt automatisch im Browser gespeichert, plus **Speichern/Laden** als `.hcv.json` (inkl. Aufnahmen)

### Tastatur
`Leertaste` Play/Stop · `1`–`4` Pattern wählen · `Strg+Z` / `Strg+Shift+Z` Undo/Redo

## Aufbau

```
index.html          Oberfläche
css/style.css       Design
js/main.js          UI-Logik, Undo, Speichern, Export
js/state.js         Datenmodell, Parameter, Presets
js/instruments.js   Synthese aller Instrumente (Web Audio)
js/audio.js         Mixer- und Master-Kette
js/sequencer.js     Scheduler, Offline-Render, WAV-Encoder
js/ai.js            Lokale KI (Stile, Pattern-, Melodie-, Sound-Generator)
js/claude.js        Claude-Anbindung (Prompt → JSON → Projekt)
js/voice.js         Formant-Robostimme, Mikrofon, Sample-Import
js/theory.js        Skalen & Noten
```
