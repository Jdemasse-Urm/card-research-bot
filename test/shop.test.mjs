// 3.11 the Shop: customers + store credit, consignment, grading for customers, card shows, supplies, and the
// helper PIN. Temp data folder; the route tests start the real server on a spare port (no network calls).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-shop-"));
const store = await import("../lib/store.js");
const find = (id) => store.inventory().find((r) => r.id === id);

test("store credit adds and spends, never goes below zero, and keeps a log", () => {
  const c = store.addCustomer({ name: "Mike", email: " Mike@Example.com ", collects: "Tigers, Skubal" });
  assert.equal(c.email, "mike@example.com");
  assert.equal(store.findCustomerByEmail("MIKE@example.com").id, c.id);
  store.addCredit(c.id, 50, "trade-in", "Joe");
  assert.equal(store.addCredit(c.id, -20, "show sale").credit, 30);
  assert.throws(() => store.addCredit(c.id, -31), /only \$30\.00/);
  assert.equal(store.customers().find((x) => x.id === c.id).creditLog.length, 2);
  assert.throws(() => store.deleteCustomer(c.id), /store credit/);
});

test("new cards are matched to the customers who collect them (name, player, team, set)", () => {
  const rows = [{ name: "2024 Topps Chrome Tarik Skubal #12", facts: {} }, { name: "Random card", facts: { team: "Detroit Tigers" } }, { name: "Base", facts: {} }];
  const m = store.customerMatches(rows).find((x) => x.customer.name === "Mike");
  assert.deepEqual(m.rows.map((r) => r.name), ["2024 Topps Chrome Tarik Skubal #12", "Random card"]);
});

test("a consigned card that sells records what its owner is owed; the profit is the commission", () => {
  const owner = store.addCustomer({ name: "Consignor" });
  const r = store.addInventory({ name: "Their PSA 10", qty: 3, cost: 0, consignorId: owner.id, consignPct: 20, consignFloor: 80 });
  const s = store.sellUnits(r.id, { qty: 2, soldPrice: 100, soldOn: "eBay" });
  assert.equal(s.soldRow.cost, 80); // 100 less 20%
  assert.deepEqual(s.soldRow.payout, { owed: 160, pct: 20, paidAt: null, method: null });
  assert.equal(find(r.id).qty, 1, "the rest stay in stock, still consigned");
  assert.equal(find(r.id).consignorId, owner.id);
  const list = store.consignments(owner.id);
  assert.equal(list.length, 2);
  assert.equal(list.find((x) => x.status === "sold").owed, 160);
  assert.deepEqual(store.payConsignor(owner.id, [], "Venmo", "Jeff"), { paid: 1, total: 160 });
  assert.equal(store.payConsignor(owner.id).paid, 0, "paid once");
  // the shop's default commission when none is set on the card
  const d = store.addInventory({ name: "Default pct", consignorId: owner.id });
  assert.equal(store.sellUnits(d.id, { soldPrice: 10 }).soldRow.cost, 8.5);
});

test("a customer's grading order follows the submission it went in with", () => {
  const c = store.addCustomer({ name: "Grader" });
  const o = store.addGradingOrder({ customerId: c.id, service: "PSA Value", cards: [{ desc: "LeBron Chrome #111", declared: 500, fee: 35 }, { desc: "", fee: 9 }, { desc: "Kobe", fee: 35 }] });
  assert.equal(o.cards.length, 2, "blank lines dropped");
  assert.equal(o.total, 70);
  assert.equal(store.gradingOrderStage(o).text, "Received at the shop");
  const sub = store.addSubmission({ company: "PSA", number: "123456", service: "Value" });
  const linked = store.updateGradingOrder(o.id, { submissionId: sub.id });
  assert.equal(linked.status, "submitted");
  assert.match(store.gradingOrderStage(linked).text, /^At PSA/);
  store.updateSubmission(sub.id, { progress: { gradesReady: true, stage: "Grades ready" } });
  assert.equal(store.gradingOrderStage(linked).text, "Grades ready at PSA");
  assert.equal(store.gradingOrderStage(store.updateGradingOrder(o.id, { status: "returned" })).text, "Returned to you");
});

