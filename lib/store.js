// Tiny JSON-file database in ./data — no install, works the same on Windows and Mac.
//   lookups.json  every card report the bot produced (newest first)
//   watchlist.json cards you are tracking, each with a price snapshot history
//   hot.json      cached "hottest cards" reports per category+period

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.join(here, "..", "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

function file(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export function load(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file(name), "utf8"));
  } catch {
    return fallback;
  }
}

export function save(name, value) {
  const tmp = file(name) + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file(name));
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---- lookups ----
export function addLookup(report) {
  const all = load("lookups", []);
  all.unshift(report);
  save("lookups", all.slice(0, 500));
  return report;
}

// ---- watchlist ----
export function watchlist() {
  return load("watchlist", []);
}

export function addToWatchlist(report) {
  const list = watchlist();
  const key = report.card?.search_query || report.card?.name;
  if (list.some((w) => w.key === key)) return list;
  list.push({
    id: newId(),
    key,
    card: report.card,
    category: report.card?.category,
    pricechartingUrl: report.pricing?.pricecharting_url || null,
    added: new Date().toISOString(),
    snapshots: [{ at: new Date().toISOString(), value: report.pricing?.estimated_value_usd ?? null }],
  });
  save("watchlist", list);
  return list;
}

export function removeFromWatchlist(id) {
  save("watchlist", watchlist().filter((w) => w.id !== id));
}

export function addSnapshot(id, value) {
  const list = watchlist();
  const w = list.find((x) => x.id === id);
  if (!w) return;
  w.snapshots.push({ at: new Date().toISOString(), value });
  save("watchlist", list);
}

// % change of each watched card over the last N days, from our own snapshots.
export function movers(days) {
  const cutoff = Date.now() - days * 86400000;
  return watchlist()
    .map((w) => {
      const pts = w.snapshots.filter((s) => s.value != null);
      if (pts.length < 2) return null;
      const last = pts[pts.length - 1];
      let base = pts[0];
      for (const p of pts) if (Date.parse(p.at) <= cutoff) base = p;
      if (base === last || !base.value) return null;
      return { id: w.id, name: w.card?.name, category: w.category, from: base.value, to: last.value, pct: Math.round(((last.value - base.value) / base.value) * 1000) / 10 };
    })
    .filter(Boolean)
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}
