// عدّاد الاستهلاك المتدحرج (آخر 60 دقيقة) على السيرفر.
// يمنع تجاوز الحد حتى لو تعطل عداد الهاتف.
export class ByteBudget {
  constructor(limitBytes, windowMs = 60 * 60 * 1000) {
    this.limitBytes = limitBytes;
    this.windowMs = windowMs;
    this.entries = []; // [{t, n}]
    this.total = 0;
  }

  prune(now = Date.now()) {
    const cutoff = now - this.windowMs;
    while (this.entries.length && this.entries[0].t < cutoff) {
      this.total -= this.entries.shift().n;
    }
  }

  add(bytes, now = Date.now()) {
    this.prune(now);
    this.entries.push({ t: now, n: bytes });
    this.total += bytes;
  }

  used(now = Date.now()) {
    this.prune(now);
    return this.total;
  }

  exhausted(now = Date.now()) {
    return this.used(now) >= this.limitBytes;
  }
}
