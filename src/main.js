// src/main.js

async function startWorkersPool(logLines, endpoint, token, uiOptions, workerManager){
  // Build workers list: if workerManager has entries use them, else default one
  const workers = workerManager && workerManager.getWorkers && workerManager.getWorkers().length
    ? workerManager.getWorkers()
    : [{ id: 0, name: 'logstreamity', mode: uiOptions.mode, delayMs: uiOptions.delay, batchSize: uiOptions.volume, randomize: uiOptions.randomize, attributes: uiOptions.attributes }];

  let running = 0, errors = 0;
  const dot = document.getElementById('status-dot');
  function setBusy(){ if(dot){ dot.classList.remove('status-ready','status-error'); dot.classList.add('status-busy'); } }
  function setReady(){ if(dot){ dot.classList.remove('status-busy','status-error'); dot.classList.add('status-ready'); } }
  function setError(){ if(dot){ dot.classList.remove('status-busy','status-ready'); dot.classList.add('status-error'); } }

  setBusy();
  const startOne = async (wCfg) => {
    return new Promise((resolve) => {
      const w = new Worker('src/webhook-worker.js');
      w.onmessage = (ev) => {
        const d = ev.data;
        if (d.type === 'PROGRESS') {
          logStatus(`↗ ${wCfg.name}: ${d.progress}%`);
        } else if (d.type === 'DONE') {
          logStatus(`✓ ${wCfg.name}: done`);
          w.terminate();
          running--;
          if (running === 0) { if(errors) setError(); else setReady(); }
          resolve(true);
        } else if (d.type === 'ERROR') {
          logStatus(`⚠ ${wCfg.name}: ${d.error}`);
          w.terminate();
          errors++; running--;
          if (running === 0) setError();
          resolve(false);
        }
      };
      const options = {
        endpoint, token,
        mode: wCfg.mode || uiOptions.mode,
        delayMs: Number(wCfg.delayMs ?? uiOptions.delay),
        batchSize: Number(wCfg.batchSize ?? uiOptions.volume),
        randomize: !!(wCfg.randomize ?? uiOptions.randomize),
        attributes: wCfg.attributes || uiOptions.attributes,
        rateLimitPerSecond: 90
      };
      running++;
      w.postMessage({ type: 'START_INGEST', config: options, lines: logLines, workerInfo: { id: wCfg.id, name: wCfg.name || 'logstreamity' } });
    });
  };

  for (const w of workers) await startOne(w);
  return errors === 0;
}


async function tryLoadJSON(path){
  try{
    const res = await fetch(path + '?_=' + Date.now(), {cache:'no-store'});
    if(!res.ok) return null;
    return await res.json();
  }catch{ return null; }
}

function setStatus(state){
  const dot = document.getElementById('status-dot');
  if(!dot) return;
  dot.classList.remove('status-ready','status-busy','status-error');
  if(state==='ready') dot.classList.add('status-ready');
  else if(state==='busy') dot.classList.add('status-busy');
  else if(state==='error') dot.classList.add('status-error');
}


import { updateLabels, updateAttributeList, showAttributeDropdown } from './ui.js';
import { loadAttributes, saveAttributes, loadAttributesFromFile } from './attributes.js';
import { processEndpointUrl, sendLogBatch } from './ingest.js';
import { WorkerManager } from './worker.js';

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
const helpTokenBtn = document.getElementById('help-token');

let logLines = [];
let ingestInterval = null;
let currentLineIndex = 0;
let loopEnabled = false;
let randomizeEnabled = false;
let selectedAttributes = loadAttributes();
let attributeKeys = [];
let activeWorkerId = null;

fetch('./attributes.json')
  .then(res => res.json())
  .then(data => { if (Array.isArray(data)) attributeKeys = data; })
  .catch(err => console.warn("Could not load attributes.json", err));

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

const logStatus = (msg) => {
  const now = new Date().toLocaleTimeString();
  statusLog.textContent += `[${now}] ${msg}\n`;
  statusLog.scrollTop = statusLog.scrollHeight;
};

const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

