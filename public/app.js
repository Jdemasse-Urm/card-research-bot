// Card Research Bot — front end (plain JS, no build step).
"use strict";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : null);
const link = (u, text) => (safeUrl(u) ? `<a href="${esc(u)}" target="_blank" rel="noopener">${esc(text ?? u)}</a>` : esc(text ?? ""));
const usd = (n) => (n == null || isNaN(n) ? "—" : (n < 0 ? "-" : "") + "$" + Math.abs(Number(n)).toLocaleString("en-US", { minimumFractionDigits: Math.abs(n) < 100 ? 2 : 0, maximumFractionDigits: Math.abs(n) < 100 ? 2 : 0 }));
const pct = (n) => (n == null ? "—" : `<span class="${n > 0 ? "pos" : n < 0 ? "neg" : ""}">${n > 0 ? "+" : ""}${n}%</span>`);
const when = (iso) => (iso ? new Date(iso).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");
const CAT_LABEL = { baseball: "⚾ Baseball", basketball: "🏀 Basketball", football: "🏈 Football", yugioh: "🃏 Yu-Gi-Oh", onepiece: "🏴‍☠️ One Piece", other: "Other" };
const json = (method, body) => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

function costLine(u) {
  if (!u) return "";
  const free = u.freeGrounded ? ` · Google searches this month: ${u.groundedThisMonth}/${u.freeGrounded} free` : "";
  return `AI: ${u.calls || 0} calls, ≈ $${(u.usd || 0).toFixed(3)} on paid tier ($0 on free tier)${free}`;
}

let status = { hasKey: false };

// ------------------------------------------------------------------ tabs

function goTab(name) {
  $$("#tabs button").forEach((x) => {
    const on = x.dataset.tab === name;
    x.classList.toggle("active", on);
    on ? x.setAttribute("aria-current", "page") : x.removeAttribute("aria-current");
  });
  $$(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + name));
  if (name === "watch") loadWatch();
  if (name === "history") loadHistory();
  if (name === "hot") loadHotCached();
  if (name === "inventory") loadInventory();
  window.scrollTo({ top: 0 });
}
$$("#tabs button").forEach((b) => b.addEventListener("click", () => goTab(b.dataset.tab)));

// ------------------------------------------------------------------ status / alerts badge

let lastAlertCount = 0;
async function refreshStatus() {
  status = await (await fetch("/api/status")).json();
  $("#keyBanner").classList.toggle("hidden", status.hasKey);
  const n = status.unseenAlerts || 0;
  $("#alertBadge").textContent = n;
  $("#alertBadge").classList.toggle("hidden", !n);
  if (n > lastAlertCount && "Notification" in window && Notification.permission === "granted") {
    new Notification("Card Research Bot", { body: `${n} new price alert${n > 1 ? "s" : ""} on your watchlist` });
  }
  lastAlertCount = n;
}
setInterval(refreshStatus, 5 * 60 * 1000);

// ------------------------------------------------------------------ settings

const settingsDlg = $("#settings");
async function openSettings() {
  settingsDlg.showModal();
  $("#keyMsg").textContent = "";
  const s = await (await fetch("/api/settings")).json();
  $("#settingsLocalOnly").classList.toggle("hidden", s.canEditSettings);
  $$("#settings input, #settings button:not(#closeSettings)").forEach((el) => (el.disabled = !s.canEditSettings));
  $("#modelInfo").textContent = `AI model: ${s.model} · key ${s.hasKey ? "saved ✓" : "not set"}`;
  $("#budgetInput").value = s.budget ?? "";
  $("#shareToggle").checked = s.share;
  $("#usageBox").innerHTML = `Estimated AI cost this month: <b>${usd(s.spendThisMonth)}</b> <span class="muted">(only charged if you turned on billing in Google AI Studio; the free tier is $0)</span><br>
    Google searches this month: <b>${s.groundedThisMonth}</b> of ${s.freeGrounded.toLocaleString()} free`;
  $("#shareMsg").innerHTML = s.shareActive
    ? `Sharing is on. On the other computer open: ${s.lanUrls.map((u) => `<b>${esc(u)}</b>`).join(" or ")}`
    : s.share ? `<span class="bad">Sharing is set but not active. Restart the bot (and make sure a PIN is saved).</span>` : "";
  loadHealth();
}
async function loadHealth() {
  $("#healthBox").textContent = "Checking…";
  try {
    const h = await (await fetch("/api/health")).json();
    $("#healthBox").innerHTML = h.results.map((r) => `<div><span class="${r.ok ? "ok" : "bad"}">${r.ok ? "✓" : "✗"}</span> ${esc(r.name)} <span class="muted">${r.ok ? r.ms + " ms" : esc(r.error || "no results")}</span></div>`).join("");
  } catch {
    $("#healthBox").textContent = "Couldn't check.";
  }
}
$("#settingsBtn").onclick = openSettings;
$("#keyBannerBtn").onclick = openSettings;
$("#closeSettings").onclick = () => settingsDlg.close();
async function saveSettings(body, msgEl) {
  const r = await fetch("/api/settings", json("POST", body));
  const j = await r.json();
  msgEl.innerHTML = j.ok ? (j.restartNeeded ? "Saved ✓ — close the bot window and start it again to apply." : "Saved ✓") : `<span class="bad">${esc(j.error)}</span>`;
  await refreshStatus();
  return j.ok;
}
$("#saveKey").onclick = async () => {
  if (await saveSettings({ apiKey: $("#keyInput").value }, $("#keyMsg"))) $("#keyInput").value = "";
};
$("#saveBudget").onclick = () => saveSettings({ budget: $("#budgetInput").value }, $("#keyMsg"));
$("#saveShare").onclick = () => saveSettings({ share: $("#shareToggle").checked, pin: $("#pinInput").value || undefined }, $("#shareMsg"));
$("#restoreFile").onchange = async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const r = await fetch("/api/restore", json("POST", JSON.parse(await f.text())));
    const j = await r.json();
    $("#restoreMsg").innerHTML = j.ok ? "Restored ✓" : `<span class="bad">${esc(j.error)}</span>`;
  } catch {
    $("#restoreMsg").innerHTML = `<span class="bad">That file isn't a valid backup.</span>`;
  }
  e.target.value = "";
};