test("a show files today's sales; its report counts the table, expenses and the cash drawer", () => {
  const today = new Date().toLocaleDateString("en-CA");
  const sh = store.addShow({ name: "Novi show", date: today, tableCost: 100, startCash: 200 });
  assert.equal(store.currentShow().id, sh.id);
  assert.ok(sh.checklist.length >= 5, "a starter checklist");
  const card = store.addInventory({ name: "Show card", cost: 40 });
  const s = store.sellUnits(card.id, { soldPrice: 150, soldOn: "Card show", payment: "Cash" });
  const sale = store.addShowSale({ payment: "Cash", total: 150, items: [{ name: card.name, qty: 1, price: 150, soldRowId: s.soldRow.id, rowId: card.id }] });
  assert.equal(sale.showId, sh.id);
  store.addExpense({ kind: "Travel", amount: 20, showId: sh.id });
  store.updateShow(sh.id, { cashOut: 50, countedCash: 295 });
  const r = store.showReport(sh.id);
  assert.equal(r.revenue, 150);
  assert.equal(r.cogs, 40);
  assert.equal(r.profit, -10); // 150 − 40 − 100 table − 20 travel
  assert.equal(r.cash.expected, 300); // 200 + 150 cash − 50 paid out
  assert.equal(r.cash.over, -5);
});

test("supplies are used up by orders and cards sold; crossing the reorder point is reported once", () => {
  const list = store.supplies();
  const mailers = list.find((x) => x.name === "Bubble mailers");
  store.saveSupply({ ...mailers, onHand: 26, reorderAt: 25 });
  let low = store.useSupplies({ orders: 1 });
  assert.ok(low.some((x) => x.name === "Bubble mailers"));
  low = store.useSupplies({ orders: 1 });
  assert.ok(!low.some((x) => x.name === "Bubble mailers"), "already below — no second alert");
  assert.equal(store.supplies().find((x) => x.name === "Bubble mailers").onHand, 24);
  assert.equal(store.useSupplies({ cards: 3 }).length, 0, "nothing is used per card by default");
});

