// YGOPRODeck free API: Yu-Gi-Oh card data, every printing (set code + rarity + set price) and
// marketplace prices (TCGplayer, Cardmarket, eBay, Amazon, CoolStuffInc).

import { getJson } from "../http.js";

export async function lookup(name, limit = 5) {
  const url = `https://db.ygoprodeck.com/api/v7/cardinfo.php?fname=${encodeURIComponent(name)}`;
  let data;
  try {
    data = (await getJson(url, { ttlMs: 60 * 60 * 1000 })).data || [];
  } catch (e) {
    if (String(e.message).includes("400")) return []; // API answers 400 for "no card matching"
    throw e;
  }
  const q = name.toLowerCase();
  data.sort((a, b) => (a.name.toLowerCase() === q ? -1 : 0) - (b.name.toLowerCase() === q ? -1 : 0));
  return data.slice(0, limit).map((c) => ({
    name: c.name,
    type: c.humanReadableCardType || c.type,
    attribute: c.attribute,
    level: c.level,
    atk: c.atk,
    def: c.def,
    archetype: c.archetype,
    url: c.ygoprodeck_url,
    image: c.card_images?.[0]?.image_url,
    marketPrices: c.card_prices?.[0],
    printings: (c.card_sets || []).slice(0, 40).map((s) => ({
      set: s.set_name,
      code: s.set_code,
      rarity: s.set_rarity,
      price: s.set_price,
    })),
    banlist: c.banlist_info || null,
  }));
}
