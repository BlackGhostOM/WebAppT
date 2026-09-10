# مركز العمليات — Operations Center

منصة ويب لشركة سياحية عُمانية تُدار عملياتها اليومية بأربعة وكلاء ذكاء اصطناعي (تنفيذي، منتجات، مبيعات، خدمة عملاء) ويعتمد المالك كل ما يمس المال أو العملاء أو السمعة.

- الحزمة: Next.js 16 + TypeScript + Tailwind v4 + shadcn/ui · Convex (قاعدة البيانات، الدوال، cron، التخزين، البحث المتجهي) · Convex Auth (بريد + كلمة مرور) · Anthropic Claude API.
- دليل المشروع للمطورين ووكلاء البرمجة: [CLAUDE.md](./CLAUDE.md)
- الوثائق: [الافتراضات](./docs/ASSUMPTIONS.md) · [قاموس البيانات](./docs/DATA_DICTIONARY.md) · [ERD](./docs/ERD.md) · [المفردات](./docs/VOCABULARY.md) · [المؤشرات](./docs/KPI_DICTIONARY.md) · [إجراء تغيير البيانات](./docs/DATA_CHANGE_PROCESS.md)

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
