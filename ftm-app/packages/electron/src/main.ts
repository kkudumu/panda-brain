import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { startDaemon } from '../../daemon/src/start.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

async function createWindow(): Promise<void> {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 600,
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
