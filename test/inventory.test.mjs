// Organising the inventory: bulk edit + undo, merging duplicate rows, lot cost splits, stock counts, the data
// check, the history split (rows stay small), and the HTTP routes the Stock / Locations / Bulk scan screens
// use. Temp data folder; the route tests start the real server on a spare port (no network calls).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-inv-"));
const store = await import("../lib/store.js");
const find = (id) => store.inventory().find((r) => r.id === id);

test("bulk edit changes only what was filled in, records who did it, and undo puts every card back", () => {
  const a = store.addInventory({ name: "Card A", location: "Box 1", tags: ["pc"] });
  const b = store.addInventory({ name: "Card B", location: "Box 2", cost: 5 });
  const r = store.updateMany([a.id, b.id], { location: "Box 9", addTags: ["flip"] }, "Jeff");
  assert.equal(r.updated, 2);
  assert.equal(find(a.id).location, "Box 9");
  assert.deepEqual(find(a.id).tags, ["pc", "flip"]);
  assert.equal(find(b.id).cost, 5, "cost wasn't in the patch");
  const c = store.cardHistory(a.id).c.at(-1);
  assert.equal(c.by, "Jeff");
  assert.deepEqual(c.f.location, ["Box 1", "Box 9"]);
  assert.ok(store.undoBulk(r.token));
  assert.equal(find(a.id).location, "Box 1");
  assert.deepEqual(find(a.id).tags, ["pc"]);
  assert.equal(find(b.id).location, "Box 2");
  assert.equal(store.undoBulk(r.token), false, "an undo is used once");
});

test("merging the same card on several rows adds the quantities and averages the cost; undo restores the rows", () => {
  const x = store.addInventory({ name: "Wemby Prizm #136", grade: "Raw", qty: 1, cost: 10, tags: ["a"] });
  const y = store.addInventory({ name: "Wemby Prizm #136", grade: "Raw", qty: 3, cost: 30, tags: ["b"] });
  const m = store.mergeRows([x.id, y.id], "Joe");
  assert.equal(m.kept.qty, 4);
  assert.equal(m.kept.cost, 25); // (10×1 + 30×3) / 4
  assert.deepEqual(m.kept.tags, ["a", "b"]);
  assert.equal(find(y.id), undefined);
  assert.ok(store.undoBulk(m.token));
  assert.equal(find(x.id).qty, 1);
  assert.equal(find(x.id).cost, 10);
  assert.equal(find(y.id).qty, 3);
  assert.equal(store.mergeRows([x.id], null), null, "one row can't be merged");
});

test("a lot's cost split card by card is one undoable write", () => {
  const p = store.addInventory({ name: "Lot 1", cost: 0 });
  const q = store.addInventory({ name: "Lot 2", cost: 0 });
  const r = store.updateEach([{ id: p.id, cost: 75 }, { id: q.id, cost: 25 }], "Jeff");
  assert.equal(r.updated, 2);
  assert.equal(find(p.id).cost, 75);
  assert.ok(store.undoBulk(r.token));
  assert.equal(find(p.id).cost, 0);
});

test("a stock count marks cards counted and moves the ones found in the wrong box; locations add up", () => {
  const s1 = store.addInventory({ name: "Counted", location: "Shelf", qty: 2, cost: 4, value: 10 });
  const s2 = store.addInventory({ name: "Strayed", location: "Elsewhere", qty: 1, cost: 1 });
  const r = store.markCounted([s1.id, s2.id], "Shelf", "Jeff");
  assert.deepEqual(r, { counted: 2, moved: 1 });
  assert.equal(find(s2.id).location, "Shelf");
  assert.ok(find(s1.id).countedAt);
  const shelf = store.locations().find((l) => l.location === "Shelf");
  assert.equal(shelf.cards, 2);
  assert.equal(shelf.qty, 3);
  assert.equal(shelf.value, 21); // 10×2 + cost 1 (no value yet)
  assert.equal(shelf.uncounted, 0);
});

