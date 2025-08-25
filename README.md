# Logstreamity — Dynatrace Log Ingest Playground

[![License: Unlicense](https://img.shields.io/badge/license-Unlicense-blue.svg)](#license)

Logstreamity is a **purely client-side** web app for testing and demonstrating log ingestion into **Dynatrace Logs API v2**—directly from your browser. Load any line-based log file (TXT/LOG/JSON/XML lines), optionally inject attributes, choose a timestamp strategy, and stream logs in real time or at high speed. No servers. No storage. Just the browser doing the work.

- **Live Hosted on GitHub Pages:** https://justschwendi.github.io/logstreamity/  
- **Host Offline by Git-Cloning:** https://github.com/JustSchwendi/logstreamity

---

## Why this is safe by design

- **All processing is client-side.** Your logs, access token, and endpoint live in your browser’s memory and (for attributes) your browser’s LocalStorage—**not** on any server hosted by this project.
- **Direct to Dynatrace.** Requests are sent straight from your browser to the Dynatrace endpoint you provide (Prod, Sprint, Dev)
- **No telemetry / analytics** in this app.  
*(As always, treat tokens carefully and only send data to tenants you control.)*

---

## Key features

- **Timestamp strategies (modes)**  
  - **Sequential:** real-time live playback with defined `delayMs` between lines - great to **showcase live troubleshooting & investigations**
  - **Historic:** fast ingest with **planned timestamps** starting from a chosen time - great to **retrofit dt.source_entity objects with logs** (hosts and problems)
  - **Scattered:** distribute timestamps between start/end with chunking and jitter - great to **simulate hours of demo logs**, unevenly spreaded, but ingested in seconds
  - 
- **Dynatrace endpoint normalization**  
  Automatically sets `https://…/api/v2/logs/ingest` and removes accidental `.apps.` host fragments, or incorrect destination pathes.
- **Attribute injection & persistence**  
  Add custom attributes (e.g., `source_id`, `seq_no`, `worker`). Export/import attribute sets from a file. Basic severity detection adds a derived `loglevel` when possible.
  If you define loglevels or timestamps here, this will override parsing and processing capabilities of other features!
- **Demo Library**  
  Quickly try the tool using built-in sample log files.
- **Resilient delivery**  
  Client-side token-bucket rate limiter; 429/5xx retry with exponential backoff and `Retry-After` support.
- **Helpful Status indicators**  
  Status dot (ready/busy/error), clear HTTP status feedback, dark mode, accessible labels.

---

## Quick start

### Option A — Use the hosted page (easiest)

Open: **https://justschwendi.github.io/logstreamity/**

1. Enter your **Dynatrace endpoint** (Logs API v2). Logstreamity will normalize it to `https://<host>/api/v2/logs/ingest` for ingestion!
2. Paste a Dynatrace **Access Token** with permission  "log ingest".
3. Load a structured or unstructured **file** (or pick a sample from **Demo Library**). 
4. Pick a **mode** (Sequential / Historic / Scattered), adjust delay/volume.
5. *(Optional)* **Inject attributes** - start typing, all supported attributes will appear. Unsupported and custom attributes are supported when loading a file.
6. **Start**. Watch status and responses. **Stop** anytime. Enable **Loop** if desired (will loop until stop is pressed)

### Option B — Run locally with `npx` (no install)

From the repo root in windows or linux:

```bash
# Using 'serve' (zero-config)
npx serve .

# OR using http-server (recommended)
npx http-server -c-1 -p 8080 .

# OR with Python
python3 -m http.server 8080
```

Then open: `http://localhost:3000` (or `:8080`, depending on your command).

---

## How to use (details)

1. **Configuration**
   - **Endpoint**: paste your Dynatrace base URL; the app transforms it to `https://<host>/api/v2/logs/ingest` and strips `.apps.` if present.
   - **Token**: paste a token with log ingest permissions.
   - **Delay / Line Volume**: per-worker pacing knobs.

2. **Pick your input**
   - **Upload** any line-based file (TXT/LOG/JSON lines/XML lines).
   - Or choose a sample from **Demo Library** (disables file upload while selected).

3. **Attributes (optional)**
   - Click **Inject Attributes** to show the attribute panel.
   - Add/edit key-values, search your saved attributes, **Save to file** / **Read from file**.
   - Attributes persist in local storage and are merged into outgoing events.

4. **Mode selection**
   - **Sequential**: real-time with `delayMs` between lines.
   - **Historic**: set a **Start Time**; timestamps are **planned** (no artificial waiting).
   - **Scattered**: set **Start/End** and **Chunks**; timestamps distribute across the window with chunk jitter.

5. **Workers**
   - Add workers in the sidebar. Each worker can have its own file, pacing, and mode.
   - Workers send sequentially for their source; multiple workers run in parallel.

6. **Start / Stop / Loop**
   - **Start** begins ingestion for the selected worker(s).
   - **Stop** cancels in-flight sends.
   - **Loop** replays once the worker reaches EOF.

---

## Tips & notes

- **Severity auto-detection**: the app attempts to parse common severity tokens and injects a derived `loglevel` attribute when found.
- **Inline sleep directive**: lines containing `[[[SLEEP 1000]]]` will pause ~1000 ms between sends (useful in Sequential mode).
- **CORS**: your Dynatrace environment must allow cross-origin requests from your browser; most tenants do for their APIs.
- **No persistence of logs**: only attributes (your key-value presets) are stored locally.

---

## Roadmap / ideas

- Multi-worker fully functional
- More sample datasets
- Enriched parsing helpers

*(PRs welcome!)*

---

## Development

This project is plain HTML/CSS/ES modules—no build step required.

```
/index.html
/style.css, /template.css
/src/*.js (main, ui, ingest, worker, attributes, modules/*)
/DemoLibrary (sample data)
/service-worker.js
```

Serve the folder with any static server (see **Quick start**).

---

## License

This project uses **The Unlicense**—public domain dedication.  
You’re free to **use, copy, modify, merge, publish, distribute, sublicense,** and/or **sell** copies of the software. See [UNLICENSE](https://unlicense.org) for details.

> TL;DR: **Fork it, change it, ship it.**

---

## Credits

Built by **Christian Schwendemann**.  
Made with ❤️ for SREs, DevOps, and anyone who needs a fast, safe way to demo or test Dynatrace log ingestion.
