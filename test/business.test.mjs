// The business records: selling part of a stack, show-mode undo, value history and movers, backups copied
// to a cloud folder, receipt fingerprints. Temp data folder, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-biz-"));
const store = await import("../lib/store.js");
const find = (id) => store.inventory().find((r) => r.id === id);

test("selling part of a stack leaves the rest in stock and makes a separate sold row", () => {
  const row = store.addInventory({ name: "Ohtani RC", grade: "Raw", qty: 3, cost: 10, sku: "MJC-0001" });
  const r = store.sellUnits(row.id, { qty: 2, soldPrice: 25, soldOn: "Card show", payment: "Cash", fees: 0 });
  assert.ok(r.split);
  assert.equal(find(row.id).qty, 1);
  assert.equal(find(row.id).status, "in_stock");
  const sold = find(r.soldRow.id);
  assert.equal(sold.qty, 2);
  assert.equal(sold.status, "sold");
  assert.equal(sold.soldPrice, 25);
  assert.equal(sold.payment, "Cash");
  assert.equal(sold.sku, "MJC-0001-S1");
  assert.equal(sold.splitFrom, row.id);
  // the last one sells the row itself
  const last = store.sellUnits(row.id, { qty: 5, soldPrice: 30, soldOn: "eBay" });
  assert.ok(!last.split);
  assert.equal(find(row.id).status, "sold");
  assert.equal(find(row.id).qty, 1);
  assert.equal(store.sellUnits(row.id, { soldPrice: 1 }), null, "can't sell a sold row again");
});

test("undo puts a show sale back exactly", () => {
  const row = store.addInventory({ name: "Griffey", grade: "PSA 9", qty: 2, cost: 100, status: "listed", sku: "MJC-0002" });
  const part = store.sellUnits(row.id, { qty: 1, soldPrice: 150 });
  assert.ok(store.unsellUnits({ rowId: row.id, soldRowId: part.soldRow.id, split: part.split, prev: part.prev }));
  assert.equal(find(row.id).qty, 2);
  assert.equal(find(part.soldRow.id), undefined);
  const all = store.sellUnits(row.id, { qty: 2, soldPrice: 150 });
  assert.ok(store.unsellUnits({ rowId: row.id, soldRowId: all.soldRow.id, split: all.split, prev: all.prev }));
  assert.equal(find(row.id).status, "listed");
  assert.equal(find(row.id).soldPrice, null);
  const sale = store.addShowSale({ by: "test", payment: "Cash", total: 150, items: [] });
  assert.equal(store.showSales()[0].id, sale.id);
  store.removeShowSale(sale.id);
  assert.ok(!store.showSales().some((s) => s.id === sale.id));
});

test("the daily re-value keeps a history; movers come from it", () => {
  const up = store.addInventory({ name: "Riser", grade: "PSA 10", qty: 2, cost: 50 });
  const down = store.addInventory({ name: "Faller", grade: "Raw", qty: 1, cost: 50 });
  store.recordValues([{ id: up.id, value: 100 }, { id: down.id, value: 80 }]);
  // pretend the first values were recorded 10 days ago
  const list = store.inventory();
  const old = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  for (const r of list) if (r.valueLog) r.valueLog = r.valueLog.map(([, v]) => [old, v]);
  store.save("inventory", list);
  assert.equal(store.recordValues([{ id: up.id, value: 130 }, { id: down.id, value: 60 }]), 2);
  assert.equal(find(up.id).value, 130);
  assert.equal(find(up.id).valueLog.length, 2);
  const m = store.stockMovers(7);
  assert.equal(m.up[0].name, "Riser");
  assert.equal(m.up[0].dollars, 60); // +$30 × 2 copies
  assert.equal(m.down[0].name, "Faller");
  assert.ok(Math.abs(m.down[0].pct + 0.25) < 1e-9);
});

test("an install from before backup tracking still reports its last backup (no false 'no backup' warning)", () => {
  const dir = path.join(process.env.CARD_BOT_HOME, "data", "backups");
  fs.writeFileSync(path.join(dir, "backup-2026-01-01.json"), "{}");
  store.save("backup-state", {});
  const st = store.backupState();
  assert.ok(st.lastLocal, JSON.stringify(st));
  assert.ok(st.lastLocalFile);
});

test("backups are copied to the chosen cloud folder and the copy is reported", () => {
  const cloud = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-cloud-"));
  process.env.CARD_BOT_BACKUP_DIR = cloud;
  const name = store.dailyBackup({ force: true });
  const copy = path.join(cloud, "Card Research Bot backups", name);
  assert.ok(fs.existsSync(copy));
  assert.equal(JSON.parse(fs.readFileSync(copy, "utf8")).app, "card-research-bot");
  const st = store.backupState();
  assert.ok(st.lastLocal && st.lastMirror && !st.mirrorError);
  // a folder that can't be written is reported, not thrown
  process.env.CARD_BOT_BACKUP_DIR = path.join(copy, "not-a-folder");
  store.dailyBackup({ force: true });
  assert.ok(store.backupState().mirrorError);
  delete process.env.CARD_BOT_BACKUP_DIR;
  assert.ok(Array.isArray(store.cloudFolders()));
});

test("an expense read from a receipt keeps its fingerprint (so the same receipt is caught twice)", () => {
  const e = store.addExpense({ date: "2026-10-01", kind: "Supplies", amount: 24.5, note: "toploaders", receiptHash: "a".repeat(32) });
  assert.equal(e.receiptHash, "a".repeat(32));
  assert.equal(store.addExpense({ amount: 1, receiptHash: "<script>" }).receiptHash, undefined);
});
