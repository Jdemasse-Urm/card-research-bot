// 3.10 "a scan you can trust": the set-checklist check, the reader learning from fixes, card facts + condition on
// the row, sealed boxes opened into cards, and the phone/video routes. Temp data folder; no network calls (the
// checklist is tested on saved search results).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

process.env.CARD_BOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-trust-"));
const store = await import("../lib/store.js");
const jobs = await import("../lib/jobs.js");
const find = (id) => store.inventory().find((r) => r.id === id);

// what the price site's search returned for "2023 Panini Prizm 136" (trimmed), plus a look-alike set
const PRIZM_136 = [
  ["Victor Wembanyama #136", "2023 Panini Prizm (Basketball)"],
  ["Victor Wembanyama [Silver] #136", "2023 Panini Prizm (Basketball)"],
  ["Victor Wembanyama [Gold Sparkle] #136", "2023 Panini Prizm (Basketball)"],
  ["Victor Wembanyama [Red Ice] #136", "2023 Panini Prizm (Basketball)"],
  ["Jordan Addison #136", "2023 Panini Prizm Draft Picks (Football)"],
  ["Justin Herbert [Silver Prizm Die-Cut] #136", "2023 Panini Select (Football)"],
].map(([name, set]) => ({ name, set }));
const wemby = (details) => ({ category: "basketball", details: { year: "2023-24", set: "Panini Prizm", player: "Victor Wembanyama", number: "136", parallel: "", ...details } });

test("checklist: entries parse for sports and TCG names", () => {
  assert.deepEqual(jobs.parseEntry("Victor Wembanyama [Silver] #136"), { player: "Victor Wembanyama", parallel: "Silver", number: "136" });
  assert.deepEqual(jobs.parseEntry("Monkey.D.Luffy [Alternate Art] OP05-119"), { player: "Monkey.D.Luffy", parallel: "Alternate Art", number: "OP05-119" });
  assert.deepEqual(jobs.parseEntry("Blue-Eyes White Dragon LOB-001"), { player: "Blue-Eyes White Dragon", parallel: "", number: "LOB-001" });
  assert.equal(jobs.parseEntry("Some Box"), null);
});

test("checklist: a card that matches passes, and the closest set wins (not Draft Picks, not Select)", () => {
  const v = jobs.checklistCheck(wemby({ parallel: "Silver Prizm" }), PRIZM_136);
  assert.equal(v.set, "2023 Panini Prizm (Basketball)");
  assert.equal(v.note, null);
  assert.deepEqual(v.players, ["Victor Wembanyama"]);
  assert.ok(v.parallels.includes("Base") && v.parallels.includes("Silver"));
  assert.equal(jobs.checklistCheck(wemby({ parallel: "Gold" }), PRIZM_136).note, null, "less specific than [Gold Sparkle] is fine");
});

