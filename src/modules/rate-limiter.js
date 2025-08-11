export class RateLimiter {
  constructor(ratePerSec) {
    this.capacity = Math.max(1, ratePerSec | 0);
    this.tokens = this.capacity;
    this.queue = [];
    this._timer = setInterval(() => {
      this.tokens = Math.min(this.capacity, this.tokens + this.capacity);
      this._drain();
    }, 1000);
  }
  async take(n = 1) {
    if (n <= this.tokens) { this.tokens -= n; return; }
    return new Promise((resolve) => { this.queue.push({ n, resolve }); this._drain(); });
  }
  _drain() {
    while (this.queue.length && this.queue[0].n <= this.tokens) {
      const { n, resolve } = this.queue.shift();
      this.tokens -= n; resolve();
    }
  }
  stop() { clearInterval(this._timer); }
}
