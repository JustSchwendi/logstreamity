// src/webhook-worker.js

self.onmessage = async function(event) {
  // The main thread sends { type: "START_INGEST", config, logs }
  if (event.data.type === "START_INGEST") {
    const { config, logs, workerInfo } = event.data;
    const endpoint = config.endpoint.endsWith("/") ? config.endpoint : config.endpoint + "/";
    const url = endpoint + "api/v2/logs/ingest"; // Adjust as needed for Dynatrace
    const token = config.token;
    const lines = logs.split(/\r?\n/).filter(Boolean);

    // Simulate log ingestion: batch send (could use fetch if CORS & token allowed)
    for (let i = 0; i < lines.length; i += config.lineVolume) {
      // Prepare the payload (e.g. NDJSON, or array, or however your API needs it)
      const batch = lines.slice(i, i + config.lineVolume).map(line => ({ content: line }));
      try {
        // You'd use fetch in a real scenario; here, just simulate network delay and progress:
        // await fetch(url, {
        //   method: "POST",
        //   headers: {
        //     "Authorization": `Api-Token ${token}`,
        //     "Content-Type": "application/json"
        //   },
        //   body: JSON.stringify(batch)
        // });
        await new Promise(res => setTimeout(res, config.delay || 1000));
        self.postMessage({ type: "PROGRESS", progress: Math.round(((i + config.lineVolume) / lines.length) * 100) });
      } catch (e) {
        self.postMessage({ type: "ERROR", error: e.toString() });
        return;
      }
    }
    self.postMessage({ type: "DONE", message: `Ingestion finished for worker "${workerInfo?.name || ''}"!` });
  } else {
    self.postMessage({ type: "INFO", message: "Unknown command" });
  }
};
