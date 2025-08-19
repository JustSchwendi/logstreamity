// src/main.js — cleaned & stable (no UI changes)

// ===== Imports from existing modules =====
import { updateLabels, updateAttributeList } from './ui.js';
import { loadAttributes, saveAttributes, loadAttributesFromFile } from './attributes.js';
import { processEndpointUrl } from './ingest.js';
import { WorkerManager } from './worker.js';

// ===== Globals & DOM refs =====
const endpointInput = document.getElementById('endpoint');
const tokenInput = document.getElementById('token');
const delayInput = document.getElementById('delay');
const lineVolumeInput = document.getElementById('lineVolume');
const fileInput = document.getElementById('logFile');
const fileStatus = document.getElementById('file-status');
const statusLog = document.getElementById('statusLog');
const randomizeBtn = document.getElementById('randomizeBtn');
const attributeList = document.getElementById('attribute-list');
const attributeSearch = document.getElementById('attribute-search');
const injectAttributesBtn = document.getElementById('inject-attributes');
const attributeSection = document.getElementById('attribute-section');
const saveToFileBtn = document.getElementById('save-to-file');
const readFromFileBtn = document.getElementById('read-from-file');
const attributesFileInput = document.getElementById('attributes-file');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const loopBtn = document.getElementById('loopBtn');
const saveConfigBtn = document.getElementById('save-config');
const loadConfigBtn = document.getElementById('load-config');
const configFileInput = document.getElementById('config-file');

// Some pages have a status-dot element; if not, we noop.
const statusDot = document.getElementById('status-dot');

// ===== State =====
let logLines = [];
let PREPARED_LINES = null; // array of {content, derived?}
let currentLineIndex = 0;
let loopEnabled = false;
let randomizeEnabled = false;
let selectedAttributes = loadAttributes();
let attributeKeys = [];
const activeWorkers = new Set();
const workerRowElems = new Map();
const wm = new WorkerManager();

// ===== Helpers =====
const logStatus = (msg) => {
  const now = new Date().toLocaleTimeString();
  if (statusLog) {
    statusLog.textContent += `[${now}] ${msg}\n`;
    statusLog.scrollTop = statusLog.scrollHeight;
  } else {
    console.log(msg);
  }
};

function setDot(state){
  if (!statusDot) return;
  statusDot.classList.remove('status-ready','status-busy','status-error');
  if (state === 'busy') statusDot.classList.add('status-busy');
  else if (state === 'error') statusDot.classList.add('status-error');
  else statusDot.classList.add('status-ready');
}

async function tryLoadJSON(path){
  try{
    const res = await fetch(path + '?_=' + Date.now(), { cache: 'no-store' });
    if (!res.ok) return null;
    return await res.json();
  }catch{ return null; }
}

// Severity parsing (used at load-time preprocessing)
const SEVERITY_TOKENS = [
  "trace","trc","debug","dbg","info","information","notice",
  "warn","warning","alert","error","err","fatal","critical","crit","emerg","emergency"
];
function normLvl(tok){
  const t = String(tok||"").toLowerCase();
  if (["trace","trc"].includes(t)) return "trace";
  if (["debug","dbg"].includes(t)) return "debug";
  if (["info","information","notice"].includes(t)) return "info";
  if (["warn","warning","alert"].includes(t)) return "warn";
  if (["error","err"].includes(t)) return "error";
  if (["fatal","critical","crit","emerg","emergency"].includes(t)) return "fatal";
  return null;
}
const RX_BRACKET = /^\s*[\[\(<\{]\s*([A-Za-z]+)\s*[\]\)>\}][\s:;\-]?/;
const RX_PREFIX  = /^\s*([A-Za-z]+)[\s:;\-]/;
function parseSeverityFromLine(line){
  if (!line) return null;
  let m = RX_BRACKET.exec(line); if (m){ const v = normLvl(m[1]); if (v) return v; }
  m = RX_PREFIX.exec(line); if (m){ const v = normLvl(m[1]); if (v) return v; }
  const first = String(line).slice(0, 24).toLowerCase();
  for (const tok of SEVERITY_TOKENS){ if (first.includes(tok)){ const v = normLvl(tok); if (v) return v; } }
  return null;
}
function prepareLinesFromText(text){
  const arr = String(text||"").split(/\r?\n/);
  const out = [];
  for (const raw of arr){
    if (raw == null) continue;
    const s = String(raw);
    if (!s.trim()) continue;
    const lvl = parseSeverityFromLine(s);
    out.push({ content: s, derived: lvl ? { loglevel: lvl } : {} });
  }
  return out;
}

