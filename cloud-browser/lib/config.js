// كل الإعدادات تأتي من متغيرات البيئة (ملف .env عند التشغيل بـ Docker Compose).
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== '' ? n : d;
};

export const config = {
  port: num(process.env.PORT, 8080),
  accessKey: (process.env.ACCESS_KEY || '').trim(),
  // حد الاستهلاك لكل 60 دقيقة (بالميغابايت) - هذا هو الشرط الأساسي للمشروع
  limitMbPerHour: num(process.env.LIMIT_MB_PER_HOUR, 50),
  display: process.env.DISPLAY || ':99',
  screenWidth: num(process.env.SCREEN_WIDTH, 1280),
  screenHeight: num(process.env.SCREEN_HEIGHT, 720),
  chromiumBin: process.env.CHROMIUM_BIN || '/usr/bin/chromium',
  ffmpegBin: process.env.FFMPEG_BIN || 'ffmpeg',
  xdotoolBin: process.env.XDOTOOL_BIN || 'xdotool',
  // x11 = التقاط الشاشة الحقيقية (الإنتاج). test = شاشة اختبارية بدون X (للفحص فقط)
  captureMode: process.env.CAPTURE_MODE === 'test' ? 'test' : 'x11',
  debugPort: num(process.env.CDP_PORT, 9222),
  startUrl: process.env.START_URL || 'https://duckduckgo.com/',
  searchUrl: process.env.SEARCH_URL || 'https://duckduckgo.com/?q=',
  locale: process.env.LOCALE || 'ar',
  pulseSink: process.env.PULSE_SINK || 'cb.monitor',
  downloadDir: process.env.DOWNLOAD_DIR || '/tmp/cb-downloads',
  maxBufferedBytes: num(process.env.MAX_BUFFERED_BYTES, 4 * 1024 * 1024),
};

export function validateConfig(c = config) {
  const errors = [];
  if (!c.accessKey || c.accessKey.length < 12) {
    errors.push('ACCESS_KEY غير مضبوط أو أقصر من 12 حرفاً. أنشئ مفتاحاً بالأمر: openssl rand -hex 16');
  }
  if (!(c.limitMbPerHour > 0 && c.limitMbPerHour <= 1000)) {
    errors.push('LIMIT_MB_PER_HOUR يجب أن يكون رقماً بين 1 و 1000');
  }
  return errors;
}
