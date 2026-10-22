// Tiny JSON-file database in ./data — no install, works the same on Windows and Mac.
//   lookups      every AI card report (newest first)        watchlist  tracked cards + price snapshots
//   hot          cached hottest-cards reports              inventory  what you own / sold
//   submissions  grading submissions                       expenses   supplies, shows, shipping...
//   portfolio    daily inventory value snapshots           activity   who did what
//   alerts, spend, idcache, trash (for Undo)
// Saves are atomic (write temp file, then rename) and keep a .bak copy, so a crash or power cut
// mid-save can't wipe your data; a damaged file is recovered from its .bak automatically.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DATA_DIR } from "./env.js";

export { DATA_DIR };
const BACKUP_DIR = path.join(DATA_DIR, "backups");
fs.mkdirSync(BACKUP_DIR, { recursive: true });

const file = (name) => path.join(DATA_DIR, `${name}.json`);

export function load(name, fallback) {
  for (const f of [file(name), file(name) + ".bak"]) {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT" && f === file(name)) console.warn(`data/${name}.json is damaged — trying the backup copy`);
    }
  }
  return fallback;
}

export function save(name, value) {
  const f = file(name);
  const tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  if (fs.existsSync(f)) fs.copyFileSync(f, f + ".bak");
  fs.renameSync(tmp, f);
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const nowIso = () => new Date().toISOString();

// ---- input cleaning (server-side; never trust the browser) ----
export const clean = {
  str: (v, max = 200) => (v == null ? "" : String(v).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max)),
  /** Like str() but keeps line breaks — for paragraphs the website shows (policies, about). */
  text: (v, max = 2000) => (v == null ? "" : String(v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0009\u000b-\u001f]/g, " ").trim().slice(0, max)),
  money: (v) => {
    if (v === "" || v == null) return null;
    const n = parseFloat(String(v).replace(/[$,\s]/g, ""));
    return Number.isFinite(n) && n >= 0 && n < 1e8 ? Math.round(n * 100) / 100 : null;
  },
  int: (v, min = 1, max = 100000) => {
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  },
  date: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : null),
  oneOf: (v, list, dflt) => (list.includes(v) ? v : dflt),
  url: (v) => (/^https:\/\/www\.(pricecharting|sportscardspro)\.com\/game\//.test(String(v || "")) ? String(v) : null),
};

// ---- activity feed (who did what) ----
export function logActivity(who, text) {
  const list = load("activity", []);
  list.unshift({ at: nowIso(), who: clean.str(who, 40) || "Someone", text: clean.str(text, 300) });
  save("activity", list.slice(0, 500));
}
export const activity = (n = 50) => load("activity", []).slice(0, n);

// ---- trash / undo ----
function trash(collection, item) {
  const t = load("trash", []);
  const id = newId();
  t.unshift({ id, at: nowIso(), collection, item });
  save("trash", t.filter((x) => Date.now() - Date.parse(x.at) < 7 * 86400000).slice(0, 200));
  return id;
}

export function undo(trashId) {
  const t = load("trash", []);
  const entry = t.find((x) => x.id === trashId);
  if (!entry) return false;
  const list = load(entry.collection, []);
  if (!list.some((x) => x.id === entry.item.id)) {
    entry.collection === "lookups" ? list.unshift(entry.item) : list.push(entry.item);
    save(entry.collection, list);
  }
  save("trash", t.filter((x) => x.id !== trashId));
  return true;
}

function removeFrom(collection, id) {
  const list = load(collection, []);
  const item = list.find((x) => x.id === id);
  if (!item) return null;
  save(collection, list.filter((x) => x.id !== id));
  return trash(collection, item);
}

// ---- lookups ----
export function addLookup(report) {
  const all = load("lookups", []);
  all.unshift(report);
  save("lookups", all.slice(0, 500));
  return report;
}
export const getLookup = (id) => load("lookups", []).find((r) => r.id === id) || null;
export const deleteLookup = (id) => removeFrom("lookups", id);

