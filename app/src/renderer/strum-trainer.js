// Strum Pattern Trainer tab logic: plays a fixed 8-slot (one measure of
// 8th notes) strum pattern as a click track, so the user can practice
// syncing their strumming hand's direction to a beat without needing to
// hold a chord shape or have any audio input connected. Reuses the same
// lookahead audio-scheduling approach as Metronome (see metronome.js) but
// schedules one of four distinct sounds per slot instead of a single click.

const StrumTrainer = (() => {
  const SLOT_COUNT = 8;

  // Slot symbols: D = downstroke, U = upstroke, X = percussive mute/chunk,
  // '.' = rest (no sound, but still shown so the grid stays legible and
  // slot positions don't shift between patterns of different density).
  const PRESETS = {
    quarter_downs: { label: 'All downstrokes (quarters)', pattern: ['D', '.', 'D', '.', 'D', '.', 'D', '.'] },
    pop_rock:      { label: 'Down-Down-Up-Up-Down-Up', pattern: ['D', '.', 'D', 'U', 'U', 'D', 'U', '.'] },
    with_mute:     { label: 'Down-Up-Mute-Up-Down-Up', pattern: ['D', '.', 'U', 'X', 'U', 'D', 'U', '.'] },
    custom:        { label: 'Custom', pattern: ['D', '.', '.', '.', '.', '.', '.', '.'] }
  };

  const SAVED_CUSTOM_KEY = 'guitar-app:strum-custom-pattern';
  const SAVED_PRESET_KEY = 'guitar-app:strum-preset';

  let audioContext = null;
  let nextSlotTime = 0;
  let currentSlot = 0;
  let schedulerTimer = null;
  let running = false;

  let bpm = 80;
  let presetKey = 'quarter_downs';

  const SCHEDULE_AHEAD_TIME = 0.1; // seconds
  const LOOKAHEAD_MS = 25;

  let els = {};

  function cacheEls() {
    els = {
      slider: document.getElementById('strum-bpm-slider'),
      number: document.getElementById('strum-bpm-number'),
      presetSelect: document.getElementById('strum-preset-select'),
      toggleBtn: document.getElementById('strum-toggle'),
      slotsContainer: document.getElementById('strum-slots'),
      hint: document.getElementById('strum-custom-hint')
    };
  }

  function currentPattern() {
    return PRESETS[presetKey].pattern;
  }

  function buildSlots() {
    els.slotsContainer.innerHTML = '';
    const pattern = currentPattern();
    const isCustom = presetKey === 'custom';
    pattern.forEach((symbol, idx) => {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'strum-slot';
      slot.dataset.index = String(idx);
      slot.dataset.symbol = symbol;
      slot.textContent = symbol === '.' ? '' : symbol;
      slot.disabled = !isCustom;
      if (isCustom) {
        slot.addEventListener('click', () => cycleSlot(idx));
      }
      els.slotsContainer.appendChild(slot);
    });
    els.hint.style.display = isCustom ? '' : 'none';
  }

  // Cycles a custom-pattern slot through D -> U -> X -> rest -> D...
  const CYCLE_ORDER = ['D', 'U', 'X', '.'];
  function cycleSlot(idx) {
    const pattern = PRESETS.custom.pattern;
    const cur = pattern[idx];
    const nextIdx = (CYCLE_ORDER.indexOf(cur) + 1) % CYCLE_ORDER.length;
    pattern[idx] = CYCLE_ORDER[nextIdx];
    saveCustomPattern();
    buildSlots();
  }

  function saveCustomPattern() {
    try {
      localStorage.setItem(SAVED_CUSTOM_KEY, JSON.stringify(PRESETS.custom.pattern));
    } catch (err) {
      console.warn('Failed to save custom strum pattern:', err);
    }
  }

  function loadCustomPattern() {
    try {
      const raw = localStorage.getItem(SAVED_CUSTOM_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length === SLOT_COUNT && parsed.every((s) => CYCLE_ORDER.includes(s))) {
        PRESETS.custom.pattern = parsed;
      }
    } catch (err) {
      console.warn('Failed to load custom strum pattern:', err);
    }
  }

  // Each stroke type gets a distinct, short percussive sound so the user
  // can tell direction apart by ear, not just by watching the screen:
  // downstroke = low accented tone, upstroke = higher/softer tone,
  // mute/chunk = short noisy thock (filtered noise burst, no clear pitch,
  // mimicking a palm-muted strum).
  function playDown(time) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1100;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.35, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.06);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.07);
  }

  function playUp(time) {
    const osc = audioContext.createOscillator();
    const gain = audioContext.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1700;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.2, time + 0.001);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    osc.connect(gain);
    gain.connect(audioContext.destination);
    osc.start(time);
    osc.stop(time + 0.05);
  }

  function playMute(time) {
    // Short filtered noise burst for a percussive "chunk" with no clear pitch.
    const bufferSize = Math.floor(audioContext.sampleRate * 0.05);
    const buffer = audioContext.createBuffer(1, bufferSize, audioContext.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = audioContext.createBufferSource();
    noise.buffer = buffer;

    const filter = audioContext.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 800;
    filter.Q.value = 0.8;

    const gain = audioContext.createGain();
    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.045);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(audioContext.destination);
    noise.start(time);
    noise.stop(time + 0.05);
  }

  function scheduleSlot(slotIndex, time, symbol) {
    if (symbol === 'D') playDown(time);
    else if (symbol === 'U') playUp(time);
    else if (symbol === 'X') playMute(time);
    // '.' (rest) plays no sound but still gets a visual flash below.

    const delayMs = Math.max(0, (time - audioContext.currentTime) * 1000);
    setTimeout(() => flashSlot(slotIndex), delayMs);
  }

  function flashSlot(slotIndex) {
    const cells = els.slotsContainer.children;
    Array.from(cells).forEach((c) => c.classList.remove('flash'));
    const cell = cells[slotIndex];
    if (cell) {
      cell.classList.add('flash');
      setTimeout(() => cell.classList.remove('flash'), 100);
    }
  }

  function nextSlot() {
    // 8 slots per measure = 8th notes, so each slot is a half-beat.
    const secondsPerSlot = 60.0 / bpm / 2;
    nextSlotTime += secondsPerSlot;
    currentSlot = (currentSlot + 1) % SLOT_COUNT;
  }

  function scheduler() {
    const pattern = currentPattern();
    while (nextSlotTime < audioContext.currentTime + SCHEDULE_AHEAD_TIME) {
      scheduleSlot(currentSlot, nextSlotTime, pattern[currentSlot]);
      nextSlot();
    }
    schedulerTimer = setTimeout(scheduler, LOOKAHEAD_MS);
  }

  function start() {
    if (running) return;
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    currentSlot = 0;
    nextSlotTime = audioContext.currentTime + 0.05;
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
    Array.from(els.slotsContainer.children).forEach((c) => c.classList.remove('flash'));
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

  function init() {
    cacheEls();
    loadCustomPattern();

    const savedPreset = localStorage.getItem(SAVED_PRESET_KEY);
    if (savedPreset && PRESETS[savedPreset]) {
      presetKey = savedPreset;
      els.presetSelect.value = presetKey;
    }

    buildSlots();
    updateSliderFill();

    els.slider.addEventListener('input', () => setBpm(els.slider.value));
    els.number.addEventListener('input', () => setBpm(els.number.value || 80));
    els.presetSelect.addEventListener('change', () => {
      presetKey = els.presetSelect.value;
      localStorage.setItem(SAVED_PRESET_KEY, presetKey);
      buildSlots();
    });
    els.toggleBtn.addEventListener('click', toggle);
  }

  function stopIfRunning() {
    if (running) stop();
  }

  return { init, stop: stopIfRunning };
})();
