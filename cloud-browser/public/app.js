// واجهة الهاتف: تستقبل fMP4 عبر WebSocket وتشغّله بـ MediaSource، وتُرسل اللمس/الكتابة/الأوامر.
const $ = (id) => document.getElementById(id);
const MB = 1e6;
const WINDOW_MS = 60 * 60 * 1000;
const LTR = (t) => `\u2066${t}\u2069`; // عزل النص اللاتيني/الأرقام داخل سطر عربي
const ZW = '\u200b'; // حرف مخفي دائم في حقل الكتابة، لكي نلتقط زر الحذف على لوحة أندرويد
const LS_KEY = 'cb.key', LS_LIMIT = 'cb.limitMb', LS_USAGE = 'cb.usage';

const el = {
  login: $('login'), keyInput: $('keyInput'), loginBtn: $('loginBtn'), loginMsg: $('loginMsg'),
  url: $('url'), goBtn: $('goBtn'), backBtn: $('backBtn'), fwdBtn: $('fwdBtn'), reloadBtn: $('reloadBtn'),
  fullBtn: $('fullBtn'), kbBtn: $('kbBtn'), settingsBtn: $('settingsBtn'),
  video: $('screen'), touch: $('touch'), placeholder: $('placeholder'), startBtn: $('startBtn'), statusText: $('statusText'),
  toast: $('toast'), pageTitle: $('pageTitle'), qualityLabel: $('qualityLabel'),
  usageText: $('usageText'), usageBar: $('usageBar'), qualitySel: $('qualitySel'), toggleBtn: $('toggleBtn'),
  settings: $('settings'), limitInput: $('limitInput'), settingsClose: $('settingsClose'), logoutBtn: $('logoutBtn'),
  kb: $('kb'),
};

const state = {
  ws: null, authed: false, key: localStorage.getItem(LS_KEY) || '',
  wantStreaming: false, streaming: false, replaced: false,
  limitMb: Number(localStorage.getItem(LS_LIMIT)) || 50,
  serverLimitMb: 50, profiles: [], quality: 'balanced', audio: 'opus',
  usage: loadUsage(), lastSave: 0, reconnectTimer: null, toastTimer: null,
  // MediaSource
  ms: null, sb: null, queue: [], objUrl: null, initMime: null,
  press: null, scrollAcc: 0, scrollLast: 0, urlFocused: false,
};

// ---------- عدّاد الاستهلاك (آخر 60 دقيقة) ----------
function loadUsage() {
  try {
    const arr = JSON.parse(localStorage.getItem(LS_USAGE) || '[]');
    const cutoff = Date.now() - WINDOW_MS;
    return arr.filter((e) => e && e.t > cutoff && e.b > 0);
  } catch { return []; }
}
function countBytes(n) {
  state.usage.push({ t: Date.now(), b: n });
  const now = Date.now();
  const cutoff = now - WINDOW_MS;
  while (state.usage.length && state.usage[0].t < cutoff) state.usage.shift();
  if (now - state.lastSave > 5000) {
    state.lastSave = now;
    try { localStorage.setItem(LS_USAGE, JSON.stringify(state.usage)); } catch { /* ignore */ }
  }
}
function usedBytes() {
  const cutoff = Date.now() - WINDOW_MS;
  let s = 0;
  for (const e of state.usage) if (e.t >= cutoff) s += e.b;
  return s;
}
function usedRatio() { return usedBytes() / (state.limitMb * MB); }

function renderUsage() {
  const used = usedBytes() / MB;
  const ratio = usedRatio();
  el.usageText.textContent = `الاستهلاك خلال 60 دقيقة: ${LTR(used.toFixed(1) + ' MB')} من ${LTR(state.limitMb + ' MB')}`;
  el.usageBar.style.width = `${Math.min(100, ratio * 100).toFixed(1)}%`;
  el.usageBar.className = ratio >= 1 ? 'bad' : ratio >= 0.85 ? 'warn' : '';
}
setInterval(renderUsage, 1000);

// ---------- رسائل مؤقتة ----------
function toast(msg, kind = '', ms = 4000) {
  el.toast.textContent = msg;
  el.toast.className = kind;
  el.toast.hidden = false;
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
}

