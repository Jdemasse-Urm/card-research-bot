// 3.12 books & taxes, sales imported from other sites, the listing file, insurance, the weekly report, the live
// stream, and "ask your own business" (its counting — the AI only picks the filter). Temp data; no network calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-books-"));
const jobs = await import("../lib/jobs.js");
const store = await import("../lib/store.js");

const INV = [
  { name: "2024 Topps Chrome Tarik Skubal #12", category: "baseball", grade: "PSA 10", status: "sold", soldPrice: 100, soldDate: "2026-03-02", soldOn: "eBay", cost: 40, qty: 1, purchased: "2026-01-10" },
  { name: "2023 Bowman Riley Greene #5", category: "baseball", grade: "Raw", status: "sold", soldPrice: 20, soldDate: "2026-05-02", soldOn: "Card show", cost: 5, qty: 2, purchased: "2026-01-10" },
  { name: "2023 Prizm Wembanyama #136", category: "basketball", grade: "Raw", status: "sold", soldPrice: 300, soldDate: "2025-12-30", soldOn: "eBay", cost: 100, qty: 1 },
  { name: "1999 Pokemon Charizard #4", category: "pokemon", grade: "PSA 8", status: "in_stock", value: 900, cost: 500, qty: 1, added: "2025-06-01T00:00:00Z", location: "Case" },
  { name: "Old Tigers team card", category: "baseball", grade: "Raw", status: "in_stock", value: 3, cost: 1, qty: 4, added: "2026-01-01T00:00:00Z", facts: { team: "Detroit Tigers" } },
];
const fee = (r) => (r.soldOn === "eBay" ? Math.round(r.soldPrice * r.qty * 0.1325 * 100) / 100 : 0);

test("ask-your-business counting: a team's cards by its players, this year, grouped by where they sold", () => {
  const r = jobs.runBusinessQuery({ dataset: "sales", text_any: ["Tigers", "Skubal", "Greene"], category: "any", date_from: "2026-01-01", date_to: null, platform: null, grade_has: null, min_days_in_stock: null, group_by: "platform", sort_by: "revenue" }, { inventory: INV, feeFor: fee, today: "2026-10-27" });
  assert.equal(r.totals.units, 3);
  assert.equal(r.totals.revenue, 140);
  assert.equal(r.totals.profit, 100 - 40 - 13.25 + 40 - 10); // eBay sale after fees + the show sale
  assert.deepEqual(r.groups.map((g) => g.group), ["eBay", "Card show"]);
});

test("ask-your-business counting: stock sitting 90+ days, and an empty answer is empty (not invented)", () => {
  const r = jobs.runBusinessQuery({ dataset: "stock", text_any: [], category: "any", date_from: null, date_to: null, platform: null, grade_has: null, min_days_in_stock: 90, group_by: "none", sort_by: "value" }, { inventory: INV, today: "2026-10-27" });
  assert.deepEqual(r.rows.map((x) => x.name), ["1999 Pokemon Charizard #4", "Old Tigers team card"]);
  assert.equal(r.totals.value, 912);
  const none = jobs.runBusinessQuery({ dataset: "sales", text_any: ["Ohtani"], category: "any", group_by: "none", sort_by: "units" }, { inventory: INV, today: "2026-10-27" });
  assert.equal(none.totals.rows, 0);
  assert.equal(none.totals.revenue, 0);
});

test("inventory on a date counts what was owned then, at cost (sold later = still owned then)", () => {
  const a = store.addInventory({ name: "Owned all year", cost: 10, purchased: "2025-05-01" });
  const b = store.addInventory({ name: "Bought in March, sold in June", cost: 20, purchased: "2026-03-01" });
  store.sellUnits(b.id, { soldPrice: 30, soldDate: "2026-06-01" });
  store.addInventory({ name: "Consigned", cost: 0, consignorId: "x", purchased: "2025-01-01" });
  const ids = (d) => store.inventoryAt(d).map((r) => r.id);
  assert.deepEqual(ids("2025-12-31"), [a.id]);
  assert.deepEqual(ids("2026-04-01").sort(), [a.id, b.id].sort());
  assert.deepEqual(ids("2026-07-01"), [a.id], "consigned cards never count — they aren't yours");
});

