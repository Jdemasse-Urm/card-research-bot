// Card Research Bot — the business side: Home dashboard, inventory (stock / grading / sales / expenses).
// Uses helpers from app.js ($, esc, usd, getJSON, json, toast, openModal, removeWithUndo, ...).
"use strict";

const STATUS_LABEL = { in_stock: "In stock", listed: "Listed", grading: "At grading", sold: "Sold" };
const SELL_PLATFORMS = ["eBay", "TCGplayer", "Whatnot", "Facebook", "Card show", "Local / cash", "Other"];
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
  const d = await getJSON("/api/dashboard");
  const p = d.portfolio;
  const unreal = p.value - p.cost;
  $("#dash").innerHTML = `
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
    <button data-a="labels">🏷 Print labels</button>
    <a class="button" href="/api/export/inventory.csv">⬇ CSV</a>`;
  $("#invActions [data-a=add]").onclick = () => openItemEditor();
  $("#invActions [data-a=import]").onclick = openImport;
  $("#invActions [data-a=labels]").onclick = printLabels;
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
          <td class="num">${r.status === "sold" ? `sold ${usd(r.soldPrice)}` : usd(r.value)}<div class="small muted">${r.status === "sold" ? esc(r.soldOn || "") : esc(when(r.valuedAt))}</div></td>
          <td class="num ${pl == null ? "" : pl >= 0 ? "pos" : "neg"}">${usd(pl)}</td>
          <td><span class="chip st-${r.status}">${esc(STATUS_LABEL[r.status])}</span>${r.status === "listed" && r.listedOn ? `<div class="small muted">${esc(r.listedOn)} ${usd(r.listPrice)}</div>` : ""}</td>
          <td class="actions nowrap">${r.status !== "sold" ? `<button class="small" data-sell>Sold</button>` : ""}<button class="small ghost" data-edit aria-label="Edit">✎</button><button class="small ghost" data-del aria-label="Remove">🗑</button></td></tr>`;
      }).join("")}</table>
      <div class="row bulk"><span class="small muted" data-selcount>0 selected</span><button class="small" data-bulk="grading" disabled>Send selected to grading</button><button class="small" data-bulk="labels" disabled>Labels for selected</button></div></div>`
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
  $$("#invBody tr[data-id]").forEach((tr) => {
    const row = invRows.find((r) => r.id === tr.dataset.id);
    $("[data-edit]", tr).onclick = () => openItemEditor(row);
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
      <label class="span2">Notes<textarea name="notes" rows="2">${esc(r.notes || "")}</textarea></label>
      <div class="span2 row"><button class="primary">${row ? "Save" : "Add card"}</button></div>
    </form>`, { wide: true });
  $("[data-form]", body).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    if (f.value === "") f.value = null;
    if (!f.sku) delete f.sku;
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

async function loadSales() {
  $("#invActions").innerHTML = `<a class="button" href="/api/export/sales.csv">⬇ Sales CSV</a>`;
  const a = await getJSON("/api/analytics");
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
