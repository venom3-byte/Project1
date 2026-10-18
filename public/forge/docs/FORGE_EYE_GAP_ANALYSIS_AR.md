# Forge Eye — مراجعة الفجوات وخطة التطوير مقارنةً بـ Blender وUnreal Engine

**الحالة:** وثيقة هندسية للمراجعة؛ تميّز بين ما نُفّذ في فرع التطوير، وما ثبت بالاختبار، وما لا يزال خطة. لا تعني هذه الخطة أن Forge Eye أصبح بديلًا كاملًا لـ Blender أو Unreal Engine.

## 1. قراءة الصور المرجعية المرفقة

### الصورة الأولى: Blender، نافذة العرض وShader Editor وMaterial Properties
- **نافذة العرض:** المجسم مرئي كجسم ثلاثي الأبعاد داخل مشهد، وتظهر الكاميرا/الإضاءة في سياق المشهد. المطلوب في Forge Eye أن يظل الـViewport عرضًا حيًا للمشهد، لا صورة ثابتة أو رسماً توضيحياً؛ اختيار الجسم يجب أن يشير إلى كيان المشهد نفسه، وتحويله يجب أن يغيّر بيانات المشروع.
- **Shader Editor:** العقد موصولة بخطوط بين مداخل ومخارج، ما يسمح بفهم تدفق خصائص المادة. Forge Eye لديه الآن محرر خصائص PBR على مستوى المادة، لكنه **لا يملك بعد محرر عقد ماديًا كاملًا**. المرحلة اللاحقة يجب أن تضيف عقدًا واضحة (Texture, Base Color, Normal, Metallic, Roughness, Alpha/Transmission, Emission) وروابط محفوظة في ملف المشروع.
- **Material Properties:** قيم المادة جزء من بيانات الكيان، لا ألوان مرسومة فوق المشهد. لذلك تم تصحيح إعداد المادة الافتراضية في Forge Eye لتستخدم إضاءة المشهد؛ أضيفت قيم Metalness وRoughness وOpacity وPresets. الشفافية الحالية معاينة ألفا ملوّنة وليست انكسارًا ضوئيًا واقعيًا.

### الصورة الثانية: قائمة إجراءات داخل الـViewport
- القائمة المنبثقة تختصر العمليات الشائعة وتعرض الاختصارات قرب موضع العمل، من دون تغيير المشروع إلى صورة أو صفحة منفصلة.
- الفائدة في Forge Eye هي توفير **قائمة سياقية** مرتبطة بالعنصر المحدد: تحويل، إضافة كاميرا، إضافة ضوء، إعداد Pivot، نسخ، حذف، وتثبيت/فك التثبيت. يجب أن تتصل كل عملية ببيانات الكيان وUndo/Redo؛ لا تضاف أزرار مظهرية لا تنفّذ فعلاً.
- تم البدء بتثبيت التفاعل الأساسي وأدوات Inspector. قائمة سياقية كاملة في الـViewport وحماية الاختصارات من تعارضات الهاتف ما زالت ضمن أعمال الواجهة التالية.

## 2. المراجعة التفصيلية — الوظيفة والفائدة والفجوة