attributeSearch?.addEventListener('input', (e) => {
  const dropdown = document.getElementById('attribute-dropdown');
  const value = e.target.value.toLowerCase();
  const results = attributeKeys.filter(key => key.toLowerCase().includes(value)).slice(0, 8);
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
      } catch {
        alert('Invalid config file');
      }
    };
    reader.readAsText(file);
  }
});

helpTokenBtn?.addEventListener('click', () => {
  alert(`To create a Dynatrace API token:\n\n1. Log into your Dynatrace tenant\n2. Go to Access Tokens\n3. Click "Generate new token"\n4. Add scope: logs.ingest\n5. Copy the token and paste it here`);
});

fileInput?.addEventListener('change', function () {
  const file = fileInput.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      logLines = e.target.result.split(/\r?\n/).filter(line => line.trim() !== '');
      fileStatus.textContent = `${logLines.length} log lines loaded.`;
    };
    reader.readAsText(file);
  }
});

startBtn?.addEventListener('click', async () => {
  const endpoint = processEndpointUrl(endpointInput.value.trim());
  const token = tokenInput.value.trim();
  const baseDelay = parseInt(delayInput.value.trim(), 10) || 1000;
  const baseVolume = parseInt(lineVolumeInput.value.trim(), 10) || 1;
  
  if (!endpoint || !token || logLines.length === 0) {
    alert('Please fill all fields and upload a log file.');
    return;
  }

  const modeBtn = document.querySelector('.btn-secondary.active') || document.getElementById('mode-sequential');
  const mode = modeBtn?.id?.replace('mode-', '') || 'sequential';
  
  // Add initial log message
  logStatus('Logstreamity worker start.');

  const options = {
    rateLimitPerSecond: 90,
    mode,
    delay: baseDelay,
    lineVolume: baseVolume,
    currentLineIndex,
    logLines,
    historicTimestamp: document.getElementById('historic-timestamp')?.value,
    scatteredStart: document.getElementById('scattered-start')?.value,
    scatteredEnd: document.getElementById('scattered-end')?.value,
    scatteredChunks: parseInt(document.getElementById('scattered-chunks')?.value, 10)
  };

  if (mode === 'scattered' && !randomizeEnabled) {
    randomizeEnabled = true;
    randomizeBtn.classList.add('bg-green-100');
    updateLabels(true);
    logStatus('🎲 Randomization auto-enabled for Scattered mode');
  }

  startBtn.disabled = true;
  stopBtn.disabled = false;
  loopBtn.disabled = false;
  currentLineIndex = 0;

  
if (true) { // use worker pool for all modes
    const ok = await startWorkersPool(logLines, endpoint, token, { mode, delay: baseDelay, volume: baseVolume, randomize: randomizeEnabled, attributes: Object.fromEntries(selectedAttributes) }, workerManager);
    startBtn.disabled = false; stopBtn.disabled = true; loopBtn.disabled = true; return;
  } else {
    // For historic and scattered modes, process all at once
    // Timestamp scheduling: use baseDelay per event to simulate gaps in time
    options.timestampStrategy = 'scheduled';
    options.timestampStepMs = baseDelay;
    try {
      const result = await sendLogBatch(endpoint, token, logLines, selectedAttributes, options);
      logStatus(result?.success ? 
        `✓ Processed all ${logLines.length} lines with ${mode} mode` : 
        `⚠ Error processing logs in ${mode} mode${result?.status ? ` (HTTP ${result.status})` : ''}${result?.errorText ? `: ${result.errorText}` : ''}`
      );
      startBtn.disabled = false;
      stopBtn.disabled = true;
      loopBtn.disabled = true;
    } catch (error) {
      logStatus(`⚠ Error: ${error.message}`);
      startBtn.disabled = false;
      stopBtn.disabled = true;
      loopBtn.disabled = true;
    }
  }
});

stopBtn?.addEventListener('click', () => {
  clearInterval(ingestInterval);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  loopBtn.disabled = true;
  loopEnabled = false;
  logStatus('⏹ Ingestion stopped by user.');
});