function needKey() {
  if (status.hasKey) return false;
  openSettings();
  return true;
}

// ------------------------------------------------------------------ streaming helper (with cancel)

async function streamPost(url, body, progressEl, controller) {
  progressEl.classList.remove("hidden", "done");
  progressEl.innerHTML = "<div>Starting…</div>";
  let res;
  try {
    res = await fetch(url, { ...json("POST", body), signal: controller?.signal });
  } catch (err) {
    progressEl.classList.add("done");
    throw new Error(err.name === "AbortError" ? "Cancelled." : "Couldn't reach the bot — is its window still open?");
  }
  if (!res.ok || !res.body) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch {}
    progressEl.classList.add("done");
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "", final = null;
  try {
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
  } catch (err) {
    if (err.name === "AbortError") final = { type: "error", message: "Cancelled." };
    else throw err;
  } finally {
    progressEl.classList.add("done");
  }
  if (!final) throw new Error("Connection closed before the research finished.");
  if (final.type === "error") throw new Error(final.message);
  progressEl.insertAdjacentHTML("beforeend", `<div>✓ Done</div>`);
  return final;
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

function scaled(img, maxSide, quality) {
  const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", quality);
}

async function addFiles(files) {
  const limit = $("#batchMode").checked ? 40 : 4;
  for (const f of files) {
    if (!f.type.startsWith("image/") && !/\.(heic|heif)$/i.test(f.name)) continue;
    if (photos.length >= limit) break;
    try {
      const { img, url } = await readAsImage(f);
      const dataUrl = scaled(img, MAX_SIDE, 0.9);
      photos.push({ mediaType: "image/jpeg", data: dataUrl.split(",")[1], url: dataUrl, thumb: scaled(img, 160, 0.7) });
      URL.revokeObjectURL(url);
    } catch (err) {
      alertBox($("#lookupResult"), err.message);
    }
  }
  renderThumbs();
}

function renderThumbs() {
  $("#thumbs").innerHTML = photos
    .map((p, i) => `<div class="thumb"><img src="${p.thumb}" alt="card photo ${i + 1}"><button data-i="${i}" aria-label="Remove photo ${i + 1}">×</button></div>`)
    .join("");
  $$("#thumbs button").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); photos.splice(+b.dataset.i, 1); renderThumbs(); }));
  $(".drop-inner").classList.toggle("hidden", photos.length > 0);
}

const drop = $("#drop");
drop.onclick = () => $("#fileInput").click();
drop.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("#fileInput").click(); } };
$("#fileInput").onchange = (e) => { addFiles([...e.target.files]); e.target.value = ""; };
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", (e) => { e.stopPropagation(); addFiles([...e.dataTransfer.files]); });
document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", (e) => { e.preventDefault(); if ($("#tab-lookup").classList.contains("active")) addFiles([...e.dataTransfer.files]); });
document.addEventListener("paste", (e) => {
  const files = [...(e.clipboardData?.files || [])];
  if (files.length && $("#tab-lookup").classList.contains("active")) addFiles(files);
});

function alertBox(el, msg) {
  el.innerHTML = `<div class="report" role="alert"><div class="error">⚠ ${esc(msg)}</div></div>`;
}

$("#clearBtn").onclick = () => {
  photos = []; renderThumbs(); $("#lookupText").value = "";
  $("#lookupProgress").classList.add("hidden");
};

// ------------------------------------------------------------------ AI lookup (single + batch)

let lookupCtrl = null;
$("#cancelBtn").onclick = () => lookupCtrl?.abort();

async function runLookup(images, text, thumb) {
  return (await streamPost("/api/lookup", { images: images.map(({ mediaType, data }) => ({ mediaType, data })), text, thumb }, $("#lookupProgress"), lookupCtrl)).report;
}

$("#researchBtn").onclick = async () => {
  if (needKey()) return;
  const text = $("#lookupText").value;
  if (!photos.length && !text.trim()) return alertBox($("#lookupResult"), "Drop a card photo or type a card name first.");
  const batch = $("#batchMode").checked && photos.length > 1;
  $("#researchBtn").disabled = true;
  $("#cancelBtn").classList.remove("hidden");
  lookupCtrl = new AbortController();
  try {
    if (batch) await runBatch(text);
    else renderReport(await runLookup(photos, text, photos[0]?.thumb || null), $("#lookupResult"));
  } catch (err) {
    alertBox($("#lookupResult"), err.message);
  } finally {
    $("#researchBtn").disabled = false;
    $("#cancelBtn").classList.add("hidden");
  }
};
$("#lookupText").addEventListener("keydown", (e) => { if (e.key === "Enter") (status.hasKey || photos.length ? $("#researchBtn") : $("#quickBtn")).click(); });