test("the data check finds duplicate SKUs, duplicate rows and sold cards on the website — and fixes what it can", () => {
  const d1 = store.addInventory({ name: "Dup sku 1", sku: "X-1" });
  const d2 = store.addInventory({ name: "Dup sku 2", sku: "X-1" });
  store.addInventory({ name: "Twin", grade: "PSA 9" });
  store.addInventory({ name: "twin", grade: "psa 9" });
  const sold = store.addInventory({ name: "Gone", web: true, status: "sold", soldPrice: 5 });
  const c = store.dataCheck();
  const by = Object.fromEntries(c.issues.map((i) => [i.type, i]));
  assert.equal(by.dupSku.count, 1);
  assert.ok(by.dupCard.groups.some((g) => g.length === 2 && /twin/i.test(g[0].name)));
  assert.equal(by.webSold.rows[0].id, sold.id);
  assert.equal(store.fixData("dupSku").fixed, 1);
  assert.notEqual(find(d1.id).sku, find(d2.id).sku);
  assert.equal(store.fixData("webSold").fixed, 1);
  assert.equal(find(sold.id).web, false);
  assert.throws(() => store.fixData("costTypo"), /person/);
});

test("adding many cards gives each its own next SKU in one write", () => {
  const rows = store.addInventoryMany([{ name: "M1" }, { name: "M2" }, { name: "M3" }]);
  const n = rows.map((r) => parseInt(r.sku.replace(/\D/g, ""), 10));
  assert.deepEqual([n[1] - n[0], n[2] - n[1]], [1, 1]);
  assert.equal(new Set(store.inventory().map((r) => r.sku)).size, store.inventory().length, "SKUs unique after the dup fix");
});

test("an inventory file from before the history split is migrated on first read (also by the read-only view)", () => {
  const file = path.join(process.env.CARD_BOT_HOME, "data", "inventory.json");
  const list = JSON.parse(fs.readFileSync(file, "utf8"));
  list.push({ id: "old1", name: "Old row", grade: "Raw", qty: 1, cost: 1, status: "in_stock", sku: "OLD-1", valueLog: [["2026-01-01", 5], ["2026-02-01", 6]], priceLog: [{ at: "2026-02-01T00:00:00Z", from: 5, to: 6, reason: "test" }] });
  fs.writeFileSync(file, JSON.stringify(list));
  const view = store.inventoryView();
  const row = view.find((r) => r.id === "old1");
  assert.equal(row.valueLog, undefined);
  assert.equal(row.priceLog, undefined);
  assert.equal(store.cardHistory("old1").v.length, 2);
  assert.equal(store.cardHistory("old1").p[0].reason, "test");
  assert.ok(!fs.readFileSync(file, "utf8").includes("valueLog"));
});

// ---------------------------------------------------------------- the routes, on a real server

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function startServer() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-srv-"));
  const port = 39000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, CARD_BOT_HOME: home, PORT: String(port), NO_BROWSER: "1", GEMINI_API_KEY: "", SHARE_ON_NETWORK: "0" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const base = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server didn't start: " + out)), 15000);
    const check = () => {
      const m = out.match(/running → (http:\/\/[^\s]+)/);
      if (m) { clearTimeout(t); resolve(m[1].replace(/\/$/, "")); } else setTimeout(check, 100);
    };
    check();
  });
  const call = async (method, url, body) => {
    const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": "Tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { call, home, stop: () => child.kill() };
}

