# Forge Next — إعادة بناء معمارية وخطة تنفيذ

**الحالة:** خطة هندسية ومرحلة إعادة البناء الأولى.  
**الفرع:** `agent/forge-next-rebuild-2026-10-16`  
**الهدف:** بناء بيئة عمل ثلاثية الأبعاد ذات طابع إنتاجي، شاشة-أولاً على الكمبيوتر وقابلة للاستخدام على الهاتف، تدعم النمذجة والمواد والأصول والأنيميشن وبناء المشاريع مع تحكم الوكيل وفحص بصري حقيقي.

## 1. لماذا لا يكفي تلميع الواجهة الحالية؟

فحص الشجرة الحالية في 16 أكتوبر 2026 أظهر أن `public/forge` يضم 45 ملفاً منفصلاً، لكن توزيع المسؤوليات غير متوازن: واجهة ضخمة في `forge-ui.js` (~37 KB)، ملف CSS كبير تتراكم فيه طبقات تصحيح إضافية (~40 KB)، مع محرك منفصل (`forge-engine.js`, ~26 KB) ووحدات وظائف مثل `forge-production.js` (~48 KB). HTML/CSS/JS تحتوي كثيراً من المعرفات العالمية والروابط المباشرة بين عناصر الصفحة وسلوك المحرك. هذه البنية تصعّب تغيير التخطيط من دون كسر سلوك قائم، ولذلك سيكون vNext واجهة جديدة بعقد محرك واضح، لا إعادة تسمية للواجهة القديمة.

**قرار المحافظة على الموجود:** لا نعيد كتابة PlayCanvas أو Rapier من الصفر. نحافظ على محرك المشهد والفيزياء واستيراد الأصول والوحدات التي تنجح في الاختبارات، ونستبدل طبقة العرض والتحكم تدريجياً خلف واجهة متوافقة. لا نحذف المحرر القديم قبل اجتياز بوابات القبول والتحقق من حفظ وفتح المشاريع.

## 2. مبادئ المنتج

1. **Viewport هو محور العمل:** أكبر مساحة ثابتة ممكنة للمشهد، وليس صفاً وسط أشرطة كثيفة.
2. **كل عنصر له موضع واضح:** قائمة المشهد، خصائص التحديد، الأصول، والخط الزمني لا تختفي داخل شريط غير مفهوم.
3. **واجهة تعتمد المهمة والسياق:** Layout، Modeling، Materials، Animation، Assets، World، Playtest، Review. تتغير الأدوات السياقية فقط عندما تكون ذات صلة، ولا تتكرر وظيفة واحدة في مواضع متضاربة.
4. **لا أزرار زينة:** كل عنصر واجهة له فعل محدد واختبار يثبته؛ الوظائف غير المتاحة تُعلّم بوضوح بدلاً من الادعاء بأنها تعمل.
5. **Docking وتغيير الحجم:** يمكن تصغير اللوحات أو إخفاؤها وإعادة فتحها وتغيير عرضها وارتفاعها، مع حفظ التخطيط لكل جهاز.
6. **اختصارات متسقة:** Q Select، W Move، E Rotate، R Scale، F Focus، Ctrl/Cmd+Z Undo، Ctrl/Cmd+Shift+Z Redo؛ يُمنع اعتراض الكتابة داخل الحقول.
7. **الهاتف ليس شاشة كمبيوتر مصغرة:** أدوات أساسية ثابتة، لوحات على شكل درج/نافذة، بدون عصا تحكم أو أزرار لعبة فوق مساحة النمذجة. أفعال Scene Playtest منفصلة بوضوح عن تشغيل Animation Timeline.
8. **مهيّأ للوكيل:** كل أمر له اسم ثابت، وصف، مدخلات/مخرجات قابلة للتحقق، وتحديث حالة صريح؛ يعمل الوكيل على حالة المحرك ثم يتحقق بصرياً.
9. **قياس الأداء أولاً:** تسجيل FPS / frame-time / GPU أو WebGL fallback / ذاكرة حيث تتاح / زمن فتح الأصول، مع إبقاء الرصد خارج مسار الرسم الحرج.
10. **التدرج دون توقف النسخة الحية:** يبقى مسار `/forge/` ثابتاً أثناء بناء `/forge-next/` بالتوازي. يتم التحويل بعد نجاح الاختبارات، وليس قبلها.

## 3. ما نتعلمه من الأدوات المرجعية

