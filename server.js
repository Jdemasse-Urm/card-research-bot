// Card Research Bot — the app's local web server. The desktop app (electron/main.js) runs it inside its
// window; developers can also run `npm start` and open http://localhost:3737 in a browser.
import { APP_DIR, ENV_PATH, HOME } from "./lib/env.js"; // first: loads settings for everything else
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { exec, execFile } from "node:child_process";

import { hasKey, resetClient, explainError, MODEL, FALLBACK_MODEL, monthlyBudget, FREE_GROUNDED_PER_MONTH } from "./lib/ai.js";
import { cardLookup, hotCards, ask, lotLookup, writeListing, slabCheck, adviseInventory, CATEGORIES, PERIODS, kindOf } from "./lib/jobs.js";
import { runSelfTest } from "./lib/selftest.js";
import * as store from "./lib/store.js";
import * as pricecharting from "./lib/sources/pricecharting.js";
import * as ygoprodeck from "./lib/sources/ygoprodeck.js";
import * as onepiece from "./lib/sources/onepiece.js";
import * as psa from "./lib/sources/psa.js";
import * as ebay from "./lib/sources/ebay.js";

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

const pinFails = new Map(); // ip -> { n, until }
app.post("/api/login", (req, res) => {
  const ip = req.socket.remoteAddress;
  const f = pinFails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) return res.status(429).json({ error: "Too many wrong PINs — wait 10 minutes." });
  const ok = SHARE && String(req.body?.pin || "") === process.env.ACCESS_PIN;
  if (!ok) {
    f.n++;
    if (f.n >= 10) Object.assign(f, { n: 0, until: Date.now() + 600000 });
    pinFails.set(ip, f);
    return res.status(401).json({ error: "Wrong PIN" });
  }
  pinFails.delete(ip);
  res.setHeader("Set-Cookie", `${PIN_COOKIE}=${pinToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=31536000`);
  res.json({ ok: true });
});

const PUBLIC_WITHOUT_PIN = new Set(["/pin.js", "/manifest.webmanifest", "/icon.svg", "/icon-192.png", "/apple-touch-icon.png"]);
app.use((req, res, next) => {
  if (isLoopback(req.socket.remoteAddress) || hasPinCookie(req) || PUBLIC_WITHOUT_PIN.has(req.path)) return next();
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
    share: process.env.SHARE_ON_NETWORK === "1",
    shareActive: SHARE,
    pinSet: Boolean(process.env.ACCESS_PIN),
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
    owned: url ? store.inventory().filter((r) => r.priceUrl === url && r.status !== "sold") : [],
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

app.get("/api/inventory", (_req, res) => res.json(store.inventory()));

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
  res.json(row);
});

app.patch("/api/inventory/:id", (req, res) => {
  const before = store.inventory().find((r) => r.id === req.params.id);
  const row = store.updateInventory(req.params.id, req.body || {});
  if (!row) return res.status(404).json({ error: "not found" });
  if (before && before.status !== "sold" && row.status === "sold") log(req, `sold ${row.name} for $${row.soldPrice ?? "?"}${row.soldOn ? " on " + row.soldOn : ""}`);
  else if (before && before.status !== row.status) log(req, `marked ${row.name} as ${row.status.replace("_", " ")}`);
  res.json(row);
});

app.delete("/api/inventory/:id", (req, res) => okDelete(res, store.deleteInventory(req.params.id)));

async function revalueInventory() {
  let updated = 0;
  for (const row of store.inventory()) {
    if (!row.priceUrl || row.status === "sold") continue;
    try {
      const value = pricecharting.valueAtGrade(await pricecharting.card(row.priceUrl), row.grade);
      if (value != null) {
        store.updateInventory(row.id, { value, valuedAt: new Date().toISOString() });
        updated++;
      }
    } catch {
      /* keep the old value */
    }
  }
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

// Approximate seller fees when a sale didn't record its own (same table as the profit calculator).
const FEE_PCT = { eBay: [13.25, 0.4], TCGplayer: [13.25, 0.3], Whatnot: [10.9, 0.3], Facebook: [0, 0], "Card show": [0, 0], "Local / cash": [0, 0], Other: [0, 0] };
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
  });
});

// ---------------- dashboard + activity ----------------

app.get("/api/dashboard", (_req, res) => {
  const inv = store.inventory();
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
  });
});

app.get("/api/activity", (_req, res) => res.json(store.activity(100)));