// ---- watchlist ----
export const watchlist = () => load("watchlist", []);
const gradeKey = (c) => (c?.grading_company ? `${c.grading_company} ${c.grade}` : "Raw").toUpperCase();

/** entry: { key, card, category, pricechartingUrl, value, addedBy } */
export function addToWatchlist(entry) {
  const list = watchlist();
  const existing = list.find((w) => (entry.pricechartingUrl && w.pricechartingUrl === entry.pricechartingUrl && gradeKey(w.card) === gradeKey(entry.card)) || w.key === entry.key);
  if (existing) return existing;
  const w = {
    id: newId(),
    key: entry.key,
    card: entry.card,
    category: entry.category,
    pricechartingUrl: entry.pricechartingUrl || null,
    added: nowIso(),
    addedBy: entry.addedBy || null,
    snapshots: [{ at: nowIso(), value: entry.value ?? null }],
  };
  list.push(w);
  save("watchlist", list);
  return w;
}

export const removeFromWatchlist = (id) => removeFrom("watchlist", id);

export function updateWatch(id, patch) {
  const list = watchlist();
  const w = list.find((x) => x.id === id);
  if (!w) return null;
  Object.assign(w, patch);
  save("watchlist", list);
  return w;
}

export function addSnapshot(id, value, extra = {}) {
  const list = watchlist();
  const w = list.find((x) => x.id === id);
  if (!w) return;
  w.snapshots.push({ at: nowIso(), value });
  w.snapshots = w.snapshots.slice(-400);
  Object.assign(w, extra);
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

// ---- AI usage: spend per month (estimated from tokens; $0 on Gemini's free tier) + per-day performance ----
const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export function recordJob(kind, usd, grounded = 0, ms = 0) {
  const s = load("spend", { months: {} });
  const m = (s.months[monthKey()] ||= { total: 0, byKind: {}, jobs: 0, grounded: 0 });
  m.total = Math.round((m.total + usd) * 10000) / 10000;
  m.grounded = (m.grounded || 0) + grounded;
  m.byKind[kind] = Math.round(((m.byKind[kind] || 0) + usd) * 10000) / 10000;
  m.jobs++;
  const d = usageDay(s);
  d.jobs++;
  d.jobMs += ms;
  d.slowestJobMs = Math.max(d.slowestJobMs, ms);
  save("spend", s);
}
function usageDay(s, key = dayKey()) {
  const days = (s.days ||= {});
  for (const k of Object.keys(days)) if (k < dayKey(new Date(Date.now() - 14 * 86400000))) delete days[k];
  return (days[key] ||= { calls: 0, failed: 0, timeouts: 0, retries: 0, fallbacks: 0, fast: 0, ms: 0, slowestMs: 0, input: 0, output: 0, jobs: 0, jobMs: 0, slowestJobMs: 0, byModel: {} });
}
/** One Gemini call (success or failure) — the raw material of the AI performance panel. */
export function recordCall({ model, ms = 0, ok, retries = 0, fallback = false, timeout = false, fast = false, input = 0, output = 0 }) {
  const s = load("spend", { months: {} });
  const d = usageDay(s);
  d.calls++;
  if (!ok) d.failed++;
  if (timeout) d.timeouts++;
  if (fallback) d.fallbacks++;
  if (fast) d.fast++;
  d.retries += retries;
  d.ms += ms;
  d.slowestMs = Math.max(d.slowestMs, ms);
  d.input += input;
  d.output += output;
  if (model) d.byModel[model] = (d.byModel[model] || 0) + 1;
  save("spend", s);
}
/** Today and the last 7 days, for Settings → AI performance. */
export function usageStats() {
  const days = load("spend", { months: {} }).days || {};
  const keys = Object.keys(days).sort().slice(-7);
  const sum = keys.reduce((acc, k) => {
    const d = days[k];
    for (const f of ["calls", "failed", "timeouts", "retries", "fallbacks", "fast", "ms", "input", "output", "jobs", "jobMs"]) acc[f] += d[f] || 0;
    acc.slowestMs = Math.max(acc.slowestMs, d.slowestMs || 0);
    acc.slowestJobMs = Math.max(acc.slowestJobMs, d.slowestJobMs || 0);
    for (const [m, n] of Object.entries(d.byModel || {})) acc.byModel[m] = (acc.byModel[m] || 0) + n;
    return acc;
  }, { calls: 0, failed: 0, timeouts: 0, retries: 0, fallbacks: 0, fast: 0, ms: 0, slowestMs: 0, input: 0, output: 0, jobs: 0, jobMs: 0, slowestJobMs: 0, byModel: {} });
  return { today: days[dayKey()] || null, week: { days: keys.length, ...sum } };
}
export const spendThisMonth = () => load("spend", { months: {} }).months[monthKey()]?.total || 0;
// Google-Search-grounded requests this month (the first 5,000/month are free).
export const groundedThisMonth = () => load("spend", { months: {} }).months[monthKey()]?.grounded || 0;
export const spendSummary = () => load("spend", { months: {} }).months;

// ---- price alerts ----
export const alerts = () => load("alerts", []);
export function addAlert(a) {
  const list = alerts();
  list.unshift({ id: newId(), at: nowIso(), seen: false, ...a });
  save("alerts", list.slice(0, 200));
}
export function markAlertsSeen() {
  save("alerts", alerts().map((a) => ({ ...a, seen: true })));
}

// ---- inventory ----
export const STATUSES = ["in_stock", "listed", "grading", "sold"];
export const PLATFORMS = ["eBay", "TCGplayer", "Whatnot", "Facebook", "MJC site", "Card show", "Local / cash", "Other"];
/** How a buyer paid (show mode records it; the tax CSV shows it). */
export const PAYMENTS = ["Cash", "Card", "Venmo", "PayPal", "Cash App", "Zelle", "Trade", "Other"];
export const inventory = () => load("inventory", []);

function nextSku(list) {
  const max = list.reduce((m, r) => Math.max(m, parseInt(String(r.sku || "").replace(/\D/g, ""), 10) || 0), 0);
  return "CRB-" + String(max + 1).padStart(4, "0");
}

function cleanInventory(b, base = {}) {
  const out = {};
  if ("name" in b) out.name = clean.str(b.name) || base.name || "Unnamed card";
  if ("category" in b) out.category = clean.str(b.category, 20) || "other";
  if ("grade" in b) out.grade = clean.str(b.grade, 30) || "Raw";
  if ("qty" in b) out.qty = clean.int(b.qty);
  if ("cost" in b) out.cost = clean.money(b.cost) ?? 0;
  if ("value" in b) out.value = clean.money(b.value);
  if ("purchased" in b) out.purchased = clean.date(b.purchased) || base.purchased || nowIso().slice(0, 10);
  if ("notes" in b) out.notes = clean.str(b.notes, 1000);
  if ("tags" in b) out.tags = (Array.isArray(b.tags) ? b.tags : String(b.tags || "").split(",")).map((t) => clean.str(t, 30)).filter(Boolean).slice(0, 10);
  if ("location" in b) out.location = clean.str(b.location, 80);
  if ("sku" in b) out.sku = clean.str(b.sku, 30);
  if ("priceUrl" in b) out.priceUrl = clean.url(b.priceUrl);
  if ("status" in b) out.status = clean.oneOf(b.status, STATUSES, "in_stock");
  if ("listedOn" in b) out.listedOn = clean.oneOf(b.listedOn, PLATFORMS, null);
  if ("listPrice" in b) out.listPrice = clean.money(b.listPrice);
  if ("soldPrice" in b) out.soldPrice = clean.money(b.soldPrice);
  if ("soldDate" in b) out.soldDate = clean.date(b.soldDate);
  if ("soldOn" in b) out.soldOn = clean.oneOf(b.soldOn, PLATFORMS, null);
  if ("fees" in b) out.fees = clean.money(b.fees);
  if ("payment" in b) out.payment = clean.oneOf(b.payment, PAYMENTS, null);
  if ("valuedAt" in b) out.valuedAt = b.valuedAt || null;
  if ("submissionId" in b) out.submissionId = b.submissionId || null;
  // MJC website listing (prices themselves are set by the pricing engine via setEngineFields)
  if ("web" in b) out.web = b.web === true || b.web === "true" || b.web === "on" || b.web === 1;
  if ("webMode" in b) out.webMode = clean.oneOf(b.webMode, ["auto", "fixed"], "auto");
  if ("webFixedPrice" in b) out.webFixedPrice = clean.money(b.webFixedPrice);
  if ("webDescription" in b) out.webDescription = clean.str(b.webDescription, 3000);
  return out;
}

/** Fields only the app itself writes (pricing engine, photo uploads, store sync) — not user input. */
const ENGINE_FIELDS = ["webPrice", "webMarket", "webMarketPending", "webLiquidity", "webLiqPerDay", "lastPricedAt", "priceLog", "photos", "photoUrls", "thumbUrls", "webListedAt", "webPricingNote"];
export function setEngineFields(id, patch) {
  return setEngineFieldsMany([{ id, ...patch }])[0] || null;
}
/** Several rows in one read + one write (the daily pricing run touches every on-site card). */
export function setEngineFieldsMany(patches) {
  if (!patches.length) return [];
  const list = inventory();
  const byId = new Map(list.map((r) => [r.id, r]));
  const out = [];
  for (const { id, ...patch } of patches) {
    const row = byId.get(id);
    if (!row) continue;
    for (const k of ENGINE_FIELDS) if (k in patch) row[k] = patch[k];
    out.push(row);
  }
  save("inventory", list);
  return out;
}

// ---- pricing engine training data: one observation per on-site card per day; y = sold that day ----
export const pricingObs = () => load("pricing-obs", []);
export function addPricingObs(rows) {
  const day = nowIso().slice(0, 10);
  const list = pricingObs();
  const seen = new Set(list.filter((o) => o.date === day).map((o) => o.id));
  for (const r of rows) if (!seen.has(r.id)) list.push({ date: day, ...r, y: 0 });
  save("pricing-obs", list.slice(-60000));
}
/**
 * A website sale is a "yes" for the price it sold at. If today's listing-day row doesn't exist yet (the
 * daily run hasn't happened), it's created from the sale itself so the model learns the right price.
 */
export function recordSale(id, sale = {}) {
  const list = pricingObs();
  const day = nowIso().slice(0, 10);
  const today = list.find((o) => o.id === id && o.date === day);
  if (today) today.y = 1;
  else if (sale.price > 0 && sale.market > 0) list.push({ date: day, id, ratio: sale.price / sale.market, liq: sale.liq > 0 ? sale.liq : 0.02, market: sale.market, y: 1 });
  else {
    const last = [...list].reverse().find((o) => o.id === id);
    if (last && Date.now() - Date.parse(last.date + "T12:00:00") < 3 * 86400000) last.y = 1;
  }
  save("pricing-obs", list);
}

const NEW_ROW_DEFAULTS = { name: "", category: "other", grade: "Raw", purchased: "", notes: "", location: "" };

function newRow(item, existing) {
  const row = {
    id: newId(),
    added: nowIso(),
    addedBy: clean.str(item.addedBy, 40) || null,
    lookupId: item.lookupId || null,
    status: "in_stock",
    qty: 1,
    cost: 0,
    tags: [],
    ...cleanInventory({ ...NEW_ROW_DEFAULTS, ...item }),
  };
  row.sku = row.sku || nextSku(existing);
  row.valuedAt = row.value != null ? nowIso() : null;
  return row;
}

export function addInventory(item) {
  const list = inventory();
  const row = newRow(item, list);
  list.push(row);
  save("inventory", list);
  return row;
}

export function addInventoryMany(items) {
  const list = inventory();
  const rows = [];
  for (const item of items) rows.push(newRow(item, [...list, ...rows]));
  save("inventory", [...list, ...rows]);
  return rows;
}

export function updateInventory(id, patch) {
  const list = inventory();
  const row = list.find((x) => x.id === id);
  if (!row) return null;
  const wasListed = row.status === "listed";
  Object.assign(row, cleanInventory(patch, row));
  if (row.status === "listed" && !wasListed) row.listedAt = nowIso();
  if (row.status === "sold" && !row.soldDate) row.soldDate = nowIso().slice(0, 10);
  save("inventory", list);
  return row;
}
export const deleteInventory = (id) => removeFrom("inventory", id);

/**
 * Sell some or all units of an inventory row — the ONE place a sale changes stock (the Sold dialog, show
 * mode and website orders all come through here). Selling part of a stack leaves the rest in stock and
 * adds a separate sold row for the units sold, so profit and fees stay per sale.
 * @returns {{ row, soldRow, split, prev }} or null if the row is gone / already sold
 */
export function sellUnits(id, { qty = null, soldPrice, soldOn = null, soldDate = null, fees = undefined, payment = null, note = "" } = {}) {
  const list = inventory();
  const row = list.find((x) => x.id === id);
  if (!row || row.status === "sold") return null;
  const n = Math.min(row.qty, Math.max(1, clean.int(qty ?? row.qty)));
  const sale = cleanInventory({ soldPrice, soldOn, soldDate: soldDate || nowIso().slice(0, 10), ...(fees !== undefined && fees !== "" && fees != null ? { fees } : {}), payment });
  const prev = { status: row.status, qty: row.qty };
  let soldRow;
  if (n < row.qty) {
    row.qty -= n;
    const copies = list.filter((x) => x.sku && row.sku && x.sku.startsWith(`${row.sku}-S`)).length;
    soldRow = { ...row, ...sale, id: newId(), added: nowIso(), qty: n, status: "sold", web: false, sku: row.sku ? `${row.sku}-S${copies + 1}` : row.sku, splitFrom: row.id, notes: [row.notes, note].filter(Boolean).join(" · ") };
    delete soldRow.webPrice;
    list.push(soldRow);
  } else {
    Object.assign(row, sale, { status: "sold", notes: [row.notes, note].filter(Boolean).join(" · ") });
    soldRow = row;
  }
  save("inventory", list);
  return { row, soldRow, split: soldRow !== row, prev };
}

/** Put a sale back (show mode's Undo): the units return to the row they came from. */
export function unsellUnits({ rowId, soldRowId, split, prev }) {
  const list = inventory();
  const row = list.find((x) => x.id === rowId);
  if (!row) return false;
  if (split) {
    const i = list.findIndex((x) => x.id === soldRowId);
    if (i < 0) return false;
    row.qty += list[i].qty;
    list.splice(i, 1);
  } else {
    Object.assign(row, { status: prev?.status || "in_stock", soldPrice: null, soldOn: null, soldDate: null, fees: null, payment: null });
  }
  save("inventory", list);
  return true;
}

/** A card's value from the daily re-value, with a short history (the Stock sparkline and "your movers"). */
export function recordValues(updates) {
  if (!updates.length) return 0;
  const list = inventory();
  const byId = new Map(list.map((r) => [r.id, r]));
  const day = nowIso().slice(0, 10);
  let n = 0;
  for (const { id, value } of updates) {
    const row = byId.get(id);
    if (!row || value == null) continue;
    row.value = value;
    row.valuedAt = nowIso();
    const log = (row.valueLog || []).filter(([d]) => d !== day);
    log.push([day, value]);
    row.valueLog = log.slice(-120);
    n++;
  }
  save("inventory", list);
  return n;
}

/** Biggest value changes in your own stock over `days` (needs the daily value history). */
export function stockMovers(days = 7, n = 5) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const out = [];
  for (const r of inventory()) {
    if (r.status === "sold" || !(r.valueLog?.length > 1)) continue;
    const base = [...r.valueLog].reverse().find(([d]) => d <= since) || r.valueLog[0];
    const last = r.valueLog[r.valueLog.length - 1];
    if (!(base[1] > 0) || base[0] === last[0]) continue;
    const pct = (last[1] - base[1]) / base[1];
    if (Math.abs(pct) < 0.01) continue;
    out.push({ id: r.id, name: r.name, grade: r.grade, from: base[1], to: last[1], pct, dollars: (last[1] - base[1]) * r.qty, since: base[0] });
  }
  const up = out.filter((m) => m.dollars > 0).sort((a, b) => b.dollars - a.dollars).slice(0, n);
  const down = out.filter((m) => m.dollars < 0).sort((a, b) => a.dollars - b.dollars).slice(0, n);
  return { up, down };
}

