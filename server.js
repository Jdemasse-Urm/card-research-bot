// Card Research Bot — local web app. Run `npm start`, then open http://localhost:3737
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

import { hasKey, resetClient, explainError, MODEL, monthlyBudget, FREE_GROUNDED_PER_MONTH } from "./lib/ai.js";
import { cardLookup, hotCards, ask, CATEGORIES, PERIODS } from "./lib/jobs.js";
import * as store from "./lib/store.js";
import * as pricecharting from "./lib/sources/pricecharting.js";
import * as ygoprodeck from "./lib/sources/ygoprodeck.js";
import * as onepiece from "./lib/sources/onepiece.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const ENV_PATH = path.join(here, ".env");
const PORT = Number(process.env.PORT) || 3737;
const SHARE = process.env.SHARE_ON_NETWORK === "1" && Boolean(process.env.ACCESS_PIN);
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "40mb" }));

// ---------------- security ----------------

const isLoopback = (ip) => /^(::1|127\.\d+\.\d+\.\d+|::ffff:127\.\d+\.\d+\.\d+)$/.test(ip || "");

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

app.use((req, res, next) => {
  if (isLoopback(req.socket.remoteAddress) || hasPinCookie(req)) return next();
  if (req.path.startsWith("/api/")) return res.status(401).json({ error: "PIN required" });
  res.sendFile(path.join(here, "public", "pin.html"));
});

app.use(express.static(path.join(here, "public")));

// ---------------- helpers ----------------

