# دليل النشر — Vercel + Convex

هذا الدليل ينقل «مركز العمليات» من بيئة التطوير المحلية (نشر Convex مجهول + `next dev`) إلى إنتاج: قاعدة بيانات ودوال على Convex Cloud، وواجهة Next.js على Vercel، وقنوات العملاء (نموذج الموقع + إنستجرام) موصولة. كل الأسرار تعيش في متغيرات بيئة Convex أو Vercel فقط — لا في الكود ولا في المستندات.

## 0. قبل أن تبدأ
- حساب [Convex](https://dashboard.convex.dev) وحساب [Vercel](https://vercel.com)، والمستودع على GitHub/GitLab.
- مفتاح Anthropic (`ANTHROPIC_API_KEY`). اختيارياً: Voyage AI للتضمين، Resend لبريد إعادة التعيين، تطبيق Meta لإنستجرام.
- تأكد محلياً أن كل شيء يمر: `npm run typecheck && npm run lint && npm test && npm run build`.

## 1. إنشاء نشر Convex للإنتاج
```bash
npx convex login                      # مرة واحدة
npx convex dev --configure new        # يربط المشروع بفريقك ويكتب CONVEX_DEPLOYMENT في .env.local (نشر dev سحابي)
npx convex deploy                     # ينشئ/يحدّث نشر الإنتاج prod ويرفع الدوال والمخطط وcron
```
- من لوحة Convex → Settings → **Deploy Key**: أنشئ مفتاح نشر للإنتاج (`CONVEX_DEPLOY_KEY`) وستحتاجه في Vercel.
- عنوانان مهمان من لوحة النشر: `https://<slug>.convex.cloud` (العميل) و`https://<slug>.convex.site` (نقاط HTTP: Webhook إنستجرام ونموذج الموقع).

## 2. متغيرات بيئة Convex (الإنتاج)
تُضبط من اللوحة (Settings → Environment Variables) أو بالأمر `npx convex env set NAME=VALUE --prod`.

| المتغير | إلزامي | الغرض |
|---|---|---|
| `JWT_PRIVATE_KEY`, `JWKS` | ✓ | مفاتيح Convex Auth. ولّدها مرة واحدة: `node scripts/auth-keys.mjs https://your-domain.com --prod` (السكربت يكتبها إلى النشر) |
| `SITE_URL` | ✓ | عنوان الموقع النهائي (مثل `https://ops.yourcompany.om`) لروابط المصادقة |
| `ANTHROPIC_API_KEY` | ✓ | مزوّد النموذج. بدونه يعمل وضع المحاكاة (لا يخترع بيانات) |
| `LLM_PROVIDER` | ✗ | `anthropic` (افتراضي عند وجود المفتاح) أو `openai_compatible` مع `OPENAI_COMPAT_BASE_URL`/`OPENAI_COMPAT_API_KEY` |
| `VOYAGE_API_KEY` | ✗ | تضمينات البحث الدلالي في المعرفة؛ بدونه تضمين حتمي محلي (بحث كلمات مفتاحية أساساً) |
| `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM` | ✗ | بريد إعادة تعيين كلمة المرور؛ بدونه تظهر الرموز في سجلات Convex فقط |
| `META_WEBHOOK_VERIFY_TOKEN` | مع إنستجرام | رمز تحقق من اختيارك لمصافحة Meta |
| `META_APP_SECRET` | مع إنستجرام | يتحقق من توقيع `X-Hub-Signature-256` على كل Webhook (بدونه يعمل وضع المحاكاة ويقبل حمولات غير موقّعة) |
| `META_PAGE_ACCESS_TOKEN` | مع إنستجرام | إرسال الردود الحية عبر Graph API عند تبديل «وضع إنستجرام حي» |
| `OWNER_EMAIL`, `OWNER_PASSWORD` | مؤقتاً | لبذر حساب المالك الأول ثم **احذفهما** |
| `DEPLOYMENT_STAGE=prod` | ✓ | يمنع `npm run seed` (البيانات الاصطناعية) على الإنتاج |

بعد ضبطها:
```bash
npx convex run seedOwner:run --prod   # حساب المالك + الإعدادات الافتراضية والوكلاء
npx convex env remove OWNER_PASSWORD --prod
```

## 3. مشروع Vercel
1. Import المستودع في Vercel (Framework: Next.js). ملف `vercel.json` يضبط أمر البناء: `npx convex deploy --cmd 'npm run build'` — أي كل نشر على Vercel ينشر دوال Convex أولاً ثم يبني الواجهة بعنوان النشر الصحيح.
2. متغيرات بيئة Vercel (Production):

| المتغير | القيمة |
|---|---|
| `CONVEX_DEPLOY_KEY` | مفتاح النشر من الخطوة 1 (Sensitive) |
| `NEXT_PUBLIC_CONVEX_URL` | `https://<slug>.convex.cloud` (يكتبه `convex deploy` تلقائياً أثناء البناء؛ ضعه احتياطاً) |
| `NEXT_PUBLIC_CONVEX_SITE_URL` | `https://<slug>.convex.site` — تستخدمه صفحة `/contact` ويُعرض في صندوق العملاء كعنوان الـWebhook |

3. Deploy. الرؤوس الأمنية (nosniff, DENY, Referrer-Policy, Permissions-Policy) مضبوطة في `vercel.json`، والمنطقة `fra1` (الأقرب لعُمان بين مناطق Vercel).
4. اربط النطاق المخصص في Vercel وحدّث `SITE_URL` في Convex ليطابقه، ثم أعد توليد مفاتيح المصادقة إن غيّرت النطاق: `node scripts/auth-keys.mjs https://ops.yourcompany.om --prod`.

## 4. ربط قنوات العملاء
### نموذج الموقع
- صفحة جاهزة: `https://ops.yourcompany.om/contact` (عامة، بلا تسجيل دخول).
- أو من موقع الشركة الحالي: `POST https://<slug>.convex.site/api/contact` بجسم JSON `{ name, phone | email, message, subject?, language?: "ar"|"en", requestId? }`. الحد 10 طلبات/دقيقة لكل IP، وحقل `website` مصيدة للروبوتات (يجب أن يبقى فارغاً).

### إنستجرام (Meta)
1. في [Meta for Developers](https://developers.facebook.com) أنشئ تطبيقاً من نوع Business وأضف منتج **Instagram** (Instagram API with Instagram Login) واربط حساب الشركة المهني.
2. Webhooks → Instagram → Callback URL: `https://<slug>.convex.site/webhooks/instagram` · Verify token: قيمة `META_WEBHOOK_VERIFY_TOKEN` · اشترك في الحقل `messages`.
3. انسخ App Secret إلى `META_APP_SECRET` وولّد Access Token طويل الأمد بصلاحيات `instagram_business_basic` و`instagram_business_manage_messages` إلى `META_PAGE_ACCESS_TOKEN`.
4. في مركز العمليات → الإعدادات → ربط الحسابات: بدّل «وضع إنستجرام حي». قبل ذلك تُسجَّل الردود المعتمدة فقط دون إرسال (deliveryStatus = MOCK).
5. اختبر: أرسل رسالة من حساب شخصي إلى حساب الشركة → تظهر في صندوق العملاء خلال ثوانٍ مع رد مقترح.

ملاحظات الامتثال: نافذة الرد 24 ساعة تُحترم تلقائياً للردود التلقائية؛ الرسائل التسويقية تحتاج موافقة `GRANTED` في سجل العميل؛ يمكن حذف عميل نهائياً من إدخال البيانات (أرشفة ثم حذف).

## 5. المهام المجدولة (cron) على الإنتاج
تُنشر تلقائياً مع `convex deploy` (ملف `convex/crons.ts`). تظهر في لوحة Convex → Schedules:

| الوظيفة | التوقيت (مسقط) | ما تفعله |
|---|---|---|
| freshness engine | 06:00 يومياً | تحديث الحداثة، تنبيهات الانتهاء (30/7 يوماً)، فجوات البيانات |
| daily digest | 07:00 يومياً | تنبيه ملخص للمالك (بلا نموذج) |
| weekly executive summary | الأحد 07:30 | مهمة للوكيل التنفيذي (تُفعَّل من الإعدادات → المهام المجدولة) |
| lifecycle follow-ups | 08:00 يومياً | ترحيب/تذكير/استطلاع من الحجوزات المؤكدة → اعتماد → إرسال |
| lead follow-up reminders | 09:00 يومياً | مهام لوكيل المبيعات للمتابعات المتأخرة (بسقف يومي) |
| task watchdog | كل 15 دقيقة | إنهاء المهام المعلّقة |

## 6. قائمة تحقق بعد النشر
- [ ] تسجيل دخول المالك يعمل، والتسجيل العام مغلق (صفحة `/login` فقط).
- [ ] الإعدادات → توجيه النماذج تُظهر المزوّد `anthropic` (لا `mock`).
- [ ] رسالة تجريبية من `/contact` تصل إلى صندوق العملاء ويقترح الوكيل رداً.
- [ ] الاعتماد بنقرة ينفّذ الإرسال (MOCK في وضع المحاكاة، SENT عند ربط إنستجرام).
- [ ] الميزانية الشهرية والتنبيه (80%) مضبوطان في الإعدادات → الميزانية.
- [ ] `DEPLOYMENT_STAGE=prod` مضبوط و`OWNER_PASSWORD` محذوف.
- [ ] رفع مستندات السياسات إلى مصادر المعرفة واعتمادها حتى يستند الوكلاء إليها.

## 7. التشغيل والصيانة
- **النسخ الاحتياطي**: لوحة Convex → Backups (يومي تلقائي على الخطط المدفوعة) أو `npx convex export --prod --path backup.zip` دورياً.
- **التراجع**: أعد نشر الإيداع السابق من Vercel (Redeploy) — يتضمن `convex deploy` لنفس الإيداع. تغييرات المخطط إضافية ومتوافقة (انظر `docs/DATA_CHANGE_PROCESS.md`).
- **السجلات**: لوحة Convex → Logs (دوال وcron وأخطاء التسليم)، وVercel → Logs للواجهة. كل تغيير حساس في جدول `auditLog` (صفحة الإعدادات → الحوكمة).
- **الإيقاف الطارئ**: زر «إيقاف كل الوكلاء» في الشريط العلوي يوقف كل المهام الجارية والمجدولة فوراً؛ إعادة التفعيل يدوية.
- **التكلفة**: التقارير → التكلفة تُظهر الاستهلاك اليومي والتوقع لنهاية الشهر؛ الحد الشهري لكل وكيل في الإعدادات → الوكلاء.
- **مراقبة Meta**: عند فشل إرسال رد حي يظهر تنبيه `DELIVERY_FAILED` وتُسجَّل الرسالة `FAILED` مع سبب Graph API.

## 8. بيئة التطوير مقابل الإنتاج
| | تطوير | إنتاج |
|---|---|---|
| Convex | نشر محلي مجهول `http://127.0.0.1:3210` (`CONVEX_AGENT_MODE=anonymous`) | `https://<slug>.convex.cloud` |
| نقاط HTTP | `http://127.0.0.1:3211` | `https://<slug>.convex.site` |
| النموذج | `mock` ما لم يُضبط المفتاح | `anthropic` |
| إنستجرام | محاكاة (زر «محاكاة رسالة واردة») | حي بعد ربط Meta |
| البيانات | `npm run seed` مسموح | مرفوض (`DEPLOYMENT_STAGE=prod`) |
