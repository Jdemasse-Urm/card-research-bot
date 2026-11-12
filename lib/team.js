// Shared inventory: Joseph's PC and his dad's Mac work on ONE set of business data — cards, sales, customers, expenses,
// shows, research — instead of one each.
//
// What already did part of this, and why this file exists (the golden rule's three questions):
//   1. Nothing shared business data between computers: each bot kept its own JSON files (lib/store.js) and pushed only its
//      on-site cards to the website (lib/mjc.js). The store already lived in the cloud, so the shared copy lives THERE
//      (a private team/ folder of the store's bucket) — no new server, no new account, the same sync key.
//   2. It owns no data another part owns: lib/store.js stays the one place every read and write goes; this only keeps the
//      cloud copy and this computer's files in step. The website sync stays lib/mjc.js's — it just says which shared copy
//      it was built from, so a stale one can't take the other computer's new cards off the site.
//   3. Built because the existing parts can't do it at all, not to avoid reading them.
//
// How it works:
//   · every save marks a collection changed (store.hooks.saved) → pushed within ~2 s; every 20 s one call lists the
//     cloud's versions, and a collection the other computer changed is pulled.
//   · merge = three-way: what both computers last agreed on (the "base", kept in team-base/), this computer's copy, the
//     cloud's. A card added or edited on one computer and another card (or another field of the same card) on the other
//     both survive; the same field edited on both → this computer's edit, the later save, wins; a card edited on one and
//     deleted on the other is kept (an edit is never lost).
//   · a save names the cloud version it was merged with and lands only if that's still the newest (the store checks), so
//     two computers saving at the same moment can't overwrite each other: the second merges again and saves again.
//   · each computer keeps a FULL working copy: fast, works offline (it catches up when back), and its own daily backups.
//   · one computer runs the daily jobs (re-pricing, the website's orders, PSA checks, value history) so nothing runs twice;
//     if it's been off for 20 minutes the other one takes over by itself.
//   · photos: this computer's card photos go up to the store's photo folder (the address is kept on the card), and the
//     other computer's come down — so both see every card's pictures.

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import * as store from "./store.js";
import * as mjc from "./mjc.js";

const VERSION = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8")).version;
  } catch {
    return "";
  }
})();

/**
 * The business's data — shared. What stays on each computer: its Google AI spend and caches, the phone's scan list and
 * scan feedback, Undo/trash, saved views, the website connection state and the copies of its messages (pulled from the
 * store by each computer).
 */
export const SHARED = [
  "inventory", "inventory-changes", "inventory-history", "lookups", "watchlist", "hot", "submissions", "expenses", "portfolio",
  "activity", "alerts", "wantlist", "advice", "pricing-obs", "pricing-settings", "pricing-model", "pricing-last-run",
  "mjc-store", "mjc-orders", "show-sales", "box-breaks", "pop-watch", "customers", "grading-orders", "shows", "supplies",
  "shop-settings", "live", "live-sessions", "sales-imports", "drop-announced", "weekly-state", "check-state", "team",
];
const SHARED_SET = new Set(SHARED);
const BASE_DIR = path.join(store.DATA_DIR, "team-base");
const PULL_EVERY = 20e3; // how often the cloud's versions are listed (one small call)
const PUSH_AFTER = 1500; // a save is pushed this long after the last of a burst
const HEARTBEAT = 5 * 60e3; // this computer says it's on, at most this often
const TAKEOVER = 20 * 60e3; // the daily-jobs computer silent this long → this one takes the jobs over
const FRESH = 3 * 60e3; // the jobs run only on a view of the shared data at most this old
const MAX_GZ = 3.9e6; // the store takes 4 MB of gzip per collection

// ------------------------------------------------------------------ merging (exported for the tests)

