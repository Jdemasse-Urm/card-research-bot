// The three things the bot does — each is a system prompt + a strict "submit" schema for runJob().

import { runJob } from "./agent.js";

export const CATEGORIES = {
  all: "all five categories (baseball, basketball, football, Yu-Gi-Oh, One Piece)",
  baseball: "baseball cards",
  basketball: "basketball cards",
  football: "football cards",
  yugioh: "Yu-Gi-Oh! TCG cards",
  onepiece: "One Piece TCG cards",
};
export const PERIODS = { daily: "the last 24-48 hours", weekly: "the last 7 days", monthly: "the last 30 days" };

// ---- strict-schema helpers (every key required, no extras) ----
const S = (d) => ({ type: "string", description: d });
const SN = (d) => ({ type: ["string", "null"], description: d });
const N = (d) => ({ type: ["number", "null"], description: d });
const B = (d) => ({ type: "boolean", description: d });
const E = (values, d) => ({ type: "string", enum: values, description: d });
const A = (items, d) => ({ type: "array", items, description: d });
const O = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });

const today = () => new Date().toISOString().slice(0, 10);

const SHARED_RULES = `
Prices: real recent SOLD prices beat asking prices and beat "book value". Always say which grade a price is for.
Use pricecharting_search + pricecharting_card for recent eBay sold prices on every category. For Yu-Gi-Oh also use
yugioh_lookup, for One Piece also use onepiece_lookup (TCGplayer market). Use web_search for news, population reports,
very recent sales spikes, and anything the databases miss (130point, Card Ladder, PSA, eBay, TCGplayer, Reddit, YouTube).
Never invent a sale, a price or a URL. If you could not find data, use null and say so.
The user is a small trading card business (a parent and child buying, grading and reselling) — be concrete and practical.`;

// ------------------------------------------------------------------ card lookup

const CARD_REPORT = {
  name: "submit_card_report",
  description: "Submit the finished research report for the card. Call exactly once, when research is done.",
  strict: true,
  input_schema: O({
    card: O({
      name: S("Short display name, e.g. '2018 Panini Prizm Luka Doncic #280 Silver Prizm RC PSA 10'"),
      category: E(["baseball", "basketball", "football", "yugioh", "onepiece", "other"], "Card category"),
      player_or_character: S("Player or character"),
      year: SN("Year or season"),
      brand_set: SN("Manufacturer + set, e.g. 'Panini Prizm', 'Legend of Blue Eyes White Dragon', 'OP05 Awakening of the New Era'"),
      card_number: SN("Card number / set code, e.g. '#280', 'LOB-001', 'OP05-119'"),
      parallel_or_variant: SN("Parallel, refractor, rarity or variant, e.g. 'Silver Prizm', 'Ultra Rare 1st Edition', 'Alternate Art Manga'"),
      team: SN("Team, if a sports card"),
      rookie: B("Rookie card (RC)"),
      autograph: B("Has an autograph"),
      memorabilia: B("Has a patch/relic"),
      serial_number: SN("Serial numbering like '/99' or '23/99', if visible"),
      grading_company: SN("PSA, BGS, SGC, CGC, TAG... if slabbed, else null"),
      grade: SN("Grade on the slab if graded, else null"),
      condition_notes: S("What the photo shows about condition: centering, corners, edges, surface, print lines. 'No photo' if text lookup."),
      identification_confidence: E(["high", "medium", "low"], "How sure the identification is"),
      identification_notes: S("What was used to identify it and anything uncertain (e.g. 'could be the Silver or the base — check the back')"),
      search_query: S("Best search string to look this exact card up again"),
    }),
    pricing: O({
      estimated_value_usd: N("Best estimate of what THIS card (this grade/condition) sells for today"),
      value_range_low: N("Low end of realistic recent sales"),
      value_range_high: N("High end of realistic recent sales"),
      basis: S("How the estimate was made, e.g. 'avg of last 6 PSA 10 eBay sales, Sep 28–Oct 16'"),
      pricecharting_url: SN("PriceCharting page used, if any"),
      recent_sales: A(
        O({ date: S("YYYY-MM-DD"), price: N("USD"), grade: S("Raw / PSA 10 / ..."), title: S("Listing title"), source: S("eBay, PWCC, Goldin, TCGplayer...") }),
        "Most relevant recent completed sales (up to 12), newest first",
      ),
      grade_values: A(O({ grade: S("e.g. Ungraded, PSA 9, PSA 10, BGS 9.5"), value: N("USD") }), "Current value at each grade"),
      trend_summary: S("Price direction over 1, 3 and 12 months with numbers"),
    }),
    market: O({
      demand: E(["hot", "rising", "steady", "cooling", "cold"], "Current demand"),
      sales_volume: S("How liquid it is, e.g. '~1 sale per day graded'"),
      outlook: S("Short-term outlook and what could move the price (games, injuries, awards, set releases, banlist, reprints)"),
      recent_news: A(S("One news item"), "Recent news affecting value (can be empty)"),
    }),
    grading: O({
      recommendation: E(["grade_it", "maybe", "dont_grade", "already_graded"], "Should they send it to grade?"),
      reasoning: S("Math: raw value vs graded values minus ~$25-$75 grading cost, and the condition risk seen in the photo"),
    }),
    buy_sell: O({
      verdict: E(["buy", "hold", "sell", "pass"], "Overall call for a reseller"),
      max_buy_price: N("Most a reseller should pay to still profit after ~13% eBay fees"),
      list_price: N("Suggested listing price"),
      quick_sale_price: N("Price that sells fast"),
      reasoning: S("Why"),
    }),
    key_facts: A(S("Fact"), "Useful facts: print run, pop report, why it's desirable, look-alikes/fakes to watch for"),
    summary: S("2-4 sentence plain-English bottom line"),
  }),
};

