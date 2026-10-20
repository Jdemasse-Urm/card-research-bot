// Card Research Bot — the business side: Home dashboard, inventory (stock / grading / sales / expenses).
// Uses helpers from app.js ($, esc, usd, getJSON, json, toast, openModal, removeWithUndo, ...).
"use strict";

const STATUS_LABEL = { in_stock: "In stock", listed: "Listed", grading: "At grading", sold: "Sold" };
window.STATUS_LABEL = STATUS_LABEL;
const SELL_PLATFORMS = ["eBay", "TCGplayer", "Whatnot", "Facebook", "MJC site", "Card show", "Local / cash", "Other"];
const webPrice = (r) => (r.webMode === "fixed" ? r.webFixedPrice : r.webPrice);
const EXPENSE_KINDS = ["Supplies", "Shipping", "Grading", "Card show / table", "Fees", "Travel", "Software", "Other"];
const COMPANIES = ["PSA", "BGS", "SGC", "CGC", "TAG", "Other"];
const today = () => new Date().toISOString().slice(0, 10);
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
  const attention = att && (att.items.length || att.unpriced || att.staleValues)
    ? `<div class="panel"><h3 style="margin-top:0">Needs attention</h3>
       ${att.items.slice(0, 8).map((it) => `<div class="att-row"><span class="chip ${it.type === "value_drop" ? "bad" : "warn"}">${esc({ stale_listing: "Stale listing", unlisted_long: "Not listed", value_drop: "Value drop" }[it.type])}</span><span><b>${esc(it.name)}</b> <span class="muted small">${esc(it.grade)}</span><div class="small">${esc(it.text)}</div></span>${it.suggested ? `<button class="small" data-drop="${esc(it.id)}" data-price="${it.suggested}">Set ${usd(it.suggested)}</button>` : ""}</div>`).join("")}
       ${att.unpriced ? `<div class="att-row"><span class="chip">Unpriced</span><span>${att.unpriced} card${att.unpriced > 1 ? "s" : ""} without a sales page — they never get valued.</span><button class="small" data-findprices>Find prices</button></div>` : ""}
       ${att.staleValues ? `<div class="att-row"><span class="chip">Stale</span><span>${att.staleValues} value${att.staleValues > 1 ? "s" : ""} older than a week.</span><button class="small" data-revalue>Re-value</button></div>` : ""}
     </div>` : "";
  $("#dash").innerHTML = welcome + attention + `
    <div class="totals">
      <div><span>Inventory value</span><b>${usd(p.value)}</b><span>${p.cards} cards · paid ${usd(p.cost)}</span></div>
      <div><span>Unrealized profit</span><b class="${unreal >= 0 ? "pos" : "neg"}">${usd(unreal)}</b><span>${p.change30 != null ? `30-day change ${usd(p.change30)}` : "&nbsp;"}</span></div>
      <div><span>Sold this month</span><b>${usd(d.month.revenue)}</b><span>${d.month.sales} cards · profit <span class="${d.month.profit >= 0 ? "pos" : "neg"}">${usd(d.month.profit)}</span></span></div>
      <div><span>In progress</span><b>${d.status.listed} listed</b><span>${d.status.grading} at grading · ${d.status.submissionsOpen} open submissions</span></div>
    </div>
    <div class="dash-grid">
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
        ${d.alerts.length ? `<h3>Alerts</h3>${d.alerts.map((a) => `<div class="small">${a.kind === "brief" ? "☀️ " + esc(a.text) : `🔔 ${esc(a.name)} → ${usd(a.value)} (target ${usd(a.target)})`}</div>`).join("")}<button class="ghost small" data-go="watch" style="margin-top:.4rem">See watchlist →</button>` : ""}
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
  if (adv && $("#dash [data-advice]")) renderAdvice(adv, $("#dash [data-advice]"), { compact: true });
  if ($("#welcomeDismiss")) $("#welcomeDismiss").onclick = () => { store.set("welcomeDone", true); loadDashboard(); };
  $$("#dash [data-step]").forEach((b) => (b.onclick = () => steps[+b.dataset.step][2]()));
  $$("#dash [data-drop]").forEach((b) => (b.onclick = async () => { await fetch("/api/inventory/" + b.dataset.drop, json("PATCH", { listPrice: b.dataset.price })); toast(`List price set to ${usd(+b.dataset.price)} — update it on the marketplace too`); loadDashboard(); }));
  if ($("#dash [data-findprices]")) $("#dash [data-findprices]").onclick = () => findPricesBulk(loadDashboard);
  if ($("#dash [data-revalue]")) $("#dash [data-revalue]").onclick = async (e) => { e.target.disabled = true; await fetch("/api/inventory/refresh", { method: "POST" }); toast("Values refreshed"); loadDashboard(); };
  $("#dash [data-lot]").onclick = () => { goTab("lookup"); $('#lookupMode [data-v="lot"]').click(); };
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
  if (invView === "grading") return loadGrading();
  if (invView === "sales") return loadSales();
  if (invView === "expenses") return loadExpenses();
  if (invView === "want") return loadWant();
  if (invView === "mjc") return loadMjc();
}
TAB_LOADERS.inventory = loadInventory;

// ------------------------------------------------------------------ STOCK

let invRows = [];
const invFilter = { q: "", status: "active", category: "", sort: "added" };

async function loadStock() {
  $("#invActions").innerHTML = `
    <button data-a="add">＋ Add card</button>
    <button data-a="import">⬆ Import CSV</button>
    <button data-a="revalue">↻ Re-value</button>
    <button data-a="findprices" title="Link unpriced cards to their sales pages so they get valued">💲 Find prices</button>
    <button data-a="labels">🏷 Print labels</button>
    <a class="button" href="/api/export/inventory.csv">⬇ CSV</a>`;
  $("#invActions [data-a=add]").onclick = () => openItemEditor();
  $("#invActions [data-a=import]").onclick = openImport;
  $("#invActions [data-a=labels]").onclick = printLabels;
  $("#invActions [data-a=findprices]").onclick = () => findPricesBulk(loadStock);
  $("#invActions [data-a=revalue]").onclick = async (e) => {
    e.target.disabled = true; e.target.textContent = "Re-valuing…";
    const r = await (await fetch("/api/inventory/refresh", { method: "POST" })).json();
    toast(`Updated ${r.updated} values from recent sales`);
    loadStock();
  };
  invRows = await getJSON("/api/inventory");
  drawStock();
}

function drawStock() {
  const stock = invRows.filter((r) => r.status !== "sold");
  const sum = (arr, f) => arr.reduce((n, r) => n + (f(r) || 0), 0);
  const cost = sum(stock, (r) => r.cost * r.qty);
  const value = sum(stock, (r) => (r.value ?? r.cost) * r.qty);
  const cats = [...new Set(invRows.map((r) => r.category))].sort();
  const q = invFilter.q.toLowerCase();
  let rows = invRows.filter((r) =>
    (invFilter.status === "all" || (invFilter.status === "active" ? r.status !== "sold" : r.status === invFilter.status)) &&
    (!invFilter.category || r.category === invFilter.category) &&
    (!q || [r.name, r.sku, r.location, r.grade, (r.tags || []).join(" "), r.notes].join(" ").toLowerCase().includes(q)));
  const sorters = {
    added: (a, b) => (a.added < b.added ? 1 : -1),
    name: (a, b) => a.name.localeCompare(b.name),
    value: (a, b) => (b.value ?? 0) * b.qty - (a.value ?? 0) * a.qty,
    profit: (a, b) => ((b.value ?? b.cost) - b.cost) * b.qty - ((a.value ?? a.cost) - a.cost) * a.qty,
    sku: (a, b) => String(a.sku).localeCompare(String(b.sku)),
  };
  rows = rows.sort(sorters[invFilter.sort] || sorters.added);

  $("#invBody").innerHTML = `
    ${invRows.length ? `<div class="totals">
      <div><span>Cards in stock</span><b>${sum(stock, (r) => r.qty)}</b></div>
      <div><span>Total cost</span><b>${usd(cost)}</b></div>
      <div><span>Value today</span><b>${usd(value)}</b></div>
      <div><span>Unrealized profit</span><b class="${value - cost >= 0 ? "pos" : "neg"}">${usd(value - cost)}</b></div>
    </div>` : ""}
    <div class="panel filters">
      <input type="search" data-f="q" placeholder="Search name, SKU, location, tag…" value="${esc(invFilter.q)}" aria-label="Search inventory">
      <select data-f="status" aria-label="Status">${[["active", "In stock + listed + grading"], ["in_stock", "In stock"], ["listed", "Listed"], ["grading", "At grading"], ["sold", "Sold"], ["all", "Everything"]].map(([v, l]) => `<option value="${v}"${invFilter.status === v ? " selected" : ""}>${l}</option>`).join("")}</select>
      <select data-f="category" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c)}"${invFilter.category === c ? " selected" : ""}>${esc(CAT_LABEL[c] || c)}</option>`).join("")}</select>
      <select data-f="sort" aria-label="Sort">${[["added", "Newest first"], ["value", "Highest value"], ["profit", "Biggest gain"], ["name", "Name A–Z"], ["sku", "SKU"]].map(([v, l]) => `<option value="${v}"${invFilter.sort === v ? " selected" : ""}>${l}</option>`).join("")}</select>
    </div>
    ${rows.length ? `<div class="panel table-wrap"><table class="inv-table">
      <tr><th><input type="checkbox" data-all aria-label="Select all"></th><th>Card</th><th>Grade</th><th class="num">Qty</th><th class="num">Paid</th><th class="num">Value</th><th class="num">P/L</th><th>Status</th><th></th></tr>
      ${rows.map((r) => {
        const pl = r.status === "sold" ? (r.soldPrice != null ? (r.soldPrice - r.cost) * r.qty : null) : r.value != null ? (r.value - r.cost) * r.qty : null;
        return `<tr data-id="${esc(r.id)}" class="${r.status === "sold" ? "sold" : ""}">
          <td><input type="checkbox" data-sel aria-label="Select ${esc(r.name)}"></td>
          <td><b>${esc(r.name)}</b><div class="small muted">${esc(r.sku || "")}${r.location ? " · 📍" + esc(r.location) : ""}${(r.tags || []).length ? " · " + r.tags.map((t) => "#" + esc(t)).join(" ") : ""}${r.priceUrl ? " · " + link(r.priceUrl, "sales") : ""}${r.addedBy ? " · " + esc(r.addedBy) : ""}</div></td>
          <td class="small">${esc(r.grade)}</td><td class="num">${esc(r.qty)}</td>
          <td class="num">${usd(r.cost)}</td>
          <td class="num">${r.status === "sold" ? `sold ${usd(r.soldPrice)}` : r.priceUrl ? usd(r.value) : `<button class="small" data-findprice title="Link to a sales page so this card gets valued">💲 Find price</button>`}<div class="small muted">${r.status === "sold" ? esc(r.soldOn || "") : r.priceUrl ? `${esc(when(r.valuedAt))}${!r.valuedAt || Date.now() - Date.parse(r.valuedAt) > 7 * 86400000 ? ` <span class="chip warn" title="Older than a week">stale</span> <button class="ghost small" data-revalue aria-label="Re-value now">↻</button>` : ""}` : ""}</div></td>
          <td class="num ${pl == null ? "" : pl >= 0 ? "pos" : "neg"}">${usd(pl)}</td>
          <td><span class="chip st-${r.status}">${esc(STATUS_LABEL[r.status])}</span>${r.status === "listed" && r.listedOn ? `<div class="small muted">${esc(r.listedOn)} ${usd(r.listPrice)}</div>` : ""}${r.web && r.status !== "sold" ? `<div><span class="chip st-web" title="${esc(r.webPricingNote || (r.priceLog?.at(-1)?.reason) || "On the MJC website")}">🌐 ${webPrice(r) ? usd(webPrice(r)) : "needs price"}</span></div>` : ""}</td>
          <td class="actions nowrap">${r.status !== "sold" ? `<button class="small" data-sell>Sold</button>` : ""}<button class="small ghost" data-edit aria-label="Edit">✎</button><button class="small ghost" data-del aria-label="Remove">🗑</button></td></tr>`;
      }).join("")}</table>
      <div class="row bulk"><span class="small muted" data-selcount>0 selected</span><button class="small" data-bulk="grading" disabled>Send selected to grading</button><button class="small" data-bulk="labels" disabled>Labels for selected</button><button class="small" data-bulk="web-on" disabled>🌐 Sell selected on MJC</button><button class="small" data-bulk="web-off" disabled>Remove from MJC</button></div></div>`
    : `<div class="empty"><h2>${invRows.length ? "No cards match" : "No inventory yet"}</h2><p>${invRows.length ? "Change the filters above." : "Research a card and click <b>＋ Inventory</b>, add one by hand, or import your existing spreadsheet."}</p></div>`}`;

  $$("#invBody [data-f]").forEach((el) => (el.oninput = () => {
    invFilter[el.dataset.f] = el.value;
    const focus = el.dataset.f === "q";
    drawStock();
    if (focus) { const s = $('#invBody [data-f="q"]'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }
  }));
  const selected = () => $$("#invBody tr[data-id]").filter((tr) => $("[data-sel]", tr).checked).map((tr) => tr.dataset.id);
  const syncBulk = () => {
    const n = selected().length;
    $("#invBody [data-selcount]") && ($("#invBody [data-selcount]").textContent = `${n} selected`);
    $$("#invBody [data-bulk]").forEach((b) => (b.disabled = !n));
  };
  $("#invBody [data-all]") && ($("#invBody [data-all]").onchange = (e) => { $$("#invBody [data-sel]").forEach((c) => (c.checked = e.target.checked)); syncBulk(); });
  $$("#invBody [data-sel]").forEach((c) => (c.onchange = syncBulk));
  $("#invBody [data-bulk=grading]") && ($("#invBody [data-bulk=grading]").onclick = () => openSubmissionEditor(selected()));
  $("#invBody [data-bulk=labels]") && ($("#invBody [data-bulk=labels]").onclick = () => printLabels(selected()));
  for (const on of [true, false]) {
    const b = $(`#invBody [data-bulk=web-${on ? "on" : "off"}]`);
    if (b) b.onclick = async () => {
      const ids = selected();
      b.disabled = true;
      for (const id of ids) await fetch("/api/inventory/" + id, json("PATCH", { web: on }));
      toast(on ? `${ids.length} card${ids.length > 1 ? "s" : ""} going on the MJC website — the pricing engine is setting prices now` : `${ids.length} card${ids.length > 1 ? "s" : ""} taken off the website`);
      setTimeout(loadStock, on ? 2500 : 300);
    };
  }
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
  });
}

