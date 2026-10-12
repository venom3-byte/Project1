// يشغّل Chromium (وضع kiosk) على الشاشة الافتراضية، ويتحكم فيه عبر Chrome DevTools Protocol.
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import puppeteer from 'puppeteer-core';
import { isHostAllowed, toNavigableUrl } from './security.js';

export class BrowserController extends EventEmitter {
  constructor(cfg) {
    super();
    this.cfg = cfg;
    this.proc = null;
    this.browser = null;
    this.page = null;
    this.mainTarget = null;
    this.handledTargets = new WeakSet();
    this.loadingFrames = new Set();
    this.nav = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: '' };
  }

  async start() {
    fs.mkdirSync(this.cfg.downloadDir, { recursive: true });
    const args = [
      '--no-sandbox', // داخل حاوية Docker نعمل كمستخدم غير root
      '--ozone-platform=x11',
      '--kiosk', '--start-fullscreen',
      '--window-position=0,0',
      `--window-size=${this.cfg.screenWidth},${this.cfg.screenHeight}`,
      '--user-data-dir=/tmp/cb-profile',
      `--remote-debugging-address=127.0.0.1`,
      `--remote-debugging-port=${this.cfg.debugPort}`,
      `--lang=${this.cfg.locale}`,
      '--autoplay-policy=no-user-gesture-required',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run', '--no-default-browser-check',
      '--disable-infobars', '--disable-session-crashed-bubble',
      '--disable-features=Translate,OptimizationHints',
      '--password-store=basic',
      'about:blank',
    ];
    this.proc = spawn(this.cfg.chromiumBin, args, {
      env: { ...process.env, DISPLAY: this.cfg.display, PULSE_SINK: this.cfg.pulseSink },
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    this.proc.stderr.on('data', () => {}); // نتجاهل ضجيج Chromium
    this.proc.on('exit', (code) => {
      console.error(`Chromium exited with code ${code}`);
      this.emit('crash', code);
    });

    const wsEndpoint = await this.waitForDevTools();
    this.browser = await puppeteer.connect({ browserWSEndpoint: wsEndpoint, defaultViewport: null });

    const cdp = await this.browser.target().createCDPSession();
    await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: this.cfg.downloadDir });

    this.browser.on('targetcreated', (t) => this.onTarget(t));
    this.browser.on('targetchanged', (t) => this.onTarget(t));

    const pages = await this.browser.pages();
    this.page = pages[0] || (await this.browser.newPage());
    this.mainTarget = this.page.target();
    await this.attachPage();
    await this.navigate(this.cfg.startUrl).catch(() => {});
    return this;
  }

  async waitForDevTools() {
    const url = `http://127.0.0.1:${this.cfg.debugPort}/json/version`;
    for (let i = 0; i < 120; i++) {
      try {
        const r = await fetch(url);
        if (r.ok) return (await r.json()).webSocketDebuggerUrl;
      } catch { /* ننتظر */ }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error('لم يبدأ Chromium في الوقت المحدد');
  }

  async attachPage() {
    const page = this.page;
    await page.setRequestInterception(true);
    page.on('request', (req) => this.guardRequest(req));
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) this.refresh(); });
    page.on('load', () => this.refresh());
    page.on('domcontentloaded', () => this.refresh());

    const cdp = await page.createCDPSession();
    await cdp.send('Page.enable');
    cdp.on('Page.frameStartedLoading', ({ frameId }) => { this.loadingFrames.add(frameId); this.refresh(); });
    cdp.on('Page.frameStoppedLoading', ({ frameId }) => { this.loadingFrames.delete(frameId); this.refresh(); });
    this.cdp = cdp;
  }

  async guardRequest(req) {
    try {
      const u = new URL(req.url());
      if (u.protocol === 'data:' || u.protocol === 'blob:') return req.continue();
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return req.abort('blockedbyclient');
      if (!(await isHostAllowed(u.hostname))) {
        this.nav.error = 'تم منع الوصول إلى عنوان داخلي أو غير مسموح';
        this.emit('state', this.snapshot());
        return req.abort('blockedbyclient');
      }
      return req.continue();
    } catch {
      return req.abort('failed').catch(() => {});
    }
  }

  onTarget(target) {
    if (target.type() !== 'page' || target === this.mainTarget || this.handledTargets.has(target)) return;
    const url = target.url();
    if (!url || url === 'about:blank') return; // ننتظر حتى يُحدَّد الرابط
    this.handledTargets.add(target);
    // نافذة جديدة (target=_blank): نغلقها ونفتح الرابط في الصفحة الرئيسية
    target.page().then((p) => p && p.close()).catch(() => {});
    let safe;
    try { safe = toNavigableUrl(url); } catch { return; }
    this.navigate(safe).catch(() => {});
  }

  snapshot() { return { ...this.nav }; }

  async refresh() {
    if (!this.page || this.page.isClosed()) return;
    try {
      const url = this.page.url();
      let title = this.nav.title;
      try { title = await this.page.title(); } catch { /* قد تتغير الصفحة */ }
      let canGoBack = false;
      let canGoForward = false;
      try {
        const h = await this.cdp.send('Page.getNavigationHistory');
        canGoBack = h.currentIndex > 0;
        canGoForward = h.currentIndex < h.entries.length - 1;
      } catch { /* ignore */ }
      this.nav = {
        url, title, canGoBack, canGoForward,
        loading: this.loadingFrames.size > 0,
        error: this.nav.error && this.nav.url === url ? this.nav.error : '',
      };
      if (!this.nav.loading) this.nav.url = url;
    } catch { /* ignore */ }
    this.emit('state', this.snapshot());
  }

  async navigate(input) {
    if (!this.page) throw new Error('المتصفح غير جاهز');
    const url = toNavigableUrl(input);
    const u = new URL(url);
    if (!(await isHostAllowed(u.hostname))) {
      this.nav = { ...this.nav, error: 'هذا العنوان داخلي أو غير مسموح' };
      this.emit('state', this.snapshot());
      throw new Error('blocked');
    }
    this.nav = { ...this.nav, error: '', loading: true, url };
    this.emit('state', this.snapshot());
    this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((err) => {
      this.nav = { ...this.nav, error: `تعذر فتح الصفحة: ${String(err.message || err).split('\n')[0]}`, loading: false };
      this.emit('state', this.snapshot());
    });
  }

  back() { if (!this.page) return; this.page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {}).finally(() => this.refresh()); }
  forward() { if (!this.page) return; this.page.goForward({ waitUntil: 'domcontentloaded' }).catch(() => {}).finally(() => this.refresh()); }
  reload() { if (!this.page) return; this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}).finally(() => this.refresh()); }

  async close() {
    try { await this.browser?.close(); } catch { /* ignore */ }
    if (this.proc && this.proc.exitCode === null) this.proc.kill('SIGTERM');
  }
}