// ===== Attributes UI wiring =====
fetch('./attributes.json')
  .then(res => res.json())
  .then(data => { if (Array.isArray(data)) attributeKeys = data; })
  .catch(() => {});

updateAttributeList(attributeList, selectedAttributes);
updateLabels(randomizeEnabled);

window.updateAttributeValue = (key, value) => {
  selectedAttributes.set(key, value);
  updateAttributeList(attributeList, selectedAttributes);
  saveAttributes(selectedAttributes);
};
window.removeAttribute = (key) => {
  selectedAttributes.delete(key);
  updateAttributeList(attributeList, selectedAttributes);
  saveAttributes(selectedAttributes);
};

attributeSearch?.addEventListener('input', (e) => {
  const dropdown = document.getElementById('attribute-dropdown');
  const value = e.target.value.toLowerCase();
  const results = attributeKeys.filter(key => key.toLowerCase().includes(value)).slice(0, 8);
  if (!dropdown) return;
  dropdown.innerHTML = '';
  results.forEach(key => {
    const div = document.createElement('div');
    div.className = 'p-2 hover:bg-gray-100 cursor-pointer';
    div.textContent = key;
    div.onclick = () => {
      selectedAttributes.set(key, '');
      updateAttributeList(attributeList, selectedAttributes);
      dropdown.innerHTML = '';
      attributeSearch.value = '';
      saveAttributes(selectedAttributes);
    };
    dropdown.appendChild(div);
  });
  dropdown.style.display = results.length ? 'block' : 'none';
});

injectAttributesBtn?.addEventListener('click', () => attributeSection?.classList.toggle('hidden'));
saveToFileBtn?.addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(Object.fromEntries(selectedAttributes), null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'attributes.json';
  a.click();
});
readFromFileBtn?.addEventListener('click', () => attributesFileInput?.click());
attributesFileInput?.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file) {
    const attrs = await loadAttributesFromFile(file);
    selectedAttributes = attrs;
    updateAttributeList(attributeList, selectedAttributes);
    saveAttributes(selectedAttributes);
  }
});

saveConfigBtn?.addEventListener('click', () => {
  const config = { endpoint: endpointInput.value.trim(), token: tokenInput.value.trim() };
  const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'config.json';
  a.click();
});
loadConfigBtn?.addEventListener('click', () => configFileInput?.click());
configFileInput?.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const config = JSON.parse(e.target.result);
        endpointInput.value = config.endpoint || '';
        tokenInput.value = config.token || '';
        validateReady();
      } catch { alert('Invalid config file'); }
    };
    reader.readAsText(file);
  }
});

// ===== Upload → preprocess to RAM =====
fileInput?.addEventListener('change', function () {
  const file = fileInput.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = String(e.target.result || '');
      PREPARED_LINES = prepareLinesFromText(text);
      logLines = text.split(/\r?\n/).filter(line => line.trim() !== '');
      if (fileStatus) fileStatus.textContent = `${logLines.length} log lines loaded.`;
      validateReady();
    };
    reader.readAsText(file);
  } else {
    PREPARED_LINES = null;
    logLines = [];
    if (fileStatus) fileStatus.textContent = 'No file selected.';
    validateReady();
  }
});

// ===== Mode buttons =====
['mode-sequential', 'mode-historic', 'mode-scattered'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => {
    document.querySelectorAll('#mode-descriptions > div').forEach(div => div.classList.add('hidden'));
    document.querySelector(`#${id.replace('mode-', '')}-desc`)?.classList.remove('hidden');
    document.querySelectorAll('.btn-secondary[id^="mode-"]').forEach(btn => btn.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');

    if (id === 'mode-historic') {
      const input = document.getElementById('historic-timestamp');
      const now = new Date(); now.setSeconds(0); now.setMilliseconds(0);
      if (input) input.value = now.toISOString().slice(0, 16);
    }
    if (id === 'mode-scattered') {
      const start = document.getElementById('scattered-start');
      const end = document.getElementById('scattered-end');
      const now = new Date(); const later = new Date(now.getTime() + 3600000);
      if (start) start.value = now.toISOString().slice(0, 16);
      if (end) end.value = later.toISOString().slice(0, 16);
      if (!randomizeEnabled) {
        randomizeEnabled = true;
        randomizeBtn?.classList.add('bg-green-100');
        updateLabels(true);
        logStatus('🎲 Randomization auto-enabled for Scattered mode');
      }
    }
  });
});

