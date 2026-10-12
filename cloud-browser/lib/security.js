// حماية: منع الوصول للعناوين الداخلية (الشبكة الخاصة، localhost، عنوان الـ metadata...)
import dns from 'node:dns/promises';
import net from 'node:net';

const SEARCH_BASE = process.env.SEARCH_URL || 'https://duckduckgo.com/?q=';

export function isPrivateIPv4(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) return true;
  const [a, b] = p;
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||      // CGNAT
    (a === 169 && b === 254) ||                // link-local + metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                                   // multicast + reserved
  );
}

export function isPrivateIPv6(ip) {
  const x = ip.toLowerCase();
  if (x === '::' || x === '::1') return true;
  const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
}

export function isPrivateIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) return isPrivateIPv4(ip);
  if (v === 6) return isPrivateIPv6(ip);
  return true; // غير معروف = ممنوع
}

const BLOCKED_HOST = /(^localhost$)|(\.localhost$)|(\.local$)|(\.internal$)|(\.lan$)|(\.home\.arpa$)|(^metadata\.)/i;

const cache = new Map(); // host -> {ok, exp}
const CACHE_MS = 60 * 1000;

// يرجع true إذا كان المضيف مسموحاً (كل عناوينه عامة)
export async function isHostAllowed(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || BLOCKED_HOST.test(host)) return false;
  if (net.isIP(host)) return !isPrivateIp(host);
  const hit = cache.get(host);
  if (hit && hit.exp > Date.now()) return hit.ok;
  let ok = false;
  try {
    const addrs = await dns.lookup(host, { all: true, verbatim: true });
    ok = addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    ok = false;
  }
  cache.set(host, { ok, exp: Date.now() + CACHE_MS });
  return ok;
}

// يحوّل ما يكتبه المستخدم إلى رابط آمن، أو يرمي خطأ مفهوماً
export function toNavigableUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) throw new Error('الرابط فارغ');
  if (raw.length > 2048) throw new Error('الرابط طويل جداً');

  if (/^(javascript|data|file|vbscript|blob|about|chrome|view-source|intent):/i.test(raw)) {
    throw new Error('نوع الرابط غير مسموح');
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    let u;
    try { u = new URL(raw); } catch { throw new Error('الرابط غير صالح'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('مسموح فقط http و https');
    return u.toString();
  }

  // بدون بروتوكول: هل يبدو كنطاق أو عنوان IP؟
  const looksLikeHost = /^[^\s/]+\.[a-z\d-]{2,}(:\d+)?(\/.*)?$/i.test(raw) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/.*)?$/.test(raw);
  if (looksLikeHost && !/\s/.test(raw)) {
    let u;
    try { u = new URL(`https://${raw}`); } catch { throw new Error('الرابط غير صالح'); }
    return u.toString();
  }

  return SEARCH_BASE + encodeURIComponent(raw);
}
