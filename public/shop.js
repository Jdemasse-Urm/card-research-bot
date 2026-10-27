// Card Research Bot — the Shop tab: the customer book (+ store credit), consignment, grading as a service,
// card shows (calendar, what to bring, checklist, cash count) and supplies. Uses the helpers in app.js.

let shopView = store.get("shopView", "customers");
const SHOP_VIEWS = {
  customers: ["👥 Customers", () => loadCustomers()],
  consign: ["🤝 Consignment", () => loadConsign()],
  grading: ["🏷 Grading service", () => loadGradingService()],
  shows: ["🎪 Shows", () => loadShows()],
  supplies: ["📦 Supplies", () => loadSupplies()],
  settings: ["⚙ Shop settings", () => loadShopSettings()],
};
async function loadShop() {
  if (!SHOP_VIEWS[shopView]) shopView = "customers";
  $("#shopPills").innerHTML = Object.entries(SHOP_VIEWS).map(([k, [label]]) => `<button data-v="${k}" class="${k === shopView ? "active" : ""}" aria-pressed="${k === shopView}">${label}</button>`).join("");
  $$("#shopPills button").forEach((b) => (b.onclick = () => { shopView = b.dataset.v; store.set("shopView", shopView); loadShop(); }));
  $("#shopActions").innerHTML = "";
  await SHOP_VIEWS[shopView][1]();
}
TAB_LOADERS.shop = loadShop;

/** A printable page in its own window (statements, receipts, pull lists) with a Print button. */
function printDoc(title, html) {
  const w = window.open("", "_blank");
  if (!w) return toast("Allow pop-ups to print.", { error: true });
  w.document.write(`<!doctype html><title>${esc(title)}</title><style>
    body{font:13px/1.4 -apple-system,Segoe UI,Arial,sans-serif;margin:24px;color:#111} h1{font-size:20px;margin:0 0 4px} h2{font-size:15px;margin:18px 0 6px}
    table{border-collapse:collapse;width:100%} th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;vertical-align:top} .num{text-align:right}
    .muted{color:#666} .bar{margin-bottom:14px} .bar button{font:inherit;padding:6px 12px} .tot td{font-weight:700;border-top:2px solid #111}
    @media print{.bar{display:none}}</style><div class="bar"><button id="doPrint">🖨 Print / Save as PDF</button></div>${html}`);
  w.document.close();
  w.document.getElementById("doPrint").onclick = () => w.print();
}
const shopName = () => status.storeName || "MJC Sports Cards & Collectibles";

// ------------------------------------------------------------------ CUSTOMERS

let custRows = [], custQ = "";
async function loadCustomers() {
  custRows = await getJSON("/api/customers");
  $("#shopActions").innerHTML = `<button class="primary" data-addcust>＋ Add customer</button>`;
  $("#shopActions [data-addcust]").onclick = () => openCustomer(null);
  drawCustomers();
}
function drawCustomers() {
  const q = custQ.trim().toLowerCase();
  const rows = custRows.filter((c) => !q || [c.name, c.email, c.phone, c.handle, c.collects, c.notes].join(" ").toLowerCase().includes(q));
  const credit = custRows.reduce((n, c) => n + (c.credit || 0), 0), owed = custRows.reduce((n, c) => n + (c.consigned?.owed || 0), 0);
  $("#shopBody").innerHTML = `
    <div class="totals"><div><span>Customers</span><b>${custRows.length}</b></div><div><span>Store credit out</span><b>${usd(credit)}</b></div><div><span>Owed to consignors</span><b>${usd(owed)}</b></div></div>
    <div class="panel"><input type="search" data-cq placeholder="Search name, email, phone, what they collect…" value="${esc(custQ)}" aria-label="Search customers" style="width:100%">
      ${rows.length ? `<div class="table-wrap"><table><tr><th>Customer</th><th>Collects</th><th class="num">Bought</th><th class="num">Credit</th><th>Consigned</th><th>Grading</th><th>Last</th></tr>
        ${rows.map((c) => `<tr data-cid="${esc(c.id)}" class="clickable"><td><b>${esc(c.name)}</b><div class="small muted">${esc([c.email, c.phone, c.handle].filter(Boolean).join(" · "))}</div></td>
          <td class="small">${esc(String(c.collects || "").slice(0, 80))}</td>
          <td class="num">${c.bought ? `${c.bought} · ${usd(c.spent)}` : "—"}</td><td class="num">${c.credit ? usd(c.credit) : "—"}</td>
          <td class="small">${c.consigned.inStock || c.consigned.sold ? `${c.consigned.inStock} in stock · ${c.consigned.sold} sold${c.consigned.owed ? ` · <b class="neg">${usd(c.consigned.owed)} owed</b>` : ""}` : "—"}</td>
          <td class="small">${c.grading ? `${c.grading} open` : "—"}</td><td class="small muted">${esc(day(c.lastAt))}</td></tr>`).join("")}</table></div>`
      : `<div class="empty"><h2>${custRows.length ? "No one matches" : "No customers yet"}</h2><p>${custRows.length ? "" : "Website buyers are added automatically. Add show buyers, consignors and people you trade with — write what they collect and you're told when matching cards come in."}</p></div>`}
    </div>`;
  const qIn = $("#shopBody [data-cq]");
  qIn.oninput = () => { custQ = qIn.value; drawCustomers(); const s = $("#shopBody [data-cq]"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); };
  $$("#shopBody tr[data-cid]").forEach((tr) => (tr.onclick = () => openCustomer(tr.dataset.cid)));
}

/** Cards in stock that a customer collects (their "collects" words in the name / player / team / set). */
function cardsTheyCollect(c, inv) {
  const terms = String(c.collects || "").split(/[,;\n]/).map((t) => t.trim().toLowerCase()).filter((t) => t.length >= 3);
  if (!terms.length) return [];
  return inv.filter((r) => r.status !== "sold" && terms.some((t) => [r.name, r.facts?.player, r.facts?.team, r.facts?.set].join(" ").toLowerCase().includes(t)));
}