async function runBatch(text) {
  const items = photos.map((p, i) => ({ p, i, state: "waiting", report: null, error: null }));
  const q = $("#batchQueue");
  q.classList.remove("hidden");
  const draw = () => {
    q.innerHTML = `<div class="queue"><div class="row space" style="margin:0"><b>Batch: ${items.filter((x) => x.state === "done").length}/${items.length} done</b></div>
      ${items.map((x) => `<div class="qrow"><img src="${x.p.thumb}" alt=""><div>${x.report ? `<b>${esc(x.report.card?.name)}</b> · ${usd(x.report.pricing?.estimated_value_usd)}` : x.error ? `<span class="error">${esc(x.error)}</span>` : esc(x.state)}</div>
        <div>${x.report ? `<button data-open="${x.i}">Open</button>` : ""}</div></div>`).join("")}</div>`;
    $$("[data-open]", q).forEach((b) => (b.onclick = () => renderReport(items[+b.dataset.open].report, $("#lookupResult"))));
  };
  draw();
  for (const x of items) {
    if (lookupCtrl.signal.aborted) { x.state = "cancelled"; continue; }
    x.state = "researching…";
    draw();
    try {
      x.report = await runLookup([x.p], text, x.p.thumb);
      x.state = "done";
      renderReport(x.report, $("#lookupResult"));
    } catch (err) {
      x.error = err.message;
      x.state = "failed";
    }
    draw();
  }
  $("#lookupResult").insertAdjacentHTML("afterbegin", `<div class="panel">Batch finished — every card is saved in <b>History</b> (export to CSV from there).</div>`);
}

// ------------------------------------------------------------------ price history chart (SVG)

const SERIES_PREF = ["Ungraded", "Grade 9", "PSA 10"];
const SERIES_COLORS = ["#1f8a70", "#c58b00", "#5b5bd6"];
function priceChart(history) {
  if (!history) return "";
  let keys = SERIES_PREF.filter((k) => history[k]);
  if (!keys.length) keys = Object.keys(history).slice(0, 3);
  if (!keys.length) return "";
  const W = 640, H = 220, L = 54, R = 10, T = 10, B = 26;
  const all = keys.flatMap((k) => history[k]);
  const t0 = Math.min(...all.map((p) => p[0])), t1 = Math.max(...all.map((p) => p[0]));
  const vMin = Math.max(0.5, Math.min(...all.map((p) => p[1]))), vMax = Math.max(...all.map((p) => p[1]));
  const lg = (v) => Math.log10(Math.max(v, 0.01));
  const y0 = lg(vMin) - 0.05, y1 = lg(vMax) + 0.05;
  const X = (t) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
  const Y = (v) => T + (1 - (lg(v) - y0) / Math.max(0.01, y1 - y0)) * (H - T - B);
  const ticks = [];
  for (let e = Math.floor(y0); e <= Math.ceil(y1); e++) for (const m of [1, 2, 5]) { const v = m * 10 ** e; if (lg(v) >= y0 && lg(v) <= y1) ticks.push(v); }
  const years = [];
  for (let y = new Date(t0).getFullYear() + 1; y <= new Date(t1).getFullYear(); y++) years.push(Date.UTC(y, 0, 1));
  return `<figure style="margin:0">
    <svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly sold-price history, ${esc(keys.join(", "))}">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end">${usd(v)}</text>`).join("")}
      ${years.map((t) => `<text x="${X(t)}" y="${H - 8}" text-anchor="middle">${new Date(t).getUTCFullYear()}</text>`).join("")}
      ${keys.map((k, i) => `<polyline fill="none" stroke="${SERIES_COLORS[i]}" stroke-width="2.2" points="${history[k].map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")}"/>`).join("")}
    </svg>
    <figcaption class="chart-legend">${keys.map((k, i) => `<span style="--c:${SERIES_COLORS[i]}">${esc(k)}</span>`).join("")}<span style="--c:transparent">monthly, log scale</span></figcaption>
  </figure>`;
}

// ------------------------------------------------------------------ profit + grading calculators

// Approximate seller fees (Oct 2026). Edit here if a platform changes its rates.
const PLATFORMS = [
  { name: "eBay", pct: 13.25, fixed: 0.4 },
  { name: "TCGplayer", pct: 10.75 + 2.5, fixed: 0.3 },
  { name: "Whatnot", pct: 8 + 2.9, fixed: 0.3 },
  { name: "Local / cash", pct: 0, fixed: 0 },
];

function profitCalc(r, el) {
  const v = r.buy_sell?.list_price ?? r.pricing?.estimated_value_usd ?? "";
  el.innerHTML = `<div class="calc">
      <label>Sell price $<input type="number" step="0.01" min="0" data-k="sale" value="${esc(v)}"></label>
      <label>Your cost $<input type="number" step="0.01" min="0" data-k="cost" value="${esc(r.buy_sell?.max_buy_price ?? "")}"></label>
      <label>Shipping you pay $<input type="number" step="0.01" min="0" data-k="ship" value="5"></label>
    </div><div data-out></div>`;
  const calc = () => {
    const g = (k) => parseFloat($(`[data-k=${k}]`, el).value) || 0;
    const sale = g("sale"), cost = g("cost"), ship = g("ship");
    $("[data-out]", el).innerHTML = `<table><tr><th>Platform</th><th class="num">Fees</th><th class="num">You keep</th><th class="num">Profit</th></tr>
      ${PLATFORMS.map((p) => {
        const fees = sale ? sale * p.pct / 100 + p.fixed : 0;
        const net = sale - fees - (p.name.startsWith("Local") ? 0 : ship);
        const profit = net - cost;
        return `<tr><td>${p.name}</td><td class="num">${usd(fees)}</td><td class="num">${usd(net)}</td><td class="num ${profit >= 0 ? "pos" : "neg"}">${usd(profit)}${cost ? ` <span class="muted small">(${Math.round((profit / cost) * 100)}%)</span>` : ""}</td></tr>`;
      }).join("")}</table><div class="small muted">Fee rates are approximate; local sales assume no shipping.</div>`;
  };
  $$("input", el).forEach((i) => (i.oninput = calc));
  calc();
}

function gradeValue(r, re) {
  return (r.pricing?.grade_values || []).find((g) => re.test(g.grade))?.value ?? null;
}

function gradingCalc(r, el) {
  const o = r.grade_odds || {};
  const raw = gradeValue(r, /^(raw|ungraded)$/i) ?? r.pricing?.estimated_value_usd;
  const v10 = gradeValue(r, /^PSA 10$/i), v9 = gradeValue(r, /^(PSA 9|Grade 9)$/i), v8 = gradeValue(r, /^(PSA 8|Grade 8)$/i);
  el.innerHTML = `<div class="calc">
      <label>PSA 10 chance %<input type="number" min="0" max="100" data-k="p10" value="${esc(o.psa10_pct ?? 10)}"></label>
      <label>PSA 9 chance %<input type="number" min="0" max="100" data-k="p9" value="${esc(o.psa9_pct ?? 40)}"></label>
      <label>PSA 8 or lower %<input type="number" min="0" max="100" data-k="p8" value="${esc(o.psa8_or_lower_pct ?? 50)}"></label>
      <label>PSA 10 value $<input type="number" min="0" data-k="v10" value="${esc(v10 ?? "")}"></label>
      <label>PSA 9 value $<input type="number" min="0" data-k="v9" value="${esc(v9 ?? "")}"></label>
      <label>PSA 8 value $<input type="number" min="0" data-k="v8" value="${esc(v8 ?? "")}"></label>
      <label>Raw value $<input type="number" min="0" data-k="raw" value="${esc(raw ?? "")}"></label>
      <label>Grading + shipping $<input type="number" min="0" data-k="fee" value="40"></label>
    </div><div data-out></div>`;
  const calc = () => {
    const g = (k) => parseFloat($(`[data-k=${k}]`, el).value) || 0;
    const tot = g("p10") + g("p9") + g("p8") || 1;
    const ev = (g("p10") * g("v10") + g("p9") * g("v9") + g("p8") * g("v8")) / tot - g("fee");
    const diff = ev - g("raw");
    $("[data-out]", el).innerHTML = `<p style="margin:.3rem 0">Expected value if graded: <b>${usd(ev)}</b> vs selling raw: <b>${usd(g("raw"))}</b> →
      <b class="${diff >= 0 ? "pos" : "neg"}">${diff >= 0 ? "grading wins by " : "selling raw wins by "}${usd(Math.abs(diff))}</b></p>
      <div class="small muted">Odds come from the AI's look at your photo — treat them as a rough guess and adjust.</div>`;
  };
  $$("input", el).forEach((i) => (i.oninput = calc));
  calc();
}

