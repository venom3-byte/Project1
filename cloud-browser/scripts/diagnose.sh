#!/bin/sh
# تشخيص شامل: يطبع PASS أو FAIL لكل عنصر، ويقيس معدل الفيديو الفعلي لـ 15 ثانية.
DISP="${DISPLAY:-:99}"
CHROME="${CHROMIUM_BIN:-/usr/bin/chromium}"
ok()  { echo "PASS $1"; }
bad() { echo "FAIL $1"; }

echo "== النظام"
uname -sm
node -v 2>/dev/null || bad "node"

echo "== الأدوات"
for t in Xvfb xdotool ffmpeg pulseaudio pactl; do
  if command -v "$t" >/dev/null 2>&1; then ok "$t"; else bad "$t غير موجود"; fi
done
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libx264; then ok "libx264"; else bad "libx264"; fi
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q libopus; then ok "libopus"; else bad "libopus"; fi
if [ -x "$CHROME" ]; then ok "chromium: $("$CHROME" --version 2>/dev/null | head -1)"; else bad "Chromium غير موجود في $CHROME"; fi

echo "== الشاشة (DISPLAY=$DISP)"
if DISPLAY="$DISP" xdotool getdisplaygeometry 2>/dev/null; then ok "Xvfb يعمل"; else bad "Xvfb لا يعمل"; fi

echo "== الصوت"
DEF=$(pactl get-default-sink 2>/dev/null)
echo "default sink: ${DEF:-غير معروف}"
if pactl list short sources 2>/dev/null | grep -q 'cb.monitor'; then ok "cb.monitor موجود"; else bad "cb.monitor غير موجود (PulseAudio لا يعمل؟)"; fi

echo "== الذاكرة المشتركة"
df -h /dev/shm 2>/dev/null | tail -1

echo "== قياس الترميز الفعلي (15 ثانية، 480p بـ 78kbps + صوت 16kbps)"
rm -f /tmp/cb-diag.mp4
if ffmpeg -hide_banner -loglevel error -y \
    -f x11grab -framerate 15 -video_size 1280x720 -draw_mouse 0 -i "$DISP" \
    -f pulse -i cb.monitor -t 15 \
    -vf "fps=15,scale=854:480" -c:v libx264 -preset veryfast -tune zerolatency \
    -b:v 78k -maxrate 78k -bufsize 78k -c:a libopus -b:a 16k -ac 1 \
    -f mp4 -movflags empty_moov+default_base_moof+frag_keyframe /tmp/cb-diag.mp4 2>/tmp/cb-diag.err; then
  SIZE=$(stat -c%s /tmp/cb-diag.mp4 2>/dev/null || echo 0)
  MBH=$(awk "BEGIN{printf \"%.1f\", $SIZE*3600/15/1000000}")
  ok "الالتقاط والترميز يعملان: الحجم=${SIZE} بايت، المعدل ≈ ${MBH} MB/ساعة (الهدف ≈ 44)"
else
  bad "فشل الالتقاط أو الترميز"
  echo "--- رسالة ffmpeg:"; tail -5 /tmp/cb-diag.err
fi

echo "== انتهى التشخيص"
