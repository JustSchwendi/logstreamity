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

const RATE_LIMIT_PER_SECOND = 90; // Keep safely below 100 events/sec limit

export const getCurrentTimestamp = (mode, currentLineIndex, logLines, options = {}) => {
  const now = new Date();
  
  switch (mode) {
    case 'historic': {
      const startTime = new Date(options.historicTimestamp || now);
      if (isNaN(startTime.getTime())) return now.toISOString();
      
      // Calculate time progression based on line index and delay
      const delay = options.delay || 1000;
      const progressMs = (currentLineIndex * delay);
      const timestamp = new Date(startTime.getTime() + progressMs);
      return timestamp.toISOString();
    }

    case 'scattered': {
      const start = new Date(options.scatteredStart);
      const end = new Date(options.scatteredEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return now.toISOString();

      const totalDuration = end.getTime() - start.getTime();
      const chunks = options.scatteredChunks || 10;
      const chunkSize = Math.ceil(logLines.length / chunks);
      const currentChunk = Math.floor(currentLineIndex / chunkSize);
      const chunkProgress = (currentLineIndex % chunkSize) / chunkSize;
      
      // Calculate time for current chunk
      const chunkStartTime = start.getTime() + (totalDuration * (currentChunk / chunks));
      const chunkDuration = totalDuration / chunks;
      const timestamp = new Date(chunkStartTime + (chunkDuration * chunkProgress));
      return timestamp.toISOString();
    }

    case 'sequential':
    default:
      return now.toISOString();
  }
};

export const buildPayload = (line, selectedAttributes, timestamp) => {
  // Skip empty lines
  if (!line.trim()) return null;

  // Special command: [[[SLEEP 1000]]]
  if (line.trim().match(/^\[\[\[SLEEP\s+(\d+)\]\]\]$/)) {
    return null;
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

  // Add selected attributes, except timestamp which we handle specially
  selectedAttributes.forEach((value, key) => {
    if (key === 'timestamp') return;
    payload[key] = value;
  });

  payload.timestamp = payload.timestamp || timestamp;

  return payload;
};

export const sendLogBatch = async (endpoint, token, lines, selectedAttributes, options = {}) => {
  const { mode = 'sequential' } = options;
  
  // Build payloads, filtering out nulls from empty lines and sleep commands
  const payloads = lines
    .map(line => {
      // Check for sleep command
      const sleepMatch = line.trim().match(/^\[\[\[SLEEP\s+(\d+)\]\]\]$/);
      if (sleepMatch) {
        return { sleep: parseInt(sleepMatch[1], 10) };
      }
      
      return buildPayload(
        line,
        selectedAttributes,
        getCurrentTimestamp(mode, options.currentLineIndex, options.logLines, options)
      );
    })
    .filter(p => p !== null);

  if (payloads.length === 0) return true;

  // For non-sequential modes, we need to respect rate limits but don't need UI delays
  if (mode !== 'sequential') {
    const batchSize = RATE_LIMIT_PER_SECOND;
    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize);
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Api-Token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(batch.filter(p => !p.sleep))
        });

        if (!response.ok) {
          console.error('Failed to send batch:', response.status, response.statusText);
          return false;
        }

        // Add a small delay between batches to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1100)); // Slightly over 1 second
      } catch (error) {
        console.error('[Log Ingest] Network Error:', error);
        return false;
      }
    }
    return true;
  }

  // For sequential mode, we process one by one with UI feedback
  for (const payload of payloads) {
    if (payload.sleep) {
      await new Promise(resolve => setTimeout(resolve, payload.sleep));
      continue;
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Api-Token ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([payload])
      });

      if (!response.ok) {
        console.error('Failed to send log:', response.status, response.statusText);
        return false;
      }

      // For sequential mode, we respect the configured delay
      if (options.delay) {
        await new Promise(resolve => setTimeout(resolve, options.delay));
      }
    } catch (error) {
      console.error('[Log Ingest] Network Error:', error);
      return false;
    }
  }

  return true;
};