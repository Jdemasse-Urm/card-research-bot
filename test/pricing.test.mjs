// Offline tests of the MJC pricing engine (guardrails, cold-start schedule, and that the model learns).
import { test } from "node:test";
import assert from "node:assert/strict";
import * as pr from "../lib/pricing.js";

const model0 = { beta: pr.PRIOR, n: 0, sales: 0 };
const base = { market: 100, liq: 0.2 };

test("never below cost + margin + fees", () => {
  const d = pr.choosePrice({ ...base, cost: 95 }, model0);
  assert.ok(d.price >= 95 * 1.1 + 95 * 0.029 + 0.3 - 0.01, `got ${d.price}`);
});

test("daily move is capped", () => {
  const d = pr.choosePrice({ ...base, current: 150 }, model0);
  assert.ok(d.capped && d.price >= 150 * 0.95 - 0.01);
});

test("tiny moves are skipped (no price churn)", () => {
  const first = pr.choosePrice({ ...base }, model0);
  assert.ok(pr.choosePrice({ ...base, current: first.price }, model0).unchanged);
});

test("a price below the floor jumps to the floor despite the move cap", () => {
  assert.ok(pr.choosePrice({ ...base, cost: 95, current: 90 }, model0).price >= 107);
});

test("clearance after the clearance age lowers the floor", () => {
  const fresh = pr.choosePrice({ ...base, cost: 95 }, model0).price;
  const old = pr.choosePrice({ ...base, cost: 95, daysListed: 80 }, model0);
  assert.ok(old.clearance && old.price < fresh);
});

test("charm rounding never lands under the floor", () => {
  assert.equal(pr.charm(487.3), 486.99);
  const d = pr.choosePrice({ market: 100, liq: 2, daysListed: 200 }, model0); // floor = 85
  assert.ok(d.price >= d.floor);
});

test("cold start: slow movers start at a premium and mark down weekly", () => {
  const s0 = pr.choosePrice({ market: 100, liq: 0.05 }, model0);
  const s21 = pr.choosePrice({ market: 100, liq: 0.05, daysListed: 21 }, model0);
  assert.equal(s0.mode, "schedule");
  assert.ok(s0.price >= 109 && s21.price < s0.price);
});

test("market estimate: weighted median of recent comps, outliers dropped", () => {
  const today = new Date().toISOString().slice(0, 10);
  const data = { recentSales: { "PSA 10": [100, 102, 98, 101, 99, 5000].map((p) => ({ date: today, price: p })) }, trendPct: {}, salesVolume: { "PSA 10": "2 sales per week" } };
  const est = pr.marketEstimate(data, "PSA 10", 100);
  assert.ok(est.comps === 5 && est.market > 95 && est.market < 105, JSON.stringify(est));
  assert.ok(Math.abs(est.liquidity - 2 / 7) < 1e-9);
});

test("the model learns price sensitivity from the shop's own sales", () => {
  let x = 7;
  const rnd = () => ((x = (x * 16807) % 2147483647) / 2147483647);
  const sim = (b) => {
    const obs = [];
    for (let i = 0; i < 20000; i++) {
      const ratio = 0.85 + rnd() * 0.45, liq = 0.05 + rnd() * 1.5, market = 20 + rnd() * 800;
      obs.push({ ratio, liq, market, y: rnd() < pr.pSellPerDay([-3.6, b, 0.8, -0.1], ratio, liq, market) ? 1 : 0 });
    }
    return pr.trainModel(obs);
  };
  const sensitive = sim(-24), relaxed = sim(-5);
  assert.ok(sensitive.beta[1] < -18, `learned ${sensitive.beta[1]}`);
  assert.ok(pr.choosePrice({ market: 100, liq: 0.5 }, sensitive).q < pr.choosePrice({ market: 100, liq: 0.5 }, relaxed).q);
});
