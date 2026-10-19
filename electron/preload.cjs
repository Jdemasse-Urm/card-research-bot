// Tiny, explicit bridge between the page and the desktop shell. The page can only call what's listed here.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktop", {
  platform: process.platform, // "win32" | "darwin"
  savePDF: (title) => ipcRenderer.invoke("save-pdf", String(title || "report")),
  getPrefs: () => ipcRenderer.invoke("prefs:get"),
  setPrefs: (patch) => ipcRenderer.invoke("prefs:set", patch),
});