// ---------------------------------------------------------------- routes

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function startServer() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-books-srv-"));
  const port = 45000 + Math.floor(Math.random() * 2000);
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
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch {}
    return { status: r.status, body: j, text, type: r.headers.get("content-type") };
  };
  return { call, stop: () => child.kill() };
}

test("routes: books, 1099-K check, eBay sales import (SKU + title, no double import), listing file, insurance, weekly, QR", { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const { call } = srv;
    const y = String(new Date().getFullYear());
    const a = (await call("POST", "/api/inventory", { name: "2024 Topps Chrome Paul Skenes #1 Refractor RC", grade: "PSA 10", cost: 60, value: 150, sku: "CRB-0100", purchased: `${y}-01-05`, facts: { cert: "81234567", player: "Paul Skenes", year: "2024" } })).body;
    const b = (await call("POST", "/api/inventory", { name: "2023 Bowman Chrome Jackson Holliday #BCP-1", grade: "Raw", cost: 10, value: 25, purchased: `${y}-02-01` })).body;
    await call("PUT", "/api/shop/settings", { salesTaxPct: 6, taxIncluded: true });

    // an eBay "Orders report": a title line before the header, a SKU match, a title match, and a line for nothing we have
    const today = new Date().toISOString().slice(0, 10);
    const csv = `"Seller Hub orders report"\n"Order Number","Buyer Username","Item Title","Custom Label","Quantity","Sold For","Sale Date"\n"01-111","buyer_one","Paul Skenes Chrome Refractor PSA 10","CRB-0100","1","$140.00","${today}"\n"01-112","buyer_two","2023 Bowman Chrome Jackson Holliday BCP-1 raw","","1","$30.00","${today}"\n"01-113","buyer_3","Something else entirely","","1","$5.00","${today}"\n`;
    const prev = (await call("POST", "/api/import-sales/preview", { text: csv, platform: "eBay" })).body;
    assert.equal(prev.columns.sku, "Custom Label");
    assert.equal(prev.rows[0].match.how, "sku");
    assert.equal(prev.rows[1].match.id, b.id);
    assert.equal(prev.rows[1].match.how, "title");
    assert.equal(prev.rows[2].match, null);
    const rows = prev.rows.filter((x) => x.match).map((x) => ({ key: x.key, rowId: x.match.id, qty: x.qty, price: x.price, date: x.date, buyer: x.buyer, order: x.order }));
    assert.equal((await call("POST", "/api/import-sales/apply", { platform: "eBay", rows })).body.sold, 2);
    assert.equal((await call("POST", "/api/import-sales/apply", { platform: "eBay", rows })).body.sold, 0, "the same lines again: skipped");
    assert.ok((await call("POST", "/api/import-sales/preview", { text: csv, platform: "eBay" })).body.rows[0].dup);
    const skenes = (await call("GET", "/api/inventory/" + a.id)).body;
    assert.equal(skenes.status, "sold");
    assert.equal(skenes.soldPrice, 140);
    assert.ok((await call("GET", "/api/customers")).body.some((c) => c.handle === "buyer_one"), "the buyer joins the customer book");

    // a show sale for the sales-tax line
    const c = (await call("POST", "/api/inventory", { name: "Show card", cost: 5, purchased: `${y}-03-01` })).body;
    await call("POST", "/api/show/sale", { items: [{ id: c.id, qty: 1, price: 106 }], payment: "Cash" });
    let books = (await call("GET", "/api/books?year=" + y)).body;
    assert.equal(books.gross, 276);
    assert.equal(books.byChannel.find((x) => x.channel === "eBay").gross, 170);
    assert.equal(books.salesTax.inPerson, 106);
    assert.equal(books.salesTax.due, 6); // 6% included in $106
    assert.equal(books.inventory.purchases, 75);
    assert.equal(books.inventory.end, 0, "everything bought this year was sold");
    await call("PUT", "/api/books/1099", { year: y, platform: "eBay", amount: 200 });
    books = (await call("GET", "/api/books?year=" + y)).body;
    assert.equal(books.k1099.find((k) => k.platform === "eBay").diff, 30);
    const invCsv = await call("GET", `/api/export/inventory-at.csv?date=${y}-01-31`);
    assert.match(invCsv.text, /Paul Skenes/);
    assert.doesNotMatch(invCsv.text, /Show card/, "bought in March — not owned on Jan 31");

    // the listing file
    const d = (await call("POST", "/api/inventory", { name: "List me", grade: "BGS 9.5", value: 80, facts: { player: "X", cert: "123456" } })).body;
    const listing = await call("POST", "/api/export/listings.csv", { ids: [d.id] });
    assert.match(listing.type, /text\/csv/);
    assert.match(listing.text, /SKU \(custom label\),Title,Price/);
    assert.match(listing.text, /List me BGS 9\.5,80,1,Yes,BGS,9\.5,123456/);

    const ins = (await call("GET", "/api/insurance?min=50")).body;
    assert.deepEqual(ins.rows.map((r) => r.name), ["List me"]);
    const w = (await call("GET", "/api/weekly")).body;
    assert.ok(w.sales >= 3 && Array.isArray(w.toDo.lowSupplies));
    const qr = await call("GET", "/api/qr?text=" + encodeURIComponent("https://example.com/track?order=MJC-1"));
    assert.match(qr.type, /svg/);
    assert.equal((await call("POST", "/api/ask-business", {})).status, 400);
  } finally {
    srv.stop();
  }
});

