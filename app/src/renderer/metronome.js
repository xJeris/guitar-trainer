// Metronome tab logic: Web Audio-based click generator (no audio assets).

const Metronome = (() => {
  let audioContext = null;
  let nextNoteTime = 0;
  let currentBeat = 0;
  let schedulerTimer = null;
  let running = false;

  let bpm = 80;
  let beatsPerMeasure = 4;

  const SCHEDULE_AHEAD_TIME = 0.1; // seconds
  const LOOKAHEAD_MS = 25;

  let els = {};
  let tapTimes = [];

  function cacheEls() {
    els = {
      slider: document.getElementById('bpm-slider'),
      number: document.getElementById('bpm-number'),
      beatsSelect: document.getElementById('beats-per-measure'),
      toggleBtn: document.getElementById('metronome-toggle'),
      tapBtn: document.getElementById('tap-tempo'),
      dotsContainer: document.getElementById('beat-dots')
    };
  }

  function buildDots() {
    els.dotsContainer.innerHTML = '';
    for (let i = 0; i < beatsPerMeasure; i++) {
      const dot = document.createElement('div');
      dot.className = 'beat-dot';
      els.dotsContainer.appendChild(dot);
    }
  }

  function playClick(time, isAccent) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();

    osc.frequency.value = isAccent ? 1500 : 1000;
    osc.type = 'sine';

    // Short percussive envelope so it sounds like a click, not a tone.
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(isAccent ? 0.35 : 0.22, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);

    osc.connect(gain);
    gain.connect(audioContext.destination);

    osc.start(time);
    osc.stop(time + 0.06);
  }

  function scheduleNote(beatNumber, time) {
    playClick(time, beatNumber === 0);

    // Schedule the visual flash to happen as close to `time` as possible.
    const delayMs = Math.max(0, (time - audioContext.currentTime) * 1000);
    setTimeout(() => flashBeat(beatNumber), delayMs);
  }

  function flashBeat(beatNumber) {
    const dots = els.dotsContainer.children;
    Array.from(dots).forEach((d) => d.classList.remove('flash', 'accent'));
    const dot = dots[beatNumber];
    if (dot) {
      dot.classList.add('flash');
      if (beatNumber === 0) dot.classList.add('accent');
      setTimeout(() => dot.classList.remove('flash', 'accent'), 100);
    }
  }

  function nextNote() {
    const secondsPerBeat = 60.0 / bpm;
    nextNoteTime += secondsPerBeat;
    currentBeat = (currentBeat + 1) % beatsPerMeasure;
  }

  function scheduler() {
    while (nextNoteTime < audioContext.currentTime + SCHEDULE_AHEAD_TIME) {
      scheduleNote(currentBeat, nextNoteTime);
      nextNote();
    }
    schedulerTimer = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  function start() {
    if (running) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    currentBeat = 0;
    nextNoteTime = audioContext.currentTime + 0.05;
    running = true;
    scheduler();
    els.toggleBtn.textContent = 'Stop';
  }

  function stop() {
    running = false;
    if (schedulerTimer) clearTimeout(schedulerTimer);
    schedulerTimer = null;
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
    }
    els.toggleBtn.textContent = 'Start';
    Array.from(els.dotsContainer.children).forEach((d) => d.classList.remove('flash', 'accent'));
  }

  function toggle() {
    if (running) stop(); else start();
  }

  function setBpm(newBpm) {
    newBpm = Math.max(40, Math.min(220, Math.round(newBpm)));
    bpm = newBpm;
    els.slider.value = String(newBpm);
    els.number.value = String(newBpm);
    updateSliderFill();
  }

  function updateSliderFill() {
    const min = Number(els.slider.min) || 40;
    const max = Number(els.slider.max) || 220;
    const percent = ((bpm - min) / (max - min)) * 100;
    els.slider.style.setProperty('--range-fill', `${percent}%`);
  }

  function handleTapTempo() {
    const now = performance.now();
    tapTimes.push(now);
    // Only keep taps within the last 3 seconds — allows resetting the tap
    // sequence if the user pauses.
    tapTimes = tapTimes.filter((t) => now - t < 3000);
    if (tapTimes.length < 2) return;

    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) {
      intervals.push(tapTimes[i] - tapTimes[i - 1]);
    }
    const avgMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    const tappedBpm = 60000 / avgMs;
    setBpm(tappedBpm);
  }

  function init() {
    cacheEls();
    buildDots();
    updateSliderFill();

    els.slider.addEventListener('input', () => setBpm(els.slider.value));
    els.number.addEventListener('input', () => setBpm(els.number.value || 80));
    els.beatsSelect.addEventListener('change', () => {
      beatsPerMeasure = parseInt(els.beatsSelect.value, 10);
      currentBeat = 0;
      buildDots();
    });
    els.toggleBtn.addEventListener('click', toggle);
    els.tapBtn.addEventListener('click', handleTapTempo);
  }

  function stopIfRunning() {
    if (running) stop();
  }

  return { init, stop: stopIfRunning };
})();
