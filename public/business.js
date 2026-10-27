// Card Research Bot — the business side: Home dashboard, inventory (stock / grading / sales / expenses).
// Uses helpers from app.js ($, esc, usd, getJSON, json, toast, openModal, removeWithUndo, ...).
"use strict";

const STATUS_LABEL = { in_stock: "In stock", listed: "Listed", grading: "At grading", sold: "Sold" };
window.STATUS_LABEL = STATUS_LABEL;
const SELL_PLATFORMS = ["eBay", "TCGplayer", "Whatnot", "Facebook", "MJC site", "Card show", "Local / cash", "Other"];
const webPrice = (r) => (r.webMode === "fixed" ? r.webFixedPrice : r.webPrice);
const EXPENSE_KINDS = ["Supplies", "Shipping", "Grading", "Card show / table", "Fees", "Travel", "Software", "Other"];
const COMPANIES = ["PSA", "BGS", "SGC", "CGC", "TAG", "Other"];
const today = () => new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time (toISOString is UTC: tomorrow after 8 PM ET)
const opts = (list, sel) => list.map((x) => `<option${x === sel ? " selected" : ""}>${esc(x)}</option>`).join("");

// ------------------------------------------------------------------ small line chart (portfolio)

function lineChart(points, { valueKey = "value", costKey = "cost", label = "Portfolio value" } = {}) {
  if (!points || points.length < 2) return `<p class="muted small">The value chart appears after a couple of days of daily snapshots.</p>`;
  const W = 640, H = 180, L = 64, R = 10, T = 10, B = 24;
  const ts = points.map((p) => Date.parse(p.date + "T12:00:00"));
  const vals = points.flatMap((p) => [p[valueKey], p[costKey]]).filter((v) => v != null);
  const lo = Math.min(...vals) * 0.95, hi = Math.max(...vals) * 1.05 || 1;
  const X = (t) => L + ((t - ts[0]) / Math.max(1, ts[ts.length - 1] - ts[0])) * (W - L - R);
  const Y = (v) => T + (1 - (v - lo) / Math.max(1, hi - lo)) * (H - T - B);
  const line = (k) => points.map((p, i) => `${X(ts[i]).toFixed(1)},${Y(p[k]).toFixed(1)}`).join(" ");
  const ticks = [lo, (lo + hi) / 2, hi];
  return `<figure style="margin:0"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} over time">
    ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${usd(v)}</text>`).join("")}
    <text x="${L}" y="${H - 6}">${esc(day(points[0].date))}</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(day(points[points.length - 1].date))}</text>
    <polyline fill="none" stroke="#9a9aa2" stroke-width="1.6" stroke-dasharray="4 4" points="${line(costKey)}"/>
    <polyline fill="none" stroke="#1f8a70" stroke-width="2.4" points="${line(valueKey)}"/>
  </svg><figcaption class="chart-legend"><span style="--c:#1f8a70">Value</span><span style="--c:#9a9aa2">What you paid</span></figcaption></figure>`;
}

// ------------------------------------------------------------------ HOME dashboard

async function loadDashboard() {
  const [d, att, adv] = await Promise.all([getJSON("/api/dashboard"), getJSON("/api/attention").catch(() => null), getJSON("/api/advice").catch(() => null)]);
  const p = d.portfolio;
  const unreal = p.value - p.cost;
  const steps = [
    ["Add your free Gemini key", status.hasKey, () => openSettings()],
    ["Run the self-test", store.get("selftestDone"), () => { openSettings(); setTimeout(() => $("#selftestBtn")?.scrollIntoView(), 300); }],
    ["Research your first card", d.recent.length > 0, () => goTab("lookup")],
    ["Add a card to inventory", p.cards > 0, () => openItemEditor()],
  ];
  const welcome = !store.get("welcomeDone") && steps.some(([, done]) => !done)
    ? `<div class="panel welcome"><div class="row space" style="margin:0"><h2 style="margin:0">Welcome 👋 — four steps to get going</h2><button class="ghost small" id="welcomeDismiss">Hide</button></div>
       <ol class="steps">${steps.map(([t, done], i) => `<li class="${done ? "done" : ""}"><button class="ghost" data-step="${i}">${done ? "✓" : i + 1 + "."} ${esc(t)}</button></li>`).join("")}</ol></div>` : "";
  // Backups: warn when the daily copy hasn't happened, the cloud copy is failing, or there's no off-computer copy yet.
  const bk = d.backup || {};
  const bkAge = bk.lastLocal ? (Date.now() - Date.parse(bk.lastLocal)) / 86400000 : Infinity;
  const backupRow = bkAge > 3 ? `<div class="att-row"><span class="chip bad">Backup</span><span>No backup in ${bkAge === Infinity ? "a while" : Math.floor(bkAge) + " days"} — the bot backs up once a day while it's open.</span><button class="small" data-backupnow>Back up now</button></div>`
    : bk.mirror && bk.mirrorError ? `<div class="att-row"><span class="chip bad">Backup</span><span>Couldn't copy today's backup to your cloud folder (${esc(bk.mirrorError)}).</span><button class="small" data-backupset>Fix</button></div>`
    : !bk.mirror ? `<div class="att-row"><span class="chip">Backup</span><span>Your backups are only on this computer. Keep a copy in OneDrive, iCloud Drive, Dropbox or Google Drive so a dead computer can't take your records.</span><button class="small" data-backupset>Set up</button></div>` : "";
  const attention = att && (att.items.length || att.unpriced || att.staleValues || backupRow)
    ? `<div class="panel"><h3 style="margin-top:0">Needs attention</h3>
       ${att.items.slice(0, 8).map((it) => `<div class="att-row"><span class="chip ${it.type === "value_drop" ? "bad" : "warn"}">${esc({ stale_listing: "Stale listing", unlisted_long: "Not listed", value_drop: "Value drop" }[it.type])}</span><span><b>${esc(it.name)}</b> <span class="muted small">${esc(it.grade)}</span><div class="small">${esc(it.text)}</div></span>${it.suggested ? `<button class="small" data-drop="${esc(it.id)}" data-price="${it.suggested}">Set ${usd(it.suggested)}</button>` : ""}</div>`).join("")}
       ${att.unpriced ? `<div class="att-row"><span class="chip">Unpriced</span><span>${att.unpriced} card${att.unpriced > 1 ? "s" : ""} without a sales page — they never get valued.</span><button class="small" data-findprices>Find prices</button></div>` : ""}
       ${att.staleValues ? `<div class="att-row"><span class="chip">Stale</span><span>${att.staleValues} value${att.staleValues > 1 ? "s" : ""} older than a week.</span><button class="small" data-revalue>Re-value</button></div>` : ""}
       ${backupRow}
     </div>` : "";
  const w = d.week || {};
  const moversRow = (m) => `<tr><td class="small">${esc(m.name)} <span class="muted">${esc(m.grade)}</span></td><td class="num">${usd(m.to)}</td><td class="num ${m.dollars >= 0 ? "pos" : "neg"}">${pct(m.pct)}</td></tr>`;
  $("#dash").innerHTML = welcome + attention + `
    <div class="totals">
      <div><span>Inventory value</span><b>${usd(p.value)}</b><span>${p.cards} cards · paid ${usd(p.cost)}</span></div>
      <div><span>Unrealized profit</span><b class="${unreal >= 0 ? "pos" : "neg"}">${usd(unreal)}</b><span>${p.change30 != null ? `30-day change ${usd(p.change30)}` : "&nbsp;"}</span></div>
      <div><span>Sold this month</span><b>${usd(d.month.revenue)}</b><span>${d.month.sales} cards · profit <span class="${d.month.profit >= 0 ? "pos" : "neg"}">${usd(d.month.profit)}</span></span></div>
      <div><span>In progress</span><b>${d.status.listed} listed</b><span>${d.status.grading} at grading · ${d.status.submissionsOpen} open submissions</span></div>
    </div>
    <div class="dash-grid">
      <div class="panel week">
        <div class="row space" style="margin:0"><h3 style="margin:0">This week</h3><button class="small" data-weekly title="Last week's numbers and what needs doing — print it or email it">📋 Weekly report</button></div>
        <div class="week-grid">
          <div><b>${w.sales || 0}</b><span>cards sold</span></div>
          <div><b>${usd(w.revenue || 0)}</b><span>sales</span></div>
          <div><b class="${(w.profit || 0) >= 0 ? "pos" : "neg"}">${usd(w.profit || 0)}</b><span>profit after fees</span></div>
          <div><b>${w.added || 0}</b><span>cards added</span></div>
        </div>
        ${w.best ? `<p class="small">Best flip: <b>${esc(w.best.name)}</b> ${esc(w.best.grade || "")} — <span class="pos">${usd(w.best.profit)}</span>${w.best.soldOn ? ` on ${esc(w.best.soldOn)}` : ""}</p>` : ""}
        ${w.website ? `<p class="small">Website: ${w.website.visits != null ? `<b>${w.website.visits}</b> visit${w.website.visits === 1 ? "" : "s"} · ` : ""}<b>${w.website.orders}</b> order${w.website.orders === 1 ? "" : "s"} · <b>${w.website.offers}</b> offer${w.website.offers === 1 ? "" : "s"} · <b>${w.website.messages}</b> message${w.website.messages === 1 ? "" : "s"}${w.website.subscribers ? ` · <b>${w.website.subscribers}</b> on the email list` : ""} <button class="ghost small" data-mjc>Open →</button></p>` : ""}
        ${w.expenses ? `<p class="small muted">Expenses this week: ${usd(w.expenses)}</p>` : ""}
      </div>
      <div class="panel">
        <div class="row space" style="margin:0"><h3 style="margin:0">Portfolio value</h3><button class="ghost small" data-go="inventory">Inventory →</button></div>
        ${lineChart(p.history)}
      </div>
      <div class="panel">
        <h3 style="margin-top:0">Quick actions</h3>
        <div class="quick-actions">
          <button data-go="lookup" class="primary">📷 Research a card</button>
          <button data-lot>📚 Value a lot</button>
          <button data-go="hot">🔥 Hottest cards</button>
          <button data-go="sets">📖 Browse a set</button>
          <button data-addinv>＋ Add inventory</button>
          <button data-expense>🧾 Log an expense</button>
        </div>
        ${d.alerts.length ? `<h3>Alerts</h3>${d.alerts.map((a) => `<div class="small">${a.kind === "brief" ? "☀️ " + esc(a.text) : a.text ? `${{ order: "🛒", ticket: "✉", pricing: "📈" }[a.kind] || "🔔"} <b>${esc(a.name)}</b>: ${esc(a.text)}` : `🔔 ${esc(a.name)} → ${usd(a.value)} (target ${usd(a.target)})`}</div>`).join("")}<button class="ghost small" data-go="watch" style="margin-top:.4rem">See all alerts →</button>` : ""}
      </div>
      <div class="panel">
        <div class="row space" style="margin:0"><h3 style="margin:0">${d.hot ? `Hottest ${d.hot.period === "daily" ? "today" : "this week"}` : "Hottest cards"}</h3><button class="ghost small" data-go="hot">More →</button></div>
        ${d.hot ? `<p class="small muted">${esc(d.hot.market_summary || "")}</p><ol class="tight small">${d.hot.cards.map((c) => `<li><b>${esc(c.name)}</b> — ${esc(c.price_change)}</li>`).join("")}</ol><div class="small muted">Updated ${esc(when(d.hot.at))}</div>`
          : `<p class="small muted">No scan yet. Open <b>Hottest</b> and run one — or turn on the <b>morning brief</b> in Settings.</p>`}
      </div>
      <div class="panel">
        <div class="row space" style="margin:0"><h3 style="margin:0">Inventory plan</h3><button class="ghost small" data-go="ask">${adv ? "Refresh →" : "Get advice →"}</button></div>
        ${adv ? `<div class="small muted">${esc(when(adv.at))}</div><div data-advice></div>` : `<p class="small muted">Ask the AI what to sell, hold, list, grade or re-price — based on what you actually own.</p>`}
      </div>
      <div class="panel">
        <h3 style="margin-top:0">Your cards: biggest moves (7 days)</h3>
        ${(d.stockMovers?.up.length || d.stockMovers?.down.length) ? `<table>${[...d.stockMovers.up, ...d.stockMovers.down].map(moversRow).join("")}</table>`
          : `<p class="small muted">Shows once your cards have been re-valued for a few days (it happens daily for cards with a sales page).</p>`}
      </div>
      <div class="panel">
        <h3 style="margin-top:0">Watchlist movers (7 days)</h3>
        ${d.movers.length ? `<table>${d.movers.map((m) => `<tr><td class="small">${esc(m.name)}</td><td class="num">${usd(m.to)}</td><td class="num">${pct(m.pct)}</td></tr>`).join("")}</table>` : `<p class="small muted">Nothing moving yet — add cards to the watchlist.</p>`}
      </div>
      <div class="panel">
        <h3 style="margin-top:0">Recent lookups</h3>
        ${d.recent.length ? d.recent.map((r) => `<div class="mini-row" data-open="${esc(r.id)}" role="button" tabindex="0">${r.thumb ? `<img src="${esc(r.thumb)}" alt="">` : ""}<span>${esc(r.name)}</span><b>${usd(r.value)}</b></div>`).join("") : `<p class="small muted">No lookups yet.</p>`}
      </div>
      <div class="panel">
        <h3 style="margin-top:0">Activity</h3>
        ${d.activity.length ? `<ul class="tight small activity">${d.activity.map((a) => `<li><b>${esc(a.who)}</b> ${esc(a.text)} <span class="muted">· ${esc(when(a.at))}</span></li>`).join("")}</ul>` : `<p class="small muted">Nothing yet.</p>`}
      </div>
    </div>`;
  $$("#dash [data-go]").forEach((b) => (b.onclick = () => goTab(b.dataset.go)));
  if ($("#dash [data-weekly]")) $("#dash [data-weekly]").onclick = openWeeklyReport;
  if (adv && $("#dash [data-advice]")) renderAdvice(adv, $("#dash [data-advice]"), { compact: true });
  if ($("#welcomeDismiss")) $("#welcomeDismiss").onclick = () => { store.set("welcomeDone", true); loadDashboard(); };
  $$("#dash [data-step]").forEach((b) => (b.onclick = () => steps[+b.dataset.step][2]()));
  $$("#dash [data-drop]").forEach((b) => (b.onclick = async () => { await fetch("/api/inventory/" + b.dataset.drop, json("PATCH", { listPrice: b.dataset.price })); toast(`List price set to ${usd(+b.dataset.price)} — update it on the marketplace too`); loadDashboard(); }));
  if ($("#dash [data-findprices]")) $("#dash [data-findprices]").onclick = () => findPricesBulk(loadDashboard);
  if ($("#dash [data-revalue]")) $("#dash [data-revalue]").onclick = async (e) => { e.target.disabled = true; await fetch("/api/inventory/refresh", { method: "POST" }); toast("Values refreshed"); loadDashboard(); };
  $("#dash [data-lot]").onclick = () => { goTab("lookup"); $('#lookupMode [data-v="lot"]').click(); };
  if ($("#dash [data-mjc]")) $("#dash [data-mjc]").onclick = () => { invView = "mjc"; goTab("inventory"); };
  if ($("#dash [data-backupnow]")) $("#dash [data-backupnow]").onclick = async (e) => { e.target.disabled = true; const r = await fetch("/api/backup/now", { method: "POST" }); toast(r.ok ? "Backed up ✓" : "Backup failed — see Settings", { error: !r.ok }); loadDashboard(); };
  if ($("#dash [data-backupset]")) $("#dash [data-backupset]").onclick = () => { openSettings(); setTimeout(() => $("#backupBlock")?.scrollIntoView({ block: "center" }), 300); };
  $("#dash [data-addinv]").onclick = () => { invView = "stock"; goTab("inventory"); setTimeout(() => openItemEditor(), 50); };
  $("#dash [data-expense]").onclick = () => { invView = "expenses"; goTab("inventory"); };
  $$("#dash [data-open]").forEach((el) => {
    const open = async () => { const list = await getJSON("/api/lookups"); const r = list.find((x) => x.id === el.dataset.open); if (r) { goTab("lookup"); renderReport(r, $("#lookupResult")); } };
    el.onclick = open;
    el.onkeydown = (e) => e.key === "Enter" && open();
  });
}
TAB_LOADERS.home = loadDashboard;

// ------------------------------------------------------------------ INVENTORY shell

let invView = "stock";
pillGroup("#invView", (v) => { invView = v; loadInventory(); });
function syncInvPills() {
  $$("#invView button").forEach((x) => { x.classList.toggle("active", x.dataset.v === invView); x.setAttribute("aria-pressed", x.dataset.v === invView); });
}
async function loadInventory() {
  syncInvPills();
  if (invView === "stock") return loadStock();
  if (invView === "scan") return loadScan();
  if (invView === "locations") return loadLocations();
  if (invView === "grading") return loadGrading();
  if (invView === "sales") return loadSales();
  if (invView === "expenses") return loadExpenses();
  if (invView === "want") return loadWant();
  if (invView === "mjc") return loadMjc();
  if (invView === "show") return loadShow();
}
TAB_LOADERS.inventory = loadInventory;

// ------------------------------------------------------------------ STOCK

let invRows = [];
// Filters are remembered on this computer (never the search box); a fresh install starts on "active".
const invFilter = { status: "active", category: "", sort: "added", location: "", group: "", quick: "", ...store.get("invFilter", {}), q: "" };
let invDense = store.get("invDense", false);
const invSel = new Set(); // selected card ids — kept across redraws, filters and "Show more"
let invViews = []; // named views anyone using this bot saved
// Big inventories stay fast: draw this many rows, then "Show more".
const PAGE = 150;
let invLimit = PAGE;
const NO_LOC = " none"; // the "No location" filter value (a real location can't start with a space)
const SERIOUS = ["dupSku", "dupCard", "webSold", "soldNoPrice"];
const ageDays = (iso) => (iso ? (Date.now() - Date.parse(iso)) / 86400000 : Infinity);
const searchText = (r) => (r._s ??= [r.name, r.sku, r.location, r.grade, (r.tags || []).join(" "), r.notes, r.upc, r.facts?.team, r.condition?.scale && `cond:${r.condition.scale}`].join(" ").toLowerCase());
const byNumber = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
// One-click views for the jobs that come up every week.
const QUICK = {
  unpriced: ["💲 No sales page", (r) => r.status !== "sold" && !r.priceUrl],
  stale: ["⏳ Value over a week old", (r) => r.status !== "sold" && r.priceUrl && ageDays(r.valuedAt) > 7],
  web: ["🌐 On the website", (r) => r.web && r.status !== "sold"],
  aged: ["🐢 Listed 30+ days", (r) => r.status === "listed" && ageDays(r.listedAt || r.added) > 30],
  noloc: ["📍 No location", (r) => r.status !== "sold" && !r.location],
  uncounted: ["🔢 Never counted", (r) => r.status !== "sold" && !r.countedAt],
  nophoto: ["📷 No photo", (r) => r.status !== "sold" && !(r.photos || []).length],
  sealed: ["📦 Sealed", (r) => r.status !== "sold" && r.kind === "sealed"],
  nocond: ["🔍 Raw, no condition", (r) => r.status !== "sold" && r.kind !== "sealed" && /^raw$/i.test(r.grade) && !r.condition?.scale],
};
const GROUPS = { "": "No grouping", location: "Group by location", category: "Group by category", status: "Group by status", grade: "Group by grade" };
const groupLabel = (g, r) => (g === "location" ? (r.location ? "📍 " + r.location : "📍 No location") : g === "category" ? CAT_LABEL[r.category] || r.category : g === "status" ? STATUS_LABEL[r.status] : r.grade);
const saveFilter = () => { const { q, ...keep } = invFilter; store.set("invFilter", keep); };

async function loadStock() {
  $("#invActions").innerHTML = `
    <button data-a="add" title="Shortcut: N">＋ Add card</button>
    <button data-a="scan" title="Scan a stack or binder pages — every card found, cut out and priced">📥 Bulk scan</button>
    <button data-a="import">⬆ Import CSV</button>
    <button data-a="revalue">↻ Re-value</button>
    <button data-a="findprices" title="Link unpriced cards to their sales pages so they get valued">💲 Find prices</button>
    <button data-a="labels" title="Labels for the selected cards, or every unsold card in this view">🏷 Print labels</button>
    <button data-a="check" title="Duplicate SKUs, the same card on two rows, sold cards still on the website…">🩺 Data check <span data-checkn></span></button>
    <button data-a="csv" title="The selected cards, or the cards in this view, as a spreadsheet">⬇ CSV</button>`;
  $("#invActions [data-a=add]").onclick = () => openItemEditor();
  $("#invActions [data-a=scan]").onclick = () => { invView = "scan"; loadInventory(); };
  $("#invActions [data-a=import]").onclick = openImport;
  $("#invActions [data-a=labels]").onclick = () => printLabels(invSel.size ? [...invSel] : stockMatches().filter((r) => r.status !== "sold").map((r) => r.id));
  $("#invActions [data-a=findprices]").onclick = () => findPricesBulk(loadStock);
  $("#invActions [data-a=check]").onclick = openDataCheck;
  $("#invActions [data-a=csv]").onclick = () => exportRows(invSel.size ? invRows.filter((r) => invSel.has(r.id)) : stockMatches());
  $("#invActions [data-a=revalue]").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Re-valuing…";
    const r = await (await fetch("/api/inventory/refresh", { method: "POST" })).json();
    toast(`Updated ${r.updated} values from recent sales`);
    loadStock();
  };
  [invRows, invViews] = await Promise.all([getJSON("/api/inventory"), getJSON("/api/inventory/views").catch(() => [])]);
  const live = new Set(invRows.map((r) => r.id));
  for (const id of invSel) if (!live.has(id)) invSel.delete(id);
  drawStock();
  // the badge: problems that make the numbers or the website wrong (the full list is one click away)
  getJSON("/api/inventory/check").then((c) => {
    const n = c.issues.filter((i) => SERIOUS.includes(i.type)).reduce((k, i) => k + i.count, 0);
    const el = $("#invActions [data-checkn]");
    if (el && n) el.outerHTML = `<span class="chip warn" data-checkn>${n}</span>`;
  }).catch(() => {});
}

function stockMatches() {
  const q = invFilter.q.toLowerCase().trim();
  const quick = QUICK[invFilter.quick]?.[1];
  return invRows.filter((r) =>
    (invFilter.status === "all" || (invFilter.status === "active" ? r.status !== "sold" : r.status === invFilter.status)) &&
    (!invFilter.category || r.category === invFilter.category) &&
    (!invFilter.location || (invFilter.location === NO_LOC ? !r.location : r.location === invFilter.location)) &&
    (!quick || quick(r)) &&
    (!q || searchText(r).includes(q)));
}

