// The three things the bot does. Each is a short pipeline:
//   our code fetches real sold prices (free)  +  Gemini reads photos / searches Google / writes JSON.

import { Job } from "./ai.js";
import * as pricecharting from "./sources/pricecharting.js";
import * as ygoprodeck from "./sources/ygoprodeck.js";
import * as onepiece from "./sources/onepiece.js";

export const CATEGORIES = {
  all: "all five categories (baseball, basketball, football, Yu-Gi-Oh, One Piece)",
  baseball: "baseball cards",
  basketball: "basketball cards",
  football: "football cards",
  yugioh: "Yu-Gi-Oh! TCG cards",
  onepiece: "One Piece TCG cards",
};
export const PERIODS = { daily: "the last 24-48 hours", weekly: "the last 7 days", monthly: "the last 30 days" };
const SPORTS = new Set(["baseball", "basketball", "football"]);

// ---- JSON-schema helpers ----
const S = (d) => ({ type: "string", description: d });
const SN = (d) => ({ type: ["string", "null"], description: d });
const N = (d) => ({ type: ["number", "null"], description: d });
const B = (d) => ({ type: "boolean", description: d });
const E = (values, d) => ({ type: "string", enum: values, description: d });
const A = (items, d) => ({ type: "array", items, description: d });
const O = (props) => ({ type: "object", properties: props, required: Object.keys(props) });

const today = () => new Date().toISOString().slice(0, 10);
const AUDIENCE = "The user is a small trading card business (a parent and child buying, grading and reselling). Be concrete and practical.";
const NO_INVENTING = "Never invent a sale, a price, a population count or a URL. If something isn't in the data or your search results, say it's unknown.";

// Trim a price-page record to what the AI needs (keeps prompts small and cheap).
function priceSummary(pc) {
  if (!pc) return null;
  const sales = {};
  for (const [g, rows] of Object.entries(pc.recentSales || {})) sales[g] = rows.slice(0, 6).map((r) => `${r.date} $${r.price} ${r.title}`);
  return { source: pc.source, url: pc.url, title: pc.title, set: pc.set, value_by_grade: pc.priceGuide, sales_volume: pc.salesVolume, trend_pct: pc.trendPct, recent_sales: sales };
}

// ================================================================== card lookup

const CARD_ID = {
  card: O({
    name: S("Short display name, e.g. '2018 Panini Prizm Luka Doncic #280 Silver Prizm RC PSA 10'"),
    category: E(["baseball", "basketball", "football", "yugioh", "onepiece", "other"], "Card category"),
    player_or_character: S("Player or character"),
    year: SN("Year or season"),
    brand_set: SN("Manufacturer + set, e.g. 'Panini Prizm', 'Legend of Blue Eyes White Dragon', 'OP05 Awakening of the New Era'"),
    card_number: SN("Card number / set code, e.g. '280', 'LOB-001', 'OP05-119'"),
    parallel_or_variant: SN("Parallel, refractor, rarity or variant: 'Silver Prizm', 'Ultra Rare 1st Edition', 'Alternate Art Manga'; null if base"),
    team: SN("Team, if a sports card"),
    rookie: B("Rookie card (RC)"),
    autograph: B("Has an autograph"),
    memorabilia: B("Has a patch/relic"),
    serial_number: SN("Serial numbering like '/99' or '23/99', if visible"),
    grading_company: SN("PSA, BGS, SGC, CGC, TAG... if slabbed, else null"),
    grade: SN("Grade on the slab if graded (e.g. '10', '9.5'), else null"),
    condition_notes: S("What the photo shows about condition: centering, corners, edges, surface, print lines. 'No photo' if text only."),
    identification_confidence: E(["high", "medium", "low"], "How sure the identification is"),
    identification_notes: S("What was used to identify it and anything uncertain (e.g. 'could be the Silver or the base — check the back')"),
    search_query: S("Best search string to look this exact card up again"),
  }),
  price_searches: A(S("Search string"), "1-3 searches for a sold-price database, most specific first, e.g. 'luka doncic 2018 prizm 280 silver', 'luka doncic 2018 prizm 280'. Use name + set/year + number + parallel words; no grade words."),
  grade_odds: O({
    psa10_pct: N("For a RAW card: estimated % chance of PSA 10 from the visible condition; null if graded or no photo"),
    psa9_pct: N("Estimated % chance of PSA 9"),
    psa8_or_lower_pct: N("Estimated % chance of PSA 8 or lower"),
  }),
};