const isPlain = (x) => x != null && typeof x === "object" && !Array.isArray(x);
/** JSON with object keys sorted: two computers can write the same card with its fields in a different order. */
export const stable = (x) => (x === undefined ? "\u0000" : JSON.stringify(x, (_k, v) => (isPlain(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v)));
export const same = (a, b) => a === b || stable(a) === stable(b);
const rowKey = (x) => (isPlain(x) && (typeof x.id === "string" || typeof x.id === "number") ? "#" + x.id : "=" + stable(x));

/**
 * Three-way merge: b = what both computers last agreed on, m = this computer's copy, t = the cloud's. undefined = absent.
 * Lists merge by row (a row's id, or the whole row when it has none); objects by key; the same field changed on both → m.
 */
export function merge3(b, m, t, depth = 0) {
  if (same(m, b)) return t; // only the other computer changed it (or nobody did)
  if (same(t, b) || same(m, t)) return m; // only this computer changed it (or both the same way)
  if (m === undefined) return t; // deleted here, edited there → keep the edit
  if (t === undefined) return m;
  if (depth < 4) {
    if (Array.isArray(m) && Array.isArray(t)) return mergeList(Array.isArray(b) ? b : [], m, t, depth);
    if (isPlain(m) && isPlain(t)) return mergeObj(isPlain(b) ? b : {}, m, t, depth);
  }
  return m;
}

function mergeObj(b, m, t, depth) {
  const out = {};
  for (const k of new Set([...Object.keys(t), ...Object.keys(m), ...Object.keys(b)])) {
    const v = merge3(b[k], m[k], t[k], depth + 1);
    if (v !== undefined) out[k] = v;
  }
  return out;
}

function mergeList(b, m, t, depth) {
  const index = (list) => {
    const map = new Map();
    for (const x of list) map.set(rowKey(x), x);
    return map;
  };
  const B = index(b), M = index(m), T = index(t);
  const merged = new Map();
  for (const k of new Set([...T.keys(), ...M.keys(), ...B.keys()])) {
    const v = merge3(B.get(k), M.get(k), T.get(k), depth + 1);
    if (v !== undefined) merged.set(k, v);
  }
  // Order: the cloud's, then this computer's new rows — at the front when they were added at the front here (newest-first
  // lists: research, activity, alerts, orders), otherwise at the end.
  const out = [];
  const used = new Set();
  const firstShared = m.findIndex((x) => T.has(rowKey(x)));
  const mineOnly = m.map(rowKey).filter((k) => !T.has(k) && merged.has(k));
  const front = mineOnly.filter((k) => firstShared > 0 && m.findIndex((x) => rowKey(x) === k) < firstShared);
  for (const k of front) out.push(merged.get(k)), used.add(k);
  for (const k of T.keys()) if (merged.has(k) && !used.has(k)) out.push(merged.get(k)), used.add(k);
  for (const k of merged.keys()) if (!used.has(k)) out.push(merged.get(k)), used.add(k);
  return out;
}

const skuNum = (r) => parseInt(String(r?.sku || "").replace(/\D/g, ""), 10) || 0;
/**
 * Both computers number new cards CRB-0001, CRB-0002… on their own, so two cards added at the same moment can get the same
 * SKU: the card this computer added keeps its place and gets the next free number (the label hasn't gone anywhere yet).
 */
export function fixSkus(merged, base, theirs) {
  const known = new Set([...(Array.isArray(base) ? base : []), ...(Array.isArray(theirs) ? theirs : [])].map((r) => r?.id));
  const owner = new Map();
  for (const r of merged) if (r?.sku && known.has(r.id)) owner.set(r.sku, r.id);
  let max = merged.reduce((n, r) => Math.max(n, skuNum(r)), 0);
  const changed = [];
  for (let i = 0; i < merged.length; i++) {
    const r = merged[i];
    if (!r?.sku || known.has(r.id)) continue;
    if (owner.has(r.sku) && owner.get(r.sku) !== r.id) {
      // a copy of the row: the merged list shares its rows with this computer's copy, which must stay as it was read
      merged[i] = { ...r, sku: "CRB-" + String(++max).padStart(4, "0") };
      changed.push({ id: r.id, from: r.sku, to: merged[i].sku });
    }
    owner.set(merged[i].sku, r.id);
  }
  return changed;
}

// ------------------------------------------------------------------ this computer's state (never shared)

const state = () => store.load("team-state", {}) || {};
const setState = (patch) => store.save("team-state", { ...state(), ...patch });

/** This computer: a random id made once, and the name both computers see ("Joseph's PC", "Dad's Mac"). */
export function device() {
  const st = state();
  if (st.device?.id) return st.device;
  const d = { id: crypto.randomBytes(6).toString("hex"), name: process.platform === "darwin" ? "Mac" : process.platform === "win32" ? "Windows PC" : "This computer" };
  setState({ device: d });
  return d;
}
export const on = () => Boolean(state().on && mjc.configured());
/** Who did it, in the shared activity feed (with sharing off it's just "This computer"). */
export const deviceName = () => (on() ? device().name : "This computer");
export const etag = (name) => state().etags?.[name] ?? null;

const stampOf = (name) => {
  try {
    const st = fs.statSync(path.join(store.DATA_DIR, `${name}.json`));
    return `${st.mtimeMs}:${st.size}`;
  } catch {
    return "none";
  }
};
const baseFile = (name) => path.join(BASE_DIR, `${name}.json`);
function readBase(name) {
  try {
    return JSON.parse(fs.readFileSync(baseFile(name), "utf8"));
  } catch {
    return undefined;
  }
}
function writeBase(name, value) {
  fs.mkdirSync(BASE_DIR, { recursive: true });
  fs.writeFileSync(baseFile(name) + ".tmp", JSON.stringify(value));
  fs.renameSync(baseFile(name) + ".tmp", baseFile(name));
}
function forgetAgreement() {
  fs.rmSync(BASE_DIR, { recursive: true, force: true });
  setState({ etags: {}, stamps: {} });
}

// ------------------------------------------------------------------ the cloud copy

const listRemote = async () => (await mjc.call("GET", "/admin/team")).collections || {};
async function getRemote(name) {
  try {
    const r = await mjc.call("GET", `/admin/team/${name}`);
    return { etag: r.etag, data: JSON.parse(zlib.gunzipSync(Buffer.from(r.gz, "base64")).toString("utf8")) };
  } catch (err) {
    if (err.status === 404) return null;
    throw err;
  }
}
async function putRemote(name, value, ifMatch) {
  const gz = zlib.gzipSync(JSON.stringify(value));
  if (gz.length > MAX_GZ) throw new Error(`The shared ${name} is too big for one file (${Math.round(gz.length / 1e6)} MB packed) — tell Claude.`);
  try {
    return await mjc.call("PUT", `/admin/team/${name}`, { gz: gz.toString("base64"), ifMatch: ifMatch || null });
  } catch (err) {
    if (err.status === 412) return null; // the other computer saved first: merge again
    throw err;
  }
}

// ------------------------------------------------------------------ one collection in step

let applying = false; // this file's own writes don't count as "changed here"
async function syncOne(name, remoteEtag) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const st = state();
    const base = readBase(name);
    let theirs, theirEtag = remoteEtag || null;
    if (!theirEtag) theirs = undefined;
    else if (theirEtag === st.etags?.[name] && base !== undefined) theirs = base; // the cloud still has what we agreed on
    else {
      const r = await getRemote(name);
      theirs = r ? r.data : undefined;
      theirEtag = r ? r.etag : null;
    }
    const mine = store.load(name, undefined);
    let merged = merge3(base, mine, theirs);
    let skus = [];
    if (name === "inventory" && Array.isArray(merged)) {
      if (merged === mine || merged === theirs) merged = [...merged];
      skus = fixSkus(merged, base, theirs);
    }
    let agreed = theirEtag;
    if (merged !== undefined && !same(merged, theirs)) {
      const put = await putRemote(name, merged, theirEtag);
      if (!put) {
        remoteEtag = (await listRemote())[name]?.etag || null;
        continue;
      }
      agreed = put.etag;
    }
    // From here to the return nothing awaits, so an edit made on this computer can't slip in between the read and the write.
    const now = store.load(name, undefined);
    const local = same(now, mine) ? merged : merge3(mine, now, merged); // edits made while we talked to the cloud stay
    const pulled = !same(local, now);
    if (pulled && local !== undefined) {
      applying = true;
      try {
        store.save(name, local);
      } finally {
        applying = false;
      }
    }
    if (merged !== undefined) writeBase(name, merged);
    const s = state();
    setState({ etags: { ...s.etags, [name]: agreed }, stamps: { ...s.stamps, [name]: same(local, merged) ? stampOf(name) : "pending" } });
    for (const x of skus) store.logActivity(deviceName(), `card ${x.from} was also used on the other computer — this one is now ${x.to}`);
    return { pulled, pushed: agreed !== theirEtag };
  }
  throw new Error(`The shared ${name} kept changing on the other computer — trying again shortly.`);
}

