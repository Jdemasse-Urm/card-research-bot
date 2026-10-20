// The MJC pricing engine — sets the website price of every card marked "Sell on MJC", once a day.
//
// 1. MARKET VALUE from real sold comps (SportsCardsPro / PriceCharting eBay sales for that exact grade):
//    time-decayed weighted median (half-life 21 days), outliers removed with a MAD filter, blended with the
//    price guide when there are few comps, nudged by the 1-month trend.
// 2. A LEARNED SELL-THROUGH MODEL: logistic regression for "does this card sell today at this price?"
//    on features [ln(price/market), ln(sales per day), ln(market)]. It's trained every day on the shop's
//    own history (one observation per card per day listed; label = sold that day), with a Bayesian prior
//    so it behaves sensibly from day one and gradually learns how price-sensitive YOUR buyers are.
// 3. THE PRICE: until the site has MIN_SALES_TO_OPTIMIZE sales, a markdown schedule from market; after that,
//    the multiple of market maximizing expected discounted profit under the learned model. Always inside hard
//    guardrails — never below cost + margin (until the clearance age), at most ±maxMove a day, no change for
//    moves under 1%, rounded to a clean .99 price at or above the floor. Every change carries its reason.

export const DEFAULTS = { enabled: true, minMarginPct: 10, maxMovePct: 5, clearanceDays: 75, monthlyReturnPct: 5, feePct: 2.9, feeFixed: 0.3 };

// prior: logit p(sell today on the MJC site) = a + b·ln(P/M) + c·ln(liq + .02) + d·ln(M)
//   A small shop sees far less traffic than eBay: a card that sells ~3×/day on eBay starts at ~2–3%/day on
//   the site at market price, and buyers who can compare with eBay are price-sensitive (+10% ≈ −70% odds).
export const PRIOR = [-3.9, -12.0, 0.8, -0.1];
// How hard each coefficient is pulled toward the prior. Price sensitivity is held loosely so the shop's own
// sales teach it quickly; the baseline terms move more slowly.
const PRIOR_STRENGTH = [1, 0.25, 1, 1];

const sigmoid = (z) => 1 / (1 + Math.exp(-z));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const DAY = 86400000;

// ------------------------------------------------------------------ market value

/** Which PriceCharting sales column holds comps for a grade label. */
export function salesColumn(recentSales, grade) {
  const keys = Object.keys(recentSales || {});
  const g = String(grade || "Raw").toUpperCase();
  const num = g.match(/(\d+(\.\d)?)$/)?.[1];
  if (/RAW|UNGRADED/.test(g) || !num) return keys.find((k) => /^(ungraded|loose)/i.test(k)) || keys[0] || null;
  return keys.find((k) => k.toUpperCase() === g) || (num === "10" ? (/^(PSA )?10$/.test(g) ? keys.find((k) => /^PSA 10$/i.test(k)) : null) : keys.find((k) => k.toUpperCase() === `GRADE ${num}`)) || null;
}

function weightedMedian(points) {
  const sorted = [...points].sort((a, b) => a.v - b.v);
  const total = sorted.reduce((n, p) => n + p.w, 0);
  let acc = 0;
  for (const p of sorted) {
    acc += p.w;
    if (acc >= total / 2) return p.v;
  }
  return sorted.at(-1)?.v ?? null;
}

/** salesVolume text like "3 sales per week" → sales per day */
export function salesPerDay(text) {
  const m = String(text || "").match(/(\d+(?:\.\d+)?)\s+sales?\s+per\s+(day|week|month|year)/i);
  if (!m) return /rare/i.test(text) ? 0.003 : null;
  return parseFloat(m[1]) / { day: 1, week: 7, month: 30, year: 365 }[m[2].toLowerCase()];
}

/**
 * @param data  pricecharting.card() result
 * @param guideValue  pricecharting.valueAtGrade(data, grade)
 */
