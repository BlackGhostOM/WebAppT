/**
 * Idempotent defaults: the four agents, the access matrix, the tool registry,
 * reference data and data-quality rules. Safe to run on every deploy; it never
 * overwrites owner edits (agent prompts, budgets).
 */
import { v } from "convex/values";
import { internalMutation, mutation, type MutationCtx } from "./_generated/server";
import { AGENT_SEEDS } from "./agents/prompts";
import { TOOL_SPECS } from "./agents/tools";
import { requireOwner, systemActor } from "./lib/actor";
import { appendAudit } from "./lib/audit";
import { DEFAULT_MODEL_ROUTING } from "../lib/modelRouting";
import type { AccessAction, AgentSlug } from "./lib/vocab";

const SYSTEM = systemActor("bootstrap");

interface MatrixSeed {
  agentSlug: AgentSlug;
  resource: string;
  actions: AccessAction[];
  condition?: string;
  fieldDenyList?: string[];
}

const PII_DENY = ["nationality", "idDocumentRef"];
const COST_DENY = ["pricing.supplierCost", "pricing.internalCost", "margin", "totalSupplierCost"];
const SALES_PRODUCT_DENY = ["pricing.supplierCost", "pricing.internalCost", "margin", "targetMarginPercent"];
const SUPPORT_PRODUCT_DENY = ["pricing.supplierCost", "pricing.internalCost", "pricing.minSellingPrice", "pricing.recommendedSellingPrice", "margin", "targetMarginPercent"];

const READ_ALL_EXEC = [
  "customers", "customerPreferences", "leads", "quotes", "interactions", "products", "productComponents", "itineraries", "destinations", "attractions", "experiences",
  "suppliers", "hotels", "contracts", "rates", "pricingRules", "bookings", "bookingServices", "confirmationEvidence", "policies", "sops", "decisionRegister",
  "agents", "tasks", "taskRuns", "approvals", "usageLog", "dataConflicts", "dataGaps", "knowledgeGaps", "campaigns", "contentCalendar", "digitalAssets", "documents", "memories",
];