### Unreal Engine 5.6–5.8
- تقسيم ثابت بين الشريط الرئيسي، أدوات الـViewport، المشهد، Outliner، Details، Content Drawer، وشريط تشخيص.
- تجميع أوامر الـViewport في فئات منطقية، مع overflow/collapse عندما تضيق مساحة العرض.
- اختيار العنصر متزامن بين الـViewport والـOutliner والخصائص؛ الفلترة، البحث، طي المجموعات، وإخفاء العناصر جزء من إدارة المشهد.
- يجب أن تبقى أوامر التشغيل/الإيقاف والبناء منفصلة عن أدوات التحويل وعن تشغيل الأنيميشن.

مراجع:
- https://dev.epicgames.com/documentation/unreal-engine/unreal-editor-interface?lang=en-US
- https://dev.epicgames.com/documentation/unreal-engine/viewport-toolbar?lang=en-US
- https://dev.epicgames.com/documentation/unreal-engine/outliner-in-unreal-engine
- فيديو: https://www.youtube.com/watch?v=o2jiEDppycg (Unreal Engine 5.6 Viewport UI Changes، 14 مايو 2025؛ مقارنة القديم والجديد، يبدأ شرح الواجهة المحسّنة عند 02:25).
- فيديو: https://www.youtube.com/watch?v=-XHihMJrOVg (UE5.6 improved Viewport toolbar؛ overflow وSurface Snap وسلوك الأدوات).

### Blender 4.4 / بنية المناطق
- المساحات Workspaces تخطيطات متخصصة، وكل مساحة تتكون من Areas وEditors.
- Layout يعرض عادةً 3D Viewport وOutliner وProperties وTimeline؛ Modeling وAnimation تغيّران تركيز الأدوات والمحررات.
- مناطق المحرر تشمل Header، Main region، Toolbar، Sidebar؛ يمكن إظهار/إخفاء المناطق بدون تحويلها إلى عناصر عائمة عشوائية.
- التخطيط قابل للحفظ مع ملف المشروع أو كإعداد افتراضي.

مراجع:
- https://docs.blender.org/manual/en/4.4/interface/window_system/workspaces.html
- https://docs.blender.org/manual/en/4.4/interface/window_system/areas.html
- https://docs.blender.org/manual/en/4.4/interface/window_system/regions.html

### PlayCanvas واعتبارات محرر الويب
- فصل Toolbar وHierarchy وViewport وInspector وAssets.
- التحديد من القائمة والـViewport يجب أن ينتج الحالة نفسها.
- مراعاة اختصارات الكاميرا والتحويل، ومنع أحداث لوحة المفاتيح الخاصة بالاختصارات عند التحرير النصي.
مراجع:
- https://developer.playcanvas.com/user-manual/editor/interface/
- https://developer.playcanvas.com/user-manual/editor/interface/keyboard-shortcuts/
- https://developer.playcanvas.com/user-manual/editor/interface/inspector/

**ملاحظة البحث:** مصادر الوثائق وأوصاف الفيديو وفهارسها تمت مراجعتها. لم يُنفّذ في هذه المرحلة تحليل بكسل-ببكسل لكل إطار من فيديوهات يوتيوب؛ لن نعرض هذه الخطوة على أنها قد حدثت. تحليل الحركة الحقيقي لاحقاً يكون عبر تسجيل شاشة Chromium ومقارنة الحالات البصرية قبل/بعد كل فعل.

## 4. معمارية vNext المقترحة

### طبقة العرض
- `forge-next/index.html`: الهيكل الدلالي فقط، بلا سلوك محرّك متداخل في HTML.
- `forge-next/styles/tokens.css`: ألوان، مسافات، أحجام خطوط، حدود، طبقات Z، تركيز لوحة المفاتيح.
- `forge-next/styles/shell.css`: شبكة التطبيق وإدارة المناطق المستجيبة.
- `forge-next/styles/panels.css`: رؤوس اللوحات والجداول والخصائص والمجموعات.
- `forge-next/styles/viewport.css`: تراكبات الـViewport وأدواته فقط.
- `forge-next/styles/mobile.css`: تخطيط الهاتف والدرج السفلي وإجراءات اللمس.

### طبقة التطبيق
- `app/workspace-controller.js`: تنقّل المساحات، تحميل layout، استعادة الأوضاع، وتحديد الأدوات السياقية.
- `app/panel-layout.js`: تغيير حجم اللوحات، collapse/dock، حفظ الأبعاد، وقيود الحد الأدنى/الأقصى.
- `app/command-registry.js`: سجل موحد للأوامر وطرق التنفيذ والاختصارات والتعطيل.
- `app/selection-model.js`: مصدر موحد للتحديد والتزامن بين الـViewport والقائمة والمفتش.
- `app/keyboard-router.js`: يوجّه الاختصارات وفق التركيز والسياق مع تجاهل input/textarea/contenteditable.
- `app/persistence.js`: versioned editor prefs، layout، recents. بيانات المشهد تحفظ عبر تنسيق مشروع محدد لا عبر HTML.
- `app/engine-adapter.js`: الواجهة الوحيدة التي تستخدمها طبقة UI للوصول إلى المحرك؛ تمنع ارتباط مكونات الواجهة بعناصر DOM القديمة.
- `app/diagnostics.js`: قياس frame time، حالات التحميل، أخطاء الوحدات، وحالة جاهزية المحرك.
- `app/agent-bridge.js`: أوامر موحدة وحالة قابلة للفحص، مع نتائج فعلية وأدلة.

