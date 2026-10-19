// The three things the bot does. Each is a short pipeline:
//   our code fetches real sold prices (free)  +  Gemini reads photos / searches Google / writes JSON.

import { Job } from "./ai.js";
import * as pricecharting from "./sources/pricecharting.js";
import * as ygoprodeck from "./sources/ygoprodeck.js";
import * as onepiece from "./sources/onepiece.js";
import * as psa from "./sources/psa.js";
import { idCacheGet, idCacheSet } from "./store.js";
import crypto from "node:crypto";

export const CATEGORIES = {
  all: "all five categories (baseball, basketball, football, Yu-Gi-Oh, One Piece)",
  baseball: "baseball cards",
  basketball: "basketball cards",
  football: "football cards",
  yugioh: "Yu-Gi-Oh! TCG cards",
  onepiece: "One Piece TCG cards",
  pokemon: "Pokémon TCG cards",
  hockey: "hockey cards",
  soccer: "soccer cards",
};
export const PERIODS = { daily: "the last 24-48 hours", weekly: "the last 7 days", monthly: "the last 30 days" };
const SPORTS = new Set(["baseball", "basketball", "football", "hockey", "soccer"]);
const TCG = new Set(["yugioh", "onepiece", "pokemon"]);
const CAT_ENUM = ["baseball", "basketball", "football", "hockey", "soccer", "yugioh", "onepiece", "pokemon", "other"];
export const kindOf = (category) => (SPORTS.has(category) ? "sports" : TCG.has(category) ? "tcg" : "any");

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
    category: E(CAT_ENUM, "Card category"),
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
    cert_number: SN("Certification number printed on the slab label (digits only), if readable; else null"),
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

