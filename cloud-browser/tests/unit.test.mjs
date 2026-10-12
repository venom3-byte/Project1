import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toNavigableUrl, isPrivateIp } from '../lib/security.js';
import { ByteBudget } from '../lib/budget.js';
import { PROFILES, expectedMbPerHour, mimeFor } from '../lib/profiles.js';
import { buildFfmpegArgs } from '../lib/stream.js';
import { validateConfig } from '../lib/config.js';

test('toNavigableUrl: روابط وبحث وحظر المخططات الخطرة', () => {
  assert.equal(toNavigableUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(toNavigableUrl('example.com'), 'https://example.com/');
  assert.equal(toNavigableUrl('youtube.com/watch?v=x'), 'https://youtube.com/watch?v=x');
  assert.match(toNavigableUrl('hello world'), /^https:\/\/duckduckgo\.com\/\?q=hello%20world$/);
  assert.throws(() => toNavigableUrl('javascript:alert(1)'));
  assert.throws(() => toNavigableUrl('file:///etc/passwd'));
  assert.throws(() => toNavigableUrl('data:text/html,x'));
  assert.throws(() => toNavigableUrl('ftp://example.com'));
  assert.throws(() => toNavigableUrl('   '));
  assert.throws(() => toNavigableUrl('a'.repeat(3000)));
});

test('isPrivateIp: العناوين الداخلية ممنوعة', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1', '0.0.0.0', 'junk']) {
    assert.equal(isPrivateIp(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:4700:4700::1111']) {
    assert.equal(isPrivateIp(ip), false, ip);
  }
});

test('ByteBudget: العدّاد المتدحرج لآخر 60 دقيقة', () => {
  const b = new ByteBudget(1000, 60 * 60 * 1000);
  const t0 = 1_000_000;
  b.add(600, t0);
  assert.equal(b.used(t0), 600);
  assert.equal(b.exhausted(t0), false);
  b.add(400, t0 + 1000);
  assert.equal(b.exhausted(t0 + 1000), true);
  // بعد 60 دقيقة تسقط الإدخالات القديمة
  assert.equal(b.used(t0 + 60 * 60 * 1000 + 1), 400);
  assert.equal(b.used(t0 + 61 * 60 * 1000 + 2000), 0);
});

test('profiles: الاستهلاك المتوقع ضمن الأهداف (توفير ≈27، متوازن ≈44، أقل من 50 للوضعين)', () => {
  const s = expectedMbPerHour(PROFILES.saver);
  const b = expectedMbPerHour(PROFILES.balanced);
  assert.ok(s > 25 && s < 30, `saver ${s}`);
  assert.ok(b > 40 && b < 47, `balanced ${b}`);
  assert.ok(b < 50 && s < 50);
  assert.ok(expectedMbPerHour(PROFILES.high) > 900);
});

test('mimeFor: Opus أو AAC داخل MP4', () => {
  assert.equal(mimeFor(PROFILES.balanced, 'opus'), 'video/mp4; codecs="avc1.42E01E,opus"');
  assert.equal(mimeFor(PROFILES.high, 'aac'), 'video/mp4; codecs="avc1.42E01F,mp4a.40.2"');
});

test('buildFfmpegArgs: ترميز بمعدل ثابت وfMP4 مجزأ', () => {
  const a = buildFfmpegArgs({ profile: PROFILES.balanced, audioCodec: 'opus', captureMode: 'x11', display: ':99', screen: { width: 1280, height: 720 }, pulseSource: 'cb.monitor' }).join(' ');
  assert.match(a, /-f x11grab/);
  assert.match(a, /-f pulse -i cb\.monitor/);
  assert.match(a, /-b:v 78k -maxrate 78k -bufsize 78k/);
  assert.match(a, /-c:a libopus -b:a 16k/);
  assert.match(a, /-movflags empty_moov\+default_base_moof\+frag_keyframe/);
  assert.match(a, /scale=854:480/);
  const aac = buildFfmpegArgs({ profile: PROFILES.saver, audioCodec: 'aac', captureMode: 'x11', display: ':99', screen: { width: 1280, height: 720 }, pulseSource: 'x' }).join(' ');
  assert.match(aac, /-c:a aac -b:a 16k/);
});

test('validateConfig: مفتاح الدخول إلزامي وطوله 12 حرفاً على الأقل', () => {
  assert.ok(validateConfig({ accessKey: '', limitMbPerHour: 50 }).length > 0);
  assert.ok(validateConfig({ accessKey: 'short', limitMbPerHour: 50 }).length > 0);
  assert.deepEqual(validateConfig({ accessKey: 'a-very-long-key-123', limitMbPerHour: 50 }), []);
});

import { StreamStats } from '../lib/stats.js';
test('StreamStats: معدل kbps ومعادلة MB/ساعة', () => {
  const s = new StreamStats();
  const now = 1_000_000;
  s.addBytes(12500, now); // 12.5 KB خلال 10 ثوانٍ = 10 kbps
  assert.equal(Math.round(s.kbps(10000, now)), 10);
  assert.ok(Math.abs(StreamStats.mbPerHour(100) - 45) < 0.01); // 100 kbps ≈ 45 MB/س
  assert.equal(s.kbps(10000, now + 20000), 0); // العينات القديمة تسقط
  assert.match(s.line({ quality: 'balanced' }), /stats total=0\.013MB .* quality=balanced/);
});
