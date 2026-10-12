#!/bin/sh
# اختبار مؤقت داخل GitHub Codespaces فقط (ليس للاستخدام الدائم ولا لتصفح شخصي).
# يثبت الأدوات، ويشغّل الخادم في الخلفية، ويطبع التشخيص، ثم يعرض السجل المباشر.
set -eu
cd "$(dirname "$0")/.."

echo "[1/5] تثبيت الأدوات..."
sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq xvfb xdotool ffmpeg pulseaudio pulseaudio-utils fonts-noto-core fonts-liberation >/dev/null

echo "[2/5] تثبيت Chromium..."
npx --yes @puppeteer/browsers install chrome@stable > .chrome-install.log 2>&1 || true
CHROME_BIN=$(tail -1 .chrome-install.log | sed 's/^[^ ]* //')
if [ ! -x "$CHROME_BIN" ]; then
  CHROME_BIN=$(find "$HOME/.cache/puppeteer" . -path '*chrome-linux*' -name chrome -type f 2>/dev/null | head -1)
fi
[ -x "${CHROME_BIN:-/nonexistent}" ] || { echo "فشل تثبيت Chromium. سجل التثبيت:"; cat .chrome-install.log; exit 1; }
echo "Chromium: $CHROME_BIN"

echo "[3/5] تثبيت الحزم وإعداد المفتاح..."
npm install --omit=dev --silent
[ -f .env ] || ./scripts/init-env.sh >/dev/null
echo "مفتاح الدخول:"; grep '^ACCESS_KEY=' .env | cut -d= -f2

echo "[4/5] تشغيل الخادم في الخلفية (السجل في server.log)..."
export CHROMIUM_BIN="$CHROME_BIN" FFMPEG_BIN=ffmpeg XDOTOOL_BIN=xdotool DISPLAY=:99 PORT=8080 CAPTURE_MODE=x11
./scripts/entrypoint.sh > server.log 2>&1 &
i=0
until curl -fs http://127.0.0.1:8080/healthz >/dev/null 2>&1; do
  i=$((i + 1)); [ "$i" -gt 120 ] && { echo "الخادم لم يبدأ. آخر السجل:"; tail -40 server.log; exit 1; }
  sleep 1
done
echo "الخادم يعمل."

echo "[5/5] التشخيص:"
sleep 5
sh scripts/diagnose.sh 2>&1 | tee diag.txt

echo ""
echo "== السجل المباشر (افتح الرابط في تبويب Ports، المنفذ 8080). اضغط Ctrl+C للإيقاف."
tail -n 50 -f server.log
