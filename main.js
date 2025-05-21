// main.js — Updated for Dynatrace Logs v2 JSON ingest with file type handling and attribute support

let logLines = [];
let ingestInterval = null;
let currentLineIndex = 0;
let loopEnabled = false;
let selectedAttributes = new Map(); // Store selected attributes and their values

const endpointInput = document.getElementById('endpoint');
const tokenInput = document.getElementById('token');
const delayInput = document.getElementById('delay');
const fileInput = document.getElementById('logFile');
const fileStatus = document.getElementById('file-status');
const statusLog = document.getElementById('statusLog');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const loopBtn = document.getElementById('loopBtn');
const helpTokenBtn = document.getElementById('help-token');
const connectionStatus = document.getElementById('connection-status');
const attributeSection = document.getElementById('attribute-section');
const attributeSearch = document.getElementById('attribute-search');
const attributeList = document.getElementById('attribute-list');
const injectAttributesBtn = document.getElementById('inject-attributes');
const saveToFileBtn = document.getElementById('save-to-file');

// Load attribute keys
const attributeKeys = [
  "audit.action", "audit.identity", "audit.result", /* ... full list from attribute_keys ... */
];

helpTokenBtn.addEventListener('click', () => {
  alert(`To create a Dynatrace API token:\n\n1. Log into your Dynatrace tenant\n2. Go to Access Tokens\n3. Click 'Generate new token'\n4. Add scope: logs.ingest\n5. Copy the token and paste it here`);
});

function processEndpointUrl(url) {
  // Remove trailing slash if present
  url = url.trim().replace(/\/$/, '');
  
  // Remove .apps. from the domain if present
  url = url.replace('.apps.', '.');
  
  // Check if the URL already ends with the API path
  if (!url.endsWith('/api/v2/logs/ingest')) {
    // Remove any path that might exist after the domain
    url = url.split('/').slice(0, 3).join('/');
    // Append the correct API path
    url = `${url}/api/v2/logs/ingest`;
  }
  
  return url;
}

// Add blur event listener to process URL when focus leaves the input
endpointInput.addEventListener('blur', () => {
  const processedUrl = processEndpointUrl(endpointInput.value);
  endpointInput.value = processedUrl.split('/api/v2/logs/ingest')[0];
});

function addAttribute(key, value) {
  selectedAttributes.set(key, value);
  updateAttributeList();
}

function removeAttribute(key) {
  selectedAttributes.delete(key);
  updateAttributeList();
}

function updateAttributeList() {
  attributeList.innerHTML = '';
  selectedAttributes.forEach((value, key) => {
    const item = document.createElement('div');
    item.className = 'flex items-center space-x-2 mb-2';
    item.innerHTML = `
      <input type="text" value="${key}" readonly class="bg-gray-100 rounded px-2 py-1 flex-1" />
      <input type="text" value="${value}" 
        onchange="selectedAttributes.set('${key}', this.value)"
        class="rounded border px-2 py-1 flex-1" />
      <button onclick="removeAttribute('${key}')" 
        class="bg-red-100 text-red-600 px-2 py-1 rounded hover:bg-red-200">
        -
      </button>
    `;
    attributeList.appendChild(item);
  });
}

function fuzzySearch(query, keys) {
  return keys.filter(key => 
    key.toLowerCase().includes(query.toLowerCase())
  );
}

attributeSearch.addEventListener('input', (e) => {
  const results = fuzzySearch(e.target.value, attributeKeys);
  const dropdown = document.getElementById('attribute-dropdown');
  dropdown.innerHTML = '';
  results.slice(0, 5).forEach(key => {
    const option = document.createElement('div');
    option.className = 'p-2 hover:bg-gray-100 cursor-pointer';
    option.textContent = key;
    option.onclick = () => {
      addAttribute(key, '');
      dropdown.innerHTML = '';
      attributeSearch.value = '';
    };
    dropdown.appendChild(option);
  });
  dropdown.style.display = results.length ? 'block' : 'none';
});

saveToFileBtn.addEventListener('click', () => {
  const template = {
    content: "Sample log content",
    timestamp: new Date().toISOString(),
    severity: "INFO",
    "log.source": "logstreamity"
  };
  
  selectedAttributes.forEach((value, key) => {
    template[key] = value;
  });
  
  const blob = new Blob([JSON.stringify([template], null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'log_template.json';
  a.click();
  URL.revokeObjectURL(url);
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
      body: JSON.stringify(buildPayload('Connection test'))
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

function buildPayload(line) {
  let payload;
  try {
    payload = JSON.parse(line);
  } catch {
    payload = {
      content: line,
      "log.source": "logstreamity",
      timestamp: Date.now(),
      severity: "INFO"
    };
  }

  // Add selected attributes
  selectedAttributes.forEach((value, key) => {
    payload[key] = value;
  });

  return payload;
}

startBtn.addEventListener('click', async () => {
  const endpoint = endpointInput.value.trim();
  const token = tokenInput.value.trim();
  const delay = parseInt(delayInput.value.trim(), 10);

  if (!endpoint || !token || !delay || logLines.length === 0) {
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

  ingestInterval = setInterval(() => {
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

    const line = logLines[currentLineIndex++];
    const payload = buildPayload(line);

    fetch(processedEndpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
      .then(response => {
        if (response.ok) {
          logStatus(`✓ Sent: ${line}`);
        } else {
          logStatus(`⚠ Error (${response.status}): ${line}`);
        }
      })
      .catch(err => {
        logStatus(`⚠ Network error: ${err.message}`);
      });
  }, delay);
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

function logStatus(msg) {
  const now = new Date().toLocaleTimeString();
  statusLog.textContent += `[${now}] ${msg}\n`;
  statusLog.scrollTop = statusLog.scrollHeight;
}