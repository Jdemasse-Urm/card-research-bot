// 3.13 the website's new services, the bot's side: credit codes, drop times, what goes to the site, and Setup
// keeping the show calendar. (The two apps together were checked end to end against the store's dev server.)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-web313-"));
const store = await import("../lib/store.js");
const mjc = await import("../lib/mjc.js");

test("a customer's online credit code is made once and kept", () => {
  const c = store.addCustomer({ name: "Mike" });
  const code = store.ensureCreditCode(c.id);
  assert.match(code, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/);
  assert.equal(store.ensureCreditCode(c.id), code);
  assert.equal(store.ensureCreditCode("nobody"), null);
});

test("a drop time is kept as a moment (blank = now) and goes to the website with the card", () => {
  const r = store.addInventory({ name: "Drop", web: true, webGoLiveAt: "2026-11-06T19:00" });
  assert.equal(r.webGoLiveAt, new Date("2026-11-06T19:00").toISOString());
  assert.equal(store.updateInventory(r.id, { webGoLiveAt: "" }).webGoLiveAt, null);
  store.updateInventory(r.id, { webGoLiveAt: "2030-01-01T10:00" });
  assert.equal(mjc.siteItem(store.inventory().find((x) => x.id === r.id)).goLiveAt, new Date("2030-01-01T10:00").toISOString());
});

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test("Setup keeps the show calendar and the new switches", { timeout: 30000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-web313-srv-"));
  const port = 47000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, CARD_BOT_HOME: home, PORT: String(port), NO_BROWSER: "1", GEMINI_API_KEY: "", SHARE_ON_NETWORK: "0", MJC_API_URL: "", MJC_SYNC_TOKEN: "" }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  try {
    await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("no start: " + out)), 15000);
      const check = () => (/running →/.test(out) ? (clearTimeout(t), resolve()) : setTimeout(check, 100));
      check();
    });
    const call = async (method, url, body) => {
      const r = await fetch(`http://localhost:${port}${url}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: r.status, body: await r.json().catch(() => null) };
    };
    // a calendar already in the store settings (Shop → Shows writes it there)
    fs.writeFileSync(path.join(home, "data", "mjc-store.json"), JSON.stringify({ name: "MJC", shows: [{ id: "s1", name: "Novi", date: "2099-01-01" }] }));
    const r = await call("PUT", "/api/mjc/store", { name: "MJC", showPickup: true, payLater: true, giftCards: true, giftAmounts: "20, 50, 5000", creditOnline: true, reviewOver: "500" });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.store.shows, [{ id: "s1", name: "Novi", date: "2099-01-01" }]);
    assert.deepEqual(r.body.store.giftAmounts, [20, 50], "an amount over $1,000 is dropped");
    assert.equal(r.body.store.reviewOver, 500);
    assert.ok(r.body.store.showPickup && r.body.store.payLater && r.body.store.creditOnline);
    // not connected to the website: its pages say so instead of failing quietly
    assert.equal((await call("GET", "/api/mjc/reviews")).status, 502);
  } finally {
    child.kill();
  }
});
