// 3.20: the phone scanner from anywhere. With the MJC store connected, the phone sends its pictures to the store (any
// Wi-Fi, cell data); the bot whose window is open takes each waiting picture into its own scan inbox (the same one the
// home-Wi-Fi phone uses), tells the store what it read for the phone, hands the phone's ＋ Add requests to Bulk scan,
// and puts its own phone page on the store. A stand-in store plays the real one's part; no network calls leave the PC.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const TOKEN = "z".repeat(64);
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(4000, 9), Buffer.from([0xff, 0xd9])]);

// ---- the stand-in store: the scanner's admin side, as the real one answers it
const S = { by: {}, key: "k".repeat(32), waiting: [], files: new Map(), claims: [], deleted: [], statuses: [], page: null, adds: [], addsDone: [], newKeys: 0 };
const stub = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString("utf8");
    const j = raw ? JSON.parse(raw) : {};
    const send = (status, body) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    const url = new URL(req.url, "http://x");
    // a signed download link: no sync key needed (like S3's)
    if (url.pathname.startsWith("/dl/")) return res.writeHead(200, { "content-type": "image/jpeg" }).end(S.files.get(decodeURIComponent(url.pathname.slice(4))));
    if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(401, { error: "Not authorized." });
    if (req.method === "GET" && url.pathname === "/admin/scan") {
      return send(200, { key: S.key, waiting: S.waiting.map((name) => ({ name, at: new Date(Date.now() - 5000).toISOString(), by: S.by[name] || "" })), adds: S.adds, activeAt: new Date().toISOString(), pageVersion: S.page?.version || null, reading: url.searchParams.get("reading") });
    }
    let m;
    if (req.method === "POST" && (m = url.pathname.match(/^\/admin\/scan\/claim\/(.+)$/))) {
      const name = decodeURIComponent(m[1]);
      if (!S.waiting.includes(name)) return send(409, { error: "Another computer took it." });
      S.waiting = S.waiting.filter((n) => n !== name);
      S.claims.push({ name, device: j.device });
      return send(200, { ok: true, url: `http://127.0.0.1:${stub.address().port}/dl/${encodeURIComponent(name)}` });
    }
    if (req.method === "DELETE" && (m = url.pathname.match(/^\/admin\/scan\/pic\/(.+)$/))) return S.deleted.push(decodeURIComponent(m[1])), send(200, { ok: true });
    if (req.method === "PUT" && url.pathname === "/admin/scan/status") return S.statuses.push(j.sessions), send(200, { ok: true });
    if (req.method === "PUT" && url.pathname === "/admin/scan/page") return (S.page = j), send(200, { ok: true, version: j.version });
    if (req.method === "DELETE" && (m = url.pathname.match(/^\/admin\/scan\/add\/(.+)$/))) {
      S.addsDone.push(decodeURIComponent(m[1]));
      S.adds = S.adds.filter((a) => a.id !== decodeURIComponent(m[1]));
      return send(200, { ok: true });
    }
    if (req.method === "POST" && url.pathname === "/admin/scan/key") return (S.key = String(++S.newKeys).padStart(32, "n")), send(200, { key: S.key });
    if (url.pathname === "/admin/team") return send(200, { collections: {} });
    send(200, { ok: true });
  });
});
await new Promise((r) => stub.listen(0, "127.0.0.1", r));
const STORE = `http://127.0.0.1:${stub.address().port}`;

