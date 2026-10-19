// Card Research Bot — tools: set browser, lot evaluator, centering tool, eBay deal finder,
// listing writer and PSA cert check. Uses helpers from app.js.
"use strict";

// ------------------------------------------------------------------ SET BROWSER

let currentSet = null;
async function findSets() {
  const q = $("#setSearch").value.trim();
  if (!q) return;
  $("#setList").innerHTML = `<p class="muted small">Searching…</p>`;
  try {
    const sets = await getJSON("/api/sets?q=" + encodeURIComponent(q));
    $("#setList").innerHTML = sets.length
      ? sets.map((s) => `<button data-url="${esc(s.url)}">${esc(s.name)}</button>`).join("")
      : `<p class="muted small">No sets found — try e.g. "2023 Prizm basketball" or "Romance Dawn".</p>`;
    $$("#setList button").forEach((b) => (b.onclick = () => { $$("#setList button").forEach((x) => x.classList.toggle("active", x === b)); openSet(b.dataset.url); }));
    if (sets.length === 1) $("#setList button").click();
  } catch (err) {
    $("#setList").innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}
$("#setSearchBtn").onclick = findSets;
$("#setSearch").addEventListener("keydown", (e) => e.key === "Enter" && findSets());

async function openSet(url, sort = "highest-price", rookies = false) {
  currentSet = { url, sort, rookies };
  $("#setResult").innerHTML = `<div class="panel muted">Loading every card in the set…</div>`;
  try {
    const s = await getJSON(`/api/set?url=${encodeURIComponent(url)}&sort=${sort}&rookies=${rookies ? 1 : 0}`);
    $("#setResult").innerHTML = `
      <div class="panel">
        <div class="row space" style="margin:0">
          <h2 style="margin:0">${esc(s.title.replace(/^Most Expensive\s+/i, ""))}</h2>
          <div class="row" style="margin:0">
            <select data-sort aria-label="Sort cards">${[["highest-price", "Most valuable"], ["popularity", "Most popular"], ["model-number", "Card number"], ["lowest-price", "Cheapest"], ["name", "A–Z"]].map(([v, l]) => `<option value="${v}"${v === sort ? " selected" : ""}>${l}</option>`).join("")}</select>
            <label class="check" style="margin:0"><input type="checkbox" data-rookies${rookies ? " checked" : ""}> Rookies only</label>
            ${link(s.url, "open on site")}
          </div>
        </div>
        <p class="small muted">${s.cards.length} cards shown (the site lists up to 150 per view — use the sort to see different slices). Click a card for its sales and history.</p>
        <div class="table-wrap"><table class="set-table"><tr><th>#</th><th>Card</th>${s.columns.map((c) => `<th class="num">${esc(c)}</th>`).join("")}</tr>
          ${s.cards.map((c, i) => `<tr data-url="${esc(c.url)}" tabindex="0" role="button"><td class="muted">${i + 1}</td><td>${esc(c.name)}${c.rookie ? ` <span class="chip">RC</span>` : ""}</td>${c.prices.map((p) => `<td class="num">${usd(p)}</td>`).join("")}</tr>`).join("")}
        </table></div>
      </div>
      <div id="setCard"></div>`;
    $("#setResult [data-sort]").onchange = (e) => openSet(url, e.target.value, rookies);
    $("#setResult [data-rookies]").onchange = (e) => openSet(url, sort, e.target.checked);
    $$("#setResult tr[data-url]").forEach((tr) => {
      const open = async () => {
        $$("#setResult tr.sel").forEach((x) => x.classList.remove("sel"));
        tr.classList.add("sel");
        const box = $("#setCard");
        box.innerHTML = `<div class="report muted">Loading…</div>`;
        try {
          box.innerHTML = `<div class="report" id="setCardInner"></div>`;
          renderQuickCard(await getJSON("/api/quick/card?url=" + encodeURIComponent(tr.dataset.url)), $("#setCardInner"));
          box.scrollIntoView({ behavior: "smooth", block: "start" });
        } catch (err) {
          box.innerHTML = `<div class="report error">${esc(err.message)}</div>`;
        }
      };
      tr.onclick = open;
      tr.onkeydown = (e) => e.key === "Enter" && open();
    });
  } catch (err) {
    $("#setResult").innerHTML = `<div class="panel error">${esc(err.message)}</div>`;
  }
}

// ------------------------------------------------------------------ LOT / BINDER PAGE

window.lotCtrl = null;
async function runLot() {
  if (!photos.length) return alertBox($("#lookupResult"), "Drop a photo of the lot or binder page first.");
  $("#researchBtn").disabled = true;
  $("#cancelBtn").classList.remove("hidden");
  window.lotCtrl = new AbortController();
  try {
    const { lot } = await streamPost("/api/lot", { images: photos.map(({ mediaType, data }) => ({ mediaType, data })), text: $("#lookupText").value }, $("#lookupProgress"), window.lotCtrl);
    renderLot(lot);
  } catch (err) {
    alertBox($("#lookupResult"), err.message);
  } finally {
    $("#researchBtn").disabled = false;
    $("#cancelBtn").classList.add("hidden");
  }
}

function renderLot(lot) {
  const el = $("#lookupResult");
  el.innerHTML = `
    <article class="report">
      <div class="report-head">
        <div><h2 class="report-title">Lot: ${lot.cards.length} cards found</h2>
          <div class="small muted">${lot.priced} priced from recent sales${lot.unreadable ? ` · ${lot.unreadable} couldn't be read` : ""}</div></div>
        <div class="value-box"><div class="muted small">Total market value</div><div class="value-big">${usd(lot.total)}</div></div>
      </div>
      ${lot.notes ? `<p class="summary">${esc(lot.notes)}</p>` : ""}
      <div class="callout" style="margin-top:1rem">
        <div class="calc">
          <label>Asking price $<input type="number" min="0" step="1" data-ask></label>
          <label>Pay up to (% of value)<input type="number" min="10" max="100" step="5" value="65" data-pct></label>
        </div>
        <div data-offer class="small"></div>
      </div>
      <div class="table-wrap" style="margin-top:1rem"><table>
        <tr><th>Card</th><th>Grade</th><th>ID</th><th class="num">Value</th><th>Matched to</th><th></th></tr>
        ${lot.cards.map((c, i) => `<tr><td><b>${esc(c.name)}</b><div class="small muted">${esc(c.position)}${c.condition_note ? " · " + esc(c.condition_note) : ""}</div></td>
          <td class="small">${esc(c.grade)}</td>
          <td><span class="chip ${c.confidence === "high" ? "good" : c.confidence === "low" ? "bad" : "warn"}">${esc(c.confidence)}</span></td>
          <td class="num">${usd(c.value)}</td>
          <td class="small">${c.url ? link(c.url, c.matched) : `<span class="muted">no match — check by hand</span>`}${c.volume ? `<div class="muted">${esc(c.volume)}</div>` : ""}</td>
          <td>${c.url ? `<button class="small" data-lwatch="${i}">★</button>` : ""}</td></tr>`).join("")}
      </table></div>
      <div class="foot"><span>${esc(costLine(lot.usage))}</span>
        <span class="actions"><button data-addall>＋ Add priced cards to inventory</button></span></div>
    </article>`;
  const offer = () => {
    const ask = parseFloat($("[data-ask]", el).value) || 0;
    const p = (parseFloat($("[data-pct]", el).value) || 65) / 100;
    const max = lot.total * p;
    $("[data-offer]", el).innerHTML = lot.total
      ? `At ${Math.round(p * 100)}% of market, pay up to <b>${usd(max)}</b>.` +
        (ask ? ` Asking ${usd(ask)} is <b>${Math.round((ask / lot.total) * 100)}%</b> of market → ${ask <= max ? `<span class="pos"><b>good buy</b></span> (room for ~${usd(lot.total - ask)} gross before fees)` : `<span class="neg"><b>too high</b></span> — counter around ${usd(Math.round(max))}`}.` : " Enter the asking price to get a verdict.") +
        ` <span class="muted">Dealers typically pay 50–75% of market for lots; unpriced cards aren't counted.</span>`
      : "No cards could be priced — check the matches by hand.";
  };
  $$("[data-ask], [data-pct]", el).forEach((i) => (i.oninput = offer));
  offer();
  $$("[data-lwatch]", el).forEach((b) => (b.onclick = async () => {
    const c = lot.cards[+b.dataset.lwatch];
    const r = await fetch("/api/watchlist", json("POST", { url: c.url, name: c.matched, grade: c.grade }));
    b.textContent = r.ok ? "✓" : "✗";
    b.disabled = true;
  }));
  $("[data-addall]", el).onclick = async (e) => {
    const priced = lot.cards.filter((c) => c.url && c.value != null);
    if (!priced.length) return toast("No priced cards to add.");
    const ask = parseFloat($("[data-ask]", el).value) || 0;
    e.target.disabled = true;
    for (const c of priced) {
      // Split what you paid for the lot across cards in proportion to their value.
      const cost = ask && lot.total ? Math.round((ask * c.value / lot.total) * 100) / 100 : 0;
      await fetch("/api/inventory", json("POST", { name: c.matched || c.name, grade: c.grade, category: c.category, priceUrl: c.url, value: c.value, cost, notes: "From a lot" }));
    }
    e.target.textContent = `✓ Added ${priced.length} cards${ask ? " (cost split by value)" : ""}`;
  };
}

