// Card Research Bot — desktop app shell (Electron).
// Starts the app's own server inside this process and shows it in a native window.
// No business logic lives here: everything is server.js + public/, exactly as when run from source.

import { app, BrowserWindow, Menu, Tray, dialog, shell, ipcMain, nativeImage, Notification, powerMonitor } from "electron";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assetVersion, badAsset, download, macAppPath, macCleanup, macReplace, quietMoment } from "./update.mjs";

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
// notify: which alerts pop up as desktop notifications (orders + offers/messages from the website, price alerts, pricing notices)
// autoUpdate: new versions install by themselves at a quiet moment; lastVersion: the version that ran last (→ "updated")
let prefs = { closeToTray: true, openAtLogin: false, autoUpdate: true, lastVersion: null, bounds: null, zoom: 0, notify: { orders: true, messages: true, prices: true, pricing: true, grading: true } };
try {
  const saved = JSON.parse(fs.readFileSync(PREFS_PATH, "utf8"));
  prefs = { ...prefs, ...saved, notify: { ...prefs.notify, ...(saved.notify || {}) } }; // a new kind of notification starts on
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
    { label: "Show mode (sell at a card show)", click: () => goto("show") },
    { label: "Website orders & messages", click: () => goto("mjc") },
    { type: "separator" },
    { label: "Check for updates", click: () => goto("updates") },
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
const publicPrefs = () => ({ closeToTray: prefs.closeToTray, openAtLogin: prefs.openAtLogin, autoUpdate: prefs.autoUpdate !== false, notify: { ...prefs.notify } });
ipcMain.handle("prefs:get", publicPrefs);
ipcMain.handle("prefs:set", (_e, patch) => {
  if (patch && typeof patch === "object") {
    if ("closeToTray" in patch) prefs.closeToTray = Boolean(patch.closeToTray);
    if ("autoUpdate" in patch) prefs.autoUpdate = Boolean(patch.autoUpdate);
    if ("openAtLogin" in patch) {
      prefs.openAtLogin = Boolean(patch.openAtLogin);
      if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: prefs.openAtLogin, openAsHidden: true });
    }
    if (patch.notify && typeof patch.notify === "object") for (const k of Object.keys(prefs.notify)) if (k in patch.notify) prefs.notify[k] = Boolean(patch.notify[k]);
    savePrefs();
  }
  return publicPrefs();
});

// ---- updates: "Update now", and automatic updates (on unless switched off in Settings) ----
// Only this project's own release files are accepted, checked against GitHub's SHA-256 before anything runs
// (electron/update.mjs). Windows: the installer replaces the app and starts the new version. Mac: the new app is
// swapped in place and reopened; when that can't be done here (the app isn't in a folder it may change), the
// installer window opens for the usual drag to Applications.
let installing = false;
const autoUpd = { checkedAt: 0, ready: null, failed: null }; // ready = { version, asset, file } downloaded + checked

async function installFile(file, version, { silent }) {
  if (process.platform === "win32") {
    spawn(file, silent ? ["/S", "--force-run"] : [], { detached: true, stdio: "ignore" }).unref();
    setTimeout(() => { quitting = "confirmed"; app.quit(); }, 600);
    return { swapped: true };
  }
  const appPath = app.isPackaged ? macAppPath(process.execPath) : null;
  if (appPath) {
    try {
      await macReplace(file, appPath, version);
      fs.rmSync(file, { force: true });
      app.relaunch();
      app.exit(0);
      return { swapped: true };
    } catch (err) {
      console.warn("update: couldn't swap the app in place:", err.message);
      if (silent) throw err;
    }
  }
  if (silent) throw new Error("This copy of the app isn't in a folder it can update (open it from Applications).");
  await shell.openPath(file); // Finder shows the installer window
  dialog.showMessageBox({ type: "info", title: "Finish the update", message: "Drag Card Research Bot into Applications and choose Replace.", detail: "Then quit this window and open Card Research Bot again from Applications. Your data and settings stay as they are." });
  return { swapped: false };
}

ipcMain.handle("update:install", async (e, asset = {}) => {
  const send = (msg) => e.sender.isDestroyed() || e.sender.send("update:progress", msg);
  const bad = badAsset(asset);
  if (bad) return { ok: false, error: bad };
  if (installing) return { ok: false, error: "The update is already downloading — it installs in a moment." };
  installing = true;
  try {
    const have = autoUpd.ready?.asset.name === asset.name && fs.existsSync(autoUpd.ready.file) ? autoUpd.ready.file : null;
    const file = have || (await download(asset, app.getPath("temp"), (p) => send({ stage: "download", ...p })));
    send({ stage: "install" });
    const r = await installFile(file, assetVersion(asset.name), { silent: false });
    return { ok: true, file, verified: Boolean(asset.sha256), swapped: r.swapped };
  } catch (err) {
    return { ok: false, error: err.message };
  } finally {
    installing = false;
  }
});

