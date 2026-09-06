# Guitar Trainer

A free, local-first practice toolkit for beginner guitar: a small Electron desktop
app (tuner, metronome, strum pattern trainer, chord/note recognition drill, and a
tab library) plus a markdown curriculum that teaches **chords and songs first, not
music theory**.

No accounts, no cloud, no telemetry — everything runs on your machine.

## What's in here

```
guitar-trainer/
  curriculum/     A chords-and-songs-first lesson plan (plain markdown)
  app/            The Electron practice app (tuner, metronome, strum trainer,
                  chord/note drill, tabs)
  tabs/           Your saved tab library lives here once you start using the app
```

- **[curriculum/](curriculum/00-overview.md)** — start here if you're brand new to
  guitar. No prior music theory assumed.
- **[app/](app/README.md)** — the desktop app itself; see that README for setup,
  audio input notes, difficulty tiers, and a tour of each screen.

## Quick start

Requires [Node.js](https://nodejs.org/) (LTS).

```bash
git clone https://github.com/xJeris/guitar-trainer.git
cd guitar-trainer/app
npm install
npm run dev
```

On Windows, you can instead just double-click `launch.bat` in the repo root —
it runs `npm install` on first launch and then starts the app for you.

See [app/README.md](app/README.md) for details on selecting an audio input
(USB interface or plain microphone both work) and what each of the five
screens does.

## Philosophy

Guitar doesn't require music theory to learn. Theory only shows up in the
curriculum when it makes the next physical thing easier — "these two chords
share two fingers" is useful; naming a scale mode is not, at least not yet.
See [curriculum/00-overview.md](curriculum/00-overview.md) for the full
philosophy and pacing guide.

## License

[MIT](LICENSE)
