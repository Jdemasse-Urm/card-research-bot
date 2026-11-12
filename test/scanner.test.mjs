// 3.19 scanner 10-10: the phone's pictures are never lost (a restart re-reads what wasn't finished; the reader being
// down holds pictures instead of failing them), a slab already in stock is recognised, the phone sends the camera's
// own JPEG, and the phone's view survives a restart. Temp data folders; no network calls.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ApiError } from "@google/genai";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-scanner-"));
const { canRetryLater } = await import("../lib/ai.js");
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(3000, 7), Buffer.from([0xff, 0xd9])]);

test("the reader being down is 'try again later' (credit, limits, overload, network) — a wrong key or a cancel isn't", () => {
  for (const status of [402, 429, 500, 503]) assert.equal(canRetryLater(new ApiError({ message: "x", status })), true, String(status));
  for (const status of [400, 403, 404]) assert.equal(canRetryLater(new ApiError({ message: "x", status })), false, String(status));
  assert.equal(canRetryLater(new TypeError("fetch failed")), true);
  assert.equal(canRetryLater(new Error("Monthly AI budget reached")), false);
  assert.equal(canRetryLater(new Error("Cancelled.")), false);
});

test("a picture of only a card's back is recognised (11/5: a slab's back was read as 'One Piece Card Game')", () => {
  // the computer page's own functions, run here as they are
  const src = fs.readFileSync(path.join(root, "public", "business.js"), "utf8");
  const pick = (name) => {
    const line = src.match(new RegExp(`^const ${name} = .*$`, "m"))[0];
    return line.trimEnd().endsWith(";") ? line : src.match(new RegExp(`^const ${name} = [\\s\\S]*?^};?$`, "m"))[0];
  };
  const looksLikeBack = new Function(`${pick("normName")}\n${pick("looksLikeBack")}\nreturn looksLikeBack;`)();
  assert.equal(looksLikeBack({ name: "One Piece Card Game", details: {} }), true);
  assert.equal(looksLikeBack({ name: "Pokémon Trading Card Game", details: {} }), true);
  assert.equal(looksLikeBack({ name: "2023 Yu-Gi-Oh! card back", details: {} }), true);
  assert.equal(looksLikeBack({ name: "2023 One Piece Kingdom of Ruin Donquixote Doflamingo #OP04-019", details: { player: "Donquixote Doflamingo", number: "OP04-019" } }), false);
  assert.equal(looksLikeBack({ name: "One Piece Card Game", details: { number: "OP01-001" } }), false, "a number means it's a card");
  assert.equal(looksLikeBack({ name: "2024 Panini Prizm Caitlin Clark #22", details: {} }), false);
});

// ---------------------------------------------------------------- the routes, with a bot started (and restarted)

