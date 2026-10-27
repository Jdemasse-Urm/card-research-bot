// Card Research Bot — core front end (plain JS, no build step).
// business.js (dashboard, inventory, grading, sales, expenses) and tools.js (sets, lots, centering,
// deals, listings, PSA) load after this file and use the helpers defined here.
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : null);
const link = (u, text) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(text ?? u)}</a>` : esc(text ?? ""));
const usd = (n) => (n == null || isNaN(n) ? "—" : (n < 0 ? "-" : "") + "$" + Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 }));
const pct = (n) => (n == null || isNaN(n) ? "—" : `<span class="${n > 0 ? "pos" : n < 0 ? "neg" : ""}">${n > 0 ? "+" : ""}${n}%</span>`);
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const day = (iso) => (iso ? new Date(iso.length === 10 ? iso + "T12:00:00" : iso).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" }) : "");
const CAT_LABEL = { baseball: "⚾ Baseball", basketball: "🏀 Basketball", football: "🏈 Football", hockey: "🏒 Hockey", soccer: "⚽ Soccer", yugioh: "🃏 Yu-Gi-Oh", onepiece: "🏴‍☠️ One Piece", pokemon: "⚡ Pokémon", other: "Other" };
const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const getJSON = async (url) => {
  const r = await fetch(url);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
};
const store = {
  get: (k, d) => { try { const v = localStorage.getItem("cardbot." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem("cardbot." + k, JSON.stringify(v)); } catch {} },
};

// Every request carries who is using this browser (for the activity feed).
const _fetch = window.fetch.bind(window);
window.fetch = (url, opts = {}) => {
  const headers = new Headers(opts.headers || {});
  if (store.get("who")) headers.set("x-user", store.get("who"));
  return _fetch(url, { ...opts, headers });
};

function costLine(u) {
  if (!u) return "";
  const free = u.freeGrounded ? ` · Google searches this month: ${u.groundedThisMonth}/${u.freeGrounded} free` : "";
  const models = u.models?.length ? ` · ${u.models.join(", ")}` : "";
  const took = u.ms ? ` · took ${Math.round(u.ms / 1000)} s` : "";
  return `AI: ${u.calls || 0} calls, ≈ $${(u.usd || 0).toFixed(3)} on paid tier ($0 on free tier)${took}${models}${free}`;
}

let status = { hasKey: false };
let isDesktop = false; // set from /api/settings — wording for "restart" differs in the desktop app

// ------------------------------------------------------------------ toasts + undo

function toast(msg, { undo, ms = 6000, error = false } = {}) {
  const el = document.createElement("div");
  el.className = "toast" + (error ? " error" : "");
  el.setAttribute("role", error ? "alert" : "status");
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? `<button>Undo</button>` : ""}`;
  $("#toasts").appendChild(el);
  const close = () => el.remove();
  if (undo) $("button", el).onclick = async () => { close(); await undo(); };
  setTimeout(close, ms);
}

/** DELETE something; show "Removed · Undo" instead of an "are you sure?" pop-up. */
async function removeWithUndo(url, label, reload) {
  const r = await fetch(url, { method: "DELETE" });
  const j = await r.json().catch(() => ({}));
  reload();
  if (j.undo) toast(`Removed ${label}`, { undo: async () => { await fetch("/api/undo/" + j.undo, { method: "POST" }); reload(); toast("Restored"); } });
}

// ------------------------------------------------------------------ generic modal

const modal = $("#modal");
function openModal(title, html, { wide = false } = {}) {
  $("#modalTitle").textContent = title;
  $("#modalBody").innerHTML = html;
  modal.classList.toggle("wide", wide);
  if (!modal.open) modal.showModal();
  return $("#modalBody");
}
$("#modalClose").onclick = () => modal.close();

/**
 * A window on top of the open one (measure centering or record a video from inside the card editor without
 * losing what's typed there). Closing it removes it. → { body, close, dialog }
 */
function openLayer(title, html, { wide = false } = {}) {
  const d = document.createElement("dialog");
  d.className = wide ? "wide" : "";
  d.setAttribute("aria-label", title);
  d.innerHTML = `<div class="modal-head"><h2></h2><button class="ghost" data-x aria-label="Close">✕</button></div><div data-body></div>`;
  $("h2", d).textContent = title;
  $("[data-body]", d).innerHTML = html;
  document.body.appendChild(d);
  const close = () => d.close();
  $("[data-x]", d).onclick = close;
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return { body: $("[data-body]", d), close, dialog: d };
}

// ------------------------------------------------------------------ who / theme / shortcuts

function renderWho() {
  $("#whoName").textContent = store.get("who") || "Who's this?";
}
$("#whoBtn").onclick = () => {
  const body = openModal("Who's using this browser?", `
    <p class="small muted">Shown next to things you add or sell, so you can tell who did what.</p>
    <div class="row">${["Joseph", "Dad"].map((n) => `<button data-n="${n}">${n}</button>`).join("")}</div>
    <div class="row"><input id="whoInput" type="text" placeholder="Or type a name" value="${esc(store.get("who") || "")}" style="flex:1" maxlength="40"><button id="whoSave" class="primary">Save</button></div>`);
  const set = (n) => { store.set("who", n.trim().slice(0, 40)); renderWho(); modal.close(); };
  $$("[data-n]", body).forEach((b) => (b.onclick = () => set(b.dataset.n)));
  $("#whoSave", body).onclick = () => $("#whoInput", body).value.trim() && set($("#whoInput", body).value);
};

function applyTheme() {
  const t = store.get("theme", "auto");
  if (t === "auto") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  $("#themeBtn").title = `Theme: ${t} (click to change)`;
}
$("#themeBtn").onclick = () => {
  const order = ["auto", "light", "dark"];
  store.set("theme", order[(order.indexOf(store.get("theme", "auto")) + 1) % 3]);
  applyTheme();
  toast(`Theme: ${store.get("theme")}`, { ms: 1500 });
};

const SHORTCUTS = [
  ["Ctrl/⌘ + K", "Search everything (inventory, reports, watchlist, want list)"],
  ["/", "Jump to the card search box"],
  ["Ctrl/⌘ + Enter", "Research with AI"],
  ["Esc", "Cancel a running job / close a window"],
  ["1 – 8", "Switch tabs (Home, Lookup, Hottest, Sets, Inventory, Watchlist, Ask, History)"],
  ["?", "Show this list"],
];
$("#helpBtn").onclick = () => openModal("Keyboard shortcuts", `<table>${SHORTCUTS.map(([k, d]) => `<tr><td><kbd>${esc(k)}</kbd></td><td>${esc(d)}</td></tr>`).join("")}</table>`);
document.addEventListener("keydown", (e) => {
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openSearch(); return; }
  if (e.key === "Escape") {
    lookupCtrl?.abort(); hotCtrl?.abort(); askCtrl?.abort(); window.lotCtrl?.abort();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); goTab("lookup"); $("#researchBtn").click(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey || modal.open || $("#settings").open) return;
  if (e.key === "/") { e.preventDefault(); goTab("lookup"); $("#lookupText").focus(); }
  else if (e.key === "?") $("#helpBtn").click();
  else if (/^[1-8]$/.test(e.key)) goTab($$("#tabs button")[+e.key - 1].dataset.tab);
});

// ------------------------------------------------------------------ tabs

const TAB_LOADERS = {};
function goTab(name) {
  $$("#tabs button").forEach((x) => {
    const on = x.dataset.tab === name;
    x.classList.toggle("active", on);
    on ? x.setAttribute("aria-current", "page") : x.removeAttribute("aria-current");
  });
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  TAB_LOADERS[name]?.();
  store.set("tab", name);
  window.scrollTo({ top: 0 });
}
$$("#tabs button").forEach((b) => b.addEventListener("click", () => goTab(b.dataset.tab)));

function pillGroup(sel, onPick) {
  $$(sel + " button").forEach((b) => (b.onclick = () => {
    $$(sel + " button").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b); });
    onPick(b.dataset.v ?? b.dataset.g);
  }));
}

// ------------------------------------------------------------------ status / alerts badge

let lastAlertCount = 0;
async function refreshStatus() {
  status = await getJSON("/api/status");
  $("#keyBanner").classList.toggle("hidden", status.hasKey);
  const n = status.unseenAlerts || 0;
  $("#alertBadge").textContent = n;
  $("#alertBadge").classList.toggle("hidden", !n);
  if (n > lastAlertCount && !window.desktop && "Notification" in window && Notification.permission === "granted") {
    new Notification("Card Research Bot", { body: `${n} new alert${n > 1 ? "s" : ""} on your watchlist` });
  }
  lastAlertCount = n;
}
setInterval(refreshStatus, 5 * 60 * 1000);

// ------------------------------------------------------------------ settings

