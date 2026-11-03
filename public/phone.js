// Phone camera for Bulk scan. Every picture goes to the computer's scan inbox at full resolution, through a queue
// that survives a Wi-Fi drop, and what the computer found comes back here per picture: how many cards, which need a
// retake (glare, blur, cut off) and each card's name and value — while the cards are still on the table.
// Names tell the computer how pictures go together: phone-<session>-<n>-a (front), -b (back), -s (one picture).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (v) => (v == null ? "—" : `$${Number(v).toLocaleString(undefined, { minimumFractionDigits: v < 100 ? 2 : 0, maximumFractionDigits: v < 100 ? 2 : 0 })}`);
const ls = {
  get: (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode: this session only */ } },
};
const PROBLEM = { glare: "glare", blurry: "blurry", cut_off: "cut off by the edge", too_small: "too small", covered: "covered" };

// The session (and what was sent in it) survives a reload, so a page refresh mid-binder doesn't lose the thread.
let session = ls.get("phoneSession", null) || newSession();
let pics = ls.get("phonePics", []); // [{ name, n, side, thumb, stage, found, problems, cards, error, warn, at }]
let card = ls.get("phoneCard", 0), waitingBack = ls.get("phoneWaitingBack", null);
function newSession() {
  const s = Date.now().toString(36);
  ls.set("phoneSession", s);
  return s;
}
const save = () => { ls.set("phonePics", pics.slice(-120)); ls.set("phoneCard", card); ls.set("phoneWaitingBack", waitingBack); };

const both = $("#both"), sound = $("#sound");
both.checked = ls.get("phoneBoth", false);
sound.checked = ls.get("phoneSound", false);
both.onchange = () => {
  ls.set("phoneBoth", both.checked);
  waitingBack = null;
  save();
  say(both.checked ? "Take the front of a card (or a whole page)." : "");
};
sound.onchange = () => ls.set("phoneSound", sound.checked);
$("#shoot").onclick = () => $("#cam").click();
$("#pickBtn").onclick = () => $("#pick").click();
$("#cam").onchange = (e) => takeAll(e.target);
$("#pick").onchange = (e) => takeAll(e.target);
$("#undoBtn").onclick = undoLast;
$("#newBtn").onclick = () => {
  if (queueCount() && !confirmSoft()) return;
  session = newSession();
  pics = [];
  card = 0;
  waitingBack = null;
  save();
  draw();
  say("New session — take a picture.");
};
$("#detailClose").onclick = () => $("#detail").close();
// a dialog-free "are you sure": the Start over button asks twice
let armed = 0;
function confirmSoft() {
  if (Date.now() - armed < 4000) return true;
  armed = Date.now();
  say(`${queueCount()} picture(s) haven't reached the computer yet — tap Start over again to drop them.`, "warn");
  return false;
}

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

/**
 * Full camera resolution (an iPhone's 4032 px), capped at 4096 px — the most an iPhone's canvas can hold, and on a
 * 9-card page about 1.7× the detail per card of the old 2400 px. The card numbers and serials live in that detail.
 */
function encode(img, maxSide, quality) {
  const w = img.width, h = img.height, k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement("canvas");
  c.width = Math.round(w * k);
  c.height = Math.round(h * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return { canvas: c, url: c.toDataURL("image/jpeg", quality) };
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
    const { canvas } = encode(img, 480, 0.6);
    const d = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height);
    return photoCheck(d.data, canvas.width, canvas.height);
  } catch {
    return "";
  }
}

