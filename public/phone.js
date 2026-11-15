// Phone camera for Bulk scan. Every picture goes to the computer's scan inbox at full resolution, through a queue
// that survives a Wi-Fi drop, and what the computer found comes back here per picture: how many cards, which need a
// retake (glare, blur, cut off), each card's name and value, whether it's already in stock, and its inventory number
// once it's added — while the cards are still on the table.
// Names tell the computer how pictures go together: phone-<session>-<n>-a (front), -b (back), -s (one picture).
// Two ways to the computer (3.20): through the MJC store — this page at /scan/ on the store's address, from any Wi-Fi or
// cell signal (no signal: pictures wait here and go when it's back) — or straight to it on the home Wi-Fi (/phone).
// Inventory changes only by "＋ Add": here (the computer that read the pictures adds the cards it trusts; ⚠ ones wait
// for a check on a computer) or on the computer. The website changes only from the computer.
// A phone still on the old address (/phone.html, before 3.19.1) moves to /phone?s=…, the one that can go on the Home
// Screen (the computer itself, testing on localhost, stays put).
if (location.pathname === "/phone.html" && !/^(localhost|127\.\d+\.\d+\.\d+|\[::1\])$/.test(location.hostname)) location.replace("/phone");
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (v) => (v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}`);
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

// The session (and what was sent in it) survives a reload, so a page refresh mid-binder doesn't lose the thread. A
// session ends by itself after 4 hours without a picture (11/12: last week's pictures were still showing).
const SESSION_GAP = 4 * 3600000;
let session = ls.get("phoneSession", null) || newSession();
let pics = ls.get("phonePics", []); // [{ name, n, side, thumb, stage, found, problems, cards, error, warn, skus, at }]
let card = ls.get("phoneCard", 0), waitingBack = ls.get("phoneWaitingBack", null);
function newSession() {
  const s = Date.now().toString(36);
  ls.set("phoneSession", s);
  return s;
}
const save = () => { ls.set("phonePics", pics.slice(-120)); ls.set("phoneCard", card); ls.set("phoneWaitingBack", waitingBack); };
const sessionOf = (name) => String(name).match(/^phone-(\w+)-/)?.[1] || null;
/** Not done yet: still to send (always kept: it's the only copy), or on the computer within the last day */
const unfinished = (p) => p.stage === "queued" || (["sent", "reading", "found", "held"].includes(p.stage) && Date.now() - p.at < 86400000);

/**
 * A new session: this phone's list starts empty. Pictures not done yet come along, so nothing is ever dropped.
 * Nothing on the computer changes — inventory, the website and Bulk scan's list stay as they are.
 */
function startSession(message) {
  pics = pics.filter(unfinished);
  session = newSession();
  card = 0;
  waitingBack = null;
  save();
  draw();
  say(message);
}

const both = $("#both"), sound = $("#sound");
both.checked = ls.get("phoneBoth", true); // the back has the number, year and set — on unless this phone turned it off
sound.checked = ls.get("phoneSound", false);
both.onchange = () => {
  ls.set("phoneBoth", both.checked);
  waitingBack = null;
  save();
  draw();
  say(both.checked ? "Take the front of a card (or a whole page)." : "");
};
sound.onchange = () => ls.set("phoneSound", sound.checked);
$("#shoot").onclick = () => $("#cam").click();
$("#pickBtn").onclick = () => $("#pick").click();
$("#cam").onchange = (e) => takeAll(e.target);
$("#pick").onchange = (e) => takeAll(e.target);
$("#undoBtn").onclick = undoLast;
$("#noBackBtn").onclick = noBack;
$("#newBtn").onclick = () => {
  const carried = pics.filter(unfinished).length;
  startSession(`New session. Only this phone's list was cleared — your inventory, the website and the computer's list didn't change.${carried ? ` ${carried} picture${carried === 1 ? "" : "s"} not done yet stayed.` : ""}`);
};
$("#detailClose").onclick = () => $("#detail").close();

function say(text, kind = "") {
  const el = $("#status");
  el.textContent = text;
  el.className = "status " + kind;
}

