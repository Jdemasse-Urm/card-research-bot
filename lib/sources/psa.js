// PSA Public API (free token: psacard.com/publicapi/documentation). Used for:
//   - slab verification: cert number -> what PSA says is in that slab (+ population)
//   - population report by grade (spec ID from the cert)
//   - grading submission progress
// Official API, not a scraped page, so plain fetch with the bearer token.

const BASE = "https://api.psacard.com/publicapi";

export const hasToken = () => Boolean(process.env.PSA_API_TOKEN);

// PSA's free API allows about 100 calls a day; Settings shows how many this app has made today (since it opened).
let calls = { day: "", n: 0 };
export const callsToday = () => (calls.day === new Date().toLocaleDateString("en-CA") ? calls.n : 0);

// Since late Oct 2026 PSA's "public" API answers every method with 403 "Access to this API is limited to approved
// customers" until PSA switches API access on for the account — a new token doesn't change it (other developers
// report the same). Other developers were pointed to PSA's API team at this address.
export const PSA_API_CONTACT = "collectors-apis@collectors.com";
export const NOT_APPROVED = `PSA hasn't switched API access on for your account yet — PSA now approves its "public" API account by account (since late Oct 2026), and every request gets "Access to this API is limited to approved customers." The token itself is fine. Ask PSA's API team to approve the account (Settings → ✉ Ask PSA for access, or email ${PSA_API_CONTACT}); until then check slabs on psacard.com/cert.`;
// After that answer the app stops asking for 6 hours (it's the same answer, and each ask uses one of the ~100 a day).
let refusedUntil = 0;
export const refused = () => Date.now() < refusedUntil;