// ---- show mode: each completed sale (for the day summary and Undo) ----
export const showSales = () => load("show-sales", []);
export function addShowSale(s) {
  const list = showSales();
  const sale = { id: newId(), at: nowIso(), ...s };
  list.unshift(sale);
  save("show-sales", list.slice(0, 2000));
  return sale;
}
export function removeShowSale(id) {
  save("show-sales", showSales().filter((s) => s.id !== id));
}

// ---- want list (cards you're hunting) ----
export const wantlist = () => load("wantlist", []);
export function addWant(b) {
  const list = wantlist();
  const w = {
    id: newId(),
    added: nowIso(),
    name: clean.str(b.name) || "Unnamed card",
    category: clean.str(b.category, 20) || "other",
    grade: clean.str(b.grade, 30) || "Raw",
    maxPrice: clean.money(b.maxPrice),
    priceUrl: clean.url(b.priceUrl),
    notes: clean.str(b.notes, 300),
    addedBy: clean.str(b.addedBy, 40) || null,
  };
  list.unshift(w);
  save("wantlist", list);
  return w;
}
export function updateWant(id, b) {
  const list = wantlist();
  const w = list.find((x) => x.id === id);
  if (!w) return null;
  if ("maxPrice" in b) w.maxPrice = clean.money(b.maxPrice);
  if ("notes" in b) w.notes = clean.str(b.notes, 300);
  if ("grade" in b) w.grade = clean.str(b.grade, 30) || "Raw";
  if ("priceUrl" in b) w.priceUrl = clean.url(b.priceUrl);
  save("wantlist", list);
  return w;
}
export const deleteWant = (id) => removeFrom("wantlist", id);

