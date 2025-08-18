
// src/worker.js — Worker/job sidebar logic for Logstreamity

export class WorkerManager {
  constructor(listElId = 'workersList') {
    this.listEl = document.getElementById(listElId);
    this.workers = [];
    this.counter = 1;
    this.selectedId = null;
    this.onChange = null;
    this.render();
  }

  getWorkers() { return this.workers.slice(); }
  getSelected() { return this.workers.find(w => w.id === this.selectedId) || null; }
  setOnChange(fn){ this.onChange = fn; }

  addWorker(name = null) {
    const w = {
      id: this.counter++,
      name: name || `worker-${this.counter-1}`,
      mode: 'sequential',
      delayMs: 1000,
      batchSize: 1,
      randomize: false,
      attributes: {},
      status: 'ready'
    };
    this.workers.push(w);
    if (!this.selectedId) this.selectedId = w.id;
    this.render();
    this.fire();
    return w;
  }

  updateSelected(partial) {
    const w = this.getSelected();
    if (!w) return;
    Object.assign(w, partial || {});
    this.render();
    this.fire();
  }

  setStatus(id, status) {
    const w = this.workers.find(x => x.id === id);
    if (w) { w.status = status; this.render(); }
  }

  select(id) {
    if (this.workers.some(w => w.id === id)) {
      this.selectedId = id; this.render(); this.fire();
    }
  }

  remove(id) {
    this.workers = this.workers.filter(w => w.id !== id);
    if (this.selectedId === id) this.selectedId = this.workers[0]?.id || null;
    this.render(); this.fire();
  }

  render() {
    if (!this.listEl) return;
    const tpl = document.getElementById('workerItemTpl');
    this.listEl.innerHTML = '';
    this.workers.forEach((w) => {
      const node = tpl ? tpl.content.firstElementChild.cloneNode(true) : document.createElement('div');
      if (!tpl) node.className = 'flex items-center justify-between p-2 border rounded';
      node.dataset.workerId = String(w.id);
      node.dataset.workerName = w.name;
      const st = node.querySelector('[data-status]') || document.createElement('span');
      st.classList.remove('status-ready','status-busy','status-error');
      st.classList.add('status-dot', w.status === 'busy' ? 'status-busy' : w.status === 'error' ? 'status-error' : 'status-ready');
      if (!st.parentNode && node.firstChild) node.insertBefore(st, node.firstChild);
      const nm = node.querySelector('[data-name]') || document.createElement('span');
      nm.textContent = w.name;
      const meta = node.querySelector('[data-meta]') || document.createElement('div');
      meta.textContent = `mode:${w.mode} • delay:${w.delayMs}ms • batch:${w.batchSize}`;
      node.addEventListener('click', () => this.select(w.id));
      this.listEl.appendChild(node);
      if (this.selectedId === w.id) {
        node.classList.add('ring-2','ring-dynatrace-primary');
      }
    });
  }

  fire(){ if (typeof this.onChange === 'function') this.onChange(this.getSelected(), this.getWorkers()); }
}
