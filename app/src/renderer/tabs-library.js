// Tabs/Songs tab logic: a plain-text ASCII tab library (paste, import,
// save, view, delete) persisted via IPC as individual .txt files in
// Guitar/tabs/ (see main.js). No tab parsing/interpretation — just storage
// and a monospace viewer. The main process self-heals the list if a .txt
// file gets deleted/moved outside the app (e.g. in Explorer).

const TabsLibrary = (() => {
  let els = {};
  let tabs = [];
  let editingId = null; // null while composing a brand-new tab
  let viewingId = null;
  let autoScrollTimer = null;
  let autoScrolling = false;

  function cacheEls() {
    els = {
      newBtn: document.getElementById('tabs-new-btn'),
      importBtn: document.getElementById('tabs-import-btn'),
      listEl: document.getElementById('tabs-library-list'),

      editor: document.getElementById('tabs-editor'),
      titleInput: document.getElementById('tabs-title-input'),
      contentInput: document.getElementById('tabs-content-input'),
      saveBtn: document.getElementById('tabs-save-btn'),
      cancelBtn: document.getElementById('tabs-cancel-btn'),
      saveStatus: document.getElementById('tabs-save-status'),

      viewer: document.getElementById('tabs-viewer'),
      viewerTitle: document.getElementById('tabs-viewer-title'),
      viewerSource: document.getElementById('tabs-viewer-source'),
      viewerContent: document.getElementById('tabs-viewer-content'),
      editBtn: document.getElementById('tabs-edit-btn'),
      deleteBtn: document.getElementById('tabs-delete-btn'),
      closeBtn: document.getElementById('tabs-close-btn'),

      autoScrollBpm: document.getElementById('tabs-autoscroll-bpm'),
      autoScrollToggle: document.getElementById('tabs-autoscroll-toggle')
    };
  }

  function showEditor() {
    els.editor.style.display = '';
    els.viewer.style.display = 'none';
    stopAutoScroll();
  }

  function showViewer() {
    els.editor.style.display = 'none';
    els.viewer.style.display = '';
  }

  function renderList() {
    els.listEl.innerHTML = '';
    if (tabs.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'tabs-empty-msg';
      msg.textContent = 'No saved tabs yet.';
      els.listEl.appendChild(msg);
      return;
    }

    tabs.forEach((tab) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'tabs-library-item';
      if (tab.id === viewingId) item.classList.add('active');

      const title = document.createElement('div');
      title.className = 'tabs-library-item-title';
      title.textContent = tab.title;

      const meta = document.createElement('div');
      meta.className = 'tabs-library-item-meta';
      meta.textContent = tab.source === 'pasted' ? 'Pasted' : tab.source;

      item.appendChild(title);
      item.appendChild(meta);
      item.addEventListener('click', () => openTab(tab.id));
      els.listEl.appendChild(item);
    });
  }

  function openTab(id) {
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return;
    viewingId = id;
    els.viewerTitle.textContent = tab.title;
    els.viewerSource.textContent = tab.source === 'pasted' ? 'Pasted' : tab.source;
    els.viewerContent.textContent = tab.content;
    els.viewerContent.scrollTop = 0;
    showViewer();
    renderList();
  }

  function startNewTab() {
    editingId = null;
    viewingId = null;
    els.titleInput.value = '';
    els.contentInput.value = '';
    els.saveStatus.textContent = '';
    showEditor();
    renderList();
    els.titleInput.focus();
  }

  function editCurrentTab() {
    const tab = tabs.find((t) => t.id === viewingId);
    if (!tab) return;
    editingId = tab.id;
    els.titleInput.value = tab.title;
    els.contentInput.value = tab.content;
    els.saveStatus.textContent = '';
    showEditor();
  }

  async function saveCurrentTab() {
    const title = els.titleInput.value.trim() || 'Untitled Tab';
    const content = els.contentInput.value;

    if (!content.trim()) {
      els.saveStatus.textContent = 'Paste some tab content before saving.';
      return;
    }

    const saved = await window.tabsApi.save({
      id: editingId,
      title,
      content,
      source: editingId ? undefined : 'pasted'
    });

    tabs = await window.tabsApi.list();
    els.saveStatus.textContent = 'Saved.';
    openTab(saved.id);
  }

  async function deleteCurrentTab() {
    if (!viewingId) return;
    const tab = tabs.find((t) => t.id === viewingId);
    const confirmed = window.confirm(`Delete "${tab ? tab.title : 'this tab'}"? This cannot be undone.`);
    if (!confirmed) return;

    tabs = await window.tabsApi.delete(viewingId);
    viewingId = null;
    stopAutoScroll();
    startNewTab();
  }

  async function importFile() {
    const result = await window.tabsApi.importFile();
    if (!result) return; // user canceled

    const saved = await window.tabsApi.save({
      title: result.title,
      content: result.content,
      source: result.source
    });

    tabs = await window.tabsApi.list();
    openTab(saved.id);
  }

  // ---- Auto-scroll synced to a BPM value ----
  // Small, self-contained feature: scrolls the viewer a fixed pixel amount
  // per beat, reusing the "beats per minute -> ms per beat" math from the
  // Metronome tab's core idea, but without sharing timer/audio internals.

  function stopAutoScroll() {
    if (autoScrollTimer) clearInterval(autoScrollTimer);
    autoScrollTimer = null;
    autoScrolling = false;
    if (els.autoScrollToggle) els.autoScrollToggle.textContent = 'Start Auto-Scroll';
  }

  function startAutoScroll() {
    const bpm = Math.max(40, Math.min(220, parseInt(els.autoScrollBpm.value, 10) || 80));
    const msPerBeat = 60000 / bpm;
    const pxPerBeat = 4; // small, steady scroll step per beat

    autoScrolling = true;
    els.autoScrollToggle.textContent = 'Stop Auto-Scroll';

    autoScrollTimer = setInterval(() => {
      els.viewerContent.scrollTop += pxPerBeat;
      // Stop automatically once we hit the bottom.
      const atBottom = els.viewerContent.scrollTop + els.viewerContent.clientHeight >= els.viewerContent.scrollHeight - 1;
      if (atBottom) stopAutoScroll();
    }, msPerBeat);
  }

  function toggleAutoScroll() {
    if (autoScrolling) stopAutoScroll();
    else startAutoScroll();
  }

  async function init() {
    cacheEls();
    tabs = await window.tabsApi.list();
    renderList();
    showEditor();

    els.newBtn.addEventListener('click', startNewTab);
    els.importBtn.addEventListener('click', importFile);
    els.saveBtn.addEventListener('click', saveCurrentTab);
    els.cancelBtn.addEventListener('click', startNewTab);
    els.editBtn.addEventListener('click', editCurrentTab);
    els.deleteBtn.addEventListener('click', deleteCurrentTab);
    els.closeBtn.addEventListener('click', () => {
      viewingId = null;
      stopAutoScroll();
      startNewTab();
    });
    els.autoScrollToggle.addEventListener('click', toggleAutoScroll);
  }

  function stop() {
    stopAutoScroll();
  }

  return { init, stop };
})();

window.TabsLibrary = TabsLibrary;
