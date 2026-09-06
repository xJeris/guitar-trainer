# Guitar Practice Tools

A small Electron desktop app with five practice screens: a tuner, a metronome, a
strum pattern trainer, a chord/note recognition drill, and a plain-text tab library —
built to go alongside the chords-and-songs-first curriculum in `../curriculum/`. No
auth, no backend, no telemetry — everything runs locally in the app window.

## Running it

Easiest way (Windows): double-click `launch.bat` in the `Guitar` folder (one
level up from `app/`). It runs `npm install` for you on first run and then
`npm run dev`. If a `.node/` portable Node folder exists next to `launch.bat`
it's used automatically; otherwise it falls back to whatever Node is on your
system PATH.

## Running it manually (any OS)

Requires [Node.js](https://nodejs.org/) (LTS) installed and on your PATH.

```bash
cd <path-to-guitar-trainer>/app
npm install
npm run dev
```

`npm run dev` (and `npm start`) both just run `electron .` — this launches the
app window directly. There is no build/installer step; that's out of scope for
this project.

## Selecting your audio input

The **Tuner** and **Chord & Note Drill** tabs both need to listen to your guitar.
Any of these work:

- **A USB audio interface** (e.g. a Behringer UM2 or similar) — plug your guitar
  into its instrument input with a standard instrument cable, and if it has a
  gain knob, turn it up until the signal light flickers green (not red/clipping)
  when you pluck a string. Connect the interface to your computer via USB —
  it should show up like any other audio input device, no special drivers
  needed.
- **A microphone** (built-in laptop mic, USB mic, or headset) placed near your
  amp — works for casual practice, though pitch/chord detection is less
  reliable than a direct line-in signal.

Then, in the app:

1. Open the **Tuner** or **Chord & Note Drill** tab and pick your device from
   the "Audio input device" dropdown (the app tries to auto-select a likely
   audio interface if one is connected, based on its device name). Click
   **Refresh** if it doesn't show up right away, or if you plug it in after
   the app is already open.
2. The first time you do this, Windows/Electron may prompt for microphone
   permission — allow it, otherwise device names will stay hidden and capture
   will fail.
3. Click **Start Listening** on either tab to begin.

## The five tools

- **Tuner** — Listens to a single plucked string and shows the detected note
  name, how many cents sharp/flat it is, and a needle meter, with the six
  standard-tuning targets (E2 A2 D3 G3 B3 E4) highlighted as you get close.
- **Metronome** — Adjustable 40-220 BPM click (slider + number input, plus tap
  tempo) with a flashing visual beat indicator, so you can practice strumming
  in time without needing sound.
- **Strum Pattern Trainer** — Pick a strumming pattern (or build your own) and
  it plays a distinct sound per stroke — downstroke, upstroke, and a muted
  "chunk" — with a matching visual flash, so you can practice the actual
  down/up/mute rhythm of a strumming pattern instead of just a plain click.
  Three built-in patterns (straight downstrokes, the classic
  down-down-up-up-down-up pop/rock pattern, and a muting variant) plus a
  **Custom** pattern: click any of the 8 slots to cycle it through Down →
  Up → Mute → Rest. No audio input needed — like the Metronome, it doesn't
  listen to your guitar at all, it's playback only.
- **Chord & Note Drill** — Note mode asks you to play a specific string/fret
  and confirms when it hears the right pitch; Chord mode names a chord,
  listens to your strum, and gives approximate per-string feedback on which
  notes sounded and which may be buzzing or muted. A **Difficulty** dropdown
  (Beginner → Expert) controls how much of the fretboard/chord vocabulary is
  in play — see "Difficulty tiers" below. Tracks a simple score and streak
  for the session.
- **Tabs** — A local library for plain-text ASCII guitar tab (the 6-line
  per-string format from sites like Ultimate Guitar). Paste tab text directly
  or import a `.txt` file, give it a title, and it's saved to disk so it's
  still there next time you open the app. Includes an optional BPM-synced
  auto-scroll while viewing a tab. This is a viewer/library only — it doesn't
  parse or interpret fret numbers.

## Difficulty tiers (Chord & Note Drill)

Each tier is cumulative — picking a harder tier still includes everything from
the easier tiers below it, so you'll still see familiar targets mixed in.

| Tier | Notes | Chords |
|---|---|---|
| Beginner | Open strings only | Em, Am, C |
| Novice | + frets 1-3 | + G, D, Em7, Am7 |
| Intermediate | + frets 4-7 | + A, E, D7, G7, Dm |
| Advanced | + frets 8-12 | + F, B, Bm, F#m (first barre chords) |
| Expert | + frets 13-15 | + movable barre shapes further up the neck (C-shape/G-shape barre, Cm, F#) |

Barre chords only show up once you pick Advanced or Expert — if you're
following the curriculum's Stage 1-3 order, Beginner/Novice/Intermediate cover
everything you need without them.

## How the audio analysis works (so it's not a black box)

- **Pitch detection** (used by the Tuner and Note Drill) is a from-scratch
  autocorrelation implementation (`src/renderer/pitch-detect.js`) — a
  well-known, well-documented DSP technique. No third-party pitch-detection
  package is used.
- **Chord detection** (Chord Drill) is intentionally approximate: it checks
  frequency-bin energy near each expected note's fundamental (and second
  harmonic as a backup) using the Web Audio `AnalyserNode`'s FFT output, and
  scores a chord as "heard" once most of the expected strings show enough
  energy. This is directional feedback for a beginner, not a rigorous
  polyphonic pitch detector — real chord recognition from a single mic signal
  is a hard, unsolved-in-general problem, so treat it as a rough guide rather
  than ground truth.
- Saved tabs live as individual `.txt` files in `Guitar/tabs/` (one level up
  from this `app/` folder), with a small `index.json` alongside them tracking
  title/timestamps/source. They're plain visible files on purpose — browse,
  edit, or back them up like any other file. If you delete or move a `.txt`
  file directly (e.g. in Explorer), the app notices next time it lists tabs
  and quietly drops the stale entry instead of showing a broken tab.

## Project structure

```
app/
  package.json
  README.md
  src/
    main/
      main.js       # Electron entry point, window creation, tabs IPC handlers
      preload.js     # contextBridge: exposes window.tabsApi to the renderer
    renderer/
      index.html         # tab layout for all five screens
      styles.css          # all styling (dark theme, single stylesheet)
      pitch-detect.js      # autocorrelation pitch detection (shared)
      audio-engine.js      # getUserMedia + AnalyserNode wrapper (shared)
      tuner.js             # Tuner tab logic
      metronome.js         # Metronome tab logic
      strum-trainer.js     # Strum Pattern Trainer tab logic
      drill.js             # Chord & Note Drill tab logic
      tabs-library.js      # Tabs/Songs tab logic (paste/import/save/view)
      app.js               # tab switching + shared device-list setup
```
