// main.js — Enhanced ingest logic and UI wiring

let logLines = [];
let ingestInterval = null;
let currentLineIndex = 0;

const endpointInput = document.getElementById('endpoint');
const tokenInput = document.getElementById('token');
const delayInput = document.getElementById('delay');
const fileInput = document.getElementById('logFile');
const fileStatus = document.getElementById('file-status');
const statusLog = document.getElementById('statusLog');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const helpTokenBtn = document.getElementById('help-token');
const connectionStatus = document.getElementById('connection-status');

helpTokenBtn.addEventListener('click', () => {
  alert(`To create a Dynatrace API token:\n\n1. Log into your Dynatrace tenant\n2. Go to Access Tokens\n3. Click 'Generate new token'\n4. Add scope: logs.ingest\n5. Copy the token and paste it here`);
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) {
    fileStatus.textContent = 'No file selected.';
    return;
  }

  const reader = new FileReader();
  reader.onload = function (e) {
    const content = e.target.result;
    logLines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    fileStatus.textContent = `${logLines.length} log lines ready for ingestion`;
    fileStatus.className = 'text-sm text-dynatrace-primary font-medium';
  };
  reader.readAsText(file);
});

async function testConnection(endpoint, token) {
  try {
    const response = await fetch(endpoint, {
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

startBtn.addEventListener('click', async () => {
  const endpoint = endpointInput.value.trim();
  const token = tokenInput.value.trim();
  const delay = parseInt(delayInput.value.trim(), 10);

  if (!endpoint || !token || !delay || logLines.length === 0) {
    alert('Please fill all fields and upload a log file.');
    return;
  }

  // Test connection before starting
  const isConnected = await testConnection(endpoint, token);
  if (!isConnected) {
    return;
  }

  currentLineIndex = 0;
  startBtn.disabled = true;
  stopBtn.disabled = false;
  statusLog.textContent = '';

  ingestInterval = setInterval(() => {
    if (currentLineIndex >= logLines.length) {
      clearInterval(ingestInterval);
      startBtn.disabled = false;
      stopBtn.disabled = true;
      logStatus('✓ Ingestion completed successfully');
      return;
    }

    const line = logLines[currentLineIndex++];
    const payload = buildPayload(line);
    
    fetch(endpoint, {
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
  logStatus('⏹ Ingestion stopped by user.');
});

function buildPayload(line) {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'manual-log-ingest-ui' } }
          ]
        },
        scopeLogs: [
          {
            logRecords: [
              {
                timeUnixNano: Date.now() * 1_000_000,
                severityText: 'INFO',
                body: { stringValue: line }
              }
            ]
          }
        ]
      }
    ]
  };
}

function logStatus(msg) {
  const now = new Date().toLocaleTimeString();
  statusLog.textContent += `[${now}] ${msg}\n`;
  statusLog.scrollTop = statusLog.scrollHeight;
}