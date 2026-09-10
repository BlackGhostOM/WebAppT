# مركز العمليات — Operations Center (Claude Code project guide)

Next.js 16 (App Router) + TypeScript + Tailwind v4 + shadcn/ui (Base UI) frontend, Convex backend
(schema, queries/mutations/actions, crons, file storage, vector search), Convex Auth (email + password),
Anthropic Claude API behind an `LLMProvider` abstraction. UI is Arabic-first (RTL) with an English toggle.

## Golden rules (copied verbatim from the master prompt, section 4.1)
1. النموذج ليس قاعدة البيانات ولا الذاكرة المؤسسية.
2. لكل حقيقة تجارية مصدر مرجعي واحد؛ لا سعر واحد بقيمتين في جدولين.
3. لا تُعرض بيانات غير متحقق منها كأنها متحقق منها.
4. الوصول بمبدأ الحد الأدنى من الصلاحيات؛ لا توجد صلاحية اسمها "Full Access" للوكلاء.
5. كل تغيير حساس قابل للتدقيق (من، ماذا، متى، القيمة القديمة والجديدة، السبب، الاعتماد).
6. المعرفة تخضع للإصدارات وتواريخ النفاذ.
7. استنتاج الذكاء الاصطناعي لا يصبح حقيقة مؤسسية تلقائياً.
8. البيانات المنتهية الصلاحية لا تقود قرارات حالية بصمت.
9. تُجمع البيانات لغرض محدد وبالحد الأدنى (Data Minimization).
10. كل قرار تجاري حرج قابل للتتبع إلى بياناته وأدلته.

Governing principle: agents propose, prepare and execute low-risk work; the owner approves anything that
touches money, customers or reputation. `external` tools create an `approvals` record and never run directly.

## Layout
```
app/                      Next.js routes. (auth)/login, (auth)/reset-password are public; everything under (app)/ is behind proxy.ts
components/               UI (shadcn in components/ui — Base UI primitives, not Radix), app-shell, badges, data forms
lib/                      Shared pure code: modelRouting.ts (routing policy), entities.ts (form/data dictionary), i18n/, format.ts
convex/
  schema.ts               12 domains; MVP tables implemented, the rest documented as // Phase 2+
  lib/vocab.ts            Controlled vocabulary (as const) — the ONLY place statuses/types live
  lib/baseFields.ts       Shared provenance/trust/validity/version fields + money & citation validators
  lib/ids.ts              businessId generator (counters table)
  lib/access.ts           Access matrix enforcement (row-level conditions, field-level redaction)
  lib/audit.ts            appendAudit — the only write to auditLog (append-only). No update/delete exists.
  lib/validation.ts       Validator class, normalisation, duplicate detection, transitions
  lib/settings.ts         Typed settings with defaults (modelRouting, budget, emergencyStop, autoApprove…)
  lib/llm/                LLMProvider: anthropic.ts, openaiCompat.ts (xAI etc.), mock.ts, pricing.ts, embeddings
  services/               The ONLY layer that reads/writes tables. records.ts (generic CRUD from lib/entities.ts),
                          commercial.ts (rates/products/bookings/leads/quotes rules), tasks.ts, approvals.ts, usage.ts,
                          knowledge.ts, documents.ts, governance.ts (memory, conflicts, gaps)
  agents/                 prompts.ts (seed prompts), tools.ts (registry + executor), runtime.ts (internal fns), loop.ts (action)
  <public api files>      chat, tasks, approvals, records, products, bookings, leads, rates, documents, knowledge/*, settings,
                          agentConfig, usage, dashboard, audit, dataQuality, contentApi, bootstrap, seed, seedOwner, crons, maintenance
  tests/                  Vitest + convex-test (in-memory backend). helpers.ts sets up defaults + identities.
docs/                     ASSUMPTIONS, DATA_DICTIONARY, ERD, VOCABULARY, KPI_DICTIONARY, DATA_CHANGE_PROCESS (+ DEPLOY in phase 4)
```

## Non-negotiable coding rules
- Every public Convex function calls `requireUser` / `requireOwner` (server-side `ctx.auth`). Never trust the UI guard alone.
- Agents never touch `ctx.db` directly: tools call `convex/services/*` with an `actor` and `assertAccess` runs first.
- New statuses/types go in `convex/lib/vocab.ts` and are enforced in the schema via `literals()`; no free-text states.
- Money is `{ amount, currency, baseAmount, baseCurrency: "OMR", … }` (lib/money.ts). Times are UTC timestamps; zoned times carry `timezone`.
- Every write goes through validation → duplicates → business rules → access → `appendAudit` with D1–D4 severity. D3/D4 by an agent → approval.
- Research prices are `rateTrust: ESTIMATED` + `trustLevel: E_AI_ESTIMATE` + `source.url` + `retrievedAt`, always (services/commercial.ts).
- Model routing lives only in `lib/modelRouting.ts` (customer → Haiku 4.5, owner/executive → Sonnet 5, no premium by default).
- Secrets only in Convex env vars (`npx convex env set`); never in code, prompts or knowledge.
- Documents are visible to agents only when `lifecycle` is ACTIVE/REVIEW_DUE and the agent is in `allowedAgents`.
- Schema changes follow docs/DATA_CHANGE_PROCESS.md and update docs/DATA_DICTIONARY.md, ERD.md, VOCABULARY.md.

## Commands
```bash
npm install
npx convex dev            # backend (anonymous local deployment is fine: CONVEX_AGENT_MODE=anonymous)
npm run dev               # frontend on http://localhost:3000
npm run build             # production build (type-checks the frontend)
npm run typecheck         # tsc --noEmit
npm test                  # vitest (convex-test)
npm run lint / format
node scripts/auth-keys.mjs http://localhost:3000   # one-time: JWT_PRIVATE_KEY / JWKS / SITE_URL on the deployment
npx convex env set OWNER_EMAIL=you@example.com
npx convex env set OWNER_PASSWORD='12+ chars with digits'
npm run seed:owner        # creates the owner account + defaults (then remove OWNER_PASSWORD)
npm run seed              # synthetic Omani data (refuses when DEPLOYMENT_STAGE=prod)
```
Windows note: Node lives in `%LOCALAPPDATA%\nodejs` (portable install, on the user PATH).

## Runtime modes
- No `ANTHROPIC_API_KEY` → `mock` LLM provider (deterministic; never invents business data) and hashed mock embeddings.
- No `AUTH_RESEND_KEY` → password-reset codes are printed in Convex logs.
- Instagram/WhatsApp: mock mode until Phase 3 integrations are connected (Settings → Integrations).

## Phase status
- Phase 1 (backbone): done.
- Phase 2 (product + sales agents): done — web research via Anthropic `web_search` (sources become task citations,
  searches billed in usageLog), product drafting tools (draft → components → itinerary → lifecycle → activation
  approval), sales tools (quotes from ACTIVE products only, follow-up proposals, campaigns, content calendar,
  pipeline report). Owner UI: packages (research-rate confirmation, components, itinerary), pipeline (lead dialog,
  quotes, messages), content calendar (campaigns, week grid, owner actions). Services: `services/sales.ts`, `services/reports.ts`.
- Phase 3: support agent inbox, website form, Instagram webhook (mock first).
- Phase 4: reports, scheduled follow-ups, auto-approval rules, Vercel/Convex deployment guide (docs/DEPLOY.md).
