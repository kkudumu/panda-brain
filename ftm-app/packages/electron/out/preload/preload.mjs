import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("ftm", {
  // Get daemon connection info
  getDaemonPort: () => ipcRenderer.invoke("get-daemon-port"),
  // Window controls
  minimize: () => ipcRenderer.send("window-minimize"),
  maximize: () => ipcRenderer.send("window-maximize"),
  close: () => ipcRenderer.send("window-close"),
  // Platform info
  platform: process.platform,
  // IPC events
  onDaemonEvent: (callback) => {
    ipcRenderer.on("daemon-event", (_event, data) => callback(data));
  },
  removeDaemonEventListener: () => {
    ipcRenderer.removeAllListeners("daemon-event");
  }
});