randomizeBtn?.addEventListener('click', () => {
  randomizeEnabled = !randomizeEnabled;
  randomizeBtn.classList.toggle('bg-green-100', randomizeEnabled);
  updateLabels(randomizeEnabled);
  logStatus(randomizeEnabled ? '🎲 Randomization enabled' : '🎲 Randomization disabled');
});

// ===== Worker sidebar wiring (no UI redesign) =====
const workersList = document.getElementById('workersList');
function renderWorkers(){
  if (!workersList) return;
  workersList.innerHTML = '';
  workerRowElems.clear();
  for (const w of wm.getWorkers()) {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between p-2 border rounded';
    row.dataset.workerId = String(w.id);
    const left = document.createElement('div');
    left.className = 'flex items-center gap-2';
    const dotEl = document.createElement('span');
    dotEl.className = 'status-dot status-ready';
    const nameEl = document.createElement('span');
    nameEl.className = 'font-medium';
    nameEl.textContent = w.name;
    left.appendChild(dotEl); left.appendChild(nameEl);
    const metaEl = document.createElement('div');
    metaEl.className = 'text-xs text-gray-500';
    metaEl.textContent = `mode:${w.mode||'sequential'} • delay:${w.delayMs??0}ms • batch:${w.batchSize??1}`;
    row.appendChild(left); row.appendChild(metaEl);
    row.addEventListener('click', () => { wm.select(w.id); enableStartAndClear(w.name); syncFormFromWorker(w); validateReady(); });
    workersList.appendChild(row);
    workerRowElems.set(w.id, { statusEl: dotEl, metaEl, root: row });
  }
}
wm.setOnChange((sel) => { if (sel) syncFormFromWorker(sel); renderWorkers(); validateReady(); });
document.getElementById('addWorker')?.addEventListener('click', () => {
  const name = prompt("New Worker Name:") || undefined;
  const nw = wm.addWorker(name);
  wm.select(nw.id);
  renderWorkers();
});

function syncFormFromWorker(w){
  if (!w) return;
  const map = { sequential: 'mode-sequential', historic: 'mode-historic', scattered: 'mode-scattered' };
  (document.getElementById(map[w.mode] || 'mode-sequential') || {}).click?.();
  if (delayInput) delayInput.value = w.delayMs ?? 1000;
  if (lineVolumeInput) lineVolumeInput.value = w.batchSize ?? 1;
}
['delay','lineVolume'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', () => {
    const w = wm.getSelected(); if (!w) return;
    wm.updateSelected({ delayMs: Number(delayInput.value||0), batchSize: Number(lineVolumeInput.value||1) });
  });
});
document.getElementById('mode-sequential')?.addEventListener('click', () => wm.updateSelected({mode:'sequential'}));
document.getElementById('mode-historic')?.addEventListener('click', () => wm.updateSelected({mode:'historic'}));
document.getElementById('mode-scattered')?.addEventListener('click', () => wm.updateSelected({mode:'scattered'}));

function enableStartAndClear(workerName){
  try { console.clear(); } catch {}
  if (startBtn) startBtn.disabled = false;
  if (workerName) logStatus(`⚙ Ready: ${workerName} selected`);
}

