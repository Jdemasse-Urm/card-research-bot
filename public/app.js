// Card Research Bot — front end (plain JS, no build step).
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : null);
const link = (u, text) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(text ?? u)}</a>` : esc(text ?? ""));
const usd = (n) => (n == null || isNaN(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: n < 100 ? 2 : 0, maximumFractionDigits: n < 100 ? 2 : 0 }));
const pct = (n) => (n == null ? "—" : `<span class="${n > 0 ? "pos" : n < 0 ? "neg" : ""}">${n > 0 ? "+" : ""}${n}%</span>`);
const when = (iso) => new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const CAT_LABEL = { baseball: "⚾ Baseball", basketball: "🏀 Basketball", football: "🏈 Football", yugioh: "🃏 Yu-Gi-Oh", onepiece: "🏴‍☠️ One Piece", other: "Other" };

// Opus 5.5 list prices — shown as a rough per-lookup cost.
function cost(u) {
  if (!u) return "";
  const d = (u.input * 4 + u.cacheRead * 0.2 + u.output * 20) / 1e6 + (u.webSearches || 0) * 0.01;
  return `≈ $${d.toFixed(2)} AI cost`;
}

let status = { hasKey: false };

// ------------------------------------------------------------------ tabs / settings

$$("#tabs button").forEach((b) =>
  b.addEventListener("click", () => {
    $$("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
    if (b.dataset.tab === "watch") loadWatch();
    if (b.dataset.tab === "history") loadHistory();
    if (b.dataset.tab === "hot") loadHotCached();
  }),
);
function goTab(name) {
  $(`#tabs button[data-tab="${name}"]`).click();
  window.scrollTo({ top: 0 });
}

async function refreshStatus() {
  status = await (await fetch("/api/status")).json();
  $("#keyBanner").classList.toggle("hidden", status.hasKey);
  $("#modelInfo").textContent = `AI model: ${status.model}. Key status: ${status.hasKey ? "saved ✓" : "not set"}.`;
}
const openSettings = () => { $("#keyMsg").textContent = ""; $("#settings").showModal(); };
$("#settingsBtn").onclick = openSettings;
$("#keyBannerBtn").onclick = openSettings;
$("#saveKey").onclick = async (e) => {
  e.preventDefault();
  const r = await fetch("/api/settings", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ apiKey: $("#keyInput").value }) });
  const j = await r.json();
  $("#keyMsg").textContent = j.ok ? "Saved ✓" : j.error;
  if (j.ok) { $("#keyInput").value = ""; await refreshStatus(); setTimeout(() => $("#settings").close(), 600); }
};

// ------------------------------------------------------------------ streaming helper

async function streamPost(url, body, progressEl) {
  progressEl.classList.remove("hidden", "done");
  progressEl.innerHTML = "<div>Starting…</div>";
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", final = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.type === "step") {
        progressEl.insertAdjacentHTML("beforeend", `<div>${esc(ev.text)}</div>`);
        progressEl.scrollTop = progressEl.scrollHeight;
      } else if (ev.type === "done" || ev.type === "error") final = ev;
    }
  }
  progressEl.classList.add("done");
  if (!final) throw new Error("Connection closed before the research finished.");
  if (final.type === "error") throw new Error(final.message);
  progressEl.insertAdjacentHTML("beforeend", `<div>✓ Done</div>`);
  return final;
}

function needKey() {
  if (status.hasKey) return false;
  openSettings();
  return true;
}

// ------------------------------------------------------------------ images (drop / pick / paste)

let photos = []; // { mediaType, data(base64), url }
const MAX_SIDE = 1600;

function readAsImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => reject(new Error(`Can't open ${file.name || "that image"}${/heic|heif/i.test(file.type + file.name) ? " — HEIC photos: export as JPEG first (in Photos: File → Export)" : ""}.`));
    img.src = url;
  });
}