async function openCustomer(id) {
  const [c, inv] = await Promise.all([id ? getJSON("/api/customers/" + id) : Promise.resolve(null), getJSON("/api/inventory").catch(() => [])]);
  const k = c || { name: "", email: "", phone: "", handle: "", collects: "", notes: "", credit: 0 };
  const theirs = c ? cardsTheyCollect(c, inv) : [];
  const owed = (c?.consignments || []).filter((x) => x.owed && !x.paidAt);
  const body = openModal(c ? c.name : "Add a customer", `
    <form class="form-grid" data-cform>
      <label>Name<input name="name" required value="${esc(k.name)}"></label>
      <label>Email<input name="email" type="email" value="${esc(k.email || "")}"></label>
      <label>Phone<input name="phone" value="${esc(k.phone || "")}"></label>
      <label>Handle <span class="muted small">(Whatnot, Instagram…)</span><input name="handle" value="${esc(k.handle || "")}"></label>
      <label class="span2">Collects <span class="muted small">— players, teams, sets, comma separated; you're told when matching cards come in</span><input name="collects" value="${esc(k.collects || "")}" placeholder="Tigers, Skubal, Pokemon 151, Wembanyama"></label>
      <label class="span2">Notes<textarea name="notes" rows="2">${esc(k.notes || "")}</textarea></label>
      <label>Consignment commission % <span class="muted small">(blank = the shop's)</span><input name="consignPct" type="number" min="0" max="60" step="0.5" value="${esc(k.consignPct ?? "")}"></label>
      <div class="span2 row"><button class="primary">${c ? "Save" : "Add customer"}</button>${c?.email ? `<a class="button" href="mailto:${esc(c.email)}">✉ Email</a>` : ""}${c ? `<button type="button" class="ghost" data-delcust>Delete</button>` : ""}</div>
    </form>
    ${c ? `
    <div class="grid2" style="margin-top:.8rem">
      <div class="panel" style="margin:0"><h3 style="margin-top:0">Store credit: ${usd(c.credit || 0)}</h3>
        <form class="row" data-credit style="margin:0"><input name="amount" type="number" step="0.01" min="0" placeholder="$" style="width:90px" aria-label="Amount"><input name="reason" placeholder="why (trade-in, refund, gift card…)" style="flex:1" aria-label="Reason">
          <button data-sign="1">＋ Add</button><button data-sign="-1" class="ghost">− Use</button></form>
        ${(c.creditLog || []).length ? `<ul class="tight small">${c.creditLog.slice(0, 8).map((x) => `<li>${esc(day(x.at))}: <b class="${x.amount > 0 ? "pos" : "neg"}">${x.amount > 0 ? "+" : ""}${usd(x.amount)}</b> ${esc(x.reason || "")}${x.by ? ` · ${esc(x.by)}` : ""}</li>`).join("")}</ul>` : `<p class="small muted">Store credit is spent with the "Store credit" payment in Show mode or the Sold dialog.</p>`}
      </div>
      <div class="panel" style="margin:0"><h3 style="margin-top:0">In stock that they collect (${theirs.length})</h3>
        ${theirs.length ? `<ul class="tight small">${theirs.slice(0, 10).map((r) => `<li>${esc(r.name)} <span class="muted">${esc(r.grade)}</span> ${usd(r.listPrice ?? r.value)}</li>`).join("")}</ul>${c.email ? `<a class="button small" href="${esc(`mailto:${c.email}?subject=${encodeURIComponent(`New cards you collect — ${shopName()}`)}&body=${encodeURIComponent(`Hi ${c.name.split(" ")[0]},\n\nWe have some cards you might like:\n\n${theirs.slice(0, 15).map((r) => `• ${r.name} (${r.grade})${(r.listPrice ?? r.value) ? ` — $${r.listPrice ?? r.value}` : ""}`).join("\n")}\n\nReply if you'd like any of them.\n\n${shopName()}`)}`)}">✉ Email them these</a>` : ""}` : `<p class="small muted">${c.collects ? "Nothing in stock matches right now." : "Fill in what they collect."}</p>`}
      </div>
    </div>
    ${c.consignments.length ? `<div class="panel" style="margin:.8rem 0 0"><div class="row space"><h3 style="margin:0">Consigned cards</h3><span class="row" style="margin:0">${owed.length ? `<select data-paymethod aria-label="Paid with">${["Cash", "Check", "Venmo", "PayPal", "Zelle", "Store credit", "Other"].map((m) => `<option>${m}</option>`).join("")}</select><button class="primary small" data-payall>Pay ${usd(owed.reduce((n, x) => n + x.owed, 0))} owed</button>` : ""}<button class="small" data-statement>🖨 Statement</button></span></div>
      ${consignTable(c.consignments)}</div>` : ""}
    ${c.gradingOrders.length ? `<div class="panel" style="margin:.8rem 0 0"><h3 style="margin-top:0">Grading orders</h3><ul class="tight small">${c.gradingOrders.map((o) => `<li>${esc(day(o.at))}: ${o.cards.length} card${o.cards.length === 1 ? "" : "s"} · ${esc(o.service)} · ${usd(o.total)}${o.paid ? " paid" : " <b class=neg>unpaid</b>"} — <b>${esc(o.stage.text)}</b></li>`).join("")}</ul></div>` : ""}
    ${c.history.length ? `<details class="panel" style="margin:.8rem 0 0"><summary><b>History (${c.history.length})</b></summary><ul class="tight small">${c.history.slice(0, 60).map((h) => `<li>${esc(day(h.at))} · ${esc(h.what)}: ${esc(h.name || "")}${h.amount != null ? ` · ${usd(h.amount)}` : ""}${h.where ? ` <span class="muted">${esc(h.where)}</span>` : ""}</li>`).join("")}</ul></details>` : ""}` : ""}`, { wide: true });
  $("[data-cform]", body).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const r = await fetch(c ? "/api/customers/" + c.id : "/api/customers", json(c ? "PATCH" : "POST", f));
    const j = await r.json();
    if (!r.ok) return toast(j.error, { error: true });
    toast(c ? "Saved" : `${j.name} added`);
    if (shopView === "customers") loadCustomers();
    openCustomer(j.id);
  };
  if (!c) return;
  $("[data-delcust]", body).onclick = async () => {
    const r = await fetch("/api/customers/" + c.id, { method: "DELETE" });
    const j = await r.json();
    if (!r.ok) return toast(j.error, { error: true });
    modal.close();
    toast(`${c.name} removed`, { undo: async () => { await fetch("/api/undo/" + j.undo, { method: "POST" }); loadCustomers(); } });
    loadCustomers();
  };
  const cf = $("[data-credit]", body);
  $$("button[data-sign]", cf).forEach((b) => (b.onclick = async (e) => {
    e.preventDefault();
    const amount = parseFloat(cf.amount.value) * +b.dataset.sign;
    if (!(Math.abs(amount) > 0)) return toast("Enter an amount.", { error: true });
    const r = await fetch(`/api/customers/${c.id}/credit`, json("POST", { amount, reason: cf.reason.value }));
    const j = await r.json();
    if (!r.ok) return toast(j.error, { error: true });
    toast(`Store credit now ${usd(j.credit)}`);
    openCustomer(c.id);
  }));
  const payall = $("[data-payall]", body);
  if (payall) payall.onclick = async () => {
    const method = $("[data-paymethod]", body).value;
    const r = await (await fetch(`/api/customers/${c.id}/payout`, json("POST", { method }))).json();
    if (method === "Store credit" && r.total) await fetch(`/api/customers/${c.id}/credit`, json("POST", { amount: r.total, reason: "Consignment payout" }));
    toast(`Paid ${usd(r.total)} for ${plural(r.paid, "card")} (${method})`);
    openCustomer(c.id);
  };
  const st = $("[data-statement]", body);
  if (st) st.onclick = () => printStatement(c);
}

