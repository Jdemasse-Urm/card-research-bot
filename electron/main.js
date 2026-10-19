// Card Research Bot — desktop app shell (Electron).
// Starts the app's own server inside this process and shows it in a native window.
// No business logic lives here: everything is server.js + public/, exactly as when run from source.

import { app, BrowserWindow, Menu, Tray, dialog, shell, ipcMain, nativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_TEST = process.argv.includes("--smoke-test"); // CI: start, check, exit
const isMac = process.platform === "darwin";

app.setName("Card Research Bot");
app.setAppUserModelId("com.cardresearchbot.app"); // Windows notifications + taskbar grouping

// One copy at a time — a second launch just brings the existing window forward.
if (!SMOKE_TEST && !app.requestSingleInstanceLock()) app.quit();

// Data + settings live in the per-user app-data folder, never inside the (read-only) app.
process.env.CARD_BOT_HOME ||= app.isPackaged ? app.getPath("userData") : path.join(here, "..");
process.env.CARD_BOT_DESKTOP = "1";
process.env.NO_BROWSER = "1";

// ---- small preferences file (window bounds, close-to-tray, open at login) ----
const PREFS_PATH = path.join(process.env.CARD_BOT_HOME, "desktop-prefs.json");
let prefs = { closeToTray: true, openAtLogin: false, bounds: null, zoom: 0 };
try {
  prefs = { ...prefs, ...JSON.parse(fs.readFileSync(PREFS_PATH, "utf8")) };
} catch {}
const savePrefs = () => {
  try {
    fs.writeFileSync(PREFS_PATH, JSON.stringify(prefs, null, 2));
  } catch {}
};

let win = null;
let tray = null;
let origin = null;
let quitting = false;
const ICON = path.join(here, "..", "public", "icon-192.png");

function createWindow() {
  const b = prefs.bounds || {};
  win = new BrowserWindow({
    width: b.width || 1400,
    height: b.height || 920,
    x: b.x,
    y: b.y,
    minWidth: 380,
    minHeight: 500,
    title: "Card Research Bot",
    icon: ICON,
    backgroundColor: "#141416",
    show: false,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(here, "preload.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win.once("ready-to-show", () => {
    if (b.maximized) win.maximize();
    win.show();
    if (prefs.zoom) win.webContents.setZoomLevel(prefs.zoom);
  });

  // Remember size/position and zoom for next time.
  const remember = () => {
    if (!win || win.isMinimized()) return;
    prefs.bounds = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    savePrefs();
  };
  win.on("resize", remember);
  win.on("move", remember);
  win.webContents.on("zoom-changed", () => { prefs.zoom = win.webContents.getZoomLevel(); savePrefs(); });

  // Links to websites open in the normal browser; the label-printing pop-up (about:blank) stays in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url || url === "about:blank") {
      return { action: "allow", overrideBrowserWindowOptions: { width: 900, height: 700, autoHideMenuBar: true, title: "Print labels" } };
    }
    if (/^https?:\/\//i.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(origin)) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });
  // Allow the camera/microphone prompts the page may ask for (photo capture); deny everything else.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, cb) => cb(["media", "notifications", "clipboard-sanitized-write"].includes(permission)));

  // Closing the window keeps the bot running in the tray (so daily price checks + alerts happen), unless turned off.
  win.on("close", (e) => {
    if (quitting || !prefs.closeToTray || !tray) return;
    e.preventDefault();
    win.hide();
    if (!prefs.trayHintShown) {
      tray.displayBalloon?.({ title: "Card Research Bot is still running", content: "Price checks and alerts continue in the background. Right-click the tray icon to quit.", icon: ICON });
      prefs.trayHintShown = true;
      savePrefs();
    }
  });

  win.loadURL(origin);
  win.on("closed", () => (win = null));
}

function showWindow() {
  if (!win) createWindow();
  else {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
}

function createTray() {
  const img = nativeImage.createFromPath(ICON).resize({ width: isMac ? 18 : 16, height: isMac ? 18 : 16 });
  tray = new Tray(img);
  tray.setToolTip("Card Research Bot");
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Card Research Bot", click: showWindow },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on("click", showWindow);
  tray.on("double-click", showWindow);
}

function buildMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(isMac ? [{ role: "appMenu" }] : []),
      { role: "fileMenu" },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [{ role: "reload" }, { role: "forceReload" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }],
      },
      { role: "windowMenu" },
      {
        label: "Help",
        submenu: [
          { label: "Open data folder", click: () => shell.openPath(process.env.CARD_BOT_HOME) },
          { label: "Releases (download updates)", click: () => shell.openExternal("https://github.com/Jdemasse-Urm/card-research-bot/releases/latest") },
          { type: "separator" },
          { label: "Developer tools", accelerator: isMac ? "Alt+Cmd+I" : "Ctrl+Shift+I", click: () => win?.webContents.toggleDevTools() },
        ],
      },
    ]),
  );
}