// ------------------------------------------------------------------ CENTERING TOOL

// Approximate PSA front-centering limits (worse side %) per grade; backs are allowed much more.
const FRONT_LIMITS = [[60, "10"], [65, "9"], [70, "8"], [75, "7"], [80, "6"], [85, "5"], [90, "4"], [101, "3 or lower"]];
const BACK_LIMITS = [[75, "10"], [90, "9 / 8 / 7"], [101, "6 or lower"]];

function openCentering(photo) {
  if (!photo) return;
  const body = openModal("Measure centering", `
    <p class="small">Drag the <b>outer</b> lines (green) to the card's edges and the <b>inner</b> lines (gold) to the edges of the printed border/frame. Tip: click a line, then use the arrow keys for fine moves.</p>
    <div class="center-wrap" data-wrap><img src="${photo.url}" alt="card photo for centering" data-img draggable="false"></div>
    <label class="check"><input type="checkbox" data-back> This photo is the <b>back</b> of the card</label>
    <div data-out class="center-out" aria-live="polite"></div>`, { wide: true });
  const wrap = $("[data-wrap]", body);
  // positions in % of the image box
  const lines = { oL: 2, iL: 8, iR: 92, oR: 98, oT: 2, iT: 6, iB: 94, oB: 98 };
  const vertical = (k) => /L|R/.test(k[1]);
  for (const k of Object.keys(lines)) {
    const b = document.createElement("button");
    b.className = `cline ${vertical(k) ? "v" : "h"} ${k[0] === "o" ? "outer" : "inner"}`;
    b.dataset.k = k;
    b.setAttribute("aria-label", `${k[0] === "o" ? "Outer" : "Inner"} ${{ L: "left", R: "right", T: "top", B: "bottom" }[k[1]]} line`);
    wrap.appendChild(b);
  }
  const place = () => {
    $$(".cline", wrap).forEach((b) => (b.style[vertical(b.dataset.k) ? "left" : "top"] = lines[b.dataset.k] + "%"));
    const img = $("[data-img]", wrap);
    const W = img.naturalWidth, H = img.naturalHeight;
    const l = (lines.iL - lines.oL) * W, r = (lines.oR - lines.iR) * W, t = (lines.iT - lines.oT) * H, bt = (lines.oB - lines.iB) * H;
    const lr = l + r > 0 ? Math.round((Math.max(l, r) / (l + r)) * 100) : null;
    const tb = t + bt > 0 ? Math.round((Math.max(t, bt) / (t + bt)) * 100) : null;
    const worst = Math.max(lr ?? 0, tb ?? 0);
    const limits = $("[data-back]", body).checked ? BACK_LIMITS : FRONT_LIMITS;
    const grade = limits.find(([lim]) => worst <= lim)?.[1];
    const ok = l > 0 && r > 0 && t > 0 && bt > 0;
    $("[data-out]", body).innerHTML = ok
      ? `Left/right <b>${l >= r ? lr + "/" + (100 - lr) : 100 - lr + "/" + lr}</b> · Top/bottom <b>${t >= bt ? tb + "/" + (100 - tb) : 100 - tb + "/" + tb}</b> →
         centering alone allows up to about a <b>PSA ${esc(grade)}</b>. <span class="muted small">Approximate PSA guide; corners, edges and surface also count. Straight-on photos measure best.</span>`
      : `<span class="bad">Lines are crossed — keep each inner line inside its outer line.</span>`;
  };
  let dragging = null;
  const toPct = (e) => {
    const rect = wrap.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 };
  };
  wrap.addEventListener("pointerdown", (e) => {
    const p = toPct(e);
    let best = null, bestD = 4; // grab within ~4% of a line
    for (const k of Object.keys(lines)) {
      const d = Math.abs((vertical(k) ? p.x : p.y) - lines[k]);
      if (d < bestD) { best = k; bestD = d; }
    }
    if (!best) return;
    dragging = best;
    wrap.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  wrap.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const p = toPct(e);
    lines[dragging] = Math.min(100, Math.max(0, vertical(dragging) ? p.x : p.y));
    place();
  });
  wrap.addEventListener("pointerup", () => (dragging = null));
  $$(".cline", wrap).forEach((b) => (b.onkeydown = (e) => {
    const k = b.dataset.k, step = e.shiftKey ? 1 : 0.2;
    const d = { ArrowLeft: -step, ArrowUp: -step, ArrowRight: step, ArrowDown: step }[e.key];
    if (d == null) return;
    e.preventDefault();
    lines[k] = Math.min(100, Math.max(0, lines[k] + d));
    place();
  }));
  $("[data-back]", body).onchange = place;
  const img = $("[data-img]", wrap);
  img.complete ? place() : (img.onload = place);
}