const CARD_SYSTEM = `You are a trading card research analyst for a small card business. Today is ${today()}.
Job: identify the card in the photo(s) (or the text description), find what it actually sells for right now, and give
practical buy/sell/grading advice.

Identification: read everything visible — player/character, year, brand, set, card number, parallel/refractor color,
serial number, rookie logo, autograph, patch, slab label (company, grade, cert number). For Yu-Gi-Oh read the set code
(e.g. LOB-EN001), rarity foil and 1st Edition stamp; for One Piece read the card number (OP05-119), and whether it is
an alternate art / manga / SP / parallel. Parallels change value by 10-100x, so be careful and say if unsure.
For raw cards, judge condition from the photo (centering, corners, edges, surface).
${SHARED_RULES}
Finish by calling submit_card_report exactly once.`;

export async function cardLookup({ images = [], text = "" }, onEvent) {
  const content = [];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `Photo ${i + 1}${images.length > 1 ? (i === 0 ? " (front)" : " (back/other side)") : ""}:` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.data } });
  });
  content.push({
    type: "text",
    text: text?.trim()
      ? `Research this card. Extra info from the user: ${text.trim()}`
      : "Research this card.",
  });
  onEvent({ type: "step", text: images.length ? "Reading the card photo…" : "Starting research…" });
  return runJob({ system: CARD_SYSTEM, content, finishTool: CARD_REPORT, onEvent });
}

// ------------------------------------------------------------------ hottest cards

const HOT_LIST = {
  name: "submit_hot_list",
  description: "Submit the ranked hottest-cards list. Call exactly once.",
  strict: true,
  input_schema: O({
    market_summary: S("3-5 sentences on what is driving this market right now"),
    cards: A(
      O({
        rank: { type: "integer", description: "1 = hottest" },
        name: S("Specific card: year, set, player/character, number, parallel, grade if relevant"),
        category: E(["baseball", "basketball", "football", "yugioh", "onepiece"], "Category"),
        why_hot: S("The concrete reason: performance, news, release, tournament results, price spike, sales volume"),
        recent_price: S("Recent sold price with grade, e.g. '$1,250 PSA 10 (Oct 14)'; 'unknown' if not found"),
        price_change: S("Change over the period with numbers if known, e.g. '+38% in 7 days'; 'unknown' if not found"),
        signal: E(["price_spike", "volume_spike", "news", "new_release", "tournament_meta", "milestone", "long_term_riser"], "Main signal"),
        opportunity: S("What a reseller could do: buy raw and grade, sell now into the spike, wait for a dip, etc."),
        search_query: S("Search string to look this card up"),
        source_urls: A(S("URL"), "Where this came from (only URLs you actually saw)"),
      }),
      "8-15 cards, ranked",
    ),
    watch_out: A(S("Item"), "Cards/segments cooling off or risky right now"),
  }),
};

function hotSystem(category, period) {
  return `You are a trading card market analyst. Today is ${today()}.
Find the HOTTEST ${CATEGORIES[category]} over ${PERIODS[period]}: the cards with the biggest jumps in sold prices,
sales volume and collector attention in that window.

Search widely and recently: news (call-ups, breakout games, injuries, trades, awards, records, playoff runs, Hall of
Fame), new product releases and their chase cards, Yu-Gi-Oh tournament meta and banlist changes, One Piece set
releases and tournament results, plus market trackers (Card Ladder, Market Movers, 130point, PriceCharting, TCGplayer,
eBay trending, PSA, Reddit r/basketballcards r/baseballcards r/footballcards r/yugioh r/OnePieceTCG, YouTube hobby
channels). Prefer evidence dated inside the window. Check a few top candidates' actual recent sales with
pricecharting_search/pricecharting_card${category === "yugioh" ? "/yugioh_lookup" : category === "onepiece" ? "/onepiece_lookup" : ""}.
${category === "all" ? "Cover all five categories (at least 2 each)." : ""}
${SHARED_RULES}
Finish by calling submit_hot_list exactly once.`;
}

export async function hotCards({ category, period, trackedMovers = [] }, onEvent) {
  let text = `Find the hottest ${CATEGORIES[category]} — ${period} (${PERIODS[period]}).`;
  if (trackedMovers.length) {
    text += `\nFor context, cards on our own watchlist moved like this over the period: ${JSON.stringify(trackedMovers.slice(0, 15))}`;
  }
  onEvent({ type: "step", text: `Scanning the ${CATEGORIES[category]} market (${period})…` });
  return runJob({ system: hotSystem(category, period), content: [{ type: "text", text }], finishTool: HOT_LIST, onEvent });
}

// ------------------------------------------------------------------ free questions

const ANSWER = {
  name: "submit_answer",
  description: "Submit the final answer. Call exactly once.",
  strict: true,
  input_schema: O({
    answer_markdown: S("The answer in Markdown (headings, bullet points, tables where useful)"),
    follow_up_ideas: A(S("Question"), "2-4 useful follow-up questions"),
  }),
};

const ASK_SYSTEM = `You are a trading card research assistant for a small card business (sports cards, Yu-Gi-Oh, One Piece).
Today is ${today()}. Answer the question with current, sourced information — use the tools; don't rely on memory for
prices, releases or news.
${SHARED_RULES}
Finish by calling submit_answer exactly once.`;

export async function ask({ question, history = [] }, onEvent) {
  const ctx = history.length ? `Earlier in this conversation:\n${history.map((h) => `Q: ${h.q}\nA: ${h.a}`).join("\n\n").slice(-6000)}\n\n` : "";
  onEvent({ type: "step", text: "Researching…" });
  return runJob({ system: ASK_SYSTEM, content: [{ type: "text", text: ctx + question }], finishTool: ANSWER, onEvent });
}