function consignTable(list) {
  return `<div class="table-wrap"><table class="small"><tr><th>Card</th><th>Status</th><th class="num">Their minimum</th><th class="num">Listed / sold</th><th class="num">Commission</th><th class="num">Owed to them</th><th>Paid</th></tr>
    ${list.map((x) => `<tr><td>${esc(x.name)} <span class="muted">${esc(x.grade)}</span></td><td>${esc(STATUS_LABEL[x.status] || x.status)}${x.soldDate ? ` <span class="muted">${esc(day(x.soldDate))}${x.soldOn ? " · " + esc(x.soldOn) : ""}</span>` : ""}</td>
      <td class="num">${usd(x.floor)}</td><td class="num">${x.status === "sold" ? usd(x.soldPrice) : usd(x.listed)}</td><td class="num">${esc(x.pct)}%</td><td class="num">${usd(x.owed)}</td><td class="small">${x.paidAt ? `✓ ${esc(day(x.paidAt))}${x.method ? " · " + esc(x.method) : ""}` : x.owed ? "<b class=neg>owed</b>" : ""}</td></tr>`).join("")}</table></div>`;
}

function printStatement(c) {
  const list = c.consignments;
  const sold = list.filter((x) => x.status === "sold"), owed = sold.filter((x) => !x.paidAt);
  printDoc(`Consignment statement — ${c.name}`, `<h1>${esc(shopName())}</h1><div class="muted">Consignment statement · ${esc(new Date().toLocaleDateString())}</div>
    <h2>${esc(c.name)}${c.email ? ` <span class="muted">${esc(c.email)}</span>` : ""}</h2>
    <table><tr><th>Card</th><th>Status</th><th class="num">Your minimum</th><th class="num">Listed / sold for</th><th class="num">Commission</th><th class="num">Your payout</th><th>Paid</th></tr>
    ${list.map((x) => `<tr><td>${esc(x.name)} (${esc(x.grade)})</td><td>${x.status === "sold" ? `Sold ${esc(day(x.soldDate))}` : "For sale"}</td><td class="num">${usd(x.floor)}</td><td class="num">${x.status === "sold" ? usd(x.soldPrice) : usd(x.listed)}</td><td class="num">${esc(x.pct)}%</td><td class="num">${usd(x.owed)}</td><td>${x.paidAt ? esc(day(x.paidAt)) : x.owed ? "Due" : ""}</td></tr>`).join("")}
    <tr class="tot"><td colspan="5">Sold ${sold.length} · paid out ${usd(sold.filter((x) => x.paidAt).reduce((n, x) => n + x.owed, 0))} · due now</td><td class="num">${usd(owed.reduce((n, x) => n + x.owed, 0))}</td><td></td></tr></table>
    <p class="muted">Payout = sale price minus the shop's commission. Questions? Reply to the shop or ask at our table.</p>`);
}

// ------------------------------------------------------------------ CONSIGNMENT

