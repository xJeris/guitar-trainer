// Tuner tab logic: wires up the AudioEngine + PitchDetect to the UI.

const Tuner = (() => {
  const engine = new AudioEngine();
  let rafId = null;

  const STANDARD_TUNING = ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'];

  let els = {};

  function cacheEls() {
    els = {
      select: document.getElementById('audio-input-select'),
      refreshBtn: document.getElementById('tuner-refresh-devices'),
      startBtn: document.getElementById('tuner-start'),
      stopBtn: document.getElementById('tuner-stop'),
      status: document.getElementById('tuner-status'),
      noteEl: document.getElementById('tuner-note'),
      freqEl: document.getElementById('tuner-freq'),
      needle: document.getElementById('meter-needle'),
      centsEl: document.getElementById('tuner-cents'),
      stringTargets: document.querySelectorAll('.string-target'),
      levelBar: document.getElementById('tuner-level-bar'),
      levelText: document.getElementById('tuner-level-text')
    };
  }

  /** Raw RMS of the buffer (0..~1), independent of pitch-detection thresholds. */
  function rmsOf(buffer) {
    let sum = 0;
    for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i];
    return Math.sqrt(sum / buffer.length);
  }

  function nearestStandardString(fullNoteName) {
    return STANDARD_TUNING.includes(fullNoteName) ? fullNoteName : null;
  }

  function updateStringHighlights(detectedFullName, cents) {
    els.stringTargets.forEach((el) => {
      el.classList.remove('nearby', 'in-tune');
      const note = el.dataset.note;
      if (note === detectedFullName) {
        if (Math.abs(cents) <= 5) {
          el.classList.add('in-tune');
        } else {
          el.classList.add('nearby');
        }
      }
    });
  }

  function renderNoResult() {
    els.noteEl.textContent = '--';
    els.freqEl.textContent = '0.0 Hz';
    els.centsEl.textContent = '0 cents';
    els.needle.style.setProperty('--needle-angle', '0deg');
    els.needle.classList.remove('in-tune');
    els.stringTargets.forEach((el) => el.classList.remove('nearby', 'in-tune'));
  }

  function resetLevel() {
    els.levelBar.style.width = '0%';
    els.levelText.textContent = '0%';
  }

  function tick() {
    if (!engine.listening) return;

    const buffer = engine.getTimeDomainData();

    if (buffer) {
      // RMS of ~1.0 is a full-scale (clipping) signal, so scale up for a
      // meter that's readable at normal playing volume rather than pinned
      // near 0 the whole time.
      const level = Math.min(1, rmsOf(buffer) * 4);
      els.levelBar.style.width = `${(level * 100).toFixed(0)}%`;
      els.levelText.textContent = `${(level * 100).toFixed(0)}%`;
    }

    const freq = buffer ? PitchDetect.autoCorrelate(buffer, engine.sampleRate) : -1;

    if (freq > 0) {
      const note = PitchDetect.frequencyToNote(freq);
      els.noteEl.textContent = note.fullName;
      els.freqEl.textContent = `${freq.toFixed(1)} Hz`;
      els.centsEl.textContent = `${note.cents > 0 ? '+' : ''}${note.cents} cents`;

      // Clamp cents to +/-50 and sweep the needle across a +/-45 degree
      // arc (VU-meter style pivot from the base), matching the dial drawn
      // in the meter-track background.
      const clamped = Math.max(-50, Math.min(50, note.cents));
      const angle = (clamped / 50) * 45;
      els.needle.style.setProperty('--needle-angle', `${angle}deg`);

      const inTune = Math.abs(note.cents) <= 5;
      els.needle.classList.toggle('in-tune', inTune);

      updateStringHighlights(note.fullName, note.cents);
    } else {
      renderNoResult();
    }

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
      els.status.textContent = 'Listening...';
      els.status.classList.add('live');
      els.startBtn.disabled = true;
      els.stopBtn.disabled = false;
      rafId = requestAnimationFrame(tick);
    } catch (err) {
      console.error('Tuner failed to start:', err);
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
    renderNoResult();
    resetLevel();
  }

  function init() {
    cacheEls();
    renderNoResult();

    els.startBtn.addEventListener('click', start);
    els.stopBtn.addEventListener('click', stop);
    els.refreshBtn.addEventListener('click', async () => {
      await AudioEngine.requestInitialPermission();
      await AudioEngine.populateDeviceList(els.select);
    });
  }

  return { init, stop, get engine() { return engine; } };
})();
