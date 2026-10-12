#!/bin/sh
# يشغّل الشاشة الافتراضية والصوت ثم خادم التطبيق.
set -eu

export XDG_RUNTIME_DIR=/tmp/xdg-runtime
mkdir -p "$XDG_RUNTIME_DIR" && chmod 700 "$XDG_RUNTIME_DIR"

DISP="${DISPLAY:-:99}"
W="${SCREEN_WIDTH:-1280}"
H="${SCREEN_HEIGHT:-720}"

if [ "${CAPTURE_MODE:-x11}" = "x11" ]; then
  # 1) شاشة افتراضية
  Xvfb "$DISP" -screen 0 "${W}x${H}x24" -nolisten tcp -ac >/tmp/xvfb.log 2>&1 &
  i=0
  until DISPLAY="$DISP" xdotool getdisplaygeometry >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then echo "فشل تشغيل Xvfb"; cat /tmp/xvfb.log; exit 1; fi
    sleep 0.25
  done

  # 2) صوت افتراضي: مخرج وهمي (null sink) نلتقط منه الصوت بـ ffmpeg
  pulseaudio --daemonize=yes --exit-idle-time=-1 --disallow-exit -n \
    -L "module-native-protocol-unix" \
    -L "module-null-sink sink_name=cb sink_properties=device.description=CloudBrowser"
  i=0
  until pactl info >/dev/null 2>&1; do
    i=$((i + 1))
    if [ "$i" -gt 60 ]; then echo "فشل تشغيل PulseAudio"; exit 1; fi
    sleep 0.25
  done
  pactl set-default-sink cb
fi

cd /app
exec node server.js
