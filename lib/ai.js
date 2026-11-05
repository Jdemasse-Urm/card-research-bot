// Google Gemini client for the bot. Every AI step goes through generate():
//   - photo reading + JSON answers  -> responseJsonSchema (no tools)
//   - live research                 -> Google Search grounding (plain text + sources)
// The two are kept in separate calls on purpose: mixing JSON output or our own functions with
// Google Search is still a preview feature on Gemini, and these two paths are the stable ones.
//
// Service rules (all in one place, here):
//   - at most MAX_IN_FLIGHT calls at once — two jobs running together queue instead of racing into 429s
//   - every call has a deadline (TIMEOUT_MS); a hung call is retried once, then fails with a clear message
//   - a model hanging, overloaded (503) or out of quota moves the call down MODELS (main → backup → Google's older free
//     model), and the model that failed is skipped for 5 min (3 h when it's out of today's quota). Google's free tier
//     rations its newest models first on busy days, so the last stop is the one most likely to answer.
//   - a 429 waits exactly as long as Google asks (retryDelay in the error), not a blind 20 s
//   - Google Search refused on this key's plan (Google's free tier has no search on Gemini 3 models) fails at once
//     with the fix, instead of waiting out a "speed limit" that never lifts
//   - simple structured steps run in the "fast lane" (low thinking effort): quicker and cheaper
//   - every call and job is recorded (model, time, outcome) for the AI performance panel in Settings

import { GoogleGenAI, ApiError } from "@google/genai";
import { recordJob, recordCall, spendThisMonth, groundedThisMonth } from "./store.js";

export const MODEL = process.env.CARD_BOT_MODEL || "gemini-3.8-flash";
// Used automatically when the main model is out of daily free quota or unavailable for this key.
export const FALLBACK_MODEL = process.env.CARD_BOT_FALLBACK_MODEL === "off" ? null : process.env.CARD_BOT_FALLBACK_MODEL || "gemini-3.5-flash-lite";
let searchRefusedUntil = 0; // after Google refused Search on this key's plan, search steps fail without asking again for a bit
const SEARCH_RECHECK_MS = 2 * 60000;
// Google's free tier has no Search on Gemini 3 models but still has it on gemini-2.5-flash (500 a day) — until Dec 1,
// 2026, when Google routes that model to 3.5-flash-lite. A free key's searches go there; after Dec 1 Google refuses
// those too and the app says billing is needed. Remove once Google has retired it.
export const FREE_SEARCH_MODEL = process.env.CARD_BOT_FREE_SEARCH_MODEL === "off" ? null : process.env.CARD_BOT_FREE_SEARCH_MODEL || "gemini-2.5-flash";
let searchViaFreeUntil = 0; // the plan refused search on the main models: searches use FREE_SEARCH_MODEL for an hour (then the main one is tried again — billing may be on by then)
// The order calls move down when a model is out of quota, hung or overloaded (the free-search model reads photos and
// answers JSON too — the last stop on a day Google's newer models turn free keys away).
export const MODELS = [...new Set([MODEL, FALLBACK_MODEL, FREE_SEARCH_MODEL].filter(Boolean))];
const blockedUntil = new Map(); // model → until when calls skip it (out of today's quota, or overloaded)
// Overloads in a row per model: each one skips it longer (5, 10, 20, then 30 min) and switches after its first 503 —
// on 11/5 the main model took ~50 s to say "overloaded", twice, every time it was tried again.
const strikes = new Map();
const usable = (m) => !(Date.now() < (blockedUntil.get(m) || 0));
export const SEARCH_NEEDS_BILLING =
  "Google refused the search: this key's project is on Google's free tier, which includes no Google Search on Gemini 3 models " +
  "(it's 0 searches — not \"5,000 left\"), and its older free-search model refused too (Google retires it Dec 1, 2026, and allows 500 a day). " +
  "Turn on billing for the key's project in Google AI Studio (aistudio.google.com/apikey → Set up billing; " +
  "the key's row then shows a paid tier instead of \"Free tier\"). With billing on, the first 5,000 searches a month cost nothing. " +
  "The app asks Google again every 2 minutes. Photo reading, bulk scans and sold prices work without it.";

