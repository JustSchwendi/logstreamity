// src/ingest.js
import { RateLimiter } from './modules/rate-limiter.js';


export const processEndpointUrl = (input) => {
  if (!input) return "";
  let urlStr = String(input).trim();
  if (!/^https?:\/\//i.test(urlStr)) urlStr = "https://" + urlStr;
  let u;
  try { u = new URL(urlStr); } catch { return urlStr; }
  u.hostname = u.hostname.replace(/\.apps\./i, "."); // remove .apps. (case-insensitive)
  u.pathname = "/api/v2/logs/ingest";
  u.search = "";
  u.hash = "";
  return u.toString();
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
  const { mode = 'sequential', rateLimitPerSecond = 90 } = options;
  // Build payloads, filtering out nulls (empty lines / [[[SLEEP ...]]] directives)
  let seqBase = typeof options.seqNo === 'number' ? options.seqNo : 0;
  if (!options.sourceId) options.sourceId = cryptoRandomHex();
  const sourceId = options.sourceId;

  const payloads = lines
    .map((line, index) => {
      const sleepMatch = line.trim().match(/^\[\[\[SLEEP\s+(\d+)\]\]\]$/);
      if (sleepMatch) return { sleep: parseInt(sleepMatch[1], 10) };
      // Timestamp strategy: 'scheduled' uses a running clock advanced by timestampStepMs per event
      const useSched = options.timestampStrategy === 'scheduled';
      if (useSched && typeof options.timestampNext !== 'number') {
        options.timestampNext = Date.now();
      }
      const ts = useSched ? options.timestampNext : Date.now();
      const payload = buildPayload(line, selectedAttributes, ts);
      if (useSched) options.timestampNext += (options.timestampStepMs || 0);
      if (!payload) return null;
      payload.source_id = sourceId;
      payload.seq_no = seqBase++;
      return payload;
    })
    .filter(Boolean);

  options.seqNo = seqBase;

  const limiter = new RateLimiter(rateLimitPerSecond);

  if (mode !== 'sequential') {
    const batchSize = Math.max(1, rateLimitPerSecond);
    for (let i = 0; i < payloads.length; i += batchSize) {
      const batch = payloads.slice(i, i + batchSize).filter(p => !p.sleep);
      if (batch.length === 0) continue;
      await limiter.take(batch.length);
      const r = await sendWithRetry(endpoint, token, batch);
      if (!r.ok) {
        return { success: false, status: r.status, errorText: r.text };
      }
      if (i + batchSize < payloads.length) {
        await sleep(50);
      }
    }
    return { success: true };
  }

  // Sequential mode: send one-by-one respecting rate limit and retries
  for (const p of payloads) {
    if (p.sleep) {
      await sleep(p.sleep);
      continue;
    }
    await limiter.take(1);
    const r = await sendWithRetry(endpoint, token, [p]);
    if (!r.ok) {
      return { success: false, status: r.status, errorText: r.text };
    }
  }
  return { success: true };
};

function cryptoRandomHex() {
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    const arr = new Uint32Array(2); crypto.getRandomValues(arr);
    return Array.from(arr, (n) => n.toString(16)).join("");
  }
  try { const { randomBytes } = require("crypto"); return randomBytes(8).toString("hex"); }
  catch { return Math.random().toString(16).slice(2) + Date.now().toString(16); }
}


async function sendWithRetry(endpoint, token, body, attempt = 0) {
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Api-Token ${token}`,
      'Content-Type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  if (res.ok) return { ok: true, res };
  const status = res.status;
  // retry on 429 and 5xx up to 5 times
  if ((status === 429 || status >= 500) && attempt < 5) {
    const ra = parseInt(res.headers.get('Retry-After') || '0', 10);
    const backoff = ra ? ra*1000 : (250 * Math.pow(2, attempt+1) + Math.floor(Math.random()*100));
    await sleep(backoff);
    return sendWithRetry(endpoint, token, body, attempt+1);
  }
  let txt = ''; try { txt = await res.text(); } catch {}
  return { ok: false, status, text: txt };
}