// ===== Demo Library & config.json autoload =====
document.addEventListener('DOMContentLoaded', async () => {
  const demoSel = document.getElementById('demoLibrarySelect');
  const demoInfo = document.getElementById('demoLibraryInfo');
  if (demoSel){
    const manifest = await tryLoadJSON('DemoLibrary/manifest.json');
    demoSel.innerHTML = '';
    if (manifest && Array.isArray(manifest.files) && manifest.files.length){
      const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent='— choose demo file —';
      demoSel.appendChild(opt0);
      manifest.files.forEach(f => { const opt = document.createElement('option'); opt.value = f.path; opt.textContent = f.name; demoSel.appendChild(opt); });
      demoSel.onchange = async () => {
        const v = demoSel.value;
        if (v){
          if (fileInput) fileInput.disabled = true;
          try{
            const res = await fetch(v + '?_=' + Date.now()); const txt = await res.text();
            window.__LOGSTREAMITY_DEMO__ = { path: v, content: txt };
            PREPARED_LINES = prepareLinesFromText(txt);
            logLines = txt.split(/\r?\n/).filter(Boolean);
            const count = logLines.length;
            if (demoInfo) demoInfo.textContent = `${v} loaded (${count} lines)`;
            if (fileStatus) fileStatus.textContent = `${v} selected (${count} lines)`;
            injectAttributesBtn?.removeAttribute('disabled');
          }catch(e){ if (demoInfo) demoInfo.textContent = 'Failed to load demo file'; }
        } else {
          if (fileInput) fileInput.disabled = false;
          window.__LOGSTREAMITY_DEMO__ = null;
          PREPARED_LINES = null;
          if (demoInfo) demoInfo.textContent = '';
          if (fileStatus) fileStatus.textContent = 'No file selected.';
        }
        validateReady();
      };
    } else {
      const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent='(no demo files found)';
      demoSel.appendChild(opt0);
    }
  }

  const conf = await tryLoadJSON('config.json'); // OK if 404
  if (conf){
    if (conf.endpoint) endpointInput.value = conf.endpoint;
    if (conf.token) tokenInput.value = conf.token;
    const theme = (conf.global && conf.global.darkMode) || 'auto';
    if (theme === 'dark') document.documentElement.setAttribute('data-theme','dark');
    else if (theme === 'light') document.documentElement.setAttribute('data-theme','light');
    else document.documentElement.removeAttribute('data-theme');

    if (Array.isArray(conf.workers) && conf.workers.length){
      const w = conf.workers[0];
      if (delayInput) delayInput.value = w.delayMs ?? 1000;
      if (lineVolumeInput) lineVolumeInput.value = w.batchSize ?? 1;
      const modeId = `mode-${w.mode||'sequential'}`; document.getElementById(modeId)?.click();
      if (w.attributes){
        try{ localStorage.setItem('logstreamityAttrs', JSON.stringify(w.attributes)); }catch{}
      }
    }
  }

  renderWorkers();
  validateReady();
});

// ===== Start/Stop/Loop =====
startBtn?.addEventListener('click', async () => {
  try { console.clear(); } catch {}
  const endpoint = processEndpointUrl(endpointInput.value.trim());
  const token = tokenInput.value.trim();
  const baseDelay = parseInt(delayInput.value.trim(), 10) || 1000;
  const baseVolume = parseInt(lineVolumeInput.value.trim(), 10) || 1;
  const hasPrepared = Array.isArray(PREPARED_LINES) && PREPARED_LINES.length > 0;
  if (!endpoint || !token || (!hasPrepared && logLines.length === 0)) {
    alert('Please fill all fields and upload or select a log file.');
    return;
  }
  const modeBtn = document.querySelector('.btn-secondary.active') || document.getElementById('mode-sequential');
  const mode = modeBtn?.id?.replace('mode-', '') || 'sequential';

  logStatus('Logstreamity worker start.');
  setDot('busy');
  startBtn.disabled = true; stopBtn.disabled = false; loopBtn.disabled = false; currentLineIndex = 0;

  const ok = await startWorkersPool(
    (hasPrepared ? PREPARED_LINES : logLines),
    endpoint,
    token,
    { mode, delay: baseDelay, volume: baseVolume, randomize: randomizeEnabled, attributes: Object.fromEntries(selectedAttributes) },
    wm
  );
  startBtn.disabled = false; stopBtn.disabled = true; loopBtn.disabled = true;
  setDot(ok ? 'ready' : 'error');
});