test("routes: slim list, full card, duplicate check, bulk + undo, many with photos, count, locations, check, views", { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const { call } = srv;
    const a = (await call("POST", "/api/inventory", { name: "Route card", grade: "PSA 10", location: "Box 1", webDescription: "Long text" })).body;
    const b = (await call("POST", "/api/inventory", { name: "Other card", location: "Box 1" })).body;

    const list = (await call("GET", "/api/inventory")).body;
    const slim = list.find((r) => r.id === a.id);
    assert.equal(slim.webDescription, undefined, "the list leaves out long text");
    assert.equal(slim.hasDescription, true);
    const full = (await call("GET", "/api/inventory/" + a.id)).body;
    assert.equal(full.webDescription, "Long text");
    assert.deepEqual(Object.keys(full.history).sort(), ["c", "p", "v"]);
    assert.equal((await call("GET", "/api/inventory/nope")).status, 404);

    // a static path is not taken for a card id
    const dup = await call("GET", "/api/inventory/duplicate?name=Route%20card&grade=PSA%2010");
    assert.equal(dup.status, 200);
    assert.equal(dup.body.id, a.id);

    const bulk = (await call("POST", "/api/inventory/bulk", { ids: [a.id, b.id], patch: { location: "Box 2" } })).body;
    assert.equal(bulk.updated, 2);
    assert.equal((await call("GET", "/api/inventory/" + a.id)).body.history.c.at(-1).by, "Tester");
    assert.equal((await call("POST", "/api/inventory/bulk/undo", { token: bulk.token })).status, 200);
    assert.equal((await call("GET", "/api/inventory/" + a.id)).body.location, "Box 1");
    assert.equal((await call("POST", "/api/inventory/bulk", { ids: [], patch: {} })).status, 400);

    // bulk scan's add: several cards in one request, each with its cut-out photo
    const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(300, 7), Buffer.from([0xff, 0xd9])]).toString("base64");
    const many = (await call("POST", "/api/inventory/many", { items: [{ name: "Scanned 1", qty: 2, location: "Box 3", photos: [{ data: jpeg, thumb: jpeg }] }, { name: "Scanned 2", location: "Box 3", photos: [{ data: "not a jpeg" }] }] })).body;
    assert.equal(many.added, 2);
    const s1 = (await call("GET", "/api/inventory/" + many.rows[0].id)).body;
    assert.equal(s1.photos.length, 1);
    assert.equal(s1.addedBy, "Tester");
    assert.ok(fs.readdirSync(path.join(srv.home, "data", "photos", s1.id)).length === 2, "photo + its small copy");
    assert.equal((await call("GET", "/api/inventory/" + many.rows[1].id)).body.photos, undefined, "a bad photo is skipped, the card is still added");

    const cost = (await call("POST", "/api/inventory/split-cost", { ids: [many.rows[0].id, many.rows[1].id], total: 30 })).body;
    assert.equal(cost.updated, 2);
    assert.equal(cost.byValue, false); // nothing valued → split by copies: 20 for the pair (10 each), 10 for the single
    assert.equal((await call("GET", "/api/inventory/" + many.rows[0].id)).body.cost, 10);
    assert.equal((await call("GET", "/api/inventory/" + many.rows[1].id)).body.cost, 10);

    const count = (await call("POST", "/api/inventory/count", { location: "Box 1", skus: [a.sku, many.rows[0].sku, "NOPE-1"] })).body;
    assert.deepEqual(count.found.map((r) => r.id), [a.id]);
    assert.deepEqual(count.missing.map((r) => r.id), [b.id]);
    assert.deepEqual(count.extra.map((r) => r.id), [many.rows[0].id]);
    assert.deepEqual(count.unknown, ["nope-1"]);
    const applied = (await call("POST", "/api/inventory/count/apply", { location: "Box 1", found: [a.id], moveHere: [many.rows[0].id], missing: [b.id] })).body;
    assert.equal(applied.moved, 1);
    assert.equal(applied.missing, 1);
    const locs = (await call("GET", "/api/inventory/locations")).body;
    assert.equal(locs.find((l) => l.location === "Box 1").cards, 2);
    assert.ok(locs.some((l) => /^Not found/.test(l.location)));

    const check = (await call("GET", "/api/inventory/check")).body;
    assert.ok(Array.isArray(check.issues));
    assert.equal((await call("POST", "/api/inventory/check/fix", { type: "costTypo" })).status, 400);

    const views = (await call("PUT", "/api/inventory/views", [{ name: "Box 1", filter: { location: "Box 1", evil: "x" } }])).body;
    assert.deepEqual(views, [{ name: "Box 1", filter: { location: "Box 1" } }]);
    assert.deepEqual((await call("GET", "/api/inventory/views")).body, views);

    // bulk scan's saved readings
    assert.deepEqual((await call("GET", "/api/scan")).body, {});
    assert.equal((await call("DELETE", "/api/scan", { keys: ["x"] })).status, 200);
  } finally {
    srv.stop();
  }
});