const settingsDlg = $("#settings");
async function openSettings() {
  settingsDlg.showModal();
  $("#keyMsg").textContent = "";
  const s = await getJSON("/api/settings");
  isDesktop = s.desktop;
  $("#settingsLocalOnly").classList.toggle("hidden", s.canEditSettings);
  $$("#settings input, #settings button:not(#closeSettings):not(#diagBtn)").forEach((el) => (el.disabled = !s.canEditSettings));
  $("#budgetInput").value = s.budget ?? "";
  $("#shareToggle").checked = s.share;
  $("#helperPinState").textContent = s.helperPinSet ? "set — leave blank and Save to remove it" : "not set";
  $("#briefToggle").checked = s.dailyBrief;
  $("#psaState").innerHTML = s.psa ? `<span class="ok">✓ connected</span>` : "";
  $("#ebayState").innerHTML = s.ebay ? `<span class="ok">✓ connected</span>` : "";
  $("#usageBox").innerHTML = `Estimated AI cost this month: <b>${usd(s.spendThisMonth)}</b> <span class="muted">(only charged if you turned on billing in Google AI Studio; the free tier is $0)</span><br>
    Google searches this month: <b>${s.groundedThisMonth}</b> of ${s.freeGrounded.toLocaleString()} free · AI model ${esc(s.model)}${s.fallbackModel ? `, backup ${esc(s.fallbackModel)}` : ""} · key ${s.hasKey ? "saved ✓" : "not set"}`;
  // How the AI is actually performing (every Gemini call is timed and its outcome recorded).
  const perf = (d) => (d && d.calls
    ? `${d.calls} call${d.calls === 1 ? "" : "s"} in ${d.jobs} job${d.jobs === 1 ? "" : "s"} · ${d.failed ? `<span class="bad">${d.failed} failed</span>` : "none failed"}${d.timeouts ? ` (${d.timeouts} timed out)` : ""} · avg ${(d.ms / d.calls / 1000).toFixed(1)} s per call, slowest ${Math.round(d.slowestMs / 1000)} s${d.jobs ? ` · avg job ${Math.round(d.jobMs / d.jobs / 1000)} s` : ""}${d.retries ? ` · ${d.retries} retr${d.retries === 1 ? "y" : "ies"}` : ""}${d.fallbacks ? ` · <span class="warn">${d.fallbacks} switch${d.fallbacks === 1 ? "" : "es"} to the backup model</span>` : ""}${d.fast ? ` · ${d.fast} fast-lane` : ""}`
    : "no AI calls");
  const st = s.aiStats || {};
  $("#aiPerfBox").innerHTML = `<b>AI performance</b> — today: ${perf(st.today)}<br>last ${st.week?.days || 0} day${st.week?.days === 1 ? "" : "s"}: ${perf(st.week)}${s.aiQueue?.waiting ? `<br>${s.aiQueue.waiting} call${s.aiQueue.waiting === 1 ? "" : "s"} waiting in the queue (at most ${s.aiQueue.max} at once)` : ""}`;
  $("#shareMsg").innerHTML = s.shareActive
    ? `Sharing is on. On the other computer or phone open: ${s.lanUrls.map((u) => `<b>${esc(u)}</b>`).join(" or ")}`
    : s.share ? `<span class="bad">Sharing is set but not active. ${s.desktop ? "Quit and reopen the app" : "Restart the bot"} (and make sure a PIN is saved).</span>` : "";
  $("#dataFolderBox").innerHTML = `Your data and settings: <code>${esc(s.dataFolder)}</code>`;
  $("#openDataBtn").classList.toggle("hidden", !s.canEditSettings);
  loadHealth();
  getJSON("/api/version").then((v) => {
    const latest = (v.changelog.split(/\n(?=## )/)[1] || "").trim();
    $("#versionBox").innerHTML = `Card Research Bot <b>${esc(v.version)}</b> <button class="small" id="checkUpdBtn">Check for updates</button><div id="updateBox" class="small" role="status"></div>${latest ? `<details><summary>What's new</summary>${md(latest)}</details>` : ""}
      <p class="small muted">To update: download and run the newest installer from <a href="https://github.com/Jdemasse-Urm/card-research-bot/releases/latest" target="_blank" rel="noopener">Releases</a> — your data and settings are kept.</p>`;
    $("#checkUpdBtn").onclick = () => { $("#updateBox").textContent = "Checking…"; checkUpdates(true, true); };
  });
  if (window.desktop) {
    $("#desktopBlock").hidden = false;
    const prefs = await window.desktop.getPrefs();
    $("#trayToggle").checked = prefs.closeToTray !== false;
    $("#loginToggle").checked = Boolean(prefs.openAtLogin);
    $("#trayToggle").onchange = () => window.desktop.setPrefs({ closeToTray: $("#trayToggle").checked });
    $("#loginToggle").onchange = () => window.desktop.setPrefs({ openAtLogin: $("#loginToggle").checked });
    $$("#settings [data-notify]").forEach((c) => {
      c.checked = prefs.notify?.[c.dataset.notify] !== false;
      c.onchange = () => window.desktop.setPrefs({ notify: { [c.dataset.notify]: c.checked } });
    });
  }
  loadBackupStatus();
}

// Backups: when the last one ran, and an optional copy in a cloud folder (OneDrive, iCloud Drive, Dropbox…).
async function loadBackupStatus() {
  try {
    const b = await getJSON("/api/backup/status");
    const st = b.state || {};
    $("#backupStatus").innerHTML = `Last backup: <b>${st.lastLocal ? esc(when(st.lastLocal)) : "not yet"}</b>${b.mirror ? ` · copy in <code>${esc(b.mirror)}</code>${st.mirrorError ? ` <span class="bad">— failed: ${esc(st.mirrorError)}</span>` : st.lastMirror ? ` <span class="ok">✓ ${esc(when(st.lastMirror))}</span>` : ""}` : ` · <span class="warn">only on this computer</span>`}`;
    const options = [["", "— nowhere else (this computer only) —"], ...b.folders.map((f) => [f.dir, `${f.label} — ${f.dir}`])];
    if (b.mirror && !options.some(([d]) => d === b.mirror)) options.push([b.mirror, b.mirror]);
    $("#mirrorSelect").innerHTML = options.map(([d, l]) => `<option value="${esc(d)}"${d === (b.mirror || "") ? " selected" : ""}>${esc(l)}</option>`).join("");
    if (!b.folders.length && !b.mirror) $("#backupStatus").insertAdjacentHTML("beforeend", `<div class="muted">No OneDrive, iCloud Drive, Dropbox or Google Drive folder found on this computer.</div>`);
    $("#mirrorSave").disabled = $("#mirrorSelect").disabled = !b.canEditSettings;
  } catch (err) {
    $("#backupStatus").innerHTML = `<span class="bad">${esc(err.message)}</span>`;
  }
}
$("#mirrorSave").onclick = async () => {
  const r = await fetch("/api/backup/mirror", json("POST", { dir: $("#mirrorSelect").value || null }));
  const j = await r.json();
  toast(r.ok ? (j.mirror ? "Backups will be copied there every day — the first copy is done" : "Cloud copies turned off") : j.error, { error: !r.ok });
  loadBackupStatus();
};
$("#backupNow").onclick = async () => {
  const r = await fetch("/api/backup/now", { method: "POST" });
  toast(r.ok ? "Backed up ✓" : (await r.json()).error, { error: !r.ok });
  loadBackupStatus();
};
async function loadHealth() {
  $("#healthBox").textContent = "Checking…";
  try {
    const h = await getJSON("/api/health");
    $("#healthBox").innerHTML = h.results.map((r) => `<div><span class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"}</span> ${esc(r.name)} <span class="muted">${r.ok ? r.ms + " ms" : esc(r.error || "no results")}</span></div>`).join("");
  } catch {
    $("#healthBox").textContent = "Couldn't check.";
  }
}
$("#settingsBtn").onclick = openSettings;
$("#keyBannerBtn").onclick = openSettings;
$("#closeSettings").onclick = () => settingsDlg.close();
async function saveSettings(body, msgEl) {
  const r = await fetch("/api/settings", json("POST", body));
  const j = await r.json();
  const restart = isDesktop ? "quit the app and open it again to apply." : "close the bot window and start it again to apply.";
  msgEl.innerHTML = j.ok ? (j.restartNeeded ? `Saved ✓ — ${restart}` : "Saved ✓") : `<span class="bad">${esc(j.error)}</span>`;
  await refreshStatus();
  return j.ok;
}
$("#saveKey").onclick = async () => { if (await saveSettings({ apiKey: $("#keyInput").value }, $("#keyMsg"))) $("#keyInput").value = ""; };
$("#savePsa").onclick = async () => { if (await saveSettings({ psaToken: $("#psaInput").value }, $("#connMsg"))) { $("#psaInput").value = ""; openSettings(); } };
$("#saveEbay").onclick = async () => { if (await saveSettings({ ebayId: $("#ebayIdInput").value, ebaySecret: $("#ebaySecretInput").value }, $("#connMsg"))) { $("#ebayIdInput").value = $("#ebaySecretInput").value = ""; openSettings(); } };
$("#saveBudget").onclick = () => saveSettings({ budget: $("#budgetInput").value }, $("#keyMsg"));
$("#briefToggle").onchange = () => saveSettings({ dailyBrief: $("#briefToggle").checked }, $("#keyMsg"));
$("#saveShare").onclick = () => saveSettings({ share: $("#shareToggle").checked, pin: $("#pinInput").value || undefined }, $("#shareMsg"));
$("#saveHelperPin").onclick = () => saveSettings({ helperPin: $("#helperPinInput").value.trim() }, $("#shareMsg")).then(openSettings);
$("#restoreFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const r = await fetch("/api/restore", json("POST", JSON.parse(await f.text())));
    const j = await r.json();
    $("#restoreMsg").innerHTML = j.ok ? "Restored ✓" : `<span class="bad">${esc(j.error)}</span>`;
  } catch {
    $("#restoreMsg").innerHTML = `<span class="bad">That file isn't a valid backup.</span>`;
  }
  e.target.value = "";
};
$("#openDataBtn").onclick = () => fetch("/api/open-data-folder", { method: "POST" });
$("#diagBtn").onclick = async () => {
  const text = await (await fetch("/api/diagnostics")).text();
  try { await navigator.clipboard.writeText(text); toast("Diagnostics copied — paste them in a message to get help (no keys included)."); }
  catch { openModal("Diagnostics", `<pre class="diag">${esc(text)}</pre>`, { wide: true }); }
};
$("#selftestBtn").onclick = async () => {
  const b = $("#selftestBtn");
  b.disabled = true;
  try {
    const { selftest } = await streamPost("/api/selftest", { full: true }, $("#selftestOut"));
    if (selftest.ok) store.set("selftestDone", true);
    toast(selftest.ok ? "Self-test passed ✓" : "Self-test found problems — see the list", { error: !selftest.ok });
  } catch (err) {
    toast(err.message, { error: true });
  } finally {
    b.disabled = false;
  }
};

function needKey() {
  if (status.hasKey) return false;
  openSettings();
  return true;
}

// ------------------------------------------------------------------ streaming helper (with cancel)

async function streamPost(url, body, progressEl, controller) {
  progressEl.classList.remove("hidden", "done");
  progressEl.innerHTML = "<div>Starting…</div>";
  let res;
  try {
    res = await fetch(url, { ...json("POST", body), signal: controller?.signal });
  } catch (err) {
    progressEl.classList.add("done");
    throw new Error(err.name === "AbortError" ? "Cancelled." : "Couldn't reach the bot — is its window still open?");
  }
  if (!res.ok || !res.body) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    progressEl.classList.add("done");
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", final = null;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.type === "step") {
          progressEl.insertAdjacentHTML("beforeend", `<div>${esc(ev.text)}</div>`);
          progressEl.scrollTop = progressEl.scrollHeight;
        } else if (ev.type === "done" || ev.type === "error") final = ev;
      }
    }
  } catch (err) {
    if (err.name === "AbortError") final = { type: "error", message: "Cancelled." };
    else throw err;
  } finally {
    progressEl.classList.add("done");
  }
  if (!final) throw new Error("Connection closed before the research finished.");
  if (final.type === "error") throw new Error(final.message);
  progressEl.insertAdjacentHTML("beforeend", `<div>✓ Done</div>`);
  return final;
}

// ------------------------------------------------------------------ images (drop / pick / paste / camera)

let photos = []; // { mediaType, data(base64), url, thumb, img, rotation, warn }
const MAX_SIDE = 1600;

function readAsImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error(`Can't open ${file.name || "that image"}${/heic|heif/i.test(file.type + file.name) ? " — HEIC photos: export as JPEG first (in Photos: File → Export)" : ""}.`));
    img.src = url;
  });
}

function drawScaled(img, maxSide, rotation = 0) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
  const c = document.createElement("canvas");
  const sideways = rotation % 180 !== 0;
  c.width = sideways ? h : w;
  c.height = sideways ? w : h;
  const ctx = c.getContext("2d");
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  return c;
}

// Quick photo check: too dark, too blurry, or too small to read card details.
function photoWarning(img) {
  if (Math.max(img.naturalWidth, img.naturalHeight) < 600) return "Small photo — details may be unreadable";
  const c = drawScaled(img, 256);
  const { data, width: w, height: h } = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  const g = new Float32Array(w * h);
  let sum = 0;
  for (let i = 0; i < w * h; i++) { g[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]; sum += g[i]; }
  if (sum / (w * h) < 55) return "Photo looks dark — more light helps";
  let lapSum = 0, lapSq = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i];
    lapSum += l; lapSq += l * l; n++;
  }
  const variance = lapSq / n - (lapSum / n) ** 2;
  return variance < 40 ? "Photo looks blurry — hold steady / tap to focus" : null;
}

function encodePhoto(p) {
  const big = drawScaled(p.img, MAX_SIDE, p.rotation).toDataURL("image/jpeg", 0.9);
  p.data = big.split(",")[1];
  p.url = big;
  p.thumb = drawScaled(p.img, 160, p.rotation).toDataURL("image/jpeg", 0.7);
}