async function take(file) {
  let side = "s", n;
  if (both.checked) {
    if (waitingBack == null) { n = waitingBack = ++card; side = "a"; }
    else { n = waitingBack; waitingBack = null; side = "b"; }
  } else n = ++card;
  save();
  say("Getting it ready…");
  let img;
  try {
    img = await decode(file);
  } catch {
    if (side === "a") { waitingBack = null; card--; } else if (side === "b") waitingBack = n; else card--;
    save();
    return say("That picture couldn't be opened — try again.", "bad");
  }
  const warn = quickCheck(img);
  const full = encode(img, 4096, 0.9).url;
  const thumb = encode(img, 240, 0.7).url;
  img.close?.();
  const name = `phone-${session}-${String(n).padStart(4, "0")}-${side}`;
  pics.push({ name: name + ".jpg", n, side, thumb, stage: "queued", warn, at: Date.now() });
  save();
  await enqueue({ name, image: full });
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

let pumping = false, backoff = 0;
async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = (await queued()).sort((a, b) => (a.name < b.name ? -1 : 1))[0];
      if (!next) break;
      const pic = pics.find((p) => p.name === next.name + ".jpg");
      try {
        const r = await fetch("/api/scan/inbox", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
        const j = await r.json().catch(() => ({}));
        if (r.status === 400) { // the computer will never take this one (not a photo): drop it, say why
          await dequeue(next.name);
          if (pic) Object.assign(pic, { stage: "error", error: j.error || "The computer refused this picture." });
          continue;
        }
        if (!r.ok) throw new Error(j.error || `The computer said ${r.status}`);
        await dequeue(next.name);
        if (pic && pic.stage === "queued") pic.stage = "sent";
        backoff = 0;
      } catch (err) {
        // the Wi-Fi dropped or the computer is busy: keep it, try again a little later
        backoff = Math.min(30000, backoff ? backoff * 2 : 2000);
        say(`Not sent yet (${err.message}) — trying again in ${Math.round(backoff / 1000)} s. Same Wi-Fi as the computer?`, "bad");
        setTimeout(pump, backoff);
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
window.addEventListener("online", pump);

async function undoLast() {
  const p = [...pics].reverse().find((x) => ["queued", "sent"].includes(x.stage));
  if (!p) return;
  const base = p.name.replace(/\.jpg$/, "");
  if (p.stage === "queued") await dequeue(base);
  else {
    const r = await fetch("/api/scan/inbox/" + encodeURIComponent(p.name), { method: "DELETE" });
    if (!r.ok) return say((await r.json().catch(() => ({}))).error || "Too late — the computer is already reading it.", "warn");
  }
  pics = pics.filter((x) => x !== p);
  // numbering steps back so the next picture takes its place (a front waiting for its back is forgotten too)
  if (p.side === "b") waitingBack = p.n;
  else { if (p.n === card) card--; if (p.side === "a") waitingBack = null; }
  save();
  draw();
  say(`Picture ${p.n}${p.side === "b" ? " (back)" : ""} taken back.`);
}

// ---------------------------------------------------------------- what the computer found

let computerAge = null;
async function poll() {
  try {
    const r = await fetch("/api/scan/phone-status?session=" + encodeURIComponent(session));
    if (r.ok) {
      const j = await r.json();
      computerAge = j.computer;
      let readNow = 0;
      for (const p of pics) {
        const s = j.pictures?.[p.name];
        if (!s || p.stage === "queued") continue;
        if (s.stage === "read" && p.stage !== "read") readNow++;
        Object.assign(p, { stage: s.stage, usd: (s.findUsd || 0) + (s.readUsd || 0), found: s.found ?? p.found, problems: s.problems || p.problems || [], cards: s.cards || p.cards, error: s.error || null, backOf: s.backOf || null });
      }
      if (readNow && sound.checked) beep();
      save();
      draw();
    }
  } catch {
    /* the next poll tries again */
  }
  setTimeout(poll, pics.some((p) => !["read", "error"].includes(p.stage)) ? 2000 : 6000);
}

let audio = null;
function beep() {
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    const o = audio.createOscillator(), g = audio.createGain();
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.15, audio.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.18);
    o.connect(g).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + 0.2);
  } catch { /* no sound on this phone */ }
}