// ---- last AI inventory advice ----
export const saveAdvice = (a) => save("advice", a);
export const advice = () => load("advice", null);

// ---- grading submissions ----
export const COMPANIES = ["PSA", "BGS", "SGC", "CGC", "TAG", "Other"];
export const submissions = () => load("submissions", []);

export function addSubmission(b) {
  const list = submissions();
  const sub = {
    id: newId(),
    created: nowIso(),
    company: clean.oneOf(b.company, COMPANIES, "PSA"),
    service: clean.str(b.service, 60),
    number: clean.str(b.number, 30),
    sent: clean.date(b.sent) || nowIso().slice(0, 10),
    cost: clean.money(b.cost) ?? 0,
    itemIds: (Array.isArray(b.itemIds) ? b.itemIds : []).map(String).slice(0, 500),
    status: "sent",
    progress: null,
    notes: clean.str(b.notes, 1000),
    returned: null,
    addedBy: clean.str(b.addedBy, 40) || null,
  };
  list.unshift(sub);
  save("submissions", list);
  // Cards in the submission are "at grading" until they come back.
  const inv = inventory();
  for (const r of inv) if (sub.itemIds.includes(r.id)) Object.assign(r, { status: "grading", submissionId: sub.id });
  save("inventory", inv);
  return sub;
}

