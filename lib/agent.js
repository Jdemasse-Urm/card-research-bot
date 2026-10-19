// The research agent: Claude (vision + live web search) with our price scrapers as tools.
// One loop drives every job (card lookup, hottest cards, free questions). A job ends when Claude
// calls its "submit_*" tool, which hands back structured JSON the UI can render.

import Anthropic from "@anthropic-ai/sdk";
import * as pricecharting from "./sources/pricecharting.js";
import * as ygoprodeck from "./sources/ygoprodeck.js";
import * as onepiece from "./sources/onepiece.js";

export const MODEL = process.env.CARD_BOT_MODEL || "claude-opus-5-5";
const EFFORT = process.env.CARD_BOT_EFFORT || "medium";
const MAX_TURNS = 24;

// Server-side refusal fallback (opt-in, on by default). If the account/endpoint rejects the
// parameter we switch it off for the rest of the session and resend without it.
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
let useFallbacks = process.env.CARD_BOT_FALLBACKS !== "off";

let client = null;
export function resetClient() {
  client = null;
}
function getClient() {
  if (!client) client = new Anthropic(); // reads ANTHROPIC_API_KEY
  return client;
}
export const hasKey = () => Boolean(process.env.ANTHROPIC_API_KEY);

// ---------------- tools ----------------

const SERVER_TOOLS = [
  { type: "web_search_20260209", name: "web_search", max_uses: 8 },
  { type: "web_fetch_20260209", name: "web_fetch", max_uses: 6 },
];

const DATA_TOOLS = [
  {
    name: "pricecharting_search",
    description:
      "Search PriceCharting for a trading card (sports cards, Yu-Gi-Oh, One Piece). Returns matching card pages with their set name and URL. " +
      "Good queries: 'luka doncic 2018 prizm 280', 'ken griffey jr 1989 upper deck 1', 'blue-eyes white dragon LOB-001 1st edition', 'monkey d luffy OP05-119 manga'. " +
      "Parallels/variants are separate pages, e.g. 'silver prizm', '[Alternate Art Manga]', '[1st Edition]'.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Player/character + year + set + card number + parallel" },
        kind: { type: "string", enum: ["sports", "tcg", "any"], description: "sports = baseball/basketball/football, tcg = Yu-Gi-Oh/One Piece" },
      },
      required: ["query"],
    },
  },
  {
    name: "pricecharting_card",
    description:
      "Open one PriceCharting card page. Returns current value for every grade (Ungraded, Grade 7-9.5, PSA/BGS/CGC/SGC 10...), " +
      "the most recent eBay completed sales per grade with dates and prices, sales volume, and 1/3/6/12-month price trend %. " +
      "This is the primary source for recent sold prices.",
    input_schema: {
      type: "object",
      properties: { url: { type: "string", description: "A https://www.pricecharting.com/game/... URL from pricecharting_search" } },
      required: ["url"],
    },
  },
  {
    name: "yugioh_lookup",
    description:
      "Yu-Gi-Oh card database (YGOPRODeck): card details, every printing with set code + rarity + typical price, and current " +
      "TCGplayer/Cardmarket/eBay/Amazon prices, plus banlist status. Use the exact English card name if you can.",
    input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
  },
  {
    name: "onepiece_lookup",
    description:
      "One Piece TCG database (optcgapi.com): every booster and starter-deck card incl. alternate-art/manga/SP variants with " +
      "TCGplayer market price (refreshed daily). Query by name and/or card number like 'OP05-119' or 'Shanks OP09'.",
    input_schema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
  },
];

async function runDataTool(name, input) {
  switch (name) {
    case "pricecharting_search":
      return pricecharting.search(String(input.query || ""), 12, ["sports", "tcg"].includes(input.kind) ? input.kind : "any");
    case "pricecharting_card":
      return pricecharting.card(String(input.url || ""));
    case "yugioh_lookup":
      return ygoprodeck.lookup(String(input.name || ""));
    case "onepiece_lookup":
      return onepiece.lookup(String(input.query || ""));
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function describeTool(name, input) {
  switch (name) {
    case "pricecharting_search":
      return `Searching sold-price database for "${input.query}"`;
    case "pricecharting_card":
      return `Reading recent sales: ${decodeURIComponent(String(input.url || "").split("/game/")[1] || "")}`;
    case "yugioh_lookup":
      return `Checking Yu-Gi-Oh database for "${input.name}"`;
    case "onepiece_lookup":
      return `Checking One Piece database for "${input.query}"`;
    case "web_search":
      return `Searching the web: "${input.query}"`;
    case "web_fetch":
      return `Reading page: ${input.url}`;
    default:
      return name;
  }
}

// ---------------- loop ----------------

async function callClaude(params) {
  const c = getClient();
  if (useFallbacks) {
    try {
      return await c.beta.messages.create({ ...params, betas: [FALLBACK_BETA], fallbacks: "default" });
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError) || !/fallback/i.test(err.message)) throw err;
      useFallbacks = false;
    }
  }
  return c.beta.messages.create(params);
}