async function addFiles(files) {
  const limit = $("#batchMode").checked ? 40 : lookupMode === "lot" ? 6 : 4;
  for (const f of files) {
    if (!f.type.startsWith("image/") && !/\.(heic|heif)$/i.test(f.name)) continue;
    if (photos.length >= limit) { toast(`Up to ${limit} photos here.`); break; }
    try {
      const { img, url } = await readAsImage(f);
      const p = { mediaType: "image/jpeg", img, rotation: 0, warn: photoWarning(img) };
      encodePhoto(p);
      photos.push(p);
      URL.revokeObjectURL(url);
    } catch (err) {
      alertBox($("#lookupResult"), err.message);
    }
  }
  renderThumbs();
}

function renderThumbs() {
  $("#thumbs").innerHTML = photos
    .map((p, i) => `<div class="thumb"><img src="${p.thumb}" alt="card photo ${i + 1}">
      <button class="x" data-i="${i}" aria-label="Remove photo ${i + 1}">×</button>
      <div class="thumb-tools"><button data-rot="${i}" title="Rotate" aria-label="Rotate photo ${i + 1}">⟳</button><button data-center="${i}" title="Measure centering" aria-label="Measure centering of photo ${i + 1}">⌖</button></div>
      ${p.warn ? `<div class="thumb-warn" title="${esc(p.warn)}">⚠ ${esc(p.warn)}</div>` : ""}</div>`)
    .join("");
  $$("#thumbs [data-i]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); photos.splice(+b.dataset.i, 1); renderThumbs(); }));
  $$("#thumbs [data-rot]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const p = photos[+b.dataset.rot]; p.rotation = (p.rotation + 90) % 360; encodePhoto(p); renderThumbs(); }));
  $$("#thumbs [data-center]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openCentering(photos[+b.dataset.center]); }));
  $(".drop-inner").classList.toggle("hidden", photos.length > 0);
}

const drop = $("#drop");
drop.onclick = () => $("#fileInput").click();
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#fileInput").click(); } };
$("#fileInput").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
$("#cameraBtn").onclick = () => $("#cameraInput").click();
$("#cameraInput").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { e.stopPropagation(); addFiles([...e.dataTransfer.files]); });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); if ($("#tab-lookup").classList.contains("active")) addFiles([...e.dataTransfer.files]); });
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length && $("#tab-lookup").classList.contains("active")) addFiles(files);
});

function alertBox(el, msg, retry) {
  el.innerHTML = `<div class="report" role="alert"><div class="error">⚠ ${esc(msg)}</div>${retry ? `<div class="row"><button data-retry>↻ Try again</button></div>` : ""}</div>`;
  if (retry) $("[data-retry]", el).onclick = retry;
}

$("#clearBtn").onclick = () => {
  photos = []; renderThumbs(); $("#lookupText").value = "";
  $("#lookupProgress").classList.add("hidden");
  $("#batchQueue").classList.add("hidden");
};

let lookupMode = "single";
pillGroup("#lookupMode", (v) => {
  lookupMode = v;
  $("#batchWrap").classList.toggle("hidden", v === "lot");
  $("#dropTitle").textContent = v === "lot" ? "Drop a photo of the lot / binder page" : "Drag & drop card photos here";
  $("#dropHint").textContent = v === "lot" ? "up to 6 photos · lay cards flat, good light, fronts up" : "or click to choose · or paste (Ctrl/⌘+V) · front + back works best";
  $("#researchBtn").textContent = v === "lot" ? "🔎 Value this lot" : "🔎 Research with AI";
  $("#researchBtn").disabled = v === "trade";
  if (v === "trade") renderTrade();
});

// ------------------------------------------------------------------ AI lookup (single + batch)

let lookupCtrl = null;
$("#cancelBtn").onclick = () => { lookupCtrl?.abort(); window.lotCtrl?.abort(); };

async function runLookup(images, text, thumb) {
  return (await streamPost("/api/lookup", { images: images.map(({ mediaType, data }) => ({ mediaType, data })), text, thumb, fresh: $("#freshMode").checked }, $("#lookupProgress"), lookupCtrl)).report;
}

$("#researchBtn").onclick = async () => {
  if (needKey()) return;
  if (lookupMode === "lot") return runLot();
  const text = $("#lookupText").value;
  if (!photos.length && !text.trim()) return alertBox($("#lookupResult"), "Drop a card photo or type a card name first.");
  const batch = $("#batchMode").checked && photos.length > 1;
  $("#researchBtn").disabled = true;
  $("#cancelBtn").classList.remove("hidden");
  lookupCtrl = new AbortController();
  try {
    if (batch) await runBatch(text);
    else renderReport(await runLookup(photos, text, photos[0]?.thumb || null), $("#lookupResult"));
  } catch (err) {
    alertBox($("#lookupResult"), err.message, err.message === "Cancelled." ? null : () => $("#researchBtn").click());
  } finally {
    $("#researchBtn").disabled = false;
    $("#cancelBtn").classList.add("hidden");
  }
};
$("#lookupText").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) (status.hasKey || photos.length ? $("#researchBtn") : $("#quickBtn")).click(); });

async function runBatch(text) {
  const items = photos.map((p, i) => ({ p, i, state: "waiting", report: null, error: null }));
  const q = $("#batchQueue");
  q.classList.remove("hidden");
  const draw = () => {
    q.innerHTML = `<div class="queue"><div class="row space" style="margin:0"><b>Batch: ${items.filter((x) => x.state === "done").length}/${items.length} done</b></div>
      ${items.map((x) => `<div class="qrow"><img src="${x.p.thumb}" alt=""><div>${x.report ? `<b>${esc(x.report.card?.name)}</b> · ${usd(x.report.pricing?.estimated_value_usd)}` : x.error ? `<span class="error">${esc(x.error)}</span>` : esc(x.state)}</div>
        <div>${x.report ? `<button data-open="${x.i}">Open</button>` : ""}</div></div>`).join("")}</div>`;
    $$("[data-open]", q).forEach((b) => (b.onclick = () => renderReport(items[+b.dataset.open].report, $("#lookupResult"))));
  };
  draw();
  for (const x of items) {
    if (lookupCtrl.signal.aborted) { x.state = "cancelled"; continue; }
    x.state = "researching…";
    draw();
    try {
      x.report = await runLookup([x.p], text, x.p.thumb);
      x.state = "done";
      renderReport(x.report, $("#lookupResult"));
    } catch (err) {
      x.error = err.message;
      x.state = "failed";
    }
    draw();
  }
  $("#lookupResult").insertAdjacentHTML("afterbegin", `<div class="panel">Batch finished — every card is saved in <b>History</b> (export to CSV from there).</div>`);
}

// ------------------------------------------------------------------ price history chart (SVG)

const SERIES_PREF = ["Ungraded", "Grade 9", "PSA 10"];
const SERIES_COLORS = ["#1f8a70", "#c58b00", "#5b5bd6"];
function priceChart(history, { label = "Monthly sold-price history" } = {}) {
  if (!history) return "";
  let keys = SERIES_PREF.filter((k) => history[k]);
  if (!keys.length) keys = Object.keys(history).slice(0, 3);
  if (!keys.length) return "";
  const W = 640, H = 220, L = 58, R = 10, T = 10, B = 26;
  const all = keys.flatMap((k) => history[k]);
  const t0 = Math.min(...all.map((p) => p[0])), t1 = Math.max(...all.map((p) => p[0]));
  const vMin = Math.max(0.5, Math.min(...all.map((p) => p[1]))), vMax = Math.max(...all.map((p) => p[1]));
  const lg = (v) => Math.log10(Math.max(v, 0.01));
  const y0 = lg(vMin) - 0.05, y1 = lg(vMax) + 0.05;
  const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v) => T + (1 - (lg(v) - y0) / Math.max(0.01, y1 - y0)) * (H - T - B);
  const ticks = [];
  for (let e = Math.floor(y0); e <= Math.ceil(y1); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (lg(v) >= y0 && lg(v) <= y1) ticks.push(v); }
  const years = [];
  for (let y = new Date(t0).getFullYear() + 1; y <= new Date(t1).getFullYear(); y++) years.push(Date.UTC(y, 0, 1));
  return `<figure style="margin:0">
    <svg class="chart" data-chart="${esc(JSON.stringify({ keys, series: Object.fromEntries(keys.map((k) => [k, history[k]])), W, H, L, R, T, B, t0, t1, y0, y1 }))}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)}: ${esc(keys.join(", "))}">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${usd(v)}</text>`).join("")}
      ${years.map((t) => `<text x="${X(t)}" y="${H - 8}" text-anchor="middle">${new Date(t).getUTCFullYear()}</text>`).join("")}
      ${keys.map((k, i) => `<polyline fill="none" stroke="${SERIES_COLORS[i]}" stroke-width="2.2" points="${history[k].map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>`).join("")}
    </svg>
    <figcaption class="chart-legend">${keys.map((k, i) => `<span style="--c:${SERIES_COLORS[i]}">${esc(k)}</span>`).join("")}<span style="--c:transparent">monthly, log scale</span></figcaption>
  </figure>`;
}

// ------------------------------------------------------------------ liquidity

// "3 sales per week" -> sales per day
function salesPerDay(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s+sales?\s+per\s+(day|week|month|year)/i);
  if (!m) return /rare/i.test(text) ? 0.002 : null;
  return parseFloat(m[1]) / { day: 1, week: 7, month: 30, year: 365 }[m[2].toLowerCase()];
}
function liquidity(volumeText) {
  const r = salesPerDay(volumeText);
  if (r == null) return null;
  const level = r >= 1 ? "High" : r >= 1 / 7 ? "Medium" : r >= 1 / 30 ? "Low" : "Very low";
  const days = Math.max(1, Math.round(1 / r / 2)); // a fairly priced copy usually sells within ~half the gap between sales
  return { level, days: days > 365 ? "months+" : `~${days} day${days > 1 ? "s" : ""}`, cls: { High: "good", Medium: "", Low: "warn", "Very low": "bad" }[level] };
}

// ------------------------------------------------------------------ profit + grading calculators

// Approximate seller fees (Oct 2026). Edit here if a platform changes its rates.
const PLATFORMS = [
  { name: "eBay", pct: 13.25, fixed: 0.4 },
  { name: "TCGplayer", pct: 10.75 + 2.5, fixed: 0.3 },
  { name: "Whatnot", pct: 8 + 2.9, fixed: 0.3 },
  { name: "Local / cash", pct: 0, fixed: 0 },
];

function profitCalc(r, el) {
  const v = r.buy_sell?.list_price ?? r.pricing?.estimated_value_usd ?? "";
  el.innerHTML = `<div class="calc">
      <label>Sell price $<input type="number" step="0.01" min="0" data-k="sale" value="${esc(v)}"></label>
      <label>Your cost $<input type="number" step="0.01" min="0" data-k="cost" value="${esc(r.buy_sell?.max_buy_price ?? "")}"></label>
      <label>Shipping you pay $<input type="number" step="0.01" min="0" data-k="ship" value="5"></label>
    </div><div data-out></div>`;
  const calc = () => {
    const g = (k) => parseFloat($(`[data-k=${k}]`, el).value) || 0;
    const sale = g("sale"), cost = g("cost"), ship = g("ship");
    $("[data-out]", el).innerHTML = `<div class="table-wrap"><table><tr><th>Platform</th><th class="num">Fees</th><th class="num">You keep</th><th class="num">Profit</th></tr>
      ${PLATFORMS.map((p) => {
        const fees = sale ? sale * p.pct / 100 + p.fixed : 0;
        const net = sale - fees - (p.name.startsWith("Local") ? 0 : ship);
        const profit = net - cost;
        return `<tr><td>${p.name}</td><td class="num">${usd(fees)}</td><td class="num">${usd(net)}</td><td class="num ${profit >= 0 ? "pos" : "neg"}">${usd(profit)}${cost ? ` <span class="muted small">(${Math.round((profit / cost) * 100)}%)</span>` : ""}</td></tr>`;
      }).join("")}</table></div><div class="small muted">Fee rates are approximate; local sales assume no shipping.</div>`;
  };
  $$("input", el).forEach((i) => (i.oninput = calc));
  calc();
}

function gradeValue(r, re) {
  return (r.pricing?.grade_values || []).find((g) => re.test(g.grade))?.value ?? null;
}

function gradingCalc(r, el) {
  const o = r.grade_odds || {};
  const guide = r.price_guide || {};
  const raw = guide.Ungraded ?? gradeValue(r, /^(raw|ungraded)$/i) ?? r.pricing?.estimated_value_usd;
  const v10 = guide["PSA 10"] ?? gradeValue(r, /^PSA 10$/i), v9 = guide["Grade 9"] ?? gradeValue(r, /^(PSA 9|Grade 9)$/i), v8 = guide["Grade 8"] ?? gradeValue(r, /^(PSA 8|Grade 8)$/i);
  el.innerHTML = `<div class="calc">
      <label>PSA 10 chance %<input type="number" min="0" max="100" data-k="p10" value="${esc(o.psa10_pct ?? 10)}"></label>
      <label>PSA 9 chance %<input type="number" min="0" max="100" data-k="p9" value="${esc(o.psa9_pct ?? 40)}"></label>
      <label>PSA 8 or lower %<input type="number" min="0" max="100" data-k="p8" value="${esc(o.psa8_or_lower_pct ?? 50)}"></label>
      <label>PSA 10 value $<input type="number" min="0" data-k="v10" value="${esc(v10 ?? "")}"></label>
      <label>PSA 9 value $<input type="number" min="0" data-k="v9" value="${esc(v9 ?? "")}"></label>
      <label>PSA 8 value $<input type="number" min="0" data-k="v8" value="${esc(v8 ?? "")}"></label>
      <label>Raw value $<input type="number" min="0" data-k="raw" value="${esc(raw ?? "")}"></label>
      <label>Grading + shipping $<input type="number" min="0" data-k="fee" value="40"></label>
    </div><div data-out></div>`;
  const calc = () => {
    const g = (k) => parseFloat($(`[data-k=${k}]`, el).value) || 0;
    const tot = g("p10") + g("p9") + g("p8") || 1;
    const ev = (g("p10") * g("v10") + g("p9") * g("v9") + g("p8") * g("v8")) / tot - g("fee");
    const diff = ev - g("raw");
    $("[data-out]", el).innerHTML = `<p style="margin:.3rem 0">Expected value if graded: <b>${usd(ev)}</b> vs selling raw: <b>${usd(g("raw"))}</b> →
      <b class="${diff >= 0 ? "pos" : "neg"}">${diff >= 0 ? "grading wins by " : "selling raw wins by "}${usd(Math.abs(diff))}</b></p>
      <div class="small muted">Odds come from the AI's look at your photo — treat them as a rough guess and adjust.</div>`;
  };
  $$("input", el).forEach((i) => (i.oninput = calc));
  calc();
}