// ------------------------------------------------------------------ the sync loop

let cycle = null, again = false, timer = null, listeners = { jobs: null, pulled: null };
/** Bring every shared collection in step now (one at a time; a call made meanwhile runs once more after). */
export function syncNow() {
  if (!on()) return Promise.resolve(null);
  if (cycle) return (again = true), cycle;
  cycle = run()
    .then((r) => {
      setState({ lastSyncAt: new Date().toISOString(), lastError: null, failures: 0 });
      return r;
    })
    .catch((err) => {
      const failures = (state().failures || 0) + 1;
      setState({ lastError: err.message, lastErrorAt: new Date().toISOString(), failures });
      // never silent: the third failure in a row (a minute of trying) tells the owner once, until it works again
      if (failures === 3) store.addAlert({ kind: "team", name: "Shared inventory isn't syncing", text: `This computer couldn't reach the shared copy (${err.message}). Your changes are safe here and go up as soon as it works — MJC store → Setup shows the error.` });
      throw err;
    })
    .finally(() => {
      cycle = null;
      if (again) (again = false), schedule(300);
    });
  return cycle;
}
function schedule(ms = PUSH_AFTER) {
  clearTimeout(timer);
  timer = setTimeout(() => syncNow().catch(() => {}), ms);
}

async function run() {
  // A different store (the business moved to its own AWS account): start over by merging with whatever is there.
  if (state().url && state().url !== mjc.apiUrl()) forgetAgreement();
  setState({ url: mjc.apiUrl() });
  const remote = await listRemote();
  const st = state();
  const out = { pulled: [], pushed: [] };
  for (const name of SHARED) {
    const r = remote[name]?.etag || null;
    const changedHere = stampOf(name) !== (st.stamps?.[name] ?? "");
    const changedThere = r !== (st.etags?.[name] ?? null);
    if (!changedHere && !changedThere) continue;
    const x = await syncOne(name, r);
    if (x.pulled) out.pulled.push(name);
    if (x.pushed) out.pushed.push(name);
  }
  if (heartbeat()) await syncOne("team", (await listRemote()).team?.etag || null);
  if (out.pulled.length) listeners.pulled?.(out.pulled);
  if (out.pulled.includes("inventory") || out.pushed.includes("inventory") || !photosChecked) photos().catch((err) => console.warn("shared photos:", err.message));
  return out;
}