// ---------------------------------------------------------------- the picture

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
  if (both.checked) {
    if (waitingBack == null) { n = waitingBack = ++card; side = "a"; }
    else { n = waitingBack; waitingBack = null; side = "b"; }
  } else n = ++card;
  save();
  say("Getting it ready…");
  let img, blob;
  try {
    img = await decode(file);
    blob = await fullPicture(file, img);
    if (!blob) throw new Error("no picture");
  } catch {
    if (side === "a") { waitingBack = null; card--; } else if (side === "b") waitingBack = n; else card--;
    save();
    return say("That picture couldn't be opened — try again.", "bad");
  }
  const warn = quickCheck(img);
  const thumb = scaled(img, 240).toDataURL("image/jpeg", 0.7);
  img.close?.();
  const name = `phone-${session}-${String(n).padStart(4, "0")}-${side}`;
  pics.push({ name: name + ".jpg", n, side, thumb, stage: "queued", warn, at: Date.now() });
  save();
  await enqueue({ name, blob });
  draw();
  if (warn) say(`Picture ${n}: ${warn}. It's sent anyway — retake it if the computer can't read it.`, "warn");
  else say(side === "a" ? `Picture ${n}: front sent — now flip it (or the whole page) and take the back.` : `Picture ${n} sent.`, "good");
  pump();
}

// ---------------------------------------------------------------- the send queue (survives a Wi-Fi drop)

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

/**
 * One picture to the computer: the JPEG itself (3.19), or a picture queued by an older page (a data URL in JSON).
 * Through the store: a signed link, the picture straight into the store's private folder, then "sent".
 */
async function upload(item, name) {
  if (!CLOUD) {
    if (item.blob) return fetch("/api/scan/inbox?name=" + encodeURIComponent(name), { method: "POST", headers: { "content-type": "image/jpeg" }, body: item.blob });
    return fetch("/api/scan/inbox", json({ name, image: item.image }));
  }
  if (!item.blob) return new Response(JSON.stringify({ error: "An old picture from before 3.20 — take it again." }), { status: 400 });
  const up = await api("/scan/upload", json({ name: name + ".jpg", bytes: item.blob.size }));
  if (!up.ok) return up;
  const { url, headers } = await up.json();
  const put = await fetch(url, { method: "PUT", headers, body: item.blob });
  if (!put.ok) throw new Error(`the upload stopped (${put.status})`);
  return api("/scan/sent", json({ name: name + ".jpg" }));
}

let pumping = false, backoff = 0, pumpTimer = null;
async function pump() {
  if (pumping) return;
  pumping = true;
  clearTimeout(pumpTimer);
  try {
    for (;;) {
      const next = (await queued()).sort((a, b) => (a.name < b.name ? -1 : 1))[0];
      if (!next) break;
      const pic = pics.find((p) => p.name === next.name + ".jpg");
      const sendName = pic?.single ? next.name.replace(/-a$/, "-s") : next.name; // "no back": goes as a single
      try {
        const r = await upload(next, sendName);
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
      } catch (err) {
        // the Wi-Fi dropped or the computer is busy: keep it, try again soon (and the moment the page is back in view)
        backoff = Math.min(document.hidden ? 30000 : 8000, backoff ? backoff * 2 : 2000);
        const offline = err.message === "Load failed" || err.message === "Failed to fetch" || navigator.onLine === false;
        say(CLOUD
          ? `Not sent yet (${offline ? "no signal" : err.message}) — ${queueCount()} waiting here, sent by itself when the phone is back online. Keep shooting.`
          : `Not sent yet (${offline ? "can't reach the computer" : err.message}) — trying again in ${Math.round(backoff / 1000)} s. Same Wi-Fi as the computer?`, "bad");
        pumpTimer = setTimeout(pump, backoff);
        break;
      } finally {
        save();
        draw();
      }
    }
  } finally {
    pumping = false;
  }
}
window.addEventListener("online", () => { backoff = 0; pump(); });
// iOS stops the page while the camera is open (11/12: a picture sat "waiting to send" for minutes after it): the
// moment the page is back, send what's waiting and ask what the computer found.
document.addEventListener("visibilitychange", () => {
  if (document.hidden) return;
  backoff = 0;
  pump();
  poll();
});

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
  say(`Picture ${n}: no back — it's read on its own. Take the next card's front.`, "good");
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
  // numbering steps back so the next picture takes its place (a front waiting for its back is forgotten too)
  if (sessionOf(p.name) === session) {
    if (p.side === "b") waitingBack = p.n;
    else { if (p.n === card) card--; if (p.side === "a") waitingBack = null; }
  }
  save();
  draw();
  say(`Picture ${p.n}${p.side === "b" ? " (back)" : ""} taken back — the computer won't read it.`);
}

