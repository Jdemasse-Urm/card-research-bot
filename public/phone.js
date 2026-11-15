// Card Scanner — the phone camera for Bulk scan. Every picture goes to the computer's scan inbox at full resolution,
// through a queue that survives a dropped signal, and what the computer found comes back here per picture: how many
// cards, which need a retake (glare, blur, cut off), each card's name and value, whether it's already in stock, and its
// inventory number once it's added — while the cards are still on the table.
// Names tell the computer how pictures go together: phone-<session>-<n>-a (front), -b (back), -s (one picture).
// Two ways to the computer (3.20): through the MJC store — this page at /scan/ on the store's address, from any Wi-Fi or
// cell signal (no signal: pictures wait here and go when it's back) — or straight to it on the home Wi-Fi (/phone).
// Inventory changes only by "＋ Add": here (the computer that read the pictures adds the cards it trusts; ⚠ ones wait
// for a check on a computer) or on the computer. The website changes only from the computer.
// 3.21: an app with four tabs — Scan (the shutter and what was just read), Cards (every card, filters, ＋ Add), History
// (this session and earlier ones on this phone, shareable) and Settings. The sending, reading and adding underneath are
// the same as 3.20.
// A phone still on the old address (/phone.html, before 3.19.1) moves to /phone?s=…, the one that can go on the Home
// Screen (the computer itself, testing on localhost, stays put).
if (location.pathname === "/phone.html" && !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname)) location.replace("/phone");
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (v) => (v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}`);
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const ls = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: this session only */ } },
};
const PROBLEM = { glare: "glare", blurry: "blurry", cut_off: "cut off by the edge", too_small: "too small", covered: "covered" };

const CLOUD = location.pathname.startsWith("/scan");
// the scanner key is in the address the QR code or Home Screen icon opened (kept, should the page open without it)
const KEY = CLOUD ? (() => { const k = new URLSearchParams(location.search).get("s"); if (k) ls.set("scanKey", k); return k || ls.get("scanKey", ""); })() : "";
const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
/** A call to the computer: through the store (with the scanner key) or straight to it */
const api = (url, opts = {}) => fetch(url, CLOUD ? { ...opts, headers: { ...(opts.headers || {}), "x-scan-key": KEY } } : opts);
const API = CLOUD
  ? { status: (s) => `/scan/status?session=${encodeURIComponent(s)}`, single: (n) => `/scan/pic/${encodeURIComponent(n)}/single`, pic: (n) => `/scan/pic/${encodeURIComponent(n)}`, add: "/scan/add" }
  : { status: (s) => `/api/scan/phone-status?session=${encodeURIComponent(s)}`, single: (n) => `/api/scan/inbox/${encodeURIComponent(n)}/single`, pic: (n) => `/api/scan/inbox/${encodeURIComponent(n)}`, add: "/api/scan/phone-add" };
let linkGone = false; // the store said this link was replaced (a new one was made on the computer)
// with no signal at all, the page still opens from the phone (the store's address is https, so it can keep a copy)
if (CLOUD && "serviceWorker" in navigator) navigator.serviceWorker.register("phone-sw.js").catch(() => {});
/** "2:45 PM" today, "Nov 5, 2:45 PM" before */
const when = (t) => new Date(t).toLocaleString(undefined, new Date(t).toDateString() === new Date().toDateString() ? { hour: "numeric", minute: "2-digit" } : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ---------------------------------------------------------------- this phone's settings (kept on the phone)

const PREF_KEY = { both: "phoneBoth", sound: "phoneSound", awake: "phoneAwake", theme: "phoneTheme", tab: "phoneTab", view: "phoneView", filter: "phoneFilter", sort: "phoneSort" };
const prefs = {
  both: ls.get("phoneBoth", true), // the back has the number, year and set — on unless this phone turned it off
  sound: ls.get("phoneSound", false),
  awake: ls.get("phoneAwake", true),
  theme: ls.get("phoneTheme", "auto"),
  tab: ls.get("phoneTab", "scan"),
  view: ls.get("phoneView", "cards"),
  filter: ls.get("phoneFilter", "all"),
  sort: ls.get("phoneSort", "value"),
};
const setPref = (k, v) => { prefs[k] = v; ls.set(PREF_KEY[k], v); };
const TABS = ["scan", "cards", "history", "settings"];

// ---------------------------------------------------------------- the session

// The session (and what was sent in it) survives a reload, so a page refresh mid-binder doesn't lose the thread. A
// session ends by itself after 4 hours without a picture (11/12: last week's pictures were still showing).
const SESSION_GAP = 4 * 3600000;
let session = ls.get("phoneSession", null) || newSession();
let pics = ls.get("phonePics", []); // [{ name, n, side, thumb, stage, found, problems, cards, error, warn, skus, at, … }]
let card = ls.get("phoneCard", 0), waitingBack = ls.get("phoneWaitingBack", null);
let history = ls.get("phoneHistory", []); // sessions that ended on this phone, newest first (30 kept)
let retakeOf = null; // the next picture replaces this one (its name)
function newSession() {
  const s = Date.now().toString(36);
  ls.set("phoneSession", s);
  return s;
}
const save = () => { ls.set("phonePics", pics.slice(-150).map(({ progress, ...p }) => p)); ls.set("phoneCard", card); ls.set("phoneWaitingBack", waitingBack); };
const sessionOf = (name) => String(name).match(/^phone-(\w+)-/)?.[1] || null;
const byName = (n) => pics.find((p) => p.name === n);
/** Not done yet: still to send (always kept: it's the only copy), or on the computer within the last day */
const unfinished = (p) => p.stage === "queued" || (["sent", "reading", "found", "held"].includes(p.stage) && Date.now() - p.at < 86400000);

/** What a session came to: its cards (name, grade, value, where each went), for History and Share. */
function summarize(id) {
  const mine = pics.filter((p) => sessionOf(p.name) === id && !p.backOf && !p.replacedBy);
  const rows = mine.flatMap((p) => (p.cards || []).map((c) => ({ p, c })));
  const start = parseInt(id, 36) || Date.now();
  return {
    id, start, end: Math.max(start, ...mine.map((p) => p.at || 0)), pictures: mine.length,
    value: Math.round(rows.reduce((n, r) => n + (r.c.value || 0), 0) * 100) / 100,
    added: rows.filter((r) => cardStatus(r.p, r.c) === "added").length,
    usd: mine.reduce((n, p) => n + (p.usd || 0), 0),
    cards: rows.slice(0, 400).map((r) => ({ n: r.c.name, g: r.c.grade || "", v: r.c.value ?? null, s: cardStatus(r.p, r.c), k: skuFor(r.p, r.c) })),
  };
}
function closeSession(id) {
  const s = summarize(id);
  if (!s.pictures) return;
  history = [s, ...history.filter((h) => h.id !== id)].slice(0, 30);
  ls.set("phoneHistory", history);
}

/**
 * A new session: this phone's list starts empty (the one before goes to History). Pictures not done yet come along, so
 * nothing is ever dropped. Nothing on the computer changes — inventory, the website and Bulk scan's list stay as they are.
 */
function startSession(message) {
  closeSession(session);
  pics = pics.filter(unfinished);
  session = newSession();
  card = 0;
  waitingBack = null;
  retakeOf = null;
  save();
  draw();
  if (message) say(message);
}

// ---------------------------------------------------------------- the message at the bottom

let toastTimer = null;
function say(text, kind = "") {
  const t = $("#toast");
  clearTimeout(toastTimer);
  if (!text) { t.className = "toast"; return; }
  t.textContent = text;
  t.className = `toast on ${kind}`;
  // a problem stays until it's dealt with (or tapped away); everything else goes by itself
  if (kind !== "bad") toastTimer = setTimeout(() => (t.className = `toast ${kind}`), kind === "warn" ? 7000 : 4200);
}

// ---------------------------------------------------------------- the picture

let busy = false, lastShotAt = 0;
function setBusy(on) {
  busy = on;
  $("#shoot").classList.toggle("busy", on);
  $("#shoot").setAttribute("aria-busy", String(on));
}

async function takeAll(input) {
  const files = [...input.files];
  input.value = "";
  for (const f of files) await take(f);
}

/** Decode with the phone's rotation applied. */
async function decode(file) {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return new Promise((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = bad;
      i.src = URL.createObjectURL(file);
    });
  }
}

function scaled(img, maxSide) {
  const w = img.width, h = img.height, k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}
const jpegBlob = (canvas, quality) => new Promise((ok) => canvas.toBlob(ok, "image/jpeg", quality));

/**
 * What goes to the computer: the camera's own JPEG, untouched, when it's at most 4096 px (an iPhone's is 4032).
 * Before 3.19 every picture was re-encoded on the phone (about a second of a frozen page) and sent as base64 text
 * (a third bigger). Anything else (HEIC, PNG, a bigger picture) is re-encoded at 4096 px, the most an iPhone's canvas
 * can hold; the card numbers and serials live in that detail.
 */
async function fullPicture(file, img) {
  if (file.type === "image/jpeg" && Math.max(img.width, img.height) <= 4096) return file;
  return jpegBlob(scaled(img, 4096), 0.9);
}

/**
 * Instant checks before anything is sent (no AI, no waiting): too dark, or so blurry nothing will read. Measured on a
 * small copy: average brightness, and how much the picture changes from pixel to pixel (sharp edges = lots).
 */
function photoCheck(data, w, h) {
  let sum = 0, edges = 0, n = 0;
  const lum = (i) => 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  for (let y = 1; y < h - 1; y += 2) {
    for (let x = 1; x < w - 1; x += 2) {
      const i = (y * w + x) * 4, c = lum(i);
      sum += c;
      // Laplacian: the centre against its four neighbours
      const lap = 4 * c - lum(i - 4) - lum(i + 4) - lum(i - w * 4) - lum(i + w * 4);
      edges += lap * lap;
      n++;
    }
  }
  const bright = sum / n, sharp = edges / n;
  return bright < 45 ? "too dark — more light, or turn the flash on" : sharp < 18 ? "looks blurry — hold the phone still and let it focus" : "";
}
function quickCheck(img) {
  try {
    const c = scaled(img, 480);
    return photoCheck(c.getContext("2d").getImageData(0, 0, c.width, c.height).data, c.width, c.height);
  } catch {
    return "";
  }
}

async function take(file) {
  // a picture after hours away starts a new session first (the page may have stayed open since then)
  const last = Math.max(0, ...pics.map((p) => p.at || 0));
  if (pics.length && Date.now() - last > SESSION_GAP) startSession("");
  let side = "s", n;
  if (prefs.both) {
    if (waitingBack == null) { n = waitingBack = ++card; side = "a"; }
    else { n = waitingBack; waitingBack = null; side = "b"; }
  } else n = ++card;
  save();
  setBusy(true);
  let img, blob;
  try {
    img = await decode(file);
    blob = await fullPicture(file, img);
    if (!blob) throw new Error("no picture");
  } catch {
    if (side === "a") { waitingBack = null; card--; } else if (side === "b") waitingBack = n; else card--;
    save();
    setBusy(false);
    draw();
    return say("That picture couldn't be opened — try again.", "bad");
  }
  const warn = quickCheck(img);
  const thumb = scaled(img, 300).toDataURL("image/jpeg", 0.72);
  img.close?.();
  const name = `phone-${session}-${String(n).padStart(4, "0")}-${side}`;
  const pic = { name: name + ".jpg", n, side, thumb, stage: "queued", warn, at: Date.now() };
  // a retake: the new picture stands in for the old one here (the old one's cards leave the totals and ＋ Add)
  const old = retakeOf && byName(retakeOf);
  if (old) { old.replacedBy = n; pic.retakeOf = old.n; }
  retakeOf = null;
  pics.push(pic);
  lastShotAt = Date.now();
  save();
  await enqueue({ name, blob });
  setBusy(false);
  draw();
  keepAwake();
  if (warn) say(`#${n}: ${warn}. Sent anyway — retake it if it can't be read.`, "warn");
  else if (side === "a") say(`#${n} front sent. Flip it over and take the back.`, "good");
  else say(`#${n}${side === "b" ? " back" : ""} sent${old ? ` — it replaces #${old.n}` : ""}.`, "good");
  pump();
}

