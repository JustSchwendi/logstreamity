// Main application module
import { saveConfig, loadConfig, autoLoadConfig } from './config.js';
import { loadAttributes, saveAttributes, loadAttributesFromFile } from './attributes.js';
import { updateLabels, updateAttributeList } from './ui.js';
import { processEndpointUrl, sendLogBatch } from './ingest.js';

let logLines = [];
let ingestInterval = null;
let currentLineIndex = 0;
let loopEnabled = false;
let selectedAttributes = new Map();
let randomizeEnabled = false;
let attributeKeys = [];

// DOM Elements
const endpointInput = document.getElementById('endpoint');
const tokenInput = document.getElementById('token');
const delayInput = document.getElementById('delay');
const lineVolumeInput = document.getElementById('lineVolume');
const fileInput = document.getElementById('logFile');
const fileStatus = document.getElementById('file-status');
const statusLog = document.getElementById('statusLog');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const loopBtn = document.getElementById('loopBtn');
const randomizeBtn = document.getElementById('randomizeBtn');
const helpTokenBtn = document.getElementById('help-token');
const connectionStatus = document.getElementById('connection-status');
const attributeSection = document.getElementById('attribute-section');
const attributeSearch = document.getElementById('attribute-search');
const attributeList = document.getElementById('attribute-list');
const injectAttributesBtn = document.getElementById('inject-attributes');
const saveToFileBtn = document.getElementById('save-to-file');
const readFromFileBtn = document.getElementById('read-from-file');
const saveConfigBtn = document.getElementById('save-config');
const loadConfigBtn = document.getElementById('load-config');
const configFileInput = document.getElementById('config-file');
const attributesFileInput = document.getElementById('attributes-file');

// Initialize
async function init() {
  attributeKeys = await loadAttributes();
  const config = await autoLoadConfig();
  if (config) {
    endpointInput.value = config.endpoint;
    tokenInput.value = config.token;
  }
}

init();

// Event Listeners
helpTokenBtn.addEventListener('click', () => {
  alert(`To create a Dynatrace API token:\n\n1. Log into your Dynatrace tenant\n2. Go to Access Tokens\n3. Click 'Generate new token'\n4. Add scope: logs.ingest\n5. Copy the token and paste it here`);
});

injectAttributesBtn.addEventListener('click', () => {
  attributeSection.classList.toggle('hidden');
});

saveConfigBtn.addEventListener('click', () => {
  saveConfig(endpointInput.value, tokenInput.value);
});

loadConfigBtn.addEventListener('click', () => {
  configFileInput.click();
});

configFileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file) {
    const config = await loadConfig(file);
    if (config) {
      endpointInput.value = config.endpoint;
      tokenInput.value = config.token;
    }
  }
});

readFromFileBtn.addEventListener('click', () => {
  attributesFileInput.click();
});

attributesFileInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (file) {
    const attributes = await loadAttributesFromFile(file);
    selectedAttributes.clear();
    Object.entries(attributes).forEach(([key, value]) => {
      selectedAttributes.set(key, value);
    });
    updateAttributeList(attributeList, selectedAttributes);
  }
});

saveToFileBtn.addEventListener('click', () => {
  saveAttributes(selectedAttributes);
});

endpointInput.addEventListener('blur', () => {
  endpointInput.value = processEndpointUrl(endpointInput.value).split('/api/v2/logs/ingest')[0];
});

randomizeBtn.addEventListener('click', () => {
  randomizeEnabled = !randomizeEnabled;
  randomizeBtn.classList.toggle('bg-green-100');
  updateLabels(randomizeEnabled);
  logStatus(randomizeEnabled ? '🎲 Randomization enabled' : '🎲 Randomization disabled');
});

// Make functions available to window for HTML event handlers
window.updateAttributeValue = (key, value) => {
  selectedAttributes.set(key, value);
};

window.removeAttribute = (key) => {
  selectedAttributes.delete(key);
  updateAttributeList(attributeList, selectedAttributes);
};

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

attributeSearch.addEventListener('input', (e) => {
  const results = attributeKeys.filter(key => 
    key.toLowerCase().includes(e.target.value.toLowerCase())
  );
  const dropdown = document.getElementById('attribute-dropdown');
  dropdown.innerHTML = '';
  results.slice(0, 5).forEach(key => {
    const option = document.createElement('div');
    option.className = 'p-2 hover:bg-gray-100 cursor-pointer';
    option.textContent = key;
    option.onclick = () => {
      selectedAttributes.set(key, '');
      updateAttributeList(attributeList, selectedAttributes);
      dropdown.innerHTML = '';
      attributeSearch.value = '';
    };
    dropdown.appendChild(option);
  });
  dropdown.style.display = results.length ? 'block' : 'none';
});