// ---------------------------------------------------------------- what the computer found

let computerAge = null, computerName = null, pollTimer = null, polling = false;
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
      computerAge = j.computer;
      computerName = j.computerName || null;
      let readNow = 0, failedNow = 0;
      for (const p of pics) {
        const s = j.pictures?.[p.name];
        if (!s || p.stage === "queued") continue;
        if (s.stage === "read" && p.stage !== "read") readNow++;
        if (["error", "held"].includes(s.stage) && s.stage !== p.stage) failedNow++;
        // the store only knows a picture once a computer has taken it: until then it's "sent" here
        if (s.stage === "sent" && p.stage !== "queued" && p.stage !== "sent") continue;
        Object.assign(p, { stage: s.stage, usd: (s.findUsd || 0) + (s.readUsd || 0), found: s.found ?? p.found, problems: s.problems || p.problems || [], cards: s.cards || p.cards, error: s.error || null, backOf: s.backOf || null, skus: s.skus || p.skus, addLeft: s.addLeft ?? p.addLeft });
        // an add the computer has dealt with (added, or left every card for a check) isn't "adding…" any more
        // (the computer's clock may be a little off the phone's: two minutes' grace; nothing after 10 minutes → ask again)
        if (p.addAsked && ((s.addDoneAt || 0) > p.addAsked - 120000 || Date.now() - p.addAsked > 10 * 60000)) p.addAsked = null;
      }
      if (sound.checked && readNow) beep(880);
      else if (sound.checked && failedNow) beep(330);
      save();
      draw();
    }
  } catch {
    /* the next poll tries again */
  } finally {
    polling = false;
    pollTimer = setTimeout(poll, pics.some((p) => !["read", "error", "added"].includes(p.stage)) ? 2000 : 6000);
  }
}

let audio = null;
function beep(freq) {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.15, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.2);
  } catch { /* no sound on this phone */ }
}

/** Same cards as an earlier picture of this session (the page was shot twice)? → that picture's number */
function sameAs(p) {
  const mine = (p.cards || []).map((c) => c.name);
  if (mine.length < 3) return null;
  for (const q of pics) {
    if (q === p || q.side !== p.side || q.n >= p.n || sessionOf(q.name) !== sessionOf(p.name) || !(q.cards || []).length) continue;
    const theirs = new Set(q.cards.map((c) => c.name));
    if (mine.filter((n) => theirs.has(n)).length / mine.length >= 0.7) return q.n;
  }
  return null;
}

/** An inventory number already holding this card: the same PSA cert (the same slab), or the same card and grade */
const haveSku = (p) => (p.cards || []).find((c) => c.have)?.have;
const firstSentence = (s) => String(s || "").split(/(?<=\.)\s/)[0];

// ---------------------------------------------------------------- ＋ Add from the phone (3.20)

/** A card the computer would add without a check: no ⚠ note, no retake, not a slab already in stock */
const trusted = (c) => Boolean(c.name) && !c.check && !c.problem && !c.have?.cert;
const canAdd = (p) => p.stage === "read" && !p.backOf && !p.addAsked && (p.cards || []).some(trusted);
/** The computer that read these pictures adds their trusted cards to the shared inventory and sends back the numbers. */
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
      ? `${n} card${n === 1 ? "" : "s"} will be added as soon as Card Research Bot is open on one of your computers.`
      : `Adding ${n} card${n === 1 ? "" : "s"} — each picture shows ✓ and its inventory number in a few seconds.${paid ? ` ${usd(paid)} split over them by value.` : ""}`, "good");
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
$("#addBtn").onclick = () => addPictures(pics.filter(canAdd));

