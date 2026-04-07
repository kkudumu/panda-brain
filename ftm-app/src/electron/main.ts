import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import path from 'path';
import { startDaemon } from '../daemon/index.js';

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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // In development, load from Vite dev server
  if (process.env.NODE_ENV === 'development') {
    await mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    // In production, load built files
    await mainWindow.loadFile(path.join(__dirname, '../ui/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  // Create a simple tray icon
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
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  // On macOS, keep running in tray
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
