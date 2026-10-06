# مواصفات Arena AI — لعبة إدارة سجن تجارية للويب
## الإصدار 1.0 — وثيقة تنفيذية قابلة للتحويل إلى مشروع فعلي

> الهدف: بناء لعبة أصلية تجارية للويب مستوحاة من عمق ألعاب إدارة السجون الحديثة، مع أنظمة مترابطة وذكاء اصطناعي وسلاسة حركة وأصول صور حقيقية مرخّصة. لا تُنسخ أي شفرة أو أصول أو أسماء أو واجهات محمية من أي لعبة أخرى.

---

# 1. أمر التنفيذ الرئيسي

أنت وكيل تطوير ألعاب تجاري كامل. لا تتعامل مع هذا الملف كمقال أو فكرة أو Prototype. حوّل المواصفات إلى مشروع ويب قابل للتشغيل، ثم اختبره بصرياً ووظيفياً، ثم أصلح الأخطاء، ثم أعد الاختبار.

المعيار هو:
**INSPECT → PLAN → IMPLEMENT → RUN → OBSERVE → MEASURE → REPAIR → RETEST → APPROVE**

لا تعتبر أي ميزة مكتملة لمجرد وجود كود لها. يجب أن تكون:
1. موجودة في الكود.
2. مرتبطة بالأنظمة الأخرى.
3. قابلة للاستخدام داخل اللعبة.
4. ظاهرة بصرياً بطريقة صحيحة.
5. مختبرة في المتصفح.
6. خالية من أخطاء Console وRuntime.
7. قابلة للحفظ والاستعادة.
8. قابلة للعمل على الهاتف والكمبيوتر.

---

# 2. نوع اللعبة

لعبة إدارة وبناء ومحاكاة لسجن ثنائي الأبعاد من منظور علوي/Isometric-lite للويب.

اللاعب هو مدير المنشأة.

المحاور الأساسية:
- البناء.
- التخطيط.
- إدارة السجناء.
- إدارة الموظفين.
- الأمن.
- الطاقة والمياه والمرافق.
- الطعام.
- النظافة.
- الاقتصاد.
- البرامج وإعادة التأهيل.
- العقوبات والانضباط.
- الطوارئ.
- الهروب.
- التحقيق في الحوادث.
- التوسع.
- الحفظ والاستعادة.
- الإحصاءات والتقارير.

يجب أن تكون اللعبة الأصلية في الهوية البصرية والمحتوى، حتى لو استلهمت عمق فئة Prison Management.

---

# 3. التقنية

الهدف الأول: Web.

التقنية المقترحة:
- TypeScript.
- Phaser 4 أو أحدث إصدار مستقر مناسب للمشروع.
- WebGL، مع مسار WebGPU اختياري عندما يكون مستقراً.
- Vite.
- ES Modules.
- Web Workers للعمليات الثقيلة عند الحاجة.
- IndexedDB للحفظ الكبير، مع localStorage للإعدادات الصغيرة.
- Canvas rendering.
- بنية ECS أو Component-based حيث تكون مفيدة.
- نظام Simulation Core مستقل عن Rendering.

قاعدة مهمة:
لا تضع منطق اللعبة داخل كود الرسم.

افصل:
Simulation → State → Systems → Renderer → Input → UI → Persistence.

---

# 4. بنية المشروع

أنشئ بنية مشابهة:

src/
  core/
    Game.ts
    Clock.ts
    EventBus.ts
    Random.ts
    Id.ts
  simulation/
    World.ts
    TimeSystem.ts
    ConstructionSystem.ts
    PrisonerSystem.ts
    StaffSystem.ts
    JobSystem.ts
    NeedsSystem.ts
    UtilitySystem.ts
    SecuritySystem.ts
    EconomySystem.ts
    ProgramSystem.ts
    EmergencySystem.ts
    WeatherSystem.ts
    SaveSystem.ts
  entities/
    Prisoner.ts
    Staff.ts
    Guard.ts
    Worker.ts
    Doctor.ts
    Cook.ts
    Janitor.ts
    DogHandler.ts
    Visitor.ts
    Vehicle.ts
  world/
    Grid.ts
    Tile.ts
    Room.ts
    Zone.ts
    Door.ts
    Wall.ts
    UtilityGraph.ts
    PathGraph.ts
  ai/
    UtilityAI.ts
    GoalSystem.ts
    NeedsPlanner.ts
    ScheduleSystem.ts
    Pathfinding.ts
    Steering.ts
  rendering/
    WorldRenderer.ts
    EntityRenderer.ts
    AnimationSystem.ts
    Camera.ts
    Effects.ts
  input/
    MouseInput.ts
    TouchInput.ts
    KeyboardInput.ts
  ui/
    HUD.ts
    BuildMenu.ts
    PrisonerPanel.ts
    StaffPanel.ts
    FinancePanel.ts
    ReportsPanel.ts
    SettingsPanel.ts
  assets/
    AssetRegistry.ts
    AssetManifest.ts
  audio/
    AudioManager.ts
    SpatialAudio.ts
  save/
    Serializer.ts
    Versioning.ts
  debug/
    DebugOverlay.ts
    PerformancePanel.ts