// ---------------------------------------------------------------- the send queue (survives a dropped signal)

let mem = []; // used when the phone won't keep a database (private browsing)
let dbp = null;
const db = () => (dbp ||= new Promise((ok, bad) => {
  const r = indexedDB.open("cardbot-phone", 1);
  r.onupgradeneeded = () => r.result.createObjectStore("queue", { keyPath: "name" });
  r.onsuccess = () => ok(r.result);
  r.onerror = () => bad(r.error);
}));
async function store(mode, fn) {
  const d = await db();
  return new Promise((ok, bad) => {
    const t = d.transaction("queue", mode);
    const out = fn(t.objectStore("queue"));
    t.oncomplete = () => ok(out?.result);
    t.onerror = () => bad(t.error);
  });
}
async function enqueue(item) {
  try { await store("readwrite", (s) => s.put(item)); } catch { mem.push(item); }
}
async function dequeue(name) {
  mem = mem.filter((x) => x.name !== name);
  try { await store("readwrite", (s) => s.delete(name)); } catch { /* memory only */ }
}
async function queued() {
  let list = [];
  try { list = await store("readonly", (s) => s.getAll()); } catch { /* memory only */ }
  return [...(list || []), ...mem.filter((m) => !(list || []).some((x) => x.name === m.name))];
}
const queueCount = () => pics.filter((p) => p.stage === "queued").length;

/** A request whose upload can be watched (fetch can't report upload progress): answers like fetch's Response. */
function xhr(method, url, { headers = {}, body, onProgress } = {}) {
  return new Promise((ok, bad) => {
    const x = new XMLHttpRequest();
    x.open(method, url);
    for (const [k, v] of Object.entries(headers)) x.setRequestHeader(k, v);
    if (onProgress && x.upload) x.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    x.timeout = 180000;
    x.onload = () => ok({ ok: x.status >= 200 && x.status < 300, status: x.status, json: async () => { try { return JSON.parse(x.responseText); } catch { return {}; } } });
    x.onerror = x.ontimeout = () => bad(new Error("Failed to fetch"));
    x.send(body);
  });
}

/**
 * One picture to the computer: the JPEG itself (3.19), or a picture queued by an older page (a data URL in JSON).
 * Through the store: a signed link, the picture straight into the store's private folder, then "sent".
 */
async function upload(item, name, onProgress) {
  if (!CLOUD) {
    if (item.blob) return xhr("POST", "/api/scan/inbox?name=" + encodeURIComponent(name), { headers: { "content-type": "image/jpeg" }, body: item.blob, onProgress });
    return fetch("/api/scan/inbox", json({ name, image: item.image }));
  }
  if (!item.blob) return new Response(JSON.stringify({ error: "An old picture from before 3.20 — take it again." }), { status: 400 });
  const up = await api("/scan/upload", json({ name: name + ".jpg", bytes: item.blob.size }));
  if (!up.ok) return up;
  const { url, headers } = await up.json();
  const put = await xhr("PUT", url, { headers, body: item.blob, onProgress });
  if (!put.ok) throw new Error(`the upload stopped (${put.status})`);
  return api("/scan/sent", json({ name: name + ".jpg" }));
}

