// eBay Browse API — LIVE listings (what's for sale right now), for the deal finder.
// Free keys: developer.ebay.com -> create a Production keyset -> App ID (Client ID) + Cert ID (Client Secret).
// Sold prices still come from SportsCardsPro/PriceCharting; eBay doesn't give sold data on this API.

let token = null; // { value, exp }

export const hasKeys = () => Boolean(process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET);

async function getToken() {
  if (token && Date.now() < token.exp - 60000) return token.value;
  if (!hasKeys()) throw new Error("No eBay API keys — add them in Settings (free at developer.ebay.com).");
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch("https://api.ebay.com/identity/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials&scope=" + encodeURIComponent("https://api.ebay.com/oauth/api_scope"),
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(res.status === 401 ? "eBay rejected the API keys — check them in Settings." : `eBay sign-in failed (${res.status}).`);
  const j = await res.json();
  token = { value: j.access_token, exp: Date.now() + (j.expires_in || 7200) * 1000 };
  return token.value;
}

export function resetToken() {
  token = null;
}

/** Active listings for a query, cheapest total (price + shipping) first. */
export async function searchActive(query, { limit = 50 } = {}) {
  const t = await getToken();
  const params = new URLSearchParams({ q: query.slice(0, 300), limit: String(Math.min(200, limit)), sort: "price" });
  params.set("filter", "buyingOptions:{FIXED_PRICE|AUCTION|BEST_OFFER},priceCurrency:USD,itemLocationCountry:US");
  const res = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?${params}`, {
    headers: { Authorization: `Bearer ${t}`, "X-EBAY-C-MARKETPLACE-ID": "EBAY_US", Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401) {
    token = null;
    throw new Error("eBay token expired — try again.");
  }
  if (!res.ok) throw new Error(`eBay search failed (${res.status}).`);
  const j = await res.json();
  return (j.itemSummaries || []).map((it) => {
    const price = parseFloat(it.price?.value) || parseFloat(it.currentBidPrice?.value) || 0;
    const ship = it.shippingOptions?.[0]?.shippingCost ? parseFloat(it.shippingOptions[0].shippingCost.value) || 0 : 0;
    return {
      title: it.title,
      price,
      shipping: ship,
      total: Math.round((price + ship) * 100) / 100,
      url: it.itemWebUrl,
      image: it.image?.imageUrl || it.thumbnailImages?.[0]?.imageUrl || null,
      buying: (it.buyingOptions || []).join("/"),
      bids: it.bidCount ?? null,
      ends: it.itemEndDate || null,
      condition: it.condition || null,
      seller: it.seller ? `${it.seller.username} (${it.seller.feedbackPercentage}%)` : null,
    };
  });
}