tests/
docs/
public/
assets/

---

# 5. قاعدة فصل المحاكاة عن الرسم

Simulation Tick لا يعتمد على FPS.

استخدم:
- Fixed timestep للمحاكاة.
- Interpolation للرسم.
- Delta time مضبوط.
- Seeded Random.

النتيجة المطلوبة:
إذا تغير FPS من 30 إلى 60 إلى 120، يجب ألا تتغير نتائج المحاكاة الأساسية.

اختبر:
- 30 FPS.
- 60 FPS.
- 90 FPS.
- 120 FPS.

أي اختلاف غير مقصود يعتبر Bug.

---

# 6. العالم والشبكة

العالم عبارة عن Grid دقيقة.

كل Tile يجب أن يحتوي على:
- coordinates.
- type.
- walkable.
- buildable.
- roomId.
- zoneId.
- movementCost.
- lightLevel.
- temperature.
- ownership.
- utility connections.
- collision flags.

أنواع الأرض:
- أرضية.
- جدار.
- باب.
- طريق.
- عشب.
- ساحة.
- ماء.
- منطقة ممنوعة.
- منطقة بناء.
- منطقة خدمة.

لا تستخدم collision مرئي غير متطابق مع الرسم.

---

# 7. الغرف

نظام الغرف يجب أن يكتشف الغرفة تلقائياً من الجدران والمداخل.

أمثلة:
- زنزانة.
- مهجع.
- مطبخ.
- مخزن.
- مطعم.
- حمامات.
- عيادة.
- مكتب طبيب.
- غرفة حراسة.
- غرفة مراقبة.
- ورشة.
- فصل تعليمي.
- صالة.
- ساحة.
- غرفة زيارة.
- مكتب إدارة.
- غرفة كهرباء.
- غرفة مياه.
- غرفة نفايات.
- مشرحة/منطقة طبية عند الحاجة.
- بوابة أمنية.

كل غرفة لها:
- capacity.
- requiredObjects.
- allowedRoles.
- cleanliness.
- securityLevel.
- temperature.
- occupancy.
- utilityRequirements.

---

# 8. البناء

نظام البناء يجب أن يعمل كالتالي:

1. اللاعب يختار العنصر.
2. يظهر Ghost Preview.
3. يوضح اللون حالة الصلاحية.
4. يتحقق النظام من:
   - المساحة.
   - collision.
   - الجدار.
   - utilities.
   - المال.
   - المتطلبات.
5. عند التأكيد ينشأ Construction Job.
6. يذهب العامل إلى الموقع.
7. يجلب المواد.
8. ينفذ البناء.
9. تتغير نسبة الإنجاز.
10. يظهر العنصر النهائي.
11. تتحدث الغرفة/المرافق.

لا تجعل البناء فورياً إلا إذا كان ذلك إعداداً خاصاً.

---

# 9. اقتصاد ومواد البناء

كل عنصر له:
- materialCost.
- labourCost.
- constructionTime.
- maintenanceCost.
- powerUsage.
- waterUsage.

المواد:
- خرسانة.
- خشب.
- معدن.
- زجاج.
- إلكترونيات.
- طعام.
- أدوات تنظيف.
- أدوية.
- ملابس.
- مستلزمات مختلفة.

يجب منع ظهور المال أو الموارد من العدم.

كل عملية مالية تسجل Event.

---

# 10. اللوجستيات

أنشئ نظام Jobs حقيقي.

أمثلة:
- Build.
- DeliverMaterial.
- CookMeal.
- CleanRoom.
- Repair.
- EscortPrisoner.
- TreatPatient.
- TransportFood.
- CollectWaste.
- DeliverLaundry.
- Patrol.
- Investigate.
- ExtinguishFire.

كل Job يحتوي:
- id.
- type.
- priority.
- source.
- destination.
- requiredSkill.
- assignedAgent.
- state.
- progress.
- createdAt.

الأولوية قابلة للتغيير حسب الخطر والوقت.

---

# 11. الذكاء الاصطناعي

لا تجعل الشخصيات تتحرك عشوائياً.

استخدم Utility AI + Goals + Needs + Schedule.

كل شخصية لديها:
- identity.
- role.
- needs.
- traits.
- schedule.
- relationships.
- memory.
- currentGoal.
- currentJob.
- path.
- stress.
- health.
- fatigue.
- discipline.
- risk.

---

# 12. احتياجات السجين

احتياجات قابلة للتغير مع الزمن:

- Hunger.
- Thirst.
- Sleep.
- Hygiene.
- Bladder.
- Comfort.
- Recreation.
- Safety.
- Privacy.
- Freedom.
- Social.
- Family.
- Health.
- Exercise.
- Education.
- Spiritual/quiet time عند ملاءمة تصميم اللعبة.

كل Need:
- currentValue.
- decayRate.
- satisfactionSources.
- criticalThreshold.
- effectOnBehavior.