/** This computer is on (every 5 minutes at most), and who runs the daily jobs (taken over after 20 silent minutes). */
function heartbeat() {
  const me = device();
  const t = store.load("team", {}) || {};
  const now = Date.now(), at = new Date().toISOString();
  const devices = { ...(t.devices || {}) };
  let changed = false, took = false;
  const seen = devices[me.id];
  if (!seen || now - Date.parse(seen.seenAt || 0) > HEARTBEAT || seen.name !== me.name || seen.version !== VERSION) {
    devices[me.id] = { name: me.name, platform: process.platform, version: VERSION, seenAt: at };
    changed = true;
  }
  let jobs = t.jobs || null;
  const age = jobs ? now - Date.parse(jobs.at || 0) : Infinity;
  if (!jobs || (jobs.device !== me.id && age > TAKEOVER)) (jobs = { device: me.id, name: me.name, at }), (changed = took = true);
  else if (jobs.device === me.id && (age > HEARTBEAT || jobs.name !== me.name)) (jobs = { ...jobs, name: me.name, at }), (changed = true);
  if (!changed) return false;
  applying = true;
  try {
    store.save("team", { ...t, devices, jobs });
  } finally {
    applying = false;
  }
  if (took) setTimeout(() => listeners.jobs?.(), 3000);
  return true;
}

/**
 * Does THIS computer run the daily jobs? Sharing off: yes (it's the only one). Sharing on: only the chosen computer, and
 * only on a view of the shared data fresh from the cloud — a computer just woken from sleep must not run them on its old
 * copy while the other one has taken over.
 */