// ---- bridge calls from the page (see preload.cjs) ----
ipcMain.handle("prefs:get", () => ({ closeToTray: prefs.closeToTray, openAtLogin: prefs.openAtLogin }));
ipcMain.handle("prefs:set", (_e, patch) => {
  if (patch && typeof patch === "object") {
    if ("closeToTray" in patch) prefs.closeToTray = Boolean(patch.closeToTray);
    if ("openAtLogin" in patch) {
      prefs.openAtLogin = Boolean(patch.openAtLogin);
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin, openAsHidden: true });
    }
    savePrefs();
  }
  return { closeToTray: prefs.closeToTray, openAtLogin: prefs.openAtLogin };
});
ipcMain.handle("save-pdf", async (e, title) => {
  const wc = e.sender;
  const safe = String(title).replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "report";
  const { canceled, filePath } = await dialog.showSaveDialog(BrowserWindow.fromWebContents(wc), { title: "Save report as PDF", defaultPath: path.join(app.getPath("documents"), `${safe}.pdf`), filters: [{ name: "PDF", extensions: ["pdf"] }] });
  if (canceled || !filePath) return { saved: false };
  try {
    const data = await wc.printToPDF({ printBackground: true, pageSize: "Letter", margins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
    fs.writeFileSync(filePath, data);
    return { saved: true, path: filePath };
  } catch (err) {
    return { saved: false, error: err.message };
  }
});

async function boot() {
  const { ready } = await import("../server.js");
  const port = await ready;
  origin = `http://localhost:${port}`;

  if (SMOKE_TEST) {
    // Used by the release build on GitHub: prove the packaged app starts and its data sources answer.
    try {
      const status = await (await fetch(origin + "/api/status")).json();
      const health = await (await fetch(origin + "/api/health")).json();
      const failed = health.results.filter((r) => !r.ok).map((r) => r.name);
      console.log(`smoke-test: version ${status.version}, sources ok ${health.results.length - failed.length}/${health.results.length}`);
      app.exit(status.version && failed.length < health.results.length ? 0 : 1);
    } catch (err) {
      console.error("smoke-test failed:", err);
      app.exit(1);
    }
    return;
  }

  buildMenu();
  createTray();
  createWindow();
}

app.on("second-instance", showWindow);
app.on("activate", () => origin && showWindow()); // Mac: Dock icon click

// With close-to-tray on, the server keeps running when the window is closed; otherwise closing quits.
app.on("window-all-closed", () => {
  if (!prefs.closeToTray || !tray) app.quit();
});

// Don't lose a running research job by accident.
app.on("before-quit", (e) => {
  if (quitting === "confirmed" || SMOKE_TEST) return;
  quitting = true;
  if (busyCount > 0) {
    const choice = dialog.showMessageBoxSync({ type: "question", buttons: ["Keep running", "Quit anyway"], defaultId: 0, cancelId: 0, title: "Research is still running", message: "A research job is still running. Quit anyway and lose it?" });
    if (choice === 0) {
      quitting = false;
      e.preventDefault();
      return;
    }
  }
  quitting = "confirmed";
});

// The server reports jobs in flight; poll it cheaply so quitting can warn.
let busyCount = 0;
setInterval(async () => {
  if (!origin) return;
  try {
    busyCount = (await (await fetch(origin + "/api/status")).json()).busy || 0;
  } catch {}
}, 5000);

app.whenReady().then(boot).catch((err) => {
  dialog.showErrorBox("Card Research Bot couldn't start", String(err?.stack || err));
  app.exit(1);
});