async function get(path, { fresh = false } = {}) {
  if (!hasToken()) throw new Error("No PSA API token — add one in Settings (free at psacard.com/publicapi).");
  if (!fresh && refused()) throw new Error(NOT_APPROVED);
  const day = new Date().toLocaleDateString("en-CA");
  calls = { day, n: (calls.day === day ? calls.n : 0) + 1 };
  const res = await fetch(BASE + path, {
    headers: { Authorization: `bearer ${process.env.PSA_API_TOKEN}`, Accept: "application/json" },
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 || res.status === 403) {
    // PSA says why: a wrong token, or a right one on an account PSA hasn't approved for the API yet
    const said = String((await res.json().catch(() => null))?.Message || "").slice(0, 200);
    if (/approved/i.test(said)) {
      refusedUntil = Date.now() + 6 * 3600000;
      throw new Error(NOT_APPROVED);
    }
    throw new Error(`PSA rejected the API token${said ? ` ("${said}")` : ""} — check it in Settings.`);
  }
  refusedUntil = 0; // PSA answered: approved now
  if (res.status === 429) throw new Error("PSA's daily API limit was reached — try again tomorrow.");
  if (res.status === 404 || res.status === 204) return null;
  if (!res.ok) throw new Error(`PSA API error ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// Does the saved token actually work? "Saved" is not "working": PSA can know a token and still refuse it (an account
// not approved for the API). Checked when the token is saved and then at most hourly; Settings shows the answer.
let lastCheck = null; // { at, ok, error }
export async function check({ fresh = false } = {}) {
  if (!hasToken()) return (lastCheck = null);
  if (!fresh && lastCheck && Date.now() - lastCheck.at < 3600000) return lastCheck;
  try {
    await get("/cert/GetByCertNumber/10000000", { fresh }); // Settings → Save asks PSA even while it's been refusing
    lastCheck = { at: Date.now(), ok: true, error: null };
  } catch (err) {
    lastCheck = { at: Date.now(), ok: false, error: err.message };
  }
  return lastCheck;
}

const certCache = new Map();

/** fresh: skip the in-memory copy (the daily population watch wants today's numbers). */
export async function cert(certNumber, { fresh = false } = {}) {
  const n = String(certNumber || "").replace(/\D/g, "");
  if (n.length < 6 || n.length > 12) throw new Error("A PSA cert number is 6–12 digits.");
  if (certCache.has(n) && !fresh) return certCache.get(n);
  const data = await get(`/cert/GetByCertNumber/${n}`);
  const c = data?.PSACert;
  const out = c
    ? {
        found: true,
        certNumber: c.CertNumber,
        specId: c.SpecID,
        year: c.Year,
        brand: c.Brand,
        category: c.Category,
        cardNumber: c.CardNumber,
        subject: c.Subject,
        variety: c.Variety,
        grade: c.CardGrade,
        gradeDescription: c.GradeDescription,
        labelType: c.LabelType,
        autographGrade: c.AutographGrade || null,
        population: num(c.TotalPopulation),
        populationHigher: num(c.PopulationHigher),
        url: `https://www.psacard.com/cert/${n}`,
      }
    : { found: false, certNumber: n, url: `https://www.psacard.com/cert/${n}` };
  certCache.set(n, out);
  return out;
}

const num = (v) => (v == null || v === "" ? null : Number(v));

// Population by grade for a spec (card). Returns { total, byGrade: {"10": n, "9": n, ...} }.
export async function population(specId) {
  if (!specId) return null;
  const d = await get(`/pop/GetPSASpecPopulation/${encodeURIComponent(specId)}`);
  const p = d?.PSAPop;
  if (!p) return null;
  const byGrade = {};
  for (const [k, v] of Object.entries(p)) {
    const m = k.match(/^Grade(\d+)(_5)?$/);
    if (m && v) byGrade[m[1] + (m[2] ? ".5" : "")] = v;
  }
  return { description: d.Description, total: p.Total, authentic: p.Auth, byGrade };
}

/** PSA's own photos of the slab (when PSA has them): { front, back }. Lets you compare with the slab in hand. */
export async function images(certNumber) {
  const n = String(certNumber || "").replace(/\D/g, "");
  const d = await get(`/cert/GetImagesByCertNumber/${n}`);
  const list = Array.isArray(d) ? d : Array.isArray(d?.Images) ? d.Images : d && typeof d === "object" ? Object.values(d).flat().filter((x) => x && typeof x === "object") : [];
  const urlOf = (x) => x.ImageURL || x.imageUrl || x.ImageUrl || x.Url || x.url || null;
  const front = list.find((x) => x.IsFrontImage === true || x.isFrontImage === true || /front/i.test(x.ImageType || x.type || ""));
  const back = list.find((x) => x !== front && (x.IsFrontImage === false || x.isFrontImage === false || /back/i.test(x.ImageType || x.type || "")));
  const all = list.map(urlOf).filter(Boolean);
  return { front: (front && urlOf(front)) || all[0] || null, back: (back && urlOf(back)) || all[1] || null, all };
}

// The API reports numbered progress steps without names, so we show "step X of Y".
export async function submissionProgress(number) {
  const n = String(number || "").replace(/\D/g, "");
  if (!n) throw new Error("Enter the PSA submission number.");
  const d = (await get(`/order/GetSubmissionProgress/${n}`)) || (await get(`/order/GetProgress/${n}`));
  if (!d) return { found: false };
  const steps = (d.orderProgressSteps || []).sort((a, b) => a.index - b.index);
  const done = steps.filter((s) => s.completed).length;
  return {
    found: true,
    gradesReady: Boolean(d.gradesReady),
    shipped: Boolean(d.shipped),
    problem: Boolean(d.problemOrder),
    trackingNumber: d.shipTrackingNumber || null,
    carrier: d.shipCarrier || null,
    stepsDone: done,
    stepsTotal: steps.length,
    stage: d.shipped ? "Shipped back" : d.gradesReady ? "Grades ready" : d.problemOrder ? "Problem — check PSA" : steps.length ? `Step ${done} of ${steps.length} done` : "Received",
  };
}
