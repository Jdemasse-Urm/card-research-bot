// Card Research Bot — the app's local web server. The desktop app (electron/main.js) runs it inside its
// window; developers can also run `npm start` and open http://localhost:3737 in a browser.
import { APP_DIR, ENV_PATH, HOME } from "./lib/env.js"; // first: loads settings for everything else
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { exec, execFile } from "node:child_process";

import { hasKey, resetClient, explainError, MODEL, FALLBACK_MODEL, monthlyBudget, FREE_GROUNDED_PER_MONTH, aiQueue } from "./lib/ai.js";
import { cardLookup, hotCards, ask, askBusiness, lotLookup, locateCards, readCards, writeListing, slabCheck, adviseInventory, readReceipt, CATEGORIES, PERIODS, kindOf } from "./lib/jobs.js";
import { runSelfTest } from "./lib/selftest.js";
import * as store from "./lib/store.js";
import * as pricecharting from "./lib/sources/pricecharting.js";
import * as ygoprodeck from "./lib/sources/ygoprodeck.js";
import * as onepiece from "./lib/sources/onepiece.js";
import * as psa from "./lib/sources/psa.js";
import * as ebay from "./lib/sources/ebay.js";
import * as mjc from "./lib/mjc.js";
import * as pricingJob from "./lib/pricing-job.js";
import { DEFAULTS as PRICING_DEFAULTS } from "./lib/pricing.js";
import QRCode from "qrcode";

const here = APP_DIR;
const DESKTOP = process.env.CARD_BOT_DESKTOP === "1";
const VERSION = JSON.parse(fs.readFileSync(path.join(here, "package.json"), "utf8")).version;
const WANT_PORT = Number(process.env.PORT) || 3737;
let PORT = WANT_PORT;
const SHARE = process.env.SHARE_ON_NETWORK === "1" && Boolean(process.env.ACCESS_PIN);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "60mb" }));

// ---------------- log file (Settings → Copy diagnostics reads the tail) ----------------

const LOG_DIR = path.join(store.DATA_DIR, "logs");
fs.mkdirSync(LOG_DIR, { recursive: true });
const LOG_FILE = path.join(LOG_DIR, "app.log");
const redact = (s) => String(s).replace(/AIza[\w-]{20,}/g, "AIza…").replace(/(bearer|Basic)\s+[\w.=+/-]{12,}/gi, "$1 …");
function writeLog(level, args) {
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 1_000_000) fs.renameSync(LOG_FILE, LOG_FILE + ".1");
    const line = args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === "string" ? a : JSON.stringify(a))).join(" ");
    fs.appendFileSync(LOG_FILE, `${new Date().toISOString()} ${level} ${redact(line)}\n`);
  } catch {
    /* logging must never break the app */
  }
}
for (const level of ["error", "warn"]) {
  const orig = console[level].bind(console);
  console[level] = (...args) => {
    writeLog(level.toUpperCase(), args);
    orig(...args);
  };
}

// ---------------- security ----------------

const isLoopback = (ip) => /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/.test(ip || "");

// Browser hardening headers: no framing, no sniffing, only our own scripts.
app.use((_req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
});

// 1) Only answer to our own host names. Blocks "DNS rebinding", where a web page you visit
//    tricks the browser into talking to this local app.
app.use((req, res, next) => {
  const host = String(req.headers.host || "").replace(/:\d+$/, "");
  if (/^(localhost|127\.0\.0\.1|\[::1\]|\d{1,3}(\.\d{1,3}){3}|[\w-]+\.local)$/i.test(host)) return next();
  res.status(403).send("Forbidden host");
});

// 2) Changes (POST/PATCH/DELETE) must come from this app's own page — another website can't
//    secretly start AI jobs or edit your data.
app.use((req, res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (origin) {
    try {
      if (new URL(origin).host !== req.headers.host) return res.status(403).json({ error: "Cross-site request blocked" });
    } catch {
      return res.status(403).json({ error: "Bad origin" });
    }
  }
  next();
});

// 3) Home-network sharing: other devices must enter the PIN once (remembered in a cookie).
const PIN_COOKIE = "cardbot_pin";
const pinToken = () => crypto.createHash("sha256").update("cardbot:" + (process.env.ACCESS_PIN || "")).digest("hex").slice(0, 32);
const hasPinCookie = (req) => (req.headers.cookie || "").split(/;\s*/).includes(`${PIN_COOKIE}=${pinToken()}`);

