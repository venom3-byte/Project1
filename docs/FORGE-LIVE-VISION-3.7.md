# Forge Live Vision 3.7 — Technical Design & Verification

## الهدف
هذه النسخة تفصل «الرؤية» عن مفهوم لقطة الشاشة الواحدة. جلسة Vision حقيقية تفتح متصفح Playwright مخصصًا، ثم تبث محتوى الصفحة بصورة مستمرة عبر Playwright Screencast وتستقبل أوامر إدخال حقيقية على الجلسة نفسها.

المسار:
1. VisionController يملك جلسة المتصفح والصفحة.
2. page.screencast.start({ onFrame }) يلتقط إطارات JPEG حية.
3. /api/vision/stream يبث الإطارات كـ multipart MJPEG متصل، وليس سلسلة طلبات screenshots.
4. /vision يمرر أوامر التحكم في قناة WebSocket مستقلة.
5. أوامر الماوس والكيبورد تستخدم Playwright Input APIs.
6. أوامر اللمس منخفضة المستوى تستخدم CDP Input.dispatchTouchEvent.
7. كل فعل يرجع رقم الإطار قبل/بعد التنفيذ، بحيث يمكن التحقق أن المتصفح استقبل الفعل وأن جلسة الرؤية ما زالت حية.
8. state وelements هما قناة تحقق منظمة تكمل الرؤية البصرية ولا تستبدلها.

## لماذا هذا التصميم
Playwright 1.59 أضاف page.screencast كواجهة موحدة لبث الإطارات في الوقت الحقيقي، مع callback يعطي JPEG وtimestamp وأبعاد viewport. كما توفر Playwright أدوات الماوس والكيبورد، بينما يتيح Chrome DevTools Protocol أحداث اللمس منخفضة المستوى.

## ما يتم اعتباره دليلاً
الاختبار tests/vision.live.spec.mjs يغطي:
- استمرار الإطارات وتقدم رقم الإطار بمرور الزمن.
- صحة استجابة multipart المستمرة وبنية JPEG.
- تحكم mouse move/down/up على إحداثيات حقيقية من واجهة Forge.
- سحب حقيقي mouse.drag.
- عجلة التمرير.
- لوحة المفاتيح الحقيقية مع Control+Z وControl+Y والتحقق من عدد الكيانات.
- touchStart/touchMove/touchEnd عبر CDP.
- قراءة حالة Forge بعد التفاعل للتأكد أن الفعل وصل إلى التطبيق.

## الحدود المتعمدة
الرؤية المستمرة هنا هي stream حي داخل جلسة متصفح. نموذج اللغة لا يتلقى «فيديو لا نهائي» في خطوة واحدة؛ بل يتمكن عميل الرؤية من الاشتراك في stream وأخذ أحدث frame وtelemetry عند الحاجة. هذا يطابق هندسيًا نمط agents الحالي: بث مستمر + تحكم منخفض المستوى + state verification.

التقاط شاشة المستخدم المحلي عبر getDisplayMedia يبقى fallback عندما لا يكون الخادم موجودًا. Screen Capture API ينتج MediaStream حيًا، لكنه يحتاج موافقة المستخدم ويختلف دعمه بين المتصفحات؛ لذلك تم استخدامه كـfallback وليس العمود الفقري لجلسة Forge المحلية.

## الأمن
الوضع الافتراضي يسمح فقط بهدف Forge المحلي. فتح أهداف خارجية يحتاج VISION_ALLOW_REMOTE=1. يفضل إبقاء الخادم على loopback أثناء التطوير المحلي. التحكم لا يستخدم JavaScript injection كوسيلة النقر الأساسية؛ جميع أفعال الإدخال تمر عبر طبقة المتصفح نفسها.

## المرحلة التالية بعد إثبات Vision
بعد نجاح بوابة Vision، يصبح المسار المناسب هو توسيع Forge إلى pipeline أصول متعدد الوسائط: 2D raster وsprite sheets، 3D GLB/glTF مع خامة/هيكل/animation/skin، مؤثرات VFX قابلة للاستيراد أو التحويل، وصوت مع metadata وtranscoding. بعد ذلك تتم إضافة بوابات تصدير Android وWindows/Web مع smoke tests على runtime الناتج، وليس مجرد إنشاء ملف تصدير شكلي.