async function loadConsign() {
  const [list, settings] = await Promise.all([getJSON("/api/consignments"), getJSON("/api/shop/settings")]);
  const by = new Map();
  for (const x of list) {
    const e = by.get(x.consignorId) || { id: x.consignorId, name: x.consignor, inStock: 0, sold: 0, owed: 0, paid: 0 };
    if (x.status === "sold") { e.sold++; x.paidAt ? (e.paid += x.owed || 0) : (e.owed += x.owed || 0); } else e.inStock++;
    by.set(x.consignorId, e);
  }
  const people = [...by.values()].sort((a, b) => b.owed - a.owed || a.name.localeCompare(b.name));
  $("#shopBody").innerHTML = `
    <div class="panel small"><b>Taking in someone's cards:</b> scan them in <b>Inventory → Bulk scan</b> and pick <b>Consigned by</b> (or set it in a card's editor → Consignment, with their minimum price).
      The shop keeps <b>${esc(settings.consignPct)}%</b> of each sale (change it in Shop settings, or per customer). The pricing engine never prices a consigned card under its owner's minimum; when one sells, what they're owed is recorded automatically.</div>
    ${people.length ? `<div class="totals"><div><span>Consignors</span><b>${people.length}</b></div><div><span>Their cards in stock</span><b>${people.reduce((n, p) => n + p.inStock, 0)}</b></div><div><span>Owed now</span><b class="${people.some((p) => p.owed) ? "neg" : ""}">${usd(people.reduce((n, p) => n + p.owed, 0))}</b></div><div><span>Paid out</span><b>${usd(people.reduce((n, p) => n + p.paid, 0))}</b></div></div>
      <div class="panel table-wrap"><table><tr><th>Consignor</th><th class="num">In stock</th><th class="num">Sold</th><th class="num">Owed</th><th class="num">Paid</th><th></th></tr>
        ${people.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td class="num">${p.inStock}</td><td class="num">${p.sold}</td><td class="num ${p.owed ? "neg" : ""}">${usd(p.owed)}</td><td class="num">${usd(p.paid)}</td><td><button class="small" data-open="${esc(p.id)}">Open</button></td></tr>`).join("")}</table></div>
      <div class="panel"><h3 style="margin-top:0">Every consigned card</h3>${consignTable(list)}</div>`
    : `<div class="empty"><h2>No consigned cards yet</h2><p>Selling other people's cards for a commission adds stock without spending your money.</p></div>`}`;
  $$("#shopBody [data-open]").forEach((b) => (b.onclick = () => openCustomer(b.dataset.open)));
}

// ------------------------------------------------------------------ GRADING SERVICE

async function loadGradingService() {
  const [orders, subs] = await Promise.all([getJSON("/api/grading-orders"), getJSON("/api/submissions")]);
  $("#shopActions").innerHTML = `<button class="primary" data-neworder>＋ Take in cards to grade</button>`;
  $("#shopActions [data-neworder]").onclick = () => openGradingOrder();
  const open = orders.filter((o) => o.status !== "returned");
  const openSubs = subs.filter((s) => s.status !== "complete");
  $("#shopBody").innerHTML = `
    <div class="panel small">Customers' cards go in with your own submissions: link an order to a submission in <b>Inventory → Grading</b> and its progress at PSA shows here (and to the customer, once the website is live). ${status.psa ? "" : "Add the free PSA token in Settings so progress updates by itself."}</div>
    ${orders.length ? `<div class="totals"><div><span>Open orders</span><b>${open.length}</b></div><div><span>Cards out</span><b>${open.reduce((n, o) => n + o.cards.length, 0)}</b></div><div><span>Unpaid</span><b class="${orders.some((o) => !o.paid) ? "neg" : ""}">${usd(orders.filter((o) => !o.paid).reduce((n, o) => n + o.total, 0))}</b></div></div>
      <div class="panel table-wrap"><table><tr><th>Taken in</th><th>Customer</th><th>Cards</th><th class="num">Fee</th><th>Where it is</th><th>Submission</th><th></th></tr>
      ${orders.map((o) => `<tr data-oid="${esc(o.id)}"><td class="small">${esc(day(o.at))}</td><td><b>${esc(o.customer)}</b></td><td class="small">${o.cards.length} · ${esc(o.service)}<div class="muted">${esc(o.cards.slice(0, 3).map((c) => c.desc).join("; "))}${o.cards.length > 3 ? "…" : ""}</div></td>
        <td class="num">${usd(o.total)}<div class="small ${o.paid ? "pos" : "neg"}">${o.paid ? "paid" : "unpaid"}</div></td>
        <td class="small"><b>${esc(o.stage.text)}</b><div class="muted">step ${o.stage.step} of 5</div></td>
        <td><select data-sub aria-label="Submission"><option value="">— not sent yet —</option>${openSubs.concat(subs.filter((s) => s.id === o.submissionId && s.status === "complete")).map((s) => `<option value="${esc(s.id)}"${s.id === o.submissionId ? " selected" : ""}>${esc(s.company)} ${esc(s.number || s.service || "")} · sent ${esc(s.sent)}</option>`).join("")}</select></td>
        <td class="nowrap"><button class="small" data-edit>✎</button>${o.status !== "back" && o.status !== "returned" ? `<button class="small" data-back title="The cards are back at the shop">Back</button>` : ""}${o.status !== "returned" ? `<button class="small" data-returned title="Picked up / shipped to the customer">Returned</button>` : ""}<button class="small ghost" data-receipt title="Print the customer's receipt">🖨</button></td></tr>`).join("")}</table></div>`
    : `<div class="empty"><h2>No grading orders yet</h2><p>Take in customers' cards, send them with your own submissions, and track every card until it's back in their hands. Set your prices in Shop settings.</p></div>`}`;
  $$("#shopBody tr[data-oid]").forEach((tr) => {
    const o = orders.find((x) => x.id === tr.dataset.oid);
    const patch = async (p, msg) => { const r = await fetch("/api/grading-orders/" + o.id, json("PATCH", p)); if (!r.ok) return toast((await r.json()).error, { error: true }); toast(msg); loadGradingService(); };
    $("[data-sub]", tr).onchange = (e) => patch({ submissionId: e.target.value || null }, e.target.value ? "Linked — its progress shows here" : "Unlinked");
    const back = $("[data-back]", tr);
    if (back) back.onclick = () => patch({ status: "back" }, "Back at the shop");
    const ret = $("[data-returned]", tr);
    if (ret) ret.onclick = () => patch({ status: "returned" }, "Returned to the customer");
    $("[data-edit]", tr).onclick = () => openGradingOrder(o);
    $("[data-receipt]", tr).onclick = () => printGradingReceipt(o);
  });
}

async function openGradingOrder(o = null) {
  const [cust, settings] = await Promise.all([getJSON("/api/customers"), getJSON("/api/shop/settings")]);
  const prices = settings.gradingPrices || [];
  const service = o?.service || prices[0]?.service || "";
  const fee = (sv) => prices.find((p) => p.service === sv)?.fee ?? "";
  const line = (c = {}) => `<div class="row" data-line style="margin:.2rem 0"><input name="desc" value="${esc(c.desc || "")}" placeholder="2003 Topps Chrome LeBron James #111" style="flex:3" aria-label="Card"><input name="declared" type="number" min="0" step="1" value="${esc(c.declared ?? "")}" placeholder="value $" style="width:90px" aria-label="Declared value"><input name="fee" type="number" min="0" step="0.01" value="${esc(c.fee ?? fee(service))}" style="width:80px" aria-label="Fee"><input name="grade" value="${esc(c.grade || "")}" placeholder="grade" style="width:70px" aria-label="Grade"><input name="cert" value="${esc(c.cert || "")}" placeholder="cert" style="width:100px" aria-label="Cert"><button type="button" class="ghost small" data-rmline aria-label="Remove">✕</button></div>`;
  const body = openModal(o ? `Grading order — ${o.customer}` : "Take in cards to grade", `
    <form class="form-grid" data-gform>
      <label>Customer<select name="customerId" required><option value="">— pick —</option>${cust.map((c) => `<option value="${esc(c.id)}"${c.id === o?.customerId ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <label>Service<select name="service">${prices.map((p) => `<option${p.service === service ? " selected" : ""}>${esc(p.service)}</option>`).join("")}${service && !prices.some((p) => p.service === service) ? `<option selected>${esc(service)}</option>` : ""}</select></label>
      <div class="span2"><div class="small muted">Cards — description, declared value, your fee, and the grade + cert when they come back</div><div data-lines>${(o?.cards?.length ? o.cards : [{}]).map(line).join("")}</div><button type="button" class="small" data-addline>＋ Card</button></div>
      <label class="check"><input type="checkbox" name="paid"${o?.paid ? " checked" : ""}> Paid</label>
      <label class="span2">Notes<textarea name="notes" rows="2">${esc(o?.notes || "")}</textarea></label>
      <div class="span2 row"><button class="primary">${o ? "Save" : "Take them in"}</button>${o ? `<button type="button" class="ghost" data-delorder>Delete</button>` : ""}<span class="small muted">No customer yet? Add them in Shop → Customers.</span></div>
    </form>`, { wide: true });
  const form = $("[data-gform]", body), lines = $("[data-lines]", body);
  const wireLines = () => $$("[data-rmline]", lines).forEach((b) => (b.onclick = () => { b.closest("[data-line]").remove(); if (!$("[data-line]", lines)) lines.insertAdjacentHTML("beforeend", line()); wireLines(); }));
  wireLines();
  $("[data-addline]", body).onclick = () => { lines.insertAdjacentHTML("beforeend", line({ fee: fee(form.service.value) })); wireLines(); };
  form.service.onchange = () => $$('[data-line] [name="fee"]', lines).forEach((i) => { if (!o) i.value = fee(form.service.value); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const cards = $$("[data-line]", lines).map((l) => Object.fromEntries(["desc", "declared", "fee", "grade", "cert"].map((k) => [k, $(`[name="${k}"]`, l).value]))).filter((c) => c.desc.trim());
    const b = { customerId: form.customerId.value, service: form.service.value, cards, paid: form.paid.checked, notes: form.notes.value };
    const r = await fetch(o ? "/api/grading-orders/" + o.id : "/api/grading-orders", json(o ? "PATCH" : "POST", b));
    const j = await r.json();
    if (!r.ok) return toast(j.error, { error: true });
    modal.close();
    toast(o ? "Saved" : `Taken in — ${plural(j.cards.length, "card")}, ${usd(j.total)}`);
    if (!o) printGradingReceipt({ ...j, customer: cust.find((c) => c.id === j.customerId)?.name || "" });
    loadGradingService();
  };
  const del = $("[data-delorder]", body);
  if (del) del.onclick = async () => { const r = await fetch("/api/grading-orders/" + o.id, { method: "DELETE" }); const j = await r.json(); modal.close(); toast("Order deleted", { undo: async () => { await fetch("/api/undo/" + j.undo, { method: "POST" }); loadGradingService(); } }); loadGradingService(); };
}

function printGradingReceipt(o) {
  printDoc(`Grading receipt ${o.id}`, `<h1>${esc(shopName())}</h1><div class="muted">Grading service receipt · order ${esc(o.id)} · ${esc(day(o.at))}</div>
    <h2>${esc(o.customer)} — ${esc(o.service)}</h2>
    <table><tr><th>#</th><th>Card</th><th class="num">Declared value</th><th class="num">Fee</th></tr>${o.cards.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.desc)}</td><td class="num">${usd(c.declared)}</td><td class="num">${usd(c.fee)}</td></tr>`).join("")}
    <tr class="tot"><td colspan="3">${o.cards.length} card${o.cards.length === 1 ? "" : "s"} · ${o.paid ? "paid" : "due at pickup"}</td><td class="num">${usd(o.total)}</td></tr></table>
    <p class="muted">We send your cards to the grader with our own submissions and tell you when they're back. Keep this receipt — the order number finds your cards.</p>`);
}

// ------------------------------------------------------------------ SHOWS

async function loadShows() {
  const list = await getJSON("/api/shows");
  $("#shopActions").innerHTML = `<button class="primary" data-addshow>＋ Add a show</button>`;
  $("#shopActions [data-addshow]").onclick = () => openShowEditor();
  const todayIso = new Date().toLocaleDateString("en-CA");
  const upcoming = list.filter((s) => (s.endDate || s.date) >= todayIso), past = list.filter((s) => (s.endDate || s.date) < todayIso).reverse();
  const row = (s) => `<tr data-sid="${esc(s.id)}" class="clickable"><td><b>${esc(s.name)}</b><div class="small muted">${esc([s.venue, s.city].filter(Boolean).join(", "))}${s.table ? ` · table ${esc(s.table)}` : ""}</div></td><td class="small">${esc(day(s.date))}${s.endDate ? " – " + esc(day(s.endDate)) : ""}</td>
    <td class="small">${s.public ? "🌐 on the website" : "private"}</td><td class="num">${s.report.sales ? usd(s.report.revenue) : "—"}</td><td class="num ${s.report.profit >= 0 ? "pos" : "neg"}">${s.report.sales || s.report.table ? usd(s.report.profit) : "—"}</td><td class="small">${s.report.cash.over != null ? (Math.abs(s.report.cash.over) < 0.01 ? "✓ drawer even" : `<b class="${s.report.cash.over > 0 ? "pos" : "neg"}">drawer ${s.report.cash.over > 0 ? "over" : "short"} ${usd(Math.abs(s.report.cash.over))}</b>`) : ""}</td></tr>`;
  const table = (rows) => `<div class="table-wrap"><table><tr><th>Show</th><th>When</th><th>Website</th><th class="num">Sales</th><th class="num">Profit</th><th>Cash</th></tr>${rows.map(row).join("")}</table></div>`;
  $("#shopBody").innerHTML = list.length ? `
    ${status.currentShow ? `<div class="panel"><b>🎪 Today: ${esc(status.currentShow.name)}</b> — Show mode sales are filed under it. <button class="small primary" data-today>Open it</button></div>` : ""}
    <div class="panel"><h3 style="margin-top:0">Coming up</h3>${upcoming.length ? table(upcoming) : `<p class="muted small">Nothing booked.</p>`}</div>
    ${past.length ? `<div class="panel"><h3 style="margin-top:0">Past shows</h3>${table(past)}</div>` : ""}`
    : `<div class="empty"><h2>No shows yet</h2><p>Add the shows you have tables at: they go on the website's calendar, Show mode files each sale under the show, and you get what to bring, a table checklist, the profit per show and a cash count at close.</p></div>`;
  $$("#shopBody tr[data-sid]").forEach((tr) => (tr.onclick = () => openShow(tr.dataset.sid)));
  const t = $("#shopBody [data-today]");
  if (t) t.onclick = () => openShow(status.currentShow.id);
}

function openShowEditor(s = null) {
  const body = openModal(s ? `Edit — ${s.name}` : "Add a card show", `
    <form class="form-grid" data-sform>
      <label class="span2">Show name<input name="name" required value="${esc(s?.name || "")}" placeholder="Detroit Sports Card Show"></label>
      <label>First day<input name="date" type="date" required value="${esc(s?.date || "")}"></label><label>Last day <span class="muted small">(if more than one)</span><input name="endDate" type="date" value="${esc(s?.endDate || "")}"></label>
      <label>Venue<input name="venue" value="${esc(s?.venue || "")}" placeholder="Hall name"></label><label>City<input name="city" value="${esc(s?.city || "")}" placeholder="Novi, MI"></label>
      <label>Hours<input name="hours" value="${esc(s?.hours || "")}" placeholder="9 AM – 4 PM"></label><label>Our table #<input name="table" value="${esc(s?.table || "")}"></label>
      <label>Table cost $<input name="tableCost" type="number" min="0" step="0.01" value="${esc(s?.tableCost ?? "")}"></label>
      <label class="check"><input type="checkbox" name="public"${s ? (s.public ? " checked" : "") : " checked"}> Show it on the website's "Find us at shows"</label>
      <label class="span2">Notes<textarea name="notes" rows="2">${esc(s?.notes || "")}</textarea></label>
      <div class="span2 row"><button class="primary">${s ? "Save" : "Add show"}</button>${s ? `<button type="button" class="ghost" data-delshow>Delete</button>` : ""}</div>
    </form>`);
  $("[data-sform]", body).onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    f.public = e.target.public.checked;
    const r = await fetch(s ? "/api/shows/" + s.id : "/api/shows", json(s ? "PATCH" : "POST", f));
    const j = await r.json();
    if (!r.ok) return toast(j.error, { error: true });
    toast(s ? "Saved" : "Show added");
    await refreshStatus();
    if (shopView === "shows") loadShows();
    openShow(j.id);
  };
  const del = $("[data-delshow]", body);
  if (del) del.onclick = async () => { const r = await fetch("/api/shows/" + s.id, { method: "DELETE" }); const j = await r.json(); modal.close(); toast("Show deleted", { undo: async () => { await fetch("/api/undo/" + j.undo, { method: "POST" }); loadShows(); } }); loadShows(); };
}