| المجال | مرجع Blender / Unreal | الحالة الحالية في Forge Eye | الخطوة الهندسية التالية |
|---|---|---|---|
| تحريك/تدوير/تحجيم | Blender G/R/S ومقابض التحويل؛ Unreal Modeling Gizmo يجمع التحويلات | أضيف مسار سحب بديل لموضع/دوران/حجم الجسم عندما لا تكون Gizmos الأصلية متاحة؛ يشمل Snap وHistory وAuto Key | مقابض مرئية X/Y/Z، محور/مستوى حر، World/Local، Pivot/Median، حدود اختيار واضحة، واختبار سحب فعلي على سطح اللمس |
| Scene Hierarchy | Outliner في Blender وWorld Outliner في Unreal | قائمة عناصر فعلية، تحديد، خصائص، وحفظ/تحميل؛ بدأ إظهار التداخل الهرمي للأجسام | طي/فتح الأبناء، إعادة ترتيب بالسحب، قفل/إخفاء، مجموعات، وتحديد متعدد |
| هندسة الشبكة Mesh | Extrude / Inset / Bevel / Loop Cut / Subdivide / Mirror / Boolean في Blender وModeling Mode في Unreal | بدائيات، Lathe بملف مقطع قابل للتحرير، بروز حدود صورة، وإعادة بناء Visual Hull خشنة من مسقطين/ثلاثة | وضع Edit Mesh مستقل مع تحديد Vertex/Edge/Face؛ ثم Extrude/Inset/Bevel/Loop Cut، وبعدها Mirror/Boolean/Subdivision وقياسات/تحقق من Manifold |
| شكل من صورة | تتبع حدود الصورة ثم بناء شبكة؛ Unreal يدعم رسم/بثق مضلّعات ومسارات | أضيف استخراج محلي لحدود أكبر جسم من PNG شفاف أو خلفية متجانسة، ثم معاينة الحدود وبناء مجسم ذي عمق | أدوات تنظيف القناع، تعديل الحدود، الثقوب والأجزاء المتعددة، تحديد مقياس حقيقي، إسناد Texture، ثم segmentation متقدم اختياري مع إظهار الثقة |
| إعادة البناء من عدة مساقط | مخططات Front/Side/Top وتطابق القياس والمحاور | تتبع معاير ومخزن للصور، وVisual Hull تقريبي من مسقطين أو ثلاثة | أدوات محاذاة ونقاط تناظر، معايرة وحدات، تحذير من عدم تطابق الأبعاد، مراجعة الشبكة قبل قبولها |
| المادة PBR | Principled BSDF في Blender؛ Material Editor في Unreal: Base Color/Metallic/Roughness | إضاءة فعلية افتراضية، Presets (Plastic, Paint, Metal, Rubber, Ceramic, Glass)، لون، Metalness، Roughness، Opacity | محرر عقد مادي محفوظ؛ Texture maps، Normal/Roughness/Metallic maps، IOR/Transmission، Coat، UV preview، مواد متعددة ومقارنة مرئية |
| الزجاج والانكسار | Blender Principled Transmission وIOR؛ Unreal يتطلب إعدادات شفافية/Translucency متوافقة مع الرندر | Opacity وBlend للمعاينة؛ لا يوجد انكسار أو IOR كامل | فصل Alpha عن Transmission؛ إعداد IOR/Thickness/Refraction مع فحص دعم GPU وإظهار fallback صريح على الهاتف |
| الإنارة | أنواع أضواء، لون، شدة، مدى، ظل؛ خصائص الإضاءة يمكن أن تكون مسارات أنيميشن | Inspector يضبط Directional/Point/Spot، اللون، الشدة، المدى، مخروط Spot والظلال | Environment/HDRI، ضبط تعريض/إضاءة للمشهد، معاينة حدود المدى، حفظ presets، واختبار الأداء عند تعدد الأضواء |
| الكاميرا | Blender Camera Data؛ Unreal Cine Camera/Sequencer | كاميرا نشطة، FOV، منظور/إسقاط متعامد؛ خصائص الكاميرا ومسار تحويلها مدعومة في نظام المفاتيح | Piloting واضح، قفل الكاميرا، focal length/filmback، clipping، depth of field وExposure تدريجيًا |
| Animation / Graph | Dope Sheet وGraph Editor؛ Unreal Sequencer | مفاتيح transforms، Linear/Ease/Hold، Autokey، قنوات Light/Camera جديدة قابلة للرسم والتعديل | تحديد متعدد للمفاتيح، handles/tangents Bezier، نسخ/لصق، markers، loop، فصل Tracks وNLA-like clips |
| Rig / Skeleton | Armatures وBone Constraints/IK في Blender؛ Control Rig في Unreal | أضيفت Pivot hierarchy وFK للأجزاء الصلبة المنفصلة؛ مواضع الأبوين/الأبناء تحفظ في المشروع | Bones حقيقية، rest pose، skinning weights/weight paint، IK/constraints، control shapes، ثم اختبار شخصية بسيطة وجناح/عجلة بمراجع مستقلة |
| المشروع والتصدير | أصول مشروع قابلة لإعادة الفتح والتصدير | حفظ JSON، تصدير OBJ/ملفات موجودة بحسب الأداة؛ أضيف حفظ علاقات Parent/Child | صيغة ملف ذات إصدار وترحيل آمن، اختبار round-trip، وحدات/محاور، مواد وTextures، ثم GLB/glTF مع تحقق من النتيجة |
| UX الهاتف | أدوات تلامس ومساحات جانبية قابلة للطي | إغلاق اللوحات على الهاتف عند تبديل Workspace؛ اختبارات 390 و360 بكسل موجودة في Smoke Suite | مقابض لمس أكبر، gesture conflict rules، أدوات قابلة للطي، أزرار Undo/Redo ظاهرة، وعدم التضحية بالـViewport |

## 3. لماذا لا يكفي جعل الشكل «يشبه» Blender؟

الأجزاء التي يجب أن تكون **بيانات حقيقية**:
1. Transform: موقع ودوران وحجم محفوظة في كيان المشهد.
2. Mesh: رؤوس/حواف/وجوه وفهارس وNormals وTopology، لا مجرد صورة للمجسم.
3. Material: قيم PBR والخرائط والروابط محفوظة ويمكن إعادة تحميلها.
4. Light/Camera: Components قابلة للتعديل والتنشيط والتحريك بمفاتيح.
5. Rig: Hierarchy وTransforms، وبعدها Skeleton/Skinning فعليان، وليس أسماء عظام مرسومة فقط.
6. Animation: مفاتيح وCurves تقيم عند الزمن؛ يجب أن تغيّر حالة المشهد نفسها.
7. QA: الاختبار يقيس التغيير في Transform/Material/Mesh ومخرجات التصدير ويعيد فتح المشروع للتحقق من بقاء البيانات.