// ------------------------------------------------------------------ report

const recClass = { grade_it: "good", maybe: "warn", dont_grade: "bad", already_graded: "" };
const recLabel = { grade_it: "Grade it", maybe: "Maybe grade", dont_grade: "Don't grade", already_graded: "Already graded" };
const verdictClass = { buy: "good", hold: "warn", sell: "bad", pass: "" };
const demandClass = { hot: "bad", rising: "good", steady: "", cooling: "warn", cold: "" };

function summaryText(r) {
  const c = r.card || {}, p = r.pricing || {}, bs = r.buy_sell || {};
  return [
    `${c.name}`,
    `Value: ${usd(p.estimated_value_usd)}${p.value_range_low != null ? ` (range ${usd(p.value_range_low)}–${usd(p.value_range_high)})` : ""}`,
    `Call: ${String(bs.verdict || "").toUpperCase()} · max buy ${usd(bs.max_buy_price)} · list at ${usd(bs.list_price)}`,
    `Grading: ${recLabel[r.grading?.recommendation] || ""}`,
    r.summary,
    p.pricecharting_url ? `Sales: ${p.pricecharting_url}` : "",
  ].filter(Boolean).join("\n");
}

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
  <article class="report">
    <div class="report-head">
      <div style="display:flex;gap:1rem;align-items:flex-start">
        ${r.thumb ? `<img src="${esc(r.thumb)}" alt="" class="hist-thumb" style="width:64px;height:auto">` : ""}
        <div>
          <h2 class="report-title">${esc(c.name)}</h2>
          <div class="chips">${chips.map((x) => `<span class="chip">${esc(x)}</span>`).join("")}
            <span class="chip ${c.identification_confidence === "high" ? "good" : c.identification_confidence === "low" ? "bad" : "warn"}">ID: ${esc(c.identification_confidence)} confidence</span>
            <span class="chip ${demandClass[m.demand] || ""}">Demand: ${esc(m.demand)}</span>
          </div>
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

    ${r.history ? `<h3>Price history</h3>${priceChart(r.history)}` : ""}

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

    <div class="grid2 calc-block">
      <div><h3>Profit calculator</h3><div data-profit></div></div>
      ${c.grading_company ? "" : `<div><h3>Should I grade it? (expected value)</h3><div data-grading></div></div>`}
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
      <span>${r.at ? "Researched " + esc(when(r.at)) : ""} · ${esc(costLine(r.usage))}</span>
      <span class="actions">
        ${r.id ? `<button data-act="watch">★ Watchlist</button><button data-act="inv">＋ Inventory</button><button data-act="ask">💬 Ask about it</button>` : ""}
        <button data-act="rerun" title="Research again with fresh prices">↻ Re-run</button>
        <button data-act="copy">📋 Copy summary</button>
        <button data-act="print">🖨 Print</button>
      </span>
    </div>
    <form class="inline-form hidden" data-invform>
      <label class="small">Paid each $ <input type="number" step="0.01" min="0" name="cost" required></label>
      <label class="small">Qty <input type="number" min="1" value="1" name="qty" style="width:70px"></label>
      <button class="primary">Add to inventory</button>
    </form>
  </article>`;

  profitCalc(r, $("[data-profit]", el));
  if ($("[data-grading]", el)) gradingCalc(r, $("[data-grading]", el));

  const act = (name, fn) => { const b = $(`[data-act=${name}]`, el); if (b) b.onclick = () => fn(b); };
  act("watch", async (b) => {
    const res = await fetch("/api/watchlist", json("POST", { lookupId: r.id }));
    b.textContent = res.ok ? "★ On watchlist" : "Couldn't add";
    b.disabled = true;
  });
  act("inv", () => { $("[data-invform]", el).classList.toggle("hidden"); $("[data-invform] input", el).focus(); });
  $("[data-invform]", el).onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const res = await fetch("/api/inventory", json("POST", { lookupId: r.id, cost: f.get("cost"), qty: f.get("qty") }));
    e.target.innerHTML = res.ok ? `<span class="ok">Added to inventory ✓</span>` : `<span class="bad">Couldn't add</span>`;
  };
  act("ask", () => { setAskContext(r); goTab("ask"); $("#askInput").focus(); });
  act("rerun", () => {
    const grade = c.grading_company ? ` ${c.grading_company} ${c.grade}` : "";
    photos = []; renderThumbs();
    $("#lookupText").value = (c.search_query || c.name) + grade;
    goTab("lookup");
    $("#researchBtn").click();
  });
  act("copy", async (b) => {
    try { await navigator.clipboard.writeText(summaryText(r)); b.textContent = "✓ Copied"; } catch { b.textContent = "Copy failed"; }
  });
  act("print", () => window.print());
}