const kids = [];
after(() => (kids.forEach((k) => k.kill()), stub.close()));
async function startBot() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-anywhere-"));
  const port = 45000 + Math.floor(Math.random() * 2000);
  const child = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, CARD_BOT_HOME: home, PORT: String(port), NO_BROWSER: "1", GEMINI_API_KEY: "", PSA_API_TOKEN: "", SHARE_ON_NETWORK: "0", MJC_API_URL: STORE, MJC_SYNC_TOKEN: TOKEN }, stdio: ["ignore", "pipe", "pipe"] });
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
    let b = null;
    try { b = JSON.parse(text); } catch {}
    return { status: r.status, body: b, text };
  };
  const stop = () => new Promise((r) => (child.once("exit", r), child.kill()));
  return { call, base, home, stop, out: () => out };
}
/** wait until fn() is truthy, while the bot's window "is open" (Bulk scan looks at the inbox every 3 s, as the page does) */
async function until(bot, fn, ms = 25000) {
  const end = Date.now() + ms;
  for (;;) {
    const list = (await bot.call("GET", "/api/scan/inbox")).body;
    const v = await fn(list);
    if (v) return v;
    if (Date.now() > end) throw new Error("timed out\n" + bot.out().slice(-1500));
    await new Promise((r) => setTimeout(r, 500));
  }
}

test("a picture sent from anywhere lands in this computer's scan inbox; what was read goes back for the phone; the phone's ＋ Add reaches Bulk scan", { timeout: 90000 }, async () => {
  const bot = await startBot();

  // the bot puts its own phone page on the store (all of it, at its version)
  const version = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version;
  await until(bot, () => S.page);
  assert.equal(S.page.version, version);
  for (const f of ["phone.html", "phone.js", "phone-sw.js", "apple-touch-icon.png", "icon.svg"]) assert.ok(S.page.files[f], f);
  assert.match(Buffer.from(S.page.files["phone.html"], "base64").toString(), /<title>Card Scanner<\/title>/);

  // the 📱 Phone window: the store's link (works anywhere), not the home Wi-Fi one
  const link = (await bot.call("GET", "/api/scan/phone-link")).body;
  assert.equal(link.cloud, true);
  assert.equal(link.url, `${STORE}/scan/?s=${S.key}`);
  assert.match(link.svg, /<svg/);

  // a picture waiting in the store → taken (by this computer, named), downloaded into the inbox, off the store
  S.files.set("phone-c1-0001-s.jpg", JPEG);
  S.by["phone-c1-0001-s.jpg"] = "Dad"; // 3.22: whose phone rides with the picture (11/15: Dad's scan was taken for Joseph's)
  S.waiting.push("phone-c1-0001-s.jpg");
  const inbox = await until(bot, (list) => list.find((x) => x.name === "phone-c1-0001-s.jpg"));
  assert.ok(inbox);
  assert.equal(inbox.by, "Dad", "Bulk scan knows whose phone it came from");
  assert.deepEqual(S.claims.map((c) => c.name), ["phone-c1-0001-s.jpg"]);
  assert.equal(S.claims[0].device, "This computer");
  assert.ok(fs.readFileSync(path.join(bot.home, "data", "scan-inbox", "phone-c1-0001-s.jpg")).equals(JPEG));
  await until(bot, () => S.deleted.includes("phone-c1-0001-s.jpg"));

  // what this computer does with it goes to the store for the phone (Bulk scan takes it: "reading")
  assert.equal((await bot.call("POST", "/api/scan/inbox/phone-c1-0001-s.jpg/claim")).status, 200);
  const seen = await until(bot, () => { const v = S.statuses.map((s) => s.c1?.["phone-c1-0001-s.jpg"]?.stage).filter(Boolean); return v.includes("reading") ? v : null; });
  assert.ok(seen.includes("reading"), JSON.stringify(seen));

  // a picture the store says is waiting, but this computer already has (a re-send): never a second copy
  S.files.set("phone-c1-0001-s.jpg", Buffer.concat([JPEG, Buffer.from("again")]));
  S.waiting.push("phone-c1-0001-s.jpg");
  await until(bot, () => S.deleted.filter((n) => n === "phone-c1-0001-s.jpg").length === 2);
  assert.ok(!fs.existsSync(path.join(bot.home, "data", "scan-inbox", "phone-c1-0001-s.jpg")), "still only the one in done/");

  // ＋ Add on the phone: Bulk scan sees it, adds what it trusts, says how many it left; the store's request is done
  S.adds.push({ id: "A1", names: ["phone-c1-0001-s.jpg"], paid: 25, by: "Dad", at: new Date().toISOString() });
  const asks = await until(bot, async () => {
    const a = (await bot.call("GET", "/api/scan/phone-adds")).body;
    return a.length ? a : null;
  });
  assert.deepEqual(asks.map((a) => [a.id, a.names, a.paid, a.by, a.cloud]), [["A1", ["phone-c1-0001-s.jpg"], 25, "Dad", true]]);
  // Bulk scan sends the add's own person (x-user), so the activity says who added it
  const done = await fetch(bot.base + "/api/scan/phone-adds/A1/done", { method: "POST", headers: { "content-type": "application/json", "x-user": "Dad" }, body: JSON.stringify({ left: { "phone-c1-0001-s.jpg": 1 }, missing: [], added: 2 }) });
  assert.equal(done.status, 200);
  assert.ok((await bot.call("GET", "/api/activity")).body.some((x) => x.who === "Dad" && /added 2 cards from the phone/.test(x.text)), "Dad's add is logged as Dad's");
  assert.deepEqual(S.addsDone, ["A1"]);
  const after = await until(bot, () => S.statuses.map((s) => s.c1?.["phone-c1-0001-s.jpg"]).filter((x) => x?.addLeft === 1).pop());
  assert.ok(after.addDoneAt > 0, "the phone stops showing 'adding…'");
  assert.deepEqual((await bot.call("GET", "/api/scan/phone-adds")).body, []);

  // a lost phone: a new link — the old key is gone from the 📱 Phone window
  const fresh = (await bot.call("POST", "/api/scan/phone-link/new")).body;
  assert.equal(fresh.url, `${STORE}/scan/?s=${S.key}`);
  assert.notEqual(S.key, "k".repeat(32));
  await bot.stop();
});