function openItemEditor(row = null) {
  const r = row || { name: "", grade: "Raw", qty: 1, cost: "", value: "", category: "other", status: "in_stock", purchased: today(), tags: [] };
  const body = openModal(row ? "Edit card" : "Add a card", `
    <form class="form-grid" data-form>
      <label class="span2">Card name<input name="name" required value="${esc(r.name)}" placeholder="2023 Prizm Victor Wembanyama #136 Silver"></label>
      <label>Grade<input name="grade" value="${esc(r.grade)}" placeholder="Raw, PSA 10, BGS 9.5"></label>
      <label>Category<select name="category">${Object.keys(CAT_LABEL).map((c) => `<option value="${c}"${c === r.category ? " selected" : ""}>${esc(CAT_LABEL[c])}</option>`).join("")}</select></label>
      <label>Qty<input name="qty" type="number" min="1" value="${esc(r.qty)}"></label>
      <label>Paid each $<input name="cost" type="number" min="0" step="0.01" value="${esc(r.cost)}"></label>
      <label>Value each $<input name="value" type="number" min="0" step="0.01" value="${esc(r.value ?? "")}" placeholder="auto from sales page"></label>
      <label>Purchased<input name="purchased" type="date" value="${esc(r.purchased || today())}"></label>
      <label>Status<select name="status">${Object.entries(STATUS_LABEL).map(([v, l]) => `<option value="${v}"${v === r.status ? " selected" : ""}>${l}</option>`).join("")}</select></label>
      <label>Listed on<select name="listedOn"><option value="">—</option>${opts(SELL_PLATFORMS, r.listedOn)}</select></label>
      <label>List price $<input name="listPrice" type="number" min="0" step="0.01" value="${esc(r.listPrice ?? "")}"></label>
      <label>SKU<input name="sku" value="${esc(r.sku || "")}" placeholder="auto"></label>
      <label>Location<input name="location" value="${esc(r.location || "")}" placeholder="Box 3, row 2"></label>
      <label class="span2">Tags (comma separated)<input name="tags" value="${esc((r.tags || []).join(", "))}" placeholder="rookie, flip, PC"></label>
      <label class="span2">Sales page URL (for automatic values)<input name="priceUrl" value="${esc(r.priceUrl || "")}" placeholder="https://www.sportscardspro.com/game/..."></label>
      <label class="span2">Notes <span class="muted">(private — never shown on the website)</span><textarea name="notes" rows="2">${esc(r.notes || "")}</textarea></label>
      <fieldset class="span2 web-box">
        <legend>🌐 MJC website</legend>
        <label class="check"><input type="checkbox" name="web"${r.web ? " checked" : ""}> Sell this card on the MJC website</label>
        <div class="form-grid" style="margin-top:.4rem">
          <label>Price<select name="webMode"><option value="auto"${r.webMode !== "fixed" ? " selected" : ""}>Automatic (pricing engine, daily)</option><option value="fixed"${r.webMode === "fixed" ? " selected" : ""}>Fixed price I set</option></select></label>
          <label>Fixed price $<input name="webFixedPrice" type="number" min="0" step="0.01" value="${esc(r.webFixedPrice ?? "")}" placeholder="only for fixed"></label>
        </div>
        ${row?.web ? `<div class="small" style="margin-top:.4rem">${webPrice(row) ? `On the site at <b>${usd(webPrice(row))}</b>${row.webMarket ? ` · market ${usd(row.webMarket)}` : ""}${row.webLiquidity ? ` · ${esc(row.webLiquidity)}` : ""}` : `<span class="bad">${esc(row.webPricingNote || "Waiting for its first price")}</span>`}
          ${(row.priceLog || []).length ? `<details><summary>Price history (${row.priceLog.length})</summary><ul class="tight small">${row.priceLog.slice(-8).reverse().map((l) => `<li>${esc(when(l.at))}: ${usd(l.from)} → <b>${usd(l.to)}</b> — ${esc(l.reason)}</li>`).join("")}</ul></details>` : ""}</div>` : ""}
        <label style="margin-top:.5rem">Website description <span class="muted">(blank = the research summary)</span><textarea name="webDescription" rows="3">${esc(r.webDescription || "")}</textarea></label>
        ${row ? `<div class="row" style="margin:.3rem 0 0"><button type="button" class="small" data-describe>✍ Write it with AI</button><span class="small muted">uses the card's research report</span></div>
        <div class="photo-strip" data-photos></div>
        <div class="row" style="margin:.3rem 0 0"><label class="button small" for="photoIn">📷 Add photos</label><input type="file" id="photoIn" accept="image/*" multiple hidden><span class="small muted">Front first. Your own photos — up to 8.</span></div>` : `<p class="small muted">Save the card first, then reopen it to add photos.</p>`}
      </fieldset>
      <div class="span2 row"><button class="primary">${row ? "Save" : "Add card"}</button></div>
    </form>`, { wide: true });
  if (row) wireWebExtras(row, body);
  $("[data-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
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
    if ($("#tab-inventory").classList.contains("active")) loadStock();
  };
}