let pumping = false, backoff = 0, pumpTimer = null, sendTrouble = false;
async function pump() {
  if (pumping || linkGone) return;
  pumping = true;
  clearTimeout(pumpTimer);
  try {
    for (;;) {
      const next = (await queued()).sort((a, b) => (a.name < b.name ? -1 : 1))[0];
      if (!next) break;
      const pic = byName(next.name + ".jpg");
      const sendName = pic?.single ? next.name.replace(/-a$/, "-s") : next.name; // "no back": goes as a single
      try {
        const r = await upload(next, sendName, (f) => { if (pic) { pic.progress = f; progressed(pic); } });
        const j = await r.json().catch(() => ({}));
        if (r.status === 400) { // the computer will never take this one (not a photo): drop it, say why
          await dequeue(next.name);
          if (pic) Object.assign(pic, { stage: "error", error: j.error || "The computer refused this picture." });
          continue;
        }
        if (r.status === 401) { // a new link was made on the computer: this one is retired (the pictures stay here)
          linkGone = true;
          say(j.error || "This scanner link no longer works — scan the new code on the computer (Inventory → Bulk scan → 📱 Phone).", "bad");
          break;
        }
        if (!r.ok) throw new Error(j.error || `The computer said ${r.status}`);
        await dequeue(next.name);
        if (pic?.single) Object.assign(pic, { name: sendName + ".jpg", side: "s", single: false });
        if (pic && pic.stage === "queued") pic.stage = "sent";
        backoff = 0;
        if (sendTrouble) say(CLOUD ? "Back online — sending what was waiting." : "Reached the computer again.", "good");
        sendTrouble = false;
      } catch (err) {
        // no signal, or the computer is busy: keep it, try again soon (and the moment the page is back in view)
        backoff = Math.min(document.hidden ? 30000 : 8000, backoff ? backoff * 2 : 2000);
        const offline = err.message === "Load failed" || err.message === "Failed to fetch" || navigator.onLine === false;
        if (!sendTrouble) {
          say(CLOUD
            ? `${offline ? "No signal" : `Not sent yet (${err.message})`} — pictures wait on this phone and go by themselves when it's back. Keep shooting.`
            : `Not sent yet (${offline ? "can't reach the computer" : err.message}). Same Wi-Fi as the computer? It keeps trying.`, "warn");
        }
        sendTrouble = true;
        pumpTimer = setTimeout(pump, backoff);
        break;
      } finally {
        if (pic) delete pic.progress;
        save();
        drawSoon();
      }
    }
  } finally {
    pumping = false;
  }
}
window.addEventListener("online", () => { backoff = 0; pump(); });
window.addEventListener("offline", () => drawSoon());
// iOS stops the page while the camera is open (11/12: a picture sat "waiting to send" for minutes after it): the
// moment the page is back, send what's waiting and ask what the computer found.
document.addEventListener("visibilitychange", () => {
  keepAwake();
  if (document.hidden) return;
  backoff = 0;
  pump();
  poll();
});
/** Upload progress: only the pill and the picture's bar move (no full redraw for every few kilobytes). */
function progressed(p) {
  drawPill();
  const bar = $(`.tile[data-name="${CSS.escape(p.name)}"] .bar`);
  if (bar) bar.style.setProperty("--p", p.progress.toFixed(3));
}

/**
 * The front just taken has no back worth shooting (a slab — its label says it all): it's read on its own now. Still on
 * the phone → it goes as a single picture; already at the computer → the computer renames it, instead of holding it
 * 2 minutes for a back.
 */
async function noBack() {
  if (waitingBack == null) return;
  const n = waitingBack;
  waitingBack = null;
  const p = pics.find((x) => x.n === n && x.side === "a" && sessionOf(x.name) === session);
  if (p?.stage === "queued") p.single = true;
  else if (p) {
    const r = await api(API.single(p.name), { method: "POST" }).catch(() => null);
    if (r?.ok) Object.assign(p, { name: p.name.replace(/-a\.jpg$/, "-s.jpg"), side: "s" });
  }
  save();
  draw();
  pump();
  say(`#${n} goes without a back. Take the next card's front.`, "good");
}

const lastUndoable = () => [...pics].reverse().find((x) => ["queued", "sent"].includes(x.stage));
async function undoLast() {
  const p = lastUndoable();
  if (!p) return;
  const base = p.name.replace(/\.jpg$/, "");
  if (p.stage === "queued") await dequeue(base);
  else {
    const r = await api(API.pic(p.name), { method: "DELETE" });
    if (!r.ok) return say((await r.json().catch(() => ({}))).error || "Too late — the computer is already reading it.", "warn");
  }
  pics = pics.filter((x) => x !== p);
  for (const q of pics) if (q.replacedBy === p.n && sessionOf(q.name) === sessionOf(p.name)) delete q.replacedBy; // its retake is undone
  // numbering steps back so the next picture takes its place (a front waiting for its back is forgotten too)
  if (sessionOf(p.name) === session) {
    if (p.side === "b") waitingBack = p.n;
    else { if (p.n === card) card--; if (p.side === "a") waitingBack = null; }
  }
  save();
  draw();
  say(`#${p.n}${p.side === "b" ? " back" : ""} taken back — the computer won't read it.`);
}

// ---------------------------------------------------------------- what the computer found

let computerAge = null, computerName = null, polled = false, pollTimer = null, polling = false;
async function poll() {
  clearTimeout(pollTimer);
  if (polling) return;
  polling = true;
  try {
    // this session and any a not-yet-done picture came from
    const sessions = [...new Set([session, ...pics.map((p) => sessionOf(p.name)).filter(Boolean)])].slice(0, 5);
    const r = await api(API.status(sessions.join(",")));
    if (r.status === 401) linkGone = true;
    if (r.ok) {
      const j = await r.json();
      polled = true;
      computerAge = j.computer;
      computerName = j.computerName || null;
      let readNow = 0, failedNow = 0;
      const addedSkus = [];
      for (const p of pics) {
        const s = j.pictures?.[p.name];
        if (!s || p.stage === "queued") continue;
        if (s.stage === "read" && p.stage !== "read") readNow++;
        if (s.stage === "added" && p.stage !== "added") addedSkus.push(...(s.skus || []));
        if (["error", "held"].includes(s.stage) && s.stage !== p.stage) failedNow++;
        // the store only knows a picture once a computer has taken it: until then it's "sent" here
        if (s.stage === "sent" && p.stage !== "queued" && p.stage !== "sent") continue;
        Object.assign(p, { stage: s.stage, usd: (s.findUsd || 0) + (s.readUsd || 0), found: s.found ?? p.found, problems: s.problems || p.problems || [], cards: s.cards || p.cards, error: s.error || null, backOf: s.backOf || null, skus: s.skus || p.skus, addLeft: s.addLeft ?? p.addLeft });
        // an add the computer has dealt with (added, or left every card for a check) isn't "adding…" any more
        // (the computer's clock may be a little off the phone's: two minutes' grace; nothing after 10 minutes → ask again)
        if (p.addAsked && ((s.addDoneAt || 0) > p.addAsked - 120000 || Date.now() - p.addAsked > 10 * 60000)) p.addAsked = null;
      }
      if (prefs.sound) { if (addedSkus.length) chime(); else if (readNow) beep(880); else if (failedNow) beep(330); }
      if (addedSkus.length) say(`In inventory: ${addedSkus.slice(0, 6).join(", ")}${addedSkus.length > 6 ? ` and ${addedSkus.length - 6} more` : ""} ✓`, "good");
      save();
      draw();
    }
  } catch {
    /* the next poll tries again */
  } finally {
    polling = false;
    pollTimer = setTimeout(poll, pics.some((p) => !["read", "error", "added"].includes(p.stage) || p.addAsked) ? 2000 : 6000);
  }
}

let audio = null;
function tone(freq, at = 0, len = 0.18) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + at;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.15, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(audio.destination);
    o.start(t);
    o.stop(t + len + 0.02);
  } catch { /* no sound on this phone */ }
}
const beep = (freq) => tone(freq);
const chime = () => { tone(660, 0, 0.12); tone(990, 0.12, 0.2); };

