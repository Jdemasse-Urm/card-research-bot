// OPTCG API (optcgapi.com): every One Piece TCG card from booster sets + starter decks with
// TCGplayer market price, scraped daily by that site. Loaded once and cached for 6 hours.

import { getJson } from "../http.js";

const TTL = 6 * 60 * 60 * 1000;

async function allCards() {
  const [sets, starters] = await Promise.all([
    getJson("https://optcgapi.com/api/allSetCards/", { ttlMs: TTL, timeoutMs: 60000 }),
    getJson("https://optcgapi.com/api/allSTCards/", { ttlMs: TTL, timeoutMs: 60000 }).catch(() => []),
  ]);
  return [...sets, ...starters];
}

// query can be a name ("Monkey.D.Luffy"), a card number ("OP05-119") or both.
export async function lookup(query, limit = 15) {
  const cards = await allCards();
  const q = query.toLowerCase().replace(/[.\s]+/g, " ").trim();
  const code = query.toUpperCase().match(/\b(OP|ST|EB|PRB|P)\d{0,2}-\d{3}\b/)?.[0];
  const words = q.split(" ").filter((w) => w && !(code && w.toUpperCase() === code));

  const scored = [];
  for (const c of cards) {
    const name = String(c.card_name || "").toLowerCase().replace(/[.\s]+/g, " ");
    let score = 0;
    if (code && String(c.card_set_id || "").toUpperCase() === code) score += 10;
    for (const w of words) if (name.includes(w)) score += 2;
    if (score > 0) scored.push([score, c]);
  }
  scored.sort((a, b) => b[0] - a[0] || (b[1].market_price || 0) - (a[1].market_price || 0));

  return scored.slice(0, limit).map(([, c]) => ({
    name: c.card_name,
    number: c.card_set_id,
    set: c.set_name,
    rarity: c.rarity,
    color: c.card_color,
    type: c.card_type,
    variant: c.card_image_id && c.card_image_id !== c.card_set_id ? c.card_image_id : "base",
    marketPrice: c.market_price,
    listedPrice: c.inventory_price,
    priceDate: c.date_scraped,
    image: c.card_image,
  }));
}
