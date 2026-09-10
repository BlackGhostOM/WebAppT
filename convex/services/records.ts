/**
 * Generic master-data services driven by `lib/entities.ts`.
 *
 * Every write goes through: field validation → referential integrity →
 * duplicate detection → business rules (transitions) → access check → audit.
 * Reads apply the access matrix (row + field level) and recompute freshness.
 */
import { type EntityDef, type EntityKey, type FieldDef, entityDef } from "../../lib/entities";
import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { assertAccess, canSeeCosts, type ContextRefs, redactForActor } from "../lib/access";
import type { Actor } from "../lib/actor";
import { appendAudit, classifySeverity, requiresOwnerApproval } from "../lib/audit";
import { appError } from "../lib/errors";
import { computeFreshness } from "../lib/freshness";
import { iso3, nextBusinessId, type IdTable } from "../lib/ids";
import { makeMoney, type Money } from "../lib/money";
import {
  assertTransition,
  type DuplicateCandidate,
  findBookingDuplicates,
  findCustomerDuplicates,
  findHotelDuplicates,
  findSupplierDuplicates,
  normalizeEmail,
  normalizeName,
  normalizePhone,
  throwIfDuplicates,
  Validator,
} from "../lib/validation";
import { DEFAULT_TIMEZONE } from "../lib/baseFields";
import { getSetting } from "../lib/settings";
import { DOCUMENT_TRANSITIONS, LEAD_TRANSITIONS, PRODUCT_TRANSITIONS, isOneOf } from "../lib/vocab";
import { computeDataQualityScore, loadCurrencyRates, stampBase, stripUndefined, withFreshness, withMargin } from "./common";

type Ctx = QueryCtx | MutationCtx;
type Fields = Record<string, unknown>;

const QUALITY_SCORED: EntityKey[] = ["customers", "suppliers", "hotels", "rates", "products", "destinations"];
const TRANSITION_MAPS: Partial<Record<EntityKey, Record<string, readonly string[]>>> = {
  products: PRODUCT_TRANSITIONS,
  leads: LEAD_TRANSITIONS,
  policies: DOCUMENT_TRANSITIONS,
};

/** Default lifecycle state applied when a create call omits the status field. */
const DEFAULT_STATUS: Partial<Record<EntityKey, string>> = {
  customers: "ACTIVE",
  suppliers: "UNDER_REVIEW",
  hotels: "ACTIVE",
  destinations: "ACTIVE",
  attractions: "ACTIVE",
  experiences: "ACTIVE",
  rates: "ACTIVE",
  products: "IDEA",
  bookings: "INQUIRY",
  leads: "NEW_LEAD",
  pricingRules: "ACTIVE",
  policies: "DRAFT",
  decisionRegister: "ACTIVE",
};

/** Fields never accepted from a form: managed by the system. */
const MANAGED_FIELDS = new Set(["businessId", "createdBy", "updatedBy", "createdAt", "updatedAt", "archivedAt", "trustLevel", "verificationStatus", "source", "version", "supersededBy", "freshness", "dataQualityScore", "productFamilyId", "policyFamilyId", "normalizedName", "normalizedPhone", "normalizedEmail"]);

// ---------------------------------------------------------------------------
// Field validation
// ---------------------------------------------------------------------------
async function parseMoney(ctx: Ctx, v: Validator, field: FieldDef, raw: unknown): Promise<Money | undefined> {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const rates = await loadCurrencyRates(ctx);
  let amount: number;
  let currency = "OMR";
  if (typeof raw === "number") amount = raw;
  else if (typeof raw === "object" && raw !== null && "amount" in raw) {
    const r = raw as { amount: unknown; currency?: unknown };
    amount = typeof r.amount === "string" ? Number(r.amount) : (r.amount as number);
    if (typeof r.currency === "string" && r.currency) currency = r.currency.toUpperCase();
  } else if (typeof raw === "string" && raw.trim() !== "") amount = Number(raw);
  else {
    v.custom(field.name, false, "قيمة مالية غير صالحة");
    return undefined;
  }
  if (!Number.isFinite(amount) || amount < 0) {
    v.custom(field.name, false, "مبلغ غير صالح");
    return undefined;
  }
  try {
    return makeMoney(amount, currency, rates);
  } catch (e) {
    v.custom(field.name, false, `العملة ${currency} بلا سعر صرف مرجعي`);
    void e;
    return undefined;
  }
}