// ---------- الاتصال ----------
function wsUrl() {
  return `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
}

function connect() {
  if (!state.key) { showLogin(); return; }
  clearTimeout(state.reconnectTimer);
  el.statusText.textContent = 'جارٍ الاتصال...';
  const ws = new WebSocket(wsUrl());
  ws.binaryType = 'arraybuffer';
  state.ws = ws;
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', key: state.key }));
  ws.onmessage = (ev) => {
    if (typeof ev.data === 'string') {
      countBytes(ev.data.length);
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      onMessage(msg);
    } else {
      countBytes(ev.data.byteLength);
      onBinary(ev.data);
    }
  };
  ws.onclose = () => {
    state.authed = false;
    state.streaming = false;
    teardownMSE();
    if (state.replaced) return;
    if (!state.key) return showLogin();
    el.statusText.textContent = 'انقطع الاتصال، إعادة المحاولة...';
    el.placeholder.hidden = false;
    state.reconnectTimer = setTimeout(connect, 2500);
  };
}

function send(obj) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(obj));
}

function onMessage(msg) {
  switch (msg.type) {
    case 'welcome': {
      state.authed = true;
      state.serverLimitMb = msg.limitMb;
      state.profiles = msg.profiles || [];
      state.quality = msg.defaultQuality || state.quality;
      el.qualitySel.value = state.quality;
      if (!state.limitMb || state.limitMb > msg.limitMb) state.limitMb = msg.limitMb;
      el.limitInput.value = state.limitMb;
      send({ type: 'limit', mb: state.limitMb });
      applyStatus(msg.state);
      el.statusText.textContent = 'جاهز. اضغط "ابدأ البث"';
      if (state.wantStreaming) startStreaming(true);
      break;
    }
    case 'auth-failed':
      localStorage.removeItem(LS_KEY); state.key = '';
      el.loginMsg.textContent = 'المفتاح غير صحيح';
      break;
    case 'replaced':
      state.replaced = true;
      toast(msg.message || 'تم فتح الجلسة من جهاز آخر', 'warn', 8000);
      el.statusText.textContent = 'الجلسة مفتوحة في جهاز آخر';
      el.placeholder.hidden = false;
      break;
    case 'status':
      applyStatus(msg);
      break;
    case 'stream-init':
      state.quality = msg.profile;
      el.qualitySel.value = msg.profile;
      el.qualityLabel.textContent = `${msg.label} · ${LTR(msg.width + '×' + msg.height)}`;
      startMSE(msg.mime);
      break;
    case 'stream-stopped':
      if (msg.reason === 'budget') {
        state.streaming = false; state.wantStreaming = false;
        el.toggleBtn.textContent = 'استئناف';
        el.placeholder.hidden = false;
        el.statusText.textContent = 'تم إيقاف البث';
        toast(`تم إيقاف البث: وصلت إلى الحد (${LTR(Number(msg.limitMb || state.limitMb).toFixed(0) + ' MB')} خلال 60 دقيقة)`, 'bad', 10000);
      }
      break;
    case 'limit-set':
      state.serverLimitMb = msg.limitMb;
      break;
    case 'error':
      toast(msg.message || 'خطأ', 'bad', 6000);
      break;
    default: break;
  }
}

function applyStatus(s) {
  if (!s) return;
  if (document.activeElement !== el.url && !state.urlFocused && s.url) el.url.value = s.url;
  el.pageTitle.textContent = s.title || s.url || '';
  el.backBtn.disabled = !s.canGoBack;
  el.fwdBtn.disabled = !s.canGoForward;
  el.goBtn.textContent = s.loading ? '...' : 'فتح';
  if (s.error) toast(s.error, 'warn', 6000);
}

// ---------- بدء/إيقاف البث ----------
function audioCodecSupport() {
  if (!window.MediaSource) return 'none';
  if (MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,opus"')) return 'opus';
  if (MediaSource.isTypeSupported('video/mp4; codecs="avc1.42E01E,mp4a.40.2"')) return 'aac';
  return 'none';
}

function startStreaming(silent = false) {
  if (!window.MediaSource) { toast('متصفحك لا يدعم MediaSource', 'bad', 8000); return; }
  const audio = audioCodecSupport();
  if (audio === 'none') { toast('متصفحك لا يدعم تشغيل H.264 داخل MP4', 'bad', 8000); return; }
  if (usedRatio() >= 1) {
    toast('وصلت للحد المسموح خلال 60 دقيقة. انتظر حتى ينخفض الاستهلاك.', 'bad', 8000);
    return;
  }
  state.audio = audio === 'aac' ? 'aac' : 'opus';
  state.wantStreaming = true;
  state.streaming = true;
  el.toggleBtn.textContent = 'إيقاف';
  el.placeholder.hidden = true;
  send({ type: 'start', quality: state.quality, audio: state.audio });
  el.video.play().catch(() => {});
  if (!silent) el.statusText.textContent = 'جارٍ تحميل البث...';
}

function stopStreaming(reason = 'user') {
  state.wantStreaming = false;
  state.streaming = false;
  send({ type: 'stop' });
  teardownMSE();
  el.toggleBtn.textContent = 'ابدأ';
  el.placeholder.hidden = false;
  el.statusText.textContent = reason === 'auto' ? 'تم إيقاف البث' : 'البث متوقف';
}

// ---------- MediaSource ----------
function teardownMSE() {
  if (state.objUrl) URL.revokeObjectURL(state.objUrl);
  state.objUrl = null;
  state.ms = null; state.sb = null; state.queue = [];
  el.video.removeAttribute('src');
  el.video.load();
}

function startMSE(mime) {
  teardownMSE();
  if (!MediaSource.isTypeSupported(mime)) {
    toast('نوع الترميز غير مدعوم على هذا المتصفح', 'bad', 8000);
    return;
  }
  const ms = new MediaSource();
  state.ms = ms;
  state.objUrl = URL.createObjectURL(ms);
  el.video.src = state.objUrl;
  ms.addEventListener('sourceopen', () => {
    if (state.ms !== ms) return;
    try {
      const sb = ms.addSourceBuffer(mime);
      sb.mode = 'segments';
      sb.addEventListener('updateend', onUpdateEnd);
      state.sb = sb;
      pump();
    } catch (e) {
      toast(`تعذر إنشاء مخزن الفيديو: ${e.message}`, 'bad', 8000);
    }
  }, { once: true });
  el.video.play().catch(() => {});
}

function onBinary(buf) {
  if (!state.streaming) return;
  state.queue.push(buf);
  pump();
}

function pump() {
  const { sb, ms } = state;
  if (!sb || sb.updating || !state.queue.length || !ms || ms.readyState !== 'open') return;
  const chunk = state.queue.shift();
  try {
    sb.appendBuffer(chunk);
  } catch (e) {
    state.queue.unshift(chunk);
    if (e.name === 'QuotaExceededError') trimBuffer(true);
  }
}

function onUpdateEnd() {
  const v = el.video;
  const sb = state.sb;
  if (!sb) return;
  if (!sb.updating) {
    trimBuffer(false);
    // البقاء قريباً من البث المباشر: إن تأخرنا أكثر من 3 ثوانٍ نقفز للنهاية
    if (sb.buffered.length) {
      const end = sb.buffered.end(sb.buffered.length - 1);
      if (end - v.currentTime > 3) v.currentTime = end - 0.4;
    }
    if (v.paused && state.streaming) v.play().catch(() => {});
  }
  pump();
}

function trimBuffer(force) {
  const sb = state.sb;
  if (!sb || sb.updating || !sb.buffered.length) return;
  const start = sb.buffered.start(0);
  const cut = el.video.currentTime - (force ? 1 : 6);
  if (cut > start + 0.5) {
    try { sb.remove(start, cut); } catch { /* ignore */ }
  }
}

// ---------- تحويل نقرات الشاشة إلى إحداثيات الخادم ----------
function mapPoint(clientX, clientY) {
  const r = el.video.getBoundingClientRect();
  const vw = el.video.videoWidth || 1280;
  const vh = el.video.videoHeight || 720;
  const s = Math.min(r.width / vw, r.height / vh);
  const cw = vw * s;
  const ch = vh * s;
  const ox = r.left + (r.width - cw) / 2;
  const oy = r.top + (r.height - ch) / 2;
  const nx = Math.min(1, Math.max(0, (clientX - ox) / cw));
  const ny = Math.min(1, Math.max(0, (clientY - oy) / ch));
  return { nx, ny, screenPerCss: 720 / ch };
}

el.touch.addEventListener('pointerdown', (e) => {
  if (!state.streaming) return;
  el.touch.setPointerCapture(e.pointerId);
  state.press = { id: e.pointerId, x: e.clientX, y: e.clientY, lastY: e.clientY, t: Date.now(), moved: false };
  state.scrollAcc = 0;
  e.preventDefault();
});

el.touch.addEventListener('pointermove', (e) => {
  const p = state.press;
  if (!p || p.id !== e.pointerId) return;
  if (!p.moved && Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) p.moved = true;
  if (!p.moved) return;
  const fingerDy = e.clientY - p.lastY;
  p.lastY = e.clientY;
  // سحب الإصبع للأعلى = التمرير للأسفل
  const m = mapPoint(e.clientX, e.clientY);
  state.scrollAcc += -fingerDy * m.screenPerCss;
  if (Math.abs(state.scrollAcc) >= 24) {
    send({ type: 'scroll', x: m.nx, y: m.ny, dy: Math.round(state.scrollAcc) });
    state.scrollAcc = 0;
  }
});

function endPress(e) {
  const p = state.press;
  if (!p || p.id !== e.pointerId) return;
  state.press = null;
  if (!p.moved && Date.now() - p.t < 700) {
    const m = mapPoint(p.x, p.y);
    send({ type: 'click', x: m.nx, y: m.ny });
  }
}
el.touch.addEventListener('pointerup', endPress);
el.touch.addEventListener('pointercancel', () => { state.press = null; });

// ---------- الكتابة ----------
function resetKb() {
  el.kb.value = ZW;
  try { el.kb.setSelectionRange(1, 1); } catch { /* ignore */ }
}
el.kb.addEventListener('input', (e) => {
  if (e.isComposing) return;
  if (el.kb.value === '') { send({ type: 'key', key: 'BackSpace' }); resetKb(); return; }
  const text = el.kb.value.split(ZW).join('');
  if (text.includes('\n')) {
    text.split('\n').forEach((part, i) => {
      if (i > 0) send({ type: 'key', key: 'Return' });
      if (part) send({ type: 'text', text: part });
    });
  } else if (text) {
    send({ type: 'text', text });
  }
  resetKb();
});
el.kb.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); send({ type: 'key', key: 'Return' }); }
  if (e.key === 'Tab') { e.preventDefault(); send({ type: 'key', key: 'Tab' }); }
});
el.kb.addEventListener('compositionend', () => {
  setTimeout(() => {
    const text = el.kb.value.split(ZW).join('');
    if (text) send({ type: 'text', text });
    resetKb();
  }, 0);
});

// ---------- أزرار ----------
function goUrl() {
  const v = el.url.value.trim();
  if (!v) return;
  send({ type: 'navigate', url: v });
  el.url.blur();
}
el.goBtn.addEventListener('click', goUrl);
el.url.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goUrl(); } });
el.url.addEventListener('focus', () => { state.urlFocused = true; el.url.select(); });
el.url.addEventListener('blur', () => { state.urlFocused = false; });
el.backBtn.addEventListener('click', () => send({ type: 'back' }));
el.fwdBtn.addEventListener('click', () => send({ type: 'forward' }));
el.reloadBtn.addEventListener('click', () => send({ type: 'reload' }));
el.kbBtn.addEventListener('click', () => { resetKb(); el.kb.focus(); });

el.fullBtn.addEventListener('click', async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      await document.documentElement.requestFullscreen();
      try { await screen.orientation.lock('landscape'); } catch { /* ليس كل الأجهزة تدعم القفل */ }
    }
  } catch { toast('ملء الشاشة غير مدعوم هنا', 'warn'); }
});

el.startBtn.addEventListener('click', () => {
  if (!state.authed) { toast('جارٍ الاتصال بالسيرفر...', 'warn'); return; }
  startStreaming();
});
el.toggleBtn.addEventListener('click', () => {
  if (state.streaming) stopStreaming('user');
  else startStreaming();
});

el.qualitySel.addEventListener('change', () => {
  const q = el.qualitySel.value;
  if (q !== 'saver' && usedRatio() >= 0.85) {
    el.qualitySel.value = state.quality;
    toast('لا يمكن اختيار جودة أعلى: وصلت إلى 85% من الحد. استخدم "توفير".', 'warn', 6000);
    return;
  }
  state.quality = q;
  send({ type: 'quality', quality: q });
  if (!state.streaming) toast(`الجودة: ${el.qualitySel.options[el.qualitySel.selectedIndex].text}`, '', 2000);
});

el.settingsBtn.addEventListener('click', () => { el.limitInput.value = state.limitMb; el.settings.hidden = false; });
el.settingsClose.addEventListener('click', () => {
  let v = Math.round(Number(el.limitInput.value));
  if (!(v >= 1 && v <= 1000)) { toast('أدخل رقماً بين 1 و 1000', 'warn'); return; }
  if (v > state.serverLimitMb) { toast(`الحد الأقصى على السيرفر ${state.serverLimitMb} MB`, 'warn', 6000); v = state.serverLimitMb; }
  state.limitMb = v;
  localStorage.setItem(LS_LIMIT, String(v));
  send({ type: 'limit', mb: v });
  el.settings.hidden = true;
  renderUsage();
});
el.logoutBtn.addEventListener('click', () => {
  localStorage.removeItem(LS_KEY);
  state.key = '';
  state.replaced = false;
  if (state.ws) state.ws.close();
  el.settings.hidden = true;
  showLogin();
});

// ---------- الدخول ----------
function showLogin() {
  el.login.hidden = false;
  el.keyInput.focus();
}
el.loginBtn.addEventListener('click', () => {
  const k = el.keyInput.value.trim();
  if (k.length < 8) { el.loginMsg.textContent = 'أدخل المفتاح كاملاً'; return; }
  state.key = k;
  localStorage.setItem(LS_KEY, k);
  el.login.hidden = true;
  el.loginMsg.textContent = '';
  state.replaced = false;
  if (state.ws) state.ws.close();
  connect();
});
el.keyInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.loginBtn.click(); });

// ---------- بدء ----------
resetKb();
renderUsage();
if (state.key) connect(); else showLogin();
