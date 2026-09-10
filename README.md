# مركز العمليات — Operations Center

منصة ويب لشركة سياحية عُمانية تُدار عملياتها اليومية بأربعة وكلاء ذكاء اصطناعي (تنفيذي، منتجات، مبيعات، خدمة عملاء) ويعتمد المالك كل ما يمس المال أو العملاء أو السمعة.

- الحزمة: Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui · Convex (قاعدة البيانات، الدوال، cron، التخزين، البحث المتجهي) · Convex Auth (بريد + كلمة مرور) · Anthropic Claude API.
- دليل المشروع للمطورين ووكلاء البرمجة: [CLAUDE.md](./CLAUDE.md)
- الوثائق: [الافتراضات](./docs/ASSUMPTIONS.md) · [قاموس البيانات](./docs/DATA_DICTIONARY.md) · [ERD](./docs/ERD.md) · [المفردات](./docs/VOCABULARY.md) · [المؤشرات](./docs/KPI_DICTIONARY.md) · [إجراء تغيير البيانات](./docs/DATA_CHANGE_PROCESS.md) · [دليل النشر](./docs/DEPLOY.md)

## التشغيل محلياً
```bash
npm install
npx convex dev                       # في نافذة (يقبل نشراً محلياً مجهولاً)
node scripts/auth-keys.mjs           # مرة واحدة لكل نشر
npx convex env set OWNER_EMAIL=owner@example.com
npx convex env set OWNER_PASSWORD='كلمة-مرور-12-حرفاً-فأكثر-مع-أرقام1'
npm run seed:owner                   # حساب المالك + الإعدادات الافتراضية
npm run seed                         # بيانات اصطناعية عُمانية (اختياري)
npm run dev                          # http://localhost:3000
```
بدون `ANTHROPIC_API_KEY` يعمل النظام في وضع محاكاة صريح لا يخترع بيانات.

## قنوات العملاء (المرحلة 3)
- **إنستجرام**: اضبط في لوحة Meta عنوان الـWebhook `https://<deployment>.convex.site/webhooks/instagram` مع `META_WEBHOOK_VERIFY_TOKEN`، وأضف `META_APP_SECRET` و`META_PAGE_ACCESS_TOKEN` إلى بيئة Convex، ثم بدّل «وضع إنستجرام حي» من الإعدادات. قبل ذلك يعمل وضع المحاكاة (زر «محاكاة رسالة واردة» في صندوق العملاء).
- **نموذج الموقع**: صفحة `/contact` جاهزة، أو أرسل `POST https://<deployment>.convex.site/api/contact` بحقول `name, phone|email, message, subject?, language?` من موقع الشركة.
- كل رسالة تصل إلى صندوق موحد، يصنّفها وكيل خدمة العملاء ويقترح رداً يعتمده المالك بنقرة؛ الشكاوى تُصعَّد فوراً.

## التشغيل الآلي والتقارير (المرحلة 4)
- **قواعد الاعتماد التلقائي** (الإعدادات → الاعتماد التلقائي): حسب النوع، أو رسائل ما بعد البيع، أو الأسئلة الشائعة؛ بسقف يومي وساعات هدوء. لا يُعتمد تلقائياً أبداً ما يمس المال أو الحجوزات أو البيانات الحساسة.
- **المهام المجدولة** (الإعدادات → المهام المجدولة): ملخص يومي، متابعات ما بعد البيع، تذكيرات المتابعة، ملخص تنفيذي أسبوعي — مع زر «تشغيل الآن».
- **التقارير** (`/reports`): اتجاه 6 أشهر، خدمة العملاء، أداء الوكلاء، التكلفة والتوقع، الحجوزات؛ تصدير CSV.
- **النشر على الإنتاج**: [docs/DEPLOY.md](./docs/DEPLOY.md).
