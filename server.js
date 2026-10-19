// Card Research Bot — local web app. Run `npm start`, then open http://localhost:3737
import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { exec } from "node:child_process";

import { hasKey, resetClient, explainError, MODEL } from "./lib/agent.js";
import { cardLookup, hotCards, ask, CATEGORIES, PERIODS } from "./lib/jobs.js";
import * as store from "./lib/store.js";
import * as pricecharting from "./lib/sources/pricecharting.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3737;
const app = express();
app.use(express.json({ limit: "40mb" }));
app.use(express.static(path.join(here, "public")));

// Streams progress lines (NDJSON) while a job runs, then one {type:"done"} or {type:"error"} line.
function streamJob(res, work) {
  res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache");
  const send = (obj) => res.write(JSON.stringify(obj) + "\n");
  const ping = setInterval(() => send({ type: "ping" }), 15000);
  work(send)
    .then((payload) => send({ type: "done", ...payload }))
    .catch((err) => {
      console.error(err);
      send({ type: "error", message: explainError(err) });
    })
    .finally(() => {
      clearInterval(ping);
      res.end();
    });
}

// ---------------- status / settings ----------------

app.get("/api/status", (_req, res) => {
  res.json({ hasKey: hasKey(), model: MODEL, categories: CATEGORIES, periods: Object.keys(PERIODS) });
});

app.post("/api/settings", (req, res) => {
  const key = String(req.body?.apiKey || "").trim();
  if (!/^sk-ant-[\w-]{20,}$/.test(key)) return res.status(400).json({ error: "That doesn't look like an Anthropic API key (it starts with sk-ant-)." });
  const envPath = path.join(here, ".env");
  let env = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  env = env.replace(/^ANTHROPIC_API_KEY=.*$/m, "").trim();
  fs.writeFileSync(envPath, `${env ? env + "\n" : ""}ANTHROPIC_API_KEY=${key}\n`);
  process.env.ANTHROPIC_API_KEY = key;
  resetClient();
  res.json({ ok: true });
});

// ---------------- card lookup ----------------

app.post("/api/lookup", (req, res) => {
  const images = (req.body?.images || [])
    .filter((i) => i && typeof i.data === "string" && /^image\/(jpeg|png|webp|gif)$/.test(i.mediaType))
    .slice(0, 4);
  const text = String(req.body?.text || "").slice(0, 2000);
  if (!images.length && !text.trim()) return res.status(400).json({ error: "Drop a card photo or type a card name." });

  streamJob(res, async (send) => {
    const { result, sources, usage } = await cardLookup({ images, text }, (e) => send(e));
    const report = { id: store.newId(), at: new Date().toISOString(), input: { text, photos: images.length }, ...result, sources, usage };
    store.addLookup(report);
    return { report };
  });
});

// Free, instant price check (no AI): PriceCharting search + first card's sales.
app.get("/api/quick", async (req, res) => {
  try {
    const q = String(req.query.q || "").trim();
    if (!q) return res.status(400).json({ error: "Type a card to search." });
    const results = await pricecharting.search(q, 10);
    const top = results[0] ? await pricecharting.card(results[0].url) : null;
    res.json({ results, top });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/quick/card", async (req, res) => {
  try {
    res.json(await pricecharting.card(String(req.query.url || "")));
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/lookups", (_req, res) => res.json(store.load("lookups", []).slice(0, 100)));

// ---------------- hottest cards ----------------

const HOT_TTL_H = { daily: 4, weekly: 12, monthly: 24 };
const MOVER_DAYS = { daily: 1, weekly: 7, monthly: 30 };

app.get("/api/hot", (req, res) => {
  const key = `${req.query.category}:${req.query.period}`;
  res.json(store.load("hot", {})[key] || null);
});

app.post("/api/hot", (req, res) => {
  const category = String(req.body?.category || "all");
  const period = String(req.body?.period || "weekly");
  if (!CATEGORIES[category] || !PERIODS[period]) return res.status(400).json({ error: "bad category/period" });
  const key = `${category}:${period}`;
  const cached = store.load("hot", {})[key];
  const fresh = cached && Date.now() - Date.parse(cached.at) < HOT_TTL_H[period] * 3600000;

  streamJob(res, async (send) => {
    if (fresh && !req.body?.refresh) return { hot: cached, cached: true };
    const trackedMovers = store.movers(MOVER_DAYS[period]).filter((m) => category === "all" || m.category === category);
    const { result, sources, usage } = await hotCards({ category, period, trackedMovers }, (e) => send(e));
    const hot = { at: new Date().toISOString(), category, period, ...result, trackedMovers, sources, usage };
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
  streamJob(res, async (send) => {
    const { result, sources, usage } = await ask({ question, history }, (e) => send(e));
    return { answer: { ...result, sources, usage } };
  });
});

// ---------------- watchlist ----------------

app.get("/api/watchlist", (_req, res) => {
  res.json({ items: store.watchlist(), movers: { daily: store.movers(1), weekly: store.movers(7), monthly: store.movers(30) } });
});

app.post("/api/watchlist", (req, res) => {
  const report = store.load("lookups", []).find((r) => r.id === req.body?.lookupId);
  if (!report) return res.status(404).json({ error: "lookup not found" });
  res.json(store.addToWatchlist(report));
});

app.delete("/api/watchlist/:id", (req, res) => {
  store.removeFromWatchlist(req.params.id);
  res.json({ ok: true });
});

// Re-price one watched card from PriceCharting (free, no AI) for the grade we are tracking.
async function refreshWatched(w) {
  if (!w.pricechartingUrl) return null;
  const data = await pricecharting.card(w.pricechartingUrl);
  const g = w.card?.grading_company && w.card?.grade ? `${w.card.grading_company} ${w.card.grade}`.toUpperCase() : "UNGRADED";
  const entry = Object.entries(data.priceGuide).find(([k]) => k.toUpperCase() === g)
    || Object.entries(data.priceGuide).find(([k]) => k.toUpperCase() === `GRADE ${String(w.card?.grade || "").toUpperCase()}`)
    || Object.entries(data.priceGuide).find(([k]) => k.toUpperCase() === "UNGRADED");
  const value = entry ? entry[1] : null;
  if (value != null) store.addSnapshot(w.id, value);
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

// Daily automatic re-price while the app is open (snapshots feed the daily/weekly/monthly movers).
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
}
setTimeout(dailyRefresh, 10000);
setInterval(dailyRefresh, 3600000);

// ---------------- start ----------------

app.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  Card Research Bot is running → ${url}\n  (leave this window open; close it to stop the bot)\n`);
  if (process.env.NO_BROWSER !== "1") {
    const cmd = process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});