async function openShow(id) {
  const s = (await getJSON("/api/shows")).find((x) => x.id === id);
  if (!s) return toast("That show isn't on the calendar anymore.", { error: true });
  const r = s.report, cash = r.cash;
  const body = openModal(`🎪 ${s.name}`, `
    <p class="small">${esc(day(s.date))}${s.endDate ? " – " + esc(day(s.endDate)) : ""} · ${esc([s.venue, s.city].filter(Boolean).join(", "))}${s.table ? ` · table ${esc(s.table)}` : ""}${s.hours ? ` · ${esc(s.hours)}` : ""} · ${s.public ? "🌐 on the website" : "private"} <button class="ghost small" data-editshow>✎ Edit</button></p>
    <div class="grid2">
      <div class="panel" style="margin:0"><h3 style="margin-top:0">Checklist</h3>
        ${s.checklist.map((c, i) => `<label class="check"><input type="checkbox" data-ck="${i}"${c.done ? " checked" : ""}> ${esc(c.text)}</label>`).join("")}
        <form class="row" data-addck style="margin:.3rem 0 0"><input name="t" placeholder="Add an item" style="flex:1" aria-label="Checklist item"><button class="small">＋</button></form>
        <div class="row"><button class="small ghost" data-resetck>Untick all</button></div></div>
      <div class="panel" style="margin:0"><h3 style="margin-top:0">What to bring</h3>
        <form class="form-grid" data-bring><label>Worth at least $<input name="minValue" type="number" min="0" value="${esc(store.get("bringMin", 20))}"></label><label>Category<select name="category"><option value="">All</option>${Object.keys(CAT_LABEL).map((c) => `<option value="${c}">${esc(CAT_LABEL[c])}</option>`).join("")}</select></label>
          <label>Tag <span class="muted small">(e.g. show)</span><input name="tag" placeholder="any"></label><label class="check"><input type="checkbox" name="sealed"> Sealed boxes too</label>
          <div class="span2 row"><button class="primary small">🖨 Pull list by location</button></div></form></div>
    </div>
    <div class="panel" style="margin:.8rem 0 0"><h3 style="margin-top:0">Numbers</h3>
      <div class="week-grid"><div><b>${usd(r.revenue)}</b><span>${r.sales} sale${r.sales === 1 ? "" : "s"} · ${r.cards} cards</span></div><div><b>${usd(r.cogs)}</b><span>what those cards cost</span></div><div><b>${usd(r.table + r.expenses)}</b><span>table + show expenses</span></div><div><b class="${r.profit >= 0 ? "pos" : "neg"}">${usd(r.profit)}</b><span>profit</span></div></div>
      ${Object.keys(r.byPayment).length ? `<p class="small">${Object.entries(r.byPayment).map(([p, v]) => `${esc(p)} ${usd(v)}`).join(" · ")}</p>` : `<p class="small muted">Sales made in Show mode on the show's days are filed here. Expenses you add with this show picked count too.</p>`}
      <h3>Cash drawer</h3>
      <form class="form-grid" data-cash><label>Cash at the start $<input name="startCash" type="number" min="0" step="0.01" value="${esc(cash.start ?? "")}"></label><label>Cash paid out (cards bought) $<input name="cashOut" type="number" min="0" step="0.01" value="${esc(cash.out || "")}"></label>
        <label>Counted at the end $<input name="countedCash" type="number" min="0" step="0.01" value="${esc(cash.counted ?? "")}"></label><div class="small">${cash.expected != null ? `Expected in the drawer: <b>${usd(cash.expected)}</b> (start + ${usd(cash.sales)} cash sales − paid out)${cash.over != null ? `<br>${Math.abs(cash.over) < 0.01 ? "✓ The drawer is even." : `<b class="${cash.over > 0 ? "pos" : "neg"}">${cash.over > 0 ? "Over" : "Short"} by ${usd(Math.abs(cash.over))}</b>`}` : ""}` : "Enter the starting cash to see what the drawer should hold."}</div>
        <div class="span2 row"><button class="small primary">Save the count</button></div></form>
    </div>`, { wide: true });
  const patch = (p) => fetch("/api/shows/" + s.id, json("PATCH", p)).then((x) => x.json());
  $("[data-editshow]", body).onclick = () => openShowEditor(s);
  $$("[data-ck]", body).forEach((c) => (c.onchange = () => { s.checklist[+c.dataset.ck].done = c.checked; patch({ checklist: s.checklist }); }));
  $("[data-addck]", body).onsubmit = async (e) => { e.preventDefault(); const t = e.target.t.value.trim(); if (!t) return; s.checklist.push({ text: t, done: false }); await patch({ checklist: s.checklist }); openShow(s.id); };
  $("[data-resetck]", body).onclick = async () => { s.checklist.forEach((c) => (c.done = false)); await patch({ checklist: s.checklist }); openShow(s.id); };
  $("[data-cash]", body).onsubmit = async (e) => { e.preventDefault(); await patch(Object.fromEntries(new FormData(e.target))); toast("Saved"); openShow(s.id); };
  $("[data-bring]", body).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    store.set("bringMin", f.minValue.value);
    const q = new URLSearchParams({ minValue: f.minValue.value || 0, category: f.category.value, tag: f.tag.value.trim(), sealed: f.sealed.checked ? "1" : "" });
    const rows = await getJSON(`/api/shows/${s.id}/bring?${q}`);
    if (!rows.length) return toast("No cards match — lower the value or clear the filters.");
    const byLoc = new Map();
    for (const x of rows) byLoc.set(x.location || "No location", [...(byLoc.get(x.location || "No location") || []), x]);
    printDoc(`Pull list — ${s.name}`, `<h1>Pull list — ${esc(s.name)}</h1><div class="muted">${esc(day(s.date))} · ${rows.length} rows · ${rows.reduce((n, x) => n + x.qty, 0)} cards · worth ${usd(rows.reduce((n, x) => n + (x.value || 0) * x.qty, 0))}</div>
      ${[...byLoc].map(([loc, list]) => `<h2>📍 ${esc(loc)}</h2><table><tr><th>☐</th><th>SKU</th><th>Card</th><th class="num">Qty</th><th class="num">Value</th><th class="num">Price</th></tr>${list.map((x) => `<tr><td>☐</td><td>${esc(x.sku || "")}</td><td>${esc(x.name)} (${esc(x.grade)})${x.web ? " · on the website" : ""}</td><td class="num">${x.qty}</td><td class="num">${usd(x.value)}</td><td class="num">${usd(x.listPrice)}</td></tr>`).join("")}</table>`).join("")}
      <p class="muted">Cards also on the website stay there — if one sells at the table, Show mode takes it off the site.</p>`);
  };
}

// ------------------------------------------------------------------ SUPPLIES

async function loadSupplies() {
  const list = await getJSON("/api/supplies");
  $("#shopActions").innerHTML = `<button class="primary" data-addsup>＋ Add a supply</button>`;
  $("#shopActions [data-addsup]").onclick = () => openSupply();
  const low = list.filter((x) => x.onHand <= x.reorderAt);
  $("#shopBody").innerHTML = `
    <div class="panel small">Each website order uses up its "per order" amounts (a sleeve, a top loader, a team bag, a mailer…) and each card sold at a show its "per card" amounts. When something reaches its reorder point you get an alert. <b>＋ Restock</b> when a delivery comes in (it can file the expense too).</div>
    ${low.length ? `<div class="panel"><b class="neg">Time to reorder:</b> ${low.map((x) => `${esc(x.name)} (${x.onHand} left)`).join(" · ")}</div>` : ""}
    <div class="panel table-wrap"><table><tr><th>Supply</th><th class="num">On hand</th><th class="num">Reorder at</th><th class="num">Per order</th><th class="num">Per card</th><th class="num">Cost each</th><th></th></tr>
      ${list.map((x) => `<tr data-sup="${esc(x.id)}" class="${x.onHand <= x.reorderAt ? "low" : ""}"><td><b>${esc(x.name)}</b>${x.link ? ` <span class="small">${link(x.link, "reorder")}</span>` : ""}</td><td class="num ${x.onHand <= x.reorderAt ? "neg" : ""}">${x.onHand}${x.unit ? " " + esc(x.unit) : ""}</td><td class="num">${x.reorderAt}</td><td class="num">${x.perOrder || "—"}</td><td class="num">${x.perCard || "—"}</td><td class="num">${usd(x.cost)}</td>
        <td class="nowrap"><button class="small" data-restock>＋ Restock</button><button class="small ghost" data-edit aria-label="Edit">✎</button><button class="small ghost" data-del aria-label="Delete">🗑</button></td></tr>`).join("")}</table></div>`;
  $$("#shopBody tr[data-sup]").forEach((tr) => {
    const x = list.find((s) => s.id === tr.dataset.sup);
    $("[data-edit]", tr).onclick = () => openSupply(x);
    $("[data-del]", tr).onclick = async () => { await fetch("/api/supplies/" + x.id, { method: "DELETE" }); toast(`${x.name} removed`); loadSupplies(); };
    $("[data-restock]", tr).onclick = () => {
      const body = openModal(`Restock — ${x.name}`, `<form class="form-grid" data-rs><label>How many came in<input name="qty" type="number" min="1" step="1" required></label><label>Paid for them $ <span class="muted small">(files a Supplies expense)</span><input name="paid" type="number" min="0" step="0.01"></label><div class="span2 row"><button class="primary">Add to stock</button></div></form>`);
      $("[data-rs]", body).onsubmit = async (e) => { e.preventDefault(); const r = await fetch(`/api/supplies/${x.id}/restock`, json("POST", Object.fromEntries(new FormData(e.target)))); if (!r.ok) return toast((await r.json()).error, { error: true }); modal.close(); toast("Restocked"); loadSupplies(); };
    };
  });
}
function openSupply(x = null) {
  const body = openModal(x ? `Edit — ${x.name}` : "Add a supply", `
    <form class="form-grid" data-supf>
      <label class="span2">Name<input name="name" required value="${esc(x?.name || "")}" placeholder="Top loaders"></label>
      <label>On hand<input name="onHand" type="number" min="0" step="1" value="${esc(x?.onHand ?? 0)}"></label><label>Unit <span class="muted small">(optional)</span><input name="unit" value="${esc(x?.unit || "")}" placeholder="each, rolls…"></label>
      <label>Reorder when down to<input name="reorderAt" type="number" min="0" step="1" value="${esc(x?.reorderAt ?? 0)}"></label><label>Cost each $<input name="cost" type="number" min="0" step="0.01" value="${esc(x?.cost ?? "")}"></label>
      <label>Used per website order<input name="perOrder" type="number" min="0" step="0.5" value="${esc(x?.perOrder ?? 0)}"></label><label>Used per card sold at a show<input name="perCard" type="number" min="0" step="0.5" value="${esc(x?.perCard ?? 0)}"></label>
      <label class="span2">Where to reorder (link)<input name="link" value="${esc(x?.link || "")}" placeholder="https://…"></label>
      <div class="span2 row"><button class="primary">${x ? "Save" : "Add"}</button></div>
    </form>`);
  $("[data-supf]", body).onsubmit = async (e) => {
    e.preventDefault();
    const r = await fetch("/api/supplies", json("PUT", { ...(x ? { id: x.id } : {}), ...Object.fromEntries(new FormData(e.target)) }));
    if (!r.ok) return toast("Couldn't save", { error: true });
    modal.close();
    toast("Saved");
    loadSupplies();
  };
}

// ------------------------------------------------------------------ SHOP SETTINGS

async function loadShopSettings() {
  const s = await getJSON("/api/shop/settings");
  const priceRow = (p = {}) => `<div class="row" data-price style="margin:.2rem 0"><input name="service" value="${esc(p.service || "")}" placeholder="PSA Value" style="flex:1" aria-label="Service"><input name="fee" type="number" min="0" step="0.01" value="${esc(p.fee ?? "")}" placeholder="$ per card" style="width:110px" aria-label="Fee per card"><button type="button" class="ghost small" data-rm aria-label="Remove">✕</button></div>`;
  $("#shopBody").innerHTML = `<div class="panel"><form class="form-grid" data-shopset>
    <label>Consignment commission % <span class="muted small">(what the shop keeps of each sale)</span><input name="consignPct" type="number" min="0" max="60" step="0.5" value="${esc(s.consignPct)}"></label>
    <div class="span2"><b>Grading service prices</b> <span class="small muted">— what you charge a customer per card, by service</span><div data-prices>${(s.gradingPrices.length ? s.gradingPrices : [{}]).map(priceRow).join("")}</div><button type="button" class="small" data-addprice>＋ Service</button></div>
    <div class="span2 row"><button class="primary">Save</button></div></form></div>`;
  const box = $("#shopBody [data-prices]");
  const wire = () => $$("[data-rm]", box).forEach((b) => (b.onclick = () => { b.closest("[data-price]").remove(); wire(); }));
  wire();
  $("#shopBody [data-addprice]").onclick = () => { box.insertAdjacentHTML("beforeend", priceRow()); wire(); };
  $("#shopBody [data-shopset]").onsubmit = async (e) => {
    e.preventDefault();
    const gradingPrices = $$("[data-price]", box).map((r) => ({ service: $('[name="service"]', r).value, fee: $('[name="fee"]', r).value })).filter((g) => g.service.trim());
    await fetch("/api/shop/settings", json("PUT", { consignPct: e.target.consignPct.value, gradingPrices }));
    toast("Saved");
  };
}