مثال:
إذا Hunger < threshold:
→ البحث عن الطعام.
→ إنشاء Goal.
→ اختيار أقرب مصدر صالح.
→ Pathfinding.
→ الانتظار.
→ الأكل.
→ تحديث Hunger.
→ العودة للجدول.

---

# 13. شخصية السجين

أنشئ بيانات أصلية وليست نسخاً من شخصيات ألعاب أخرى.

مثال:

Prisoner {
  id
  name
  age
  sentence
  securityClass
  health
  stress
  needs
  traits
  skills
  relationships
  schedule
  history
  contrabandRisk
  escapeRisk
  aggression
  rehabilitationProgress
}

Traits:
- calm.
- impulsive.
- manipulative.
- social.
- solitary.
- fearful.
- intelligent.
- violent.
- cooperative.

هذه الصفات تؤثر فعلياً في القرارات.

---

# 14. الموظفون

أدوار:
- Guard.
- ChiefGuard.
- Cook.
- Doctor.
- Nurse.
- Janitor.
- Builder.
- Engineer.
- Warden.
- Accountant.
- Psychologist.
- Teacher.
- Lawyer/visitor-role إذا لزم.
- DogHandler.

لكل وظيفة:
- skill.
- wage.
- fatigue.
- schedule.
- equipment.
- permissions.

---

# 15. نظام الجدول الزمني

اليوم مقسم إلى فترات.

مثال:
- Sleep.
- Wake.
- Breakfast.
- Work.
- Yard.
- Lunch.
- Education.
- Recreation.
- Dinner.
- Lockdown.
- Sleep.

الجدول ليس مجرد UI.

يجب أن يغير قرارات AI.

يمكن للإدارة إنشاء Regime مخصص.

---

# 16. الأمن

نظام أمني متعدد الطبقات:

- Staff presence.
- Doors.
- Locks.
- Cameras.
- Patrols.
- Search.
- Metal detection.
- Contraband detection.
- Security zones.
- Alarm.
- Lockdown.
- Perimeter.

مستوى الأمان يجب أن يؤثر في سلوك AI.

---

# 17. الأبواب

الباب ليس صورة فقط.

Door State:
- Open.
- Closed.
- Locked.
- Forced.
- Damaged.
- Repairing.

ويملك:
- accessRules.
- securityLevel.
- animationState.
- colliderState.

عند فتح الباب:
1. animation.
2. collider transition.
3. path graph update.
4. audio.
5. event.

---

# 18. مسارات الحركة

استخدم A* أو نظام Pathfinding مناسب.

المسار يأخذ في الاعتبار:
- walls.
- doors.
- blocked tiles.
- security zones.
- movement cost.
- current occupancy.
- temporary obstacles.

عند تغير الخريطة:
لا تعيد حساب كل المسارات دائماً.

استخدم:
- dirty regions.
- cached paths.
- invalidation.
- hierarchical pathfinding عند اتساع الخريطة.

---

# 19. الحركة والرسوم

الحركة يجب أن تكون مرتبطة بموقع العالم وليس بتحريك Sprite عشوائياً.

كل Agent:
- worldPosition.
- targetPosition.
- velocity.
- facing.
- movementState.
- animationState.

Animation states:
- idle.
- walk.
- run.
- carry.
- work.
- eat.
- sleep.
- sit.
- interact.
- injured.
- restrained.

لا تغير حجم الشخصية أثناء المشي.

لا تجعل القدمين تنزلقان.

لا تسمح بـ:
- jitter.
- teleport.
- clipping.
- floating.
- sprite stretching.
- wrong pivot.

---

# 20. قاعدة الأصول الاحترافية

لا تستخدم Placeholder نهائي.

استخدم أصولاً حقيقية أو مولدة ومملوكة/مرخّصة للمشروع.

كل Asset يمر عبر:

INSPECT
→ CLEAN
→ CROP
→ REMOVE BACKGROUND عند الحاجة
→ SCALE
→ PIVOT
→ COLLIDER
→ SOCKETS
→ ANIMATION
→ METADATA
→ IMPORT
→ TEST

---

# 21. مواصفات Asset Metadata

لكل أصل:

{
  id,
  name,
  type,
  source,
  license,
  width,
  height,
  nativeScale,
  anchor,
  pivot,
  collision,
  sockets,
  animations,
  tags,
  variants
}

لا تقبل Asset بدون source/license metadata في النسخة التجارية.

---

# 22. الصور الحقيقية

عند استخدام صورة حقيقية:
- افصل الخلفية بدقة.
- لا تشوه الجسم.
- لا تغير aspect ratio.
- حافظ على الحواف.
- صحح crop.
- أصلح transparency.
- اضبط pivot.
- اختبر على خلفية فاتحة وداكنة.

إذا كان الأصل مركبة/أداة/أثاثاً:
- حدد نقاط التفاعل.
- حدد حدود collision.
- حدد مركز الحركة.
- حدد orientation.

---

# 23. التحريك الاحترافي للأصول

لا تنشئ الحركة بتغيير scale عشوائياً.

استخدم:
- position interpolation.
- rotation interpolation.
- sprite animation.
- skeletal animation عند الحاجة.
- state machine.
- easing فقط للحركات غير الفيزيائية.

