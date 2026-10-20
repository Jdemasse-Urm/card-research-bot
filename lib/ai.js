// Google Gemini client for the bot. Every AI step goes through generate():
//   - photo reading + JSON answers  -> responseJsonSchema (no tools)
//   - live research                 -> Google Search grounding (plain text + sources)
// The two are kept in separate calls on purpose: mixing JSON output or our own functions with
// Google Search is still a preview feature on Gemini, and these two paths are the stable ones.
//
// Service rules (all in one place, here):
//   - at most MAX_IN_FLIGHT calls at once — two jobs running together queue instead of racing into 429s
//   - every call has a deadline (TIMEOUT_MS); a hung call is retried once, then fails with a clear message
//   - a 429 waits exactly as long as Google asks (retryDelay in the error), not a blind 20 s
//   - simple structured steps run in the "fast lane" (low thinking effort): quicker and cheaper
//   - every call and job is recorded (model, time, outcome) for the AI performance panel in Settings

import { GoogleGenAI, ApiError } from "@google/genai";
import { recordJob, recordCall, spendThisMonth, groundedThisMonth } from "./store.js";

export const MODEL = process.env.CARD_BOT_MODEL || "gemini-3.8-flash";
// Used automatically when the main model is out of daily free quota or unavailable for this key.
export const FALLBACK_MODEL = process.env.CARD_BOT_FALLBACK_MODEL === "off" ? null : process.env.CARD_BOT_FALLBACK_MODEL || "gemini-3.5-flash-lite";
let mainModelBlockedUntil = 0; // after a daily-quota error, skip straight to the fallback for a while

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
// A 429 body says how long to wait ("retryDelay": "23s"); honour it instead of a blind pause.
export function retryAfterMs(err) {
  const m = String(err?.message || "").match(/retryDelay"?\s*:\s*"?(\d+(?:\.\d+)?)s/i) || String(err?.message || "").match(/retry (?:in|after) (\d+(?:\.\d+)?)\s*s/i);
  return m ? Math.min(60000, Math.ceil(parseFloat(m[1]) * 1000) + 500) : null;
}
// Fast lane: if a model rejects the thinking-level option, drop it for the rest of the session instead of failing jobs.
let thinkingLevelSupported = true;