### عقود المحرك
- `EngineAdapter.init(canvas, options)`
- `getSceneSnapshot()` / `getSelection()` / `select(id)`
- `createPrimitive(kind)` / `deleteSelection()` / `duplicateSelection()`
- `transformSelection({position, rotation, scale})`
- `setViewportMode(mode)` / `frameSelection()` / `setSnap(config)`
- `playScene()` / `stopScene()` **مستقلان تماماً** عن `playTimeline()` / `pauseTimeline()`
- `importAssets(files)` / `exportProject()` / `loadProject(data)`
- `subscribe(event, handler)` / `getDiagnostics()`

الواجهة لا تتعامل مباشرةً مع كائنات PlayCanvas؛ تعمل من خلال هذه العقود، مما يسمح بتغيير المحرك أو تشغيل أوامر وكيل دون إعادة كتابة اللوحات.

## 5. تخطيط الشاشة المستهدف

### Desktop (عرض عمل 1440×900 مرجعي)
- **Top menu (28–32 px):** File, Edit, Object, View, Window, Help + اسم المشروع والحالة.
- **Workspace tabs (34–38 px):** Layout, Modeling, Materials, Animation, Assets, World, Playtest, Review.
- **Viewport header (34–40 px):** أدوات Select/Move/Rotate/Scale، snapping، منظور العرض، view mode، overflow.
- **Left dock (240–280 px):** Hierarchy/Scene أو Asset Browser بحسب تبويب اللوحة.
- **Center viewport:** يشغل المساحة المتبقية؛ أشرطة رفيعة، Grid/axes/gizmos منفصلة عن عناصر المشهد.
- **Right dock (280–340 px):** Inspector بتقسيمات Transform, Geometry, Material, Physics, Animation, Metadata.
- **Bottom timeline (140–190 px):** يظهر أساساً في Animation أو عند فتحه؛ مستقل عن Playtest.
- **Status/diagnostics (22–26 px):** الكيان المحدد، الوحدات، وضع الكاميرا، FPS/frame time، عدد العناصر، حالة الحفظ.

### Mobile
- Canvas بارتفاع مرن ومريح، من دون تغطية مستمرة بتراكبات كبيرة.
- شريط علوي يحوي اسم المشروع وأزرار Save/Build/Preview بأيقونات واضحة ووسوم ARIA.
- أدوات Select/Move/Rotate/Scale في شريط أفقي قابل للتمرير مع مؤشر وضع نشط.
- درج سفلي للتبديل بين Scene وProperties وAssets وAnimation؛ يفتح كلوحة قابلة للتمرير.
- دعم اللمس: نقرتان/سحب/قرص وفق وضع الكاميرا؛ لا تمرير الصفحة أثناء إيماءات الـViewport.
- لا توجد أدوات تحكم لعبة مرئية خارج وضع Playtest. في Playtest فقط يمكن ظهور عناصر تحكم خاصة باللعبة، ولا تؤثر في تخطيط التحرير.

## 6. خارطة التنفيذ والبوابات

### Gate 0 — تثبيت خط الأساس
- تسجيل commit الحالي، نتائج البناء والاختبارات، لقطات Desktop/Mobile، وHTTP smoke للنسخة الحية.
- عدم إجراء حذف من المسار الحالي. الفرع الجديد نقطة العمل.

### Gate 1 — واجهة shell جديدة
- بناء `public/forge-next/` بالتوازي: تخطيط دلالي، أشرطة ولوحات ومساحات عمل ودرج هاتف.
- لا أزرار لعبة في وضع التحرير؛ لا أشرطة عائمة دائمة.
- تغيير حجم اللوحات وحفظ التخطيط وإعادة ضبط التخطيط.
- اختبارات: عناصر DOM فريدة، overflow أفقي = 0، مناطق قابلة للنقر، التنقل بلوحة المفاتيح، قياسات لوحة العرض.

### Gate 2 — Engine Adapter
- ربط vNext بالمحرك الحالي خلف عقد صغير.
- اختيار متزامن بين viewport وhierarchy وinspector.
- تأكيد استيراد الأصول/إنشاء عنصر/تحويل/حذف/تراجع وإعادة/حفظ وفتح مشروع.

