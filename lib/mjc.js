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
/** The grid-size copy of a listing photo ("abc.jpg" → "abc-t.jpg"), made by the photo editor. */
export const thumbName = (file) => String(file).replace(/\.jpg$/i, "-t.jpg");

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
/** The email list the website collects ("new arrivals and price drops by email"). */
export const subscribers = async () => (await call("GET", "/admin/subscribers")).subscribers;
export const removeSubscriber = (email) => call("DELETE", `/admin/subscribers/${encodeURIComponent(email)}`);

// ------------------------------------------------------------------ store settings (policies the chatbot quotes)

export const storeSettings = () => store.load("mjc-store", null);
export async function saveStoreSettings(s) {
  store.save("mjc-store", s);
  if (configured()) await call("PUT", "/admin/store", s);
  return s;
}

/** Upcoming public card shows → the website's "Find us at shows" calendar (part of the store settings). */
export async function syncShows() {
  const s = storeSettings();
  if (!s || !configured()) return;
  const day = new Date().toLocaleDateString("en-CA");
  const shows = store.shows().filter((x) => x.public && (x.endDate || x.date) >= day).slice(0, 20).map(({ id, name, date, endDate, venue, city, hours, table }) => ({ id, name, date, endDate: endDate || null, venue, city, hours: hours || "", table }));
  await saveStoreSettings({ ...s, shows });
}

// ------------------------------------------------------------------ catalog push

const SPORT_NAME = { baseball: "Baseball", basketball: "Basketball", football: "Football", hockey: "Hockey", soccer: "Soccer" };
export const onSite = (r) => r.web && ["in_stock", "listed"].includes(r.status) && r.qty > 0 && (r.webMode === "fixed" ? r.webFixedPrice > 0 : r.webPrice > 0);
export const sitePrice = (r) => (r.webMode === "fixed" ? r.webFixedPrice : r.webPrice);

async function uploadPhotos(row) {
  const urls = { ...(row.photoUrls || {}) };
  const thumbs = { ...(row.thumbUrls || {}) };
  let changed = false;
  for (const file of row.photos || []) {
    const n = (row.photos || []).indexOf(file);
    const p = photoPath(row.id, file);
    if (!urls[file] && fs.existsSync(p)) {
      const r = await call("PUT", `/admin/photos/${encodeURIComponent(row.id)}/${n}`, { contentType: "image/jpeg", data: fs.readFileSync(p).toString("base64") });
      urls[file] = r.url;
      changed = true;
    }
    const t = photoPath(row.id, thumbName(file));
    if (!thumbs[file] && fs.existsSync(t)) {
      const r = await call("PUT", `/admin/photos/${encodeURIComponent(row.id)}/${n}`, { contentType: "image/jpeg", variant: "thumb", data: fs.readFileSync(t).toString("base64") });
      thumbs[file] = r.url;
      changed = true;
    }
  }
  for (const map of [urls, thumbs]) for (const k of Object.keys(map)) if (!(row.photos || []).includes(k)) { delete map[k]; changed = true; }
  if (changed) store.setEngineFields(row.id, { photoUrls: urls, thumbUrls: thumbs });
  const listed = (row.photos || []).filter((f) => urls[f]);
  return { photos: listed.map((f) => urls[f]), thumbs: listed.map((f) => thumbs[f] || null), video: await uploadVideo(row) };
}

const VIDEO_TYPE = { mp4: "video/mp4", webm: "video/webm", mov: "video/quicktime" };
/**
 * The card's tilt video, uploaded once: the store hands out a signed upload link (videos are too big for an API
 * call) and the bytes go straight to its photo bucket. A store that can't take videos just doesn't show one.
 */
async function uploadVideo(row) {
  if (!row.video) return null;
  if (row.videoUrl) return row.videoUrl;
  const p = photoPath(row.id, row.video);
  if (!fs.existsSync(p)) return null;
  try {
    const bytes = fs.readFileSync(p);
    const r = await call("POST", "/admin/upload-url", { id: row.id, contentType: VIDEO_TYPE[row.video.split(".").pop()] || "video/mp4", bytes: bytes.length });
    const up = await fetch(r.uploadUrl, { method: "PUT", headers: r.headers, body: bytes, signal: AbortSignal.timeout(120000) });
    if (!up.ok) throw new Error(`upload ${up.status}`);
    store.setEngineFields(row.id, { videoUrl: r.url });
    return r.url;
  } catch (err) {
    console.warn("video upload skipped:", row.id, err.message);
    return null;
  }
}

