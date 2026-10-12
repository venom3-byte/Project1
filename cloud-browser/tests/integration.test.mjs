// يشغّل الخادم الحقيقي في وضع CAPTURE_MODE=test (شاشة اختبارية بدل X11) ويتحقق من البث والحدود.
// يحتاج ffmpeg: ضع FFMPEG_BIN=/path/to/ffmpeg. بدونه تُتخطى الاختبارات.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FF = process.env.FFMPEG_BIN;
const KEY = 'test-key-1234567890';
const PORT = 18080 + Math.floor(Math.random() * 500);
let proc;

async function waitForPort() {
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/healthz`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

function connect(key = KEY) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  ws.binaryType = 'arraybuffer';
  const inbox = [];
  const bin = { bytes: 0, chunks: [] };
  const waiters = [];
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') { inbox.push(JSON.parse(ev.data)); }
    else { bin.bytes += ev.data.byteLength; bin.chunks.push(Buffer.from(ev.data)); }
    waiters.forEach((w) => w());
  };
  const until = (pred, ms = 15000) => new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout waiting for message')), ms);
    const check = () => { const m = inbox.find(pred); if (m) { clearTimeout(t); resolve(m); return true; } return false; };
    if (check()) return;
    const w = () => { if (check()) waiters.splice(waiters.indexOf(w), 1); };
    waiters.push(w);
  });
  const open = new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  return { ws, inbox, bin, until, open, send: (o) => ws.send(JSON.stringify(o)) };
}

const skip = !FF || !fs.existsSync(FF) ? `FFMPEG_BIN not set` : false;

before(async () => {
  if (skip) return;
  proc = spawn(process.execPath, [path.join(root, 'server.js')], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT), ACCESS_KEY: KEY, CAPTURE_MODE: 'test', FFMPEG_BIN: FF, LIMIT_MB_PER_HOUR: '50' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  proc.stderr.on('data', () => {});
  proc.stdout.on('data', () => {});
  await waitForPort();
});

after(() => { if (proc) proc.kill('SIGTERM'); });

test('الصفحة الرئيسية وفحص الصحة', { skip }, async () => {
  const html = await (await fetch(`http://127.0.0.1:${PORT}/`)).text();
  assert.match(html, /dir="rtl"/);
  const hz = await (await fetch(`http://127.0.0.1:${PORT}/healthz`)).json();
  assert.equal(hz.ok, true);
  const r = await fetch(`http://127.0.0.1:${PORT}/../package.json`);
  assert.notEqual(r.status, 200);
});

test('مفتاح خاطئ يُرفض', { skip }, async () => {
  const c = connect('wrong-key-xxxxxxxx');
  await c.open;
  c.send({ type: 'auth', key: 'wrong-key-xxxxxxxx' });
  const m = await c.until((x) => x.type === 'auth-failed');
  assert.equal(m.type, 'auth-failed');
});

test('مفتاح صحيح: welcome ثم بث H.264/fMP4 وصوت', { skip }, async () => {
  const c = connect();
  await c.open;
  c.send({ type: 'auth', key: KEY });
  const w = await c.until((x) => x.type === 'welcome');
  assert.equal(w.limitMb, 50);
  assert.deepEqual(w.profiles.map((p) => p.id), ['saver', 'balanced', 'high']);
  c.send({ type: 'start', quality: 'saver', audio: 'opus' });
  const init = await c.until((x) => x.type === 'stream-init');
  assert.equal(init.profile, 'saver');
  assert.match(init.mime, /avc1\.42E01E,opus/);
  await new Promise((r) => setTimeout(r, 4000));
  const head = c.bin.chunks.slice(0, 4).map((b) => b.toString('latin1')).join('');
  assert.ok(head.includes('ftyp'), 'init segment starts with ftyp');
  assert.ok(head.includes('moov'), 'init segment includes moov');
  assert.ok(c.bin.chunks.some((b) => b.toString('latin1').includes('moof')), 'fragments present');
  // معدل الاستهلاك التقريبي للتوفير ≈ 27MB/س = 7.5KB/s (مع هامش)
  const kbPerSec = c.bin.bytes / 4 / 1000;
  assert.ok(kbPerSec > 4 && kbPerSec < 11, `saver rate ${kbPerSec.toFixed(2)} KB/s`);
  c.send({ type: 'stop' });
  await c.until((x) => x.type === 'stream-stopped' && x.reason === 'user');
  c.ws.close();
});

test('تغيير الجودة يعيد التهيئة بجودة جديدة', { skip }, async () => {
  const c = connect();
  await c.open;
  c.send({ type: 'auth', key: KEY });
  await c.until((x) => x.type === 'welcome');
  c.send({ type: 'start', quality: 'saver', audio: 'opus' });
  await c.until((x) => x.type === 'stream-init' && x.profile === 'saver');
  c.send({ type: 'quality', quality: 'balanced' });
  const init2 = await c.until((x) => x.type === 'stream-init' && x.profile === 'balanced');
  assert.equal(init2.width, 854);
  c.ws.close();
});

test('حد الاستهلاك: الخادم يوقف البث عند الوصول للحد', { skip }, async () => {
  const c = connect();
  await c.open;
  c.send({ type: 'auth', key: KEY });
  await c.until((x) => x.type === 'welcome');
  c.send({ type: 'limit', mb: 0.1 });
  const set = await c.until((x) => x.type === 'limit-set');
  assert.equal(set.limitMb, 0.1);
  c.send({ type: 'start', quality: 'balanced', audio: 'opus' });
  const stopped = await c.until((x) => x.type === 'stream-stopped' && x.reason === 'budget', 30000);
  assert.equal(stopped.limitMb, 0.1);
  // العداد تراكمي عبر الجلسات (الاختبارات السابقة استهلكت جزءاً من الحد)
  assert.ok(c.bin.bytes >= 0.1 * 1e6 * 0.5, `received ${c.bin.bytes}`);
  assert.ok(c.bin.bytes <= 0.1 * 1e6 + 100000, `received too much: ${c.bin.bytes}`);
  c.ws.close();
});

test('الهاتف لا يستطيع رفع الحد فوق LIMIT_MB_PER_HOUR', { skip }, async () => {
  const c = connect();
  await c.open;
  c.send({ type: 'auth', key: KEY });
  await c.until((x) => x.type === 'welcome');
  c.send({ type: 'limit', mb: 500 });
  const set = await c.until((x) => x.type === 'limit-set');
  assert.equal(set.limitMb, 50);
  c.ws.close();
});

test('جلسة ثانية تطرد الأولى', { skip }, async () => {
  const a = connect();
  await a.open;
  a.send({ type: 'auth', key: KEY });
  await a.until((x) => x.type === 'welcome');
  const b = connect();
  await b.open;
  b.send({ type: 'auth', key: KEY });
  await b.until((x) => x.type === 'welcome');
  await a.until((x) => x.type === 'replaced');
  b.ws.close();
  a.ws.close();
});