// Which grading company pays best for a 10 / 9.5 on this card. Fees are typical bulk/value tiers
// (Oct 2026, approximate) — edit here when they change.
const COMPANY_FEES = { PSA: 25, BGS: 22, SGC: 18, CGC: 18, TAG: 20 };
function companyCompare(guide) {
  if (!guide) return "";
  const rows = Object.keys(COMPANY_FEES)
    .map((c) => ({ c, ten: guide[`${c} 10`] ?? null, black: c === "BGS" ? guide["BGS 10 Black"] ?? null : c === "CGC" ? guide["CGC 10 Pristine"] ?? null : null, fee: COMPANY_FEES[c] }))
    .filter((r) => r.ten != null);
  if (rows.length < 2) return "";
  const best = rows.reduce((a, b) => (b.ten - b.fee > a.ten - a.fee ? b : a));
  return `<h3>Which company to grade with</h3>
    <div class="table-wrap"><table><tr><th>Company</th><th class="num">"10" sells for</th><th class="num">Top label</th><th class="num">Typical fee</th><th class="num">Net on a 10</th></tr>
    ${rows.map((r) => `<tr${r === best ? ' class="best"' : ""}><td>${r.c}${r === best ? " ★" : ""}</td><td class="num">${usd(r.ten)}</td><td class="num">${usd(r.black)}</td><td class="num">${usd(r.fee)}</td><td class="num">${usd(r.ten - r.fee)}</td></tr>`).join("")}
    </table></div><p class="small muted">Based on recent sold prices for this card. Fees are typical value-tier prices and change often; slower/cheaper tiers and declared value change the math.</p>`;
}

// ------------------------------------------------------------------ report

const recClass = { grade_it: "good", maybe: "warn", dont_grade: "bad", already_graded: "" };
const recLabel = { grade_it: "Grade it", maybe: "Maybe grade", dont_grade: "Don't grade", already_graded: "Already graded" };
const verdictClass = { buy: "good", hold: "warn", sell: "bad", pass: "" };
const demandClass = { hot: "bad", rising: "good", steady: "", cooling: "warn", cold: "" };

function summaryText(r) {
  const c = r.card || {}, p = r.pricing || {}, bs = r.buy_sell || {};
  return [
    `${c.name}`,
    `Value: ${usd(p.estimated_value_usd)}${p.value_range_low != null ? ` (range ${usd(p.value_range_low)}–${usd(p.value_range_high)})` : ""}`,
    `Call: ${String(bs.verdict || "").toUpperCase()} · max buy ${usd(bs.max_buy_price)} · list at ${usd(bs.list_price)}`,
    `Grading: ${recLabel[r.grading?.recommendation] || ""}`,
    r.slab ? `PSA cert: ${r.slab.verified ? "verified" : "DOES NOT MATCH — check it"}` : "",
    r.summary,
    p.pricecharting_url ? `Sales: ${p.pricecharting_url}` : "",
  ].filter(Boolean).join("\n");
}

function slabPanel(slab) {
  if (!slab) return "";
  const c = slab.cert || {};
  const pop = slab.population;
  const popRow = pop?.byGrade ? Object.entries(pop.byGrade).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])).slice(0, 6).map(([g, n]) => `${g}: ${n.toLocaleString()}`).join(" · ") : "";
  return `<div class="callout ${slab.verified ? "ok-box" : "bad-box"}" style="margin-top:1rem">
    <div class="big">${slab.verified ? "✅ PSA cert verified" : "⚠ PSA cert check failed"}</div>
    ${slab.warning ? `<p class="small">${esc(slab.warning)}</p>` : ""}
    ${(slab.mismatches || []).length ? `<ul class="tight small">${slab.mismatches.map((m) => `<li>${esc(m)}</li>`).join("")}</ul>` : ""}
    ${c.found ? `<p class="small">PSA record #${esc(c.certNumber)}: ${esc([c.year, c.brand, c.subject, c.cardNumber ? "#" + c.cardNumber : "", c.variety].filter(Boolean).join(" "))} — <b>${esc(c.gradeDescription || c.grade)}</b>
      ${c.population != null ? ` · Pop ${c.population.toLocaleString()} at this grade, ${c.populationHigher?.toLocaleString() ?? "?"} higher` : ""} · ${link(c.url, "view on PSA")}</p>` : ""}
    ${popRow ? `<p class="small muted">Population by grade — ${esc(popRow)}${pop.total ? ` · total graded ${pop.total.toLocaleString()}` : ""}</p>` : ""}
    ${psaPhotos(slab.images)}
  </div>`;
}

async function ownedBanner(url, grade, el, name) {
  if (!el || (!url && !name)) return;
  try {
    const { owned, wanted } = await getJSON(`/api/owned?url=${encodeURIComponent(url || "")}&grade=${encodeURIComponent(grade || "Raw")}&name=${encodeURIComponent(name || "")}`);
    let html = "";
    if (owned.length) {
      const qty = owned.reduce((n, r) => n + r.qty, 0);
      html += `<div class="owned">📦 You already own <b>${qty}</b> of this card: ${owned.map((r) => `${esc(r.grade)} (paid ${usd(r.cost)}${r.location ? ", " + esc(r.location) : ""})`).join(" · ")}</div>`;
    }
    if (wanted.length) {
      const w = wanted[0];
      html += `<div class="owned want">🎯 On your want list${w.maxPrice != null ? ` — pay up to <b>${usd(w.maxPrice)}</b>` : ""}${w.notes ? ` · ${esc(w.notes)}` : ""}</div>`;
    }
    el.innerHTML = html;
  } catch {}
}

function psaPhotos(images) {
  const urls = [images?.front, images?.back].filter(safeUrl);
  if (!urls.length) return "";
  return `<div class="psa-photos"><div class="small muted">PSA's own photos of this cert — compare with the slab in your hand:</div>${urls.map((u) => `<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="PSA photo of the slab" loading="lazy"></a>`).join("")}</div>`;
}

function savePdf(title, btn) {
  if (window.desktop?.savePDF) {
    btn.disabled = true;
    window.desktop.savePDF(title).then((r) => { btn.disabled = false; if (r?.saved) toast(`Saved ${r.path}`); else if (r?.error) toast(r.error, { error: true }); });
  } else window.print(); // browsers: choose "Save as PDF" as the printer
}