مثال باب:
Closed → Opening → Open → Closing → Closed.

إذا دخل شخص أثناء Opening:
لا يسمح النظام بانغلاق الباب عليه.

---

# 24. مثال Socket

كرسي:
- seatSocket.
- interactionSocket.

سجين:
- sitSocket.

عند الجلوس:
align prisoner pelvis/anchor with seatSocket.

المطلوب:
- لا تخرج القدم من الأرض.
- لا يدخل الجسم في الكرسي.
- لا يحدث انزلاق.
- لا يظهر فرق واضح بين نقطة التفاعل والأصل.

---

# 25. الفيزياء

استخدم الفيزياء حيث تضيف قيمة فعلية.

أمثلة:
- أجسام تسقط.
- أبواب.
- عناصر قابلة للدفع.
- عربات.
- أجسام الطوارئ.

لا تستخدم physics لكل شخصية إذا كان ذلك يضر الأداء.

للحركة البشرية:
Kinematic/Navigation movement أفضل من rigid-body في معظم الحالات.

---

# 26. الطعام

نظام الطعام:

Kitchen:
→ receives ingredients
→ creates meal jobs
→ cooks
→ stores meals
→ delivers
→ prisoners consume.

المطبخ لديه:
- capacity.
- staff.
- appliances.
- inventory.
- cleanliness.
- fireRisk.

نقص الطعام يجب أن يؤدي إلى أحداث حقيقية.

---

# 27. النظافة

كل غرفة لديها dirtiness.

مصادر الاتساخ:
- traffic.
- meals.
- waste.
- prisoners.
- incidents.

عامل التنظيف:
- يبحث عن dirty jobs.
- يحمل أدوات.
- يصل للموقع.
- ينظف.
- يعود.

النظافة تؤثر على:
- health.
- happiness.
- infectionRisk.
- reputation.

---

# 28. الصحة

السجين يمكن أن:
- يمرض.
- يصاب.
- يغمى عليه.
- يحتاج علاجاً.
- يتعرض لجرعة/تسمم ضمن سيناريوهات اللعبة المناسبة.

النظام الطبي:
Symptom → Diagnosis → Treatment → Recovery.

حالات الطوارئ الطبية يجب أن تغير سلوك الموظفين فوراً.

---

# 29. البرامج وإعادة التأهيل

برامج:
- Education.
- Literacy.
- Vocational training.
- Therapy.
- Anger management.
- Substance recovery.
- Work training.

كل برنامج:
- duration.
- teacher requirement.
- room requirement.
- capacity.
- eligibility.
- completion effect.

البرنامج يؤثر في:
- behavior.
- skill.
- reoffending risk.
- reputation.
- future events.

---

# 30. الزيارات

نظام Visitors:
- visitor identity.
- relationship.
- schedule.
- security check.
- waiting.
- meeting.
- departure.

الزيارة تؤثر في:
- prisoner stress.
- morale.
- relationships.

---

# 31. الاتصالات والعلاقات

السجناء والموظفون يملكون علاقات.

Relationship:
- trust.
- hostility.
- influence.
- friendship.
- family.

هذه العلاقات تؤثر في:
- fights.
- alliances.
- cooperation.
- contraband.
- escape plans.

---

# 32. الممنوعات Contraband

أصناف:
- phone.
- drugs.
- weapon.
- tool.
- illegal material.

كل عنصر:
- concealment.
- detectionRisk.
- source.
- value.
- danger.

الممنوعات تدخل عبر:
- visitors.
- staff.
- deliveries.
- hidden routes.

ولا تجعل كل حدث عشوائياً؛ استخدم قواعد احتمالية قابلة للتفسير.

---

# 33. التحقيق

بعد حادث:
- Incident created.
- Evidence generated.
- Camera records.
- Witnesses.
- Logs.
- Investigation job.
- Report.
- Consequence.

هذه الطبقة تجعل اللعبة محاكاة وليست مجرد إدارة أرقام.

---

# 34. الحرائق والطوارئ

أمثلة:
- Fire.
- Power failure.
- Water failure.
- Riot.
- Medical emergency.
- Escape attempt.
- Equipment failure.

كل Emergency:
- severity.
- origin.
- propagation.
- required response.
- escalation.
- resolution.

---

# 35. الحريق

الحريق يمكن أن ينتشر حسب:
- material.
- room.
- ventilation.
- distance.
- suppression.

لكن لا تستخدم محاكاة مكلفة لكل Pixel.

استخدم grid-based propagation.

الحريق يؤثر على:
- health.
- visibility.
- navigation.
- power.
- security.

---

# 36. الكهرباء

شبكة كهرباء حقيقية.

Power sources:
- generator.
- grid.

Consumers:
- lights.
- cameras.
- doors.
- kitchen.
- medical.
- pumps.

عند تجاوز capacity:
- breaker.
- partial outage.
- emergency generator.

---

# 37. المياه

Water network:
- source.
- pipes.
- consumers.
- pressure.
- leak.

التسريب:
- يزيد damage.
- يقلل water availability.
- ينشئ maintenance job.

