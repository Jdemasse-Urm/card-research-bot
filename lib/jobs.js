// The three things the bot does. Each is a short pipeline:
//   our code fetches real sold prices (free)  +  Gemini reads photos / searches Google / writes JSON.

import { Job } from "./ai.js";
import * as pricecharting from "./sources/pricecharting.js";
import * as ygoprodeck from "./sources/ygoprodeck.js";
import * as onepiece from "./sources/onepiece.js";
import * as psa from "./sources/psa.js";
import { idCacheGet, idCacheSet, EXPENSE_KINDS } from "./store.js";
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

const today = () => new Date().toLocaleDateString("en-CA");
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

  // 4 (started early). Google research is the slowest step and doesn't depend on the sold-price lookup,
  // so it runs while our scrapers work; the final report combines both.
  job.step("Researching news and the market on Google…");
  const research = job.generate({
    system: `You are a trading card market researcher. Today is ${today()}. Use Google Search. ${NO_INVENTING}`,
    parts: [{
      text: `Card: ${card.name}${card.grading_company ? ` (${card.grading_company} ${card.grade})` : " (raw)"}.

Find, with dates: (1) news in the last 60 days that affects this card's value (performance, injuries, trades, awards,
milestones, set releases, banlist/tournament results, reprints); (2) notable recent sales or auction results
(eBay, Goldin, PWCC/Fanatics Collect, Heritage, TCGplayer) especially any spikes; (3) PSA/BGS/CGC population if
findable; (4) known fakes/reprints or look-alike parallels; (5) whether collector demand is rising or falling;
(6) recent sold prices by grade, in case the price database has no entry for this exact card.
Write compact notes with dates and numbers.`,
    }],
    search: true,
  });
  research.catch(() => {}); // awaited below — this only keeps a failure during the scrapes from being "unhandled"
  // The set's checklist (runs alongside): is that number really this player, does that parallel exist?
  const checklist = checkChecklist([{ category: card.category, details: { year: card.year, set: card.brand_set, player: card.player_or_character, number: card.card_number, parallel: card.parallel_or_variant } }]).then((l) => l[0]).catch(() => null);

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
    // Same photo + same candidate pages as last time → the same match (one call fewer on repeat lookups).
    const pickKey = cacheKey ? `${cacheKey}:pick:${crypto.createHash("sha256").update(candidates.map((c) => c.url).join("|")).digest("hex").slice(0, 16)}` : null;
    let pick = pickKey && !fresh ? idCacheGet(pickKey) : null;
    if (pick) job.step("Same price pages as last time — reusing the match.");
    else {
      pick = await job.generate({
        system: "You match a trading card to the correct entry in a price database. Parallels/variants/editions are separate entries and must match exactly; if the card is base, pick the base entry.",
        parts: [{ text: `Card: ${JSON.stringify(card)}\n\nCandidates:\n${candidates.map((c, i) => `${i}: ${c.name} | ${c.set}`).join("\n")}` }],
        schema: PICK,
        effort: "low",
      });
      if (pickKey) idCacheSet(pickKey, pick);
    }
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

  // 4. The Google research started in step 4-early.
  const notes = await research;
  const listed = await checklist;

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
${listed?.note ? `SET CHECKLIST WARNING (from the price site's checklist — mention it in the summary): ${listed.note}` : ""}
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
    checklist: listed ? { set: listed.set, number: listed.number, note: listed.note, parallels: listed.parallels.slice(0, 30) } : null,
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
      photo: { type: "integer", description: "Which photo the card is in (1 = the first photo)" },
      box: { type: "array", items: { type: "integer" }, description: "Where the whole card (the whole slab, for graded cards) is in that photo: [ymin, xmin, ymax, xmax], each 0-1000" },
      cert: S("The certification number printed on a slab label (digits only); '' for raw cards or when it can't be read"),
    }),
    "Every card you can see, up to 40",
  ),
  unreadable: { type: "integer", description: "How many cards were visible but couldn't be identified" },
  notes: S("Anything the buyer should know (damage, possible reprints, duplicates)"),
});

