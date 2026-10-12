// عدّادات وسجلات للتشخيص: تُطبع كل 10 ثوانٍ عند وجود جهاز متصل.
const MB = 1e6;
const ts = () => new Date().toISOString().slice(11, 19);

export class StreamStats {
  constructor() {
    this.total = 0;
    this.samples = []; // [time, bytes]
    this.streams = 0;
    this.restarts = 0;
    this.errors = 0;
  }

  addBytes(n, now = Date.now()) {
    this.total += n;
    this.samples.push([now, n]);
  }

  // معدل آخر windowMs بالكيلوبت في الثانية
  kbps(windowMs = 10000, now = Date.now()) {
    const cutoff = now - windowMs;
    while (this.samples.length && this.samples[0][0] < cutoff) this.samples.shift();
    let s = 0;
    for (const [, n] of this.samples) s += n;
    return (s * 8) / (windowMs / 1000) / 1000;
  }

  // تحويل kbps إلى ميغابايت في الساعة (1 MB = 10^6 بايت)
  static mbPerHour(kbps) {
    return (kbps * 1000 / 8 * 3600) / MB;
  }

  log(msg) {
    console.log(`[${ts()}] ${msg}`);
  }

  line(extra = {}) {
    const k = this.kbps();
    const extras = Object.entries(extra).map(([a, b]) => `${a}=${b}`).join(' ');
    return `[${ts()}] stats total=${(this.total / MB).toFixed(3)}MB rate10s=${k.toFixed(1)}kbps ` +
      `(~${StreamStats.mbPerHour(k).toFixed(1)}MB/h) streams=${this.streams} restarts=${this.restarts} ` +
      `errors=${this.errors} ${extras}`;
  }
}