export function marketEstimate(data, grade, guideValue, now = Date.now()) {
  const col = salesColumn(data?.recentSales, grade);
  const rows = (col ? data.recentSales[col] : []) || [];
  let pts = rows
    .map((r) => ({ v: r.price, age: (now - Date.parse(r.date + "T12:00:00")) / DAY, date: r.date }))
    .filter((p) => p.v > 0 && p.age >= 0 && p.age <= 120)
    .map((p) => ({ ...p, w: Math.pow(0.5, p.age / 21) }));
  // Robust outlier filter (bad listings, lots, mislabeled grades).
  if (pts.length >= 4) {
    const med = weightedMedian(pts.map((p) => ({ v: p.v, w: 1 })));
    const mad = weightedMedian(pts.map((p) => ({ v: Math.abs(p.v - med), w: 1 })));
    if (mad > 0) pts = pts.filter((p) => Math.abs(p.v - med) <= 3 * 1.4826 * mad);
  }
  const compMedian = pts.length ? weightedMedian(pts) : null;
  const n = pts.length;
  let market = compMedian != null && guideValue != null ? (n / (n + 3)) * compMedian + (3 / (n + 3)) * guideValue : compMedian ?? guideValue ?? null;
  const trend1 = col ? data?.trendPct?.[col]?.["1mo"] ?? null : null;
  if (market != null && trend1 != null) market *= 1 + clamp((trend1 / 100) * 0.5, -0.08, 0.08);
  const liq = salesPerDay(col ? data?.salesVolume?.[col] : null) ?? (n ? Math.min(1, n / 60) : 0.02);
  const last = [...pts].sort((a, b) => a.age - b.age)[0] || null;
  return {
    market: market != null ? Math.round(market * 100) / 100 : null,
    comps: n,
    compMedian: compMedian != null ? Math.round(compMedian * 100) / 100 : null,
    guide: guideValue ?? null,
    trend1,
    liquidity: liq,
    lastSale: last ? { price: last.v, date: last.date } : null,
    column: col,
  };
}

// ------------------------------------------------------------------ sell-through model

const features = (ratio, liq, market) => [1, Math.log(ratio), Math.log((liq || 0) + 0.02), Math.log(Math.max(1, market))];

/** MAP logistic regression (Newton steps) pulled toward PRIOR. obs: [{ratio, liq, market, y}] */
export function trainModel(obs, prior = PRIOR) {
  let beta = [...prior];
  const n = obs.length;
  if (!n) return { beta, n: 0, sales: 0 };
  for (let iter = 0; iter < 25; iter++) {
    const g = beta.map((b, j) => PRIOR_STRENGTH[j] * (b - prior[j])); // gradient of the penalty
    const H = beta.map((_, i) => beta.map((__, j) => (i === j ? PRIOR_STRENGTH[j] : 0)));
    for (const o of obs) {
      const x = features(o.ratio, o.liq, o.market);
      const p = sigmoid(x.reduce((s, v, j) => s + v * beta[j], 0));
      for (let i = 0; i < 4; i++) {
        g[i] += (p - o.y) * x[i];
        for (let j = 0; j < 4; j++) H[i][j] += p * (1 - p) * x[i] * x[j];
      }
    }
    const step = solve(H, g);
    beta = beta.map((b, i) => b - step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }
  return { beta, n, sales: obs.filter((o) => o.y).length };
}

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) continue;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-12 ? 0 : row[n] / row[i]));
}

export const pSellPerDay = (beta, ratio, liq, market) => sigmoid(features(ratio, liq, market).reduce((s, v, j) => s + v * beta[j], 0));

/** Human summary of what the model has learned. */
export function describeModel(model) {
  const [, b] = model.beta;
  const tenPct = Math.round((1 - Math.exp(b * Math.log(1.1))) * 100);
  return `Trained on ${model.n} listing-days and ${model.sales} site sale${model.sales === 1 ? "" : "s"}. Pricing 10% over market cuts the daily chance of a sale by about ${tenPct}%${model.sales < 20 ? " (still mostly the built-in starting assumptions — it sharpens as you make sales)" : ""}.`;
}

// ------------------------------------------------------------------ the price

export const charm = (p) => (p < 2 ? Math.max(0.99, Math.round(p * 100) / 100) : Math.max(0.99, Math.round(p) - 0.01));
/** Charm-round without ever landing below the floor. */
const charmAbove = (p, floor) => {
  let c = charm(p);
  while (c < floor - 1e-9) c = c < 2 ? Math.round((c + 0.01) * 100) / 100 : c + 1;
  return c;
};

/** Below this many site sales the model hasn't seen enough to steer prices; a markdown schedule does. */
export const MIN_SALES_TO_OPTIMIZE = 10;

/**
 * @param o.market      market value (from marketEstimate)
 * @param o.liq         sales per day (market-wide, from the comps feed)
 * @param o.cost        cost basis per unit (0/unknown allowed)
 * @param o.current     current site price (null on first pricing)
 * @param o.daysListed  days on the site
 */
