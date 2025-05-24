// src/ingest.js

export const processEndpointUrl = (url) => {
  url = url.trim().replace(/\/$/, '');
  url = url.replace('.apps.', '.');

  if (!url.endsWith('/api/v2/logs/ingest')) {
    url = url.split('/').slice(0, 3).join('/');
    url = `${url}/api/v2/logs/ingest`;
  }

  return url;
};

export const getCurrentTimestamp = (mode, currentLineIndex, logLines, options = {}) => {
  switch (mode) {
    case 'historic':
      return options.historicTimestamp || new Date().toISOString();

    case 'scattered': {
      const start = new Date(options.scatteredStart);
      const end = new Date(options.scatteredEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return new Date().toISOString();

      const progress = currentLineIndex / logLines.length;
      const scatterTime = new Date(start.getTime() + (end.getTime() - start.getTime()) * progress);
      return scatterTime.toISOString();
    }

    case 'sequential':
    default:
      return new Date().toISOString();
  }
};

export const buildPayload = (line, selectedAttributes, timestamp) => {
  // Special command: [[[SLEEP 1000]]]
  if (line.trim().match(/^\[\[\[SLEEP\s+(\d+)\]\]\]$/)) {
    return null; // Skip sending a payload for sleep commands
  }

  let payload;

  try {
    payload = JSON.parse(line);
  } catch {
    payload = {
      content: line,
      timestamp
    };
  }

  selectedAttributes.forEach((value, key) => {
    if (key === 'timestamp') return;
    payload[key] = value;
  });

  payload.timestamp = payload.timestamp || timestamp;

  return payload;
};

export const sendLogBatch = async (endpoint, token, lines, selectedAttributes, options = {}) => {
  const payloads = lines
    .map(line =>
      buildPayload(
        line,
        selectedAttributes,
        getCurrentTimestamp(options.mode, options.currentLineIndex, options.logLines, options)
      )
    )
    .filter(p => p !== null);

  if (payloads.length === 0) return true;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Token ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payloads)
    });

    return response.ok;
  } catch (error) {
    console.error('[Log Ingest] Network Error:', error);
    return false;
  }
};
