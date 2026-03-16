// src/modules/geoscada-generator.js
// Synthetic GeoSCADA log generator based on geoscada_log_content_reference.yaml

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function pad2(n) { return String(n).padStart(2, '0'); }
function pad3(n) { return String(n).padStart(3, '0'); }

function fmtTs(d) {
  return `${pad2(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function hex4() { return ri(0, 0xffff).toString(16).toUpperCase().padStart(4, '0'); }
function randomIp() { return `192.168.${ri(1, 254)}.${ri(1, 254)}`; }
function randomPort() { return ri(1024, 65535); }
function fmt6dp(n) { return n.toFixed(6); }
function fmt3dp(n) { return n.toFixed(3); }
function fmt4dp(n) { return n.toFixed(4); }

const SERVER_POOL = ['SCADA-SVR-01', 'SCADA-SVR-02', 'GEO-PRIMARY', 'GEO-STANDBY', 'SCADA-PROD-A', 'SCADA-PROD-B'];
const PEER_POOL   = ['SCADA-SVR-02', 'SCADA-SVR-01', 'GEO-PRIMARY', 'GEO-STANDBY', 'SCADA-PROD-B', 'SCADA-PROD-A'];

// Weighted template table — weights from observed_prevalence in the YAML reference
const TEMPLATES = [
  { id: 'trans_syncexecute',            weight: 31598 },
  { id: 'trans_onexecute',              weight: 4390  },
  { id: 'svr_accepted_connection',      weight: 2354  },
  { id: 'svradvise_sendevent',          weight: 800   },
  { id: 'lus_lock_usage',               weight: 285   },
  { id: 'stby_transfer_complete',       weight: 185   },
  { id: 'logic_onschedule',             weight: 148   },
  { id: 'datafile_flush_cycle_complete',weight: 34    },
  { id: 'general_information_snapshot', weight: 3     },
  { id: 'snapshot_completed',           weight: 1     },
];
const TOTAL_WEIGHT = TEMPLATES.reduce((s, t) => s + t.weight, 0);

function pickTemplate() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const t of TEMPLATES) { r -= t.weight; if (r <= 0) return t.id; }
  return TEMPLATES[0].id;
}

// stby metric block variants (8 options from the YAML)
const STBY_BLOCK_FNS = [
  (i) => `Data ${i()}, Dyn ${i()}, Evt ${i()}, HisRec ${i()}, JnlRec ${i()}`,
  (i) => `Data ${i()}, Dyn ${i()}, Evt ${i()}, HisRec ${i()}, JnlFile ${i()}, JnlRec ${i()}`,
  (i) => `Data ${i()}, Dyn ${i()}, Int ${i()}, Evt ${i()}, HisRec ${i()}, JnlRec ${i()}`,
  (i) => `Data ${i()}, Dyn ${i()}, Int ${i()}, Evt ${i()}, HisRec ${i()}, JnlFile ${i()}, JnlRec ${i()}`,
  (i) => `Data ${i()}, Dyn ${i()}, Int ${i()}, Evt ${i()}, HisRec ${i()}, AlsRec ${i()}, JnlRec ${i()}`,
  (i) => `Data ${i()}, Dyn ${i()}, Int ${i()}, Evt ${i()}, HisRec ${i()}, AlsRec ${i()}, JnlFile ${i()}, JnlRec ${i()}`,
  (i) => `Data ${i()}, Dyn ${i()}, Evt ${i()}, HisRec ${i()}, AlsRec ${i()}, JnlRec ${i()}`,
  (i) => `Cfg ${i()}, Data ${i()}, Dyn ${i()}, Int ${i()}, Evt ${i()}, HisRec ${i()}, JnlFile ${i()}, JnlRec ${i()}`,
];

// Renders a single-line template; returns a string
function renderSingleLine(id, ts, serverName) {
  const t = fmtTs(ts);
  const h = hex4();
  switch (id) {
    case 'trans_syncexecute':
      return `${t} ${h} [TRANS] 0 SyncExecute Time =   ${fmt6dp(Math.random() * 0.0001)} seconds`;
    case 'trans_onexecute':
      return `${t} ${h} [TRANS] 0 OnExecute Time =   ${fmt6dp(Math.random() * 0.001)} seconds`;
    case 'svr_accepted_connection':
      return `${t} ${h} [SVR] Accepted connection ${ri(1, 9999)} from ${randomIp()}:${randomPort()} to ${randomIp()}:${randomPort()} on socket ${hex4()}...`;
    case 'svradvise_sendevent': {
      const area = String.fromCharCode(65 + ri(0, 25)) + String.fromCharCode(65 + ri(0, 25));
      return `${t} ${h} [SVRADVISE] ${area}#${ri(1, 999)} SendEvent: EVT_OPCAE_EVENT (${ri(50, 500)} bytes) to ClientId ${ri(1, 99)} (${ri(1, 5)} events queued)`;
    }
    case 'lus_lock_usage':
      return `${t} ${h} [LUS] Lock usage, ${fmt4dp(Math.random() * 100)}%, over the last second (diagnostic)`;
    case 'logic_onschedule':
      return `${t} ${h} [LOGIC] OnSchedule() ${ri(1, 20)} programs to process`;
    case 'datafile_flush_cycle_complete': {
      const files = ri(0, 5);
      return `${t} ${h} [DATAFILE] Flush cycle complete, flushed ${files} files (${files * ri(0, 4096)} bytes), time taken ${fmt6dp(Math.random())} milliseconds`;
    }
    case 'stby_transfer_complete': {
      const blockFn = STBY_BLOCK_FNS[ri(0, STBY_BLOCK_FNS.length - 1)];
      return `${t} ${h} [STBY] 1 Transfer ${ri(1, 999)} Complete: Time ${fmt3dp(Math.random() * 10)} S, ${blockFn(() => ri(0, 50000))}, ${serverName} `;
    }
    case 'snapshot_completed':
      return `${t} ${h} ...snapshot completed in ${ri(50, 2000)} ms.`;
    default:
      return null;
  }
}

