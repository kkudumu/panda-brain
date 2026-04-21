import { contextBridge, ipcRenderer } from 'electron';

// Expose a safe API to the renderer
contextBridge.exposeInMainWorld('ftm', {
  // Get daemon connection info
  getDaemonPort: () => ipcRenderer.invoke('get-daemon-port'),

  // Window controls
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // Platform info
  platform: process.platform,

  // Native folder picker — returns selected path string or null
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('open-folder'),
  listDirectory: (dirPath: string) => ipcRenderer.invoke('list-directory', dirPath),
  readTextFile: (filePath: string) => ipcRenderer.invoke('read-text-file', filePath),

  // IPC events
  onDaemonEvent: (callback: (event: unknown) => void) => {
    ipcRenderer.on('daemon-event', (_event, data) => callback(data));
  },

  removeDaemonEventListener: () => {
    ipcRenderer.removeAllListeners('daemon-event');
  },
});