function drawStock() {
  const stock = invRows.filter((r) => r.status !== "sold");
  const sum = (arr, f) => arr.reduce((n, r) => n + (f(r) || 0), 0);
  const cost = sum(stock, (r) => r.cost * r.qty);
  const value = sum(stock, (r) => (r.value ?? r.cost) * r.qty);
  const cats = [...new Set(invRows.map((r) => r.category))].sort();
  const locs = [...new Set(stock.map((r) => r.location).filter(Boolean))].sort(byNumber);
  const sorters = {
    added: (a, b) => (a.added < b.added ? 1 : -1),
    name: (a, b) => a.name.localeCompare(b.name),
    value: (a, b) => (b.value ?? 0) * b.qty - (a.value ?? 0) * a.qty,
    profit: (a, b) => ((b.value ?? b.cost) - b.cost) * b.qty - ((a.value ?? a.cost) - a.cost) * a.qty,
    trend: (a, b) => (b.trend30 ?? -9) - (a.trend30 ?? -9),
    sku: (a, b) => byNumber(a.sku, b.sku),
    location: (a, b) => byNumber(a.location || "~", b.location || "~"),
  };
  let rows = stockMatches().sort(sorters[invFilter.sort] || sorters.added);
  const g = invFilter.group;
  const gstats = new Map();
  if (g) {
    rows.sort((a, b) => byNumber(groupLabel(g, a), groupLabel(g, b))); // stable: keeps the chosen order inside each group
    for (const r of rows) {
      const k = groupLabel(g, r), s = gstats.get(k) || { rows: 0, qty: 0, value: 0 };
      s.rows++; s.qty += r.qty; s.value += (r.status === "sold" ? r.soldPrice ?? 0 : r.value ?? r.cost) * r.qty;
      gstats.set(k, s);
    }
  }
  const total = rows.length;
  const shown = rows.slice(0, invLimit);
  const quickCount = Object.fromEntries(Object.entries(QUICK).map(([k, [, f]]) => [k, invRows.reduce((n, r) => n + (f(r) ? 1 : 0), 0)]));
  let lastG = null;
  const rowHtml = (r) => {
    const pl = r.status === "sold" ? (r.soldPrice != null ? (r.soldPrice - r.cost) * r.qty : null) : r.value != null ? (r.value - r.cost) * r.qty : null;
    const trend = r.trend30 != null && Math.abs(r.trend30) >= 0.05 ? ` <span class="small ${r.trend30 > 0 ? "pos" : "neg"}" title="Value change, last 30 days">${r.trend30 > 0 ? "▲" : "▼"}${Math.round(Math.abs(r.trend30) * 100)}%</span>` : "";
    return `<tr data-id="${esc(r.id)}" class="${r.status === "sold" ? "sold" : ""}${invSel.has(r.id) ? " picked" : ""}">
      <td><input type="checkbox" data-sel aria-label="Select ${esc(r.name)}"${invSel.has(r.id) ? " checked" : ""}></td>
      <td><b>${esc(r.name)}</b>${r.kind === "sealed" ? ` <span class="chip">📦 ${esc(r.sealedType || "sealed")}</span>` : r.condition?.scale && /^raw$/i.test(r.grade) ? ` <span class="chip" title="${esc(status.conditions?.[r.condition.scale] || "")}">${esc(r.condition.scale)}</span>` : ""}<div class="small muted">${esc(r.sku || "")}${r.location ? " · 📍" + esc(r.location) : ""}${(r.tags || []).length ? " · " + r.tags.map((t) => "#" + esc(t)).join(" ") : ""}${r.priceUrl ? " · " + link(r.priceUrl, "sales") : ""}${r.addedBy ? " · " + esc(r.addedBy) : ""}</div></td>
      <td class="small">${esc(r.grade)}</td><td class="num">${esc(r.qty)}</td>
      <td class="num">${usd(r.cost)}</td>
      <td class="num">${r.status === "sold" ? `sold ${usd(r.soldPrice)}` : r.priceUrl ? usd(r.value) + (r.spark ? sparkline(r.spark) : "") + trend : `<button class="small" data-findprice title="Link to a sales page so this card gets valued">💲 Find price</button>`}<div class="small muted">${r.status === "sold" ? esc(r.soldOn || "") : r.priceUrl ? `${esc(when(r.valuedAt))}${!r.valuedAt || Date.now() - Date.parse(r.valuedAt) > 7 * 86400000 ? ` <span class="chip warn" title="Older than a week">stale</span> <button class="ghost small" data-revalue aria-label="Re-value now">↻</button>` : ""}` : ""}</div></td>
      <td class="num ${pl == null ? "" : pl >= 0 ? "pos" : "neg"}">${usd(pl)}</td>
      <td><span class="chip st-${r.status}">${esc(STATUS_LABEL[r.status])}</span>${r.status === "listed" && r.listedOn ? `<div class="small muted">${esc(r.listedOn)} ${usd(r.listPrice)}</div>` : ""}${r.web && r.status !== "sold" ? `<div><span class="chip st-web" title="${esc(r.webPricingNote || r.lastPriceReason || "On the MJC website")}">🌐 ${webPrice(r) ? usd(webPrice(r)) : "needs price"}</span></div>` : ""}</td>
      <td class="actions nowrap">${r.kind === "sealed" && r.status !== "sold" ? `<button class="small" data-open title="Opened one: its cost goes to the cards that came out">📦 Opened</button>` : ""}${r.status !== "sold" ? `<button class="small" data-sell>Sold</button>` : ""}<button class="small ghost" data-edit aria-label="Edit">✎</button><button class="small ghost" data-del aria-label="Remove">🗑</button></td></tr>`;
  };
  const body = shown.map((r) => {
    let head = "";
    if (g && groupLabel(g, r) !== lastG) {
      lastG = groupLabel(g, r);
      const s = gstats.get(lastG);
      head = `<tr class="grp"><td colspan="9"><b>${esc(lastG)}</b> <span class="small muted">${plural(s.rows, "row")} · ${plural(s.qty, "card")} · ${usd(s.value)}</span> <button class="ghost small" data-gsel="${esc(lastG)}">Select these</button></td></tr>`;
    }
    return head + rowHtml(r);
  }).join("");

  $("#invBody").innerHTML = `
    ${invRows.length ? `<div class="totals">
      <div><span>Cards in stock</span><b>${sum(stock, (r) => r.qty)}</b></div>
      <div><span>Total cost</span><b>${usd(cost)}</b></div>
      <div><span>Value today</span><b>${usd(value)}</b></div>
      <div><span>Unrealized profit</span><b class="${value - cost >= 0 ? "pos" : "neg"}">${usd(value - cost)}</b></div>
    </div>
    <div class="row views" role="group" aria-label="Quick views">
      ${Object.entries(QUICK).filter(([k]) => quickCount[k] || invFilter.quick === k).map(([k, [label]]) => `<button class="small${invFilter.quick === k ? " active" : ""}" data-quick="${k}" aria-pressed="${invFilter.quick === k}">${label} <span class="muted">${quickCount[k]}</span></button>`).join("")}
      ${invViews.map((v, i) => `<span class="saved-view"><button class="small" data-view="${i}">★ ${esc(v.name)}</button><button class="ghost small" data-unview="${i}" aria-label="Delete the view ${esc(v.name)}">×</button></span>`).join("")}
      <button class="ghost small" data-saveview title="Keep these filters under a name (every computer sees it)">☆ Save this view</button>
    </div>` : ""}
    <div class="panel filters">
      <input type="search" data-f="q" placeholder="Search name, SKU, location, tag…" value="${esc(invFilter.q)}" aria-label="Search inventory">
      <select data-f="status" aria-label="Status">${[["active", "In stock + listed + grading"], ["in_stock", "In stock"], ["listed", "Listed"], ["grading", "At grading"], ["sold", "Sold"], ["all", "Everything"]].map(([v, l]) => `<option value="${v}"${invFilter.status === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      <select data-f="category" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c)}"${invFilter.category === c ? " selected" : ""}>${esc(CAT_LABEL[c] || c)}</option>`).join("")}</select>
      <select data-f="location" aria-label="Location"><option value="">All locations</option><option value="${NO_LOC}"${invFilter.location === NO_LOC ? " selected" : ""}>No location</option>${locs.map((l) => `<option value="${esc(l)}"${invFilter.location === l ? " selected" : ""}>${esc(l)}</option>`).join("")}</select>
      <select data-f="sort" aria-label="Sort">${[["added", "Newest first"], ["value", "Highest value"], ["profit", "Biggest gain"], ["trend", "Rising fastest (30 days)"], ["name", "Name A–Z"], ["sku", "SKU"], ["location", "Location"]].map(([v, l]) => `<option value="${v}"${invFilter.sort === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      <select data-f="group" aria-label="Group">${Object.entries(GROUPS).map(([v, l]) => `<option value="${v}"${invFilter.group === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      <button class="ghost small" data-dense aria-pressed="${invDense}" title="Fit more rows on the screen">${invDense ? "☰ Roomy" : "≡ Compact"}</button>
    </div>
    ${shown.length ? `<div class="panel"><div class="table-wrap"><table class="inv-table${invDense ? " dense" : ""}">
      <tr><th><input type="checkbox" data-all aria-label="Select every card shown"></th><th>Card</th><th>Grade</th><th class="num">Qty</th><th class="num">Paid</th><th class="num">Value</th><th class="num">P/L</th><th>Status</th><th></th></tr>
      ${body}</table></div>
      ${total > shown.length ? `<div class="row" style="justify-content:center"><span class="small muted">Showing ${shown.length} of ${total}</span><button class="small" data-more>Show ${Math.min(PAGE, total - shown.length)} more</button><button class="small ghost" data-allrows>Show all</button></div>` : ""}
      <div class="row bulk">
        <span class="small" data-selcount></span>
        <button class="ghost small" data-selall>Select all ${total} matching</button><button class="ghost small" data-selnone>Clear</button>
        <button class="small" data-bulk="edit" title="Location, status, tags, price… for every selected card (shortcut: E)">✎ Edit selected</button>
        <button class="small" data-bulk="merge" title="The same card kept on several rows → one row with the total quantity">⇉ Merge</button>
        <button class="small" data-bulk="split" title="Paid one price for these? Spread it over them by value">÷ Split lot cost</button>
        <button class="small" data-bulk="grading">Send to grading</button>
        <button class="small" data-bulk="labels">Labels</button>
        <button class="small" data-bulk="listfile" title="Every field eBay / Whatnot ask for, one row per card — copy the columns into their bulk-listing template">⬇ Listing file</button>
        <button class="small" data-bulk="web-on">🌐 Sell on MJC</button>
        <button class="small" data-bulk="web-off">Remove from MJC</button>
      </div></div>`
    : `<div class="empty"><h2>${invRows.length ? "No cards match" : "No inventory yet"}</h2><p>${invRows.length ? "Change the filters above." : "Use <b>📥 Bulk scan</b> to scan a stack, research a card and click <b>＋ Inventory</b>, add one by hand, or import your spreadsheet."}</p></div>`}`;

  const redraw = () => { invLimit = PAGE; saveFilter(); drawStock(); };
  const on = (sel, fn) => { const el = $("#invBody " + sel); if (el) el.onclick = fn; };
  on("[data-more]", () => { invLimit += PAGE; drawStock(); });
  on("[data-allrows]", () => { invLimit = Infinity; drawStock(); });
  on("[data-dense]", () => { invDense = !invDense; store.set("invDense", invDense); drawStock(); });
  on("[data-saveview]", openSaveView);
  $$("#invBody [data-quick]").forEach((b) => (b.onclick = () => { invFilter.quick = invFilter.quick === b.dataset.quick ? "" : b.dataset.quick; redraw(); }));
  $$("#invBody [data-view]").forEach((b) => (b.onclick = () => { Object.assign(invFilter, { q: "", status: "active", category: "", sort: "added", location: "", group: "", quick: "" }, invViews[+b.dataset.view].filter); redraw(); }));
  $$("#invBody [data-unview]").forEach((b) => (b.onclick = async () => {
    const gone = invViews[+b.dataset.unview];
    invViews = await (await fetch("/api/inventory/views", json("PUT", invViews.filter((_, i) => i !== +b.dataset.unview)))).json();
    drawStock();
    toast(`Deleted the view "${gone.name}"`, { undo: async () => { invViews = await (await fetch("/api/inventory/views", json("PUT", [...invViews, gone]))).json(); drawStock(); } });
  }));
  // A barcode scanner types the SKU and presses Enter: an exact SKU opens that card.
  const qIn = $('#invBody [data-f="q"]');
  if (qIn) qIn.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    const v = qIn.value.trim().toLowerCase();
    const hit = invRows.find((r) => r.status !== "sold" && ((r.sku && r.sku.toLowerCase() === v) || (r.upc && r.upc === v))) || invRows.find((r) => r.sku && r.sku.toLowerCase() === v);
    if (hit) { e.preventDefault(); openItemEditor(hit); }
  };
  $$("#invBody [data-f]").forEach((el) => (el.oninput = () => {
    invFilter[el.dataset.f] = el.value;
    const focus = el.dataset.f === "q";
    if (focus) { invLimit = PAGE; drawStock(); } else redraw();
    if (focus) { const s = $('#invBody [data-f="q"]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }));

  // ---- selection (survives redraws; "Select all matching" reaches cards not drawn yet)
  const syncBulk = () => {
    const n = invSel.size;
    const c = $("#invBody [data-selcount]");
    if (c) c.innerHTML = n ? `<b>${n} selected</b>` : `<span class="muted">Tick cards to change many at once</span>`;
    $$("#invBody [data-bulk]").forEach((b) => (b.disabled = b.dataset.bulk === "merge" ? n < 2 : !n));
    const sn = $("#invBody [data-selnone]");
    if (sn) sn.hidden = !n;
    const sa = $("#invBody [data-selall]");
    if (sa) sa.hidden = total <= shown.length || rows.every((r) => invSel.has(r.id));
    const all = $("#invBody [data-all]");
    if (all) all.checked = shown.length > 0 && shown.every((r) => invSel.has(r.id));
  };
  const pick = (id, yes) => {
    yes ? invSel.add(id) : invSel.delete(id);
    const tr = $(`#invBody tr[data-id="${CSS.escape(id)}"]`);
    if (tr) { tr.classList.toggle("picked", yes); $("[data-sel]", tr).checked = yes; }
  };
  syncBulk();
  on("[data-all]", (e) => { shown.forEach((r) => pick(r.id, e.target.checked)); syncBulk(); });
  on("[data-selall]", () => { rows.forEach((r) => invSel.add(r.id)); drawStock(); });
  on("[data-selnone]", () => { invSel.clear(); drawStock(); });
  $$("#invBody [data-gsel]").forEach((b) => (b.onclick = () => { rows.filter((r) => groupLabel(g, r) === b.dataset.gsel).forEach((r) => invSel.add(r.id)); drawStock(); }));
  // shift-click ticks every row between the last tick and this one
  let lastTick = null;
  $$("#invBody [data-sel]").forEach((c) => (c.onclick = (e) => {
    const id = c.closest("tr").dataset.id;
    if (e.shiftKey && lastTick) {
      const ids = shown.map((r) => r.id), a = ids.indexOf(lastTick), b = ids.indexOf(id);
      if (a >= 0 && b >= 0) ids.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((x) => pick(x, c.checked));
    }
    pick(id, c.checked);
    lastTick = id;
    syncBulk();
  }));
  const selected = () => [...invSel];
  on("[data-bulk=edit]", () => openBulkEdit(selected()));
  on("[data-bulk=merge]", () => mergeSelected(selected()));
  on("[data-bulk=split]", () => openSplitCost(selected()));
  on("[data-bulk=grading]", () => openSubmissionEditor(selected()));
  on("[data-bulk=labels]", () => printLabels(selected()));
  on("[data-bulk=listfile]", async () => {
    const r = await fetch("/api/export/listings.csv", json("POST", { ids: selected() }));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await r.blob());
    a.download = `listings-${today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  });
  on("[data-bulk=web-on]", () => bulkPatch(selected(), { web: true }, "Going on the MJC website — the pricing engine is setting prices now"));
  on("[data-bulk=web-off]", () => bulkPatch(selected(), { web: false }, "Taken off the website"));
  $$("#invBody tr[data-id]").forEach((tr) => {
    const row = invRows.find((r) => r.id === tr.dataset.id);
    $("[data-edit]", tr).onclick = () => openItemEditor(row);
    const fp = $("[data-findprice]", tr);
    if (fp) fp.onclick = () => openFindPrice(row, loadStock);
    const rv = $("[data-revalue]", tr);
    if (rv) rv.onclick = async () => { rv.disabled = true; const r = await fetch(`/api/inventory/${row.id}/revalue`, { method: "POST" }); if (!r.ok) toast((await r.json()).error, { error: true }); loadStock(); };
    $("[data-del]", tr).onclick = () => removeWithUndo("/api/inventory/" + row.id, row.name, loadStock);
    const sell = $("[data-sell]", tr);
    if (sell) sell.onclick = () => openSellDialog(row);
    const opened = $("[data-open]", tr);
    if (opened) opened.onclick = () => openOpenedBox(row);
  });
}

/** Opened a box: scan what came out (its cost becomes the lot cost), pick cards already added, or nothing kept. */
function openOpenedBox(box) {
  const since = Date.now() - 3 * 86400000;
  const recent = invRows.filter((r) => r.status !== "sold" && r.kind !== "sealed" && Date.parse(r.added) > since && !r.openedFrom).sort((a, b) => (a.added < b.added ? 1 : -1)).slice(0, 200);
  const body = openModal(`📦 Opened: ${box.name}`, `
    <p class="small">One ${esc(box.sealedType || "box")} leaves stock (you have ${box.qty}). Its cost, <b>${usd(box.cost)}</b>, is spread over what came out by value — so each card's profit is real, and <b>Sales &amp; profit</b> shows whether opening boxes pays.</p>
    <div class="row"><button class="primary" data-scanpulls>📥 Scan what came out</button><span class="small muted">opens Bulk scan with this box picked</span></div>
    ${recent.length ? `<details${recent.length ? " open" : ""}><summary class="small">Or pick cards already added (last 3 days)</summary>
      <div class="table-wrap" style="max-height:40vh"><table class="small">${recent.map((r) => `<tr><td><input type="checkbox" data-pull="${esc(r.id)}" aria-label="${esc(r.name)}"></td><td>${esc(r.name)} <span class="muted">${esc(r.grade)}</span></td><td class="num">${usd(r.value)}</td><td class="muted">${esc(when(r.added))}</td></tr>`).join("")}</table></div>
      <div class="row"><button data-pickpulls>Use the ticked cards</button></div></details>` : ""}
    <div class="row"><button class="ghost" data-nothing>Nothing worth keeping came out</button></div>`);
  $("[data-scanpulls]", body).onclick = () => { scan.box = box.id; modal.close(); invView = "scan"; syncInvPills(); loadInventory(); };
  const send = async (pullIds) => {
    const r = await fetch(`/api/inventory/${box.id}/open`, json("POST", { pullIds }));
    const j = await r.json();
    if (!r.ok) return toast(j.error, { error: true });
    modal.close();
    toast(pullIds.length ? `Opened — ${plural(j.pulls, "card")} worth ${usd(j.value)} out of a ${usd(j.cost)} box` : `Opened — counted as ${usd(j.cost)} spent with nothing kept`);
    loadStock();
  };
  const pick = $("[data-pickpulls]", body);
  if (pick) pick.onclick = () => { const ids = $$("[data-pull]:checked", body).map((c) => c.dataset.pull); if (!ids.length) return toast("Tick the cards that came out.", { error: true }); send(ids); };
  $("[data-nothing]", body).onclick = () => send([]);
}

/** Change many cards at once; the toast's Undo puts every one back (kept a week on the bot). */
async function bulkPatch(ids, patch, what) {
  const r = await fetch("/api/inventory/bulk", json("POST", { ids, patch }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return toast(j.error || "Couldn't save", { error: true });
  toast(`${what} — ${plural(j.updated, "card")}`, { ms: 12000, undo: j.token ? () => undoBulk(j.token) : null });
  loadStock();
}
async function undoBulk(token) {
  const r = await fetch("/api/inventory/bulk/undo", json("POST", { token }));
  toast(r.ok ? "Undone" : (await r.json()).error, { error: !r.ok });
  loadStock();
}

function openBulkEdit(ids) {
  if (!ids.length) return;
  const locs = [...new Set(invRows.map((r) => r.location).filter(Boolean))].sort(byNumber);
  const body = openModal(`Edit ${plural(ids.length, "card")}`, `
    <p class="small muted">Only the boxes you fill in change. Undo stays available for a week.</p>
    <form class="form-grid" data-form>
      <label>Move to location<input name="location" list="bulkLocs" placeholder="unchanged" autocomplete="off"><datalist id="bulkLocs">${locs.map((l) => `<option value="${esc(l)}">`).join("")}</datalist></label>
      <label>Status<select name="status"><option value="">unchanged</option>${Object.entries(STATUS_LABEL).filter(([v]) => v !== "sold").map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></label>
      <label>Category<select name="category"><option value="">unchanged</option>${Object.keys(CAT_LABEL).map((c) => `<option value="${c}">${esc(CAT_LABEL[c])}</option>`).join("")}</select></label>
      <label>Grade<input name="grade" placeholder="unchanged"></label>
      <label>Add tags<input name="addTags" placeholder="rookie, flip"></label>
      <label>Paid each $<input name="cost" type="number" min="0" step="0.01" placeholder="unchanged"></label>
      <label>Listed on<select name="listedOn"><option value="">unchanged</option>${opts(SELL_PLATFORMS, "")}</select></label>
      <label>List price $<input name="listPrice" type="number" min="0" step="0.01" placeholder="unchanged"></label>
      <label>Website drop at <span class="muted small">(they go live together)</span><input name="webGoLiveAt" type="datetime-local"></label>
      <label>Condition <span class="muted small">(raw cards)</span><select name="conditionScale"><option value="">unchanged</option>${Object.entries(status.conditions || {}).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join("")}</select></label>
      <p class="span2 small muted">Selling goes through <b>Sold</b> on each card (or Show mode), so fees and profit stay right.</p>
      <div class="span2 row"><button class="primary">Apply to ${plural(ids.length, "card")}</button></div>
    </form>`);
  $("[data-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(Object.entries(Object.fromEntries(new FormData(e.target))).filter(([, v]) => String(v).trim() !== ""));
    if (f.addTags) f.addTags = f.addTags.split(",").map((t) => t.trim()).filter(Boolean);
    if (!Object.keys(f).length) return toast("Fill in at least one box.", { error: true });
    modal.close();
    const said = Object.keys(f).map((k) => ({ location: `moved to ${f.location}`, status: STATUS_LABEL[f.status], category: CAT_LABEL[f.category], grade: `grade ${f.grade}`, addTags: "tagged", cost: `paid ${usd(+f.cost)} each`, listedOn: `listed on ${f.listedOn}`, listPrice: `list price ${usd(+f.listPrice)}`, conditionScale: `condition ${f.conditionScale}`, webGoLiveAt: `website drop ${new Date(f.webGoLiveAt).toLocaleString()}` })[k]).join(", ");
    bulkPatch(ids, f, said.charAt(0).toUpperCase() + said.slice(1));
  };
}

async function mergeSelected(ids) {
  const rows = invRows.filter((r) => ids.includes(r.id) && r.status !== "sold").sort((a, b) => (a.added < b.added ? -1 : 1));
  if (rows.length < 2) return toast("Pick at least two cards that aren't sold.", { error: true });
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const same = rows.every((r) => norm(r.name) === norm(rows[0].name) && norm(r.grade) === norm(rows[0].grade));
  if (!same && !confirm(`These aren't all the same card and grade:\n\n${rows.slice(0, 6).map((r) => `• ${r.name} (${r.grade})`).join("\n")}\n\nMerge them into "${rows[0].name}" anyway?`)) return;
  const r = await fetch("/api/inventory/merge", json("POST", { ids: rows.map((x) => x.id) }));
  const j = await r.json();
  if (!r.ok) return toast(j.error, { error: true });
  invSel.clear();
  toast(`Merged into one row: ${j.kept.name} × ${j.kept.qty} (cost averaged to ${usd(j.kept.cost)})`, { ms: 12000, undo: () => undoBulk(j.token) });
  loadStock();
}

function openSplitCost(ids) {
  const rows = invRows.filter((r) => ids.includes(r.id));
  const worth = rows.reduce((n, r) => n + (r.value ?? r.webMarket ?? 0) * r.qty, 0);
  const body = openModal("Split what you paid", `
    <p class="small">You bought these ${plural(rows.length, "card")} together. Enter the total and it's spread over them <b>by value</b>${worth ? ` (they're worth ${usd(worth)} together)` : " — none are valued yet, so evenly"}. Each card's "Paid each" is replaced.</p>
    <form class="row" data-form><label>Paid for all of them $<input name="total" type="number" min="0" step="0.01" required autofocus></label><button class="primary">Split it</button></form>`);
  $("[data-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const total = parseFloat(new FormData(e.target).get("total"));
    const r = await fetch("/api/inventory/split-cost", json("POST", { ids, total }));
    const j = await r.json();
    if (!r.ok) return toast(j.error, { error: true });
    modal.close();
    toast(`Split ${usd(total)} over ${plural(j.updated, "card")} ${j.byValue ? "by value" : "evenly"}`, { ms: 12000, undo: j.token ? () => undoBulk(j.token) : null });
    loadStock();
  };
}

function openSaveView() {
  const body = openModal("Save this view", `
    <p class="small muted">Saves the current filters, sort and grouping (not the search box) as a button above the list — on every computer using this bot.</p>
    <form class="row" data-form><label>Name<input name="name" required maxlength="40" placeholder="Box 3 rookies" autofocus></label><button class="primary">Save</button></form>`);
  $("[data-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const { q, ...filter } = invFilter;
    invViews = await (await fetch("/api/inventory/views", json("PUT", [...invViews, { name: new FormData(e.target).get("name"), filter }]))).json();
    modal.close();
    drawStock();
  };
}

/** The given cards as a spreadsheet (what you see, not the whole inventory). */
function exportRows(rows) {
  if (!rows.length) return toast("No cards to export.");
  const cols = [["SKU", "sku"], ["Card", "name"], ["Grade", "grade"], ["Category", "category"], ["Qty", "qty"], ["Paid each", "cost"], ["Value each", "value"], ["Status", (r) => STATUS_LABEL[r.status]], ["Location", "location"], ["Tags", (r) => (r.tags || []).join(", ")], ["Listed on", "listedOn"], ["List price", "listPrice"], ["Sold price", "soldPrice"], ["Sold date", "soldDate"], ["Website price", (r) => (r.web ? webPrice(r) : "")], ["Sales page", "priceUrl"], ["Last counted", (r) => (r.countedAt || "").slice(0, 10)], ["Notes", "notes"]];
  const cell = (v) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const text = [cols.map(([h]) => h).join(","), ...rows.map((r) => cols.map(([, f]) => cell(typeof f === "function" ? f(r) : r[f])).join(","))].join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob(["﻿" + text], { type: "text/csv" }));
  a.download = `inventory-${today()}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

// ------------------------------------------------------------------ DATA CHECK

const FIXABLE = new Set(["dupSku", "webSold", "orphanHistory"]);
async function openDataCheck() {
  const body = openModal("🩺 Data check", `<p class="muted">Checking every record…</p>`, { wide: true });
  const draw = async () => {
    const c = await getJSON("/api/inventory/check");
    const cardLine = (r) => `<li><a href="#" data-open="${esc(r.id)}">${esc(r.name)}</a> <span class="muted">${esc(r.grade || "")}${r.sku ? " · " + esc(r.sku) : ""}${r.location ? " · 📍" + esc(r.location) : ""}${r.note ? " · " + esc(r.note) : ""}</span></li>`;
    body.innerHTML = !c.issues.length
      ? `<p class="ok">✓ Every record looks right — ${plural(c.cards, "card")} checked.</p>`
      : `<p class="small muted">${plural(c.cards, "card")} checked. Problems that make profit, labels or the website wrong are at the top.</p>` +
        c.issues.sort((a, b) => SERIOUS.includes(b.type) - SERIOUS.includes(a.type)).map((i) => `
        <details class="check-item${SERIOUS.includes(i.type) ? " serious" : ""}"${SERIOUS.includes(i.type) ? " open" : ""}>
          <summary><b>${i.count}</b> × ${esc(i.title)}
            ${FIXABLE.has(i.type) ? `<button class="small" data-fix="${i.type}">${esc(i.fix)}</button>` : i.type === "dupCard" ? `<button class="small" data-mergeall>Merge all ${i.count}</button>` : i.type === "noPriceUrl" ? `<button class="small" data-findp>💲 Find prices</button>` : ""}</summary>
          ${i.type === "dupCard"
            ? `<ul class="tight small">${i.groups.slice(0, 50).map((grp, k) => `<li>${esc(grp[0].name)} (${esc(grp[0].grade)}) — ${grp.length} rows, qty ${grp.reduce((n, r) => n + r.qty, 0)} <button class="ghost small" data-merge="${k}">Merge</button></li>`).join("")}</ul>`
            : i.rows?.length ? `<ul class="tight small">${i.rows.slice(0, 50).map(cardLine).join("")}${i.count > 50 ? `<li class="muted">…and ${i.count - 50} more</li>` : ""}</ul>` : ""}
        </details>`).join("");
    $$("[data-open]", body).forEach((a) => (a.onclick = (e) => { e.preventDefault(); openItemEditor({ id: a.dataset.open }); }));
    $$("[data-fix]", body).forEach((b) => (b.onclick = async (e) => {
      e.preventDefault();
      b.disabled = true;
      const r = await fetch("/api/inventory/check/fix", json("POST", { type: b.dataset.fix }));
      const j = await r.json();
      toast(r.ok ? `Fixed ${plural(j.fixed, "record")}` : j.error, { error: !r.ok });
      draw();
    }));
    const dup = c.issues.find((i) => i.type === "dupCard");
    const merge = async (grp) => {
      const r = await fetch("/api/inventory/merge", json("POST", { ids: grp.map((x) => x.id) }));
      return r.ok ? (await r.json()).token : null;
    };
    $$("[data-merge]", body).forEach((b) => (b.onclick = async () => { b.disabled = true; const t = await merge(dup.groups[+b.dataset.merge]); if (t) toast("Merged", { undo: () => undoBulk(t) }); draw(); }));
    const all = $("[data-mergeall]", body);
    if (all) all.onclick = async (e) => {
      e.preventDefault();
      all.disabled = true;
      let n = 0;
      for (const grp of dup.groups) if (await merge(grp)) n++;
      toast(`Merged ${plural(n, "group")} — each card is on one row now (Undo is on each card's merge for a week)`);
      draw();
    };
    const fp = $("[data-findp]", body);
    if (fp) fp.onclick = (e) => { e.preventDefault(); modal.close(); findPricesBulk(loadStock); };
  };
  modal.addEventListener("close", () => { if (invView === "stock") loadStock(); }, { once: true });
  draw().catch((err) => (body.innerHTML = `<p class="error">${esc(err.message)}</p>`));
}

// ------------------------------------------------------------------ LOCATIONS + STOCK COUNT

async function loadLocations() {
  $("#invActions").innerHTML = `<button data-a="count" class="primary" title="Scan every card in a box with the barcode scanner">🔢 Count a box</button>`;
  $("#invActions [data-a=count]").onclick = () => openCount("");
  const [locs, rows] = await Promise.all([getJSON("/api/inventory/locations"), getJSON("/api/inventory")]);
  invRows = rows;
  $("#invBody").innerHTML = locs.length ? `
    <p class="small muted">Every box, binder and case with what's in it. <b>Count</b> it with the barcode scanner to find cards that walked off or were put back in the wrong box.</p>
    <div class="panel table-wrap"><table>
      <tr><th>Location</th><th class="num">Rows</th><th class="num">Cards</th><th class="num">Value</th><th class="num">Paid</th><th>Last counted</th><th></th></tr>
      ${locs.map((l, i) => `<tr><td><b>${l.location ? "📍 " + esc(l.location) : `<span class="muted">No location</span>`}</b></td><td class="num">${l.cards}</td><td class="num">${l.qty}</td><td class="num">${usd(l.value)}</td><td class="num">${usd(l.cost)}</td>
        <td class="small">${l.counted ? esc(day(l.counted)) + (l.uncounted ? ` <span class="chip warn">${l.uncounted} never counted</span>` : "") : `<span class="muted">never</span>`}</td>
        <td class="actions nowrap"><button class="small" data-open="${i}">Open</button>${l.location ? `<button class="small" data-count="${i}">🔢 Count</button><button class="small ghost" data-rename="${i}" aria-label="Rename ${esc(l.location)}">✎</button>` : ""}</td></tr>`).join("")}
    </table></div>` : `<div class="empty"><h2>No locations yet</h2><p>Give cards a location (Box 3, Binder A…) in the card editor or with <b>✎ Edit selected</b> on the Stock list.</p></div>`;
  $$("#invBody [data-open]").forEach((b) => (b.onclick = () => { Object.assign(invFilter, { location: locs[+b.dataset.open].location || NO_LOC, quick: "", status: "active" }); saveFilter(); invView = "stock"; loadInventory(); }));
  $$("#invBody [data-count]").forEach((b) => (b.onclick = () => openCount(locs[+b.dataset.count].location)));
  $$("#invBody [data-rename]").forEach((b) => (b.onclick = () => {
    const from = locs[+b.dataset.rename].location;
    const body = openModal(`Rename ${from}`, `<form class="row" data-form><label>New name<input name="to" required maxlength="80" value="${esc(from)}" autofocus></label><button class="primary">Rename</button></form>`);
    $("[data-form]", body).onsubmit = async (e) => {
      e.preventDefault();
      const to = new FormData(e.target).get("to").trim();
      modal.close();
      const ids = invRows.filter((r) => r.location === from && r.status !== "sold").map((r) => r.id);
      const r = await fetch("/api/inventory/bulk", json("POST", { ids, patch: { location: to } }));
      const j = await r.json();
      toast(r.ok ? `Renamed — ${plural(j.updated, "card")} now in ${to}` : j.error, { error: !r.ok, undo: j.token ? async () => { await fetch("/api/inventory/bulk/undo", json("POST", { token: j.token })); loadLocations(); } : null });
      loadLocations();
    };
  }));
}

/** Stock count: scan every label in a box; the bot says what's there, what's missing and what belongs elsewhere. */
function openCount(location) {
  const scanned = [];
  const locs = [...new Set(invRows.map((r) => r.location).filter(Boolean))].sort(byNumber);
  const body = openModal("🔢 Count a box", `
    <form class="row" data-where><label>Which box / binder<input name="loc" list="countLocs" value="${esc(location)}" required autocomplete="off"><datalist id="countLocs">${locs.map((l) => `<option value="${esc(l)}">`).join("")}</datalist></label></form>
    <label>Scan each card's label (or type the SKU and press Enter)<input data-sku autocomplete="off" placeholder="CRB-0001" ${location ? "autofocus" : ""}></label>
    <div data-tally class="small" aria-live="polite" style="margin:.5rem 0"></div>
    <div class="row"><button class="primary" data-finish disabled>Finish count</button><span class="small muted">Nothing changes until you check the result and apply it.</span></div>
    <div data-result></div>`, { wide: true });
  const loc = () => $("[name=loc]", body).value.trim();
  const tally = () => {
    const inBox = invRows.filter((r) => r.location === loc() && r.status !== "sold").length;
    $("[data-tally]", body).innerHTML = `<b>${scanned.length}</b> scanned${inBox ? ` of ${inBox} recorded in ${esc(loc())}` : ""}${scanned.length ? ` · last: ${esc(scanned.at(-1).label)}` : ""}`;
    $("[data-finish]", body).disabled = !scanned.length || !loc();
  };
  $("[data-where]", body).onsubmit = (e) => { e.preventDefault(); $("[data-sku]", body).focus(); };
  $("[name=loc]", body).oninput = tally;
  $("[data-sku]", body).onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const sku = e.target.value.trim();
    e.target.value = "";
    if (!sku) return;
    if (scanned.some((s) => s.sku.toLowerCase() === sku.toLowerCase())) return toast(`${sku} was already scanned`, { ms: 1500 });
    const r = invRows.find((x) => x.sku && x.sku.toLowerCase() === sku.toLowerCase());
    scanned.push({ sku, label: r ? `${r.name} (${r.grade})` : `${sku} — not a SKU on file` });
    tally();
  };
  tally();
  $("[data-finish]", body).onclick = async () => {
    const res = await (await fetch("/api/inventory/count", json("POST", { location: loc(), skus: scanned.map((s) => s.sku) }))).json();
    const list = (rows, note) => `<ul class="tight small">${rows.slice(0, 100).map((r) => `<li>${esc(r.name)} <span class="muted">${esc(r.grade)} · ${esc(r.sku)}${note ? note(r) : ""}</span></li>`).join("")}</ul>`;
    const extraMovable = res.extra.filter((r) => r.status !== "sold");
    $("[data-result]", body).innerHTML = `
      <h3>✓ ${res.found.length} where they should be</h3>
      ${res.missing.length ? `<h3 class="bad">${res.missing.length} recorded in ${esc(loc())} but not scanned</h3>${list(res.missing)}
        <label class="check small"><input type="checkbox" data-markmissing> Set their location to "Not found (count ${today()})" so they're easy to hunt down</label>` : ""}
      ${res.extra.length ? `<h3 class="warn">${res.extra.length} scanned here but recorded somewhere else</h3>${list(res.extra, (r) => r.status === "sold" ? ` · <b class="bad">marked SOLD</b> — check that sale` : ` · records say ${esc(r.location || "no location")}`)}
        ${extraMovable.length ? `<label class="check small"><input type="checkbox" data-movehere checked> Move ${plural(extraMovable.length, "card")} to ${esc(loc())}</label>` : ""}` : ""}
      ${res.unknown.length ? `<p class="small"><b>${res.unknown.length}</b> scanned code${res.unknown.length === 1 ? " isn't" : "s aren't"} on file: ${res.unknown.slice(0, 20).map(esc).join(", ")}</p>` : ""}
      <div class="row"><button class="primary" data-apply>Apply count</button></div>`;
    $("[data-apply]", body).onclick = async () => {
      const r = await fetch("/api/inventory/count/apply", json("POST", {
        location: loc(),
        found: res.found.map((x) => x.id),
        moveHere: $("[data-movehere]", body)?.checked ? extraMovable.map((x) => x.id) : [],
        missing: $("[data-markmissing]", body)?.checked ? res.missing.map((x) => x.id) : [],
      }));
      const j = await r.json();
      if (!r.ok) return toast(j.error, { error: true });
      modal.close();
      toast(`Counted ${loc()}: ${j.counted} checked off${j.moved ? `, ${j.moved} moved here` : ""}${j.missing ? `, ${j.missing} marked not found` : ""}`);
      if (invView === "locations") loadLocations();
    };
  };
}

async function openItemEditor(row = null) {
  window.__customers = await getJSON("/api/customers").catch(() => []);
  // The Stock list is slimmed (no descriptions, no history): edit the full card, or saving would blank them.
  if (row?.id) {
    try {
      row = await getJSON("/api/inventory/" + encodeURIComponent(row.id));
    } catch (err) {
      return toast(/not found/.test(err.message) ? "That card isn't in the inventory anymore." : err.message, { error: true });
    }
  }
  const hist = row?.history || { v: [], p: [], c: [] };
  const FIELD_NAME = { facts: "card facts", condition: "condition", kind: "type", upc: "UPC", sealedType: "box type", name: "name", category: "category", grade: "grade", qty: "qty", cost: "paid", value: "value", purchased: "purchased", notes: "notes", tags: "tags", location: "location", sku: "SKU", priceUrl: "sales page", status: "status", listedOn: "listed on", listPrice: "list price", soldPrice: "sold price", soldDate: "sold date", soldOn: "sold on", fees: "fees", payment: "payment", web: "website", webMode: "website pricing", webFixedPrice: "fixed website price" };
  const show = (k, v) => (v == null || v === "" ? "—" : k === "condition" ? [v.scale, v.centering].filter(Boolean).join(" · ") || "set" : k === "facts" ? [v.year, v.set, v.player, v.number && "#" + v.number, v.parallel].filter(Boolean).join(" ") || "set" : Array.isArray(v) ? v.join(", ") || "—" : typeof v === "boolean" ? (v ? "on" : "off") : k === "status" ? STATUS_LABEL[v] || v : ["cost", "value", "listPrice", "soldPrice", "fees", "webFixedPrice"].includes(k) ? usd(v) : k === "priceUrl" ? "linked" : String(v).slice(0, 60));
  const r = row || { name: "", grade: "Raw", qty: 1, cost: "", value: "", category: "other", status: "in_stock", purchased: today(), tags: [] };
  const F = r.facts || {}, K = r.condition || {}, parts = status.conditionParts || {};
  const partSel = (k) => `<select name="cond.${k}"><option value="">—</option>${opts(parts[k] || [], K[k])}</select>`;
  const fact = (k, label, ph = "") => `<label>${label}<input name="facts.${k}" value="${esc(F[k] || "")}" placeholder="${esc(ph)}"></label>`;
  const tick = (k, label) => `<label class="check"><input type="checkbox" name="facts.${k}"${F[k] ? " checked" : ""}> ${label}</label>`;
  const body = openModal(row ? "Edit card" : "Add a card", `
    <form class="form-grid" data-form>
      <label class="span2">Card name<input name="name" required value="${esc(r.name)}" placeholder="2023 Prizm Victor Wembanyama #136 Silver"></label>
      <label>Grade<input name="grade" value="${esc(r.grade)}" placeholder="Raw, PSA 10, BGS 9.5"></label>
      <label>Category<select name="category">${Object.keys(CAT_LABEL).map((c) => `<option value="${c}"${c === r.category ? " selected" : ""}>${esc(CAT_LABEL[c])}</option>`).join("")}</select></label>
      <label>What is it<select name="kind" data-kindsel><option value="card"${r.kind !== "sealed" ? " selected" : ""}>A card</option><option value="sealed"${r.kind === "sealed" ? " selected" : ""}>Sealed product (box, pack, case)</option></select></label>
      <label>Qty<input name="qty" type="number" min="1" value="${esc(r.qty)}"></label>
      <label>Paid each $<input name="cost" type="number" min="0" step="0.01" value="${esc(r.cost)}"></label>
      <label>Value each $<input name="value" type="number" min="0" step="0.01" value="${esc(r.value ?? "")}" placeholder="auto from sales page"></label>
      <label>Purchased<input name="purchased" type="date" value="${esc(r.purchased || today())}"></label>
      <label>Status<select name="status">${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}"${v === r.status ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Listed on<select name="listedOn"><option value="">—</option>${opts(SELL_PLATFORMS, r.listedOn)}</select></label>
      <label>List price $<input name="listPrice" type="number" min="0" step="0.01" value="${esc(r.listPrice ?? "")}"></label>
      <label>SKU<input name="sku" value="${esc(r.sku || "")}" placeholder="auto"></label>
      <label>Location<input name="location" value="${esc(r.location || "")}" placeholder="Box 3, row 2" list="editLocs" autocomplete="off"><datalist id="editLocs">${[...new Set(invRows.map((x) => x.location).filter(Boolean))].sort(byNumber).map((l) => `<option value="${esc(l)}">`).join("")}</datalist></label>
      <label class="span2">Tags (comma separated)<input name="tags" value="${esc((r.tags || []).join(", "))}" placeholder="rookie, flip, PC"></label>
      <label class="span2">Sales page URL (for automatic values)<input name="priceUrl" value="${esc(r.priceUrl || "")}" placeholder="https://www.sportscardspro.com/game/..."></label>
      <label class="span2">Notes <span class="muted">(private — never shown on the website)</span><textarea name="notes" rows="2">${esc(r.notes || "")}</textarea></label>
      <fieldset class="span2 web-box" data-kind="card">
        <legend>🃏 Card facts <span class="muted small">(the website shows these)</span></legend>
        <div class="form-grid">
          ${fact("year", "Year", "2023")}${fact("set", "Set", "Panini Prizm")}${fact("player", "Player / character")}${fact("team", "Team")}
          ${fact("number", "Card #", "136")}${fact("parallel", "Parallel / variant", "blank = base")}${fact("serial", "Serial", "23/99")}${fact("cert", "Cert #")}
          <div class="span2 row" style="margin:0">${tick("rookie", "Rookie")}${tick("auto", "Autograph")}${tick("relic", "Relic / patch")}</div>
          ${row?.pop ? `<p class="span2 small" style="margin:0">PSA population at ${esc(row.pop.grade)}: <b>${esc(row.pop.pop)}</b>${row.pop.higher != null ? ` · ${esc(row.pop.higher)} graded higher` : ""} · checked ${esc(when(row.pop.at))}${row.pop.base !== row.pop.pop ? "" : ""}</p>` : ""}
        </div>
      </fieldset>
      <fieldset class="span2 web-box" data-kind="card">
        <legend>🔍 Condition <span class="muted small">(raw cards — a slab's grade is its condition)</span></legend>
        <div class="form-grid">
          <label>Condition<select name="cond.scale" data-condsel><option value="">—</option>${Object.entries(status.conditions || {}).map(([v, l]) => `<option value="${v}"${K.scale === v ? " selected" : ""}>${esc(l)} (${v})</option>`).join("")}</select></label>
          <label>Centering<span class="row" style="margin:0;flex-wrap:nowrap"><input name="cond.centering" value="${esc(K.centering || "")}" placeholder="55/45 L/R · 60/40 T/B" style="flex:1">${(row?.photos || []).length ? `<button type="button" class="small" data-measure title="Measure it on the front photo">📐</button>` : ""}</span></label>
          <label>Corners${partSel("corners")}</label><label>Edges${partSel("edges")}</label><label>Surface${partSel("surface")}</label>
          <label>Condition notes <span class="muted small">(the website shows them)</span><input name="cond.notes" value="${esc(K.notes || "")}" placeholder="tiny white spot, top-left corner of the back"></label>
          <p class="span2 small muted" data-condhelp style="margin:0"></p>
        </div>
      </fieldset>
      <fieldset class="span2 web-box">
        <legend>🤝 Consignment <span class="muted small">(someone else's card you sell for a commission)</span></legend>
        <div class="form-grid">
          <label>Consigned by<select name="consignorId" data-consignor><option value="">— our own card —</option>${(window.__customers || []).map((c) => `<option value="${esc(c.id)}"${c.id === r.consignorId ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
          <label>Their minimum price $<input name="consignFloor" type="number" min="0" step="0.01" value="${esc(r.consignFloor ?? "")}" placeholder="never sold under this"></label>
          <label>Commission % <span class="muted small">(blank = the shop's)</span><input name="consignPct" type="number" min="0" max="60" step="0.5" value="${esc(r.consignPct ?? "")}"></label>
          ${r.payout ? `<p class="small" style="margin:0">Sold — owed to them: <b>${usd(r.payout.owed)}</b> ${r.payout.paidAt ? `· paid ${esc(day(r.payout.paidAt))}` : "· <b class=neg>not paid yet</b>"}</p>` : ""}
        </div>
      </fieldset>
      <fieldset class="span2 web-box" data-kind="sealed">
        <legend>📦 Sealed product</legend>
        <div class="form-grid">
          <label>Type<select name="sealedType"><option value="">—</option>${opts(status.sealedTypes || [], r.sealedType)}</select></label>
          <label>UPC barcode<input name="upc" inputmode="numeric" value="${esc(r.upc || "")}" placeholder="scan the barcode on the box"></label>
          <p class="span2 small muted" style="margin:0">Opened one? Click <b>📦 Opened</b> on it in Stock — its cost goes to the cards that came out.</p>
        </div>
      </fieldset>
      <fieldset class="span2 web-box">
        <legend>🌐 MJC website</legend>
        <label class="check"><input type="checkbox" name="web"${r.web ? " checked" : ""}> Sell this card on the MJC website</label>
        <div class="form-grid" style="margin-top:.4rem">
          <label>Price<select name="webMode"><option value="auto"${r.webMode !== "fixed" ? " selected" : ""}>Automatic (pricing engine, daily)</option><option value="fixed"${r.webMode === "fixed" ? " selected" : ""}>Fixed price I set</option></select></label>
          <label>Fixed price $<input name="webFixedPrice" type="number" min="0" step="0.01" value="${esc(r.webFixedPrice ?? "")}" placeholder="only for fixed"></label>
          <label>Goes live at <span class="muted small">(a drop — hidden on the site until then; blank = now)</span><input name="webGoLiveAt" type="datetime-local" value="${esc(r.webGoLiveAt ? new Date(new Date(r.webGoLiveAt).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "")}"></label>
        </div>
        ${row?.web ? `<div class="small" style="margin-top:.4rem">${webPrice(row) ? `On the site at <b>${usd(webPrice(row))}</b>${row.webMarket ? ` · market ${usd(row.webMarket)}` : ""}${row.webLiquidity ? ` · ${esc(row.webLiquidity)}` : ""}` : `<span class="bad">${esc(row.webPricingNote || "Waiting for its first price")}</span>`}
          ${hist.p.length ? `<details><summary>Price history (${hist.p.length})</summary><ul class="tight small">${hist.p.slice(-8).reverse().map((l) => `<li>${esc(when(l.at))}: ${usd(l.from)} → <b>${usd(l.to)}</b> — ${esc(l.reason)}</li>`).join("")}</ul></details>` : ""}</div>` : ""}
        <label style="margin-top:.5rem">Website description <span class="muted">(blank = the research summary)</span><textarea name="webDescription" rows="3">${esc(r.webDescription || "")}</textarea></label>
        ${row ? `<div class="row" style="margin:.3rem 0 0"><button type="button" class="small" data-describe>✍ Write it with AI</button><span class="small muted">uses the card's research report</span></div>
        <div class="photo-strip" data-photos></div>
        <div class="row" style="margin:.3rem 0 0"><label class="button small" for="photoIn">📷 Add photos</label><input type="file" id="photoIn" accept="image/*" multiple hidden><span class="small muted">Front first. Your own photos — up to 8.</span></div>
        <div class="row" style="margin:.5rem 0 0;align-items:center" data-videobox></div>` : `<p class="small muted">Save the card first, then reopen it to add photos and a video.</p>`}
      </fieldset>
      ${hist.v.length > 1 ? `<div class="span2 small">Value over time ${sparkline(hist.v.slice(-60).map(([, v]) => v))} <span class="muted">${esc(day(hist.v[0][0]))} → ${esc(day(hist.v.at(-1)[0]))}</span></div>` : ""}
      ${hist.c.length ? `<details class="span2 small"><summary>Change history (${hist.c.length})</summary><ul class="tight">${hist.c.slice().reverse().map((e) => `<li>${esc(when(e.at))}${e.by ? " · " + esc(e.by) : ""}: ${Object.entries(e.f).map(([k, [a, b]]) => `${esc(FIELD_NAME[k] || k)} ${esc(show(k, a))} → <b>${esc(show(k, b))}</b>`).join("; ")}</li>`).join("")}</ul></details>` : ""}
      <div class="span2 row"><button class="primary">${row ? "Save" : "Add card"}</button></div>
    </form>`, { wide: true });
  if (row) { wireWebExtras(row, body); wireVideo(row, body); }
  // card vs sealed product: only the boxes that apply
  const kindSel = $("[data-kindsel]", body);
  const showKind = () => $$("[data-kind]", body).forEach((el) => (el.hidden = el.dataset.kind !== kindSel.value));
  kindSel.onchange = showKind;
  showKind();
  const condSel = $("[data-condsel]", body), condHelp = $("[data-condhelp]", body);
  const showHelp = () => (condHelp.textContent = condSel.value ? `${status.conditions[condSel.value]}: ${status.conditionHelp?.[condSel.value] || ""}${K.at && K.scale === condSel.value ? ` Checked ${K.at}.` : ""}` : "One scale for every raw card: Near Mint, Lightly Played, Moderately Played, Heavily Played, Damaged.");
  condSel.onchange = showHelp;
  showHelp();
  const measure = $("[data-measure]", body);
  if (measure) measure.onclick = () => openCentering({ url: `/api/photos/${encodeURIComponent(row.id)}/${encodeURIComponent(row.photos[0])}` }, { onUse: (text) => { $('[name="cond.centering"]', body).value = text; } });
  $("[data-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    // "facts.year" → f.facts.year, "cond.scale" → f.condition.scale (ticked boxes only arrive when ticked)
    f.facts = { rookie: false, auto: false, relic: false, ...(row?.facts?.certVerified ? { certVerified: true } : {}) };
    f.condition = {};
    for (const [k, v] of Object.entries(f)) {
      const m = k.match(/^(facts|cond)\.(\w+)$/);
      if (!m) continue;
      (m[1] === "facts" ? f.facts : f.condition)[m[2]] = ["rookie", "auto", "relic"].includes(m[2]) ? true : v;
      delete f[k];
    }
    if (f.kind === "sealed") { delete f.facts; delete f.condition; }
    if (!f.consignorId) { f.consignorId = null; delete f.consignFloor; delete f.consignPct; }
    if (f.value === "") f.value = null;
    if (!f.sku) delete f.sku;
    f.web = e.target.elements.web.checked;
    if (f.webMode === "fixed" && !(parseFloat(f.webFixedPrice) > 0)) return toast("Enter the fixed website price, or switch to Automatic.", { error: true });
    if (!row) {
      const dup = await getJSON(`/api/inventory/duplicate?name=${encodeURIComponent(f.name)}&grade=${encodeURIComponent(f.grade || "Raw")}`).catch(() => null);
      if (dup && !e.target.dataset.force) {
        const choice = confirm(`You already have "${dup.name}" (${dup.grade}) in stock — qty ${dup.qty}, ${dup.sku || ""}.\n\nOK = add ${f.qty || 1} to that card's quantity.  Cancel = add it as a separate card.`);
        if (choice) {
          await fetch("/api/inventory/" + dup.id, json("PATCH", { qty: dup.qty + (parseInt(f.qty, 10) || 1) }));
          modal.close();
          toast(`Quantity updated to ${dup.qty + (parseInt(f.qty, 10) || 1)}`);
          if ($("#tab-inventory").classList.contains("active")) loadStock();
          return;
        }
        e.target.dataset.force = "1";
      }
    }
    const res = await fetch(row ? "/api/inventory/" + row.id : "/api/inventory", json(row ? "PATCH" : "POST", f));
    if (!res.ok) return toast((await res.json()).error || "Couldn't save", { error: true });
    modal.close();
    toast(row ? "Saved" : "Added to inventory");
    if ($("#tab-inventory").classList.contains("active") && invView === "stock") loadStock();
  };
}

// Stock shortcuts: N = add a card, E = edit the selected cards, F = search the list, Esc = clear the selection.
SHORTCUTS.push(["N / E / F", "Inventory → Stock: add a card / edit the selected cards / search the list"]);
document.addEventListener("keydown", (e) => {
  if (!$("#tab-inventory")?.classList.contains("active") || invView !== "stock" || modal.open || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === "n") { e.preventDefault(); openItemEditor(); }
  else if (k === "e" && invSel.size) { e.preventDefault(); openBulkEdit([...invSel]); }
  else if (k === "f") { e.preventDefault(); $('#invBody [data-f="q"]')?.focus(); }
  else if (e.key === "Escape" && invSel.size) { invSel.clear(); drawStock(); }
});

async function openSellDialog(row) {
  window.__customers = await getJSON("/api/customers").catch(() => []);
  const body = openModal(`Sold: ${row.name}`, `
    <form class="form-grid" data-form>
      ${row.qty > 1 ? `<label>How many<select name="qty">${Array.from({ length: Math.min(row.qty, 100) }, (_, i) => `<option${i + 1 === row.qty ? " selected" : ""}>${i + 1}</option>`).join("")}</select></label>` : ""}
      <label>Sold for (each) $<input name="soldPrice" type="number" min="0" step="0.01" required value="${esc(row.listPrice ?? row.value ?? "")}"></label>
      <label>Where<select name="soldOn">${opts(SELL_PLATFORMS, row.listedOn || "eBay")}</select></label>
      <label>Paid with<select name="payment"><option value="">—</option>${opts(status.payments || [], "")}</select></label>
      <label>Customer <span class="muted small">(optional — needed for store credit)</span><select name="customerId"><option value="">—</option>${(window.__customers || []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}${c.credit ? ` (credit ${usd(c.credit)})` : ""}</option>`).join("")}</select></label>
      <label>Date<input name="soldDate" type="date" value="${today()}"></label>
      <label>Fees $ <span class="muted small">(blank = estimate)</span><input name="fees" type="number" min="0" step="0.01"></label>
      <div class="span2 small" data-preview></div>
      <div class="span2 row"><button class="primary">Mark sold</button></div>
    </form>`);
  const form = $("[data-form]", body);
  // Profit after fees, as you type (the fee table is the server's, the same one Sales & profit uses).
  const preview = () => {
    const f = Object.fromEntries(new FormData(form));
    const n = parseInt(f.qty || row.qty, 10), price = parseFloat(f.soldPrice) || 0;
    const [p, fixed] = (status.fees || {})[f.soldOn] || [0, 0];
    const fees = f.fees !== "" ? parseFloat(f.fees) || 0 : Math.round((price * n * p / 100 + (price ? fixed : 0)) * 100) / 100;
    const profit = (price - row.cost) * n - fees;
    $("[data-preview]", body).innerHTML = `${n} × ${usd(price)} = <b>${usd(price * n)}</b> · fees ${usd(fees)}${f.fees === "" && p ? ` <span class="muted">(est. ${p}% + ${usd(fixed)})</span>` : ""} · paid ${usd(row.cost * n)} → <b class="${profit >= 0 ? "pos" : "neg"}">${profit >= 0 ? "profit" : "loss"} ${usd(Math.abs(profit))}</b>${n < row.qty ? ` <span class="muted">· ${row.qty - n} stay in stock</span>` : ""}`;
  };
  form.oninput = preview;
  preview();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.fees === "") delete f.fees;
    if (!f.payment) delete f.payment;
    const r = await fetch(`/api/inventory/${row.id}/sell`, json("POST", f));
    const j = await r.json();
    if (!r.ok) return toast(j.error || "Couldn't save", { error: true });
    modal.close();
    toast(`Sold ✓ ${j.soldRow.qty} × ${row.name}${j.split ? ` — ${j.row.qty} still in stock` : ""}`);
    loadStock();
  };
}

function openImport() {
  const body = openModal("Import a spreadsheet", `
    <p class="small">Save your spreadsheet as <b>CSV</b> (Excel: File → Save As → CSV; Google Sheets: File → Download → CSV).
      The first row must be column names. Recognized columns: <b>Card</b>/Name (required), Grade, Qty, Cost/Paid, Value, Purchased/Date, Category/Sport, Location, SKU, Notes.</p>
    <input type="file" accept=".csv,text/csv,.txt" data-file>
    <div data-out class="small" style="margin-top:.6rem"></div>`);
  $("[data-file]", body).onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const r = await fetch("/api/inventory/import", json("POST", { csv: await f.text() }));
    const j = await r.json();
    $("[data-out]", body).innerHTML = r.ok
      ? `<span class="ok">Imported ${j.added} cards ✓</span>${j.skipped ? ` (${j.skipped} empty rows skipped)` : ""}<br><span class="muted">Columns used: ${Object.entries(j.columns).map(([k, v]) => `${esc(k)} ← "${esc(v)}"`).join(", ")}</span>`
      : `<span class="bad">${esc(j.error)}</span>`;
    if (r.ok) loadStock();
  };
}

/**
 * Code 128 (set B) barcode of a SKU as an SVG — what a USB/Bluetooth barcode scanner reads. Scanning it into
 * the Stock search or Show mode finds the card instantly.
 */
const C128 = "212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 114131 311141 411131 211412 211214 211232 2331112".split(" ");
function code128(text) {
  const vals = [...String(text)].map((ch) => ch.charCodeAt(0) - 32).filter((v) => v >= 0 && v <= 95);
  if (!vals.length) return "";
  const codes = [104, ...vals, (104 + vals.reduce((n, v, i) => n + v * (i + 1), 0)) % 103, 106];
  let x = 10, bars = "";
  for (const c of codes) {
    [...C128[c]].forEach((wd, i) => {
      if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${wd}" height="40"/>`;
      x += +wd;
    });
  }
  return `<svg class="bc" viewBox="0 0 ${x + 10} 40" preserveAspectRatio="none" role="img" aria-label="Barcode ${esc(text)}">${bars}</svg>`;
}

function printLabels(ids) {
  const list = (Array.isArray(ids) && ids.length ? invRows.filter((r) => ids.includes(r.id)) : invRows.filter((r) => r.status !== "sold"));
  if (!list.length) return toast("No cards to print.");
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print labels.", { error: true });
  const fmt = store.get("labelFormat") || "sheet";
  w.document.write(`<!doctype html><title>Labels</title><style>
    body{font:12px/1.3 -apple-system,Segoe UI,Arial,sans-serif;margin:12px} .bar{display:flex;gap:8px;align-items:center;margin-bottom:10px}
    .bar button{font:inherit;padding:6px 10px} .bar button.on{font-weight:700;outline:2px solid #1f8a70}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .l{border:1px dashed #999;border-radius:6px;padding:8px;break-inside:avoid} .sku{font:700 13px monospace} .n{font-weight:600;margin:3px 0}
    .p{font-size:15px;font-weight:700} .bc{display:block;width:100%;height:34px;margin:2px 0}
    body.thermal .grid{display:block} body.thermal .l{width:2.25in;height:1.25in;box-sizing:border-box;border:0;border-radius:0;padding:.06in .1in;page-break-after:always;overflow:hidden}
    body.thermal .n{font-size:10px;max-height:2.6em;overflow:hidden;margin:1px 0} body.thermal .p{font-size:13px} body.thermal .bc{height:.36in}
    @media print{.hint,.bar{display:none} body{margin:0}} @page{margin:.3in} body.thermal{} </style>
    <style id="page"></style>
    <div class="bar"><b>Labels:</b><button id="fmtSheet">Letter sheet (3 across)</button><button id="fmtThermal">Thermal roll 2.25" × 1.25"</button><button id="doPrint">🖨 Print</button></div>
    <p class="hint">The barcode is the card's SKU — scan it into Stock search or Show mode to find the card. (Close this tab when done.)</p>
    <div class="grid">${list.map((r) => `<div class="l">${r.sku ? code128(r.sku) : ""}<div class="sku">${esc(r.sku || "")}</div><div class="n">${esc(r.name)}</div><div>${esc(r.grade)}${r.location ? " · " + esc(r.location) : ""}</div><div class="p">${usd(r.listPrice ?? r.value)}</div></div>`).join("")}</div>`);
  w.document.close();
  // Wired from this page (the pop-up allows no scripts of its own).
  const doc = w.document;
  const setFmt = (f) => {
    store.set("labelFormat", f);
    doc.body.className = f;
    doc.getElementById("page").textContent = f === "thermal" ? "@page{size:2.25in 1.25in;margin:0}" : "";
    doc.getElementById("fmtSheet").className = f === "sheet" ? "on" : "";
    doc.getElementById("fmtThermal").className = f === "thermal" ? "on" : "";
  };
  doc.getElementById("fmtSheet").onclick = () => setFmt("sheet");
  doc.getElementById("fmtThermal").onclick = () => setFmt("thermal");
  doc.getElementById("doPrint").onclick = () => w.print();
  setFmt(fmt);
  w.focus();
}

// ------------------------------------------------------------------ BULK SCAN
// A stack of cards in, inventory rows out: scans (one card or a page of cards per file) are read by the
// lot reader up to 10 files per AI call, every card is cut out of its scan as its own photo, priced from
// recent sales, checked by a person, then added in one go. What each file held is kept on the bot, so
// pausing, a quota stop or closing the app never pays for the same file twice.

const scan = { pages: [], running: false, paused: false, ctrl: null, secsPerFile: null, usd: 0, msg: "", inv: [] };
const fileKey = (f) => `${f.webkitRelativePath || f.name}|${f.size}|${f.lastModified}`;
const scanCards = () => scan.pages.flatMap((p) => p.cards);
const normName = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
/** A card a person should look at before it's added. */
const needsCheck = (c) => c.confidence === "low" || Boolean(c.parallel_check) || Boolean(c.checklist?.note) || /says|no record/.test(c.certNote || "");
/** The display name from the card's fields — the same order the reader uses (lib/jobs.js normalizeRead). */
const nameFromDetails = (d) => [String(d.set || "").startsWith(d.year || "") ? "" : d.year, d.set, d.player, d.number ? "#" + d.number : "", d.parallel, d.serial, d.rookie ? "RC" : "", d.autograph ? "Auto" : "", d.relic ? "Relic" : ""].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
const tagsFromDetails = (d) => [d.rookie && "rookie", d.autograph && "auto", d.relic && "relic", d.serial && "numbered", d.parallel && String(d.parallel).toLowerCase().slice(0, 30)].filter(Boolean);
/** What the card is, as the row keeps it (the website shows these). */
const factsOf = (c) => {
  const d = c.details || {};
  return { year: d.year, set: d.set, player: d.player, number: d.number, parallel: d.parallel, serial: d.serial, team: d.team, rookie: d.rookie, auto: d.autograph, relic: d.relic, cert: c.cert, certVerified: Boolean(c.certVerified) };
};

/**
 * What a person corrected on a scanned card (for the reader's accuracy and its "look twice" notes). Fields fixed
 * in the big view compare one by one; a name typed over in the list is compared by its words, and the card's
 * fields are brought in line with the new name so the website shows what was typed.
 */
function scanFixes(c) {
  const r = c.read;
  if (!r || String(c.uid).startsWith("cert:")) return null;
  const a = r.details || {}, b = (c.details ||= {});
  const n = (x) => String(x ?? "").trim().toLowerCase();
  if (c.name !== r.name && !c.structured) {
    const num = (s) => String(s).match(/#\s*([\w.-]+)/)?.[1] || "";
    const yr = (s) => String(s).match(/\b(19|20)\d{2}(-\d{2})?\b/)?.[0] || "";
    if (n(num(r.name)) !== n(num(c.name))) b.number = num(c.name);
    if (yr(r.name) !== yr(c.name)) b.year = yr(c.name);
    const words = (s) => new Set(normName(s).split(" ").filter(Boolean));
    const before = words(r.name), after = words(c.name);
    const added = [...after].filter((w) => !before.has(w) && !/^\d/.test(w)), removed = [...before].filter((w) => !after.has(w) && !/^\d/.test(w));
    if (added.length || removed.length) {
      if (removed.some((w) => words(a.player).has(w))) b.player = added.join(" ");
      else if (!["rc", "auto", "relic"].some((w) => added.includes(w) || removed.includes(w))) b.parallel = [...[...words(a.parallel)].filter((w) => !removed.includes(w)), ...added].join(" ");
    }
  }
  const fixed = {};
  for (const k of ["player", "number", "parallel", "year", "set"]) if (n(a[k]) !== n(b[k])) fixed[k] = { from: a[k] || "", to: b[k] || "" };
  if (n(r.grade) !== n(c.grade)) fixed.grade = { from: r.grade, to: c.grade };
  return { set: [a.year, a.set].filter(Boolean).join(" "), fixed };
}

async function loadScan() {
  $("#invActions").innerHTML = "";
  [scan.inv, scan.people] = await Promise.all([getJSON("/api/inventory").catch(() => []), getJSON("/api/customers").catch(() => [])]);
  drawScan();
}

function drawScan() {
  const cards = scanCards();
  $("#invBody").innerHTML = `
    <div class="panel">
      <h2 style="margin-top:0">📥 Bulk scan — the whole stack, not a photo per card</h2>
      <ol class="small tight">
        <li><b>Scan</b> the cards into a folder: a sheet-fed card scanner saves each card as its own file (fastest); a flatbed or a phone photo of a binder page gets 8–12 cards in one picture.</li>
        <li><b>Choose the folder</b> (or the files). The bot finds every card, cuts each one out at full resolution and reads it up close — year, set, player, number, parallel, serial, RC, auto, relic, slab grade and cert — then prices it from recent sales. With <b>Backs too</b> it reads each back as well.</li>
        <li><b>Check the list</b>: anything it isn't sure of is flagged with what to look at (e.g. "refractor or base? tilt it under a light"); click a picture to see it big. Set the box and what you paid, and add them all.</li>
      </ol>
      <details class="small"><summary>Which scanner, and tips</summary><ul class="tight">
        <li><b>Sheet-fed card scanners</b> (photo scanners like the Epson FastFoto FF-680W, or a Raven) feed a stack at about a card a second and save front + back. Rollers touch the card: use them for commons and bulk, not for valuable raw cards.</li>
        <li><b>Flatbed</b>: lay 9–12 cards on the glass with a little space between them and a dark sheet behind. Safe for anything; slabs fit too.</li>
        <li><b>Phone</b>: binder pages or cards laid on a dark table, shot straight down in good light. 9-pocket pages read well.</li>
        <li><b>Slabs</b>: scan the barcode on each slab into <b>PSA cert numbers</b> below (with the PSA token in Settings) — PSA's record gives the exact card and grade, no photo needed.</li>
        <li>Name the folder after the box (e.g. "Box 3") — it's suggested as the location.</li>
      </ul></details>
      <div class="row" style="margin-top:.6rem">
        <label class="button primary" for="scanDir">📁 Choose a folder of scans</label><input type="file" id="scanDir" webkitdirectory multiple hidden>
        <label class="button" for="scanFiles">🖼 Choose files</label><input type="file" id="scanFiles" accept="image/*" multiple hidden>
        <button data-camscan title="A webcam or document camera looking down at the cards: one key press per page">📷 Camera</button>
        <button data-phone title="Take the pictures with your phone — they show up here">📱 Phone</button>
        <label class="check small" title="Scan the fronts, flip every card over where it lies, scan again. Each back is matched to its front by position."><input type="checkbox" id="scanDuplex"${store.get("scanDuplex", false) ? " checked" : ""}> <b>Backs too</b>: each picture's backs are the next file (flip the cards in place) — the back gives the number, year and set</label>
      </div>
      <form class="row" data-cert style="margin-top:.4rem"><label>PSA cert numbers <span class="small muted">— scan the slab barcode or type it, Enter</span><input name="cert" inputmode="numeric" autocomplete="off" placeholder="e.g. 81234567"></label></form>
      ${scan.box ? `<p class="small" style="margin:.5rem 0 0">📦 Scanning what came out of <b>${esc(scan.inv.find((r) => r.id === scan.box)?.name || "a box")}</b> — its cost is spread over these cards when you add them. <button class="ghost small" data-unbox>Not from a box</button></p>` : ""}
    </div>
    <div id="scanAcc"></div>
    <div id="scanProg"></div>
    <div id="scanReview">${cards.length ? scanReviewHtml() : ""}</div>`;
  const pickFiles = (e) => {
    const files = [...e.target.files].filter((f) => /^image\/(jpeg|png|webp|gif)$/.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name));
    e.target.value = "";
    if (!files.length) return toast("No JPEG, PNG or WebP images there.", { error: true });
    addScanFiles(files);
  };
  $("#scanDir").onchange = pickFiles;
  $("#scanFiles").onchange = pickFiles;
  $("#scanDuplex").onchange = (e) => store.set("scanDuplex", e.target.checked);
  $("#invBody [data-camscan]").onclick = openScanCamera;
  $("#invBody [data-phone]").onclick = openPhoneLink;
  const unbox = $("#invBody [data-unbox]");
  if (unbox) unbox.onclick = () => { scan.box = null; drawScan(); };
  pollInbox();
  loadScanAccuracy();
  $("[data-cert]").onsubmit = (e) => { e.preventDefault(); const n = e.target.cert.value.replace(/\D/g, ""); e.target.cert.value = ""; if (n) addCert(n); };
  drawScanProgress();
  wireScanReview();
}

/** How often the reader gets each field right, and what it's been told to look twice at. */
async function loadScanAccuracy() {
  const el = $("#scanAcc");
  const a = await getJSON("/api/scan/accuracy").catch(() => null);
  if (!el || !a?.cards) return;
  const f = a.fields, p = (v) => (v == null ? "—" : `${v}%`);
  el.innerHTML = `<details class="panel small"><summary>Reader accuracy: <b>${p(a.allRight)}</b> of the last ${a.cards} scanned cards needed no fix · number ${p(f.number)} · parallel ${p(f.parallel)} · player ${p(f.player)} · grade ${p(f.grade)}</summary>
    ${a.hints.length ? `<p style="margin:.5rem 0 .2rem">Before every scan the reader is told about the mistakes you've fixed most:</p><ul class="tight">${a.hints.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>` : `<p class="muted">No repeated mistakes yet — every fix you make in the list is remembered and told to the reader next time.</p>`}</details>`;
}

/** Phone → this computer: a QR code signs the phone in; its pictures land in the scan. */
async function openPhoneLink() {
  let j;
  try {
    j = await getJSON("/api/scan/phone-link");
  } catch (err) {
    return toast(err.message, { error: true });
  }
  if (!j.share) {
    const body = openModal("📱 Scan with your phone", `<p>The phone sends its pictures to this computer over your home Wi-Fi. Switch that on once:</p>
      <ol class="small"><li><b>⚙ Settings → Share on home network</b>: tick <b>Share</b>, pick a PIN, <b>Save</b>.</li><li>Close the app and open it again.</li><li>Come back here and press <b>📱 Phone</b>.</li></ol>
      <div class="row"><button class="primary" data-set>Open Settings</button></div>`);
    $("[data-set]", body).onclick = () => { modal.close(); openSettings(); };
    return;
  }
  openModal("📱 Scan with your phone", `
    <div class="row" style="align-items:flex-start;flex-wrap:wrap">
      <div class="qr">${j.svg}</div>
      <ol class="small" style="flex:1 1 240px;margin-top:0">
        <li>Phone on the <b>same Wi-Fi</b> as this computer.</li>
        <li>Point the phone's camera at the code and open the link.</li>
        <li>Take a picture of each card (or a binder page). Tick <b>Front + back</b> on the phone to read both sides.</li>
        <li>The pictures show up here in a few seconds and are read like scanned files.</li>
      </ol></div>
    <p class="small muted">The code works for 15 minutes; the phone stays signed in after that.</p>`);
}

/** Pictures from the phone (named …-a front, …-b back, …-s single) join the scan; a front waits 2 minutes for its back. */
let inboxTimer = null, inboxBusy = false;
function pollInbox() {
  if (inboxTimer) return;
  inboxTimer = setInterval(async () => {
    if (invView !== "scan" || !$("#tab-inventory")?.classList.contains("active")) { clearInterval(inboxTimer); inboxTimer = null; return; }
    if (inboxBusy) return;
    inboxBusy = true;
    try {
      const list = await getJSON("/api/scan/inbox");
      if (!list.length) return;
      const byCard = new Map();
      for (const x of list) {
        const m = x.name.match(/^(.*)-([asb])\.jpg$/);
        const e = byCard.get(m ? m[1] : x.name) || {};
        e[m ? m[2] : "s"] = x;
        byCard.set(m ? m[1] : x.name, e);
      }
      const singles = [], pairs = [];
      for (const e of byCard.values()) {
        if (e.s) singles.push(e.s);
        else if (e.a && e.b) pairs.push(e.a, e.b);
        else if (e.a && Date.now() - e.a.at > 120000) singles.push(e.a);
        else if (e.b && !e.a) singles.push(e.b);
      }
      const take = async (x) => {
        const blob = await (await fetch("/api/scan/inbox/" + encodeURIComponent(x.name))).blob();
        await fetch("/api/scan/inbox/" + encodeURIComponent(x.name), { method: "DELETE" });
        return new File([blob], x.name, { type: "image/jpeg", lastModified: Math.round(x.at) });
      };
      const s = await Promise.all(singles.map(take)), p = await Promise.all(pairs.map(take));
      if (s.length) addScanFiles(s, { quiet: true, duplex: false });
      if (p.length) addScanFiles(p, { quiet: true, duplex: true });
      if (s.length || p.length) toast(`📱 ${plural(s.length + p.length / 2, "picture")} from the phone`, { ms: 1500 });
    } catch {
      /* the next tick tries again */
    } finally {
      inboxBusy = false;
    }
  }, 3000);
}

function addScanFiles(files, { quiet = false, duplex: forced = null } = {}) {
  files.sort((a, b) => byNumber(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));
  const duplex = forced ?? (!quiet && $("#scanDuplex")?.checked);
  const have = new Set(scan.pages.map((p) => p.key));
  let added = 0;
  for (let i = 0; i < files.length; i += duplex ? 2 : 1) {
    const key = fileKey(files[i]);
    if (have.has(key)) continue;
    scan.pages.push({ key, file: files[i], back: duplex ? files[i + 1] || null : null, status: "waiting", cards: [] });
    added++;
  }
  // a folder named like a box is the likely location
  const folder = files[0].webkitRelativePath?.split("/")[0];
  if (folder && !scan.location) scan.location = folder;
  if (!quiet) toast(`${plural(added, duplex ? "card" : "file")} added to the scan${added < files.length / (duplex ? 2 : 1) ? " (the rest were already in it)" : ""}`);
  runScan();
}

function drawScanProgress() {
  const el = $("#scanProg");
  if (!el) return;
  const p = scan.pages.filter((x) => x.file);
  if (!p.length) return (el.innerHTML = "");
  const done = p.filter((x) => x.status === "done").length, waiting = p.filter((x) => x.status !== "done").length;
  const found = scanCards().length, empty = p.filter((x) => x.status === "done" && !x.cards.length).length;
  const eta = scan.secsPerFile && waiting ? Math.ceil((scan.secsPerFile * waiting) / 60) : null;
  el.innerHTML = `<div class="panel">
    <div class="row space"><b>${done} of ${plural(p.length, "file")} read · ${plural(found, "card")} found</b>
      <span class="row" style="margin:0">${scan.running ? `<button class="small" data-pause>⏸ Pause</button>` : waiting ? `<button class="small primary" data-resume>▶ ${done ? "Resume" : "Start"}</button>` : ""}
      <button class="small ghost" data-clearscan title="Empty this list (what was read stays saved on the bot for a month)">Clear</button></span></div>
    <progress max="${p.length}" value="${done}" style="width:100%"></progress>
    <div class="small muted">${scan.running ? `Reading… ${eta ? `about ${eta} min left` : ""}` : waiting ? "Paused" : "All files read"}${empty ? ` · ${plural(empty, "file")} with no card found` : ""}${scan.usd ? ` · AI ≈ $${scan.usd.toFixed(2)} on the paid tier ($0 on the free tier)` : ""}</div>
    ${scan.msg ? `<p class="small ${/Paused/.test(scan.msg) ? "bad" : ""}">${esc(scan.msg)}</p>` : ""}
    <div class="progress small hidden" id="scanSteps"></div></div>`;
  const b = (sel, fn) => { const x = $(sel, el); if (x) x.onclick = fn; };
  b("[data-pause]", () => { scan.paused = true; scan.ctrl?.abort(); });
  b("[data-resume]", () => runScan());
  b("[data-clearscan]", () => { scan.paused = true; scan.ctrl?.abort(); Object.assign(scan, { pages: [], msg: "", usd: 0, location: "" }); drawScan(); });
}

/**
 * Camera station: a document camera (or any webcam) looking straight down. Lay out cards, press Space,
 * swap them, press Space… each shot joins the scan like a scanned file. Uses the camera's full resolution
 * (card numbers need it: a 4K camera reads a 9-card spread, a 1080p webcam is good for 2–4 cards).
 */
async function openScanCamera() {
  if (!navigator.mediaDevices?.getUserMedia) return toast("This computer can't open a camera here.", { error: true });
  let stream = null, shots = 0;
  const body = openModal("📷 Camera scan", `
    <div class="row"><label>Camera<select data-cam></select></label><span class="small muted" data-res></span></div>
    <video data-video autoplay playsinline muted style="width:100%;max-height:60vh;background:#000;border-radius:10px"></video>
    <div class="row"><button class="primary" data-shot>📸 Take picture (Space)</button><span class="small" data-count aria-live="polite">No pictures yet</span></div>
    <p class="small muted">Dark background, cards not touching, camera straight down, no glare. Each picture is read with the rest of the scan.</p>`, { wide: true });
  const video = $("[data-video]", body), sel = $("[data-cam]", body);
  const start = async (deviceId) => {
    stream?.getTracks().forEach((t) => t.stop());
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), width: { ideal: 3840 }, height: { ideal: 2160 } } });
    } catch (err) {
      return ($("[data-res]", body).textContent = `Couldn't open the camera (${err.name === "NotAllowedError" ? "permission denied — allow the camera for Card Research Bot in the system settings" : err.message}).`);
    }
    video.srcObject = stream;
    const s = stream.getVideoTracks()[0].getSettings();
    $("[data-res]", body).textContent = s.width ? `${s.width} × ${s.height}${s.width < 1900 ? " — low for a full page; scan 2–4 cards at a time" : ""}` : "";
    const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
    sel.innerHTML = cams.map((d, i) => `<option value="${esc(d.deviceId)}"${d.deviceId === s.deviceId ? " selected" : ""}>${esc(d.label || "Camera " + (i + 1))}</option>`).join("");
  };
  sel.onchange = () => start(sel.value);
  const shoot = () => {
    if (!video.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    c.toBlob((blob) => {
      if (!blob) return;
      shots++;
      const at = Date.now();
      addScanFiles([new File([blob], `camera-${new Date(at).toLocaleTimeString().replace(/\W/g, "")}-${shots}.jpg`, { type: "image/jpeg", lastModified: at })], { quiet: true });
      $("[data-count]", body).textContent = `${plural(shots, "picture")} taken — swap the cards and go again`;
      video.style.opacity = ".3";
      setTimeout(() => (video.style.opacity = ""), 120);
    }, "image/jpeg", 0.92);
  };
  $("[data-shot]", body).onclick = shoot;
  const key = (e) => { if (e.code === "Space" && modal.open) { e.preventDefault(); shoot(); } };
  document.addEventListener("keydown", key);
  modal.addEventListener("close", () => { stream?.getTracks().forEach((t) => t.stop()); document.removeEventListener("keydown", key); drawScan(); }, { once: true });
  start(store.get("scanCam") || null).then(() => sel.addEventListener("change", () => store.set("scanCam", sel.value)));
}

/** A canvas as the JPEG the server takes. */
const jpegPart = (canvas, q = 0.9) => ({ mediaType: "image/jpeg", data: canvas.toDataURL("image/jpeg", q).split(",")[1] });

/** Cut one card out of its scan; box = [ymin, xmin, ymax, xmax] in 0–1000, null = the whole picture. */
function cropCard(img, box, maxSide) {
  const W = img.naturalWidth, H = img.naturalHeight;
  const [y0, x0, y1, x1] = box || [0, 0, 1000, 1000];
  const py = box ? (y1 - y0) * 0.025 : 0, px = box ? (x1 - x0) * 0.025 : 0; // a sliver of margin so edges aren't clipped
  const sx = Math.max(0, ((x0 - px) / 1000) * W), sy = Math.max(0, ((y0 - py) / 1000) * H);
  const sw = Math.min(W, ((x1 + px) / 1000) * W) - sx, sh = Math.min(H, ((y1 + py) / 1000) * H) - sy;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * k));
  c.height = Math.max(1, Math.round(sh * k));
  c.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/**
 * The backs picture is the same cards flipped over in place, so each card's back sits at its front's position
 * mirrored left↔right (flipped like a page) or top↕bottom. Try both, keep the better fit, pair closest-first.
 */
