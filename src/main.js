// src/main.js

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

  if (mode === 'sequential') {
    // For sequential mode, we use intervals for UI feedback
    ingestInterval = setInterval(async () => {
      if (currentLineIndex >= logLines.length) {
        if (loopEnabled) {
          currentLineIndex = 0;
          logStatus('↻ Restarting log ingestion from beginning');
        } else {
          clearInterval(ingestInterval);
          startBtn.disabled = false;
          stopBtn.disabled = true;
          loopBtn.disabled = true;
          logStatus('✓ Ingestion completed successfully');
          return;
        }
      }

      const delay = randomizeEnabled ? getRandomInt(0, baseDelay) : baseDelay;
      const volume = randomizeEnabled ? getRandomInt(1, baseVolume) : baseVolume;
      const batchLines = logLines.slice(currentLineIndex, currentLineIndex + volume);
      options.currentLineIndex = currentLineIndex;

      const success = await sendLogBatch(endpoint, token, batchLines, selectedAttributes, options);
      currentLineIndex += volume;

      logStatus(success ? `✓ Sent batch of ${batchLines.length} lines` : `⚠ Error sending batch`);
      if (randomizeEnabled) logStatus(`ℹ Delay: ${delay}ms, volume: ${volume}`);
    }, baseDelay);
  } else {
    // For historic and scattered modes, process all at once
    try {
      const success = await sendLogBatch(endpoint, token, logLines, selectedAttributes, options);
      logStatus(success ? 
        `✓ Processed all ${logLines.length} lines with ${mode} mode` : 
        `⚠ Error processing logs in ${mode} mode`
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