
// src/webhook-worker.js — Real ingest worker (sequential per worker)
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
class RateLimiter{
  constructor(rps){ this.capacity=Math.max(1, rps||90); this.tokens=this.capacity; setInterval(()=>{ this.tokens=Math.min(this.capacity,this.tokens+this.capacity); },1000); }
  async take(n=1){ while(this.tokens<n){ await sleep(10); } this.tokens-=n; }
}
function normalizeEndpoint(input){
  if(!input) return "";
  let s = String(input).trim();
  if(!/^https?:\/\//i.test(s)) s = "https://" + s;
  let u; try{ u = new URL(s);}catch{ return s; }
  u.hostname = u.hostname.replace(/\.apps\./i, ".");
  u.pathname = "/api/v2/logs/ingest"; u.search=""; u.hash="";
  return u.toString();
}
async function sendWithRetry(endpoint, token, body, attempt=0){
  const res = await fetch(endpoint, {
    method:"POST",
    headers:{ "Authorization":`Api-Token ${token}`, "Content-Type":"application/json; charset=utf-8" },
    body: JSON.stringify(body)
  });
  if(res.ok) return {ok:true,res};
  const status = res.status;
  if((status===429 || status>=500) && attempt<5){
    const ra = parseInt(res.headers.get("Retry-After")||"0",10);
    const backoff = ra ? ra*1000 : (250*Math.pow(2,attempt+1) + Math.floor(Math.random()*100));
    await sleep(backoff);
    return sendWithRetry(endpoint, token, body, attempt+1);
  }
  let txt=""; try{ txt = await res.text(); }catch{}
  return {ok:false,status,text:txt};
}
function makeScheduler(mode, delayMs, batchSize, randomize, baseTime){
  // Returns an iterator of timestamps for each line index
  const step = Math.max(0, Math.floor((delayMs||0)/Math.max(1,batchSize||1)));
  let t = baseTime || Date.now();
  return function next(){ const cur=t; t += step; return cur; };
}

self.onmessage = async (event) => {
  if (event.data.type !== "START_INGEST") { self.postMessage({ type:"INFO", message:"Unknown command" }); return; }
  const { config, lines, workerInfo } = event.data;
  const endpoint = normalizeEndpoint(config.endpoint);
  const token = config.token;
  const mode = config.mode || "sequential";
  const delayMs = Number(config.delayMs||0);
  const batchSize = Number(config.batchSize||1);
  const randomize = !!config.randomize;
  const attributes = config.attributes || {};
  const rateLimit = Number(config.rateLimitPerSecond||90);
  const limiter = new RateLimiter(rateLimit);
  const sourceId = (Math.random().toString(16).slice(2) + Date.now().toString(16));
  let seq = 0;

  try{
    if (mode === "sequential"){
      // Live replay: real waiting by delay per batch (or per line)
      for (let i=0; i<lines.length; i+=batchSize){
        const chunk = lines.slice(i, i+batchSize);
        for (const line of chunk){
          await limiter.take(1);
          const nowTs = Date.now();
          const payload = [{
            content: line,
            attributes: { ...attributes, source_id: sourceId, seq_no: seq++, worker: workerInfo?.name || "logstreamity" },
            timestamp: nowTs
          }];
          const r = await sendWithRetry(endpoint, token, payload);
          if(!r.ok){ self.postMessage({ type:"ERROR", error:`HTTP ${r.status}: ${r.text||""}` }); return; }
          await sleep(delayMs||0);
        }
        const progress = Math.round(((i+chunk.length)/lines.length)*100);
        self.postMessage({ type:"PROGRESS", progress });
      }
      self.postMessage({ type:"DONE", message:`Ingestion finished for worker "${workerInfo?.name||''}"!` });
      return;
    }

    // Historic / scattered / random: no real waits, but scheduled timestamps
    const base = Date.now();
    const nextTs = makeScheduler(mode, delayMs, batchSize, randomize, base);
    let orderIdx = lines.map((_,i)=>i);
    if (mode === "random"){ orderIdx.sort(()=>Math.random()-0.5); }
    // "scattered": we could permute chunks; for now simple even distribution by step via scheduler
    for (let idx of orderIdx){
      await limiter.take(1);
      const line = lines[idx];
      const payload = [{
        content: line,
        attributes: { ...attributes, source_id: sourceId, seq_no: seq++, worker: workerInfo?.name || "logstreamity" },
        timestamp: nextTs()
      }];
      const r = await sendWithRetry(endpoint, token, payload);
      if(!r.ok){ self.postMessage({ type:"ERROR", error:`HTTP ${r.status}: ${r.text||""}` }); return; }
      // small micro-sleep to allow UI to breathe when huge lists
      if ((seq % 500) === 0) await sleep(1);
      if (seq % 50 === 0){
        const progress = Math.round((seq/lines.length)*100);
        self.postMessage({ type:"PROGRESS", progress });
      }
    }
    self.postMessage({ type:"DONE", message:`Ingestion finished for worker "${workerInfo?.name||''}"!` });
  }catch(e){
    self.postMessage({ type:"ERROR", error: String(e && e.message || e) });
  }
};