function caption(p) {
  const who = `#${p.n}${p.side === "a" ? " front" : p.side === "b" ? " back" : ""}`;
  if (p.stage === "queued") return [`${who} · waiting to send`, "warn"];
  if (p.stage === "sent") return [`${who} · ${CLOUD ? "sent" : "on the computer"}`, ""];
  if (p.stage === "reading") return [`${who} · reading…`, ""];
  if (p.stage === "held") return [`${who} · ⏸ waiting for the reader`, "warn"];
  if (p.stage === "error") return [`${who} · ✗ not read — tap`, "bad"];
  if (p.stage === "found") return [`${who} · ${p.found} found${p.problems?.length ? ` · ${p.problems.length} retake` : ""}`, p.found ? (p.problems?.length ? "warn" : "") : "bad"];
  if (p.stage === "added") return [`#${p.n} · ✓ in inventory${p.skus?.length ? " " + p.skus.join(", ") : ""}${p.addLeft ? ` · ${p.addLeft} to check` : ""}`, p.addLeft ? "warn" : "good"];
  if (p.stage === "read" && p.backOf) return [`#${p.n} back · read with the front`, "good"];
  if (p.stage === "read" && p.addAsked) return [`#${p.n} · adding…`, ""];
  if (p.stage === "read" && p.addLeft) return [`#${p.n} · ⚠ ${p.addLeft} to check on a computer`, "warn"];
  if (p.stage === "read") {
    const n = (p.cards || []).length, check = (p.cards || []).filter((c) => c.check || c.problem).length, have = haveSku(p);
    if (have?.cert) return [`#${p.n} · already in inventory (${have.sku})`, "warn"];
    return [`#${p.n} · ✓ ${n === 1 ? "read" : `${n} cards`}${check ? ` · ${check} to check` : ""}${have ? ` · have ${have.sku}` : ""}`, check ? "warn" : "good"];
  }
  return [who, ""];
}