function renderReport(r, el) {
  const c = r.card || {}, p = r.pricing || {}, m = r.market || {}, g = r.grading || {}, bs = r.buy_sell || {};
  const vol = r.sales_volume_raw ? Object.values(r.sales_volume_raw)[c.grading_company ? Object.keys(r.sales_volume_raw).length - 1 : 0] : null;
  const liq = liquidity(vol);
  const chips = [
    CAT_LABEL[c.category] || c.category,
    c.rookie && "RC",
    c.autograph && "Auto",
    c.memorabilia && "Patch/Relic",
    c.serial_number && `#'d ${c.serial_number}`,
    c.grading_company && c.grade && `${c.grading_company} ${c.grade}`,
    !c.grading_company && "Raw",
  ].filter(Boolean);
  const gradeLabel = c.grading_company && c.grade ? `${c.grading_company} ${c.grade}` : "Raw";

  el.innerHTML = `
  <article class="report">
    <div data-owned></div>
    <div class="report-head">
      <div style="display:flex;gap:1rem;align-items:flex-start">
        ${r.thumb ? `<img src="${esc(r.thumb)}" alt="" class="hist-thumb" style="width:64px;height:auto">` : ""}
        <div>
          <h2 class="report-title">${esc(c.name)}</h2>
          <div class="chips">${chips.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}
            <span class="chip ${c.identification_confidence === "high" ? "good" : c.identification_confidence === "low" ? "bad" : "warn"}">ID: ${esc(c.identification_confidence)} confidence</span>
            <span class="chip ${demandClass[m.demand] || ""}">Demand: ${esc(m.demand)}</span>
            ${liq ? `<span class="chip ${liq.cls}" title="How fast this card sells, from recent sales volume">Liquidity: ${esc(liq.level)} · sells in ${esc(liq.days)}</span>` : ""}
          </div>
        </div>
      </div>
      <div class="value-box">
        <div class="muted small">Estimated value</div>
        <div class="value-big">${usd(p.estimated_value_usd)}</div>
        <div class="value-range">${p.value_range_low != null ? `${usd(p.value_range_low)} – ${usd(p.value_range_high)}` : ""}</div>
      </div>
    </div>
    <p class="summary">${esc(r.summary)}</p>
    ${r.checklist?.note ? `<div class="callout bad-box" style="margin-top:1rem"><b>⚠ Check the card</b><p class="small" style="margin:.3rem 0 0">${esc(r.checklist.note)}</p></div>` : r.checklist ? `<p class="small muted">✓ Matches the checklist: #${esc(r.checklist.number)} in ${esc(r.checklist.set)}</p>` : ""}
    ${slabPanel(r.slab)}

    <div class="grid2" style="margin-top:1rem">
      <div class="callout">
        <div class="muted small">Reseller call</div>
        <div class="big"><span class="chip ${verdictClass[bs.verdict] || ""}" style="font-size:1rem">${esc(String(bs.verdict || "").toUpperCase())}</span></div>
        <div class="kv" style="margin-top:.5rem">
          <span>Max buy price</span><b>${usd(bs.max_buy_price)}</b>
          <span>List at</span><b>${usd(bs.list_price)}</b>
          <span>Quick sale</span><b>${usd(bs.quick_sale_price)}</b>
        </div>
        <p class="small">${esc(bs.reasoning)}</p>
      </div>
      <div class="callout">
        <div class="muted small">Grading</div>
        <div class="big"><span class="chip ${recClass[g.recommendation] || ""}" style="font-size:1rem">${esc(recLabel[g.recommendation] || g.recommendation)}</span></div>
        <p class="small">${esc(g.reasoning)}</p>
        <div class="muted small"><b>Condition:</b> ${esc(c.condition_notes)}</div>
      </div>
    </div>

    ${r.history ? `<h3>Price history</h3>${priceChart(r.history)}` : ""}

    <div class="grid2">
      <div>
        <h3>Value by grade</h3>
        <div class="table-wrap"><table><tr><th>Grade</th><th class="num">Value</th></tr>
          ${(p.grade_values || []).map((x) => `<tr><td>${esc(x.grade)}</td><td class="num">${usd(x.value)}</td></tr>`).join("") || `<tr><td colspan=2 class="muted">No grade data found</td></tr>`}
        </table></div>
        <h3>Trend</h3>
        <p class="small">${esc(p.trend_summary)}</p>
        <p class="small muted"><b>Volume:</b> ${esc(m.sales_volume)}</p>
      </div>
      <div>
        <h3>Recent sold</h3>
        <div class="table-wrap"><table><tr><th>Date</th><th>Grade</th><th class="num">Price</th></tr>
          ${(p.recent_sales || []).map((s) => `<tr title="${esc(s.title)}"><td>${esc(s.date)}</td><td>${esc(s.grade)} <span class="muted small">${esc(s.source)}</span></td><td class="num">${usd(s.price)}</td></tr>`).join("") || `<tr><td colspan=3 class="muted">No recent sales found</td></tr>`}
        </table></div>
        <p class="small muted">${esc(p.basis)} ${p.pricecharting_url ? "· " + link(p.pricecharting_url, "sales source") : ""}</p>
      </div>
    </div>

    <div class="grid2 calc-block">
      <div><h3>Profit calculator</h3><div data-profit></div></div>
      ${c.grading_company ? "" : `<div><h3>Should I grade it? (expected value)</h3><div data-grading></div></div>`}
    </div>
    <div class="calc-block">${c.grading_company ? "" : companyCompare(r.price_guide)}</div>

    <div class="grid2">
      <div>
        <h3>Market outlook</h3>
        <p class="small">${esc(m.outlook)}</p>
        ${(m.recent_news || []).length ? `<ul class="tight small">${m.recent_news.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      </div>
      <div>
        <h3>Key facts</h3>
        <ul class="tight small">${(r.key_facts || []).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      </div>
    </div>

    <h3>Card details</h3>
    <div class="kv small">
      ${[["Player / character", c.player_or_character], ["Year", c.year], ["Set", c.brand_set], ["Number", c.card_number], ["Parallel / variant", c.parallel_or_variant], ["Team", c.team], ["Cert #", c.cert_number], ["How it was identified", c.identification_notes], ["Researched by", r.by]]
        .filter(([, v]) => v).map(([k, v]) => `<span class="muted">${esc(k)}</span><span>${esc(v)}</span>`).join("")}
    </div>

    ${(r.sources || []).length ? `<h3>Sources</h3><div class="sources">${r.sources.map((s) => link(s.url, s.title)).join("")}</div>` : ""}

    <div class="foot">
      <span>${r.at ? "Researched " + esc(when(r.at)) : ""} · ${esc(costLine(r.usage))}</span>
      <span class="actions">
        ${r.id ? `<button data-act="watch">★ Watchlist</button><button data-act="inv">＋ Inventory</button>` : ""}
        ${p.pricecharting_url ? `<button data-act="deals" title="Live eBay listings below recent sold value">🏷 Find deals</button>` : ""}
        ${r.id ? `<button data-act="listing">📝 Write listing</button><button data-act="ask">💬 Ask about it</button>` : ""}
        <button data-act="rerun" title="Research again with fresh prices">↻ Re-run</button>
        <button data-act="copy">📋 Copy summary</button>
        <button data-act="pdf">📄 Save PDF</button>
        <button data-act="print">🖨 Print</button>
      </span>
    </div>
    <form class="inline-form hidden" data-invform>
      <label class="small">Paid each $ <input type="number" step="0.01" min="0" name="cost" required></label>
      <label class="small">Qty <input type="number" min="1" value="1" name="qty" style="width:70px"></label>
      <label class="small">Location <input type="text" name="location" placeholder="Box 3" style="width:110px"></label>
      <button class="primary">Add to inventory</button>
    </form>
  </article>`;

  profitCalc(r, $("[data-profit]", el));
  if ($("[data-grading]", el)) gradingCalc(r, $("[data-grading]", el));
  ownedBanner(p.pricecharting_url, gradeLabel, $("[data-owned]", el), c.name);

  const act = (name, fn) => { const b = $(`[data-act=${name}]`, el); if (b) b.onclick = () => fn(b); };
  act("watch", async (b) => {
    const res = await fetch("/api/watchlist", json("POST", { lookupId: r.id }));
    b.textContent = res.ok ? "★ On watchlist" : "Couldn't add";
    b.disabled = true;
  });
  act("inv", () => { $("[data-invform]", el).classList.toggle("hidden"); $("[data-invform] input", el).focus(); });
  $("[data-invform]", el).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const res = await fetch("/api/inventory", json("POST", { lookupId: r.id, cost: f.get("cost"), qty: f.get("qty"), location: f.get("location") }));
    e.target.innerHTML = res.ok ? `<span class="ok">Added to inventory ✓</span>` : `<span class="bad">Couldn't add</span>`;
  };
  act("deals", () => openDeals({ url: p.pricecharting_url, grade: gradeLabel, q: c.search_query, name: c.name }));
  act("listing", () => openListing(r));
  act("ask", () => { setAskContext(r); goTab("ask"); $("#askInput").focus(); });
  act("rerun", () => {
    photos = []; renderThumbs();
    $("#lookupText").value = (c.search_query || c.name) + (c.grading_company ? ` ${c.grading_company} ${c.grade}` : "");
    goTab("lookup");
    $("#researchBtn").click();
  });
  act("copy", async (b) => {
    try { await navigator.clipboard.writeText(summaryText(r)); b.textContent = "✓ Copied"; } catch { b.textContent = "Copy failed"; }
  });
  act("print", () => window.print());
  act("pdf", (b) => savePdf(c.name, b));
}

// ------------------------------------------------------------------ quick (free) price

$("#quickBtn").onclick = async () => {
  const q = $("#lookupText").value.trim();
  const out = $("#lookupResult");
  if (!q) return alertBox(out, "Type the card (player/character, year, set, number) for a quick price check.");
  const btn = $("#quickBtn");
  btn.disabled = true;
  out.innerHTML = `<div class="report muted" role="status">Searching sold prices…</div>`;
  try {
    const j = await getJSON("/api/quick?q=" + encodeURIComponent(q));
    if (!j.results.length) return alertBox(out, "No matching cards found. Try fewer words, e.g. 'griffey 1989 upper deck 1'.");
    out.innerHTML = `<div class="report"><div class="grid2 quick-grid">
      <div class="qlist"><h3 style="margin-top:0">Matches</h3>${j.results.map((x, i) => `<button data-url="${esc(x.url)}" class="${i === 0 ? "active" : ""}"><b>${esc(x.name)}</b><br><span class="muted small">${esc(x.set)} · ${esc(x.ungraded || "")}</span></button>`).join("")}</div>
      <div id="quickCard"></div></div></div>`;
    renderQuickCard(j.top);
    $$(".qlist button", out).forEach((b) => (b.onclick = async () => {
      $$(".qlist button", out).forEach((x) => x.classList.toggle("active", x === b));
      $("#quickCard").innerHTML = `<p class="muted">Loading…</p>`;
      try { renderQuickCard(await getJSON("/api/quick/card?url=" + encodeURIComponent(b.dataset.url))); }
      catch (err) { $("#quickCard").innerHTML = `<p class="error">${esc(err.message)}</p>`; }
    }));
  } catch (err) {
    alertBox(out, err.message);
  } finally {
    btn.disabled = false;
  }
};

