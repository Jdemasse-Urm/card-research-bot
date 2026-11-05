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

test("checklist: a read that fits several look-alike versions is flagged (11/5: a Red Ice read as plain Red — $1,665 vs far less)", () => {
  const withRed = [...PRIZM_136, { name: "Victor Wembanyama [Red] #136", set: "2023 Panini Prizm (Basketball)" }];
  const v = jobs.checklistCheck(wemby({ parallel: "Red Prizm" }), withRed);
  assert.match(v.note, /"Red Prizm" fits 2 versions of #136 .*Red Ice.*Red|"Red Prizm" fits 2 versions of #136 .*Red.*Red Ice/);
  assert.equal(v.ambiguous, true, "the second look gets the list to pick from");
  assert.ok(jobs.needsSecondLook({ checklist: v }));
  assert.equal(jobs.checklistCheck(wemby({ parallel: "Red Ice" }), withRed).note, null, "the exact version is one fit");
  assert.equal(jobs.checklistCheck(wemby({ parallel: "Silver Prizm" }), withRed).note, null);
});

test("checklist: a front-only scan (no number read) gets the number from the set's list — only when there's one", () => {
  // what the price site's search returned for "2023 Panini Prizm Victor Wembanyama" (trimmed): inserts are sets of their own
  const player = [
    ["Victor Wembanyama #136", "2023 Panini Prizm (Basketball)"],
    ["Victor Wembanyama [Silver] #136", "2023 Panini Prizm (Basketball)"],
    ["Victor Wembanyama #81", "2023 Panini Prizm Monopoly (Basketball)"],
    ["Victor Wembanyama #3", "2023 Panini Prizm Instant Impact (Basketball)"],
    ["Victor Wembanyama [Red Ice] #136", "2023 Panini Prizm (Basketball)"],
    ["Victor Wembanyama [Blue Prizm] #87", "2023 Panini Select (Basketball)"],
  ].map(([name, set]) => ({ name, set }));
  assert.equal(jobs.numberFromChecklist(wemby({ number: "" }), player), "136");
  assert.equal(jobs.numberFromChecklist(wemby({ number: "" }), [...player, { name: "Victor Wembanyama [Variation] #300", set: "2023 Panini Prizm (Basketball)" }]), null, "two numbers in the set — can't tell from the front");
  assert.equal(jobs.numberFromChecklist(wemby({ number: "", player: "Chet Holmgren" }), player), null, "not this player's list");
  assert.equal(jobs.numberFromChecklist(wemby({ number: "136" }), player), null, "a read number is never replaced");
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
  assert.equal(jobs.checklistCheck(wemby({ number: "0136", parallel: "Red Ice" }), PRIZM_136).note, null);
});

test("checklist: a card read as the base gets a by-eye check when the set has a Silver of it (they look alike flat)", () => {
  const v = jobs.checklistCheck(wemby({}), PRIZM_136);
  assert.match(v.note, /also comes as Silver, which looks like the base in a photo — tilt the card/);
  assert.equal(v.lookalike, true);
  assert.equal(jobs.needsSecondLook({ checklist: v }), false, "a person's check — another look at the same flat photo can't settle it (a backup reader 'settled' it the wrong way round)");
  const priced = PRIZM_136.map((e) => ({ ...e, ungraded: /\[Silver\]/.test(e.name) ? "$897.21" : e.name === "Victor Wembanyama #136" ? "$67.00" : null }));
  assert.match(jobs.checklistCheck(wemby({}), priced).note, /Silver \(~\$897 raw vs ~\$67 for the base\)/);
  const commons = PRIZM_136.map((e) => ({ ...e, ungraded: /\[Silver\]/.test(e.name) ? "$3.00" : e.name === "Victor Wembanyama #136" ? "$0.50" : null }));
  assert.equal(jobs.checklistCheck(wemby({}), commons).note, null, "a $3 Silver isn't worth stopping for");
  const noTwin = PRIZM_136.filter((e) => !/\[Silver\]/.test(e.name));
  assert.equal(jobs.checklistCheck(wemby({}), noTwin).note, null, "no look-alike listed → nothing to check");
  const chrome = [{ name: "Shohei Ohtani [Refractor] #150", set: "2018 Topps Chrome" }, { name: "Shohei Ohtani #150", set: "2018 Topps Chrome" }];
  assert.match(jobs.checklistCheck({ category: "baseball", details: { year: "2018", set: "Topps Chrome", player: "Shohei Ohtani", number: "150", parallel: "" } }, chrome).note, /also comes as Refractor/);
});

test("phone scans: each found card gets its place on the page, what it's in, and what spoiled its photo", () => {
  const photos = jobs.placeCards(2, [
    { photo: 1, box: [520, 40, 990, 480], problem: "none", holder: "sleeve" },
    { photo: 1, box: [10, 520, 480, 960], problem: "glare", holder: "toploader" },
    { photo: 1, box: [10, 40, 480, 480], problem: "made-up", holder: "?" },
    { photo: 2, box: [100, 100, 900, 900], problem: "blurry", holder: "slab" },
    { photo: 9, box: [1, 1, 500, 500] }, // a photo that doesn't exist
  ]);
  assert.equal(photos.length, 2);
  assert.deepEqual(photos[0].boxes, [[10, 40, 480, 480], [10, 520, 480, 960], [520, 40, 990, 480]], "rows top to bottom, left to right");
  assert.deepEqual(photos[0].notes, [
    { problem: "none", holder: "none", position: "row 1, card 1" }, // unknown words become none
    { problem: "glare", holder: "toploader", position: "row 1, card 2" },
    { problem: "none", holder: "sleeve", position: "row 2, card 1" },
  ]);
  assert.deepEqual(photos[1].notes, [{ problem: "blurry", holder: "slab", position: "" }], "one card in the picture: no position");
});

test("full details: a raw card's condition, centering and PSA odds from the scan land in the inventory's own fields", () => {
  const raw = jobs.normalizeRead({ player_or_character: "Wemby", card_number: "136", grading_company: null, condition: "NM", corners: "Sharp", edges: "Light wear", surface: "Clean", centering: "55/45 L/R · 60/40 T/B", psa10_pct: 22.4, psa9_pct: 48, identification_confidence: "high" }, 1);
  assert.deepEqual(raw.condition, { scale: "NM", corners: "Sharp", edges: "Light wear", surface: "Clean", centering: "55/45 L/R · 60/40 T/B", notes: "Estimated from the scan photo · PSA 10 ~22% · PSA 9 ~48%" });
  const slab = jobs.normalizeRead({ player_or_character: "Wemby", grading_company: "PSA", grade: "10", condition: "NM" }, 2);
  assert.equal(slab.condition, null, "a slab's grade is the grade — no photo estimate");
  const hidden = jobs.normalizeRead({ player_or_character: "X", condition: "n/a", corners: "n/a", edges: "n/a", surface: "n/a", centering: null }, 3);
  assert.equal(hidden.condition, null, "glare hid everything: nothing made up");
  // the row keeps it as the editor would, so "What to grade next" reads it
  const row = store.addInventory({ name: raw.name, condition: raw.condition });
  assert.equal(find(row.id).condition.scale, "NM");
  assert.equal(find(row.id).condition.centering, "55/45 L/R · 60/40 T/B");
});

test("hottest cards: a claimed move is checked against the card's own sold prices", () => {
  const now = Date.parse("2026-11-03T12:00:00Z");
  const page = (rows, trend) => ({ recentSales: rows.length ? { Ungraded: rows } : {}, trendPct: trend != null ? { Ungraded: { "1mo": trend } } : {}, history: { Ungraded: [[1, 10], [2, 12], [3, 15]] } });
  const up = jobs.soldCheck(page([{ date: "2026-11-01", price: 150 }, { date: "2026-10-30", price: 140 }, { date: "2026-10-10", price: 100 }, { date: "2026-10-01", price: 100 }]), "weekly", now);
  assert.equal(up.confirmed, true);
  assert.equal(up.changePct, 45);
  assert.match(up.why, /raw sales in the last 7 days average \+45% vs the ones before/);
  assert.deepEqual(up.spark, [10, 12, 15]);
  const flat = jobs.soldCheck(page([{ date: "2026-11-01", price: 101 }, { date: "2026-10-10", price: 100 }], 2), "weekly", now);
  assert.equal(flat.confirmed, false, "sales say +1%, the trend +2%: the claim isn't backed");
  assert.equal(jobs.soldCheck(page([], 15), "monthly", now).confirmed, true, "no recent sales, but a +15% month");
  assert.equal(jobs.soldCheck({}, "weekly", now).confirmed, null, "no data: no verdict either way");
});

test("hottest cards without search: your own tracked cards that rose, biggest first, nothing made up", () => {
  const r = jobs.trackedHotList({ category: "basketball", period: "weekly", reason: "no search", trackedMovers: [{ name: "Wemby", category: "basketball", from: 10, to: 14, pct: 40 }, { name: "Mahomes", category: "football", from: 10, to: 20, pct: 100 }, { name: "Down", category: "basketball", from: 10, to: 8, pct: -20 }], stockMovers: [{ name: "wemby", grade: "Raw", from: 10, to: 12, pct: 0.2 }] });
  assert.deepEqual(r.cards.map((c) => c.name), ["Wemby"], "other categories, falls and the same card twice are left out");
  assert.equal(r.tracked, true);
  assert.deepEqual(r.cards[0].sources, []);
});

test("a second look goes to the unsure cards only — never to a PSA-verified slab", () => {
  assert.equal(jobs.needsSecondLook({ confidence: "high" }), false);
  assert.equal(jobs.needsSecondLook({ confidence: "low" }), true);
  assert.equal(jobs.needsSecondLook({ confidence: "high", parallel_check: "Silver or base?" }), true);
  assert.equal(jobs.needsSecondLook({ confidence: "high", checklist: { note: "no Gold version listed" } }), true);
  assert.equal(jobs.needsSecondLook({ confidence: "low", certVerified: true }), false);
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

test("settings: Google's new AQ. Gemini keys are accepted (older AIza keys too); junk is refused", { timeout: 30000 }, async () => {
  const srv = await startServer();
  try {
    const { call } = srv;
    const aq = "AQ.Ab8" + "x".repeat(20) + "_" + "y".repeat(20) + "-z";
    assert.equal((await call("POST", "/api/settings", { apiKey: aq })).status, 200, "the new key format");
    assert.match(fs.readFileSync(path.join(srv.home, ".env"), "utf8"), new RegExp(`^GEMINI_API_KEY=${aq.replace(/\./g, "\\.")}$`, "m"));
    assert.equal((await call("POST", "/api/settings", { apiKey: "AIza" + "S".repeat(35) })).status, 200, "the older format still works");
    assert.equal((await call("GET", "/api/status")).body.jobIdleSecs, null, "no research yet → an automatic update needn't wait for one");
    const bad = await call("POST", "/api/settings", { apiKey: "not a key" });
    assert.equal(bad.status, 400);
    assert.match(bad.body.error, /AQ\./);
    // a price-site API token that isn't 40 letters/numbers is refused before anything is asked of the site
    const scp = await call("POST", "/api/settings", { scpToken: "too-short" });
    assert.equal(scp.status, 400);
    assert.match(scp.body.error, /SportsCardsPro API token \(40 letters and numbers/);
    assert.doesNotMatch(fs.readFileSync(path.join(srv.home, ".env"), "utf8"), /SPORTSCARDSPRO_API_TOKEN/);
    const s = (await call("GET", "/api/settings")).body;
    assert.deepEqual(s.priceApi, { sportscardspro: false, pricecharting: false });
    assert.equal(s.psaCheck, null, "no PSA token → nothing to check");
  } finally {
    srv.stop();
  }
});

test("price sites: a season year is searched as its first year (the sites' search turns '2023-24' into junk)", async () => {
  const { searchWords } = await import("../lib/sources/pricecharting.js");
  assert.equal(searchWords("2023-24 Panini Prizm Victor Wembanyama 136"), "2023 Panini Prizm Victor Wembanyama 136");
  assert.equal(searchWords("1986-87 Fleer Michael Jordan #57"), "1986 Fleer Michael Jordan #57");
  assert.equal(searchWords("2023/2024 Upper Deck Bedard 201"), "2023 Upper Deck Bedard 201");
  assert.equal(searchWords("Monkey.D.Luffy OP05-119"), "Monkey.D.Luffy OP05-119", "set codes are left alone");
  assert.equal(searchWords("2018 Prizm Luka 280"), "2018 Prizm Luka 280");
});

test("price sites: a card's page address is built the way both sites build theirs", async () => {
  const { pageSlug } = await import("../lib/sources/pricecharting.js");
  // real addresses from the sites' set pages (899 of 900 matched the first rule; "&" was the one fix)
  assert.equal(pageSlug("Shaquille O'Neal [Silver] #181"), "shaquille-o%27neal-silver-181");
  assert.equal(pageSlug("Monkey.D.Luffy [Alt Art] OP01-003"), "monkeydluffy-alt-art-op01-003");
  assert.equal(pageSlug("Ray & Temperature LOB-035"), "ray-&-temperature-lob-035");
  assert.equal(pageSlug("Ken Griffey Jr. #1"), "ken-griffey-jr-1");
  assert.equal(pageSlug("Basketball Cards 2023 Panini Prizm"), "basketball-cards-2023-panini-prizm");
  assert.equal(pageSlug("Pokemon Scarlet & Violet 151"), "pokemon-scarlet-&-violet-151");
});

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
    // the computer claims it: it gets the picture, a second claim (another open screen) gets nothing
    const claim = await call("POST", "/api/scan/inbox/" + sent.name + "/claim");
    assert.equal(claim.status, 200);
    assert.equal(claim.text.length > 1000, true, "the picture itself");
    assert.equal((await call("POST", "/api/scan/inbox/" + sent.name + "/claim")).status, 404, "read once, never twice");
    assert.deepEqual((await call("GET", "/api/scan/inbox")).body, [], "picked up = out of the inbox");
    assert.ok(fs.existsSync(path.join(srv.home, "data", "scan-inbox", "done", sent.name)), "kept a week in case the scan never finished");
    assert.equal((await call("POST", "/api/scan/inbox", { image: jpeg, name: "phone-x-0001-a..evil" })).body.already, true, "a retry of a picture already taken isn't a second copy");
    assert.equal((await call("DELETE", "/api/scan/inbox/" + sent.name)).status, 409, "too late to take it back once it's being read");

    // the phone's view: sent → being read, per picture of its own session; Undo takes back one not started
    const p1 = (await call("POST", "/api/scan/inbox", { image: jpeg, name: "phone-sess1-0001-s" })).body.name;
    (await call("POST", "/api/scan/inbox", { image: jpeg, name: "phone-other-0001-s" }));
    const ps = (await call("GET", "/api/scan/phone-status?session=sess1")).body;
    assert.deepEqual(Object.keys(ps.pictures), [p1], "only this phone's pictures");
    assert.equal(ps.pictures[p1].stage, "sent");
    assert.ok(ps.computer != null, "the computer has looked for pictures (seconds ago)");
    await call("POST", "/api/scan/inbox/" + p1 + "/claim");
    assert.equal((await call("GET", "/api/scan/phone-status?session=sess1")).body.pictures[p1].stage, "reading");
    assert.equal((await call("DELETE", "/api/scan/inbox/phone-other-0001-s.jpg")).status, 200, "undo before the computer took it");
    assert.deepEqual((await call("GET", "/api/scan/phone-status?session=other")).body.pictures, {});

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