const ID_SYSTEM = `You identify trading cards from photos for a card business. Today is ${today()}.
Read everything visible: player/character, year, brand, set, card number, parallel/refractor colour, serial number,
rookie logo, autograph, patch, and slab label (company, grade, cert number). For Yu-Gi-Oh read the set code
(e.g. LOB-EN001), rarity foil and the 1st Edition stamp; for One Piece read the card number (OP05-119) and whether it's
an alternate art / manga / SP / parallel. Parallels change value 10-100x — be careful and say when unsure.
For raw cards, judge condition (centering, corners, edges, surface) and estimate realistic PSA grade odds
(most raw cards are NOT 10s; be conservative). If only text is given, identify the most likely card from it.`;

const CARD_REPORT = O({
  pricing: O({
    estimated_value_usd: N("Best estimate of what THIS card (this grade/condition) sells for today"),
    value_range_low: N("Low end of realistic recent sales"),
    value_range_high: N("High end of realistic recent sales"),
    basis: S("How the estimate was made, e.g. 'avg of last 6 PSA 10 eBay sales, Sep 28–Oct 16'"),
    recent_sales: A(
      O({ date: S("YYYY-MM-DD"), price: N("USD"), grade: S("Raw / PSA 10 / ..."), title: S("Listing title"), source: S("eBay, Goldin, TCGplayer...") }),
      "Most relevant recent completed sales (up to 12), newest first — only from the data given",
    ),
    grade_values: A(O({ grade: S("e.g. Ungraded, PSA 9, PSA 10, BGS 9.5"), value: N("USD") }), "Current value at each grade"),
    trend_summary: S("Price direction over 1, 3 and 12 months with numbers"),
  }),
  market: O({
    demand: E(["hot", "rising", "steady", "cooling", "cold"], "Current demand"),
    sales_volume: S("How liquid it is, e.g. '~1 sale per day graded'"),
    outlook: S("Short-term outlook and what could move the price (games, injuries, awards, set releases, banlist, reprints)"),
    recent_news: A(S("One dated news item"), "Recent news affecting value (can be empty)"),
  }),
  grading: O({
    recommendation: E(["grade_it", "maybe", "dont_grade", "already_graded"], "Should they send it to grade?"),
    reasoning: S("Math: raw value vs graded values × grade odds, minus ~$25-$75 grading + shipping, and the condition risk"),
  }),
  buy_sell: O({
    verdict: E(["buy", "hold", "sell", "pass"], "Overall call for a reseller"),
    max_buy_price: N("Most a reseller should pay to still profit after ~13% eBay fees"),
    list_price: N("Suggested listing price"),
    quick_sale_price: N("Price that sells fast"),
    reasoning: S("Why"),
  }),
  key_facts: A(S("Fact"), "Useful facts: print run, population, why it's desirable, look-alikes/fakes to watch for"),
  summary: S("2-4 sentence plain-English bottom line"),
});

const PICK = O({
  match_index: { type: ["integer", "null"], description: "Index of the candidate that is exactly this card (same parallel/variant), or null if none match" },
  reason: S("Why"),
});

