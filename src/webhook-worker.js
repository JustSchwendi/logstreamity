
// src/webhook-worker.js — Ingest worker (sequential per worker), cancellable, with retry & rate-limit

// --- Utilities ---
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

let cancelled = false;
let currentController = null;

function newAbortController(){
  if (typeof AbortController !== 'undefined') {
    currentController = new AbortController();
    return currentController;
  }
  currentController = null;
  return null;
}
function abortInFlight(){
  try { currentController && currentController.abort(); } catch {}
  currentController = null;
}

class RateLimiter{
  constructor(rps){
    this.capacity = Math.max(1, Number(rps || 90));
    this.tokens = this.capacity;
    this._t = setInterval(() => {
      this.tokens = Math.min(this.capacity, this.tokens + this.capacity);
    }, 1000);
  }
  stop(){ try { clearInterval(this._t); } catch {} }
  async take(n=1){
    n = Math.max(1, n|0);
    while (this.tokens < n) {
      if (cancelled) throw new Error('cancelled');
      await sleep(10);
    }
    this.tokens -= n;
  }
}

function normalizeEndpoint(input){
  if (!input) return "";
  let s = String(input).trim();
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u;
  try { u = new URL(s); } catch { return s; }
  u.hostname = u.hostname.replace(/\.apps\./i, ".");
  u.pathname = "/api/v2/logs/ingest";
  u.search = "";
  u.hash = "";
  return u.toString();
}

async function sendWithRetry(endpoint, token, body, attempt=0, signal){
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Authorization": `Api-Token ${token}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body),
    signal
  });
  if (res.ok) return { ok: true, res };
  const status = res.status;
  if ((status === 429 || status >= 500) && attempt < 5) {
    const ra = parseInt(res.headers.get("Retry-After") || "0", 10);
    const backoff = ra ? ra * 1000 : (250 * Math.pow(2, attempt + 1) + Math.floor(Math.random() * 100));
    await sleep(backoff);
    return sendWithRetry(endpoint, token, body, attempt + 1, signal);
  }
  let text = "";
  try { text = await res.text(); } catch {}
  return { ok: false, status, text };
}

function makeScheduler(delayMs, batchSize, baseTime){
  const step = Math.max(0, Math.floor(Number(delayMs||0) / Math.max(1, Number(batchSize||1))));
  let t = baseTime || Date.now();
  return function next(){ const cur = t; t += step; return cur; };
}

// severity helpers
const SEVERITY_KEYS = new Set(["level", "loglevel", "severity", "status", "syslog.severity"]);
function hasUserSeverityAttr(attrs){
  if (!attrs) return false;
  for (const k of Object.keys(attrs)) {
    if (SEVERITY_KEYS.has(k.toLowerCase())) return true;
  }
  return false;
}

// --- Worker message loop ---
self.onmessage = async (event) => {
  if (event.data.type === "STOP") {
    cancelled = true;
    abortInFlight();
    return;
  }
  if (event.data.type !== "START_INGEST") {
    self.postMessage({ type: "INFO", message: "Unknown command" });
    return;
  }

  cancelled = false;

  const { config, lines, workerInfo } = event.data;
  const endpoint = normalizeEndpoint(config.endpoint);
  const token = config.token;
  const mode = String(config.mode || "sequential");
  const delayMs = Number(config.delayMs || 0);
  const batchSize = Number(config.batchSize || 1);
  const randomize = !!config.randomize;
  const baseAttributes = config.attributes || {};
  const rateLimit = Number(config.rateLimitPerSecond || 90);

  const limiter = new RateLimiter(rateLimit);
  const sourceId = (Math.random().toString(16).slice(2) + Date.now().toString(16));
  let seq = 0;

  const finish = (kind, msg) => {
    try { limiter.stop(); } catch {}
    if (kind === 'cancel') self.postMessage({ type: "CANCELLED", message: msg || "Stopped" });
    else if (kind === 'done') self.postMessage({ type: "DONE", message: msg || "Finished" });
    else if (kind === 'error') self.postMessage({ type: "ERROR", error: msg || "Error" });
  };

  const userOverridesSeverity = hasUserSeverityAttr(baseAttributes);

  try {
    if (mode === "sequential") {
      // Live replay
      for (let i=0; i<lines.length; i+=batchSize){
        const chunk = lines.slice(i, i + batchSize);
        for (const item of chunk){
          if (cancelled) return finish('cancel');
          await limiter.take(1);
          const obj = (item && typeof item === 'object') ? item : { content: String(item ?? "") };
          const attrs = { ...baseAttributes, source_id: sourceId, seq_no: seq++, worker: workerInfo?.name || "logstreamity" };
          if (!userOverridesSeverity && obj.derived && obj.derived.loglevel) {
            attrs.loglevel = obj.derived.loglevel;
          }
          const payload = [{
            content: obj.content,
            attributes: attrs,
            timestamp: Date.now()
          }];
          const ctrl = newAbortController();
          const r = await sendWithRetry(endpoint, token, payload, 0, ctrl?.signal);
          currentController = null;
          if (!r.ok) return finish('error', `HTTP ${r.status}: ${r.text || ""}`);
          if (cancelled) return finish('cancel');
          if (delayMs > 0) { await sleep(delayMs); if (cancelled) return finish('cancel'); }
        }
        const progress = Math.round(((i + chunk.length) / lines.length) * 100);
        self.postMessage({ type: "PROGRESS", progress });
      }
      return finish('done', `Ingestion finished for worker "${workerInfo?.name || ''}"!`);
    }

    // Historic / scattered / random — scheduled timestamps, fast send
    const base = Date.now();
    const nextTs = makeScheduler(delayMs, batchSize, base);
    let orderIdx = lines.map((_, i) => i);
    if (mode === "random") orderIdx.sort(() => Math.random() - 0.5);
    for (const idx of orderIdx) {
      if (cancelled) return finish('cancel');
      await limiter.take(1);
      const item = lines[idx];
      const obj = (item && typeof item === 'object') ? item : { content: String(item ?? "") };
      const attrs = { ...baseAttributes, source_id: sourceId, seq_no: seq++, worker: workerInfo?.name || "logstreamity" };
      if (!userOverridesSeverity && obj.derived && obj.derived.loglevel) {
        attrs.loglevel = obj.derived.loglevel;
      }
      const payload = [{
        content: obj.content,
        attributes: attrs,
        timestamp: nextTs()
      }];
      const ctrl = newAbortController();
      const r = await sendWithRetry(endpoint, token, payload, 0, ctrl?.signal);
      currentController = null;
      if (!r.ok) return finish('error', `HTTP ${r.status}: ${r.text || ""}`);
      if (cancelled) return finish('cancel');
      if (seq % 50 === 0) {
        self.postMessage({ type: "PROGRESS", progress: Math.round((seq / lines.length) * 100) });
      }
      if ((seq % 500) === 0) await sleep(1);
    }
    return finish('done', `Ingestion finished for worker "${workerInfo?.name || ''}"!`);
  } catch (e) {
    if (String(e).includes('cancelled')) return finish('cancel');
    return finish('error', String(e && e.message || e));
  }
};
