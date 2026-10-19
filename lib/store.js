// Tiny JSON-file database in ./data — no install, works the same on Windows and Mac.
//   lookups.json  every card report the bot produced (newest first)
//   watchlist.json cards you are tracking, each with a price snapshot history
//   hot.json      cached "hottest cards" reports per category+period

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  const tmp = file(name) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file(name));
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- lookups ----
export function addLookup(report) {
  const all = load("lookups", []);
  all.unshift(report);
  save("lookups", all.slice(0, 500));
  return report;
}

// ---- watchlist ----
export function watchlist() {
  return load("watchlist", []);
}

export function addToWatchlist(report) {
  const list = watchlist();
  const key = report.card?.search_query || report.card?.name;
  if (list.some((w) => w.key === key)) return list;
  list.push({
    id: newId(),
    key,
    card: report.card,
    category: report.card?.category,
    pricechartingUrl: report.pricing?.pricecharting_url || null,
    added: new Date().toISOString(),
    snapshots: [{ at: new Date().toISOString(), value: report.pricing?.estimated_value_usd ?? null }],
  });
  save("watchlist", list);
  return list;
}

export function removeFromWatchlist(id) {
  save("watchlist", watchlist().filter((w) => w.id !== id));
}

export function addSnapshot(id, value) {
  const list = watchlist();
  const w = list.find((x) => x.id === id);
  if (!w) return;
  w.snapshots.push({ at: new Date().toISOString(), value });
  save("watchlist", list);
}

// % change of each watched card over the last N days, from our own snapshots.
export function movers(days) {
  const cutoff = Date.now() - days * 86400000;
  return watchlist()
    .map((w) => {
      const pts = w.snapshots.filter((s) => s.value != null);
      if (pts.length < 2) return null;
      const last = pts[pts.length - 1];
      let base = pts[0];
      for (const p of pts) if (Date.parse(p.at) <= cutoff) base = p;
      if (base === last || !base.value) return null;
      return { id: w.id, name: w.card?.name, category: w.category, from: base.value, to: last.value, pct: Math.round(((last.value - base.value) / base.value) * 1000) / 10 };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

export function deleteLookup(id) {
  save("lookups", load("lookups", []).filter((r) => r.id !== id));
}

export function updateWatch(id, patch) {
  const list = watchlist();
  const w = list.find((x) => x.id === id);
  if (!w) return null;
  Object.assign(w, patch);
  save("watchlist", list);
  return w;
}

// ---- AI spend (estimated from token usage; $0 on Gemini's free tier) ----
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export function recordSpend(kind, usd, grounded = 0) {
  const s = load("spend", { months: {} });
  const m = (s.months[monthKey()] ||= { total: 0, byKind: {}, jobs: 0, grounded: 0 });
  m.total = Math.round((m.total + usd) * 10000) / 10000;
  m.grounded = (m.grounded || 0) + grounded;
  m.byKind[kind] = Math.round(((m.byKind[kind] || 0) + usd) * 10000) / 10000;
  m.jobs++;
  save("spend", s);
}

export function spendThisMonth() {
  return load("spend", { months: {} }).months[monthKey()]?.total || 0;
}

// Google-Search-grounded requests this month (the first 5,000/month are free).
export function groundedThisMonth() {
  return load("spend", { months: {} }).months[monthKey()]?.grounded || 0;
}

export function spendSummary() {
  return load("spend", { months: {} }).months;
}

// ---- price alerts ----
export function alerts() {
  return load("alerts", []);
}

export function addAlert(a) {
  const list = alerts();
  list.unshift({ id: newId(), at: new Date().toISOString(), seen: false, ...a });
  save("alerts", list.slice(0, 200));
}

export function markAlertsSeen() {
  save("alerts", alerts().map((a) => ({ ...a, seen: true })));
}

// ---- inventory (what you own, what you paid) ----
export function inventory() {
  return load("inventory", []);
}

export function addInventory(item) {
  const list = inventory();
  const row = {
    id: newId(),
    added: new Date().toISOString(),
    name: String(item.name || "Unnamed card").slice(0, 200),
    category: item.category || "other",
    grade: item.grade || "Raw",
    qty: Math.max(1, parseInt(item.qty, 10) || 1),
    cost: Number.isFinite(+item.cost) ? +item.cost : 0,
    purchased: item.purchased || new Date().toISOString().slice(0, 10),
    notes: String(item.notes || "").slice(0, 1000),
    priceUrl: item.priceUrl || null,
    lookupId: item.lookupId || null,
    value: Number.isFinite(+item.value) ? +item.value : null,
    valuedAt: item.value != null ? new Date().toISOString() : null,
    status: "in_stock",
    soldPrice: null,
    soldDate: null,
  };
  list.push(row);
  save("inventory", list);
  return row;
}

const INV_FIELDS = ["name", "category", "grade", "qty", "cost", "purchased", "notes", "value", "valuedAt", "status", "soldPrice", "soldDate", "priceUrl"];
export function updateInventory(id, patch) {
  const list = inventory();
  const row = list.find((x) => x.id === id);
  if (!row) return null;
  for (const k of INV_FIELDS) if (k in patch) row[k] = patch[k];
  save("inventory", list);
  return row;
}

export function deleteInventory(id) {
  save("inventory", inventory().filter((x) => x.id !== id));
}

// ---- backup / restore everything in one file ----
const BACKUP_FILES = ["lookups", "watchlist", "hot", "inventory", "alerts", "spend"];

export function backup() {
  const out = { app: "card-research-bot", version: 1, at: new Date().toISOString() };
  for (const f of BACKUP_FILES) out[f] = load(f, null);
  return out;
}

export function restore(data) {
  if (!data || data.app !== "card-research-bot") throw new Error("That isn't a Card Research Bot backup file.");
  for (const f of BACKUP_FILES) if (data[f] != null) save(f, data[f]);
}