// Streams progress lines (NDJSON) while a job runs, then one {type:"done"} or {type:"error"} line.
// Closing the page / pressing Cancel aborts the job so it stops spending.
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
  work(send, ctrl.signal)
    .then((payload) => send({ type: "done", ...payload }))
    .catch((err) => {
      if (!ctrl.signal.aborted) console.error(err);
      send({ type: "error", message: explainError(err) });
    })
    .finally(() => {
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
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => i.address)
    .sort((a, b) => rank(a) - rank(b))
    .map((a) => `http://${a}:${PORT}`);
  // Home Wi-Fi addresses first; VPN/virtual adapters (Tailscale, WSL, Docker) after.
  function rank(a) {
    return a.startsWith("192.168.") ? 0 : a.startsWith("10.") ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(a) ? 2 : 3;
  }
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

// Current value for a grade label like "PSA 10" / "BGS 9.5" / "Raw" from a price page.
async function valueFor(priceUrl, gradeLabel) {
  const data = await pricecharting.card(priceUrl);
  const want = String(gradeLabel || "Raw").toUpperCase().trim();
  const guide = Object.entries(data.priceGuide);
  const find = (label) => guide.find(([k]) => k.toUpperCase() === label)?.[1];
  const num = want.match(/(\d+(\.\d)?)$/)?.[1];
  return find(want) ?? (num ? find(`GRADE ${num}`) : undefined) ?? (/RAW|UNGRADED/.test(want) || !num ? find("UNGRADED") : undefined) ?? null;
}

const gradeOf = (card) => (card?.grading_company && card?.grade ? `${card.grading_company} ${card.grade}` : "Raw");

// ---------------- status / settings ----------------

app.get("/api/status", (req, res) => {
  const local = isLoopback(req.socket.remoteAddress);
  res.json({
    hasKey: hasKey(),
    model: MODEL,
    categories: CATEGORIES,
    periods: Object.keys(PERIODS),
    canEditSettings: local,
    unseenAlerts: store.alerts().filter((a) => !a.seen).length,
  });
});

app.get("/api/settings", (req, res) => {
  const months = store.spendSummary();
  res.json({
    hasKey: hasKey(),
    model: MODEL,
    budget: monthlyBudget(),
    spendThisMonth: store.spendThisMonth(),
    groundedThisMonth: store.groundedThisMonth(),
    freeGrounded: FREE_GROUNDED_PER_MONTH,
    months,
    share: process.env.SHARE_ON_NETWORK === "1",
    shareActive: SHARE,
    pinSet: Boolean(process.env.ACCESS_PIN),
    lanUrls: SHARE ? lanUrls() : [],
    canEditSettings: isLoopback(req.socket.remoteAddress),
  });
});

app.post("/api/settings", (req, res) => {
  // Only the computer running the bot may change keys/sharing.
  if (!isLoopback(req.socket.remoteAddress)) return res.status(403).json({ error: "Settings can only be changed on the computer running the bot." });
  const b = req.body || {};
  const vars = {};
  if (b.apiKey != null && String(b.apiKey).trim()) {
    const key = String(b.apiKey).trim();
    if (!/^[\w-]{30,}$/.test(key)) return res.status(400).json({ error: "That doesn't look like a Gemini API key (it usually starts with AIza)." });
    vars.GEMINI_API_KEY = key;
  }
  if (b.budget !== undefined) {
    const n = parseFloat(b.budget);
    vars.CARD_BOT_MONTHLY_BUDGET = Number.isFinite(n) && n > 0 ? String(n) : null;
  }
  let restart = false;
  if (b.share !== undefined) {
    if (b.share && !/^\d{4,8}$/.test(String(b.pin || process.env.ACCESS_PIN || ""))) return res.status(400).json({ error: "Pick a 4–8 digit PIN for network sharing." });
    vars.SHARE_ON_NETWORK = b.share ? "1" : null;
    if (b.pin) vars.ACCESS_PIN = String(b.pin);
    restart = Boolean(b.share) !== SHARE || Boolean(b.pin);
  }
  setEnv(vars);
  if (vars.GEMINI_API_KEY) resetClient();
  res.json({ ok: true, restartNeeded: restart });
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

// ---------------- card lookup ----------------

app.post("/api/lookup", (req, res) => {
  const images = (req.body?.images || [])
    .filter((i) => i && typeof i.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(i.mediaType))
    .slice(0, 4);
  const text = String(req.body?.text || "").slice(0, 2000);
  const thumb = typeof req.body?.thumb === "string" && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(req.body.thumb) && req.body.thumb.length < 80000 ? req.body.thumb : null;
  if (!images.length && !text.trim()) return res.status(400).json({ error: "Drop a card photo or type a card name." });

  streamJob(req, res, async (send, signal) => {
    const result = await cardLookup({ images, text }, { onEvent: send, signal });
    const report = { id: store.newId(), at: new Date().toISOString(), input: { text, photos: images.length }, thumb, ...result };
    store.addLookup(report);
    return { report };
  });
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

app.get("/api/lookups", (_req, res) => res.json(store.load("lookups", []).slice(0, 300)));
app.delete("/api/lookups/:id", (req, res) => {
  store.deleteLookup(req.params.id);
  res.json({ ok: true });
});

// ---------------- hottest cards ----------------

const HOT_TTL_H = { daily: 4, weekly: 12, monthly: 24 };
const MOVER_DAYS = { daily: 1, weekly: 7, monthly: 30 };

app.get("/api/hot", (req, res) => {
  res.json(store.load("hot", {})[`${req.query.category}:${req.query.period}`] || null);
});

app.post("/api/hot", (req, res) => {
  const category = String(req.body?.category || "all");
  const period = String(req.body?.period || "weekly");
  if (!CATEGORIES[category] || !PERIODS[period]) return res.status(400).json({ error: "bad category/period" });
  const key = `${category}:${period}`;
  const cached = store.load("hot", {})[key];
  const fresh = cached && Date.now() - Date.parse(cached.at) < HOT_TTL_H[period] * 3600000;

  streamJob(req, res, async (send, signal) => {
    if (fresh && !req.body?.refresh) return { hot: cached, cached: true };
    const trackedMovers = store.movers(MOVER_DAYS[period]).filter((m) => category === "all" || m.category === category);
    const result = await hotCards({ category, period, trackedMovers }, { onEvent: send, signal });
    const hot = { at: new Date().toISOString(), category, period, ...result, trackedMovers };
    const all = store.load("hot", {});
    all[key] = hot;
    store.save("hot", all);
    return { hot, cached: false };
  });
});

// ---------------- ask anything ----------------

app.post("/api/ask", (req, res) => {
  const question = String(req.body?.question || "").trim().slice(0, 4000);
  if (!question) return res.status(400).json({ error: "Ask a question." });
  const history = Array.isArray(req.body?.history) ? req.body.history.slice(-4) : [];
  const lookup = req.body?.lookupId ? store.load("lookups", []).find((r) => r.id === req.body.lookupId) : null;
  const cardContext = lookup ? { card: lookup.card, pricing: lookup.pricing, market: lookup.market, grading: lookup.grading, buy_sell: lookup.buy_sell, summary: lookup.summary } : null;
  streamJob(req, res, async (send, signal) => ({ answer: await ask({ question, history, cardContext }, { onEvent: send, signal }) }));
});

// ---------------- watchlist + alerts ----------------

app.get("/api/watchlist", (_req, res) => {
  res.json({ items: store.watchlist(), movers: { daily: store.movers(1), weekly: store.movers(7), monthly: store.movers(30) } });
});

app.post("/api/watchlist", (req, res) => {
  const report = store.load("lookups", []).find((r) => r.id === req.body?.lookupId);
  if (!report) return res.status(404).json({ error: "lookup not found" });
  res.json(store.addToWatchlist(report));
});

app.patch("/api/watchlist/:id", (req, res) => {
  const num = (v) => (v === "" || v == null ? null : Number.isFinite(+v) ? +v : null);
  const w = store.updateWatch(req.params.id, { targetAbove: num(req.body?.targetAbove), targetBelow: num(req.body?.targetBelow) });
  w ? res.json(w) : res.status(404).json({ error: "not found" });
});

app.delete("/api/watchlist/:id", (req, res) => {
  store.removeFromWatchlist(req.params.id);
  res.json({ ok: true });
});

async function refreshWatched(w) {
  if (!w.pricechartingUrl) return null;
  const value = await valueFor(w.pricechartingUrl, gradeOf(w.card));
  if (value == null) return null;
  const prev = [...w.snapshots].reverse().find((s) => s.value != null)?.value ?? null;
  store.addSnapshot(w.id, value);
  const name = w.card?.name || w.key;
  if (w.targetAbove != null && value >= w.targetAbove && (prev == null || prev < w.targetAbove)) {
    store.addAlert({ watchId: w.id, name, kind: "above", target: w.targetAbove, value });
  }
  if (w.targetBelow != null && value <= w.targetBelow && (prev == null || prev > w.targetBelow)) {
    store.addAlert({ watchId: w.id, name, kind: "below", target: w.targetBelow, value });
  }
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
  const lookup = b.lookupId ? store.load("lookups", []).find((r) => r.id === b.lookupId) : null;
  const row = store.addInventory({
    ...b,
    name: b.name || lookup?.card?.name,
    category: b.category || lookup?.card?.category,
    grade: b.grade || (lookup ? gradeOf(lookup.card) : "Raw"),
    priceUrl: b.priceUrl || lookup?.pricing?.pricecharting_url || null,
    value: b.value ?? lookup?.pricing?.estimated_value_usd ?? null,
  });
  res.json(row);
});

app.patch("/api/inventory/:id", (req, res) => {
  const row = store.updateInventory(req.params.id, req.body || {});
  row ? res.json(row) : res.status(404).json({ error: "not found" });
});

app.delete("/api/inventory/:id", (req, res) => {
  store.deleteInventory(req.params.id);
  res.json({ ok: true });
});

app.post("/api/inventory/refresh", async (_req, res) => {
  let updated = 0;
  for (const row of store.inventory()) {
    if (!row.priceUrl || row.status === "sold") continue;
    try {
      const value = await valueFor(row.priceUrl, row.grade);
      if (value != null) {
        store.updateInventory(row.id, { value, valuedAt: new Date().toISOString() });
        updated++;
      }
    } catch {
      /* keep the old value */
    }
  }
  res.json({ updated });
});

// ---------------- export / backup ----------------

app.get("/api/export/inventory.csv", (_req, res) => {
  sendCsv(res, "inventory", csv(store.inventory(), [
    ["Card", (r) => r.name], ["Category", (r) => r.category], ["Grade", (r) => r.grade], ["Qty", (r) => r.qty],
    ["Cost each", (r) => r.cost], ["Value each", (r) => r.value], ["Unrealized P/L", (r) => (r.value != null && r.status !== "sold" ? ((r.value - r.cost) * r.qty).toFixed(2) : "")],
    ["Status", (r) => r.status], ["Sold price", (r) => r.soldPrice], ["Sold date", (r) => r.soldDate],
    ["Realized P/L", (r) => (r.status === "sold" && r.soldPrice != null ? ((r.soldPrice - r.cost) * r.qty).toFixed(2) : "")],
    ["Purchased", (r) => r.purchased], ["Valued at", (r) => r.valuedAt], ["Notes", (r) => r.notes], ["Price page", (r) => r.priceUrl],
  ]));
});

app.get("/api/export/lookups.csv", (_req, res) => {
  sendCsv(res, "card-lookups", csv(store.load("lookups", []), [
    ["Date", (r) => r.at], ["Card", (r) => r.card?.name], ["Category", (r) => r.card?.category], ["Grade", (r) => gradeOf(r.card)],
    ["Est. value", (r) => r.pricing?.estimated_value_usd], ["Low", (r) => r.pricing?.value_range_low], ["High", (r) => r.pricing?.value_range_high],
    ["Verdict", (r) => r.buy_sell?.verdict], ["Max buy", (r) => r.buy_sell?.max_buy_price], ["List at", (r) => r.buy_sell?.list_price],
    ["Grading", (r) => r.grading?.recommendation], ["Demand", (r) => r.market?.demand], ["Summary", (r) => r.summary], ["Price page", (r) => r.pricing?.pricecharting_url],
  ]));
});

app.get("/api/export/watchlist.csv", (_req, res) => {
  sendCsv(res, "watchlist", csv(store.watchlist(), [
    ["Card", (w) => w.card?.name], ["Category", (w) => w.category], ["Grade", (w) => gradeOf(w.card)], ["Added", (w) => w.added],
    ["First value", (w) => w.snapshots.find((s) => s.value != null)?.value], ["Latest value", (w) => [...w.snapshots].reverse().find((s) => s.value != null)?.value],
    ["Alert above", (w) => w.targetAbove], ["Alert below", (w) => w.targetBelow], ["Price page", (w) => w.pricechartingUrl],
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
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ---------------- daily background re-price (watchlist + inventory) ----------------

async function dailyRefresh() {
  for (const w of store.watchlist()) {
    const last = w.snapshots[w.snapshots.length - 1];
    if (last && Date.now() - Date.parse(last.at) < 20 * 3600000) continue;
    try {
      await refreshWatched(w);
    } catch (err) {
      console.warn("watchlist refresh failed for", w.key, err.message);
    }
  }
  for (const row of store.inventory()) {
    if (!row.priceUrl || row.status === "sold" || (row.valuedAt && Date.now() - Date.parse(row.valuedAt) < 20 * 3600000)) continue;
    try {
      const value = await valueFor(row.priceUrl, row.grade);
      if (value != null) store.updateInventory(row.id, { value, valuedAt: new Date().toISOString() });
    } catch {
      /* try again next hour */
    }
  }
}
setTimeout(dailyRefresh, 10000);
setInterval(dailyRefresh, 3600000);

// ---------------- start ----------------

app.listen(PORT, SHARE ? "0.0.0.0" : "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Card Research Bot is running → ${url}`);
  if (SHARE) console.log(`  Shared on your home network (PIN required): ${lanUrls().join("  ")}`);
  if (process.env.SHARE_ON_NETWORK === "1" && !SHARE) console.log("  Network sharing is ON but no ACCESS_PIN is set — staying local only.");
  console.log("  (leave this window open; close it to stop the bot)\n");
  if (process.env.NO_BROWSER !== "1") {
    const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