// Renders the multi-line general information snapshot block; returns string[]
function renderGeneralInformation(ts, serverName, peerName) {
  const t = fmtTs(ts);
  const totPhys   = ri(32768, 65536);  const avPhys  = ri(8192, totPhys);
  const totPage   = ri(16384, 32768);  const avPage  = ri(4096, totPage);
  const totVirt   = ri(131072, 524288);const avVirt  = ri(65536, totVirt);
  const totDbPts  = ri(50000, 500000); const dbPts   = ri(10000, totDbPts);
  const totOpc    = ri(50, 200);       const opc     = ri(0, totOpc);
  const totViewx  = ri(20, 100);       const viewx   = ri(0, totViewx);
  const totWebx   = ri(20, 100);       const webx    = ri(0, totWebx);
  const totDac    = ri(20, 100);       const dac     = ri(0, totDac);
  const pct = (a, b) => ((a / b) * 100).toFixed(1);
  const isMain = Math.random() > 0.5;
  const stateChangeDt = new Date(ts.getTime() - ri(3600000, 86400000 * 7));
  const wentMainStr = isMain ? fmtTs(stateChangeDt) : 'Never';
  const stateStr = isMain ? 'Main' : `Standby to "${peerName}"`;
  const licId = Math.random() > 0.1 ? `${ri(100000, 999999)} (Quote this for support)` : 'None';

  return [
    `${t} 0000 01. General Information`,
    `    EcoStruxure Geo SCADA Expert 2021 on ${serverName}`,
    `    Version 85.5543.2`,
    `    Copyright \u00A9 2005-2024 AVEVA Group Limited or its subsidiaries. All rights reserved.`,
    `    License Site Id: ${licId}`,
    `    June 2024 Update`,
    `    'EVERYONE' HAS ACCESS TO ROOT GROUP.`,
    `    As an additional security measure, please consider removing these permissions.`,
    `    Database Watchdog is enabled; system will restart after a stall is detected.`,
    `    Current State: ${stateStr}`,
    `    State Change Time: ${fmtTs(stateChangeDt)}`,
    `    Time Went Main: ${wentMainStr}`,
    `    Available Physical Memory: ${avPhys} of ${totPhys} MBytes`,
    `    Available Paging File: ${avPage} of ${totPage} MBytes`,
    `    Available Virtual Memory: ${avVirt} of ${totVirt} MBytes`,
    `    Process Working Set Size: ${ri(500, 2000)} MBytes`,
    `    Process Peak Working Set Size: ${ri(500, 2000)} MBytes`,
    `    Process Page File Usage: ${ri(200, 1000)} MBytes`,
    `    Process Peak Page File Usage: ${ri(200, 1000)} MBytes`,
    `    Memory used by database objects: ${ri(10000, 500000)} KBytes`,
    `    Operating System: Windows Server 2022 Datacenter`,
    `    CPU: Intel(R) Xeon(R) Gold 6254 CPU @ 3.10GHz`,
    `    Registry Root: HKEY_LOCAL_MACHINE\\SOFTWARE\\Schneider Electric\\ClearSCADA`,
    `    License Runtime: Server`,
    `    Database points: ${dbPts} of ${totDbPts} (${pct(dbPts, totDbPts)}%)`,
    `    Data Access Clients: ${dac} of ${totDac} (${pct(dac, totDac)}%)`,
    `    OPC Clients: ${opc} of ${totOpc} (${pct(opc, totOpc)}%)`,
    `    ViewX Clients: ${viewx} of ${totViewx} (${pct(viewx, totViewx)}%)`,
    `    WebX Clients: ${webx} of ${totWebx} (${pct(webx, totWebx)}%)`,
    `    Web Server HTTP Port: ${ri(8000, 8099)}`,
    `    Web Server HTTPS Port: ${ri(8443, 8543)}`,
    `    Telnet Server: ${Math.random() > 0.5 ? 'Enabled' : 'Disabled'}`,
  ];
}

/**
 * Generate synthetic GeoSCADA log lines.
 *
 * @param {number} count     Number of log events to generate
 * @param {object} [opts]
 * @param {number} [opts.startMs]  Start epoch ms (defaults to now minus ~count seconds)
 * @returns {string[]}  Array of log line strings ready for ingestion
 */
export function generateGeoScadaLines(count, { startMs } = {}) {
  const serverIdx = ri(0, SERVER_POOL.length - 1);
  const serverName = SERVER_POOL[serverIdx];
  const peerName   = PEER_POOL[serverIdx];
  const start = startMs ?? (Date.now() - count * 150);
  const lines = [];
  let cursor = start;

  for (let i = 0; i < count; i++) {
    cursor += ri(50, 300);
    const ts = new Date(cursor);
    const id = pickTemplate();

    if (id === 'general_information_snapshot') {
      lines.push(...renderGeneralInformation(ts, serverName, peerName));
    } else {
      const line = renderSingleLine(id, ts, serverName);
      if (line) lines.push(line);
    }
  }

  return lines;
}
