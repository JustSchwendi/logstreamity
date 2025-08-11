# Logstreamity — Dynatrace Log Ingest Playground

Logstreamity ist eine **rein clientseitige** Web‑App, um Logs gegen einen Dynatrace‑Tenant (Logs API v2) zu senden – ideal zum Testen von Ingest‑Verhalten, Ratelimits, Timestamps und Attributen. Keine Server‑Komponente, keine Speicherung.

---

## ✨ Neu in dieser Version

- **Multi‑Worker (parallel)**: Eigener Web‑Worker pro Quelle (z. B. *webserver*, *user_session*, *firewall*). Jeder Worker sendet **sequenziell** für seine Quelle (keine Duplikate/Gaps), global parallel.
- **Stabile Timestamps pro Modus**  
  - **Sequential**: „Live‑Replay“ – echte Wartezeit gemäß `delayMs` (real‑time).  
  - **Historic / Scattered / Random**: Versand so schnell wie möglich, **aber** Timestamps werden gemäß `delayMs`/Chunk **geplant** (realistische Zeitstempel ohne echte Wartezeit).
- **Robuste URL‑Normalisierung**: `.apps.` (case‑insensitive) wird entfernt; Pfad/Query/Hash werden verworfen; finaler Pfad stets `/api/v2/logs/ingest`. Protokoll `https://` wird ergänzt, wenn nötig.
- **Fehler/Retry/Backoff**: 429/5xx werden mit Exponential Backoff + `Retry‑After` bis 5× erneut versucht. UI zeigt HTTP‑Status/Text an.
- **Rate‑Limit (Client)**: Token‑Bucket begrenzt Events/s pro Worker bzw. gesamt (konfigurierbar).
- **Status‑Dot**: **Grün** (ready), **Lila** (busy), **Rot** (error).
- **DemoLibrary‑Dropdown**: Auswahl aus mitgelieferten Demo‑Logs; deaktiviert Dateiupload solange gewählt.
- **Dark Mode + A11y‑Basics**: CSS‑Variablen, hoher Kontrast, Status‑Text neben Dot.

> Hinweis: Remote‑Steuerung (Webhooks/WebSockets) ist **nicht** Teil dieser Version. GitHub Pages ist statisch; optionales Polling wurde entfernt/deaktiviert.

---

## 🧩 Features

- Upload/Versand von `.txt`/`.log`/JSON/XML‑Zeilen
- Attribute injizieren (vordefiniert + frei) – inkl. `source_id`, `seq_no`, `worker` (für Dedupe/Analyse)
- In‑Line SLEEP‑Direktiv: `[[[SLEEP 1000]]]`
- Startzeit steuerbar (Historic/Scattered/Random via geplante Timestamps)
- Live‑Status, Fortschritt, Fehlercodes

---

## ⚙️ Konfiguration

### `config.json` (optional, automatisch geladen aus Repo‑Root)

```jsonc
{
  "endpoint": "https://tenantID.live.apps.dynatrace.com",
  "token": "DT0c01...",

  "global": {
    "eventsPerSecond": 0,     // 0 = kein globales Client‑Throttling
    "darkMode": "auto"        // "auto" | "light" | "dark"
  },

  "workers": [
    {
      "name": "webserver",
      "mode": "sequential",   // "sequential" | "historic" | "scattered" | "random"
      "delayMs": 50,
      "batchSize": 1,
      "randomize": false,
      "attributes": { "source": "web" },
      "file": "DemoLibrary/web.txt"   // optional: lädt Demo‑Datei automatisch
    },
    {
      "name": "user_session",
      "mode": "historic",
      "delayMs": 4000,
      "batchSize": 10,
      "randomize": true,
      "attributes": { "source": "session" },
      "file": "DemoLibrary/session.txt"
    }
  ]
}
```

- Wird gefunden → UI‑Felder werden befüllt; der **erste Worker** prägt das sichtbare UI. Alle Worker aus `workers[]` werden nacheinander in **eigenen Web‑Workern** gestartet.
- **Endpoint‑Normalisierung** sorgt automatisch für valide Ingest‑URL (`https://…/api/v2/logs/ingest`).

### DemoLibrary

- `DemoLibrary/manifest.json` listet alle mitgelieferten Demo‑Dateien (wird automatisch erzeugt).
- Dropdown unter **Step 2**; Auswahl deaktiviert Upload und lädt die Datei in die App.

---

## 🕹️ Modi & Timestamps

| Modus        | Versand            | Timestamp‑Strategie                                     |
|--------------|--------------------|---------------------------------------------------------|
| Sequential   | Echtzeit (await + delay) | `Date.now()` je Event + echte Wartezeit (`delayMs`)     |
| Historic     | so schnell wie möglich   | Geplante Timestamps: Basetime + Schritte aus `delayMs`/Chunk |
| Scattered    | wie Historic, aber verteilt | Geplante Timestamps (gleichmäßige Verteilung)         |
| Random       | wie Historic, aber random Order | Geplante Timestamps (Offsets fix, Reihenfolge gemischt) |

---

## 🔐 Fehlerbehandlung & Limits

- **HTTP 429/5xx** → Retry mit Backoff (`Retry‑After` respektiert), max. 5 Versuche.
- **Records/Request**: wir senden default **einzeln** im Sequential‑Modus, und **Batch** in anderen Modi.  
- **Empfehlung**: Client‑Limit konservativ halten (z. B. 90 Events/s pro Worker).

> Hinweis: Dynatrace Limits können sich ändern; prüfe bei Bedarf die offiziellen Docs im Tenant‑Kontext.

---

## 🖥️ Entwicklung & Build

- Lokaler Test: irgendein Static‑Server (z. B. `npx http-server`, `python -m http.server`).  
- Deployment: GitHub Pages (Branch/Root).

---

## 🔮 Roadmap (aktualisiert)

- [x] Multi‑Worker (Worker‑Pool)
- [x] Dark Mode + A11y‑Verbesserungen (Basis)
- [ ] Erweiterte Worker‑UI (Add/Remove/Weights live)
- [ ] Format‑Erkennung & Validierung (Hints)
- [ ] Export/Import von Sessions (inkl. Attributen & Worker‑Setup)

---

## 🪪 License

Dieses Projekt steht unter der [Unlicense](https://unlicense.org/).
Frei verwendbar, veränderbar, weiterverteilbar – ohne Auflagen.