// Automatic: every 6 hours ask the app's update check (the server caches GitHub's answer) for a newer release,
// download and check it in the background, then install it at the first quiet moment (update.mjs quietMoment).
// The new version starts by itself and says so in a notification (boot()).
async function autoUpdateTick() {
  if (!origin || SMOKE_TEST || !app.isPackaged || prefs.autoUpdate === false || installing) return;
  try {
    if (!autoUpd.ready && Date.now() - autoUpd.checkedAt > 6 * 3600000) {
      autoUpd.checkedAt = Date.now();
      const u = await (await fetch(origin + "/api/update-check")).json();
      const asset = u.available && u.latest !== autoUpd.failed ? (u.assets || []).find((a) => !badAsset(a)) : null;
      if (asset) {
        installing = true;
        try {
          autoUpd.ready = { version: u.latest, asset, file: await download(asset, app.getPath("temp")) };
        } finally {
          installing = false;
        }
      }
    }
    if (autoUpd.ready && quietMoment({ busy: busyCount, jobIdleSecs, userIdleSecs: powerMonitor.getSystemIdleTime() })) {
      const { file, version } = autoUpd.ready;
      installing = true;
      try {
        await installFile(file, version, { silent: true });
      } catch (err) {
        installing = false;
        autoUpd.failed = version; // not again for this version; "Update now" still works
        autoUpd.ready = null;
        console.warn("automatic update failed:", err.message);
        if (Notification.isSupported()) new Notification({ title: `Card Research Bot ${version} is ready`, body: `It couldn't install by itself (${err.message}). Open the app and click Update now.` }).show();
      }
    }
  } catch (err) {
    console.warn("automatic update check:", err.message);
  }
}
setTimeout(() => { autoUpdateTick(); setInterval(autoUpdateTick, 60000); }, 120000);

// ---- open the app on a given screen (tray menu, notification clicks) ----
function goto(where) {
  showWindow();
  const send = () => win?.webContents.send("goto", where);
  if (win?.webContents.isLoading()) win.webContents.once("did-finish-load", send);
  else send();
}

// ---- desktop notifications for new alerts: website orders, offers and messages, price targets ----
// The server keeps the alerts; this polls the unseen count (already polled every 5 s for "busy") and pops
// up each new one with its own words. Clicking it opens the screen that deals with it.
const notified = new Set();
let alertsPrimed = false;
const KIND_PREF = { order: "orders", ticket: "messages", above: "prices", below: "prices", pop: "prices", pricing: "pricing", grading: "grading" };
const KIND_SCREEN = { order: "mjc", ticket: "mjc-messages", pricing: "mjc-pricing", above: "watch", below: "watch", brief: "hot", pop: "home", grading: "grading" };
async function notifyNewAlerts(unseen) {
  if (isMac || process.platform === "linux") app.setBadgeCount(unseen); // Dock badge = alerts waiting
  if (tray) tray.setToolTip(unseen ? `Card Research Bot — ${unseen} new alert${unseen === 1 ? "" : "s"}` : "Card Research Bot");
  let alerts;
  try {
    alerts = await (await fetch(origin + "/api/alerts")).json();
  } catch {
    return;
  }
  const fresh = alerts.filter((a) => !a.seen && !notified.has(a.id));
  for (const a of fresh) notified.add(a.id);
  if (!alertsPrimed) { alertsPrimed = true; return; } // alerts from before this launch don't pop up again
  if (!Notification.isSupported()) return;
  for (const a of fresh.slice(0, 4)) {
    if (prefs.notify[KIND_PREF[a.kind]] === false) continue;
    const body = a.text || (a.value != null ? `Now $${a.value} (your target $${a.target})` : "");
    const n = new Notification({ title: a.name || "Card Research Bot", body: String(body).slice(0, 200), icon: ICON, silent: a.kind !== "order" });
    n.on("click", () => goto(KIND_SCREEN[a.kind] || "watch"));
    n.show();
    if (a.kind === "order" && win && !win.isFocused()) win.flashFrame(true); // Windows: taskbar button flashes
  }
}
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

  // after an update: say so once, and (Mac) remove the previous version's copy left beside the app
  const version = app.getVersion();
  if (prefs.lastVersion && prefs.lastVersion !== version && Notification.isSupported()) new Notification({ title: `Card Research Bot updated to ${version}`, body: "Settings → What's new shows what changed. Your data and settings are as they were." }).show();
  if (prefs.lastVersion !== version) { prefs.lastVersion = version; savePrefs(); }
  if (isMac && app.isPackaged) macCleanup(macAppPath(process.execPath));
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

// The server reports jobs in flight (so quitting can warn) and unseen alerts (desktop notifications); poll it cheaply.
let busyCount = 0;
let jobIdleSecs = null; // seconds since a research job last started or ended (null = none since start)
let lastUnseen = -1;
setInterval(async () => {
  if (!origin || SMOKE_TEST) return;
  try {
    const st = await (await fetch(origin + "/api/status")).json();
    busyCount = st.busy || 0;
    jobIdleSecs = st.jobIdleSecs ?? null;
    if (st.unseenAlerts !== lastUnseen) {
      const grew = st.unseenAlerts > lastUnseen;
      lastUnseen = st.unseenAlerts;
      if (grew || !alertsPrimed) await notifyNewAlerts(st.unseenAlerts);
      else notifyNewAlerts(st.unseenAlerts).catch(() => {}); // fewer = alerts were read: update the badge
    }
  } catch {}
}, 5000);

app.whenReady().then(boot).catch((err) => {
  dialog.showErrorBox("Card Research Bot couldn't start", String(err?.stack || err));
  app.exit(1);
});