loopBtn?.addEventListener('click', () => {
  loopEnabled = !loopEnabled;
  loopBtn.classList.toggle('bg-green-100', loopEnabled);
  logStatus(loopEnabled ? '↻ Loop mode enabled' : '↻ Loop mode disabled');
});

randomizeBtn?.addEventListener('click', () => {
  randomizeEnabled = !randomizeEnabled;
  randomizeBtn.classList.toggle('bg-green-100', randomizeEnabled);
  updateLabels(randomizeEnabled);
  logStatus(randomizeEnabled ? '🎲 Randomization enabled' : '🎲 Randomization disabled');
});

['mode-sequential', 'mode-historic', 'mode-scattered'].forEach(id => {
  document.getElementById(id)?.addEventListener('click', () => {
    document.querySelectorAll('#mode-descriptions > div').forEach(div => div.classList.add('hidden'));
    document.querySelector(`#${id.replace('mode-', '')}-desc`)?.classList.remove('hidden');
    document.querySelectorAll('.btn-secondary[id^="mode-"]').forEach(btn => btn.classList.remove('active'));
    document.getElementById(id)?.classList.add('active');

    if (id === 'mode-historic') {
      const input = document.getElementById('historic-timestamp');
      const now = new Date();
      now.setSeconds(0);
      now.setMilliseconds(0);
      input.value = now.toISOString().slice(0, 16);
    }

    if (id === 'mode-scattered') {
      const start = document.getElementById('scattered-start');
      const end = document.getElementById('scattered-end');
      const now = new Date();
      const later = new Date(now.getTime() + 3600000);
      start.value = now.toISOString().slice(0, 16);
      end.value = later.toISOString().slice(0, 16);

      if (!randomizeEnabled) {
        randomizeEnabled = true;
        randomizeBtn.classList.add('bg-green-100');
        updateLabels(true);
        logStatus('🎲 Randomization auto-enabled for Scattered mode');
      }
    }
  });
});

const stepIds = ['step-settings', 'step-upload', 'step-replay-config', 'step-replay'];
stepIds.forEach((id, idx) => {
  const step = document.getElementById(id);
  const nextBtn = step?.querySelector('.next-step');
  const toggleSpan = step?.querySelector('.toggle-section span');
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      step.querySelector('.section-content').classList.add('hidden');
      toggleSpan.textContent = '►';
      const nextStep = document.getElementById(stepIds[idx + 1]);
      if (nextStep) {
        nextStep.querySelector('.section-content').classList.remove('hidden');
        nextStep.querySelector('.toggle-section span').textContent = '▼';
      }
    });
  }
});

document.querySelectorAll('.toggle-section').forEach(toggleBtn => {
  toggleBtn.addEventListener('click', () => {
    const section = toggleBtn.closest('section');
    const content = section.querySelector('.section-content');
    const icon = toggleBtn.querySelector('span');
    const isHidden = content.classList.contains('hidden');
    content.classList.toggle('hidden');
    icon.textContent = isHidden ? '▼' : '►';
  });
});

const workerManager = new WorkerManager();
const workersList = document.getElementById('workersList');
workerManager.onUpdate = () => {
  workersList.innerHTML = '';
  for (const w of workerManager.getWorkers()) {
    const row = document.createElement('div');
    row.className = `worker-row flex items-center justify-between my-2 p-2 rounded cursor-pointer ${
      w.id === activeWorkerId ? 'bg-dynatrace-primary text-white' : 'hover:bg-gray-100'
    }`;
    row.innerHTML = `
      <span>${w.name}</span>
      <div class="flex items-center space-x-2">
        <button class="rename-btn text-sm ${w.id === activeWorkerId ? 'text-white' : 'text-blue-600'}">✎</button>
        <button class="kill-btn text-sm ${w.id === activeWorkerId ? 'text-white' : 'text-red-600'}">✖</button>
      </div>
    `;

    row.addEventListener('click', () => {
      activeWorkerId = w.id;
      workerManager.onUpdate();
      logStatus(`🔀 Switched to worker: ${w.name}`);
    });

    row.querySelector('.rename-btn').onclick = (e) => {
      e.stopPropagation();
      const newName = prompt('Rename worker:', w.name);
      if (newName) workerManager.renameWorker(w.id, newName);
    };

    row.querySelector('.kill-btn').onclick = (e) => {
      e.stopPropagation();
      if (confirm(`Kill worker "${w.name}"?`)) {
        if (w.id === activeWorkerId) activeWorkerId = null;
        workerManager.killWorker(w.id);
      }
    };

    workersList.appendChild(row);
  }
};