// Paid-tier list prices for gemini-3.8-flash (USD per 1M tokens) — the free tier costs $0.
// Google raises these on Jan 1, 2027 ($1.50 / $7.50); override with env if you switch models.
const PRICE_IN = parseFloat(process.env.CARD_BOT_PRICE_IN) || 0.75;
const PRICE_OUT = parseFloat(process.env.CARD_BOT_PRICE_OUT) || 3.75;
export const FREE_GROUNDED_PER_MONTH = 5000;

// Gemini's free tier allows only a handful of requests per minute, so calls queue through this gate.
const MAX_IN_FLIGHT = Math.max(1, parseInt(process.env.CARD_BOT_AI_CONCURRENCY, 10) || 2);
let inFlight = 0;
const waiting = [];
async function gate(fn, signal) {
  if (inFlight >= MAX_IN_FLIGHT) {
    await new Promise((resolve, reject) => {
      const w = { resolve };
      waiting.push(w);
      signal?.addEventListener("abort", () => {
        const i = waiting.indexOf(w);
        if (i >= 0) waiting.splice(i, 1);
        reject(new Error("Cancelled."));
      }, { once: true });
    });
  }
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.resolve();
  }
}
export const aiQueue = () => ({ inFlight, waiting: waiting.length, max: MAX_IN_FLIGHT });

// How long one call may run before it's abandoned (grounded research is the slow kind).
export const TIMEOUT_MS = { plain: 90000, search: 150000 };
// When to say a call is slow, and the pause between retries of an overloaded model (the tests shorten both).
export const WAITS = { slowNotice: 25000, retryStep: 4000 };
// A 429 body says how long to wait ("retryDelay": "23s"); honour it instead of a blind pause.
export function retryAfterMs(err) {
  const m = String(err?.message || "").match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i) || String(err?.message || "").match(/retry (?:in|after) (\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.min(60000, Math.ceil(parseFloat(m[1]) * 1000) + 500) : null;
}
// Fast lane: a model that rejects the thinking-level option (older models) is asked without it from then on.
const noThinkingLevel = new Set();
// Close reads (bulk scan) ask for high image detail so small print survives; dropped the same way per model if refused.
const noMediaResolution = new Set();

let client = null;
export function resetClient() {
  client = null;
  blockedUntil.clear(); // a new key starts fresh
  strikes.clear();
  searchRefusedUntil = searchViaFreeUntil = 0;
}
function getClient() {
  // CARD_BOT_GEMINI_URL: the tests point the real SDK at a stand-in server
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, ...(process.env.CARD_BOT_GEMINI_URL ? { httpOptions: { baseUrl: process.env.CARD_BOT_GEMINI_URL } } : {}) });
  return client;
}
export const hasKey = () => Boolean(process.env.GEMINI_API_KEY);

export function usageCost(u) {
  return ((u.input || 0) * PRICE_IN + (u.output || 0) * PRICE_OUT) / 1e6;
}
export const monthlyBudget = () => {
  const n = parseFloat(process.env.CARD_BOT_MONTHLY_BUDGET);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => (clearTimeout(t), reject(new Error("Cancelled."))), { once: true });
  });

/**
 * A job groups the AI calls of one lookup / hot scan / question so spend is recorded once.
 */