// A second, limited PIN for someone helping at the table: Show mode only — no costs, no settings, no edits.
const helperToken = () => (/^\d{4,8}$/.test(process.env.HELPER_PIN || "") ? crypto.createHash("sha256").update("cardbot-helper:" + process.env.HELPER_PIN).digest("hex").slice(0, 32) : null);
const isHelper = (req) => Boolean(helperToken()) && (req.headers.cookie || "").split(/;\s*/).includes(`${PIN_COOKIE}=${helperToken()}`);
const HELPER_API = [/^GET \/api\/(status|version|show|inventory|customers|search)$/, /^POST \/api\/show\/sale$/, /^POST \/api\/show\/sale\/[\w-]+\/undo$/, /^GET \/api\/photos\//];

const pinFails = new Map(); // ip -> { n, until }
app.post("/api/login", (req, res) => {
  const ip = req.socket.remoteAddress;
  const f = pinFails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: "Too many wrong PINs — wait 10 minutes." });
  const helper = SHARE && helperToken() && String(req.body?.pin || "") === process.env.HELPER_PIN;
  const ok = (SHARE && String(req.body?.pin || "") === process.env.ACCESS_PIN) || helper;
  if (!ok) {
    f.n++;
    if (f.n >= 10) Object.assign(f, { n: 0, until: Date.now() + 600000 });
    pinFails.set(ip, f);
    return res.status(401).json({ error: "Wrong PIN" });
  }
  pinFails.delete(ip);
  res.setHeader("Set-Cookie", `${PIN_COOKIE}=${helper ? helperToken() : pinToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
  res.json({ ok: true, helper: Boolean(helper) });
});

// Phone as a scanner: Bulk scan shows a QR code holding a short-lived key; opening it on a phone signs that
// phone in (the same cookie the PIN gives) and opens the phone camera page. Keys last 15 minutes.
const phoneKeys = new Map(); // key -> expiry (ms)
app.get("/phone", (req, res) => {
  const k = String(req.query.k || "");
  const until = phoneKeys.get(k);
  for (const [key, t] of phoneKeys) if (t < Date.now()) phoneKeys.delete(key);
  if (!SHARE || !until || until < Date.now()) return res.status(403).send("<!doctype html><meta name=viewport content='width=device-width'><p style='font:18px system-ui;padding:24px'>This code has expired — on the computer, open Inventory → Bulk scan → 📱 Phone and scan the new code.</p>");
  res.setHeader("Set-Cookie", `${PIN_COOKIE}=${pinToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`);
  res.redirect("/phone.html");
});

const PUBLIC_WITHOUT_PIN = new Set(["/pin.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/apple-touch-icon.png"]);
app.use((req, res, next) => {
  if (isLoopback(req.socket.remoteAddress) || hasPinCookie(req) || PUBLIC_WITHOUT_PIN.has(req.path)) return next();
  if (isHelper(req)) {
    req.helper = true;
    if (!req.path.startsWith("/api/") || HELPER_API.some((re) => re.test(`${req.method} ${req.path}`))) return next();
    return res.status(403).json({ error: "The helper PIN can use Show mode only." });
  }
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "PIN required" });
  res.sendFile(path.join(here, "public", "pin.html"));
});

app.use(express.static(path.join(here, "public")));

// ---------------- helpers ----------------

// Who is using the app (picked once per browser, sent on every request) — for the activity feed.
const who = (req) => store.clean.str(req.get("x-user"), 40) || (isLoopback(req.socket.remoteAddress) ? "This computer" : "Other device");
const log = (req, text) => store.logActivity(who(req), text);

// Streams progress lines (NDJSON) while a job runs, then one {type:"done"} or {type:"error"} line.
// Closing the page / pressing Cancel aborts the job so it stops spending.
let busyJobs = 0; // AI jobs in flight (the desktop app asks before quitting)
function streamJob(req, res, work) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const ctrl = new AbortController();
  let finished = false;
  res.on("close", () => {
    if (!finished) ctrl.abort();
  });
  const send = (obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + "\n");
  };
  const ping = setInterval(() => send({ type: "ping" }), 15000);
  busyJobs++;
  work(send, ctrl.signal)
    .then((payload) => send({ type: "done", ...payload }))
    .catch((err) => {
      // Expected situations (no key yet, budget reached, cancelled) aren't errors worth logging.
      if (!ctrl.signal.aborted && !/No Gemini API key|Monthly AI budget|Cancelled/.test(err?.message || "")) console.error(err);
      send({ type: "error", message: explainError(err) });
    })
    .finally(() => {
      busyJobs--;
      finished = true;
      clearInterval(ping);
      res.end();
    });
}

function setEnv(vars) {
  let env = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
  for (const [k, v] of Object.entries(vars)) {
    env = env.replace(new RegExp(`^${k}=.*\\r?\\n?`, "m"), "");
    if (v !== null && v !== "") env = env.replace(/\s*$/, "\n") + `${k}=${v}\n`;
    if (v === null || v === "") delete process.env[k];
    else process.env[k] = String(v);
  }
  fs.writeFileSync(ENV_PATH, env.replace(/^\s+/, ""));
}

function lanUrls() {
  // Home Wi-Fi addresses first; VPN/virtual adapters (Tailscale, WSL, Docker) after.
  const rank = (a) => (a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3);
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => i.address)
    .sort((a, b) => rank(a) - rank(b))
    .map((a) => `http://${a}:${PORT}`);
}

function csv(rows, cols) {
  const cell = (v) => {
    const s = v == null ? "" : String(v);
    const safe = /^[=+\-@\t\r]/.test(s) ? "'" + s : s; // stop spreadsheet formula injection
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [cols.map((c) => c[0]).join(","), ...rows.map((r) => cols.map((c) => cell(c[1](r))).join(","))].join("\r\n");
}

function sendCsv(res, name, body) {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${name}-${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(body);
}

// Minimal CSV parser (quotes, commas, newlines in quotes) for imports.
function parseCsv(text) {
  const rows = [];
  let row = [], cell = "", q = false;
  const t = String(text).replace(/^﻿/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) {
      if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === "," || c === "\t") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

const gradeOf = (card) => (card?.grading_company && card?.grade ? `${card.grading_company} ${card.grade}` : "Raw");
const categoryFromUrl = (url) => {
  const m = String(url || "").match(/\/game\/(baseball|basketball|football|hockey|soccer)-cards|\/game\/(yugioh|one-piece|pokemon)/);
  return m ? (m[1] || (m[2] === "one-piece" ? "onepiece" : m[2])) : "other";
};
const num = (v) => (v === "" || v == null ? null : Number.isFinite(+v) ? +v : null);
const okDelete = (res, trashId) => (trashId ? res.json({ ok: true, undo: trashId }) : res.status(404).json({ error: "not found" }));

// ---------------- status / settings / version ----------------

app.get("/api/status", (req, res) => {
  res.json({
    version: VERSION,
    hasKey: hasKey(),
    model: MODEL,
    categories: CATEGORIES,
    periods: Object.keys(PERIODS),
    canEditSettings: isLoopback(req.socket.remoteAddress),
    unseenAlerts: store.alerts().filter((a) => !a.seen).length,
    psa: psa.hasToken(),
    ebay: ebay.hasKeys(),
    busy: busyJobs,
    desktop: DESKTOP,
    fees: FEE_PCT,
    payments: store.PAYMENTS,
    role: req.helper ? "helper" : "owner",
    storeName: mjc.storeSettings()?.name || null,
    currentShow: store.currentShow(),
    conditions: store.CONDITION_LABEL,
    conditionHelp: store.CONDITION_HELP,
    conditionParts: store.CONDITION_PARTS,
    sealedTypes: store.SEALED_TYPES,
  });
});

app.get("/api/settings", (req, res) => {
  res.json({
    version: VERSION,
    hasKey: hasKey(),
    model: MODEL,
    fallbackModel: FALLBACK_MODEL,
    budget: monthlyBudget(),
    spendThisMonth: store.spendThisMonth(),
    groundedThisMonth: store.groundedThisMonth(),
    freeGrounded: FREE_GROUNDED_PER_MONTH,
    aiStats: store.usageStats(),
    aiQueue: aiQueue(),
    share: process.env.SHARE_ON_NETWORK === "1",
    shareActive: SHARE,
    pinSet: Boolean(process.env.ACCESS_PIN),
    helperPinSet: Boolean(helperToken()),
    lanUrls: SHARE ? lanUrls() : [],
    psa: psa.hasToken(),
    ebay: ebay.hasKeys(),
    dailyBrief: process.env.CARD_BOT_DAILY_BRIEF === "1",
    port: PORT,
    desktop: DESKTOP,
    dataFolder: HOME,
    canEditSettings: isLoopback(req.socket.remoteAddress),
  });
});

// Open the folder holding data/ and .env in Explorer / Finder (this computer only).
app.post("/api/open-data-folder", (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Only on the computer running the bot." });
  const opener = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  execFile(opener, [HOME], () => {});
  res.json({ ok: true, folder: HOME });
});

app.post("/api/settings", (req, res) => {
  // Only the computer running the bot may change keys/sharing.
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Settings can only be changed on the computer running the bot." });
  const b = req.body || {};
  const vars = {};
  const token = (v, re, msg) => {
    const t = String(v).trim();
    if (!re.test(t)) throw new Error(msg);
    return t;
  };
  let restart = false;
  try {
    if (b.apiKey != null && String(b.apiKey).trim()) vars.GEMINI_API_KEY = token(b.apiKey, /^[\w-]{30,}$/, "That doesn't look like a Gemini API key (it usually starts with AIza).");
    if (b.psaToken != null) vars.PSA_API_TOKEN = String(b.psaToken).trim() ? token(b.psaToken, /^[\w.-]{20,}$/, "That doesn't look like a PSA API token.") : null;
    if (b.ebayId != null) vars.EBAY_CLIENT_ID = String(b.ebayId).trim() ? token(b.ebayId, /^[\w.-]{10,}$/, "That doesn't look like an eBay App ID.") : null;
    if (b.ebaySecret != null) vars.EBAY_CLIENT_SECRET = String(b.ebaySecret).trim() ? token(b.ebaySecret, /^[\w.-]{10,}$/, "That doesn't look like an eBay Cert ID.") : null;
    if (b.budget !== undefined) {
      const n = parseFloat(b.budget);
      vars.CARD_BOT_MONTHLY_BUDGET = Number.isFinite(n) && n > 0 ? String(n) : null;
    }
    if (b.dailyBrief !== undefined) vars.CARD_BOT_DAILY_BRIEF = b.dailyBrief ? "1" : null;
    if (b.share !== undefined) {
      if (b.share && !/^\d{4,8}$/.test(String(b.pin || process.env.ACCESS_PIN || ""))) throw new Error("Pick a 4–8 digit PIN for network sharing.");
      vars.SHARE_ON_NETWORK = b.share ? "1" : null;
      if (b.pin) vars.ACCESS_PIN = String(b.pin);
      restart = Boolean(b.share) !== SHARE || Boolean(b.pin);
    }
    if (b.helperPin !== undefined) {
      const hp = String(b.helperPin || "").trim();
      if (hp && !/^\d{4,8}$/.test(hp)) throw new Error("The helper PIN is 4–8 digits.");
      if (hp && hp === (b.pin || process.env.ACCESS_PIN)) throw new Error("Pick a helper PIN different from your own PIN.");
      vars.HELPER_PIN = hp || null;
    }
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  setEnv(vars);
  if (vars.GEMINI_API_KEY) resetClient();
  if ("EBAY_CLIENT_ID" in vars || "EBAY_CLIENT_SECRET" in vars) ebay.resetToken();
  res.json({ ok: true, restartNeeded: restart });
});

app.get("/api/version", (_req, res) => {
  let changelog = "";
  try {
    changelog = fs.readFileSync(path.join(here, "CHANGELOG.md"), "utf8");
  } catch {}
  res.json({ version: VERSION, changelog });
});

// Data sources health check (cached 10 minutes).
let health = null;
app.get("/api/health", async (_req, res) => {
  if (health && Date.now() - health.at < 600000) return res.json(health);
  const check = async (name, fn) => {
    const t = Date.now();
    try {
      const r = await fn();
      return { name, ok: Array.isArray(r) ? r.length > 0 : Boolean(r), ms: Date.now() - t };
    } catch (err) {
      return { name, ok: false, error: err.message, ms: Date.now() - t };
    }
  };
  const results = await Promise.all([
    check("Sports sold prices (SportsCardsPro)", () => pricecharting.search("ken griffey jr 1989 upper deck 1", 3, "sports")),
    check("TCG sold prices (PriceCharting)", () => pricecharting.search("blue-eyes white dragon LOB-001", 3, "tcg")),
    check("Yu-Gi-Oh database (YGOPRODeck)", () => ygoprodeck.lookup("Dark Magician", 1)),
    check("One Piece prices (optcgapi)", () => onepiece.lookup("OP01-001", 1)),
  ]);
  health = { at: Date.now(), results };
  res.json(health);
});

app.post("/api/selftest", (req, res) => {
  streamJob(req, res, async (send, signal) => ({ selftest: await runSelfTest({ full: req.body?.full !== false, onEvent: send, signal }) }));
});

app.get("/api/diagnostics", (_req, res) => {
  let logTail = "";
  try {
    logTail = fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-60).join("\n");
  } catch {}
  const counts = {};
  for (const f of ["lookups", "watchlist", "inventory", "submissions", "expenses", "alerts"]) counts[f] = store.load(f, []).length;
  res.type("text/plain").send(
    redact(
      [
        `Card Research Bot ${VERSION}`,
        `Node ${process.version} · ${process.platform} ${os.release()} · ${os.arch()}`,
        `Model ${MODEL} (fallback ${FALLBACK_MODEL || "off"}) · Gemini key ${hasKey() ? "set" : "missing"} · PSA ${psa.hasToken() ? "set" : "no"} · eBay ${ebay.hasKeys() ? "set" : "no"}`,
        `Port ${PORT} · sharing ${SHARE ? "on" : "off"} · ${DESKTOP ? "desktop app" : "from source"} · uptime ${Math.round(process.uptime() / 60)} min`,
        `Data folder ${HOME}`,
        `Data: ${JSON.stringify(counts)}`,
        "",
        "Recent log:",
        logTail || "(empty)",
      ].join("\n"),
    ),
  );
});

// ---------------- card lookup / lot / listing ----------------

const cleanImages = (list, max) =>
  (list || []).filter((i) => i && typeof i.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(i.mediaType)).slice(0, max);

app.post("/api/lookup", (req, res) => {
  const images = cleanImages(req.body?.images, 4);
  const text = String(req.body?.text || "").slice(0, 2000);
  const thumb = typeof req.body?.thumb === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(req.body.thumb) && req.body.thumb.length < 80000 ? req.body.thumb : null;
  if (!images.length && !text.trim()) return res.status(400).json({ error: "Drop a card photo or type a card name." });

  streamJob(req, res, async (send, signal) => {
    const result = await cardLookup({ images, text, fresh: Boolean(req.body?.fresh) }, { onEvent: send, signal });
    const report = { id: store.newId(), at: new Date().toISOString(), by: who(req), input: { text, photos: images.length }, thumb, ...result };
    store.addLookup(report);
    log(req, `researched ${report.card?.name} (${report.pricing?.estimated_value_usd != null ? "$" + report.pricing.estimated_value_usd : "no price"})`);
    return { report };
  });
});

// Lot / binder page evaluator (Card Lookup tab): one call, every card in the photo priced.
app.post("/api/lot", (req, res) => {
  const images = cleanImages(req.body?.images, 6);
  if (!images.length) return res.status(400).json({ error: "Drop a photo of the lot or binder page." });
  streamJob(req, res, async (send, signal) => {
    const lot = await lotLookup({ images, text: String(req.body?.text || "").slice(0, 1000) }, { onEvent: send, signal });
    for (const c of lot.cards) c.wanted = wantMatches(c.url, c.grade, c.name);
    log(req, `valued a lot of ${lot.cards.length} cards ($${lot.total})`);
    return { lot };
  });
});

// Bulk scan, step 1: where the cards are in each picture (fronts and backs), so each can be cut out.
app.post("/api/scan/locate", (req, res) => {
  const images = cleanImages(req.body?.images, 12);
  if (!images.length) return res.status(400).json({ error: "No pictures to look at." });
  streamJob(req, res, (send, signal) => locateCards({ images }, { onEvent: send, signal }));
});
// Bulk scan, step 2: each card's own cut-out (+ its back) read up close and priced. Each scanned file's cards are
// kept ("scan-queue", a month) so opening the same folder again after a pause or a crash never pays twice.
// The browser sends whole files per call, with slots[i] = { key: the file, box, backBox } for cards[i].
app.post("/api/scan/read", (req, res) => {
  const raw = (Array.isArray(req.body?.cards) ? req.body.cards : []).slice(0, 16);
  const cards = raw.map((c) => ({ front: cleanImages([c?.front], 1)[0], back: cleanImages([c?.back], 1)[0] || null }));
  if (!cards.length || cards.some((c) => !c.front)) return res.status(400).json({ error: "Each card needs its picture." });
  const box = (b) => (Array.isArray(b) && b.length === 4 && b.every((v) => Number.isFinite(+v)) ? b.map((v) => Math.min(1000, Math.max(0, Math.round(+v)))) : null);
  const slots = (Array.isArray(req.body?.slots) ? req.body.slots : []).slice(0, cards.length).map((x) => ({ key: String(x?.key || "").slice(0, 300), box: box(x?.box), backBox: box(x?.backBox) }));
  streamJob(req, res, async (send, signal) => {
    const read = await readCards({ cards, hints: store.scanHints() }, { onEvent: send, signal });
    read.cards.forEach((c, i) => Object.assign(c, { wanted: wantMatches(c.url, c.grade, c.name), box: slots[i]?.box ?? null, backBox: slots[i]?.backBox ?? null }));
    if (slots.length === cards.length && slots.every((x) => x.key)) {
      const q = store.load("scan-queue", {});
      const at = new Date().toISOString();
      for (const key of new Set(slots.map((x) => x.key))) q[key] = { at, cards: read.cards.filter((_, i) => slots[i].key === key) };
      store.save("scan-queue", Object.fromEntries(Object.entries(q).filter(([, v]) => Date.now() - Date.parse(v.at) < 30 * 86400000).slice(-5000)));
    }
    log(req, `scanned ${cards.length} card${cards.length === 1 ? "" : "s"} (${read.cards.filter((c) => c.value != null).length} priced)`);
    return { read };
  });
});
app.get("/api/scan", (_req, res) => res.json(store.load("scan-queue", {})));

// The reader's mistakes: the cards added from a scan, with the fields a person corrected. Shown as accuracy and
// told to the reader on the next scan ("parallel was read as base but it was Silver").
app.post("/api/scan/feedback", (req, res) => res.json({ cards: store.addScanFeedback(req.body?.cards) }));
app.get("/api/scan/accuracy", (_req, res) => res.json({ ...store.scanAccuracy(), hints: store.scanHints() }));

// Phone → computer: photos taken on the phone land in an inbox the computer's Bulk scan picks up.
const INBOX = path.join(store.DATA_DIR, "scan-inbox");
const inboxName = (n) => String(n || "").replace(/[^\w.-]/g, "").slice(0, 80);
app.get("/api/scan/phone-link", async (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Only on the computer running the bot." });
  if (!SHARE) return res.json({ share: false });
  const k = crypto.randomBytes(16).toString("hex");
  phoneKeys.set(k, Date.now() + 15 * 60000);
  const url = `${lanUrls()[0]}/phone?k=${k}`;
  res.json({ share: true, url, svg: await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }), expires: Date.now() + 15 * 60000 });
});
app.post("/api/scan/inbox", (req, res) => {
  const m = String(req.body?.image || "").match(/^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/);
  const buf = m ? Buffer.from(m[1], "base64") : null;
  if (!buf || buf.length < 1000 || buf.length > 15e6 || buf[0] !== 0xff || buf[1] !== 0xd8) return res.status(400).json({ error: "Send a JPEG photo." });
  fs.mkdirSync(INBOX, { recursive: true });
  if (fs.readdirSync(INBOX).length >= 500) return res.status(429).json({ error: "500 photos are waiting — open Bulk scan on the computer to read them first." });
  const name = `${inboxName(req.body?.name) || "phone-" + Date.now()}.jpg`;
  fs.writeFileSync(path.join(INBOX, name), buf);
  res.json({ ok: true, name });
});
app.get("/api/scan/inbox", (_req, res) => {
  let files = [];
  try {
    files = fs.readdirSync(INBOX).filter((f) => f.endsWith(".jpg")).map((f) => ({ name: f, at: fs.statSync(path.join(INBOX, f)).mtimeMs }));
    const done = path.join(INBOX, "done");
    if (fs.existsSync(done)) for (const f of fs.readdirSync(done)) if (Date.now() - fs.statSync(path.join(done, f)).mtimeMs > 7 * 86400000) fs.unlinkSync(path.join(done, f));
  } catch {}
  res.json(files.sort((a, b) => a.at - b.at));
});
app.get("/api/scan/inbox/:name", (req, res) => {
  const f = path.join(INBOX, inboxName(req.params.name));
  if (!fs.existsSync(f)) return res.status(404).end();
  res.sendFile(f);
});
// picked up by the computer: kept a week in done/ in case the scan never finished
app.delete("/api/scan/inbox/:name", (req, res) => {
  try {
    fs.mkdirSync(path.join(INBOX, "done"), { recursive: true });
    fs.renameSync(path.join(INBOX, inboxName(req.params.name)), path.join(INBOX, "done", inboxName(req.params.name)));
  } catch {}
  res.json({ ok: true });
});
app.delete("/api/scan", (req, res) => {
  const keys = Array.isArray(req.body?.keys) ? new Set(req.body.keys.map(String)) : null;
  const q = store.load("scan-queue", {});
  store.save("scan-queue", keys ? Object.fromEntries(Object.entries(q).filter(([k]) => !keys.has(k))) : {});
  res.json({ ok: true });
});

app.post("/api/listing", (req, res) => {
  const report = store.getLookup(req.body?.lookupId);
  if (!report) return res.status(404).json({ error: "Report not found." });
  const platform = store.clean.oneOf(req.body?.platform, ["eBay", "TCGplayer", "Whatnot", "Facebook"], "eBay");
  streamJob(req, res, async (send, signal) => ({ listing: await writeListing({ report, platform }, { onEvent: send, signal }) }));
});

// Free, instant price check (no AI).
app.get("/api/quick", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Type a card to search." });
    const results = await pricecharting.search(q, 10);
    const top = results[0] ? await pricecharting.card(results[0].url, { withHistory: true }) : null;
    res.json({ results, top });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/quick/card", async (req, res) => {
  try {
    res.json(await pricecharting.card(String(req.query.url || ""), { withHistory: true }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// "Do we already own this?" / "Is this on the want list?" — by price page (+ grade for the want list).
app.get("/api/owned", (req, res) => {
  const url = store.clean.url(req.query.url);
  const grade = store.clean.str(req.query.grade, 30) || "Raw";
  res.json({
    owned: url ? store.inventoryView().filter((r) => r.priceUrl === url && r.status !== "sold") : [],
    wanted: wantMatches(url, grade, store.clean.str(req.query.name)),
  });
});

// ---------------- sets ----------------

app.get("/api/sets", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.json([]);
    res.json(await pricecharting.findSets(q, ["sports", "tcg"].includes(req.query.kind) ? req.query.kind : "any"));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/set", async (req, res) => {
  try {
    res.json(await pricecharting.setPage(String(req.query.url || ""), { sort: String(req.query.sort || "highest-price"), rookiesOnly: req.query.rookies === "1", includeSealed: req.query.sealed === "1" }));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------- PSA + eBay deals ----------------

app.get("/api/psa/cert/:n", async (req, res) => {
  try {
    const cert = await psa.cert(req.params.n);
    const population = cert.found ? await psa.population(cert.specId).catch(() => null) : null;
    res.json({ cert, population });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post("/api/psa/verify", async (req, res) => {
  try {
    res.json(await slabCheck(req.body?.card || {}));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const GRADED_WORDS = /\b(PSA|BGS|SGC|CGC|TAG|BECKETT|HGA|graded|slab)\b/i;

// Live eBay listings priced below recent sold value for this card + grade.
app.get("/api/deals", async (req, res) => {
  try {
    const url = store.clean.url(req.query.url);
    const grade = store.clean.str(req.query.grade, 30) || "Raw";
    if (!url) return res.status(400).json({ error: "This card has no sold-price page to compare against." });
    const data = await pricecharting.card(url);
    const value = pricecharting.valueAtGrade(data, grade);
    if (value == null) return res.status(400).json({ error: `No sold value for ${grade} on this card.` });
    const graded = !/^raw|ungraded$/i.test(grade);
    const base = String(req.query.q || `${data.set} ${data.title}`).replace(/[\[\]#]/g, " ").replace(/\s+/g, " ").trim();
    const items = await ebay.searchActive(graded ? `${base} ${grade}` : base, { limit: 100 });
    const g = grade.match(/^(\w+)\s+(\d+(\.5)?)$/);
    const listings = items
      .filter((it) => (graded ? (g ? new RegExp(`\\b${g[1]}\\s*${g[2].replace(".", "\\.")}\\b`, "i").test(it.title) : GRADED_WORDS.test(it.title)) : !GRADED_WORDS.test(it.title)))
      .filter((it) => !/\b(lot|reprint|custom|proxy|digital|you pick|pick your)\b/i.test(it.title))
      .map((it) => ({ ...it, discountPct: Math.round(((value - it.total) / value) * 1000) / 10 }))
      .sort((a, b) => b.discountPct - a.discountPct);
    res.json({ value, grade, card: `${data.title} (${data.set})`, deals: listings.filter((l) => l.discountPct >= 15).slice(0, 25), others: listings.filter((l) => l.discountPct < 15).slice(0, 15), searched: items.length });
  } catch (err) {
    res.status(/keys|token|rejected/i.test(err.message) ? 400 : 502).json({ error: err.message });
  }
});

// ---------------- history ----------------

app.get("/api/lookups", (_req, res) => res.json(store.load("lookups", []).slice(0, 300)));
app.delete("/api/lookups/:id", (req, res) => okDelete(res, store.deleteLookup(req.params.id)));

app.post("/api/undo/:id", (req, res) => {
  const ok = store.undo(req.params.id);
  if (ok) log(req, "undid a delete");
  res.status(ok ? 200 : 404).json({ ok });
});

// ---------------- hottest cards ----------------

const HOT_TTL_H = { daily: 4, weekly: 12, monthly: 24 };
const MOVER_DAYS = { daily: 1, weekly: 7, monthly: 30 };
const hotKey = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function runHotScan({ category, period, onEvent, signal }) {
  const trackedMovers = store.movers(MOVER_DAYS[period]).filter((m) => category === "all" || m.category === category);
  const result = await hotCards({ category, period, trackedMovers }, { onEvent, signal });
  const key = `${category}:${period}`;
  const all = store.load("hot", {});
  // Mark what's new or moving vs the previous scan of the same view.
  const prev = new Map((all[key]?.cards || []).map((c) => [hotKey(c.name), c.rank]));
  for (const c of result.cards || []) {
    const was = prev.get(hotKey(c.name));
    c.movement = all[key] ? (was == null ? "new" : was - c.rank) : null;
  }
  const hot = { at: new Date().toISOString(), category, period, ...result, trackedMovers };
  all[key] = hot;
  store.save("hot", all);
  return hot;
}

app.get("/api/hot", (req, res) => {
  res.json(store.load("hot", {})[`${req.query.category}:${req.query.period}`] || null);
});

app.post("/api/hot", (req, res) => {
  const category = String(req.body?.category || "all");
  const period = String(req.body?.period || "weekly");
  if (!CATEGORIES[category] || !PERIODS[period]) return res.status(400).json({ error: "bad category/period" });
  const cached = store.load("hot", {})[`${category}:${period}`];
  const fresh = cached && Date.now() - Date.parse(cached.at) < HOT_TTL_H[period] * 3600000;
  streamJob(req, res, async (send, signal) => {
    if (fresh && !req.body?.refresh) return { hot: cached, cached: true };
    const hot = await runHotScan({ category, period, onEvent: send, signal });
    log(req, `scanned hottest ${category} cards (${period})`);
    return { hot, cached: false };
  });
});

// ---------------- ask anything ----------------

// A question about the shop's own records: the AI writes the query, the code counts, the AI words the answer.
app.post("/api/ask-business", (req, res) => {
  const question = store.clean.str(req.body?.question, 500);
  if (!question) return res.status(400).json({ error: "Ask a question." });
  const records = { inventory: store.inventoryView(), expenses: store.expenses(), customers: store.customers().map((c) => customerSummary(c)), feeFor, today: new Date().toLocaleDateString("en-CA") };
  streamJob(req, res, async (send, signal) => ({ result: await askBusiness({ question, records }, { onEvent: send, signal }) }));
});

app.post("/api/ask", (req, res) => {
  const question = String(req.body?.question || "").trim().slice(0, 4000);
  if (!question) return res.status(400).json({ error: "Ask a question." });
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-4) : [];
  const lookup = req.body?.lookupId ? store.getLookup(req.body.lookupId) : null;
  const cardContext = lookup ? { card: lookup.card, pricing: lookup.pricing, market: lookup.market, grading: lookup.grading, buy_sell: lookup.buy_sell, summary: lookup.summary } : null;
  streamJob(req, res, async (send, signal) => ({ answer: await ask({ question, history, cardContext }, { onEvent: send, signal }) }));
});

// ---------------- watchlist + alerts ----------------

app.get("/api/watchlist", (_req, res) => {
  res.json({ items: store.watchlist(), movers: { daily: store.movers(1), weekly: store.movers(7), monthly: store.movers(30) } });
});

// From an AI report ({lookupId}) or straight from a price page ({url, name, grade}) — the free path.
app.post("/api/watchlist", async (req, res) => {
  const b = req.body || {};
  let entry;
  if (b.lookupId) {
    const r = store.getLookup(b.lookupId);
    if (!r) return res.status(404).json({ error: "lookup not found" });
    entry = { key: r.card?.search_query || r.card?.name, card: r.card, category: r.card?.category, pricechartingUrl: r.pricing?.pricecharting_url || null, value: r.pricing?.estimated_value_usd ?? null };
  } else {
    const url = store.clean.url(b.url);
    if (!url) return res.status(400).json({ error: "Need a card price page." });
    const grade = store.clean.str(b.grade, 30) || "Raw";
    const m = grade.match(/^(\w+)\s+(\d+(\.5)?)$/);
    let value = null;
    try {
      value = pricecharting.valueAtGrade(await pricecharting.card(url), grade);
    } catch {}
    const name = store.clean.str(b.name) || url.split("/").pop();
    entry = { key: `${url}|${grade}`, card: { name: grade === "Raw" ? name : `${name} ${grade}`, category: categoryFromUrl(url), grading_company: m ? m[1] : null, grade: m ? m[2] : null }, category: categoryFromUrl(url), pricechartingUrl: url, value };
  }
  const w = store.addToWatchlist({ ...entry, addedBy: who(req) });
  log(req, `started watching ${w.card?.name}`);
  res.json(w);
});

app.patch("/api/watchlist/:id", (req, res) => {
  const w = store.updateWatch(req.params.id, { targetAbove: store.clean.money(req.body?.targetAbove), targetBelow: store.clean.money(req.body?.targetBelow) });
  w ? res.json(w) : res.status(404).json({ error: "not found" });
});

app.delete("/api/watchlist/:id", (req, res) => okDelete(res, store.removeFromWatchlist(req.params.id)));

async function refreshWatched(w) {
  if (!w.pricechartingUrl) return null;
  const data = await pricecharting.card(w.pricechartingUrl, { withHistory: true });
  const grade = gradeOf(w.card);
  const value = pricecharting.valueAtGrade(data, grade);
  if (value == null) return null;
  const prev = [...w.snapshots].reverse().find((s) => s.value != null)?.value ?? null;
  store.addSnapshot(w.id, value, { avg12: pricecharting.yearAverage(data, grade) });
  const name = w.card?.name || w.key;
  if (w.targetAbove != null && value >= w.targetAbove && (prev == null || prev < w.targetAbove)) store.addAlert({ watchId: w.id, name, kind: "above", target: w.targetAbove, value });
  if (w.targetBelow != null && value <= w.targetBelow && (prev == null || prev > w.targetBelow)) store.addAlert({ watchId: w.id, name, kind: "below", target: w.targetBelow, value });
  return value;
}

app.post("/api/watchlist/refresh", async (_req, res) => {
  const out = [];
  for (const w of store.watchlist()) {
    try {
      out.push({ id: w.id, value: await refreshWatched(w) });
    } catch (err) {
      out.push({ id: w.id, error: err.message });
    }
  }
  res.json(out);
});

app.get("/api/alerts", (_req, res) => res.json(store.alerts()));
app.post("/api/alerts/seen", (_req, res) => {
  store.markAlertsSeen();
  res.json({ ok: true });
});

// ---------------- inventory ----------------

// The Stock list: every card, slimmed for the table (no long text, no per-photo URL maps), with a short value
// trend instead of the full history. The editor fetches the full card (GET /api/inventory/:id).
app.get("/api/inventory", (req, res) => {
  if (req.helper) return res.json(store.inventoryView().filter((r) => r.status !== "sold").map(({ id, name, grade, qty, sku, location, value, listPrice, web, webMode, webPrice, webFixedPrice, category, status, kind }) => ({ id, name, grade, qty, sku, location, value, listPrice, web, webMode, webPrice, webFixedPrice, category, status, kind })));
  const h = store.historyView();
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  res.json(store.inventoryView().map(({ photoUrls, thumbUrls, webDescription, ...r }) => {
    const v = h[r.id]?.v;
    const base = v ? [...v].reverse().find(([d]) => d <= since) : null;
    const last = v?.[v.length - 1];
    return {
      ...r,
      ...(v?.length > 2 ? { spark: v.slice(-30).map(([, x]) => x) } : {}),
      ...(base && last && base[1] > 0 && base[0] !== last[0] ? { trend30: Math.round(((last[1] - base[1]) / base[1]) * 1000) / 1000 } : {}),
      ...(h[r.id]?.p?.length ? { lastPriceReason: h[r.id].p.at(-1).reason } : {}),
      ...(webDescription ? { hasDescription: true } : {}),
    };
  }));
});

// ---- organising the inventory: bulk edit (+undo), cost splits, merges, locations, stock counts, data check, views
app.post("/api/inventory/bulk", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).slice(0, 20000) : [];
  const patch = req.body?.patch || {};
  if (!ids.length) return res.status(400).json({ error: "Select some cards first." });
  const r = store.updateMany(ids, patch, who(req));
  const what = Object.keys(patch).filter((k) => patch[k] !== undefined && patch[k] !== "").join(", ");
  log(req, `changed ${r.updated} card${r.updated === 1 ? "" : "s"} at once (${what})`);
  if ("web" in patch) {
    // one pricing pass for the whole batch, then one sync (the old per-card loop ran the engine per card)
    if (patch.web) pricingJob.run({ ids }).then(() => mjc.scheduleSync()).catch(() => {});
    else mjc.scheduleSync();
  } else mjc.scheduleSync();
  res.json(r);
});
app.post("/api/inventory/bulk/undo", (req, res) => {
  if (!store.undoBulk(String(req.body?.token || ""))) return res.status(404).json({ error: "That change can't be undone anymore." });
  log(req, "undid a bulk change");
  mjc.scheduleSync();
  res.json({ ok: true });
});
// Paid one price for a lot: spread it over the cards by what each is worth (equal shares when nothing is valued).
app.post("/api/inventory/split-cost", (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  const total = store.clean.money(req.body?.total);
  if (!ids.length || !(total >= 0)) return res.status(400).json({ error: "Select the cards and enter what you paid for all of them." });
  const rows = store.inventory().filter((r) => ids.includes(r.id));
  const worth = (r) => (r.value ?? r.webMarket ?? 0) * r.qty;
  const sum = rows.reduce((n, r) => n + worth(r), 0);
  const units = rows.reduce((n, r) => n + r.qty, 0);
  const patches = rows.map((r) => ({ id: r.id, cost: Math.round(((sum > 0 ? (total * worth(r)) / sum : (total * r.qty) / units) / r.qty) * 100) / 100 }));
  const out = store.updateEach(patches, who(req));
  log(req, `split $${total} across ${rows.length} cards by value`);
  res.json({ ...out, byValue: sum > 0 });
});
app.post("/api/inventory/merge", (req, res) => {
  const r = store.mergeRows(Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [], who(req));
  if (!r) return res.status(400).json({ error: "Pick at least two cards that are still in stock." });
  log(req, `merged ${r.merged + 1} rows of ${r.kept.name} into one (qty ${r.kept.qty})`);
  mjc.scheduleSync();
  res.json(r);
});
app.get("/api/inventory/locations", (_req, res) => res.json(store.locations()));
// Stock count: what was scanned in a box vs what the records say is in it.
app.post("/api/inventory/count", (req, res) => {
  const loc = store.clean.str(req.body?.location, 80);
  const skus = [...new Set((Array.isArray(req.body?.skus) ? req.body.skus : []).map((x) => String(x).trim().toLowerCase()).filter(Boolean))];
  const inv = store.inventoryView();
  const bySku = new Map(inv.filter((r) => r.sku).map((r) => [r.sku.toLowerCase(), r]));
  const brief = (r) => ({ id: r.id, name: r.name, grade: r.grade, sku: r.sku, location: r.location || "", status: r.status, qty: r.qty });
  const scanned = skus.map((k) => bySku.get(k)).filter(Boolean);
  const scannedIds = new Set(scanned.map((r) => r.id));
  res.json({
    found: scanned.filter((r) => (r.location || "") === loc && r.status !== "sold").map(brief),
    extra: scanned.filter((r) => (r.location || "") !== loc || r.status === "sold").map(brief),
    missing: inv.filter((r) => (r.location || "") === loc && r.status !== "sold" && !scannedIds.has(r.id)).map(brief),
    unknown: skus.filter((k) => !bySku.has(k)),
  });
});
app.post("/api/inventory/count/apply", (req, res) => {
  const loc = store.clean.str(req.body?.location, 80);
  const ids = (a) => (Array.isArray(a) ? a.map(String) : []);
  const counted = store.markCounted([...ids(req.body?.found), ...ids(req.body?.moveHere)], loc, who(req));
  let missing = 0;
  if (ids(req.body?.missing).length) missing = store.updateMany(ids(req.body.missing), { location: `Not found (count ${new Date().toISOString().slice(0, 10)})` }, who(req)).updated;
  log(req, `counted ${loc || "the unlabelled cards"}: ${counted.counted} found${counted.moved ? `, ${counted.moved} moved here` : ""}${missing ? `, ${missing} not found` : ""}`);
  res.json({ ...counted, missing });
});
app.get("/api/inventory/check", (_req, res) => res.json(store.dataCheck()));
app.post("/api/inventory/check/fix", (req, res) => {
  try {
    const r = store.fixData(String(req.body?.type || ""), who(req));
    log(req, `fixed ${r.fixed} record${r.fixed === 1 ? "" : "s"} (${req.body?.type})`);
    if (req.body?.type === "webSold") mjc.scheduleSync();
    res.json(r);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
// Saved views (filters with a name), shared by every computer using this bot.
app.get("/api/inventory/views", (_req, res) => res.json(store.load("saved-views", [])));
app.put("/api/inventory/views", (req, res) => {
  const views = (Array.isArray(req.body) ? req.body : []).slice(0, 40).map((v) => ({
    name: store.clean.str(v.name, 40) || "View",
    filter: Object.fromEntries(Object.entries(v.filter || {}).filter(([k]) => ["q", "status", "category", "sort", "location", "group"].includes(k)).map(([k, x]) => [k, store.clean.str(x, 120)])),
  }));
  store.save("saved-views", views);
  res.json(views);
});
// Duplicate check for hand-added cards: same name + grade already in stock?
app.get("/api/inventory/duplicate", (req, res) => {
  const name = stripGrade(req.query.name).toLowerCase(), grade = String(req.query.grade || "Raw").toUpperCase();
  const hit = name && store.inventoryView().find((r) => r.status !== "sold" && stripGrade(r.name).toLowerCase() === name && String(r.grade).toUpperCase() === grade);
  res.json(hit || null);
});

// One card in full, with its history (the editor). Keep every static /api/inventory/<word> GET above this.
app.get("/api/inventory/:id", (req, res) => {
  const row = store.inventoryView().find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const pop = Object.values(store.popWatch()).find((e) => e?.rowId === row.id) || null;
  res.json({ ...row, history: store.cardHistory(row.id), pop });
});

app.post("/api/inventory", (req, res) => {
  const b = req.body || {};
  const lookup = b.lookupId ? store.getLookup(b.lookupId) : null;
  const row = store.addInventory({
    ...b,
    addedBy: who(req),
    name: b.name || lookup?.card?.name,
    category: b.category || lookup?.card?.category || (b.priceUrl ? categoryFromUrl(b.priceUrl) : "other"),
    grade: b.grade || (lookup ? gradeOf(lookup.card) : "Raw"),
    priceUrl: b.priceUrl || lookup?.pricing?.pricecharting_url || null,
    value: b.value ?? lookup?.pricing?.estimated_value_usd ?? null,
  });
  log(req, `added ${row.qty}× ${row.name} to inventory (paid $${row.cost} each)`);
  tellCustomers([row]);
  if (row.web) pricingJob.run({ ids: [row.id] }).then(() => mjc.scheduleSync()).catch(() => {});
  res.json(row);
});

app.patch("/api/inventory/:id", (req, res) => {
  const before = store.inventoryView().find((r) => r.id === req.params.id);
  const row = store.updateInventory(req.params.id, req.body || {}, who(req));
  if (!row) return res.status(404).json({ error: "not found" });
  if (before && before.status !== "sold" && row.status === "sold") log(req, `sold ${row.name} for $${row.soldPrice ?? "?"}${row.soldOn ? " on " + row.soldOn : ""}`);
  else if (before && before.status !== row.status) log(req, `marked ${row.name} as ${row.status.replace("_", " ")}`);
  if (row.web && !before?.web) log(req, `put ${row.name} on the MJC website`);
  if (before?.web && !row.web) log(req, `took ${row.name} off the MJC website`);
  if (row.web && (!before?.web || before.webMode !== row.webMode || before.grade !== row.grade || before.cost !== row.cost)) {
    pricingJob.run({ ids: [row.id] }).then(() => mjc.scheduleSync()).catch(() => {});
  } else if (row.web || before?.web) mjc.scheduleSync();
  res.json(row);
});

// Sell some or all of a row (the Sold dialog). Selling part of a stack keeps the rest in stock.
app.post("/api/inventory/:id/sell", (req, res) => {
  const b = req.body || {};
  const customerId = b.customerId ? String(b.customerId) : null;
  const before = store.inventoryView().find((x) => x.id === req.params.id);
  const owe = Math.round((store.clean.money(b.soldPrice) || 0) * Math.min(before?.qty || 1, store.clean.int(b.qty ?? before?.qty ?? 1)) * 100) / 100;
  if (b.payment === "Store credit") {
    const c = store.customers().find((x) => x.id === customerId);
    if (!c) return res.status(400).json({ error: "Pick the customer whose store credit pays for it." });
    if ((c.credit || 0) < owe - 0.004) return res.status(400).json({ error: `${c.name} has only $${(c.credit || 0).toFixed(2)} in store credit.` });
  }
  const r = store.sellUnits(req.params.id, { qty: b.qty, soldPrice: b.soldPrice, soldOn: b.soldOn, soldDate: b.soldDate, fees: b.fees, payment: b.payment, customerId });
  if (!r) return res.status(404).json({ error: "That card isn't in stock anymore." });
  if (b.payment === "Store credit") store.addCredit(customerId, -(r.soldRow.soldPrice * r.soldRow.qty), `Bought ${r.soldRow.name}`, who(req));
  log(req, `sold ${r.soldRow.qty}× ${r.soldRow.name} for $${r.soldRow.soldPrice ?? "?"} each${r.soldRow.soldOn ? " on " + r.soldRow.soldOn : ""}${r.split ? ` (${r.row.qty} left)` : ""}`);
  if (r.row.web) mjc.scheduleSync();
  res.json(r);
});

// ---- show mode: a quick register for card shows (sell several cards in one go, undo the last one)
app.get("/api/show", (_req, res) => {
  const day = new Date().toISOString().slice(0, 10);
  const sales = store.showSales();
  const today = sales.filter((s) => s.at.slice(0, 10) === day);
  const byPayment = {};
  for (const s of today) byPayment[s.payment] = Math.round(((byPayment[s.payment] || 0) + s.total) * 100) / 100;
  res.json({ today, recent: sales.slice(0, 30), totals: { sales: today.length, cards: today.reduce((n, s) => n + s.items.reduce((m, i) => m + i.qty, 0), 0), total: Math.round(today.reduce((n, s) => n + s.total, 0) * 100) / 100, byPayment } });
});
app.post("/api/show/sale", (req, res) => {
  const b = req.body || {};
  const payment = store.clean.oneOf(b.payment, store.PAYMENTS, "Cash");
  const lines = (Array.isArray(b.items) ? b.items : []).slice(0, 100);
  if (!lines.length) return res.status(400).json({ error: "Add a card to the sale first." });
  const customer = b.customerId ? store.customers().find((c) => c.id === String(b.customerId)) : null;
  if (payment === "Store credit") {
    const want = lines.reduce((n, l) => n + (store.clean.money(l.price) || 0) * (store.clean.int(l.qty) || 1), 0);
    if (!customer) return res.status(400).json({ error: "Pick the customer whose store credit pays for this." });
    if ((customer.credit || 0) < want - 0.004) return res.status(400).json({ error: `${customer.name} has only $${(customer.credit || 0).toFixed(2)} in store credit (this sale is $${want.toFixed(2)}).` });
  }
  const items = [];
  let web = false;
  for (const l of lines) {
    const price = store.clean.money(l.price);
    if (price == null) return res.status(400).json({ error: "Every card needs a price." });
    const r = store.sellUnits(l.id, { qty: l.qty, soldPrice: price, soldOn: "Card show", soldDate: store.clean.date(b.date), payment, fees: 0, customerId: customer?.id || null });
    if (!r) continue; // sold elsewhere a moment ago
    web ||= Boolean(r.row.web);
    items.push({ name: r.soldRow.name, grade: r.soldRow.grade, sku: r.soldRow.sku, qty: r.soldRow.qty, price, rowId: r.row.id, soldRowId: r.soldRow.id, split: r.split, prev: r.prev });
  }
  if (!items.length) return res.status(409).json({ error: "Those cards were already sold." });
  const total = Math.round(items.reduce((n, i) => n + i.price * i.qty, 0) * 100) / 100;
  const sale = store.addShowSale({ by: who(req), payment, total, items, ...(customer ? { customerId: customer.id, customer: customer.name } : {}) });
  if (payment === "Store credit") store.addCredit(customer.id, -total, "Show sale", who(req));
  for (const x of store.useSupplies({ cards: items.reduce((n, i) => n + i.qty, 0) })) store.addAlert({ kind: "supplies", name: x.name, text: `Down to ${x.onHand}${x.unit ? " " + x.unit : ""} — time to reorder.` });
  log(req, `sold ${items.reduce((n, i) => n + i.qty, 0)} card${items.length === 1 && items[0].qty === 1 ? "" : "s"} at a show for $${total} (${payment})`);
  if (web) mjc.scheduleSync();
  res.json({ sale, skipped: lines.length - items.length });
});
app.post("/api/show/sale/:id/undo", (req, res) => {
  const sale = store.showSales().find((s) => s.id === req.params.id);
  if (!sale) return res.status(404).json({ error: "That sale isn't on record." });
  let back = 0;
  for (const i of sale.items) if (store.unsellUnits(i)) back++;
  store.removeShowSale(sale.id);
  if (sale.payment === "Store credit" && sale.customerId) store.addCredit(sale.customerId, sale.total, "Show sale undone", who(req));
  log(req, `undid a $${sale.total} show sale (${back} card${back === 1 ? "" : "s"} back in stock)`);
  mjc.scheduleSync();
  res.json({ ok: true, back });
});

// Opened one box/pack of a sealed row: its cost goes to the cards that came out (Bulk scan sends the new rows).
app.post("/api/inventory/:id/open", (req, res) => {
  const pullIds = (Array.isArray(req.body?.pullIds) ? req.body.pullIds : []).map(String).slice(0, 2000);
  const r = store.openSealed(req.params.id, pullIds, who(req));
  if (!r) return res.status(404).json({ error: "That isn't a sealed box in stock." });
  log(req, `opened ${r.box.name}: ${r.pulls} card${r.pulls === 1 ? "" : "s"} worth $${r.value} out of a $${r.cost} box`);
  res.json(r);
});

app.delete("/api/inventory/:id", (req, res) => {
  const wasWeb = store.inventory().find((r) => r.id === req.params.id)?.web;
  const trashId = store.deleteInventory(req.params.id);
  if (wasWeb) mjc.scheduleSync();
  okDelete(res, trashId);
});

// ---------------- the shop: customers (+ store credit), consignment, grading service, shows, supplies ----------------

/** Everything a customer has done with the shop, newest first. */
function customerHistory(c) {
  const inv = store.inventoryView();
  const email = (c.email || "").toLowerCase();
  const bought = inv.filter((r) => r.customerId === c.id && r.status === "sold").map((r) => ({ at: r.soldDate, what: "Bought", name: r.name, grade: r.grade, qty: r.qty, amount: Math.round((r.soldPrice || 0) * r.qty * 100) / 100, where: r.soldOn || "" }));
  const orders = email ? mjc.localOrders().filter((o) => (o.email || "").toLowerCase() === email).map((o) => ({ at: o.created.slice(0, 10), what: "Website order", name: o.items.map((i) => i.title).join(", "), amount: o.total, where: o.id })) : [];
  const tickets = email ? mjc.localTickets().filter((t) => (t.email || "").toLowerCase() === email).map((t) => ({ at: String(t.created || t.at || "").slice(0, 10), what: { offer: "Offer", sell: "Wants to sell / trade", want: "Card request" }[t.kind] || "Message", name: t.cardTitle || String(t.message || "").slice(0, 80), amount: t.amount ?? null, where: "website" })) : [];
  const credit = (c.creditLog || []).map((x) => ({ at: x.at.slice(0, 10), what: x.amount > 0 ? "Store credit added" : "Store credit used", name: x.reason, amount: x.amount, where: "" }));
  const grading = store.gradingOrders().filter((o) => o.customerId === c.id).map((o) => ({ at: o.at.slice(0, 10), what: "Grading order", name: `${o.cards.length} card${o.cards.length === 1 ? "" : "s"} · ${o.service}`, amount: o.total, where: store.gradingOrderStage(o).text }));
  // the website order's cards are also "Bought" rows: keep the order line, drop the duplicate rows
  const orderIds = new Set(orders.map((o) => o.where));
  return [...bought.filter((b) => !(b.where === "MJC site" && orderIds.size)), ...orders, ...tickets, ...credit, ...grading].sort((a, b) => (a.at < b.at ? 1 : -1));
}
function customerSummary(c, inv = store.inventoryView()) {
  const sold = inv.filter((r) => r.customerId === c.id && r.status === "sold");
  const consigned = store.consignments(c.id);
  return {
    ...c,
    creditLog: undefined,
    token: undefined,
    bought: sold.reduce((n, r) => n + r.qty, 0),
    spent: Math.round(sold.reduce((n, r) => n + (r.soldPrice || 0) * r.qty, 0) * 100) / 100,
    lastAt: sold.map((r) => r.soldDate).sort().pop() || c.added.slice(0, 10),
    consigned: { inStock: consigned.filter((x) => x.status !== "sold").length, sold: consigned.filter((x) => x.status === "sold").length, owed: Math.round(consigned.filter((x) => x.owed && !x.paidAt).reduce((n, x) => n + x.owed, 0) * 100) / 100 },
    grading: store.gradingOrders().filter((o) => o.customerId === c.id && o.status !== "returned").length,
  };
}
app.get("/api/customers", (req, res) => {
  if (req.helper) return res.json(store.customers().map((c) => ({ id: c.id, name: c.name, credit: c.credit || 0 })));
  const inv = store.inventoryView();
  res.json(store.customers().map((c) => customerSummary(c, inv)).sort((a, b) => a.name.localeCompare(b.name)));
});
app.get("/api/customers/:id", (req, res) => {
  const c = store.customers().find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "not found" });
  res.json({ ...customerSummary(c), creditCode: c.creditCode || null, statusUrl: store.consignments(c.id).length ? mjc.statusUrl(c.token) : "", creditLog: c.creditLog || [], history: customerHistory(c), consignments: store.consignments(c.id), gradingOrders: store.gradingOrders().filter((o) => o.customerId === c.id).map((o) => ({ ...o, stage: store.gradingOrderStage(o) })) });
});
app.post("/api/customers", (req, res) => {
  const b = req.body || {};
  if (!store.clean.str(b.name)) return res.status(400).json({ error: "Give the customer a name." });
  if (b.email && store.findCustomerByEmail(b.email)) return res.status(409).json({ error: "A customer with that email is already in the book." });
  const c = store.addCustomer(b);
  log(req, `added customer ${c.name}`);
  res.json(c);
});
app.patch("/api/customers/:id", (req, res) => {
  const c = store.updateCustomer(req.params.id, req.body || {});
  if (!c) return res.status(404).json({ error: "not found" });
  res.json(c);
});
app.delete("/api/customers/:id", (req, res) => {
  try {
    okDelete(res, store.deleteCustomer(req.params.id));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/customers/:id/credit", (req, res) => {
  try {
    const c = store.addCredit(req.params.id, req.body?.amount, req.body?.reason, who(req));
    mjc.scheduleSync();
    log(req, `${parseFloat(req.body?.amount) > 0 ? "gave" : "used"} $${Math.abs(parseFloat(req.body?.amount)).toFixed(2)} store credit — ${c.name} (now $${c.credit.toFixed(2)})`);
    res.json(c);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
app.post("/api/customers/:id/payout", (req, res) => {
  const c = store.customers().find((x) => x.id === req.params.id);
  if (!c) return res.status(404).json({ error: "not found" });
  const r = store.payConsignor(c.id, Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [], req.body?.method, who(req));
  if (r.paid) log(req, `paid ${c.name} $${r.total} for ${r.paid} consigned card${r.paid === 1 ? "" : "s"}`);
  mjc.scheduleSync();
  res.json(r);
});
// cards just added that customers collect → one alert naming who to tell
function tellCustomers(rows) {
  const hits = store.customerMatches(rows.filter((r) => r.status !== "sold"));
  if (!hits.length) return;
  store.addAlert({ kind: "customer", name: "New cards your customers collect", text: hits.slice(0, 6).map((h) => `${h.customer.name}: ${h.rows.slice(0, 3).map((r) => r.name).join(", ")}${h.rows.length > 3 ? ` +${h.rows.length - 3}` : ""}`).join(" · ") + ". Shop → Customers to email them." });
}

app.get("/api/shop/settings", (_req, res) => res.json(store.shopSettings()));
app.put("/api/shop/settings", (req, res) => res.json(store.saveShopSettings(req.body || {})));

app.get("/api/consignments", (_req, res) => {
  const people = new Map(store.customers().map((c) => [c.id, c]));
  res.json(store.consignments().map((x) => ({ ...x, consignor: people.get(x.consignorId)?.name || "?" })));
});

app.get("/api/grading-orders", (_req, res) => {
  const people = new Map(store.customers().map((c) => [c.id, c]));
  const subs = store.submissions();
  res.json(store.gradingOrders().map((o) => ({ ...o, statusUrl: mjc.statusUrl(o.token), customer: people.get(o.customerId)?.name || "?", stage: store.gradingOrderStage(o, subs), submission: subs.find((s) => s.id === o.submissionId) ? { id: o.submissionId, company: subs.find((s) => s.id === o.submissionId).company, number: subs.find((s) => s.id === o.submissionId).number } : null })));
});
app.post("/api/grading-orders", (req, res) => {
  const b = req.body || {};
  if (!store.customers().some((c) => c.id === b.customerId)) return res.status(400).json({ error: "Pick the customer." });
  const o = store.addGradingOrder({ ...b, by: who(req) });
  if (!o.cards.length) return res.status(400).json({ error: "Add at least one card." });
  log(req, `took in ${o.cards.length} card${o.cards.length === 1 ? "" : "s"} to grade for a customer ($${o.total})`);
  mjc.scheduleSync(); // their status page goes up
  res.json({ ...o, statusUrl: mjc.statusUrl(o.token) });
});
app.patch("/api/grading-orders/:id", (req, res) => {
  const o = store.updateGradingOrder(req.params.id, req.body || {});
  if (!o) return res.status(404).json({ error: "not found" });
  mjc.scheduleSync();
  res.json({ ...o, stage: store.gradingOrderStage(o) });
});
app.delete("/api/grading-orders/:id", (req, res) => okDelete(res, store.deleteGradingOrder(req.params.id)));

app.get("/api/shows", (_req, res) => res.json(store.shows().map((sh) => ({ ...sh, report: store.showReport(sh.id) }))));
app.post("/api/shows", (req, res) => {
  const sh = store.addShow(req.body || {});
  log(req, `added a card show: ${sh.name} on ${sh.date}`);
  mjc.syncShows().catch(() => {});
  res.json(sh);
});
app.patch("/api/shows/:id", (req, res) => {
  const sh = store.updateShow(req.params.id, req.body || {});
  if (!sh) return res.status(404).json({ error: "not found" });
  if (["name", "date", "endDate", "venue", "city", "hours", "table", "public"].some((k) => k in (req.body || {}))) mjc.syncShows().catch(() => {});
  res.json({ ...sh, report: store.showReport(sh.id) });
});
app.delete("/api/shows/:id", (req, res) => {
  okDelete(res, store.deleteShow(req.params.id));
  mjc.syncShows().catch(() => {});
});
// What to bring: cards in stock worth at least minValue (optional category / tag), by location so they're quick to pull.
app.get("/api/shows/:id/bring", (req, res) => {
  const min = parseFloat(req.query.minValue) || 0;
  const cat = String(req.query.category || ""), tag = String(req.query.tag || "").toLowerCase();
  const rows = store.inventoryView().filter((r) => ["in_stock", "listed"].includes(r.status) && (req.query.sealed === "1" || r.kind !== "sealed") && (r.value ?? r.listPrice ?? 0) >= min && (!cat || r.category === cat) && (!tag || (r.tags || []).some((t) => t.toLowerCase() === tag)));
  res.json(rows.map(({ id, name, grade, qty, sku, location, value, listPrice, web, category }) => ({ id, name, grade, qty, sku, location, value, listPrice, web, category })).sort((a, b) => String(a.location || "~").localeCompare(String(b.location || "~"), undefined, { numeric: true }) || (b.value || 0) - (a.value || 0)));
});

app.get("/api/supplies", (_req, res) => res.json(store.supplies()));
app.put("/api/supplies", (req, res) => res.json(store.saveSupply(req.body || {})));
app.delete("/api/supplies/:id", (req, res) => res.json(store.deleteSupply(req.params.id)));
app.post("/api/supplies/:id/restock", (req, res) => {
  const x = store.supplies().find((s) => s.id === req.params.id);
  if (!x) return res.status(404).json({ error: "not found" });
  const qty = parseFloat(req.body?.qty) || 0;
  if (qty <= 0) return res.status(400).json({ error: "How many came in?" });
  const paid = store.clean.money(req.body?.paid);
  const list = store.saveSupply({ ...x, onHand: (x.onHand ?? 0) + qty, cost: paid ? Math.round((paid / qty) * 100) / 100 : x.cost });
  if (paid) store.addExpense({ kind: "Supplies", amount: paid, note: `${qty} ${x.name}`, addedBy: who(req) });
  log(req, `restocked ${qty} ${x.name}${paid ? ` ($${paid})` : ""}`);
  res.json(list);
});

// ---------------- books & taxes, sales from other sites, listings out, insurance, grading picks, weekly report, live

/** The year's books: sales by where they sold, fees, cost of cards, expenses, inventory at the start and end of
 *  the year (cost), sales tax, and each platform's 1099-K checked against what's recorded here. */
app.get("/api/books", (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year || "")) ? String(req.query.year) : String(new Date().getFullYear());
  const inv = store.inventory();
  const s = store.shopSettings();
  const r2 = (v) => Math.round(v * 100) / 100;
  const sold = inv.filter((r) => r.status === "sold" && r.soldPrice != null && (r.soldDate || "").startsWith(year));
  const channels = {};
  for (const r of sold) {
    const c = (channels[r.soldOn || "Other"] ||= { channel: r.soldOn || "Other", units: 0, gross: 0, fees: 0, cost: 0, consigned: 0 });
    c.units += r.qty;
    c.gross += r.soldPrice * r.qty;
    c.fees += feeFor(r);
    c.cost += (r.cost || 0) * r.qty;
    if (r.consignorId) c.consigned += r.soldPrice * r.qty;
  }
  const byChannel = Object.values(channels).map((c) => ({ ...c, gross: r2(c.gross), fees: r2(c.fees), cost: r2(c.cost), consigned: r2(c.consigned), profit: r2(c.gross - c.fees - c.cost) })).sort((a, b) => b.gross - a.gross);
  const exps = store.expenses().filter((e) => e.date.startsWith(year));
  const byKind = {};
  for (const e of exps) byKind[e.kind] = r2((byKind[e.kind] || 0) + e.amount);
  const todayIso = new Date().toLocaleDateString("en-CA");
  const start = `${Number(year) - 1}-12-31`, end = `${year}-12-31` < todayIso ? `${year}-12-31` : todayIso;
  const atCost = (list) => r2(list.reduce((n, r) => n + (r.cost || 0) * r.qty, 0));
  const startInv = atCost(store.inventoryAt(start, inv)), endInv = atCost(store.inventoryAt(end, inv));
  const purchases = atCost(inv.filter((r) => !r.consignorId && (r.purchased || String(r.added || "").slice(0, 10)).startsWith(year)));
  const sum = (list, k) => r2(list.reduce((n, x) => n + x[k], 0));
  const gross = sum(byChannel, "gross"), fees = sum(byChannel, "fees"), cogs = sum(byChannel, "cost"), expenses = r2(exps.reduce((n, e) => n + e.amount, 0));
  const inPerson = r2(sold.filter((r) => ["Card show", "Local / cash"].includes(r.soldOn)).reduce((n, r) => n + r.soldPrice * r.qty, 0));
  const websiteTax = r2(mjc.localOrders().filter((o) => (o.created || "").startsWith(year)).reduce((n, o) => n + (o.tax || 0), 0));
  const rate = s.salesTaxPct;
  const k = s.k1099?.[year] || {};
  const platforms = ["eBay", "Whatnot", "TCGplayer", "MJC site", "Facebook"];
  res.json({
    year, through: end, gross, fees, cogs, expenses, profit: r2(gross - fees - cogs), net: r2(gross - fees - cogs - expenses),
    byChannel, expensesByKind: byKind,
    inventory: { start: startInv, purchases, end: endInv, cogs: r2(startInv + purchases - endInv), note: "Cost of cards owned on Jan 1 + cards bought this year − cards owned at year end. Consigned cards aren't yours and aren't counted; boxes opened leave stock when opened." },
    salesTax: { websiteCollected: websiteTax, inPerson, rate, included: s.taxIncluded, due: rate ? r2(s.taxIncluded ? (inPerson * rate) / (100 + rate) : (inPerson * rate) / 100) : null },
    k1099: platforms.map((p) => { const rec = channels[p] ? r2(channels[p].gross) : 0; return { platform: p, recorded: rec, reported: k[p] ?? null, diff: k[p] != null ? r2(k[p] - rec) : null }; }).filter((x) => x.recorded || x.reported != null),
    consignment: { sales: r2(sold.filter((r) => r.consignorId).reduce((n, r) => n + r.soldPrice * r.qty, 0)), paidOut: r2(sold.filter((r) => r.payout?.paidAt).reduce((n, r) => n + r.payout.owed, 0)), owed: r2(sold.filter((r) => r.payout && !r.payout.paidAt).reduce((n, r) => n + r.payout.owed, 0)) },
  });
});
app.put("/api/books/1099", (req, res) => res.json(store.saveShopSettings({ k1099: req.body || {} }).k1099));
// What you owned on a date, at cost (the year-end inventory list for the accountant).
app.get("/api/export/inventory-at.csv", (req, res) => {
  const d = store.clean.date(req.query.date) || new Date().toLocaleDateString("en-CA");
  const rows = store.inventoryAt(d);
  sendCsv(res, `inventory-on-${d}`, csv(rows, [["SKU", (r) => r.sku], ["Card", (r) => r.name], ["Grade", (r) => r.grade], ["Category", (r) => r.category], ["Qty", (r) => r.qty], ["Cost each", (r) => r.cost], ["Cost total", (r) => Math.round((r.cost || 0) * r.qty * 100) / 100], ["Bought", (r) => r.purchased || String(r.added || "").slice(0, 10)], ["Location", (r) => r.location]]));
});

// Insurance schedule: every card worth more than a set amount, with what it cost, its value today and where it is.
app.get("/api/insurance", (req, res) => {
  const min = parseFloat(req.query.min) || 100;
  const rows = store.inventoryView().filter((r) => r.status !== "sold" && (r.value ?? r.cost ?? 0) >= min).sort((a, b) => (b.value ?? b.cost ?? 0) * b.qty - (a.value ?? a.cost ?? 0) * a.qty);
  res.json({ min, at: new Date().toISOString(), total: Math.round(rows.reduce((n, r) => n + (r.value ?? r.cost ?? 0) * r.qty, 0) * 100) / 100, rows: rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, grade: r.grade, qty: r.qty, cost: r.cost, value: r.value, location: r.location, cert: r.facts?.cert || "", photo: (r.photos || [])[0] ? `/api/photos/${r.id}/${mjc.thumbName(r.photos[0])}` : null, consigned: Boolean(r.consignorId), valuedAt: r.valuedAt })) });
});

// Sales made on other sites (eBay's orders report, Whatnot's sales export, TCGplayer…): read the file, match each
// line to a card (SKU = "Custom label" first, else the closest title), then mark the confirmed ones sold.
const findCol = (head, res) => { for (const re of res) { const i = head.findIndex((h) => re.test(h)); if (i >= 0) return i; } return -1; };
app.post("/api/import-sales/preview", (req, res) => {
  const all = parseCsv(String(req.body?.text || "").slice(0, 5e6));
  const hi = all.findIndex((r) => r.some((c) => /title|item|product|card|name/i.test(c)) && r.some((c) => /price|sold|total|amount/i.test(c)));
  if (hi < 0) return res.status(400).json({ error: "Couldn't find the header row (a title column and a price column)." });
  const head = all[hi].map((h) => String(h).trim());
  const col = {
    sku: findCol(head, [/^custom label/i, /\bsku\b/i, /custom label/i]),
    title: findCol(head, [/^item title$/i, /title/i, /product name/i, /^item$/i, /listing/i, /card name/i, /name/i]),
    qty: findCol(head, [/^quantity$/i, /quantity/i, /^qty/i]),
    price: findCol(head, [/^sold for$/i, /item price/i, /sold price/i, /sale price/i, /^price$/i, /price/i, /total/i, /amount/i]),
    date: findCol(head, [/sale date/i, /order date/i, /sold date/i, /paid on/i, /date/i]),
    order: findCol(head, [/order number/i, /order id/i, /order #/i, /sales record/i, /order/i]),
    buyer: findCol(head, [/buyer username/i, /buyer user/i, /buyer name/i, /buyer/i, /username/i, /customer/i]),
  };
  if (col.title < 0 || col.price < 0) return res.status(400).json({ error: "The file needs a title column and a price column." });
  const platform = store.clean.oneOf(req.body?.platform, store.PLATFORMS, "eBay");
  const done = new Set(store.load("sales-imports", []));
  const stock = store.inventoryView().filter((r) => r.status !== "sold");
  const words = (s) => new Set(String(s || "").toLowerCase().replace(/[^a-z0-9#]+/g, " ").split(" ").filter((w) => w.length > 1));
  const totalPrice = /total|amount/i.test(head[col.price]);
  const money = (v) => store.clean.money(String(v || "").replace(/[^0-9.]/g, ""));
  const dateOf = (v) => { if (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "").trim())) return String(v).trim(); const t = Date.parse(String(v || "").replace(/ (PDT|PST|EDT|EST|CDT|CST|MDT|MST)$/, "")); return Number.isFinite(t) ? new Date(t).toLocaleDateString("en-CA") : null; };
  const rows = all.slice(hi + 1).map((r, i) => {
    const title = String(r[col.title] || "").trim(), sku = col.sku >= 0 ? String(r[col.sku] || "").trim() : "";
    const qty = col.qty >= 0 ? Math.max(1, parseInt(r[col.qty], 10) || 1) : 1;
    const price = money(r[col.price]);
    if (!title || price == null) return null;
    const order = col.order >= 0 ? String(r[col.order] || "").trim() : "";
    const key = `${platform}|${order}|${sku}|${title}`.toLowerCase();
    let match = sku ? stock.find((x) => x.sku && x.sku.toLowerCase() === sku.toLowerCase()) : null;
    let how = match ? "sku" : null, score = match ? 1 : 0;
    if (!match) {
      const tw = words(title);
      for (const x of stock) {
        const xw = words(x.name);
        const overlap = [...xw].filter((w) => tw.has(w)).length / Math.max(1, xw.size);
        if (overlap > score) { score = overlap; match = x; }
      }
      how = score >= 0.6 ? "title" : null;
      if (!how) match = null;
    }
    return { i, key, title, sku, qty, price: totalPrice ? Math.round((price / qty) * 100) / 100 : price, date: col.date >= 0 ? dateOf(r[col.date]) : null, order, buyer: col.buyer >= 0 ? String(r[col.buyer] || "").trim() : "", dup: done.has(key), match: match ? { id: match.id, name: match.name, sku: match.sku, grade: match.grade, qty: match.qty, how, score: Math.round(score * 100) / 100 } : null };
  }).filter(Boolean);
  res.json({ platform, columns: Object.fromEntries(Object.entries(col).map(([k, i]) => [k, i >= 0 ? head[i] : null])), rows });
});
app.post("/api/import-sales/apply", (req, res) => {
  const platform = store.clean.oneOf(req.body?.platform, store.PLATFORMS, "eBay");
  const done = store.load("sales-imports", []);
  const seen = new Set(done);
  let sold = 0, web = false;
  for (const x of (Array.isArray(req.body?.rows) ? req.body.rows : []).slice(0, 2000)) {
    const key = String(x.key || "").slice(0, 400);
    if (!key || seen.has(key)) continue;
    let customerId = null;
    if (x.buyer) {
      const handle = store.clean.str(x.buyer, 60);
      customerId = (store.customers().find((c) => (c.handle || "").toLowerCase() === handle.toLowerCase()) || store.addCustomer({ name: handle, handle, notes: `Bought on ${platform}` })).id;
    }
    const r = store.sellUnits(String(x.rowId), { qty: x.qty, soldPrice: x.price, soldOn: platform, soldDate: store.clean.date(x.date), note: `${platform}${x.order ? " order " + store.clean.str(x.order, 60) : ""}`, customerId });
    if (!r) continue;
    web ||= Boolean(r.row.web);
    seen.add(key);
    done.push(key);
    sold++;
  }
  store.save("sales-imports", done.slice(-20000));
  if (sold) log(req, `marked ${sold} card${sold === 1 ? "" : "s"} sold from a ${platform} sales file`);
  if (web) mjc.scheduleSync(); // sold on another site → off the MJC website too
  res.json({ sold });
});

// Listings out: every field the selling sites ask for, one row per card — copy the columns into eBay's or Whatnot's
// bulk-listing template (their column names differ, so this file has all of them under plain names).
app.all("/api/export/listings.csv", (req, res) => {
  if (!["GET", "POST"].includes(req.method)) return res.status(405).end();
  const ids = new Set((Array.isArray(req.body?.ids) ? req.body.ids : String(req.query.ids || "").split(",")).map(String).filter(Boolean));
  const site = (mjc.storeSettings()?.siteUrl || "").replace(/\/+$/, "");
  const rows = store.inventory().filter((r) => r.status !== "sold" && (ids.size ? ids.has(r.id) : true));
  const grader = (r) => String(r.grade || "").match(/^(PSA|BGS|SGC|CGC|TAG|HGA)\b/i)?.[1]?.toUpperCase() || "";
  const title = (r) => { const t = /^raw$/i.test(r.grade) || r.name.includes(r.grade) ? r.name : `${r.name} ${r.grade}`; return t.length > 80 ? t.slice(0, 79).trim() + "…" : t; };
  const photo = (r, n) => (r.photos || [])[n] ? r.photoUrls?.[r.photos[n]] || "" : "";
  sendCsv(res, "listings", csv(rows, [
    ["SKU (custom label)", (r) => r.sku], ["Title", title], ["Price", (r) => r.listPrice ?? (r.web ? (r.webMode === "fixed" ? r.webFixedPrice : r.webPrice) : null) ?? r.value], ["Quantity", (r) => r.qty],
    ["Graded", (r) => (grader(r) ? "Yes" : "No")], ["Grader", grader], ["Grade", (r) => String(r.grade || "").match(/(\d+(\.\d)?)\s*$/)?.[1] || ""], ["Cert number", (r) => r.facts?.cert || ""],
    ["Condition (raw)", (r) => (/^raw$/i.test(r.grade) && r.condition?.scale ? store.CONDITION_LABEL[r.condition.scale] : "")], ["Condition notes", (r) => (/^raw$/i.test(r.grade) ? [r.condition?.centering && "centering " + r.condition.centering, r.condition?.notes].filter(Boolean).join("; ") : "")],
    ["Year", (r) => r.facts?.year || ""], ["Set", (r) => r.facts?.set || ""], ["Player / character", (r) => r.facts?.player || ""], ["Team", (r) => r.facts?.team || ""], ["Card number", (r) => r.facts?.number || ""],
    ["Parallel / variety", (r) => r.facts?.parallel || ""], ["Serial numbered", (r) => r.facts?.serial || ""], ["Rookie", (r) => (r.facts?.rookie ? "Yes" : "")], ["Autographed", (r) => (r.facts?.auto ? "Yes" : "")], ["Relic / patch", (r) => (r.facts?.relic ? "Yes" : "")],
    ["Category", (r) => r.category], ["Description", (r) => r.webDescription || ""],
    ...[0, 1, 2, 3, 4, 5, 6, 7].map((n) => [`Photo URL ${n + 1}`, (r) => photo(r, n)]),
    ["Website link", (r) => (site && r.web ? `${site}/card/${r.id}` : "")],
  ]));
});

// What to grade next: your raw cards ranked by what grading should add after fees, from each grade's sold value
// and grade odds from the card's condition (centering included). Estimates — the odds are rules of thumb.
const GRADE_ODDS = { great: [0.25, 0.45, 0.2, 0.1], good: [0.1, 0.45, 0.3, 0.15], off: [0.02, 0.25, 0.45, 0.28], lp: [0, 0.05, 0.35, 0.6], unknown: [0.08, 0.35, 0.35, 0.22] };
function gradeOdds(r) {
  const k = r.condition;
  if (["MP", "HP", "DMG"].includes(k?.scale)) return null;
  if (k?.scale === "LP") return ["lp", GRADE_ODDS.lp];
  // "55/45 L/R · 60/40 T/B": the worse side of each pair, either way round
  const worst = Math.max(0, ...[...String(k?.centering || "").matchAll(/(\d{2})\s*\/\s*(\d{2})/g)].map((m) => Math.max(+m[1], +m[2])));
  if (k?.scale !== "NM" || !worst) return ["unknown", GRADE_ODDS.unknown];
  return worst <= 55 ? ["great", GRADE_ODDS.great] : worst <= 60 ? ["good", GRADE_ODDS.good] : ["off", GRADE_ODDS.off];
}
const guideCache = new Map(); // sales page → { at, d }
app.post("/api/grading/candidates", (req, res) => {
  const minRaw = parseFloat(req.body?.minRaw) || 5;
  const fee = store.shopSettings().ownGradingFee || 25;
  const [ebayPct, ebayFixed] = FEE_PCT.eBay;
  const rows = store.inventoryView().filter((r) => ["in_stock", "listed"].includes(r.status) && /^raw$/i.test(r.grade) && r.priceUrl && r.kind !== "sealed" && !r.consignorId && (r.value ?? 0) >= minRaw).sort((a, b) => (b.value || 0) - (a.value || 0)).slice(0, 80);
  streamJob(req, res, async (send, signal) => {
    const out = [];
    let i = 0;
    const net = (v) => (v > 0 ? v * (1 - ebayPct / 100) - ebayFixed : 0);
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (i < rows.length && !signal.aborted) {
        const r = rows[i++];
        const odds = gradeOdds(r);
        if (!odds) continue;
        send({ type: "step", text: `Grade values: ${r.name}` });
        let d = guideCache.get(r.priceUrl);
        if (!d || Date.now() - d.at > 6 * 3600000) {
          try {
            d = { at: Date.now(), d: await pricecharting.card(r.priceUrl) };
            guideCache.set(r.priceUrl, d);
          } catch {
            continue;
          }
        }
        const raw = pricecharting.valueAtGrade(d.d, "Raw") ?? r.value ?? 0;
        const v = ["PSA 10", "PSA 9", "PSA 8", "PSA 7"].map((g) => pricecharting.valueAtGrade(d.d, g));
        if (v[0] == null && v[1] == null) continue;
        for (let k = 3; k >= 0; k--) if (v[k] == null) v[k] = k === 3 ? raw : v[k + 1]; // a missing grade counts as the next one down
        const graded = odds[1].reduce((n, p, k) => n + p * net(v[k]), 0);
        const gain = Math.round((graded - net(raw) - fee) * 100) / 100;
        out.push({ id: r.id, name: r.name, sku: r.sku, location: r.location, condition: r.condition?.scale || "", centering: r.condition?.centering || "", oddsFrom: odds[0], odds: odds[1], raw, values: { psa10: v[0], psa9: v[1], psa8: v[2], psa7: v[3] }, gain, roi: Math.round((gain / fee) * 100) });
      }
    }));
    return { fee, cards: out.sort((a, b) => b.gain - a.gain) };
  });
});

// The weekly report: last week's numbers and what needs doing this week (Home → 📋 Weekly report; Monday alert).
function weeklyReport() {
  const inv = store.inventoryView();
  const w = weekSummary(inv);
  const todayIso = new Date().toLocaleDateString("en-CA");
  const soon = new Date(Date.now() + 14 * 86400000).toLocaleDateString("en-CA");
  const subs = store.submissions();
  return {
    ...w,
    from: new Date(Date.now() - 7 * 86400000).toLocaleDateString("en-CA"), to: todayIso,
    stockValue: Math.round(inv.filter((r) => r.status !== "sold").reduce((n, r) => n + (r.value ?? r.cost ?? 0) * r.qty, 0) * 100) / 100,
    movers: store.stockMovers(7, 5),
    toDo: {
      unshipped: mjc.localOrders().filter((o) => o.status === "paid").length,
      openMessages: mjc.localTickets().filter((t) => t.status === "open").length,
      lowSupplies: store.supplies().filter((x) => x.onHand != null && x.onHand <= x.reorderAt).map((x) => x.name),
      consignorsOwed: Math.round(store.consignments().filter((x) => x.owed && !x.paidAt).reduce((n, x) => n + x.owed, 0) * 100) / 100,
      gradingBack: store.gradingOrders().filter((o) => store.gradingOrderStage(o, subs).step === 4 && o.status !== "returned").length,
      shows: store.shows().filter((s) => s.date >= todayIso && s.date <= soon).map((s) => ({ name: s.name, date: s.date, table: s.table })),
    },
  };
}
app.get("/api/weekly", (_req, res) => res.json({ ...weeklyReport(), emailTo: store.shopSettings().weeklyTo }));

// QR codes for packing slips and signs (an SVG; plain text in, at most 500 characters).
app.get("/api/qr", async (req, res) => {
  const text = String(req.query.text || "").slice(0, 500);
  if (!text) return res.status(400).end();
  res.setHeader("Content-Type", "image/svg+xml");
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.send(await QRCode.toString(text, { type: "svg", margin: 1, errorCorrectionLevel: "M" }));
});

// ---- live stream (Whatnot): the queue, the card on screen, sold to @buyer — and the overlay OBS shows
const liveRow = (id) => store.inventoryView().find((r) => r.id === id);
const liveCard = (q) => { const r = q && liveRow(q.id); return r ? { id: r.id, name: r.name, grade: r.grade, qty: r.qty, sku: r.sku, location: r.location, value: r.value ?? null, price: q.price ?? null, status: r.status, photo: (r.photos || [])[0] ? `/api/photos/${r.id}/${r.photos[0]}` : null } : null; };
app.get("/api/live", (_req, res) => {
  const st = store.liveState();
  res.json({ ...st, queue: st.queue.map(liveCard).filter(Boolean), now: liveCard(st.now), total: Math.round(st.sales.reduce((n, x) => n + x.price, 0) * 100) / 100, feePct: FEE_PCT.Whatnot });
});
app.put("/api/live/queue", (req, res) => {
  const st = store.liveState();
  st.queue = (Array.isArray(req.body?.queue) ? req.body.queue : []).slice(0, 500).filter((q) => liveRow(String(q?.id))).map((q) => ({ id: String(q.id), price: store.clean.money(q.price) }));
  store.saveLive(st);
  res.json({ ok: true, queue: st.queue.length });
});
app.post("/api/live/now", (req, res) => {
  const st = store.liveState();
  const q = st.queue.find((x) => x.id === String(req.body?.id));
  if (!q) return res.status(404).json({ error: "That card isn't in the queue." });
  st.now = q;
  st.startedAt ||= new Date().toISOString();
  store.saveLive(st);
  res.json({ ok: true });
});
app.post("/api/live/sold", (req, res) => {
  const st = store.liveState();
  if (!st.now) return res.status(400).json({ error: "Put a card on screen first." });
  const price = store.clean.money(req.body?.price);
  if (price == null) return res.status(400).json({ error: "What did it sell for?" });
  const buyer = store.clean.str(req.body?.buyer, 60).replace(/^@/, "");
  const cust = buyer ? store.customers().find((c) => (c.handle || "").toLowerCase() === buyer.toLowerCase()) || store.addCustomer({ name: buyer, handle: buyer, notes: "Bought on a Whatnot stream" }) : null;
  const r = store.sellUnits(st.now.id, { qty: 1, soldPrice: price, soldOn: "Whatnot", payment: "Card", note: `Whatnot stream${buyer ? " · @" + buyer : ""}`, customerId: cust?.id || null });
  if (!r) return res.status(409).json({ error: "That card was already sold." });
  st.sales.push({ at: new Date().toISOString(), rowId: r.row.id, soldRowId: r.soldRow.id, name: r.soldRow.name, grade: r.soldRow.grade, sku: r.soldRow.sku, location: r.soldRow.location || "", buyer, customerId: cust?.id || null, price });
  // the next card in the queue goes on screen; a stack with copies left stays queued
  const i = st.queue.findIndex((x) => x.id === st.now.id);
  if (i >= 0 && r.soldRow === r.row) st.queue.splice(i, 1);
  st.now = st.queue[i] || st.queue[0] || null;
  store.saveLive(st);
  log(req, `sold ${r.soldRow.name} on a Whatnot stream for $${price}${buyer ? " to @" + buyer : ""}`);
  if (r.row.web) mjc.scheduleSync();
  res.json({ ok: true, sale: st.sales.at(-1) });
});
app.post("/api/live/skip", (_req, res) => {
  const st = store.liveState();
  if (st.now) {
    const i = st.queue.findIndex((x) => x.id === st.now.id);
    const [q] = st.queue.splice(i, 1);
    st.queue.push(q);
    st.now = st.queue[i] || st.queue[0] || null;
    store.saveLive(st);
  }
  res.json({ ok: true });
});
app.post("/api/live/end", (req, res) => {
  const st = store.endLive();
  log(req, `ended a Whatnot stream: ${st.sales.length} sales, $${Math.round(st.sales.reduce((n, x) => n + x.price, 0) * 100) / 100}`);
  res.json({ ok: true, sales: st.sales });
});
app.get("/api/live/sessions", (_req, res) => res.json(store.liveSessions()));
// The overlay page (OBS browser source → http://localhost:3737/overlay.html) asks this every second or two.
app.get("/api/live/overlay", (_req, res) => {
  const st = store.liveState();
  const last = st.sales.at(-1);
  res.json({ now: liveCard(st.now), last: last ? { name: last.name, buyer: last.buyer, price: last.price } : null, next: st.queue.length > 1 ? liveCard(st.queue[(st.queue.findIndex((x) => x.id === st.now?.id) + 1) % st.queue.length]) : null });
});

// ---------------- MJC website: listing photos + description ----------------

app.get("/api/photos/:id/:file", (req, res) => {
  const f = mjc.photoPath(req.params.id, req.params.file);
  if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(f);
});

/** Write one JPEG (+ its small website copy) for a card; returns the file name, or null if it isn't a usable JPEG. */
function writePhoto(rowId, data, thumb) {
  const jpeg = (v, max) => {
    const m = String(v || "").match(/^(?:data:image\/jpeg;base64,)?([A-Za-z0-9+/=]+)$/);
    const b = m ? Buffer.from(m[1], "base64") : null;
    return b && b.length > 100 && b.length < max && b[0] === 0xff && b[1] === 0xd8 ? b : null;
  };
  const buf = jpeg(data, 4.5e6);
  if (!buf) return null;
  const file = `${store.newId()}.jpg`;
  const f = mjc.photoPath(rowId, file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  // The small copy for the website's grid (optional — older photos simply have none).
  const tbuf = jpeg(thumb, 1e6);
  if (tbuf) fs.writeFileSync(mjc.photoPath(rowId, mjc.thumbName(file)), tbuf);
  return file;
}

// Many new cards in one write, each with its photos (bulk scan). Up to 40 per request.
app.post("/api/inventory/many", (req, res) => {
  const items = (Array.isArray(req.body?.items) ? req.body.items : []).slice(0, 40);
  if (!items.length) return res.status(400).json({ error: "No cards to add." });
  const by = who(req);
  const rows = store.addInventoryMany(items.map(({ photos, ...it }) => ({ ...it, addedBy: by })));
  const patches = [];
  rows.forEach((row, i) => {
    const files = (Array.isArray(items[i].photos) ? items[i].photos : []).slice(0, 8).map((p) => writePhoto(row.id, p?.data, p?.thumb)).filter(Boolean);
    if (files.length) patches.push({ id: row.id, photos: files });
  });
  store.setEngineFieldsMany(patches);
  log(req, `added ${rows.length} scanned card${rows.length === 1 ? "" : "s"} to inventory`);
  tellCustomers(rows);
  res.json({ added: rows.length, rows: rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name })) });
});

app.post("/api/inventory/:id/photos", (req, res) => {
  const row = store.inventoryView().find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  if ((row.photos || []).length >= 8) return res.status(400).json({ error: "Up to 8 photos per card." });
  const file = writePhoto(row.id, req.body?.data, req.body?.thumb);
  if (!file) return res.status(400).json({ error: "Send a JPEG photo under 4.5 MB." });
  const updated = store.setEngineFields(row.id, { photos: [...(row.photos || []), file] });
  if (row.web) mjc.scheduleSync();
  res.json({ ok: true, file, photos: updated.photos });
});

app.delete("/api/inventory/:id/photos/:file", (req, res) => {
  const row = store.inventory().find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const photos = (row.photos || []).filter((x) => x !== req.params.file);
  for (const f of [req.params.file, mjc.thumbName(req.params.file)]) {
    try {
      fs.unlinkSync(mjc.photoPath(row.id, f));
    } catch {}
  }
  store.setEngineFields(row.id, { photos });
  if (row.web) mjc.scheduleSync();
  res.json({ ok: true, photos });
});

app.post("/api/inventory/:id/photos/order", (req, res) => {
  const row = store.inventory().find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const want = (Array.isArray(req.body?.photos) ? req.body.photos : []).filter((f) => (row.photos || []).includes(f));
  const photos = [...want, ...(row.photos || []).filter((f) => !want.includes(f))];
  store.setEngineFields(row.id, { photos });
  if (row.web) mjc.scheduleSync();
  res.json({ ok: true, photos });
});

// A short tilt video (refractor shine, surface) — MP4 or WebM, recorded in the app or picked from a file.
app.post("/api/inventory/:id/video", (req, res) => {
  const row = store.inventoryView().find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  const m = String(req.body?.data || "").match(/^data:(video\/(mp4|webm|quicktime))(;[^,]*)?;base64,([A-Za-z0-9+/=]+)$/);
  const buf = m ? Buffer.from(m[4], "base64") : null;
  if (!buf || buf.length < 1000 || buf.length > 25e6) return res.status(400).json({ error: "Send an MP4 or WebM video under 25 MB (a few seconds is plenty)." });
  const file = `${store.newId()}.${m[2] === "quicktime" ? "mov" : m[2]}`;
  const f = mjc.photoPath(row.id, file);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, buf);
  if (row.video) {
    try {
      fs.unlinkSync(mjc.photoPath(row.id, row.video));
    } catch {}
  }
  store.setEngineFields(row.id, { video: file, videoUrl: null });
  if (row.web) mjc.scheduleSync();
  res.json({ ok: true, video: file });
});
app.delete("/api/inventory/:id/video", (req, res) => {
  const row = store.inventoryView().find((r) => r.id === req.params.id);
  if (!row?.video) return res.status(404).json({ error: "No video on this card." });
  try {
    fs.unlinkSync(mjc.photoPath(row.id, row.video));
  } catch {}
  store.setEngineFields(row.id, { video: null, videoUrl: null });
  if (row.web) mjc.scheduleSync();
  res.json({ ok: true });
});

// AI-written website description from the card's research report.
app.post("/api/inventory/:id/describe", (req, res) => {
  const row = store.inventory().find((r) => r.id === req.params.id);
  const report = row?.lookupId ? store.getLookup(row.lookupId) : null;
  if (!report) return res.status(400).json({ error: "Research this card first (Card Lookup → Research with AI → ＋ Inventory) so the description has real facts to work from." });
  streamJob(req, res, async (send, signal) => {
    const l = await writeListing({ report, platform: "MJC website (your own shop, fixed price)" }, { onEvent: send, signal });
    store.updateInventory(row.id, { webDescription: l.description });
    if (row.web) mjc.scheduleSync();
    return { description: l.description, title: l.title };
  });
});

// ---------------- MJC website: connection, store policies, orders, messages ----------------

app.get("/api/mjc", async (req, res) => {
  let remote = null, remoteError = null;
  if (mjc.configured()) {
    try {
      remote = await mjc.status();
    } catch (err) {
      remoteError = err.message;
    }
  }
  const inv = store.inventory();
  res.json({
    configured: mjc.configured(),
    apiUrl: mjc.apiUrl(),
    state: mjc.state(),
    remote,
    remoteError,
    store: mjc.storeSettings(),
    onSite: inv.filter(mjc.onSite).length,
    marked: inv.filter((r) => r.web && r.status !== "sold").length,
    needsPrice: inv.filter((r) => r.web && r.status !== "sold" && !mjc.onSite(r)).map((r) => ({ id: r.id, name: r.name, note: r.webPricingNote || (r.qty > 0 ? "Waiting for its first price" : "Out of stock") })),
    canEditSettings: isLoopback(req.socket.remoteAddress),
  });
});

app.post("/api/mjc/connect", async (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Only on the computer running the bot." });
  const url = String(req.body?.apiUrl || "").trim().replace(/\/+$/, "");
  const token = String(req.body?.token || "").trim();
  if (!/^https?:\/\/[\w.-]+(:\d+)?(\/[\w./-]*)?$/.test(url)) return res.status(400).json({ error: "That isn't a web address." });
  if (!/^https:\/\//.test(url) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(url)) return res.status(400).json({ error: "The store address must start with https:// (http only for localhost testing)." });
  setEnv({ MJC_API_URL: url, ...(token ? { MJC_SYNC_TOKEN: token } : {}) });
  try {
    const remote = await mjc.status();
    log(req, "connected the bot to the MJC website");
    res.json({ ok: true, remote });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put("/api/mjc/store", async (req, res) => {
  const b = req.body || {};
  const s = {
    name: store.clean.str(b.name, 120) || "MJC Sports Cards & Collectibles",
    supportEmail: store.clean.str(b.supportEmail, 254),
    shippingFlat: store.clean.money(b.shippingFlat) ?? 0,
    freeShippingOver: store.clean.money(b.freeShippingOver),
    about: store.clean.text(b.about, 1500),
    shipping: store.clean.text(b.shipping, 1000),
    returns: store.clean.text(b.returns, 2000),
    policies: store.clean.text(b.policies, 8000),
    checkoutEnabled: Boolean(b.checkoutEnabled),
    showDemo: b.showDemo === undefined ? true : Boolean(b.showDemo),
    localPickup: Boolean(b.localPickup),
    pickupNote: store.clean.str(b.pickupNote, 300),
    promoCodes: Boolean(b.promoCodes),
    stripeTax: Boolean(b.stripeTax),
    emailList: b.emailList === undefined ? true : Boolean(b.emailList),
    social: Object.fromEntries(["instagram", "facebook", "tiktok", "youtube", "ebay", "whatnot", "x"].map((k) => [k, store.clean.str(b[`social_${k}`], 300)]).filter(([, v]) => v)),
    // 3.13: pickup at a card show, pay over time, gift cards, store credit by code, the "check it first" amount
    showPickup: Boolean(b.showPickup),
    payLater: Boolean(b.payLater),
    giftCards: Boolean(b.giftCards),
    giftAmounts: String(b.giftAmounts || "25, 50, 100").split(/[,\s]+/).map((v) => store.clean.money(v)).filter((v) => v >= 5 && v <= 1000).slice(0, 6),
    creditOnline: Boolean(b.creditOnline),
    reviewOver: store.clean.money(b.reviewOver),
    // the show calendar comes from Shop → Shows (kept as it is when this form is saved)
    shows: mjc.storeSettings()?.shows || [],
  };
  try {
    await mjc.saveStoreSettings(s);
    log(req, `updated MJC store settings${s.checkoutEnabled ? " (checkout ON)" : ""}`);
    res.json({ ok: true, store: s });
  } catch (err) {
    res.status(502).json({ error: `Saved here, but the website didn't take it: ${err.message}` });
  }
});

app.post("/api/mjc/sync", async (req, res) => {
  try {
    const r = await mjc.syncCatalog();
    log(req, `synced ${r.live} cards to the MJC website`);
    res.json(r);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/mjc/orders", (_req, res) => res.json(mjc.localOrders()));
app.post("/api/mjc/orders/pull", async (_req, res) => {
  try {
    res.json({ fresh: (await pullMjc()).orders });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.patch("/api/mjc/orders/:id", async (req, res) => {
  try {
    const b = req.body || {};
    const o = await mjc.updateOrder(req.params.id, { status: b.status, carrier: store.clean.str(b.carrier, 30), tracking: store.clean.str(b.tracking, 60), ...(b.hold === false ? { hold: false } : {}) });
    if (b.hold === false) log(req, `checked MJC order ${o.id} — OK to ship`);
    if (b.status === "shipped") log(req, `shipped MJC order ${o.id}${o.tracking ? ` (${o.carrier || ""} ${o.tracking})` : ""}`);
    res.json(o);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---- the website's conversations, reviews and Pip's unanswered questions (3.13)
const mjcCall = (fn) => async (req, res) => {
  try {
    res.json(await fn(req));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
};
app.post("/api/mjc/tickets/:id/reply", mjcCall(async (req) => {
  const text = store.clean.text(req.body?.text, 4000);
  if (!text) throw new Error("Write the reply.");
  const r = await mjc.replyTicket(req.params.id, text, who(req));
  await mjc.pullTickets().catch(() => {});
  log(req, `replied to website message ${req.params.id}`);
  return { ok: true, emailed: r.emailed };
}));
app.post("/api/mjc/tickets/:id/offer", mjcCall(async (req) => {
  const b = req.body || {};
  const offer = { cash: store.clean.money(b.cash), credit: store.clean.money(b.credit), note: store.clean.text(b.note, 1000) };
  if (offer.cash == null && offer.credit == null) throw new Error("Offer cash, store credit or both.");
  const r = await mjc.offerTicket(req.params.id, offer);
  await mjc.pullTickets().catch(() => {});
  log(req, `offered${offer.cash != null ? ` $${offer.cash} cash` : ""}${offer.credit != null ? ` / $${offer.credit} credit` : ""} on website request ${req.params.id}`);
  return { ok: true, emailed: r.emailed };
}));
app.get("/api/mjc/reviews", mjcCall(async () => ({ reviews: await mjc.reviews() })));
app.patch("/api/mjc/reviews/:id", mjcCall(async (req) => {
  const b = req.body || {};
  const r = await mjc.updateReview(req.params.id, { ...("reply" in b ? { reply: store.clean.text(b.reply, 1000) } : {}), ...("hidden" in b ? { hidden: Boolean(b.hidden), hideReason: b.hideReason } : {}) });
  return r;
}));
app.get("/api/mjc/pip-questions", mjcCall(async () => ({ questions: await mjc.pipQuestions() })));
app.post("/api/mjc/email", mjcCall(async (req) => mjc.sendEmail(store.clean.str(req.body?.to, 600).split(/[,;\s]+/).filter(Boolean), store.clean.str(req.body?.subject, 200), store.clean.text(req.body?.text, 20000))));
app.get("/api/mjc/credits", (_req, res) => res.json(store.load("mjc-credits", [])));

app.get("/api/mjc/subscribers.csv", async (_req, res) => {
  try {
    const list = await mjc.subscribers();
    sendCsv(res, "mjc-email-list", csv(list, [["Email", (s) => s.email], ["Name", (s) => s.name], ["Signed up", (s) => s.created], ["Where", (s) => s.source]]));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.delete("/api/mjc/subscribers/:email", async (req, res) => {
  try {
    await mjc.removeSubscriber(req.params.email);
    log(req, `removed ${req.params.email} from the website's email list`);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});
app.get("/api/mjc/tickets", (_req, res) => res.json(mjc.localTickets()));
app.get("/api/mjc/tickets/:id/photos/:n", (req, res) => {
  const f = mjc.ticketPhotoPath(req.params.id, req.params.n);
  if (!fs.existsSync(f)) return res.status(404).end();
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(f);
});
app.patch("/api/mjc/tickets/:id", async (req, res) => {
  try {
    await mjc.updateTicket(req.params.id, store.clean.oneOf(req.body?.status, ["open", "answered", "closed"], "answered"));
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------- pricing engine ----------------

app.get("/api/pricing", (_req, res) => {
  res.json({
    settings: pricingJob.settings(),
    defaults: PRICING_DEFAULTS,
    model: store.load("pricing-model", null),
    lastRun: store.load("pricing-last-run", null),
    changes: pricingJob.recentChanges(80),
    observations: store.pricingObs().length,
  });
});
app.put("/api/pricing/settings", (req, res) => res.json(pricingJob.saveSettings(req.body || {})));
app.post("/api/pricing/run", async (req, res) => {
  try {
    const r = await pricingJob.run({ force: true });
    if (r.changes?.length) log(req, `re-priced ${r.changes.length} website cards`);
    mjc.scheduleSync();
    res.json(r);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// New orders and customer messages, every few minutes (alerts + desktop notifications via the badge).
let mjcPulling = false;
async function pullMjc() {
  if (!mjc.configured() || mjcPulling) return { orders: [], tickets: 0 };
  mjcPulling = true;
  try {
    const orders = await mjc.pullOrders({
      onOrder: (o) => {
        store.addAlert({ kind: "order", name: `MJC order ${o.id}`, text: o.hold ? `⚠ ${o.name || o.email} bought ${o.items.map((i) => i.title).join(", ")} — $${o.total}. ${o.hold.reason} (Inventory → MJC store → Orders → Checked, OK to ship).` : o.gift ? `${o.name || o.email} bought a $${o.gift.amount} gift card (code ${o.gift.code}).` : `${o.name || o.email} bought ${o.items.map((i) => i.title).join(", ")} — $${o.total}. Ship it from Inventory → MJC store.` });
        store.logActivity("MJC website", `new order ${o.id}: ${o.items.map((i) => i.title).join(", ")} ($${o.total})`);
        for (const x of store.useSupplies({ orders: 1 })) store.addAlert({ kind: "supplies", name: x.name, text: `Down to ${x.onHand}${x.unit ? " " + x.unit : ""} — time to reorder.` });
      },
    });
    if (orders.length) mjc.scheduleSync();
    mjc.refreshStatus().catch(() => {}); // Home's website numbers; a miss just keeps the last copy
    let tickets = 0;
    await mjc.pullTickets({
      onActivity: (t, what) => store.addAlert({ kind: "ticket", name: `${what === "answer" ? "Answer to your offer" : "Reply"} from ${t.name || t.email}`, text: what === "answer" ? `They chose: ${{ cash: "cash", credit: "store credit", decline: "no thanks" }[t.offer.answer.choice] || t.offer.answer.choice}.` : String((t.replies || []).filter((r) => r.from === "customer").at(-1)?.text || "").slice(0, 140) }),
      onTicket: (t) => {
        tickets++;
        const what = { offer: `Offer of $${t.amount} on ${t.cardTitle}`, sell: "Cards to sell or trade to you", want: "Card request" }[t.kind] || "Message";
        store.addAlert({ kind: "ticket", name: `${what} from ${t.name || t.email}`, text: t.message.slice(0, 140) });
      },
    });
    return { orders, tickets };
  } finally {
    mjcPulling = false;
  }
}
setInterval(() => pullMjc().catch((err) => console.warn("MJC pull failed:", err.message)), 5 * 60 * 1000);
// While a website conversation is going (a message in the last half hour), its replies are checked every 30 s —
// the same pull, more often — so a shopper waiting in Pip's chat hears back in a minute, not five.
setInterval(() => { if (mjc.configured() && mjc.liveConversation() && !mjcPulling) pullMjc().catch(() => {}); }, 30 * 1000);

async function revalueInventory() {
  const updates = [];
  for (const row of store.inventory()) {
    if (!row.priceUrl || row.status === "sold") continue;
    try {
      const value = pricecharting.valueAtGrade(await pricecharting.card(row.priceUrl), row.grade);
      if (value != null) updates.push({ id: row.id, value });
    } catch {
      /* keep the old value */
    }
  }
  const updated = store.recordValues(updates); // value + its daily history, one write
  store.snapshotPortfolio();
  return updated;
}

app.post("/api/inventory/refresh", async (_req, res) => res.json({ updated: await revalueInventory() }));

// Import a spreadsheet (CSV). Header names are matched loosely: Card/Name, Grade, Qty, Cost/Paid, Value, ...
const IMPORT_COLS = {
  name: /^(card|name|card name|title|description|player)$/i,
  grade: /^(grade|condition)$/i,
  qty: /^(qty|quantity|count|#)$/i,
  cost: /^(cost|paid|cost each|price paid|purchase price|buy price)$/i,
  value: /^(value|market value|current value|est\.? value)$/i,
  purchased: /^(purchased|date|purchase date|bought)$/i,
  category: /^(category|sport|game|type)$/i,
  location: /^(location|box|storage)$/i,
  sku: /^(sku|id|item id)$/i,
  notes: /^(notes?|comments?)$/i,
  priceUrl: /^(price page|url|link)$/i,
};
app.post("/api/inventory/import", (req, res) => {
  const rows = parseCsv(String(req.body?.csv || "").slice(0, 5_000_000));
  if (rows.length < 2) return res.status(400).json({ error: "The file needs a header row and at least one card." });
  const header = rows[0].map((h) => h.trim());
  const map = {};
  header.forEach((h, i) => {
    for (const [field, re] of Object.entries(IMPORT_COLS)) if (!(field in map) && re.test(h)) map[field] = i;
  });
  if (!("name" in map)) return res.status(400).json({ error: `Couldn't find a card name column. Columns found: ${header.join(", ")}` });
  const catWord = (v) => {
    const s = String(v || "").toLowerCase();
    return ["baseball", "basketball", "football", "hockey", "soccer", "pokemon"].find((c) => s.includes(c)) || (/yu.?gi.?oh/.test(s) ? "yugioh" : /one.?piece/.test(s) ? "onepiece" : "other");
  };
  const items = [];
  let skipped = 0;
  for (const r of rows.slice(1, 5001)) {
    const get = (f) => (f in map ? r[map[f]] : undefined);
    if (!String(get("name") || "").trim()) {
      skipped++;
      continue;
    }
    const d = String(get("purchased") || "").trim();
    const iso = /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(0, 10) : !isNaN(Date.parse(d)) && d ? new Date(d).toISOString().slice(0, 10) : undefined;
    items.push({ name: get("name"), grade: get("grade") || "Raw", qty: get("qty") || 1, cost: get("cost"), value: get("value"), purchased: iso, category: catWord(get("category")), location: get("location"), sku: get("sku"), notes: get("notes"), priceUrl: get("priceUrl"), addedBy: who(req) });
  }
  const added = store.addInventoryMany(items);
  log(req, `imported ${added.length} cards from a spreadsheet`);
  res.json({ added: added.length, skipped, columns: Object.fromEntries(Object.entries(map).map(([k, i]) => [k, header[i]])) });
});

app.get("/api/portfolio", (_req, res) => res.json(store.portfolio()));

// ---------------- grading submissions ----------------

app.get("/api/submissions", (_req, res) => res.json(store.submissions()));

app.post("/api/submissions", (req, res) => {
  const sub = store.addSubmission({ ...(req.body || {}), addedBy: who(req) });
  log(req, `sent ${sub.itemIds.length} cards to ${sub.company}${sub.service ? " (" + sub.service + ")" : ""}`);
  res.json(sub);
});

app.patch("/api/submissions/:id", (req, res) => {
  const s = store.updateSubmission(req.params.id, req.body || {});
  s ? res.json(s) : res.status(404).json({ error: "not found" });
});

app.post("/api/submissions/:id/complete", async (req, res) => {
  const s = store.completeSubmission(req.params.id, req.body?.grades || {});
  if (!s) return res.status(404).json({ error: "not found" });
  log(req, `got ${s.itemIds.length} cards back from ${s.company}`);
  revalueInventory().catch(() => {});
  res.json(s);
});

app.delete("/api/submissions/:id", (req, res) => okDelete(res, store.deleteSubmission(req.params.id)));

async function refreshSubmissions() {
  let n = 0;
  for (const s of store.submissions()) {
    if (s.company !== "PSA" || !s.number || s.status === "complete" || !psa.hasToken()) continue;
    try {
      const p = await psa.submissionProgress(s.number);
      if (p.found) {
        store.updateSubmission(s.id, { progress: { ...p, checked: new Date().toISOString() }, ...(p.shipped ? { status: "shipped" } : p.gradesReady ? { status: "grading" } : {}) });
        n++;
      }
    } catch (err) {
      console.warn("PSA progress check failed:", err.message);
    }
  }
  return n;
}
app.post("/api/submissions/refresh", async (_req, res) => res.json({ checked: await refreshSubmissions() }));

// ---------------- expenses + analytics ----------------

app.get("/api/expenses", (_req, res) => res.json(store.expenses()));
app.post("/api/expenses", (req, res) => {
  const e = store.addExpense({ ...(req.body || {}), addedBy: who(req) });
  log(req, `logged a $${e.amount} ${e.kind} expense`);
  res.json(e);
});
app.delete("/api/expenses/:id", (req, res) => okDelete(res, store.deleteExpense(req.params.id)));
// A receipt photo → the expense's fields, for the owner to check and save. Same photo twice is flagged.
app.post("/api/expenses/receipt", (req, res) => {
  const images = cleanImages(req.body?.images, 2);
  if (!images.length) return res.status(400).json({ error: "Add a photo of the receipt." });
  const hash = crypto.createHash("sha256").update(images.map((i) => i.data).join("|")).digest("hex").slice(0, 32);
  const duplicate = store.expenses().find((e) => e.receiptHash === hash) || null;
  streamJob(req, res, async (send, signal) => {
    const receipt = await readReceipt({ images }, { onEvent: send, signal });
    return { receipt, hash, duplicate };
  });
});

// Approximate seller fees when a sale didn't record its own (same table as the profit calculator).
const FEE_PCT = { eBay: [13.25, 0.4], TCGplayer: [13.25, 0.3], Whatnot: [10.9, 0.3], Facebook: [0, 0], "MJC site": [2.9, 0.3], "Card show": [0, 0], "Local / cash": [0, 0], Other: [0, 0] };
const feeFor = (r) => {
  if (r.fees != null) return r.fees;
  const [p, f] = FEE_PCT[r.soldOn] || [0, 0];
  return r.soldPrice ? Math.round((r.soldPrice * r.qty * p / 100 + f) * 100) / 100 : 0;
};

app.get("/api/analytics", (req, res) => {
  const inv = store.inventory();
  const allSold = inv.filter((r) => r.status === "sold" && r.soldPrice != null);
  const years = [...new Set([...allSold.map((r) => (r.soldDate || r.added).slice(0, 4)), ...store.expenses().map((e) => e.date.slice(0, 4))])].sort().reverse();
  const year = /^\d{4}$/.test(String(req.query.year || "")) ? String(req.query.year) : null; // null = all time
  const sold = year ? allSold.filter((r) => (r.soldDate || r.added).startsWith(year)) : allSold;
  const exps = year ? store.expenses().filter((e) => e.date.startsWith(year)) : store.expenses();
  const months = {};
  const bucket = (m) => (months[m] ||= { month: m, revenue: 0, cogs: 0, fees: 0, expenses: 0, sales: 0 });
  for (const r of sold) {
    const b = bucket((r.soldDate || r.added).slice(0, 7));
    b.revenue += r.soldPrice * r.qty;
    b.cogs += (r.cost || 0) * r.qty;
    b.fees += feeFor(r);
    b.sales += r.qty;
  }
  for (const e of exps) bucket(e.date.slice(0, 7)).expenses += e.amount;
  const monthly = Object.values(months)
    .sort((a, b) => (a.month < b.month ? 1 : -1))
    .map((m) => ({ ...m, gross: m.revenue - m.cogs - m.fees, net: m.revenue - m.cogs - m.fees - m.expenses }));
  const byCat = {};
  for (const r of sold) {
    const c = (byCat[r.category] ||= { category: r.category, sales: 0, revenue: 0, profit: 0 });
    c.sales += r.qty;
    c.revenue += r.soldPrice * r.qty;
    c.profit += (r.soldPrice - (r.cost || 0)) * r.qty - feeFor(r);
  }
  const flips = sold.map((r) => {
    const profit = (r.soldPrice - (r.cost || 0)) * r.qty - feeFor(r);
    const days = r.purchased && r.soldDate ? Math.max(0, Math.round((Date.parse(r.soldDate) - Date.parse(r.purchased)) / 86400000)) : null;
    return { name: r.name, grade: r.grade, soldOn: r.soldOn, cost: r.cost * r.qty, sold: r.soldPrice * r.qty, profit: Math.round(profit * 100) / 100, roi: r.cost ? Math.round((profit / (r.cost * r.qty)) * 1000) / 10 : null, days };
  });
  const sum = (arr, f) => arr.reduce((n, x) => n + (f(x) || 0), 0);
  const withDays = flips.filter((f) => f.days != null);
  // Opening boxes: what each cost vs what came out (sold for, or still worth if not sold yet)
  const boxes = store.boxBreaks().filter((b) => !year || b.at.startsWith(year)).map((b) => {
    let soldFor = 0, stillWorth = 0;
    for (const p of b.pulls) for (const r of inv.filter((x) => x.id === p.id || x.splitFrom === p.id)) {
      if (r.status === "sold") soldFor += (r.soldPrice || 0) * r.qty - feeFor(r);
      else stillWorth += (r.value ?? 0) * r.qty;
    }
    return { at: b.at.slice(0, 10), name: b.name, cost: b.cost, cards: b.pulls.reduce((n, p) => n + p.qty, 0), worthAtOpen: b.value, soldFor: Math.round(soldFor * 100) / 100, stillWorth: Math.round(stillWorth * 100) / 100, result: Math.round((soldFor + stillWorth - b.cost) * 100) / 100 };
  });
  res.json({
    totals: {
      revenue: sum(sold, (r) => r.soldPrice * r.qty),
      profit: sum(flips, (f) => f.profit),
      expenses: sum(exps, (e) => e.amount),
      sales: sum(sold, (r) => r.qty),
      avgRoi: flips.length ? Math.round((sum(flips, (f) => f.roi) / flips.filter((f) => f.roi != null).length || 0) * 10) / 10 : null,
      avgDaysToSell: withDays.length ? Math.round(sum(withDays, (f) => f.days) / withDays.length) : null,
    },
    year,
    years,
    monthly,
    byCategory: Object.values(byCat).sort((a, b) => b.profit - a.profit),
    best: [...flips].sort((a, b) => b.profit - a.profit).slice(0, 5),
    worst: [...flips].sort((a, b) => a.profit - b.profit).slice(0, 5),
    boxes: { count: boxes.length, cost: sum(boxes, (b) => b.cost), soldFor: sum(boxes, (b) => b.soldFor), stillWorth: sum(boxes, (b) => b.stillWorth), result: sum(boxes, (b) => b.result), recent: boxes.slice(0, 25) },
  });
});

// ---------------- dashboard + activity ----------------

app.get("/api/dashboard", (_req, res) => {
  const inv = store.inventoryView();
  const stock = inv.filter((r) => r.status !== "sold");
  const port = store.portfolio();
  const value = stock.reduce((n, r) => n + (r.value ?? r.cost ?? 0) * r.qty, 0);
  const cost = stock.reduce((n, r) => n + (r.cost ?? 0) * r.qty, 0);
  const monthAgo = port.find((p) => Date.parse(p.date) >= Date.now() - 31 * 86400000);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const soldThisMonth = inv.filter((r) => r.status === "sold" && r.soldPrice != null && (r.soldDate || "").startsWith(thisMonth));
  const hot = store.load("hot", {});
  const brief = hot["all:daily"] || hot["all:weekly"] || null;
  res.json({
    portfolio: { value, cost, cards: stock.reduce((n, r) => n + r.qty, 0), change30: monthAgo ? value - monthAgo.value : null, history: port.slice(-120) },
    month: { sales: soldThisMonth.reduce((n, r) => n + r.qty, 0), revenue: soldThisMonth.reduce((n, r) => n + r.soldPrice * r.qty, 0), profit: soldThisMonth.reduce((n, r) => n + (r.soldPrice - r.cost) * r.qty - feeFor(r), 0) },
    status: { listed: inv.filter((r) => r.status === "listed").length, grading: inv.filter((r) => r.status === "grading").length, submissionsOpen: store.submissions().filter((s) => s.status !== "complete").length },
    alerts: store.alerts().filter((a) => !a.seen).slice(0, 5),
    movers: store.movers(7).slice(0, 5),
    hot: brief ? { at: brief.at, category: brief.category, period: brief.period, cards: (brief.cards || []).slice(0, 5), market_summary: brief.market_summary } : null,
    recent: store.load("lookups", []).slice(0, 5).map((r) => ({ id: r.id, name: r.card?.name, value: r.pricing?.estimated_value_usd, at: r.at, thumb: r.thumb })),
    activity: store.activity(12),
    week: weekSummary(inv),
    stockMovers: store.stockMovers(7, 4),
    backup: { ...store.backupState(), mirror: process.env.CARD_BOT_BACKUP_DIR || null },
  });
});

/** The last 7 days of the business, in numbers: sales, profit, best flip, new stock, the website. */
function weekSummary(inv) {
  const since = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const sold = inv.filter((r) => r.status === "sold" && r.soldPrice != null && (r.soldDate || "") >= since);
  const profitOf = (r) => (r.soldPrice - (r.cost || 0)) * r.qty - feeFor(r);
  const best = [...sold].sort((a, b) => profitOf(b) - profitOf(a))[0] || null;
  const tickets = mjc.localTickets().filter((t) => (t.created || "") >= since);
  return {
    sales: sold.reduce((n, r) => n + r.qty, 0),
    revenue: Math.round(sold.reduce((n, r) => n + r.soldPrice * r.qty, 0) * 100) / 100,
    profit: Math.round(sold.reduce((n, r) => n + profitOf(r), 0) * 100) / 100,
    best: best ? { name: best.name, grade: best.grade, profit: Math.round(profitOf(best) * 100) / 100, soldOn: best.soldOn } : null,
    // cards bought/added this week, counting units already sold off a stack (they carry their stack's date)
    added: inv.filter((r) => ((r.splitFrom && inv.find((x) => x.id === r.splitFrom)?.added) || r.added || "") >= since).reduce((n, r) => n + r.qty, 0),
    expenses: Math.round(store.expenses().filter((e) => e.date >= since).reduce((n, e) => n + e.amount, 0) * 100) / 100,
    website: mjc.configured() ? {
      orders: mjc.localOrders().filter((o) => (o.created || "") >= since).length,
      offers: tickets.filter((t) => t.kind === "offer").length,
      messages: tickets.filter((t) => t.kind !== "offer").length,
      visits: mjc.state().lastStatus?.visits?.week?.sessions ?? null,
      cardViews: mjc.state().lastStatus?.visits?.week?.card ?? null,
      subscribers: mjc.state().lastStatus?.subscribers ?? null,
    } : null,
  };
}

app.get("/api/activity", (_req, res) => res.json(store.activity(100)));

// ---------------- export / backup ----------------

app.get("/api/export/inventory.csv", (_req, res) => {
  sendCsv(res, "inventory", csv(store.inventoryView(), [
    ["SKU", (r) => r.sku], ["Card", (r) => r.name], ["Category", (r) => r.category], ["Grade", (r) => r.grade], ["Qty", (r) => r.qty],
    ["Cost each", (r) => r.cost], ["Value each", (r) => r.value], ["Unrealized P/L", (r) => (r.value != null && r.status !== "sold" ? ((r.value - r.cost) * r.qty).toFixed(2) : "")],
    ["Status", (r) => r.status], ["Listed on", (r) => r.listedOn], ["List price", (r) => r.listPrice], ["Location", (r) => r.location], ["Tags", (r) => (r.tags || []).join("; ")],
    ["Sold price each", (r) => r.soldPrice], ["Sold on", (r) => r.soldOn], ["Sold date", (r) => r.soldDate], ["Fees", (r) => (r.status === "sold" ? feeFor(r) : "")],
    ["Realized P/L", (r) => (r.status === "sold" && r.soldPrice != null ? ((r.soldPrice - r.cost) * r.qty - feeFor(r)).toFixed(2) : "")],
    ["Purchased", (r) => r.purchased], ["Added by", (r) => r.addedBy], ["Valued at", (r) => r.valuedAt], ["Notes", (r) => r.notes], ["Price page", (r) => r.priceUrl],
  ]));
});

app.get("/api/export/lookups.csv", (_req, res) => {
  sendCsv(res, "card-lookups", csv(store.load("lookups", []), [
    ["Date", (r) => r.at], ["By", (r) => r.by], ["Card", (r) => r.card?.name], ["Category", (r) => r.card?.category], ["Grade", (r) => gradeOf(r.card)],
    ["Est. value", (r) => r.pricing?.estimated_value_usd], ["Low", (r) => r.pricing?.value_range_low], ["High", (r) => r.pricing?.value_range_high],
    ["Verdict", (r) => r.buy_sell?.verdict], ["Max buy", (r) => r.buy_sell?.max_buy_price], ["List at", (r) => r.buy_sell?.list_price],
    ["Grading", (r) => r.grading?.recommendation], ["Demand", (r) => r.market?.demand], ["PSA verified", (r) => (r.slab ? (r.slab.verified ? "yes" : "NO") : "")], ["Summary", (r) => r.summary], ["Price page", (r) => r.pricing?.pricecharting_url],
  ]));
});

app.get("/api/export/watchlist.csv", (_req, res) => {
  sendCsv(res, "watchlist", csv(store.watchlist(), [
    ["Card", (w) => w.card?.name], ["Category", (w) => w.category], ["Grade", (w) => gradeOf(w.card)], ["Added", (w) => w.added],
    ["First value", (w) => w.snapshots.find((s) => s.value != null)?.value], ["Latest value", (w) => [...w.snapshots].reverse().find((s) => s.value != null)?.value],
    ["12-mo average", (w) => w.avg12], ["Alert above", (w) => w.targetAbove], ["Alert below", (w) => w.targetBelow], ["Price page", (w) => w.pricechartingUrl],
  ]));
});

app.get("/api/export/sales.csv", (_req, res) => {
  sendCsv(res, "sales", csv(store.inventoryView().filter((r) => r.status === "sold"), [
    ["Sold date", (r) => r.soldDate], ["Card", (r) => r.name], ["Grade", (r) => r.grade], ["Qty", (r) => r.qty], ["Sold on", (r) => r.soldOn], ["Sold price each", (r) => r.soldPrice],
    ["Cost each", (r) => r.cost], ["Fees", (r) => feeFor(r)], ["Profit", (r) => ((r.soldPrice - r.cost) * r.qty - feeFor(r)).toFixed(2)], ["Purchased", (r) => r.purchased], ["SKU", (r) => r.sku],
  ]));
});

app.get("/api/backup/status", (req, res) => {
  res.json({ state: store.backupState(), mirror: process.env.CARD_BOT_BACKUP_DIR || null, folders: store.cloudFolders(), canEditSettings: isLoopback(req.socket.remoteAddress) });
});
app.post("/api/backup/now", (req, res) => {
  try {
    store.dailyBackup({ force: true });
    log(req, "backed up the data");
    res.json({ ok: true, state: store.backupState() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
app.post("/api/backup/mirror", (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Only on the computer running the bot." });
  const dir = req.body?.dir ? String(req.body.dir) : null;
  if (dir && !(path.isAbsolute(dir) && fs.existsSync(dir) && fs.statSync(dir).isDirectory())) return res.status(400).json({ error: "That folder doesn't exist on this computer." });
  setEnv({ CARD_BOT_BACKUP_DIR: dir });
  if (dir) {
    try {
      store.dailyBackup({ force: true }); // first copy right away, so the owner sees it worked
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }
  log(req, dir ? `turned on backup copies to ${dir}` : "turned off cloud backup copies");
  res.json({ ok: true, state: store.backupState(), mirror: dir });
});

app.get("/api/backup", (_req, res) => {
  res.setHeader("Content-Disposition", `attachment; filename="card-bot-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(store.backup());
});

app.post("/api/restore", (req, res) => {
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Restore only on the computer running the bot." });
  try {
    store.restore(req.body);
    log(req, "restored a backup");
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Year summary for taxes: every sale line, then every expense line, then totals.
app.get("/api/export/tax.csv", (req, res) => {
  const year = /^\d{4}$/.test(String(req.query.year || "")) ? String(req.query.year) : new Date().getFullYear().toString();
  const sold = store.inventoryView().filter((r) => r.status === "sold" && r.soldPrice != null && (r.soldDate || r.added).startsWith(year));
  const exps = store.expenses().filter((e) => e.date.startsWith(year));
  const lines = [
    ...sold.map((r) => ({ date: r.soldDate, type: "Sale", item: `${r.name} (${r.grade}) x${r.qty}`, where: r.soldOn || "", gross: r.soldPrice * r.qty, cogs: (r.cost || 0) * r.qty, fees: feeFor(r), expense: "" })),
    ...exps.map((e) => ({ date: e.date, type: "Expense", item: `${e.kind}${e.note ? " — " + e.note : ""}`, where: "", gross: "", cogs: "", fees: "", expense: e.amount })),
  ].sort((a, b) => (a.date < b.date ? -1 : 1));
  const sum = (f) => lines.reduce((n, l) => n + (Number(l[f]) || 0), 0);
  lines.push({ date: "", type: "TOTAL", item: `Year ${year}`, where: "", gross: sum("gross"), cogs: sum("cogs"), fees: sum("fees"), expense: sum("expense") });
  lines.push({ date: "", type: "NET", item: "Gross − cost of cards − fees − expenses", where: "", gross: "", cogs: "", fees: "", expense: (sum("gross") - sum("cogs") - sum("fees") - sum("expense")).toFixed(2) });
  sendCsv(res, `tax-summary-${year}`, csv(lines, [["Date", (l) => l.date], ["Type", (l) => l.type], ["Item", (l) => l.item], ["Where", (l) => l.where], ["Gross sale", (l) => l.gross], ["Cost of card", (l) => l.cogs], ["Fees", (l) => l.fees], ["Expense", (l) => l.expense]]));
});

// ---------------- matching cards to price pages (free) ----------------

const stripGrade = (s) => String(s || "").replace(/\b(PSA|BGS|SGC|CGC|TAG|HGA|Beckett)\s*\d+(\.5)?\b/gi, " ").replace(/\b(RC|rookie|raw|graded|gem mint|mint|card)\b/gi, " ").replace(/[#()\[\],]/g, " ").replace(/\s+/g, " ").trim();
const nameWords = (s) => stripGrade(s).toLowerCase().split(" ").filter((w) => w.length > 1 || /\d/.test(w));
function coverage(name, cand) {
  const hay = ` ${`${cand.name} ${cand.set}`.toLowerCase().replace(/[#\[\]()]/g, " ")} `;
  const ws = nameWords(name);
  return ws.length ? ws.filter((w) => hay.includes(w)).length / ws.length : 0;
}
// Candidates for a card name; `auto` is set only when the top match is clear (all/most words present,
// and the base card wins a tie over a parallel the name didn't mention).
async function findPricePage(name, category) {
  const query = stripGrade(name);
  const candidates = (await pricecharting.search(query, 8, kindOf(category)))
    .map((c) => ({ ...c, coverage: Math.round(coverage(name, c) * 100) / 100 }))
    .sort((a, b) => b.coverage - a.coverage || a.name.length - b.name.length);
  const [top, second] = candidates;
  const auto = top && top.coverage >= 0.8 && (!second || second.coverage < top.coverage || top.name.length < second.name.length) ? top : null;
  return { query, candidates, auto };
}

async function attachPrice(row, url) {
  const data = await pricecharting.card(url);
  const value = pricecharting.valueAtGrade(data, row.grade);
  return store.updateInventory(row.id, { priceUrl: url, value, valuedAt: value != null ? new Date().toISOString() : null, ...(row.category === "other" ? { category: categoryFromUrl(url) } : {}) });
}

app.get("/api/inventory/:id/find-price", async (req, res) => {
  const row = store.inventory().find((r) => r.id === req.params.id);
  if (!row) return res.status(404).json({ error: "not found" });
  try {
    res.json(await findPricePage(row.name, row.category));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/inventory/:id/attach-price", async (req, res) => {
  const row = store.inventory().find((r) => r.id === req.params.id);
  const url = store.clean.url(req.body?.url);
  if (!row || !url) return res.status(400).json({ error: "Need a card and a price page." });
  try {
    const updated = await attachPrice(row, url);
    log(req, `linked ${row.name} to its sales page`);
    res.json(updated);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/inventory/:id/revalue", async (req, res) => {
  const row = store.inventory().find((r) => r.id === req.params.id);
  if (!row?.priceUrl) return res.status(400).json({ error: "This card has no sales page linked yet — use Find price first." });
  try {
    res.json(await attachPrice(row, row.priceUrl));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// Link every unpriced card whose match is clear; the rest are returned for a human to pick.
app.post("/api/inventory/find-prices", async (req, res) => {
  const rows = store.inventory().filter((r) => !r.priceUrl && r.status !== "sold").slice(0, 40);
  const attached = [], review = [];
  for (const row of rows) {
    try {
      const { auto, candidates } = await findPricePage(row.name, row.category);
      if (auto) {
        await attachPrice(row, auto.url);
        attached.push({ id: row.id, name: row.name, matched: `${auto.name} (${auto.set})` });
      } else review.push({ id: row.id, name: row.name, candidates: candidates.slice(0, 5) });
    } catch (err) {
      review.push({ id: row.id, name: row.name, error: err.message, candidates: [] });
    }
  }
  if (attached.length) log(req, `auto-linked ${attached.length} cards to sales pages`);
  res.json({ attached, review, remaining: Math.max(0, store.inventory().filter((r) => !r.priceUrl && r.status !== "sold").length - review.length) });
});

// Lot: a card was misread — re-price it from a corrected name without re-running the AI.
app.post("/api/lot/reprice", async (req, res) => {
  const name = store.clean.str(req.body?.name), grade = store.clean.str(req.body?.grade, 30) || "Raw", category = store.clean.str(req.body?.category, 20) || "other";
  if (!name) return res.status(400).json({ error: "Type the card name." });
  try {
    const { candidates, auto } = await findPricePage(name, category);
    let value = null, url = null, matched = null, volume = null;
    if (auto) {
      const d = await pricecharting.card(auto.url);
      value = pricecharting.valueAtGrade(d, grade);
      url = d.url;
      matched = `${d.title} (${d.set})`;
      volume = Object.values(d.salesVolume || {})[0] || null;
    }
    res.json({ name, grade, category, value, url, matched, volume, candidates: candidates.slice(0, 5), wanted: wantMatches(url, grade, name) });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

// ---------------- want list ----------------

function wantMatches(url, grade, name) {
  const g = String(grade || "Raw").toUpperCase();
  return store.wantlist().filter((w) => {
    const gradeOk = String(w.grade || "Raw").toUpperCase() === g;
    if (url && w.priceUrl) return w.priceUrl === url && gradeOk;
    return Boolean(name) && gradeOk && coverage(w.name, { name, set: "" }) >= 0.8;
  });
}

app.get("/api/wantlist", (_req, res) => res.json(store.wantlist()));
app.post("/api/wantlist", (req, res) => {
  const w = store.addWant({ ...(req.body || {}), addedBy: who(req) });
  log(req, `added ${w.name} (${w.grade}) to the want list${w.maxPrice != null ? ` — max $${w.maxPrice}` : ""}`);
  res.json(w);
});
app.patch("/api/wantlist/:id", (req, res) => {
  const w = store.updateWant(req.params.id, req.body || {});
  w ? res.json(w) : res.status(404).json({ error: "not found" });
});
app.delete("/api/wantlist/:id", (req, res) => okDelete(res, store.deleteWant(req.params.id)));

// ---------------- trade evaluator (free: sold values on both sides) ----------------

app.post("/api/trade", async (req, res) => {
  const side = async (items) => {
    const rows = [];
    for (const it of (Array.isArray(items) ? items : []).slice(0, 25)) {
      const inv = it.inventoryId ? store.inventory().find((r) => r.id === it.inventoryId) : null;
      const url = store.clean.url(it.url || inv?.priceUrl);
      const grade = store.clean.str(it.grade || inv?.grade, 30) || "Raw";
      let value = inv?.value ?? null, name = inv?.name || store.clean.str(it.name);
      if (url) {
        try {
          const d = await pricecharting.card(url);
          value = pricecharting.valueAtGrade(d, grade);
          name = name || `${d.title} (${d.set})`;
        } catch {}
      }
      rows.push({ name, grade, url, value, cost: inv?.cost ?? null });
    }
    return { rows, total: Math.round(rows.reduce((n, r) => n + (r.value || 0), 0) * 100) / 100, unpriced: rows.filter((r) => r.value == null).length };
  };
  const [mine, theirs] = await Promise.all([side(req.body?.mine), side(req.body?.theirs)]);
  res.json({ mine, theirs, diff: Math.round((theirs.total - mine.total) * 100) / 100 });
});

// ---------------- needs attention (deterministic, free) ----------------

app.get("/api/attention", (_req, res) => {
  const days = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 86400000) : null);
  const items = [];
  for (const r of store.inventoryView()) {
    if (r.status === "sold") continue;
    const base = r.listPrice ?? r.value;
    if (r.status === "listed") {
      const d = days(r.listedAt || r.added);
      if (d >= 21 && base) {
        const suggested = Math.round(Math.min(base * 0.93, r.value != null ? r.value * 0.97 : Infinity) * 100) / 100;
        items.push({ type: "stale_listing", id: r.id, name: r.name, grade: r.grade, days: d, current: base, suggested, text: `Listed ${d} days without selling — try ${usdText(suggested)}` });
      }
    } else if (r.status === "in_stock") {
      const d = days(r.purchased ? r.purchased + "T12:00:00" : r.added);
      if (d >= 60 && (r.value ?? r.cost) >= 20) items.push({ type: "unlisted_long", id: r.id, name: r.name, grade: r.grade, days: d, text: `In stock ${d} days and not listed (worth ${usdText(r.value ?? r.cost)})` });
    }
    if (r.value != null && r.cost > 0 && r.value < r.cost * 0.85) items.push({ type: "value_drop", id: r.id, name: r.name, grade: r.grade, pct: Math.round((1 - r.value / r.cost) * 100), text: `Worth ${Math.round((1 - r.value / r.cost) * 100)}% less than you paid (${usdText(r.cost)} → ${usdText(r.value)})` });
  }
  const unpriced = store.inventoryView().filter((r) => !r.priceUrl && r.status !== "sold").length;
  const stale = store.inventoryView().filter((r) => r.priceUrl && r.status !== "sold" && (!r.valuedAt || days(r.valuedAt) > 7)).length;
  res.json({ items: items.slice(0, 30), unpriced, staleValues: stale });
});
const usdText = (n) => (n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { maximumFractionDigits: n < 100 ? 2 : 0 }));

// ---------------- PSA photos ----------------

app.get("/api/psa/images/:n", async (req, res) => {
  try {
    res.json(await psa.images(req.params.n));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------- global search ----------------

app.get("/api/search", (req, res) => {
  const q = String(req.query.q || "").trim().toLowerCase();
  if (q.length < 2) return res.json({ inventory: [], lookups: [], watchlist: [], wantlist: [] });
  const has = (...fields) => fields.some((f) => String(f || "").toLowerCase().includes(q));
  res.json({
    inventory: store.inventoryView().filter((r) => has(r.name, r.sku, r.location, (r.tags || []).join(" "), r.notes)).slice(0, 8).map((r) => ({ id: r.id, name: r.name, grade: r.grade, status: r.status, value: r.value, sku: r.sku })),
    lookups: store.load("lookups", []).filter((r) => has(r.card?.name, r.card?.player_or_character)).slice(0, 8).map((r) => ({ id: r.id, name: r.card?.name, value: r.pricing?.estimated_value_usd, at: r.at })),
    watchlist: store.watchlist().filter((w) => has(w.card?.name)).slice(0, 5).map((w) => ({ id: w.id, name: w.card?.name })),
    wantlist: store.wantlist().filter((w) => has(w.name)).slice(0, 5).map((w) => ({ id: w.id, name: w.name, grade: w.grade, maxPrice: w.maxPrice })),
  });
});

// ---------------- AI inventory advisor ----------------

app.post("/api/advisor", (req, res) => {
  streamJob(req, res, async (send, signal) => {
    const days = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 86400000) : null);
    const inventory = store.inventoryView().filter((r) => r.status !== "sold")
      .sort((a, b) => (b.value ?? b.cost ?? 0) * b.qty - (a.value ?? a.cost ?? 0) * a.qty)
      .map((r) => ({ card: `${r.name} (${r.grade})`, qty: r.qty, paid: r.cost, value: r.value, status: r.status, days_held: days(r.purchased ? r.purchased + "T12:00:00" : r.added), ...(r.status === "listed" ? { listed_on: r.listedOn, list_price: r.listPrice, listed_days: days(r.listedAt || r.added) } : {}) }));
    if (!inventory.length) throw new Error("Add some cards to Inventory first — the advisor works from what you own.");
    const hot = store.load("hot", {});
    const recentSales = store.inventoryView().filter((r) => r.status === "sold").slice(-10).map((r) => ({ card: r.name, paid: r.cost, sold: r.soldPrice, on: r.soldOn, date: r.soldDate }));
    const result = await adviseInventory({ inventory, movers: { week: store.movers(7).slice(0, 10), month: store.movers(30).slice(0, 10) }, hot: hot["all:weekly"] || hot["all:daily"] || null, recentSales }, { onEvent: send, signal });
    const advice = { at: new Date().toISOString(), by: who(req), cards: inventory.length, ...result };
    store.saveAdvice(advice);
    log(req, "asked the advisor for an inventory plan");
    return { advice };
  });
});
app.get("/api/advice", (_req, res) => res.json(store.advice()));

// ---------------- update check (GitHub Releases) ----------------

const REPO = "Jdemasse-Urm/card-research-bot";
let updateCache = null;
const semver = (v) => String(v || "").replace(/^v/, "").split(".").map((n) => parseInt(n, 10) || 0);
const newer = (a, b) => { const x = semver(a), y = semver(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
app.get("/api/update-check", async (req, res) => {
  if (updateCache && !req.query.force && Date.now() - updateCache.at < 6 * 3600000) return res.json(updateCache.value);
  let value;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, { headers: { "user-agent": "card-research-bot", accept: "application/vnd.github+json" }, signal: AbortSignal.timeout(15000) });
    if (r.status === 404) value = { current: VERSION, latest: null, private: true, url: `https://github.com/${REPO}/releases/latest` };
    else if (!r.ok) throw new Error(`GitHub answered ${r.status}`);
    else {
      const j = await r.json();
      value = {
        current: VERSION,
        latest: String(j.tag_name || "").replace(/^v/, ""),
        available: newer(j.tag_name, VERSION),
        url: j.html_url,
        notes: String(j.body || "").slice(0, 2000),
        assets: (j.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size, sha256: /^sha256:[a-f0-9]{64}$/.test(a.digest || "") ? a.digest.slice(7) : null })).filter((a) => /\.(exe|dmg)$/i.test(a.name)),
      };
      if (value.available) {
        try {
          const log = await (await fetch(`https://raw.githubusercontent.com/${REPO}/${encodeURIComponent(j.tag_name)}/CHANGELOG.md`, { signal: AbortSignal.timeout(10000) })).text();
          value.whatsNew = (log.split(/\n(?=## )/).find((sec) => sec.startsWith(`## ${value.latest}`)) || "").slice(0, 4000);
        } catch {
          /* the banner still works without it */
        }
      }
    }
  } catch (err) {
    value = { current: VERSION, latest: null, error: err.message, url: `https://github.com/${REPO}/releases/latest` };
  }
  updateCache = { at: Date.now(), value };
  res.json(value);
});

// ---------------- background: daily re-price, backups, PSA progress, optional morning brief ----------------

let briefRunning = false;
// PSA population watch: each day a batch of your PSA slabs (oldest-checked first — PSA's free API allows about
// 100 calls a day) is re-checked; when the count at your grade grows by 10% (at least 3), one alert.
const certOf = (r) => r.facts?.cert || (r.lookupId ? String(store.getLookup(r.lookupId)?.card?.cert_number || "").replace(/\D/g, "") : "") || String(r.notes || "").match(/\bcert (\d{6,12})/)?.[1] || "";
async function watchPops() {
  if (!psa.hasToken()) return;
  const w = store.popWatch();
  const day = new Date().toLocaleDateString("en-CA");
  if (w._day === day) return;
  const slabs = store.inventoryView().filter((r) => r.status !== "sold" && /^PSA\b/i.test(r.grade) && certOf(r).length >= 6);
  slabs.sort((a, b) => ((w[certOf(a)]?.at || "") < (w[certOf(b)]?.at || "") ? -1 : 1));
  for (const r of slabs.slice(0, 40)) {
    const cert = certOf(r);
    try {
      const c = await psa.cert(cert, { fresh: true });
      if (!c.found || c.population == null) continue;
      const e = w[cert] || { base: c.population, baseAt: day };
      Object.assign(e, { rowId: r.id, name: r.name, grade: r.grade, pop: c.population, higher: c.populationHigher, at: new Date().toISOString() });
      const grew = e.pop - e.base;
      if (grew >= Math.max(3, Math.ceil(e.base * 0.1))) {
        store.addAlert({ kind: "pop", name: r.name, text: `PSA population at ${r.grade} went ${e.base} → ${e.pop} (+${grew}) since ${e.baseAt}. More copies at your grade usually pull the price down — think about selling, or watch its price.` });
        Object.assign(e, { base: e.pop, baseAt: day });
      }
      w[cert] = e;
    } catch (err) {
      if (/limit|token/i.test(err.message)) break; // out of PSA calls for today
    }
  }
  w._day = day;
  store.savePopWatch(w);
}

async function hourly() {
  try {
    store.dailyBackup();
  } catch (err) {
    console.warn("daily backup failed:", err.message);
  }
  for (const w of store.watchlist()) {
    const last = w.snapshots[w.snapshots.length - 1];
    if (last && Date.now() - Date.parse(last.at) < 20 * 3600000) continue;
    try {
      await refreshWatched(w);
    } catch (err) {
      console.warn("watchlist refresh failed for", w.key, err.message);
    }
  }
  const lastPoint = store.portfolio().slice(-1)[0];
  if (!lastPoint || lastPoint.date !== new Date().toISOString().slice(0, 10)) await revalueInventory();
  await refreshSubmissions();
  await watchPops().catch((err) => console.warn("PSA population watch failed:", err.message));
  // Monday morning: last week's report is ready (one alert a week)
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7)).toLocaleDateString("en-CA");
  if (now.getHours() >= 8 && store.load("weekly-state", {}).week !== monday) {
    try {
      const w = weeklyReport();
      store.addAlert({ kind: "weekly", name: "Weekly report", text: `Last week: ${w.sales} cards sold for $${w.revenue} (profit after fees $${w.profit}), ${w.added} added.${w.toDo.unshipped ? ` ${w.toDo.unshipped} orders to ship.` : ""}${w.toDo.lowSupplies.length ? ` Low: ${w.toDo.lowSupplies.join(", ")}.` : ""} Home → 📋 Weekly report.` });
      store.save("weekly-state", { week: monday });
    } catch (err) {
      console.warn("weekly report failed:", err.message);
    }
  }

  // Daily data check: one alert a day when records need attention (duplicate SKUs, sold cards still on the website…).
  const dayNow = new Date().toISOString().slice(0, 10);
  if (store.load("check-state", {}).day !== dayNow) {
    try {
      const c = store.dataCheck();
      const serious = c.issues.filter((i) => ["dupSku", "dupCard", "webSold", "soldNoPrice"].includes(i.type));
      if (serious.length) store.addAlert({ kind: "check", name: "Inventory check", text: serious.map((i) => `${i.count} × ${i.title.toLowerCase()}`).join("; ") + ". Inventory → Data check fixes most of it in one click." });
      store.save("check-state", { day: dayNow, issues: c.issues.length });
    } catch (err) {
      console.warn("data check failed:", err.message);
    }
  }

  // Daily website re-price (the pricing engine), then push the new prices to the MJC site.
  // A run that couldn't read the sold-price feed doesn't count as today's run — try again next hour.
  const lastPricing = store.load("pricing-last-run", null);
  if (!lastPricing || lastPricing.feedDown || lastPricing.at.slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
    try {
      const r = await pricingJob.run();
      if (r.changes?.length) store.logActivity("Pricing engine", `re-priced ${r.changes.length} MJC website cards`);
    } catch (err) {
      console.warn("pricing run failed:", err.message);
    }
  }
  if (mjc.configured()) {
    try {
      await mjc.syncCatalog();
      await pullMjc();
    } catch (err) {
      console.warn("MJC sync failed:", err.message);
    }
  }

  // Morning brief (opt-in): one fresh "hottest cards today" scan per day after the chosen hour.
  const hour = parseInt(process.env.CARD_BOT_BRIEF_HOUR, 10) || 8;
  const today = new Date().toISOString().slice(0, 10);
  const daily = store.load("hot", {})["all:daily"];
  if (process.env.CARD_BOT_DAILY_BRIEF === "1" && hasKey() && !briefRunning && new Date().getHours() >= hour && (!daily || daily.at.slice(0, 10) !== today)) {
    briefRunning = true;
    try {
      const hot = await runHotScan({ category: "all", period: "daily", onEvent: () => {} });
      store.addAlert({ kind: "brief", name: "Morning brief", text: `Today's hottest cards are ready (${hot.cards?.length || 0} cards).` });
    } catch (err) {
      console.warn("morning brief failed:", err.message);
    } finally {
      briefRunning = false;
    }
  }
}
setTimeout(hourly, 10000);
setInterval(hourly, 3600000);

// ---------------- start (tries the next port if 3737 is busy) ----------------

// Resolves with the port once the server is listening (the desktop window waits for this).
let markReady, markFailed;
export const ready = new Promise((resolve, reject) => {
  markReady = resolve;
  markFailed = reject;
});

function start(port, triesLeft) {
  const server = app.listen(port, SHARE ? "0.0.0.0" : "127.0.0.1", () => {
    PORT = port;
    markReady(PORT);
    const url = `http://localhost:${PORT}`;
    console.log(`\n  Card Research Bot ${VERSION} is running → ${url}`);
    if (PORT !== WANT_PORT) console.log(`  (port ${WANT_PORT} was busy — maybe the bot is already open in another window — so using ${PORT})`);
    if (SHARE) console.log(`  Shared on your home network (PIN required): ${lanUrls().join("  ")}`);
    if (process.env.SHARE_ON_NETWORK === "1" && !SHARE) console.log("  Network sharing is ON but no ACCESS_PIN is set — staying local only.");
    if (!DESKTOP) console.log("  (leave this window open; close it to stop the bot)\n");
    if (process.env.NO_BROWSER !== "1" && !DESKTOP) {
      const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
      exec(cmd, () => {});
    }
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE" && triesLeft > 0) start(port + 1, triesLeft - 1);
    else {
      console.error(`Couldn't start the web server: ${err.message}`);
      markFailed(err);
      if (!DESKTOP) process.exit(1);
    }
  });
}
start(WANT_PORT, 10);