export async function cardLookup({ images = [], text = "" }, { onEvent, signal }) {
  const job = new Job({ kind: "lookup", onEvent, signal });

  // 1. Identify (vision -> JSON)
  job.step(images.length ? "Reading the card photo…" : "Working out which card you mean…");
  const parts = [];
  images.forEach((img, i) => {
    parts.push({ text: `Photo ${i + 1}${images.length > 1 ? (i === 0 ? " (front)" : " (back/other side)") : ""}:` });
    parts.push({ inlineData: { mimeType: img.mediaType, data: img.data } });
  });
  parts.push({ text: text?.trim() ? `Identify this card. Extra info from the user: ${text.trim()}` : "Identify this card." });
  const id = await job.generate({ system: ID_SYSTEM, parts, schema: O(CARD_ID) });
  const card = id.card;
  job.step(`Identified: ${card.name} (${card.identification_confidence} confidence)`);

  // 2. Sold prices (our scrapers, free)
  const kind = SPORTS.has(card.category) ? "sports" : ["yugioh", "onepiece"].includes(card.category) ? "tcg" : "any";
  let candidates = [];
  for (const q of (id.price_searches || []).slice(0, 3)) {
    job.step(`Searching sold prices: "${q}"`);
    try {
      candidates = await pricecharting.search(q, 12, kind);
    } catch (err) {
      job.step(`Price search failed (${err.message})`);
    }
    if (candidates.length) break;
  }
  const extras = {};
  try {
    if (card.category === "yugioh") {
      job.step("Checking the Yu-Gi-Oh database…");
      extras.yugioh = (await ygoprodeck.lookup(card.player_or_character, 2)).map((c) => ({ ...c, printings: c.printings.filter((p) => !card.card_number || p.code === card.card_number || p.code.split("-")[0] === String(card.card_number).split("-")[0]).slice(0, 8) }));
    }
    if (card.category === "onepiece") {
      job.step("Checking One Piece TCGplayer prices…");
      extras.onepiece = await onepiece.lookup(`${card.player_or_character} ${card.card_number || ""}`, 10);
    }
  } catch (err) {
    job.step(`Card database lookup failed (${err.message})`);
  }

  // 3. Pick the exact matching price page
  let pc = null;
  if (candidates.length) {
    const pick = await job.generate({
      system: "You match a trading card to the correct entry in a price database. Parallels/variants/editions are separate entries and must match exactly; if the card is base, pick the base entry.",
      parts: [{ text: `Card: ${JSON.stringify(card)}\n\nCandidates:\n${candidates.map((c, i) => `${i}: ${c.name} | ${c.set}`).join("\n")}` }],
      schema: PICK,
    });
    const chosen = Number.isInteger(pick.match_index) ? candidates[pick.match_index] : null;
    if (chosen) {
      job.step(`Reading recent sales: ${chosen.name} (${chosen.set})`);
      try {
        pc = await pricecharting.card(chosen.url, { withHistory: true });
      } catch (err) {
        job.step(`Couldn't read the sales page (${err.message})`);
      }
    } else job.step("No exact match in the sold-price database — leaning on web research.");
  }

  // 4. Live research (Google Search grounding)
  job.step("Researching news and the market on Google…");
  const notes = await job.generate({
    system: `You are a trading card market researcher. Today is ${today()}. Use Google Search. ${NO_INVENTING}`,
    parts: [{
      text: `Card: ${card.name}${card.grading_company ? ` (${card.grading_company} ${card.grade})` : " (raw)"}.
Price database snapshot: ${pc ? JSON.stringify({ value_by_grade: pc.priceGuide, trend_pct: pc.trendPct }) : "not found"}.

Find, with dates: (1) news in the last 60 days that affects this card's value (performance, injuries, trades, awards,
milestones, set releases, banlist/tournament results, reprints); (2) notable recent sales or auction results
(eBay, Goldin, PWCC/Fanatics Collect, Heritage, TCGplayer) especially any spikes; (3) PSA/BGS/CGC population if
findable; (4) known fakes/reprints or look-alike parallels; (5) whether collector demand is rising or falling.
${pc ? "" : "Also find recent sold prices by grade, since the price database had no match."}
Write compact notes with dates and numbers.`,
    }],
    search: true,
  });

  // 5. Final structured report
  job.step("Writing the report…");
  const report = await job.generate({
    system: `You are a trading card analyst writing a buy/sell/grade report. Today is ${today()}. ${AUDIENCE} ${NO_INVENTING}
Base prices on the SOLD data provided (real eBay completed sales) over asking prices; always say which grade a price is for.
For grading math use the grade odds given. eBay fees ≈ 13.25% + $0.40; grading ≈ $25-$75 + shipping.`,
    parts: [{
      text: `CARD: ${JSON.stringify(card)}
GRADE ODDS FROM PHOTO: ${JSON.stringify(id.grade_odds)}
SOLD-PRICE DATA: ${JSON.stringify(priceSummary(pc))}
${extras.yugioh ? `YU-GI-OH DATABASE: ${JSON.stringify(extras.yugioh)}` : ""}
${extras.onepiece ? `ONE PIECE TCGPLAYER PRICES: ${JSON.stringify(extras.onepiece)}` : ""}
WEB RESEARCH NOTES:
${notes}`,
    }],
    schema: CARD_REPORT,
  });

  const sources = [...(pc ? [{ title: pc.source + ": " + pc.title, url: pc.url }] : []), ...job.sources.values()].slice(0, 25);
  return {
    card,
    grade_odds: id.grade_odds,
    ...report,
    pricing: { ...report.pricing, pricecharting_url: pc?.url || null },
    history: pc?.history || null,
    sources,
    usage: job.finish(),
  };
}

// ================================================================== hottest cards

const HOT_LIST = O({
  market_summary: S("3-5 sentences on what is driving this market right now"),
  cards: A(
    O({
      rank: { type: "integer", description: "1 = hottest" },
      name: S("Specific card: year, set, player/character, number, parallel, grade if relevant"),
      category: E(["baseball", "basketball", "football", "yugioh", "onepiece"], "Category"),
      why_hot: S("The concrete reason: performance, news, release, tournament results, price spike, sales volume"),
      recent_price: S("Recent sold price with grade, e.g. '$1,250 PSA 10 (Oct 14)'; 'unknown' if not in the notes"),
      price_change: S("Change over the period with numbers if known, e.g. '+38% in 7 days'; 'unknown' if not in the notes"),
      signal: E(["price_spike", "volume_spike", "news", "new_release", "tournament_meta", "milestone", "long_term_riser"], "Main signal"),
      opportunity: S("What a reseller could do: buy raw and grade, sell into the spike, wait for a dip, etc."),
      search_query: S("Sold-price database search: name + year + set + number + parallel, no grade words"),
    }),
    "8-15 cards, ranked",
  ),
  watch_out: A(S("Item"), "Cards/segments cooling off or risky right now"),
});