export class Job {
  constructor({ kind, signal, onEvent = () => {} }) {
    if (!hasKey()) throw new Error("No Gemini API key yet — open Settings (top right) and paste your key.");
    const budget = monthlyBudget();
    if (budget != null && spendThisMonth() >= budget) {
      throw new Error(`Monthly AI budget of $${budget.toFixed(2)} reached. Raise it in Settings, or use Quick price (free).`);
    }
    this.kind = kind;
    this.signal = signal;
    this.onEvent = onEvent;
    this.startedAt = Date.now();
    this.usage = { input: 0, output: 0, grounded: 0, calls: 0, retries: 0, models: [] };
    this.sources = new Map();
    this.sourceList = []; // the same pages, numbered [1], [2]… across every search of this job (cite: true)
    this.sourceIndex = new Map();
    this.lastModel = null; // which model gave the latest answer (a backup's photo read is checked by eye)
  }

  step(text) {
    this.onEvent({ type: "step", text });
  }

  /**
   * @param {object} o
   * @param {string} o.system
   * @param {Array}  o.parts     user content parts: {text} and/or {inlineData:{mimeType,data}}
   * @param {object} [o.schema]  JSON schema -> returns parsed JSON
   * @param {boolean} [o.search] enable Google Search grounding -> returns text + sources
   * @param {string}  [o.effort] "low" for simple structured steps (fast lane); default = the model's own choice
   * @param {boolean} [o.detail] read images at high resolution (card numbers, serial stamps, slab labels)
   * @param {boolean} [o.cite]   with search: mark each claim's sources in the text as [n] (this.sourceList numbers)
   */
  async generate({ system, parts, schema, search = false, effort = null, detail = false, cite = false }) {
    if (this.signal?.aborted) throw new Error("Cancelled.");
    const base = { systemInstruction: system };
    if (schema) {
      base.responseMimeType = "application/json";
      base.responseJsonSchema = schema;
    }
    if (search) base.tools = [{ googleSearch: {} }];
    const timeoutMs = search ? TIMEOUT_MS.search : TIMEOUT_MS.plain;

    if (search && Date.now() < searchRefusedUntil) throw new Error(SEARCH_NEEDS_BILLING);

    let res;
    let model = search && FREE_SEARCH_MODEL && Date.now() < searchViaFreeUntil ? FREE_SEARCH_MODEL : MODELS.find(usable) || MODELS[MODELS.length - 1];
    let retries = 0, fallback = false;
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      const config = { ...base, abortSignal: AbortSignal.any([this.signal, AbortSignal.timeout(timeoutMs)].filter(Boolean)) };
      if (effort && !noThinkingLevel.has(model)) config.thinkingConfig = { thinkingLevel: String(effort).toUpperCase() };
      if (detail && !noMediaResolution.has(model)) config.mediaResolution = "MEDIA_RESOLUTION_HIGH";
      const t0 = Date.now();
      const failed = (extra = {}) => recordCall({ model, ms: Date.now() - t0, ok: false, ...extra });
      // a long silence reads as "stuck" — say what it's waiting on
      const slow = setTimeout(() => this.step(`Still waiting on ${model} (Google is slow right now; it gives up at ${Math.round(timeoutMs / 1000)} s)…`), WAITS.slowNotice);
      try {
        res = await gate(() => {
          // asked again once through the queue: searches started together (hot cards) mustn't all go out after a refusal
          if (search && Date.now() < searchRefusedUntil) throw new Error(SEARCH_NEEDS_BILLING);
          return getClient().models.generateContent({ model, contents: [{ role: "user", parts }], config });
        }, this.signal);
        clearTimeout(slow);
        break;
      } catch (err) {
        clearTimeout(slow);
        if (this.signal?.aborted) throw new Error("Cancelled.");
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        if (err?.message === SEARCH_NEEDS_BILLING) throw err; // never sent, nothing to record
        if (!timedOut && !(err instanceof ApiError)) {
          failed();
          throw err;
        }
        const msg = timedOut ? "" : err.message || "";
        if (!timedOut && err.status === 400 && config.thinkingConfig && /thinking/i.test(msg)) {
          noThinkingLevel.add(model); // this model has no fast lane; same call again without it
          attempt--;
          continue;
        }
        if (!timedOut && err.status === 400 && config.mediaResolution && /media.?resolution/i.test(msg)) {
          noMediaResolution.add(model); // same call at the model's normal image detail
          attempt--;
          continue;
        }
        const daily = !timedOut && err.status === 429 && /per ?day|daily|PerDay/i.test(msg);
        // A speed limit says how long to wait (retryDelay) or names a per-minute quota. A 429 on a search call with
        // neither is Google saying search isn't on this key's plan — waiting never lifts it.
        if (search && !timedOut && err.status === 429 && !daily && retryAfterMs(err) == null && !/per ?minute/i.test(msg)) {
          failed();
          // Google's free tier still searches with its older model — use it for searches until billing is on
          if (FREE_SEARCH_MODEL && model !== FREE_SEARCH_MODEL) {
            searchViaFreeUntil = Date.now() + 3600000;
            this.step(`Google's free tier has no search on ${model} — searching with ${FREE_SEARCH_MODEL} instead (free, 500 searches a day, until Google retires it on Dec 1, 2026).`);
            model = FREE_SEARCH_MODEL;
            attempt = -1;
            continue;
          }
          searchRefusedUntil = Date.now() + SEARCH_RECHECK_MS; // short: billing switched on starts working within minutes
          throw new Error(SEARCH_NEEDS_BILLING);
        }
        const missing = !timedOut && err.status === 404;
        const busy = timedOut || err.status === 503 || err.status === 500;
        // a search on the free-search model never falls back to the backup: the backup can't search on the free tier
        const next = search && model === FREE_SEARCH_MODEL ? null : MODELS[MODELS.indexOf(model) + 1] || null;
        // Out of today's quota, the key can't use the model, it hung or stayed overloaded, or it keeps hitting the
        // speed limit: move to the next model, and skip this one for a while (daily: 3 h, overloaded: 5 min).
        if (next && (daily || missing || (busy && (timedOut || attempt >= 1 || strikes.get(model) > 0)) || (attempt >= 3 && err.status === 429))) {
          const n = busy ? (strikes.get(model) || 0) + 1 : 0;
          if (busy) strikes.set(model, n);
          blockedUntil.set(model, Math.max(blockedUntil.get(model) || 0, Date.now() + (daily ? 3 * 3600000 : busy ? Math.min(30, 5 * 2 ** (n - 1)) * 60000 : 0)));
          this.step(`${model} is ${daily ? "out of today's free quota" : missing ? "not available for this key" : timedOut ? "not answering" : busy ? "overloaded at Google right now" : "busy"} — switching to ${next}.`);
          failed({ fallback: true, timeout: timedOut });
          model = next;
          fallback = true;
          attempt = -1;
          continue;
        }
        if (timedOut) {
          failed({ timeout: true });
          if (attempt >= 1) throw new Error(`Gemini didn't answer within ${Math.round(timeoutMs / 1000)} s, twice — try again in a minute.`);
          retries++;
          this.step("Gemini is taking too long — trying again…");
          continue;
        }
        // Speed limits and overloads usually pass in seconds — wait and retry instead of failing.
        const retryable = err.status === 429 || err.status === 503 || err.status === 500;
        if (!retryable || attempt >= 3) {
          failed();
          throw err;
        }
        retries++;
        const wait = err.status === 429 ? retryAfterMs(err) ?? 20000 : WAITS.retryStep * (attempt + 1);
        this.step(err.status === 429 ? `Google's speed limit hit — waiting ${Math.round(wait / 1000)} s…` : "Gemini is busy — retrying…");
        await sleep(wait, this.signal);
      }
    }
    if (!this.usage.models.includes(model)) this.usage.models.push(model);
    this.lastModel = model;
    strikes.delete(model);