const kids = [];
after(() => kids.forEach((k) => k.kill()));
async function startBot(home) {
  const port = 43000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, CARD_BOT_HOME: home, PORT: String(port), NO_BROWSER: "1", GEMINI_API_KEY: "", SHARE_ON_NETWORK: "0", MJC_API_URL: "" }, stdio: ["ignore", "pipe", "pipe"] });
  kids.push(child);
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const base = await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("server didn't start: " + out)), 15000);
    const check = () => {
      const m = out.match(/running → (http:\/\/[^\s]+)/);
      if (m) (clearTimeout(t), resolve(m[1].replace(/\/$/, "")));
      else setTimeout(check, 100);
    };
    check();
  });
  const call = async (method, url, body, headers = { "content-type": "application/json" }) => {
    const r = await fetch(base + url, { method, headers, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch {}
    return { status: r.status, body: j, text };
  };
  const stop = () => new Promise((r) => (child.once("exit", r), child.kill()));
  return { call, stop };
}
const inbox = (home, ...p) => path.join(home, "data", "scan-inbox", ...p);

test("the phone sends the camera's own JPEG (no base64); a picture the computer took but never finished is read again after a restart", { timeout: 60000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-scanner-srv-"));
  let bot = await startBot(home);
  const raw = { "content-type": "image/jpeg" };
  const sent = await bot.call("POST", "/api/scan/inbox?name=phone-s1-0001-s", JPEG, raw);
  assert.equal(sent.status, 200, sent.text);
  assert.equal(sent.body.name, "phone-s1-0001-s.jpg");
  assert.equal((await bot.call("POST", "/api/scan/inbox?name=phone-s1-0002-s", Buffer.from("not a jpeg at all, just text........"), raw)).status, 400);
  // an older page's JSON still works
  assert.equal((await bot.call("POST", "/api/scan/inbox", { name: "phone-s1-0003-s", image: "data:image/jpeg;base64," + JPEG.toString("base64") })).status, 200);
  const claimed = await bot.call("POST", "/api/scan/inbox/phone-s1-0001-s.jpg/claim");
  assert.equal(claimed.status, 200);
  assert.equal(claimed.text.length > 1000, true);
  assert.deepEqual((await bot.call("GET", "/api/scan/inbox")).body.map((x) => x.name), ["phone-s1-0003-s.jpg"]);

  // the app closes mid-read: at the next start the picture is back in the inbox
  await new Promise((r) => setTimeout(r, 2300)); // the phone's view is saved within 2 s
  await bot.stop();
  bot = await startBot(home);
  assert.deepEqual((await bot.call("GET", "/api/scan/inbox")).body.map((x) => x.name).sort(), ["phone-s1-0001-s.jpg", "phone-s1-0003-s.jpg"], "taken but never read → read again");
  const ps = (await bot.call("GET", "/api/scan/phone-status?session=s1")).body.pictures;
  assert.equal(ps["phone-s1-0001-s.jpg"]?.stage, "reading", "the phone's view survived the restart");
  assert.equal(ps["phone-s1-0003-s.jpg"]?.stage, "sent");
  await bot.stop();
});

test("the first start on 3.19 files pictures already read as finished — never re-read into the list (they may be in stock)", { timeout: 30000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-scanner-old-"));
  fs.mkdirSync(inbox(home, "done"), { recursive: true });
  fs.writeFileSync(inbox(home, "done", "phone-old-0001-s.jpg"), JPEG); // 3.18 kept every read picture here a week
  const bot = await startBot(home);
  assert.deepEqual((await bot.call("GET", "/api/scan/inbox")).body, []);
  assert.ok(fs.existsSync(inbox(home, "read", "phone-old-0001-s.jpg")), "filed as finished");
  // and the phone re-sending it (a dropped answer) isn't a second copy
  assert.equal((await bot.call("POST", "/api/scan/inbox?name=phone-old-0001-s", JPEG, { "content-type": "image/jpeg" })).body.already, true);
  await bot.stop();
});

test("the phone sees which pictures' cards went into inventory, across sessions it carried pictures from", { timeout: 30000 }, async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-scanner-add-"));
  const bot = await startBot(home);
  const raw = { "content-type": "image/jpeg" };
  await bot.call("POST", "/api/scan/inbox?name=phone-old-0003-a", JPEG, raw);
  await bot.call("POST", "/api/scan/inbox?name=phone-new-0001-s", JPEG, raw);
  await bot.call("POST", "/api/scan/inbox?name=phone-else-0001-s", JPEG, raw);
  const both = (await bot.call("GET", "/api/scan/phone-status?session=new,old")).body.pictures;
  assert.deepEqual(Object.keys(both).sort(), ["phone-new-0001-s.jpg", "phone-old-0003-a.jpg"], "both of this phone's sessions, not another phone's");
  // Bulk scan added the picture's cards: its file key → their inventory numbers
  const key = `phone-new-0001-s.jpg|${JPEG.length}|1794500000000`;
  assert.equal((await bot.call("DELETE", "/api/scan", { keys: [key], added: { [key]: ["CRB-0007", "CRB-0008"] } })).status, 200);
  const p = (await bot.call("GET", "/api/scan/phone-status?session=new")).body.pictures["phone-new-0001-s.jpg"];
  assert.equal(p.stage, "added");
  assert.deepEqual(p.skus, ["CRB-0007", "CRB-0008"]);
  await bot.stop();
});