/** Same cards as an earlier picture of this session (the page was shot twice)? → that picture's number */
function sameAs(p) {
  const mine = (p.cards || []).map((c) => c.name);
  if (mine.length < 3) return null;
  for (const q of pics) {
    if (q === p || q.replacedBy || q.side !== p.side || q.n >= p.n || sessionOf(q.name) !== sessionOf(p.name) || !(q.cards || []).length) continue;
    const theirs = new Set(q.cards.map((c) => c.name));
    if (mine.filter((n) => theirs.has(n)).length / mine.length >= 0.7) return q.n;
  }
  return null;
}
const firstSentence = (s) => String(s || "").split(/(?<=\.)\s/)[0];

// ---------------------------------------------------------------- each card: where it stands (3.20 ＋ Add, 3.21 look)

/** A card the computer would add without a check: no ⚠ note, no retake, not a slab already in stock */
const trusted = (c) => Boolean(c.name) && !c.check && !c.problem && !c.have?.cert;
/** The computer already looked at this picture's add and kept every card for a check */
const allLeft = (p) => p.stage === "read" && p.addLeft > 0;
const canAdd = (p) => p.stage === "read" && !p.backOf && !p.addAsked && !p.replacedBy && !allLeft(p) && (p.cards || []).some(trusted);
/** A picture worth taking again: the reader said so, couldn't read it, or found no card */
const needsRetake = (p) => !p.replacedBy && !p.backOf && (p.problems?.length > 0 || p.stage === "error" || (p.stage === "found" && p.found === 0) || (p.stage === "read" && !(p.cards || []).length));
function cardStatus(p, c) {
  if (p.replacedBy) return "replaced";
  if (c.have?.cert) return "have";
  if (p.stage === "added") return trusted(c) ? "added" : "check";
  if (c.problem) return "retake";
  if (!trusted(c) || allLeft(p)) return "check";
  if (p.addAsked) return "adding";
  return p.stage === "read" ? "ready" : "reading";
}
const STATUS_LABEL = { ready: "Ready to add", adding: "Adding…", added: "In inventory", check: "Check on a computer", retake: "Retake", have: "Already in stock", reading: "Reading", replaced: "Replaced" };
const skuFor = (p, c) => (p.stage === "added" && trusted(c) ? (p.skus || []).join(", ") : "");
const gradeChip = (g) => (g && !/^raw$/i.test(g) ? `<span class="grade">${esc(g)}</span>` : `<span>Raw</span>`);

/** Ask the computer that read these pictures to add their trusted cards to the shared inventory. */
async function addPictures(list) {
  const n = list.flatMap((p) => p.cards.filter(trusted)).length;
  if (!n) return;
  const paid = Math.max(0, parseFloat($("#paid").value) || 0);
  $("#addBtn").disabled = true;
  try {
    const r = await api(API.add, json({ names: list.map((p) => p.name), paid }));
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) linkGone = true;
    if (!r.ok) throw new Error(j.error || `The computer said ${r.status}`);
    const at = Date.now();
    for (const p of list) p.addAsked = at;
    $("#paid").value = "";
    const nobody = computerAge == null || computerAge > 60;
    say(nobody
      ? `${plural(n, "card")} will go in as soon as Card Research Bot is open on one of your computers.`
      : `Adding ${plural(n, "card")}${paid ? `, ${usd(paid)} split by value` : ""}. Each shows its inventory number in a few seconds.`, "good");
  } catch (err) {
    const offline = /load failed|failed to fetch/i.test(err.message) || navigator.onLine === false;
    say(`Not added yet: ${offline ? "no signal — press ＋ Add again when you have one" : err.message}`, "bad");
  } finally {
    $("#addBtn").disabled = false;
    save();
    draw();
    poll();
  }
}

// ---------------------------------------------------------------- drawing (only what changed reaches the page)

const memo = new Map();
function setHTML(el, html) {
  if (memo.get(el) === html) return false;
  memo.set(el, html);
  el.innerHTML = html;
  return true;
}
let drawQueued = false;
function drawSoon() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => { drawQueued = false; draw(); });
}

/** Everything the tabs show, worked out once per draw */
function model() {
  const live = pics.filter((p) => !p.replacedBy);
  const rows = [];
  for (const p of live) if (!p.backOf) (p.cards || []).forEach((c, i) => rows.push({ p, c, i, st: cardStatus(p, c) }));
  const counts = { all: rows.length, ready: 0, check: 0, added: 0 };
  for (const r of rows) {
    if (r.st === "ready") counts.ready++;
    else if (r.st === "added") counts.added++;
    else if (["check", "retake", "have"].includes(r.st)) counts.check++;
  }
  const ready = rows.filter((r) => r.st === "ready");
  return {
    live, rows, counts,
    value: rows.reduce((n, r) => n + (r.c.value || 0), 0),
    priced: rows.some((r) => r.c.value != null),
    addValue: ready.reduce((n, r) => n + (r.c.value || 0), 0),
    retakes: live.filter(needsRetake).length,
    waiting: queueCount(),
  };
}

let lastModel = null;
function draw() {
  const m = (lastModel = model());
  drawPill();
  drawTabs(m);
  const t = prefs.tab;
  if (t === "scan") drawScan(m);
  else if (t === "cards") drawCards(m);
  else if (t === "history") drawHistory();
  else drawSettings(m);
  if (t !== "cards") showDock(false);
}

/** The pill at the top: how pictures travel right now, in a few words */
function pillState() {
  if (linkGone) return ["bad", "Link replaced — scan the new code"];
  const up = pics.find((p) => p.progress != null);
  const waiting = queueCount();
  if (up) return ["busy", `Sending #${up.n} · ${Math.round(up.progress * 100)}%${waiting > 1 ? ` · ${waiting - 1} more` : ""}`];
  if (navigator.onLine === false || sendTrouble) return ["warn", waiting ? `${CLOUD ? "No signal" : "Can't reach the computer"} · ${waiting} waiting on this phone` : CLOUD ? "No signal" : "Can't reach the computer"];
  if (waiting) return ["busy", `Sending ${plural(waiting, "picture")}`];
  if (!polled) return ["", "Connecting…"];
  const reading = computerAge != null && computerAge < (CLOUD ? 60 : 20);
  if (CLOUD) return reading ? ["good", `${computerName || "Your computer"} is reading`] : ["warn", "No computer open · pictures wait in your store"];
  return reading ? ["good", "The computer is reading"] : ["warn", "The computer isn't picking up"];
}
function drawPill() {
  const [state, text] = pillState();
  const p = $("#pill");
  p.dataset.state = state;
  $("#pillText").textContent = text;
  p.setAttribute("aria-label", `${text}. Open connection settings`);
}

function drawTabs(m) {
  for (const x of TABS) {
    const b = $(`#t-${x}`);
    b.setAttribute("aria-selected", String(x === prefs.tab));
    b.tabIndex = x === prefs.tab ? 0 : -1;
  }
  const b = $("#cardsBadge");
  if (m.counts.ready) {
    b.hidden = false;
    b.className = "badge";
    b.textContent = m.counts.ready > 99 ? "99+" : String(m.counts.ready);
    b.setAttribute("aria-label", `${m.counts.ready} ready to add`);
  } else if (m.retakes) {
    b.hidden = false;
    b.className = "badge alert";
    b.textContent = "";
    b.setAttribute("aria-label", "a picture needs a retake");
  } else b.hidden = true;
}