test("checklist: a parallel the set never had is flagged with what is listed", () => {
  const v = jobs.checklistCheck(wemby({ parallel: "Gold Vinyl" }), PRIZM_136);
  assert.match(v.note, /no "Gold Vinyl" version of #136/);
  assert.match(v.note, /Silver/);
});

test("checklist: a misread number is caught — that number is someone else", () => {
  const entries = [{ name: "Seth Lundy #138", set: "2023 Panini Prizm (Basketball)" }];
  const v = jobs.checklistCheck(wemby({ number: "138" }), entries);
  assert.match(v.note, /#138 in 2023 Panini Prizm \(Basketball\) is Seth Lundy, not Victor Wembanyama/);
});

test("checklist: no verdict (never a false alarm) when the set or number isn't found", () => {
  assert.equal(jobs.checklistCheck(wemby({ number: "999" }), PRIZM_136), null);
  assert.equal(jobs.checklistCheck(wemby({ set: "Topps Chrome" }), PRIZM_136), null);
  assert.equal(jobs.checklistCheck({ category: "basketball", details: { player: "X" } }, PRIZM_136), null, "no number, no check");
});

test("checklist: One Piece codes and zero-padded numbers match", () => {
  const op = [{ name: "Monkey.D.Luffy [Alternate Art] OP05-119", set: "One Piece Awakening of the New Era" }, { name: "Monkey.D.Luffy OP05-119", set: "One Piece Awakening of the New Era" }];
  const v = jobs.checklistCheck({ category: "onepiece", details: { set: "OP05 Awakening of the New Era", player: "Monkey D. Luffy", number: "OP05-119", parallel: "Alternate Art" } }, op);
  assert.equal(v.note, null);
  assert.equal(jobs.checklistCheck(wemby({ number: "0136" }), PRIZM_136).note, null);
});

test("parallel matching: noise words and print runs don't count; a word the listing lacks does", () => {
  assert.ok(jobs.parallelMatches("Silver Prizm", "Silver"));
  assert.ok(jobs.parallelMatches("Blue /199", "Blue"));
  assert.ok(jobs.parallelMatches("Refractor", "Refractor"));
  assert.ok(!jobs.parallelMatches("Refractor", "Blue Refractor"));
  assert.ok(!jobs.parallelMatches("Gold Shimmer", "Gold"));
});

test("the reader's fixes become an accuracy score and its 'look twice' notes, most repeated first", () => {
  store.addScanFeedback([
    { set: "2023 Panini Prizm", fixed: { parallel: { from: "", to: "Silver" } } },
    { set: "2023 Panini Prizm", fixed: { parallel: { from: "", to: "Silver" } } },
    { set: "2023 Topps Chrome", fixed: { number: { from: "36", to: "38" } } },
    { set: "2023 Topps Chrome", fixed: {} },
    { set: "x", fixed: { grade: { from: "PSA 9", to: "psa 9" } } }, // only letter case: not a fix
  ]);
  const a = store.scanAccuracy();
  assert.equal(a.cards, 5);
  assert.equal(a.allRight, 40); // 2 of 5 needed no fix
  assert.equal(a.fields.parallel, 60);
  assert.equal(a.fields.number, 80);
  const hints = store.scanHints();
  assert.equal(hints[0], '2023 Panini Prizm: parallel was read as base but it was "Silver" (2 times)');
  assert.match(hints[1], /number was read as "36" but it was "38"/);
});

test("card facts and condition are kept on the row; bulk condition keeps each card's own centering", () => {
  const r = store.addInventory({ name: "Raw card", facts: { year: "2023", set: "Prizm", player: "Wemby", number: "#136", rookie: "on", cert: "PSA 123-456", junk: 1 }, condition: { scale: "LP", centering: "55/45 L/R", corners: "Light wear", surface: "bogus" } });
  assert.deepEqual(r.facts, { year: "2023", set: "Prizm", player: "Wemby", number: "136", parallel: "", serial: "", team: "", rookie: true, auto: false, relic: false, cert: "123456", certVerified: false });
  assert.equal(r.condition.scale, "LP");
  assert.equal(r.condition.surface, "", "only the listed words");
  assert.match(r.condition.at, /^\d{4}-\d{2}-\d{2}$/);
  store.updateMany([r.id], { conditionScale: "NM" }, "Jeff");
  assert.equal(find(r.id).condition.scale, "NM");
  assert.equal(find(r.id).condition.centering, "55/45 L/R");
  assert.equal(store.updateInventory(r.id, { condition: { scale: "" } }).condition, null, "an empty condition clears it");
  assert.equal(store.updateInventory(r.id, { kind: "sealed", upc: "0 12345-67890 5", sealedType: "Hobby box" }).upc, "012345678905");
});

test("opening a sealed box spreads its cost over what came out (by value) and keeps the record; the last one leaves stock", () => {
  const box = store.addInventory({ name: "2023 Prizm Hobby", kind: "sealed", sealedType: "Hobby box", qty: 2, cost: 100 });
  const hit = store.addInventory({ name: "Hit", value: 75 });
  const base = store.addInventory({ name: "Base", value: 25, qty: 1 });
  const r = store.openSealed(box.id, [hit.id, base.id], "Joe");
  assert.equal(r.pulls, 2);
  assert.equal(find(hit.id).cost, 75);
  assert.equal(find(base.id).cost, 25);
  assert.equal(find(hit.id).openedFrom, box.id);
  assert.equal(find(box.id).qty, 1);
  assert.equal(store.boxBreaks()[0].value, 100);
  const last = store.openSealed(box.id, [], "Joe");
  assert.ok(last.trashId, "the last box is removed (into the trash)");
  assert.equal(find(box.id), undefined);
  assert.equal(store.openSealed(hit.id, []), null, "only sealed rows open");
});

// ---------------------------------------------------------------- routes

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
async function startServer() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tcrb-trust-srv-"));
  const port = 41000 + Math.floor(Math.random() * 2000);
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
    const r = await fetch(base + url, { method, headers: { "content-type": "application/json", "x-user": "Tester" }, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    const text = await r.text();
    let j = null;
    try { j = JSON.parse(text); } catch {}
    return { status: r.status, body: j, text };
  };
  return { call, home, stop: () => child.kill() };
}

test("routes: feedback + accuracy, phone inbox, box opening, video, card facts in the full card", { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const { call } = srv;
    assert.equal((await call("POST", "/api/scan/feedback", { cards: [{ set: "S", fixed: { number: { from: "1", to: "7" } } }] })).body.cards, 1);
    const acc = (await call("GET", "/api/scan/accuracy")).body;
    assert.equal(acc.fields.number, 0);
    assert.equal(acc.hints.length, 1);

    // the phone: without home-network sharing there's no code, and a made-up key is refused
    assert.deepEqual((await call("GET", "/api/scan/phone-link")).body, { share: false });
    assert.equal((await call("GET", "/phone?k=nope")).status, 403);
    const jpeg = "data:image/jpeg;base64," + Buffer.concat([Buffer.from([0xff, 0xd8]), Buffer.alloc(2000, 7)]).toString("base64");
    assert.equal((await call("POST", "/api/scan/inbox", { image: "data:image/png;base64,AAAA" })).status, 400);
    const sent = (await call("POST", "/api/scan/inbox", { image: jpeg, name: "phone-x-0001-a/../evil" })).body;
    assert.equal(sent.name, "phone-x-0001-a..evil.jpg", "no path tricks in the name");
    assert.deepEqual((await call("GET", "/api/scan/inbox")).body.map((x) => x.name), [sent.name]);
    await call("DELETE", "/api/scan/inbox/" + sent.name);
    assert.deepEqual((await call("GET", "/api/scan/inbox")).body, [], "picked up = out of the inbox");
    assert.ok(fs.existsSync(path.join(srv.home, "data", "scan-inbox", "done", sent.name)), "kept a week in case the scan never finished");

    // a box opened into the cards just added
    const box = (await call("POST", "/api/inventory", { name: "Blaster", kind: "sealed", sealedType: "Blaster box", cost: 30 })).body;
    const many = (await call("POST", "/api/inventory/many", { items: [{ name: "Pull A", value: 20, facts: { player: "A", number: "1" } }, { name: "Pull B", value: 10 }] })).body;
    const opened = (await call("POST", `/api/inventory/${box.id}/open`, { pullIds: many.rows.map((r) => r.id) })).body;
    assert.equal(opened.value, 30);
    const pullA = (await call("GET", "/api/inventory/" + many.rows[0].id)).body;
    assert.equal(pullA.cost, 20);
    assert.equal(pullA.facts.player, "A");
    assert.equal(pullA.pop, null);
    assert.equal((await call("POST", `/api/inventory/${box.id}/open`, {})).status, 404, "the last one is gone");
    const sales = (await call("GET", "/api/analytics")).body;
    assert.equal(sales.boxes.count, 1);
    assert.equal(sales.boxes.result, 0); // $30 box, $30 of cards still in stock

    // tilt video
    const mp4 = "data:video/mp4;base64," + Buffer.alloc(3000, 1).toString("base64");
    assert.equal((await call("POST", `/api/inventory/${many.rows[0].id}/video`, { data: "data:video/avi;base64,AAAA" })).status, 400);
    const v = (await call("POST", `/api/inventory/${many.rows[0].id}/video`, { data: mp4 })).body;
    assert.match(v.video, /\.mp4$/);
    assert.equal((await call("GET", "/api/inventory/" + many.rows[0].id)).body.video, v.video);
    assert.equal((await call("DELETE", `/api/inventory/${many.rows[0].id}/video`)).status, 200);
    assert.equal((await call("GET", "/api/inventory/" + many.rows[0].id)).body.video, null);

    const st = (await call("GET", "/api/status")).body;
    assert.equal(st.conditions.NM, "Near Mint");
    assert.ok(st.sealedTypes.includes("Hobby box"));
  } finally {
    srv.stop();
  }
});