// ------------------------------------------------------------------ quick (free) price

$("#quickBtn").onclick = async () => {
  const q = $("#lookupText").value.trim();
  const out = $("#lookupResult");
  if (!q) return alertBox(out, "Type the card (player/character, year, set, number) for a quick price check.");
  const btn = $("#quickBtn");
  btn.disabled = true;
  out.innerHTML = `<div class="report muted" role="status">Searching sold prices…</div>`;
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
    ${d.history && Object.keys(d.history).length ? `<h3>Price history</h3>${priceChart(d.history)}` : ""}
    <h3>Trend</h3>
    <table><tr><th>Grade</th><th class="num">1 mo</th><th class="num">3 mo</th><th class="num">6 mo</th><th class="num">12 mo</th><th>Volume</th></tr>
      ${Object.entries(d.trendPct || {}).map(([k, t]) => `<tr><td>${esc(k)}</td><td class="num">${pct(t["1mo"])}</td><td class="num">${pct(t["3mo"])}</td><td class="num">${pct(t["6mo"])}</td><td class="num">${pct(t["12mo"])}</td><td class="small muted">${esc(d.salesVolume?.[k] || "")}</td></tr>`).join("")}
    </table>
    <h3>Recent sold</h3>
    <div class="pills" id="qGrades" role="group" aria-label="Grade">${grades.map((g, i) => `<button data-g="${esc(g)}" class="${i === 0 ? "active" : ""}" aria-pressed="${i === 0}">${esc(g)}</button>`).join("")}</div>
    <div id="qSales"></div>
    <p class="small muted" style="margin-top:.8rem">Free data, no AI. For card ID from a photo, grading advice and news, use <b>Research with AI</b>.</p>`;
  const show = (g) => {
    $("#qSales").innerHTML = `<table style="margin-top:.5rem"><tr><th>Date</th><th>Listing</th><th class="num">Price</th></tr>
      ${(d.recentSales[g] || []).map((s) => `<tr><td>${esc(s.date)}</td><td class="small">${esc(s.title)}</td><td class="num">${usd(s.price)}</td></tr>`).join("")}</table>`;
  };
  pillGroup("#qGrades", show);
  if (grades.length) show(grades[0]);
}

// ------------------------------------------------------------------ hottest cards

let hotCat = "all", hotPeriod = "weekly", hotCtrl = null;
function pillGroup(sel, onPick) {
  $$(sel + " button").forEach((b) => (b.onclick = () => {
    $$(sel + " button").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", x === b); });
    onPick(b.dataset.v ?? b.dataset.g);
  }));
}
pillGroup("#hotCats", (v) => { hotCat = v; loadHotCached(); });
pillGroup("#hotPeriods", (v) => { hotPeriod = v; loadHotCached(); });

async function loadHotCached() {
  const r = await fetch(`/api/hot?category=${hotCat}&period=${hotPeriod}`);
  const hot = await r.json();
  $("#hotRefresh").classList.toggle("hidden", !hot);
  $("#hotResult").innerHTML = hot ? "" : `<div class="empty"><h2>No report yet for this view</h2><p>Click <b>Find hottest cards</b>. The bot searches Google for news and market trackers, then checks real sold prices (takes 1–2 minutes).</p></div>`;
  if (hot) renderHot(hot);
}

async function runHot(refresh) {
  if (needKey()) return;
  $("#hotBtn").disabled = $("#hotRefresh").disabled = true;
  $("#hotCancel").classList.remove("hidden");
  hotCtrl = new AbortController();
  try {
    const { hot } = await streamPost("/api/hot", { category: hotCat, period: hotPeriod, refresh }, $("#hotProgress"), hotCtrl);
    renderHot(hot);
    $("#hotRefresh").classList.remove("hidden");
  } catch (err) {
    alertBox($("#hotResult"), err.message);
  } finally {
    $("#hotBtn").disabled = $("#hotRefresh").disabled = false;
    $("#hotCancel").classList.add("hidden");
  }
}
$("#hotBtn").onclick = () => runHot(false);
$("#hotRefresh").onclick = () => runHot(true);
$("#hotCancel").onclick = () => hotCtrl?.abort();

const signalLabel = { price_spike: "📈 Price spike", volume_spike: "🔊 Volume spike", news: "📰 News", new_release: "🆕 New release", tournament_meta: "🏆 Tournament meta", milestone: "🎯 Milestone", long_term_riser: "⏫ Long-term riser" };

function renderHot(h) {
  const periodLabel = { daily: "today", weekly: "this week", monthly: "this month" }[h.period];
  $("#hotResult").innerHTML = `
    <div class="panel hot-summary">
      <div class="row space"><h2>Hottest ${esc(h.category === "all" ? "cards" : CAT_LABEL[h.category])} ${esc(periodLabel)}</h2><span class="muted small">Updated ${esc(when(h.at))}</span></div>
      <p>${esc(h.market_summary)}</p>
      ${(h.trackedMovers || []).length ? `<p class="small"><b>Your watchlist movers:</b> ${h.trackedMovers.slice(0, 6).map((m) => `${esc(m.name)} ${pct(m.pct)}`).join(" · ")}</p>` : ""}
      <div class="small muted">${esc(costLine(h.usage))}</div>
    </div>
    ${(h.cards || []).map((c) => {
      const pc = c.price_check;
      return `
      <div class="hot-card">
        <div class="rank">${esc(c.rank)}</div>
        <div>
          <div class="hot-name">${esc(c.name)}</div>
          <div class="chips"><span class="chip">${esc(CAT_LABEL[c.category] || c.category)}</span><span class="chip warn">${esc(signalLabel[c.signal] || c.signal)}</span></div>
          <p class="small" style="margin:.5rem 0 .3rem">${esc(c.why_hot)}</p>
          <p class="small" style="margin:0"><b>Play:</b> ${esc(c.opportunity)}</p>
          ${pc ? `<p class="small muted" style="margin:.35rem 0 0">Sold-price check (${link(pc.url, pc.matched)}): raw ${usd(pc.ungraded)} · PSA 10 ${usd(pc.psa10)} · 1-mo ${pct(pc.trend_1mo)}${pc.last_sale ? ` · last sale ${usd(pc.last_sale.price)} ${esc(pc.last_sale.grade)} on ${esc(pc.last_sale.date)}` : ""}</p>` : ""}
        </div>
        <div class="hot-right">
          <div class="price">${esc(c.recent_price)}</div>
          <div class="small">${esc(c.price_change)}</div>
          <button class="small research-this" data-q="${esc(c.search_query)}" style="margin-top:.5rem">Research →</button>
        </div>
      </div>`;
    }).join("")}
    ${(h.watch_out || []).length ? `<div class="panel"><h3 style="margin-top:0">Cooling off / watch out</h3><ul class="tight small">${h.watch_out.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    ${(h.sources || []).length ? `<div class="panel"><h3 style="margin-top:0">Sources</h3><div class="sources">${h.sources.map((s) => link(s.url, s.title)).join("")}</div></div>` : ""}`;
  $$(".research-this").forEach((b) => (b.onclick = () => {
    photos = []; renderThumbs();
    $("#lookupText").value = b.dataset.q;
    goTab("lookup");
  }));
}

// ------------------------------------------------------------------ inventory

$("#invAddBtn").onclick = () => $("#invForm").classList.toggle("hidden");
$("#invForm").onsubmit = async (e) => {
  e.preventDefault();
  const f = Object.fromEntries(new FormData(e.target));
  if (f.value === "") delete f.value;
  await fetch("/api/inventory", json("POST", f));
  e.target.reset();
  e.target.classList.add("hidden");
  loadInventory();
};
$("#invRefresh").onclick = async () => {
  const b = $("#invRefresh");
  b.disabled = true; b.textContent = "Re-valuing…";
  await fetch("/api/inventory/refresh", { method: "POST" });
  b.disabled = false; b.textContent = "↻ Re-value";
  loadInventory();
};

async function loadInventory() {
  const rows = await (await fetch("/api/inventory")).json();
  const inStock = rows.filter((r) => r.status !== "sold");
  const sold = rows.filter((r) => r.status === "sold");
  const sum = (arr, f) => arr.reduce((n, r) => n + (f(r) || 0), 0);
  const cost = sum(inStock, (r) => r.cost * r.qty);
  const value = sum(inStock, (r) => (r.value ?? r.cost) * r.qty);
  const realized = sum(sold, (r) => (r.soldPrice != null ? (r.soldPrice - r.cost) * r.qty : 0));
  $("#invTotals").innerHTML = rows.length ? `
    <div><span>Cards in stock</span><b>${sum(inStock, (r) => r.qty)}</b></div>
    <div><span>Total cost</span><b>${usd(cost)}</b></div>
    <div><span>Value today</span><b>${usd(value)}</b></div>
    <div><span>Unrealized profit</span><b class="${value - cost >= 0 ? "pos" : "neg"}">${usd(value - cost)}</b></div>
    <div><span>Realized profit (sold)</span><b class="${realized >= 0 ? "pos" : "neg"}">${usd(realized)}</b></div>` : "";
  $("#invList").innerHTML = rows.length
    ? `<div class="panel" style="overflow-x:auto"><table>
        <tr><th>Card</th><th>Grade</th><th class="num">Qty</th><th class="num">Paid each</th><th class="num">Value each</th><th class="num">P/L</th><th>Sold for (each)</th><th></th></tr>
        ${rows.map((r) => {
          const pl = r.status === "sold" ? (r.soldPrice != null ? (r.soldPrice - r.cost) * r.qty : null) : r.value != null ? (r.value - r.cost) * r.qty : null;
          return `<tr class="${r.status === "sold" ? "sold" : ""}" data-id="${esc(r.id)}">
            <td><b>${esc(r.name)}</b><div class="small muted">${esc(CAT_LABEL[r.category] || "")} · bought ${esc(r.purchased)} ${r.priceUrl ? "· " + link(r.priceUrl, "sales") : ""}</div></td>
            <td class="small">${esc(r.grade)}</td><td class="num">${esc(r.qty)}</td>
            <td class="num"><input class="cell" type="number" step="0.01" min="0" data-f="cost" value="${esc(r.cost)}" aria-label="Paid each"></td>
            <td class="num">${usd(r.value)}<div class="small muted">${esc(when(r.valuedAt))}</div></td>
            <td class="num ${pl == null ? "" : pl >= 0 ? "pos" : "neg"}">${usd(pl)}</td>
            <td><input class="cell" type="number" step="0.01" min="0" data-f="soldPrice" value="${esc(r.soldPrice ?? "")}" placeholder="not sold" aria-label="Sold price each"></td>
            <td><button class="ghost small" data-del>Remove</button></td></tr>`;
        }).join("")}</table></div>`
    : `<div class="empty"><h2>No inventory yet</h2><p>Research a card and click <b>＋ Inventory</b>, or add one by hand with <b>＋ Add card</b>.</p></div>`;
  $$("#invList tr[data-id]").forEach((tr) => {
    const id = tr.dataset.id;
    $$("input[data-f]", tr).forEach((inp) => (inp.onchange = async () => {
      const v = inp.value === "" ? null : parseFloat(inp.value);
      const patch = { [inp.dataset.f]: v };
      if (inp.dataset.f === "soldPrice") Object.assign(patch, v == null ? { status: "in_stock", soldDate: null } : { status: "sold", soldDate: new Date().toISOString().slice(0, 10) });
      await fetch("/api/inventory/" + id, json("PATCH", patch));
      loadInventory();
    }));
    $("[data-del]", tr).onclick = async () => {
      if (!confirm("Remove this card from inventory?")) return;
      await fetch("/api/inventory/" + id, { method: "DELETE" });
      loadInventory();
    };
  });
}

// ------------------------------------------------------------------ watchlist + alerts

async function loadWatch() {
  const [{ items, movers }, alerts] = await Promise.all([(await fetch("/api/watchlist")).json(), (await fetch("/api/alerts")).json()]);
  const unseen = alerts.filter((a) => !a.seen);
  $("#alertList").innerHTML = unseen.length
    ? unseen.map((a) => `<div class="alert-item" role="status"><span>🔔 <b>${esc(a.name)}</b> is ${a.kind === "above" ? "up to" : "down to"} <b>${usd(a.value)}</b> (your ${a.kind === "above" ? "sell" : "buy"} target ${usd(a.target)}) · ${esc(when(a.at))}</span></div>`).join("") +
      `<div class="row" style="margin:0 0 1rem"><button id="alertsSeen">Mark alerts as read</button>${"Notification" in window && Notification.permission !== "granted" ? `<button id="alertsNotify" class="ghost">Enable desktop alerts</button>` : ""}</div>`
    : "Notification" in window && Notification.permission === "default" && items.length ? `<div class="row" style="margin:0 0 1rem"><button id="alertsNotify" class="ghost">🔔 Enable desktop alerts</button></div>` : "";
  if ($("#alertsSeen")) $("#alertsSeen").onclick = async () => { await fetch("/api/alerts/seen", { method: "POST" }); refreshStatus(); loadWatch(); };
  if ($("#alertsNotify")) $("#alertsNotify").onclick = async () => { await Notification.requestPermission(); loadWatch(); };

  const moverBox = (title, list) => `<div class="panel"><h3 style="margin-top:0">${title}</h3>${list.length
    ? `<table>${list.slice(0, 6).map((m) => `<tr><td class="small">${esc(m.name)}</td><td class="num">${usd(m.to)}</td><td class="num">${pct(m.pct)}</td></tr>`).join("")}</table>`
    : `<p class="muted small">Not enough price history yet. Check back after a few daily re-checks.</p>`}</div>`;
  $("#movers").innerHTML = moverBox("Biggest movers · 24h", movers.daily) + moverBox("Biggest movers · 7 days", movers.weekly) + moverBox("Biggest movers · 30 days", movers.monthly);
  $("#watchList").innerHTML = items.length
    ? `<div class="panel" style="overflow-x:auto"><table><tr><th>Card</th><th>Tracking</th><th class="num">Added at</th><th class="num">Latest</th><th class="num">Change</th><th>Alert me at</th><th></th></tr>
      ${items.map((w) => {
        const pts = w.snapshots.filter((s) => s.value != null);
        const first = pts[0]?.value, last = pts[pts.length - 1]?.value;
        const ch = first && last ? Math.round(((last - first) / first) * 1000) / 10 : null;
        return `<tr data-id="${esc(w.id)}"><td><b>${esc(w.card?.name)}</b><div class="small muted">${esc(CAT_LABEL[w.category] || "")} ${w.pricechartingUrl ? "· " + link(w.pricechartingUrl, "sales") : "· no price source (won't auto-update)"}</div></td>
          <td class="small">${esc(w.card?.grading_company ? `${w.card.grading_company} ${w.card.grade}` : "Raw")}</td>
          <td class="num">${usd(first)}</td><td class="num">${usd(last)}<div class="small muted">${pts.length ? esc(when(pts[pts.length - 1].at)) : ""}</div></td><td class="num">${pct(ch)}</td>
          <td class="targets small">≥ <input type="number" min="0" step="1" data-t="targetAbove" value="${esc(w.targetAbove ?? "")}" aria-label="Alert when price rises to"> ≤ <input type="number" min="0" step="1" data-t="targetBelow" value="${esc(w.targetBelow ?? "")}" aria-label="Alert when price falls to"></td>
          <td><button class="ghost small" data-del>Remove</button></td></tr>`;
      }).join("")}</table></div>`
    : `<div class="empty"><h2>Nothing on the watchlist yet</h2><p>Research a card, then click <b>★ Watchlist</b>. The bot re-prices watched cards daily and shows your biggest movers here.</p></div>`;
  $$("#watchList tr[data-id]").forEach((tr) => {
    const save = async () => {
      await fetch("/api/watchlist/" + tr.dataset.id, json("PATCH", { targetAbove: $("[data-t=targetAbove]", tr).value, targetBelow: $("[data-t=targetBelow]", tr).value }));
    };
    $$("[data-t]", tr).forEach((i) => (i.onchange = save));
    $("[data-del]", tr).onclick = async () => { await fetch("/api/watchlist/" + tr.dataset.id, { method: "DELETE" }); loadWatch(); };
  });
}
$("#watchRefresh").onclick = async () => {
  const b = $("#watchRefresh");
  b.disabled = true; b.textContent = "Checking…";
  await fetch("/api/watchlist/refresh", { method: "POST" });
  b.disabled = false; b.textContent = "↻ Re-check prices now";
  refreshStatus();
  loadWatch();
};

// ------------------------------------------------------------------ ask

const askHistory = [];
let askLookup = null, askCtrl = null;

function setAskContext(r) {
  askLookup = r;
  const box = $("#askContext");
  box.classList.toggle("hidden", !r);
  if (r) {
    box.innerHTML = `<div class="row space" style="margin:0"><span>Asking about: <b>${esc(r.card?.name)}</b> (${usd(r.pricing?.estimated_value_usd)})</span><button class="ghost small" id="askClear">✕ Clear</button></div>`;
    $("#askClear").onclick = () => setAskContext(null);
  }
}

function md(src) {
  // Small, safe Markdown renderer: escape first, then format.
  const lines = esc(src).split("\n");
  let html = "", inList = false, table = [];
  const inline = (s) => s
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<i>$2</i>")
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
    if (/^\s*([-*]|\d+\.) /.test(l)) { if (!inList) { html += "<ul class='tight'>"; inList = true; } html += `<li>${inline(l.replace(/^\s*([-*]|\d+\.) /, ""))}</li>`; continue; }
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
  $("#askCancel").classList.remove("hidden");
  askCtrl = new AbortController();
  try {
    const { answer } = await streamPost("/api/ask", { question, history: askHistory, lookupId: askLookup?.id }, $("#askProgress"), askCtrl);
    askHistory.push({ q: question, a: answer.answer_markdown.slice(0, 1500) });
    chat.insertAdjacentHTML("beforeend", `<div class="msg a">${md(answer.answer_markdown)}
      ${(answer.sources || []).length ? `<h3>Sources</h3><div class="sources">${answer.sources.map((s) => link(s.url, s.title)).join("")}</div>` : ""}
      <div class="followups">${(answer.follow_up_ideas || []).map((f) => `<button>${esc(f)}</button>`).join("")}</div>
      <div class="small muted" style="margin-top:.4rem">${esc(costLine(answer.usage))}</div></div>`);
    $$(".msg.a:last-child .followups button").forEach((b) => (b.onclick = () => doAsk(b.textContent)));
    $("#askProgress").classList.add("hidden");
  } catch (err) {
    chat.insertAdjacentHTML("beforeend", `<div class="msg a error" role="alert">⚠ ${esc(err.message)}</div>`);
  } finally {
    $("#askBtn").disabled = false;
    $("#askCancel").classList.add("hidden");
  }
}
$("#askBtn").onclick = () => doAsk($("#askInput").value);
$("#askCancel").onclick = () => askCtrl?.abort();
$("#askInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doAsk($("#askInput").value); });

// ------------------------------------------------------------------ history

let historyCache = [];
async function loadHistory() {
  historyCache = await (await fetch("/api/lookups")).json();
  drawHistory();
}
function drawHistory() {
  const q = $("#histSearch").value.trim().toLowerCase();
  const list = historyCache.filter((r) => !q || JSON.stringify([r.card?.name, r.card?.player_or_character, r.card?.brand_set, r.card?.category]).toLowerCase().includes(q));
  $("#historyList").innerHTML = list.length
    ? list.map((r) => `<div class="hist" data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="Open report for ${esc(r.card?.name)}">
        <div class="hist-left">${r.thumb ? `<img class="hist-thumb" src="${esc(r.thumb)}" alt="">` : ""}<div><b>${esc(r.card?.name)}</b><div class="small muted">${esc(CAT_LABEL[r.card?.category] || "")} · ${esc(when(r.at))}</div></div></div>
        <div class="row" style="margin:0"><div class="value-big" style="font-size:1.2rem">${usd(r.pricing?.estimated_value_usd)}</div><button class="ghost small" data-del aria-label="Delete this report">🗑</button></div></div>`).join("")
    : `<div class="empty"><h2>${q ? "No matches" : "No lookups yet"}</h2><p>${q ? "Try another search." : "Every AI card report is saved here."}</p></div>`;
  $$(".hist").forEach((el) => {
    const r = historyCache.find((x) => x.id === el.dataset.id);
    const open = () => { renderReport(r, $("#lookupResult")); goTab("lookup"); };
    el.onclick = open;
    el.onkeydown = (e) => { if (e.key === "Enter") open(); };
    $("[data-del]", el).onclick = async (e) => {
      e.stopPropagation();
      if (!confirm("Delete this report from history?")) return;
      await fetch("/api/lookups/" + r.id, { method: "DELETE" });
      loadHistory();
    };
  });
}
$("#histSearch").oninput = drawHistory;

refreshStatus();