test("routes: the live stream — queue, on screen, sold to @buyer (fees, customer), next card, overlay, end", { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const { call } = srv;
    const one = (await call("POST", "/api/inventory", { name: "Stream card A", value: 50 })).body;
    const two = (await call("POST", "/api/inventory", { name: "Stream card B", value: 20, qty: 2 })).body;
    await call("PUT", "/api/live/queue", { queue: [{ id: one.id, price: 25 }, { id: two.id, price: 5 }, { id: "gone" }] });
    assert.equal((await call("GET", "/api/live")).body.queue.length, 2, "unknown cards are dropped");
    assert.equal((await call("POST", "/api/live/sold", { price: 30 })).status, 400, "nothing on screen yet");
    await call("POST", "/api/live/now", { id: one.id });
    let ov = (await call("GET", "/api/live/overlay")).body;
    assert.equal(ov.now.name, "Stream card A");
    assert.equal(ov.next.name, "Stream card B");
    const sold = (await call("POST", "/api/live/sold", { buyer: "@cardfan", price: 40 })).body;
    assert.equal(sold.sale.buyer, "cardfan");
    const row = (await call("GET", "/api/inventory/" + one.id)).body;
    assert.equal(row.status, "sold");
    assert.equal(row.soldOn, "Whatnot");
    let st = (await call("GET", "/api/live")).body;
    assert.equal(st.now.name, "Stream card B", "the next card goes on screen");
    assert.equal(st.total, 40);
    await call("POST", "/api/live/sold", { buyer: "cardfan", price: 10 });
    st = (await call("GET", "/api/live")).body;
    assert.equal(st.queue.length, 1, "a stack with a copy left stays queued");
    assert.equal((await call("GET", "/api/customers")).body.filter((c) => c.handle === "cardfan").length, 1, "one customer for the handle");
    ov = (await call("GET", "/api/live/overlay")).body;
    assert.deepEqual(ov.last, { name: "Stream card B", buyer: "cardfan", price: 10 });
    assert.equal((await call("POST", "/api/live/end")).body.sales.length, 2);
    assert.equal((await call("GET", "/api/live/sessions")).body[0].sales.length, 2);
    assert.equal((await call("GET", "/api/live")).body.sales.length, 0);
  } finally {
    srv.stop();
  }
});
