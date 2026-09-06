// Pitch detection using autocorrelation (ACF2+ style, a well-known public
// domain approach popularized by Chris Wilson's pitch-detection demos).
// No external libraries — this is a from-scratch implementation.

/**
 * Estimate the fundamental frequency of a time-domain audio buffer.
 * @param {Float32Array} buffer - time-domain samples
 * @param {number} sampleRate
 * @returns {number} frequency in Hz, or -1 if no confident pitch found
 */
function autoCorrelate(buffer, sampleRate) {
  const SIZE = buffer.length;

  // 1. Compute RMS to reject silence/noise floor.
  let rms = 0;
  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);
  if (rms < 0.01) return -1; // too quiet, likely no note being played

  // 2. Trim leading/trailing silence to focus the autocorrelation window.
  let r1 = 0;
  let r2 = SIZE - 1;
  const threshold = 0.2;
  for (let i = 0; i < SIZE / 2; i++) {
    if (Math.abs(buffer[i]) < threshold) { r1 = i; break; }
  }
  for (let i = 1; i < SIZE / 2; i++) {
    if (Math.abs(buffer[SIZE - i]) < threshold) { r2 = SIZE - i; break; }
  }

  const trimmed = buffer.slice(r1, r2);
  const newSize = trimmed.length;
  if (newSize < 512) return -1;

  // 3. Autocorrelation via direct sum (buffer sizes here are small enough,
  //    ~2048-4096 samples, that O(n^2/2) is fine at ~60fps on modern CPUs
  //    when we cap the lag search range as done below).
  const c = new Array(newSize).fill(0);
  for (let lag = 0; lag < newSize; lag++) {
    let sum = 0;
    for (let i = 0; i < newSize - lag; i++) {
      sum += trimmed[i] * trimmed[i + lag];
    }
    c[lag] = sum;
  }

  // 4. Find the first dip after lag 0, then find the max peak after that dip.
  //    This avoids locking onto the trivial zero-lag peak.
  let d = 0;
  while (d < newSize - 1 && c[d] > c[d + 1]) d++;

  let maxVal = -Infinity;
  let maxPos = -1;
  for (let i = d; i < newSize; i++) {
    if (c[i] > maxVal) {
      maxVal = c[i];
      maxPos = i;
    }
  }

  if (maxPos <= 0) return -1;

  let T0 = maxPos;

  // 5. Parabolic interpolation around the peak for sub-sample accuracy.
  const x1 = c[T0 - 1] ?? c[T0];
  const x2 = c[T0];
  const x3 = c[T0 + 1] ?? c[T0];
  const a = (x1 + x3 - 2 * x2) / 2;
  const b = (x3 - x1) / 2;
  if (a !== 0) {
    T0 = T0 - b / (2 * a);
  }

  if (T0 <= 0) return -1;

  const frequency = sampleRate / T0;

  // Guitar's usable range (with headroom): ~70Hz (below low E) to ~1200Hz
  // (well above high E's higher harmonics/frets).
  if (frequency < 60 || frequency > 1500) return -1;

  return frequency;
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const A4_FREQ = 440;
const A4_MIDI = 69;

/**
 * Convert a frequency in Hz to the nearest note info: name, octave, and
 * cents deviation from that note's equal-tempered pitch.
 */
function frequencyToNote(frequency) {
  if (!frequency || frequency <= 0) return null;

  const midiFloat = A4_MIDI + 12 * Math.log2(frequency / A4_FREQ);
  const midiRounded = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midiRounded) * 100);

  const noteIndex = ((midiRounded % 12) + 12) % 12;
  const octave = Math.floor(midiRounded / 12) - 1;
  const name = NOTE_NAMES[noteIndex];
  const noteFrequency = A4_FREQ * Math.pow(2, (midiRounded - A4_MIDI) / 12);

  return {
    name,
    octave,
    fullName: `${name}${octave}`,
    midi: midiRounded,
    cents,
    noteFrequency
  };
}

/** Convert a note name like "E2" to its frequency in Hz. */
function noteNameToFrequency(noteName) {
  const match = /^([A-G]#?)(-?\d+)$/.exec(noteName);
  if (!match) return null;
  const [, name, octaveStr] = match;
  const octave = parseInt(octaveStr, 10);
  const noteIndex = NOTE_NAMES.indexOf(name);
  const midi = (octave + 1) * 12 + noteIndex;
  return A4_FREQ * Math.pow(2, (midi - A4_MIDI) / 12);
}

// Exposed as globals for the plain-script renderer (no bundler in use).
window.PitchDetect = {
  autoCorrelate,
  frequencyToNote,
  noteNameToFrequency,
  NOTE_NAMES
};
