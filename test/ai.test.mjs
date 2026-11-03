// How the one Gemini client (lib/ai.js) copes with Google having a bad day: the real SDK talks to a stand-in server
// that is overloaded, hangs, or refuses Google Search on a free-tier key — the cases that made the self-test look stuck.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "cardbot-ai-"));
let behave = () => [200]; // (model, search) → [status, body?] or "hang"
const seen = [];
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const model = req.url.match(/models\/([^:]+):/)?.[1];
    const search = /googleSearch/.test(body);
    seen.push({ model, search });
    const [status, err] = [].concat(behave(model, search));
    if (status === "hang") return; // never answers; the client's deadline has to end it
    res.writeHead(status, { "content-type": "application/json" });
    if (status === 200) {
      const text = /responseJsonSchema/.test(body) ? JSON.stringify({ ok: true, n: 7 }) : `answer from ${model}`;
      return res.end(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } }));
    }
    res.end(JSON.stringify({ error: { code: status, ...err } }));
  });
});
const BUSY = { message: "This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.", status: "UNAVAILABLE" };
// what a free-tier key gets for Google Search on a Gemini 3 model: a bare 429, no retry delay, no per-minute quota
const NO_SEARCH = { message: "You exceeded your current quota, please check your plan and billing details.", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.Help" }] };
const PER_MINUTE = { message: "Quota exceeded for metric generate_content_free_tier_requests, limit: 10 per minute", status: "RESOURCE_EXHAUSTED", details: [{ "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "1s" }] };

let ai;
before(async () => {
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { CARD_BOT_HOME: home, GEMINI_API_KEY: "AQ.test-key-for-the-stand-in-server-0000000", CARD_BOT_GEMINI_URL: `http://127.0.0.1:${server.address().port}`, CARD_BOT_MODEL: "main-model", CARD_BOT_FALLBACK_MODEL: "backup-model" });
  ai = await import("../lib/ai.js");
  Object.assign(ai.WAITS, { slowNotice: 150, retryStep: 20 });
});
after(() => {
  server.close();
  fs.rmSync(home, { recursive: true, force: true });
});
const fresh = () => {
  ai.resetClient();
  seen.length = 0;
};
const run = async (o) => {
  const steps = [];
  const job = new ai.Job({ kind: "test", onEvent: (e) => steps.push(e.text) });
  const t = Date.now();
  try {
    return { out: await job.generate({ system: "s", parts: [{ text: "q" }], ...o }), steps, ms: Date.now() - t, models: job.usage.models };
  } catch (err) {
    return { err, steps, ms: Date.now() - t };
  }
};

test("an overloaded main model: one quick retry, then the backup answers — and the next call skips the main one", async () => {
  fresh();
  behave = (m) => (m === "main-model" ? [503, BUSY] : [200]);
  const r = await run({});
  assert.equal(r.out, "answer from backup-model");
  assert.deepEqual(seen.map((x) => x.model), ["main-model", "main-model", "backup-model"]);
  assert.ok(r.steps.some((s) => /main-model is overloaded at Google right now — switching to backup-model/.test(s)), r.steps.join(" | "));
  seen.length = 0;
  const again = await run({});
  assert.equal(again.out, "answer from backup-model");
  assert.deepEqual(seen.map((x) => x.model), ["backup-model"], "skipped for 5 minutes, no wasted round trip");
});

test("a hung main model goes to the backup after one deadline, not two, and says it's waiting meanwhile", async () => {
  fresh();
  const was = ai.TIMEOUT_MS.plain;
  ai.TIMEOUT_MS.plain = 400;
  behave = (m) => (m === "main-model" ? "hang" : [200]);
  try {
    const r = await run({});
    assert.equal(r.out, "answer from backup-model");
    assert.deepEqual(seen.map((x) => x.model), ["main-model", "backup-model"]);
    assert.ok(r.steps.some((s) => /Still waiting on main-model/.test(s)), "the silence is explained");
    assert.ok(r.steps.some((s) => /main-model is not answering — switching/.test(s)));
  } finally {
    ai.TIMEOUT_MS.plain = was;
  }
});

test("Google Search refused on a free-tier key: fails at once with the fix, and later searches don't ask again", async () => {
  fresh();
  behave = (m, search) => (search ? [429, NO_SEARCH] : [200]);
  const r = await run({ search: true });
  assert.equal(r.err?.message, ai.SEARCH_NEEDS_BILLING);
  assert.ok(r.ms < 2000, `no 20-second "speed limit" waits (took ${r.ms} ms)`);
  assert.equal(seen.length, 1);
  assert.match(ai.SEARCH_NEEDS_BILLING, /Set up billing/);
  const again = await run({ search: true });
  assert.equal(again.err?.message, ai.SEARCH_NEEDS_BILLING);
  assert.equal(seen.length, 1, "the second search never reached Google");
  const plain = await run({});
  assert.equal(plain.out, "answer from main-model", "everything without search still works");
  ai.resetClient(); // a new key (Settings → Save) tries search again
  seen.length = 0;
  behave = () => [200];
  assert.equal((await run({ search: true })).out, "answer from main-model");
});

test("a real per-minute speed limit on a search still waits and retries (it's not mistaken for 'needs billing')", async () => {
  fresh();
  let n = 0;
  behave = () => (n++ === 0 ? [429, PER_MINUTE] : [200]);
  const r = await run({ search: true });
  assert.equal(r.out, "answer from main-model");
  assert.ok(r.steps.some((s) => /speed limit hit — waiting 2 s/.test(s)), r.steps.join(" | "));
});

test("both models overloaded: a plain-words error, not a raw 503", async () => {
  fresh();
  behave = () => [503, BUSY];
  const r = await run({});
  assert.equal(r.err?.status, 503);
  assert.match(ai.explainError(r.err), /overloaded right now/);
});
