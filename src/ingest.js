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

const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

export const getCurrentTimestamp = (mode, currentLineIndex, logLines, options = {}) => {
  const now = new Date();
  
  switch (mode) {
    case 'historic': {
      const startTime = new Date(options.historicTimestamp || now);
      if (isNaN(startTime.getTime())) return now.toISOString();
      
      // For historic mode, just add milliseconds based on line index
      const msPerLine = 10; // Process logs very quickly
      const timestamp = new Date(startTime.getTime() + (currentLineIndex * msPerLine));
      return timestamp.toISOString();
    }

    case 'scattered': {
      const start = new Date(options.scatteredStart);
      const end = new Date(options.scatteredEnd);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) return now.toISOString();

      const totalDuration = end.getTime() - start.getTime();
      const chunks = options.scatteredChunks || 10;
      
      // Instead of evenly distributing logs, create random-sized chunks
      const chunkBoundaries = Array(chunks + 1).fill(0);
      chunkBoundaries[0] = 0;
      chunkBoundaries[chunks] = logLines.length;
      
      // Generate random chunk sizes that sum to total log lines
      for (let i = 1; i < chunks; i++) {
        const remainingChunks = chunks - i;
        const remainingLines = logLines.length - chunkBoundaries[i - 1];
        const maxForChunk = Math.floor(remainingLines / remainingChunks * 2); // Allow up to 2x average size
        chunkBoundaries[i] = chunkBoundaries[i - 1] + getRandomInt(1, maxForChunk);
      }
      
      // Find which chunk this line belongs to
      let currentChunk = 0;
      while (currentChunk < chunks && currentLineIndex >= chunkBoundaries[currentChunk + 1]) {
        currentChunk++;
      }
      
      // Calculate progress within chunk with some random variation
      const chunkStart = chunkBoundaries[currentChunk];
      const chunkEnd = chunkBoundaries[currentChunk + 1];
      const chunkProgress = (currentLineIndex - chunkStart) / (chunkEnd - chunkStart);
      
      // Add some random jitter to the timestamp within the chunk
      const chunkStartTime = start.getTime() + (totalDuration * (currentChunk / chunks));
      const chunkDuration = totalDuration / chunks;
      const jitter = getRandomInt(-Math.floor(chunkDuration * 0.1), Math.floor(chunkDuration * 0.1));
      const timestamp = new Date(chunkStartTime + (chunkDuration * chunkProgress) + jitter);
      
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
    .map((line, index) => {
      // Check for sleep command
      const sleepMatch = line.trim().match(/^\[\[\[SLEEP\s+(\d+)\]\]\]$/);
      if (sleepMatch) {
        return { sleep: parseInt(sleepMatch[1], 10) };
      }
      
      return buildPayload(
        line,
        selectedAttributes,
        getCurrentTimestamp(mode, options.currentLineIndex + index, options.logLines, options)
      );
    })
    .filter(p => p !== null);

  if (payloads.length === 0) return true;

  // For non-sequential modes, process in batches respecting rate limits
  if (mode !== 'sequential') {
    const batchSize = RATE_LIMIT_PER_SECOND;
    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize);
      const validBatch = batch.filter(p => !p.sleep);
      
      if (validBatch.length === 0) continue;

      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Authorization': `Api-Token ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(validBatch)
        });

        if (!response.ok) {
          console.error('Failed to send batch:', response.status, response.statusText);
          return false;
        }

        // Minimal delay between batches to respect rate limits
        if (i + batchSize < payloads.length) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      } catch (error) {
        console.error('[Log Ingest] Network Error:', error);
        return false;
      }
    }
    return true;
  }

  // For sequential mode, process one by one with UI feedback
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
    } catch (error) {
      console.error('[Log Ingest] Network Error:', error);
      return false;
    }
  }

  return true;
};