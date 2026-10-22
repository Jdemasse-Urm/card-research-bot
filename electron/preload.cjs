// Tiny, explicit bridge between the page and the desktop shell. The page can only call what's listed here.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform, // "win32" | "darwin"
  savePDF: (title) => ipcRenderer.invoke("save-pdf", String(title || "report")),
  getPrefs: () => ipcRenderer.invoke("prefs:get"),
  setPrefs: (patch) => ipcRenderer.invoke("prefs:set", patch),
  // one-click update: the main process downloads, checks and runs the installer
  installUpdate: (asset) => ipcRenderer.invoke("update:install", asset),
  onUpdateProgress: (cb) => ipcRenderer.on("update:progress", (_e, msg) => cb(msg)),
  // tray menu and notification clicks ask the page to open a screen
  onGoto: (cb) => ipcRenderer.on("goto", (_e, where) => cb(String(where))),
});
