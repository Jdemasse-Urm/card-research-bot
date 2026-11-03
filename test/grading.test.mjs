// 3.16 PSA: tracking a submission (cards already at the grader, stages, when it's due), the cards coming back with
// their certs, the grading services list, and the prep sheet's service pick. Temp data folder; no network calls.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-grading-"));
const store = await import("../lib/store.js");
const find = (id) => store.inventory().find((r) => r.id === id);

test("a submission can hold cards that were never in inventory, and remembers what each was worth when it went out", () => {
  const mine = store.addInventory({ name: "2023 Prizm Wembanyama #136", value: 40, cost: 20 });
  const sub = store.addSubmission({ company: "PSA", service: "Regular", number: "12345678", sent: "2026-11-02", itemIds: [mine.id], newCards: [{ name: "1989 Upper Deck Griffey #1", cost: "15" }, { name: " " }] });
  assert.equal(sub.itemIds.length, 2, "the blank line is ignored");
  const added = find(sub.itemIds[1]);
  assert.equal(added.name, "1989 Upper Deck Griffey #1");
  assert.equal(added.status, "grading");
  assert.equal(added.cost, 15);
  assert.equal(find(mine.id).status, "grading");
  assert.deepEqual(sub.before, { [mine.id]: 40, [added.id]: null });
});

test("when it's due: the service's turnaround in business days from the day it was sent", () => {
  assert.equal(store.addBusinessDays("2026-11-06", 1), "2026-11-09", "Friday + 1 = Monday");
  assert.equal(store.addBusinessDays("2026-11-02", 5), "2026-11-09");
  const services = [{ service: "PSA Regular", days: "40-50" }, { service: "PSA Express", days: "20" }];
  assert.deepEqual(store.expectedBack({ company: "PSA", service: "Regular", sent: "2026-11-02" }, services), { from: "2026-12-28", to: "2027-01-11", service: "PSA Regular" });
  assert.equal(store.expectedBack({ company: "PSA", service: "Express", sent: "2026-11-02" }, services).to, "2026-11-30");
  assert.equal(store.expectedBack({ company: "PSA", service: "Value", sent: "2026-11-02" }, services), null, "no turnaround set → no date");
});

test("PSA's stages are kept with when each began; the same stage again doesn't restart its clock", () => {
  const sub = store.addSubmission({ company: "PSA", number: "999", itemIds: [] });
  store.updateSubmission(sub.id, { progress: { found: true, stage: "Step 1 of 5 done" } });
  store.updateSubmission(sub.id, { progress: { found: true, stage: "Step 1 of 5 done", checked: "later" } });
  const s = store.updateSubmission(sub.id, { progress: { found: true, stage: "Grades ready" } });
  assert.deepEqual(s.stages.map((x) => x.stage), ["Step 1 of 5 done", "Grades ready"]);
});

test("cards back: the grade, the cert and PSA's label go on each card; its share of the cost goes on its cost", () => {
  const a = store.addInventory({ name: "Card A", cost: 10, value: 30 });
  const b = store.addInventory({ name: "Card B", cost: 5, value: 20 });
  const sub = store.addSubmission({ company: "PSA", service: "Regular", cost: 160, itemIds: [a.id, b.id] });
  store.completeSubmission(sub.id, { [a.id]: "10", [b.id]: "Authentic" }, { [a.id]: { cert: "PSA 81234567", verified: true, label: "GEM MT 10" }, [b.id]: { cert: "12", verified: false } });
  assert.equal(find(a.id).grade, "PSA 10");
  assert.equal(find(a.id).cost, 90);
  assert.deepEqual([find(a.id).facts.cert, find(a.id).facts.certVerified], ["81234567", true]);
  assert.match(find(a.id).notes, /PSA label: GEM MT 10/);
  assert.equal(find(b.id).grade, "Authentic");
  assert.equal(find(b.id).facts.certVerified, false, "a cert PSA didn't confirm isn't marked as matching");
  assert.equal(find(a.id).status, "in_stock");
});

test("the grading services list keeps the grader's price, the declared-value limit, the turnaround and paused levels", () => {
  const s = store.saveShopSettings({ gradingPrices: [{ service: "PSA Regular", fee: "95", cost: "79.99", maxValue: "1500", days: "40 - 50 days", paused: false }, { service: "PSA Value", fee: "35", paused: "on" }] });
  assert.deepEqual(s.gradingPrices[0], { service: "PSA Regular", fee: 95, cost: 79.99, maxValue: 1500, days: "40-50", paused: false });
  assert.equal(s.gradingPrices[1].paused, true);
  assert.equal(s.gradingPrices[1].cost, null);
});