async function addFiles(files) {
  for (const f of files) {
    if (!f.type.startsWith("image/") && !/\.(heic|heif)$/i.test(f.name)) continue;
    if (photos.length >= 4) break;
    try {
      const { img, url } = await readAsImage(f);
      const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL("image/jpeg", 0.9);
      photos.push({ mediaType: "image/jpeg", data: dataUrl.split(",")[1], url: dataUrl });
      URL.revokeObjectURL(url);
    } catch (err) {
      alertBox($("#lookupResult"), err.message);
    }
  }
  renderThumbs();
}

function renderThumbs() {
  $("#thumbs").innerHTML = photos
    .map((p, i) => `<div class="thumb"><img src="${p.url}" alt="card photo ${i + 1}"><button data-i="${i}" title="Remove">×</button></div>`)
    .join("");
  $$("#thumbs button").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); photos.splice(+b.dataset.i, 1); renderThumbs(); }));
  $(".drop-inner").classList.toggle("hidden", photos.length > 0);
}

const drop = $("#drop");
drop.onclick = () => $("#fileInput").click();
$("#fileInput").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); if ($("#tab-lookup").classList.contains("active")) addFiles([...e.dataTransfer.files]); });
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length && $("#tab-lookup").classList.contains("active")) addFiles(files);
});

function alertBox(el, msg) {
  el.innerHTML = `<div class="report"><div class="error">⚠ ${esc(msg)}</div></div>`;
}

$("#clearBtn").onclick = () => {
  photos = []; renderThumbs(); $("#lookupText").value = "";
  $("#lookupProgress").classList.add("hidden");
};

// ------------------------------------------------------------------ AI lookup

$("#researchBtn").onclick = async () => {
  if (needKey()) return;
  const text = $("#lookupText").value;
  if (!photos.length && !text.trim()) return alertBox($("#lookupResult"), "Drop a card photo or type a card name first.");
  const btn = $("#researchBtn");
  btn.disabled = true;
  try {
    const { report } = await streamPost("/api/lookup", { images: photos.map(({ mediaType, data }) => ({ mediaType, data })), text }, $("#lookupProgress"));
    renderReport(report, $("#lookupResult"));
  } catch (err) {
    alertBox($("#lookupResult"), err.message);
  } finally {
    btn.disabled = false;
  }
};
$("#lookupText").addEventListener("keydown", (e) => { if (e.key === "Enter") (status.hasKey || photos.length ? $("#researchBtn") : $("#quickBtn")).click(); });

const recClass = { grade_it: "good", maybe: "warn", dont_grade: "bad", already_graded: "" };
const recLabel = { grade_it: "Grade it", maybe: "Maybe grade", dont_grade: "Don't grade", already_graded: "Already graded" };
const verdictClass = { buy: "good", hold: "warn", sell: "bad", pass: "" };
const demandClass = { hot: "bad", rising: "good", steady: "", cooling: "warn", cold: "" };

