// 11/12: Joseph's PC and his dad's Mac on ONE inventory. The merge rules on their own, then two real bots (two data
// folders, two servers) sharing a stand-in store that keeps the shared copy the way the real one does (a save lands only
// on the version it was merged from). Temp folders; no network beyond 127.0.0.1.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-team-unit-"));
const { merge3, fixSkus } = await import("../lib/team.js");

// ---------------------------------------------------------------- the merge rules

const card = (id, extra = {}) => ({ id, sku: "CRB-0001", name: `Card ${id}`, qty: 1, cost: 1, tags: [], ...extra });

test("a card added on each computer: both are in the shared copy", () => {
  const base = [card("a")];
  const out = merge3(base, [card("a"), card("mine")], [card("a"), card("theirs")]);
  assert.deepEqual(out.map((r) => r.id).sort(), ["a", "mine", "theirs"]);
});

test("different fields of the same card edited on each computer: both edits survive", () => {
  const base = [card("a")];
  const out = merge3(base, [card("a", { location: "Box 2" })], [card("a", { notes: "from the PC" })]);
  assert.equal(out[0].location, "Box 2");
  assert.equal(out[0].notes, "from the PC");
});

test("the same field edited on both: this computer's (the later save) wins; a tag added on each: both", () => {
  const out = merge3([card("a", { cost: 1, tags: ["x"] })], [card("a", { cost: 7, tags: ["x", "mine"] })], [card("a", { cost: 5, tags: ["x", "theirs"] })]);
  assert.equal(out[0].cost, 7);
  assert.deepEqual(out[0].tags.sort(), ["mine", "theirs", "x"]);
});

test("deleted on one computer: gone — unless the other edited it meanwhile (an edit is never lost)", () => {
  const base = [card("a"), card("b")];
  const deletedHere = merge3(base, [card("b")], base);
  assert.deepEqual(deletedHere.map((r) => r.id), ["b"]);
  const editedThere = merge3(base, [card("b")], [card("a", { notes: "sold it?" }), card("b")]);
  assert.deepEqual(editedThere.map((r) => r.id).sort(), ["a", "b"]);
  assert.equal(editedThere.find((r) => r.id === "a").notes, "sold it?");
});

test("newest-first lists (research, activity, alerts) keep this computer's new entries at the top", () => {
  const base = [{ at: "1", text: "old" }];
  const out = merge3(base, [{ at: "3", text: "mine" }, ...base], [{ at: "2", text: "theirs" }, ...base]);
  assert.deepEqual(out.map((x) => x.text), ["mine", "theirs", "old"]);
});

test("objects merge by key (settings, histories); nothing anywhere stays nothing", () => {
  assert.deepEqual(merge3({ a: 1, b: 1 }, { a: 2, b: 1 }, { a: 1, b: 3, c: 4 }), { a: 2, b: 3, c: 4 });
  assert.equal(merge3(undefined, undefined, undefined), undefined);
  assert.deepEqual(merge3(undefined, [card("a")], undefined), [card("a")], "the first computer's data starts the shared copy");
});

test("two cards given the same SKU on two computers at once: the one added here gets the next free number", () => {
  const theirs = [card("a", { sku: "CRB-0001" }), card("b", { sku: "CRB-0002" })];
  const merged = [...theirs, card("new", { sku: "CRB-0002" })];
  const mine = merged[2];
  const changed = fixSkus(merged, [theirs[0]], theirs);
  assert.deepEqual(changed, [{ id: "new", from: "CRB-0002", to: "CRB-0003" }]);
  assert.equal(merged[2].sku, "CRB-0003");
  assert.equal(mine.sku, "CRB-0002", "this computer's copy of the row isn't changed under it (a copy is)");
});