---

# 38. الإضاءة

الإضاءة ليست لوناً ثابتاً فقط.

اعتمد على:
- time of day.
- room lights.
- emergency lights.
- shadows/ambient treatment.

مع توفير Quality settings للهاتف.

---

# 39. الكاميرا

Camera:
- pan.
- zoom.
- bounds.
- smooth movement.
- mouse.
- touch pinch.
- touch pan.

لا تجعل UI تغطي العالم.

---

# 40. واجهة المستخدم

الواجهة تجارية ونظيفة.

المطلوب:
- HUD صغير.
- Build toolbar.
- contextual inspector.
- top status.
- alerts.
- pause/speed.
- reports.

ممنوع:
- أزرار عشوائية.
- أزرار مكررة.
- عناصر تجريبية.
- joystick ألعاب هاتفية لا حاجة لها.
- عناصر Placeholder في النسخة النهائية.

---

# 41. التحكم

Desktop:
- Mouse.
- Keyboard shortcuts.

Mobile:
- Touch.
- pinch zoom.
- drag pan.
- tap selection.
- long press.
- contextual controls.

لا تستخدم أزراراً ضخمة تملأ الشاشة.

---

# 42. نظام السرعة

دعم:
- Pause.
- 1x.
- 2x.
- 3x.
- Fast simulation.

يجب أن تبقى المحاكاة deterministic.

---

# 43. الحفظ

Save schema versioned.

مثال:
saveVersion: 1

يشمل:
- world.
- entities.
- economy.
- construction.
- schedules.
- incidents.
- relationships.
- RNG seed.
- time.

يجب دعم migration من الإصدارات القديمة.

---

# 44. Replay وDeterminism

كل مباراة يمكن أن تسجل:
- seed.
- input events.
- simulation ticks.

عند إعادة التشغيل يجب الحصول على نتائج مكافئة.

هذا مهم لاختبار AI.

---

# 45. الأداء

استهدف:
- 60 FPS على أجهزة سطح المكتب المتوسطة.
- تجربة قابلة للعب على الهواتف الحديثة.
- عدم تشغيل AI كامل لكل Agent كل frame.

استخدم:
- spatial partitioning.
- update budgets.
- dirty flags.
- pooled objects.
- cached paths.
- batched rendering.
- texture atlases.

---

# 46. مستويات الجودة

Low:
- أقل effects.
- أقل shadows.
- أقل particles.

Medium:
- effects أساسية.

High:
- shadows.
- particles.
- enhanced lighting.

Ultra:
- أفضل جودة للأجهزة القوية.

---

# 47. Audio

AudioManager:
- music.
- UI.
- ambient.
- footsteps.
- doors.
- alarms.
- construction.
- fire.
- medical.

استخدم spatial audio عندما يكون مفيداً.

لا تكرر الصوت كل frame.

---

# 48. نظام الأحداث

EventBus للأحداث المهمة:

PRISONER_ARRIVED
PRISONER_ESCAPED
FIRE_STARTED
POWER_FAILED
WATER_LEAK
FIGHT_STARTED
MEDICAL_EMERGENCY
CONTRABAND_FOUND
DOOR_FORCED
BUILD_COMPLETED
PROGRAM_COMPLETED

الأحداث تسجل وتستخدم في UI وAI وAudio وAnalytics.

---

# 49. نظام التقارير

التقارير:
- Finance.
- Population.
- Security.
- Health.
- Staff.
- Prisoner satisfaction.
- Incidents.
- Programs.
- Utilities.

يجب أن تكون الأرقام مستخرجة من Simulation State الحقيقي.

---

# 50. نظام العقوبات

عند مخالفة:
- Warning.
- Loss of privileges.
- Solitary.
- Transfer.
- Other game-defined consequences.

كل عقوبة لها:
- duration.
- reason.
- authority.
- effects.

لا تجعل العقوبة مجرد تغيير رقم مخفي.

---

# 51. الاقتصاد

الإيرادات:
- government funding.
- contracts.
- approved work/programs.

المصروفات:
- wages.
- food.
- electricity.
- water.
- maintenance.
- construction.
- medical.
- security.

كل شهر:
- income.
- expenses.
- net balance.

---

# 52. التوسع

يمكن شراء/فتح:
- أرض.
- مبانٍ.
- مناطق أمنية.
- برامج.
- تقنيات.

يجب أن يكون التوسع تدريجياً.

---

# 53. أهداف اللاعب

لا تعتمد على Sandbox فقط.

Campaign Objectives:
- بناء منشأة.
- استقبال عدد محدد.
- تحقيق safety score.
- تحقيق budget.
- تشغيل برنامج.
- منع الهروب.
- تجاوز أزمة.

كل مهمة لها success/failure conditions.

---

# 54. حفظ الأخطاء

عند حدوث Bug:
سجّل:
- reproduction steps.
- seed.
- simulation tick.
- screenshot.
- relevant state.
- console error.
- performance metrics.

---

# 55. الاختبارات

اختبارات Unit:
- needs.
- pathfinding.
- jobs.
- economy.
- save/load.
- RNG.