export const ACCESS_MATRIX_SEED: MatrixSeed[] = [
  // executive: read everything except STRICTLY_CONFIDENTIAL; write tasks/approvals/decisions; no export
  ...READ_ALL_EXEC.map((resource): MatrixSeed => ({
    agentSlug: "executive",
    resource,
    actions: ["READ"],
    condition: "not_strictly_confidential",
    fieldDenyList: [...PII_DENY, "bankAccountRef"],
  })),
  { agentSlug: "executive", resource: "tasks", actions: ["READ", "CREATE", "UPDATE"], condition: "not_strictly_confidential", fieldDenyList: [] },
  { agentSlug: "executive", resource: "approvals", actions: ["READ", "CREATE", "UPDATE"], condition: "not_strictly_confidential", fieldDenyList: [] },
  { agentSlug: "executive", resource: "decisionRegister", actions: ["READ", "CREATE", "UPDATE"], condition: "not_strictly_confidential", fieldDenyList: [] },
  { agentSlug: "executive", resource: "memories", actions: ["READ", "CREATE"], fieldDenyList: [] },
  { agentSlug: "executive", resource: "knowledgeGaps", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: [] },
  { agentSlug: "executive", resource: "dataConflicts", actions: ["READ", "CREATE"], fieldDenyList: [] },
  // product: products, destinations, suppliers, rates (ESTIMATED only), sees cost and margin, no customer PII
  { agentSlug: "product", resource: "products", actions: ["READ", "CREATE", "UPDATE", "ARCHIVE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "productComponents", actions: ["READ", "CREATE", "UPDATE", "ARCHIVE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "itineraries", actions: ["READ", "CREATE", "UPDATE", "ARCHIVE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "destinations", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "attractions", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "experiences", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "suppliers", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: ["bankAccountRef"] },
  { agentSlug: "product", resource: "hotels", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "rates", actions: ["READ", "CREATE", "UPDATE"], condition: "estimated_only", fieldDenyList: [] },
  { agentSlug: "product", resource: "pricingRules", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "product", resource: "policies", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "product", resource: "documents", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "product", resource: "leads", actions: ["READ"], fieldDenyList: ["contactName", "contactPhone", "contactEmail"] },
  { agentSlug: "product", resource: "memories", actions: ["READ", "CREATE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "knowledgeGaps", actions: ["READ", "CREATE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "dataConflicts", actions: ["READ", "CREATE"], fieldDenyList: [] },
  { agentSlug: "product", resource: "tasks", actions: ["READ", "CREATE"], fieldDenyList: [] },
  // sales: leads, quotes, campaigns, content; sees customer/min selling price, never supplier/internal cost
  { agentSlug: "sales", resource: "leads", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "quotes", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: ["totals.supplierCost", "totals.internalCost", "lines"] },
  { agentSlug: "sales", resource: "campaigns", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "contentCalendar", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "customers", actions: ["READ", "CREATE", "UPDATE"], fieldDenyList: PII_DENY },
  { agentSlug: "sales", resource: "interactions", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "products", actions: ["READ"], fieldDenyList: SALES_PRODUCT_DENY },
  { agentSlug: "sales", resource: "productComponents", actions: ["READ"], fieldDenyList: COST_DENY },
  { agentSlug: "sales", resource: "destinations", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "attractions", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "experiences", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "hotels", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "pricingRules", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "policies", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "documents", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "bookings", actions: ["READ"], fieldDenyList: ["totalSupplierCost"] },
  { agentSlug: "sales", resource: "memories", actions: ["READ", "CREATE"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "knowledgeGaps", actions: ["READ", "CREATE"], fieldDenyList: [] },
  { agentSlug: "sales", resource: "tasks", actions: ["READ", "CREATE"], fieldDenyList: [] },
  // support: only the customers in its task context (row-level); never costs or margin (field-level)
  { agentSlug: "support", resource: "customers", actions: ["READ", "CREATE", "UPDATE"], condition: "customer_in_task_context", fieldDenyList: PII_DENY },
  { agentSlug: "support", resource: "customerPreferences", actions: ["READ", "CREATE", "UPDATE"], condition: "customer_in_task_context", fieldDenyList: [] },
  { agentSlug: "support", resource: "interactions", actions: ["READ", "CREATE", "UPDATE"], condition: "customer_in_task_context", fieldDenyList: [] },
  { agentSlug: "support", resource: "bookings", actions: ["READ", "UPDATE"], condition: "customer_in_task_context", fieldDenyList: ["totalSupplierCost"] },
  { agentSlug: "support", resource: "bookingServices", actions: ["READ", "CREATE", "UPDATE"], condition: "customer_in_task_context", fieldDenyList: ["pricing.supplierCost", "pricing.internalCost", "pricing.minSellingPrice", "pricing.recommendedSellingPrice", "margin"] },
  { agentSlug: "support", resource: "quotes", actions: ["READ"], condition: "customer_in_task_context", fieldDenyList: ["totals.supplierCost", "totals.internalCost", "totals.minSellingPrice", "totals.recommendedSellingPrice", "lines"] },
  { agentSlug: "support", resource: "leads", actions: ["READ", "CREATE"], fieldDenyList: [] },
  { agentSlug: "support", resource: "products", actions: ["READ"], fieldDenyList: SUPPORT_PRODUCT_DENY },
  { agentSlug: "support", resource: "destinations", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "support", resource: "attractions", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "support", resource: "experiences", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "support", resource: "hotels", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "support", resource: "policies", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "support", resource: "documents", actions: ["READ"], fieldDenyList: [] },
  { agentSlug: "support", resource: "memories", actions: ["READ", "CREATE"], fieldDenyList: [] },
  { agentSlug: "support", resource: "knowledgeGaps", actions: ["READ", "CREATE"], fieldDenyList: [] },
  { agentSlug: "support", resource: "tasks", actions: ["READ", "CREATE"], fieldDenyList: [] },
];

// De-duplicate executive rows: specific rows override the generic READ rows.
const MATRIX_ROWS: MatrixSeed[] = (() => {
  const map = new Map<string, MatrixSeed>();
  for (const row of ACCESS_MATRIX_SEED) map.set(`${row.agentSlug}:${row.resource}`, row);
  return [...map.values()];
})();

const REF_COUNTRIES = [
  { code: "OM", iso3: "OMN", nameAr: "سلطنة عُمان", nameEn: "Oman", phonePrefix: "+968" },
  { code: "AE", iso3: "ARE", nameAr: "الإمارات", nameEn: "United Arab Emirates", phonePrefix: "+971" },
  { code: "SA", iso3: "SAU", nameAr: "السعودية", nameEn: "Saudi Arabia", phonePrefix: "+966" },
  { code: "QA", iso3: "QAT", nameAr: "قطر", nameEn: "Qatar", phonePrefix: "+974" },
  { code: "KW", iso3: "KWT", nameAr: "الكويت", nameEn: "Kuwait", phonePrefix: "+965" },
  { code: "BH", iso3: "BHR", nameAr: "البحرين", nameEn: "Bahrain", phonePrefix: "+973" },
  { code: "GB", iso3: "GBR", nameAr: "المملكة المتحدة", nameEn: "United Kingdom", phonePrefix: "+44" },
  { code: "DE", iso3: "DEU", nameAr: "ألمانيا", nameEn: "Germany", phonePrefix: "+49" },
  { code: "IN", iso3: "IND", nameAr: "الهند", nameEn: "India", phonePrefix: "+91" },
];

/** Reference exchange rates (OMR per unit). The owner maintains these; agents never invent them. */
const REF_CURRENCIES = [
  { code: "OMR", nameAr: "ريال عُماني", nameEn: "Omani Rial", decimals: 3, rateToBase: 1 },
  { code: "USD", nameAr: "دولار أمريكي", nameEn: "US Dollar", decimals: 2, rateToBase: 0.385 },
  { code: "EUR", nameAr: "يورو", nameEn: "Euro", decimals: 2, rateToBase: 0.42 },
  { code: "GBP", nameAr: "جنيه إسترليني", nameEn: "British Pound", decimals: 2, rateToBase: 0.49 },
  { code: "AED", nameAr: "درهم إماراتي", nameEn: "UAE Dirham", decimals: 2, rateToBase: 0.1048 },
  { code: "SAR", nameAr: "ريال سعودي", nameEn: "Saudi Riyal", decimals: 2, rateToBase: 0.1027 },
];

const REF_LANGUAGES = [
  { code: "ar", nameAr: "العربية", nameEn: "Arabic", rtl: true },
  { code: "en", nameAr: "الإنجليزية", nameEn: "English", rtl: false },
];

const REF_SERVICE_TYPES = [
  { code: "HOTEL_ROOM", nameAr: "غرفة فندقية", nameEn: "Hotel room", componentType: "HOTEL", defaultRateBasis: "PER_NIGHT" },
  { code: "DESERT_CAMP", nameAr: "مخيم صحراوي", nameEn: "Desert camp", componentType: "HOTEL", defaultRateBasis: "PER_NIGHT" },
  { code: "VEHICLE_4X4", nameAr: "سيارة دفع رباعي مع سائق", nameEn: "4x4 with driver", componentType: "TRANSPORT", defaultRateBasis: "PER_VEHICLE" },
  { code: "VEHICLE_RENTAL", nameAr: "تأجير مركبة", nameEn: "Vehicle rental", componentType: "VEHICLE_RENTAL", defaultRateBasis: "PER_VEHICLE" },
  { code: "AIRPORT_TRANSFER", nameAr: "نقل من/إلى المطار", nameEn: "Airport transfer", componentType: "TRANSPORT", defaultRateBasis: "PER_VEHICLE" },
  { code: "GUIDE_DAY", nameAr: "مرشد سياحي (يوم)", nameEn: "Tour guide (day)", componentType: "GUIDE", defaultRateBasis: "PER_GROUP" },
  { code: "ACTIVITY", nameAr: "نشاط", nameEn: "Activity", componentType: "ACTIVITY", defaultRateBasis: "PER_PERSON" },
  { code: "BOAT_TRIP", nameAr: "رحلة بحرية", nameEn: "Boat trip", componentType: "ACTIVITY", defaultRateBasis: "PER_PERSON" },
  { code: "MEAL", nameAr: "وجبة", nameEn: "Meal", componentType: "MEAL", defaultRateBasis: "PER_PERSON" },
  { code: "ENTRY_TICKET", nameAr: "تذكرة دخول", nameEn: "Entry ticket", componentType: "TICKET", defaultRateBasis: "PER_PERSON" },
  { code: "DOMESTIC_FLIGHT", nameAr: "طيران داخلي", nameEn: "Domestic flight", componentType: "FLIGHT", defaultRateBasis: "PER_PERSON" },
] as const;

const REF_PAYMENT_METHODS = [
  { code: "BANK_TRANSFER", nameAr: "تحويل بنكي", nameEn: "Bank transfer" },
  { code: "CARD", nameAr: "بطاقة", nameEn: "Card" },
  { code: "CASH", nameAr: "نقداً", nameEn: "Cash" },
  { code: "PAYMENT_LINK", nameAr: "رابط دفع", nameEn: "Payment link" },
];

const REF_CANCELLATION_TYPES = [
  { code: "FREE_72H", nameAr: "إلغاء مجاني حتى 72 ساعة", nameEn: "Free until 72h", description: "إلغاء مجاني حتى 72 ساعة قبل الخدمة؛ بعدها 100%" },
  { code: "FREE_7D", nameAr: "إلغاء مجاني حتى 7 أيام", nameEn: "Free until 7 days", description: "إلغاء مجاني حتى 7 أيام قبل الخدمة؛ بعدها ليلة واحدة" },
  { code: "NON_REFUNDABLE", nameAr: "غير قابل للاسترداد", nameEn: "Non-refundable", description: "لا استرداد بعد التأكيد" },
  { code: "TIERED", nameAr: "متدرّج", nameEn: "Tiered", description: "50% حتى 14 يوماً، 100% خلال 7 أيام" },
];

const DQ_RULES = [
  { name: "hotel_child_policy", table: "hotels", field: "childPolicy", dimension: "COMPLETENESS", description: "الفندق بلا سياسة أطفال", weight: 2, severity: "D2" },
  { name: "supplier_contact", table: "suppliers", field: "phone", dimension: "COMPLETENESS", description: "المورد بلا رقم اتصال", weight: 2, severity: "D2" },
  { name: "rate_validity", table: "rates", field: "validTo", dimension: "FRESHNESS", description: "السعر بلا تاريخ انتهاء أو منتهٍ", weight: 3, severity: "D3" },
  { name: "rate_cancellation", table: "rates", field: "cancellationTerms", dimension: "COMPLETENESS", description: "السعر بلا شروط إلغاء", weight: 3, severity: "D3" },
  { name: "customer_consent", table: "customers", field: "consentStatus", dimension: "VALIDITY", description: "العميل بلا موافقة تواصل صريحة", weight: 3, severity: "D3" },
  { name: "customer_contact", table: "customers", field: "phone", dimension: "COMPLETENESS", description: "العميل بلا هاتف ولا بريد", weight: 2, severity: "D2" },
  { name: "product_pricing", table: "products", field: "pricing.customerSellingPrice", dimension: "COMPLETENESS", description: "المنتج بلا سعر بيع للعميل", weight: 3, severity: "D2" },
  { name: "destination_description", table: "destinations", field: "description", dimension: "COMPLETENESS", description: "الوجهة بلا وصف", weight: 1, severity: "D1" },
  { name: "record_traceability", table: "*", field: "source", dimension: "TRACEABILITY", description: "سجل بلا مصدر", weight: 3, severity: "D3" },
] as const;

export async function ensureDefaultsInternal(ctx: MutationCtx): Promise<{ agents: number; matrix: number; tools: number }> {
  const now = Date.now();
  let agents = 0;
  for (const slug of Object.keys(AGENT_SEEDS) as AgentSlug[]) {
    const seed = AGENT_SEEDS[slug];
    const existing = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", slug)).unique();
    if (existing) {
      // Agents never edited by the owner pick up new tools/prompts released with the code.
      if (existing.updatedBy.type === "system") {
        const missing = seed.allowedTools.filter((t) => !existing.allowedTools.includes(t));
        if (missing.length > 0 || existing.systemPrompt !== seed.systemPrompt || existing.maxStepsPerTask !== seed.maxStepsPerTask) {
          await ctx.db.patch(existing._id, {
            allowedTools: [...existing.allowedTools, ...missing],
            systemPrompt: seed.systemPrompt,
            promptVersion: existing.systemPrompt === seed.systemPrompt ? existing.promptVersion : existing.promptVersion + 1,
            maxStepsPerTask: seed.maxStepsPerTask,
            updatedAt: now,
            updatedBy: SYSTEM,
          });
        }
      }
      continue;
    }
    await ctx.db.insert("agents", {
      slug,
      name: seed.name,
      nameEn: seed.nameEn,
      description: seed.description,
      systemPrompt: seed.systemPrompt,
      promptVersion: 1,
      allowedTools: seed.allowedTools,
      defaultModel: slug === "executive" ? DEFAULT_MODEL_ROUTING.executiveModel : DEFAULT_MODEL_ROUTING.ownerModel,
      escalationModel: DEFAULT_MODEL_ROUTING.escalationModel,
      monthlyBudgetUsd: seed.monthlyBudgetUsd,
      maxStepsPerTask: seed.maxStepsPerTask,
      enabled: true,
      createdAt: now,
      updatedAt: now,
      updatedBy: SYSTEM,
    });
    agents += 1;
  }

  let matrix = 0;
  for (const row of MATRIX_ROWS) {
    const existing = await ctx.db.query("dataAccessMatrix").withIndex("by_agent_resource", (q) => q.eq("agentSlug", row.agentSlug).eq("resource", row.resource)).unique();
    const doc = { agentSlug: row.agentSlug, resource: row.resource, actions: row.actions, condition: row.condition, fieldDenyList: row.fieldDenyList ?? [], grantedBy: SYSTEM, grantedAt: now };
    if (existing) {
      // Only refresh rows still owned by the bootstrap (owner edits win).
      if (existing.grantedBy.type === "system") await ctx.db.replace(existing._id, doc);
    } else {
      await ctx.db.insert("dataAccessMatrix", doc);
      matrix += 1;
    }
  }

  let tools = 0;
  for (const spec of TOOL_SPECS) {
    const existing = await ctx.db.query("toolRegistry").withIndex("by_name", (q) => q.eq("name", spec.name)).unique();
    const doc = { name: spec.name, kind: spec.kind, description: spec.description, inputSchema: spec.inputSchema, allowedAgents: spec.allowedAgents, severity: spec.severity, requiresApproval: spec.requiresApproval, enabled: true, updatedAt: now };
    if (existing) await ctx.db.patch(existing._id, doc);
    else {
      await ctx.db.insert("toolRegistry", { ...doc, createdAt: now });
      tools += 1;
    }
  }

  for (const c of REF_COUNTRIES) {
    if (!(await ctx.db.query("refCountries").withIndex("by_code", (q) => q.eq("code", c.code)).unique())) await ctx.db.insert("refCountries", { ...c, active: true });
  }
  for (const c of REF_CURRENCIES) {
    if (!(await ctx.db.query("refCurrencies").withIndex("by_code", (q) => q.eq("code", c.code)).unique())) {
      await ctx.db.insert("refCurrencies", { ...c, rateSource: "owner_reference", rateUpdatedAt: now, active: true });
    }
  }
  for (const l of REF_LANGUAGES) {
    if (!(await ctx.db.query("refLanguages").withIndex("by_code", (q) => q.eq("code", l.code)).unique())) await ctx.db.insert("refLanguages", l);
  }
  for (const st of REF_SERVICE_TYPES) {
    if (!(await ctx.db.query("refServiceTypes").withIndex("by_code", (q) => q.eq("code", st.code)).unique())) await ctx.db.insert("refServiceTypes", { ...st });
  }
  for (const pm of REF_PAYMENT_METHODS) {
    if (!(await ctx.db.query("refPaymentMethods").withIndex("by_code", (q) => q.eq("code", pm.code)).unique())) await ctx.db.insert("refPaymentMethods", { ...pm, active: true });
  }
  for (const ct of REF_CANCELLATION_TYPES) {
    if (!(await ctx.db.query("refCancellationTypes").withIndex("by_code", (q) => q.eq("code", ct.code)).unique())) await ctx.db.insert("refCancellationTypes", ct);
  }
  const existingRules = await ctx.db.query("dataQualityRules").take(100);
  for (const rule of DQ_RULES) {
    if (!existingRules.some((r) => r.name === rule.name)) await ctx.db.insert("dataQualityRules", { ...rule, enabled: true, createdAt: now });
  }
  return { agents, matrix, tools };
}

export const ensureDefaults = internalMutation({
  args: {},
  returns: v.object({ agents: v.number(), matrix: v.number(), tools: v.number() }),
  handler: async (ctx) => await ensureDefaultsInternal(ctx),
});

/** Owner-triggered from Settings after a fresh deploy. */
export const ensure = mutation({
  args: {},
  returns: v.object({ agents: v.number(), matrix: v.number(), tools: v.number() }),
  handler: async (ctx) => {
    const user = await requireOwner(ctx);
    const result = await ensureDefaultsInternal(ctx);
    await appendAudit(ctx, { actor: { type: "owner", id: user._id }, table: "settings", recordId: "bootstrap", event: "SEED", newValue: result, severity: "D2" });
    return result;
  },
});
