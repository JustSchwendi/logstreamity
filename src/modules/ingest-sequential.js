import { RateLimiter } from "./rate-limiter.js";
import { sleep } from "./sleep.js";

export async function ingestSequential({
  lines, batchSize, delayMs, url, token, source,
  attributes = {}, rateLimitPerSecond = 90, debug = false, onDebug = () => {}
}) {
  const limiter = new RateLimiter(rateLimitPerSecond);
  const sourceId = cryptoRandomHex();
  let seq = 0;

  for (let i = 0; i < lines.length; i += batchSize) {
    const batchLines = lines.slice(i, i + batchSize);
    await limiter.take(batchLines.length);

    const payload = batchLines.map((line) => ({
      content: line,
      attributes: { ...attributes, dt_source: source || attributes.dt_source || "logstreamity", source_id: sourceId, seq_no: seq++ }
    }));

    const res = await sendBatchWithRetry(url, token, payload, debug, onDebug);
    if (debug) onDebug(`Sent batch ${i}-${i + batchLines.length - 1}`, { status: res.status });
    if (delayMs > 0) await sleep(delayMs);
  }
}

async function sendBatchWithRetry(url, token, payload, debug, onDebug) {
  let attempt = 0;
  while (true) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Api-Token ${token}` },
      body: JSON.stringify(payload)
    });
    if (res.ok) return res;

    const text = await safeText(res);
    const retryAfter = parseInt(res.headers.get("Retry-After") || "0", 10);
    if (debug) onDebug(`HTTP ${res.status} attempt ${attempt + 1}${text ? `: ${text}` : ""}`);

    if ((res.status === 429 || res.status >= 500) && attempt < 5) {
      attempt++;
      const backoff = retryAfter ? retryAfter * 1000 : 250 * (2 ** attempt) + Math.floor(Math.random() * 100);
      await sleep(backoff);
      continue;
    }
    const err = new Error(`Ingest failed with HTTP ${res.status}${text ? `: ${text}` : ""}`);
    err.status = res.status; err.body = text; throw err;
  }
}
async function safeText(res) { try { return await res.text(); } catch { return ""; } }
function cryptoRandomHex() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint32Array(2); crypto.getRandomValues(arr);
    return Array.from(arr, (n) => n.toString(16)).join("");
  }
  try { const { randomBytes } = require("crypto"); return randomBytes(8).toString("hex"); }
  catch { return Math.random().toString(16).slice(2) + Date.now().toString(16); }
}
