// End-to-end self-test: proves the data sources, the Gemini key, Google Search grounding and a full
// card lookup all work on this computer. Used by Settings → "Run self-test" and `npm run selftest`.

import "dotenv/config"; // so `npm run selftest` sees the same .env as the app
import { Job, explainError, hasKey, MODEL } from "./ai.js";
import { cardLookup } from "./jobs.js";
import * as pricecharting from "./sources/pricecharting.js";
import * as ygoprodeck from "./sources/ygoprodeck.js";
import * as onepiece from "./sources/onepiece.js";
import * as psa from "./sources/psa.js";
import * as ebay from "./sources/ebay.js";

export async function runSelfTest({ full = true, onEvent = () => {}, signal } = {}) {
  const results = [];
  const check = async (name, fn) => {
    const t = Date.now();
    onEvent({ type: "step", text: `Testing: ${name}…` });
    try {
      const detail = await fn();
      results.push({ name, ok: true, ms: Date.now() - t, detail });
      onEvent({ type: "step", text: `✓ ${name}${detail ? " — " + detail : ""}` });
    } catch (err) {
      results.push({ name, ok: false, ms: Date.now() - t, error: explainError(err) });
      onEvent({ type: "step", text: `✗ ${name} — ${explainError(err)}` });
    }
  };

  await check("Sports sold prices (SportsCardsPro)", async () => {
    const [top] = await pricecharting.search("ken griffey jr 1989 upper deck 1", 3, "sports");
    if (!top) throw new Error("no results");
    const d = await pricecharting.card(top.url);
    return `${d.title}: ${Object.values(d.recentSales)[0]?.length || 0} recent sales`;
  });
  await check("TCG sold prices (PriceCharting)", async () => {
    const r = await pricecharting.search("blue-eyes white dragon LOB-001", 3, "tcg");
    if (!r.length) throw new Error("no results");
    return r[0].name;
  });
  await check("Yu-Gi-Oh database", async () => `${(await ygoprodeck.lookup("Dark Magician", 1))[0]?.name || "no result"}`);
  await check("One Piece prices", async () => {
    const r = await onepiece.lookup("OP01-001", 1);
    if (!r.length) throw new Error("no results");
    return `${r[0].name} $${r[0].marketPrice}`;
  });
  if (psa.hasToken()) await check("PSA cert API", async () => ((await psa.cert("10000000")).found ? "cert lookup works" : "connected (test cert not found, that's fine)"));
  if (ebay.hasKeys()) await check("eBay live listings", async () => `${(await ebay.searchActive("ken griffey jr 1989 upper deck", { limit: 5 })).length} listings`);

  if (!hasKey()) {
    results.push({ name: "Gemini AI", ok: false, error: "No Gemini API key yet — add it in Settings." });
    onEvent({ type: "step", text: "✗ Gemini AI — no API key yet" });
  } else {
    await check(`Gemini AI (${MODEL})`, async () => {
      const job = new Job({ kind: "selftest", signal });
      const r = await job.generate({
        system: "Reply with JSON only.",
        parts: [{ text: "Return ok=true and the number 7." }],
        schema: { type: "object", properties: { ok: { type: "boolean" }, n: { type: "integer" } }, required: ["ok", "n"] },
      });
      job.finish();
      if (r.ok !== true) throw new Error("unexpected answer " + JSON.stringify(r));
      return `answered in JSON via ${job.usage.models.join(", ")}`;
    });
    await check("Google Search through Gemini", async () => {
      const job = new Job({ kind: "selftest", signal });
      const text = await job.generate({ system: "Answer in one sentence.", parts: [{ text: "What is the most recent Panini Prizm basketball release? Use Google Search." }], search: true });
      job.finish();
      if (!job.sources.size) throw new Error("answered without searching: " + text.slice(0, 120));
      return `${job.sources.size} sources`;
    });
    if (full) {
      await check("Full card lookup (text)", async () => {
        const r = await cardLookup({ text: "1989 Upper Deck Ken Griffey Jr. #1 rookie, raw" }, { onEvent: () => {}, signal });
        if (!r.card?.name) throw new Error("no card in report");
        return `${r.card.name}: est. $${r.pricing?.estimated_value_usd ?? "?"} (${r.usage.calls} AI calls)`;
      });
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

// CLI: npm run selftest
if (process.argv[1] && process.argv[1].replace(/\\/g, "/").endsWith("lib/selftest.js")) {
  const out = await runSelfTest({ onEvent: (e) => console.log(e.text) });
  console.log(out.ok ? "\nALL TESTS PASSED" : "\nSOME TESTS FAILED (see ✗ above)");
  process.exit(out.ok ? 0 : 1);
}