function matchBacks(fronts, backs) {
  if (fronts.length === 1 && backs.length === 1) return [backs[0]]; // one card per picture (a phone shot)
  const mid = (b) => [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
  const plan = (mirror) => {
    const pairs = [];
    fronts.forEach((f, i) => backs.forEach((b, j) => {
      const [fy, fx] = mid(f), [by, bx] = mid(b);
      pairs.push({ i, j, d: mirror === "x" ? Math.hypot(fy - by, 1000 - fx - bx) : Math.hypot(1000 - fy - by, fx - bx) });
    }));
    pairs.sort((p, q) => p.d - q.d);
    const out = fronts.map(() => null), used = new Set();
    let cost = 0;
    for (const { i, j, d } of pairs) if (out[i] == null && !used.has(j) && d < 150) { out[i] = j; used.add(j); cost += d; }
    return { out, cost: cost + 1000 * out.filter((x) => x == null).length };
  };
  const x = plan("x"), y = plan("y");
  return (x.cost <= y.cost ? x : y).out.map((j) => (j == null ? null : backs[j]));
}

const imageCache = new Map(); // File → decoded picture, while its cards are being cut out
const pictureOf = (file) => { if (!imageCache.has(file)) imageCache.set(file, readAsImage(file)); return imageCache.get(file).then((x) => x.img); };
function forgetPicture(file) {
  const p = file && imageCache.get(file);
  if (!p) return;
  imageCache.delete(file);
  p.then((x) => URL.revokeObjectURL(x.url)).catch(() => {});
}

/** Step 1: where every card is in each picture (and its back, when the backs were scanned as the next file). */
async function locatePages(pages) {
  const files = pages.flatMap((p) => (p.back ? [p.file, p.back] : [p.file]));
  const images = await Promise.all(files.map(async (f) => jpegPart(drawScaled(await pictureOf(f), 1600), 0.85)));
  scan.ctrl = new AbortController();
  const r = await streamPost("/api/scan/locate", { images }, $("#scanSteps") || document.createElement("div"), scan.ctrl);
  scan.usd += r.usage?.usd || 0;
  let i = 0;
  for (const p of pages) {
    const fronts = r.photos[i++]?.boxes || [];
    const backs = p.back ? r.photos[i++]?.boxes || [] : [];
    const paired = p.back ? matchBacks(fronts, backs) : fronts.map(() => null);
    p.slots = fronts.map((box, k) => ({ box, backBox: paired[k] }));
    if (!p.slots.length) { p.status = "done"; p.cards = []; forgetPicture(p.file); forgetPicture(p.back); }
  }
}

/** Step 2: every card's own full-resolution cut-out (+ back) read up close and priced. Whole files per call. */
async function readPages(pages) {
  const cards = [], slots = [];
  for (const p of pages) {
    const img = await pictureOf(p.file), back = p.back ? await pictureOf(p.back) : null;
    for (const sl of p.slots) {
      cards.push({ front: jpegPart(cropCard(img, sl.box, 1400)), back: back && sl.backBox ? jpegPart(cropCard(back, sl.backBox, 1400)) : null });
      slots.push({ key: p.key, box: sl.box, backBox: sl.backBox });
    }
  }
  scan.ctrl = new AbortController();
  const { read } = await streamPost("/api/scan/read", { cards, slots }, $("#scanSteps") || document.createElement("div"), scan.ctrl);
  scan.usd += read.usage?.usd || 0;
  for (const p of pages) await finishPage(p, read.cards.filter((_, i) => slots[i].key === p.key));
}

async function runScan() {
  if (scan.running || needKey()) return;
  scan.running = true;
  scan.paused = false;
  scan.msg = "";
  drawScanProgress();
  try {
    // files read before (an earlier session, or before a pause) come back free
    const saved = await getJSON("/api/scan").catch(() => ({}));
    for (const p of scan.pages) if (p.status === "waiting" && saved[p.key]) await finishPage(p, saved[p.key].cards);
    drawScanProgress();
    while (!scan.paused) {
      const waiting = scan.pages.filter((p) => p.status === "waiting" && p.file);
      if (!waiting.length) break;
      const t0 = Date.now();
      // find the cards in up to 6 pictures at a time, then read whole files, up to 12 cards per call
      const unlocated = waiting.filter((p) => !p.slots).slice(0, 6);
      const batch = [];
      if (!unlocated.length) {
        let n = 0;
        for (const p of waiting) { if (batch.length && n + p.slots.length > 12) break; batch.push(p); n += p.slots.length; }
      }
      const work = unlocated.length ? unlocated : batch;
      work.forEach((p) => (p.status = "reading"));
      try {
        if (unlocated.length) await locatePages(unlocated);
        else {
          await readPages(batch);
          const per = (Date.now() - t0) / 1000 / batch.length;
          scan.secsPerFile = scan.secsPerFile ? scan.secsPerFile * 0.6 + per * 0.4 : per;
        }
        work.forEach((p) => p.status === "reading" && (p.status = "waiting"));
      } catch (err) {
        work.forEach((p) => p.status === "reading" && (p.status = "waiting"));
        scan.paused = true;
        scan.msg = /cancel/i.test(err.message) ? "" : `Paused: ${err.message}${/quota|limit|429/i.test(err.message) ? " Everything read so far is kept — press Resume later (or tomorrow)." : ""}`;
      }
      drawScanProgress();
    }
  } finally {
    scan.running = false;
    scan.ctrl = null;
    drawScanProgress();
  }
}

/** A file's cards → review rows (each with a small cut-out to check by eye). */
async function finishPage(p, cards) {
  p.status = "done";
  p.cards = [];
  if (!cards.length) return;
  let img = null;
  try {
    img = await pictureOf(p.file);
  } catch {
    /* unreadable now — the cards still list, without the picture */
  }
  p.cards = cards.map((c, i) => ({ ...c, read: c.read || { name: c.name, grade: c.grade, details: { ...(c.details || {}) } }, uid: `${p.key}#${i}`, page: p, include: true, thumb: img ? cropCard(img, c.box || null, 220).toDataURL("image/jpeg", 0.75) : null }));
  forgetPicture(p.file);
  forgetPicture(p.back);
  appendScanRows(p.cards);
}

/** Look at a card big (front and back) before trusting the reading. */
async function openScanZoom(c) {
  const pics = [];
  try {
    if (c.page?.file) pics.push(["Front", cropCard(await pictureOf(c.page.file), c.box || null, 1100).toDataURL("image/jpeg", 0.9)]);
    if (c.page?.back && c.backBox) pics.push(["Back", cropCard(await pictureOf(c.page.back), c.backBox, 1100).toDataURL("image/jpeg", 0.9)]);
  } catch {
    /* the file moved: show what was read */
  }
  forgetPicture(c.page?.file);
  forgetPicture(c.page?.back);
  const d = c.details || {};
  const ck = c.checklist;
  const field = (k, label, v = d[k]) => `<label>${label}<input name="${k}" value="${esc(v || "")}"></label>`;
  const body = openModal(c.name, `
    <div class="row" style="align-items:flex-start;flex-wrap:wrap">${pics.map(([k, src]) => `<figure style="margin:0;flex:1 1 300px"><img src="${src}" alt="${k} of ${esc(c.name)}" style="width:100%;border-radius:8px"><figcaption class="small muted">${k}</figcaption></figure>`).join("") || `<p class="muted">No picture.</p>`}</div>
    ${ck?.note ? `<p class="small warn">⚠ ${esc(ck.note)}</p>` : ""}${c.parallel_check ? `<p class="small warn">⚠ Check by eye: ${esc(c.parallel_check)}</p>` : ""}${c.id_notes ? `<p class="small muted">${esc(c.id_notes)}</p>` : ""}${c.certNote ? `<p class="small">${esc(c.certNote)}</p>` : ""}
    <form class="form-grid small" data-fixform style="margin-top:.5rem">
      ${field("year", "Year")}${field("set", "Set")}${field("player", "Player / character")}${field("number", "Card #")}
      <label>Parallel / variant <span class="muted">(blank = base)</span><input name="parallel" value="${esc(d.parallel || "")}"></label>
      ${field("serial", "Serial")}${field("grade", "Grade", c.grade)}
      <div class="row" style="margin:0">${[["rookie", "Rookie"], ["autograph", "Autograph"], ["relic", "Relic / patch"]].map(([k, l]) => `<label class="check"><input type="checkbox" name="${k}"${d[k] ? " checked" : ""}> ${l}</label>`).join("")}</div>
      ${ck?.parallels?.length ? `<div class="span2">Versions of #${esc(ck.number)} in ${esc(ck.set)} (click one): ${ck.parallels.map((p) => `<button type="button" class="small ghost" data-par="${esc(p)}">${esc(p)}</button>`).join(" ")}</div>` : ""}
      <div class="span2 row"><button class="primary">Save and re-price</button><span class="muted">Fixes are remembered: the reader is told to look twice at the same thing next time.</span></div>
    </form>`, { wide: true });
  const form = $("[data-fixform]", body);
  $$("[data-par]", form).forEach((b) => (b.onclick = () => { form.parallel.value = b.dataset.par === "Base" ? "" : b.dataset.par; form.parallel.focus(); }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = Object.fromEntries(new FormData(form));
    const nd = { ...d, year: v.year.trim(), set: v.set.trim(), player: v.player.trim(), number: v.number.trim().replace(/^#/, ""), parallel: v.parallel.trim(), serial: v.serial.trim(), rookie: Boolean(v.rookie), autograph: Boolean(v.autograph), relic: Boolean(v.relic) };
    const changedId = ["number", "player", "parallel", "set", "year"].some((k) => String(nd[k] || "") !== String(d[k] || ""));
    Object.assign(c, { details: nd, grade: v.grade.trim() || "Raw", name: nameFromDetails(nd) || c.name, tags: tagsFromDetails(nd), structured: true, edited: true });
    if (changedId && c.checklist) c.checklist = { ...c.checklist, note: null };
    if (changedId) c.parallel_check = null;
    modal.close();
    const tr = $(`#scanReview tr[data-uid="${CSS.escape(c.uid)}"]`);
    const r = await (await fetch("/api/lot/reprice", json("POST", { name: c.name, grade: c.grade, category: c.category || "other" }))).json().catch(() => ({}));
    if (r.url) Object.assign(c, { value: r.value, url: r.url, matched: r.matched, volume: r.volume, confidence: "high" });
    else Object.assign(c, { value: null, url: null });
    if (tr) tr.outerHTML = scanRowHtml(c);
    scanSummary();
    if (!r.url) toast("Saved — no exact sales page for it; it can be priced later with 💲 Find price.", { ms: 4000 });
  };
}

async function addCert(n) {
  if (!status.psa) return toast("Add your free PSA API token in Settings to look up slabs by cert number.", { error: true });
  if (scan.pages.some((p) => p.key === "cert:" + n)) return toast(`Cert ${n} is already in the list`, { ms: 1500 });
  try {
    const { cert } = await getJSON("/api/psa/cert/" + n);
    if (!cert.found) return toast(`PSA has no record of cert ${n} — check the number.`, { error: true });
    const num = String(cert.grade || "").match(/(\d+(\.\d)?)\s*$/)?.[1];
    const name = [cert.year, cert.brand, cert.subject, cert.cardNumber ? "#" + cert.cardNumber : "", cert.variety].filter(Boolean).join(" ");
    const cat = String(cert.category || "").toLowerCase();
    const category = ["baseball", "basketball", "football", "hockey", "soccer", "pokemon"].find((k) => cat.includes(k)) || (/yu.?gi/.test(cat) ? "yugioh" : /one.?piece/.test(cat) ? "onepiece" : "other");
    const card = { uid: "cert:" + n, name, grade: num ? `PSA ${num}` : "PSA", category, cert: n, certUrl: cert.url, certVerified: true, confidence: "high", certNote: "From PSA's record", position: "slab", include: true, thumb: null, value: null, url: null, details: { year: String(cert.year || ""), set: cert.brand || "", player: cert.subject || "", number: String(cert.cardNumber || ""), parallel: cert.variety || "" } };
    const page = { key: "cert:" + n, file: null, status: "done", cards: [card] };
    card.page = page;
    scan.pages.push(page);
    const pr = await (await fetch("/api/lot/reprice", json("POST", { name, grade: card.grade, category }))).json().catch(() => ({}));
    if (pr.url) Object.assign(card, { value: pr.value, url: pr.url, matched: pr.matched, volume: pr.volume });
    appendScanRows([card]);
    toast(`${name} (${card.grade})${card.value != null ? " — " + usd(card.value) : ""}`, { ms: 2500 });
  } catch (err) {
    toast(err.message, { error: true });
  }
}

function dupNote(c) {
  const have = scan.inv.filter((r) => r.status !== "sold" && ((c.url && r.priceUrl === c.url) || normName(r.name) === normName(c.name)) && normName(r.grade) === normName(c.grade));
  return have.length ? `<span class="chip warn" title="${esc(have.map((r) => `${r.sku} ${r.location ? "· " + r.location : ""}`).join("\n"))}">have ${have.reduce((n, r) => n + r.qty, 0)}</span>` : "";
}
function scanRowHtml(c) {
  const low = needsCheck(c);
  return `<tr data-uid="${esc(c.uid)}" class="${c.include ? "" : "sold"}">
    <td><input type="checkbox" data-inc${c.include ? " checked" : ""} aria-label="Add ${esc(c.name)}"></td>
    <td>${c.thumb ? `<button class="ghost bare" data-zoom title="Look at it big (front and back)"><img class="scan-thumb" src="${c.thumb}" alt="Card picture"></button>` : `<span class="muted small">slab</span>`}</td>
    <td><input data-name value="${esc(c.name)}" aria-label="Card name" class="scan-name">
      <div class="small">${(c.tags || []).map((t) => `<span class="chip">${esc(t)}</span>`).join(" ")}${c.backBox ? ` <span class="chip" title="The back was read too">+ back</span>` : ""}${c.certVerified ? ` <span class="chip good" title="${esc(c.certNote || "")}">✓ PSA</span>` : ""}${c.checklist && !c.checklist.note ? ` <span class="chip good" title="${esc(`#${c.checklist.number} in ${c.checklist.set}`)}">✓ checklist</span>` : ""} <button class="ghost small" data-fix title="Fix what was read, field by field (the reader learns from it)">✎ fix</button></div>
      ${c.checklist?.note ? `<div class="small warn">⚠ ${esc(c.checklist.note)}</div>` : ""}
      ${c.parallel_check ? `<div class="small warn">⚠ Check: ${esc(c.parallel_check)}</div>` : ""}
      ${c.certNote && !c.certVerified ? `<div class="small bad">${esc(c.certNote)}</div>` : c.certNote && /says/.test(c.certNote) ? `<div class="small warn">${esc(c.certNote)}</div>` : ""}
      <div class="small muted">${esc(c.page?.file?.name || "")}${c.position ? " · " + esc(c.position) : ""}${c.condition_note ? " · " + esc(c.condition_note) : ""}${c.cert ? ` · cert ${c.certUrl ? link(c.certUrl, c.cert) : esc(c.cert)}` : ""}</div></td>
    <td><input data-grade value="${esc(c.grade)}" size="7" aria-label="Grade"></td>
    <td><span class="chip ${c.confidence === "high" && !low ? "good" : low ? "bad" : "warn"}" title="How sure the reader is">${low ? "check" : esc(c.confidence || "")}</span> ${dupNote(c)}</td>
    <td class="num" data-val>${usd(c.value)}<div class="small">${c.url ? link(c.url, "sales") : `<span class="muted">no match</span>`}</div></td>
    <td><button class="ghost small" data-reprice title="Changed the name or grade? Re-price it (free, no AI)">↻</button></td></tr>`;
}
function scanReviewHtml() {
  const cards = scanCards();
  const locs = [...new Set(scan.inv.map((r) => r.location).filter(Boolean))].sort(byNumber);
  const boxes = scan.inv.filter((r) => r.kind === "sealed" && r.status !== "sold");
  const box = boxes.find((r) => r.id === scan.box);
  return `<div class="panel">
    <div class="row space"><h3 style="margin:0">Check the cards</h3><span class="small" data-scansum></span></div>
    <div class="row small"><button class="ghost small" data-skiplow>Untick the ones to check</button><button class="ghost small" data-tickall>Tick all</button></div>
    <div class="table-wrap"><table class="scan-table"><tr><th></th><th></th><th>Card</th><th>Grade</th><th>Sure?</th><th class="num">Value</th><th></th></tr>
      <tbody data-scanrows>${cards.map(scanRowHtml).join("")}</tbody></table></div>
    <form class="form-grid" data-scanadd style="margin-top:.8rem">
      <label>Location<input name="location" list="scanLocs" value="${esc(scan.location || "")}" placeholder="Box 3" autocomplete="off"><datalist id="scanLocs">${locs.map((l) => `<option value="${esc(l)}">`).join("")}</datalist></label>
      ${boxes.length ? `<label>Came out of a box <span class="muted small">(its cost is spread over these cards)</span><select name="box" data-boxsel><option value="">— not from a box —</option>${boxes.map((r) => `<option value="${esc(r.id)}"${r.id === scan.box ? " selected" : ""}>${esc(r.name)} — ${usd(r.cost)} each, ${r.qty} left</option>`).join("")}</select></label>` : ""}
      <label>Paid for all of them $ <span class="muted small">(split by value — unpriced cards get $0; price them later and use ÷ Split lot cost to re-split)</span><input name="total" type="number" min="0" step="0.01" placeholder="0" value="${box ? esc(box.cost) : ""}"${box ? " readonly" : ""}></label>
      <label>Status<select name="status">${["in_stock", "listed", "grading"].map((v) => `<option value="${v}">${STATUS_LABEL[v]}</option>`).join("")}</select></label>
      ${(scan.people || []).length ? `<label>Consigned by <span class="muted small">(someone else's cards: no cost; they're paid when each sells)</span><select name="consignorId"><option value="">— our own cards —</option>${scan.people.map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>` : ""}
      <label class="check"><input type="checkbox" name="combine" checked> Copies of the same card go on one row (qty)</label>
      <div class="span2 row"><button class="primary" data-addscan>＋ Add to inventory</button><span class="small muted" data-addprog></span></div>
    </form></div>`;
}
function appendScanRows(cards) {
  if (!cards.length) return;
  const tb = $("#scanReview [data-scanrows]");
  if (!tb) { $("#scanReview").innerHTML = scanReviewHtml(); wireScanReview(); return; }
  tb.insertAdjacentHTML("beforeend", cards.map(scanRowHtml).join(""));
  scanSummary();
}
function scanSummary() {
  const el = $("#scanReview [data-scansum]");
  if (!el) return;
  const on = scanCards().filter((c) => c.include);
  const low = on.filter(needsCheck).length;
  el.innerHTML = `<b>${plural(on.length, "card")}</b> ticked · worth ${usd(on.reduce((n, c) => n + (c.value || 0), 0))}${low ? ` · <span class="bad">${low} to check</span>` : ""}${on.some((c) => c.value == null) ? ` · ${on.filter((c) => c.value == null).length} unpriced (💲 Find prices later)` : ""}`;
  const b = $("#scanReview [data-addscan]");
  if (b && !b.dataset.busy) b.textContent = `＋ Add ${plural(on.length, "card")} to inventory`;
}
function wireScanReview() {
  const box = $("#scanReview");
  if (!box || !$("[data-scanrows]", box)) return;
  const cardOf = (el) => scanCards().find((c) => c.uid === el.closest("tr").dataset.uid);
  // one listener for every row, so rows added while scanning work too
  box.onchange = (e) => {
    const c = e.target.closest("tr[data-uid]") && cardOf(e.target);
    if (!c) return;
    if (e.target.matches("[data-inc]")) { c.include = e.target.checked; e.target.closest("tr").classList.toggle("sold", !c.include); }
    if (e.target.matches("[data-name]")) { c.name = e.target.value.trim(); c.edited = true; }
    if (e.target.matches("[data-grade]")) { c.grade = e.target.value.trim() || "Raw"; c.edited = true; }
    scanSummary();
  };
  box.onclick = async (e) => {
    const t = e.target;
    if (t.matches("[data-skiplow], [data-tickall]")) {
      for (const c of scanCards()) if (t.matches("[data-tickall]") || needsCheck(c)) c.include = t.matches("[data-tickall]");
      $$("tr[data-uid]", box).forEach((tr) => { const c = cardOf(tr); $("[data-inc]", tr).checked = c.include; tr.classList.toggle("sold", !c.include); });
      return scanSummary();
    }
    if (t.matches("[data-reprice]")) {
      const c = cardOf(t), tr = t.closest("tr");
      t.disabled = true;
      const r = await (await fetch("/api/lot/reprice", json("POST", { name: c.name, grade: c.grade, category: c.category || "other" }))).json().catch(() => ({}));
      t.disabled = false;
      if (r.url) Object.assign(c, { value: r.value, url: r.url, matched: r.matched, volume: r.volume, confidence: "high" });
      else toast(r.error || "No clear match — add year, set and number to the name, or add it and use 💲 Find price later.", { error: true });
      tr.outerHTML = scanRowHtml(c);
      scanSummary();
    }
    if (t.closest("[data-zoom]") || t.matches("[data-fix]")) return openScanZoom(cardOf(t));
    if (t.matches("[data-addscan]")) { e.preventDefault(); addScanned(t); }
  };
  $("[data-scanadd]", box).onsubmit = (e) => e.preventDefault(); // Enter in a box doesn't add anything by surprise
  const boxSel = $("[data-boxsel]", box);
  if (boxSel) boxSel.onchange = () => {
    scan.box = boxSel.value || null;
    const b = scan.inv.find((r) => r.id === scan.box), total = $('[name="total"]', box);
    total.value = b ? b.cost : "";
    total.readOnly = Boolean(b);
  };
  scanSummary();
}

async function addScanned(btn) {
  const f = Object.fromEntries(new FormData($("#scanReview [data-scanadd]")));
  const chosen = scanCards().filter((c) => c.include && c.name);
  if (!chosen.length) return toast("Tick the cards to add.", { error: true });
  if (scan.running) return toast("Wait for the scan to finish (or pause it) first.", { error: true });
  const fixes = new Map(chosen.map((c) => [c, scanFixes(c)])); // also brings typed-over names into the card's fields
  const newIds = [];
  // copies of the same card → one row with a quantity (photos from the first copy)
  const groups = [];
  const byKey = new Map();
  for (const c of chosen) {
    const k = f.combine ? `${c.url || normName(c.name)}|${normName(c.grade)}` : c.uid;
    if (byKey.has(k)) byKey.get(k).push(c);
    else { const g = [c]; byKey.set(k, g); groups.push(g); }
  }
  // what was paid for the lot, spread by value (evenly when nothing is priced)
  const total = parseFloat(f.total) || 0;
  const worth = chosen.reduce((n, c) => n + (c.value || 0), 0);
  const costEach = (c) => (!total ? 0 : Math.round((worth > 0 ? (total * (c.value || 0)) / worth : total / chosen.length) * 100) / 100);
  btn.disabled = true;
  btn.dataset.busy = "1";
  const prog = $("#scanReview [data-addprog]");
  let added = 0;
  const doneCards = new Set();
  try {
    for (let i = 0; i < groups.length; i += 20) {
      const items = [];
      for (const g of groups.slice(i, i + 20)) {
        const c = g[0], photos = [];
        try {
          if (c.page.file) {
            const img = await pictureOf(c.page.file);
            photos.push({ data: cropCard(img, c.box || null, 1800).toDataURL("image/jpeg", 0.9), thumb: cropCard(img, c.box || null, 600).toDataURL("image/jpeg", 0.82) });
            if (c.page.back && c.backBox) { const b = await pictureOf(c.page.back); photos.push({ data: cropCard(b, c.backBox, 1800).toDataURL("image/jpeg", 0.9), thumb: cropCard(b, c.backBox, 600).toDataURL("image/jpeg", 0.82) }); }
          }
        } catch {
          /* the card is still added; photos can be added in the editor */
        }
        items.push({
          name: c.name, grade: c.grade || "Raw", category: c.category || "other", qty: g.length,
          cost: f.consignorId ? 0 : Math.round((g.reduce((n, x) => n + costEach(x), 0) / g.length) * 100) / 100,
          ...(f.consignorId ? { consignorId: f.consignorId } : {}),
          value: c.value ?? null, priceUrl: c.url || null, location: f.location || "", status: f.status, purchased: today(),
          tags: c.tags || [],
          facts: factsOf(c),
          notes: [`Scanned ${today()}`, c.condition_note, c.cert ? `cert ${c.cert}${c.certVerified ? " (matches PSA)" : ""}` : "", c.parallel_check ? `check: ${c.parallel_check}` : ""].filter(Boolean).join(" · "),
          photos,
        });
      }
      const r = await fetch("/api/inventory/many", json("POST", { items }));
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Couldn't add them");
      added += j.added;
      newIds.push(...(j.rows || []).map((x) => x.id));
      for (const g of groups.slice(i, i + 20)) g.forEach((c) => doneCards.add(c));
      // free memory for files whose cards are all done
      for (const [file] of imageCache) if (!groups.slice(i + 20).some((g) => g[0].page.file === file || g[0].page.back === file)) forgetPicture(file);
      if (prog) prog.textContent = `Added ${added} of ${groups.length} rows…`;
    }
  } catch (err) {
    toast(`${err.message} — ${added} rows were added before it stopped.`, { error: true });
  }
  // the added cards leave the list, and a file any of them came from is forgotten on the bot (re-reading
  // that folder later reads it again, and the "have 1" chip shows what's already in)
  const keys = scan.pages.filter((p) => p.cards.some((c) => doneCards.has(c))).map((p) => p.key);
  if (keys.length) await fetch("/api/scan", json("DELETE", { keys })).catch(() => {});
  for (const p of scan.pages) p.cards = p.cards.filter((c) => !doneCards.has(c));
  scan.pages = scan.pages.filter((p) => p.cards.length || p.status !== "done");
  delete btn.dataset.busy;
  const fb = [...doneCards].map((c) => fixes.get(c)).filter(Boolean);
  if (fb.length) fetch("/api/scan/feedback", json("POST", { cards: fb })).then(loadScanAccuracy).catch(() => {});
  if (f.box && newIds.length) {
    const r = await fetch(`/api/inventory/${f.box}/open`, json("POST", { pullIds: newIds }));
    const j = await r.json().catch(() => ({}));
    if (r.ok) toast(`📦 ${j.box.name}: ${plural(j.pulls, "card")} worth ${usd(j.value)} out of a ${usd(j.cost)} box`, { ms: 6000 });
    else toast(j.error || "Couldn't record the box opening", { error: true });
    scan.box = null;
  }
  if (added) toast(`Added ${plural(added, "row")} (${plural(doneCards.size, "card")}) to inventory${f.location ? " in " + f.location : ""} ✓`);
  scan.inv = await getJSON("/api/inventory").catch(() => scan.inv);
  drawScan();
}

// ------------------------------------------------------------------ GRADING

/** Raw cards ranked by what grading should add after fees (sold values per grade × odds from the condition). */
async function openGradePicker() {
  const body = openModal("🧮 What to grade next", `
    <form class="row" data-gp><label>Raw cards worth at least $<input name="minRaw" type="number" min="0" value="${esc(store.get("gradeMin", 10))}" style="width:90px"></label><button class="primary">Rank them</button></form>
    <p class="small muted">For each raw card with a sales page: its sold value at PSA 10 / 9 / 8 / 7, the odds of each from the card's condition and centering (rules of thumb — set the condition on your cards for better odds), less eBay fees and your grading cost (Shop settings). Estimates, not promises.</p>
    <div class="progress small hidden" data-gpprog></div><div data-gpout></div>`, { wide: true });
  $("[data-gp]", body).onsubmit = async (e) => {
    e.preventDefault();
    store.set("gradeMin", e.target.minRaw.value);
    let r;
    try {
      r = await streamPost("/api/grading/candidates", { minRaw: e.target.minRaw.value }, $("[data-gpprog]", body), new AbortController());
    } catch (err) {
      return toast(err.message, { error: true });
    }
    $("[data-gpprog]", body).classList.add("hidden");
    const ODDS = { great: "NM, centered", good: "NM, 60/40", off: "NM, off-center", lp: "LP", unknown: "condition not set" };
    $("[data-gpout]", body).innerHTML = r.cards.length ? `<div class="table-wrap" style="max-height:55vh"><table class="small"><tr><th></th><th>Card</th><th class="num">Raw</th><th class="num">PSA 10 / 9 / 8</th><th>Odds from</th><th class="num">Grading adds</th><th class="num">ROI</th></tr>
      ${r.cards.map((c) => `<tr><td><input type="checkbox" data-gid="${esc(c.id)}"${c.gain > 0 ? " checked" : ""} aria-label="Grade ${esc(c.name)}"></td><td>${esc(c.name)}<div class="muted">${esc(c.sku || "")}${c.location ? " · 📍" + esc(c.location) : ""}</div></td><td class="num">${usd(c.raw)}</td><td class="num">${usd(c.values.psa10)} / ${usd(c.values.psa9)} / ${usd(c.values.psa8)}</td><td>${esc(ODDS[c.oddsFrom])} <span class="muted">(${Math.round(c.odds[0] * 100)}% 10s)</span></td><td class="num ${c.gain > 0 ? "pos" : "neg"}">${usd(c.gain)}</td><td class="num">${c.roi}%</td></tr>`).join("")}</table></div>
      <div class="row"><button class="primary" data-mksub>＋ New submission with the ticked cards</button><span class="small muted">grading cost used: ${usd(r.fee)} a card</span></div>`
      : `<p class="muted">No raw cards with a sales page worth that much (and not Moderately Played or worse).</p>`;
    const mk = $("[data-mksub]", body);
    if (mk) mk.onclick = () => { const ids = $$("[data-gid]:checked", body).map((c) => c.dataset.gid); if (!ids.length) return toast("Tick some cards.", { error: true }); openSubmissionEditor(ids); };
  };
}

async function loadGrading() {
  $("#invActions").innerHTML = `<button data-a="new" class="primary">＋ New submission</button><button data-a="pick" title="Your raw cards ranked by what grading should add after fees">🧮 What to grade next</button><button data-a="refresh">↻ Check PSA progress</button>`;
  $("#invActions [data-a=new]").onclick = () => openSubmissionEditor([]);
  $("#invActions [data-a=pick]").onclick = () => openGradePicker();
  $("#invActions [data-a=refresh]").onclick = async (e) => {
    if (!status.psa) return toast("Add a PSA API token in Settings to check progress automatically.", { error: true });
    e.target.disabled = true;
    const r = await (await fetch("/api/submissions/refresh", { method: "POST" })).json();
    toast(`Checked ${r.checked} PSA submission${r.checked === 1 ? "" : "s"}`);
    loadGrading();
  };
  const [subs, inv] = await Promise.all([getJSON("/api/submissions"), getJSON("/api/inventory")]);
  invRows = inv;
  const byId = Object.fromEntries(inv.map((r) => [r.id, r]));
  $("#invBody").innerHTML = subs.length
    ? subs.map((s) => {
        const items = s.itemIds.map((id) => byId[id]).filter(Boolean);
        const daysOut = Math.round((Date.now() - Date.parse(s.sent + "T12:00:00")) / 86400000);
        return `<div class="panel sub" data-id="${esc(s.id)}">
          <div class="row space" style="margin:0">
            <div><b>${esc(s.company)}</b> ${esc(s.service || "")} ${s.number ? `· #${esc(s.number)}` : ""} <span class="chip ${s.status === "complete" ? "good" : "warn"}">${esc(s.status)}</span>
              <div class="small muted">Sent ${esc(day(s.sent))} · ${s.status === "complete" ? `back ${esc(day(s.returned))}` : `${daysOut} days out`} · ${items.length} cards · cost ${usd(s.cost)}${s.addedBy ? " · " + esc(s.addedBy) : ""}</div>
              ${s.progress?.found ? `<div class="small">PSA: <b>${esc(s.progress.stage)}</b>${s.progress.trackingNumber ? ` · tracking ${esc(s.progress.carrier || "")} ${esc(s.progress.trackingNumber)}` : ""} <span class="muted">(checked ${esc(when(s.progress.checked))})</span></div>` : ""}
            </div>
            <div class="actions">
              ${s.status !== "complete" ? `<select data-status aria-label="Status">${["sent", "received", "grading", "shipped"].map((x) => `<option${x === s.status ? " selected" : ""}>${x}</option>`).join("")}</select><button class="primary small" data-back>Cards are back</button>` : ""}
              <button class="ghost small" data-del aria-label="Delete submission">🗑</button>
            </div>
          </div>
          <ul class="tight small">${items.map((r) => `<li>${esc(r.name)} — <b>${esc(r.grade)}</b>${r.status === "grading" ? "" : ` <span class="muted">(${esc(STATUS_LABEL[r.status])})</span>`}</li>`).join("") || "<li class='muted'>No inventory cards attached</li>"}</ul>
        </div>`;
      }).join("")
    : `<div class="empty"><h2>No grading submissions</h2><p>Select cards in <b>Stock</b> → <b>Send selected to grading</b>, or click <b>＋ New submission</b>. When they come back, enter the grades and the bot updates each card's grade, cost basis and value.</p></div>`;
  $$("#invBody .sub").forEach((el) => {
    const s = subs.find((x) => x.id === el.dataset.id);
    const st = $("[data-status]", el);
    if (st) st.onchange = async () => { await fetch("/api/submissions/" + s.id, json("PATCH", { status: st.value })); toast("Status updated", { ms: 1500 }); };
    const back = $("[data-back]", el);
    if (back) back.onclick = () => openReturnDialog(s, s.itemIds.map((id) => byId[id]).filter(Boolean));
    $("[data-del]", el).onclick = () => removeWithUndo("/api/submissions/" + s.id, "submission", loadGrading);
  });
}

function openSubmissionEditor(itemIds) {
  const candidates = invRows.filter((r) => r.status === "in_stock" || itemIds.includes(r.id));
  const body = openModal("New grading submission", `
    <form class="form-grid" data-form>
      <label>Company<select name="company">${opts(COMPANIES, "PSA")}</select></label>
      <label>Service level<input name="service" placeholder="Value, Regular, Express…"></label>
      <label>Submission #<input name="number" placeholder="from the grader (lets PSA progress auto-update)"></label>
      <label>Sent on<input name="sent" type="date" value="${today()}"></label>
      <label>Total cost $<input name="cost" type="number" min="0" step="0.01" placeholder="fees + shipping + insurance"></label>
      <label class="span2">Notes<input name="notes"></label>
      <fieldset class="span2"><legend class="small">Cards in this submission (their share of the cost is added to their cost basis when they come back)</legend>
        <div class="pick-list">${candidates.length ? candidates.map((r) => `<label class="check"><input type="checkbox" name="item" value="${esc(r.id)}"${itemIds.includes(r.id) ? " checked" : ""}> ${esc(r.name)} <span class="muted small">${esc(r.grade)}</span></label>`).join("") : `<p class="small muted">No raw/in-stock cards in inventory — add them first, or save an empty submission.</p>`}</div>
      </fieldset>
      <div class="span2 row"><button class="primary">Save submission</button></div>
    </form>`, { wide: true });
  $("[data-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const f = Object.fromEntries(fd);
    f.itemIds = fd.getAll("item");
    delete f.item;
    await fetch("/api/submissions", json("POST", f));
    modal.close();
    toast(`Submission saved — ${f.itemIds.length} cards marked "at grading"`);
    invView = "grading";
    loadInventory();
  };
}

function openReturnDialog(sub, items) {
  const body = openModal(`Cards back from ${sub.company}`, `
    <form data-form>
      <p class="small">Enter each card's grade (e.g. <b>10</b>, <b>9</b>, <b>8.5</b>, or <b>Authentic</b>). The grading cost (${usd(sub.cost)}) is split across the cards and added to what you paid.</p>
      <div class="table-wrap"><table>${items.map((r) => `<tr><td>${esc(r.name)}</td><td><input name="${esc(r.id)}" placeholder="grade" style="width:110px" aria-label="Grade for ${esc(r.name)}"></td></tr>`).join("") || "<tr><td class='muted'>No cards attached.</td></tr>"}</table></div>
      <div class="row"><button class="primary">Save grades</button></div>
    </form>`);
  $("[data-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const grades = Object.fromEntries(new FormData(e.target));
    await fetch(`/api/submissions/${sub.id}/complete`, json("POST", { grades }));
    modal.close();
    toast("Grades saved — values will refresh at the new grades");
    loadGrading();
  };
}

// ------------------------------------------------------------------ SALES & PROFIT

function barChart(rows, key, label) {
  if (!rows.length) return "";
  const data = [...rows].reverse().slice(-12);
  const max = Math.max(...data.map((r) => Math.abs(r[key])), 1);
  const W = 640, H = 170, B = 22;
  const bw = Math.min(70, (W - 16) / data.length); // a few months shouldn't make giant bars
  const L = (W - bw * data.length) / 2;
  const zero = (H - B) / 2 + 5;
  const hasNeg = data.some((r) => r[key] < 0);
  const base = hasNeg ? zero : H - B;
  const scale = (hasNeg ? zero - 10 : H - B - 10) / max;
  return `<figure style="margin:0"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} by month">
    <line class="grid" x1="0" x2="${W}" y1="${base}" y2="${base}"/>
    ${data.map((r, i) => {
      const h = Math.abs(r[key]) * scale, x = L + i * bw + bw * 0.15, y = r[key] >= 0 ? base - h : base;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(1, h).toFixed(1)}" rx="3" fill="${r[key] >= 0 ? "#1f8a70" : "#c2341b"}"><title>${esc(r.month)}: ${usd(r[key])}</title></rect>
        <text x="${(x + bw * 0.35).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(r.month.slice(5))}/${esc(r.month.slice(2, 4))}</text>`;
    }).join("")}
  </svg><figcaption class="chart-legend"><span style="--c:#1f8a70">${esc(label)} by month</span></figcaption></figure>`;
}

let salesYear = "";
async function loadSales() {
  const a = await getJSON("/api/analytics" + (salesYear ? "?year=" + salesYear : ""));
  $("#invActions").innerHTML = `<select id="salesYear" aria-label="Year"><option value="">All time</option>${(a.years || []).map((y) => `<option value="${y}"${y === salesYear ? " selected" : ""}>${y}</option>`).join("")}</select>
    <a class="button" href="/api/export/sales.csv">⬇ Sales CSV</a>
    <a class="button" href="/api/export/tax.csv?year=${encodeURIComponent(salesYear || new Date().getFullYear())}" title="Every sale and expense for the year, with totals — for your tax preparer">🧾 Tax summary ${esc(salesYear || new Date().getFullYear())}</a>`;
  $("#salesYear").onchange = (e) => { salesYear = e.target.value; loadSales(); };
  const t = a.totals;
  const flipRow = (f) => `<tr><td>${esc(f.name)} <span class="muted small">${esc(f.grade)}</span></td><td class="num">${usd(f.cost)}</td><td class="num">${usd(f.sold)}</td><td class="num ${f.profit >= 0 ? "pos" : "neg"}">${usd(f.profit)}</td><td class="num">${pct(f.roi)}</td><td class="num">${f.days ?? "—"}</td></tr>`;
  const flipTable = (list) => `<div class="table-wrap"><table><tr><th>Card</th><th class="num">Cost</th><th class="num">Sold</th><th class="num">Profit</th><th class="num">ROI</th><th class="num">Days</th></tr>${list.map(flipRow).join("")}</table></div>`;
  $("#invBody").innerHTML = t.sales ? `
    <div class="totals">
      <div><span>Revenue</span><b>${usd(t.revenue)}</b><span>${t.sales} cards sold</span></div>
      <div><span>Profit after fees</span><b class="${t.profit >= 0 ? "pos" : "neg"}">${usd(t.profit)}</b></div>
      <div><span>Expenses</span><b>${usd(t.expenses)}</b></div>
      <div><span>Net profit</span><b class="${t.profit - t.expenses >= 0 ? "pos" : "neg"}">${usd(t.profit - t.expenses)}</b></div>
      <div><span>Average ROI</span><b>${pct(t.avgRoi)}</b><span>avg ${t.avgDaysToSell ?? "—"} days to sell</span></div>
    </div>
    <div class="panel">${barChart(a.monthly, "net", "Net profit")}</div>
    <div class="panel table-wrap"><h3 style="margin-top:0">By month</h3><table><tr><th>Month</th><th class="num">Sales</th><th class="num">Revenue</th><th class="num">Cost of cards</th><th class="num">Fees</th><th class="num">Expenses</th><th class="num">Net</th></tr>
      ${a.monthly.map((m) => `<tr><td>${esc(m.month)}</td><td class="num">${m.sales}</td><td class="num">${usd(m.revenue)}</td><td class="num">${usd(m.cogs)}</td><td class="num">${usd(m.fees)}</td><td class="num">${usd(m.expenses)}</td><td class="num ${m.net >= 0 ? "pos" : "neg"}">${usd(m.net)}</td></tr>`).join("")}</table></div>
    <div class="grid2">
      <div class="panel"><h3 style="margin-top:0">Best flips</h3>${flipTable(a.best)}</div>
      <div class="panel"><h3 style="margin-top:0">Worst flips</h3>${flipTable(a.worst)}</div>
    </div>
    ${a.boxes?.count ? `<div class="panel table-wrap"><h3 style="margin-top:0">📦 Opening boxes</h3>
      <p class="small">${plural(a.boxes.count, "box")} opened for ${usd(a.boxes.cost)} → sold for ${usd(a.boxes.soldFor)} after fees + ${usd(a.boxes.stillWorth)} still in stock = <b class="${a.boxes.result >= 0 ? "pos" : "neg"}">${a.boxes.result >= 0 ? "+" : ""}${usd(a.boxes.result)}</b></p>
      <table><tr><th>Opened</th><th>Box</th><th class="num">Cards kept</th><th class="num">Cost</th><th class="num">Sold for</th><th class="num">Still worth</th><th class="num">Result</th></tr>
      ${a.boxes.recent.map((b) => `<tr><td>${esc(b.at)}</td><td>${esc(b.name)}</td><td class="num">${b.cards}</td><td class="num">${usd(b.cost)}</td><td class="num">${usd(b.soldFor)}</td><td class="num">${usd(b.stillWorth)}</td><td class="num ${b.result >= 0 ? "pos" : "neg"}">${usd(b.result)}</td></tr>`).join("")}</table></div>` : ""}
    <div class="panel table-wrap"><h3 style="margin-top:0">By category</h3><table><tr><th>Category</th><th class="num">Sold</th><th class="num">Revenue</th><th class="num">Profit</th></tr>
      ${a.byCategory.map((c) => `<tr><td>${esc(CAT_LABEL[c.category] || c.category)}</td><td class="num">${c.sales}</td><td class="num">${usd(c.revenue)}</td><td class="num ${c.profit >= 0 ? "pos" : "neg"}">${usd(c.profit)}</td></tr>`).join("")}</table></div>`
    : `<div class="empty"><h2>No sales yet</h2><p>When a card sells, click <b>Sold</b> next to it in <b>Stock</b>. Profit, ROI, fees and days-to-sell show up here automatically.</p></div>`;
}

// ------------------------------------------------------------------ tilt video (refractor shine, surface) inside the editor

function wireVideo(row, body) {
  const box = $("[data-videobox]", body);
  if (!box) return;
  const draw = () => {
    box.innerHTML = row.video
      ? `<video src="/api/photos/${encodeURIComponent(row.id)}/${encodeURIComponent(row.video)}" muted loop playsinline autoplay controls style="max-width:220px;max-height:220px;border-radius:8px"></video>
         <button type="button" class="small ghost" data-delvideo>Remove video</button>`
      : `<button type="button" class="small" data-recvideo>🎞 Record a tilt video</button>
         <label class="button small" for="videoIn">Choose a video</label><input type="file" id="videoIn" accept="video/mp4,video/webm,video/quicktime" hidden>
         <span class="small muted">3 seconds tilting the card under a light — shows refractor shine and the surface. iPhone: Settings → Camera → Formats → Most Compatible.</span>`;
    const del = $("[data-delvideo]", box);
    if (del) del.onclick = async () => { await fetch(`/api/inventory/${row.id}/video`, { method: "DELETE" }); row.video = null; draw(); toast("Video removed"); };
    const rec = $("[data-recvideo]", box);
    if (rec) rec.onclick = () => recordTiltVideo((data) => upload(data));
    const pick = $("#videoIn", box);
    if (pick) pick.onchange = (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (f.size > 25e6) return toast("That video is over 25 MB — a few seconds is plenty.", { error: true });
      const rd = new FileReader();
      rd.onload = () => upload(String(rd.result).replace(/^data:video\/mov/, "data:video/quicktime"));
      rd.readAsDataURL(f);
    };
  };
  const upload = async (data) => {
    toast("Saving the video…", { ms: 1500 });
    const r = await fetch(`/api/inventory/${row.id}/video`, json("POST", { data }));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return toast(j.error || "Couldn't save the video", { error: true });
    row.video = j.video;
    draw();
    toast("Video saved ✓");
  };
  draw();
}

/** Record 3 seconds from a camera (H.264 MP4 where the computer can, else WebM) → onDone(dataUrl). */
async function recordTiltVideo(onDone) {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast("This computer can't record video here — choose a video file instead.", { error: true });
  const type = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { ...(store.get("scanCam") ? { deviceId: store.get("scanCam") } : {}), width: { ideal: 1920 }, height: { ideal: 1080 } } });
  } catch (err) {
    return toast(`Couldn't open the camera (${err.name === "NotAllowedError" ? "permission denied" : err.message}).`, { error: true });
  }
  const layer = openLayer("🎞 Tilt video", `
    <video data-live autoplay playsinline muted style="width:100%;max-height:55vh;background:#000;border-radius:10px"></video>
    <div class="row"><button class="primary" data-go>● Record 3 seconds</button><span class="small" data-msg aria-live="polite">Hold the card under a light; tilt it slowly while it records.</span></div>`, { wide: true });
  const live = $("[data-live]", layer.body);
  live.srcObject = stream;
  layer.dialog.addEventListener("close", () => stream.getTracks().forEach((t) => t.stop()));
  $("[data-go]", layer.body).onclick = (e) => {
    e.target.disabled = true;
    const chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 4_000_000 });
    rec.ondataavailable = (ev) => ev.data.size && chunks.push(ev.data);
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: type.split(";")[0] });
      const rd = new FileReader();
      rd.onload = () => { layer.close(); onDone(rd.result); };
      rd.readAsDataURL(blob);
    };
    rec.start();
    let left = 3;
    $("[data-msg]", layer.body).textContent = `Recording… ${left}`;
    const t = setInterval(() => { left--; $("[data-msg]", layer.body).textContent = left > 0 ? `Recording… ${left}` : "Saving…"; if (left <= 0) { clearInterval(t); rec.stop(); } }, 1000);
  };
}

