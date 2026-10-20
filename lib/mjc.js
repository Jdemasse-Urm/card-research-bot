// Connection to the MJC store website (its API lives in the mcj repo, deployed on AWS).
//   push:  cards marked "Sell on MJC" (+ their photos and AI prices) and the store's policies
//   pull:  new website orders (→ inventory marked sold) and customer messages
// Only public card facts are sent. Cost basis, notes, locations and SKUs never leave this computer.

import fs from "node:fs";
import path from "node:path";
import * as store from "./store.js";

export const apiUrl = () => String(process.env.MJC_API_URL || "").replace(/\/+$/, "");
export const configured = () => Boolean(apiUrl() && process.env.MJC_SYNC_TOKEN);
const PHOTO_DIR = path.join(store.DATA_DIR, "photos");
export const photoPath = (rowId, file) => path.join(PHOTO_DIR, rowId.replace(/[^\w-]/g, ""), path.basename(file));

async function call(method, route, body) {
  if (!configured()) throw new Error("The MJC store isn't connected — add its address and sync key in Inventory → MJC store → Setup.");
  const res = await fetch(apiUrl() + route, {
    method,
    headers: { authorization: `Bearer ${process.env.MJC_SYNC_TOKEN}`, "content-type": "application/json" },
    body: body == null ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const text = await res.text();
  let j = {};
  try {
    j = text ? JSON.parse(text) : {};
  } catch {}
  if (res.status === 401) throw new Error("The store rejected the sync key — check it in MJC store → Setup.");
  if (!res.ok) throw new Error(j.error || `Store API error ${res.status}`);
  return j;
}

export const status = () => call("GET", "/admin/status");

// ------------------------------------------------------------------ store settings (policies the chatbot quotes)

export const storeSettings = () => store.load("mjc-store", null);
export async function saveStoreSettings(s) {
  store.save("mjc-store", s);
  if (configured()) await call("PUT", "/admin/store", s);
  return s;
}

// ------------------------------------------------------------------ catalog push

const SPORT_NAME = { baseball: "Baseball", basketball: "Basketball", football: "Football", hockey: "Hockey", soccer: "Soccer" };
export const onSite = (r) => r.web && ["in_stock", "listed"].includes(r.status) && r.qty > 0 && (r.webMode === "fixed" ? r.webFixedPrice > 0 : r.webPrice > 0);
export const sitePrice = (r) => (r.webMode === "fixed" ? r.webFixedPrice : r.webPrice);

async function uploadPhotos(row) {
  const urls = { ...(row.photoUrls || {}) };
  let changed = false;
  for (const file of row.photos || []) {
    if (urls[file]) continue;
    const p = photoPath(row.id, file);
    if (!fs.existsSync(p)) continue;
    const r = await call("PUT", `/admin/photos/${encodeURIComponent(row.id)}/${(row.photos || []).indexOf(file)}`, { contentType: "image/jpeg", data: fs.readFileSync(p).toString("base64") });
    urls[file] = r.url;
    changed = true;
  }
  for (const k of Object.keys(urls)) if (!(row.photos || []).includes(k)) { delete urls[k]; changed = true; }
  if (changed) store.setEngineFields(row.id, { photoUrls: urls });
  return (row.photos || []).map((f) => urls[f]).filter(Boolean);
}

export function siteItem(row, photos) {
  const lookup = row.lookupId ? store.getLookup(row.lookupId) : null;
  const c = lookup?.card || {};
  return {
    id: row.id,
    title: row.name,
    player: c.player_or_character || "",
    year: c.year || "",
    set: c.brand_set || "",
    number: c.card_number || "",
    parallel: c.parallel_or_variant || "",
    grade: row.grade,
    category: row.category,
    sport: SPORT_NAME[row.category] || "",
    price: sitePrice(row),
    marketValue: row.webMarket ?? null,
    qty: row.qty,
    rookie: Boolean(c.rookie),
    auto: Boolean(c.autograph),
    serial: c.serial_number || "",
    certNumber: c.cert_number || "",
    certVerified: Boolean(lookup?.slab?.verified),
    pop: lookup?.slab?.cert?.population ?? null,
    liquidity: row.webLiquidity || "",
    description: row.webDescription || lookup?.summary || "",
    photos,
  };
}

let syncing = null;
/** Push every on-site card (full sync: anything no longer marked comes off the website). */
export function syncCatalog() {
  if (syncing) return syncing; // one sync at a time; callers share the result
  syncing = (async () => {
    const rows = store.inventory().filter(onSite);
    const items = [];
    for (const r of rows) items.push(siteItem(r, await uploadPhotos(r)));
    const out = await call("PUT", "/admin/items", { items, full: true });
    setState({ lastSync: new Date().toISOString(), lastSyncError: null, lastSyncCount: items.length });
    return { ...out, live: items.length };
  })()
    .catch((err) => {
      setState({ lastSyncError: err.message, lastSyncErrorAt: new Date().toISOString() });
      throw err;
    })
    .finally(() => (syncing = null));
  return syncing;
}

let debounce = null;
/** Called whenever inventory changes; batches bursts of edits into one sync. */
export function scheduleSync() {
  if (!configured()) return;
  clearTimeout(debounce);
  debounce = setTimeout(() => syncCatalog().catch(() => {}), 8000);
}

// ------------------------------------------------------------------ orders + messages pull

export const localOrders = () => store.load("mjc-orders", []);
export const localTickets = () => store.load("mjc-tickets", []);
export const state = () => store.load("mjc-state", {});
const setState = (patch) => store.save("mjc-state", { ...state(), ...patch });

const STRIPE_PCT = 2.9, STRIPE_FIXED = 0.3;

/** New website orders → inventory marked sold (qty-aware), then acknowledged so the site stops counting them. */
export async function pullOrders({ onOrder } = {}) {
  const { orders } = await call("GET", "/admin/orders?unacked=1");
  const local = localOrders();
  const fresh = [];
  for (const o of orders.sort((a, b) => (a.created < b.created ? -1 : 1))) {
    if (!local.some((x) => x.id === o.id)) {
      const share = o.items.length ? 1 / o.items.length : 1;
      for (const it of o.items) {
        const row = store.inventory().find((r) => r.id === it.id);
        if (!row) continue;
        const fees = Math.round(((it.price || 0) * STRIPE_PCT / 100 + STRIPE_FIXED * share) * 100) / 100;
        const sold = { soldPrice: it.price, soldOn: "MJC site", soldDate: o.created.slice(0, 10), fees };
        if (row.qty > 1) {
          store.updateInventory(row.id, { qty: row.qty - 1 });
          store.addInventory({ ...row, qty: 1, ...sold, status: "sold", lookupId: row.lookupId, notes: `${row.notes ? row.notes + " · " : ""}MJC order ${o.id}`, sku: `${row.sku}-S` });
        } else store.updateInventory(row.id, { ...sold, status: "sold", notes: `${row.notes ? row.notes + " · " : ""}MJC order ${o.id}` });
        store.recordSale(it.id, { price: it.price, market: row.webMarket, liq: row.webLiqPerDay });
      }
      local.unshift({ ...o, acked: true, pulledAt: new Date().toISOString() });
      fresh.push(o);
    }
    await call("POST", `/admin/orders/${encodeURIComponent(o.id)}/ack`);
  }
  store.save("mjc-orders", local.slice(0, 2000));
  setState({ lastOrdersPull: new Date().toISOString() });
  for (const o of fresh) onOrder?.(o);
  return fresh;
}

export async function updateOrder(id, patch) {
  const r = await call("PATCH", `/admin/orders/${encodeURIComponent(id)}`, patch);
  store.save("mjc-orders", localOrders().map((o) => (o.id === id ? { ...o, ...r.order, acked: true } : o)));
  return r.order;
}

export async function pullTickets({ onTicket } = {}) {
  const { tickets } = await call("GET", "/admin/tickets");
  const known = new Set(localTickets().map((t) => t.id));
  store.save("mjc-tickets", tickets.slice(0, 1000));
  for (const t of tickets) if (!known.has(t.id) && t.status === "open") onTicket?.(t);
  return tickets;
}

export async function updateTicket(id, status) {
  await call("PATCH", `/admin/tickets/${encodeURIComponent(id)}`, { status });
  store.save("mjc-tickets", localTickets().map((t) => (t.id === id ? { ...t, status } : t)));
}
