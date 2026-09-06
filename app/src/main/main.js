const { app, BrowserWindow, ipcMain, dialog, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');

// Tabs live as individual, human-readable .txt files in Guitar/tabs/ (one
// level up from app/) rather than buried in Electron's userData folder, so
// the project stays self-contained and the files are easy to browse, edit
// externally, or back up. A small index.json alongside them tracks id/title/
// timestamps/source, since filenames alone can't safely be the unique key.
function tabsDir() {
  return path.join(__dirname, '..', '..', '..', 'tabs');
}

function indexFilePath() {
  return path.join(tabsDir(), 'index.json');
}

async function ensureTabsDir() {
  await fs.mkdir(tabsDir(), { recursive: true });
}

async function loadIndex() {
  try {
    const raw = await fs.readFile(indexFilePath(), 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    console.error('[main] Failed to load tabs index:', err);
    return [];
  }
}

async function saveIndex(entries) {
  await ensureTabsDir();
  await fs.writeFile(indexFilePath(), JSON.stringify(entries, null, 2), 'utf-8');
}

function slugify(title) {
  const base = (title || 'untitled-tab')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'untitled-tab';
}

async function uniqueFileName(slug, excludeFileName) {
  let candidate = `${slug}.txt`;
  let n = 2;
  while (true) {
    if (candidate === excludeFileName) return candidate;
    try {
      await fs.access(path.join(tabsDir(), candidate));
      candidate = `${slug}-${n}.txt`;
      n += 1;
    } catch {
      return candidate;
    }
  }
}

// A tab's .txt file can disappear out from under the index if the user
// deletes/moves/renames it directly in Explorer (they're plain visible files
// on purpose). Rather than show a broken/empty entry, drop it from the index
// automatically so the library self-heals to match what's actually on disk.
async function loadTabs() {
  const index = await loadIndex();
  const survivors = [];
  const missing = [];

  await Promise.all(
    index.map(async (entry) => {
      try {
        const content = await fs.readFile(path.join(tabsDir(), entry.fileName), 'utf-8');
        survivors.push({ entry, content });
      } catch (err) {
        if (err.code === 'ENOENT') {
          missing.push(entry);
        } else {
          console.error(`[main] Failed to read tab file ${entry.fileName}:`, err);
          survivors.push({ entry, content: '' });
        }
      }
    })
  );

  if (missing.length > 0) {
    console.warn(`[main] Removing ${missing.length} tab(s) from index whose file no longer exists:`, missing.map((m) => m.fileName));
    const survivingIds = new Set(survivors.map((s) => s.entry.id));
    await saveIndex(index.filter((e) => survivingIds.has(e.id)));
  }

  // Preserve original index order (Promise.all above doesn't guarantee it).
  const byId = new Map(survivors.map((s) => [s.entry.id, { ...s.entry, content: s.content }]));
  return index.filter((e) => byId.has(e.id)).map((e) => byId.get(e.id));
}

function registerTabsIpc() {
  ipcMain.handle('tabs:list', async () => {
    return loadTabs();
  });

  ipcMain.handle('tabs:save', async (_event, { id, title, content, source }) => {
    await ensureTabsDir();
    const index = await loadIndex();
    const now = new Date().toISOString();
    const resolvedTitle = title || 'Untitled Tab';

    if (id) {
      const idx = index.findIndex((t) => t.id === id);
      if (idx !== -1) {
        const existing = index[idx];
        const fileName = await uniqueFileName(slugify(resolvedTitle), existing.fileName);
        if (fileName !== existing.fileName) {
          await fs.rm(path.join(tabsDir(), existing.fileName), { force: true });
        }
        await fs.writeFile(path.join(tabsDir(), fileName), content || '', 'utf-8');
        index[idx] = { ...existing, title: resolvedTitle, fileName, updatedAt: now };
        await saveIndex(index);
        return { ...index[idx], content: content || '' };
      }
    }

    const fileName = await uniqueFileName(slugify(resolvedTitle));
    await fs.writeFile(path.join(tabsDir(), fileName), content || '', 'utf-8');
    const newEntry = {
      id: crypto.randomUUID(),
      title: resolvedTitle,
      fileName,
      source: source || 'pasted',
      createdAt: now,
      updatedAt: now
    };
    index.unshift(newEntry);
    await saveIndex(index);
    return { ...newEntry, content: content || '' };
  });

  ipcMain.handle('tabs:delete', async (_event, id) => {
    const index = await loadIndex();
    const entry = index.find((t) => t.id === id);
    const remaining = index.filter((t) => t.id !== id);
    await saveIndex(remaining);
    if (entry) {
      await fs.rm(path.join(tabsDir(), entry.fileName), { force: true });
    }
    return loadTabs();
  });

  ipcMain.handle('tabs:import-file', async (_event) => {
    const result = await dialog.showOpenDialog({
      title: 'Import Guitar Tab (.txt)',
      properties: ['openFile'],
      filters: [
        { name: 'Text files', extensions: ['txt', 'tab', 'cho', 'chopro', 'md'] },
        { name: 'All files', extensions: ['*'] }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const filePath = result.filePaths[0];
    const content = await fs.readFile(filePath, 'utf-8');
    const title = path.basename(filePath).replace(/\.[^/.]+$/, '');

    return { title, content, source: `file: ${path.basename(filePath)}` };
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 900,
    minWidth: 720,
    minHeight: 560,
    title: 'Guitar Practice Tools',
    backgroundColor: '#1b1d23',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  // Uncomment for debugging:
  // win.webContents.openDevTools();
}

// Guitar tuning/metronome need microphone access; Electron on most platforms
// grants it automatically for desktop apps, but we handle the permission
// request explicitly to avoid silent denials on some systems.
app.whenReady().then(() => {
  ipcMain.on('app:quit', () => app.quit());

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    if (permission === 'media') {
      callback(true);
    } else {
      callback(false);
    }
  });

  registerTabsIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

process.on('uncaughtException', (err) => {
  console.error('[main] Uncaught exception:', err);
});