async function parseRef(ctx: Ctx, v: Validator, field: FieldDef, raw: unknown): Promise<string | undefined> {
  if (raw === undefined || raw === null || raw === "") return undefined;
  if (typeof raw !== "string" || !field.refTable) {
    v.custom(field.name, false, "مرجع غير صالح");
    return undefined;
  }
  const table = entityDef(field.refTable).table as TableNames;
  const id = ctx.db.normalizeId(table, raw);
  if (!id) {
    v.custom(field.name, false, "معرّف غير صالح");
    return undefined;
  }
  const doc = await ctx.db.get(id);
  if (!doc || (doc as { archivedAt?: number }).archivedAt) {
    v.custom(field.name, false, "السجل المرتبط غير موجود أو مؤرشف");
    return undefined;
  }
  return id;
}

/**
 * Validates `input` against the entity definition. When `partial` is true only
 * the provided fields are validated (update).
 */
export async function validateEntityInput(ctx: Ctx, def: EntityDef, rawInput: Fields, partial: boolean): Promise<Fields> {
  const input: Fields = { ...rawInput };
  const defaultStatus = DEFAULT_STATUS[def.key];
  if (!partial && defaultStatus && (input[def.statusField] === undefined || input[def.statusField] === "")) input[def.statusField] = defaultStatus;
  const v = new Validator(input);
  const out: Fields = {};
  for (const field of def.fields) {
    const provided = field.name in input && input[field.name] !== undefined;
    if (partial && !provided) continue;
    if (MANAGED_FIELDS.has(field.name)) continue;
    switch (field.type) {
      case "text":
      case "textarea":
        out[field.name] = field.required ? v.requireString(field.name, { min: field.min, max: field.max }) : v.optionalString(field.name, { max: field.max });
        break;
      case "email":
        out[field.name] = v.optionalEmail(field.name);
        break;
      case "phone":
        out[field.name] = v.optionalPhone(field.name);
        break;
      case "number":
      case "percent":
        out[field.name] = field.required ? v.requireNumber(field.name, { min: field.min, max: field.max }) : v.optionalNumber(field.name, { min: field.min, max: field.max });
        break;
      case "integer":
        out[field.name] = field.required ? v.requireNumber(field.name, { min: field.min, max: field.max, integer: true }) : v.optionalNumber(field.name, { min: field.min, max: field.max, integer: true });
        break;
      case "boolean":
        out[field.name] = v.optionalBoolean(field.name) ?? (field.required ? false : undefined);
        break;
      case "enum":
        out[field.name] = field.required ? v.requireEnum(field.name, field.options ?? []) : v.optionalEnum(field.name, field.options ?? []);
        break;
      case "date":
        out[field.name] = field.required ? v.requireTimestamp(field.name) : v.optionalTimestamp(field.name);
        break;
      case "money":
        out[field.name] = await parseMoney(ctx, v, field, input[field.name]);
        if (field.required && out[field.name] === undefined) v.custom(field.name, false, "حقل إلزامي");
        break;
      case "ref":
        out[field.name] = await parseRef(ctx, v, field, input[field.name]);
        if (field.required && out[field.name] === undefined) v.custom(field.name, false, "حقل إلزامي");
        break;
      case "tags": {
        const values = v.optionalStringArray(field.name);
        if (field.options) values.forEach((val) => v.custom(field.name, isOneOf(field.options!, val), `قيمة غير معيارية: ${val}`));
        if (field.refTable) {
          const ids: string[] = [];
          for (const val of values) {
            const id = await parseRef(ctx, v, field, val);
            if (id) ids.push(id);
          }
          out[field.name] = ids;
        } else out[field.name] = values;
        break;
      }
    }
  }
  v.throwIfInvalid();
  return stripUndefined(out);
}