stopBtn?.addEventListener('click', () => {
  const workers = Array.from(activeWorkers);
  if (!workers.length) {
    logStatus('Nothing to stop.');
    startBtn.disabled = false; stopBtn.disabled = true; loopBtn.disabled = true;
    setDot('ready');
    return;
  }
  logStatus('Stopping…');
  for (const w of workers) { try { w.postMessage({ type: 'STOP' }); } catch {} }
  setTimeout(() => {
    for (const w of Array.from(activeWorkers)) { try { w.terminate(); } catch {} activeWorkers.delete(w); }
    logStatus('Stopped.');
    startBtn.disabled = false; stopBtn.disabled = true; loopBtn.disabled = true;
    setDot('ready');
  }, 2000);
});

loopBtn?.addEventListener('click', () => {
  loopEnabled = !loopEnabled;
  loopBtn.classList.toggle('bg-green-100', loopEnabled);
  logStatus(loopEnabled ? '↻ Loop mode enabled' : '↻ Loop mode disabled');
});

// ===== Worker pool =====
async function startWorkersPool(lines, endpoint, token, uiOptions, workerManager){
  const workers = (workerManager && workerManager.getWorkers && workerManager.getWorkers().length)
    ? workerManager.getWorkers()
    : [{ id: 0, name: 'logstreamity', mode: uiOptions.mode, delayMs: uiOptions.delay, batchSize: uiOptions.volume, randomize: uiOptions.randomize, attributes: uiOptions.attributes }];

  let running = 0, errors = 0;

  const startOne = async (wCfg) => new Promise((resolve) => {
    const workerUrl = new URL('./webhook-worker.js', import.meta.url);
    const w = new Worker(workerUrl, { type: 'classic' });
    activeWorkers.add(w);

    w.onmessage = (ev) => {
      const d = ev.data;
      const row = workerRowElems.get(wCfg.id);
      if (d.type === 'PROGRESS') {
        if (row) { row.statusEl.classList.remove('status-ready'); row.statusEl.classList.add('status-busy'); row.metaEl.textContent = `progress ${d.progress}%`; }
        logStatus(`↗ ${wCfg.name}: ${d.progress}%`);
      } else if (d.type === 'CYCLE') {
        logStatus(`↻ loop cycle ${d.cycle}`);
      } else if (d.type === 'DONE' || d.type === 'CANCELLED') {
        if (row) { row.statusEl.classList.remove('status-busy','status-error'); row.statusEl.classList.add('status-ready'); row.metaEl.textContent = 'idle'; }
        logStatus(`✓ ${wCfg.name}: ${d.type === 'DONE' ? 'done' : 'stopped'}`);
        try { w.terminate(); } catch {}
        activeWorkers.delete(w);
        running--;
        if (running === 0) resolve(true);
      } else if (d.type === 'ERROR') {
        if (row) { row.statusEl.classList.remove('status-busy'); row.statusEl.classList.add('status-error'); row.metaEl.textContent = 'error'; }
        logStatus(`⚠ ${wCfg.name}: ${d.error}`);
        try { w.terminate(); } catch {}
        activeWorkers.delete(w);
        errors++; running--;
        if (running === 0) resolve(false);
      }
    };

    const options = {
      endpoint, token,
      mode: wCfg.mode || uiOptions.mode,
      delayMs: Number(wCfg.delayMs ?? uiOptions.delay),
      batchSize: Number(wCfg.batchSize ?? uiOptions.volume),
      randomize: !!(wCfg.randomize ?? uiOptions.randomize),
      attributes: wCfg.attributes || uiOptions.attributes,
      rateLimitPerSecond: 90,
      loop: loopEnabled
    };
    running++;
    w.postMessage({ type: 'START_INGEST', config: options, lines, workerInfo: { id: wCfg.id, name: wCfg.name || 'logstreamity' } });
  });

  for (const w of workers) await startOne(w);
  return errors === 0;
}

// ===== Ready-state =====
function validateReady() {
  const endpoint = document.getElementById('endpoint')?.value?.trim();
  const token = document.getElementById('token')?.value?.trim();
  const hasPrepared = Array.isArray(PREPARED_LINES) && PREPARED_LINES.length > 0;
  const hasLocalFile = fileInput?.files && fileInput.files.length > 0;
  const ok = !!endpoint && !!token && (hasPrepared || hasLocalFile);
  if (startBtn) startBtn.disabled = !ok;
}

// Re-validate on input changes
endpointInput?.addEventListener('input', validateReady);
tokenInput?.addEventListener('input', validateReady);