export function runsJobs() {
  // not sharing, but the store's inventory IS shared (this computer is connected and never joined, or left): the computer
  // that is on it runs the jobs — this one pulling website orders would record the sales on a copy nobody else sees
  if (!on()) return !state().storeShared;
  const st = state();
  const t = store.load("team", {}) || {};
  return t.jobs?.device === device().id && Date.now() - Date.parse(st.lastSyncAt || 0) < FRESH;
}
/**
 * Is another computer working on this store's shared inventory (seen in the last 3 days)? Checked at most every 10 minutes
 * while this one isn't on it. Nobody else on it (this computer left, or it was only ever this one) → this one runs the jobs.
 */
let sharedCheckedAt = 0;
export async function checkShared() {
  if (on() || !mjc.configured() || Date.now() - sharedCheckedAt < 10 * 60e3) return;
  sharedCheckedAt = Date.now();
  try {
    const remote = await listRemote();
    if (!remote.inventory) return setState({ storeShared: false });
    const t = remote.team ? (await getRemote("team"))?.data : null;
    const me = device().id;
    const others = Object.entries(t?.devices || {}).filter(([id, d]) => id !== me && Date.now() - Date.parse(d.seenAt || 0) < 3 * 86400000);
    setState({ storeShared: !t || others.length > 0 });
  } catch (err) {
    if (err.status === 404) setState({ storeShared: false }); // a store from before shared inventory
  }
}
export const markShared = () => setState({ storeShared: true });

/** "Run the daily jobs on this computer". */
export async function takeJobs() {
  const me = device();
  const t = store.load("team", {}) || {};
  store.save("team", { ...t, jobs: { device: me.id, name: me.name, at: new Date().toISOString() } });
  await syncNow();
  setTimeout(() => listeners.jobs?.(), 1000);
  return status();
}

// ------------------------------------------------------------------ photos both ways

let photosChecked = false;
async function photos() {
  photosChecked = true;
  const rows = store.inventoryView();
  // up: this computer's photos the other computer can't see yet (10 cards a round; the rows get the addresses → pushed)
  const up = rows.filter((r) => (r.photos || []).some((f) => !r.photoUrls?.[f] && fs.existsSync(mjc.photoPath(r.id, f)))).slice(0, 10);
  for (const r of up) await mjc.uploadPhotos(r).catch((err) => console.warn("photo upload:", r.id, err.message));
  // down: the other computer's photos this one doesn't have (60 files a round, 4 at a time)
  const need = [];
  for (const r of rows) {
    for (const f of r.photos || []) {
      for (const [file, url] of [[f, r.photoUrls?.[f]], [mjc.thumbName(f), r.thumbUrls?.[f]]]) {
        if (url && /^https:\/\/|^http:\/\/127\.0\.0\.1[:/]/.test(url) && !fs.existsSync(mjc.photoPath(r.id, file))) need.push([mjc.photoPath(r.id, file), url]);
      }
    }
    if (need.length >= 60) break;
  }
  for (let i = 0; i < need.length; i += 4) {
    await Promise.all(need.slice(i, i + 4).map(async ([file, url]) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file + ".tmp", Buffer.from(await res.arrayBuffer()));
        fs.renameSync(file + ".tmp", file);
      } catch (err) {
        console.warn("photo download:", url, err.message);
      }
    }));
  }
  if (up.length === 10 || need.length >= 60) setTimeout(() => photos().catch(() => {}), 2000); // more to do
}

// ------------------------------------------------------------------ joining, leaving, the invite code

/** What joining would do: the cloud's copy and this computer's, counted. */
export async function preview() {
  if (!mjc.configured()) throw new Error("Connect to the MJC store first (the address and sync key just above).");
  let remote;
  try {
    remote = await listRemote();
  } catch (err) {
    if (err.status === 404) throw new Error("The store needs an update before it can share the inventory (store 1.2.0 — ask Claude to deploy it).");
    throw err;
  }
  const inv = remote.inventory ? await getRemote("inventory") : null;
  const cards = (list) => (Array.isArray(list) ? list.filter((r) => r.status !== "sold").length : 0);
  return {
    cloud: { started: Boolean(remote.inventory), cards: cards(inv?.data), rows: inv?.data?.length || 0, at: remote.inventory?.at || null, devices: Object.values((remote.team && (await getRemote("team"))?.data?.devices) || {}).map((d) => d.name) },
    here: { cards: cards(store.inventoryView()), rows: store.inventoryView().length },
  };
}