Integration:
- construction.
- prisoner workflow.
- kitchen workflow.
- emergency workflow.

E2E:
- start game.
- build cell.
- hire staff.
- receive prisoner.
- schedule meal.
- save.
- reload.
- trigger incident.

---

# 56. الاختبار البصري

بعد كل مرحلة:
1. شغّل اللعبة.
2. التقط screenshot.
3. افحص UI.
4. افحص asset alignment.
5. افحص clipping.
6. افحص text overflow.
7. افحص camera.
8. افحص mobile viewport.
9. افحص dark/light surfaces.
10. أصلح المشاكل.

لا تعتمد على نجاح الاختبارات البرمجية وحده.

---

# 57. اختبار الأصول

لكل Asset:
- original dimensions.
- rendered dimensions.
- pivot.
- collision.
- transparency.
- scale.

اختبر:
- 1x.
- zoomed.
- rotated.
- selected.
- moving.
- interacting.

---

# 58. قاعدة منع أخطاء الحركة

يجب ألا يحدث:
- foot sliding.
- jitter.
- teleport.
- rotation snapping غير مقصود.
- incorrect pivot.
- character داخل الجدار.
- character فوق الأرض.
- door clipping.
- furniture floating.

استخدم:
- fixed timestep.
- interpolation.
- consistent anchors.
- deterministic transitions.

---

# 59. نظام التفاعل

كل Interactive Entity:
- interactable.
- interactionPoint.
- interactionDuration.
- requiredRole.
- requiredItem.
- animation.
- result.

مثال:
Bed:
→ interactionPoint
→ prisoner walks
→ align
→ sleep animation
→ need decreases
→ wake.

---

# 60. نظام الأولويات

الأولوية تحسب من:
Urgency × Importance × Distance × SkillMatch.

لكن لا تجعل Distance العامل الوحيد.

---

# 61. نظام البحث عن أفضل قرار

Utility Score مثال:

score =
needUrgency
+ scheduleWeight
+ safetyWeight
+ socialWeight
+ jobPriority
- distanceCost
- riskCost

القرار الأعلى لا ينفذ فوراً إذا كان غير ممكن.

يجب التحقق من:
- reachable.
- available.
- allowed.
- safe.

---

# 62. تجنب Deadlocks

راقب:
- Job blocked.
- Agent blocked.
- Room unavailable.
- Door locked.
- Path invalid.

إذا علق Agent:
1. invalidate path.
2. recalculate.
3. try alternate.
4. change job.
5. report stuck state.

---

# 63. أدوات Debug

Debug overlay:
- FPS.
- frame time.
- entity count.
- path count.
- active jobs.
- memory estimate.
- simulation tick.
- current seed.

اختيارات:
- show grid.
- show colliders.
- show paths.
- show room bounds.
- show utility network.
- show AI goal.
- show job target.

لا تظهر أدوات Debug في الإنتاج إلا خلف flag.

---

# 64. بيانات قابلة للتعديل

ضع balance data في ملفات مستقلة.

مثال:
data/prisoners.json
data/staff.json
data/rooms.json
data/items.json
data/programs.json
data/economy.json

حتى يمكن تعديل اللعبة دون تعديل المنطق الأساسي.

---

# 65. نظام الأصول

Asset Manifest:
- id.
- path.
- type.
- license.
- source.
- dimensions.
- tags.

Asset Registry يتحقق عند الإقلاع.

إذا كان Asset مفقوداً:
- لا يكسر اللعبة بالكامل.
- يظهر error واضح.
- يستخدم fallback مؤقت فقط أثناء التطوير.
- النسخة التجارية تفشل Build إذا كان Asset required مفقوداً.

---

# 66. سياسة الترخيص

أي صورة أو صوت أو خط أو نموذج خارجي يجب أن يكون:
- مملوكاً.
- مرخصاً للاستخدام التجاري.
- أو منشأ خصيصاً للمشروع.

سجل المصدر والترخيص.

لا تستخدم rip من ألعاب أخرى.

---

# 67. تصميم بصري

الهوية:
- نظيفة.
- مقروءة.
- احترافية.
- كثافة معلومات محسوبة.
- ألوان وظيفية.
- outlines واضحة.
- animations خفيفة.

الأصول يجب أن تنتمي إلى نفس العالم الفني.

لا تجمع صوراً فوتوغرافية عشوائية مع Sprites غير متناسقة دون معالجة.

---

# 68. التدرج البصري

اعتمد:
1. silhouette واضح.
2. contrast.
3. readable rooms.
4. readable agents.
5. clear interaction states.
6. consistent scale.

---

# 69. الخريطة الكبيرة

عند تكبير السجن:
- لا ترسم كل التفاصيل بأعلى جودة.
- استخدم LOD بصري.
- قلل animation بعيداً عن الكاميرا.
- استخدم culling.

---

# 70. حفظ الأداء في AI

قسّم Agents إلى:
- near.
- mid.
- far.

Near:
full update.

Mid:
reduced update.

Far:
aggregated simulation.

لكن لا تفقد النتائج المهمة.

---

# 71. نظام الوقت

