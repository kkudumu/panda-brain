import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { startDaemon } from '../../daemon/src/start.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 500,
    title: 'Feed The Machine',
    backgroundColor: '#0a0a0a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // electron-vite sets ELECTRON_RENDERER_URL in dev mode
  if (process.env.ELECTRON_RENDERER_URL) {
    await mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // Production — load built files
    await mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  // Create a simple tray icon (empty for now — will be replaced with real icon)
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show FTM', click: () => mainWindow?.show() },
    { label: 'Status: Idle', enabled: false },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() },
  ]);

  tray.setToolTip('Feed The Machine');
  tray.setContextMenu(contextMenu);
}

// IPC: open native folder picker, return selected path or null
ipcMain.handle('open-folder', async () => {
  console.log('[Electron:file-browser] open-folder dialog requested');
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose working directory',
  });
  const chosen = result.canceled ? null : result.filePaths[0] ?? null;
  console.log('[Electron:file-browser] open-folder result', {
    canceled: result.canceled,
    chosen,
  });
  return chosen;
});

ipcMain.handle('list-directory', async (_event, dirPath: string) => {
  const startedAt = Date.now();
  console.log('[Electron:file-browser] list-directory start', { dirPath });
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  console.log('[Electron:file-browser] list-directory read complete', {
    dirPath,
    count: entries.length,
    ms: Date.now() - startedAt,
  });

  const payload = entries
    .map((entry) => ({
      name: entry.name,
      path: path.join(dirPath, entry.name),
      kind: entry.isDirectory() ? 'directory' : 'file',
    }))
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  console.log('[Electron:file-browser] list-directory payload ready', {
    dirPath,
    count: payload.length,
    ms: Date.now() - startedAt,
  });
  return payload;
});

ipcMain.handle('read-text-file', async (_event, filePath: string) => {
  const startedAt = Date.now();
  console.log('[Electron:file-browser] read-text-file start', { filePath });
  const stat = fs.statSync(filePath);
  const maxBytes = 200_000;

  if (stat.size > maxBytes) {
    console.log('[Electron:file-browser] read-text-file too-large', {
      filePath,
      size: stat.size,
      ms: Date.now() - startedAt,
    });
    return {
      kind: 'too_large',
      content: '',
      size: stat.size,
    };
  }

  const buffer = fs.readFileSync(filePath);
  const sample = buffer.subarray(0, Math.min(buffer.length, 512));
  const isBinary = sample.includes(0);

  if (isBinary) {
    console.log('[Electron:file-browser] read-text-file binary', {
      filePath,
      size: stat.size,
      ms: Date.now() - startedAt,
    });
    return {
      kind: 'binary',
      content: '',
      size: stat.size,
    };
  }

  const payload = {
    kind: 'text',
    content: buffer.toString('utf8'),
    size: stat.size,
  };
  console.log('[Electron:file-browser] read-text-file text', {
    filePath,
    size: stat.size,
    ms: Date.now() - startedAt,
  });
  return payload;
});

app.whenReady().then(async () => {
  // Start daemon in-process
  try {
    await startDaemon();
    console.log('[Electron] Daemon started');
  } catch (err) {
    console.error('[Electron] Failed to start daemon:', err);
  }

  await createWindow();

  // Tray icons can cause issues in dev — skip if no icon available
  try {
    createTray();
  } catch {
    console.log('[Electron] Tray icon skipped (dev mode)');
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