export function siteItem(row, { photos = [], thumbs = [], video = null } = {}) {
  const lookup = row.lookupId ? store.getLookup(row.lookupId) : null;
  const c = lookup?.card || {};
  // the card's own facts (bulk scan, the editor) first, then its research report's
  const f = row.facts || {};
  const k = row.condition;
  const pop = Object.values(store.popWatch()).find((e) => e?.rowId === row.id)?.pop;
  return {
    id: row.id,
    title: row.name,
    kind: row.kind === "sealed" ? "sealed" : "card",
    sealedType: row.kind === "sealed" ? row.sealedType || "" : "",
    player: f.player || c.player_or_character || "",
    team: f.team || c.team || "",
    year: f.year || c.year || "",
    set: f.set || c.brand_set || "",
    number: f.number || c.card_number || "",
    parallel: f.parallel || c.parallel_or_variant || "",
    grade: row.grade,
    category: row.category,
    sport: SPORT_NAME[row.category] || "",
    price: sitePrice(row),
    marketValue: row.webMarket ?? null,
    qty: row.qty,
    rookie: Boolean(f.rookie || c.rookie),
    auto: Boolean(f.auto || c.autograph),
    serial: f.serial || c.serial_number || "",
    certNumber: f.cert || c.cert_number || "",
    certVerified: Boolean(f.certVerified || lookup?.slab?.verified),
    pop: pop ?? lookup?.slab?.cert?.population ?? null,
    // raw cards only: a slab's grade is its condition
    condition: /^raw$/i.test(row.grade) && k?.scale ? { scale: k.scale, label: store.CONDITION_LABEL[k.scale], definition: store.CONDITION_HELP[k.scale], centering: k.centering || "", corners: k.corners || "", edges: k.edges || "", surface: k.surface || "", notes: k.notes || "", checked: k.at || "" } : null,
    liquidity: row.webLiquidity || "",
    description: row.webDescription || lookup?.summary || "",
    photos,
    thumbs,
    video,
    goLiveAt: row.webGoLiveAt || null,
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
    await syncExtras().catch((err) => setState({ extrasError: err.message }));
    return { ...out, live: items.length };
  })()
    .catch((err) => {
      setState({ lastSyncError: err.message, lastSyncErrorAt: new Date().toISOString() });
      throw err;
    })
    .finally(() => (syncing = null));
  return syncing;
}

/** What a consignor sees on their status page: their cards, what sold, what's owed and paid. */
function consignStatuses() {
  const out = [];
  for (const c of store.customers()) {
    const list = store.consignments(c.id);
    if (!list.length || !c.token) continue;
    const sold = list.filter((x) => x.status === "sold");
    const r2 = (v) => Math.round(v * 100) / 100;
    out.push({ token: c.token, name: c.name, pct: c.consignPct ?? store.consignDefaultPct(), cards: list.map((x) => ({ name: x.name, grade: x.grade, status: x.status === "sold" ? "Sold" : "For sale", price: x.listed, soldPrice: x.soldPrice, soldDate: x.soldDate, payout: x.owed, paid: Boolean(x.paidAt) })), totals: { owed: r2(sold.filter((x) => !x.paidAt).reduce((n, x) => n + (x.owed || 0), 0)), paid: r2(sold.filter((x) => x.paidAt).reduce((n, x) => n + (x.owed || 0), 0)) } });
  }
  return out;
}
/** What a grading customer sees: where their cards are (the linked submission's progress at the grader). */
function gradingStatuses() {
  const people = new Map(store.customers().map((c) => [c.id, c]));
  const subs = store.submissions();
  return store.gradingOrders().filter((o) => o.token && o.status !== "returned").map((o) => ({ token: o.token, name: people.get(o.customerId)?.name || "", service: o.service, total: o.total, paid: o.paid, stage: store.gradingOrderStage(o, subs), cards: o.cards.map(({ desc, grade, cert }) => ({ desc, grade, cert })) }));
}
/** Customers' store credit, usable at checkout by code (when "store credit online" is on). This bot owns the balances. */
function creditCodes() {
  if (!storeSettings()?.creditOnline) return [];
  return store.customers().filter((c) => c.credit > 0 || c.creditCode).map((c) => ({ code: store.ensureCreditCode(c.id), balance: c.credit || 0, email: c.email || "", name: c.name }));
}
export async function syncExtras() {
  await call("PUT", "/admin/statuses", { kind: "consign", statuses: consignStatuses() });
  await call("PUT", "/admin/statuses", { kind: "grading", statuses: gradingStatuses() });
  const credits = creditCodes();
  if (credits.length) await call("PUT", "/admin/credits", { credits });
  // gift cards bought on the site are codes too: kept here so Books can show what's still out
  store.save("mjc-credits", (await call("GET", "/admin/credits")).credits || []);
  setState({ extrasAt: new Date().toISOString(), extrasError: null });
}
/** A status page address (customers get it on receipts and statements). */
export const statusUrl = (token) => (state().lastStatus?.siteUrl && token ? `${state().lastStatus.siteUrl}/status/${token}` : "");

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
  let creditChanged = false;
  for (const o of orders.sort((a, b) => (a.created < b.created ? -1 : 1))) {
    if (!local.some((x) => x.id === o.id)) {
      const share = o.items.length ? 1 / o.items.length : 1;
      // the buyer goes in the customer book (found by email, or added)
      const cust = o.email ? store.findCustomerByEmail(o.email) || store.addCustomer({ name: o.name || o.email, email: o.email, notes: "From the MJC website" }) : null;
      for (const it of o.items) {
        const row = store.inventory().find((r) => r.id === it.id);
        if (!row) continue;
        const fees = Math.round(((it.price || 0) * STRIPE_PCT / 100 + STRIPE_FIXED * share) * 100) / 100;
        // One unit sold (the rest of a stack stays in stock) — through the same path as every other sale.
        store.sellUnits(row.id, { qty: 1, soldPrice: it.price, soldOn: "MJC site", soldDate: o.created.slice(0, 10), fees, payment: "Card", note: `MJC order ${o.id}`, customerId: cust?.id || null });
        store.recordSale(it.id, { price: it.price, market: row.webMarket, liq: row.webLiqPerDay });
      }
      if (o.creditUsed?.amount > 0) {
        const holder = store.customers().find((c) => c.creditCode && c.creditCode === o.creditUsed.code);
        if (holder) {
          const take = Math.min(holder.credit || 0, o.creditUsed.amount);
          if (take > 0) store.addCredit(holder.id, -take, `Website order ${o.id}`, "MJC website");
          if (take < o.creditUsed.amount) store.addAlert({ kind: "order", name: `MJC order ${o.id}`, text: `${holder.name} used $${o.creditUsed.amount} of store credit online but had $${take} left here — check their balance.` });
          creditChanged = true;
        }
      }
      local.unshift({ ...o, acked: true, pulledAt: new Date().toISOString() });
      fresh.push(o);
    }
    await call("POST", `/admin/orders/${encodeURIComponent(o.id)}/ack`);
  }
  store.save("mjc-orders", local.slice(0, 2000));
  setState({ lastOrdersPull: new Date().toISOString() });
  for (const o of fresh) onOrder?.(o);
  if (creditChanged) scheduleSync(); // the new balances go back to the site
  return fresh;
}