// ------------------------------------------------------------------ MJC website: photos + description inside the editor

function wireWebExtras(row, body) {
  const strip = $("[data-photos]", body);
  let photos = [...(row.photos || [])];
  const draw = () => {
    strip.innerHTML = photos.map((f, i) => `<div class="pthumb"><img src="/api/photos/${encodeURIComponent(row.id)}/${encodeURIComponent(f)}" alt="photo ${i + 1}">${i === 0 ? `<span class="chip">front</span>` : `<button type="button" class="ghost small" data-first="${esc(f)}" title="Make this the main photo">★</button>`}<button type="button" class="ghost small" data-rm="${esc(f)}" aria-label="Remove photo">×</button></div>`).join("");
    $$("[data-rm]", strip).forEach((b) => (b.onclick = async () => { photos = (await (await fetch(`/api/inventory/${row.id}/photos/${encodeURIComponent(b.dataset.rm)}`, { method: "DELETE" })).json()).photos; draw(); }));
    $$("[data-first]", strip).forEach((b) => (b.onclick = async () => { photos = (await (await fetch(`/api/inventory/${row.id}/photos/order`, json("POST", { photos: [b.dataset.first] }))).json()).photos; draw(); }));
  };
  draw();
  $("#photoIn", body).onchange = async (e) => {
    for (const file of e.target.files) {
      try {
        const { img, url } = await readAsImage(file);
        const data = drawScaled(img, 1800).toDataURL("image/jpeg", 0.9);
        const thumb = drawScaled(img, 600).toDataURL("image/jpeg", 0.82); // what the website's grid shows
        URL.revokeObjectURL(url);
        const r = await fetch(`/api/inventory/${row.id}/photos`, json("POST", { data, thumb }));
        const j = await r.json();
        if (!r.ok) { toast(j.error, { error: true }); break; }
        photos = j.photos;
        draw();
      } catch (err) {
        toast(err.message, { error: true });
      }
    }
    e.target.value = "";
  };
  $("[data-describe]", body).onclick = async (e) => {
    if (needKey()) return;
    e.target.disabled = true;
    e.target.textContent = "Writing…";
    const prog = document.createElement("div");
    prog.className = "progress";
    e.target.closest(".row").after(prog);
    try {
      const r = await streamPost(`/api/inventory/${row.id}/describe`, {}, prog);
      body.querySelector("[name=webDescription]").value = r.description;
      prog.remove();
    } catch (err) {
      toast(err.message, { error: true });
      prog.remove();
    } finally {
      e.target.disabled = false;
      e.target.textContent = "✍ Write it with AI";
    }
  };
}