/** Price page view, used by Quick price and the Set browser. el defaults to #quickCard. */
function renderQuickCard(d, el = $("#quickCard")) {
  if (!d) return;
  const grades = Object.keys(d.recentSales || {});
  const gradeOpts = Object.keys(d.priceGuide || {}).map((g) => `<option>${esc(g === "Ungraded" ? "Raw" : g)}</option>`).join("");
  el.innerHTML = `
    <div data-owned></div>
    <h2 style="margin-top:0">${esc(d.title)}</h2>
    <div class="muted">${esc(d.set)} · ${link(d.url, d.source)}</div>
    <div class="row qc-actions">
      <select data-grade aria-label="Grade">${gradeOpts}</select>
      <button data-q="watch">★ Watch</button>
      <button data-q="inv">＋ Inventory</button>
      <button data-q="deals">🏷 Find deals</button>
      <button data-q="want" title="Add to your want list">🎯 Want</button>
    </div>
    <form class="inline-form hidden" data-qinv>
      <label class="small">Paid each $ <input type="number" step="0.01" min="0" name="cost" required></label>
      <label class="small">Qty <input type="number" min="1" value="1" name="qty" style="width:70px"></label>
      <button class="primary">Add</button>
    </form>
    <h3>Current value by grade</h3>
    <div class="guide">${Object.entries(d.priceGuide || {}).map(([k, v]) => `<div><span>${esc(k)}</span><b>${usd(v)}</b></div>`).join("")}</div>
    ${d.history && Object.keys(d.history).length ? `<h3>Price history</h3>${priceChart(d.history)}` : ""}
    <h3>Trend</h3>
    <div class="table-wrap"><table><tr><th>Grade</th><th class="num">1 mo</th><th class="num">3 mo</th><th class="num">6 mo</th><th class="num">12 mo</th><th>Volume</th></tr>
      ${Object.entries(d.trendPct || {}).map(([k, t]) => {
        const liq = liquidity(d.salesVolume?.[k]);
        return `<tr><td>${esc(k)}</td><td class="num">${pct(t["1mo"])}</td><td class="num">${pct(t["3mo"])}</td><td class="num">${pct(t["6mo"])}</td><td class="num">${pct(t["12mo"])}</td><td class="small muted">${esc(d.salesVolume?.[k] || "")}${liq ? ` · <span class="${liq.cls}">${liq.level}</span>` : ""}</td></tr>`;
      }).join("")}
    </table></div>
    <h3>Recent sold</h3>
    <div class="pills" data-qgrades role="group" aria-label="Grade">${grades.map((g, i) => `<button data-g="${esc(g)}" class="${i === 0 ? "active" : ""}" aria-pressed="${i === 0}">${esc(g)}</button>`).join("")}</div>
    <div data-qsales></div>
    <p class="small muted" style="margin-top:.8rem">Free data, no AI. For card ID from a photo, grading advice and news, use <b>Research with AI</b>.</p>`;
  const show = (g) => {
    $("[data-qsales]", el).innerHTML = `<div class="table-wrap"><table style="margin-top:.5rem"><tr><th>Date</th><th>Listing</th><th class="num">Price</th></tr>
      ${(d.recentSales[g] || []).map((s) => `<tr><td>${esc(s.date)}</td><td class="small">${esc(s.title)}</td><td class="num">${usd(s.price)}</td></tr>`).join("")}</table></div>`;
  };
  $$("[data-qgrades] button", el).forEach((b) => (b.onclick = () => {
    $$("[data-qgrades] button", el).forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b); });
    show(b.dataset.g);
  }));
  if (grades.length) show(grades[0]);
  const grade = () => $("[data-grade]", el).value;
  const refreshOwned = () => ownedBanner(d.url, grade(), $("[data-owned]", el), `${d.title} ${d.set}`);
  refreshOwned();
  $("[data-grade]", el).onchange = refreshOwned;
  // A small dialog, not window.prompt(): prompt() silently does nothing inside the desktop app.
  $("[data-q=want]", el).onclick = (e) => {
    const body = openModal("Add to want list", `<form data-form class="form-grid"><div class="span2 small">${esc(name)} · ${esc(grade())}</div><label>Pay up to $ <span class="muted small">(optional)</span><input name="maxPrice" type="number" min="0" step="1"></label><div class="span2 row"><button class="primary">🎯 Add</button></div></form>`);
    $("[data-form]", body).onsubmit = async (ev) => {
      ev.preventDefault();
      const max = new FormData(ev.target).get("maxPrice");
      const r = await fetch("/api/wantlist", json("POST", { name, grade: grade(), priceUrl: d.url, maxPrice: max || null, category: categoryOfUrl(d.url) }));
      modal.close();
      e.target.textContent = r.ok ? "🎯 Wanted" : "Couldn't add";
      e.target.disabled = true;
      refreshOwned();
    };
  };
  const name = `${d.title} (${d.set})`;
  $("[data-q=watch]", el).onclick = async (e) => {
    const r = await fetch("/api/watchlist", json("POST", { url: d.url, name, grade: grade() }));
    e.target.textContent = r.ok ? "★ Watching" : "Couldn't add";
    e.target.disabled = true;
  };
  $("[data-q=inv]", el).onclick = () => $("[data-qinv]", el).classList.toggle("hidden");
  $("[data-qinv]", el).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const value = d.priceGuide[grade() === "Raw" ? "Ungraded" : grade()] ?? null;
    const r = await fetch("/api/inventory", json("POST", { name, grade: grade(), priceUrl: d.url, value, cost: f.get("cost"), qty: f.get("qty") }));
    e.target.innerHTML = r.ok ? `<span class="ok">Added to inventory ✓</span>` : `<span class="bad">Couldn't add</span>`;
  };
  $("[data-q=deals]", el).onclick = () => openDeals({ url: d.url, grade: grade(), name });
}

// ------------------------------------------------------------------ hottest cards

let hotCat = "all", hotPeriod = "weekly", hotCtrl = null;
pillGroup("#hotCats", (v) => { hotCat = v; loadHotCached(); });
pillGroup("#hotPeriods", (v) => { hotPeriod = v; loadHotCached(); });

async function loadHotCached() {
  const hot = await getJSON(`/api/hot?category=${hotCat}&period=${hotPeriod}`);
  $("#hotRefresh").classList.toggle("hidden", !hot);
  $("#hotResult").innerHTML = hot ? "" : `<div class="empty"><h2>No report yet for this view</h2><p>Click <b>Find hottest cards</b>. The bot searches Google for news and market trackers, then checks real sold prices (takes 1–2 minutes).</p></div>`;
  if (hot) renderHot(hot);
}
TAB_LOADERS.hot = loadHotCached;

async function runHot(refresh) {
  if (needKey()) return;
  $("#hotBtn").disabled = $("#hotRefresh").disabled = true;
  $("#hotCancel").classList.remove("hidden");
  hotCtrl = new AbortController();
  try {
    const { hot } = await streamPost("/api/hot", { category: hotCat, period: hotPeriod, refresh }, $("#hotProgress"), hotCtrl);
    renderHot(hot);
    $("#hotRefresh").classList.remove("hidden");
  } catch (err) {
    alertBox($("#hotResult"), err.message, err.message === "Cancelled." ? null : () => runHot(refresh));
  } finally {
    $("#hotBtn").disabled = $("#hotRefresh").disabled = false;
    $("#hotCancel").classList.add("hidden");
  }
}
$("#hotBtn").onclick = () => runHot(false);
$("#hotRefresh").onclick = () => runHot(true);
$("#hotCancel").onclick = () => hotCtrl?.abort();

const signalLabel = { price_spike: "📈 Price spike", volume_spike: "🔊 Volume spike", news: "📰 News", new_release: "🆕 New release", tournament_meta: "🏆 Tournament meta", milestone: "🎯 Milestone", long_term_riser: "⏫ Long-term riser" };
const movementChip = (m) => (m === "new" ? `<span class="chip good">NEW</span>` : m > 0 ? `<span class="chip good">↑${m}</span>` : m < 0 ? `<span class="chip warn">↓${-m}</span>` : "");