test("10,000 cards merge in well under a second", () => {
  const base = Array.from({ length: 10000 }, (_, i) => card("c" + i, { sku: "CRB-" + i, notes: "x".repeat(200), facts: { year: "2024", set: "Prizm", player: "P" + i } }));
  const mine = base.map((r, i) => (i % 500 === 0 ? { ...r, location: "Box 9" } : r));
  const theirs = [...base.map((r, i) => (i % 700 === 0 ? { ...r, cost: 3 } : r)), card("new")];
  const t = performance.now();
  const out = merge3(structuredClone(base), mine, theirs);
  const ms = performance.now() - t;
  assert.equal(out.length, 10001);
  assert.equal(out[0].location, "Box 9");
  assert.equal(out[0].cost, 3);
  assert.ok(ms < 1500, `took ${Math.round(ms)} ms`);
});

// ---------------------------------------------------------------- two bots, one stand-in store

const TOKEN = "t".repeat(64);
const files = new Map(); // name -> gzip bytes
const photos = new Map(); // key -> bytes
const etagOf = (b) => crypto.createHash("md5").update(b).digest("hex");
const items = [];
let forceStale = 0;
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const j = raw ? JSON.parse(raw) : {};
    const send = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const url = new URL(req.url, "http://x");
    if (url.pathname.startsWith("/img/")) return res.end(photos.get(url.pathname.slice(5)));
    if (url.pathname === "/health") return send(200, { ok: true, version: "1.2.0" });
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "Not authorized." });
    const m = url.pathname.match(/^\/admin\/team(?:\/([\w-]+))?$/);
    if (m && req.method === "GET" && !m[1]) return send(200, { collections: Object.fromEntries([...files].map(([n, b]) => [n, { etag: etagOf(b), bytes: b.length, at: new Date().toISOString() }])) });
    if (m && req.method === "GET") return files.has(m[1]) ? send(200, { etag: etagOf(files.get(m[1])), gz: files.get(m[1]).toString("base64") }) : send(404, { error: "none", missing: true });
    if (m && req.method === "PUT") {
      const cur = files.get(m[1]);
      if (j.ifMatch ? !cur || etagOf(cur) !== j.ifMatch : cur) return send(412, { error: "changed", changed: true });
      const b = Buffer.from(j.gz, "base64");
      JSON.parse(zlib.gunzipSync(b).toString("utf8"));
      files.set(m[1], b);
      return send(200, { ok: true, etag: etagOf(b) });
    }
    const p = url.pathname.match(/^\/admin\/photos\/([\w-]+)\/(\d+)$/);
    if (p) {
      const key = `${p[1]}-${p[2]}${j.variant === "thumb" ? "-t" : ""}.jpg`;
      photos.set(key, Buffer.from(j.data, "base64"));
      return send(200, { url: `http://127.0.0.1:${stub.address().port}/img/${key}` });
    }
    if (url.pathname === "/admin/items") {
      items.push(j);
      if (forceStale > 0) return forceStale--, send(409, { error: "stale", stale: true });
      const shared = files.get("inventory");
      if (shared && j.teamEtag !== undefined && j.teamEtag !== etagOf(shared)) return send(409, { error: "stale", stale: true });
      return send(200, { ok: true, upserted: j.items.length, unchanged: 0, removed: 0 });
    }
    if (url.pathname === "/admin/orders") return send(200, { orders: [] });
    if (url.pathname === "/admin/tickets") return send(200, { tickets: [] });
    if (url.pathname === "/admin/credits") return send(200, { credits: [] });
    send(200, { ok: true });
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const STORE = `http://127.0.0.1:${stub.address().port}`;

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const kids = [];
async function startBot({ connected, seed } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-team-srv-"));
  if (seed) seed(path.join(home, "data"));
  const port = 51000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, CARD_BOT_HOME: home, PORT: String(port), NO_BROWSER: "1", GEMINI_API_KEY: "", PSA_API_TOKEN: "", SHARE_ON_NETWORK: "0", MJC_API_URL: connected ? STORE : "", MJC_SYNC_TOKEN: connected ? TOKEN : "" }, stdio: ["ignore", "pipe", "pipe"] });
  kids.push(child);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const base = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server didn't start: " + out)), 15000);
    const check = () => {
      const mm = out.match(/running → (http:\/\/[^\s]+)/);
      if (mm) (clearTimeout(t), resolve(mm[1].replace(/\/$/, "")));
      else setTimeout(check, 100);
    };
    check();
  });
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
    return { status: r.status, data };
  };
  return { home, call, log: () => out };
}
const until = async (fn, ms = 10000) => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
};
const rows = async (bot) => (await bot.call("GET", "/api/inventory")).data;