// ---------------- export / backup ----------------

app.get("/api/export/inventory.csv", (_req, res) => {
  sendCsv(res, "inventory", csv(store.inventory(), [
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
  sendCsv(res, "sales", csv(store.inventory().filter((r) => r.status === "sold"), [
    ["Sold date", (r) => r.soldDate], ["Card", (r) => r.name], ["Grade", (r) => r.grade], ["Qty", (r) => r.qty], ["Sold on", (r) => r.soldOn], ["Sold price each", (r) => r.soldPrice],
    ["Cost each", (r) => r.cost], ["Fees", (r) => feeFor(r)], ["Profit", (r) => ((r.soldPrice - r.cost) * r.qty - feeFor(r)).toFixed(2)], ["Purchased", (r) => r.purchased], ["SKU", (r) => r.sku],
  ]));
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
  const sold = store.inventory().filter((r) => r.status === "sold" && r.soldPrice != null && (r.soldDate || r.added).startsWith(year));
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

// Duplicate check for hand-added cards: same name + grade already in stock?
app.get("/api/inventory/duplicate", (req, res) => {
  const name = stripGrade(req.query.name).toLowerCase(), grade = String(req.query.grade || "Raw").toUpperCase();
  const hit = name && store.inventory().find((r) => r.status !== "sold" && stripGrade(r.name).toLowerCase() === name && String(r.grade).toUpperCase() === grade);
  res.json(hit || null);
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
  for (const r of store.inventory()) {
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
  const unpriced = store.inventory().filter((r) => !r.priceUrl && r.status !== "sold").length;
  const stale = store.inventory().filter((r) => r.priceUrl && r.status !== "sold" && (!r.valuedAt || days(r.valuedAt) > 7)).length;
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
    inventory: store.inventory().filter((r) => has(r.name, r.sku, r.location, (r.tags || []).join(" "), r.notes)).slice(0, 8).map((r) => ({ id: r.id, name: r.name, grade: r.grade, status: r.status, value: r.value, sku: r.sku })),
    lookups: store.load("lookups", []).filter((r) => has(r.card?.name, r.card?.player_or_character)).slice(0, 8).map((r) => ({ id: r.id, name: r.card?.name, value: r.pricing?.estimated_value_usd, at: r.at })),
    watchlist: store.watchlist().filter((w) => has(w.card?.name)).slice(0, 5).map((w) => ({ id: w.id, name: w.card?.name })),
    wantlist: store.wantlist().filter((w) => has(w.name)).slice(0, 5).map((w) => ({ id: w.id, name: w.name, grade: w.grade, maxPrice: w.maxPrice })),
  });
});

// ---------------- AI inventory advisor ----------------

app.post("/api/advisor", (req, res) => {
  streamJob(req, res, async (send, signal) => {
    const days = (iso) => (iso ? Math.round((Date.now() - Date.parse(iso)) / 86400000) : null);
    const inventory = store.inventory().filter((r) => r.status !== "sold")
      .sort((a, b) => (b.value ?? b.cost ?? 0) * b.qty - (a.value ?? a.cost ?? 0) * a.qty)
      .map((r) => ({ card: `${r.name} (${r.grade})`, qty: r.qty, paid: r.cost, value: r.value, status: r.status, days_held: days(r.purchased ? r.purchased + "T12:00:00" : r.added), ...(r.status === "listed" ? { listed_on: r.listedOn, list_price: r.listPrice, listed_days: days(r.listedAt || r.added) } : {}) }));
    if (!inventory.length) throw new Error("Add some cards to Inventory first — the advisor works from what you own.");
    const hot = store.load("hot", {});
    const recentSales = store.inventory().filter((r) => r.status === "sold").slice(-10).map((r) => ({ card: r.name, paid: r.cost, sold: r.soldPrice, on: r.soldOn, date: r.soldDate }));
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
        assets: (j.assets || []).map((a) => ({ name: a.name, url: a.browser_download_url, size: a.size })).filter((a) => /\.(exe|dmg)$/i.test(a.name)),
      };
    }
  } catch (err) {
    value = { current: VERSION, latest: null, error: err.message, url: `https://github.com/${REPO}/releases/latest` };
  }
  updateCache = { at: Date.now(), value };
  res.json(value);
});

// ---------------- background: daily re-price, backups, PSA progress, optional morning brief ----------------

let briefRunning = false;
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