export async function cardLookup({ images = [], text = "", fresh = false }, { onEvent, signal }) {
  const job = new Job({ kind: "lookup", onEvent, signal });

  // 1. Identify (vision -> JSON)
  job.step(images.length ? "Reading the card photo…" : "Working out which card you mean…");
  const parts = [];
  images.forEach((img, i) => {
    parts.push({ text: `Photo ${i + 1}${images.length > 1 ? (i === 0 ? " (front)" : " (back/other side)") : ""}:` });
    parts.push({ inlineData: { mimeType: img.mediaType, data: img.data } });
  });
  parts.push({ text: text?.trim() ? `Identify this card. Extra info from the user: ${text.trim()}` : "Identify this card." });
  // Same photo(s) + same note as before -> reuse the identification (saves free-tier quota).
  const cacheKey = images.length ? crypto.createHash("sha256").update(images.map((i) => i.data).join("|") + "|" + text.trim()).digest("hex") : null;
  let id = cacheKey && !fresh ? idCacheGet(cacheKey) : null;
  if (id) job.step("Seen this photo before — reusing the identification.");
  else {
    id = await job.generate({ system: ID_SYSTEM, parts, schema: O(CARD_ID) });
    if (cacheKey) idCacheSet(cacheKey, id);
  }
  const card = id.card;
  job.step(`Identified: ${card.name} (${card.identification_confidence} confidence)`);

  // 1b. Slab check: ask PSA what is really in that cert number.
  let slab = null;
  if (card.grading_company === "PSA" && card.cert_number && psa.hasToken()) {
    job.step(`Verifying PSA cert #${card.cert_number}…`);
    try {
      slab = await slabCheck(card);
    } catch (err) {
      job.step(`PSA check failed (${err.message})`);
    }
  }

  // 2. Sold prices (our scrapers, free)
  const kind = kindOf(card.category);
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
${slab ? `PSA CERT LOOKUP: ${JSON.stringify(slab)}` : ""}
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
    price_guide: pc?.priceGuide || null,
    sales_volume_raw: pc?.salesVolume || null,
    history: pc?.history || null,
    slab,
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
      category: E(CAT_ENUM.filter((c) => c !== "other"), "Category"),
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
        const [top] = await pricecharting.search(c.search_query, 3, kindOf(c.category));
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

// ================================================================== PSA slab check

const norm = (v) => String(v ?? "").toLowerCase().replace(/[^a-z0-9.]/g, "");

/** Compare what we read off the slab with what PSA has on file for that cert. */
export async function slabCheck(card) {
  const c = await psa.cert(card.cert_number);
  if (!c.found) return { verified: false, warning: "PSA has no record of this cert number — re-check the digits; if they're right, the slab may be fake.", cert: c };
  const mismatches = [];
  if (card.grade && norm(c.grade).replace(/[a-z]/g, "") && !norm(c.grade).includes(norm(card.grade))) mismatches.push(`grade: slab shows ${card.grade}, PSA says ${c.grade}`);
  if (card.year && c.year && !norm(c.year).includes(norm(card.year).slice(0, 4))) mismatches.push(`year: ${card.year} vs PSA ${c.year}`);
  if (card.card_number && c.cardNumber && norm(c.cardNumber) !== norm(card.card_number).replace(/^0+/, "") && norm(c.cardNumber) !== norm(card.card_number)) mismatches.push(`card #: ${card.card_number} vs PSA ${c.cardNumber}`);
  const subj = norm(card.player_or_character).slice(0, 6);
  if (subj && c.subject && !norm(c.subject).includes(subj)) mismatches.push(`subject: ${card.player_or_character} vs PSA ${c.subject}`);
  let pop = null, images = null;
  try {
    pop = await psa.population(c.specId);
  } catch {
    /* population is a bonus */
  }
  try {
    images = await psa.images(c.certNumber);
  } catch {
    /* photos are a bonus */
  }
  return {
    images,
    verified: mismatches.length === 0,
    warning: mismatches.length ? "What's on the slab doesn't match PSA's record — could be a misread photo, or a fake/re-labelled slab. Check the cert on psacard.com." : null,
    mismatches,
    cert: c,
    population: pop,
  };
}

// ================================================================== lot / binder page

const LOT_ID = O({
  cards: A(
    O({
      position: S("Where it is, e.g. 'top row, 2nd' or 'photo 2'"),
      name: S("Year + set + player/character + number + parallel"),
      category: E(CAT_ENUM, "Category"),
      grade: S("'Raw', or the slab grade like 'PSA 10' / 'BGS 9.5'"),
      price_search: S("Sold-price database search: name + year + set + number + parallel, no grade words"),
      condition_note: S("Very short condition note for raw cards ('looks clean', 'corner wear'); '' for slabs"),
      confidence: E(["high", "medium", "low"], "How sure the identification is"),
    }),
    "Every card you can see, up to 40",
  ),
  unreadable: { type: "integer", description: "How many cards were visible but couldn't be identified" },
  notes: S("Anything the buyer should know (damage, possible reprints, duplicates)"),
});

const PICK_MANY = O({
  matches: A(O({ card: { type: "integer", description: "Card index" }, match_index: { type: ["integer", "null"], description: "Matching candidate index or null" } }), "One entry per card"),
});

export async function lotLookup({ images = [], text = "" }, { onEvent, signal }) {
  const job = new Job({ kind: "lot", onEvent, signal });
  job.step("Reading every card in the photo…");
  const parts = [];
  images.forEach((img, i) => {
    parts.push({ text: `Photo ${i + 1}:` });
    parts.push({ inlineData: { mimeType: img.mediaType, data: img.data } });
  });
  parts.push({ text: `Identify every card in these photos (a lot, binder page, or pile).${text?.trim() ? " Extra info: " + text.trim() : ""}` });
  const lot = await job.generate({
    system: `You identify trading cards in photos of lots, binder pages and piles for a card buyer. Today is ${today()}. List every card you can see, left to right, top to bottom. Read numbers, parallels and slab labels carefully; mark confidence honestly.`,
    parts,
    schema: LOT_ID,
  });
  const cards = (lot.cards || []).slice(0, 40);
  job.step(`Found ${cards.length} cards — looking up sold prices…`);

  const candidates = await Promise.all(cards.map((c) => pricecharting.search(c.price_search, 5, kindOf(c.category)).catch(() => [])));
  let picks = [];
  if (candidates.some((l) => l.length)) {
    job.step("Matching each card to its exact price page…");
    const listing = cards
      .map((c, i) => `CARD ${i}: ${c.name} (${c.grade})\n${candidates[i].map((x, j) => `  ${j}: ${x.name} | ${x.set}`).join("\n") || "  (no candidates)"}`)
      .join("\n");
    picks = (await job.generate({
      system: "Match each trading card to the correct price-database entry. Parallels/variants must match exactly; base cards match base entries. Use null when nothing matches.",
      parts: [{ text: listing }],
      schema: PICK_MANY,
    })).matches || [];
  }

  const rows = await Promise.all(
    cards.map(async (c, i) => {
      const pick = picks.find((p) => p.card === i);
      const chosen = Number.isInteger(pick?.match_index) ? candidates[i][pick.match_index] : null;
      let value = null, url = null, matched = null, volume = null;
      if (chosen) {
        try {
          const d = await pricecharting.card(chosen.url);
          value = pricecharting.valueAtGrade(d, c.grade);
          url = d.url;
          matched = `${d.title} (${d.set})`;
          volume = Object.values(d.salesVolume || {})[0] || null;
        } catch {
          /* leave unpriced */
        }
      }
      return { ...c, value, url, matched, volume };
    }),
  );
  const priced = rows.filter((r) => r.value != null);
  return {
    cards: rows,
    unreadable: lot.unreadable || 0,
    notes: lot.notes,
    total: Math.round(priced.reduce((n, r) => n + r.value, 0) * 100) / 100,
    priced: priced.length,
    usage: job.finish(),
  };
}

// ================================================================== listing writer

const LISTING = O({
  title: S("Listing title, max 80 characters, keyword-rich: year, brand, set, player/character, number, parallel, RC, grade"),
  description: S("Plain-text description: what it is, condition (honest, from the report), shipping/handling promise. 4-8 short lines."),
  item_specifics: A(O({ name: S("e.g. Player/Athlete, Sport, Set, Card Number, Parallel/Variety, Graded, Grade, Professional Grader, Year Manufactured, Manufacturer, Features"), value: S("Value") }), "eBay item specifics"),
  price: N("Suggested Buy It Now price (USD)"),
  best_offer_auto_accept: N("Auto-accept offers at or above this"),
  best_offer_auto_decline: N("Auto-decline offers below this"),
  auction_start: N("If running an auction instead, a sensible starting bid"),
  photo_tips: A(S("Tip"), "2-4 tips for photos that sell this card"),
});

export async function writeListing({ report, platform = "eBay" }, { onEvent, signal }) {
  const job = new Job({ kind: "listing", onEvent, signal });
  job.step(`Writing a ${platform} listing…`);
  const listing = await job.generate({
    system: `You write ${platform} listings for trading cards that sell fast at strong prices. Be accurate: never claim a grade, parallel, serial number or condition the report doesn't support. No ALL-CAPS spam, no emojis. Today is ${today()}.`,
    parts: [{ text: `Card report:\n${JSON.stringify({ card: report.card, pricing: report.pricing, buy_sell: report.buy_sell, market: report.market, slab: report.slab ? { verified: report.slab.verified, pop: report.slab.cert?.population } : null })}` }],
    schema: LISTING,
  });
  if (listing.title && listing.title.length > 80) listing.title = listing.title.slice(0, 80).replace(/\s+\S*$/, "");
  return { ...listing, platform, usage: job.finish() };
}

// ================================================================== inventory advisor

const ADVICE = O({
  summary: S("3-5 sentences: the state of this inventory right now and the single most important move"),
  actions: A(
    O({
      card: S("Which card (name + grade), exactly as in the inventory"),
      action: E(["sell_now", "list_it", "drop_price", "hold", "grade_it", "buy_more", "watch"], "What to do"),
      target_price: N("Suggested sale/list price in USD, or null"),
      urgency: E(["now", "this_week", "this_month"], "How soon"),
      reasoning: S("Why, with numbers (paid vs value, trend, news, liquidity)"),
    }),
    "5-15 actions, most valuable first",
  ),
  market_notes: A(S("Note"), "What in the wider market matters for this inventory (2-6 items)"),
  risks: A(S("Risk"), "What could go wrong (1-4 items)"),
});

export async function adviseInventory({ inventory, movers, hot, recentSales }, { onEvent, signal }) {
  const job = new Job({ kind: "advisor", onEvent, signal });
  const top = inventory.slice(0, 30);
  job.step(`Checking the market for your ${top.length} most valuable cards…`);
  const notes = await job.generate({
    system: `You are a trading card market analyst advising a small card business on its own inventory. Today is ${today()}. Use Google Search. ${NO_INVENTING}`,
    parts: [{
      text: `INVENTORY (top ${top.length} by value): ${JSON.stringify(top)}
WATCHLIST MOVERS (7/30 days): ${JSON.stringify(movers)}
${hot ? `LATEST HOT-CARDS SCAN (${hot.period}): ${JSON.stringify((hot.cards || []).slice(0, 10).map((c) => ({ name: c.name, why: c.why_hot, change: c.price_change })))}` : ""}
RECENT SALES: ${JSON.stringify(recentSales)}

For the biggest positions and anything that moved, search for current news and sales direction (last 30 days):
player performance/injuries/trades/awards, set releases and reprints, tournament meta and banlists, hobby sentiment.
Write compact dated notes per card group, plus general market conditions affecting these categories.`,
    }],
    search: true,
  });
  job.step("Writing the plan…");
  const plan = await job.generate({
    system: `Turn inventory data + market notes into a concrete action plan for a reseller. ${AUDIENCE} ${NO_INVENTING}
Rules of thumb: sell into spikes; drop price on listings older than 3-4 weeks; grade raw cards only when the graded value clearly beats raw + fees; hold evergreen cards that dipped; never advise selling below cost without saying so.`,
    parts: [{ text: `INVENTORY: ${JSON.stringify(top)}\nMOVERS: ${JSON.stringify(movers)}\nNOTES:\n${notes}` }],
    schema: ADVICE,
  });
  return { ...plan, sources: [...job.sources.values()].slice(0, 20), usage: job.finish() };
}