let client = null;
export function resetClient() {
  client = null;
}
function getClient() {
  if (!client) client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
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
   */
  async generate({ system, parts, schema, search = false, effort = null }) {
    if (this.signal?.aborted) throw new Error("Cancelled.");
    const base = { systemInstruction: system };
    if (schema) {
      base.responseMimeType = "application/json";
      base.responseJsonSchema = schema;
    }
    if (search) base.tools = [{ googleSearch: {} }];
    const timeoutMs = search ? TIMEOUT_MS.search : TIMEOUT_MS.plain;

    let res;
    let model = FALLBACK_MODEL && Date.now() < mainModelBlockedUntil ? FALLBACK_MODEL : MODEL;
    let retries = 0, fallback = false;
    const started = Date.now();
    for (let attempt = 0; ; attempt++) {
      const config = { ...base, abortSignal: AbortSignal.any([this.signal, AbortSignal.timeout(timeoutMs)].filter(Boolean)) };
      if (effort && thinkingLevelSupported) config.thinkingConfig = { thinkingLevel: String(effort).toUpperCase() };
      const t0 = Date.now();
      const failed = (extra = {}) => recordCall({ model, ms: Date.now() - t0, ok: false, ...extra });
      try {
        res = await gate(() => getClient().models.generateContent({ model, contents: [{ role: "user", parts }], config }), this.signal);
        break;
      } catch (err) {
        if (this.signal?.aborted) throw new Error("Cancelled.");
        if (err?.name === "TimeoutError" || err?.name === "AbortError") {
          failed({ timeout: true });
          if (attempt >= 1) throw new Error(`Gemini didn't answer within ${Math.round(timeoutMs / 1000)} s, twice — try again in a minute.`);
          retries++;
          this.step("Gemini is taking too long — trying again…");
          continue;
        }
        if (!(err instanceof ApiError)) {
          failed();
          throw err;
        }
        if (err.status === 400 && config.thinkingConfig && /thinking/i.test(err.message || "")) {
          thinkingLevelSupported = false; // this model has no fast lane; same call again without it
          attempt--;
          continue;
        }
        const daily = err.status === 429 && /per ?day|daily|PerDay/i.test(err.message || "");
        const missing = err.status === 404;
        const canFallBack = FALLBACK_MODEL && model !== FALLBACK_MODEL;
        // Out of today's quota, or this key can't use the model: switch to the backup model.
        if ((daily || missing || (attempt >= 3 && err.status === 429)) && canFallBack) {
          if (daily) mainModelBlockedUntil = Date.now() + 3 * 3600000;
          this.step(`${MODEL} is ${daily ? "out of today's free quota" : missing ? "not available for this key" : "busy"} — switching to ${FALLBACK_MODEL}.`);
          failed({ fallback: true });
          model = FALLBACK_MODEL;
          fallback = true;
          attempt = -1;
          continue;
        }
        // Free tier allows only a few requests per minute — wait and retry instead of failing.
        const retryable = err.status === 429 || err.status === 503 || err.status === 500;
        if (!retryable || attempt >= 3) {
          failed();
          throw err;
        }
        retries++;
        const wait = err.status === 429 ? retryAfterMs(err) ?? 20000 : 4000 * (attempt + 1);
        this.step(err.status === 429 ? `Free-tier speed limit hit — waiting ${Math.round(wait / 1000)} s…` : "Gemini is busy — retrying…");
        await sleep(wait, this.signal);
      }
    }
    if (!this.usage.models.includes(model)) this.usage.models.push(model);

    const u = res.usageMetadata || {};
    const input = (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0);
    const output = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    this.usage.input += input;
    this.usage.output += output;
    this.usage.calls++;
    this.usage.retries += retries;
    recordCall({ model, ms: Date.now() - started, ok: true, retries, fallback, input, output, fast: Boolean(effort && thinkingLevelSupported) });

    const cand = res.candidates?.[0];
    const meta = cand?.groundingMetadata;
    if (search && meta) {
      this.usage.grounded++;
      for (const q of meta.webSearchQueries || []) this.step(`Searched Google: "${q}"`);
      for (const c of meta.groundingChunks || []) {
        if (c.web?.uri) this.sources.set(c.web.uri, { title: c.web.title || c.web.uri, url: c.web.uri });
      }
    }

    const reason = cand?.finishReason;
    if (!cand || ["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"].includes(reason)) {
      throw new Error(`Gemini declined to answer (${reason || res.promptFeedback?.blockReason || "no response"}). Try a clearer photo or different wording.`);
    }
    const text = res.text || "";
    if (!schema) return text;
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

// Friendly text for API errors shown in the UI.
export function explainError(err) {
  if (err?.name === "AbortError" || /aborted|Cancelled/i.test(err?.message || "")) return "Cancelled.";
  if (err instanceof ApiError) {
    const m = err.message || "";
    if (err.status === 400 && /API key not valid|API_KEY_INVALID/i.test(m)) return "Your Gemini API key was rejected. Check it in Settings.";
    if (err.status === 403) return "This Gemini key isn't allowed to do that (check the key, or that the Gemini API is enabled for it).";
    if (err.status === 404) return `The model "${MODEL}" wasn't found for this key. Set CARD_BOT_MODEL in .env to another model (e.g. gemini-3.5-flash-lite).`;
    if (err.status === 429) return "Gemini's free-tier limit was reached — wait a minute (or until tomorrow for the daily limit) and try again.";
    return `Gemini API error ${err.status}: ${m.slice(0, 300)}`;
  }
  return err?.message || String(err);
}