// ------------------------------------------------------------------ MJC STORE (orders, messages, pricing, setup)

let mjcTab = "orders";
let mjcTickets = []; // the inbox as last loaded — its buttons act on these
let mjcOrders = [];
const ORDER_STATUS = ["paid", "packed", "shipped", "delivered", "refunded", "cancelled"];
async function loadMjc() {
  $("#invActions").innerHTML = `<div class="pills" id="mjcTabs" role="group" aria-label="MJC store section">${[["orders", "📦 Orders"], ["messages", "✉ Messages"], ["reviews", "⭐ Reviews"], ["pip", "❓ Pip couldn't answer"], ["pricing", "📈 Pricing engine"], ["setup", "⚙ Setup"]].map(([v, l]) => `<button data-v="${v}" class="${mjcTab === v ? "active" : ""}" aria-pressed="${mjcTab === v}">${l}</button>`).join("")}</div>`;
  pillGroup("#mjcTabs", (v) => { mjcTab = v; loadMjc(); });
  const m = await getJSON("/api/mjc");
  const head = `<div class="panel mjc-head">
    ${m.configured ? `<div class="row space" style="margin:0"><span>${m.remote ? `<span class="ok">● Connected</span>` : `<span class="bad">● Can't reach the store</span>`} · <b>${m.onSite}</b> card${m.onSite === 1 ? "" : "s"} on the website${m.needsPrice.length ? ` · <span class="warn">${m.needsPrice.length} waiting for a price</span>` : ""}${m.remote ? ` · checkout ${m.remote.checkoutEnabled && m.remote.payments ? `<span class="ok">open</span>` : `<span class="warn">closed</span>`}` : ""}${m.remote?.pip?.today ? ` · Pip today: <b>${m.remote.pip.today.chats || 0}</b> chat${m.remote.pip.today.chats === 1 ? "" : "s"}${m.remote.pip.today.handoffs ? `, ${m.remote.pip.today.handoffs} to the team` : ""}${m.remote.pip.today.degraded ? `, <span class="warn">${m.remote.pip.today.degraded} without AI</span>` : ""}${m.remote.pip.today.chats && m.remote.pip.today.ms ? `, avg ${(m.remote.pip.today.ms / m.remote.pip.today.chats / 1000).toFixed(1)} s` : ""}${m.remote.pip.capped ? ` · <span class="bad">daily chat limit reached</span>` : ""}` : ""}${m.remote?.visits?.week ? ` · this week: <b>${m.remote.visits.week.sessions || 0}</b> visit${m.remote.visits.week.sessions === 1 ? "" : "s"}, ${m.remote.visits.week.card || 0} card view${m.remote.visits.week.card === 1 ? "" : "s"}` : ""}${m.remote?.subscribers != null ? ` · <b>${m.remote.subscribers}</b> on the email list` : ""}${m.remote?.version ? ` · <span class="muted">store v${esc(m.remote.version)}${m.remote.builtAt ? ` (${esc(when(m.remote.builtAt))})` : ""}</span>` : ""}</span>
      <span class="small muted">last sync ${esc(when(m.state.lastSync) || "never")}${m.state.lastSyncError ? ` · <span class="bad">${esc(m.state.lastSyncError)}</span>` : ""} <button class="small" id="mjcSync">↻ Sync now</button></span></div>`
      : `<b>The MJC website isn't connected yet.</b> <span class="small muted">Go to <b>⚙ Setup</b> below — you'll need the store's address and sync key (shown once when the store backend is deployed).</span>`}
  </div>`;
  let bodyHtml = "";
  if (mjcTab === "orders") {
    const orders = (mjcOrders = await getJSON("/api/mjc/orders"));
    bodyHtml = (orders.some((o) => o.status === "paid") ? `<div class="panel row"><button data-picklist>🗂 Pick list for ${plural(orders.filter((o) => o.status === "paid").length, "order")} to ship</button><span class="small muted">every card to pull, by box, with each order's packing advice</span></div>` : "") + (orders.length ? orders.map((o) => `<div class="panel order" data-id="${esc(o.id)}">
        <div class="row space" style="margin:0"><div><b>${esc(o.id)}</b> · ${esc(when(o.created))} · <b>${usd(o.total)}</b> <span class="chip ${o.status === "paid" ? "warn" : o.status === "shipped" || o.status === "delivered" ? "good" : ""}">${esc(o.status)}</span></div>
          <div class="small muted">${esc(o.name || "")} · ${o.email ? link("mailto:" + o.email, o.email) : ""}</div></div>
        <ul class="tight small">${o.items.map((i) => `<li>${esc(i.title)} <span class="muted">${esc(i.grade || "")}</span> — ${usd(i.price)}</li>`).join("")}</ul>
        ${o.hold ? `<div class="small warn" style="margin:.3rem 0">⚠ <b>${esc(o.hold.reason)}</b> — the buyer has paid; look them over (name, address, email) before you ship. <button class="small" data-approve>✓ Checked — OK to ship</button></div>` : ""}
        ${o.gift ? `<div class="small"><span class="chip good">GIFT CARD</span> code <b>${esc(o.gift.code)}</b> for ${usd(o.gift.amount)}${o.gift.to ? ` · for ${esc(o.gift.to)}` : ""} — emailed to the buyer; it works online and at your table.</div>` : ""}
        ${o.fulfillment === "show" && o.pickupShow ? `<div class="small"><span class="chip warn">PICKUP AT A SHOW</span> bring it to <b>${esc(o.pickupShow.name)}</b>${o.pickupShow.date ? ` on ${esc(day(o.pickupShow.date))}` : ""}${o.pickupShow.table ? `, table ${esc(o.pickupShow.table)}` : ""}</div>` : ""}
        ${o.creditUsed?.amount ? `<div class="small muted">${usd(o.creditUsed.amount)} paid with store credit (taken off the customer's balance here)</div>` : ""}
        ${o.fulfillment === "pickup" ? `<div class="small"><span class="chip warn">LOCAL PICKUP</span> the customer chose pickup — email them to arrange it${o.phone ? ` · ${esc(o.phone)}` : ""}</div>` : o.shippingAddress ? `<div class="small"><b>Ship to:</b> ${esc([o.name, o.shippingAddress.line1, o.shippingAddress.line2, `${o.shippingAddress.city || ""}, ${o.shippingAddress.state || ""} ${o.shippingAddress.postal_code || ""}`].filter(Boolean).join(" · "))}${o.phone ? ` · ${esc(o.phone)}` : ""}</div>` : ""}
        ${o.note ? `<div class="small"><b>Note from the customer:</b> ${esc(o.note)}</div>` : ""}
        ${o.discount ? `<div class="small muted">Promo code discount ${usd(o.discount)}${o.tax ? ` · tax ${usd(o.tax)}` : ""}</div>` : o.tax ? `<div class="small muted">Tax ${usd(o.tax)}</div>` : ""}
        <div class="inline-form"><select data-st aria-label="Order status">${ORDER_STATUS.map((s) => `<option${s === o.status ? " selected" : ""}>${s}</option>`).join("")}</select>
          <input data-carrier placeholder="Carrier" value="${esc(o.carrier || "")}" style="width:110px" aria-label="Carrier"><input data-track placeholder="Tracking #" value="${esc(o.tracking || "")}" style="width:200px" aria-label="Tracking number">
          <button class="small primary" data-save>Save — customer sees it</button><a class="button small" data-mail-tracking href="#" title="Opens an email to the customer with the tracking number">✉ Email tracking</a><button class="small" data-slip title="Packing slip with a QR code to track the order">📦 Packing slip</button></div>
      </div>`).join("")
      : `<div class="empty"><h2>No website orders yet</h2><p>When a customer pays on the MJC site, the order shows up here within 5 minutes (and as an alert). The card is marked sold in your inventory automatically.</p><button id="mjcPull">↻ Check now</button></div>`);
  } else if (mjcTab === "messages") {
    const tickets = (mjcTickets = await getJSON("/api/mjc/tickets"));
    const site = m.remote?.siteUrl || "";
    const KIND = { offer: ["💲 Offer", "good"], sell: ["📦 Wants to sell / trade", "warn"], want: ["🎯 Card request", ""], message: ["✉ Message", ""] };
    const mail = (t, subject, text) => `mailto:${t.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`;
    const hi = (t) => `Hi${t.name ? " " + t.name.split(" ")[0] : ""},\n\n`;
    bodyHtml = tickets.length ? tickets.map((t) => {
      const [label, tone] = KIND[t.kind] || KIND.message;
      const link = site && t.cardId ? `${site}/card/${encodeURIComponent(t.cardId)}/x` : "";
      const pct = t.kind === "offer" && t.listPrice ? Math.round((t.amount / t.listPrice) * 100) : null;
      return `<div class="panel ticket ${t.status}" data-id="${esc(t.id)}">
        <div class="row space" style="margin:0"><div><span class="chip ${tone}">${label}</span> <b>${esc(t.name || t.email)}</b> <span class="muted small">${esc(t.email)} · ${esc(when(t.created))}</span> <span class="chip ${t.status === "open" ? "warn" : ""}">${esc(t.status)}</span></div>
          <div class="actions">${t.kind === "offer" ? `<button class="small primary" data-accept title="Sets this card's website price to the offer (fixed) and opens an email to the buyer">Accept → set price &amp; email</button><a class="button small" href="${esc(mail(t, `Your offer on ${t.cardTitle}`, `${hi(t)}Thanks for your offer of $${t.amount} on ${t.cardTitle}. The best we can do is $____.${link ? `\n\nHere's the card: ${link}` : ""}\n\n— MJC`))}">Counter by email</a>` : ""}${t.kind === "want" ? `<button class="small" data-want>🎯 Add to want list</button>` : ""}<a class="button small" href="${esc(mail(t, `Re: your message to MJC (${t.id})`, `\n\n— — —\n${t.message}`))}">Reply by email</a>${t.status !== "closed" ? `<button class="small" data-close>Mark done</button>` : ""}</div></div>
        ${t.kind === "offer" ? `<p><b>$${esc(t.amount)}</b> offered on <b>${esc(t.cardTitle)}</b> ${esc(t.cardGrade || "")} — listed at $${esc(t.listPrice)}${pct ? ` (${pct}% of the price)` : ""}.</p>` : ""}
        ${t.kind === "sell" && (t.count || t.asking) ? `<p class="small">${t.count ? `About <b>${esc(t.count)}</b> card${t.count == 1 ? "" : "s"}` : ""}${t.count && t.asking ? " · " : ""}${t.asking ? `asking <b>$${esc(t.asking)}</b>` : ""}</p>` : ""}
        ${t.kind === "want" && t.maxPrice ? `<p class="small">Would pay up to <b>$${esc(t.maxPrice)}</b></p>` : ""}
        <p style="white-space:pre-wrap">${esc(t.kind === "offer" ? t.message.replace(/^Offer of[^\n]*\n*/, "") : t.message)}</p>
        ${t.photos ? `<div class="row" style="gap:8px;flex-wrap:wrap">${Array.from({ length: t.photos }, (_, n) => `<a href="/api/mjc/tickets/${encodeURIComponent(t.id)}/photos/${n}" target="_blank" rel="noopener"><img src="/api/mjc/tickets/${encodeURIComponent(t.id)}/photos/${n}" alt="Photo ${n + 1} from ${esc(t.name || t.email)}" style="height:120px;border-radius:8px;border:1px solid var(--line)" loading="lazy"></a>`).join("")}</div>` : ""}
        ${t.transcript ? `<details><summary class="small">Chat with Pip before this message</summary><pre class="diag">${esc(t.transcript)}</pre></details>` : ""}
        ${(t.replies || []).length ? `<div class="thread small">${t.replies.map((r) => `<p class="msg ${r.from}"><b>${r.from === "shop" ? esc(r.by || "You") : esc(t.name || "Them")}:</b> ${esc(r.text)} <span class="muted">· ${esc(when(r.at))}</span></p>`).join("")}</div>` : ""}
        ${t.offer ? `<p class="small">Your offer: ${t.offer.cash != null ? `<b>${usd(t.offer.cash)}</b> cash` : ""}${t.offer.cash != null && t.offer.credit != null ? " or " : ""}${t.offer.credit != null ? `<b>${usd(t.offer.credit)}</b> store credit` : ""} — ${t.offer.answer ? `<b class="${t.offer.answer.choice === "decline" ? "neg" : "pos"}">they chose ${esc({ cash: "cash", credit: "store credit", decline: "no thanks" }[t.offer.answer.choice] || t.offer.answer.choice)}</b>${t.offer.answer.choice === "credit" ? ` <button class="small" data-givecredit>Give ${usd(t.offer.credit)} store credit</button>` : ""}` : "waiting for their answer"}</p>` : ""}
        <form class="inline-form" data-reply><input name="text" placeholder="Reply — they see it on the website${t.token ? " (and Pip's chat)" : ""} and by email" style="flex:1" aria-label="Reply"><button class="small primary">Send reply</button></form>
        ${t.kind === "sell" && !t.offer?.answer ? `<form class="inline-form" data-offer><span class="small">Offer:</span><input name="cash" type="number" min="0" step="1" placeholder="$ cash" style="width:90px" aria-label="Cash offer"><input name="credit" type="number" min="0" step="1" placeholder="$ credit" style="width:90px" aria-label="Store credit offer"><input name="note" placeholder="note (e.g. credit is 25% more)" style="flex:1" aria-label="Note"><button class="small">Send offer</button></form>` : ""}
      </div>`;
    }).join("")
      : `<div class="empty"><h2>No customer messages</h2><p>Offers on cards, cards people want to sell or trade to you, requests for cards you don't have, and anything a shopper asks Pip to pass on all land here.</p></div>`;
  } else if (mjcTab === "reviews") {
    let list = [];
    try { list = (await getJSON("/api/mjc/reviews")).reviews; } catch (err) { bodyHtml = `<div class="panel bad">${esc(err.message)}</div>`; }
    if (!bodyHtml) bodyHtml = `<div class="panel small">Every buyer whose order shipped can review it (the link is in the delivered email and on the track page). Reviews go up as written. You can <b>reply</b> publicly; you can hide one only if it's spam, abusive, or shows someone's personal details — never because it's negative (that's the FTC's rule, and buyers can tell).</div>` + (list.length ? list.map((r) => `<div class="panel review" data-rid="${esc(r.id)}"><div class="row space" style="margin:0"><span><b class="stars">${"★".repeat(r.rating)}${"☆".repeat(5 - r.rating)}</b> <b>${esc(r.name)}</b> <span class="muted small">${esc(when(r.created))} · order ${esc(r.orderId)}</span>${r.hidden ? ` <span class="chip bad">hidden: ${esc(r.hideReason)}</span>` : ""}</span>
        <span class="row" style="margin:0">${r.hidden ? `<button class="small" data-unhide>Show it again</button>` : `<select data-why aria-label="Why hide it"><option value="">Hide as…</option><option value="spam">spam</option><option value="abuse">abuse</option><option value="personal">personal details</option></select>`}</span></div>
        ${r.text ? `<p>${esc(r.text)}</p>` : ""}<p class="small muted">Bought: ${esc((r.items || []).join(", "))}</p>
        <form class="inline-form" data-rreply><input name="reply" value="${esc(r.reply || "")}" placeholder="Your public reply" style="flex:1" aria-label="Reply"><button class="small">${r.reply ? "Update reply" : "Reply"}</button></form></div>`).join("") : `<div class="empty"><h2>No reviews yet</h2><p>They come in as orders are delivered.</p></div>`);
  } else if (mjcTab === "pip") {
    let qs = [];
    try { qs = (await getJSON("/api/mjc/pip-questions")).questions; } catch (err) { bodyHtml = `<div class="panel bad">${esc(err.message)}</div>`; }
    if (!bodyHtml) bodyHtml = `<div class="panel small">Questions Pip handed to you or couldn't answer (offline), newest first — emails, phone numbers and order numbers are taken out. When the same thing comes up, add the answer to <b>⚙ Setup → Other policies &amp; facts for Pip</b> and Pip will answer it next time.</div>` + (qs.length ? `<div class="panel table-wrap"><table class="small"><tr><th>When</th><th>The question</th><th>Why</th></tr>${qs.map((q) => `<tr><td class="nowrap">${esc(when(q.at))}</td><td>${esc(q.q)}</td><td class="muted">${esc(q.reason)}</td></tr>`).join("")}</table></div>` : `<div class="empty"><h2>Nothing yet</h2><p>Pip has answered everything so far.</p></div>`);
  } else if (mjcTab === "pricing") {
    const p = await getJSON("/api/pricing");
    const s = p.settings;
    bodyHtml = `<div class="panel"><h3 style="margin-top:0">How the website prices are set</h3>
        <p class="small">Every day the engine re-prices each card marked <b>Sell on MJC</b> (with <b>Automatic</b> price) from that grade's real recent sold prices, your cost, how fast the card sells, and how long it's been listed. ${p.model ? esc(p.model.text) : "It hasn't run yet."} ${p.model && !p.model.optimizing ? `Until the site has ${p.model.needSales} sales it uses a steady starting schedule (market price, small weekly markdowns) — that variety is what the model learns from.` : p.model ? "It now chooses prices from what it has learned about your buyers." : ""}</p>
        ${p.model?.health ? `<p class="small muted">Model health: ${p.model.health.holdout ? `on ${p.model.health.holdout.n} unseen listing-days its forecasts scored ${p.model.health.holdout.lossModel} vs ${p.model.health.holdout.lossPrior} for the built-in assumptions (lower is better — ${p.model.health.holdout.better ? "✓ better" : "✗ worse"})` : "the holdout check waits for more data (150 unseen listing-days and 3 sales)"}${p.model.health.calibration ? ` · last 30 days: expected ${p.model.health.calibration.expected} sale${p.model.health.calibration.expected === 1 ? "" : "s"}, saw ${p.model.health.calibration.actual}` : ""} · ${p.model.trusted === false ? `<span class="warn">paused — ${esc(p.model.health.why || "")}</span>` : p.model.optimizing ? `<span class="ok">steering prices</span>` : "learning"}</p>` : ""}
        ${p.lastRun?.feedDown ? `<p class="small bad">⚠ Last run: the sold-price site couldn't be read for ${p.lastRun.fetchErrors} of ${p.lastRun.priced + p.lastRun.skipped.length} cards — prices were held and the engine retries every hour.</p>` : ""}
        ${p.lastRun?.held?.length ? `<p class="small warn">Market jumps held for a day until the feed confirms them: ${p.lastRun.held.map((h) => `${esc(h.name)} (${usd(h.from)} → ${usd(h.to)})`).join(" · ")}</p>` : ""}
        <form class="form-grid" data-pricing>
          <label class="check span2" style="margin:0"><input type="checkbox" name="enabled"${s.enabled ? " checked" : ""}> Re-price automatically every day</label>
          <label>Minimum profit over cost %<input name="minMarginPct" type="number" min="0" max="200" value="${s.minMarginPct}"></label>
          <label>Most a price can move in one day %<input name="maxMovePct" type="number" min="1" max="25" value="${s.maxMovePct}"></label>
          <label>Clearance after (days listed)<input name="clearanceDays" type="number" min="14" max="365" value="${s.clearanceDays}"></label>
          <label>Your return target per month % <span class="muted">(higher = sell faster)</span><input name="monthlyReturnPct" type="number" min="1" max="30" value="${s.monthlyReturnPct}"></label>
          <div class="span2 row"><button class="primary">Save</button><button type="button" id="runPricing">↻ Re-price now</button><span class="small muted">${p.lastRun ? `last run ${esc(when(p.lastRun.at))}: ${p.lastRun.priced} priced, ${p.lastRun.changes.length} changed${p.lastRun.skipped.length ? `, ${p.lastRun.skipped.length} skipped` : ""}` : "never run"} · ${p.observations} training observations</span></div>
        </form>
        ${p.lastRun?.skipped?.length ? `<p class="small warn">Skipped: ${p.lastRun.skipped.map((x) => `${esc(x.name)} (${esc(x.reason)})`).join(" · ")}</p>` : ""}
      </div>
      <div class="panel table-wrap"><h3 style="margin-top:0">Recent price changes</h3>${p.changes.length ? `<table><tr><th>When</th><th>Card</th><th class="num">From</th><th class="num">To</th><th>Why</th></tr>${p.changes.map((c) => `<tr><td class="small nowrap">${esc(when(c.at))}</td><td>${esc(c.name)} <span class="muted small">${esc(c.grade)}</span></td><td class="num">${usd(c.from)}</td><td class="num"><b>${usd(c.to)}</b></td><td class="small">${esc(c.reason)}</td></tr>`).join("")}</table>` : `<p class="muted small">No changes yet.</p>`}</div>`;
  } else {
    const st = m.store || {};
    bodyHtml = `<div class="panel"><h3 style="margin-top:0">1. Connect to the store</h3>
        <p class="small">The store's address and sync key are printed when the MJC backend is deployed (ask Claude to deploy it). The key lets this bot — and only this bot — update the website.</p>
        <form class="form-grid" data-connect>
          <label class="span2">Store API address<input name="apiUrl" value="${esc(m.apiUrl || "")}" placeholder="https://xxxx.lambda-url.us-east-2.on.aws"></label>
          <label class="span2">Sync key <span class="muted">${m.configured ? "(saved — leave blank to keep it)" : ""}</span><input name="token" type="password" autocomplete="off"></label>
          <div class="span2 row"><button class="primary"${m.canEditSettings ? "" : " disabled"}>Connect</button><span data-msg class="small"></span></div>
        </form></div>
      <div class="panel"><h3 style="margin-top:0">2. Store details Pip and checkout use</h3>
        <p class="small">Pip, the website chatbot, answers shoppers from <b>exactly this text</b> — it won't promise anything that isn't here. Write it the way you'd tell a customer.</p>
        <form class="form-grid" data-store>
          <label>Store name<input name="name" value="${esc(st.name || "MJC Sports Cards & Collectibles")}"></label>
          <label>Support email<input name="supportEmail" type="email" value="${esc(st.supportEmail || "")}" placeholder="you@yourdomain.com"></label>
          <label>Shipping charge $<input name="shippingFlat" type="number" min="0" step="0.01" value="${esc(st.shippingFlat ?? "")}" placeholder="e.g. 4.99"></label>
          <label>Free shipping over $<input name="freeShippingOver" type="number" min="0" step="1" value="${esc(st.freeShippingOver ?? "")}" placeholder="blank = never free"></label>
          <label class="span2">About the shop <span class="muted">(the website's front page and its policies page show this; Pip uses it too)</span><textarea name="about" rows="3" placeholder="e.g. A father-and-son card shop out of Michigan. We buy, grade and sell sports cards — every card is photographed and priced from recent sold prices.">${esc(st.about || "")}</textarea></label>
          <label class="span2">Shipping details<textarea name="shipping" rows="2" placeholder="e.g. Ships within 1 business day in a top loader + bubble mailer, tracked. Cards over $250 ship insured with signature.">${esc(st.shipping || "")}</textarea></label>
          <label class="span2">Returns<textarea name="returns" rows="2" placeholder="e.g. Raw cards: returns within 14 days if not as described. Graded slabs: returnable only if damaged in transit.">${esc(st.returns || "")}</textarea></label>
          <label class="span2">Other policies &amp; facts for Pip<textarea name="policies" rows="5" placeholder="Payment methods, whether you buy collections, grading services, local pickup, card shows you'll be at, how to make an offer…">${esc(st.policies || "")}</textarea></label>
          <label class="check span2"><input type="checkbox" name="checkoutEnabled"${st.checkoutEnabled ? " checked" : ""}> Open online checkout (customers can pay with Stripe). Leave off until you've done a test purchase.</label>
          <div class="span2"><b class="small">Checkout options</b></div>
          <label class="check span2"><input type="checkbox" name="localPickup"${st.localPickup ? " checked" : ""}> Offer <b>local pickup</b> (free) as a choice at checkout</label>
          <label class="span2">Pickup note shown to the customer<input name="pickupNote" value="${esc(st.pickupNote || "")}" placeholder="e.g. Saturdays at the Novi card show, or by appointment in Plymouth"></label>
          <label class="check span2"><input type="checkbox" name="promoCodes"${st.promoCodes ? " checked" : ""}> Accept <b>promo codes</b> at checkout (you create the codes in your Stripe dashboard → Product catalog → Coupons)</label>
          <label class="check span2"><input type="checkbox" name="stripeTax"${st.stripeTax ? " checked" : ""}> Charge <b>sales tax</b> automatically with Stripe Tax (turn on Stripe Tax in your Stripe dashboard first)</label>
          <label class="check span2"><input type="checkbox" name="showPickup"${st.showPickup ? " checked" : ""}> Offer <b>pickup at a card show</b> at checkout (your public shows in Shop → Shows, the next 45 days)</label>
          <label class="check span2"><input type="checkbox" name="payLater"${st.payLater ? " checked" : ""}> Say <b>pay over time</b> is available (turn on Affirm / Klarna in your Stripe dashboard → Payment methods first — they then appear on the payment page)</label>
          <label class="check span2"><input type="checkbox" name="creditOnline"${st.creditOnline ? " checked" : ""}> Let customers spend their <b>store credit online</b> with a code (each customer's code is on their page in Shop → Customers)</label>
          <label class="check"><input type="checkbox" name="giftCards"${st.giftCards ? " checked" : ""}> Sell <b>gift cards</b> on the website</label>
          <label>Gift card amounts $<input name="giftAmounts" value="${esc((st.giftAmounts || [25, 50, 100]).join(", "))}" placeholder="25, 50, 100"></label>
          <label class="span2">Check orders over $ before shipping <span class="muted">(they wait with a warning until you OK them; blank = never)</span><input name="reviewOver" type="number" min="0" step="1" value="${esc(st.reviewOver ?? "")}" placeholder="e.g. 500" style="max-width:160px"></label>
          <div class="span2"><b class="small">The website</b></div>
          <label class="check span2"><input type="checkbox" name="showDemo"${st.showDemo === false ? "" : " checked"}> Show the <b>demo</b> parts of the site (example cards, auctions, mystery boxes, sets). Off = a plain shop with only your real cards.</label>
          <label class="check span2"><input type="checkbox" name="emailList"${st.emailList === false ? "" : " checked"}> Let shoppers <b>sign up for emails</b> (new arrivals and price drops). ${m.remote?.subscribers != null ? `<b>${m.remote.subscribers}</b> signed up so far · <a href="/api/mjc/subscribers.csv">⬇ Download the list (CSV)</a> for your email program. Someone asks to stop? <button type="button" class="small ghost" data-unsub>Remove an address</button>` : ""}</label>
          <label>Instagram<input name="social_instagram" value="${esc(st.social?.instagram || "")}" placeholder="https://instagram.com/…"></label>
          <label>eBay store<input name="social_ebay" value="${esc(st.social?.ebay || "")}" placeholder="https://www.ebay.com/str/…"></label>
          <label>Facebook<input name="social_facebook" value="${esc(st.social?.facebook || "")}" placeholder="https://facebook.com/…"></label>
          <label>Whatnot<input name="social_whatnot" value="${esc(st.social?.whatnot || "")}" placeholder="https://www.whatnot.com/user/…"></label>
          <label>TikTok<input name="social_tiktok" value="${esc(st.social?.tiktok || "")}" placeholder="https://tiktok.com/@…"></label>
          <label>YouTube<input name="social_youtube" value="${esc(st.social?.youtube || "")}" placeholder="https://youtube.com/@…"></label>
          <div class="span2 row"><button class="primary">Save &amp; send to the website</button><span data-msg class="small"></span></div>
        </form></div>`;
  }
  $("#invBody").innerHTML = head + bodyHtml;

  const sync = $("#mjcSync");
  if (sync) sync.onclick = async () => { sync.disabled = true; const r = await fetch("/api/mjc/sync", { method: "POST" }); const j = await r.json(); toast(r.ok ? `Synced — ${j.live} card${j.live === 1 ? "" : "s"} on the website` : j.error, { error: !r.ok }); loadMjc(); };
  const pull = $("#mjcPull");
  if (pull) pull.onclick = async () => { pull.disabled = true; const r = await fetch("/api/mjc/orders/pull", { method: "POST" }); const j = await r.json(); toast(r.ok ? `${j.fresh.length} new order${j.fresh.length === 1 ? "" : "s"}` : j.error, { error: !r.ok }); loadMjc(); };
  const pick = $("#invBody [data-picklist]");
  if (pick) pick.onclick = () => printPickList((mjcOrders || []).filter((o) => o.status === "paid"), m.remote?.siteUrl || "");
  $$("#invBody .order").forEach((el) => {
    const slip = $("[data-slip]", el);
    if (slip) slip.onclick = () => printPickList((mjcOrders || []).filter((o) => o.id === el.dataset.id), m.remote?.siteUrl || "", { slips: true });
    $("[data-save]", el).onclick = async () => {
      const r = await fetch("/api/mjc/orders/" + el.dataset.id, json("PATCH", { status: $("[data-st]", el).value, carrier: $("[data-carrier]", el).value, tracking: $("[data-track]", el).value }));
      const j = await r.json().catch(() => ({}));
      toast(r.ok ? (j.emailed?.sent ? "Saved — the customer got an email about it" : "Saved — the customer can see it when they check their order") : j.error, { error: !r.ok });
    };
    const approve = $("[data-approve]", el);
    if (approve) approve.onclick = async () => {
      const r = await fetch("/api/mjc/orders/" + el.dataset.id, json("PATCH", { hold: false }));
      toast(r.ok ? "OK to ship ✓" : (await r.json()).error, { error: !r.ok });
      loadMjc();
    };
    // A ready-to-send shipping email: carrier, tracking number and the site's tracking page.
    const mail = $("[data-mail-tracking]", el);
    if (mail) mail.onclick = (e) => {
      e.preventDefault();
      const o = (mjcOrders || []).find((x) => x.id === el.dataset.id);
      if (!o) return;
      const carrier = $("[data-carrier]", el).value.trim(), tracking = $("[data-track]", el).value.trim();
      if (!tracking) return toast("Type the tracking number first, then Save.", { error: true });
      const site = m.remote?.siteUrl || "";
      const body = `Hi${o.name ? " " + o.name.split(" ")[0] : ""},\n\nYour order ${o.id} is on its way!\n\n${o.items.map((i) => `• ${i.title}${i.grade ? ` (${i.grade})` : ""}`).join("\n")}\n\n${carrier ? carrier + " " : ""}tracking number: ${tracking}${site ? `\nTrack it any time: ${site}/track?order=${encodeURIComponent(o.id)} (with the email you used at checkout)` : ""}\n\nThanks for buying from MJC!`;
      location.href = `mailto:${o.email}?subject=${encodeURIComponent(`Your MJC order ${o.id} has shipped`)}&body=${encodeURIComponent(body)}`;
    };
  });
  $$("#invBody .ticket").forEach((el) => {
    const t = mjcTickets.find((x) => x.id === el.dataset.id);
    const b = $("[data-close]", el);
    if (b) b.onclick = async () => { await fetch("/api/mjc/tickets/" + el.dataset.id, json("PATCH", { status: "closed" })); loadMjc(); };
    const acc = $("[data-accept]", el);
    if (acc) acc.onclick = async () => {
      const amount = t.amount;
      if (!confirm(`Set this card's website price to $${amount} (fixed) so the buyer can check out at that price?\n\nAnyone on the site will see $${amount} — switch the card back to Automatic price later if they don't buy.`)) return;
      const r = await fetch("/api/inventory/" + t.cardId, json("PATCH", { webMode: "fixed", webFixedPrice: amount }));
      if (!r.ok) return toast((await r.json()).error || "That card isn't in your inventory anymore.", { error: true });
      await fetch("/api/mjc/tickets/" + el.dataset.id, json("PATCH", { status: "answered" }));
      const site = m.remote?.siteUrl || "";
      location.href = `mailto:${t.email}?subject=${encodeURIComponent("Your offer was accepted")}&body=${encodeURIComponent(`Hi${t.name ? " " + t.name.split(" ")[0] : ""},\n\nGood news — we accepted your offer of $${amount} on ${t.cardTitle}. It's now $${amount} on our site${site ? `: ${site}/card/${encodeURIComponent(t.cardId)}/x` : ""}.\n\nWhoever checks out first gets it, so grab it soon.\n\n— MJC`)}`;
      toast(`Website price set to $${amount} — it goes up within a minute`);
      setTimeout(loadMjc, 800);
    };
    const rf = $("[data-reply]", el);
    if (rf) rf.onsubmit = async (e) => {
      e.preventDefault();
      const r = await fetch(`/api/mjc/tickets/${el.dataset.id}/reply`, json("POST", { text: rf.text.value }));
      const j = await r.json().catch(() => ({}));
      toast(r.ok ? (j.emailed?.sent ? "Sent — on the website and by email" : "Sent — they see it on the website (email isn't set up yet)") : j.error, { error: !r.ok });
      if (r.ok) loadMjc();
    };
    const of = $("[data-offer]", el);
    if (of) of.onsubmit = async (e) => {
      e.preventDefault();
      const r = await fetch(`/api/mjc/tickets/${el.dataset.id}/offer`, json("POST", Object.fromEntries(new FormData(of))));
      const j = await r.json().catch(() => ({}));
      toast(r.ok ? "Offer sent — they accept or decline on their status page" : j.error, { error: !r.ok });
      if (r.ok) loadMjc();
    };
    const gc = $("[data-givecredit]", el);
    if (gc) gc.onclick = async () => {
      const people = await getJSON("/api/customers");
      let c = people.find((x) => x.email && x.email === String(t.email || "").toLowerCase());
      if (!c) c = await (await fetch("/api/customers", json("POST", { name: t.name || t.email, email: t.email, notes: "Sold us cards (website)" }))).json();
      const r = await fetch(`/api/customers/${c.id}/credit`, json("POST", { amount: t.offer.credit, reason: `Trade-in (website request ${t.id})` }));
      const j = await r.json();
      toast(r.ok ? `${c.name} now has ${usd(j.credit)} store credit` : j.error, { error: !r.ok });
      if (r.ok) await fetch("/api/mjc/tickets/" + el.dataset.id, json("PATCH", { status: "closed" }));
      loadMjc();
    };
    const want = $("[data-want]", el);
    if (want) want.onclick = async () => {
      const r = await fetch("/api/wantlist", json("POST", { name: t.message.slice(0, 200), maxPrice: t.maxPrice || null, notes: `Website request ${t.id} from ${t.email}` }));
      toast(r.ok ? "Added to your want list" : "Couldn't add it", { error: !r.ok });
      if (r.ok) { await fetch("/api/mjc/tickets/" + el.dataset.id, json("PATCH", { status: "answered" })); loadMjc(); }
    };
  });
  $$("#invBody [data-rid]").forEach((el) => {
    const id = el.dataset.rid;
    const send = async (patch, msg) => { const r = await fetch(`/api/mjc/reviews/${encodeURIComponent(id)}`, json("PATCH", patch)); toast(r.ok ? msg : (await r.json()).error, { error: !r.ok }); loadMjc(); };
    const why = $("[data-why]", el);
    if (why) why.onchange = () => why.value && send({ hidden: true, hideReason: why.value }, "Hidden");
    const un = $("[data-unhide]", el);
    if (un) un.onclick = () => send({ hidden: false }, "Shown again");
    $("[data-rreply]", el).onsubmit = (e) => { e.preventDefault(); send({ reply: e.target.reply.value }, "Reply posted"); };
  });
  const pf = $("#invBody [data-pricing]");
  if (pf) {
    pf.onsubmit = async (e) => { e.preventDefault(); const f = Object.fromEntries(new FormData(pf)); f.enabled = pf.elements.enabled.checked; await fetch("/api/pricing/settings", json("PUT", f)); toast("Pricing settings saved"); loadMjc(); };
    $("#runPricing").onclick = async (e) => { e.target.disabled = true; e.target.textContent = "Re-pricing…"; const r = await fetch("/api/pricing/run", { method: "POST" }); const j = await r.json(); toast(r.ok ? `${j.changes.length} price${j.changes.length === 1 ? "" : "s"} changed` : j.error, { error: !r.ok }); loadMjc(); };
  }
  const cf = $("#invBody [data-connect]");
  if (cf) cf.onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch("/api/mjc/connect", json("POST", Object.fromEntries(new FormData(cf))));
    const j = await r.json();
    $("[data-msg]", cf).innerHTML = r.ok ? `<span class="ok">Connected ✓</span>` : `<span class="bad">${esc(j.error)}</span>`;
    if (r.ok) setTimeout(loadMjc, 600);
  };
  const sf = $("#invBody [data-store]");
  // (an inline box, not window.prompt — prompt() silently does nothing inside the desktop app)
  const unsub = $("#invBody [data-unsub]");
  if (unsub) unsub.onclick = () => {
    const body = openModal("Remove from the email list", `<form data-form class="form-grid"><label class="span2">Email address<input name="email" type="email" required placeholder="someone@example.com"></label><div class="span2 row"><button class="primary">Remove</button></div></form>`);
    $("[data-form]", body).onsubmit = async (e) => {
      e.preventDefault();
      const email = new FormData(e.target).get("email").trim().toLowerCase();
      const r = await fetch("/api/mjc/subscribers/" + encodeURIComponent(email), { method: "DELETE" });
      modal.close();
      toast(r.ok ? `${email} removed` : (await r.json()).error, { error: !r.ok });
      if (r.ok) loadMjc();
    };
  };
  if (sf) sf.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(sf));
    for (const k of ["checkoutEnabled", "localPickup", "promoCodes", "stripeTax", "showDemo", "emailList", "showPickup", "payLater", "creditOnline", "giftCards"]) f[k] = sf.elements[k].checked;
    const r = await fetch("/api/mjc/store", json("PUT", f));
    const j = await r.json();
    $("[data-msg]", sf).innerHTML = r.ok ? `<span class="ok">Saved ✓ — Pip and checkout use this now</span>` : `<span class="bad">${esc(j.error)}</span>`;
  };
}

// ------------------------------------------------------------------ SHOW MODE (a quick register for card shows)

let showCart = []; // [{ id, qty, price }]
let showPay = "Cash";
let showCustomer = null; // the buyer, when you pick one (store credit needs it)
async function loadShow() {
  $("#invActions").innerHTML = `<span class="small muted">Scan a label or type a card / SKU, set the price, pick how they paid, Complete sale. Each card is marked sold on "Card show".</span>`;
  const [rows, show, people] = await Promise.all([getJSON("/api/inventory"), getJSON("/api/show"), getJSON("/api/customers").catch(() => [])]);
  invRows = rows;
  const buyer = people.find((c) => c.id === showCustomer) || null;
  const inStock = rows.filter((r) => r.status !== "sold" && r.qty > 0);
  const byId = Object.fromEntries(inStock.map((r) => [r.id, r]));
  showCart = showCart.filter((l) => byId[l.id]);
  const total = showCart.reduce((n, l) => n + (parseFloat(l.price) || 0) * l.qty, 0);
  const t = show.totals;
  $("#invBody").innerHTML = `
    <div class="show-grid">
      <div class="panel">
        <input type="search" data-scan placeholder="Scan a label or type a card name / SKU…" aria-label="Find a card to sell" autocomplete="off" style="width:100%;font-size:1.1rem">
        <div data-matches class="show-matches"></div>
        ${showCart.length ? `<table class="show-cart"><tr><th>Card</th><th class="num">Qty</th><th class="num">Price each</th><th></th></tr>
          ${showCart.map((l, i) => { const r = byId[l.id]; return `<tr data-i="${i}"><td><b>${esc(r.name)}</b><div class="small muted">${esc(r.grade)} · ${esc(r.sku || "")}${status.role === "helper" ? "" : ` · paid ${usd(r.cost)}`}${r.value ? ` · value ${usd(r.value)}` : ""}</div></td>
            <td class="num">${r.qty > 1 ? `<select data-qty aria-label="Quantity">${Array.from({ length: Math.min(r.qty, 50) }, (_, k) => `<option${k + 1 === l.qty ? " selected" : ""}>${k + 1}</option>`).join("")}</select>` : "1"}</td>
            <td class="num"><input data-price type="number" min="0" step="0.01" value="${esc(l.price)}" aria-label="Price each" style="width:90px"></td>
            <td><button class="ghost small" data-rm aria-label="Remove">✕</button></td></tr>`; }).join("")}</table>
          <div class="row" style="margin:.5rem 0 0"><label class="small">Customer <span class="muted">(optional)</span> <select data-buyer aria-label="Customer"><option value="">—</option>${people.map((c) => `<option value="${esc(c.id)}"${c.id === showCustomer ? " selected" : ""}>${esc(c.name)}${c.credit ? ` · credit ${usd(c.credit)}` : ""}</option>`).join("")}</select></label>${buyer?.credit ? `<span class="small">has <b>${usd(buyer.credit)}</b> store credit</span>` : ""}</div>
          <div class="row show-pay" role="group" aria-label="Paid with">${(status.payments || ["Cash", "Card", "Venmo"]).map((p) => `<button class="${p === showPay ? "primary" : ""}" data-pay="${esc(p)}" aria-pressed="${p === showPay}">${esc(p)}</button>`).join("")}</div>
          <div class="row space"><span class="show-total">Total <b>${usd(total)}</b></span><button class="primary big" data-complete>✓ Complete sale</button></div>`
          : `<p class="muted small" style="margin-top:.8rem">Nothing in this sale yet.</p>`}
      </div>
      <div class="panel">
        ${status.currentShow ? `<p class="small" style="margin-top:0">🎪 Filed under <b>${esc(status.currentShow.name)}</b>${status.currentShow.table ? ` · table ${esc(status.currentShow.table)}` : ""} — the cash count is in Shop → Shows.</p>` : ""}
        <h3 style="margin-top:0">Today</h3>
        <div class="week-grid"><div><b>${usd(t.total)}</b><span>${t.sales} sale${t.sales === 1 ? "" : "s"} · ${t.cards} card${t.cards === 1 ? "" : "s"}</span></div>
          ${Object.entries(t.byPayment).map(([p, v]) => `<div><b>${usd(v)}</b><span>${esc(p)}</span></div>`).join("")}</div>
        <div class="row"><button class="small" data-copy${t.sales ? "" : " disabled"}>📋 Copy today's summary</button></div>
        ${show.today.length ? `<h3>Sales today</h3>${show.today.map((s, i) => `<div class="att-row"><span class="small muted nowrap">${esc(new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))}</span><span class="small">${s.items.map((x) => `${x.qty > 1 ? x.qty + "× " : ""}${esc(x.name)}`).join(", ")} — <b>${usd(s.total)}</b> ${esc(s.payment)}</span>${i === 0 ? `<button class="small ghost" data-undo="${esc(s.id)}">Undo</button>` : ""}</div>`).join("")}` : ""}
      </div>
    </div>`;
  const scan = $("#invBody [data-scan]");
  scan.focus();
  const add = (r) => {
    const have = showCart.find((l) => l.id === r.id);
    if (have) have.qty = Math.min(r.qty, have.qty + 1);
    else showCart.push({ id: r.id, qty: 1, price: r.listPrice ?? (r.web ? webPrice(r) : null) ?? r.value ?? "" });
    loadShow();
  };
  const matches = () => {
    const q = scan.value.trim().toLowerCase();
    if (!q) return [];
    const words = q.split(/\s+/);
    return inStock.filter((r) => words.every((w) => `${r.name} ${r.grade} ${r.sku || ""} ${r.location || ""}`.toLowerCase().includes(w))).slice(0, 8);
  };
  scan.oninput = () => {
    $("#invBody [data-matches]").innerHTML = matches().map((r) => `<button class="mini-row" data-add="${esc(r.id)}"><span>${esc(r.name)} <span class="muted small">${esc(r.grade)} · ${esc(r.sku || "")} · qty ${r.qty}</span></span><b>${usd(r.listPrice ?? r.value)}</b></button>`).join("");
    $$("#invBody [data-add]").forEach((b) => (b.onclick = () => add(byId[b.dataset.add])));
  };
  // A scanner types the SKU and presses Enter: an exact SKU (or a single match) goes straight into the sale.
  scan.onkeydown = (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const q = scan.value.trim().toLowerCase();
    const hit = inStock.find((r) => r.sku && r.sku.toLowerCase() === q) || (matches().length === 1 ? matches()[0] : null);
    if (hit) add(hit);
    else toast(q ? "No single card matches — pick one from the list" : "Type or scan a card first");
  };
  $$("#invBody tr[data-i]").forEach((tr) => {
    const l = showCart[+tr.dataset.i];
    const q = $("[data-qty]", tr);
    if (q) q.onchange = () => { l.qty = +q.value; loadShow(); };
    $("[data-price]", tr).onchange = (e) => { l.price = e.target.value; loadShow(); };
    $("[data-rm]", tr).onclick = () => { showCart.splice(+tr.dataset.i, 1); loadShow(); };
  });
  $$("#invBody [data-pay]").forEach((b) => (b.onclick = () => { showPay = b.dataset.pay; loadShow(); }));
  const buyerSel = $("#invBody [data-buyer]");
  if (buyerSel) buyerSel.onchange = () => { showCustomer = buyerSel.value || null; loadShow(); };
  const done = $("#invBody [data-complete]");
  if (done) done.onclick = async () => {
    if (showCart.some((l) => !(parseFloat(l.price) >= 0) || l.price === "")) return toast("Every card needs a price.", { error: true });
    done.disabled = true;
    const r = await fetch("/api/show/sale", json("POST", { items: showCart, payment: showPay, customerId: showCustomer }));
    const j = await r.json();
    if (!r.ok) { done.disabled = false; return toast(j.error, { error: true }); }
    showCart = [];
    showCustomer = null;
    toast(`Sold ✓ ${usd(j.sale.total)} (${j.sale.payment})${j.skipped ? ` — ${j.skipped} card${j.skipped === 1 ? " was" : "s were"} already sold` : ""}`);
    loadShow();
  };
  const undo = $("#invBody [data-undo]");
  if (undo) undo.onclick = async () => {
    const r = await fetch(`/api/show/sale/${undo.dataset.undo}/undo`, { method: "POST" });
    toast(r.ok ? "Sale undone — the cards are back in stock" : "Couldn't undo", { error: !r.ok });
    loadShow();
  };
  const copy = $("#invBody [data-copy]");
  if (copy) copy.onclick = async () => {
    const lines = [`Card show — ${new Date().toLocaleDateString()}`, `Total ${usd(t.total)} (${t.sales} sales, ${t.cards} cards)`, ...Object.entries(t.byPayment).map(([p, v]) => `  ${p}: ${usd(v)}`), "", ...show.today.slice().reverse().map((s) => `${new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}  ${usd(s.total)} ${s.payment} — ${s.items.map((x) => `${x.qty > 1 ? x.qty + "× " : ""}${x.name}`).join(", ")}`)];
    await navigator.clipboard.writeText(lines.join("\n"));
    toast("Copied — paste it into a text or email");
  };
}

// ------------------------------------------------------------------ WANT LIST

async function loadWant() {
  $("#invActions").innerHTML = status.ebay ? `<button data-a="scan">🏷 Scan eBay for deals on these</button>` : "";
  const list = await getJSON("/api/wantlist");
  $("#invBody").innerHTML = `
    <div class="panel">
      <h3 style="margin-top:0">Add a card you're hunting</h3>
      <form class="inline-form" data-form>
        <input name="name" type="text" placeholder="Card (year, set, player, #, parallel)" required aria-label="Card" style="width:320px">
        <input name="grade" type="text" placeholder="Grade (Raw, PSA 10…)" aria-label="Grade" style="width:150px">
        <input name="maxPrice" type="number" min="0" step="1" placeholder="Pay up to $" aria-label="Max price">
        <select name="category" aria-label="Category">${Object.keys(CAT_LABEL).map((c) => `<option value="${c}">${esc(CAT_LABEL[c])}</option>`).join("")}</select>
        <input name="notes" type="text" placeholder="Notes" aria-label="Notes" style="width:180px">
        <button class="primary">Add</button>
      </form>
      <p class="small muted">Want-list cards get flagged 🎯 in Quick price, reports, lot evaluations and the deal finder. Tip: from Quick price, click <b>🎯 Want</b> to add the exact card with its sales page linked.</p>
    </div>
    ${list.length ? `<div class="panel table-wrap"><table><tr><th>Card</th><th>Grade</th><th class="num">Pay up to</th><th>Notes</th><th></th></tr>
      ${list.map((w) => `<tr data-id="${esc(w.id)}"><td><b>${esc(w.name)}</b><div class="small muted">${esc(CAT_LABEL[w.category] || "")}${w.priceUrl ? " · " + link(w.priceUrl, "sales") : ""}${w.addedBy ? " · " + esc(w.addedBy) : ""}</div></td>
        <td class="small">${esc(w.grade)}</td><td class="num"><input type="number" min="0" step="1" data-max value="${esc(w.maxPrice ?? "")}" style="width:90px" aria-label="Max price"></td><td class="small">${esc(w.notes)}</td>
        <td class="actions nowrap">${w.priceUrl && status.ebay ? `<button class="small" data-deals>🏷 Deals</button>` : ""}<button class="small ghost" data-del aria-label="Remove">🗑</button></td></tr>`).join("")}</table></div>`
      : `<div class="empty"><h2>Want list is empty</h2><p>Add the cards you're hunting at shows and online. The bot will tell you when one shows up and whether the price beats your max.</p></div>`}`;
  $("#invBody [data-form]").onsubmit = async (e) => {
    e.preventDefault();
    await fetch("/api/wantlist", json("POST", Object.fromEntries(new FormData(e.target))));
    toast("Added to want list");
    loadWant();
  };
  $$("#invBody tr[data-id]").forEach((tr) => {
    const w = list.find((x) => x.id === tr.dataset.id);
    $("[data-max]", tr).onchange = async (e) => { await fetch("/api/wantlist/" + w.id, json("PATCH", { maxPrice: e.target.value })); toast("Saved", { ms: 1200 }); };
    $("[data-del]", tr).onclick = () => removeWithUndo("/api/wantlist/" + w.id, w.name, loadWant);
    const dl = $("[data-deals]", tr);
    if (dl) dl.onclick = () => openDeals({ url: w.priceUrl, grade: w.grade, name: w.name });
  });
  const scan = $("#invActions [data-a=scan]");
  if (scan) scan.onclick = async () => {
    const withUrl = list.filter((w) => w.priceUrl);
    if (!withUrl.length) return toast("Add want-list cards from Quick price (🎯 Want) so they have a sales page to compare against.");
    scan.disabled = true;
    const hits = [];
    for (const w of withUrl) {
      scan.textContent = `Scanning ${hits.length ? hits.length + " found · " : ""}${w.name.slice(0, 30)}…`;
      try {
        const d = await getJSON(`/api/deals?url=${encodeURIComponent(w.priceUrl)}&grade=${encodeURIComponent(w.grade)}`);
        for (const deal of d.deals) if (w.maxPrice == null || deal.total <= w.maxPrice) hits.push({ w, deal, value: d.value });
      } catch {}
    }
    scan.disabled = false;
    scan.textContent = "🏷 Scan eBay for deals on these";
    openModal(`Want-list deals (${hits.length})`, hits.length
      ? `<div class="table-wrap"><table>${hits.map(({ w, deal, value }) => `<tr><td><b>${esc(w.name)}</b> <span class="muted small">${esc(w.grade)} · sold value ${usd(value)}${w.maxPrice != null ? " · your max " + usd(w.maxPrice) : ""}</span><div class="small">${link(deal.url, deal.title)}</div></td><td class="num">${usd(deal.total)}<div class="small pos">${deal.discountPct}% under</div></td></tr>`).join("")}</table></div>`
      : `<p class="muted">Nothing under sold value right now. Try again later — the bot re-checks when you click.</p>`, { wide: true });
  };
}

// Link a card to its sales page: candidates from the free price database, pick one.
async function openFindPrice(row, reload) {
  const body = openModal(`Find price: ${row.name}`, `<p class="muted small">Searching sold-price database…</p>`, { wide: true });
  try {
    const r = await getJSON(`/api/inventory/${row.id}/find-price`);
    body.innerHTML = `<p class="small">Searched for <b>${esc(r.query)}</b> (${esc(row.grade)}). Pick the exact card — parallels are separate entries.</p>
      ${r.candidates.length ? r.candidates.map((c, i) => `<div class="mini-row" data-c="${i}" role="button" tabindex="0"><span><b>${esc(c.name)}</b> <span class="muted small">${esc(c.set)} · raw ${esc(c.ungraded || "—")}</span></span><span class="small ${c.coverage >= 0.8 ? "pos" : "muted"}">${Math.round(c.coverage * 100)}% match</span></div>`).join("") : `<p class="muted">No matches — edit the card name to be more specific (year, set, number) and try again.</p>`}
      <div class="row"><input type="text" data-manual placeholder="…or paste a sportscardspro.com / pricecharting.com card URL" style="flex:1"><button data-attach>Link</button></div>`;
    const attach = async (url) => {
      const res = await fetch(`/api/inventory/${row.id}/attach-price`, json("POST", { url }));
      if (!res.ok) return toast((await res.json()).error, { error: true });
      modal.close();
      toast("Linked — this card now gets valued daily");
      reload();
    };
    $$("[data-c]", body).forEach((el) => { const go = () => attach(r.candidates[+el.dataset.c].url); el.onclick = go; el.onkeydown = (e) => e.key === "Enter" && go(); });
    $("[data-attach]", body).onclick = () => attach($("[data-manual]", body).value.trim());
  } catch (err) {
    body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

async function findPricesBulk(reload) {
  toast("Finding sales pages for unpriced cards…", { ms: 3000 });
  const r = await (await fetch("/api/inventory/find-prices", { method: "POST" })).json();
  reload();
  if (!r.review.length) return toast(`Linked ${r.attached.length} card${r.attached.length === 1 ? "" : "s"}${r.remaining ? ` (${r.remaining} more next run)` : ""}`);
  const body = openModal(`Find prices: ${r.attached.length} linked, ${r.review.length} to check`, `
    ${r.attached.length ? `<details><summary>${r.attached.length} linked automatically</summary><ul class="tight small">${r.attached.map((a) => `<li>${esc(a.name)} → ${esc(a.matched)}</li>`).join("")}</ul></details>` : ""}
    <h3>Pick the right match</h3>
    ${r.review.map((it, i) => `<div class="review-row"><b>${esc(it.name)}</b>${it.error ? `<div class="small bad">${esc(it.error)}</div>` : ""}<div class="row" style="margin:.3rem 0 .6rem">${it.candidates.map((c, j) => `<button class="small" data-pick="${i}:${j}">${esc(c.name)} <span class="muted">${esc(c.set)}</span></button>`).join("") || `<span class="muted small">no candidates — edit the name to include year/set/number</span>`}</div></div>`).join("")}`, { wide: true });
  $$("[data-pick]", body).forEach((b) => (b.onclick = async () => {
    const [i, j] = b.dataset.pick.split(":").map(Number);
    const it = r.review[i];
    b.disabled = true;
    const res = await fetch(`/api/inventory/${it.id}/attach-price`, json("POST", { url: it.candidates[j].url }));
    b.textContent = res.ok ? "✓ Linked" : "✗";
    reload();
  }));
}

// ------------------------------------------------------------------ EXPENSES

async function loadExpenses() {
  $("#invActions").innerHTML = "";
  const [list, shows] = await Promise.all([getJSON("/api/expenses"), getJSON("/api/shows").catch(() => [])]);
  const month = today().slice(0, 7);
  const thisMonth = list.filter((e) => e.date.startsWith(month)).reduce((n, e) => n + e.amount, 0);
  $("#invBody").innerHTML = `
    <div class="panel">
      <h3 style="margin-top:0">Log an expense</h3>
      <form class="inline-form" data-form>
        <input name="date" type="date" value="${today()}" aria-label="Date">
        <select name="kind" aria-label="Type">${opts(EXPENSE_KINDS)}</select>
        <input name="amount" type="number" min="0" step="0.01" placeholder="Amount $" required aria-label="Amount">
        <input name="note" type="text" placeholder="Note (e.g. toploaders, show table)" aria-label="Note" style="width:260px">
        ${shows.length ? `<select name="showId" aria-label="For a card show"><option value="">— not for a show —</option>${shows.slice().reverse().slice(0, 12).map((x) => `<option value="${esc(x.id)}"${x.id === status.currentShow?.id ? " selected" : ""}>${esc(x.name)} · ${esc(day(x.date))}</option>`).join("")}</select>` : ""}
        <input name="receiptHash" type="hidden">
        <button class="primary">Add</button>
        <label class="button ghost" title="Take or choose a photo of a receipt — the AI fills in the expense for you to check">📷 Read a receipt<input type="file" accept="image/*" data-receipt hidden></label>
      </form>
      <div data-receipt-progress class="progress hidden" aria-live="polite"></div>
      <div data-receipt-msg class="small" role="status"></div>
      <p class="small muted">This month: <b>${usd(thisMonth)}</b> · all time: <b>${usd(list.reduce((n, e) => n + e.amount, 0))}</b>. Expenses come off your net profit in <b>Sales &amp; profit</b>.</p>
    </div>
    ${list.length ? `<div class="panel table-wrap"><table><tr><th>Date</th><th>Type</th><th>Note</th><th class="num">Amount</th><th></th></tr>
      ${list.map((e) => `<tr data-id="${esc(e.id)}"><td>${esc(day(e.date))}</td><td>${esc(e.kind)}</td><td class="small">${esc(e.note)}${e.addedBy ? ` <span class="muted">· ${esc(e.addedBy)}</span>` : ""}</td><td class="num">${usd(e.amount)}</td><td><button class="ghost small" data-del aria-label="Delete expense">🗑</button></td></tr>`).join("")}</table></div>` : ""}`;
  $("#invBody [data-form]").onsubmit = async (e) => {
    e.preventDefault();
    await fetch("/api/expenses", json("POST", Object.fromEntries(new FormData(e.target))));
    toast("Expense added");
    loadExpenses();
  };
  $("#invBody [data-receipt]").onchange = async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || needKey()) return;
    const form = $("#invBody [data-form]"), msg = $("#invBody [data-receipt-msg]");
    try {
      const { img, url } = await readAsImage(file);
      const data = drawScaled(img, 1600).toDataURL("image/jpeg", 0.85).split(",")[1];
      URL.revokeObjectURL(url);
      msg.textContent = "";
      const r = await streamPost("/api/expenses/receipt", { images: [{ mediaType: "image/jpeg", data }] }, $("#invBody [data-receipt-progress]"));
      const x = r.receipt;
      if (x.date) form.elements.date.value = x.date;
      if (x.kind) form.elements.kind.value = x.kind;
      if (x.total != null) form.elements.amount.value = x.total;
      form.elements.note.value = [x.vendor, x.note].filter(Boolean).join(" — ").slice(0, 300);
      form.elements.receiptHash.value = r.hash;
      msg.innerHTML = `${r.duplicate ? `<span class="bad">⚠ This receipt looks already logged (${esc(day(r.duplicate.date))}, ${usd(r.duplicate.amount)}). </span>` : ""}${x.total == null ? `<span class="warn">The total couldn't be read — type it in. </span>` : ""}Check the fields and click <b>Add</b>.${x.confidence === "low" ? " <span class=\"warn\">(hard to read — double-check)</span>" : ""}`;
      form.elements.amount.focus();
    } catch (err) {
      msg.innerHTML = `<span class="bad">${esc(err.message)}</span>`;
    }
  };
  $$("#invBody tr[data-id]").forEach((tr) => ($("[data-del]", tr).onclick = () => removeWithUndo("/api/expenses/" + tr.dataset.id, "expense", loadExpenses)));
}
