// Chord & Note Recognition Drill tab logic.

const Drill = (() => {
  const engine = new AudioEngine();
  let rafId = null;
  let mode = 'note';
  let currentTarget = null;

  let score = 0;
  let streak = 0;
  let bestStreak = 0;

  // Debounce so a single held note/chord doesn't rack up multiple hits.
  let lastJudgedAt = 0;
  const JUDGE_COOLDOWN_MS = 1200;

  // After a chord hit, a strummed chord's ring/sustain can easily outlast
  // JUDGE_COOLDOWN_MS (or even the delay before the next target appears).
  // Without this, the tail of the previous strum gets judged against the
  // *new* target and can register as a free, unplayed hit if the two
  // chords share notes (e.g. Em -> Em7). So after a hit, judging is
  // suspended until overall energy has actually dropped back down near the
  // noise floor at least once — i.e. the player actually stopped playing.
  let awaitingSilence = false;

  // Per-bin ambient noise floor captured by "Calibrate Noise Floor" (see
  // calibrate()). Chord judging requires energy to clear this floor by a
  // margin, not just an absolute threshold — otherwise room noise/hum/mic
  // self-noise sitting in the guitar's frequency range can look like a
  // played note. null until the user calibrates; falls back to a
  // conservative flat floor so the drill still works uncalibrated.
  let noiseFloor = null;
  const CALIBRATION_MS = 4000;
  const DEFAULT_NOISE_FLOOR = 20;
  const NOISE_MARGIN = 25;
  const SAVED_NOISE_FLOOR_KEY = 'guitar-app:drill-noise-floor';

  function saveNoiseFloor() {
    try {
      localStorage.setItem(SAVED_NOISE_FLOOR_KEY, JSON.stringify(noiseFloor));
    } catch (err) {
      console.warn('Failed to save noise floor:', err);
    }
  }

  function loadSavedNoiseFloor() {
    try {
      const raw = localStorage.getItem(SAVED_NOISE_FLOOR_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : null;
    } catch (err) {
      console.warn('Failed to load saved noise floor:', err);
      return null;
    }
  }

  // Beginner note-drill targets: open strings + a few easy fretted notes,
  // named as string + fret so a total beginner knows exactly what to play.
  // `string` is 1-6 (1 = high E, matching standard fretboard-diagram
  // convention) and `fret` is 0 for open. Used to draw the fretboard dot.
  // `finger` is the standard left-hand finger for fretted notes (1=index,
  // 2=middle, 3=ring, 4=pinky), null for open strings (no finger needed).
  const NOTE_TARGETS = [
    { label: 'Low E string, open (E2)', note: 'E2', string: 6, fret: 0, finger: null },
    { label: 'A string, open (A2)', note: 'A2', string: 5, fret: 0, finger: null },
    { label: 'D string, open (D3)', note: 'D3', string: 4, fret: 0, finger: null },
    { label: 'G string, open (G3)', note: 'G3', string: 3, fret: 0, finger: null },
    { label: 'B string, open (B3)', note: 'B3', string: 2, fret: 0, finger: null },
    { label: 'High E string, open (E4)', note: 'E4', string: 1, fret: 0, finger: null },
    { label: 'A string, 2nd fret (B2)', note: 'B2', string: 5, fret: 2, finger: 2 },
    { label: 'D string, 2nd fret (E3)', note: 'E3', string: 4, fret: 2, finger: 2 },
    { label: 'G string, 2nd fret (A3)', note: 'A3', string: 3, fret: 2, finger: 2 }
  ];

  // Beginner chord set with approximate note names per string actually
  // sounded in the open-position voicing (low to high). Muted/skipped
  // strings are omitted. This is intentionally simple/approximate per the
  // task scope — good enough for directional feedback, not exact.
  //
  // `shape` gives the standard open-position fingering for the fretboard
  // diagram: one entry per string, ordered string 1-6 = high E, B, G, D, A,
  // low E. Fret number, 0 = open, null = muted/not strummed. This is
  // separate from `notes` (which drives audio judging) since a couple of
  // chords here are voiced with a repeated/octave note that doesn't map
  // 1:1 to a single fret shape.
  // `fingers` parallels `shape` one-for-one: standard beginner left-hand
  // finger (1=index, 2=middle, 3=ring, 4=pinky) for each fretted note, null
  // for open/muted strings. Common textbook fingering, not the only valid
  // option, but a reasonable default for someone learning the shape fresh.
  const CHORD_TARGETS = {
    Em:  { label: 'E minor', notes: ['E2', 'B2', 'E3', 'G3', 'B3', 'E4'], shape: [0, 0, 0, 2, 2, 0], fingers: [null, null, null, 3, 2, null] },
    Am:  { label: 'A minor', notes: ['A2', 'E3', 'A3', 'C4', 'E4'], shape: [0, 1, 2, 2, 0, null], fingers: [null, 1, 2, 3, null, null] },
    C:   { label: 'C major', notes: ['C3', 'E3', 'G3', 'C4', 'E4'], shape: [0, 1, 0, 2, 3, null], fingers: [null, 1, null, 2, 3, null] },
    G:   { label: 'G major', notes: ['G2', 'B2', 'D3', 'G3', 'B3', 'G4'], shape: [3, 0, 0, 0, 2, 3], fingers: [4, null, null, null, 2, 3] },
    D:   { label: 'D major', notes: ['D3', 'A3', 'D4', 'F#4'], shape: [2, 3, 2, 0, null, null], fingers: [2, 3, 1, null, null, null] },
    Em7: { label: 'E minor 7', notes: ['E2', 'B2', 'D3', 'G3', 'B3', 'E4'], shape: [0, 0, 0, 0, 2, 0], fingers: [null, null, null, null, 2, null] },
    Am7: { label: 'A minor 7', notes: ['A2', 'E3', 'G3', 'C4', 'E4'], shape: [0, 1, 0, 2, 0, null], fingers: [null, 1, null, 2, null, null] },
    A:   { label: 'A major', notes: ['A2', 'E3', 'A3', 'C#4', 'E4'], shape: [0, 2, 2, 2, 0, null], fingers: [null, 3, 2, 1, null, null] },
    E:   { label: 'E major', notes: ['E2', 'B2', 'E3', 'G#3', 'B3', 'E4'], shape: [0, 0, 1, 2, 2, 0], fingers: [null, null, 1, 2, 3, null] }
  };

  let els = {};
  let showFretboard = true;

  function cacheEls() {
    els = {
      select: document.getElementById('drill-audio-input-select'),
      startBtn: document.getElementById('drill-start'),
      stopBtn: document.getElementById('drill-stop'),
      status: document.getElementById('drill-status'),
      calibrateBtn: document.getElementById('drill-calibrate'),
      calibrateStatus: document.getElementById('drill-calibrate-status'),
      modeRadios: document.querySelectorAll('input[name="drill-mode"]'),
      targetEl: document.getElementById('drill-target'),
      targetSubEl: document.getElementById('drill-target-sub'),
      nextBtn: document.getElementById('drill-next'),
      feedback: document.getElementById('drill-feedback'),
      chordBreakdown: document.getElementById('chord-string-breakdown'),
      fretboard: document.getElementById('drill-fretboard'),
      fretboardToggle: document.getElementById('drill-fretboard-toggle'),
      scoreEl: document.getElementById('drill-score'),
      streakEl: document.getElementById('drill-streak'),
      bestStreakEl: document.getElementById('drill-best-streak'),
      resetScoreBtn: document.getElementById('drill-reset-score')
    };
  }

  // ---- Fretboard diagram ----
  // Small SVG diagram, low-fret open-position view (frets 0-4). Draws
  // either a single dot (note mode) or one dot per fretted/open string plus
  // an "x" for muted strings (chord mode). Purely visual aid for beginners;
  // has no bearing on audio judging.

  const FRET_COUNT = 4;
  const NUT_X = 90;
  const FRET_SPACING = 74;
  const STRING_SPACING = 29;
  const TOP_Y = 32;
  const SVG_WIDTH = NUT_X + FRET_COUNT * FRET_SPACING + 32;
  const SVG_HEIGHT = TOP_Y + 5 * STRING_SPACING + 38;
  const STRING_NAMES = ['e', 'B', 'G', 'D', 'A', 'E']; // string 1 (high e) to 6 (low E)

  function stringY(stringNum) {
    // string 1 (high E) drawn at top, string 6 (low E) at bottom.
    return TOP_Y + (stringNum - 1) * STRING_SPACING;
  }

  function fretX(fretNum) {
    if (fretNum === 0) return NUT_X - 22;
    return NUT_X + (fretNum - 0.5) * FRET_SPACING;
  }

  function svgEl(tag, attrs) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function buildFretboardSvg(dots) {
    const svg = svgEl('svg', {
      viewBox: `0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`,
      width: SVG_WIDTH,
      height: SVG_HEIGHT
    });

    // Nut (thick line at fret 0).
    svg.appendChild(svgEl('line', {
      x1: NUT_X, x2: NUT_X, y1: stringY(1), y2: stringY(6),
      class: 'fretboard-nut'
    }));

    // Fret wires.
    for (let f = 1; f <= FRET_COUNT; f++) {
      const x = NUT_X + f * FRET_SPACING;
      svg.appendChild(svgEl('line', {
        x1: x, x2: x, y1: stringY(1), y2: stringY(6),
        class: 'fretboard-fret-wire'
      }));
    }

    // Strings, with the open-string name to the left of each.
    for (let s = 1; s <= 6; s++) {
      const y = stringY(s);
      svg.appendChild(svgEl('line', {
        x1: NUT_X, x2: NUT_X + FRET_COUNT * FRET_SPACING, y1: y, y2: y,
        class: 'fretboard-string-line'
      }));
      const nameLabel = svgEl('text', {
        x: 6, y: y + 5.5, class: 'fretboard-string-label'
      });
      nameLabel.textContent = STRING_NAMES[s - 1];
      svg.appendChild(nameLabel);
    }

    // Fret number labels below the board.
    for (let f = 1; f <= FRET_COUNT; f++) {
      const x = NUT_X + (f - 0.5) * FRET_SPACING;
      const label = svgEl('text', {
        x, y: stringY(6) + 28, class: 'fretboard-fret-label', 'text-anchor': 'middle'
      });
      label.textContent = String(f);
      svg.appendChild(label);
    }

    // Dots (or open/mute markers) per string.
    dots.forEach(({ string, fret, state, text }) => {
      const y = stringY(string);
      if (fret === null) {
        // Muted string: small "x" to the left of the nut.
        const x = fretX(0) - 16;
        const mark = svgEl('text', {
          x, y: y + 6, class: 'fretboard-fret-label fretboard-muted-marker',
          'text-anchor': 'middle'
        });
        mark.textContent = 'x';
        svg.appendChild(mark);
        return;
      }
      if (fret === 0) {
        // Open string: ring to the left of the nut.
        svg.appendChild(svgEl('circle', {
          cx: fretX(0), cy: y, r: 10, class: 'fretboard-open-marker'
        }));
        return;
      }
      const x = fretX(fret);
      const dotClass = 'fretboard-dot' + (state ? ` ${state}` : '');
      svg.appendChild(svgEl('circle', { cx: x, cy: y, r: 13, class: dotClass }));
      if (text) {
        const label = svgEl('text', { x, y: y + 0.5, class: 'fretboard-dot-label' });
        label.textContent = text;
        svg.appendChild(label);
      }
    });

    return svg;
  }

  function renderFretboard() {
    els.fretboard.innerHTML = '';
    if (!showFretboard || !currentTarget) return;

    let dots = [];
    if (currentTarget.type === 'note') {
      dots = [{
        string: currentTarget.string,
        fret: currentTarget.fret,
        text: currentTarget.finger ? String(currentTarget.finger) : null
      }];
    } else {
      const { shape, fingers } = CHORD_TARGETS[currentTarget.name];
      dots = shape.map((fret, idx) => ({
        string: idx + 1,
        fret,
        text: fingers[idx] ? String(fingers[idx]) : null
      }));
    }
    els.fretboard.appendChild(buildFretboardSvg(dots));
  }


  function pickRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function newTarget() {
    els.chordBreakdown.innerHTML = '';
    setFeedback('', '');

    if (mode === 'note') {
      currentTarget = { type: 'note', ...pickRandom(NOTE_TARGETS) };
      els.targetEl.textContent = currentTarget.note;
      els.targetSubEl.textContent = currentTarget.label;
    } else {
      const chordName = pickRandom(Object.keys(CHORD_TARGETS));
      const chordInfo = CHORD_TARGETS[chordName];
      currentTarget = { type: 'chord', name: chordName, ...chordInfo };
      els.targetEl.textContent = chordName;
      els.targetSubEl.textContent = `Strum ${chordInfo.label}`;

      chordInfo.notes.forEach((note) => {
        const chip = document.createElement('div');
        chip.className = 'chord-string-chip';
        chip.textContent = note;
        chip.dataset.note = note;
        els.chordBreakdown.appendChild(chip);
      });
    }

    renderFretboard();
    if (engine.listening) setFeedback('Listening...', 'listening');
  }

  function setFeedback(text, cls) {
    els.feedback.textContent = text;
    els.feedback.className = 'drill-feedback' + (cls ? ` ${cls}` : '');
  }

  function registerHit() {
    score += 1;
    streak += 1;
    bestStreak = Math.max(bestStreak, streak);
    updateScoreUI();
  }

  function registerMiss() {
    streak = 0;
    updateScoreUI();
  }

  function updateScoreUI() {
    els.scoreEl.textContent = String(score);
    els.streakEl.textContent = String(streak);
    els.bestStreakEl.textContent = String(bestStreak);
  }

  function resetScore() {
    score = 0;
    streak = 0;
    bestStreak = 0;
    updateScoreUI();
  }

  // ---- Note drill judging ----

  function judgeNote() {
    const buffer = engine.getTimeDomainData();
    const freq = buffer ? PitchDetect.autoCorrelate(buffer, engine.sampleRate) : -1;
    if (freq <= 0) return;

    const detected = PitchDetect.frequencyToNote(freq);
    const now = performance.now();
    if (now - lastJudgedAt < JUDGE_COOLDOWN_MS) return;

    if (detected.fullName === currentTarget.note) {
      lastJudgedAt = now;
      setFeedback(`Correct! Heard ${detected.fullName} (${detected.cents > 0 ? '+' : ''}${detected.cents}c)`, 'correct');
      registerHit();
      setTimeout(newTarget, 900);
    }
    // Wrong notes are simply not matched — we don't want to punish the
    // transient noise/pluck-in-progress as a "miss" mid-attempt. The user
    // can hit "New Target" to skip if stuck.
  }

  // ---- Chord drill judging ----
  // Approximate approach per the task scope: look at frequency-bin energy
  // near each expected note's fundamental (and its 2nd harmonic as a
  // backup, since guitar fundamentals can be weak on some strings/pickups).
  // This is directional, not a real polyphonic pitch detector.

  function binIndexForFreq(freq, binHz) {
    return Math.round(freq / binHz);
  }

  function energyNear(freqData, binHz, targetFreq, spreadBins) {
    const center = binIndexForFreq(targetFreq, binHz);
    let maxEnergy = 0;
    for (let i = -spreadBins; i <= spreadBins; i++) {
      const idx = center + i;
      if (idx >= 0 && idx < freqData.length) {
        maxEnergy = Math.max(maxEnergy, freqData[idx]);
      }
    }
    return maxEnergy;
  }

  // Noise floor for a given bin index: the calibrated per-bin ambient level
  // if available, otherwise a flat default. Returns the max floor over the
  // same bin window energyNear() scans, so a hit has to beat the noisiest
  // bin in that window, not just its own bin's floor.
  function floorNear(binHz, targetFreq, spreadBins) {
    if (!noiseFloor) return DEFAULT_NOISE_FLOOR;
    const center = binIndexForFreq(targetFreq, binHz);
    let maxFloor = 0;
    for (let i = -spreadBins; i <= spreadBins; i++) {
      const idx = center + i;
      if (idx >= 0 && idx < noiseFloor.length) {
        maxFloor = Math.max(maxFloor, noiseFloor[idx]);
      }
    }
    return maxFloor;
  }

  function judgeChord() {
    const freqData = engine.getFrequencyData();
    const binHz = engine.binHz;
    if (!freqData || !binHz) return;

    // Overall energy gate: don't judge on near-silence. Relative to the
    // calibrated floor (if any) so a noisy room doesn't get stuck unable to
    // ever clear a fixed absolute gate.
    const avgFloor = noiseFloor
      ? noiseFloor.reduce((a, b) => a + b, 0) / noiseFloor.length
      : DEFAULT_NOISE_FLOOR;
    const totalEnergy = freqData.reduce((a, b) => a + b, 0) / freqData.length;

    if (awaitingSilence) {
      // Previous chord's ring/sustain hasn't died down yet — don't judge
      // it against whatever the new target is. Once it drops near the
      // floor, the player has actually stopped, so resume judging.
      if (totalEnergy < avgFloor + 4) awaitingSilence = false;
      return;
    }

    if (totalEnergy < avgFloor + 4) return;

    const now = performance.now();
    if (now - lastJudgedAt < JUDGE_COOLDOWN_MS) return;

    const results = currentTarget.notes.map((note) => {
      const targetFreq = PitchDetect.noteNameToFrequency(note);
      const fundamentalEnergy = energyNear(freqData, binHz, targetFreq, 2);
      const secondHarmonicEnergy = energyNear(freqData, binHz, targetFreq * 2, 2);
      const fundamentalFloor = floorNear(binHz, targetFreq, 2);
      const harmonicFloor = floorNear(binHz, targetFreq * 2, 2);
      const hit =
        fundamentalEnergy > fundamentalFloor + NOISE_MARGIN ||
        secondHarmonicEnergy * 0.8 > harmonicFloor + NOISE_MARGIN;
      return { note, hit };
    });

    const hitCount = results.filter((r) => r.hit).length;
    const ratio = hitCount / results.length;

    // Update chip UI live so the user sees which strings are "sounding".
    results.forEach(({ note, hit }) => {
      const chip = els.chordBreakdown.querySelector(`[data-note="${CSS.escape(note)}"]`);
      if (chip) chip.classList.toggle('hit', hit);
    });

    if (ratio >= 0.6) {
      lastJudgedAt = now;
      awaitingSilence = true;
      const missed = results.filter((r) => !r.hit).map((r) => r.note);
      results.forEach(({ note, hit }) => {
        const chip = els.chordBreakdown.querySelector(`[data-note="${CSS.escape(note)}"]`);
        if (chip) chip.classList.toggle('miss', !hit);
      });

      if (missed.length === 0) {
        setFeedback(`Great strum! All strings of ${currentTarget.name} sounded.`, 'correct');
      } else {
        setFeedback(
          `Mostly good on ${currentTarget.name} — check: ${missed.join(', ')} (buzzing or muted?)`,
          'correct'
        );
      }
      registerHit();
      setTimeout(newTarget, 1400);
    }
  }

  function tick() {
    if (!engine.listening) return;
    if (mode === 'note') judgeNote();
    else judgeChord();
    rafId = requestAnimationFrame(tick);
  }

  async function start() {
    const deviceId = els.select.value;
    if (!deviceId) {
      els.status.textContent = 'No input device selected';
      return;
    }
    try {
      await engine.start(deviceId);
      awaitingSilence = false;
      els.status.textContent = 'Listening...';
      els.status.classList.add('live');
      els.startBtn.disabled = true;
      els.stopBtn.disabled = false;
      els.calibrateBtn.disabled = false;
      if (!currentTarget) newTarget();
      setFeedback('Listening...', 'listening');
      rafId = requestAnimationFrame(tick);
    } catch (err) {
      console.error('Drill failed to start:', err);
      els.status.textContent = `Error: ${err.message}`;
      els.status.classList.remove('live');
    }
  }

  function stop() {
    engine.stop();
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    els.status.textContent = 'Not listening';
    els.status.classList.remove('live');
    els.startBtn.disabled = false;
    els.stopBtn.disabled = true;
    els.calibrateBtn.disabled = true;
    setFeedback('', '');
  }

  // Sample ambient noise (room/AC/fan/mic self-noise, no guitar playing) for
  // CALIBRATION_MS and record the max per-bin level seen as that bin's
  // floor. Run with nothing played; chord judging then requires energy to
  // clear this floor by NOISE_MARGIN rather than a fixed absolute number.
  function calibrate() {
    if (!engine.listening) return;

    els.calibrateBtn.disabled = true;
    els.calibrateStatus.classList.remove('live');

    const sampled = new Float64Array(engine.analyser.frequencyBinCount);
    const startedAt = performance.now();

    function sampleTick() {
      const freqData = engine.getFrequencyData();
      if (freqData) {
        for (let i = 0; i < freqData.length; i++) {
          sampled[i] = Math.max(sampled[i], freqData[i]);
        }
      }
      const elapsed = performance.now() - startedAt;
      if (elapsed < CALIBRATION_MS) {
        const secondsLeft = Math.ceil((CALIBRATION_MS - elapsed) / 1000);
        els.calibrateStatus.textContent =
          `Listening for room noise, stay quiet... ${secondsLeft}s`;
        requestAnimationFrame(sampleTick);
      } else {
        noiseFloor = Array.from(sampled);
        saveNoiseFloor();
        const avg = Math.round(sampled.reduce((a, b) => a + b, 0) / sampled.length);
        els.calibrateStatus.textContent = `Calibrated (avg noise floor: ${avg}/255)`;
        els.calibrateStatus.classList.add('live');
        els.calibrateBtn.disabled = false;
      }
    }
    requestAnimationFrame(sampleTick);
  }

  function init() {
    cacheEls();
    updateScoreUI();
    showFretboard = els.fretboardToggle.checked;
    newTarget();

    const savedFloor = loadSavedNoiseFloor();
    if (savedFloor) {
      noiseFloor = savedFloor;
      const avg = Math.round(savedFloor.reduce((a, b) => a + b, 0) / savedFloor.length);
      els.calibrateStatus.textContent = `Calibrated (avg noise floor: ${avg}/255, saved)`;
      els.calibrateStatus.classList.add('live');
    }

    els.startBtn.addEventListener('click', start);
    els.stopBtn.addEventListener('click', stop);
    els.calibrateBtn.addEventListener('click', calibrate);
    els.nextBtn.addEventListener('click', newTarget);
    els.resetScoreBtn.addEventListener('click', resetScore);
    els.modeRadios.forEach((radio) => {
      radio.addEventListener('change', () => {
        if (radio.checked) {
          mode = radio.value;
          newTarget();
        }
      });
    });
    els.fretboardToggle.addEventListener('change', () => {
      showFretboard = els.fretboardToggle.checked;
      renderFretboard();
    });
  }

  return { init, stop, get engine() { return engine; } };
})();
