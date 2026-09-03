// src/webhook-worker.js — attribute injection (all modes), dynamic loop, historic/scattered

/* Utilities */
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
class RateLimiter{
  // Refills continuously (proportional to elapsed time) instead of hard-resetting to
  // full capacity once per second. A once-per-second reset is fine when every take()
  // asks for 1 token, but once a single batched request asks for a large chunk of the
  // capacity, a hard reset lets through at most ~1 such request per second no matter
  // how much concurrency is available — this is what makes a "fast" batched send look
  // rate-limited to ~1 req/sec instead of the intended ~rps events/sec.
  constructor(rps){ this.capacity=Math.max(1,Number(rps||90)); this.tokens=this.capacity; this.lastRefill=Date.now(); }
  _refill(){
    const now = Date.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsedSec * this.capacity);
    this.lastRefill = now;
  }
  async take(n=1){
    n = Math.min(Math.max(1,n|0), this.capacity);
    while (true){
      this._refill();
      if (this.tokens >= n){ this.tokens -= n; return; }
      await sleep(10);
      if (cancelled) throw new Error("cancelled");
    }
  }
  stop(){}
}
function normalizeEndpoint(input){
  if(!input) return "";
  let s=String(input).trim(); if(!/^https?:\/\//i.test(s)) s="https://"+s;
  let u; try{ u=new URL(s); }catch{ return s; }
  u.hostname = u.hostname.replace(/\.apps\./i, ".");     // remove ".apps."
  u.pathname = "/api/v2/logs/ingest"; u.search=""; u.hash="";
  return u.toString();
}

let cancelled=false, loopActive=false;
// Tracks every in-flight request's controller (not just the latest), since with
// concurrent batched sends there can be many requests in flight at once — a single
// shared controller would only ever abort whichever one last overwrote it.
const inFlightControllers = new Set();
function newAbortController(){
  if(typeof AbortController==='undefined') return null;
  const ctrl = new AbortController();
  inFlightControllers.add(ctrl);
  return ctrl;
}
function releaseController(ctrl){ if (ctrl) inFlightControllers.delete(ctrl); }
function abortInFlight(){ for (const ctrl of inFlightControllers){ try{ ctrl.abort(); }catch{} } inFlightControllers.clear(); }

async function sendWithRetry(endpoint, token, body, attempt=0, signal){
  const res = await fetch(endpoint, {
    method:"POST",
    headers:{ "Authorization":`Api-Token ${token}`, "Content-Type":"application/json; charset=utf-8" },
    body: JSON.stringify(body),
    signal
  });
  if(res.ok) return { ok:true };
  const status = res.status;
  if((status===429 || status>=500) && attempt<5){
    const ra = parseInt(res.headers.get("Retry-After")||"0",10);
    const backoff = ra ? ra*1000 : (250*Math.pow(2,attempt+1) + Math.floor(Math.random()*120));
    await sleep(backoff);
    return sendWithRetry(endpoint, token, body, attempt+1, signal);
  }
  let text=""; try{ text = await res.text(); }catch{}
  return { ok:false, status, text };
}

/* Severity handling */
const USER_SEVERITY_KEYS = ['level','loglevel','severity','status','syslog.severity'];
function userHasSeverityAttr(attrs){
  if(!attrs || typeof attrs!=='object') return false;
  return USER_SEVERITY_KEYS.some(k => Object.prototype.hasOwnProperty.call(attrs, k));
}
const RX_BRACKET=/^\s*[\[\(<\{]\s*([A-Za-z]+)\s*[\]\)>\}][\s:;\-]*/;
const RX_PREFIX =/^\s*([A-Za-z]+)[\s:;\-]/;
const TOKENS = ["trace","trc","debug","dbg","info","information","notice","warn","warning","alert","error","err","fatal","critical","crit","emerg","emergency"];
function normalizeLevel(t){
  const s=String(t||"").toLowerCase();
  if(["trace","trc"].includes(s)) return "trace";
  if(["debug","dbg"].includes(s)) return "debug";
  if(["info","information","notice"].includes(s)) return "info";
  if(["warn","warning","alert"].includes(s)) return "warn";
  if(["error","err"].includes(s)) return "error";
  if(["fatal","critical","crit","emerg","emergency"].includes(s)) return "fatal";
  return null;
}
function parseSeverityFromLine(line){
  if(!line) return null;
  let m = RX_BRACKET.exec(line); if(m){ const v=normalizeLevel(m[1]); if(v) return v; }
  m = RX_PREFIX.exec(line); if(m){ const v=normalizeLevel(m[1]); if(v) return v; }
  const first = String(line).slice(0,24).toLowerCase();
  for(const t of TOKENS){ if(first.includes(t)){ const v=normalizeLevel(t); if(v) return v; } }
  return null;
}

/* Line helpers */
function getLineContent(any){ return (any && typeof any==='object' && 'content' in any) ? String(any.content ?? "") : String(any ?? ""); }
function getDerivedLevel(any){ return (any && typeof any==='object' && any.derived && typeof any.derived==='object' && any.derived.loglevel) ? String(any.derived.loglevel) : null; }
function isSleepDirective(s){ return /^\s*\[\[\[\s*SLEEP\s+(\d+)\s*\]\]\]\s*$/i.test(s||""); }
function sleepMsFromDirective(s){ const m=/^\s*\[\[\[\s*SLEEP\s+(\d+)\s*\]\]\]\s*$/i.exec(s||""); return m ? parseInt(m[1],10) : 0; }
// Dispatches worker(i) for i in [0,n) with up to `concurrency` in flight at once,
// instead of awaiting each item's full round-trip before starting the next. The
// rate limiter (inside worker) still caps actual send rate; this just stops network
// latency from serializing an otherwise-fast backfill/scatter run.
function runPool(n, concurrency, worker){
  return new Promise((resolve) => {
    if (n <= 0) return resolve(true);
    const cap = Math.max(1, concurrency|0);
    let nextIndex = 0, active = 0, failed = false;
    const launch = () => {
      while (!failed && !cancelled && active < cap && nextIndex < n){
        const i = nextIndex++;
        active++;
        worker(i).then((ok) => {
          active--;
          if (!ok) failed = true;
          if (cancelled || failed){ if (active === 0) resolve(false); return; }
          if (nextIndex >= n && active === 0){ resolve(true); return; }
          launch();
        });
      }
      if ((failed || cancelled) && active === 0) resolve(false);
    };
    launch();
  });
}

/* Worker message handling */
self.onmessage = async (event) => {
  const { type } = event.data || {};
  if(type === "SET_LOOP"){ loopActive = !!event.data.value; self.postMessage({ type:"INFO", message:`loop=${loopActive}` }); return; }
  if(type === "STOP"){ cancelled=true; abortInFlight(); return; }
  if(type !== "START_INGEST"){ self.postMessage({ type:"INFO", message:"Unknown command" }); return; }

  cancelled=false;

  const { config, lines, workerInfo } = event.data;
  const endpoint = normalizeEndpoint(config.endpoint);
  const token    = config.token;
  const mode     = (config.mode || "sequential").toLowerCase();
  const delayMs  = Number(config.delayMs || 0);
  const batchSize= Number(config.batchSize || 1);
  const rps      = Number(config.rateLimitPerSecond || 90);
  loopActive     = !!config.loop;

  // Robust attributes (always object; allow dotted keys like "dt.source_entity")
  const userAttrs = (config.attributes && typeof config.attributes === 'object') ? config.attributes : {};
  const allowParseLevel = !userHasSeverityAttr(userAttrs);

  const historicStartMs = Number(config.historicStartMs || 0) || null;
  const scattered = (config.scattered && typeof config.scattered === 'object') ? config.scattered : null;

  const limiter = new RateLimiter(rps);
  const sourceId = (Math.random().toString(16).slice(2) + Date.now().toString(16));

  let seq=0, cycle=0;

  const finish = (kind,msg)=>{ try{ limiter.stop(); }catch{};
    if(kind==='cancel') self.postMessage({ type:"CANCELLED", message:msg||"Stopped" });
    else if(kind==='done') self.postMessage({ type:"DONE", message:msg||"Finished" });
    else if(kind==='error') self.postMessage({ type:"ERROR", error:msg||"Error" });
  };

  const total = Array.isArray(lines) ? lines.length : 0;

  // Sends multiple records in a single POST — the ingest API accepts arrays of up to
  // 50,000 records (5MB) per request, so batching here (instead of one record per
  // request) cuts the number of network round-trips by up to WIRE_BATCH-fold. That
  // matters far more than send-concurrency once there's any real latency to the
  // endpoint, and it's also what keeps a "fast" backfill from hitting the browser's
  // own ~6-connections-per-host ceiling on HTTP/1.1.
  const sendRecords = async (records) => {
    await limiter.take(records.length);
    const ctrl = newAbortController();
    const r = await sendWithRetry(endpoint, token, records, 0, ctrl?.signal);
    releaseController(ctrl);
    if(cancelled) return { ok:false, cancelled:true };
    if(!r.ok) return { ok:false, status:r.status, text:r.text||"" };
    return { ok:true };
  };

  const tryParseJsonLine = (s) => {
    if (typeof s !== 'string') return null;
    const t = s.trim();
    if (!t.startsWith('{') || !t.endsWith('}')) return null;
    try {
      const obj = JSON.parse(t);
      return (obj && typeof obj === 'object' && !Array.isArray(obj)) ? obj : null;
    } catch { return null; }
  };

  const buildRecord = (s, ts, wName) => {
    // If the line is itself a JSON object (e.g. a pre-built JSONL log), unpack its
    // fields as top-level attributes instead of nesting the whole line under `content`.
    const parsed = tryParseJsonLine(s);
    const rec = parsed ? { ...parsed } : { content: s };

    if (mode === 'sequential') {
      // Preserve a timestamp already baked into the line; only fill in if missing.
      if (rec.timestamp === undefined) rec.timestamp = ts;
    } else {
      // historic/scattered modes explicitly control timing, so they override.
      rec.timestamp = ts;
    }

    Object.assign(rec, userAttrs);   // <-- top-level attributes (incl. 'dt.source_entity') win, matching API precedence
    rec.source_id = sourceId;
    rec.seq_no = seq++;
    rec.worker = wName || "logstreamity";

    // Plain-text lines get a best-effort severity guess; JSON lines are expected to
    // already carry their own severity/loglevel/level/status field.
    if (allowParseLevel && !parsed){
      const derived = parseSeverityFromLine(s);
      if (derived) rec.loglevel = derived;
    }
    return rec;
  };

  const WIRE_BATCH = Math.max(1, Math.min(rps, 50));

  // Sends `pending` in WIRE_BATCH-sized groups (guards against a single oversized
  // request if the user sets Line Volume very high) and clears it on success.
  const flushPending = async (pending) => {
    while (pending.length){
      const group = pending.splice(0, WIRE_BATCH);
      const rs = await sendRecords(group);
      if (!rs.ok) return rs;
    }
    return { ok: true };
  };

  const runSequentialOnce = async () => {
    for (let i=0; i<total; i+=batchSize){
      if (cancelled) return false;
      const chunk = lines.slice(i, i+batchSize);
      let pending = [];
      for (const item of chunk){
        if (cancelled) return false;
        const s = getLineContent(item);
        if (!s) continue;
        if (isSleepDirective(s)){
          const rs = await flushPending(pending);
          if (!rs.ok){ if (rs.cancelled) return false; self.postMessage({ type:"ERROR", error:`HTTP ${rs.status}: ${rs.text}` }); return false; }
          const ms=sleepMsFromDirective(s); if (ms>0) await sleep(ms);
          continue;
        }
        pending.push(buildRecord(s, Date.now(), workerInfo?.name));
      }
      const rs = await flushPending(pending);
      if (!rs.ok){ if (rs.cancelled) return false; self.postMessage({ type:"ERROR", error:`HTTP ${rs.status}: ${rs.text}` }); return false; }
      if (delayMs>0){ await sleep(delayMs); if (cancelled) return false; }
      const sent = Math.min(i + chunk.length, total);
      self.postMessage({ type:"PROGRESS", progress: Math.round((sent/total)*100) });
    }
    return true;
  };

  // historic/scattered/default-scheduled all share this: every record's timestamp is
  // computed up front from its index, so sends can be pipelined instead of waiting for
  // each request's full network round-trip before starting the next one. Actual send
  // rate is still capped by the RateLimiter inside sendRec(); this only removes the
  // artificial serialization that made a "fast" backfill run as slow as real-time replay
  // whenever the endpoint had any non-trivial latency.
  const CONCURRENCY = Math.max(5, Math.min(rps, 50));

  const runIndexed = async (n, computeTs) => {
    const numBatches = Math.ceil(n / WIRE_BATCH);
    let completed = 0;
    const ok = await runPool(numBatches, CONCURRENCY, async (b) => {
      const start = b * WIRE_BATCH;
      const end = Math.min(n, start + WIRE_BATCH);
      const records = [];
      for (let i = start; i < end; i++){
        const s = getLineContent(lines[i]);
        if (!s) continue;
        records.push(buildRecord(s, computeTs(i), workerInfo?.name));
      }
      if (records.length === 0) return true;
      const rs = await sendRecords(records);
      if (!rs.ok){
        if (!rs.cancelled) self.postMessage({ type:"ERROR", error:`HTTP ${rs.status}: ${rs.text}` });
        return false;
      }
      completed += records.length;
      self.postMessage({ type:"PROGRESS", progress: Math.round((completed/n)*100) });
      return true;
    });
    if (ok) self.postMessage({ type:"PROGRESS", progress: 100 });
    return ok && !cancelled;
  };

  const runScheduledOnce = async () => {
    // HISTORIC: explicit start timestamp, each line spaced by delay/batchSize from it
    if (mode === "historic" && historicStartMs){
      const step = Math.max(0, Math.floor((Number(delayMs)||0)/Math.max(1, Number(batchSize)||1)));
      return runIndexed(total, (i) => historicStartMs + i*step);
    }

    // SCATTERED: spread over [start,end] in chunks
    if (mode === "scattered" && scattered && scattered.startMs && scattered.endMs){
      const start = Number(scattered.startMs);
      const end   = Number(scattered.endMs);
      const duration = Math.max(0, end - start);
      const n = total || 1;
      const chunks = Math.max(1, Number(scattered.chunks || 1));
      const chunkSize = Math.ceil(n / chunks);

      const computeTs = (i) => {
        let ts = start + Math.floor(duration * (i / Math.max(1, n - 1)));
        if (chunks > 1){
          const chunkIndex = Math.floor(i / chunkSize);
          const chunkStart = start + Math.floor(duration * (chunkIndex / chunks));
          const chunkEnd   = start + Math.floor(duration * ((chunkIndex + 1) / chunks));
          const posInChunk = i - (chunkIndex * chunkSize);
          const denom = Math.max(1, chunkSize - 1);
          ts = chunkStart + Math.floor((chunkEnd - chunkStart) * (posInChunk / denom));
          if (config.randomize){
            const jitter = Math.floor((chunkEnd - chunkStart) * 0.05);
            ts += Math.floor(Math.random() * (2*jitter + 1)) - jitter;
          }
        }
        return ts;
      };
      return runIndexed(n, computeTs);
    }

    // Default scheduled from "now"
    const step = Math.max(0, Math.floor((Number(delayMs)||0)/Math.max(1, Number(batchSize)||1)));
    const base = Date.now();
    return runIndexed(total, (i) => base + i*step);
  };

  try{
    if (mode === "sequential"){
      do {
        self.postMessage({ type:"PROGRESS", progress:0 });
        const ok = await runSequentialOnce();
        if (!ok || cancelled) break;
        cycle++; if (loopActive) self.postMessage({ type:"CYCLE", cycle });
      } while(loopActive && !cancelled);
      if (cancelled) return finish('cancel');
      return loopActive ? undefined : finish('done');
    } else {
      do {
        self.postMessage({ type:"PROGRESS", progress:0 });
        const ok = await runScheduledOnce();
        if (!ok || cancelled) break;
        cycle++; if (loopActive) self.postMessage({ type:"CYCLE", cycle });
      } while(loopActive && !cancelled);
      if (cancelled) return finish('cancel');
      return loopActive ? undefined : finish('done');
    }
  }catch(e){
    if(String(e).includes('cancelled')) return finish('cancel');
    const msg = String(e && e.message || e);
    if(msg.toLowerCase().includes('failed to fetch') || msg.toLowerCase().includes('networkerror') || msg.toLowerCase().includes('load failed')){
      return finish('error', 'Failed to fetch — request was blocked before reaching Dynatrace. Check if an ad blocker (e.g. AdBlock, uBlock) or privacy browser (e.g. Brave) is blocking the request, and add an exception for your Dynatrace endpoint.');
    }
    return finish('error', msg);
  }
};