// ---------------------------------------------------------------- routes

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function startServer() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-grading-srv-"));
  const port = 53000 + Math.floor(Math.random() * 1400); // clear of the ports Windows reserves
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, CARD_BOT_HOME: home, PORT: String(port), NO_BROWSER: "1", GEMINI_API_KEY: "", PSA_API_TOKEN: "", SHARE_ON_NETWORK: "0" }, stdio: ["ignore", "pipe", "pipe"] });
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
  return { call, stop: () => child.kill() };
}

test("routes: the prep sheet picks the cheapest open level that covers every card; submissions say when they're due", { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const { call } = srv;
    await call("PUT", "/api/shop/settings", { gradingPrices: [
      { service: "PSA Value", fee: 35, cost: 32.99, maxValue: 500, days: "65", paused: true },
      { service: "PSA Regular", fee: 95, cost: 79.99, maxValue: 1500, days: "40-50" },
      { service: "PSA Express", fee: 0, cost: 149, maxValue: 2500, days: "20-30" },
    ] });
    const cheap = (await call("POST", "/api/inventory", { name: "Cheap card", value: 120, facts: { year: "2023", set: "Panini Prizm", player: "Victor Wembanyama", number: "136" } })).body;
    const big = (await call("POST", "/api/inventory", { name: "Big card", value: 1800 })).body;
    let prep = (await call("POST", "/api/grading/prep", { ids: [cheap.id], company: "PSA" })).body;
    assert.equal(prep.suggestion.service, "PSA Regular", "Value covers $120 but it's paused");
    assert.equal(prep.suggestion.total, 79.99);
    assert.deepEqual([prep.cards[0].year, prep.cards[0].set, prep.cards[0].number, prep.cards[0].player, prep.cards[0].declared], ["2023", "Panini Prizm", "136", "Victor Wembanyama", 120]);
    assert.match(prep.cards[0].basis, /raw value/, "no sales page → the raw value, and it says so");
    prep = (await call("POST", "/api/grading/prep", { ids: [cheap.id, big.id], company: "PSA" })).body;
    assert.equal(prep.suggestion.service, "PSA Express", "the $1,800 card needs the level whose limit covers it");
    assert.equal(prep.suggestion.total, 298);

    const sub = (await call("POST", "/api/submissions", { company: "PSA", service: "Regular", number: "555", sent: "2026-11-02", itemIds: [cheap.id], newCards: [{ name: "Already at PSA", cost: 12 }] })).body;
    const list = (await call("GET", "/api/submissions")).body;
    const mine = list.find((s) => s.id === sub.id);
    assert.deepEqual(mine.expected, { from: "2026-12-28", to: "2027-01-11", service: "PSA Regular" });
    assert.equal(mine.itemIds.length, 2);
    assert.equal((await call("POST", "/api/grading/precheck", { ids: [cheap.id] })).status, 400, "no photo → nothing to look at");
    const set = (await call("GET", "/api/settings")).body;
    assert.equal(set.psaCallsToday, 0);
  } finally {
    srv.stop();
  }
});

test("PSA refusing the account: the app says what to do, then stops asking for a while (each ask is one of ~100 a day)", async () => {
  const psa = await import("../lib/sources/psa.js");
  const was = globalThis.fetch;
  let asked = 0;
  globalThis.fetch = async () => { asked++; return new Response(JSON.stringify({ Message: "Access to this API is limited to approved customers." }), { status: 403, headers: { "content-type": "application/json" } }); };
  process.env.PSA_API_TOKEN = "t".repeat(40);
  try {
    await assert.rejects(psa.cert("81234567"), (err) => err.message === psa.NOT_APPROVED);
    assert.match(psa.NOT_APPROVED, /collectors-apis@collectors\.com/);
    assert.match(psa.NOT_APPROVED, /token itself is fine/);
    await assert.rejects(psa.cert("81234568"), /hasn't switched API access on/);
    assert.equal(asked, 1, "the second lookup never asked PSA");
    assert.equal((await psa.check({ fresh: true })).ok, false);
    assert.equal(asked, 2, "Settings → Save asks PSA again even while it's been refusing");
  } finally {
    globalThis.fetch = was;
    delete process.env.PSA_API_TOKEN;
  }
});
