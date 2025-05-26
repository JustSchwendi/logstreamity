# Logstreamity — Dynatrace Log Ingest Playground

Logstreamity is a **fully client-side** web application to simulate and test log ingestion into a [Dynatrace](https://www.dynatrace.com) tenant using the **Logs API v2**.

🚀 Use this tool to explore ingestion behavior, troubleshoot formatting issues, demo observability flows — all directly from your browser, with **no data storage or backend** involved.

---

## 🔧 Features

- Upload and ingest uncompressed log files (`.log`, `.txt`, JSON, XML)
- Simulate real-time ingestion line by line with configurable delay
- Inject structured log attributes using predefined or custom fields
- Definable ingest **start timestamp**, decoupled from system time (e.g. `2025-05-22T15:00:00`)
- `[[[SLEEP 1000]]]` directive support for in-line ingestion pauses
- Skips blank/empty lines to avoid noise
- Ingest loop mode: replay the log file endlessly
- Debug mode with live preview of parsed and ingested log data
- Pre-upload connection test to validate endpoint + token
- Attribute search and injection interface
- Hosted log library samples and webhook test calls
- Works fully offline — runs 100% in your browser, no external dependencies

---

## 📦 How It Works

- Sends logs to your Dynatrace environment via `POST /api/v2/logs/ingest`
- Requires a Dynatrace API token with `logs.ingest` scope
- All data remains local — no logging, caching, or external calls

---

## ✨ Feature Button Reference

### 🔘 Inject Attributes
Adds a predefined set of semantic attributes to each log line — like `host.name`, `dt.source_entity`, and `service.name`.  
Useful for testing enriched logs that link to entities in Smartscape and Grail. The attributes are auto-prefilled per definition of the Dynatrace product documentation. Please load a attributes config file to ingest custom attributes.

### 🕓 Historic Logs
Allows to to ingest backdated logs. Preserves original timestamps (if present) or uses a custom ingest start time.  
Great if you would like to retrofit an existing entity or problem with logs for testing purposes, or load a demo scenario.

### 💥 Scattered Logs
Randomizes the order of log line ingestion to mimic asynchronous, out-of-order delivery.  
Ideal for testing log sorting, causality, or distributed ingestion edge cases.
Great for use cases where you look to load several hours of logs in a realistic look and feel for lab environments.

---

## 🧪 Try It Live

▶️ [justschwendi.github.io/logstreamity](https://justschwendi.github.io/logstreamity)

Or just download it on your computer and run 'python -m http.server 8000' in your local console in the same directory.
This will start a local webserver on port 8000 that will host the application. 
Due to multiple js libraries you can no longer just double-click the index.html file

---

## 🛡️ Disclaimer

> ⚠️ This tool is provided **as-is** with no warranty of any kind.

All tokens, URLs, and log data are processed **entirely in your browser** and never sent anywhere else, unless you use the github.io hosted version. Use at your own risk.

---

## 🧠 Why?

- Testing log ingestion shouldn’t require setting up full pipelines and demo-lab environments
- Perfect for demos, education, or parsing experiments
- Helps test edge cases like timestamp mismatches, encoding, or delays
- Enables you to retrofit your use cases with pre-defined logs

---

## 🧑‍💻 Contribute

- Fork the repo
- Submit a pull request
- Report issues or suggest features

GitHub: [github.com/JustSchwendi/logstreamity](https://github.com/JustSchwendi/logstreamity)

---

## 🔮 To-Do / Roadmap

- [ ] Multi-threaded processing with worker pool for high-volume logs
- [ ] Support for **remote worker execution** via webhook callbacks
- [ ] Dark mode and accessibility optimizations
- [ ] Log format validation hints and suggestions

---

## 🪪 License

This project is released under the [Unlicense](https://unlicense.org/).

> You are free to use, modify, and distribute this code for any purpose — no permission or attribution required.