// ------------------------------------------------------------------ EBAY DEAL FINDER

async function openDeals({ url, grade = "Raw", q, name }) {
  const body = openModal(`Deals: ${name || "this card"}`, `<p class="muted">Searching live eBay listings…</p>`, { wide: true });
  if (!status.ebay) {
    body.innerHTML = `<p>The deal finder compares <b>live eBay listings</b> with this card's recent <b>sold</b> value and flags anything well underpriced.</p>
      <p>It needs free eBay developer keys (one-time, ~5 minutes):</p>
      <ol class="tight small"><li>Go to <a href="https://developer.ebay.com/my/keys" target="_blank" rel="noopener">developer.ebay.com</a> and sign in / join (free).</li>
      <li>Create a <b>Production</b> keyset (application title anything, e.g. "card bot").</li>
      <li>Copy the <b>App ID (Client ID)</b> and <b>Cert ID (Client Secret)</b> into <b>Settings → Optional connections → eBay</b>.</li></ol>
      <div class="row"><button class="primary" data-settings>Open Settings</button></div>`;
    $("[data-settings]", body).onclick = () => { modal.close(); openSettings(); };
    return;
  }
  try {
    const d = await getJSON(`/api/deals?url=${encodeURIComponent(url)}&grade=${encodeURIComponent(grade)}${q ? "&q=" + encodeURIComponent(q) : ""}`);
    const row = (l) => `<tr>${l.image ? `<td><img src="${esc(l.image)}" alt="" class="deal-img" loading="lazy"></td>` : "<td></td>"}
      <td>${link(l.url, l.title)}<div class="small muted">${esc(l.buying)}${l.bids != null ? ` · ${l.bids} bids` : ""}${l.ends ? ` · ends ${esc(when(l.ends))}` : ""}${l.seller ? ` · ${esc(l.seller)}` : ""}</div></td>
      <td class="num">${usd(l.total)}<div class="small muted">${l.shipping ? "incl. " + usd(l.shipping) + " ship" : "free ship"}</div></td>
      <td class="num">${l.discountPct >= 0 ? `<span class="pos"><b>${l.discountPct}% under</b></span>` : `<span class="muted">${-l.discountPct}% over</span>`}</td></tr>`;
    body.innerHTML = `
      <p class="small">Recent sold value for <b>${esc(grade)}</b>: <b>${usd(d.value)}</b> (${esc(d.card)}). Checked ${d.searched} live listings.
        <span class="muted">Always open the listing and confirm it's the exact card, parallel and grade — titles can be misleading.</span></p>
      <h3>${d.deals.length ? `🔥 ${d.deals.length} listing${d.deals.length > 1 ? "s" : ""} 15%+ under sold value` : "No listings 15%+ under sold value right now"}</h3>
      ${d.deals.length ? `<div class="table-wrap"><table>${d.deals.map(row).join("")}</table></div>` : ""}
      ${d.others.length ? `<details><summary>Other matching listings (${d.others.length})</summary><div class="table-wrap"><table>${d.others.map(row).join("")}</table></div></details>` : ""}`;
  } catch (err) {
    body.innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

// ------------------------------------------------------------------ LISTING WRITER

async function openListing(report, platform = "eBay") {
  if (needKey()) return;
  const body = openModal(`Listing: ${report.card?.name || ""}`, `
    <div class="row" style="margin-top:0"><label class="small">Platform <select data-platform>${["eBay", "TCGplayer", "Whatnot", "Facebook"].map((p) => `<option${p === platform ? " selected" : ""}>${p}</option>`).join("")}</select></label></div>
    <div data-progress class="progress" aria-live="polite"></div><div data-out></div>`, { wide: true });
  $("[data-platform]", body).onchange = (e) => openListing(report, e.target.value);
  const ctrl = new AbortController();
  modal.addEventListener("close", () => ctrl.abort(), { once: true });
  try {
    const { listing: l } = await streamPost("/api/listing", { lookupId: report.id, platform }, $("[data-progress]", body), ctrl);
    $("[data-progress]", body).classList.add("hidden");
    const specifics = (l.item_specifics || []).map((s) => `${s.name}: ${s.value}`).join("\n");
    $("[data-out]", body).innerHTML = `
      <label class="lbl">Title <span class="muted small">(${l.title.length}/80)</span></label>
      <div class="row" style="margin:0"><input type="text" value="${esc(l.title)}" data-title style="flex:1" maxlength="80"><button data-copy="title">Copy</button></div>
      <label class="lbl">Description</label>
      <textarea rows="7" data-desc>${esc(l.description)}</textarea>
      <div class="row" style="margin-top:.3rem"><button data-copy="desc">Copy description</button></div>
      <h3>Item specifics</h3>
      <div class="table-wrap"><table>${(l.item_specifics || []).map((s) => `<tr><td class="muted">${esc(s.name)}</td><td>${esc(s.value)}</td></tr>`).join("")}</table></div>
      <div class="row"><button data-copy="spec">Copy item specifics</button></div>
      <h3>Pricing</h3>
      <div class="kv small"><span>Buy It Now</span><b>${usd(l.price)}</b><span>Auto-accept offers ≥</span><b>${usd(l.best_offer_auto_accept)}</b><span>Auto-decline offers &lt;</span><b>${usd(l.best_offer_auto_decline)}</b><span>Or auction start</span><b>${usd(l.auction_start)}</b></div>
      ${(l.photo_tips || []).length ? `<h3>Photo tips</h3><ul class="tight small">${l.photo_tips.map((t) => `<li>${esc(t)}</li>`).join("")}</ul>` : ""}
      <p class="small muted">${esc(costLine(l.usage))}</p>`;
    const out = $("[data-out]", body);
    const copy = async (text, btn) => { try { await navigator.clipboard.writeText(text); btn.textContent = "✓ Copied"; } catch { btn.textContent = "Copy failed"; } };
    $("[data-copy=title]", out).onclick = (e) => copy($("[data-title]", out).value, e.target);
    $("[data-copy=desc]", out).onclick = (e) => copy($("[data-desc]", out).value, e.target);
    $("[data-copy=spec]", out).onclick = (e) => copy(specifics, e.target);
  } catch (err) {
    $("[data-out]", body).innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
}

// ------------------------------------------------------------------ PSA CERT CHECK

async function checkCert() {
  const n = $("#certInput").value.replace(/\D/g, "");
  const out = $("#certOut");
  if (!status.psa) {
    out.innerHTML = `Needs a free PSA API token — add it in <a href="#" data-open-settings>Settings</a>. (Or check by hand at ${link("https://www.psacard.com/cert/" + n, "psacard.com/cert")}.)`;
    $("[data-open-settings]", out).onclick = (e) => { e.preventDefault(); openSettings(); };
    return;
  }
  out.textContent = "Checking with PSA…";
  try {
    const { cert: c, population: pop } = await getJSON("/api/psa/cert/" + n);
    if (!c.found) return (out.innerHTML = `<span class="bad">PSA has no record of cert #${esc(n)}.</span> Double-check the number — if it's right, the slab may not be genuine.`);
    const popRow = pop?.byGrade ? Object.entries(pop.byGrade).sort((a, b) => parseFloat(b[0]) - parseFloat(a[0])).slice(0, 6).map(([g, k]) => `${g}: ${k.toLocaleString()}`).join(" · ") : "";
    out.innerHTML = `<div class="callout ok-box" style="margin-top:.5rem"><b>${esc([c.year, c.brand, c.subject, c.cardNumber ? "#" + c.cardNumber : "", c.variety].filter(Boolean).join(" "))}</b><br>
      Grade: <b>${esc(c.gradeDescription || c.grade)}</b>${c.population != null ? ` · Pop ${c.population.toLocaleString()} (${c.populationHigher?.toLocaleString() ?? "?"} higher)` : ""}<br>
      ${popRow ? `<span class="muted">By grade — ${esc(popRow)}</span><br>` : ""}${link(c.url, "View on PSA")} · compare the photo there with the slab in your hand.</div>`;
  } catch (err) {
    out.innerHTML = `<span class="bad">${esc(err.message)}</span>`;
  }
}
$("#certBtn").onclick = checkCert;
$("#certInput").addEventListener("keydown", (e) => e.key === "Enter" && checkCert());