const PHOTO_ROW = "seedphoto1";
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("a real card photo"), 0xff, 0xd9]);
let A, B;
after(() => { kids.forEach((k) => k.kill()); stub.close(); });

test("two computers, one inventory: start, invite, join, and every change reaches the other", { timeout: 120000 }, async (t) => {

  A = await startBot({
    connected: true,
    seed: (data) => {
      fs.mkdirSync(path.join(data, "photos", PHOTO_ROW), { recursive: true });
      fs.writeFileSync(path.join(data, "photos", PHOTO_ROW, "front.jpg"), JPEG);
      fs.writeFileSync(path.join(data, "inventory.json"), JSON.stringify([{ id: PHOTO_ROW, sku: "CRB-0001", name: "Doflamingo OP04-019", category: "onepiece", grade: "PSA 10", qty: 1, cost: 40, status: "in_stock", added: new Date().toISOString(), tags: [], photos: ["front.jpg"] }]));
    },
  });
  B = await startBot({ connected: false });

  // Joseph's PC starts the shared copy
  await A.call("POST", "/api/inventory", { name: "Caitlin Clark Prizm WNBA #22", category: "basketball", cost: 30 });
  await A.call("POST", "/api/inventory", { name: "Wembanyama Prizm #136", category: "basketball", cost: 50 });
  let p = (await A.call("GET", "/api/team/preview")).data;
  assert.equal(p.cloud.started, false);
  assert.equal(p.here.cards, 3);
  const joinedA = await A.call("POST", "/api/team/join", { mode: "merge", name: "Joseph's PC" });
  assert.equal(joinedA.status, 200, JSON.stringify(joinedA.data));
  assert.equal(joinedA.data.on, true);
  assert.ok(files.has("inventory"), "the shared copy is in the store");

  // Dad's Mac: one card of its own, then the invite code
  await B.call("POST", "/api/inventory", { name: "Dad's Griffey Upper Deck #1", category: "baseball", cost: 100 });
  const code = (await A.call("GET", "/api/team/invite")).data.code;
  assert.match(code, /^MJC1-/);
  p = (await B.call("GET", "/api/team/preview?invite=" + encodeURIComponent(code))).data;
  assert.equal(p.cloud.started, true);
  assert.equal(p.cloud.cards, 3);
  assert.equal(p.here.cards, 1);
  const joinedB = await B.call("POST", "/api/team/join", { mode: "merge", name: "Dad's Mac" });
  assert.equal(joinedB.status, 200, JSON.stringify(joinedB.data));
  assert.equal((await rows(B)).length, 4, "Dad's card joined the three from the PC");
  await A.call("POST", "/api/team/sync");
  const onA = await rows(A);
  assert.equal(onA.length, 4, "…and the PC has Dad's card");
  assert.equal(new Set(onA.map((r) => r.sku)).size, 4, "Dad's CRB-0001 got a free number instead of sharing the PC's");

  // the same card edited on both computers: different fields both stay; the same field → the later save
  const clark = onA.find((r) => /Clark/.test(r.name));
  await A.call("PATCH", `/api/inventory/${clark.id}`, { notes: "centering looks 10", cost: 5 });
  await B.call("PATCH", `/api/inventory/${clark.id}`, { location: "Box 2", cost: 7 });
  await A.call("POST", "/api/team/sync");
  await B.call("POST", "/api/team/sync");
  await A.call("POST", "/api/team/sync");
  for (const bot of [A, B]) {
    const r = (await bot.call("GET", `/api/inventory/${clark.id}`)).data;
    assert.equal(r.notes, "centering looks 10");
    assert.equal(r.location, "Box 2");
    assert.equal(r.cost, 7);
  }

  // a card added on each at the same moment (both would be CRB-0005): both kept, different SKUs
  await A.call("POST", "/api/inventory", { name: "PC card", category: "football" });
  await B.call("POST", "/api/inventory", { name: "Mac card", category: "football" });
  await A.call("POST", "/api/team/sync");
  await B.call("POST", "/api/team/sync");
  await A.call("POST", "/api/team/sync");
  const fa = await rows(A), fb = await rows(B);
  assert.equal(fa.length, 6);
  assert.deepEqual(fa.map((r) => r.id).sort(), fb.map((r) => r.id).sort());
  assert.equal(new Set(fa.map((r) => r.sku)).size, 6);

  // the activity feed is shared and says which computer did what
  const act = (await B.call("GET", "/api/activity")).data;
  const who = new Set((Array.isArray(act) ? act : act.items || []).map((x) => x.who));
  assert.ok(who.has("Joseph's PC") && who.has("Dad's Mac"), [...who].join(", "));
});

