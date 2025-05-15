# Logstreamity — Dynatrace Log Ingest Playground

Logstreamity is a **fully client-side** web application that lets you simulate and test log ingestion into a [Dynatrace](https://www.dynatrace.com) tenant using the **Logs API v2**.

🚀 Use this to explore ingestion behavior, troubleshoot format issues, or demo observability flows — all directly from your browser, with **no data storage or backend** involved.

---

## 🔧 Features

- Select and load your uncompressed log files
- Supports structured JSON and basic XML log formats 
- Ingests log lines individually with a configurable delay
- Offers loop mode to continuously start-over log ingestion when the EOF has been reached
- Connection check before ingestion starts
- Debug Live-Log output

---

## 📦 How It Works

- Runs entirely in your browser — **nothing is stored**, **no server involved**
- Sends log entries to your Dynatrace environment using the `/api/v2/logs/ingest` endpoint
- Requires a Dynatrace API token with the `logs.ingest` scope

---

## 🔐 Disclaimer

> ⚠️ This tool is provided **as-is** without warranty of any kind.

All tokens, URLs, and log data are processed **locally on your device only** and never leave your browser session.  
Use at your own risk.

---

## 🪪 License

This project is released under the **[Unlicense](https://unlicense.org/)**.

> You are free to use, modify, distribute, and adopt this code for any purpose — **no permission or attribution required**.

---

## 🧠 Why?

Because testing log ingestion should be simple.  
Because setting up full OpenTelemetry pipelines is overkill for quick experiments.  
Because sometimes, all you want is to replay a `.log` file into Dynatrace and see what happens.  

---

## 🧑‍💻 Contribute

Contributions are welcome!

Feel free to:
- Fork the repo
- Submit a pull request
- Report issues or suggest features

Check out [github.com/JustSchwendi/logstreamity](https://github.com/JustSchwendi/logstreamity)  
Or try the hosted version: [justschwendi.github.io/logstreamity](https://justschwendi.github.io/logstreamity)

---

Made entirely with bolt.new and ChatGPT by [Christian Schwendemann](https://www.linkedin.com/in/schwendemann).
