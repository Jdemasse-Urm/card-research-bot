// Tiny JSON-file database in ./data — no install, works the same on Windows and Mac.
//   lookups      every AI card report (newest first)        watchlist  tracked cards + price snapshots
//   hot          cached hottest-cards reports              inventory  what you own / sold
//   submissions  grading submissions                       expenses   supplies, shows, shipping...
//   portfolio    daily inventory value snapshots           activity   who did what
//   alerts, spend, idcache, trash (for Undo)
//   inventory-history   per card: value history, website price changes, edits (kept out of the rows so the
//                       inventory itself stays small — at 10,000 cards it was 104 MB with them inside)
// Saves are atomic (write temp file, then rename) and keep a .bak copy, so a crash or power cut
// mid-save can't wipe your data; a damaged file is recovered from its .bak automatically.
// Files are written compact (no indentation): pretty-printing doubled the size of every big file.

import fs from "node:fs";
import os from "node:os";
import crypto from "node:crypto";
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
  fs.writeFileSync(tmp, JSON.stringify(value));
  if (fs.existsSync(f)) fs.copyFileSync(f, f + ".bak");
  fs.renameSync(tmp, f);
  cache.delete(name);
}

/**
 * The parsed file for READ-ONLY callers on hot paths (the Stock list, Home, search): parsed once and
 * re-read only when the file changes. Never mutate what this returns — writers use load() + save().
 */
const cache = new Map(); // name -> { mtimeMs, size, value }
export function peek(name, fallback) {
  let st;
  try {
    st = fs.statSync(file(name));
  } catch {
    return load(name, fallback);
  }
  const c = cache.get(name);
  if (c && c.mtimeMs === st.mtimeMs && c.size === st.size) return c.value;
  const value = load(name, fallback);
  cache.set(name, { mtimeMs: st.mtimeMs, size: st.size, value });
  return value;
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
export const PAYMENTS = ["Cash", "Card", "Venmo", "PayPal", "Cash App", "Zelle", "Trade", "Store credit", "Other"];
export function inventory() {
  const list = load("inventory", []);
  // One-time move of the histories that used to live inside each row (see inventory-history above).
  if (list.some((r) => r.valueLog || r.priceLog)) migrateHistories(list);
  return list;
}
/** Read-only inventory for hot paths (see peek). */
let viewChecked = null;
export function inventoryView() {
  const list = peek("inventory", []);
  if (list === viewChecked) return list;
  // a file from before the history split: migrate it once (inventory() does), then serve the slim rows
  if (list.some((r) => r.valueLog || r.priceLog)) return (inventory(), peek("inventory", []));
  return (viewChecked = list);
}

const skuNumber = (r) => parseInt(String(r.sku || "").replace(/\D/g, ""), 10) || 0;
function nextSku(list) {
  const max = list.reduce((m, r) => Math.max(m, skuNumber(r)), 0);
  return "CRB-" + String(max + 1).padStart(4, "0");
}

// ---- per-card history, kept out of the rows so the inventory file stays small ----
// Two files, split by who writes them: values (v) and website price changes (p) are written by the daily
// jobs and are big; edits (c) are written on every save, so they live in their own small file — an edit
// must never rewrite months of price history.
export const history = () => load("inventory-history", {});
export const historyView = () => peek("inventory-history", {});
export const saveHistory = (h) => save("inventory-history", h);
const changes = () => load("inventory-changes", {});
const saveChanges = (c) => save("inventory-changes", c);
function migrateHistories(list) {
  const h = history();
  for (const r of list) {
    if (!r.valueLog && !r.priceLog) continue;
    const e = (h[r.id] ||= {});
    if (r.valueLog) e.v = [...(e.v || []), ...r.valueLog].slice(-120);
    if (r.priceLog) e.p = [...(e.p || []), ...r.priceLog].slice(-60);
    delete r.valueLog;
    delete r.priceLog;
  }
  saveHistory(h);
  save("inventory", list);
}
/** One card's history (the editor shows it). */
export const cardHistory = (id) => ({ v: historyView()[id]?.v || [], p: historyView()[id]?.p || [], c: peek("inventory-changes", {})[id] || [] });
const USER_FIELDS = ["name", "category", "grade", "qty", "cost", "value", "purchased", "notes", "tags", "location", "sku", "priceUrl", "status", "listedOn", "listPrice", "soldPrice", "soldDate", "soldOn", "fees", "payment", "web", "webMode", "webFixedPrice", "facts", "condition", "kind", "upc", "sealedType", "consignorId", "consignPct", "consignFloor", "webGoLiveAt"];
function recordChanges(h, id, before, after, by) {
  const f = {};
  for (const k of USER_FIELDS) if (k in after && JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)) f[k] = [before[k] ?? null, after[k] ?? null];
  if (!Object.keys(f).length) return;
  h[id] = [...(h[id] || []), { at: nowIso(), by: by || null, f }].slice(-30);
}