/**
 * Join (or start) the shared inventory. merge = this computer's data joins the shared copy (nothing is lost on either side);
 * replace = this computer takes the shared copy as it is (what was here stays in today's backup file).
 */
export async function join({ mode = "merge", name } = {}) {
  await preview(); // the store is reachable and new enough
  store.dailyBackup({ force: true });
  const me = device();
  const nm = store.clean.str(name, 40);
  if (nm) setState({ device: { ...me, name: nm } });
  forgetAgreement();
  if (mode === "replace") {
    const remote = await listRemote();
    applying = true;
    try {
      for (const n of SHARED) {
        if (!remote[n]) continue;
        const r = await getRemote(n);
        if (!r) continue;
        store.save(n, r.data);
        writeBase(n, r.data);
        const s = state();
        setState({ etags: { ...s.etags, [n]: r.etag }, stamps: { ...s.stamps, [n]: stampOf(n) } });
      }
    } finally {
      applying = false;
    }
  }
  setState({ on: true, url: mjc.apiUrl(), joinedAt: new Date().toISOString(), failures: 0, lastError: null });
  photosChecked = false;
  await syncNow();
  store.logActivity(deviceName(), mode === "replace" ? "joined the shared inventory (took the shared copy)" : "joined the shared inventory");
  return status();
}
/** Stop sharing on this computer (it keeps its copy; nothing is deleted anywhere). */
export function leave() {
  setState({ on: false });
  sharedCheckedAt = 0; // is the other computer still on it? (then it keeps the jobs; if not, this one runs them again)
  store.logActivity(device().name, "stopped sharing the inventory on this computer");
  return status();
}
export function rename(name) {
  const nm = store.clean.str(name, 40);
  if (!nm) throw new Error("Give this computer a name, e.g. Dad's Mac.");
  setState({ device: { ...device(), name: nm } });
  schedule(200);
  return status();
}

/** One code that connects another computer to the same store (its address + sync key). Send it only to your dad. */
export function invite() {
  if (!mjc.configured()) throw new Error("Connect to the MJC store first.");
  return "MJC1-" + Buffer.from(JSON.stringify({ u: mjc.apiUrl(), k: process.env.MJC_SYNC_TOKEN })).toString("base64url");
}
export function readInvite(code) {
  const m = String(code || "").trim().match(/^MJC1-([\w-]+)$/);
  if (!m) throw new Error("That isn't an invite code — it starts with MJC1-.");
  try {
    const j = JSON.parse(Buffer.from(m[1], "base64url").toString("utf8"));
    if (!/^https:\/\//.test(j.u) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(j.u)) throw new Error();
    if (!/^[\w-]{20,200}$/.test(j.k)) throw new Error();
    return { apiUrl: j.u, token: j.k };
  } catch {
    throw new Error("That invite code is damaged — copy it again.");
  }
}

export function status() {
  const st = state();
  const t = store.load("team", {}) || {};
  const me = device();
  return {
    on: on(),
    configured: mjc.configured(),
    device: me,
    jobs: t.jobs || null,
    runsJobs: runsJobs(),
    devices: Object.entries(t.devices || {}).map(([id, d]) => ({ id, ...d, me: id === me.id })).sort((a, b) => (a.seenAt < b.seenAt ? 1 : -1)),
    lastSyncAt: st.lastSyncAt || null,
    lastError: st.lastError || null,
    failures: st.failures || 0,
    syncing: Boolean(cycle),
    pending: SHARED.filter((n) => st.stamps?.[n] === "pending" || (st.on && st.stamps?.[n] !== undefined && stampOf(n) !== st.stamps[n])),
  };
}

/** Called once by the server: pushes follow saves, the cloud is checked every 20 s. */
export function start({ onJobs, onPulled } = {}) {
  listeners = { jobs: onJobs || null, pulled: onPulled || null };
  store.hooks.saved = (name) => {
    if (!applying && SHARED_SET.has(name) && on()) schedule();
  };
  setInterval(() => {
    if (on() && !cycle) syncNow().catch(() => {});
  }, PULL_EVERY).unref?.();
  setTimeout(() => syncNow().catch(() => {}), 3000).unref?.();
}