/**
 * Run one research job.
 * @param {object} o
 * @param {string} o.system      system prompt
 * @param {Array}  o.content     first user message content blocks (text and/or images)
 * @param {object} o.finishTool  the submit_* tool definition (strict JSON schema)
 * @param {(e:{type:string,text?:string})=>void} o.onEvent progress callback
 * @returns {Promise<{result:object, sources:Array<{title:string,url:string}>, usage:object}>}
 */
export async function runJob({ system, content, finishTool, onEvent = () => {} }) {
  if (!hasKey()) throw new Error("No Anthropic API key yet — open Settings (top right) and paste your key.");

  const tools = [...SERVER_TOOLS, ...DATA_TOOLS, finishTool];
  const messages = [{ role: "user", content }];
  const sources = new Map();
  const usage = { input: 0, output: 0, cacheRead: 0, webSearches: 0 };

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await callClaude({
      model: MODEL,
      max_tokens: 16000,
      system,
      tools,
      tool_choice: { type: "auto" },
      cache_control: { type: "ephemeral" },
      output_config: { effort: EFFORT },
      messages,
    });

    usage.input += response.usage?.input_tokens || 0;
    usage.output += response.usage?.output_tokens || 0;
    usage.cacheRead += response.usage?.cache_read_input_tokens || 0;
    usage.webSearches += response.usage?.server_tool_use?.web_search_requests || 0;

    if (response.stop_reason === "refusal") {
      throw new Error("Claude declined this request" + (response.stop_details?.explanation ? `: ${response.stop_details.explanation}` : "."));
    }

    // Progress + citations from this turn.
    for (const b of response.content) {
      if (b.type === "server_tool_use") onEvent({ type: "step", text: describeTool(b.name, b.input || {}) });
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r.url) sources.set(r.url, { title: r.title || r.url, url: r.url });
      }
      if (b.type === "text" && b.citations) {
        for (const c of b.citations) if (c.url) sources.set(c.url, { title: c.title || c.url, url: c.url });
      }
    }

    messages.push({ role: "assistant", content: response.content });

    if (response.stop_reason === "pause_turn") continue; // long server-side search; resume

    const toolUses = response.content.filter((b) => b.type === "tool_use");
    const finish = toolUses.find((b) => b.name === finishTool.name);
    if (finish) {
      if (response.stop_reason === "max_tokens") throw new Error("The report was cut off (too long). Try again.");
      return { result: finish.input, sources: [...sources.values()].slice(0, 25), usage };
    }

    if (toolUses.length === 0) {
      // Claude answered in plain text without submitting — nudge it once more.
      messages.push({ role: "user", content: [{ type: "text", text: `Please call ${finishTool.name} with your findings.` }] });
      continue;
    }

    const results = await Promise.all(
      toolUses.map(async (tu) => {
        onEvent({ type: "step", text: describeTool(tu.name, tu.input || {}) });
        try {
          const out = await runDataTool(tu.name, tu.input || {});
          const text = JSON.stringify(out);
          return { type: "tool_result", tool_use_id: tu.id, content: text.length > 60000 ? text.slice(0, 60000) + "…(truncated)" : text };
        } catch (err) {
          return { type: "tool_result", tool_use_id: tu.id, is_error: true, content: `Error: ${err.message}` };
        }
      }),
    );
    if (turn >= MAX_TURNS - 3) {
      results.push({ type: "text", text: `You are out of research steps. Call ${finishTool.name} now with what you have.` });
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error("Research took too many steps without a final report. Try a more specific card or photo.");
}

// Friendly text for API errors shown in the UI.
export function explainError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "Your Anthropic API key was rejected. Check it in Settings.";
  if (err instanceof Anthropic.PermissionDeniedError) return "This API key isn't allowed to use that feature/model: " + err.message;
  if (err instanceof Anthropic.RateLimitError) return "Rate limited by Anthropic — wait a minute and try again.";
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(err.message)) return "Your Anthropic account is out of credits — add credits at console.anthropic.com → Billing.";
    return "Request rejected: " + err.message;
  }
  if (err instanceof Anthropic.APIConnectionError) return "Couldn't reach Anthropic — check the internet connection.";
  if (err instanceof Anthropic.APIError) return `Anthropic API error ${err.status}: ${err.message}`;
  return err?.message || String(err);
}
