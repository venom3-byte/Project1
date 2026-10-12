#!/bin/sh
# اختبار مؤقت داخل GitHub Codespaces فقط (ليس للاستخدام الدائم ولا لتصفح شخصي).
# يثبت الأدوات، ويشغّل المسار الحقيقي: Xvfb + PulseAudio + Chromium + ffmpeg + xdotool + الخادم.
set -eu
cd "$(dirname "$0")/.."

echo "[1/4] تثبيت الأدوات..."
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb xdotool ffmpeg pulseaudio pulseaudio-utils fonts-noto-core fonts-liberation >/dev/null

echo "[2/4] تثبيت Chromium..."
npx --yes @puppeteer/browsers install chrome@stable > .chrome-install.log 2>&1 || true
CHROME_BIN=$(tail -1 .chrome-install.log | sed 's/^[^ ]* //')
if [ ! -x "$CHROME_BIN" ]; then
  # بديل: ابحث عن الملف مباشرة إن لم يُطبع المسار بالشكل المتوقع
  CHROME_BIN=$(find "$HOME/.cache/puppeteer" . -path '*chrome-linux*' -name chrome -type f 2>/dev/null | head -1)
fi
[ -x "${CHROME_BIN:-/nonexistent}" ] || { echo "فشل تثبيت Chromium. سجل التثبيت:"; cat .chrome-install.log; exit 1; }
echo "Chromium: $CHROME_BIN"

echo "[3/4] تثبيت الحزم وإعداد المفتاح..."
npm install --omit=dev --silent
[ -f .env ] || ./scripts/init-env.sh >/dev/null
echo "مفتاح الدخول:"; grep '^ACCESS_KEY=' .env | cut -d= -f2

echo "[4/4] تشغيل الخادم (أوقفه بـ Ctrl+C بعد الاختبار)"
export CHROMIUM_BIN="$CHROME_BIN" FFMPEG_BIN=ffmpeg XDOTOOL_BIN=xdotool DISPLAY=:99 PORT=8080 CAPTURE_MODE=x11
# Chrome يحتاج --no-sandbox داخل الحاوية/Codespace، وهو مضبوط في lib/browser.js
exec ./scripts/entrypoint.sh