SimulationClock:
- minute.
- hour.
- day.
- week.
- month.

الأحداث المجدولة تستخدم clock وليس setTimeout عشوائي.

---

# 72. عدم ربط المنطق بـ FPS

ممنوع:
position += speed * frameCount.

الصحيح:
position += speed * deltaTime.

وللمحاكاة:
fixedStep.

---

# 73. واجهة اختيار العنصر

عند اختيار Agent:
Panel يعرض:
- الاسم.
- الدور.
- الحالة.
- الحاجة الحالية.
- الهدف.
- الموقع.
- الصحة.
- المخاطر.

عند اختيار Room:
- النوع.
- السعة.
- الاستخدام.
- النظافة.
- الطاقة.
- الماء.
- الأشخاص.

---

# 74. نظام الإشعارات

Notification severity:
- Info.
- Warning.
- Critical.

مثال:
"المطبخ توقف بسبب نقص الكهرباء."

لا ترسل 50 إشعاراً لنفس الحدث.

استخدم aggregation.

---

# 75. قابلية الوصول

دعم:
- scalable UI.
- keyboard navigation.
- readable text.
- high contrast.
- reduced motion.
- color-independent indicators.

لا تعتمد على اللون وحده.

---

# 76. العربية وRTL

الواجهة يجب أن تكون قابلة للتدويل.

i18n:
- Arabic RTL.
- English LTR.

لا تضع النصوص داخل منطق اللعبة.

---

# 77. الاختبار على الهاتف

اختبر على:
- 360x800.
- 390x844.
- 412x915.
- landscape.

يجب ألا:
- تتداخل القوائم.
- تختفي الأزرار.
- يتوقف zoom.
- تتجاوز النصوص الشاشة.

---

# 78. اختبار سطح المكتب

اختبر:
- 1280x720.
- 1366x768.
- 1920x1080.
- ultrawide.

لا تجعل UI ثابتة بطريقة تسبب overflow.

---

# 79. سيناريو إثبات كامل

بعد البناء، أنشئ سيناريو Demo حقيقي:

1. Start.
2. Build perimeter.
3. Build 4 cells.
4. Build kitchen.
5. Build dining area.
6. Build staff room.
7. Hire guard.
8. Hire cook.
9. Hire janitor.
10. Receive prisoners.
11. Prisoners walk to cells.
12. Schedule meal.
13. Cook prepares food.
14. Food delivered.
15. Prisoners eat.
16. Janitor cleans.
17. Guard patrols.
18. Visitor arrives.
19. Security checks visitor.
20. Minor incident occurs.
21. Guard responds.
22. Incident recorded.
23. Player saves.
24. Reload.
25. Continue.

يجب أن يعمل السيناريو من البداية إلى النهاية.

---

# 80. سيناريو الطوارئ

اختبر:
- fire.
- medical emergency.
- power outage.
- water leak.
- fight.
- escape attempt.

كل حادث يجب أن:
- يظهر.
- يغير state.
- يخلق jobs.
- يغير AI.
- ينتهي بطريقة منطقية.

---

# 81. Quality Gate

لا تعتبر المرحلة مكتملة إلا إذا:

[ ] Build ينجح.
[ ] Tests تمر.
[ ] Console نظيف.
[ ] لا توجد أخطاء runtime.
[ ] UI لا يحتوي placeholders.
[ ] Assets صحيحة.
[ ] Collision صحيحة.
[ ] Pivot صحيح.
[ ] Animation صحيحة.
[ ] AI يتحرك.
[ ] Jobs تعمل.
[ ] Save/Load يعمل.
[ ] Mobile يعمل.
[ ] Desktop يعمل.
[ ] Performance مقبول.
[ ] Screenshot proof موجود.

---

# 82. ترتيب التنفيذ الإلزامي

Phase 1:
Engine shell + camera + grid + input.

Phase 2:
Tiles + walls + rooms.

Phase 3:
Construction + materials + jobs.

Phase 4:
Agents + pathfinding.

Phase 5:
Needs + schedules.

Phase 6:
Staff + security.

Phase 7:
Kitchen + food + utilities.

Phase 8:
Health + programs + visitors.

Phase 9:
Contraband + incidents + investigation.

Phase 10:
Emergencies.

Phase 11:
Economy + progression.

Phase 12:
Save/load + replay.

Phase 13:
Audio + VFX + polish.

Phase 14:
Mobile optimization.

Phase 15:
QA + regression.

---

# 83. بعد كل Phase

لا تنتقل مباشرة.

نفذ:
IMPLEMENT
→ BUILD
→ RUN
→ SCREENSHOT
→ TEST
→ FIX
→ TEST AGAIN.

إذا فشلت مرحلة:
أصلحها قبل بناء أنظمة تعتمد عليها.

---

# 84. قاعدة عدم التخمين

إذا كان سلوك النظام غير محدد:
اختر أبسط سلوك منطقي قابل للاختبار، وسجله في documentation.

لا تنشئ ميزات عشوائية لمجرد زيادة حجم المشروع.

---

# 85. قاعدة عدم صناعة Prototype

