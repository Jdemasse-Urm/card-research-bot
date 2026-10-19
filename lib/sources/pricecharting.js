// PriceCharting scraper. Sports cards live on its sister site SportsCardsPro.com (same page layout);
// Yu-Gi-Oh and One Piece live on PriceCharting.com. We search both and merge.
// Each card page lists the current value per grade AND the actual eBay completed sales behind it,
// plus a monthly price history — that is our "recent sold" source.

import * as cheerio from "cheerio";
import { getText } from "../http.js";

const SITES = ["https://www.sportscardspro.com", "https://www.pricecharting.com"];
const CARD_URL = /^https:\/\/www\.(pricecharting|sportscardspro)\.com\/game\//;

const money = (s) => {
  const n = parseFloat(String(s || "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const clean = (s) => String(s || "").replace(/\s+/g, " ").trim();

// chart_data keys line up with the six columns of the main price table, in this order.
const CHART_KEYS = ["used", "cib", "new", "graded", "boxonly", "manualonly"];
const TAB_KEYS = ["used", "cib", "new", "graded", "box-only", "manual-only"];

// PriceCharting also tracks video games, comics and Funko — card sets live under these slugs.
const CARD_PAGE = /\/game\/(?:[a-z]+-cards|yugioh|one-piece|pokemon|magic|digimon|dragon-ball|lorcana)[^/]*\//;

// kind: "sports" (SportsCardsPro only), "tcg" (PriceCharting only) or "any" (both).
export async function search(query, limit = 12, kind = "any") {
  const sites = kind === "sports" ? [SITES[0]] : kind === "tcg" ? [SITES[1]] : SITES;
  const settled = await Promise.allSettled(sites.map((base) => searchSite(base, query, limit)));
  const ok = settled.filter((s) => s.status === "fulfilled").map((s) => s.value);
  if (!ok.length) throw settled[0].reason;
  // Each site ranks its own way (and SportsCardsPro happily returns TCG junk), so re-rank the
  // merged list by how many query words appear in the card name + set; ties keep site order.
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9#-]+/g, " ");
  const words = norm(query).split(" ").filter((w) => w.length > 1 || /\d/.test(w));
  const merged = ok.flat().map((r, i) => {
    const hay = ` ${norm(r.name + " " + r.set)} `;
    const score = words.reduce((n, w) => n + (hay.includes(` ${w} `) || hay.includes(` #${w} `) ? 2 : hay.includes(w) ? 1 : 0), 0);
    return { r, score, i };
  });
  merged.sort((a, b) => b.score - a.score || a.i - b.i);
  return merged.slice(0, limit).map((x) => x.r);
}

async function searchSite(base, query, limit) {
  const url = `${base}/search-products?q=${encodeURIComponent(query)}&type=prices`;
  const { url: finalUrl, body } = await getText(url);

  // An exact single match redirects straight to the card page.
  if (finalUrl.includes("/game/")) {
    if (!CARD_PAGE.test(finalUrl)) return [];
    const $ = cheerio.load(body);
    return [{ name: clean($("#product_name").clone().children().remove().end().text()), set: clean($("#product_name a").first().text()), url: finalUrl }];
  }

  const $ = cheerio.load(body);
  const out = [];
  $("#games_table tbody tr").each((_, tr) => {
    if (out.length >= limit) return;
    const a = $(tr).find("td.title > a").first();
    const href = a.attr("href");
    if (!href || !CARD_PAGE.test(href)) return; // skip video games, magazines, Funko, comics
    out.push({
      name: clean(a.text()),
      set: clean($(tr).find(".console-in-title a").first().text()),
      url: href.startsWith("http") ? href : base + href,
      ungraded: clean($(tr).find("td.used_price, td.js-loose").first().text()) || null,
      mid: clean($(tr).find("td.cib_price").first().text()) || null,
      high: clean($(tr).find("td.new_price").first().text()) || null,
    });
  });
  return out;
}

function pctChange(series, monthsBack) {
  // series: [[ms, cents], ...] ascending; ignore zero (= no data) points
  const pts = series.filter((p) => p[1] > 0);
  if (pts.length < 2) return null;
  const last = pts[pts.length - 1];
  const target = last[0] - monthsBack * 30.4 * 86400000;
  let base = null;
  for (const p of pts) if (p[0] <= target) base = p;
  if (!base) return null;
  return Math.round(((last[1] - base[1]) / base[1]) * 1000) / 10;
}

export async function card(url, { salesPerGrade = 8, withHistory = false } = {}) {
  if (!CARD_URL.test(url)) {
    throw new Error("url must be a pricecharting.com or sportscardspro.com /game/... card page (get it from pricecharting_search)");
  }
  const { url: finalUrl, body } = await getText(url);
  const $ = cheerio.load(body);

  const title = clean($("#product_name").clone().children().remove().end().text());
  const set = clean($("#product_name a").first().text());
  const image = $("#product_details img, .cover img").first().attr("src") || null;

  // Column labels (Ungraded / Grade 7 / ... / PSA 10) — they differ a bit per category.
  const labels = [];
  $("#price_data thead").first().find("th").each((_, th) => labels.push(clean($(th).text())));

  // Full price guide: every grade + grading company the site tracks.
  const priceGuide = {};
  $("#full-prices table tr").each((_, tr) => {
    const tds = $(tr).find("td");
    if (tds.length >= 2) {
      const v = money($(tds[1]).text());
      if (v != null) priceGuide[clean($(tds[0]).text())] = v;
    }
  });

  // Sales volume per column ("3 sales per week").
  const volume = {};
  $("#price_data tr.sales_volume td[data-show-tab]").each((i, td) => {
    volume[labels[i] || $(td).attr("data-show-tab")] = clean($(td).find("a").text());
  });

  // Recent completed sales per column.
  const recentSales = {};
  TAB_KEYS.forEach((key, i) => {
    const rows = [];
    $(`div.completed-auctions-${key} table tbody tr`).each((_, tr) => {
      if (rows.length >= salesPerGrade) return;
      const date = clean($(tr).find("td.date").text());
      const price = money($(tr).find("td.numeric .js-price").first().text());
      if (!date || price == null) return;
      rows.push({
        date,
        price,
        title: clean($(tr).find("td.title a").first().text()),
        source: clean($(tr).find("td.title").text()).match(/\[([^\]]+)\]\s*$/)?.[1] || "eBay",
      });
    });
    if (rows.length) recentSales[labels[i] || key] = rows;
  });

  // Monthly history -> trend % (and, for charts, the last 3 years of month-end values in dollars).
  const trends = {};
  const history = {};
  const m = body.match(/VGPC\.chart_data\s*=\s*(\{[\s\S]*?\});/);
  if (m) {
    try {
      const chart = JSON.parse(m[1]);
      CHART_KEYS.forEach((k, i) => {
        if (!chart[k]) return;
        const t = { "1mo": pctChange(chart[k], 1), "3mo": pctChange(chart[k], 3), "6mo": pctChange(chart[k], 6), "12mo": pctChange(chart[k], 12) };
        if (Object.values(t).some((v) => v != null)) trends[labels[i] || k] = t;
        const pts = chart[k].filter((p) => p[1] > 0).slice(-36).map((p) => [p[0], p[1] / 100]);
        if (withHistory && pts.length >= 2) history[labels[i] || k] = pts;
      });
    } catch {
      /* chart format changed — trends just stay empty */
    }
  }

  return { source: finalUrl.includes("sportscardspro") ? "SportsCardsPro (eBay completed sales)" : "PriceCharting (eBay completed sales)", url: finalUrl, title, set, image, priceGuide, salesVolume: volume, recentSales, trendPct: trends, ...(withHistory ? { history } : {}) };
}

// ---------------- sets ("consoles") ----------------

const SET_URL = /^https:\/\/www\.(pricecharting|sportscardspro)\.com\/console\/[\w%'.-]+$/;

/** Find card sets matching a query, e.g. "2023 prizm basketball" -> [{ name, url }]. */
export async function findSets(query, kind = "any") {
  const sites = kind === "sports" ? [SITES[0]] : kind === "tcg" ? [SITES[1]] : SITES;
  const out = new Map();
  await Promise.allSettled(
    sites.map(async (base) => {
      const { body } = await getText(`${base}/search-products?q=${encodeURIComponent(query)}&type=prices`);
      const $ = cheerio.load(body);
      $("#games_table tbody tr .console-in-title a, #games_table tbody tr td.console a").each((_, a) => {
        const href = $(a).attr("href") || "";
        const url = href.startsWith("http") ? href : base + href;
        if (!/\/console\/[a-z]+-cards|\/console\/(yugioh|one-piece|pokemon)/.test(url)) return;
        if (!out.has(url)) out.set(url, { name: clean($(a).text()), url });
      });
    }),
  );
  // Sets whose name contains more of the query words first.
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const scored = [...out.values()]
    .map((s) => ({ ...s, score: words.filter((w) => s.name.toLowerCase().includes(w)).length }))
    .sort((a, b) => b.score - a.score);
  // Keep sets that match nearly as many query words as the best one (search results drag in unrelated sets).
  const best = scored[0]?.score || 0;
  return scored
    .filter((s) => s.score > 0 && s.score >= best - 1)
    .slice(0, 15)
    .map(({ name, url }) => ({ name, url }));
}

const SET_SORTS = new Set(["highest-price", "lowest-price", "popularity", "model-number", "name"]);

/** Every card in a set with current values; sort = highest-price | popularity | model-number | ... */
export async function setPage(url, { sort = "highest-price", rookiesOnly = false, includeSealed = false } = {}) {
  if (!SET_URL.test(url)) throw new Error("Not a set page URL (pick a set from the search results).");
  const params = new URLSearchParams({ sort: SET_SORTS.has(sort) ? sort : "highest-price" });
  if (rookiesOnly) params.set("rookies-only", "true");
  if (!includeSealed) params.set("exclude-hardware", "true"); // "hardware" = sealed boxes/packs on these sites
  const { url: finalUrl, body } = await getText(`${url}?${params}`);
  const $ = cheerio.load(body);
  const labels = [];
  $("#games_table thead th").each((_, th) => labels.push(clean($(th).text()).replace(/[▲▼]/g, "").trim()));
  const priceLabels = labels.filter((l) => /price|grade|psa|ungraded|loose/i.test(l)).slice(0, 3);
  const cards = [];
  $("#games_table tbody tr[id^=product-]").each((_, tr) => {
    const a = $(tr).find("td.title a").first();
    const href = a.attr("href");
    if (!href) return;
    const base = new URL(finalUrl).origin;
    cards.push({
      name: clean(a.text()),
      rookie: $(tr).find("td.title .rookie").length > 0,
      url: href.startsWith("http") ? href : base + href,
      prices: [money($(tr).find("td.used_price").text()), money($(tr).find("td.cib_price").text()), money($(tr).find("td.new_price").text())],
    });
  });
  return {
    title: clean($("h1").first().text()),
    url: finalUrl.split("?")[0],
    columns: priceLabels.length === 3 ? priceLabels : ["Ungraded", "Grade 9", "PSA 10"],
    cards,
  };
}

// ---------------- value at a grade ----------------

/** Current value for a grade label ("PSA 10", "BGS 9.5", "Raw", "9") from a card() result. */
export function valueAtGrade(data, gradeLabel) {
  const want = String(gradeLabel || "Raw").toUpperCase().replace(/\s+/g, " ").trim();
  const guide = Object.entries(data?.priceGuide || {});
  const find = (label) => guide.find(([k]) => k.toUpperCase() === label)?.[1];
  const num = want.match(/(\d+(\.\d)?)$/)?.[1];
  if (/RAW|UNGRADED/.test(want) || !num) return find("UNGRADED") ?? null;
  return find(want) ?? find(`PSA ${num}`) ?? find(`GRADE ${num}`) ?? null;
}

/** Average month-end value over the last 12 months for that grade (needs withHistory). */
export function yearAverage(data, gradeLabel) {
  const want = String(gradeLabel || "Raw").toUpperCase();
  const num = want.match(/(\d+(\.\d)?)$/)?.[1];
  const keys = Object.keys(data?.history || {});
  const key = /RAW|UNGRADED/.test(want) || !num
    ? keys.find((k) => /^ungraded$/i.test(k))
    : keys.find((k) => k.toUpperCase() === want) ||
      // history only has generic columns (Grade 7-9.5, PSA 10); don't use PSA 10's line for an SGC/BGS 10
      (num === "10" ? (/^(PSA )?10$/.test(want) ? keys.find((k) => k.toUpperCase() === "PSA 10") : null) : keys.find((k) => k.toUpperCase() === `GRADE ${num}`));
  const pts = key ? data.history[key].slice(-12) : [];
  return pts.length >= 6 ? Math.round((pts.reduce((n, p) => n + p[1], 0) / pts.length) * 100) / 100 : null;
}
