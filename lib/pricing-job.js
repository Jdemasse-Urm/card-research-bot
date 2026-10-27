// Runs the pricing engine over every card marked "Sell on MJC": the one place website prices are set.
// Called once a day by the background loop, right after a card is first put on the site, and from the
// "Re-price now" button. Free — it uses the sold-price feeds, not AI.
//
// Service rules: sales pages load in parallel (one fetch per page per run, even when several copies or
// grades of a card share it); a day when the feed can't be read for most cards is NOT counted as that
// day's run (prices hold, the owner gets one alert, and the hourly loop retries); a market value that
// jumps more than MARKET_JUMP in a day is held until the feed confirms it the next day.

import * as pr from "./pricing.js";
import * as pc from "./sources/pricecharting.js";
import * as store from "./store.js";

export const settings = () => ({ ...pr.DEFAULTS, ...store.load("pricing-settings", {}) });

export function saveSettings(b) {
  const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);
  const cur = settings();
  const s = {
    enabled: b.enabled === undefined ? cur.enabled : Boolean(b.enabled),
    minMarginPct: num(b.minMarginPct, 0, 200, cur.minMarginPct),
    maxMovePct: num(b.maxMovePct, 1, 25, cur.maxMovePct),
    clearanceDays: num(b.clearanceDays, 14, 365, cur.clearanceDays),
    monthlyReturnPct: num(b.monthlyReturnPct, 1, 30, cur.monthlyReturnPct),
  };
  store.save("pricing-settings", s);
  return { ...pr.DEFAULTS, ...s };
}

/** Train on everything observed so far and health-check the result; the summary feeds the Pricing panel. */
export function trainedModel() {
  const obs = store.pricingObs().filter((o) => o.market > 0 && o.ratio > 0);
  const m = pr.trainModel(obs);
  const health = pr.evaluateModel(obs, m);
  const model = { ...m, trusted: health.trusted };
  const summary = { ...model, at: new Date().toISOString(), text: pr.describeModel(model, health), health, optimizing: pr.modelSteers(model), needSales: pr.MIN_SALES_TO_OPTIMIZE };
  store.save("pricing-model", summary);
  return model;
}

const liqText = (l) => (l >= 1 ? `~${Math.round(l)} sold/day` : l >= 1 / 7 ? `~${Math.round(l * 7)} sold/week` : l >= 1 / 30 ? `~${Math.round(l * 30)} sold/month` : "rarely sells");
const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : 0);

/** A market value that moves this much in one day is held for a day and re-checked (misparsed page, mislabeled lot). */
export const MARKET_JUMP = 0.4;

/** The market value to price from today, given yesterday's and what the feed says now. */
export function settleMarket(row, est) {
  const prev = row.webMarket;
  if (!(prev > 0) || Math.abs(est.market / prev - 1) <= MARKET_JUMP) return { market: est.market, pending: null, held: false };
  // Second day in a row at the new level (within 25%): the feed confirmed it.
  if (row.webMarketPending > 0 && Math.abs(est.market / row.webMarketPending - 1) <= 0.25) return { market: est.market, pending: null, held: false, confirmed: true };
  return { market: prev, pending: est.market, held: true };
}

let running = null;
/**
 * @param o.ids        only these inventory rows (e.g. a card just put on the site); default = every on-site card
 * @param o.force      run even when the engine is switched off (the "Re-price now" button)
 * @param o.fetchCard  the sales-page reader (tests inject a stub)
 */