function renderHot(h) {
  const periodLabel = { daily: "today", weekly: "this week", monthly: "this month" }[h.period];
  $("#hotResult").innerHTML = `
    <div class="panel hot-summary">
      <div class="row space"><h2>Hottest ${esc(h.category === "all" ? "cards" : CAT_LABEL[h.category])} ${esc(periodLabel)}</h2><span class="muted small">Updated ${esc(when(h.at))}</span></div>
      <p>${esc(h.market_summary)}</p>
      ${(h.trackedMovers || []).length ? `<p class="small"><b>Your watchlist movers:</b> ${h.trackedMovers.slice(0, 6).map((m) => `${esc(m.name)} ${pct(m.pct)}`).join(" · ")}</p>` : ""}
      <div class="small muted">${esc(costLine(h.usage))}</div>
    </div>
    ${(h.cards || []).map((c, i) => {
      const pc = c.price_check;
      return `
      <div class="hot-card">
        <div class="rank">${esc(c.rank)}</div>
        <div>
          <div class="hot-name">${esc(c.name)}</div>
          <div class="chips"><span class="chip">${esc(CAT_LABEL[c.category] || c.category)}</span><span class="chip warn">${esc(signalLabel[c.signal] || c.signal)}</span>${movementChip(c.movement)}</div>
          <p class="small" style="margin:.5rem 0 .3rem">${esc(c.why_hot)}</p>
          <p class="small" style="margin:0"><b>Play:</b> ${esc(c.opportunity)}</p>
          ${pc ? `<p class="small muted" style="margin:.35rem 0 0">Sold-price check (${link(pc.url, pc.matched)}): raw ${usd(pc.ungraded)} · PSA 10 ${usd(pc.psa10)} · 1-mo ${pct(pc.trend_1mo)}${pc.last_sale ? ` · last sale ${usd(pc.last_sale.price)} ${esc(pc.last_sale.grade)} on ${esc(pc.last_sale.date)}` : ""}</p>` : ""}
        </div>
        <div class="hot-right">
          <div class="price">${esc(c.recent_price)}</div>
          <div class="small">${esc(c.price_change)}</div>
          <div class="actions" style="justify-content:flex-end;margin-top:.5rem">
            ${pc ? `<button class="small" data-hwatch="${i}">★ Watch</button>` : ""}
            <button class="small research-this" data-q="${esc(c.search_query)}">Research →</button>
          </div>
        </div>
      </div>`;
    }).join("")}
    ${(h.watch_out || []).length ? `<div class="panel"><h3 style="margin-top:0">Cooling off / watch out</h3><ul class="tight small">${h.watch_out.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    ${(h.sources || []).length ? `<div class="panel"><h3 style="margin-top:0">Sources</h3><div class="sources">${h.sources.map((s) => link(s.url, s.title)).join("")}</div></div>` : ""}`;
  $$(".research-this").forEach((b) => (b.onclick = () => {
    photos = []; renderThumbs();
    $("#lookupText").value = b.dataset.q;
    goTab("lookup");
  }));
  $$("[data-hwatch]").forEach((b) => (b.onclick = async () => {
    const c = h.cards[+b.dataset.hwatch];
    const r = await fetch("/api/watchlist", json("POST", { url: c.price_check.url, name: c.price_check.matched, grade: "Raw" }));
    b.textContent = r.ok ? "★ Watching" : "Couldn't add";
    b.disabled = true;
  }));
}

// ------------------------------------------------------------------ watchlist + alerts

async function loadWatch() {
  const [{ items, movers }, alerts] = await Promise.all([getJSON("/api/watchlist"), getJSON("/api/alerts")]);
  const unseen = alerts.filter((a) => !a.seen);
  const alertText = (a) => (a.kind === "brief" ? `☀️ <b>${esc(a.name)}</b>: ${esc(a.text)} <a href="#" data-gohot>Open</a>`
    : a.text ? `${a.kind === "order" ? "🛒" : a.kind === "ticket" ? "✉" : a.kind === "pricing" ? "📈" : "🔔"} <b>${esc(a.name)}</b>: ${esc(a.text)}` // website orders, messages, pricing-engine notices
    : `🔔 <b>${esc(a.name)}</b> is ${a.kind === "above" ? "up to" : "down to"} <b>${usd(a.value)}</b> (your ${a.kind === "above" ? "sell" : "buy"} target ${usd(a.target)})`);
  $("#alertList").innerHTML = unseen.length
    ? unseen.map((a) => `<div class="alert-item" role="status"><span>${alertText(a)} · ${esc(when(a.at))}</span></div>`).join("") +
      `<div class="row" style="margin:0 0 1rem"><button id="alertsSeen">Mark alerts as read</button>${"Notification" in window && Notification.permission !== "granted" ? `<button id="alertsNotify" class="ghost">Enable desktop alerts</button>` : ""}</div>`
    : "Notification" in window && Notification.permission === "default" && items.length ? `<div class="row" style="margin:0 0 1rem"><button id="alertsNotify" class="ghost">🔔 Enable desktop alerts</button></div>` : "";
  if ($("#alertsSeen")) $("#alertsSeen").onclick = async () => { await fetch("/api/alerts/seen", { method: "POST" }); refreshStatus(); loadWatch(); };
  if ($("#alertsNotify")) $("#alertsNotify").onclick = async () => { await Notification.requestPermission(); loadWatch(); };
  $$("[data-gohot]").forEach((a) => (a.onclick = (e) => { e.preventDefault(); hotCat = "all"; hotPeriod = "daily"; goTab("hot"); }));

  const moverBox = (title, list) => `<div class="panel"><h3 style="margin-top:0">${title}</h3>${list.length
    ? `<table>${list.slice(0, 6).map((m) => `<tr><td class="small">${esc(m.name)}</td><td class="num">${usd(m.to)}</td><td class="num">${pct(m.pct)}</td></tr>`).join("")}</table>`
    : `<p class="muted small">Not enough price history yet. Check back after a few daily re-checks.</p>`}</div>`;
  $("#movers").innerHTML = moverBox("Biggest movers · 24h", movers.daily) + moverBox("Biggest movers · 7 days", movers.weekly) + moverBox("Biggest movers · 30 days", movers.monthly);
  $("#watchList").innerHTML = items.length
    ? `<div class="panel table-wrap"><table><tr><th>Card</th><th>Tracking</th><th class="num">Added at</th><th class="num">Latest</th><th class="num">Change</th><th class="num">vs 12-mo avg</th><th>Alert me at</th><th></th></tr>
      ${items.map((w) => {
        const pts = w.snapshots.filter((s) => s.value != null);
        const first = pts[0]?.value, last = pts[pts.length - 1]?.value;
        const ch = first && last ? Math.round(((last - first) / first) * 1000) / 10 : null;
        const vsAvg = last && w.avg12 ? Math.round(((last - w.avg12) / w.avg12) * 1000) / 10 : null;
        const badge = vsAvg == null ? "" : vsAvg <= -15 ? ` <span class="chip good" title="Well below its 12-month average">Dip</span>` : vsAvg >= 25 ? ` <span class="chip warn" title="Well above its 12-month average">Peak</span>` : "";
        return `<tr data-id="${esc(w.id)}"><td><b>${esc(w.card?.name)}</b><div class="small muted">${esc(CAT_LABEL[w.category] || "")} ${w.pricechartingUrl ? "· " + link(w.pricechartingUrl, "sales") : "· no price source (won't auto-update)"}${w.addedBy ? " · " + esc(w.addedBy) : ""}</div></td>
          <td class="small">${esc(w.card?.grading_company ? `${w.card.grading_company} ${w.card.grade}` : "Raw")}</td>
          <td class="num">${usd(first)}</td><td class="num">${usd(last)}<div class="small muted">${pts.length ? esc(when(pts[pts.length - 1].at)) : ""}</div></td><td class="num">${pct(ch)}${sparkline(pts.map((s) => s.value))}</td>
          <td class="num">${pct(vsAvg)}${badge}</td>
          <td class="targets small">≥ <input type="number" min="0" step="1" data-t="targetAbove" value="${esc(w.targetAbove ?? "")}" aria-label="Alert when price rises to"> ≤ <input type="number" min="0" step="1" data-t="targetBelow" value="${esc(w.targetBelow ?? "")}" aria-label="Alert when price falls to"></td>
          <td><button class="ghost small" data-del aria-label="Remove from watchlist">Remove</button></td></tr>`;
      }).join("")}</table></div>`
    : `<div class="empty"><h2>Nothing on the watchlist yet</h2><p>Click <b>★ Watch</b> on any report, quick price, set card or hot card. The bot re-prices watched cards daily and shows your biggest movers here.</p></div>`;
  $$("#watchList tr[data-id]").forEach((tr) => {
    const save = async () => {
      await fetch("/api/watchlist/" + tr.dataset.id, json("PATCH", { targetAbove: $("[data-t=targetAbove]", tr).value, targetBelow: $("[data-t=targetBelow]", tr).value }));
      toast("Alert target saved", { ms: 1500 });
    };
    $$("[data-t]", tr).forEach((i) => (i.onchange = save));
    $("[data-del]", tr).onclick = () => removeWithUndo("/api/watchlist/" + tr.dataset.id, "from watchlist", loadWatch);
  });
}
TAB_LOADERS.watch = loadWatch;
$("#watchRefresh").onclick = async () => {
  const b = $("#watchRefresh");
  b.disabled = true; b.textContent = "Checking…";
  await fetch("/api/watchlist/refresh", { method: "POST" });
  b.disabled = false; b.textContent = "↻ Re-check prices now";
  refreshStatus();
  loadWatch();
};

// ------------------------------------------------------------------ ask

const askHistory = [];
let askLookup = null, askCtrl = null;

function setAskContext(r) {
  askLookup = r;
  const box = $("#askContext");
  box.classList.toggle("hidden", !r);
  if (r) {
    box.innerHTML = `<div class="row space" style="margin:0"><span>Asking about: <b>${esc(r.card?.name)}</b> (${usd(r.pricing?.estimated_value_usd)})</span><button class="ghost small" id="askClear">✕ Clear</button></div>`;
    $("#askClear").onclick = () => setAskContext(null);
  }
}

function md(src) {
  // Small, safe Markdown renderer: escape first, then format.
  const lines = esc(src).split("\n");
  let html = "", inList = false, table = [];
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim())));
    html += `<div class="table-wrap"><table><tr>${rows[0].map((c) => `<th>${c}</th>`).join("")}</tr>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table></div>`;
    table = [];
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\s*\|/.test(l)) { table.push(l.trim()); continue; } else flushTable();
    if (/^\s*([-*]|\d+\.) /.test(l)) { if (!inList) { html += "<ul class='tight'>"; inList = true; } html += `<li>${inline(l.replace(/^\s*([-*]|\d+\.) /, ""))}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    const h = l.match(/^(#{1,4}) (.*)/);
    if (h) html += `<h3>${inline(h[2])}</h3>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  flushTable();
  if (inList) html += "</ul>";
  return html;
}

async function doAsk(question) {
  if (needKey()) return;
  question = (question || "").trim();
  if (!question) return;
  const chat = $("#chat");
  $(".empty", chat)?.remove();
  chat.insertAdjacentHTML("beforeend", `<div class="msg q">${esc(question)}</div>`);
  $("#askInput").value = "";
  $("#askBtn").disabled = true;
  $("#askCancel").classList.remove("hidden");
  askCtrl = new AbortController();
  try {
    const { answer } = await streamPost("/api/ask", { question, history: askHistory, lookupId: askLookup?.id }, $("#askProgress"), askCtrl);
    askHistory.push({ q: question, a: answer.answer_markdown.slice(0, 1500) });
    chat.insertAdjacentHTML("beforeend", `<div class="msg a">${md(answer.answer_markdown)}
      ${(answer.sources || []).length ? `<h3>Sources</h3><div class="sources">${answer.sources.map((s) => link(s.url, s.title)).join("")}</div>` : ""}
      <div class="followups">${(answer.follow_up_ideas || []).map((f) => `<button>${esc(f)}</button>`).join("")}</div>
      <div class="small muted" style="margin-top:.4rem">${esc(costLine(answer.usage))}</div></div>`);
    $$(".msg.a:last-child .followups button").forEach((b) => (b.onclick = () => doAsk(b.textContent)));
    $("#askProgress").classList.add("hidden");
  } catch (err) {
    chat.insertAdjacentHTML("beforeend", `<div class="msg a error" role="alert">⚠ ${esc(err.message)} ${err.message === "Cancelled." ? "" : `<button class="small" data-retry>↻ Try again</button>`}</div>`);
    const rb = $(".msg.a.error:last-child [data-retry]", chat);
    if (rb) rb.onclick = () => { rb.closest(".msg").remove(); doAsk(question); };
  } finally {
    $("#askBtn").disabled = false;
    $("#askCancel").classList.add("hidden");
  }
}
$("#askBtn").onclick = () => doAsk($("#askInput").value);
$("#askCancel").onclick = () => askCtrl?.abort();
$("#askInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doAsk($("#askInput").value); });

// ------------------------------------------------------------------ history

let historyCache = [];
async function loadHistory() {
  historyCache = await getJSON("/api/lookups");
  drawHistory();
}
TAB_LOADERS.history = loadHistory;
function drawHistory() {
  const q = $("#histSearch").value.trim().toLowerCase();
  const list = historyCache.filter((r) => !q || JSON.stringify([r.card?.name, r.card?.player_or_character, r.card?.brand_set, r.card?.category, r.by]).toLowerCase().includes(q));
  $("#historyList").innerHTML = list.length
    ? list.map((r) => `<div class="hist" data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="Open report for ${esc(r.card?.name)}">
        <div class="hist-left">${r.thumb ? `<img class="hist-thumb" src="${esc(r.thumb)}" alt="">` : ""}<div><b>${esc(r.card?.name)}</b><div class="small muted">${esc(CAT_LABEL[r.card?.category] || "")} · ${esc(when(r.at))}${r.by ? " · " + esc(r.by) : ""}${r.slab ? (r.slab.verified ? " · ✅ cert" : " · ⚠ cert") : ""}</div></div></div>
        <div class="row" style="margin:0"><div class="value-big" style="font-size:1.2rem">${usd(r.pricing?.estimated_value_usd)}</div><button class="ghost small" data-del aria-label="Delete this report">🗑</button></div></div>`).join("")
    : `<div class="empty"><h2>${q ? "No matches" : "No lookups yet"}</h2><p>${q ? "Try another search." : "Every AI card report is saved here."}</p></div>`;
  $$(".hist").forEach((el) => {
    const r = historyCache.find((x) => x.id === el.dataset.id);
    const open = () => { goTab("lookup"); renderReport(r, $("#lookupResult")); };
    el.onclick = open;
    el.onkeydown = (e) => { if (e.key === "Enter") open(); };
    $("[data-del]", el).onclick = (e) => {
      e.stopPropagation();
      removeWithUndo("/api/lookups/" + r.id, "report", loadHistory);
    };
  });
}
$("#histSearch").oninput = drawHistory;

// ------------------------------------------------------------------ start

applyTheme();
renderWho();
refreshStatus().then(() => {
  // Signed in with the helper PIN: Show mode only (the server refuses everything else anyway).
  if (status.role === "helper") {
    document.body.classList.add("helper");
    $$("#tabs button").forEach((b) => (b.hidden = b.dataset.tab !== "inventory"));
    $$("#invView button").forEach((b) => (b.hidden = b.dataset.v !== "show"));
    ["#settingsBtn", "#keyBanner"].forEach((s) => $(s)?.classList.add("hidden"));
    invView = "show";
    return goTab("inventory");
  }
  const t = store.get("tab", "home");
  goTab($(`#tabs button[data-tab="${t}"]`) ? t : "home");
  if (!store.get("who")) setTimeout(() => $("#whoBtn").click(), 400);
  checkUpdates();
});

// ------------------------------------------------------------------ v3.2: search, updates, tooltips, advisor, errors

const categoryOfUrl = (url) => { const m = String(url || "").match(/\/game\/(baseball|basketball|football|hockey|soccer)-cards|\/game\/(yugioh|one-piece|pokemon)/); return m ? (m[1] || (m[2] === "one-piece" ? "onepiece" : m[2])) : "other"; };

function sparkline(values) {
  const v = values.filter((x) => x != null);
  if (v.length < 2) return "";
  const W = 80, H = 22, lo = Math.min(...v), hi = Math.max(...v);
  const pts = v.map((y, i) => `${(i / (v.length - 1)) * W},${H - 2 - (hi === lo ? H / 2 : ((y - lo) / (hi - lo)) * (H - 4))}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline fill="none" stroke="${v[v.length - 1] >= v[0] ? "#1f8a70" : "#c2341b"}" stroke-width="1.6" points="${pts}"/></svg>`;
}

// Hover tooltip for every price chart on the page (nearest month per series).
const chartTip = document.createElement("div");
chartTip.className = "chart-tip hidden";
document.body.appendChild(chartTip);
document.addEventListener("mousemove", (e) => {
  const svg = e.target.closest?.("svg.chart[data-chart]");
  if (!svg) return chartTip.classList.add("hidden");
  let d;
  try { d = JSON.parse(svg.dataset.chart); } catch { return; }
  const r = svg.getBoundingClientRect();
  const vx = ((e.clientX - r.left) / r.width) * d.W;
  const t = d.t0 + ((vx - d.L) / Math.max(1, d.W - d.L - d.R)) * (d.t1 - d.t0);
  const rows = d.keys.map((k, i) => {
    const pts = d.series[k];
    let best = pts[0];
    for (const p of pts) if (Math.abs(p[0] - t) < Math.abs(best[0] - t)) best = p;
    return { k, p: best, color: SERIES_COLORS[i] };
  });
  const month = new Date(rows[0].p[0]).toLocaleDateString([], { month: "short", year: "numeric" });
  chartTip.innerHTML = `<b>${esc(month)}</b>${rows.map((x) => `<div><span style="color:${x.color}">●</span> ${esc(x.k)}: ${usd(x.p[1])}</div>`).join("")}`;
  chartTip.style.left = Math.min(window.innerWidth - 190, e.clientX + 14) + "px";
  chartTip.style.top = e.clientY + 14 + "px";
  chartTip.classList.remove("hidden");
});

function openSearch() {
  const body = openModal("Search everything", `<input id="gsInput" type="search" placeholder="Card, player, SKU, location, tag…" aria-label="Search"><div id="gsOut" style="margin-top:.6rem"></div>`);
  const input = $("#gsInput", body);
  input.focus();
  let timer;
  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const q = input.value.trim();
      const out = $("#gsOut", body);
      if (q.length < 2) return (out.innerHTML = "");
      const r = await getJSON("/api/search?q=" + encodeURIComponent(q));
      const sec = (key, title, items, fn) => (items.length ? `<h3>${title}</h3>${items.map((it, i) => `<div class="mini-row" data-s="${key}:${i}" role="button" tabindex="0"><span>${fn(it)}</span></div>`).join("")}` : "");
      out.innerHTML =
        sec("inventory", "Inventory", r.inventory, (it) => `${esc(it.name)} <span class="muted small">${esc(it.grade)} · ${esc((window.STATUS_LABEL || {})[it.status] || it.status)}${it.sku ? " · " + esc(it.sku) : ""} · ${usd(it.value)}</span>`) +
        sec("lookups", "Reports", r.lookups, (it) => `${esc(it.name)} <span class="muted small">${usd(it.value)} · ${esc(when(it.at))}</span>`) +
        sec("watchlist", "Watchlist", r.watchlist, (it) => esc(it.name)) +
        sec("wantlist", "Want list", r.wantlist, (it) => `${esc(it.name)} <span class="muted small">${esc(it.grade)}${it.maxPrice != null ? " · max " + usd(it.maxPrice) : ""}</span>`) ||
        `<p class="muted small">No matches.</p>`;
      $$("[data-s]", out).forEach((el) => {
        const [key, i] = el.dataset.s.split(":");
        const it = r[key][+i];
        const go = async () => {
          modal.close();
          if (key === "inventory") { invFilter.q = it.name; invFilter.status = "all"; invView = "stock"; goTab("inventory"); }
          else if (key === "lookups") { const list = await getJSON("/api/lookups"); const rep = list.find((x) => x.id === it.id); if (rep) { goTab("lookup"); renderReport(rep, $("#lookupResult")); } }
          else if (key === "watchlist") goTab("watch");
          else { invView = "want"; goTab("inventory"); }
        };
        el.onclick = go;
        el.onkeydown = (e) => e.key === "Enter" && go();
      });
    }, 200);
  };
}

