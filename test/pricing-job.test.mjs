// Wiring tests of the daily pricing run: a temp data folder and a stubbed sales-page feed, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-pricing-"));
const store = await import("../lib/store.js");
const job = await import("../lib/pricing-job.js");

const URL = "https://www.sportscardspro.com/game/baseball-cards-1989-upper-deck/ken-griffey-jr-1";
const today = new Date().toISOString().slice(0, 10);
const feed = (price) => ({
  priceGuide: { Ungraded: price * 0.3, "PSA 10": price },
  salesVolume: { "PSA 10": "3 sales per week" },
  trendPct: {},
  recentSales: { "PSA 10": [1, 1.02, 0.98, 1.01, 0.99].map((m) => ({ date: today, price: Math.round(price * m * 100) / 100 })) },
});

const a = store.addInventory({ name: "Griffey PSA 10 #1", grade: "PSA 10", web: true, priceUrl: URL, cost: 50, qty: 1 });
store.addInventory({ name: "Griffey PSA 10 #2", grade: "PSA 10", web: true, priceUrl: URL, cost: 50, qty: 1 });
const c = store.addInventory({ name: "Other card", grade: "PSA 10", web: true, priceUrl: URL.replace("-1", "-2"), cost: 10, qty: 1 });
const row = (id) => store.inventory().find((x) => x.id === id);

test("one feed fetch per sales page, all cards priced, training rows written", async () => {
  const calls = [];
  const r = await job.run({ force: true, fetchCard: async (url) => (calls.push(url), feed(100)) });
  assert.equal(calls.filter((u) => u === URL).length, 1, "two copies of a card share one page fetch");
  assert.equal(r.priced, 3);
  assert.equal(r.feedDown, false);
  const rows = store.inventory();
  assert.ok(rows.every((x) => x.webPrice > 0 && Math.abs(x.webMarket - 100) < 3 && x.webLiqPerDay > 0), JSON.stringify(rows.map((x) => [x.webPrice, x.webMarket])));
  assert.equal(store.pricingObs().length, 3);
});

test("a day the feed can't be read is not counted: prices hold, one alert, retry flagged", async () => {
  const before = store.inventory().map((x) => x.webPrice);
  const broken = async () => { throw new Error("HTTP 503 from www.sportscardspro.com"); };
  const r = await job.run({ force: true, fetchCard: broken });
  assert.equal(r.feedDown, true);
  assert.equal(r.changes.length, 0);
  assert.deepEqual(store.inventory().map((x) => x.webPrice), before);
  assert.equal(store.load("pricing-last-run").feedDown, true);
  assert.equal(store.alerts().filter((x) => x.kind === "pricing").length, 1);
  await job.run({ force: true, fetchCard: broken });
  assert.equal(store.alerts().filter((x) => x.kind === "pricing").length, 1, "not re-alerted the same day");
  assert.equal(store.pricingObs().length, 3, "no training rows from a broken day");
});

test("a market value that jumps 40%+ in a day is held until the feed confirms it", async () => {
  const r1 = await job.run({ force: true, fetchCard: async () => feed(180) });
  assert.ok(r1.held.some((h) => h.id === a.id));
  assert.ok(Math.abs(row(a.id).webMarket - 100) < 3, `held market ${row(a.id).webMarket}`);
  assert.ok(Math.abs(row(a.id).webMarketPending - 180) < 5);
  await job.run({ force: true, fetchCard: async () => feed(182) });
  assert.ok(Math.abs(row(a.id).webMarket - 182) < 5, `confirmed market ${row(a.id).webMarket}`);
  assert.equal(row(a.id).webMarketPending, null);
});

test("a website sale becomes today's 'sold' observation at the price it sold for", () => {
  store.recordSale(c.id, { price: row(c.id).webPrice, market: row(c.id).webMarket, liq: row(c.id).webLiqPerDay });
  assert.equal(store.pricingObs().find((o) => o.id === c.id && o.date === today).y, 1);
  // Sold before the daily run created today's row: the sale itself becomes the row.
  const fresh = store.addInventory({ name: "Sold early", grade: "PSA 10", web: true, priceUrl: URL, cost: 5, qty: 1 });
  store.recordSale(fresh.id, { price: 120, market: 100, liq: 0.4 });
  const ob = store.pricingObs().find((o) => o.id === fresh.id);
  assert.ok(ob && ob.y === 1 && Math.abs(ob.ratio - 1.2) < 1e-9, JSON.stringify(ob));
});