// ---- what a card is, and its condition (kept on the row; the website shows both) ----
/** One condition scale for every raw card — the one buyers know from TCGplayer and eBay. */
export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"];
export const CONDITION_LABEL = { NM: "Near Mint", LP: "Lightly Played", MP: "Moderately Played", HP: "Heavily Played", DMG: "Damaged" };
/** What each condition means — the editor and the website both show it. */
export const CONDITION_HELP = {
  NM: "Looks fresh from the pack: sharp corners, clean edges and surface. Slight off-centering is allowed.",
  LP: "Minor wear on a corner or edge, or light surface scuffs you notice up close.",
  MP: "Clear wear on corners and edges, light creases or scratches.",
  HP: "Heavy wear, creases or surface damage.",
  DMG: "Tears, big creases, water damage, writing or missing pieces.",
};
const WEAR = ["Sharp", "Light wear", "Wear", "Damaged"];
const SURFACE = ["Clean", "Light scratches", "Scratches or print lines", "Damaged"];
export const CONDITION_PARTS = { corners: WEAR, edges: WEAR, surface: SURFACE };
export const SEALED_TYPES = ["Hobby box", "Jumbo / HTA box", "Blaster box", "Mega box", "Hanger / cello", "Retail box", "Booster box", "Elite Trainer Box", "Case", "Pack", "Starter deck", "Other"];
const yes = (v) => v === true || v === "true" || v === "on" || v === 1;
function cleanFacts(f) {
  if (!f || typeof f !== "object") return null;
  const s = (k, n = 80) => clean.str(f[k], n);
  const out = { year: s("year", 12), set: s("set"), player: s("player"), number: s("number", 30).replace(/^#/, ""), parallel: s("parallel"), serial: s("serial", 20), team: s("team", 60), rookie: yes(f.rookie), auto: yes(f.auto), relic: yes(f.relic), cert: String(f.cert || "").replace(/\D/g, "").slice(0, 12), certVerified: yes(f.certVerified) };
  return Object.values(out).some(Boolean) ? out : null;
}
const CONDITION_KEYS = ["scale", "centering", "corners", "edges", "surface", "notes"];
function cleanCondition(c, before = null) {
  if (!c || typeof c !== "object") return null;
  const out = { scale: clean.oneOf(c.scale, CONDITIONS, ""), centering: clean.str(c.centering, 40), corners: clean.oneOf(c.corners, WEAR, ""), edges: clean.oneOf(c.edges, WEAR, ""), surface: clean.oneOf(c.surface, SURFACE, ""), notes: clean.str(c.notes, 300) };
  if (!CONDITION_KEYS.some((k) => out[k])) return null;
  out.at = before && CONDITION_KEYS.every((k) => (before[k] || "") === out[k]) ? before.at : nowIso().slice(0, 10);
  return out;
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
  if ("facts" in b) out.facts = cleanFacts(b.facts);
  if ("condition" in b) out.condition = cleanCondition(b.condition, base.condition);
  // sealed product (boxes, packs): a UPC to scan, and what kind of box it is
  if ("kind" in b) out.kind = clean.oneOf(b.kind, ["card", "sealed"], "card");
  if ("upc" in b) out.upc = String(b.upc || "").replace(/\D/g, "").slice(0, 14);
  if ("sealedType" in b) out.sealedType = clean.oneOf(b.sealedType, SEALED_TYPES, "");
  // consigned: someone else's card we sell for a commission (consignPct %), never under their minimum
  if ("consignorId" in b) out.consignorId = clean.str(b.consignorId, 30) || null;
  if ("consignPct" in b) out.consignPct = b.consignPct === "" || b.consignPct == null ? null : Math.min(60, Math.max(0, Math.round(parseFloat(b.consignPct) * 10) / 10 || 0));
  if ("consignFloor" in b) out.consignFloor = clean.money(b.consignFloor);
  // a scheduled drop: the website shows the card from this moment (blank = right away)
  if ("webGoLiveAt" in b) out.webGoLiveAt = b.webGoLiveAt && Number.isFinite(Date.parse(b.webGoLiveAt)) ? new Date(b.webGoLiveAt).toISOString() : null;
  return out;
}

/** Fields only the app itself writes (pricing engine, photo uploads, store sync) — not user input. */
const ENGINE_FIELDS = ["webPrice", "webMarket", "webMarketPending", "webLiquidity", "webLiqPerDay", "lastPricedAt", "priceLog", "photos", "photoUrls", "thumbUrls", "webListedAt", "webPricingNote", "video", "videoUrl"];
export function setEngineFields(id, patch) {
  return setEngineFieldsMany([{ id, ...patch }])[0] || null;
}
/** Several rows in one read + one write (the daily pricing run touches every on-site card). */
export function setEngineFieldsMany(patches) {
  if (!patches.length) return [];
  const list = inventory();
  const byId = new Map(list.map((r) => [r.id, r]));
  const out = [];
  let h = null;
  for (const { id, ...patch } of patches) {
    const row = byId.get(id);
    if (!row) continue;
    for (const k of ENGINE_FIELDS) if (k in patch && k !== "priceLog") row[k] = patch[k];
    if (Array.isArray(patch.priceLog)) ((h ||= history())[id] ||= {}).p = patch.priceLog.slice(-60);
    out.push(row);
  }
  save("inventory", list);
  if (h) saveHistory(h);
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

function newRow(item, existing, skuFor = null) {
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
  row.sku = row.sku || (skuFor ? skuFor() : nextSku(existing));
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
  let n = list.reduce((m, r) => Math.max(m, skuNumber(r)), 0);
  const rows = items.map((item) => newRow(item, null, () => "CRB-" + String(++n).padStart(4, "0")));
  list.push(...rows);
  save("inventory", list);
  return rows;
}

export function updateInventory(id, patch, by = null) {
  const list = inventory();
  const row = list.find((x) => x.id === id);
  if (!row) return null;
  const before = { ...row };
  const wasListed = row.status === "listed";
  Object.assign(row, cleanInventory(patch, row));
  if (row.status === "listed" && !wasListed) row.listedAt = nowIso();
  if (row.status === "sold" && !row.soldDate) row.soldDate = nowIso().slice(0, 10);
  save("inventory", list);
  const h = changes();
  recordChanges(h, id, before, row, by);
  saveChanges(h);
  return row;
}

/**
 * The same change to many cards in one write (Bulk edit, moving a box, the stock count). Returns an undo
 * token: the fields as they were, kept for a week.
 */
export function updateMany(ids, patch, by = null) {
  const list = inventory();
  const h = changes();
  const want = new Set(ids);
  const fields = cleanInventory(patch);
  // addTags adds to a card's tags instead of replacing them
  const addTags = Array.isArray(patch.addTags) ? patch.addTags.map((t) => clean.str(t, 30)).filter(Boolean) : [];
  const undo = [];
  for (const row of list) {
    if (!want.has(row.id)) continue;
    const before = { ...row };
    const next = { ...fields };
    if (addTags.length) next.tags = [...new Set([...(row.tags || []), ...addTags])].slice(0, 10);
    if (CONDITIONS.includes(patch.conditionScale)) next.condition = cleanCondition({ ...(row.condition || {}), scale: patch.conditionScale }, row.condition);
    if (!Object.keys(next).length) continue;
    undo.push({ id: row.id, before: Object.fromEntries(Object.keys(next).map((k) => [k, row[k] ?? null])) });
    Object.assign(row, next);
    if (next.status === "listed" && before.status !== "listed") row.listedAt = nowIso();
    recordChanges(h, row.id, before, row, by);
  }
  save("inventory", list);
  saveChanges(h);
  return { updated: undo.length, token: undo.length ? saveUndo({ kind: "bulk", rows: undo }) : null };
}

/** A different change per card, in one write (e.g. a lot's cost split across its cards). Undoable like updateMany. */
export function updateEach(patches, by = null) {
  const list = inventory();
  const h = changes();
  const byId = new Map(list.map((r) => [r.id, r]));
  const undo = [];
  for (const { id, ...patch } of patches) {
    const row = byId.get(id);
    if (!row) continue;
    const next = cleanInventory(patch, row);
    if (!Object.keys(next).length) continue;
    const before = { ...row };
    undo.push({ id, before: Object.fromEntries(Object.keys(next).map((k) => [k, row[k] ?? null])) });
    Object.assign(row, next);
    recordChanges(h, id, before, row, by);
  }
  save("inventory", list);
  saveChanges(h);
  return { updated: undo.length, token: undo.length ? saveUndo({ kind: "each", rows: undo }) : null };
}

/** Problems in the records, each with what can be done about it (Inventory → Data check; daily alert). */
export function dataCheck() {
  const inv = inventory();
  const h = historyView();
  const subs = submissions();
  const live = inv.filter((r) => r.status !== "sold");
  const issues = [];
  const add = (type, title, rows, fix = null, extra = {}) => rows.length && issues.push({ type, title, count: rows.length, fix, rows: rows.slice(0, 200).map((r) => ({ id: r.id, name: r.name, grade: r.grade, sku: r.sku, location: r.location || "", status: r.status, ...(r._note ? { note: r._note } : {}) })), ...extra });
  // 1. the same SKU on two cards (labels and scanning would find the wrong one)
  const bySku = new Map();
  for (const r of inv) if (r.sku) bySku.set(r.sku.toLowerCase(), [...(bySku.get(r.sku.toLowerCase()) || []), r]);
  add("dupSku", "The same SKU on more than one card", [...bySku.values()].filter((g) => g.length > 1).flatMap((g) => g.slice(1)), "Give them new SKUs");
  // 2. the same card on several in-stock rows
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const groups = new Map();
  for (const r of live) {
    const k = `${norm(r.name)}|${norm(r.grade)}|${r.status}`;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  const dupGroups = [...groups.values()].filter((g) => g.length > 1);
  if (dupGroups.length) issues.push({ type: "dupCard", title: "The same card on more than one row (merge them into one with the total quantity)", count: dupGroups.length, fix: "Merge", groups: dupGroups.slice(0, 100).map((g) => g.map((r) => ({ id: r.id, name: r.name, grade: r.grade, sku: r.sku, qty: r.qty, cost: r.cost, location: r.location || "" }))) });
  // 3. on the website but already sold
  add("webSold", "Sold cards still switched on for the website", inv.filter((r) => r.web && r.status === "sold"), "Switch them off");
  // 4. sold without a sold price (profit and taxes can't be right)
  add("soldNoPrice", "Sold, but no sold price recorded", inv.filter((r) => r.status === "sold" && r.soldPrice == null));
  // 5. listed with no list price
  add("listedNoPrice", "Listed, but no list price", live.filter((r) => r.status === "listed" && r.listPrice == null));
  // 6. at grading but not on a submission
  const onSub = new Set(subs.flatMap((s) => s.itemIds || []));
  add("gradingNoSub", "Marked \"at grading\" but not on any submission", live.filter((r) => r.status === "grading" && !onSub.has(r.id)));
  // 7. cost looks like a typo (5× its value or more)
  add("costTypo", "Cost is 5× the value or more — a typo?", live.filter((r) => r.value > 0 && r.cost >= r.value * 5 && r.cost > 20).map((r) => ({ ...r, _note: `paid ${r.cost}, worth ${r.value}` })));
  // 8. website cards without photos (they show "Photo coming soon")
  add("webNoPhoto", "On the website without a photo", live.filter((r) => r.web && !(r.photos || []).length));
  // 9. no sales page — never valued
  add("noPriceUrl", "No sales page linked, so the card is never valued", live.filter((r) => !r.priceUrl), "Find prices");
  // 10. history kept for cards that no longer exist
  const ids = new Set(inv.map((r) => r.id));
  const orphans = [...new Set([...Object.keys(h), ...Object.keys(peek("inventory-changes", {}))])].filter((id) => !ids.has(id));
  if (orphans.length) issues.push({ type: "orphanHistory", title: "Saved history for cards that were deleted", count: orphans.length, fix: "Clean up", rows: [] });
  return { at: nowIso(), cards: inv.length, issues };
}
/** The fixes Data check can do on its own. */
export function fixData(type, by = null) {
  if (type === "dupSku") {
    const list = inventory();
    const seen = new Set();
    let n = list.reduce((m, r) => Math.max(m, skuNumber(r)), 0), fixed = 0;
    for (const r of list) {
      const k = String(r.sku || "").toLowerCase();
      if (!k) continue;
      if (seen.has(k)) { r.sku = "CRB-" + String(++n).padStart(4, "0"); fixed++; } else seen.add(k);
    }
    save("inventory", list);
    return { fixed };
  }
  if (type === "webSold") {
    const ids = inventory().filter((r) => r.web && r.status === "sold").map((r) => r.id);
    return { fixed: updateMany(ids, { web: false }, by).updated };
  }
  if (type === "orphanHistory") {
    const ids = new Set(inventory().map((r) => r.id));
    const gone = new Set();
    for (const [read, write] of [[history, saveHistory], [changes, saveChanges]]) {
      const h = read();
      for (const id of Object.keys(h)) if (!ids.has(id)) { delete h[id]; gone.add(id); }
      write(h);
    }
    return { fixed: gone.size };
  }
  throw new Error("That one needs a person — open the cards and fix them.");
}

/** Storage places (boxes, binders, cases) with what's in them and when they were last counted. */
export function locations() {
  const m = new Map();
  for (const r of inventoryView()) {
    if (r.status === "sold") continue;
    const k = r.location || "";
    const e = m.get(k) || { location: k, cards: 0, qty: 0, value: 0, cost: 0, counted: null, uncounted: 0 };
    e.cards++;
    e.qty += r.qty;
    e.value += (r.value ?? r.cost ?? 0) * r.qty;
    e.cost += (r.cost || 0) * r.qty;
    if (r.countedAt) e.counted = !e.counted || r.countedAt > e.counted ? r.countedAt : e.counted;
    else e.uncounted++;
    m.set(k, e);
  }
  return [...m.values()].map((e) => ({ ...e, value: Math.round(e.value * 100) / 100, cost: Math.round(e.cost * 100) / 100 })).sort((a, b) => (a.location === "" ? 1 : b.location === "" ? -1 : a.location.localeCompare(b.location, undefined, { numeric: true })));
}

// ---- undo for bulk changes (bulk edit, merge) — one week ----
function saveUndo(entry) {
  const list = load("bulk-undo", []).filter((x) => Date.now() - Date.parse(x.at) < 7 * 86400000);
  const id = newId();
  list.unshift({ id, at: nowIso(), ...entry });
  save("bulk-undo", list.slice(0, 30));
  return id;
}
export function undoBulk(token) {
  const all = load("bulk-undo", []);
  const entry = all.find((x) => x.id === token);
  if (!entry) return false;
  const list = inventory();
  const byId = new Map(list.map((r) => [r.id, r]));
  for (const { id, before } of entry.rows || []) if (byId.has(id)) Object.assign(byId.get(id), before);
  for (const removed of entry.removed || []) if (!byId.has(removed.id)) list.push(removed);
  save("inventory", list);
  save("bulk-undo", all.filter((x) => x.id !== token));
  return true;
}

/**
 * Merge the same card kept on several rows into the first one: quantities add up, cost becomes the
 * weighted average, tags and notes combine. Undo puts everything back.
 */
export function mergeRows(ids, by = null) {
  const list = inventory();
  const rows = ids.map((id) => list.find((r) => r.id === id)).filter((r) => r && r.status !== "sold");
  if (rows.length < 2) return null;
  const [keep, ...rest] = rows;
  const before = { qty: keep.qty, cost: keep.cost, tags: keep.tags, notes: keep.notes, photos: keep.photos };
  const qty = rows.reduce((n, r) => n + r.qty, 0);
  keep.cost = Math.round((rows.reduce((n, r) => n + (r.cost || 0) * r.qty, 0) / qty) * 100) / 100;
  keep.qty = qty;
  keep.tags = [...new Set(rows.flatMap((r) => r.tags || []))].slice(0, 10);
  keep.notes = [...new Set(rows.map((r) => r.notes).filter(Boolean))].join(" · ").slice(0, 1000);
  const removedIds = new Set(rest.map((r) => r.id));
  save("inventory", list.filter((r) => !removedIds.has(r.id)));
  const h = changes();
  recordChanges(h, keep.id, before, keep, by);
  saveChanges(h);
  return { kept: keep, merged: rest.length, token: saveUndo({ kind: "merge", rows: [{ id: keep.id, before }], removed: rest }) };
}

/** Cards found during a stock count: counted now, and (if they were recorded elsewhere) moved here. */
export function markCounted(ids, location, by = null) {
  const list = inventory();
  const h = changes();
  const want = new Set(ids);
  let moved = 0;
  for (const row of list) {
    if (!want.has(row.id)) continue;
    const before = { ...row };
    row.countedAt = nowIso();
    if (location != null && row.location !== location) { row.location = clean.str(location, 80); moved++; }
    recordChanges(h, row.id, before, row, by);
  }
  save("inventory", list);
  saveChanges(h);
  return { counted: want.size, moved };
}
export const deleteInventory = (id) => removeFrom("inventory", id);

/**
 * Opened one box/pack of a sealed row: one unit leaves stock and its cost is spread over the cards that
 * came out (by value; evenly when none are priced). The last unit leaves the row in the trash (Undo works).
 * Every opening is kept ("box-breaks") so Sales can show whether opening boxes makes money.
 */
export function openSealed(id, pullIds = [], by = null) {
  const list = inventory();
  const box = list.find((r) => r.id === id);
  if (!box || box.kind !== "sealed" || box.status === "sold") return null;
  const pulls = pullIds.map((pid) => list.find((r) => r.id === pid)).filter((r) => r && r.id !== id);
  const cost = box.cost || 0;
  const worth = pulls.reduce((n, r) => n + (r.value || 0) * r.qty, 0);
  const units = pulls.reduce((n, r) => n + r.qty, 0);
  const h = changes();
  for (const r of pulls) {
    const before = { ...r };
    r.cost = Math.round((worth > 0 ? (cost * (r.value || 0)) / worth : units ? cost / units : 0) * 100) / 100;
    r.openedFrom = box.id;
    recordChanges(h, r.id, before, r, by);
  }
  const breaks = load("box-breaks", []);
  breaks.unshift({ id: newId(), at: nowIso(), by: by || null, boxId: box.id, name: box.name, sealedType: box.sealedType || "", category: box.category, cost, pulls: pulls.map((r) => ({ id: r.id, name: r.name, qty: r.qty, value: r.value ?? null })), value: Math.round(worth * 100) / 100 });
  save("box-breaks", breaks.slice(0, 2000));
  let trashId = null;
  if (box.qty > 1) {
    const before = { ...box };
    box.qty -= 1;
    recordChanges(h, box.id, before, box, by);
    save("inventory", list);
  } else {
    save("inventory", list);
    trashId = removeFrom("inventory", box.id);
  }
  saveChanges(h);
  return { box, pulls: pulls.length, cost, value: Math.round(worth * 100) / 100, trashId };
}
export const boxBreaks = () => load("box-breaks", []);

/**
 * Sell some or all units of an inventory row — the ONE place a sale changes stock (the Sold dialog, show
 * mode and website orders all come through here). Selling part of a stack leaves the rest in stock and
 * adds a separate sold row for the units sold, so profit and fees stay per sale.
 * @returns {{ row, soldRow, split, prev }} or null if the row is gone / already sold
 */
export function sellUnits(id, { qty = null, soldPrice, soldOn = null, soldDate = null, fees = undefined, payment = null, note = "", customerId = null } = {}) {
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
  if (customerId) soldRow.customerId = clean.str(customerId, 30);
  // A consigned card: what its owner is owed becomes its cost, so the profit shown is our commission.
  if (soldRow.consignorId && soldRow.soldPrice != null) {
    const pct = soldRow.consignPct ?? consignDefaultPct();
    soldRow.cost = Math.round(soldRow.soldPrice * (1 - pct / 100) * 100) / 100;
    soldRow.payout = { owed: Math.round(soldRow.cost * soldRow.qty * 100) / 100, pct, paidAt: null, method: null };
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
  const h = history();
  const byId = new Map(list.map((r) => [r.id, r]));
  const day = nowIso().slice(0, 10);
  let n = 0;
  for (const { id, value } of updates) {
    const row = byId.get(id);
    if (!row || value == null) continue;
    row.value = value;
    row.valuedAt = nowIso();
    const e = (h[id] ||= {});
    e.v = [...(e.v || []).filter(([d]) => d !== day), [day, value]].slice(-120);
    n++;
  }
  save("inventory", list);
  saveHistory(h);
  return n;
}

/** Biggest value changes in your own stock over `days` (needs the daily value history). */
export function stockMovers(days = 7, n = 5) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const h = historyView();
  const out = [];
  for (const r of inventoryView()) {
    const log = h[r.id]?.v;
    if (r.status === "sold" || !(log?.length > 1)) continue;
    const base = [...log].reverse().find(([d]) => d <= since) || log[0];
    const last = log[log.length - 1];
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
  const sale = { id: newId(), at: nowIso(), showId: currentShow()?.id || null, ...s };
  list.unshift(sale);
  save("show-sales", list.slice(0, 2000));
  return sale;
}
export function removeShowSale(id) {
  save("show-sales", showSales().filter((s) => s.id !== id));
}

// ---- customers: who buys from, sells to, consigns and grades with the shop (+ their store credit) ----
const token = () => crypto.randomBytes(12).toString("hex");
export const customers = () => load("customers", []);
function cleanCustomer(b, base = {}) {
  const out = {};
  if ("name" in b) out.name = clean.str(b.name, 80) || base.name || "Customer";
  if ("email" in b) out.email = clean.str(b.email, 120).toLowerCase();
  if ("phone" in b) out.phone = clean.str(b.phone, 30);
  if ("handle" in b) out.handle = clean.str(b.handle, 60);
  if ("collects" in b) out.collects = clean.text(b.collects, 500);
  if ("notes" in b) out.notes = clean.text(b.notes, 1000);
  if ("consignPct" in b) out.consignPct = b.consignPct === "" || b.consignPct == null ? null : Math.min(60, Math.max(0, parseFloat(b.consignPct) || 0));
  return out;
}
export function addCustomer(b) {
  const list = customers();
  const c = { id: newId(), added: nowIso(), credit: 0, creditLog: [], token: token(), ...cleanCustomer({ name: "", email: "", phone: "", handle: "", collects: "", notes: "", ...b }) };
  list.push(c);
  save("customers", list);
  return c;
}
export function updateCustomer(id, patch) {
  const list = customers();
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  Object.assign(c, cleanCustomer(patch, c));
  save("customers", list);
  return c;
}
export function deleteCustomer(id) {
  const c = customers().find((x) => x.id === id);
  if (c?.credit > 0) throw new Error(`${c.name} still has ${c.credit.toFixed(2)} in store credit — use it or take it off first.`);
  return removeFrom("customers", id);
}
export const findCustomerByEmail = (email) => (email ? customers().find((c) => c.email && c.email === String(email).trim().toLowerCase()) || null : null);
/** Store credit: + adds (a trade-in, a refund, a gift card), − spends it. Never below zero. */
export function addCredit(id, amount, reason = "", by = null) {
  const list = customers();
  const c = list.find((x) => x.id === id);
  if (!c) throw new Error("That customer isn't on file.");
  const a = Math.round((parseFloat(amount) || 0) * 100) / 100;
  if (!a) throw new Error("Enter an amount.");
  if ((c.credit || 0) + a < -0.004) throw new Error(`${c.name} has only $${(c.credit || 0).toFixed(2)} in store credit.`);
  c.credit = Math.round(((c.credit || 0) + a) * 100) / 100;
  c.creditLog = [{ at: nowIso(), amount: a, reason: clean.str(reason, 200), by: clean.str(by, 40) || null }, ...(c.creditLog || [])].slice(0, 300);
  save("customers", list);
  return c;
}
/** A customer's store credit code for the website (made the first time it's needed, kept after). */
export function ensureCreditCode(id) {
  const list = customers();
  const c = list.find((x) => x.id === id);
  if (!c) return null;
  if (!c.creditCode) {
    const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const pick = () => Array.from(crypto.randomBytes(5), (b) => A[b % 32]).join("");
    c.creditCode = `${pick()}-${pick()}`;
    save("customers", list);
  }
  return c.creditCode;
}
/** Customers who collect what these cards are: a "collects" word in the card's name, player, team or set. */
export function customerMatches(rows) {
  const out = [];
  for (const c of customers()) {
    const terms = String(c.collects || "").split(/[,;\n]/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3);
    if (!terms.length) continue;
    const hits = rows.filter((r) => terms.some((t) => [r.name, r.facts?.player, r.facts?.team, r.facts?.set].join(" ").toLowerCase().includes(t)));
    if (hits.length) out.push({ customer: c, rows: hits });
  }
  return out;
}

// ---- consignment: other people's cards sold for a commission ----
export const consignDefaultPct = () => Number(load("shop-settings", {}).consignPct ?? 15);
/** Every consigned card, optionally one consignor's, with what's owed and paid. */
export function consignments(customerId = null) {
  return inventory()
    .filter((r) => r.consignorId && (!customerId || r.consignorId === customerId))
    .map((r) => ({ id: r.id, consignorId: r.consignorId, name: r.name, grade: r.grade, qty: r.qty, status: r.status, added: r.added, pct: r.consignPct ?? consignDefaultPct(), floor: r.consignFloor ?? null, listed: r.web ? r.webMode === "fixed" ? r.webFixedPrice : r.webPrice : r.listPrice ?? null, soldPrice: r.soldPrice ?? null, soldDate: r.soldDate ?? null, soldOn: r.soldOn ?? null, owed: r.payout?.owed ?? null, paidAt: r.payout?.paidAt ?? null, method: r.payout?.method ?? null }));
}
/** Paid a consignor for these sold cards (all their unpaid ones when ids is empty). */
export function payConsignor(customerId, ids = [], method = "", by = null) {
  const list = inventory();
  const want = new Set(ids);
  let total = 0, n = 0;
  for (const r of list) {
    if (r.consignorId !== customerId || r.status !== "sold" || !r.payout || r.payout.paidAt) continue;
    if (want.size && !want.has(r.id)) continue;
    Object.assign(r.payout, { paidAt: nowIso(), method: clean.str(method, 40), by: clean.str(by, 40) || null });
    total += r.payout.owed;
    n++;
  }
  save("inventory", list);
  return { paid: n, total: Math.round(total * 100) / 100 };
}

// ---- grading as a service: customers' cards we send in with our submissions ----
export const gradingOrders = () => load("grading-orders", []);
const cleanGradingCards = (cards) => (Array.isArray(cards) ? cards : []).slice(0, 100).map((c) => ({ desc: clean.str(c?.desc, 160), declared: clean.money(c?.declared), fee: clean.money(c?.fee) ?? 0, grade: clean.str(c?.grade, 30), cert: String(c?.cert || "").replace(/\D/g, "").slice(0, 12) })).filter((c) => c.desc);
export const GRADING_ORDER_STATUS = ["received", "submitted", "back", "returned"];
export function addGradingOrder(b) {
  const list = gradingOrders();
  const o = { id: newId(), at: nowIso(), customerId: clean.str(b.customerId, 30), service: clean.str(b.service, 60), cards: cleanGradingCards(b.cards), status: "received", submissionId: clean.str(b.submissionId, 30) || null, paid: Boolean(b.paid), notes: clean.text(b.notes, 1000), token: token(), by: clean.str(b.by, 40) || null };
  o.total = Math.round(o.cards.reduce((n, c) => n + (c.fee || 0), 0) * 100) / 100;
  list.unshift(o);
  save("grading-orders", list);
  return o;
}
export function updateGradingOrder(id, patch) {
  const list = gradingOrders();
  const o = list.find((x) => x.id === id);
  if (!o) return null;
  if ("cards" in patch) { o.cards = cleanGradingCards(patch.cards); o.total = Math.round(o.cards.reduce((n, c) => n + (c.fee || 0), 0) * 100) / 100; }
  if ("service" in patch) o.service = clean.str(patch.service, 60);
  if ("status" in patch) o.status = clean.oneOf(patch.status, GRADING_ORDER_STATUS, o.status);
  if ("submissionId" in patch) o.submissionId = clean.str(patch.submissionId, 30) || null;
  if ("paid" in patch) o.paid = Boolean(patch.paid);
  if ("notes" in patch) o.notes = clean.text(patch.notes, 1000);
  if (o.submissionId && o.status === "received") o.status = "submitted";
  save("grading-orders", list);
  return o;
}
export const deleteGradingOrder = (id) => removeFrom("grading-orders", id);
/** Where a customer's order is, in plain words: our own steps, or the linked submission's progress at the grader. */
export function gradingOrderStage(o, subs = submissions()) {
  if (o.status === "returned") return { step: 5, text: "Returned to you" };
  if (o.status === "back") return { step: 4, text: "Back at the shop — ready for pickup or shipping" };
  const s = o.submissionId ? subs.find((x) => x.id === o.submissionId) : null;
  if (!s) return { step: 1, text: "Received at the shop" };
  if (s.status === "complete" || s.status === "shipped") return { step: 4, text: s.status === "complete" ? "Back at the shop — ready for pickup or shipping" : `On its way back from ${s.company}` };
  if (s.progress?.gradesReady) return { step: 3, text: `Grades ready at ${s.company}` };
  return { step: 2, text: `At ${s.company}${s.progress?.stage ? " — " + s.progress.stage : ""}${s.sent ? ` (sent ${s.sent})` : ""}` };
}

// ---- card shows: the calendar, what to bring, the table's checklist, the cash count at close ----
const SHOW_CHECKLIST = ["Table cover + display cases / stands", "Price labels on every card", "Cash box + change ($200 in small bills)", "Card reader charged (and a backup)", "Phone + laptop charged, Show mode open", "Top loaders, sleeves, team bags", "Business cards / QR sign for the website", "Receipt book or text receipts", "Water + snacks"];
export const shows = () => load("shows", []);
function cleanShow(b, base = {}) {
  const out = {};
  if ("name" in b) out.name = clean.str(b.name, 100) || base.name || "Card show";
  if ("date" in b) out.date = clean.date(b.date) || base.date || nowIso().slice(0, 10);
  if ("endDate" in b) out.endDate = clean.date(b.endDate);
  if ("venue" in b) out.venue = clean.str(b.venue, 120);
  if ("city" in b) out.city = clean.str(b.city, 80);
  if ("hours" in b) out.hours = clean.str(b.hours, 80);
  if ("table" in b) out.table = clean.str(b.table, 30);
  if ("tableCost" in b) out.tableCost = clean.money(b.tableCost) ?? 0;
  if ("notes" in b) out.notes = clean.text(b.notes, 1000);
  if ("public" in b) out.public = b.public === true || b.public === "on" || b.public === "true";
  if ("checklist" in b) out.checklist = (Array.isArray(b.checklist) ? b.checklist : []).slice(0, 40).map((x) => ({ text: clean.str(x?.text, 120), done: Boolean(x?.done) })).filter((x) => x.text);
  if ("startCash" in b) out.startCash = clean.money(b.startCash);
  if ("countedCash" in b) out.countedCash = clean.money(b.countedCash);
  if ("cashOut" in b) out.cashOut = clean.money(b.cashOut);
  return out;
}
export function addShow(b) {
  const list = shows();
  const sh = { id: newId(), added: nowIso(), public: true, checklist: SHOW_CHECKLIST.map((text) => ({ text, done: false })), ...cleanShow({ name: "", date: "", venue: "", city: "", table: "", tableCost: 0, ...b }) };
  list.push(sh);
  list.sort((a, b2) => (a.date < b2.date ? -1 : 1));
  save("shows", list);
  return sh;
}
export function updateShow(id, patch) {
  const list = shows();
  const sh = list.find((x) => x.id === id);
  if (!sh) return null;
  Object.assign(sh, cleanShow(patch, sh));
  if ("countedCash" in patch && sh.countedCash != null) sh.closedAt = nowIso();
  list.sort((a, b2) => (a.date < b2.date ? -1 : 1));
  save("shows", list);
  return sh;
}
export const deleteShow = (id) => removeFrom("shows", id);
/** The show on today (local date), if any — Show mode sales are filed under it. */
export function currentShow() {
  const day = new Date().toLocaleDateString("en-CA");
  return shows().find((sh) => sh.date <= day && day <= (sh.endDate || sh.date)) || null;
}
/** A show's numbers: sales, what the cards cost, the table, expenses filed for it, and the cash drawer. */
export function showReport(id) {
  const sh = shows().find((x) => x.id === id);
  if (!sh) return null;
  const sales = showSales().filter((x) => x.showId === id);
  const inv = inventory();
  const soldRows = sales.flatMap((x) => x.items.map((i) => inv.find((r) => r.id === i.soldRowId)).filter(Boolean));
  const revenue = sales.reduce((n, x) => n + x.total, 0);
  const cogs = soldRows.reduce((n, r) => n + (r.cost || 0) * r.qty, 0);
  const exps = expenses().filter((e) => e.showId === id).reduce((n, e) => n + e.amount, 0);
  const byPayment = {};
  for (const x of sales) byPayment[x.payment] = Math.round(((byPayment[x.payment] || 0) + x.total) * 100) / 100;
  const cashSales = byPayment.Cash || 0;
  const expected = sh.startCash != null ? Math.round((sh.startCash + cashSales - (sh.cashOut || 0)) * 100) / 100 : null;
  const r2 = (v) => Math.round(v * 100) / 100;
  return { show: sh, sales: sales.length, cards: sales.reduce((n, x) => n + x.items.reduce((m, i) => m + i.qty, 0), 0), revenue: r2(revenue), cogs: r2(cogs), table: sh.tableCost || 0, expenses: r2(exps), profit: r2(revenue - cogs - (sh.tableCost || 0) - exps), byPayment, cash: { start: sh.startCash ?? null, sales: cashSales, out: sh.cashOut ?? 0, expected, counted: sh.countedCash ?? null, over: expected != null && sh.countedCash != null ? r2(sh.countedCash - expected) : null } };
}

// ---- supplies: what shipping and shows use up, with reorder points ----
const DEFAULT_SUPPLIES = [
  ["Penny sleeves", 1, 0, 200], ["Top loaders", 1, 0, 100], ["Team bags", 1, 0, 100], ["Bubble mailers", 1, 0, 25],
  ["Card savers (for grading)", 0, 0, 25], ["Magnetic one-touch holders", 0, 0, 10], ["Shipping labels", 1, 0, 50], ["Painter's tape", 0, 0, 1],
];
export const supplies = () => load("supplies", null) ?? DEFAULT_SUPPLIES.map(([name, perOrder, perCard, reorderAt], i) => ({ id: "s" + i, name, onHand: null, unit: "", perOrder, perCard, reorderAt, cost: null, link: "" }));
function cleanSupply(b, base = {}) {
  const n = (v, d) => (v === "" || v == null ? d : Math.max(0, Math.round(parseFloat(v) * 100) / 100 || 0));
  return { name: clean.str(b.name ?? base.name, 80) || "Supply", onHand: b.onHand === "" || b.onHand == null ? base.onHand ?? null : n(b.onHand, 0), unit: clean.str(b.unit ?? base.unit, 20), perOrder: n(b.perOrder, base.perOrder ?? 0), perCard: n(b.perCard, base.perCard ?? 0), reorderAt: n(b.reorderAt, base.reorderAt ?? 0), cost: clean.money(b.cost ?? base.cost), link: /^https:\/\//.test(String(b.link ?? base.link ?? "")) ? clean.str(b.link ?? base.link, 300) : "" };
}
export function saveSupply(b) {
  const list = supplies();
  const i = list.findIndex((x) => x.id === b.id);
  if (i >= 0) list[i] = { id: list[i].id, ...cleanSupply(b, list[i]) };
  else list.push({ id: newId(), ...cleanSupply(b) });
  save("supplies", list);
  return list;
}
export function deleteSupply(id) {
  const list = supplies().filter((x) => x.id !== id);
  save("supplies", list);
  return list;
}
/** Shipped orders / cards sold use supplies up; returns the ones that just reached their reorder point. */
export function useSupplies({ orders = 0, cards = 0 } = {}) {
  const list = supplies();
  const low = [];
  for (const x of list) {
    const use = (x.perOrder || 0) * orders + (x.perCard || 0) * cards;
    if (!use || x.onHand == null) continue; // not counted yet: nothing to take from
    const before = x.onHand;
    x.onHand = Math.max(0, Math.round((x.onHand - use) * 100) / 100);
    if (before > x.reorderAt && x.onHand <= x.reorderAt) low.push(x);
  }
  save("supplies", list);
  return low;
}

// ---- shop-wide settings for the new services (consignment commission, grading prices) ----
export const shopSettings = () => ({
  consignPct: 15,
  gradingPrices: [{ service: "PSA Value", fee: 35 }, { service: "PSA Regular", fee: 85 }],
  ownGradingFee: 25, // what grading one of your own cards costs you (fee + shipping share) — "what to grade next"
  salesTaxPct: null, // in-person sales tax rate (Michigan: 6) — Books shows what's due on shows and local sales
  taxIncluded: true, // in-person prices include the tax
  insureOver: 100, // packing: insure orders worth more than this
  signatureOver: 750, // packing: signature required above this
  weeklyTo: "", // who the weekly report email goes to (comma separated)
  k1099: {}, // { "2026": { eBay: 12345.67 } } — the 1099-K amounts from each platform, to check against your records
  ...load("shop-settings", {}),
});
export function saveShopSettings(b) {
  const cur = shopSettings();
  const pct = (v, d, max = 60) => (v != null && v !== "" ? Math.min(max, Math.max(0, parseFloat(v) || 0)) : d);
  const out = {
    ...cur,
    consignPct: pct(b.consignPct, cur.consignPct),
    gradingPrices: Array.isArray(b.gradingPrices) ? b.gradingPrices.slice(0, 12).map((g) => ({ service: clean.str(g?.service, 60), fee: clean.money(g?.fee) ?? 0 })).filter((g) => g.service) : cur.gradingPrices,
    ownGradingFee: "ownGradingFee" in b ? clean.money(b.ownGradingFee) ?? cur.ownGradingFee : cur.ownGradingFee,
    salesTaxPct: "salesTaxPct" in b ? (b.salesTaxPct === "" || b.salesTaxPct == null ? null : pct(b.salesTaxPct, null, 20)) : cur.salesTaxPct,
    taxIncluded: "taxIncluded" in b ? b.taxIncluded === true || b.taxIncluded === "on" || b.taxIncluded === "true" : cur.taxIncluded,
    insureOver: "insureOver" in b ? clean.money(b.insureOver) ?? cur.insureOver : cur.insureOver,
    signatureOver: "signatureOver" in b ? clean.money(b.signatureOver) ?? cur.signatureOver : cur.signatureOver,
    weeklyTo: "weeklyTo" in b ? clean.str(b.weeklyTo, 300) : cur.weeklyTo,
  };
  if (b.k1099 && /^\d{4}$/.test(String(b.k1099.year)) && b.k1099.platform) {
    const y = String(b.k1099.year), v = clean.money(b.k1099.amount);
    out.k1099 = { ...cur.k1099, [y]: { ...(cur.k1099?.[y] || {}), [clean.str(b.k1099.platform, 40)]: v } };
  }
  save("shop-settings", out);
  return out;
}

/** Cards you owned on a date (not consigned ones), at cost — the start and end of the year's inventory for taxes. */
export function inventoryAt(dateIso, list = inventory()) {
  return list.filter((r) => !r.consignorId && (r.purchased || String(r.added || "").slice(0, 10)) <= dateIso && (r.status !== "sold" || (r.soldDate || "") > dateIso));
}

// ---- live stream (Whatnot): the run of show — a queue, the card on screen, who bought what ----
export const liveState = () => ({ queue: [], now: null, sales: [], startedAt: null, ...load("live", {}) });
export const saveLive = (x) => save("live", x);
export const liveSessions = () => load("live-sessions", []);
export function endLive() {
  const st = liveState();
  if (st.sales.length) save("live-sessions", [{ id: newId(), startedAt: st.startedAt, endedAt: nowIso(), sales: st.sales }, ...liveSessions()].slice(0, 200));
  saveLive({ ...st, now: null, sales: [], startedAt: null });
  return st;
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
    // filed under a card show (its profit counts it)
    ...(b.showId ? { showId: clean.str(b.showId, 30) } : {}),
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

// ---- the bulk-scan reader's mistakes: shown as accuracy, and told to the reader on the next scan ----
export const SCAN_FIELDS = ["player", "number", "parallel", "year", "set", "grade"];
/** cards: one per card added from a scan — { set, fixed: { field: { from, to } } } (only corrected fields). */
export function addScanFeedback(cards) {
  const s = load("scan-feedback", { cards: [], fixes: [] });
  const at = nowIso();
  for (const c of (Array.isArray(cards) ? cards : []).slice(0, 1000)) {
    const fixed = {};
    for (const k of SCAN_FIELDS) {
      const f = c?.fixed?.[k];
      const from = clean.str(f?.from, 80), to = clean.str(f?.to, 80);
      if (f && from.toLowerCase() !== to.toLowerCase()) fixed[k] = { from, to };
    }
    s.cards.push({ at, n: Object.keys(fixed) });
    for (const [field, v] of Object.entries(fixed)) s.fixes.push({ at, set: clean.str(c.set, 80), field, ...v });
  }
  s.cards = s.cards.slice(-3000);
  s.fixes = s.fixes.slice(-400);
  save("scan-feedback", s);
  return s.cards.length;
}
/** How often each field came out right (the last 500 cards added from scans). */
export function scanAccuracy(last = 500) {
  const { cards, fixes } = load("scan-feedback", { cards: [], fixes: [] });
  const recent = cards.slice(-last);
  const pct = (n) => (recent.length ? Math.round((n / recent.length) * 1000) / 10 : null);
  const fields = Object.fromEntries(SCAN_FIELDS.map((k) => [k, pct(recent.filter((c) => !c.n.includes(k)).length)]));
  return { cards: recent.length, allRight: pct(recent.filter((c) => !c.n.length).length), fields, recentFixes: fixes.slice(-8).reverse() };
}
/** The reader's most repeated recent mistakes, worded for its instructions (most frequent first). */
export function scanHints(max = 12) {
  const { fixes } = load("scan-feedback", { cards: [], fixes: [] });
  const groups = new Map();
  for (const f of fixes.slice(-250)) {
    const k = [f.field, f.set, f.from, f.to].map((x) => String(x || "").toLowerCase()).join("|");
    const g = groups.get(k) || { ...f, n: 0 };
    g.n++;
    g.at = f.at;
    groups.set(k, g);
  }
  const say = (v) => (v ? `"${v}"` : "nothing");
  return [...groups.values()]
    .sort((a, b) => b.n - a.n || (a.at < b.at ? 1 : -1))
    .slice(0, max)
    .map((g) => `${g.set ? g.set + ": " : ""}${g.field} was read as ${g.field === "parallel" && !g.from ? "base" : say(g.from)} but it was ${g.field === "parallel" && !g.to ? "base" : say(g.to)}${g.n > 1 ? ` (${g.n} times)` : ""}`);
}

// ---- PSA population watch: how many copies exist at your grade, checked a few slabs a day ----
export const popWatch = () => load("pop-watch", {});
export const savePopWatch = (w) => save("pop-watch", w);

// ---- backup / restore everything in one file ----
const BACKUP_FILES = ["lookups", "watchlist", "hot", "inventory", "submissions", "expenses", "portfolio", "activity", "alerts", "spend", "wantlist", "advice", "pricing-obs", "pricing-settings", "mjc-store", "mjc-orders", "mjc-tickets", "show-sales", "inventory-history", "inventory-changes", "scan-queue", "scan-feedback", "box-breaks", "pop-watch", "customers", "grading-orders", "shows", "supplies", "shop-settings", "live", "live-sessions", "sales-imports"];

export function backup() {
  const out = { app: "card-research-bot", version: 2, at: nowIso() };
  for (const f of BACKUP_FILES) out[f] = load(f, null);
  return out;
}

export function restore(data) {
  if (!data || data.app !== "card-research-bot") throw new Error("That isn't a Card Research Bot backup file.");
  for (const f of BACKUP_FILES) {
    if (data[f] == null) continue;
    const ok = ["hot", "spend", "advice", "pricing-settings", "mjc-store", "inventory-history", "inventory-changes", "scan-queue"].includes(f) ? typeof data[f] === "object" && !Array.isArray(data[f]) : Array.isArray(data[f]);
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