/** Notices: the reader is down, nobody is picking up, a back with a different count, a page shot twice */
function notesHTML() {
  const notes = [];
  const live = pics.filter((p) => !p.replacedBy);
  const heldPic = [...live].reverse().find((p) => p.stage === "held");
  if (heldPic) {
    const why = firstSentence(heldPic.error) || "the reader is down";
    notes.push(["warn", `The reader is paused: ${why}${/[.!?]$/.test(why) ? "" : "."} Keep going — every picture waits and is read as soon as that's fixed.`]);
  }
  if (linkGone) notes.push(["bad", "This scanner link was replaced on the computer. Scan the new code there (Inventory → Bulk scan → 📱 Phone) and add it to your Home Screen again. Pictures taken here wait on this phone."]);
  else if (polled && live.some((p) => p.stage === "sent" && Date.now() - p.at > 20000) && (computerAge == null || computerAge > 20)) {
    notes.push(["warn", CLOUD
      ? "No computer is picking pictures up right now. They're safe in your MJC store and get read as soon as Card Research Bot is open on one of your computers."
      : "The computer isn't picking pictures up — is Card Research Bot open on it? They wait there until it is."]);
  }
  for (const p of live) {
    if (p.side !== "a" || p.found == null) continue;
    const b = live.find((q) => q.n === p.n && q.side === "b" && q.found != null && sessionOf(q.name) === sessionOf(p.name));
    if (b && b.found !== p.found) notes.push(["warn", `#${p.n}: the front has ${p.found} cards and the back ${b.found} — a back may be missing or two cards overlap. Retake the back with every card flipped in place.`]);
  }
  for (const p of live) { const s = sameAs(p); if (s) notes.push(["warn", `#${p.n} looks like #${s} again — the same page twice?`]); }
  return notes.slice(0, 3).map(([k, t]) => `<div class="note${k === "bad" ? " bad" : ""}">${esc(t)}</div>`).join("");
}

// ---- Scan