function draw() {
  $("#gallery").innerHTML = [...pics].reverse().map((p, i) => {
    const [text, kind] = caption(p);
    return `<button data-i="${pics.length - 1 - i}" aria-label="Picture ${esc(text)}"><img alt="" src="${p.thumb}"><span class="cap ${kind}">${esc(text)}</span></button>`;
  }).join("");
  document.querySelectorAll("#gallery button").forEach((b) => (b.onclick = () => openDetail(pics[+b.dataset.i])));
  // session totals (this session's pictures; a picture carried over from an earlier one still counts until it's done)
  const read = pics.filter((p) => ["read", "added"].includes(p.stage) && !p.backOf);
  const cards = read.flatMap((p) => p.cards || []);
  const value = cards.reduce((n, c) => n + (c.value || 0), 0);
  const toAdd = read.filter((p) => p.stage === "read").flatMap((p) => p.cards || []);
  const check = toAdd.filter((c) => c.check || c.problem).length;
  const waiting = queueCount(), held = pics.filter((p) => p.stage === "held").length, added = read.filter((p) => p.stage === "added").length;
  // ＋ Add: the cards the computer would add without a check; the ⚠ ones wait for a computer
  const addable = pics.filter(canAdd), nAdd = addable.flatMap((p) => p.cards.filter(trusted)).length;
  const flagged = read.filter((p) => p.stage === "read" && !p.addAsked).flatMap((p) => (p.cards || []).filter((c) => !trusted(c))).length;
  $("#addBar").hidden = !nAdd;
  if (nAdd) {
    $("#addBtn").textContent = `＋ Add ${nAdd} card${nAdd === 1 ? "" : "s"} to inventory`;
    $("#addNote").textContent = `${flagged ? `${flagged} marked ⚠ wait for a check on a computer. ` : ""}Added cards are in the shared inventory on every computer right away. The website changes only from a computer.`;
  }
  $("#totals").innerHTML = pics.length
    ? [flagged && !nAdd ? `<div class="muted" style="flex-basis:100%">⚠ cards: check them on a computer (Inventory → Bulk scan → ✎ fix → ＋ Add to inventory).</div>` : "", `<span><b>${cards.length}</b> card${cards.length === 1 ? "" : "s"} read</span>`, cards.some((c) => c.value != null) ? `<span>worth <b>${usd(value)}</b></span>` : cards.length ? `<span class="muted">not priced yet</span>` : "", check ? `<span class="warnText"><b>${check}</b> to check</span>` : "", added ? `<span class="goodText"><b>${added}</b> in inventory</span>` : "", held ? `<span class="warnText"><b>${held}</b> waiting for the reader</span>` : "", waiting ? `<span class="badText"><b>${waiting}</b> waiting to send</span>` : "", spent(pics)].join("")
    : "";
  // banners: the reader is down, the computer isn't picking up, a back with a different count, a page shot twice
  const notes = [];
  const heldPic = [...pics].reverse().find((p) => p.stage === "held");
  if (heldPic) {
    const why = firstSentence(heldPic.error) || "the reader is down";
    notes.push(`⏸ The computer can't read pictures right now: ${why}${/[.!?]$/.test(why) ? "" : "."} Keep going — every picture waits on the computer and is read as soon as that's fixed.`);
  }
  if (linkGone) notes.push("This scanner link was replaced on the computer — scan the new code there (Inventory → Bulk scan → 📱 Phone) and add it to your Home Screen again. Pictures taken here wait on this phone.");
  else if (pics.some((p) => p.stage === "sent" && Date.now() - p.at > 20000) && (computerAge == null || computerAge > 20)) {
    notes.push(CLOUD
      ? "No computer is picking pictures up right now. They're safe in your MJC store and get read as soon as Card Research Bot is open on one of your computers."
      : "The computer isn't picking pictures up — is Card Research Bot open on it? They wait there until it is.");
  }
  for (const p of pics) {
    if (p.side !== "a" || p.found == null) continue;
    const b = pics.find((q) => q.n === p.n && q.side === "b" && q.found != null && sessionOf(q.name) === sessionOf(p.name));
    if (b && b.found !== p.found) notes.push(`Picture ${p.n}: the front has ${p.found} cards and the back ${b.found} — a back may be missing or two cards overlap. Retake the back with every card flipped in place.`);
  }
  for (const p of read) { const s = sameAs(p); if (s) notes.push(`Picture ${p.n} looks like picture ${s} again — the same page twice?`); }
  $("#banner").innerHTML = notes.slice(0, 3).map((t) => `<div class="banner">${esc(t)}</div>`).join("");
  const u = lastUndoable();
  $("#undoBtn").hidden = !u;
  if (u) $("#undoBtn").textContent = `↩ Undo picture ${u.n}${u.side === "b" ? " (back)" : ""}`;
  $("#noBackBtn").hidden = !(both.checked && waitingBack != null);
  const started = parseInt(session, 36);
  const mine = pics.filter((p) => sessionOf(p.name) === session).length;
  $("#sessionLine").textContent = `This session: started ${when(started)} · ${mine} picture${mine === 1 ? "" : "s"}${pics.length > mine ? ` (+${pics.length - mine} from earlier, not done yet)` : ""}${CLOUD && computerName && computerAge != null && computerAge < 60 ? ` · read on ${computerName}` : ""}`;
}

/** What the AI cost for this session — only on the paid tier; Google's free tier is $0. */
function spent(list) {
  const usd = list.reduce((n, p) => n + (p.usd || 0), 0);
  return usd > 0 ? `<span class="muted">AI ≈ ${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)} (paid tier; $0 on the free tier)</span>` : "";
}

