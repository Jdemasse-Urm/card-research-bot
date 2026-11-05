// 11/5 (the store's first day live): the sync to the website against a stand-in store — chunks for a big catalog only
// when the store takes them, photos alongside, a failing sync tells the owner — plus the phone's "no back" and a shipping
// charge that isn't set. Temp data folder; no network beyond 127.0.0.1.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-mjcsync-"));
let version = "1.1.0", fail = 0;
const got = [];
const stub = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const j = body ? JSON.parse(body) : null;
    got.push({ method: req.method, url: req.url, body: j });
    res.setHeader("content-type", "application/json");
    if (fail > 0 && req.method === "PUT") return fail--, res.writeHead(500).end(JSON.stringify({ error: "store down" }));
    if (req.url === "/health") return res.end(JSON.stringify({ ok: true, version }));
    if (req.url === "/admin/items") return res.end(JSON.stringify({ ok: true, upserted: j.items.length, unchanged: 0, removed: 0, alerted: 0 }));
    res.end(JSON.stringify({ ok: true }));
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
process.env.MJC_API_URL = `http://127.0.0.1:${stub.address().port}`;
process.env.MJC_SYNC_TOKEN = "t".repeat(64);
const store = await import("../lib/store.js");
const mjc = await import("../lib/mjc.js");
const puts = () => got.filter((x) => x.method === "PUT" && x.url === "/admin/items");

const rows = store.addInventoryMany(Array.from({ length: 600 }, (_, i) => ({ name: `2024 Panini Prizm WNBA Card ${i}`, category: "basketball", value: 10, web: true, qty: 1 })));
store.setEngineFieldsMany(rows.map((r) => ({ id: r.id, webPrice: 12.99 })));

test("a 600-card catalog goes up in chunks of 250, then the list of every card still on the site", async () => {
  got.length = 0;
  const r = await mjc.syncCatalog();
  const p = puts();
  assert.deepEqual(p.map((x) => x.body.items.length), [250, 250, 100, 0]);
  assert.ok(p.slice(0, 3).every((x) => !x.body.full), "a middle chunk never removes anything");
  assert.equal(p[3].body.full, true);
  assert.equal(p[3].body.ids.length, 600);
  assert.equal(r.live, 600);
  assert.equal(p[0].body.items[0].league, "WNBA", "WNBA cards say so — the site gives them their own section");
});

test("a store that can't take chunks yet (before 1.1.0) gets the whole catalog in one request, as before", async () => {
  got.length = 0;
  version = "1.0.0";
  await mjc.syncCatalog();
  assert.deepEqual(puts().map((x) => [x.body.items.length, x.body.full]), [[600, true]]);
  version = "1.1.0";
});

test("the sync failing twice in a row tells the owner once; a sync that works clears it", async () => {
  const before = store.load("alerts", []).length;
  fail = 2;
  await assert.rejects(mjc.syncCatalog());
  assert.equal(store.load("alerts", []).length, before, "one failure can be a blip");
  await assert.rejects(mjc.syncCatalog());
  const alerts = store.load("alerts", []);
  assert.equal(alerts.length, before + 1);
  assert.match(JSON.stringify(alerts.at(-1)), /Website sync failing/);
  await mjc.syncCatalog();
  assert.equal(mjc.state().syncFailures, 0);
});

// ---------------------------------------------------------------- routes (a real server)
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test("routes: the phone's 'no back' reads a front on its own; a blank shipping charge stays blank", { timeout: 30000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-mjcsync-srv-"));
  const port = 53500 + Math.floor(Math.random() * 900);
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, CARD_BOT_HOME: home, PORT: String(port), NO_BROWSER: "1", GEMINI_API_KEY: "", PSA_API_TOKEN: "", SHARE_ON_NETWORK: "0", MJC_API_URL: "", MJC_SYNC_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  try {
    const base = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("server didn't start: " + out)), 15000);
      const check = () => { const m = out.match(/running → (http:\/\/[^\s]+)/); if (m) { clearTimeout(t); resolve(m[1].replace(/\/$/, "")); } else setTimeout(check, 100); };
      check();
    });
    const call = async (method, url, body) => {
      const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": "Tester" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    const jpeg = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 1)]).toString("base64");
    assert.equal((await call("POST", "/api/scan/inbox", { name: "phone-abc-0001-a", image: jpeg })).status, 200);
    const r = await call("POST", "/api/scan/inbox/phone-abc-0001-a.jpg/single");
    assert.deepEqual([r.status, r.body.name], [200, "phone-abc-0001-s.jpg"]);
    const inbox = (await call("GET", "/api/scan/inbox")).body.map((x) => x.name);
    assert.deepEqual(inbox, ["phone-abc-0001-s.jpg"], "the computer reads it now instead of holding it 2 minutes for a back");
    assert.equal((await call("POST", "/api/scan/inbox/phone-abc-0002-b.jpg/single")).status, 400, "only a front");

    await call("PUT", "/api/mjc/store", { name: "MJC", shippingFlat: "" });
    assert.equal((await call("GET", "/api/mjc")).body.store.shippingFlat, null, "blank isn't $0 — the site said 'Free shipping on every order'");
    await call("PUT", "/api/mjc/store", { name: "MJC", shippingFlat: "0" });
    assert.equal((await call("GET", "/api/mjc")).body.store.shippingFlat, 0, "0 on purpose = free shipping");
  } finally {
    child.kill();
  }
});

test.after(() => stub.close());