export function updateSubmission(id, patch) {
  const list = submissions();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  if ("status" in patch) s.status = clean.oneOf(patch.status, ["sent", "received", "grading", "shipped", "complete"], s.status);
  if ("number" in patch) s.number = clean.str(patch.number, 30);
  if ("service" in patch) s.service = clean.str(patch.service, 60);
  if ("cost" in patch) s.cost = clean.money(patch.cost) ?? s.cost;
  if ("notes" in patch) s.notes = clean.str(patch.notes, 1000);
  if ("progress" in patch) s.progress = patch.progress;
  save("submissions", list);
  return s;
}

/** Cards came back: set each card's new grade, add its share of the grading cost to its cost basis. */
export function completeSubmission(id, grades) {
  const list = submissions();
  const s = list.find((x) => x.id === id);
  if (!s) return null;
  const inv = inventory();
  const items = inv.filter((r) => s.itemIds.includes(r.id));
  const units = items.reduce((n, r) => n + (r.qty || 1), 0) || 1;
  const perCard = Math.round(((s.cost || 0) / units) * 100) / 100;
  for (const r of items) {
    const g = clean.str(grades?.[r.id], 30);
    if (g) r.grade = /^\d/.test(g) ? `${s.company} ${g}` : g;
    if (s.status !== "complete") r.cost = Math.round(((r.cost || 0) + perCard) * 100) / 100;
    r.status = "in_stock";
    r.value = null; // re-valued at the new grade on the next refresh
    r.valuedAt = null;
  }
  s.status = "complete";
  s.returned = nowIso().slice(0, 10);
  save("inventory", inv);
  save("submissions", list);
  return s;
}
export const deleteSubmission = (id) => removeFrom("submissions", id);