// [ymin, xmin, ymax, xmax] in 0-1000, ordered and in range — or null when the model gave no usable box.
function cleanBox(b) {
  if (!Array.isArray(b) || b.length !== 4 || !b.every((v) => Number.isFinite(+v))) return null;
  const [y0, x0, y1, x1] = b.map((v) => Math.min(1000, Math.max(0, Math.round(+v))));
  const box = [Math.min(y0, y1), Math.min(x0, x1), Math.max(y0, y1), Math.max(x0, x1)];
  return box[2] - box[0] >= 20 && box[3] - box[1] >= 20 ? box : null;
}

const PICK_MANY = O({
  matches: A(O({ card: { type: "integer", description: "Card index" }, match_index: { type: ["integer", "null"], description: "Matching candidate index or null" } }), "One entry per card"),
});

export async function lotLookup({ images = [], text = "" }, { onEvent, signal }) {
  const job = new Job({ kind: "lot", onEvent, signal });
  job.step(images.length > 1 ? `Reading every card in ${images.length} photos…` : "Reading every card in the photo…");
  const parts = [];
  images.forEach((img, i) => {
    parts.push({ text: `Photo ${i + 1}:` });
    parts.push({ inlineData: { mimeType: img.mediaType, data: img.data } });
  });
  parts.push({ text: `Identify every card in these photos (a lot, binder page, pile, or scans of single cards).${text?.trim() ? " Extra info: " + text.trim() : ""}` });
  const lot = await job.generate({
    system: `You identify trading cards in photos of lots, binder pages, piles and scanner output for a card dealer. Today is ${today()}. A photo may hold one card or many. List every card you can see, photo by photo, left to right, top to bottom, with the photo it is in and a tight box around the whole card (the whole slab for graded cards) so it can be cut out as its own picture. Read numbers, parallels and slab labels (including the cert number) carefully; mark confidence honestly.`,
    parts,
    schema: LOT_ID,
  });
  const cards = (lot.cards || []).slice(0, 40).map((c) => ({ ...c, photo: Math.min(Math.max(1, c.photo || 1), images.length || 1), box: cleanBox(c.box), cert: String(c.cert || "").replace(/\D/g, "") }));
  job.step(`Found ${cards.length} cards — looking up sold prices…`);
  await checkCerts(cards, job);
  const rows = await priceCards(cards, job);
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

const titleCase = (s) => String(s || "").toLowerCase().replace(/\b([a-z])([a-z']*)/g, (_, a, b) => a.toUpperCase() + b).replace(/\b(Rc|Psa|Bgs|Sgc|Cgc|Dna|Ssp|Sp)\b/g, (w) => w.toUpperCase());

/**
 * PSA slabs with a readable cert: PSA's own record is the exact card and grade (free, with the PSA token).
 * A grade read off the label that disagrees with PSA's record is flagged, and PSA's is used.
 */
async function checkCerts(cards, job) {
  if (!psa.hasToken()) return;
  const slabs = cards.filter((c) => c.cert?.length >= 6 && /^PSA\b/i.test(c.grade));
  if (!slabs.length) return;
  job.step(`Checking ${slabs.length} PSA cert number${slabs.length === 1 ? "" : "s"} with PSA…`);
  await Promise.all(slabs.map(async (c) => {
    try {
      const r = await psa.cert(c.cert);
      if (!r.found) return void (c.certNote = "PSA has no record of this cert number — check the slab (a misread digit, or not a real PSA slab)");
      const num = String(r.grade || "").match(/(\d+(\.\d)?)\s*$/)?.[1];
      const psaGrade = num ? `PSA ${num}` : c.grade;
      const name = titleCase([r.year, r.brand, r.subject, r.cardNumber ? "#" + r.cardNumber : "", r.variety].filter(Boolean).join(" "));
      c.certNote = psaGrade !== c.grade ? `The label was read as ${c.grade}; PSA's record says ${psaGrade} — using PSA's` : "✓ Card and grade match PSA's record";
      Object.assign(c, { name: name || c.name, grade: psaGrade, price_search: [r.year, r.brand, r.subject, r.cardNumber, r.variety].filter(Boolean).join(" ") || c.price_search, confidence: "high", certUrl: r.url, certVerified: true });
    } catch {
      /* PSA down or out of calls: keep what was read off the label */
    }
  }));
}

/** Each card → its exact sold-price page (parallels must match) → value at its grade. */
async function priceCards(cards, job) {
  const candidates = await Promise.all(cards.map((c) => (c.price_search ? pricecharting.search(c.price_search, 5, kindOf(c.category)).catch(() => []) : [])));
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
      effort: "low",
    })).matches || [];
  }
  return Promise.all(
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
}

// ================================================================== bulk scan: find the cards, then read each one up close
// One picture of a page squeezes every card into a fraction of the image the model sees, which is where card
// numbers, serial stamps and parallels get lost. So a scan is two steps: a quick pass that only finds the
// cards, then each card cut out at full resolution (with its back, when scanned) and read on its own.

const LOCATE = O({
  cards: A(O({
    photo: { type: "integer", description: "Which photo it is in (1 = the first)" },
    box: { type: "array", items: { type: "integer" }, description: "[ymin, xmin, ymax, xmax] around the whole card — the whole slab or holder if it's in one — each 0-1000" },
  }), "Every trading card in the photos"),
});

/** Reading order for a page: rows top to bottom, left to right within a row. */
export function readingOrder(boxes) {
  const cy = (b) => (b[0] + b[2]) / 2, cx = (b) => (b[1] + b[3]) / 2;
  const sorted = [...boxes].sort((a, b) => cy(a) - cy(b));
  const rows = [];
  for (const b of sorted) {
    const row = rows.find((r) => Math.abs(cy(r[0]) - cy(b)) < (r[0][2] - r[0][0]) / 2);
    row ? row.push(b) : rows.push([b]);
  }
  return rows.flatMap((r) => r.sort((a, b) => cx(a) - cx(b)));
}

export async function locateCards({ images = [] }, { onEvent, signal }) {
  const job = new Job({ kind: "scan-find", onEvent, signal });
  job.step(`Finding the cards in ${images.length} picture${images.length === 1 ? "" : "s"}…`);
  const parts = [];
  images.forEach((img, i) => {
    parts.push({ text: `Photo ${i + 1}:` });
    parts.push({ inlineData: { mimeType: img.mediaType, data: img.data } });
  });
  parts.push({ text: "Find every trading card in these photos." });
  const r = await job.generate({
    system: "You find trading cards in scans and photos so each one can be cut out as its own picture. Give a tight box around each whole card (around the whole slab, toploader or one-touch when the card is in one). Skip cards cut off by the edge of the photo. Fronts and backs both count as cards.",
    parts,
    schema: LOCATE,
    effort: "low",
  });
  const photos = images.map((_, i) => ({ photo: i + 1, boxes: [] }));
  for (const c of r.cards || []) {
    const box = cleanBox(c.box);
    const ph = photos[(c.photo || 1) - 1];
    if (box && ph && ph.boxes.length < 40) ph.boxes.push(box);
  }
  for (const ph of photos) ph.boxes = readingOrder(ph.boxes);
  return { photos, usage: job.finish() };
}

// the same identity fields as a single-card lookup (one definition of what a card is), plus scan-only fields
const SCAN_CARD = O({
  card: { type: "integer", description: "Which card: the N in 'Card N'" },
  ...CARD_ID.card.properties,
  price_search: S("Sold-price database search: year + set + player/character + card number + parallel words; no grade words"),
  parallel_check: SN("When the parallel/variant can't be confirmed from these pictures (chrome base vs refractor, foil vs non-foil, the colour of a border, 1st Edition stamp), what exactly to check by eye; null when sure"),
});
const SCAN_RULES = `
Each card has its own close-up, and its back when there is one (backs show the card number, year, set and often the
parallel or "Refractor"). Read the slab label exactly: company, the grade number and its words (e.g. NM-MT 8 = 8), the
cert number; a raw card has no grade (null) — never guess one. Name a parallel only when the pictures show it (rainbow
sheen, coloured border, the word on the back, a stamped serial); otherwise call it base and fill parallel_check.
Read stamped serial numbers digit by digit ('23/99'). One entry per card, numbered as given — never merge or skip one.`;

const GRADE_WORDS = /\b(PSA|BGS|SGC|CGC|TAG|HGA|BECKETT)\s*(DNA\s*)?\d+(\.\d)?\b/gi;
const blank = (v) => v == null || /^(null|none|n\/a|base|-)?$/i.test(String(v).trim());

/** One model answer → the card as the app keeps it: display name, "PSA 8"-style grade, tags, details. */
export function normalizeRead(c, k) {
  if (!c) return { photo: k, name: "Couldn't read this card — check it", category: "other", grade: "Raw", confidence: "low", condition_note: "", price_search: "", cert: "", tags: [], details: {} };
  const company = blank(c.grading_company) || /^raw$/i.test(c.grading_company) ? "" : String(c.grading_company).trim().toUpperCase();
  const num = String(c.grade ?? "").match(/\d+(\.\d)?/)?.[0];
  const grade = company ? `${company}${num ? " " + num : ""}` : "Raw";
  const year = blank(c.year) ? "" : String(c.year).trim();
  const set = blank(c.brand_set) ? "" : String(c.brand_set).trim();
  const number = blank(c.card_number) ? "" : String(c.card_number).trim().replace(/^#/, "");
  const parallel = blank(c.parallel_or_variant) ? "" : String(c.parallel_or_variant).trim();
  const serial = blank(c.serial_number) ? "" : String(c.serial_number).trim().replace(/^#/, "");
  const name = [set.startsWith(year) ? "" : year, set, blank(c.player_or_character) ? "" : c.player_or_character, number ? "#" + number : "", parallel, serial, c.rookie ? "RC" : "", c.autograph ? "Auto" : "", c.memorabilia ? "Relic" : ""]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim() || String(c.name || "").replace(GRADE_WORDS, "").replace(/\s+/g, " ").trim() || "Unnamed card";
  const tags = [c.rookie && "rookie", c.autograph && "auto", c.memorabilia && "relic", serial && "numbered", parallel && parallel.toLowerCase().slice(0, 30)].filter(Boolean);
  return {
    photo: k, name, category: c.category || "other", grade,
    confidence: c.identification_confidence || "medium",
    condition_note: blank(c.condition_notes) ? "" : c.condition_notes,
    price_search: c.price_search || c.search_query || name,
    cert: String(c.cert_number || "").replace(/\D/g, ""),
    parallel_check: blank(c.parallel_check) ? null : c.parallel_check,
    id_notes: c.identification_notes || "",
    tags,
    details: { year, set, player: c.player_or_character || "", number, parallel, serial, team: c.team || "", rookie: Boolean(c.rookie), autograph: Boolean(c.autograph), relic: Boolean(c.memorabilia), company, gradeRead: c.grade ?? null },
  };
}

// ================================================================== checklist check
// The reader can misread a card number or name a parallel the set never had; the price site's checklist
// (every entry for that card number in that set) can't. A mismatch is flagged for a person to look at.

const WORDS = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean);
const PARALLEL_NOISE = new Set(["prizm", "prizms", "refractor", "refractors", "parallel", "variation", "foil", "holo"]);
const SET_STOP = new Set(["the", "of", "and", "cards", "card", "set", "series", "trading"]);
const SPORT_WORD = new Set(["baseball", "basketball", "football", "hockey", "soccer"]);

/** "Victor Wembanyama [Silver] #136" or "Monkey.D.Luffy [Alternate Art] OP05-119" → { player, parallel, number } */
export function parseEntry(name) {
  const m = String(name || "").match(/^(.*?)\s*(?:\[([^\]]*)\])?\s*(?:#\s*([\w.-]+)|([A-Z0-9]{2,6}-[A-Z]{0,3}\d{1,4}[A-Z]?))\s*$/);
  return m ? { player: m[1].trim(), parallel: (m[2] || "").trim(), number: m[3] || m[4] } : null;
}
// #036 = #36, LOB-EN001 = LOB-001
const numKey = (x) => String(x || "").toLowerCase().replace(/^#/, "").replace(/-(en|e)(?=\d)/, "-").replace(/(^|\D)0+(?=\d)/g, "$1");
const lastName = (s) => WORDS(s).filter((w) => !["jr", "sr", "ii", "iii", "iv"].includes(w)).pop() || "";
const playerMatches = (read, listed) => !lastName(read) || WORDS(listed).includes(lastName(read));
/**
 * Is the read parallel a version the checklist lists? "Silver Prizm" = [Silver]; "Gold" = [Gold Sparkle] (less
 * specific is fine); "Gold Shimmer" ≠ [Gold] (a word the listing doesn't have); "Refractor" = [Refractor] only.
 */
export function parallelMatches(read, listed) {
  const sig = (s) => WORDS(s).filter((w) => !PARALLEL_NOISE.has(w) && !/^\d+$/.test(w));
  const A = sig(read), B = sig(listed);
  if (!A.length || !B.length) return WORDS(read).filter((w) => !/^\d+$/.test(w)).join(" ") === WORDS(listed).join(" ");
  return A.every((w) => B.includes(w));
}

/**
 * One read card against its set's checklist. entries = price-site search results for that set + number.
 * → null when the set/number isn't found (no verdict — never a false alarm), else
 *   { set, number, players, parallels, note } — note is set only when something doesn't add up.
 */
export function checklistCheck(card, entries) {
  const d = card?.details || {};
  if (!d.number || !(d.set || d.year)) return null;
  const year = String(d.year || "").match(/\d{4}/)?.[0] || "";
  const want = WORDS(d.set).filter((w) => !SET_STOP.has(w) && w !== year);
  const sport = SPORT_WORD.has(card.category) ? card.category : null;
  const found = [];
  for (const e of entries || []) {
    const p = parseEntry(e.name);
    if (!p || numKey(p.number) !== numKey(d.number)) continue;
    const setW = WORDS(e.set);
    if (year && /\b(19|20)\d{2}\b/.test(e.set) && !setW.includes(year)) continue;
    if (sport && setW.some((w) => SPORT_WORD.has(w)) && !setW.includes(sport)) continue;
    const hit = want.filter((w) => setW.includes(w)).length;
    if (want.length && hit / want.length < 0.6) continue;
    found.push({ ...p, set: e.set, hit, extra: setW.filter((w) => !want.includes(w) && w !== year && !SET_STOP.has(w) && !SPORT_WORD.has(w)).length });
  }
  if (!found.length) return null;
  // the closest set name wins: 2023 Panini Prizm, not 2023 Panini Prizm Draft Picks or the Japanese printing
  const best = Math.max(...found.map((x) => x.hit));
  const fewest = Math.min(...found.filter((x) => x.hit === best).map((x) => x.extra));
  const inSet = found.filter((x) => x.hit === best && x.extra === fewest);
  const set = inSet[0].set;
  const players = [...new Set(inSet.map((x) => x.player))];
  const theirs = d.player ? inSet.filter((x) => playerMatches(d.player, x.player)) : inSet;
  const out = { set, number: d.number, players, parallels: [...new Set(inSet.map((x) => x.parallel || "Base"))].slice(0, 60), note: null };
  if (d.player && !theirs.length) {
    out.note = `Checklist: #${d.number} in ${set} is ${players.slice(0, 2).join(" / ")}, not ${d.player} — check the number and the player.`;
  } else if (d.parallel && !theirs.some((x) => x.parallel && parallelMatches(d.parallel, x.parallel))) {
    const listed = [...new Set(theirs.map((x) => x.parallel).filter(Boolean))];
    out.note = `Checklist: no "${d.parallel}" version of #${d.number} is listed for ${set}${listed.length ? ` (listed: ${listed.slice(0, 8).join(", ")}${listed.length > 8 ? "…" : ""})` : ""} — check the parallel.`;
  }
  return out;
}

/** Each card → its checklist verdict (searches run alongside the price lookups; one search per set + number). */
async function checkChecklist(cards) {
  const searches = new Map();
  return Promise.all(cards.map(async (c) => {
    const d = c.details || {};
    if (!d.number) return null;
    const q = kindOf(c.category) !== "sports" && /-/.test(d.number) ? d.number : [d.year, d.set, d.number].filter(Boolean).join(" ");
    if (!searches.has(q)) searches.set(q, pricecharting.search(q, 60, kindOf(c.category)).catch(() => []));
    try {
      return checklistCheck(c, await searches.get(q));
    } catch {
      return null;
    }
  }));
}

/**
 * Close read: each card's own picture (and back) → identity, PSA check, checklist check, price.
 * cards: [{ front, back? }]; hints: this shop's past corrections ("parallel was read as base but it was Silver").
 */
export async function readCards({ cards = [], hints = [] }, { onEvent, signal }) {
  const job = new Job({ kind: "scan-read", onEvent, signal });
  job.step(`Reading ${cards.length} card${cards.length === 1 ? "" : "s"} up close…`);
  const parts = [];
  cards.forEach((c, i) => {
    parts.push({ text: `Card ${i + 1} — front:` });
    parts.push({ inlineData: { mimeType: c.front.mediaType, data: c.front.data } });
    if (c.back) {
      parts.push({ text: `Card ${i + 1} — back:` });
      parts.push({ inlineData: { mimeType: c.back.mediaType, data: c.back.data } });
    }
  });
  parts.push({ text: `Identify each of these ${cards.length} cards.` });
  const learned = hints.length ? `\nThis shop has corrected these readings before — look twice at the same things:\n- ${hints.join("\n- ")}` : "";
  const out = await job.generate({ system: ID_SYSTEM + SCAN_RULES + learned, parts, schema: O({ cards: A(SCAN_CARD, "One entry per card, in the order given") }), detail: true });
  const byNum = new Map((out.cards || []).map((c) => [c.card, c]));
  const read = cards.map((_, i) => normalizeRead(byNum.get(i + 1), i + 1));
  job.step("Looking up sold prices and checking each card against its set's checklist…");
  await checkCerts(read, job);
  const [rows, lists] = await Promise.all([priceCards(read, job), checkChecklist(read)]);
  // PSA's own record outranks the checklist (it names the card its own way)
  rows.forEach((c, i) => lists[i] && (c.checklist = c.certVerified ? { ...lists[i], note: null } : lists[i]));
  return { cards: rows, usage: job.finish() };
}

// ================================================================== ask your own business
// The AI never does the arithmetic: it turns the question into a filter + grouping (BIZ_QUERY), the code below
// counts the real records, and the AI only words the answer from those numbers.

const BIZ_QUERY = O({
  dataset: E(["sales", "stock", "expenses", "customers"], "sales = cards sold; stock = cards owned now; expenses = money spent; customers = the customer book"),
  text_any: A(S("A word or name"), "The card's name / player / team / set / tags must contain at least one of these. For a team, list its players too (Tigers → Tigers, Skubal, Greene, Torkelson, Carpenter…). Empty = every card."),
  category: E([...CAT_ENUM, "any"], "Card category, or any"),
  date_from: SN("YYYY-MM-DD or null — sales: sold date; stock: date added; expenses: date"),
  date_to: SN("YYYY-MM-DD or null"),
  platform: SN("Sales only — where it sold (eBay, Whatnot, TCGplayer, MJC site, Card show, Facebook, Local / cash) or null"),
  grade_has: SN("Grade text the card's grade must contain ('PSA 10', 'Raw', 'BGS') or null"),
  min_days_in_stock: N("Stock only: at least this many days since it was added, or null"),
  group_by: E(["none", "month", "category", "platform", "grade", "location", "card", "kind"], "How to split the result (kind = expense type)"),
  sort_by: E(["units", "revenue", "profit", "value", "cost", "days"], "Which number to sort groups by (largest first)"),
  explain: S("One plain sentence saying exactly what is counted, naming the words used"),
});

/** Run a BIZ_QUERY on the shop's records → { totals, groups, rows }. Pure: the server passes the records in. */
export function runBusinessQuery(q, { inventory = [], expenses = [], customers = [], feeFor = () => 0, today = new Date().toISOString().slice(0, 10) }) {
  const words = (q.text_any || []).map((w) => String(w).toLowerCase().trim()).filter((w) => w.length >= 2);
  const hay = (r) => [r.name, r.facts?.player, r.facts?.team, r.facts?.set, (r.tags || []).join(" ")].join(" ").toLowerCase();
  const inDates = (d) => (!q.date_from || (d || "") >= q.date_from) && (!q.date_to || (d || "") <= q.date_to);
  const r2 = (v) => Math.round(v * 100) / 100;
  const days = (from, to) => (from ? Math.max(0, Math.round((Date.parse(to || today) - Date.parse(from)) / 86400000)) : null);
  let rows = [];
  if (q.dataset === "expenses") {
    rows = expenses.filter((e) => inDates(e.date) && (!words.length || words.some((w) => `${e.kind} ${e.note}`.toLowerCase().includes(w)))).map((e) => ({ name: e.note || e.kind, kind: e.kind, month: e.date.slice(0, 7), units: 1, cost: e.amount }));
  } else if (q.dataset === "customers") {
    rows = customers.filter((c) => !words.length || words.some((w) => `${c.name} ${c.collects}`.toLowerCase().includes(w))).map((c) => ({ name: c.name, units: c.bought || 0, revenue: c.spent || 0, value: c.credit || 0 }));
  } else {
    const sold = q.dataset === "sales";
    rows = inventory
      .filter((r) => (sold ? r.status === "sold" && r.soldPrice != null : r.status !== "sold"))
      .filter((r) => (!words.length || words.some((w) => hay(r).includes(w))) && (!q.category || q.category === "any" || r.category === q.category))
      .filter((r) => inDates(sold ? r.soldDate : String(r.added || "").slice(0, 10)) && (!q.grade_has || String(r.grade || "").toLowerCase().includes(String(q.grade_has).toLowerCase())))
      .filter((r) => !sold || !q.platform || String(r.soldOn || "").toLowerCase() === String(q.platform).toLowerCase())
      .filter((r) => sold || q.min_days_in_stock == null || days(String(r.added || "").slice(0, 10)) >= q.min_days_in_stock)
      .map((r) => ({
        name: r.name, grade: r.grade, category: r.category, platform: r.soldOn || "", location: r.location || "", month: String((sold ? r.soldDate : r.added) || "").slice(0, 7), units: r.qty,
        revenue: sold ? r2(r.soldPrice * r.qty) : 0, cost: r2((r.cost || 0) * r.qty), fees: sold ? r2(feeFor(r)) : 0,
        profit: sold ? r2((r.soldPrice - (r.cost || 0)) * r.qty - feeFor(r)) : 0, value: sold ? 0 : r2((r.value ?? r.cost ?? 0) * r.qty),
        days: sold ? days(r.purchased || String(r.added || "").slice(0, 10), r.soldDate) : days(String(r.added || "").slice(0, 10)),
      }));
  }
  const sum = (list, k) => r2(list.reduce((n, x) => n + (x[k] || 0), 0));
  const totalsOf = (list) => ({ rows: list.length, units: list.reduce((n, x) => n + (x.units || 0), 0), revenue: sum(list, "revenue"), profit: sum(list, "profit"), cost: sum(list, "cost"), fees: sum(list, "fees"), value: sum(list, "value"), avgDays: list.some((x) => x.days != null) ? Math.round(list.filter((x) => x.days != null).reduce((n, x) => n + x.days, 0) / list.filter((x) => x.days != null).length) : null });
  const key = { month: "month", category: "category", platform: "platform", grade: "grade", location: "location", card: "name", kind: "kind" }[q.group_by];
  const by = q.sort_by === "days" ? "avgDays" : q.sort_by || "units";
  const groups = key ? [...rows.reduce((m, x) => m.set(x[key] || "(none)", [...(m.get(x[key] || "(none)") || []), x]), new Map())].map(([k, list]) => ({ group: k, ...totalsOf(list) })).sort((a, b) => (q.group_by === "month" ? (a.group < b.group ? 1 : -1) : (b[by] ?? 0) - (a[by] ?? 0))).slice(0, 40) : [];
  return { totals: totalsOf(rows), groups, rows: [...rows].sort((a, b) => (b[q.sort_by === "days" ? "days" : by] ?? 0) - (a[q.sort_by === "days" ? "days" : by] ?? 0)).slice(0, 25) };
}

/** A question about the shop's own records → the query used, the real numbers, and a short answer from them. */
export async function askBusiness({ question, records }, { onEvent, signal }) {
  const job = new Job({ kind: "ask-business", onEvent, signal });
  job.step("Working out what to count…");
  const q = await job.generate({
    system: `You turn a card-shop owner's question about their own records into a query. Today is ${today()}. "This year" = from ${today().slice(0, 4)}-01-01. Pick the dataset, the words to match (for a team or a theme, list the players or names that belong to it), the dates and how to group the result. Never answer the question yourself.`,
    parts: [{ text: question }],
    schema: BIZ_QUERY,
    effort: "low",
  });
  job.step(q.explain);
  const result = runBusinessQuery(q, records);
  job.step("Writing the answer from the numbers…");
  const a = await job.generate({
    system: `You answer a card-shop owner's question about their own business using ONLY the numbers given (computed from their records). Quote numbers exactly as given; never estimate, add up or invent anything not in them. 2-4 short sentences, plain words, dollars with $. If the result is empty, say nothing matched and what was looked for.`,
    parts: [{ text: `QUESTION: ${question}
WHAT WAS COUNTED: ${q.explain}
TOTALS: ${JSON.stringify(result.totals)}
GROUPS: ${JSON.stringify(result.groups.slice(0, 20))}
TOP ROWS: ${JSON.stringify(result.rows.slice(0, 10))}` }],
    schema: O({ answer: S("The answer") }),
    effort: "low",
  });
  return { query: q, ...result, answer: a.answer, usage: job.finish() };
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
    effort: "low",
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

// ================================================================== receipt → expense

const RECEIPT = O({
  vendor: S("Store or seller name as printed"),
  date: SN("Purchase date as YYYY-MM-DD, or null if it isn't on the receipt"),
  total: N("The final total paid in USD (after tax and shipping), or null if it can't be read clearly"),
  kind: E(EXPENSE_KINDS, "Best expense category for a trading card business"),
  note: S("Short description of what was bought, e.g. '200 toploaders + 100 penny sleeves' or 'PSA Value submission, 12 cards'"),
  confidence: E(["high", "medium", "low"], "How clearly the receipt could be read"),
});

/** A photo of a receipt or invoice → the fields of an expense (the owner checks them before saving). */
export async function readReceipt({ images = [] }, { onEvent, signal }) {
  const job = new Job({ kind: "receipt", onEvent, signal });
  job.step("Reading the receipt…");
  const parts = images.map((img) => ({ inlineData: { mimeType: img.mediaType, data: img.data } }));
  parts.push({ text: "Read this receipt for the business's expense log." });
  const r = await job.generate({
    system: `You read receipts and invoices for a small trading card business's bookkeeping. Today is ${today()}.
Use only what is printed. Never guess a total — if the total isn't clearly readable, return null.
Categories: grading fees (PSA, BGS, SGC, CGC, TAG) → "Grading"; postage, shipping labels → "Shipping"; toploaders, sleeves,
one-touches, team bags, boxes, mailers → "Supplies"; show tables and booths → "Card show / table"; marketplace or payment
fees → "Fees"; gas, hotel, tolls, parking → "Travel"; apps and subscriptions → "Software".`,
    parts,
    schema: RECEIPT,
    effort: "low",
  });
  return { ...r, usage: job.finish() };
}