document.getElementById('addWorker')?.addEventListener('click', () => {
  const name = prompt("New Worker Name:");
  const newWorker = workerManager.addWorker(name || undefined);
  activeWorkerId = newWorker.id;
  workerManager.onUpdate();
});

// === Auto-load config.json & DemoLibrary manifest ===
document.addEventListener('DOMContentLoaded', async () => {
  // DemoLibrary dropdown
  const demoSel = document.getElementById('demoLibrarySelect');
  const demoInfo = document.getElementById('demoLibraryInfo');
  const fileInput = document.getElementById('logFile');
  if (demoSel){
    const manifest = await tryLoadJSON('DemoLibrary/manifest.json');
    demoSel.innerHTML = '';
    if (manifest && Array.isArray(manifest.files) && manifest.files.length){
      const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent='— choose demo file —';
      demoSel.appendChild(opt0);
      manifest.files.forEach(f => {
        const opt = document.createElement('option');
        opt.value = f.path; opt.textContent = f.name;
        demoSel.appendChild(opt);
      });
      demoSel.onchange = async () => {
        const v = demoSel.value;
        if (v){
          // disable upload and load file content
          fileInput.disabled = true;
          try{
            const res = await fetch(v + '?_=' + Date.now()); const txt = await res.text();
            window.__LOGSTREAMITY_DEMO__ = { path: v, content: txt };
            demoInfo.textContent = `${v} loaded (${txt.split(/\r?\n/).filter(Boolean).length} lines)`;
          }catch(e){
            demoInfo.textContent = 'Failed to load demo file';
          }
        }else{
          fileInput.disabled = false;
          window.__LOGSTREAMITY_DEMO__ = null;
          demoInfo.textContent = '';
        }
      };
    } else {
      const opt0 = document.createElement('option'); opt0.value=''; opt0.textContent='(no demo files found)';
      demoSel.appendChild(opt0);
    }
  }

  // config.json auto-load
  const conf = await tryLoadJSON('config.json');
  if (conf){
    // endpoint & token
    const endpointInput = document.getElementById('endpoint');
    const tokenInput = document.getElementById('token');
    if (conf.endpoint) endpointInput.value = conf.endpoint;
    if (conf.token) tokenInput.value = conf.token;
    // dark mode
    const theme = (conf.global && conf.global.darkMode) || 'auto';
    if (theme === 'dark') document.documentElement.setAttribute('data-theme','dark');
    else if (theme === 'light') document.documentElement.setAttribute('data-theme','light');
    else document.documentElement.removeAttribute('data-theme');
    // workers preset (we use only first as default visible worker)
    if (Array.isArray(conf.workers) && conf.workers.length){
      const w = conf.workers[0];
      // Populate UI fields
      document.getElementById('delay').value = w.delayMs ?? 1000;
      document.getElementById('lineVolume').value = w.batchSize ?? 1;
      const modeId = `mode-${w.mode||'sequential'}`;
      const mb = document.getElementById(modeId); if (mb) mb.click();
      // attributes
      if (w.attributes){
        try {
          localStorage.setItem('logstreamityAttrs', JSON.stringify(w.attributes));
        } catch{}
      }
      // pre-load demo file if provided
      if (w.file){
        const demoSel = document.getElementById('demoLibrarySelect');
        if (demoSel){
          const opt = Array.from(demoSel.options).find(o => o.value === w.file);
          if (opt){ demoSel.value = w.file; demoSel.dispatchEvent(new Event('change')); }
        }
      }
    }
    // remote control auto-enable?
    const rct = document.getElementById('remoteControlToggle_removed');
    if (conf.global && conf.global.remoteControl === true && rct){ rct.checked = true; }
  }
});


// (remote control removed)