const words = (s) => new Set(String(s || "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2));
/** Same cards as an earlier picture of this session (the page was shot twice)? → that picture's number */
function sameAs(p) {
  const mine = (p.cards || []).map((c) => c.name);
  if (mine.length < 3) return null;
  for (const q of pics) {
    if (q === p || q.side !== p.side || q.n >= p.n || !(q.cards || []).length) continue;
    const theirs = new Set(q.cards.map((c) => c.name));
    if (mine.filter((n) => theirs.has(n)).length / mine.length >= 0.7) return q.n;
  }
  return null;
}

function caption(p) {
  const back = p.side === "b" ? " back" : p.side === "a" ? " front" : "";
  if (p.stage === "queued") return [`${p.n}${back} · waiting to send`, "warn"];
  if (p.stage === "sent") return [`${p.n}${back} · at the computer`, ""];
  if (p.stage === "reading") return [`${p.n}${back} · reading…`, ""];
  if (p.stage === "error") return [`${p.n}${back} · ✗ ${p.error || "not read"}`, "bad"];
  if (p.stage === "found") return [`${p.n}${back} · ${p.found} found${p.problems?.length ? ` · ${p.problems.length} retake` : ""}`, p.found ? (p.problems?.length ? "warn" : "") : "bad"];
  if (p.stage === "read" && p.backOf) return [`${p.n} back · read with the front`, "good"];
  if (p.stage === "read") {
    const check = (p.cards || []).filter((c) => c.check || c.problem).length;
    return [`${p.n}${back} · ✓ ${(p.cards || []).length}${check ? ` · ${check} check` : ""}`, check ? "warn" : "good"];
  }
  return [`${p.n}${back}`, ""];
}

function draw() {
  $("#gallery").innerHTML = [...pics].reverse().map((p, i) => {
    const [text, kind] = caption(p);
    return `<button data-i="${pics.length - 1 - i}" aria-label="Picture ${esc(text)}"><img alt="" src="${p.thumb}"><span class="cap ${kind}">${esc(text)}</span></button>`;
  }).join("");
  document.querySelectorAll("#gallery button").forEach((b) => (b.onclick = () => openDetail(pics[+b.dataset.i])));
  // session totals
  const read = pics.filter((p) => p.stage === "read" && !p.backOf);
  const cards = read.flatMap((p) => p.cards || []);
  const value = cards.reduce((n, c) => n + (c.value || 0), 0);
  const check = cards.filter((c) => c.check || c.problem).length;
  const waiting = queueCount();
  $("#totals").innerHTML = pics.length
    ? [`<span><b>${cards.length}</b> card${cards.length === 1 ? "" : "s"} read</span>`, cards.some((c) => c.value != null) ? `<span>worth <b>${usd(value)}</b></span>` : cards.length ? `<span class="muted">not priced yet</span>` : "", check ? `<span class="warnText"><b>${check}</b> to check</span>` : "", waiting ? `<span class="badText"><b>${waiting}</b> waiting to send</span>` : "", spent(pics)].join("")
    : "";
  // banners: the computer isn't picking up, a back with a different count, a page shot twice
  const notes = [];
  if (pics.some((p) => p.stage === "sent" && Date.now() - p.at > 20000) && (computerAge == null || computerAge > 20)) notes.push("The computer isn't picking pictures up — is Card Research Bot open on it? They wait there until it is.");
  for (const p of pics) {
    if (p.side !== "a" || p.found == null) continue;
    const b = pics.find((q) => q.n === p.n && q.side === "b" && q.found != null);
    if (b && b.found !== p.found) notes.push(`Picture ${p.n}: the front has ${p.found} cards and the back ${b.found} — a back may be missing or two cards overlap. Retake the back with every card flipped in place.`);
  }
  for (const p of read) { const s = sameAs(p); if (s) notes.push(`Picture ${p.n} looks like picture ${s} again — the same page twice?`); }
  $("#banner").innerHTML = notes.slice(-3).map((t) => `<div class="banner">${esc(t)}</div>`).join("");
  $("#undoBtn").hidden = !pics.some((x) => ["queued", "sent"].includes(x.stage));
}

/** What the AI cost for this session — only on the paid tier; Google's free tier is $0. */
function spent(list) {
  const usd = list.reduce((n, p) => n + (p.usd || 0), 0);
  return usd > 0 ? `<span class="muted">AI ≈ ${usd < 0.1 ? usd.toFixed(3) : usd.toFixed(2)} (paid tier; $0 on the free tier)</span>` : "";
}

function openDetail(p) {
  if (!p) return;
  $("#detailTitle").textContent = `Picture ${p.n}${p.side === "a" ? " (front)" : p.side === "b" ? " (back)" : ""}`;
  const retakes = (p.problems || []).map((x) => `<li class="warnText">${esc(x.position || "The card")}: ${esc(PROBLEM[x.problem] || x.problem)} — retake it</li>`);
  const list = (p.cards || []).map((c) => `<li><b>${esc(c.name)}</b>${c.grade && c.grade !== "Raw" ? ` · ${esc(c.grade)}` : ""} · ${usd(c.value)}${c.position ? ` <span class="muted">(${esc(c.position)})</span>` : ""}${c.problem ? ` <span class="warnText">· ${esc(PROBLEM[c.problem] || c.problem)}</span>` : ""}${c.check ? `<div class="muted warnText">⚠ ${esc(c.check)}</div>` : ""}</li>`);
  const stage = { queued: "Waiting to send (it goes as soon as the Wi-Fi is back).", sent: "At the computer, waiting to be read.", reading: "Being read…", found: `${p.found} card${p.found === 1 ? "" : "s"} found — reading them up close…`, error: `Not read: ${p.error || "unknown problem"}`, read: p.backOf ? "Read together with its front." : "" }[p.stage] || "";
  $("#detailBody").innerHTML = `<img alt="" src="${p.thumb}" style="width:100%;max-height:40vh;object-fit:contain;border-radius:10px">
    ${p.warn ? `<p class="warnText">📷 ${esc(p.warn)}</p>` : ""}${stage ? `<p>${esc(stage)}</p>` : ""}
    ${retakes.length ? `<ul>${retakes.join("")}</ul>` : ""}${list.length ? `<ul>${list.join("")}</ul><p class="muted">Fix anything wrong on the computer (Inventory → Bulk scan): each fix teaches the reader.</p>` : ""}`;
  $("#detail").showModal();
}

draw();
pump();
poll();