// ---- expenses ----
export const EXPENSE_KINDS = ["Supplies", "Shipping", "Grading", "Card show / table", "Fees", "Travel", "Software", "Other"];
export const expenses = () => load("expenses", []);
export function addExpense(b) {
  const list = expenses();
  const e = {
    id: newId(),
    date: clean.date(b.date) || nowIso().slice(0, 10),
    kind: clean.oneOf(b.kind, EXPENSE_KINDS, "Other"),
    amount: clean.money(b.amount) ?? 0,
    note: clean.str(b.note, 300),
    addedBy: clean.str(b.addedBy, 40) || null,
    // Read from a receipt photo: its fingerprint, so the same receipt isn't logged twice.
    ...(/^[a-f0-9]{16,64}$/.test(String(b.receiptHash || "")) ? { receiptHash: String(b.receiptHash) } : {}),
  };
  list.unshift(e);
  save("expenses", list);
  return e;
}
export const deleteExpense = (id) => removeFrom("expenses", id);

// ---- portfolio value history (one point per day) ----
export function snapshotPortfolio() {
  const inv = inventory().filter((r) => r.status !== "sold");
  const day = nowIso().slice(0, 10);
  const point = {
    date: day,
    value: Math.round(inv.reduce((n, r) => n + (r.value ?? r.cost ?? 0) * (r.qty || 1), 0) * 100) / 100,
    cost: Math.round(inv.reduce((n, r) => n + (r.cost ?? 0) * (r.qty || 1), 0) * 100) / 100,
    cards: inv.reduce((n, r) => n + (r.qty || 1), 0),
  };
  const list = load("portfolio", []).filter((p) => p.date !== day);
  list.push(point);
  save("portfolio", list.slice(-1500));
  return point;
}
export const portfolio = () => load("portfolio", []);

