// Runs the pricing engine over every card marked "Sell on MJC": the one place website prices are set.
// Called once a day by the background loop, right after a card is first put on the site, and from the
// "Re-price now" button. Free — it uses the sold-price feeds, not AI.

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

export function trainedModel() {
  const obs = store.pricingObs().filter((o) => o.market > 0 && o.ratio > 0);
  const m = pr.trainModel(obs);
  const summary = { ...m, at: new Date().toISOString(), text: pr.describeModel(m), optimizing: m.sales >= pr.MIN_SALES_TO_OPTIMIZE, needSales: pr.MIN_SALES_TO_OPTIMIZE };
  store.save("pricing-model", summary);
  return m;
}

const liqText = (l) => (l >= 1 ? `~${Math.round(l)} sold/day` : l >= 1 / 7 ? `~${Math.round(l * 7)} sold/week` : l >= 1 / 30 ? `~${Math.round(l * 30)} sold/month` : "rarely sells");
const daysSince = (iso) => (iso ? Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 86400000)) : 0);

let running = null;
/** @param o.ids  only these inventory rows (e.g. a card just put on the site); default = every on-site card */
export function run({ ids = null, force = false } = {}) {
  // One run at a time, but never drop a request: a card put on the site while another run is going
  // waits its turn and then gets priced (returning the other run's result would skip it).
  if (running) return running.catch(() => {}).then(() => run({ ids, force }));
  running = (async () => {
    const s = settings();
    if (!s.enabled && !force) return { skipped: true, reason: "Pricing engine is off" };
    const model = trainedModel();
    const rows = store.inventory().filter((r) => r.web && ["in_stock", "listed"].includes(r.status) && r.qty > 0 && (!ids || ids.includes(r.id)));
    const changes = [], skipped = [], obs = [];
    for (const r of rows) {
      if (!r.priceUrl) {
        if (r.webMode !== "fixed") {
          store.setEngineFields(r.id, { webPricingNote: "Link a sales page (💲 Find price) so the engine can price this card — or set a fixed price." });
          skipped.push({ id: r.id, name: r.name, reason: "no sales page" });
        }
        continue;
      }
      let data;
      try {
        data = await pc.card(r.priceUrl);
      } catch (err) {
        skipped.push({ id: r.id, name: r.name, reason: err.message });
        continue;
      }
      const est = pr.marketEstimate(data, r.grade, pc.valueAtGrade(data, r.grade));
      if (!est.market) {
        skipped.push({ id: r.id, name: r.name, reason: "no sold data for this grade" });
        store.setEngineFields(r.id, { webPricingNote: `No sold data for ${r.grade} on its sales page — set a fixed price.` });
        continue;
      }
      const listedAt = r.webListedAt || new Date().toISOString();
      const patch = { webMarket: est.market, webLiquidity: liqText(est.liquidity), lastPricedAt: new Date().toISOString(), webPricingNote: null, webListedAt: listedAt };
      let price = r.webFixedPrice;
      if (r.webMode !== "fixed") {
        const daysListed = daysSince(r.webListedAt);
        const d = pr.choosePrice({ market: est.market, liq: est.liquidity, cost: r.cost || 0, current: r.webPrice || null, daysListed }, model, s);
        price = d.price;
        if (!d.unchanged) {
          const reason = pr.reasonText({ est, decision: d, current: r.webPrice || null, daysListed });
          patch.webPrice = d.price;
          patch.priceLog = [...(r.priceLog || []), { at: new Date().toISOString(), from: r.webPrice ?? null, to: d.price, market: est.market, reason }].slice(-60);
          changes.push({ id: r.id, name: r.name, grade: r.grade, from: r.webPrice ?? null, to: d.price, reason });
        }
      }
      store.setEngineFields(r.id, patch);
      // Every listed card-day is training data — fixed prices too (they show how buyers react to price).
      if (price > 0) obs.push({ id: r.id, ratio: price / est.market, liq: est.liquidity, market: est.market });
    }
    if (!ids) store.addPricingObs(obs);
    const result = { at: new Date().toISOString(), priced: rows.length - skipped.length, changes, skipped, model: { n: model.n, sales: model.sales } };
    if (!ids) store.save("pricing-last-run", result);
    return result;
  })().finally(() => (running = null));
  return running;
}

/** Recent price changes across all cards, newest first (for the Pricing panel). */
export function recentChanges(limit = 60) {
  return store
    .inventory()
    .flatMap((r) => (r.priceLog || []).map((l) => ({ ...l, id: r.id, name: r.name, grade: r.grade })))
    .sort((a, b) => (a.at < b.at ? 1 : -1))
    .slice(0, limit);
}