// ---------------------------------------------------------------------------
// Entity-specific shaping (fields that are not simple form inputs)
// ---------------------------------------------------------------------------
function shapeForTable(def: EntityDef, fields: Fields, existing: Fields | undefined, actor: Actor, now: number): Fields {
  const f: Fields = { ...fields };
  const merged = { ...(existing ?? {}), ...fields };
  switch (def.key) {
    case "customers":
      if ("fullName" in f) f.normalizedName = normalizeName(String(f.fullName));
      if ("phone" in f) f.normalizedPhone = normalizePhone(f.phone as string | undefined);
      if ("email" in f) f.normalizedEmail = normalizeEmail(f.email as string | undefined);
      if (!existing) {
        f.tags = f.tags ?? [];
        f.status = f.status ?? "ACTIVE";
      }
      if ("consentStatus" in f) f.consentUpdatedAt = now;
      break;
    case "suppliers":
      if ("name" in f) f.normalizedName = normalizeName(String(f.name));
      if ("phone" in f) f.normalizedPhone = normalizePhone(f.phone as string | undefined);
      if ("email" in f) f.normalizedEmail = normalizeEmail(f.email as string | undefined);
      if (!existing) f.tags = f.tags ?? [];
      break;
    case "hotels":
      if ("name" in f) f.normalizedName = normalizeName(String(f.name));
      if (!existing) {
        f.roomTypes = f.roomTypes ?? [];
        f.amenities = f.amenities ?? [];
      }
      break;
    case "destinations":
    case "attractions":
    case "experiences":
      if ("name" in f) f.normalizedName = normalizeName(String(f.name));
      if (!existing) {
        if (def.key === "destinations") f.bestSeasons = f.bestSeasons ?? [];
        if (def.key === "experiences") f.seasons = f.seasons ?? [];
      }
      break;
    case "rates": {
      const taxesIncluded = f.taxesIncluded as boolean | undefined;
      const taxesPercent = f.taxesPercent as number | undefined;
      delete f.taxesIncluded;
      delete f.taxesPercent;
      if (!existing || taxesIncluded !== undefined || taxesPercent !== undefined) {
        const prev = (existing?.taxesAndFees as { included: boolean; percent?: number } | undefined) ?? { included: true };
        f.taxesAndFees = stripUndefined({ included: taxesIncluded ?? prev.included, percent: taxesPercent ?? prev.percent });
      }
      if (!existing) {
        f.blackoutDates = [];
        f.version = "1.0";
        f.status = f.status ?? "ACTIVE";
      }
      f.freshness = computeFreshness({
        validFrom: merged.validFrom as number | undefined,
        validTo: merged.validTo as number | undefined,
        lastVerifiedAt: now,
        verificationStatus: "HUMAN_VERIFIED",
      });
      f.lastVerifiedAt = now;
      break;
    }
    case "products": {
      const pricingKeys = ["supplierCost", "internalCost", "minSellingPrice", "recommendedSellingPrice", "customerSellingPrice"] as const;
      const touched = pricingKeys.some((k) => k in f);
      if (touched || !existing) {
        const prev = (existing?.pricing as Record<string, unknown> | undefined) ?? {};
        const pricing: Record<string, unknown> = { ...prev };
        for (const k of pricingKeys) {
          if (k in f) {
            pricing[k] = f[k];
            delete f[k];
          }
        }
        f.pricing = stripUndefined(pricing);
      }
      if (!existing) {
        f.version = "1.0";
        f.destinationIds = f.destinationIds ?? [];
        f.highlights = f.highlights ?? [];
        f.inclusions = f.inclusions ?? [];
        f.exclusions = f.exclusions ?? [];
        f.seasons = f.seasons ?? [];
        f.citations = [];
        f.status = f.status ?? "IDEA";
      }
      f.freshness = computeFreshness({ validFrom: merged.validFrom as number | undefined, validTo: merged.validTo as number | undefined, lastVerifiedAt: now });
      if (f.status === "ACTIVE" && actor.type === "owner") {
        f.approvedBy = actor;
        f.approvedAt = now;
      }
      break;
    }
    case "bookings":
      if (!existing) f.timezone = DEFAULT_TIMEZONE;
      if (f.status === "CONFIRMED" && !existing?.confirmedAt) f.confirmedAt = now;
      if (f.status === "CANCELLED" && !existing?.cancelledAt) f.cancelledAt = now;
      break;
    case "leads":
      if (f.stage === "LOST" && !merged.lostReason) {
        throw appError("VALIDATION", "lostReason: يلزم اختيار سبب الخسارة عند تحويل العميل المحتمل إلى LOST", { field: "lostReason" });
      }
      if (f.stage && f.stage !== "LOST") f.lostReason = undefined;
      if (!existing) f.lastContactAt = now;
      break;
    case "pricingRules":
      if (!existing) {
        f.appliesTo = {};
        f.status = f.status ?? "ACTIVE";
      }
      f.freshness = computeFreshness({ validFrom: merged.validFrom as number | undefined, validTo: merged.validTo as number | undefined, lastVerifiedAt: now });
      f.lastVerifiedAt = now;
      break;
    case "policies":
      if (!existing) {
        f.version = "1.0";
        f.appliesToAgents = f.appliesToAgents ?? [];
        f.lifecycle = f.lifecycle ?? "DRAFT";
      }
      f.freshness = computeFreshness({ validFrom: merged.validFrom as number | undefined, validTo: merged.validTo as number | undefined, lastVerifiedAt: now });
      f.lastVerifiedAt = now;
      if (f.lifecycle === "ACTIVE" && actor.type === "owner") {
        f.approvedBy = actor;
        f.approvedAt = now;
      }
      break;
    case "decisionRegister": {
      const scopeAgent = f.scopeAgent;
      const scopeDomain = f.scopeDomain;
      delete f.scopeAgent;
      delete f.scopeDomain;
      if (!existing || scopeAgent !== undefined || scopeDomain !== undefined) {
        const prev = (existing?.scope as Record<string, unknown> | undefined) ?? {};
        f.scope = stripUndefined({ ...prev, agentSlug: scopeAgent ?? prev.agentSlug, domain: scopeDomain ?? prev.domain });
      }
      if (!existing) {
        f.decidedBy = actor;
        f.decidedAt = now;
        f.status = f.status ?? "ACTIVE";
      }
      break;
    }
  }
  return stripUndefined(f);
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------
export async function detectDuplicates(ctx: Ctx, def: EntityDef, fields: Fields, excludeId?: string): Promise<DuplicateCandidate[]> {
  switch (def.duplicateCheck) {
    case "customer":
      return findCustomerDuplicates(
        ctx,
        {
          normalizedPhone: normalizePhone(fields.phone as string | undefined),
          normalizedEmail: normalizeEmail(fields.email as string | undefined),
          normalizedName: fields.fullName ? normalizeName(String(fields.fullName)) : undefined,
        },
        excludeId as Id<"customers"> | undefined,
      );
    case "supplier":
      return findSupplierDuplicates(
        ctx,
        {
          normalizedPhone: normalizePhone(fields.phone as string | undefined),
          normalizedEmail: normalizeEmail(fields.email as string | undefined),
          normalizedName: fields.name ? normalizeName(String(fields.name)) : undefined,
        },
        excludeId as Id<"suppliers"> | undefined,
      );
    case "hotel":
      return fields.name ? findHotelDuplicates(ctx, normalizeName(String(fields.name)), excludeId as Id<"hotels"> | undefined) : [];
    case "booking":
      return fields.customerId && fields.travelDateFrom
        ? findBookingDuplicates(ctx, { customerId: fields.customerId as Id<"customers">, travelDateFrom: fields.travelDateFrom as number })
        : [];
    case "name": {
      if (!fields.name) return [];
      const normalized = normalizeName(String(fields.name));
      const table = def.table as "destinations" | "attractions" | "experiences";
      const rows = await ctx.db.query(table).withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalized)).take(5);
      return rows
        .filter((r) => !r.archivedAt && r._id !== excludeId)
        .map((r) => ({ _id: r._id, businessId: r.businessId, label: r.name, matchedOn: ["name"] }));
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Create / update / archive
// ---------------------------------------------------------------------------
export interface CreateOptions {
  acknowledgeDuplicates?: boolean;
  imported?: boolean;
  contextRefs?: ContextRefs;
}

export interface WriteResult {
  id: string;
  businessId: string;
  approvalRequired?: boolean;
  approvalId?: Id<"approvals">;
}

export async function createRecord(ctx: MutationCtx, actor: Actor, key: EntityKey, input: Fields, opts: CreateOptions = {}): Promise<WriteResult> {
  const def = entityDef(key);
  const fields = await validateEntityInput(ctx, def, input, false);
  const duplicates = await detectDuplicates(ctx, def, fields);
  throwIfDuplicates(duplicates, opts.acknowledgeDuplicates);

  const now = Date.now();
  const shaped = shapeForTable(def, fields, undefined, actor, now);
  await assertAccess(ctx, actor, def.table, "CREATE", { record: shaped, contextRefs: opts.contextRefs });

  const company = await getSetting(ctx, "company");
  const businessId = await nextBusinessId(ctx, def.table as IdTable, {
    year: new Date(now).getUTCFullYear(),
    country: iso3(company.country),
  });
  const base = await stampBase(ctx, actor, businessId, {
    classification: def.defaultClassification,
    dataOwnerAgent: def.dataOwnerAgent,
    imported: opts.imported,
  });
  if (opts.imported && "freshness" in shaped) shaped.freshness = "REQUIRES_VERIFICATION";

  const doc: Fields = { ...base, ...shaped };
  if (def.key === "products") doc.productFamilyId = businessId;
  if (def.key === "policies") doc.policyFamilyId = businessId;
  if (QUALITY_SCORED.includes(def.key)) {
    doc.dataQualityScore = computeDataQualityScore(
      doc,
      def.fields.map((f) => f.name),
      base.verificationStatus,
    );
  }

  const severity = classifySeverity(def.table, shaped);
  if (actor.type === "agent" && requiresOwnerApproval(severity)) {
    throw appError("APPROVAL_REQUIRED", `إنشاء سجل في ${def.table} بخطورة ${severity} يتطلب اعتماد المالك`, { details: { severity } });
  }

  const id = await ctx.db.insert(def.table as TableNames, doc as never);
  await appendAudit(ctx, {
    actor,
    table: def.table,
    recordId: id,
    businessId,
    event: "CREATE",
    newValue: shaped,
    severity,
  });
  return { id, businessId };
}

export interface UpdateOptions {
  reason?: string;
  contextRefs?: ContextRefs;
}

export async function updateRecord(ctx: MutationCtx, actor: Actor, key: EntityKey, rawId: string, input: Fields, opts: UpdateOptions = {}): Promise<WriteResult> {
  const def = entityDef(key);
  const table = def.table as TableNames;
  const id = ctx.db.normalizeId(table, rawId);
  if (!id) throw appError("NOT_FOUND", "معرّف غير صالح");
  const existing = (await ctx.db.get(id)) as Fields | null;
  if (!existing) throw appError("NOT_FOUND", "السجل غير موجود");
  if (existing.archivedAt) throw appError("CONFLICT", "لا يمكن تعديل سجل مؤرشف");

  await assertAccess(ctx, actor, def.table, "UPDATE", { record: existing, contextRefs: opts.contextRefs });

  const fields = await validateEntityInput(ctx, def, input, true);
  const now = Date.now();
  const shaped = shapeForTable(def, fields, existing, actor, now);

  // Controlled status transitions.
  const transitions = TRANSITION_MAPS[def.key];
  const statusField = def.statusField;
  if (transitions && statusField in shaped && shaped[statusField] !== existing[statusField]) {
    assertTransition(transitions as Record<string, readonly string[]>, String(existing[statusField]), String(shaped[statusField]), def.labelAr);
  }
  if (def.key === "bookings" && "status" in shaped && shaped.status === "CONFIRMED") {
    const services = await ctx.db.query("bookingServices").withIndex("by_booking", (q) => q.eq("bookingId", id as Id<"bookings">)).take(100);
    const unconfirmed = services.filter((s) => s.status !== "CONFIRMED" && s.status !== "CANCELLED");
    if (services.length === 0 || unconfirmed.length > 0) {
      throw appError("INVALID_TRANSITION", "لا يمكن تأكيد الحجز قبل تأكيد كل خدماته بدليل تأكيد من المورد", {
        details: { unconfirmed: unconfirmed.map((s) => s.businessId) },
      });
    }
  }

  const changed: Fields = {};
  const oldValues: Fields = {};
  for (const [k, v] of Object.entries(shaped)) {
    if (JSON.stringify(existing[k]) !== JSON.stringify(v)) {
      changed[k] = v;
      oldValues[k] = existing[k];
    }
  }
  if (Object.keys(changed).length === 0) return { id, businessId: String(existing.businessId) };

  const severity = classifySeverity(def.table, changed);
  if (actor.type === "agent" && requiresOwnerApproval(severity)) {
    const approvalId = await createChangeApproval(ctx, actor, def, id, existing, changed, severity, opts.reason);
    return { id, businessId: String(existing.businessId), approvalRequired: true, approvalId };
  }

  const patch: Fields = { ...changed, updatedBy: actor, updatedAt: now };
  if (actor.type === "owner") {
    patch.verificationStatus = "HUMAN_VERIFIED";
    patch.trustLevel = "A_COMPANY_VERIFIED";
    patch.verifiedBy = actor;
    patch.verifiedAt = now;
  }
  if (QUALITY_SCORED.includes(def.key)) {
    patch.dataQualityScore = computeDataQualityScore(
      { ...existing, ...patch },
      def.fields.map((f) => f.name),
      (patch.verificationStatus as never) ?? (existing.verificationStatus as never),
    );
  }
  await ctx.db.patch(id, patch as never);
  await appendAudit(ctx, {
    actor,
    table: def.table,
    recordId: id,
    businessId: String(existing.businessId),
    event: "UPDATE",
    oldValue: oldValues,
    newValue: changed,
    reason: opts.reason,
    severity,
  });
  return { id, businessId: String(existing.businessId) };
}

async function createChangeApproval(ctx: MutationCtx, actor: Actor, def: EntityDef, id: string, existing: Fields, changed: Fields, severity: "D3" | "D4" | "D1" | "D2", reason?: string) {
  const approvalBusinessId = await nextBusinessId(ctx, "approvals");
  const approvalId = await ctx.db.insert("approvals", {
    businessId: approvalBusinessId,
    kind: "SENSITIVE_CHANGE",
    status: "PENDING",
    taskId: actor.taskId,
    agentSlug: actor.id as never,
    title: `تغيير ${severity} على ${def.singularAr} ${String(existing.businessId)}`,
    summary: reason ?? `الوكيل ${actor.id} يقترح تعديل حقول: ${Object.keys(changed).join(", ")}`,
    payload: { table: def.table, entityKey: def.key, recordId: id, patch: changed, before: Object.fromEntries(Object.keys(changed).map((k) => [k, existing[k]])) },
    targetTable: def.table,
    targetRecordId: id,
    severity,
    requestedAt: Date.now(),
  });
  await appendAudit(ctx, {
    actor,
    table: "approvals",
    recordId: approvalId,
    businessId: approvalBusinessId,
    event: "CREATE",
    newValue: { kind: "SENSITIVE_CHANGE", targetTable: def.table, targetRecordId: id },
    severity: "D1",
    approvalId,
  });
  return approvalId;
}

export async function archiveRecord(ctx: MutationCtx, actor: Actor, key: EntityKey, rawId: string, reason: string): Promise<WriteResult> {
  const def = entityDef(key);
  const table = def.table as TableNames;
  const id = ctx.db.normalizeId(table, rawId);
  if (!id) throw appError("NOT_FOUND", "معرّف غير صالح");
  const existing = (await ctx.db.get(id)) as Fields | null;
  if (!existing) throw appError("NOT_FOUND", "السجل غير موجود");
  await assertAccess(ctx, actor, def.table, "ARCHIVE", { record: existing });
  const now = Date.now();
  const patch: Fields = { archivedAt: now, updatedAt: now, updatedBy: actor };
  if (def.statusOptions.includes("ARCHIVED")) patch[def.statusField] = "ARCHIVED";
  await ctx.db.patch(id, patch as never);
  await appendAudit(ctx, {
    actor,
    table: def.table,
    recordId: id,
    businessId: String(existing.businessId),
    event: "ARCHIVE",
    oldValue: { [def.statusField]: existing[def.statusField] },
    newValue: patch,
    reason,
    severity: classifySeverity(def.table, { archivedAt: now }),
  });
  return { id, businessId: String(existing.businessId) };
}

/** Owner confirms an imported / AI-extracted record: raises trust to company-verified. */
export async function verifyRecord(ctx: MutationCtx, actor: Actor, key: EntityKey, rawId: string): Promise<WriteResult> {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "التحقق من السجلات متاح للمالك فقط");
  const def = entityDef(key);
  const table = def.table as TableNames;
  const id = ctx.db.normalizeId(table, rawId);
  if (!id) throw appError("NOT_FOUND", "معرّف غير صالح");
  const existing = (await ctx.db.get(id)) as Fields | null;
  if (!existing) throw appError("NOT_FOUND", "السجل غير موجود");
  const now = Date.now();
  const patch: Fields = {
    verificationStatus: "HUMAN_VERIFIED",
    trustLevel: "A_COMPANY_VERIFIED",
    verifiedBy: actor,
    verifiedAt: now,
    updatedAt: now,
    updatedBy: actor,
  };
  if ("freshness" in existing) {
    patch.lastVerifiedAt = now;
    patch.freshness = computeFreshness({ validFrom: existing.validFrom as number | undefined, validTo: existing.validTo as number | undefined, lastVerifiedAt: now });
  }
  if (QUALITY_SCORED.includes(def.key)) {
    patch.dataQualityScore = computeDataQualityScore({ ...existing, ...patch }, def.fields.map((f) => f.name), "HUMAN_VERIFIED");
  }
  await ctx.db.patch(id, patch as never);
  await appendAudit(ctx, {
    actor,
    table: def.table,
    recordId: id,
    businessId: String(existing.businessId),
    event: "UPDATE",
    oldValue: { verificationStatus: existing.verificationStatus, trustLevel: existing.trustLevel },
    newValue: { verificationStatus: "HUMAN_VERIFIED", trustLevel: "A_COMPANY_VERIFIED" },
    reason: "owner_verification",
    severity: "D2",
  });
  return { id, businessId: String(existing.businessId) };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------
export interface ListOptions {
  status?: string;
  search?: string;
  limit?: number;
  includeArchived?: boolean;
  contextRefs?: ContextRefs;
}

function matchesSearch(def: EntityDef, record: Fields, search: string): boolean {
  const needle = normalizeName(search);
  if (!needle) return true;
  const hay = [record[def.titleField], record.businessId, record.nameEn, record.email, record.phone, record.contactPhone, record.contactName]
    .filter((x) => typeof x === "string")
    .map((x) => normalizeName(x as string))
    .join(" ");
  return hay.includes(needle) || String(record.businessId ?? "").toLowerCase().includes(search.toLowerCase());
}

export async function listRecords(ctx: Ctx, actor: Actor, key: EntityKey, opts: ListOptions = {}): Promise<Fields[]> {
  const def = entityDef(key);
  const row = await assertAccess(ctx, actor, def.table, "READ", { contextRefs: opts.contextRefs });
  const limit = Math.min(opts.limit ?? 100, 500);
  const table = def.table as TableNames;
  const fetched = (await ctx.db.query(table).order("desc").take(Math.max(limit * 4, 200))) as unknown as Fields[];
  let rows = fetched;
  if (!opts.includeArchived) rows = rows.filter((r) => !r.archivedAt);
  if (opts.status) rows = rows.filter((r) => r[def.statusField] === opts.status);
  if (opts.search) rows = rows.filter((r) => matchesSearch(def, r, opts.search!));
  // Row-level scope for agents (e.g. support only sees customers in its task context).
  if (row?.condition === "customer_in_task_context") {
    const allowed = new Set(opts.contextRefs?.customerIds ?? []);
    rows = rows.filter((r) => allowed.has(String(def.table === "customers" ? r._id : r.customerId)));
  }
  if (row?.condition === "not_strictly_confidential") rows = rows.filter((r) => r.classification !== "STRICTLY_CONFIDENTIAL");
  rows = rows.slice(0, limit);
  const costs = canSeeCosts(row);
  return rows.map((r) => redactForActor(row, withMargin(withFreshness(r as never), costs)).record);
}

export async function getRecord(ctx: Ctx, actor: Actor, key: EntityKey, rawId: string, contextRefs?: ContextRefs): Promise<Fields | null> {
  const def = entityDef(key);
  const table = def.table as TableNames;
  const id = ctx.db.normalizeId(table, rawId);
  if (!id) return null;
  const doc = (await ctx.db.get(id)) as Fields | null;
  if (!doc) return null;
  const row = await assertAccess(ctx, actor, def.table, "READ", { record: doc, contextRefs });
  const costs = canSeeCosts(row);
  return redactForActor(row, withMargin(withFreshness(doc as never), costs)).record;
}

/** Sensitive fields (nationality, id document, bank ref) are audited on read. */
export async function auditSensitiveRead(ctx: MutationCtx, actor: Actor, table: string, recordId: string, fields: string[]) {
  await appendAudit(ctx, { actor, table, recordId, event: "SENSITIVE_READ", newValue: { fields }, severity: "D2" });
}