    const u = res.usageMetadata || {};
    const input = (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0);
    const output = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    this.usage.input += input;
    this.usage.output += output;
    this.usage.calls++;
    this.usage.retries += retries;
    recordCall({ model, ms: Date.now() - started, ok: true, retries, fallback, input, output, fast: Boolean(effort && !noThinkingLevel.has(model)) });

    const cand = res.candidates?.[0];
    const meta = cand?.groundingMetadata;
    const local = []; // this answer's source index → the job's source number (the same page keeps one number)
    if (search && meta) {
      this.usage.grounded++;
      for (const q of meta.webSearchQueries || []) this.step(`Searched Google: "${q}"`);
      (meta.groundingChunks || []).forEach((c, i) => {
        if (!c.web?.uri) return;
        if (!this.sources.has(c.web.uri)) this.sources.set(c.web.uri, { title: c.web.title || c.web.uri, url: c.web.uri });
        if (!this.sourceIndex.has(c.web.uri)) this.sourceIndex.set(c.web.uri, this.sourceList.push(this.sources.get(c.web.uri)));
        local[i] = this.sourceIndex.get(c.web.uri);
      });
    }

    const reason = cand?.finishReason;
    if (!cand || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(reason)) {
      throw new Error(`Gemini declined to answer (${reason || res.promptFeedback?.blockReason || "no response"}). Try a clearer photo or different wording.`);
    }
    const text = res.text || "";
    if (!schema) return cite && search ? withCitations(text, meta?.groundingSupports, local) : text;
    try {
      return JSON.parse(text);
    } catch {
      if (reason === "MAX_TOKENS") throw new Error("Gemini's answer was cut off (too long). Try again.");
      throw new Error("Gemini returned an unreadable answer. Try again.");
    }
  }

  finish() {
    const usd = usageCost(this.usage);
    const ms = Date.now() - this.startedAt;
    recordJob(this.kind, usd, this.usage.grounded, ms);
    return { ...this.usage, ms, usd: Math.round(usd * 10000) / 10000, groundedThisMonth: groundedThisMonth(), freeGrounded: FREE_GROUNDED_PER_MONTH };
  }
}