function renderReport(r, el) {
  const c = r.card || {}, p = r.pricing || {}, m = r.market || {}, g = r.grading || {}, bs = r.buy_sell || {};
  const chips = [
    CAT_LABEL[c.category] || c.category,
    c.rookie && "RC",
    c.autograph && "Auto",
    c.memorabilia && "Patch/Relic",
    c.serial_number && `#'d ${c.serial_number}`,
    c.grading_company && c.grade && `${c.grading_company} ${c.grade}`,
    !c.grading_company && "Raw",
  ].filter(Boolean);

  el.innerHTML = `
  <div class="report">
    <div class="report-head">
      <div>
        <h2 class="report-title">${esc(c.name)}</h2>
        <div class="chips">${chips.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}
          <span class="chip ${c.identification_confidence === "high" ? "good" : c.identification_confidence === "low" ? "bad" : "warn"}">ID: ${esc(c.identification_confidence)} confidence</span>
          <span class="chip ${demandClass[m.demand] || ""}">Demand: ${esc(m.demand)}</span>
        </div>
      </div>
      <div class="value-box">
        <div class="muted small">Estimated value</div>
        <div class="value-big">${usd(p.estimated_value_usd)}</div>
        <div class="value-range">${p.value_range_low != null ? `${usd(p.value_range_low)} – ${usd(p.value_range_high)}` : ""}</div>
      </div>
    </div>
    <p class="summary">${esc(r.summary)}</p>

    <div class="grid2" style="margin-top:1rem">
      <div class="callout">
        <div class="muted small">Reseller call</div>
        <div class="big"><span class="chip ${verdictClass[bs.verdict] || ""}" style="font-size:1rem">${esc(String(bs.verdict || "").toUpperCase())}</span></div>
        <div class="kv" style="margin-top:.5rem">
          <span>Max buy price</span><b>${usd(bs.max_buy_price)}</b>
          <span>List at</span><b>${usd(bs.list_price)}</b>
          <span>Quick sale</span><b>${usd(bs.quick_sale_price)}</b>
        </div>
        <p class="small">${esc(bs.reasoning)}</p>
      </div>
      <div class="callout">
        <div class="muted small">Grading</div>
        <div class="big"><span class="chip ${recClass[g.recommendation] || ""}" style="font-size:1rem">${esc(recLabel[g.recommendation] || g.recommendation)}</span></div>
        <p class="small">${esc(g.reasoning)}</p>
        <div class="muted small"><b>Condition:</b> ${esc(c.condition_notes)}</div>
      </div>
    </div>

    <div class="grid2">
      <div>
        <h3>Value by grade</h3>
        <table><tr><th>Grade</th><th class="num">Value</th></tr>
          ${(p.grade_values || []).map((x) => `<tr><td>${esc(x.grade)}</td><td class="num">${usd(x.value)}</td></tr>`).join("") || `<tr><td colspan=2 class="muted">No grade data found</td></tr>`}
        </table>
        <h3>Trend</h3>
        <p class="small">${esc(p.trend_summary)}</p>
        <p class="small muted"><b>Volume:</b> ${esc(m.sales_volume)}</p>
      </div>
      <div>
        <h3>Recent sold</h3>
        <table><tr><th>Date</th><th>Grade</th><th class="num">Price</th></tr>
          ${(p.recent_sales || []).map((s) => `<tr title="${esc(s.title)}"><td>${esc(s.date)}</td><td>${esc(s.grade)} <span class="muted small">${esc(s.source)}</span></td><td class="num">${usd(s.price)}</td></tr>`).join("") || `<tr><td colspan=3 class="muted">No recent sales found</td></tr>`}
        </table>
        <p class="small muted">${esc(p.basis)} ${p.pricecharting_url ? "· " + link(p.pricecharting_url, "sales source") : ""}</p>
      </div>
    </div>

    <div class="grid2">
      <div>
        <h3>Market outlook</h3>
        <p class="small">${esc(m.outlook)}</p>
        ${(m.recent_news || []).length ? `<ul class="tight small">${m.recent_news.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}
      </div>
      <div>
        <h3>Key facts</h3>
        <ul class="tight small">${(r.key_facts || []).map((f) => `<li>${esc(f)}</li>`).join("")}</ul>
      </div>
    </div>

    <h3>Card details</h3>
    <div class="kv small">
      ${[["Player / character", c.player_or_character], ["Year", c.year], ["Set", c.brand_set], ["Number", c.card_number], ["Parallel / variant", c.parallel_or_variant], ["Team", c.team], ["How it was identified", c.identification_notes]]
        .filter(([, v]) => v).map(([k, v]) => `<span class="muted">${esc(k)}</span><span>${esc(v)}</span>`).join("")}
    </div>

    ${(r.sources || []).length ? `<h3>Sources</h3><div class="sources">${r.sources.map((s) => link(s.url, s.title)).join("")}</div>` : ""}

    <div class="foot">
      <span>${r.at ? "Researched " + esc(when(r.at)) : ""} ${esc(cost(r.usage))}</span>
      <span class="row" style="margin:0">
        ${r.id ? `<button class="watch-add" data-id="${esc(r.id)}">★ Add to watchlist</button>` : ""}
      </span>
    </div>
  </div>`;
  const wb = $(".watch-add", el);
  if (wb) wb.onclick = async () => {
    const res = await fetch("/api/watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lookupId: wb.dataset.id }) });
    wb.textContent = res.ok ? "★ On watchlist" : "Couldn't add";
    wb.disabled = true;
  };
}

// ------------------------------------------------------------------ quick (free) price

$("#quickBtn").onclick = async () => {
  const q = $("#lookupText").value.trim();
  const out = $("#lookupResult");
  if (!q) return alertBox(out, "Type the card (player/character, year, set, number) for a quick price check.");
  const btn = $("#quickBtn");
  btn.disabled = true;
  out.innerHTML = `<div class="report muted">Searching sold prices…</div>`;
  try {
    const r = await fetch("/api/quick?q=" + encodeURIComponent(q));
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    if (!j.results.length) return alertBox(out, "No matching cards found. Try fewer words, e.g. 'griffey 1989 upper deck 1'.");
    out.innerHTML = `<div class="report"><div class="grid2" style="grid-template-columns: minmax(220px,300px) 1fr">
      <div class="qlist"><h3 style="margin-top:0">Matches</h3>${j.results.map((x, i) => `<button data-url="${esc(x.url)}" class="${i === 0 ? "active" : ""}"><b>${esc(x.name)}</b><br><span class="muted small">${esc(x.set)} · ${esc(x.ungraded || "")}</span></button>`).join("")}</div>
      <div id="quickCard"></div></div></div>`;
    renderQuickCard(j.top);
    $$(".qlist button", out).forEach((b) => (b.onclick = async () => {
      $$(".qlist button", out).forEach((x) => x.classList.toggle("active", x === b));
      $("#quickCard").innerHTML = `<p class="muted">Loading…</p>`;
      const cr = await fetch("/api/quick/card?url=" + encodeURIComponent(b.dataset.url));
      const cj = await cr.json();
      cr.ok ? renderQuickCard(cj) : ($("#quickCard").innerHTML = `<p class="error">${esc(cj.error)}</p>`);
    }));
  } catch (err) {
    alertBox(out, err.message);
  } finally {
    btn.disabled = false;
  }
};

function renderQuickCard(d) {
  if (!d) return;
  const grades = Object.keys(d.recentSales || {});
  $("#quickCard").innerHTML = `
    <h2 style="margin-top:0">${esc(d.title)}</h2>
    <div class="muted">${esc(d.set)} · ${link(d.url, d.source)}</div>
    <h3>Current value by grade</h3>
    <div class="guide">${Object.entries(d.priceGuide || {}).map(([k, v]) => `<div><span>${esc(k)}</span><b>${usd(v)}</b></div>`).join("")}</div>
    <h3>Trend</h3>
    <table><tr><th>Grade</th><th class="num">1 mo</th><th class="num">3 mo</th><th class="num">6 mo</th><th class="num">12 mo</th><th>Volume</th></tr>
      ${Object.entries(d.trendPct || {}).map(([k, t]) => `<tr><td>${esc(k)}</td><td class="num">${pct(t["1mo"])}</td><td class="num">${pct(t["3mo"])}</td><td class="num">${pct(t["6mo"])}</td><td class="num">${pct(t["12mo"])}</td><td class="small muted">${esc(d.salesVolume?.[k] || "")}</td></tr>`).join("")}
    </table>
    <h3>Recent sold</h3>
    <div class="pills" id="qGrades">${grades.map((g, i) => `<button data-g="${esc(g)}" class="${i === 0 ? "active" : ""}">${esc(g)}</button>`).join("")}</div>
    <div id="qSales"></div>
    <p class="small muted" style="margin-top:.8rem">Free data, no AI. For card ID from a photo, grading advice and news, use <b>Research with AI</b>.</p>`;
  const show = (g) => {
    $("#qSales").innerHTML = `<table style="margin-top:.5rem"><tr><th>Date</th><th>Listing</th><th class="num">Price</th></tr>
      ${(d.recentSales[g] || []).map((s) => `<tr><td>${esc(s.date)}</td><td class="small">${esc(s.title)}</td><td class="num">${usd(s.price)}</td></tr>`).join("")}</table>`;
  };
  $$("#qGrades button").forEach((b) => (b.onclick = () => { $$("#qGrades button").forEach((x) => x.classList.toggle("active", x === b)); show(b.dataset.g); }));
  if (grades.length) show(grades[0]);
}

// ------------------------------------------------------------------ hottest cards

let hotCat = "all", hotPeriod = "weekly";
function pillGroup(sel, onPick) {
  $$(sel + " button").forEach((b) => (b.onclick = () => { $$(sel + " button").forEach((x) => x.classList.toggle("active", x === b)); onPick(b.dataset.v); }));
}
pillGroup("#hotCats", (v) => { hotCat = v; loadHotCached(); });
pillGroup("#hotPeriods", (v) => { hotPeriod = v; loadHotCached(); });

async function loadHotCached() {
  const r = await fetch(`/api/hot?category=${hotCat}&period=${hotPeriod}`);
  const hot = await r.json();
  $("#hotRefresh").classList.toggle("hidden", !hot);
  $("#hotResult").innerHTML = hot ? "" : `<div class="empty"><h2>No report yet for this view</h2><p>Click <b>Find hottest cards</b> — the bot searches news, sales trackers and recent sold prices (takes 1–3 minutes).</p></div>`;
  if (hot) renderHot(hot);
}

async function runHot(refresh) {
  if (needKey()) return;
  $("#hotBtn").disabled = $("#hotRefresh").disabled = true;
  try {
    const { hot } = await streamPost("/api/hot", { category: hotCat, period: hotPeriod, refresh }, $("#hotProgress"));
    renderHot(hot);
    $("#hotRefresh").classList.remove("hidden");
  } catch (err) {
    alertBox($("#hotResult"), err.message);
  } finally {
    $("#hotBtn").disabled = $("#hotRefresh").disabled = false;
  }
}
$("#hotBtn").onclick = () => runHot(false);
$("#hotRefresh").onclick = () => runHot(true);

const signalLabel = { price_spike: "📈 Price spike", volume_spike: "🔊 Volume spike", news: "📰 News", new_release: "🆕 New release", tournament_meta: "🏆 Tournament meta", milestone: "🎯 Milestone", long_term_riser: "⏫ Long-term riser" };

function renderHot(h) {
  const periodLabel = { daily: "today", weekly: "this week", monthly: "this month" }[h.period];
  $("#hotResult").innerHTML = `
    <div class="panel hot-summary">
      <div class="row space"><h2>Hottest ${esc(h.category === "all" ? "cards" : CAT_LABEL[h.category])} ${esc(periodLabel)}</h2><span class="muted small">Updated ${esc(when(h.at))} · ${esc(cost(h.usage))}</span></div>
      <p>${esc(h.market_summary)}</p>
      ${(h.trackedMovers || []).length ? `<p class="small"><b>Your watchlist movers:</b> ${h.trackedMovers.slice(0, 6).map((m) => `${esc(m.name)} ${pct(m.pct)}`).join(" · ")}</p>` : ""}
    </div>
    ${(h.cards || []).map((c) => `
      <div class="hot-card">
        <div class="rank">${esc(c.rank)}</div>
        <div>
          <div class="hot-name">${esc(c.name)}</div>
          <div class="chips"><span class="chip">${esc(CAT_LABEL[c.category] || c.category)}</span><span class="chip warn">${esc(signalLabel[c.signal] || c.signal)}</span></div>
          <p class="small" style="margin:.5rem 0 .3rem">${esc(c.why_hot)}</p>
          <p class="small" style="margin:0"><b>Play:</b> ${esc(c.opportunity)}</p>
          <div class="small muted" style="margin-top:.3rem">${(c.source_urls || []).slice(0, 3).map((u) => link(u, (safeUrl(u) ? new URL(u).hostname.replace(/^www\./, "") : u))).join(" · ")}</div>
        </div>
        <div class="hot-right">
          <div class="price">${esc(c.recent_price)}</div>
          <div class="small">${esc(c.price_change)}</div>
          <button class="small research-this" data-q="${esc(c.search_query)}" style="margin-top:.5rem">Research →</button>
        </div>
      </div>`).join("")}
    ${(h.watch_out || []).length ? `<div class="panel"><h3 style="margin-top:0">Cooling off / watch out</h3><ul class="tight small">${h.watch_out.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    ${(h.sources || []).length ? `<div class="panel"><h3 style="margin-top:0">Sources</h3><div class="sources">${h.sources.map((s) => link(s.url, s.title)).join("")}</div></div>` : ""}`;
  $$(".research-this").forEach((b) => (b.onclick = () => {
    photos = []; renderThumbs();
    $("#lookupText").value = b.dataset.q;
    goTab("lookup");
  }));
}

// ------------------------------------------------------------------ watchlist

async function loadWatch() {
  const { items, movers } = await (await fetch("/api/watchlist")).json();
  const moverBox = (title, list) => `<div class="panel"><h3 style="margin-top:0">${title}</h3>${list.length
    ? `<table>${list.slice(0, 6).map((m) => `<tr><td class="small">${esc(m.name)}</td><td class="num">${usd(m.to)}</td><td class="num">${pct(m.pct)}</td></tr>`).join("")}</table>`
    : `<p class="muted small">Not enough price history yet — check back after a few daily re-checks.</p>`}</div>`;
  $("#movers").innerHTML = moverBox("Biggest movers · 24h", movers.daily) + moverBox("Biggest movers · 7 days", movers.weekly) + moverBox("Biggest movers · 30 days", movers.monthly);
  $("#watchList").innerHTML = items.length
    ? `<div class="panel"><table><tr><th>Card</th><th>Tracking</th><th class="num">Added at</th><th class="num">Latest</th><th class="num">Change</th><th></th></tr>
      ${items.map((w) => {
        const pts = w.snapshots.filter((s) => s.value != null);
        const first = pts[0]?.value, last = pts[pts.length - 1]?.value;
        const ch = first && last ? Math.round(((last - first) / first) * 1000) / 10 : null;
        return `<tr><td><b>${esc(w.card?.name)}</b><div class="small muted">${esc(CAT_LABEL[w.category] || "")} ${w.pricechartingUrl ? "· " + link(w.pricechartingUrl, "sales") : "· no price source (won't auto-update)"}</div></td>
          <td class="small">${esc(w.card?.grading_company ? `${w.card.grading_company} ${w.card.grade}` : "Raw")}</td>
          <td class="num">${usd(first)}</td><td class="num">${usd(last)}<div class="small muted">${pts.length ? esc(when(pts[pts.length - 1].at)) : ""}</div></td><td class="num">${pct(ch)}</td>
          <td><button class="ghost small" data-del="${esc(w.id)}">Remove</button></td></tr>`;
      }).join("")}</table></div>`
    : `<div class="empty"><h2>Nothing on the watchlist yet</h2><p>Research a card, then click <b>★ Add to watchlist</b>. The bot re-prices watched cards daily and shows your biggest movers here.</p></div>`;
  $$("[data-del]").forEach((b) => (b.onclick = async () => { await fetch("/api/watchlist/" + b.dataset.del, { method: "DELETE" }); loadWatch(); }));
}
$("#watchRefresh").onclick = async () => {
  const b = $("#watchRefresh");
  b.disabled = true; b.textContent = "Checking…";
  await fetch("/api/watchlist/refresh", { method: "POST" });
  b.disabled = false; b.textContent = "↻ Re-check prices now";
  loadWatch();
};

// ------------------------------------------------------------------ ask

const askHistory = [];
function md(src) {
  // Small, safe Markdown renderer: escape first, then format.
  const lines = esc(src).split("\n");
  let html = "", inList = false, table = [];
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const flushTable = () => {
    if (!table.length) return;
    const rows = table.filter((r) => !/^\|?\s*:?-{2,}/.test(r)).map((r) => r.replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim())));
    html += `<table><tr>${rows[0].map((c) => `<th>${c}</th>`).join("")}</tr>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</table>`;
    table = [];
  };
  for (const raw of lines) {
    const l = raw.trimEnd();
    if (/^\s*\|/.test(l)) { table.push(l.trim()); continue; } else flushTable();
    if (/^\s*[-*] /.test(l)) { if (!inList) { html += "<ul class='tight'>"; inList = true; } html += `<li>${inline(l.replace(/^\s*[-*] /, ""))}</li>`; continue; }
    if (inList) { html += "</ul>"; inList = false; }
    const h = l.match(/^(#{1,4}) (.*)/);
    if (h) html += `<h3>${inline(h[2])}</h3>`;
    else if (l.trim()) html += `<p>${inline(l)}</p>`;
  }
  flushTable();
  if (inList) html += "</ul>";
  return html;
}

async function doAsk(question) {
  if (needKey()) return;
  question = (question || "").trim();
  if (!question) return;
  const chat = $("#chat");
  $(".empty", chat)?.remove();
  chat.insertAdjacentHTML("beforeend", `<div class="msg q">${esc(question)}</div>`);
  $("#askInput").value = "";
  $("#askBtn").disabled = true;
  try {
    const { answer } = await streamPost("/api/ask", { question, history: askHistory }, $("#askProgress"));
    askHistory.push({ q: question, a: answer.answer_markdown.slice(0, 1500) });
    chat.insertAdjacentHTML("beforeend", `<div class="msg a">${md(answer.answer_markdown)}
      ${(answer.sources || []).length ? `<h3>Sources</h3><div class="sources">${answer.sources.map((s) => link(s.url, s.title)).join("")}</div>` : ""}
      <div class="followups">${(answer.follow_up_ideas || []).map((f) => `<button>${esc(f)}</button>`).join("")}</div>
      <div class="small muted" style="margin-top:.4rem">${esc(cost(answer.usage))}</div></div>`);
    $$(".msg.a:last-child .followups button").forEach((b) => (b.onclick = () => doAsk(b.textContent)));
    $("#askProgress").classList.add("hidden");
  } catch (err) {
    chat.insertAdjacentHTML("beforeend", `<div class="msg a error">⚠ ${esc(err.message)}</div>`);
  } finally {
    $("#askBtn").disabled = false;
  }
}
$("#askBtn").onclick = () => doAsk($("#askInput").value);
$("#askInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doAsk($("#askInput").value); });

// ------------------------------------------------------------------ history

async function loadHistory() {
  const list = await (await fetch("/api/lookups")).json();
  $("#historyList").innerHTML = list.length
    ? list.map((r, i) => `<div class="hist" data-i="${i}"><div><b>${esc(r.card?.name)}</b><div class="small muted">${esc(CAT_LABEL[r.card?.category] || "")} · ${esc(when(r.at))}</div></div><div class="value-big" style="font-size:1.2rem">${usd(r.pricing?.estimated_value_usd)}</div></div>`).join("")
    : `<div class="empty"><h2>No lookups yet</h2><p>Every AI card report is saved here.</p></div>`;
  $$(".hist").forEach((el) => (el.onclick = () => { renderReport(list[+el.dataset.i], $("#lookupResult")); goTab("lookup"); }));
}

refreshStatus();
