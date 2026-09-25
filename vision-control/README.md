# Vision Control Bridge

طبقة Eyes + Hands لـ Asset Forge Studio.

الطبقات:
1. Playwright/CDP للتحكم الحقيقي في Chromium.
2. DOM inventory لتحديد مواقع وأبعاد العناصر التفاعلية.
3. OpenCV لقياس الشاشة السوداء وكثافة الحواف والمناطق البصرية.
4. OCR اختياري لاستخراج النص الظاهر.
5. Annotated evidence لحفظ دليل بصري من نفس الشاشة التي تم اختبارها.

يمكن الاتصال بمتصفح جديد أو بمتصفح مفتوح مسبقًا عبر CDP. عند الاتصال عبر CDP لا يغلق الجسر متصفح المستخدم.

التشغيل:
python -m pip install -r vision-control/requirements.txt
python -m playwright install chromium
python vision-control/vision_agent.py --url http://127.0.0.1:4173/ --action inspect --name asset-forge

الناتج:
- asset-forge.png: اللقطة الفعلية.
- asset-forge-annotated.png: اللقطة مع حدود العناصر والنصوص المكتشفة.
- asset-forge.json: تقرير الرؤية + DOM + أخطاء الصفحة.

لا يسجل الجسر cookies أو Authorization أو قيم الحقول الحساسة.