function openDetail(p) {
  if (!p) return;
  $("#detailTitle").textContent = `Picture ${p.n}${p.side === "a" ? " (front)" : p.side === "b" ? " (back)" : ""} · ${when(p.at)}`;
  const retakes = (p.problems || []).map((x) => `<li class="warnText">${esc(x.position || "The card")}: ${esc(PROBLEM[x.problem] || x.problem)} — retake it</li>`);
  const list = (p.cards || []).map((c) => `<li><b>${esc(c.name)}</b>${c.grade && c.grade !== "Raw" ? ` · ${esc(c.grade)}` : ""} · ${usd(c.value)}${c.position ? ` <span class="muted">(${esc(c.position)})</span>` : ""}${c.problem ? ` <span class="warnText">· ${esc(PROBLEM[c.problem] || c.problem)}</span>` : ""}${c.have ? `<div class="${c.have.cert ? "badText" : "muted"}">${c.have.cert ? `Already in inventory as ${esc(c.have.sku)} — the same slab (same PSA cert). It won't be added again.` : `You already have this card in this grade: ${esc(c.have.sku)}.`}</div>` : ""}${c.check ? `<div class="muted warnText">⚠ ${esc(c.check)}</div>` : ""}</li>`);
  const stage = {
    queued: "Waiting to send (it goes as soon as the computer can be reached).",
    sent: "On the computer, waiting to be read.",
    reading: "Being read…",
    held: `Waiting on the computer — it can't read right now: ${p.error || "the reader is down"}`,
    found: `${p.found} card${p.found === 1 ? "" : "s"} found — reading them up close…`,
    error: `Not read: ${p.error || "unknown problem"}`,
    added: `In inventory${p.skus?.length ? ` as ${p.skus.join(", ")}` : ""}.`,
    read: p.backOf ? "Read together with its front." : "Read — add it with ＋ Add here, or from Bulk scan on the computer that read it.",
  }[p.stage] || "";
  $("#detailBody").innerHTML = `<img alt="" src="${p.thumb}" style="width:100%;max-height:40vh;object-fit:contain;border-radius:10px">
    ${p.warn ? `<p class="warnText">📷 ${esc(p.warn)}</p>` : ""}${stage ? `<p>${esc(stage)}</p>` : ""}
    ${retakes.length ? `<ul>${retakes.join("")}</ul>` : ""}${list.length ? `<ul>${list.join("")}</ul><p class="muted">Fix anything wrong on the computer (Inventory → Bulk scan): each fix teaches the reader.</p>` : ""}
    ${p.addLeft ? `<p class="warnText">${p.addLeft} card${p.addLeft === 1 ? "" : "s"} left for a check on a computer (⚠, already in stock, or the back of a card).</p>` : ""}
    ${canAdd(p) ? `<button class="more" id="addOne" style="width:100%">＋ Add this picture's ${p.cards.filter(trusted).length} card${p.cards.filter(trusted).length === 1 ? "" : "s"} to inventory</button>` : ""}`;
  const one = $("#addOne");
  if (one) one.onclick = () => ($("#detail").close(), addPictures([p]));
  $("#detail").showModal();
}

// Opening the page after hours away starts a new session (the last one's pictures are on the computer already).
{
  const last = Math.max(0, ...pics.map((p) => p.at || 0));
  if (pics.length && Date.now() - last > SESSION_GAP) startSession(`New session — the last pictures were taken ${when(last)}. Their cards are on the computer (Inventory → Bulk scan or your inventory); nothing was removed.`);
}
// In the browser (not yet from a Home Screen icon): say once how to put the scanner there, so next time is one tap.
{
  const homeApp = navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
  const hint = $("#homeHint");
  if (!homeApp && (location.pathname === "/phone" || CLOUD) && !ls.get("phoneHomeHintDone", false)) {
    const apple = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    hint.innerHTML = `<p>📲 <b>Put the scanner on your Home Screen</b>, so next time it's one tap and no QR code: ${apple ? "tap <b>Share</b> (on newer iPhones it's under <b>⋯</b>), then <b>Add to Home Screen</b> → <b>Add</b>" : "open the browser menu <b>⋮</b>, then <b>Add to Home screen</b>"}. ${CLOUD ? "It works anywhere: any Wi-Fi or cell signal, and with none the pictures wait on the phone." : "It works whenever the phone is on the same Wi-Fi as the computer."}</p><button type="button" id="homeHintOk">Got it</button>`;
    hint.hidden = false;
    $("#homeHintOk").onclick = () => { ls.set("phoneHomeHintDone", true); hint.hidden = true; };
  }
}
draw();
pump();
poll();