/**
 * A searched answer with its sources marked where Google says they back it: "…threw a no-hitter [3][5]" — the
 * numbers are the job's sourceList (1-based), so a later step can say which sources back which claim.
 */
export function withCitations(text, supports = [], local = []) {
  const marks = [];
  let from = 0;
  for (const s of supports || []) {
    const seg = s?.segment?.text;
    const nums = [...new Set((s?.groundingChunkIndices || []).map((i) => local[i]).filter(Boolean))];
    if (!seg || !nums.length) continue;
    const at = text.indexOf(seg, from);
    if (at < 0) continue;
    marks.push([at + seg.length, nums]);
    from = at + seg.length;
  }
  let out = "", prev = 0;
  for (const [end, nums] of marks) {
    out += text.slice(prev, end) + " " + nums.map((n) => `[${n}]`).join("");
    prev = end;
  }
  return out + text.slice(prev);
}

// Friendly text for API errors shown in the UI.
export function explainError(err) {
  if (err?.name === "AbortError" || /aborted|Cancelled/i.test(err?.message || "")) return "Cancelled.";
  if (err instanceof ApiError) {
    const m = err.message || "";
    if (err.status === 400 && /API key not valid|API_KEY_INVALID/i.test(m)) return "Your Gemini API key was rejected. Check it in Settings.";
    if (err.status === 403) return "This Gemini key isn't allowed to do that (check the key, or that the Gemini API is enabled for it).";
    if (err.status === 404) return `The model "${MODEL}" wasn't found for this key. Set CARD_BOT_MODEL in .env to another model (e.g. gemini-3.5-flash-lite).`;
    if (err.status === 429) return "Gemini's free-tier limit was reached — wait a minute (or until tomorrow for the daily limit) and try again.";
    if (err.status === 503 || err.status === 500) return `Google's Gemini servers are overloaded right now (all ${MODELS.length} models the app tries) — try again in a few minutes.`;
    return `Gemini API error ${err.status}: ${m.slice(0, 300)}`;
  }
  return err?.message || String(err);
}