test("photos: the PC's card photo goes up, and the Mac downloads it", { timeout: 60000 }, async () => {
  assert.ok(await until(async () => (await A.call("GET", `/api/inventory/${PHOTO_ROW}`)).data.photoUrls?.["front.jpg"]), "the PC uploaded it: " + A.log().slice(-800));
  await A.call("POST", "/api/team/sync");
  await B.call("POST", "/api/team/sync");
  const file = path.join(B.home, "data", "photos", PHOTO_ROW, "front.jpg");
  assert.ok(await until(() => fs.existsSync(file)), "the Mac has the photo file");
  assert.deepEqual(fs.readFileSync(file), JPEG);
});

test("the daily jobs run on exactly one computer, and can be moved", { timeout: 30000 }, async () => {
  let a = (await A.call("GET", "/api/team")).data, b = (await B.call("GET", "/api/team")).data;
  assert.equal(a.runsJobs, true, "the computer that started sharing runs them");
  assert.equal(b.runsJobs, false);
  assert.equal(b.jobs.name, "Joseph's PC");
  await B.call("POST", "/api/team/jobs");
  await A.call("POST", "/api/team/sync");
  a = (await A.call("GET", "/api/team")).data;
  b = (await B.call("GET", "/api/team")).data;
  assert.equal(b.runsJobs, true);
  assert.equal(a.runsJobs, false);
  assert.equal(a.devices.length, 2);
});

test("the website sync says which shared copy it's built from, and builds again when the other computer was faster", { timeout: 30000 }, async () => {
  const clark = (await rows(A)).find((r) => /Clark/.test(r.name));
  await A.call("PATCH", `/api/inventory/${clark.id}`, { web: true, webMode: "fixed", webFixedPrice: 24.99 });
  await A.call("POST", "/api/team/sync");
  items.length = 0;
  forceStale = 1; // the other computer saved a newer copy a moment before this sync
  const r = await B.call("POST", "/api/mjc/sync");
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(items.length, 2, "refused once, then built again and taken");
  const last = items.at(-1);
  assert.equal(last.teamEtag, etagOf(files.get("inventory")));
  assert.deepEqual(last.items.map((x) => x.title), ["Caitlin Clark Prizm WNBA #22"], "the card the PC put on the site, from the Mac's sync");
});

test("stop sharing on one computer: it keeps its copy and stops sending", { timeout: 30000 }, async () => {
  const before = files.get("inventory");
  const left = await B.call("POST", "/api/team/leave");
  assert.equal(left.data.on, false);
  await B.call("POST", "/api/inventory", { name: "Only on the Mac now", category: "other" });
  await B.call("POST", "/api/team/sync");
  assert.equal(files.get("inventory"), before, "nothing went up");
  assert.equal((await rows(B)).length, 7, "the Mac kept everything");
});