let justKey = null;
function drawScan(m) {
  setHTML($("#notesScan"), notesHTML());
  // the newest picture (a back is shown through its front), as it goes: sending → reading → what it is and what it's worth
  const p = [...m.live].reverse().find((x) => x.side !== "b") || m.live[m.live.length - 1];
  let html = "", fresh = false, value = null;
  if (!p) {
    html = `<div class="guide"><b>Ready when you are.</b><ul><li>Lay the card (or a binder page) on something dark.</li><li>Hold the phone straight above it, close enough to fill the picture.</li><li>Tap the gold button. The card's name and value come back here in seconds.</li></ul></div>`;
  } else {
    const who = `#${p.n}${p.side === "a" ? " front" : ""}${p.retakeOf ? `, retake of #${p.retakeOf}` : ""}`;
    const cards = p.cards || [];
    const best = [...cards].sort((a, b) => (b.value || 0) - (a.value || 0))[0];
    let title, line = "", cls = "waiting";
    if (p.stage === "queued") title = p.progress != null ? "Sending…" : navigator.onLine === false || sendTrouble ? "Waiting for a signal" : "Sending…";
    else if (p.stage === "sent") title = p.side === "a" && prefs.both && waitingBack === p.n ? "Sent — now the back" : "Waiting for the computer";
    else if (p.stage === "reading") title = "Reading…";
    else if (p.stage === "held") title = "Waiting for the reader";
    else if (p.stage === "found" && p.found) title = `${plural(p.found, "card")} found — reading them up close`;
    else if (needsRetake(p)) {
      const why = PROBLEM[p.problems?.[0]?.problem] || "a problem";
      title = p.stage === "error" ? `Not read: ${firstSentence(p.error) || "try again"}` : p.problems?.length ? `${why[0].toUpperCase()}${why.slice(1)} — tap to retake` : "No card found — tap to retake";
      line = `<span class="st retake">Retake</span>`;
      cls = "";
    } else if (best) {
      const st = cardStatus(p, best);
      title = best.name;
      value = best.value;
      line = `<span class="val num">${usd(best.value)}</span>${gradeChip(best.grade)}<span class="st ${st}">${STATUS_LABEL[st]}</span>${cards.length > 1 ? `<span class="muted">+${cards.length - 1} more</span>` : ""}`;
      cls = "";
      const key = `${p.name}:${p.stage}`;
      if (key !== justKey && ["read", "added"].includes(p.stage)) { fresh = justKey !== null; justKey = key; }
    } else title = "Reading…";
    if (cls === "waiting") justKey ||= "";
    html = `<button type="button" class="just ${cls}${fresh ? " fresh" : ""}" data-name="${esc(p.name)}"><img alt="" src="${p.thumb}"><span><span class="who">${esc(who)}</span><span class="nm">${esc(title)}</span><span class="line">${line}</span></span></button>`;
  }
  if (setHTML($("#just"), html) && fresh && value != null) countUp($("#just .val"), value);
  // the last dozen pictures at a glance (mid-binder: which are back, which need a retake), newest first
  const recent = [...pics].reverse().filter((x) => x.side !== "b").slice(0, 12);
  setHTML($("#strip"), recent.length > 1 ? recent.map((x) => {
    const [text, kind] = caption(x);
    const s = x.replacedBy ? "" : ["queued", "sent", "reading", "found", "held"].includes(x.stage) && !(x.stage === "found" && x.found === 0) ? "busy" : kind;
    return `<button type="button" data-name="${esc(x.name)}" aria-label="Picture ${x.n}: ${esc(text)}"${x.replacedBy ? ' class="replaced"' : ""}><img alt="" src="${x.thumb}"><span class="no">#${x.n}</span><span class="s ${s}"></span></button>`;
  }).join("") : "");
  for (const seg of [$("#modeSeg"), $("#modeSeg2")]) for (const b of $$("[data-mode]", seg)) b.setAttribute("aria-checked", String((b.dataset.mode === "both") === prefs.both));
  $("#modeHint").textContent = retakeOf ? `Retake: the next picture replaces #${byName(retakeOf)?.n ?? ""}.` : prefs.both ? (waitingBack != null ? `Now flip #${waitingBack} over and take its back.` : "Take the front, then flip it and take the back.") : "One picture for each card or page.";
  const next = prefs.both ? (waitingBack != null ? [waitingBack, "back"] : [card + 1, "front"]) : [card + 1, ""];
  setHTML($("#shootLbl"), `#${next[0]}${next[1] ? `<small>${next[1]}</small>` : ""}`);
  $("#shoot").setAttribute("aria-label", `Take picture ${next[0]}${next[1] ? ", " + next[1] : ""}`);
  const u = lastUndoable();
  $("#undoBtn").hidden = !u;
  if (u) $("#undoBtn").textContent = `Undo #${u.n}${u.side === "b" ? " back" : ""}`;
  $("#noBackBtn").hidden = !(prefs.both && waitingBack != null);
  $("#noBackBtn").textContent = `No back for #${waitingBack ?? ""}`;
  const mini = [];
  if (m.rows.length) mini.push(`<span><b>${m.rows.length}</b> card${m.rows.length === 1 ? "" : "s"}</span>`);
  if (m.priced) mini.push(`<span>worth <b>${usd(m.value)}</b></span>`);
  if (m.counts.ready) mini.push(`<button type="button" class="go" data-go="cards"><b>${m.counts.ready}</b> ready to add</button>`);
  if (m.waiting) mini.push(`<span><b>${m.waiting}</b> waiting to send</span>`);
  setHTML($("#mini"), mini.join(""));
}
/** The one motion moment: a fresh read's value counts up (not for anyone who asked their phone for less motion) */
function countUp(el, to) {
  if (!el || !to || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const dur = 650;
  let t0 = null;
  // timed from the first frame (a frame's own time can be a touch before "now": never below $0), and it always lands
  // on the real value even if the phone stops drawing frames halfway (the page went to the background)
  const step = (t) => {
    t0 ??= t;
    const k = Math.max(0, Math.min(1, (t - t0) / dur));
    el.textContent = usd(Math.round(to * (1 - Math.pow(1 - k, 3)) * 100) / 100);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  setTimeout(() => (el.textContent = usd(to)), dur + 150);
}

// ---- Cards

const FILTERS = [["all", "All"], ["ready", "Ready to add"], ["check", "To check"], ["added", "In inventory"]];
const inFilter = (r, f) => f === "all" || (f === "ready" && r.st === "ready") || (f === "added" && r.st === "added") || (f === "check" && ["check", "retake", "have"].includes(r.st));
function drawCards(m) {
  setHTML($("#sum"), m.rows.length
    ? `<span class="big">${m.priced ? usd(m.value) : "Not priced yet"}</span><span class="sub">${plural(m.rows.length, "card")}${m.counts.added ? `, ${m.counts.added} in inventory` : ""}${m.counts.check ? `, ${m.counts.check} to check` : ""}</span>`
    : `<span class="sub">Nothing read yet this session.</span>`);
  setHTML($("#notesCards"), notesHTML());
  for (const b of $$("#viewSeg [data-view]")) b.setAttribute("aria-selected", String(b.dataset.view === prefs.view));
  $("#cardsView").hidden = prefs.view !== "cards";
  $("#picGrid").hidden = prefs.view !== "pictures";
  if (prefs.view === "cards") {
    const counts = { all: m.counts.all, ready: m.counts.ready, check: m.counts.check, added: m.counts.added };
    setHTML($("#chips"), FILTERS.map(([f, label]) => `<button type="button" data-f="${f}" aria-pressed="${prefs.filter === f}">${label}<span class="n">${counts[f]}</span></button>`).join(""));
    $("#sortBtn").textContent = prefs.sort === "value" ? "By value" : "Newest";
    const q = $("#q").value.trim().toLowerCase();
    const rows = m.rows.filter((r) => inFilter(r, prefs.filter) && (!q || String(r.c.name).toLowerCase().includes(q)));
    rows.sort(prefs.sort === "value" ? (a, b) => (b.c.value || 0) - (a.c.value || 0) : (a, b) => b.p.at - a.p.at || a.i - b.i);
    const label = FILTERS.find(([f]) => f === prefs.filter)?.[1].toLowerCase();
    setHTML($("#cardList"), rows.length
      ? rows.map((r) => `<button type="button" class="row" data-name="${esc(r.p.name)}"><img alt="" src="${r.p.thumb}" loading="lazy"><span><span class="nm">${esc(r.c.name)}</span><span class="meta">${gradeChip(r.c.grade)}<span class="st ${r.st}">${STATUS_LABEL[r.st]}</span><span>#${r.p.n}${skuFor(r.p, r.c) ? ` · ${esc(skuFor(r.p, r.c))}` : ""}</span></span></span><span class="val">${usd(r.c.value)}</span></button>`).join("")
      : !m.rows.length
        ? `<div class="empty"><b>No cards yet</b>Take a picture on the Scan tab. Each card shows up here with its value.</div>`
        : `<div class="empty"><b>Nothing here</b>${q ? `No card matches “${esc(q)}”.` : `No cards ${label} right now.`}</div>`);
  } else {
    setHTML($("#picGrid"), pics.length ? [...pics].reverse().map(tileHTML).join("") : `<div class="empty" style="grid-column:1/-1"><b>No pictures yet</b>Pictures you take show up here with where each one is.</div>`);
  }
  showDock(m.counts.ready > 0 && !linkGone, m);
}
function caption(p) {
  if (p.replacedBy) return [`Replaced by #${p.replacedBy}`, ""];
  if (p.stage === "queued") return [p.progress != null ? `Sending ${Math.round(p.progress * 100)}%` : "Waiting to send", "warn"];
  if (p.stage === "sent") return [CLOUD ? "Sent" : "On the computer", ""];
  if (p.stage === "reading") return ["Reading…", ""];
  if (p.stage === "held") return ["Waiting for the reader", "warn"];
  if (p.stage === "error") return ["Not read — tap", "bad"];
  if (p.stage === "found") return p.found ? [`${p.found} found${p.problems?.length ? `, ${p.problems.length} retake` : ""}`, p.problems?.length ? "warn" : ""] : ["No card — retake", "bad"];
  if (p.stage === "added") return [`In inventory${p.addLeft ? `, ${p.addLeft} to check` : ""}`, p.addLeft ? "warn" : "good"];
  if (p.stage === "read" && p.backOf) return ["Back, read with the front", "good"];
  if (p.stage === "read" && p.addAsked) return ["Adding…", ""];
  if (p.stage === "read" && allLeft(p)) return [`${p.addLeft} to check`, "warn"];
  if (p.stage === "read") {
    const cards = p.cards || [], check = cards.filter((c) => !trusted(c)).length;
    if (!cards.length) return ["No card — retake", "bad"];
    const value = cards.reduce((n, c) => n + (c.value || 0), 0);
    return [`${cards.length === 1 ? "✓" : `✓ ${cards.length}`}${value ? ` ${usd(value)}` : ""}${check ? `, ${check} to check` : ""}`, check ? "warn" : "good"];
  }
  return ["", ""];
}
function tileHTML(p) {
  const [text, kind] = caption(p);
  return `<button type="button" class="tile${p.replacedBy ? " replaced" : ""}" data-name="${esc(p.name)}" aria-label="Picture ${p.n}${p.side === "a" ? " front" : p.side === "b" ? " back" : ""}: ${esc(text)}"><img alt="" src="${p.thumb}" loading="lazy"><span class="no">#${p.n}${p.side === "a" ? " front" : p.side === "b" ? " back" : ""}</span>${text ? `<span class="tag ${kind}">${esc(text)}</span>` : ""}${p.stage === "queued" ? `<span class="bar" style="--p:${(p.progress || 0).toFixed(3)}"></span>` : ""}</button>`;
}
function showDock(on, m) {
  const dock = $("#addBar");
  dock.hidden = !on;
  document.documentElement.style.setProperty("--dock", on ? `${dock.offsetHeight}px` : "0px");
  if (!on) return;
  $("#addBtn").textContent = `＋ Add ${plural(m.counts.ready, "card")}${m.addValue ? ` · ${usd(m.addValue)}` : ""}`;
  $("#addNote").textContent = `${m.counts.check ? `${m.counts.check} to check stay for a computer. ` : ""}They go into the shared inventory. The website changes only from a computer.`;
  drawEst();
  document.documentElement.style.setProperty("--dock", `${dock.offsetHeight}px`);
}
/** What the paid amount comes to: a card, and against what they're worth */
function drawEst() {
  const paid = parseFloat($("#paid").value) || 0, m = lastModel, n = m?.counts.ready || 0;
  const diff = (m?.addValue || 0) - paid;
  $("#est").textContent = paid > 0 && n
    ? `${usd(paid / n)} a card${m.addValue ? `, worth ${usd(m.addValue)} (${diff >= 0 ? "+" : "−"}${usd(Math.abs(diff))})` : ""}`
    : "What you paid, split over them by value.";
}

// ---- History

function drawHistory() {
  const s = summarize(session);
  const mins = Math.max(1, Math.round((s.end - s.start) / 60000));
  const pace = s.cards.length >= 3 ? (s.cards.length / mins).toFixed(1) : "—";
  const top = s.cards.filter((c) => c.v != null).sort((a, b) => b.v - a.v).slice(0, 3);
  const cost = s.usd > 0 ? `$${s.usd < 0.1 ? s.usd.toFixed(3) : s.usd.toFixed(2)}` : "$0";
  setHTML($("#nowBox"), `<div class="box"><div class="muted">This session, started ${esc(when(s.start))}</div>
    <div class="stats">
      <div class="stat"><b>${s.cards.length}</b>${s.cards.length === 1 ? "card" : "cards"}</div><div class="stat"><b>${usd(s.value)}</b>worth</div><div class="stat"><b>${s.added}</b>in inventory</div>
      <div class="stat"><b>${s.pictures}</b>${s.pictures === 1 ? "picture" : "pictures"}</div><div class="stat"><b>${pace}</b>cards a minute</div><div class="stat"><b>${cost}</b>reader cost</div>
    </div>
    ${top.length ? `<div class="muted" style="font-size:13px">Best cards</div><div class="top3">${top.map((c) => `<div><span>${esc(c.n)}</span><b>${usd(c.v)}</b></div>`).join("")}</div>` : ""}
    <div class="actions" style="margin-top:14px"><button type="button" class="btn gold" data-share="${esc(session)}"${s.cards.length ? "" : " disabled"}>Share this session</button><button type="button" class="btn" data-new>New session</button></div></div>`);
  $("#pastHead").hidden = !history.length;
  setHTML($("#past"), history.map((h) => `<details class="past"><summary><span>${esc(when(h.start))}</span><span class="v">${usd(h.value)}</span><small>${plural(h.cards.length, "card")}, ${h.added} in inventory, ${plural(h.pictures, "picture")}</small></summary>
    <ul>${h.cards.map((c) => `<li>${esc(c.n)} ${c.g && !/^raw$/i.test(c.g) ? `<span class="grade">${esc(c.g)}</span> ` : ""}<b class="num">${usd(c.v)}</b>${c.k ? ` <span class="muted">${esc(c.k)}</span>` : ""}</li>`).join("") || "<li class=\"muted\">No cards read.</li>"}</ul>
    <div class="actions" style="padding:0 14px 12px"><button type="button" class="btn" data-share="${esc(h.id)}"${h.cards.length ? "" : " disabled"}>Share</button></div></details>`).join(""));
}
/** A session as plain text, through the phone's share sheet (text it to your dad), or to copy */
async function shareSession(id) {
  const s = id === session ? summarize(session) : history.find((h) => h.id === id);
  if (!s?.cards.length) return;
  const text = [
    `Cards scanned ${when(s.start)}`,
    `${plural(s.cards.length, "card")}, worth ${usd(s.value)}${s.added ? `, ${s.added} in inventory` : ""}`,
    "",
    ...s.cards.map((c) => `• ${c.n}${c.g && !/^raw$/i.test(c.g) ? ` (${c.g})` : ""}: ${usd(c.v)}${c.k ? ` [${c.k}]` : ""}`),
  ].join("\n");
  if (navigator.share) {
    try { await navigator.share({ title: "Cards scanned", text }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  $("#shareText").value = text;
  $("#shareSheet").showModal();
  $("#shareText").select();
}
let armed = { what: null, at: 0 };
/** Two taps for anything that clears a list: the first says what will happen */
function twoTaps(what, message, act) {
  if (armed.what === what && Date.now() - armed.at < 5000) { armed = { what: null, at: 0 }; return act(); }
  armed = { what, at: Date.now() };
  say(message, "warn");
}
function confirmNew() {
  twoTaps("new", "Tap again to start a new session. Only this phone's list is cleared — it moves to History.", () => {
    const carried = pics.filter(unfinished).length;
    startSession(`New session.${carried ? ` ${plural(carried, "picture")} not done yet came along.` : ""}`);
    setTab("scan");
  });
}
function forgetPast() {
  if (!history.length) return say("No past sessions on this phone.");
  twoTaps("forget", `Tap again to forget ${plural(history.length, "past session")} (this phone's History only).`, () => {
    history = [];
    ls.set("phoneHistory", history);
    draw();
    say("Past sessions forgotten.", "good");
  });
}

// ---- Settings

function drawSettings(m) {
  for (const b of $$("#modeSeg2 [data-mode]")) b.setAttribute("aria-checked", String((b.dataset.mode === "both") === prefs.both));
  for (const b of $$("#themeSeg [data-theme]")) b.setAttribute("aria-checked", String(b.dataset.theme === prefs.theme));
  $("#sound").checked = prefs.sound;
  $("#awake").checked = prefs.awake;
  $("#awake").disabled = !("wakeLock" in navigator);
  const reading = computerAge != null && computerAge < (CLOUD ? 60 : 20);
  setHTML($("#connText"), CLOUD
    ? `Through your MJC store<small>Works on any Wi-Fi or cell data. With no signal, pictures wait on this phone. ${reading ? `${esc(computerName || "Your computer")} is reading right now.` : "No computer is reading right now — pictures wait in your store until one is open."}</small>`
    : `Home Wi-Fi, straight to the computer<small>Works on the same Wi-Fi as the computer.${reading ? " It's reading right now." : " It isn't picking up right now — is Card Research Bot open?"}</small>`);
  setHTML($("#queueText"), m.waiting ? `${plural(m.waiting, "picture")} waiting on this phone<small>${sendTrouble || navigator.onLine === false ? "They go by themselves when there's a signal." : "Sending now."}</small>` : "Nothing waiting on this phone");
  $("#sendNow").disabled = !m.waiting;
  setHTML($("#aboutText"), `What ＋ Add does<small>Cards that read cleanly go into the shared inventory from here. ⚠ ones wait for a check in Bulk scan on a computer. The website changes only from a computer. Lost this phone? On the computer: Bulk scan → 📱 Phone → New link.</small>`);
}
function applyTheme() {
  const r = document.documentElement;
  if (prefs.theme === "auto") r.removeAttribute("data-theme");
  else r.dataset.theme = prefs.theme;
  $('meta[name="theme-color"]').setAttribute("content", getComputedStyle(r).getPropertyValue("--bg").trim() || "#16171c");
}

// ---- the picture sheet

function openDetail(p) {
  if (!p) return;
  $("#detailTitle").textContent = `#${p.n}${p.side === "a" ? " front" : p.side === "b" ? " back" : ""}`;
  const stage = {
    queued: navigator.onLine === false || sendTrouble ? "Waiting on this phone for a signal." : "Sending…",
    sent: CLOUD ? "Sent. Waiting for a computer to pick it up." : "On the computer, waiting to be read.",
    reading: "Being read…",
    held: `Waiting — the reader can't read right now: ${p.error || "it's down"}`,
    found: p.found ? `${plural(p.found, "card")} found — reading them up close…` : "No card found in this picture.",
    error: `Not read: ${p.error || "unknown problem"}`,
    added: `In inventory${p.skus?.length ? ` as ${p.skus.join(", ")}` : ""}.`,
    read: p.backOf ? "Read together with its front." : allLeft(p) ? "The computer kept these for a check — fix them in Bulk scan." : "Read.",
  }[p.stage] || "";
  const copyable = Boolean(navigator.clipboard?.writeText) && window.isSecureContext;
  const cards = (p.cards || []).map((c, i) => {
    const st = cardStatus(p, c);
    const why = c.have ? (c.have.cert ? `Already in inventory as ${c.have.sku} — the same slab (same PSA cert). It won't be added again.` : `You already have this card in this grade: ${c.have.sku}.`) : c.check ? `⚠ ${c.check}` : c.problem ? `${PROBLEM[c.problem] || c.problem} — retake it` : "";
    return `<div class="cardLine"><span class="nm">${esc(c.name)}</span><span class="val">${usd(c.value)}</span><span class="meta">${gradeChip(c.grade)}<span class="st ${st}">${STATUS_LABEL[st]}</span>${c.position ? `<span>${esc(c.position)}</span>` : ""}${copyable ? `<button type="button" class="copy" data-copy="${i}">Copy name</button>` : ""}</span>${why ? `<span class="why">${esc(why)}</span>` : ""}</div>`;
  });
  const retakes = (p.problems || []).map((x) => `<li>${esc(x.position || "The card")}: ${esc(PROBLEM[x.problem] || x.problem)}</li>`);
  const n = (p.cards || []).filter(trusted).length;
  const acts = [
    canAdd(p) ? `<button type="button" class="btn gold" data-act="add">＋ Add ${plural(n, "card")}</button>` : "",
    needsRetake(p) || p.problems?.length ? `<button type="button" class="btn" data-act="retake">Retake this picture</button>` : "",
    lastUndoable() === p ? `<button type="button" class="btn danger" data-act="undo">Take it back</button>` : "",
    `<button type="button" class="btn" data-act="close">Close</button>`,
  ].join("");
  setHTML($("#detailBody"), `<img class="pic" alt="" src="${p.thumb}">
    <p class="muted" style="margin:10px 0 2px">${esc(when(p.at))}${p.retakeOf ? `, retake of #${p.retakeOf}` : ""}${p.replacedBy ? `, replaced by #${p.replacedBy}` : ""}</p>
    ${stage ? `<p style="margin:4px 0 8px">${esc(stage)}</p>` : ""}${p.warn ? `<p class="why" style="color:var(--amber-text)">📷 ${esc(p.warn)}</p>` : ""}
    ${retakes.length ? `<p style="margin:8px 0 2px;color:var(--amber-text)">Retake it:</p><ul style="margin:0 0 8px">${retakes.join("")}</ul>` : ""}
    ${cards.join("")}
    ${p.addLeft ? `<p style="color:var(--amber-text)">${plural(p.addLeft, "card")} left for a check on a computer (⚠, already in stock, or the back of a card).</p>` : ""}
    ${cards.length && !p.replacedBy ? `<p class="muted" style="font-size:13px">Fix anything wrong in Bulk scan on the computer: each fix teaches the reader.</p>` : ""}
    <div class="actions acts">${acts}</div>`);
  $("#detail").dataset.name = p.name;
  if (!$("#detail").open) $("#detail").showModal();
}
/** Take a picture again: the new one stands in for this one on the phone */
function retake(p) {
  retakeOf = p.name;
  if (prefs.tab !== "scan") setTab("scan");
  draw();
  $("#cam").click();
  say(`Retake of #${p.n}: take the new picture.`);
}

// ---- first open: how it works (once)

function openWelcome(force) {
  if (!force && ls.get("phoneWelcome", false)) return;
  const homeApp = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const steps = [];
  if (!homeApp) steps.push(`<li><b>Put it on your Home Screen.</b> ${apple ? "Tap Share (on newer iPhones it's under ⋯), then Add to Home Screen → Add." : "Open the browser menu ⋮, then Add to Home screen."} Next time it's one tap, no QR code.</li>`);
  steps.push(`<li><b>Shoot.</b> Cards on something dark, the phone straight above, then the gold button. Front + back reads the number and set off the back.</li>`);
  steps.push(`<li><b>Watch them come back.</b> ${CLOUD ? "Your computer reads each picture, from any Wi-Fi or cell data. With no signal they wait here." : "The computer reads each picture over the home Wi-Fi."} Name and value show up in seconds.</li>`);
  steps.push(`<li><b>Add.</b> On the Cards tab, ＋ Add puts the cleanly read cards into the shared inventory. ⚠ ones wait for a check on a computer.</li>`);
  $("#welcomeBody").innerHTML = `<h2 id="welcomeTitle">Card Scanner</h2><ol class="steps">${steps.join("")}</ol><div class="actions"><button type="button" class="btn gold" id="welcomeGo">Start scanning</button></div>`;
  $("#welcomeGo").onclick = () => $("#welcome").close();
  $("#welcome").showModal();
}

// ---- keep the screen on while scanning (a binder takes a while; the phone shouldn't lock between pages)

let wake = null;
async function keepAwake() {
  const want = prefs.awake && !document.hidden && (prefs.tab === "scan" || Date.now() - lastShotAt < 10 * 60000);
  try {
    if (want && !wake && navigator.wakeLock) {
      wake = await navigator.wakeLock.request("screen");
      wake.addEventListener("release", () => { wake = null; });
    } else if (!want && wake) {
      const w = wake;
      wake = null;
      await w.release();
    }
  } catch {
    wake = null;
  }
}

// ---------------------------------------------------------------- tabs and wiring

function setTab(t) {
  if (!TABS.includes(t)) t = "scan";
  const changed = t !== prefs.tab;
  setPref("tab", t);
  for (const x of TABS) $(`#tab-${x}`).hidden = x !== t;
  if (changed) window.scrollTo(0, 0);
  draw();
  keepAwake();
}

$$(".tabbar [data-tab]").forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
$(".tabbar [role=tablist]").addEventListener("keydown", (e) => {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
  const t = TABS[(TABS.indexOf(prefs.tab) + (e.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
  setTab(t);
  $(`#t-${t}`).focus();
  e.preventDefault();
});
$("#shoot").onclick = () => { if (!busy) $("#cam").click(); };
$("#pickBtn").onclick = () => $("#pick").click();
$("#cam").onchange = (e) => takeAll(e.target);
$("#pick").onchange = (e) => { setTab("scan"); takeAll(e.target); };
$("#undoBtn").onclick = undoLast;
$("#noBackBtn").onclick = noBack;
for (const seg of [$("#modeSeg"), $("#modeSeg2")]) {
  seg.onclick = (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || (b.dataset.mode === "both") === prefs.both) return;
    setPref("both", b.dataset.mode === "both");
    waitingBack = null;
    save();
    draw();
    say(prefs.both ? "Front + back: the front, then flip it over and take the back." : "One side: one picture for each card or page.");
  };
}
$("#sound").onchange = (e) => { setPref("sound", e.target.checked); if (e.target.checked) beep(880); };
$("#awake").onchange = (e) => { setPref("awake", e.target.checked); keepAwake(); };
$("#themeSeg").onclick = (e) => { const b = e.target.closest("[data-theme]"); if (b) { setPref("theme", b.dataset.theme); applyTheme(); draw(); } };
matchMedia("(prefers-color-scheme: light)").addEventListener?.("change", applyTheme);
$("#viewSeg").onclick = (e) => { const b = e.target.closest("[data-view]"); if (b) { setPref("view", b.dataset.view); draw(); } };
$("#chips").onclick = (e) => { const b = e.target.closest("[data-f]"); if (b) { setPref("filter", b.dataset.f); draw(); } };
$("#sortBtn").onclick = () => { setPref("sort", prefs.sort === "value" ? "new" : "value"); draw(); };
$("#q").oninput = () => draw();
$("#pill").onclick = () => setTab("settings");
$("#sendNow").onclick = () => { backoff = 0; sendTrouble = false; pump(); poll(); say("Sending what's waiting…"); };
$("#newBtn").onclick = confirmNew;
$("#forgetBtn").onclick = forgetPast;
$("#welcomeBtn").onclick = () => openWelcome(true);
$("#addBtn").onclick = () => addPictures(pics.filter(canAdd));
$("#paid").oninput = drawEst;
$("#toast").onclick = () => say("");
$("#shareClose").onclick = () => $("#shareSheet").close();
$("#welcome").addEventListener("close", () => ls.set("phoneWelcome", true));
// a picture, wherever it's shown (the card just read, a card row, a picture tile) opens its sheet
for (const el of [$("#just"), $("#strip"), $("#cardList"), $("#picGrid")]) el.onclick = (e) => { const b = e.target.closest("[data-name]"); if (b) openDetail(byName(b.dataset.name)); };
$("#mini").onclick = (e) => { if (e.target.closest("[data-go]")) setTab("cards"); };
$("#tab-history").onclick = (e) => {
  const s = e.target.closest("[data-share]");
  if (s) return shareSession(s.dataset.share);
  if (e.target.closest("[data-new]")) confirmNew();
};
$("#detailBody").onclick = async (e) => {
  const p = byName($("#detail").dataset.name);
  const copy = e.target.closest("[data-copy]");
  if (copy && p) {
    try { await navigator.clipboard.writeText(p.cards[+copy.dataset.copy].name); say("Name copied.", "good"); } catch { say("Couldn't copy on this phone.", "warn"); }
    return;
  }
  const act = e.target.closest("[data-act]")?.dataset.act;
  if (!act) return;
  $("#detail").close();
  if (!p) return;
  if (act === "add") addPictures([p]);
  else if (act === "retake") retake(p);
  else if (act === "undo") undoLast();
};
// tapping outside a sheet closes it
for (const d of $$("dialog.sheet")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });
// the sheet stays in step while it's open (the picture gets read meanwhile)
const refreshSheet = () => { if ($("#detail").open) openDetail(byName($("#detail").dataset.name)); };

// ---------------------------------------------------------------- start

applyTheme();
// Opening the page after hours away starts a new session (the last one's pictures are on the computer already).
{
  const last = Math.max(0, ...pics.map((p) => p.at || 0));
  if (pics.length && Date.now() - last > SESSION_GAP) startSession(`New session — the last pictures were taken ${when(last)}. They're in History; nothing was removed.`);
}
setTab(prefs.tab);
openWelcome(false);
pump();
poll();
setInterval(() => { refreshSheet(); drawPill(); }, 2500);