export function run({ ids = null, force = false, fetchCard = pc.card } = {}) {
  // One run at a time, but never drop a request: a card put on the site while another run is going
  // waits its turn and then gets priced (returning the other run's result would skip it).
  if (running) return running.catch(() => {}).then(() => run({ ids, force, fetchCard }));
  running = (async () => {
    const s = settings();
    if (!s.enabled && !force) return { skipped: true, reason: "Pricing engine is off" };
    const model = trainedModel();
    const rows = store.inventory().filter((r) => r.web && ["in_stock", "listed"].includes(r.status) && r.qty > 0 && (!ids || ids.includes(r.id)));
    const hist = store.historyView(); // each card's earlier website price changes (the log is kept outside the rows)
    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);

    const pages = new Map(); // sales page url -> one in-flight fetch per run
    const page = (url) => {
      if (!pages.has(url)) pages.set(url, fetchCard(url));
      return pages.get(url);
    };
    let fetchErrors = 0;

    const results = await Promise.all(rows.map(async (r) => {
      if (!r.priceUrl) {
        if (r.webMode === "fixed") return null;
        return { id: r.id, skip: { id: r.id, name: r.name, reason: "no sales page" }, patch: { webPricingNote: "Link a sales page (💲 Find price) so the engine can price this card — or set a fixed price." } };
      }
      let data;
      try {
        data = await page(r.priceUrl);
      } catch (err) {
        fetchErrors++;
        return { id: r.id, skip: { id: r.id, name: r.name, reason: err.message, fetchError: true } };
      }
      const est = pr.marketEstimate(data, r.grade, pc.valueAtGrade(data, r.grade));
      if (!est.market) return { id: r.id, skip: { id: r.id, name: r.name, reason: "no sold data for this grade" }, patch: { webPricingNote: `No sold data for ${r.grade} on its sales page — set a fixed price.` } };
      const settled = settleMarket(r, est);
      const patch = { webMarket: settled.market, webMarketPending: settled.pending, webLiquidity: liqText(est.liquidity), webLiqPerDay: est.liquidity, lastPricedAt: nowIso, webPricingNote: null, webListedAt: r.webListedAt || nowIso };
      let price = r.webFixedPrice, change = null;
      if (r.webMode !== "fixed") {
        const daysListed = daysSince(r.webListedAt);
        const d = pr.choosePrice({ market: settled.market, liq: est.liquidity, cost: r.consignorId ? r.consignFloor || 0 : r.cost || 0, current: r.webPrice || null, daysListed }, model, s);
        price = d.price;
        if (!d.unchanged) {
          const reason = pr.reasonText({ est: { ...est, market: settled.market }, decision: d, current: r.webPrice || null, daysListed, marketHeld: settled.held ? est.market : null });
          patch.webPrice = d.price;
          patch.priceLog = [...(hist[r.id]?.p || []), { at: nowIso, from: r.webPrice ?? null, to: d.price, market: settled.market, reason }].slice(-60);
          change = { id: r.id, name: r.name, grade: r.grade, from: r.webPrice ?? null, to: d.price, reason };
        }
      }
      const held = settled.held ? { id: r.id, name: r.name, grade: r.grade, from: settled.market, to: est.market } : null;
      // Every listed card-day is training data — fixed prices too (they show how buyers react to price).
      const ob = price > 0 ? { id: r.id, ratio: price / settled.market, liq: est.liquidity, market: settled.market } : null;
      return { id: r.id, patch, change, held, ob };
    }));

    const changes = [], skipped = [], held = [], obs = [], patches = [];
    for (const x of results) {
      if (!x) continue;
      if (x.skip) skipped.push(x.skip);
      if (x.patch) patches.push({ id: x.id, ...x.patch });
      if (x.change) changes.push(x.change);
      if (x.held) held.push(x.held);
      if (x.ob) obs.push(x.ob);
    }
    // Most of the feed unreadable = the site is down or blocking us, not a pricing fact: hold every price,
    // skip today's training rows, and let the hourly loop try again.
    const feedDown = rows.length > 0 && fetchErrors >= Math.max(1, Math.ceil(rows.length / 2));
    store.setEngineFieldsMany(patches);
    if (!ids && !feedDown) store.addPricingObs(obs);
    const result = { at: nowIso, priced: rows.length - skipped.length, changes, skipped, held, feedDown, fetchErrors, model: { n: model.n, sales: model.sales, trusted: model.trusted } };
    if (!ids) {
      const prev = store.load("pricing-last-run", null);
      if (feedDown && !(prev?.feedDown && prev.at.slice(0, 10) === today)) {
        const why = skipped.find((x) => x.fetchError)?.reason || "unreadable";
        store.addAlert({ kind: "pricing", name: "Website prices held", text: `The sold-price site couldn't be read for ${fetchErrors} of ${rows.length} cards (${why}). Prices stay as they are and the engine retries every hour.` });
      }
      store.save("pricing-last-run", result);
    }
    return result;
  })().finally(() => (running = null));
  return running;
}

/** Recent price changes across all cards, newest first (for the Pricing panel). */
export function recentChanges(limit = 60) {
  const h = store.historyView();
  return store
    .inventoryView()
    .flatMap((r) => (h[r.id]?.p || []).map((l) => ({ ...l, id: r.id, name: r.name, grade: r.grade })))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}
