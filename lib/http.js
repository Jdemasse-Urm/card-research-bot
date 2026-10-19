// Shared HTTP helper for the scrapers: browser-like headers, timeout, small in-memory cache.
//
// Pages are fetched with the system `curl` (built into Windows 10+ and macOS) because some
// price sites sit behind Cloudflare, which challenges Node's own fetch but lets curl through.
// If curl is missing or fails, Node's fetch is tried instead.

import { execFile } from "node:child_process";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const MARK = "\n__CARDBOT__";

const cache = new Map(); // url -> { at, value }

function viaCurl(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(
      process.platform === "win32" ? "curl.exe" : "curl",
      ["-sL", "--compressed", "--max-time", String(Math.ceil(timeoutMs / 1000)), "-A", UA, "-H", "Accept-Language: en-US,en;q=0.9",
        "-w", `${MARK}%{http_code} %{url_effective}`, url],
      { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) return reject(err);
        const i = stdout.lastIndexOf(MARK);
        if (i < 0) return reject(new Error("curl output unreadable"));
        const [code, finalUrl] = stdout.slice(i + MARK.length).trim().split(" ");
        resolve({ status: Number(code), url: finalUrl || url, body: stdout.slice(0, i) });
      },
    );
  });
}

async function viaFetch(url, timeoutMs) {
  const res = await fetch(url, {
    headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  return { status: res.status, url: res.url, body: await res.text() };
}

// Be polite to the price sites: at most 2 requests in flight per host, so a batch of lookups
// doesn't look like a scraper storm and get us blocked.
const PER_HOST = 2;
const hostSlots = new Map(); // host -> { active, queue: [resolve] }

async function withHostSlot(host, fn) {
  const s = hostSlots.get(host) || { active: 0, queue: [] };
  hostSlots.set(host, s);
  if (s.active >= PER_HOST) await new Promise((resolve) => s.queue.push(resolve));
  s.active++;
  try {
    return await fn();
  } finally {
    s.active--;
    s.queue.shift()?.();
  }
}

async function fetchOnce(url, timeoutMs) {
  let r;
  try {
    r = await viaCurl(url, timeoutMs);
  } catch {
    r = null;
  }
  if (!r || r.status === 0) r = await viaFetch(url, timeoutMs);
  return r;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getText(url, { ttlMs = 10 * 60 * 1000, timeoutMs = 25000 } = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < ttlMs) return hit.value;

  const host = new URL(url).host;
  const r = await withHostSlot(host, async () => {
    let res = await fetchOnce(url, timeoutMs);
    if (res.status === 429 || res.status >= 500) {
      await sleep(2500); // one patient retry for rate limits / hiccups
      res = await fetchOnce(url, timeoutMs);
    }
    return res;
  });
  if (r.status < 200 || r.status >= 300) throw new Error(`HTTP ${r.status} from ${host}`);

  const value = { url: r.url, body: r.body };
  cache.set(url, { at: Date.now(), value });
  return value;
}

export async function getJson(url, opts) {
  const { body } = await getText(url, opts);
  return JSON.parse(body);
}