test("the store moves to another AWS account: the bot puts its photos and store details in the new one", { timeout: 30000 }, async () => {
  // the new store (a second stand-in): it records the photos and store details it's given
  const got = { photos: [], store: null, items: [] };
  const fresh = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const j = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
      const send = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
      const url = new URL(req.url, "http://x");
      if (url.pathname.startsWith("/img/")) return res.end(JPEG);
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "Not authorized." });
      const p = url.pathname.match(/^\/admin\/photos\/([\w-]+)\/(\d+)$/);
      if (p) return got.photos.push(p[1]), send(200, { url: `http://127.0.0.1:${fresh.address().port}/img/${p[1]}-${p[2]}${j.variant === "thumb" ? "-t" : ""}.jpg` });
      if (url.pathname === "/admin/store") return (got.store = j), send(200, { ok: true });
      if (url.pathname === "/admin/items") return got.items.push(j), send(200, { ok: true, upserted: j.items.length, unchanged: 0, removed: 0 });
      if (url.pathname === "/admin/team") return send(200, { collections: {} });
      if (url.pathname === "/admin/orders") return send(200, { orders: [] });
      if (url.pathname === "/admin/tickets") return send(200, { tickets: [] });
      if (url.pathname === "/admin/credits") return send(200, { credits: [] });
      send(200, { ok: true });
    });
  });
  await new Promise((r) => fresh.listen(0, "127.0.0.1", r));
  after(() => fresh.close());
  const NEW_STORE = `http://127.0.0.1:${fresh.address().port}`;

  // the Mac (not sharing any more) has the photo file, and its address is the old store's
  const old = (await B.call("GET", `/api/inventory/${PHOTO_ROW}`)).data;
  assert.match(old.photoUrls?.["front.jpg"] || "", new RegExp("^" + STORE));
  await B.call("PATCH", `/api/inventory/${PHOTO_ROW}`, { web: true, webMode: "fixed", webFixedPrice: 139.99 });
  const details = { name: "MJC Sports Cards", shipping: "Ships in 2 days", returns: "30 days" };
  assert.equal((await B.call("PUT", "/api/mjc/store", details)).status, 200);

  // a wrong address leaves the store that works connected
  const bad = await B.call("POST", "/api/mjc/connect", { apiUrl: "http://127.0.0.1:1", token: TOKEN });
  assert.equal(bad.status, 400);
  assert.equal((await B.call("GET", `/api/inventory/${PHOTO_ROW}`)).data.photoUrls["front.jpg"], old.photoUrls["front.jpg"], "nothing forgotten on a failed connect");

  const moved = await B.call("POST", "/api/mjc/connect", { apiUrl: NEW_STORE, token: TOKEN });
  assert.equal(moved.status, 200, JSON.stringify(moved.data));
  assert.equal(got.store?.shipping, "Ships in 2 days", "the store details went to the new store");
  assert.equal((await B.call("GET", `/api/inventory/${PHOTO_ROW}`)).data.photoUrls?.["front.jpg"], undefined, "the old store's address is forgotten (the file is here)");

  const synced = await B.call("POST", "/api/mjc/sync");
  assert.equal(synced.status, 200, JSON.stringify(synced.data));
  assert.ok(got.photos.includes(PHOTO_ROW), "the photo went up to the new store");
  const now = (await B.call("GET", `/api/inventory/${PHOTO_ROW}`)).data;
  assert.match(now.photoUrls["front.jpg"], new RegExp("^" + NEW_STORE));
  const sent = got.items.flatMap((x) => x.items || []).find((x) => x.id === PHOTO_ROW);
  assert.ok(sent?.photos?.[0]?.startsWith(NEW_STORE), "the website gets the new store's photo address: " + JSON.stringify(sent?.photos));
});