test("a computer whose window isn't open leaves the store's pictures for one that can read them", { timeout: 40000 }, async () => {
  const bot = await startBot();
  S.files.set("phone-c2-0001-s.jpg", JPEG);
  S.waiting.push("phone-c2-0001-s.jpg");
  // nobody polls the inbox here (the window is closed): 8 seconds, nothing taken
  await new Promise((r) => setTimeout(r, 8000));
  assert.ok(S.waiting.includes("phone-c2-0001-s.jpg"));
  assert.ok(!S.claims.some((c) => c.name === "phone-c2-0001-s.jpg"));
  // the window opens: taken
  await until(bot, (list) => list.find((x) => x.name === "phone-c2-0001-s.jpg"));
  await bot.stop();
});

test("the phone on the home Wi-Fi can ask for ＋ Add too (no store needed for that)", { timeout: 30000 }, async () => {
  const bot = await startBot();
  assert.equal((await bot.call("POST", "/api/scan/phone-add", { names: ["phone-c3-0002-s.jpg", "../../etc"], paid: "abc", by: " Joseph\t" })).status, 200);
  const a = (await bot.call("GET", "/api/scan/phone-adds")).body.find((x) => x.names.includes("phone-c3-0002-s.jpg"));
  assert.deepEqual([a.names, a.paid, a.by, a.cloud], [["phone-c3-0002-s.jpg"], 0, "Joseph", false]);
  // and a picture sent straight to this computer (home Wi-Fi or Tailscale) carries its person too
  const pic = await fetch(bot.base + "/api/scan/inbox?name=phone-c3-0003-s&by=Joseph", { method: "POST", headers: { "content-type": "image/jpeg" }, body: JPEG });
  assert.equal(pic.status, 200);
  assert.equal((await bot.call("GET", "/api/scan/inbox")).body.find((x) => x.name === "phone-c3-0003-s.jpg")?.by, "Joseph");
  assert.equal((await bot.call("POST", "/api/scan/phone-add", { names: [] })).status, 400);
  await bot.stop();
});