// Desktop app: download the installer from the release (checked against GitHub's checksum) and run it.
// Windows installs and reopens by itself; on a Mac the installer window opens for the usual drag to Applications.
async function installUpdate(asset) {
  const btn = $("#updateNow"), out = $("#updateProgress");
  if (btn) btn.disabled = true;
  window.desktop.onUpdateProgress?.((m) => {
    if (!out) return;
    out.textContent = m.stage === "install" ? (window.desktop.platform === "win32" ? "Installing — the app will close and reopen…" : "Opening the installer…") : `Downloading… ${m.pct != null ? m.pct + "%" : Math.round(m.got / 1e6) + " MB"}`;
  });
  const r = await window.desktop.installUpdate(asset);
  if (!r.ok) {
    if (out) out.innerHTML = `<span class="bad">${esc(r.error)}</span> <a href="${esc(asset.url)}" target="_blank" rel="noopener">Download it yourself</a>`;
    if (btn) btn.disabled = false;
  }
}

async function checkUpdates(force = false, show = false) {
  try {
    const u = await getJSON("/api/update-check" + (force ? "?force=1" : ""));
    const plat = (window.desktop?.platform || navigator.platform || "").toLowerCase();
    const want = /win/.test(plat) ? /\.exe$/i : /mac|darwin/.test(plat) ? /\.dmg$/i : null;
    const asset = want ? (u.assets || []).find((a) => want.test(a.name)) : null;
    const banner = $("#updateBanner");
    const oneClick = asset && window.desktop?.installUpdate;
    if (u.available && (show || store.get("dismissedUpdate") !== u.latest)) {
      banner.innerHTML = `⬆ Version <b>${esc(u.latest)}</b> is available (you have ${esc(u.current)}). ${oneClick ? `<button class="primary" id="updateNow">Update now</button>` : asset ? `<a class="button" href="${esc(asset.url)}" target="_blank" rel="noopener">Download ${esc(asset.name)}</a>` : `<a class="button" href="${esc(u.url)}" target="_blank" rel="noopener">Open download page</a>`} <button class="ghost" id="dismissUpdate">Later</button>
        <span id="updateProgress" class="small"></span>${u.whatsNew ? `<details class="whats-new"><summary>What's new</summary>${md(u.whatsNew.replace(/^## .*\n/, ""))}</details>` : ""}`;
      banner.classList.remove("hidden");
      $("#dismissUpdate").onclick = () => { store.set("dismissedUpdate", u.latest); banner.classList.add("hidden"); };
      if (oneClick) $("#updateNow").onclick = () => installUpdate(asset);
    } else banner.classList.add("hidden");
    if (show && $("#updateBox")) {
      $("#updateBox").innerHTML = u.error ? `<span class="bad">Couldn't check: ${esc(u.error)}</span>`
        : u.private ? `Couldn't check automatically (the GitHub project is private). ${link(u.url, "Open the releases page")} and sign in to GitHub there.`
        : u.available ? `<span class="ok">Version ${esc(u.latest)} is available.</span> ${asset ? link(asset.url, "Download " + asset.name) : link(u.url, "Open download page")} — install it over this one; your data is kept.`
        : `<span class="ok">✓ You're on the latest version (${esc(u.current)}).</span>`;
    }
    return u;
  } catch (err) {
    if (show && $("#updateBox")) $("#updateBox").innerHTML = `<span class="bad">${esc(err.message)}</span>`;
  }
}

// ---- AI inventory advisor ----
let advisorCtrl = null;
const ACTION_LABEL = { sell_now: ["Sell now", "bad"], list_it: ["List it", "good"], drop_price: ["Drop price", "warn"], hold: ["Hold", ""], grade_it: ["Grade it", "good"], buy_more: ["Buy more", "good"], watch: ["Watch", ""] };
function renderAdvice(a, el, { compact = false } = {}) {
  if (!a) return (el.innerHTML = "");
  const actions = compact ? (a.actions || []).slice(0, 4) : a.actions || [];
  el.innerHTML = `<div class="${compact ? "" : "panel"}">
    ${compact ? "" : `<div class="row space" style="margin:0"><h2 style="margin:0">Inventory plan</h2><span class="small muted">${esc(when(a.at))} · ${a.cards} cards · ${esc(a.by || "")}</span></div>`}
    <p class="${compact ? "small" : "summary"}">${esc(a.summary)}</p>
    <div class="table-wrap"><table>${actions.map((x) => `<tr><td><span class="chip ${ACTION_LABEL[x.action]?.[1] || ""}">${esc(ACTION_LABEL[x.action]?.[0] || x.action)}</span></td><td><b>${esc(x.card)}</b>${compact ? "" : `<div class="small">${esc(x.reasoning)}</div>`}</td><td class="num">${usd(x.target_price)}</td><td class="small muted">${esc(x.urgency?.replace("_", " "))}</td></tr>`).join("")}</table></div>
    ${compact ? `<button class="ghost small" data-go="ask" style="margin-top:.4rem">Full plan →</button>` : `
      ${(a.market_notes || []).length ? `<h3>Market notes</h3><ul class="tight small">${a.market_notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      ${(a.risks || []).length ? `<h3>Risks</h3><ul class="tight small">${a.risks.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      ${(a.sources || []).length ? `<h3>Sources</h3><div class="sources">${a.sources.map((s) => link(s.url, s.title)).join("")}</div></div>` : ""}
      <div class="small muted" style="margin-top:.5rem">${esc(costLine(a.usage))}</div>`}
  </div>`;
  const go = $("[data-go]", el);
  if (go) go.onclick = () => goTab("ask");
}
async function loadAdvice() {
  try { renderAdvice(await getJSON("/api/advice"), $("#advisorOut")); } catch {}
}
$("#advisorBtn").onclick = async () => {
  if (needKey()) return;
  $("#advisorBtn").disabled = true;
  $("#advisorCancel").classList.remove("hidden");
  advisorCtrl = new AbortController();
  try {
    const { advice } = await streamPost("/api/advisor", {}, $("#advisorProgress"), advisorCtrl);
    renderAdvice(advice, $("#advisorOut"));
    $("#advisorProgress").classList.add("hidden");
  } catch (err) {
    toast(err.message, { error: true });
    $("#advisorProgress").classList.add("hidden");
  } finally {
    $("#advisorBtn").disabled = false;
    $("#advisorCancel").classList.add("hidden");
  }
};
$("#advisorCancel").onclick = () => advisorCtrl?.abort();
TAB_LOADERS.ask = loadAdvice;

// ---- the desktop shell (tray menu, notification clicks) can ask for a screen ----
window.desktop?.onGoto?.((where) => {
  const inv = { show: "show", mjc: "mjc", "mjc-messages": "mjc", "mjc-pricing": "mjc" }[where];
  if (inv) {
    if (where === "mjc-messages") mjcTab = "messages";
    else if (where === "mjc-pricing") mjcTab = "pricing";
    else if (where === "mjc") mjcTab = "orders";
    invView = inv;
    goTab("inventory");
  } else if (where === "updates") {
    openSettings();
    checkUpdates(true, true);
  } else if (["watch", "hot", "home"].includes(where)) goTab(where);
});

// ---- unexpected errors become a toast instead of silence ----
window.addEventListener("unhandledrejection", (e) => toast(String(e.reason?.message || e.reason || "Something went wrong"), { error: true }));
window.addEventListener("error", (e) => { if (e.message && !/ResizeObserver/.test(e.message)) toast(e.message, { error: true }); });