export function choosePrice({ market, liq, cost = 0, current = null, daysListed = 0 }, model, settings = DEFAULTS) {
  const s = { ...DEFAULTS, ...settings };
  if (!(market > 0)) return null;
  const fees = (p) => (p * s.feePct) / 100 + s.feeFixed;
  const clearance = daysListed >= s.clearanceDays;
  let floor = cost > 0 ? (clearance ? cost + fees(cost) : cost * (1 + s.minMarginPct / 100) + fees(cost)) : market * 0.85;
  floor = Math.max(floor, market * (clearance ? 0.6 : 0.8), 0.99);
  const ceiling = Math.max(floor, market * 1.35);
  const pAt = (q) => pSellPerDay(model.beta, q, liq, market);
  const p30At = (q) => 1 - Math.pow(1 - pAt(q), 30);

  let q, mode;
  if ((model.sales || 0) < MIN_SALES_TO_OPTIMIZE) {
    // Cold start: start at market (a premium for slow movers, which buyers can't easily find elsewhere),
    // then mark down 2% for every week without a sale, to 8% under the start. The variation this creates
    // is exactly what the model needs to learn your buyers' price sensitivity.
    const start = liq >= 1 ? 1.0 : liq >= 1 / 7 ? 1.05 : 1.1;
    q = Math.max(start - 0.08, start - 0.02 * Math.floor(daysListed / 7));
    mode = "schedule";
  } else {
    // Learned: maximize expected discounted profit, profit × p/(p+δ), where δ is the return you could earn
    // by selling and re-investing (Settings: target return per month), rising as a listing goes stale.
    const delta = (s.monthlyReturnPct ?? 5) / 100 / 30 * (1 + daysListed / 30);
    let best = null;
    for (let x = 0.8; x <= 1.351; x += 0.01) {
      const price = market * x;
      if (price < floor || price > ceiling) continue;
      const p = pAt(x);
      const v = (price - fees(price) - cost) * (p / (p + delta));
      if (!best || v > best.v) best = { x, v };
    }
    q = best ? best.x : floor / market;
    mode = "model";
  }

  let target = clamp(market * q, floor, ceiling);
  let capped = false;
  if (current > 0) {
    const lo = current * (1 - s.maxMovePct / 100), hi = current * (1 + s.maxMovePct / 100);
    if (target < lo || target > hi) {
      target = clamp(target, lo, hi);
      capped = true;
    }
  }
  target = Math.max(target, floor); // the floor beats the daily move cap (e.g. cost went up after grading)
  const out = { q: target / market, floor, capped, clearance, mode, maxMovePct: s.maxMovePct };
  if (current > 0 && current >= floor && Math.abs(target - current) / current < 0.01) {
    return { ...out, price: current, q: current / market, p30: p30At(current / market), unchanged: true, capped: false };
  }
  const price = charmAbove(target, floor);
  return { ...out, price, q: price / market, p30: p30At(price / market) };
}

export function reasonText({ est, decision, current, daysListed }) {
  const bits = [];
  bits.push(`market $${est.market}${est.comps ? ` from ${est.comps} recent sale${est.comps > 1 ? "s" : ""}` : " from the price guide"}${est.lastSale ? ` (last sold $${est.lastSale.price} on ${est.lastSale.date})` : ""}`);
  if (est.trend1 != null && Math.abs(est.trend1) >= 1) bits.push(`1-month trend ${est.trend1 > 0 ? "+" : ""}${est.trend1}%`);
  bits.push(`~${est.liquidity >= 1 ? Math.round(est.liquidity) + "/day" : est.liquidity >= 1 / 7 ? Math.round(est.liquidity * 7) + "/week" : Math.max(1, Math.round(est.liquidity * 30)) + "/month"} selling`);
  if (daysListed) bits.push(`listed ${daysListed} day${daysListed > 1 ? "s" : ""}`);
  bits.push(decision.mode === "model"
    ? `learned model: ${Math.round(decision.p30 * 100)}% chance to sell within 30 days at ${decision.q.toFixed(2)}× market`
    : `starting schedule: ${decision.q.toFixed(2)}× market${daysListed >= 7 ? " after weekly markdowns" : ""}`);
  if (decision.capped) bits.push(`move capped to ±${decision.maxMovePct ?? DEFAULTS.maxMovePct}%/day`);
  if (decision.clearance) bits.push("clearance pricing (old listing)");
  if (current > 0 && decision.price < current) bits.unshift("price down");
  else if (current > 0 && decision.price > current) bits.unshift("price up");
  return bits.join(" · ");
}
