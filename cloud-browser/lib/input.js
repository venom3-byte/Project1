// تمرير أوامر الفأرة ولوحة المفاتيح إلى Chromium عبر xdotool (بدون shell، لتفادي الحقن).
import { execFile } from 'node:child_process';

const ALLOWED_KEYS = new Set([
  'Return', 'BackSpace', 'Delete', 'Tab', 'Escape', 'space',
  'Left', 'Right', 'Up', 'Down', 'Home', 'End', 'Page_Up', 'Page_Down',
  'ctrl+a', 'ctrl+c', 'ctrl+v', 'ctrl+x', 'ctrl+z', 'ctrl+f', 'ctrl+l', 'ctrl+r',
  'shift+Tab', 'alt+Left', 'alt+Right',
]);

export class InputController {
  constructor({ xdotoolBin, display, width, height }) {
    this.bin = xdotoolBin;
    this.display = display;
    this.width = width;
    this.height = height;
    this.queue = Promise.resolve();
    this.pending = 0;
  }

  run(args) {
    if (this.pending > 300) return Promise.resolve(); // حماية من الإغراق
    this.pending++;
    const job = this.queue.then(() => new Promise((resolve) => {
      execFile(this.bin, args, { env: { ...process.env, DISPLAY: this.display }, timeout: 5000 }, (err) => {
        if (err) console.warn('xdotool error:', err.message.split('\n')[0]);
        resolve();
      });
    })).finally(() => { this.pending--; });
    this.queue = job.catch(() => {});
    return job;
  }

  toPixels(nx, ny) {
    const x = Math.round(Math.min(1, Math.max(0, Number(nx) || 0)) * (this.width - 1));
    const y = Math.round(Math.min(1, Math.max(0, Number(ny) || 0)) * (this.height - 1));
    return [x, y];
  }

  click(nx, ny) {
    const [x, y] = this.toPixels(nx, ny);
    return this.run(['mousemove', '--sync', String(x), String(y), 'click', '1']);
  }

  // dy بالبكسل على الشاشة: موجب = التمرير لأسفل
  scroll(nx, ny, dy) {
    const [x, y] = this.toPixels(nx, ny);
    const steps = Math.min(15, Math.max(1, Math.round(Math.abs(Number(dy) || 0) / 40)));
    const button = Number(dy) > 0 ? '5' : '4';
    return this.run(['mousemove', '--sync', String(x), String(y), 'click', '--repeat', String(steps), '--delay', '15', button]);
  }

  key(name) {
    if (!ALLOWED_KEYS.has(name)) return Promise.resolve();
    return this.run(['key', '--clearmodifiers', name]);
  }

  text(str) {
    const s = String(str || '').slice(0, 500);
    if (!s) return Promise.resolve();
    return this.run(['type', '--delay', '12', '--clearmodifiers', '--', s]);
  }
}
