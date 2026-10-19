// Card Research Bot — desktop app shell (Electron).
// Starts the app's own server inside this process and shows it in a native window.
// No business logic lives here: everything is server.js + public/, exactly as when run from source.

import { app, BrowserWindow, Menu, dialog, shell } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SMOKE_TEST = process.argv.includes("--smoke-test"); // CI: start, check, exit

app.setName("Card Research Bot");
app.setAppUserModelId("com.cardresearchbot.app"); // Windows notifications + taskbar grouping

// One copy at a time — a second launch just brings the existing window forward.
if (!SMOKE_TEST && !app.requestSingleInstanceLock()) app.quit();

// Data + settings live in the per-user app-data folder, never inside the (read-only) app.
process.env.CARD_BOT_HOME ||= app.isPackaged ? app.getPath("userData") : path.join(here, "..");
process.env.CARD_BOT_DESKTOP = "1";
process.env.NO_BROWSER = "1";

let win = null;
let origin = null;

function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 380,
    minHeight: 500,
    title: "Card Research Bot",
    icon: path.join(here, "..", "public", "icon-192.png"),
    backgroundColor: "#141416",
    show: false,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, spellcheck: true },
  });
  win.once("ready-to-show", () => win.show());

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

  win.loadURL(origin);
  win.on("closed", () => (win = null));
}

function buildMenu() {
  const isMac = process.platform === "darwin";
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
  createWindow();
}

app.on("second-instance", () => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.on("activate", () => {
  if (!win && origin) createWindow(); // Mac: clicking the Dock icon reopens the window
});

// The server runs inside the app, so closing the last window quits the app on every platform.
app.on("window-all-closed", () => app.quit());

app.whenReady().then(boot).catch((err) => {
  dialog.showErrorBox("Card Research Bot couldn't start", String(err?.stack || err));
  app.exit(1);
});