export async function hotCards({ category, period, trackedMovers = [] }, { onEvent, signal }) {
  const job = new Job({ kind: "hot", onEvent, signal });
  job.step(`Searching Google for the hottest ${CATEGORIES[category]} (${period})…`);

  const notes = await job.generate({
    system: `You are a trading card market analyst. Today is ${today()}. Use Google Search. ${NO_INVENTING}`,
    parts: [{
      text: `Find the HOTTEST ${CATEGORIES[category]} over ${PERIODS[period]}: the specific cards with the biggest jumps in
sold prices, sales volume and collector attention in that window. Search widely and recently: news (call-ups, breakout
games, injuries, trades, awards, records, playoff runs), new product releases and their chase cards, Yu-Gi-Oh tournament
meta and banlist changes, One Piece set releases and tournament results, and market trackers/communities (Card Ladder,
Market Movers, 130point, PriceCharting, SportsCardsPro, TCGplayer, eBay, PSA, Reddit card subs, YouTube hobby channels).
Prefer evidence dated inside the window. ${category === "all" ? "Cover all five categories, at least 2 cards each." : ""}
List 12-15 specific cards (year, set, number, parallel) with the reason, any sold prices you found with dates, and the
size of the move. Also note anything cooling off.
${trackedMovers.length ? `Our own watchlist moved like this over the period: ${JSON.stringify(trackedMovers.slice(0, 15))}` : ""}`,
    }],
    search: true,
  });

  job.step("Ranking the list…");
  const hot = await job.generate({
    system: `Turn market research notes into a ranked hot-cards list. ${AUDIENCE} ${NO_INVENTING}`,
    parts: [{ text: `Period: ${period} (${PERIODS[period]}). Category: ${CATEGORIES[category]}.\n\nNOTES:\n${notes}` }],
    schema: HOT_LIST,
  });

  // Free sold-price check on each card so the list isn't only hype.
  job.step("Checking real sold prices for each card…");
  await Promise.all(
    (hot.cards || []).slice(0, 15).map(async (c) => {
      try {
        const kind = SPORTS.has(c.category) ? "sports" : "tcg";
        const [top] = await pricecharting.search(c.search_query, 3, kind);
        if (!top) return;
        const d = await pricecharting.card(top.url);
        const lastSales = Object.entries(d.recentSales).map(([g, rows]) => ({ grade: g, ...rows[0] }));
        c.price_check = {
          matched: `${d.title} (${d.set})`,
          url: d.url,
          ungraded: d.priceGuide.Ungraded ?? null,
          psa10: d.priceGuide["PSA 10"] ?? null,
          trend_1mo: d.trendPct.Ungraded?.["1mo"] ?? d.trendPct["PSA 10"]?.["1mo"] ?? null,
          last_sale: lastSales.sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null,
        };
      } catch {
        /* price check is best-effort */
      }
    }),
  );

  return { ...hot, sources: [...job.sources.values()].slice(0, 30), usage: job.finish() };
}

// ================================================================== free questions

export async function ask({ question, history = [], cardContext = null }, { onEvent, signal }) {
  const job = new Job({ kind: "ask", onEvent, signal });
  job.step("Searching Google…");
  const ctx = [
    cardContext ? `The user is asking about this card report: ${JSON.stringify(cardContext).slice(0, 6000)}` : "",
    history.length ? `Earlier in this conversation:\n${history.map((h) => `Q: ${h.q}\nA: ${h.a}`).join("\n\n").slice(-6000)}` : "",
  ].filter(Boolean).join("\n\n");

  const raw = await job.generate({
    system: `You are a trading card research assistant for a small card business (sports cards, Yu-Gi-Oh, One Piece). Today is ${today()}.
Answer with current information from Google Search — don't rely on memory for prices, releases or news. ${NO_INVENTING}
Format the answer in Markdown (short headings, bullets, tables where useful). End with one line exactly like:
FOLLOWUPS: question one | question two | question three`,
    parts: [{ text: (ctx ? ctx + "\n\n" : "") + "Question: " + question }],
    search: true,
  });

  const m = raw.match(/\n?FOLLOWUPS:\s*(.+)\s*$/i);
  return {
    answer_markdown: (m ? raw.slice(0, m.index) : raw).trim(),
    follow_up_ideas: m ? m[1].split("|").map((s) => s.trim()).filter(Boolean).slice(0, 4) : [],
    sources: [...job.sources.values()].slice(0, 20),
    usage: job.finish(),
  };
}