ممنوع تسليم:
- شاشة واحدة فارغة.
- شخصيات تتحرك عشوائياً.
- أزرار بلا وظيفة.
- صور Placeholder.
- نظام AI وهمي.
- اقتصاد وهمي.
- Save وهمي.
- تأثيرات بلا ارتباط بالمحاكاة.

كل شيء يجب أن يكون مرتبطاً بالنظام الحقيقي.

---

# 86. مخرجات المشروع المطلوبة

يجب تسليم:

- لعبة ويب تعمل.
- Source code.
- package.json.
- README.md.
- ARCHITECTURE.md.
- AI.md.
- ASSETS.md.
- ANIMATION.md.
- PERFORMANCE.md.
- QA.md.
- LICENSES.md.
- asset manifest.
- tests.
- build configuration.
- save system.
- demo scenario.
- screenshots/evidence.

---

# 87. معايير النجاح النهائي

النسخة النهائية يجب أن تسمح للاعب ببناء سجن وتشغيله وإدارته لفترة طويلة دون أن تنهار المحاكاة.

المعيار ليس عدد الأسطر.

المعيار:
- systems depth.
- system interaction.
- determinism.
- visual quality.
- usability.
- performance.
- stability.
- testability.

---

# 88. قاعدة البحث والتطوير

قبل تنفيذ أي نظام معقد، ابحث في:
- game AI architecture.
- simulation architecture.
- pathfinding.
- utility AI.
- ECS.
- browser rendering.
- WebGL/WebGPU performance.
- sprite animation.
- deterministic simulation.
- spatial partitioning.
- save migration.
- accessibility.
- mobile optimization.

استخدم المصادر الرسمية والأوراق التقنية والمراجع الهندسية عندما تكون متاحة.

لا تنسخ كوداً أو أصولاً محمية.

---

# 89. قاعدة التعامل مع الأصول

عند استيراد أي أصل جديد:

1. اقرأ metadata.
2. افحص dimensions.
3. افحص transparency.
4. افحص aspect ratio.
5. افحص license.
6. افحص pivot.
7. افحص collision.
8. افحص scale.
9. اختبر في العالم.
10. اختبر أثناء الحركة.
11. اختبر مع Agent.
12. اختبر على mobile.
13. سجّل النتيجة.

---

# 90. بروتوكول إصلاح الأخطاء

عند اكتشاف خطأ:

OBSERVE
→ REPRODUCE
→ CAPTURE
→ IDENTIFY ROOT CAUSE
→ PATCH
→ TEST
→ VISUAL VERIFY
→ REGRESSION TEST.

لا تعالج العرض فقط إذا كان السبب في Simulation Core.

---

# 91. مثال خطأ حركة

المشكلة:
الشخصية تدخل الجدار.

لا تحلها فقط بإضافة offset.

افحص:
- grid collision.
- path graph.
- collider bounds.
- sprite pivot.
- scale.
- movement interpolation.

ثم أصلح السبب.

---

# 92. مثال خطأ Asset

المشكلة:
كرسي يظهر مرتفعاً.

افحص:
- source image.
- crop.
- transparent bounds.
- pivot.
- world scale.
- floor anchor.

ثم ثبت anchor بدلاً من تشويه الأصل.

---

# 93. مثال خطأ AI

المشكلة:
العامل لا يصل للمطبخ.

افحص:
- Job assignment.
- required skill.
- room access.
- path.
- locked door.
- utility.
- reservation.

ثم أصلح السبب.

---

# 94. الهدف التجاري

النسخة النهائية يجب أن تشعر كمنتج لعبة حقيقي، لا كمشروع جامعي.

لذلك:
- لا تترك TODOs حرجة.
- لا تترك أزراراً غير فعالة.
- لا تترك شاشات وهمية.
- لا تترك Assets غير متناسقة.
- لا تعتمد على console logs للمستخدم.
- لا تعرض debug UI افتراضياً.

---

# 95. التعليمات النهائية لـ Arena Agent

ابدأ بفحص هذا الملف بالكامل.

ثم:
1. افحص المستودع الحالي.
2. افحص الملفات الموجودة.
3. لا تحذف العمل الصحيح.
4. حدد ما هو مكتمل فعلاً.
5. حدد ما هو وهمي أو ناقص.
6. ضع خطة تنفيذ.
7. نفذ على مراحل.
8. شغّل المشروع.
9. اختبر في المتصفح.
10. التقط الأدلة البصرية.
11. أصلح كل مشكلة.
12. أعد الاختبار.
13. لا تتوقف عند أول Build ناجح.
14. استمر حتى تحقق Quality Gate.
15. وثّق ما تم إنجازه وما بقي.
16. اجعل اللعبة قابلة للتشغيل فعلياً.

**الأولوية المطلقة: لعبة تعمل فعلياً > كود كثير.**

**الأولوية الثانية: الأنظمة المترابطة > المظاهر الوهمية.**

**الأولوية الثالثة: أصول حقيقية واحترافية > placeholders.**

**الأولوية الرابعة: الاختبار البصري والوظيفي > الادعاء بأن الميزة مكتملة.**

