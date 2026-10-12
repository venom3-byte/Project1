#!/bin/sh
# ينشئ ملف .env مع مفتاح دخول عشوائي (إن لم يكن موجوداً).
set -eu
cd "$(dirname "$0")/.."
if [ -f .env ]; then
  echo "ملف .env موجود بالفعل، لم أغيّره."
  grep '^ACCESS_KEY=' .env | sed 's/=.*/=  (المفتاح محفوظ في .env)/'
  exit 0
fi
KEY=$(openssl rand -hex 16 2>/dev/null || head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')
cat > .env <<ENV
# مفتاح الدخول من الهاتف. احتفظ به.
ACCESS_KEY=$KEY
# الحد الأقصى للاستهلاك خلال 60 دقيقة بالميغابايت (الشرط الأساسي)
LIMIT_MB_PER_HOUR=50
# الصفحة الأولى عند فتح المتصفح
START_URL=https://duckduckgo.com/
# اللغة
LOCALE=ar
ENV
chmod 600 .env
echo "تم إنشاء .env. مفتاح الدخول الخاص بك هو:"
echo "$KEY"
echo "احفظه في مكان آمن، فهو مطلوب لفتح المتصفح من الهاتف."
