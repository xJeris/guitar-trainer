// Top-level wiring: tab switching, shared device-list population, and
// making sure switching tabs stops any active mic capture / metronome so
// only one thing runs at a time (simpler mental model for a beginner user).

(function initApp() {
  function setupTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.tab-panel');

    tabButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const targetId = `tab-${btn.dataset.tab}`;

        // Stop anything currently running when navigating away, so audio
        // capture / the metronome click don't keep running unexpectedly
        // in the background.
        Tuner.stop();
        Metronome.stop();
        Drill.stop();
        if (window.TabsLibrary) window.TabsLibrary.stop();

        tabButtons.forEach((b) => {
          b.classList.toggle('active', b === btn);
          b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
        });
        panels.forEach((p) => p.classList.toggle('active', p.id === targetId));
      });
    });
  }

  // Tuner and Drill are documented as sharing "the same microphone input",
  // so device selection is one app-wide preference: picking a device on
  // either tab updates both selects and is remembered across restarts.
  const SAVED_DEVICE_KEY = 'guitar-app:audio-input-device-id';

  async function setupDeviceLists() {
    const tunerSelect = document.getElementById('audio-input-select');
    const drillSelect = document.getElementById('drill-audio-input-select');

    // Ask for permission once up front so real device labels show up
    // instead of generic placeholders.
    await AudioEngine.requestInitialPermission();

    const savedDeviceId = localStorage.getItem(SAVED_DEVICE_KEY) || undefined;
    await AudioEngine.populateDeviceList(tunerSelect, savedDeviceId);
    await AudioEngine.populateDeviceList(drillSelect, savedDeviceId);

    function saveAndSync(sourceSelect, otherSelect) {
      localStorage.setItem(SAVED_DEVICE_KEY, sourceSelect.value);
      if (otherSelect.value !== sourceSelect.value) {
        otherSelect.value = sourceSelect.value;
      }
    }
    tunerSelect.addEventListener('change', () => saveAndSync(tunerSelect, drillSelect));
    drillSelect.addEventListener('change', () => saveAndSync(drillSelect, tunerSelect));

    navigator.mediaDevices.addEventListener('devicechange', async () => {
      const currentDeviceId = localStorage.getItem(SAVED_DEVICE_KEY) || undefined;
      await AudioEngine.populateDeviceList(tunerSelect, currentDeviceId);
      await AudioEngine.populateDeviceList(drillSelect, currentDeviceId);
    });
  }

  function setupQuit() {
    const quitBtn = document.getElementById('app-quit');
    if (!quitBtn || !window.appControl) return;
    quitBtn.addEventListener('click', () => {
      // Stop mic capture / timers before quitting so devices are released
      // cleanly rather than relying on process teardown to do it.
      Tuner.stop();
      Metronome.stop();
      Drill.stop();
      if (window.TabsLibrary) window.TabsLibrary.stop();
      window.appControl.quit();
    });
  }

  document.addEventListener('DOMContentLoaded', async () => {
    setupTabs();
    setupQuit();
    Tuner.init();
    Metronome.init();
    Drill.init();
    if (window.TabsLibrary) window.TabsLibrary.init();
    await setupDeviceLists();
  });
})();