### Gate 3 — Workspaces حقيقية لا مجرد تبويبات
- Layout: المشهد/Hierarchy/Inspector.
- Modeling: إنشاء عناصر وأدوات التحويل والمراجع/القياس.
- Materials: تحرير المواد ومعاينة القوام.
- Animation: timeline/playhead/keyframes مستقل عن Playtest.
- Assets: browser/import/audit.
- World: terrain/lighting/environment.
- Playtest: وضع مستقل يعطل أوامر التعديل ويكشف إيقافاً واضحاً.
- Review: QA وdiagnostics وasset reports.

### Gate 4 — أداء وجودة
- مقياس FPS/frame time قبل وبعد على مشهد قياسي، 100/1,000/10,000 عنصر حيث قدرة محرك الويب تسمح، واستيراد GLB بثلاثة أحجام مرجعية.
- منع إعادة بناء اللوحة كاملة مع كل إطار أو تغير بسيط بالاختيار.
- عزل أحداث لوحة المفاتيح، تفريغ listeners عند إغلاق اللوحات، ومراقبة الذاكرة/تسرب WebGL عند تكرار فتح المشروع.
- فشل الاختبار يمنع دمج vNext.

### Gate 5 — الوكيل البصري
- أدوات agent تستدعي command registry وليس DOM click الخام قدر الإمكان.
- كل أمر يعيد الحالة السابقة/اللاحقة ومعرّف العنصر وسبب الفشل؛ التقاط screenshot عند نقاط التحقق.
- الاختبار من خلال Chromium الحقيقي ولقطات ثابتة ومقارنة pixel-diff، لا ادعاء "رؤية مباشرة" دون وسيلة تصوير نشطة.

### Gate 6 — الاستبدال الآمن
- مقارنة جميع السيناريوهات مع المحرر الحالي.
- تحويل `/forge/` إلى vNext فقط بعد اكتمال الاختبارات والاختبار اليدوي.
- إبقاء واجهة legacy ومسار رجوع قابل للتشغيل حتى تمر دورة إصدار كاملة.

## 7. معايير قبول قابلة للقياس

- Build + جميع اختبارات الوحدة وSyntax تمر.
- Chromium Desktop وMobile يمران من التحميل إلى إنشاء/اختيار/تحويل/حذف/Preview/Timeline.
- لا أخطاء JavaScript غير معالجة أو طلبات ملفات فاشلة.
- لا أزرار مكررة بمعرفات متكررة؛ لا عنصر من أشرطة التحرير يغطي viewport دون قصد.
- لا overflow أفقي على 360×800 و390×844 و768×1024 و1365×768 و1920×1080.
- اللوحات يمكن تصغيرها وتغيير أبعادها وإعادة فتحها؛ التخطيط المحفوظ قابل لإعادة التحميل.
- فصل صارم بين Scene Playtest وAnimation Timeline.
- التحديد في Viewport/Hierarchy/Inspector متزامن.
- كل أمر ظاهر يعمل فعلياً أو يكون معطلاً مع سبب مفهوم.
- الأداء يقاس مقابل خط الأساس قبل تحديد هدف تحسين رقمي، لا اختيار نسبة اعتباطية.

## 8. مخاطر يجب تجنبها

- **إعادة كتابة كل الوظائف والمحرك دفعة واحدة:** تزيد خسارة الأنظمة الموجودة؛ نعيد بناء الواجهة وعقودها تدريجياً.
- **واجهة جميلة بلا وظائف:** كل زر يرتبط بسجل أوامر واختبار.
- **UI داخل ملف واحد:** يمنع؛ كل وحدة لها حدود واختبار.
- **تبويبات هي مجرد CSS:** يجب أن تغيّر layout والأدوات المرئية والسياق فعلاً.
- **تضارب localStorage مع بيانات المشاريع:** الإعدادات لها schema/version مستقل، وملف المشروع يحتوي حالة المشهد فقط.
- **إجبار الهاتف على نمط Desktop:** نعتمد drawers وtouch targets وإيماءات متناسبة.
- **تحديث حي قبل QA:** vNext لا يحل محل legacy حتى يتم التحقق من التوافق.

## 9. إقرار بالتقدم الحالي

تم إنشاء الفرع المخصص لإعادة البناء كي لا نخاطر باستقرار النسخة الحية. الخطوة التنفيذية التالية هي بناء shell متوازٍ في `public/forge-next/` مع عقود وحدات واضحة، ثم اختباره وتطويره بعيداً عن واجهة الإنتاج الحالية حتى يثبت أنه أفضل في الشكل والسلوك والأداء.
