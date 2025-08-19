// src/webhook-worker.js — dynamic SET_LOOP + historic/scattered

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }
class RateLimiter{ constructor(rps){ this.capacity=Math.max(1,Number(rps||90)); this.tokens=this.capacity; this._t=setInterval(()=>{ this.tokens=Math.min(this.capacity,this.tokens+this.capacity); },1000);} async take(n=1){ n=Math.max(1,n|0); while(this.tokens<n){ await sleep(10); if(cancelled) throw new Error("cancelled"); } this.tokens-=n; } stop(){ try{clearInterval(this._t);}catch{} } }
function normalizeEndpoint(input){ if(!input) return ""; let s=String(input).trim(); if(!/^https?:\/\//i.test(s)) s="https://"+s; let u; try{u=new URL(s);}catch{return s;} u.hostname=u.hostname.replace(/\.apps\./i,"."); u.pathname="/api/v2/logs/ingest"; u.search=""; u.hash=""; return u.toString(); }
let cancelled=false; let currentController=null; let loopActive=false;
function newAbortController(){ if(typeof AbortController!=='undefined'){ currentController=new AbortController(); return currentController; } currentController=null; return null; }
function abortInFlight(){ try{ currentController?.abort(); }catch{} currentController=null; }
async function sendWithRetry(endpoint, token, body, attempt=0, signal){
  const res = await fetch(endpoint,{ method:"POST", headers:{ "Authorization":`Api-Token ${token}`, "Content-Type":"application/json; charset=utf-8" }, body: JSON.stringify(body), signal });
  if(res.ok) return {ok:true,res};
  const status=res.status;
  if((status===429 || status>=500) && attempt<5){
    const ra=parseInt(res.headers.get("Retry-After")||"0",10);
    const backoff = ra ? ra*1000 : (250*Math.pow(2,attempt+1)+Math.floor(Math.random()*120));
    await sleep(backoff);
    return sendWithRetry(endpoint, token, body, attempt+1, signal);
  }
  let txt=""; try{ txt=await res.text(); }catch{}
  return {ok:false,status,text:txt};
}
const USER_SEVERITY_KEYS=['level','loglevel','severity','status','syslog.severity'];
function hasUserSeverityAttr(attrs){ if(!attrs||typeof attrs!=='object') return false; return USER_SEVERITY_KEYS.some(k=>Object.prototype.hasOwnProperty.call(attrs,k)); }
const SEVERITY_TOKENS=["trace","trc","debug","dbg","info","information","notice","warn","warning","alert","error","err","fatal","critical","crit","emerg","emergency"];
function normalizeSeverity(tok){ const t=String(tok||"").toLowerCase(); if(["trace","trc"].includes(t)) return "trace"; if(["debug","dbg"].includes(t)) return "debug"; if(["info","information","notice"].includes(t)) return "info"; if(["warn","warning","alert"].includes(t)) return "warn"; if(["error","err"].includes(t)) return "error"; if(["fatal","critical","crit","emerg","emergency"].includes(t)) return "fatal"; return null; }
const RX_BRACKET=/^\s*[\[\(<\{]\s*([A-Za-z]+)\s*[\]\)>\}][\s:;\-]*/; const RX_PREFIX=/^\s*([A-Za-z]+)[\s:;\-]/;
function parseSeverityFromLine(line){ if(!line) return null; let m=RX_BRACKET.exec(line); if(m){ const v=normalizeSeverity(m[1]); if(v) return v; } m=RX_PREFIX.exec(line); if(m){ const v=normalizeSeverity(m[1]); if(v) return v; } const first=String(line).slice(0,24).toLowerCase(); for(const tok of SEVERITY_TOKENS){ if(first.includes(tok)){ const v=normalizeSeverity(tok); if(v) return v; } } return null; }
function getLineContent(any){ return (any && typeof any==='object' && 'content' in any) ? String(any.content??"") : String(any??""); }
function getDerivedLevel(any){ if(any && typeof any==='object' && any.derived && typeof any.derived==='object'){ const v=any.derived.loglevel; if(v) return String(v); } return null; }
function isSleepDirective(s){ return /^\s*\[\[\[\s*SLEEP\s+(\d+)\s*\]\]\]\s*$/i.test(s||""); }
function sleepMsFromDirective(s){ const m=/^\s*\[\[\[\s*SLEEP\s+(\d+)\s*\]\]\]\s*$/i.exec(s||""); return m ? parseInt(m[1],10) : 0; }
function makeScheduler(delayMs,batchSize,baseTime){ const step=Math.max(0,Math.floor((Number(delayMs)||0)/Math.max(1,Number(batchSize)||1))); let t=baseTime||Date.now(); return ()=>{ const cur=t; t+=step; return cur; }; }

self.onmessage = async (event)=>{
  const { type } = event.data || {};
  if(type==="SET_LOOP"){ loopActive=!!event.data.value; self.postMessage({type:"INFO", message:`loop=${loopActive}`}); return; }
  if(type==="STOP"){ cancelled=true; abortInFlight(); return; }
  if(type!=="START_INGEST"){ self.postMessage({type:"INFO", message:"Unknown command"}); return; }

  cancelled=false;
  const { config, lines, workerInfo } = event.data;
  const endpoint = normalizeEndpoint(config.endpoint);
  const token    = config.token;
  const mode     = (config.mode||"sequential").toLowerCase();
  const delayMs  = Number(config.delayMs||0);
  const batchSize= Number(config.batchSize||1);
  const userAttrs= config.attributes || {};
  const rps      = Number(config.rateLimitPerSecond||90);
  loopActive     = !!config.loop;
  const historicStartMs = Number(config.historicStartMs || 0) || null;
  const scattered = (config.scattered && typeof config.scattered === 'object') ? config.scattered : null;
  const limiter  = new RateLimiter(rps);
  const sourceId = (Math.random().toString(16).slice(2) + Date.now().toString(16));
  let seq=0, cycle=0;
  const finish = (kind,msg)=>{ try{limiter.stop();}catch{}; if(kind==='cancel') self.postMessage({type:"CANCELLED", message:msg||"Stopped"}); else if(kind==='done') self.postMessage({type:"DONE", message:msg||"Finished"}); else if(kind==='error') self.postMessage({type:"ERROR", error:msg||"Error"}); };
  const total = Array.isArray(lines) ? lines.length : 0;
  const userHasSev = hasUserSeverityAttr(userAttrs);
  const sendRec = async (rec)=>{ await limiter.take(1); const ctrl=newAbortController(); const r=await sendWithRetry(endpoint, token, [rec], 0, ctrl?.signal); currentController=null; if(cancelled) return {ok:false,cancelled:true}; if(!r.ok) return {ok:false,status:r.status,text:r.text||""}; return {ok:true}; };

  const runSequentialOnce = async ()=>{
    for(let i=0;i<total;i+=batchSize){
      if(cancelled) return false;
      const chunk = lines.slice(i, i+batchSize);
      for(const item of chunk){
        if(cancelled) return false;
        const s=getLineContent(item);
        if(isSleepDirective(s)){ const ms=sleepMsFromDirective(s); if(ms>0) await sleep(ms); continue; }
        const derivedLvl=getDerivedLevel(item);
        const rec = { content:s, timestamp:Date.now(), ...userAttrs, source_id:sourceId, seq_no:seq++, worker:(workerInfo&&workerInfo.name)||"logstreamity" };
        if(!userHasSev){ const lvl=derivedLvl||parseSeverityFromLine(s); if(lvl) rec.loglevel=lvl; }
        const rs=await sendRec(rec); if(!rs.ok){ if(rs.cancelled) return false; self.postMessage({type:"ERROR", error:`HTTP ${rs.status}: ${rs.text}`}); return false; }
      }
      if(delayMs>0){ await sleep(delayMs); if(cancelled) return false; }
      const sent = Math.min(i + chunk.length, total);
      self.postMessage({ type:"PROGRESS", progress: Math.round((sent/total)*100) });
    }
    return true;
  };

  const runScheduledOnce = async ()=>{
    if (mode === 'historic' && historicStartMs) {
      const nextTs = makeScheduler(delayMs, batchSize, historicStartMs);
      for (let i = 0; i < total; i++) {
        if (cancelled) return false;
        const item = lines[i];
        const s = getLineContent(item); if (!s) continue;
        const ts = nextTs();
        const derivedLvl = getDerivedLevel(item);
        const rec = { content:s, timestamp:ts, ...userAttrs, source_id:sourceId, seq_no:seq++, worker:(workerInfo&&workerInfo.name)||"logstreamity" };
        if (!userHasSev){ const lvl = derivedLvl || parseSeverityFromLine(s); if (lvl) rec.loglevel = lvl; }
        const rs = await sendRec(rec); if (!rs.ok){ if (rs.cancelled) return false; self.postMessage({type:"ERROR", error:`HTTP ${rs.status}: ${rs.text}`}); return false; }
        if ((seq % 50)===0) self.postMessage({ type:"PROGRESS", progress: Math.round((seq/total)*100) });
      }
      return true;
    }

    if (mode === 'scattered' && scattered && scattered.startMs && scattered.endMs) {
      const start = Number(scattered.startMs);
      const end   = Number(scattered.endMs);
      const duration = Math.max(0, end - start);
      const n = total || 1;
      const chunks = Math.max(1, Number(scattered.chunks || 1));
      const chunkSize = Math.ceil(n / chunks);

      for (let i = 0; i < n; i++) {
        if (cancelled) return false;
        const item = lines[i];
        const s = getLineContent(item); if (!s) continue;

        let ts = start + Math.floor(duration * (i / Math.max(1, n - 1)));
        if (chunks > 1) {
          const chunkIndex = Math.floor(i / chunkSize);
          const chunkStart = start + Math.floor(duration * (chunkIndex / chunks));
          const chunkEnd   = start + Math.floor(duration * ((chunkIndex + 1) / chunks));
          const posInChunk = i - (chunkIndex * chunkSize);
          const denom = Math.max(1, chunkSize - 1);
          ts = chunkStart + Math.floor((chunkEnd - chunkStart) * (posInChunk / denom));
          if (config.randomize) {
            const jitter = Math.floor((chunkEnd - chunkStart) * 0.05);
            ts += Math.floor(Math.random() * (2 * jitter + 1)) - jitter;
          }
        }

        const derivedLvl = getDerivedLevel(item);
        const rec = { content:s, timestamp:ts, ...userAttrs, source_id:sourceId, seq_no:seq++, worker:(workerInfo&&workerInfo.name)||"logstreamity" };
        if (!userHasSev){ const lvl = derivedLvl || parseSeverityFromLine(s); if (lvl) rec.loglevel = lvl; }
        const rs = await sendRec(rec); if (!rs.ok){ if (rs.cancelled) return false; self.postMessage({type:"ERROR", error:`HTTP ${rs.status}: ${rs.text}`}); return false; }
        if ((seq % 50)===0) self.postMessage({ type:"PROGRESS", progress: Math.round((seq/total)*100) });
        if ((seq % 500)===0) await sleep(1);
      }
      return true;
    }

    const base = Date.now();
    const nextTs = makeScheduler(delayMs, batchSize, base);
    for (let i = 0; i < total; i++) {
      if (cancelled) return false;
      const item = lines[i];
      const s = getLineContent(item); if (!s) continue;
      const ts = nextTs();
      const derivedLvl = getDerivedLevel(item);
      const rec = { content:s, timestamp:ts, ...userAttrs, source_id:sourceId, seq_no:seq++, worker:(workerInfo&&workerInfo.name)||"logstreamity" };
      if (!userHasSev){ const lvl = derivedLvl || parseSeverityFromLine(s); if (lvl) rec.loglevel = lvl; }
      const rs = await sendRec(rec); if (!rs.ok){ if (rs.cancelled) return false; self.postMessage({type:"ERROR", error:`HTTP ${rs.status}: ${rs.text}`}); return false; }
      if ((seq % 50)===0) self.postMessage({ type:"PROGRESS", progress: Math.round((seq/total)*100) });
      if ((seq % 500)===0) await sleep(1);
    }
    return true;
  };

  try{
    if(mode==="sequential"){
      do{ self.postMessage({type:"PROGRESS", progress:0}); const ok=await runSequentialOnce(); if(!ok || cancelled) break; cycle++; if(loopActive) self.postMessage({type:"CYCLE", cycle}); } while(loopActive && !cancelled);
      if(cancelled) return finish('cancel'); return loopActive ? undefined : finish('done');
    } else {
      do{ self.postMessage({type:"PROGRESS", progress:0}); const ok=await runScheduledOnce(); if(!ok || cancelled) break; cycle++; if(loopActive) self.postMessage({type:"CYCLE", cycle}); } while(loopActive && !cancelled);
      if(cancelled) return finish('cancel'); return loopActive ? undefined : finish('done');
    }
  }catch(e){
    if(String(e).includes('cancelled')) return finish('cancel');
    return finish('error', String(e && e.message || e));
  }
};
