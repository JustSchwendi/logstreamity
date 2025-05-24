// src/worker.js — Worker/job sidebar logic for Logstreamity


export class WorkerManager {
  constructor() {
    this.workers = [];
    this.workerIdCounter = 1;
    this.onUpdate = null;
  }

  getWorkers() {
    return this.workers;
  }

  addWorker(name = null) {
    const worker = {
      id: this.workerIdCounter++,
      name: name || `Worker #${this.workerIdCounter - 1}`,
      status: "Idle",
      progress: 0,
      logLines: [],
      config: {
        endpoint: '',
        token: '',
        delay: 1000,
        volume: 1,
        mode: 'sequential',
        options: {},
        currentLineIndex: 0,
        ingestInterval: null,
        loopEnabled: false
      }
    };
    this.workers.push(worker);
    if (this.onUpdate) this.onUpdate();
    return worker;
  }

  getWorkerById(id) {
    return this.workers.find(w => w.id === id);
  }

  updateWorker(id, changes) {
    const w = this.getWorkerById(id);
    if (w) Object.assign(w.config, changes);
    if (this.onUpdate) this.onUpdate();
  }

  killWorker(id) {
    this.workers = this.workers.filter(w => w.id !== id);
    if (this.onUpdate) this.onUpdate();
  }

  renameWorker(id, newName) {
    const w = this.getWorkerById(id);
    if (w && newName) {
      w.name = newName;
      if (this.onUpdate) this.onUpdate();
    }
  }
}