// ---- photo identification cache (same photo again = no AI call) ----
export function idCacheGet(key) {
  return load("idcache", {})[key]?.value || null;
}
export function idCacheSet(key, value) {
  const c = load("idcache", {});
  c[key] = { at: nowIso(), value };
  const keys = Object.keys(c);
  if (keys.length > 400) for (const k of keys.sort((a, b) => (c[a].at < c[b].at ? -1 : 1)).slice(0, keys.length - 400)) delete c[k];
  save("idcache", c);
}

// ---- backup / restore everything in one file ----
const BACKUP_FILES = ["lookups", "watchlist", "hot", "inventory", "submissions", "expenses", "portfolio", "activity", "alerts", "spend", "wantlist", "advice", "pricing-obs", "pricing-settings", "mjc-store", "mjc-orders", "mjc-tickets", "show-sales"];

export function backup() {
  const out = { app: "card-research-bot", version: 2, at: nowIso() };
  for (const f of BACKUP_FILES) out[f] = load(f, null);
  return out;
}

export function restore(data) {
  if (!data || data.app !== "card-research-bot") throw new Error("That isn't a Card Research Bot backup file.");
  for (const f of BACKUP_FILES) {
    if (data[f] == null) continue;
    const ok = ["hot", "spend", "advice", "pricing-settings", "mjc-store"].includes(f) ? typeof data[f] === "object" && !Array.isArray(data[f]) : Array.isArray(data[f]);
    if (!ok) throw new Error(`Backup file is damaged (${f}).`);
  }
  for (const f of BACKUP_FILES) if (data[f] != null) save(f, data[f]);
}

