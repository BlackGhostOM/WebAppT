# قاموس المؤشرات — KPI Dictionary

كل مؤشر يُحسب من قاعدة البيانات مباشرة (`convex/agents/tools.ts::computeKpis`, `convex/dashboard.ts`, `convex/services/usage.ts`)، لا من تقدير النموذج. الفترة الافتراضية: الشهر التقويمي (UTC) `monthKey = YYYY-MM`.

| المؤشر | المعادلة | البسط | المقام | مصدر البيانات | التكرار | المالك | الهدف |
|---|---|---|---|---|---|---|---|
| استفسارات الشهر | عدد `interactions` الواردة | `direction = INBOUND` و`receivedAt` في الشهر | — | `interactions` | لحظي | support | — |
| عملاء محتملون جدد | عدد `leads` المنشأة في الشهر | `createdAt` في الشهر وغير مؤرشف | — | `leads` | لحظي | sales | — |
| العملاء المحتملون حسب المرحلة | عدد لكل `stage` | كل `leads` غير المؤرشفة | — | `leads` | لحظي | sales | — |
| العروض المرسلة | عدد `quotes` بحالة SENT/ACCEPTED | `status ∈ {SENT, ACCEPTED}` في الشهر | — | `quotes` | لحظي | sales | — |
| الحجوزات | عدد `bookings` المنشأة في الشهر (غير مؤرشفة) | `createdAt` في الشهر | — | `bookings` | لحظي | support/ops | — |
| الإيراد (ر.ع) | مجموع `totalSellingPrice.baseAmount` | حجوزات `status ∈ {CONFIRMED, IN_PROGRESS, COMPLETED}` في الشهر | — | `bookings` | لحظي | owner | — |
| تكلفة الوكلاء ($) | مجموع `costUsd` | `usageLog` في الشهر | — | `usageLog` | لحظي | executive | ≤ الميزانية (200$) |
| نسبة الميزانية | تكلفة الوكلاء ÷ الميزانية الشهرية × 100 | إجمالي التكلفة | `settings.budget.monthlyBudgetUsd` | `usageLog`, `settings` | لحظي | owner | تنبيه عند 80% |
| التكلفة حسب النموذج/الوكيل | مجموع `costUsd` مجمّعاً | لكل `model` / `agentSlug` | — | `usageLog` | لحظي | executive | ضمن حد الوكيل |
| معدل التحويل: استفسار → عميل محتمل | عملاء محتملون جدد ÷ استفسارات × 100 | `leads` الجديدة | `interactions` الواردة | `leads`, `interactions` | شهري | sales | ↑ |
| معدل التحويل: عميل محتمل → عرض | عروض الشهر ÷ عملاء محتملون جدد × 100 | `quotes` المنشأة | `leads` الجديدة | `quotes`, `leads` | شهري | sales | ↑ |
| معدل التحويل: عرض → حجز | حجوزات الشهر ÷ عروض الشهر × 100 | `bookings` | `quotes` | `bookings`, `quotes` | شهري | sales | ↑ |
| معدل التحويل الرئيسي | الحجوزات المدفوعة ÷ العملاء المحتملون المؤهلون في نفس الفترة × 100 | حجوزات `paymentStatus ∈ {PAID, DEPOSIT_PAID, PARTIALLY_PAID}` | `leads` بمرحلة ≠ NEW_LEAD منشأة في الفترة | `bookings`, `leads` | شهري | owner | ≥ 20% (افتراض) |
| نسبة الفوز | `leads` بمرحلة WON ÷ `leads` الجديدة × 100 | WON | الجديدة | `leads` | شهري | sales | ↑ |
| **مخاطر بيانات** — أسعار حرجة منتهية | أسعار CONTRACTED/SUPPLIER_CONFIRMED بحداثة EXPIRED ÷ كل الأسعار الحرجة × 100 | `rates` منتهية | `rates` حرجة غير مؤرشفة | `rates` | يومي (cron) | product | 0% |
| فجوات بيانات حرجة | عدد `dataGaps` OPEN بخطورة D3/D4 | — | — | `dataGaps` | يومي | executive | 0 |
| تعارضات غير محسومة | عدد `dataConflicts` بحالة ESCALATED | — | — | `dataConflicts` | لحظي | executive | 0 |
| فجوات معرفة مفتوحة | عدد `knowledgeGaps` OPEN | — | — | `knowledgeGaps` | لحظي | executive | ↓ |
| **Unsupported Fact Rate** | مهام الوكلاء المتخصصين المكتملة بلا استشهادات ÷ كل المهام المكتملة × 100 | `tasks.status = COMPLETED` و`citations = []` و`agentSlug ≠ executive` | `tasks` المكتملة في الشهر | `tasks` | شهري | executive | ≤ 20% |
| **Human Override Rate** | (مرفوض + معتمد بعد تعديل) ÷ كل الاعتمادات المحسومة × 100 | `approvals.status ∈ {REJECTED, EDITED_APPROVED}` أو `editedPayload` موجود | `approvals` المحسومة في الشهر | `approvals` | شهري | owner | ≤ 30% (مرتفع = الوكلاء لا يتعلمون) |
| معدل توقف المهام | مهام FAILED/CANCELLED/BUDGET_EXCEEDED ÷ كل المهام | حسب الحالة | كل `tasks` في الفترة | `tasks` | شهري | executive | ↓ |
| زمن الاستجابة للعميل (المرحلة 3) | متوسط (`sentAt` − `receivedAt`) للردود | ردود معتمدة ومرسلة | — | `interactions` | أسبوعي | support | ≤ 2 ساعة |

## ملاحظات
- المؤشرات المالية الحقيقية (الفواتير، المدفوعات، الربحية الفعلية) تنتظر نطاق المالية (المرحلة 2+) والدفتر المحاسبي الخارجي؛ «الإيراد» هنا إيراد الحجوزات المؤكدة لا المحصّل.
- كل مؤشر يعرضه الوكيل التنفيذي يحمل `source: { kind: "db", retrievedAt }`.
