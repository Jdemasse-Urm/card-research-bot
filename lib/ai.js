// Google Gemini client for the bot. Every AI step goes through generate():
//   - photo reading + JSON answers  -> responseJsonSchema (no tools)
//   - live research                 -> Google Search grounding (plain text + sources)
// The two are kept in separate calls on purpose: mixing JSON output or our own functions with
// Google Search is still a preview feature on Gemini, and these two paths are the stable ones.

import { GoogleGenAI, ApiError } from "@google/genai";
import { recordSpend, spendThisMonth, groundedThisMonth } from "./store.js";

export const MODEL = process.env.CARD_BOT_MODEL || "gemini-3.8-flash";
// Used automatically when the main model is out of daily free quota or unavailable for this key.
export const FALLBACK_MODEL = process.env.CARD_BOT_FALLBACK_MODEL === "off" ? null : process.env.CARD_BOT_FALLBACK_MODEL || "gemini-3.5-flash-lite";
let mainModelBlockedUntil = 0; // after a daily-quota error, skip straight to the fallback for a while

// Paid-tier list prices for gemini-3.8-flash (USD per 1M tokens) — the free tier costs $0.
// Google raises these on Jan 1, 2027 ($1.50 / $7.50); override with env if you switch models.
const PRICE_IN = parseFloat(process.env.CARD_BOT_PRICE_IN) || 0.75;
const PRICE_OUT = parseFloat(process.env.CARD_BOT_PRICE_OUT) || 3.75;
export const FREE_GROUNDED_PER_MONTH = 5000;

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
    this.usage = { input: 0, output: 0, grounded: 0, calls: 0, models: [] };
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
   */
  async generate({ system, parts, schema, search = false }) {
    if (this.signal?.aborted) throw new Error("Cancelled.");
    const config = { systemInstruction: system, abortSignal: this.signal };
    if (schema) {
      config.responseMimeType = "application/json";
      config.responseJsonSchema = schema;
    }
    if (search) config.tools = [{ googleSearch: {} }];

    let res;
    let model = FALLBACK_MODEL && Date.now() < mainModelBlockedUntil ? FALLBACK_MODEL : MODEL;
    for (let attempt = 0; ; attempt++) {
      try {
        res = await getClient().models.generateContent({ model, contents: [{ role: "user", parts }], config });
        break;
      } catch (err) {
        if (!(err instanceof ApiError)) throw err;
        const daily = err.status === 429 && /per ?day|daily|PerDay/i.test(err.message || "");
        const missing = err.status === 404;
        const canFallBack = FALLBACK_MODEL && model !== FALLBACK_MODEL;
        // Out of today's quota, or this key can't use the model: switch to the backup model.
        if ((daily || missing || (attempt >= 3 && err.status === 429)) && canFallBack) {
          if (daily) mainModelBlockedUntil = Date.now() + 3 * 3600000;
          this.step(`${MODEL} is ${daily ? "out of today's free quota" : missing ? "not available for this key" : "busy"} — switching to ${FALLBACK_MODEL}.`);
          model = FALLBACK_MODEL;
          attempt = -1;
          continue;
        }
        // Free tier allows only a few requests per minute — wait and retry instead of failing.
        const retryable = err.status === 429 || err.status === 503 || err.status === 500;
        if (!retryable || attempt >= 3) throw err;
        this.step(err.status === 429 ? "Free-tier speed limit hit — waiting a few seconds…" : "Gemini is busy — retrying…");
        await sleep(err.status === 429 ? 20000 : 4000 * (attempt + 1), this.signal);
      }
    }
    if (!this.usage.models.includes(model)) this.usage.models.push(model);

    const u = res.usageMetadata || {};
    this.usage.input += (u.promptTokenCount || 0) + (u.toolUsePromptTokenCount || 0);
    this.usage.output += (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    this.usage.calls++;

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
    recordSpend(this.kind, usd, this.usage.grounded);
    return { ...this.usage, usd: Math.round(usd * 10000) / 10000, groundedThisMonth: groundedThisMonth(), freeGrounded: FREE_GROUNDED_PER_MONTH };
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