function openSellDialog(row) {
  const body = openModal(`Sold: ${row.name}`, `
    <form class="form-grid" data-form>
      <label>Sold for (each) $<input name="soldPrice" type="number" min="0" step="0.01" required value="${esc(row.listPrice ?? row.value ?? "")}"></label>
      <label>Where<select name="soldOn">${opts(SELL_PLATFORMS, row.listedOn || "eBay")}</select></label>
      <label>Date<input name="soldDate" type="date" value="${today()}"></label>
      <label>Fees $ <span class="muted small">(blank = estimate)</span><input name="fees" type="number" min="0" step="0.01"></label>
      <div class="span2 small muted">Paid ${usd(row.cost)} each × ${row.qty}.</div>
      <div class="span2 row"><button class="primary">Mark sold</button></div>
    </form>`);
  $("[data-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.fees === "") delete f.fees;
    await fetch("/api/inventory/" + row.id, json("PATCH", { ...f, status: "sold" }));
    modal.close();
    const profit = (parseFloat(f.soldPrice) - row.cost) * row.qty;
    toast(`Sold ✓ — ${profit >= 0 ? "profit" : "loss"} ${usd(Math.abs(profit))} before fees`);
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

function printLabels(ids) {
  const list = (Array.isArray(ids) && ids.length ? invRows.filter((r) => ids.includes(r.id)) : invRows.filter((r) => r.status !== "sold"));
  if (!list.length) return toast("No cards to print.");
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print labels.", { error: true });
  w.document.write(`<!doctype html><title>Labels</title><style>
    body{font:12px/1.3 -apple-system,Segoe UI,Arial,sans-serif;margin:12px} .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .l{border:1px dashed #999;border-radius:6px;padding:8px;break-inside:avoid} .sku{font:700 16px monospace} .n{font-weight:600;margin:3px 0}
    .p{font-size:15px;font-weight:700} @media print{.hint{display:none}}</style>
    <p class="hint">Print on plain paper or a label sheet, then cut. (Close this tab when done.)</p>
    <div class="grid">${list.map((r) => `<div class="l"><div class="sku">${esc(r.sku || "")}</div><div class="n">${esc(r.name)}</div><div>${esc(r.grade)}${r.location ? " · " + esc(r.location) : ""}</div><div class="p">${usd(r.listPrice ?? r.value)}</div></div>`).join("")}</div>`);
  w.document.close();
  w.focus();
  w.print();
}

// ------------------------------------------------------------------ GRADING

async function loadGrading() {
  $("#invActions").innerHTML = `<button data-a="new" class="primary">＋ New submission</button><button data-a="refresh">↻ Check PSA progress</button>`;
  $("#invActions [data-a=new]").onclick = () => openSubmissionEditor([]);
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
    <div class="panel table-wrap"><h3 style="margin-top:0">By category</h3><table><tr><th>Category</th><th class="num">Sold</th><th class="num">Revenue</th><th class="num">Profit</th></tr>
      ${a.byCategory.map((c) => `<tr><td>${esc(CAT_LABEL[c.category] || c.category)}</td><td class="num">${c.sales}</td><td class="num">${usd(c.revenue)}</td><td class="num ${c.profit >= 0 ? "pos" : "neg"}">${usd(c.profit)}</td></tr>`).join("")}</table></div>`
    : `<div class="empty"><h2>No sales yet</h2><p>When a card sells, click <b>Sold</b> next to it in <b>Stock</b>. Profit, ROI, fees and days-to-sell show up here automatically.</p></div>`;
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
        URL.revokeObjectURL(url);
        const r = await fetch(`/api/inventory/${row.id}/photos`, json("POST", { data }));
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
const ORDER_STATUS = ["paid", "packed", "shipped", "delivered", "refunded", "cancelled"];
async function loadMjc() {
  $("#invActions").innerHTML = `<div class="pills" id="mjcTabs" role="group" aria-label="MJC store section">${[["orders", "📦 Orders"], ["messages", "✉ Messages"], ["pricing", "📈 Pricing engine"], ["setup", "⚙ Setup"]].map(([v, l]) => `<button data-v="${v}" class="${mjcTab === v ? "active" : ""}" aria-pressed="${mjcTab === v}">${l}</button>`).join("")}</div>`;
  pillGroup("#mjcTabs", (v) => { mjcTab = v; loadMjc(); });
  const m = await getJSON("/api/mjc");
  const head = `<div class="panel mjc-head">
    ${m.configured ? `<div class="row space" style="margin:0"><span>${m.remote ? `<span class="ok">● Connected</span>` : `<span class="bad">● Can't reach the store</span>`} · <b>${m.onSite}</b> card${m.onSite === 1 ? "" : "s"} on the website${m.needsPrice.length ? ` · <span class="warn">${m.needsPrice.length} waiting for a price</span>` : ""}${m.remote ? ` · checkout ${m.remote.checkoutEnabled && m.remote.payments ? `<span class="ok">open</span>` : `<span class="warn">closed</span>`}` : ""}${m.remote?.pip?.today ? ` · Pip today: <b>${m.remote.pip.today.chats || 0}</b> chat${m.remote.pip.today.chats === 1 ? "" : "s"}${m.remote.pip.today.handoffs ? `, ${m.remote.pip.today.handoffs} to the team` : ""}${m.remote.pip.today.degraded ? `, <span class="warn">${m.remote.pip.today.degraded} without AI</span>` : ""}${m.remote.pip.today.chats && m.remote.pip.today.ms ? `, avg ${(m.remote.pip.today.ms / m.remote.pip.today.chats / 1000).toFixed(1)} s` : ""}${m.remote.pip.capped ? ` · <span class="bad">daily chat limit reached</span>` : ""}` : ""}</span>
      <span class="small muted">last sync ${esc(when(m.state.lastSync) || "never")}${m.state.lastSyncError ? ` · <span class="bad">${esc(m.state.lastSyncError)}</span>` : ""} <button class="small" id="mjcSync">↻ Sync now</button></span></div>`
      : `<b>The MJC website isn't connected yet.</b> <span class="small muted">Go to <b>⚙ Setup</b> below — you'll need the store's address and sync key (shown once when the store backend is deployed).</span>`}
  </div>`;
  let bodyHtml = "";
  if (mjcTab === "orders") {
    const orders = await getJSON("/api/mjc/orders");
    bodyHtml = orders.length ? orders.map((o) => `<div class="panel order" data-id="${esc(o.id)}">
        <div class="row space" style="margin:0"><div><b>${esc(o.id)}</b> · ${esc(when(o.created))} · <b>${usd(o.total)}</b> <span class="chip ${o.status === "paid" ? "warn" : o.status === "shipped" || o.status === "delivered" ? "good" : ""}">${esc(o.status)}</span></div>
          <div class="small muted">${esc(o.name || "")} · ${o.email ? link("mailto:" + o.email, o.email) : ""}</div></div>
        <ul class="tight small">${o.items.map((i) => `<li>${esc(i.title)} <span class="muted">${esc(i.grade || "")}</span> — ${usd(i.price)}</li>`).join("")}</ul>
        ${o.shippingAddress ? `<div class="small"><b>Ship to:</b> ${esc([o.name, o.shippingAddress.line1, o.shippingAddress.line2, `${o.shippingAddress.city || ""}, ${o.shippingAddress.state || ""} ${o.shippingAddress.postal_code || ""}`].filter(Boolean).join(" · "))}</div>` : ""}
        <div class="inline-form"><select data-st aria-label="Order status">${ORDER_STATUS.map((s) => `<option${s === o.status ? " selected" : ""}>${s}</option>`).join("")}</select>
          <input data-carrier placeholder="Carrier" value="${esc(o.carrier || "")}" style="width:110px" aria-label="Carrier"><input data-track placeholder="Tracking #" value="${esc(o.tracking || "")}" style="width:200px" aria-label="Tracking number">
          <button class="small primary" data-save>Save — customer sees it</button></div>
      </div>`).join("")
      : `<div class="empty"><h2>No website orders yet</h2><p>When a customer pays on the MJC site, the order shows up here within 5 minutes (and as an alert). The card is marked sold in your inventory automatically.</p><button id="mjcPull">↻ Check now</button></div>`;
  } else if (mjcTab === "messages") {
    const tickets = await getJSON("/api/mjc/tickets");
    bodyHtml = tickets.length ? tickets.map((t) => `<div class="panel ticket ${t.status}" data-id="${esc(t.id)}">
        <div class="row space" style="margin:0"><div><b>${esc(t.name || t.email)}</b> <span class="muted small">${esc(t.email)} · ${esc(when(t.created))}</span> <span class="chip ${t.status === "open" ? "warn" : ""}">${esc(t.status)}</span></div>
          <div class="actions"><a class="button small" href="mailto:${esc(t.email)}?subject=${encodeURIComponent("Re: your message to MJC (" + t.id + ")")}&body=${encodeURIComponent("\n\n— — —\n" + t.message)}">Reply by email</a>${t.status !== "closed" ? `<button class="small" data-close>Mark done</button>` : ""}</div></div>
        <p style="white-space:pre-wrap">${esc(t.message)}</p>
        ${t.transcript ? `<details><summary class="small">Chat with Pip before this message</summary><pre class="diag">${esc(t.transcript)}</pre></details>` : ""}
      </div>`).join("")
      : `<div class="empty"><h2>No customer messages</h2><p>When a shopper asks Pip for a person (offers, bulk buys, anything Pip can't do), their message lands here with the chat that led to it.</p></div>`;
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
          <label class="span2">Shipping details<textarea name="shipping" rows="2" placeholder="e.g. Ships within 1 business day in a top loader + bubble mailer, tracked. Cards over $250 ship insured with signature.">${esc(st.shipping || "")}</textarea></label>
          <label class="span2">Returns<textarea name="returns" rows="2" placeholder="e.g. Raw cards: returns within 14 days if not as described. Graded slabs: returnable only if damaged in transit.">${esc(st.returns || "")}</textarea></label>
          <label class="span2">Other policies &amp; facts for Pip<textarea name="policies" rows="5" placeholder="Payment methods, whether you buy collections, grading services, local pickup, card shows you'll be at, how to make an offer…">${esc(st.policies || "")}</textarea></label>
          <label class="check span2"><input type="checkbox" name="checkoutEnabled"${st.checkoutEnabled ? " checked" : ""}> Open online checkout (customers can pay with Stripe). Leave off until you've done a test purchase.</label>
          <div class="span2 row"><button class="primary">Save &amp; send to the website</button><span data-msg class="small"></span></div>
        </form></div>`;
  }
  $("#invBody").innerHTML = head + bodyHtml;

  const sync = $("#mjcSync");
  if (sync) sync.onclick = async () => { sync.disabled = true; const r = await fetch("/api/mjc/sync", { method: "POST" }); const j = await r.json(); toast(r.ok ? `Synced — ${j.live} card${j.live === 1 ? "" : "s"} on the website` : j.error, { error: !r.ok }); loadMjc(); };
  const pull = $("#mjcPull");
  if (pull) pull.onclick = async () => { pull.disabled = true; const r = await fetch("/api/mjc/orders/pull", { method: "POST" }); const j = await r.json(); toast(r.ok ? `${j.fresh.length} new order${j.fresh.length === 1 ? "" : "s"}` : j.error, { error: !r.ok }); loadMjc(); };
  $$("#invBody .order").forEach((el) => ($("[data-save]", el).onclick = async () => {
    const r = await fetch("/api/mjc/orders/" + el.dataset.id, json("PATCH", { status: $("[data-st]", el).value, carrier: $("[data-carrier]", el).value, tracking: $("[data-track]", el).value }));
    toast(r.ok ? "Saved — the customer can see it when they check their order" : (await r.json()).error, { error: !r.ok });
  }));
  $$("#invBody .ticket").forEach((el) => { const b = $("[data-close]", el); if (b) b.onclick = async () => { await fetch("/api/mjc/tickets/" + el.dataset.id, json("PATCH", { status: "closed" })); loadMjc(); }; });
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
  if (sf) sf.onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(sf));
    f.checkoutEnabled = sf.elements.checkoutEnabled.checked;
    const r = await fetch("/api/mjc/store", json("PUT", f));
    const j = await r.json();
    $("[data-msg]", sf).innerHTML = r.ok ? `<span class="ok">Saved ✓ — Pip and checkout use this now</span>` : `<span class="bad">${esc(j.error)}</span>`;
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
  const list = await getJSON("/api/expenses");
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
        <button class="primary">Add</button>
      </form>
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
  $$("#invBody tr[data-id]").forEach((tr) => ($("[data-del]", tr).onclick = () => removeWithUndo("/api/expenses/" + tr.dataset.id, "expense", loadExpenses)));
}