function processXMLContent(content) {
  try {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(content, "text/xml");
    const serializer = new XMLSerializer();
    return Array.from(xmlDoc.documentElement.children).map(node => 
      serializer.serializeToString(node)
    );
  } catch (error) {
    logStatus(`⚠ XML parsing error: ${error.message}`);
    return content.split(/\r?\n/).filter(line => line.trim().length > 0);
  }
}

function processJSONContent(content) {
  try {
    const jsonData = JSON.parse(content);
    if (Array.isArray(jsonData)) {
      return jsonData.map(item => JSON.stringify(item));
    } else {
      return [JSON.stringify(jsonData)];
    }
  } catch (error) {
    logStatus(`⚠ JSON parsing error: ${error.message}`);
    return content.split(/\r?\n/).filter(line => line.trim().length > 0);
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) {
    fileStatus.textContent = 'No file selected.';
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    const content = e.target.result;
    
    if (file.name.endsWith('.xml')) {
      logLines = processXMLContent(content);
    } else if (file.name.endsWith('.json')) {
      logLines = processJSONContent(content);
    } else {
      logLines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    }
    
    fileStatus.textContent = `${logLines.length} log lines ready for ingestion`;
    fileStatus.className = 'text-lg font-bold text-dynatrace-primary';
  };
  reader.readAsText(file);
});

async function testConnection(endpoint, token) {
  try {
    const processedEndpoint = processEndpointUrl(endpoint);
    const response = await fetch(processedEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ content: 'Connection test' })
    });

    connectionStatus.className = response.ok 
      ? 'connection-success rounded-md p-4 mb-4' 
      : 'connection-error rounded-md p-4 mb-4';

    connectionStatus.textContent = response.ok
      ? '✓ Connection successful! Ready to ingest logs.'
      : `⚠ Connection failed: ${response.status} ${response.statusText}`;

    connectionStatus.style.display = 'block';
    return response.ok;
  } catch (error) {
    connectionStatus.className = 'connection-error rounded-md p-4 mb-4';
    connectionStatus.textContent = `⚠ Connection error: ${error.message}`;
    connectionStatus.style.display = 'block';
    return false;
  }
}

function logStatus(msg) {
  const now = new Date().toLocaleTimeString();
  statusLog.textContent += `[${now}] ${msg}\n`;
  statusLog.scrollTop = statusLog.scrollHeight;
}

startBtn.addEventListener('click', async () => {
  const endpoint = endpointInput.value.trim();
  const token = tokenInput.value.trim();
  const baseDelay = parseInt(delayInput.value.trim(), 10);
  const baseVolume = parseInt(lineVolumeInput.value.trim(), 10);

  if (!endpoint || !token || !baseDelay || logLines.length === 0) {
    alert('Please fill all fields and upload a log file.');
    return;
  }

  const isConnected = await testConnection(endpoint, token);
  if (!isConnected) {
    return;
  }

  const processedEndpoint = processEndpointUrl(endpoint);
  currentLineIndex = 0;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  loopBtn.disabled = false;
  statusLog.textContent = '';

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
    currentLineIndex += volume;
    
    const success = await sendLogBatch(processedEndpoint, token, batchLines, selectedAttributes);
    if (success) {
      logStatus(`✓ Sent batch of ${batchLines.length} lines`);
    } else {
      logStatus(`⚠ Error sending batch`);
    }
    
    if (randomizeEnabled) {
      logStatus(`ℹ Using random delay: ${delay}ms, volume: ${volume}`);
    }
  }, baseDelay);
});

stopBtn.addEventListener('click', () => {
  clearInterval(ingestInterval);
  startBtn.disabled = false;
  stopBtn.disabled = true;
  loopBtn.disabled = true;
  loopEnabled = false;
  loopBtn.classList.remove('bg-green-100');
  logStatus('⏹ Ingestion stopped by user.');
});

loopBtn.addEventListener('click', () => {
  loopEnabled = !loopEnabled;
  loopBtn.classList.toggle('bg-green-100');
  logStatus(loopEnabled ? '↻ Loop mode enabled' : '↻ Loop mode disabled');
});