// ---------------------------------------------------------------- routes

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function startServer(env = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-shop-srv-"));
  const port = 43000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, CARD_BOT_HOME: home, PORT: String(port), NO_BROWSER: "1", GEMINI_API_KEY: "", SHARE_ON_NETWORK: "0", ...env }, stdio: ["ignore", "pipe", "pipe"] });
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
  const lan = out.match(/home network \(PIN required\): (http:\/\/[\d.]+:\d+)/)?.[1] || null;
  const call = async (method, url, body, { from = base, cookie = "" } = {}) => {
    const r = await fetch(from + url, { method, headers: { "content-type": "application/json", "x-user": "Tester", ...(cookie ? { cookie } : {}), ...(from !== base ? { origin: from } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json().catch(() => null), cookie: r.headers.get("set-cookie") };
  };
  return { call, home, lan, stop: () => child.kill() };
}

test("routes: customers + credit, show sale paid with store credit (and its undo), consignment, grading, shows, supplies", { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const { call } = srv;
    const c = (await call("POST", "/api/customers", { name: "Ann", email: "ann@x.com", collects: "Wembanyama" })).body;
    assert.equal((await call("POST", "/api/customers", { name: "Ann 2", email: "ANN@x.com" })).status, 409);
    assert.equal((await call("POST", `/api/customers/${c.id}/credit`, { amount: 25, reason: "trade" })).body.credit, 25);

    const card = (await call("POST", "/api/inventory", { name: "2023 Prizm Victor Wembanyama #136", cost: 10 })).body;
    const alerts = (await call("GET", "/api/alerts")).body;
    assert.ok(alerts.some((a) => a.kind === "customer" && /Ann/.test(a.text)), "Ann collects Wembanyama");

    assert.equal((await call("POST", "/api/show/sale", { items: [{ id: card.id, qty: 1, price: 30 }], payment: "Store credit" })).status, 400, "no customer picked");
    assert.match((await call("POST", "/api/show/sale", { items: [{ id: card.id, qty: 1, price: 30 }], payment: "Store credit", customerId: c.id })).body.error, /only \$25\.00/);
    const sale = (await call("POST", "/api/show/sale", { items: [{ id: card.id, qty: 1, price: 20 }], payment: "Store credit", customerId: c.id })).body.sale;
    assert.equal(sale.customer, "Ann");
    let ann = (await call("GET", "/api/customers/" + c.id)).body;
    assert.equal(ann.credit, 5);
    assert.equal(ann.bought, 1);
    assert.ok(ann.history.some((h) => h.what === "Bought"));
    await call("POST", `/api/show/sale/${sale.id}/undo`);
    assert.equal((await call("GET", "/api/customers/" + c.id)).body.credit, 25, "undo gives the credit back");

    // consignment through the Sold dialog
    const theirs = (await call("POST", "/api/inventory", { name: "Ann's card", consignorId: c.id, consignFloor: 50 })).body;
    assert.equal((await call("POST", `/api/inventory/${theirs.id}/sell`, { soldPrice: 100, soldOn: "eBay" })).status, 200);
    ann = (await call("GET", "/api/customers/" + c.id)).body;
    assert.equal(ann.consigned.owed, 85);
    assert.equal((await call("POST", `/api/customers/${c.id}/payout`, { method: "Cash" })).body.total, 85);
    assert.equal((await call("GET", "/api/consignments")).body[0].consignor, "Ann");

    // grading service
    assert.equal((await call("POST", "/api/grading-orders", { customerId: "nope", cards: [{ desc: "x" }] })).status, 400);
    const o = (await call("POST", "/api/grading-orders", { customerId: c.id, service: "PSA Value", cards: [{ desc: "Kobe", fee: 35 }] })).body;
    const listed = (await call("GET", "/api/grading-orders")).body;
    assert.equal(listed[0].customer, "Ann");
    assert.equal(listed[0].stage.step, 1);
    assert.equal((await call("PATCH", "/api/grading-orders/" + o.id, { status: "back" })).body.stage.step, 4);

    // shows + the bring list
    const sh = (await call("POST", "/api/shows", { name: "Big show", date: "2099-01-02", tableCost: 50 })).body;
    await call("POST", "/api/inventory", { name: "Bring me", value: 100, location: "Box 2" });
    await call("POST", "/api/inventory", { name: "Too cheap", value: 1, location: "Box 1" });
    const bring = (await call("GET", `/api/shows/${sh.id}/bring?minValue=20`)).body;
    assert.deepEqual(bring.map((x) => x.name), ["Bring me"]);
    assert.equal((await call("GET", "/api/shows")).body.find((x) => x.id === sh.id).report.table, 50);

    // supplies: restock files an expense
    const sup = (await call("GET", "/api/supplies")).body[0];
    const after = (await call("POST", `/api/supplies/${sup.id}/restock`, { qty: 100, paid: 12 })).body;
    assert.equal(after.find((x) => x.id === sup.id).onHand, sup.onHand + 100);
    assert.ok((await call("GET", "/api/expenses")).body.some((e) => e.kind === "Supplies" && e.amount === 12));
    assert.equal((await call("PUT", "/api/shop/settings", { consignPct: 12, gradingPrices: [{ service: "SGC", fee: 20 }] })).body.consignPct, 12);
  } finally {
    srv.stop();
  }
});

test("helper PIN: Show mode only, never what cards cost", { timeout: 30000 }, async () => {
  const srv = await startServer({ SHARE_ON_NETWORK: "1", ACCESS_PIN: "1111", HELPER_PIN: "2222" });
  try {
    const { call, lan } = srv;
    if (!lan) return; // no network adapter on this machine: nothing to sign in from
    await call("POST", "/api/inventory", { name: "Secret cost card", cost: 99, value: 150 });
    assert.equal((await call("GET", "/api/inventory", undefined, { from: lan })).status, 401, "a PIN is needed from another device");
    const login = await call("POST", "/api/login", { pin: "2222" }, { from: lan });
    assert.equal(login.body.helper, true);
    const cookie = login.cookie.split(";")[0];
    const inv = (await call("GET", "/api/inventory", undefined, { from: lan, cookie })).body;
    assert.equal(inv[0].name, "Secret cost card");
    assert.equal(inv[0].cost, undefined, "the helper never sees cost");
    assert.equal((await call("GET", "/api/status", undefined, { from: lan, cookie })).body.role, "helper");
    assert.equal((await call("GET", "/api/analytics", undefined, { from: lan, cookie })).status, 403);
    assert.equal((await call("PATCH", "/api/inventory/" + inv[0].id, { cost: 1 }, { from: lan, cookie })).status, 403);
    assert.equal((await call("POST", "/api/show/sale", { items: [{ id: inv[0].id, qty: 1, price: 150 }], payment: "Cash" }, { from: lan, cookie })).status, 200, "but can sell at the show");
    const owner = (await call("POST", "/api/login", { pin: "1111" }, { from: lan })).cookie.split(";")[0];
    assert.equal((await call("GET", "/api/analytics", undefined, { from: lan, cookie: owner })).status, 200);
  } finally {
    srv.stop();
  }
});