## 4. ترتيب التنفيذ المقترح

### P0 — منع الأعطال الأساسية
- تمرير Chromium Desktop وMobile لكل تعديل.
- تغيير Transform فعليًا بالسحب ثم Undo/Redo والتحقق من القيمة المخزنة.
- إظهار خطأ واضح بدل تجاهل أمر مادة/كاميرا/ضوء.
- حفظ وإعادة فتح المشهد مع material/light/camera/parent hierarchy دون فقدان البيانات.

### P1 — أدوات بناء الأشكال
- تحويل الـfallback الحالي إلى مقابض محور/مستوى مرئية.
- تطبيق Extrude وInset وBevel على شبكة قابلة للتحرير مع فحوصات topology.
- دعم صورة ذات خلفية شفافة أو بسيطة، ثم قناع قابل للتنظيف وContour محفوظ؛ لا تدّعِ استنتاج الأسطح المخفية من صورة واحدة.
- إضافة material node graph بمدخلات ومخرجات حقيقية.

### P2 — التحريك والإضاءة
- إكمال أدوات الكاميرا والـlight property tracks.
- Bezier graph handles وتحديد مفاتيح متعددة.
- بناء FK/Pivots للأجزاء الصلبة، ثم Bones/Skin weights/IK كمرحلة منفصلة؛ لا تسمية Pivot rig بأنه armature كامل.

### P3 — جودة أصول الإنتاج
- UV tools، خرائط PBR، import/export متحقق، collision/physics، LODs وتحسين الأداء.
- مرجع بصري لكل أصل مع مقياس ومحاور واضحة، واختبارات هندسية لا تعتمد على الحكم البصري وحده.

## 5. مراجع تقنية أصلية

### Blender 5.2 Manual
- [Principled BSDF: Metalness, Roughness, Alpha, IOR, Transmission](https://docs.blender.org/manual/en/latest/render/shader_nodes/shader/principled.html)
- [Viewport Gizmos: محور X/Y/Z والتحويل الحر والمقيّد](https://docs.blender.org/manual/en/latest/editors/3dview/display/gizmo.html)
- [Armature Skinning: parenting مقابل تشويه الشبكة بالأوزان](https://docs.blender.org/manual/en/5.0/animation/armatures/skinning/introduction.html)
- [Extrude](https://docs.blender.org/manual/en/latest/modeling/meshes/editing/mesh/extrude.html)
- [Loop Cut](https://docs.blender.org/manual/en/latest/modeling/meshes/tools/loop.html)
- [Bone Constraints / IK](https://docs.blender.org/manual/en/latest/animation/armatures/posing/bone_constraints/introduction.html)
- [Pose Mode and Armature controls](https://docs.blender.org/manual/en/latest/animation/armatures/posing/index.html)

### Unreal Engine 5.8 Documentation
- [Modeling Tools: Select, Transform, Deform, Mesh, Voxel, UVs](https://dev.epicgames.com/documentation/en-us/unreal-engine/modeling-tools-in-unreal-engine)
- [Modeling Mode Quick Start](https://dev.epicgames.com/documentation/en-us/unreal-engine/modeling-mode-quick-start-in-unreal-engine)
- [Physically Based Materials: Metallic/Roughness/Base Color](https://dev.epicgames.com/documentation/en-us/unreal-engine/physically-based-materials-in-unreal-engine)
- [Transparency in Materials](https://dev.epicgames.com/documentation/en-us/unreal-engine/using-transparency-in-unreal-engine-materials)
- [Control Rig](https://dev.epicgames.com/documentation/en-us/unreal-engine/rigging-with-control-rig-in-unreal-engine)
- [Control Rig Elements: Controls, Bones and Nulls](https://dev.epicgames.com/documentation/en-us/unreal-engine/controls-bones-and-nulls-in-control-rig-in-unreal-engine)
- [Create camera animation in Sequencer](https://dev.epicgames.com/documentation/en-us/unreal-engine/how-to-animate-cinematic-cameras-in-unreal-engine)
- [Animate light intensity and color in Sequencer](https://dev.epicgames.com/documentation/en-us/unreal-engine/how-to-animate-lights-in-unreal-engine)

### محرك Forge Eye
- [PlayCanvas StandardMaterial reference](https://api.playcanvas.com/engine/classes/StandardMaterial.html)
- [PlayCanvas LightComponent reference](https://api.playcanvas.com/engine/classes/LightComponent.html)

## 6. بوابة القبول

لا تُعد أي ميزة «منجزة» لمجرد ظهور لوحة أو زر. شروط القبول:
- حدث فعلي في الـViewport أو Inspector؛
- تغير قابل للقياس في بيانات المشهد؛
- حفظ/تحميل يحافظ على النتيجة؛
- اختبار Chrome Desktop واختبار هاتف؛
- عدم وجود JavaScript errors أو failed asset requests؛
- لقطة شاشة تُظهر النتيجة الحقيقية بعد التغيير، مع توضيح أي تقريبات أو ميزات مؤجلة.
