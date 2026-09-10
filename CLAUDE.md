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
  schema.ts               12 domains; MVP tables implemented (1.2: channelIdentities, followUps), the rest as // Phase 2+
  inbound/                http.ts (webhook + contact form), pipeline.ts (internal receive), delivery.ts (Graph API send)
  inbox.ts / followUps.ts owner-facing unified inbox API and post-sale follow-ups API
  reports.ts / scheduled.ts reports API (Phase 4) and scheduled-jobs API (cron entry + owner run-now + status)
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

## Deployment (current)
- Convex cloud deployment `quiet-hyena-590` (URL https://quiet-hyena-590.convex.cloud, HTTP https://quiet-hyena-590.convex.site);
  `.env.local` carries `CONVEX_DEPLOY_KEY` so every `npx convex …` command targets it. Env vars set there: ANTHROPIC_API_KEY,
  LLM_PROVIDER=anthropic, DEPLOYMENT_STAGE=prod, JWT_PRIVATE_KEY/JWKS/SITE_URL, OWNER_EMAIL. Owner account seeded.
- Vercel: build via `node scripts/vercel-build.mjs` (deploys Convex too when CONVEX_DEPLOY_KEY is set in Vercel, otherwise
  frontend-only against the defaults in next.config.ts). GitHub remote: https://github.com/BlackGhostOM/WebAppT.git.
- To develop against a local anonymous backend again, swap the commented lines in `.env.local` and run
  `CONVEX_AGENT_MODE=anonymous npx convex dev`.

## Runtime modes
- No `ANTHROPIC_API_KEY` → `mock` LLM provider (deterministic; never invents business data) and hashed mock embeddings.
- No `AUTH_RESEND_KEY` → password-reset codes are printed in Convex logs.
- Instagram: `integrations.instagramMode` = `mock` (default; inbox "simulate" button, unsigned webhooks accepted when
  META_APP_SECRET is unset, outbound logged only) or `live` (webhook signature enforced, replies sent via Graph API
  with META_PAGE_ACCESS_TOKEN). WhatsApp: not connected (outbound logged with deliveryStatus NOT_CONNECTED).

## Automation (Phase 4)
- `createApproval` runs the rule engine; `autoApprove(..., { faqEligible })` re-runs it for the FAQ path. Rules and caps
  live in `settings.autoApprove`; automatic decisions are actor `system:auto_approve_rule` and execute via the normal executor.
- Cron jobs call `internal.scheduled.run({ job })`; each job checks its switch in `settings.scheduledTasks`, the emergency
  stop and agent enablement, and audits one SYSTEM row per run. Model-backed jobs create tasks with origin `system`
  (requestedBy `cron:<job>`); `runtime.completeTask` notifies the owner for those.
- Reports are pure read models in `services/reports.ts`; never store computed KPIs.

## Inbound channels (Phase 3)
- HTTP (convex/http.ts → convex/inbound/http.ts): `GET/POST /webhooks/instagram`, `POST /api/contact` (10/min per IP,
  honeypot field `website`). Both call `services/inbox.ts::receiveInbound` → customer match (channelIdentities → phone/email
  → minimal new customer) → `interactions` (NEW) → one support task per message (origin `customer`, Haiku).
- `propose_reply` runs `shouldEscalate` (complaint / confidence < 0.7 / booking > 2000 OMR) → second task with
  `escalationReason` on the escalation model, once. Complaints also create an URGENT executive task. FAQ auto-reply only when
  `autoApprove.faqAutoReply` + INQUIRY + `faq=true` + confidence ≥ threshold + no price text + reply window open.
- Post-sale follow-ups: `services/followUps.ts` (cron 04:00 UTC, `followUps.runNow` for the owner) → approvals → sent.
- Public page `/contact` (proxy.ts allows it) posts to `NEXT_PUBLIC_CONVEX_SITE_URL/api/contact`.

## Phase status
- Phase 1 (backbone): done.
- Phase 2 (product + sales agents): done — web research via Anthropic `web_search` (sources become task citations,
  searches billed in usageLog), product drafting tools (draft → components → itinerary → lifecycle → activation
  approval), sales tools (quotes from ACTIVE products only, follow-up proposals, campaigns, content calendar,
  pipeline report). Owner UI: packages (research-rate confirmation, components, itinerary), pipeline (lead dialog,
  quotes, messages), content calendar (campaigns, week grid, owner actions). Services: `services/sales.ts`, `services/reports.ts`.
- Phase 3 (support agent): done — unified inbox intake (Instagram webhook with mock mode, website contact form, owner
  simulator), customer matching via channel identities, per-message support tasks with one-shot model escalation and
  executive escalation for complaints, FAQ auto-reply gate, owner one-click approve/edit/reject + direct reply, live
  Instagram delivery action, post-sale follow-ups (welcome/reminder/survey) via cron + approvals. Schema 1.2.
- Phase 4 (operations): done — auto-approval rule engine (`services/approvals.ts::evaluateAutoApproval`: kind /
  follow-up / FAQ rules, daily cap, quiet hours, never D4), scheduled jobs (`services/scheduled.ts`: daily digest,
  lead follow-up reminders, weekly executive summary, lifecycle follow-ups; owner switches + "run now"; last run from
  auditLog), reports (`services/reports.ts` + `/reports`: monthly series, support, agent performance, cost projection,
  bookings; `get_report` tool; SVG charts in `components/charts.tsx`; CSV export), dashboard trend cards, ESLint clean,
  docs/DEPLOY.md.
- Next: WhatsApp Cloud API connection, Batch API path for non-urgent tasks, finance domain (P2+ tables).