export async function updateOrder(id, patch) {
  const r = await call("PATCH", `/admin/orders/${encodeURIComponent(id)}`, patch);
  store.save("mjc-orders", localOrders().map((o) => (o.id === id ? { ...o, ...r.order, acked: true } : o)));
  return { ...r.order, emailed: r.emailed || null };
}

const TICKET_PHOTO_DIR = path.join(store.DATA_DIR, "mjc-tickets");
export const ticketPhotoPath = (id, n) => path.join(TICKET_PHOTO_DIR, String(id).replace(/[^\w-]/g, ""), `${parseInt(n, 10) || 0}.jpg`);

/** The store's status (visits, Pip, email list, version), kept locally so Home can show it without a round trip. */
export async function refreshStatus() {
  const st = await status();
  setState({ lastStatus: st, lastStatusAt: new Date().toISOString() });
  return st;
}

export async function pullTickets({ onTicket, onActivity } = {}) {
  const { tickets } = await call("GET", "/admin/tickets");
  const known = new Set(localTickets().map((t) => t.id));
  // Photos from "sell to us" requests live privately on the store; keep a copy here (they're small).
  for (const t of tickets) {
    for (let n = 0; n < (t.photos || 0); n++) {
      const f = ticketPhotoPath(t.id, n);
      if (fs.existsSync(f)) continue;
      try {
        const r = await call("GET", `/admin/tickets/${encodeURIComponent(t.id)}/photos/${n}`);
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, Buffer.from(r.data, "base64"));
      } catch (err) {
        console.warn("ticket photo download failed:", t.id, n, err.message);
      }
    }
  }
  const before = new Map(localTickets().map((t) => [t.id, t]));
  store.save("mjc-tickets", tickets.slice(0, 1000));
  for (const t of tickets) {
    if (!known.has(t.id)) { if (t.status === "open") onTicket?.(t); continue; }
    const old = before.get(t.id);
    const theirs = (x) => (x?.replies || []).filter((r) => r.from === "customer").length;
    if (theirs(t) > theirs(old)) onActivity?.(t, "reply");
    else if (t.offer?.answer && !old?.offer?.answer) onActivity?.(t, "answer");
  }
  return tickets;
}
/** A conversation still going (a message in the last half hour): checked every 30 s instead of every 5 minutes. */
export const liveConversation = () => localTickets().some((t) => t.status === "open" && Date.now() - Date.parse(t.updatedAt || t.created || 0) < 30 * 60000);

export const replyTicket = (id, text, by) => call("POST", `/admin/tickets/${encodeURIComponent(id)}/reply`, { text, by });
export const offerTicket = (id, offer) => call("PATCH", `/admin/tickets/${encodeURIComponent(id)}`, { offer });
export const reviews = async () => (await call("GET", "/admin/reviews")).reviews;
export const updateReview = (id, patch) => call("PATCH", `/admin/reviews/${encodeURIComponent(id)}`, patch);
export const pipQuestions = async () => (await call("GET", "/admin/pip-questions")).questions;
/** An email from the shop's own address (the weekly report). { sent, reason } */
export const sendEmail = (to, subject, text) => call("POST", "/admin/email", { to, subject, text });

export async function updateTicket(id, status) {
  await call("PATCH", `/admin/tickets/${encodeURIComponent(id)}`, { status });
  store.save("mjc-tickets", localTickets().map((t) => (t.id === id ? { ...t, status } : t)));
}