/**
 * One automatic backup per day in data/backups, keeping the newest 14 — and, when a cloud folder is chosen
 * in Settings (CARD_BOT_BACKUP_DIR: OneDrive, iCloud Drive, Dropbox, Google Drive…), a copy there too, so a
 * dead or stolen computer doesn't take the business records with it. force = back up now even if today's
 * backup exists (Settings → Back up now).
 */
export function dailyBackup({ force = false } = {}) {
  const name = `backup-${nowIso().slice(0, 10)}.json`;
  const target = path.join(BACKUP_DIR, name);
  if (fs.existsSync(target) && !force) return null;
  fs.writeFileSync(target, JSON.stringify(backup()));
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -14);
  for (const f of old) fs.unlinkSync(path.join(BACKUP_DIR, f));
  const state = { lastLocal: nowIso(), lastLocalFile: name, mirror: backupMirrorDir(), lastMirror: load("backup-state", {}).lastMirror || null, mirrorError: null };
  if (state.mirror) {
    try {
      fs.mkdirSync(state.mirror, { recursive: true });
      fs.copyFileSync(target, path.join(state.mirror, name));
      const extra = fs.readdirSync(state.mirror).filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(0, -30);
      for (const f of extra) fs.unlinkSync(path.join(state.mirror, f));
      state.lastMirror = nowIso();
    } catch (err) {
      state.mirrorError = err.message;
    }
  }
  save("backup-state", state);
  return name;
}
/** The cloud folder backups are copied into (a "Card Research Bot backups" folder inside it), or null. */
export const backupMirrorDir = () => (process.env.CARD_BOT_BACKUP_DIR ? path.join(process.env.CARD_BOT_BACKUP_DIR, "Card Research Bot backups") : null);
/** When the last backup ran (and its cloud copy). Older installs have no record yet: read it off the newest backup file. */
export function backupState() {
  const st = load("backup-state", {});
  if (!st.lastLocal) {
    try {
      const newest = fs.readdirSync(BACKUP_DIR).filter((f) => /^backup-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().at(-1);
      if (newest) Object.assign(st, { lastLocal: fs.statSync(path.join(BACKUP_DIR, newest)).mtime.toISOString(), lastLocalFile: newest });
    } catch { /* no backups yet */ }
  }
  return st;
}

/** Cloud-synced folders on this computer that could hold a copy of the backups. */
export function cloudFolders() {
  const home = os.homedir();
  const out = [];
  const add = (label, dir) => {
    try {
      if (dir && fs.statSync(dir).isDirectory() && !out.some((o) => o.dir === dir)) out.push({ label, dir });
    } catch { /* not on this computer */ }
  };
  add("OneDrive", process.env.OneDrive);
  add("OneDrive (personal)", process.env.OneDriveConsumer);
  add("OneDrive (work)", process.env.OneDriveCommercial);
  add("iCloud Drive", path.join(home, "Library", "Mobile Documents", "com~apple~CloudDocs"));
  add("iCloud Drive", path.join(home, "iCloudDrive"));
  add("Dropbox", path.join(home, "Dropbox"));
  add("Google Drive", path.join(home, "Google Drive"));
  add("Google Drive", "G:\\My Drive");
  try {
    const cs = path.join(home, "Library", "CloudStorage");
    for (const d of fs.readdirSync(cs)) add(d.replace(/-.*/, "").replace(/([a-z])([A-Z])/g, "$1 $2"), path.join(cs, d));
  } catch { /* not a Mac, or none */ }
  return out;
}
