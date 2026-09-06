// Shared audio-capture engine used by both the Tuner and Drill tabs.
// Handles device enumeration, getUserMedia capture, and exposes an
// AnalyserNode + time-domain buffer that consumers can poll on animation
// frames.

class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.mediaStream = null;
    this.sourceNode = null;
    this.analyser = null;
    this.buffer = null;
    this.listening = false;
  }

  /**
   * Populate a <select> with available audio input devices.
   * @param {HTMLSelectElement} selectEl
   * @param {string} [preferredDeviceId] - a previously-saved device id
   *   (e.g. from localStorage) to select if it's still present, taking
   *   priority over the auto-pick guess since it reflects an explicit past
   *   user choice rather than a heuristic.
   */
  static async populateDeviceList(selectEl, preferredDeviceId) {
    // Labels are only populated after permission has been granted at least
    // once; we request a throwaway stream first if needed so the dropdown
    // shows real device names instead of blank/generic ones.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const inputs = devices.filter((d) => d.kind === 'audioinput');

      const previousValue = selectEl.value;
      selectEl.innerHTML = '';

      if (inputs.length === 0) {
        const opt = document.createElement('option');
        opt.textContent = 'No audio input devices found';
        opt.value = '';
        selectEl.appendChild(opt);
        return;
      }

      inputs.forEach((device, i) => {
        const opt = document.createElement('option');
        opt.value = device.deviceId;
        const label = device.label || `Audio Input ${i + 1}`;
        opt.textContent = label;
        // Best-effort auto-pick: prefer a device whose label mentions "USB"
        // or "interface", since that's likely a dedicated audio interface
        // rather than a laptop's built-in mic.
        if (/usb|interface|audio/i.test(label)) {
          opt.dataset.likelyInterface = 'true';
        }
        selectEl.appendChild(opt);
      });

      const preferred = Array.from(selectEl.options).find((o) => o.dataset.likelyInterface === 'true');
      if (preferredDeviceId && Array.from(selectEl.options).some((o) => o.value === preferredDeviceId)) {
        selectEl.value = preferredDeviceId;
      } else if (preferred) {
        selectEl.value = preferred.value;
      } else if (previousValue) {
        selectEl.value = previousValue;
      }
    } catch (err) {
      console.error('Failed to enumerate devices:', err);
    }
  }

  /** Request an initial permission prompt so device labels become visible. */
  static async requestInitialPermission() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
    } catch (err) {
      console.warn('Initial microphone permission request failed/denied:', err);
    }
  }

  /**
   * Start capturing from the given deviceId. Safe to call again with a new
   * deviceId — it will tear down the previous stream first.
   */
  async start(deviceId) {
    this.stop();

    const constraints = {
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    };

    this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);

    this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;

    this.buffer = new Float32Array(this.analyser.fftSize);
    this.sourceNode.connect(this.analyser);

    this.listening = true;
  }

  /** Read the current time-domain buffer into this.buffer. */
  getTimeDomainData() {
    if (!this.analyser) return null;
    this.analyser.getFloatTimeDomainData(this.buffer);
    return this.buffer;
  }

  /** Get frequency-domain magnitude data (for the chord drill's bin-energy check). */
  getFrequencyData(fftSize) {
    if (!this.analyser) return null;
    if (!this._freqBuffer || this._freqBuffer.length !== this.analyser.frequencyBinCount) {
      this._freqBuffer = new Uint8Array(this.analyser.frequencyBinCount);
    }
    this.analyser.getByteFrequencyData(this._freqBuffer);
    return this._freqBuffer;
  }

  get sampleRate() {
    return this.audioContext ? this.audioContext.sampleRate : 0;
  }

  get binHz() {
    if (!this.audioContext || !this.analyser) return 0;
    return this.audioContext.sampleRate / this.analyser.fftSize;
  }

  stop() {
    this.listening = false;
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.sourceNode) {
      try { this.sourceNode.disconnect(); } catch (e) { /* ignore */ }
      this.sourceNode = null;
    }
    if (this.audioContext) {
      this.audioContext.close().catch(() => {});
      this.audioContext = null;
    }
    this.analyser = null;
  }
}

window.AudioEngine = AudioEngine;
