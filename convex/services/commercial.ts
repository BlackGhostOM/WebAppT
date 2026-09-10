/**
 * Domain rules that go beyond generic CRUD: research rates (always ESTIMATED),
 * product activation and versioning, booking services with confirmation
 * evidence, lead stage changes and quote drafts built only from approved
 * products.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { assertAccess } from "../lib/access";
import type { Actor } from "../lib/actor";
import { appendAudit, classifySeverity, requiresOwnerApproval } from "../lib/audit";
import { appError } from "../lib/errors";
import { computeFreshness } from "../lib/freshness";
import { nextBusinessId } from "../lib/ids";
import { computeMargin, makeMoney, type Money, omr } from "../lib/money";
import { assertTransition, requireRef } from "../lib/validation";
import * as V from "../lib/vocab";
import { createApproval } from "./approvals";
import { loadCurrencyRates, stampBase } from "./common";

// ---------------------------------------------------------------------------
// Rates gathered by agents from the web are ESTIMATED, always (section 4.6)
// ---------------------------------------------------------------------------
export interface ResearchRateInput {
  supplierId: Id<"suppliers">;
  hotelId?: Id<"hotels">;
  experienceId?: Id<"experiences">;
  componentType: Doc<"rates">["componentType"];
  serviceType: string;
  serviceDescription: string;
  roomType?: string;
  rateBasis: Doc<"rates">["rateBasis"];
  amount: number;
  currency: string;
  season: Doc<"rates">["season"];
  validFrom?: number;
  validTo?: number;
  cancellationTerms?: string;
  sourceUrl: string;
  retrievedAt?: number;
  notes?: string;
}

export async function createResearchRate(ctx: MutationCtx, actor: Actor, input: ResearchRateInput): Promise<{ id: Id<"rates">; businessId: string }> {
  if (!input.sourceUrl || !/^https?:\/\//.test(input.sourceUrl)) throw appError("VALIDATION", "sourceUrl: كل سعر من البحث يحتاج رابط المصدر", { field: "sourceUrl" });
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw appError("VALIDATION", "amount: مبلغ غير صالح", { field: "amount" });
  if (!V.isOneOf(V.RATE_BASES, input.rateBasis)) throw appError("VALIDATION", "rateBasis: قيمة غير معيارية", { field: "rateBasis" });
  if (!V.isOneOf(V.SEASONS, input.season)) throw appError("VALIDATION", "season: قيمة غير معيارية", { field: "season" });
  if (!V.isOneOf(V.COMPONENT_TYPES, input.componentType)) throw appError("VALIDATION", "componentType: قيمة غير معيارية", { field: "componentType" });
  await requireRef(ctx, "suppliers", input.supplierId, "supplierId");
  if (input.hotelId) await requireRef(ctx, "hotels", input.hotelId, "hotelId");
  if (input.experienceId) await requireRef(ctx, "experiences", input.experienceId, "experienceId");

  const retrievedAt = input.retrievedAt ?? Date.now();
  const record = { rateTrust: "ESTIMATED" as const };
  await assertAccess(ctx, actor, "rates", "CREATE", { record });

  const rates = await loadCurrencyRates(ctx);
  const amount = makeMoney(input.amount, input.currency, rates);
  const businessId = await nextBusinessId(ctx, "rates");
  const base = await stampBase(ctx, actor, businessId, {
    classification: "CONFIDENTIAL",
    dataOwnerAgent: "product",
    trustLevel: "E_AI_ESTIMATE",
    verificationStatus: "AI_EXTRACTED",
    source: { kind: "web", url: input.sourceUrl, retrievedAt, ref: actor.id },
  });
  const id = await ctx.db.insert("rates", {
    ...base,
    // Forced regardless of what the caller claims.
    trustLevel: "E_AI_ESTIMATE",
    verificationStatus: "AI_EXTRACTED",
    version: "1.0",
    supplierId: input.supplierId,
    hotelId: input.hotelId,
    experienceId: input.experienceId,
    serviceType: input.serviceType,
    serviceDescription: input.serviceDescription,
    componentType: input.componentType,
    roomType: input.roomType,
    rateBasis: input.rateBasis,
    amount,
    season: input.season,
    blackoutDates: [],
    taxesAndFees: { included: false, notes: "غير معروف — سعر استرشادي من البحث" },
    cancellationTerms: input.cancellationTerms ?? "REQUIRES_VERIFICATION",
    rateTrust: "ESTIMATED",
    status: "PROPOSED",
    validFrom: input.validFrom,
    validTo: input.validTo,
    lastVerifiedAt: undefined,
    freshness: "REQUIRES_VERIFICATION",
    notes: input.notes,
  });
  await appendAudit(ctx, {
    actor,
    table: "rates",
    recordId: id,
    businessId,
    event: "CREATE",
    newValue: { rateTrust: "ESTIMATED", amount, sourceUrl: input.sourceUrl, retrievedAt },
    severity: "D2",
  });
  return { id, businessId };
}

/** Owner confirms an estimated rate with the supplier: raises trust, keeps history in audit. */
export async function confirmRate(ctx: MutationCtx, actor: Actor, rateId: Id<"rates">, input: { rateTrust: "CONTRACTED" | "SUPPLIER_CONFIRMED"; amount?: number; currency?: string; cancellationTerms?: string; validFrom?: number; validTo?: number; evidenceRef?: string }) {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "تأكيد الأسعار متاح للمالك فقط");
  const rate = await ctx.db.get(rateId);
  if (!rate) throw appError("NOT_FOUND", "السعر غير موجود");
  const now = Date.now();
  const amount = input.amount !== undefined ? makeMoney(input.amount, input.currency ?? rate.amount.currency, await loadCurrencyRates(ctx)) : rate.amount;
  const patch: Partial<Doc<"rates">> = {
    rateTrust: input.rateTrust,
    trustLevel: input.rateTrust === "CONTRACTED" ? "A_COMPANY_VERIFIED" : "B_SUPPLIER_CONFIRMED",
    verificationStatus: "HUMAN_VERIFIED",
    verifiedBy: actor,
    verifiedAt: now,
    evidenceRef: input.evidenceRef,
    amount,
    cancellationTerms: input.cancellationTerms ?? rate.cancellationTerms,
    validFrom: input.validFrom ?? rate.validFrom,
    validTo: input.validTo ?? rate.validTo,
    lastVerifiedAt: now,
    status: "ACTIVE",
    updatedAt: now,
    updatedBy: actor,
  };
  patch.freshness = computeFreshness({ validFrom: patch.validFrom, validTo: patch.validTo, lastVerifiedAt: now });
  await ctx.db.patch(rateId, patch);
  await appendAudit(ctx, {
    actor,
    table: "rates",
    recordId: rateId,
    businessId: rate.businessId,
    event: "UPDATE",
    oldValue: { rateTrust: rate.rateTrust, amount: rate.amount, status: rate.status },
    newValue: { rateTrust: input.rateTrust, amount, status: "ACTIVE" },
    severity: "D3",
  });
}

// ---------------------------------------------------------------------------
// Products: activation and versioning (section 4.6)
// ---------------------------------------------------------------------------
export async function activateProduct(ctx: MutationCtx, actor: Actor, productId: Id<"products">) {
  const product = await ctx.db.get(productId);
  if (!product) throw appError("NOT_FOUND", "المنتج غير موجود");
  if (actor.type !== "owner") {
    const { approvalId } = await createApproval(ctx, actor, {
      kind: "SENSITIVE_CHANGE",
      agentSlug: actor.id as V.AgentSlug,
      title: `تفعيل المنتج ${product.businessId} ${product.version}`,
      summary: `الوكيل ${actor.id} يطلب تفعيل المنتج «${product.name}» للبيع.`,
      payload: { table: "products", entityKey: "products", recordId: productId, patch: { status: "ACTIVE" } },
      targetTable: "products",
      targetRecordId: productId,
      severity: "D3",
    });
    return { approvalRequired: true as const, approvalId };
  }
  assertTransition(V.PRODUCT_TRANSITIONS, product.status, "ACTIVE", "المنتج");
  const components = await ctx.db.query("productComponents").withIndex("by_product", (q) => q.eq("productId", productId)).take(200);
  const estimated = components.filter((c) => c.rateTrust === "ESTIMATED" && !c.archivedAt);
  if (!product.pricing.customerSellingPrice) throw appError("VALIDATION", "pricing.customerSellingPrice: لا يُفعَّل منتج بلا سعر بيع للعميل", { field: "customerSellingPrice" });
  const now = Date.now();
  await ctx.db.patch(productId, { status: "ACTIVE", approvedBy: actor, approvedAt: now, updatedAt: now, updatedBy: actor, lastVerifiedAt: now, freshness: computeFreshness({ validFrom: product.validFrom, validTo: product.validTo, lastVerifiedAt: now }) });
  await appendAudit(ctx, {
    actor,
    table: "products",
    recordId: productId,
    businessId: product.businessId,
    event: "UPDATE",
    oldValue: { status: product.status },
    newValue: { status: "ACTIVE", estimatedComponents: estimated.length },
    reason: estimated.length > 0 ? `تنبيه: ${estimated.length} مكوّن بسعر استرشادي` : undefined,
    severity: "D3",
  });
  return { approvalRequired: false as const, estimatedComponents: estimated.length };
}

/** Creates a new version of a product (V1.1 for component changes, V2.0 for redesign). */
export async function createProductVersion(ctx: MutationCtx, actor: Actor, productId: Id<"products">, kind: "minor" | "major", changes: Partial<Pick<Doc<"products">, "name" | "summary" | "pricing" | "highlights" | "inclusions" | "exclusions" | "terms" | "durationDays" | "durationNights">>) {
  const product = await ctx.db.get(productId);
  if (!product) throw appError("NOT_FOUND", "المنتج غير موجود");
  await assertAccess(ctx, actor, "products", "CREATE", { record: product });
  const [major, minor] = product.version.split(".").map((n) => Number(n) || 0);
  const version = kind === "major" ? `${major + 1}.0` : `${major}.${minor + 1}`;
  const now = Date.now();
  const businessId = await nextBusinessId(ctx, "products", { country: "OMN" });
  const { _id, _creationTime, ...rest } = product;
  void _id;
  void _creationTime;
  const base = await stampBase(ctx, actor, businessId, { classification: product.classification, dataOwnerAgent: "product" });
  const newId = await ctx.db.insert("products", {
    ...rest,
    ...base,
    ...changes,
    version,
    supersedes: product.businessId,
    supersededBy: undefined,
    status: "DESIGN",
    approvedBy: undefined,
    approvedAt: undefined,
    approvalId: undefined,
    freshness: computeFreshness({ validFrom: product.validFrom, validTo: product.validTo, lastVerifiedAt: now }),
    lastVerifiedAt: now,
  });
  await ctx.db.patch(productId, { supersededBy: businessId, updatedAt: now, updatedBy: actor });
  // Copy components so the new version is self-contained.
  const components = await ctx.db.query("productComponents").withIndex("by_product", (q) => q.eq("productId", productId)).take(200);
  for (const c of components) {
    if (c.archivedAt) continue;
    const { _id: cid, _creationTime: cct, ...cRest } = c;
    void cid;
    void cct;
    await ctx.db.insert("productComponents", { ...cRest, businessId: await nextBusinessId(ctx, "productComponents"), productId: newId, createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now });
  }
  const itineraries = await ctx.db.query("itineraries").withIndex("by_product", (q) => q.eq("productId", productId)).take(100);
  for (const it of itineraries) {
    const { _id: iid, _creationTime: ict, ...iRest } = it;
    void iid;
    void ict;
    await ctx.db.insert("itineraries", { ...iRest, businessId: await nextBusinessId(ctx, "itineraries"), productId: newId, createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now });
  }
  await appendAudit(ctx, { actor, table: "products", recordId: newId, businessId, event: "CREATE", newValue: { version, supersedes: product.businessId, kind }, severity: "D2" });
  return { id: newId, businessId, version };
}

export interface ComponentInput {
  componentType: Doc<"productComponents">["componentType"];
  description: string;
  dayNumber?: number;
  quantity: number;
  unit: Doc<"productComponents">["unit"];
  supplierId?: Id<"suppliers">;
  hotelId?: Id<"hotels">;
  experienceId?: Id<"experiences">;
  attractionId?: Id<"attractions">;
  rateId?: Id<"rates">;
  supplierCost?: { amount: number; currency: string };
  internalCost?: { amount: number; currency: string };
  minSellingPrice?: { amount: number; currency: string };
  recommendedSellingPrice?: { amount: number; currency: string };
  customerSellingPrice?: { amount: number; currency: string };
}

export async function addProductComponent(ctx: MutationCtx, actor: Actor, productId: Id<"products">, input: ComponentInput) {
  const product = await ctx.db.get(productId);
  if (!product) throw appError("NOT_FOUND", "المنتج غير موجود");
  if (product.status === "ACTIVE" || product.status === "ARCHIVED") throw appError("INVALID_TRANSITION", "لا تُعدَّل مكوّنات منتج فعّال؛ أنشئ إصداراً جديداً");
  await assertAccess(ctx, actor, "productComponents", "CREATE", { record: { productId } });
  if (!V.isOneOf(V.COMPONENT_TYPES, input.componentType)) throw appError("VALIDATION", "componentType: قيمة غير معيارية", { field: "componentType" });
  if (!V.isOneOf(V.RATE_BASES, input.unit)) throw appError("VALIDATION", "unit: قيمة غير معيارية", { field: "unit" });
  if (!input.description?.trim()) throw appError("VALIDATION", "description: إلزامي", { field: "description" });
  const rates = await loadCurrencyRates(ctx);
  const money = (m?: { amount: number; currency: string }): Money | undefined => (m ? makeMoney(m.amount, m.currency, rates) : undefined);
  let rateTrust: Doc<"rates">["rateTrust"] | undefined;
  let trustLevel: V.TrustLevel = actor.type === "owner" ? "A_COMPANY_VERIFIED" : "E_AI_ESTIMATE";
  let supplierCost = money(input.supplierCost);
  if (input.rateId) {
    const rate = await requireRef(ctx, "rates", input.rateId, "rateId");
    rateTrust = rate.rateTrust;
    trustLevel = rate.trustLevel;
    if (!supplierCost) supplierCost = { ...rate.amount, amount: rate.amount.amount * input.quantity, baseAmount: rate.amount.baseAmount * input.quantity };
  }
  const existing = await ctx.db.query("productComponents").withIndex("by_product", (q) => q.eq("productId", productId)).take(200);
  const now = Date.now();
  const businessId = await nextBusinessId(ctx, "productComponents");
  const id = await ctx.db.insert("productComponents", {
    businessId,
    productId,
    componentType: input.componentType,
    dayNumber: input.dayNumber,
    order: existing.length + 1,
    description: input.description.trim(),
    supplierId: input.supplierId,
    hotelId: input.hotelId,
    experienceId: input.experienceId,
    attractionId: input.attractionId,
    rateId: input.rateId,
    rateTrust,
    quantity: input.quantity,
    unit: input.unit,
    pricing: {
      supplierCost,
      internalCost: money(input.internalCost),
      minSellingPrice: money(input.minSellingPrice),
      recommendedSellingPrice: money(input.recommendedSellingPrice),
      customerSellingPrice: money(input.customerSellingPrice),
    },
    source: actor.type === "owner" ? { kind: "human", ref: actor.id } : { kind: "ai", ref: actor.id, retrievedAt: now },
    trustLevel,
    createdBy: actor,
    updatedBy: actor,
    createdAt: now,
    updatedAt: now,
  });
  await appendAudit(ctx, { actor, table: "productComponents", recordId: id, businessId, event: "CREATE", newValue: { productId, componentType: input.componentType, rateTrust }, severity: "D2" });
  return { id, businessId };
}

/** Product-level margin computed from components (never stored). */
export async function productCosting(ctx: QueryCtx | MutationCtx, productId: Id<"products">) {
  const components = (await ctx.db.query("productComponents").withIndex("by_product", (q) => q.eq("productId", productId)).take(200)).filter((c) => !c.archivedAt);
  const sum = (pick: (c: Doc<"productComponents">) => Money | undefined) => components.reduce((s, c) => s + (pick(c)?.baseAmount ?? 0), 0);
  const pricing = {
    supplierCost: omr(sum((c) => c.pricing.supplierCost)),
    internalCost: omr(sum((c) => c.pricing.internalCost)),
    minSellingPrice: omr(sum((c) => c.pricing.minSellingPrice)),
    recommendedSellingPrice: omr(sum((c) => c.pricing.recommendedSellingPrice)),
    customerSellingPrice: omr(sum((c) => c.pricing.customerSellingPrice)),
  };
  return {
    components,
    pricing,
    margin: computeMargin(pricing),
    estimatedComponents: components.filter((c) => c.rateTrust === "ESTIMATED").length,
    trustLevels: [...new Set(components.map((c) => c.trustLevel))],
  };
}

// ---------------------------------------------------------------------------
// Bookings: per-service status with confirmation evidence (section 4.6)
// ---------------------------------------------------------------------------
export interface BookingServiceInput {
  componentType: Doc<"bookingServices">["componentType"];
  description: string;
  supplierId?: Id<"suppliers">;
  hotelId?: Id<"hotels">;
  serviceDateFrom: number;
  serviceDateTo?: number;
  quantity: number;
  rateId?: Id<"rates">;
  customerSellingPrice?: { amount: number; currency: string };
  supplierCost?: { amount: number; currency: string };
}

export async function addBookingService(ctx: MutationCtx, actor: Actor, bookingId: Id<"bookings">, input: BookingServiceInput) {
  const booking = await ctx.db.get(bookingId);
  if (!booking) throw appError("NOT_FOUND", "الحجز غير موجود");
  await assertAccess(ctx, actor, "bookingServices", "CREATE", { record: { customerId: booking.customerId } });
  if (!V.isOneOf(V.COMPONENT_TYPES, input.componentType)) throw appError("VALIDATION", "componentType: قيمة غير معيارية", { field: "componentType" });
  if (!input.description?.trim()) throw appError("VALIDATION", "description: إلزامي", { field: "description" });
  const rates = await loadCurrencyRates(ctx);
  let rateTrust: Doc<"rates">["rateTrust"] | undefined;
  if (input.rateId) rateTrust = (await requireRef(ctx, "rates", input.rateId, "rateId")).rateTrust;
  const now = Date.now();
  const businessId = await nextBusinessId(ctx, "bookingServices");
  const id = await ctx.db.insert("bookingServices", {
    businessId,
    bookingId,
    componentType: input.componentType,
    supplierId: input.supplierId,
    hotelId: input.hotelId,
    description: input.description.trim(),
    serviceDateFrom: input.serviceDateFrom,
    serviceDateTo: input.serviceDateTo,
    quantity: input.quantity,
    status: "PLANNED",
    rateId: input.rateId,
    rateTrust,
    pricing: {
      customerSellingPrice: input.customerSellingPrice ? makeMoney(input.customerSellingPrice.amount, input.customerSellingPrice.currency, rates) : undefined,
      supplierCost: input.supplierCost ? makeMoney(input.supplierCost.amount, input.supplierCost.currency, rates) : undefined,
    },
    createdBy: actor,
    updatedBy: actor,
    createdAt: now,
    updatedAt: now,
  });
  await appendAudit(ctx, { actor, table: "bookingServices", recordId: id, businessId, event: "CREATE", newValue: { bookingId, componentType: input.componentType }, severity: "D2" });
  return { id, businessId };
}

export async function changeBookingServiceStatus(ctx: MutationCtx, actor: Actor, serviceId: Id<"bookingServices">, to: Doc<"bookingServices">["status"], reason?: string) {
  const service = await ctx.db.get(serviceId);
  if (!service) throw appError("NOT_FOUND", "الخدمة غير موجودة");
  if (to === "CONFIRMED") throw appError("INVALID_TRANSITION", "التأكيد يمر عبر confirmBookingService مع دليل التأكيد");
  const booking = await ctx.db.get(service.bookingId);
  await assertAccess(ctx, actor, "bookingServices", "UPDATE", { record: { customerId: booking?.customerId } });
  assertTransition(V.BOOKING_SERVICE_TRANSITIONS, service.status, to, "خدمة الحجز");
  await ctx.db.patch(serviceId, { status: to, updatedAt: Date.now(), updatedBy: actor });
  await appendAudit(ctx, { actor, table: "bookingServices", recordId: serviceId, businessId: service.businessId, event: "UPDATE", oldValue: { status: service.status }, newValue: { status: to }, reason, severity: "D2" });
}

export interface EvidenceInput {
  supplierReference: string;
  confirmedAt: number;
  confirmedPrice: { amount: number; currency: string };
  cancellationTerms: string;
  evidenceKind: Doc<"confirmationEvidence">["evidenceKind"];
  fileStorageId?: Id<"_storage">;
  messageText?: string;
}

/** A service becomes CONFIRMED only together with a confirmation-evidence record (D4). */
export async function confirmBookingService(ctx: MutationCtx, actor: Actor, serviceId: Id<"bookingServices">, evidence: EvidenceInput) {
  const service = await ctx.db.get(serviceId);
  if (!service) throw appError("NOT_FOUND", "الخدمة غير موجودة");
  if (!evidence.supplierReference?.trim()) throw appError("VALIDATION", "supplierReference: مرجع المورد إلزامي", { field: "supplierReference" });
  if (!evidence.cancellationTerms?.trim()) throw appError("VALIDATION", "cancellationTerms: شروط الإلغاء إلزامية", { field: "cancellationTerms" });
  if (!evidence.fileStorageId && !evidence.messageText?.trim()) throw appError("VALIDATION", "messageText: يلزم ملف أو نص الرسالة كدليل", { field: "messageText" });
  if (!V.isOneOf(V.EVIDENCE_KINDS, evidence.evidenceKind)) throw appError("VALIDATION", "evidenceKind: قيمة غير معيارية", { field: "evidenceKind" });
  const severity = classifySeverity("bookingServices", { status: "CONFIRMED" });
  if (actor.type === "agent" && requiresOwnerApproval(severity)) {
    const { approvalId } = await createApproval(ctx, actor, {
      kind: "CONFIRM_BOOKING",
      agentSlug: actor.id as V.AgentSlug,
      title: `تأكيد خدمة الحجز ${service.businessId}`,
      summary: `الوكيل ${actor.id} يطلب تأكيد «${service.description}» بمرجع المورد ${evidence.supplierReference}.`,
      payload: { serviceId, evidence },
      targetTable: "bookingServices",
      targetRecordId: serviceId,
      severity,
    });
    return { approvalRequired: true as const, approvalId };
  }
  assertTransition(V.BOOKING_SERVICE_TRANSITIONS, service.status, "CONFIRMED", "خدمة الحجز");
  const rates = await loadCurrencyRates(ctx);
  const now = Date.now();
  const evidenceBusinessId = await nextBusinessId(ctx, "confirmationEvidence");
  const evidenceId = await ctx.db.insert("confirmationEvidence", {
    businessId: evidenceBusinessId,
    bookingServiceId: serviceId,
    supplierId: service.supplierId,
    supplierReference: evidence.supplierReference.trim(),
    confirmedAt: evidence.confirmedAt,
    confirmedPrice: makeMoney(evidence.confirmedPrice.amount, evidence.confirmedPrice.currency, rates),
    cancellationTerms: evidence.cancellationTerms.trim(),
    evidenceKind: evidence.evidenceKind,
    fileStorageId: evidence.fileStorageId,
    messageText: evidence.messageText,
    verifiedBy: actor,
    verifiedAt: now,
    createdAt: now,
  });
  await ctx.db.patch(serviceId, { status: "CONFIRMED", confirmationEvidenceId: evidenceId, supplierReference: evidence.supplierReference.trim(), updatedAt: now, updatedBy: actor });
  await appendAudit(ctx, { actor, table: "confirmationEvidence", recordId: evidenceId, businessId: evidenceBusinessId, event: "CREATE", newValue: { serviceId, supplierReference: evidence.supplierReference }, severity });
  await appendAudit(ctx, { actor, table: "bookingServices", recordId: serviceId, businessId: service.businessId, event: "UPDATE", oldValue: { status: service.status }, newValue: { status: "CONFIRMED", confirmationEvidenceId: evidenceId }, severity });
  return { approvalRequired: false as const, evidenceId };
}

// ---------------------------------------------------------------------------
// Leads and quotes
// ---------------------------------------------------------------------------
export async function changeLeadStage(ctx: MutationCtx, actor: Actor, leadId: Id<"leads">, stage: V.LeadStage, opts: { lostReason?: string; note?: string } = {}) {
  const lead = await ctx.db.get(leadId);
  if (!lead) throw appError("NOT_FOUND", "العميل المحتمل غير موجود");
  await assertAccess(ctx, actor, "leads", "UPDATE", { record: lead });
  if (!V.isOneOf(V.LEAD_STAGES, stage)) throw appError("VALIDATION", "stage: مرحلة غير معيارية", { field: "stage" });
  assertTransition(V.LEAD_TRANSITIONS, lead.stage, stage, "العميل المحتمل");
  if (stage === "LOST" && !V.isOneOf(V.LOST_REASONS, opts.lostReason)) throw appError("VALIDATION", "lostReason: يلزم سبب خسارة معياري", { field: "lostReason" });
  const now = Date.now();
  await ctx.db.patch(leadId, {
    stage,
    lostReason: stage === "LOST" ? (opts.lostReason as V.LostReasonType) : undefined,
    lastContactAt: now,
    updatedAt: now,
    updatedBy: actor,
    ...(opts.note ? { summary: `${lead.summary ?? ""}\n${opts.note}`.trim() } : {}),
  });
  await appendAudit(ctx, { actor, table: "leads", recordId: leadId, businessId: lead.businessId, event: "UPDATE", oldValue: { stage: lead.stage }, newValue: { stage, lostReason: opts.lostReason }, reason: opts.note, severity: "D2" });
}

/** Draft quote from an approved product only; ESTIMATED/EXPIRED components produce owner warnings. */
export async function createQuoteDraft(ctx: MutationCtx, actor: Actor, input: { leadId: Id<"leads">; productId: Id<"products">; pax: number; discountPercent?: number; validDays?: number }) {
  const lead = await requireRef(ctx, "leads", input.leadId, "leadId");
  const product = await requireRef(ctx, "products", input.productId, "productId");
  await assertAccess(ctx, actor, "quotes", "CREATE", { record: { customerId: lead.customerId } });
  if (product.status !== "ACTIVE") throw appError("VALIDATION", "productId: العروض تُبنى على منتجات فعّالة (ACTIVE) فقط", { field: "productId" });
  if (!Number.isInteger(input.pax) || input.pax < 1) throw appError("VALIDATION", "pax: عدد الأفراد غير صالح", { field: "pax" });
  const costing = await productCosting(ctx, input.productId);
  const warnings: string[] = [];
  if (costing.estimatedComponents > 0) warnings.push(`${costing.estimatedComponents} مكوّن بسعر استرشادي (ESTIMATED) يحتاج تأكيد المورد قبل الإرسال`);
  for (const c of costing.components) {
    if (!c.rateId) continue;
    const rate = await ctx.db.get(c.rateId);
    if (rate && computeFreshness(rate) === "EXPIRED") warnings.push(`السعر ${rate.businessId} منتهي الصلاحية`);
  }
  const perPerson = product.pricing;
  const scale = (m?: Money): Money | undefined => (m ? { ...m, amount: m.amount * input.pax, baseAmount: m.baseAmount * input.pax } : undefined);
  const discount = input.discountPercent ?? 0;
  const rules = await ctx.db.query("pricingRules").withIndex("by_kind", (q) => q.eq("kind", "DISCOUNT_CAP")).take(10);
  const cap = rules.filter((r) => r.status === "ACTIVE" && !r.archivedAt).sort((a, b) => b.priority - a.priority)[0];
  if (cap && discount > cap.value) throw appError("VALIDATION", `discountPercent: يتجاوز سقف الخصم المعتمد (${cap.value}%)`, { field: "discountPercent" });
  const customerSellingPrice = scale(perPerson.customerSellingPrice ?? perPerson.recommendedSellingPrice);
  if (!customerSellingPrice) throw appError("VALIDATION", "المنتج بلا سعر بيع للعميل");
  const discounted: Money = { ...customerSellingPrice, amount: Math.round(customerSellingPrice.amount * (1 - discount / 100) * 1000) / 1000, baseAmount: Math.round(customerSellingPrice.baseAmount * (1 - discount / 100) * 1000) / 1000 };
  const minSelling = scale(perPerson.minSellingPrice);
  if (minSelling && discounted.baseAmount < minSelling.baseAmount) warnings.push("السعر بعد الخصم أقل من الحد الأدنى لسعر البيع");
  const now = Date.now();
  const businessId = await nextBusinessId(ctx, "quotes");
  const base = await stampBase(ctx, actor, businessId, { classification: "CUSTOMER_CONFIDENTIAL", dataOwnerAgent: "sales" });
  const id = await ctx.db.insert("quotes", {
    ...base,
    version: "1.0",
    leadId: input.leadId,
    customerId: lead.customerId,
    productId: input.productId,
    productVersion: product.version,
    status: "DRAFT",
    lines: costing.components.map((c) => ({ componentType: c.componentType, description: c.description, quantity: c.quantity, rateId: c.rateId, rateTrust: c.rateTrust, pricing: c.pricing })),
    totals: {
      supplierCost: scale(perPerson.supplierCost),
      internalCost: scale(perPerson.internalCost),
      minSellingPrice: minSelling,
      recommendedSellingPrice: scale(perPerson.recommendedSellingPrice),
      customerSellingPrice: discounted,
    },
    priceWarnings: warnings,
    validUntil: now + (input.validDays ?? 7) * 24 * 60 * 60 * 1000,
    citations: [{ kind: "record", table: "products", recordId: input.productId, retrievedAt: now }],
  });
  await appendAudit(ctx, { actor, table: "quotes", recordId: id, businessId, event: "CREATE", newValue: { leadId: input.leadId, productId: input.productId, productVersion: product.version, warnings }, severity: "D2" });
  // Preparing a proposal advances the lead when the pipeline allows it.
  if (V.LEAD_TRANSITIONS[lead.stage].includes("PROPOSAL_PREPARED")) {
    await ctx.db.patch(lead._id, { stage: "PROPOSAL_PREPARED", updatedAt: now, updatedBy: actor });
    await appendAudit(ctx, { actor, table: "leads", recordId: lead._id, businessId: lead.businessId, event: "UPDATE", oldValue: { stage: lead.stage }, newValue: { stage: "PROPOSAL_PREPARED", quoteId: id }, severity: "D2" });
  }
  return { id, businessId, warnings };
}

// ---------------------------------------------------------------------------
// Itinerary (day plan) — editable while the product is not ACTIVE
// ---------------------------------------------------------------------------
export interface ItineraryDayInput {
  dayNumber: number;
  title: string;
  description: string;
  destinationId?: Id<"destinations">;
  attractionIds?: Id<"attractions">[];
  meals?: { breakfast: boolean; lunch: boolean; dinner: boolean };
  overnightHotelId?: Id<"hotels">;
  overnightDestinationId?: Id<"destinations">;
}

export async function upsertItineraryDay(ctx: MutationCtx, actor: Actor, productId: Id<"products">, input: ItineraryDayInput): Promise<Id<"itineraries">> {
  const product = await ctx.db.get(productId);
  if (!product) throw appError("NOT_FOUND", "المنتج غير موجود");
  if (product.status === "ACTIVE" || product.status === "ARCHIVED") throw appError("INVALID_TRANSITION", "لا يُعدَّل برنامج منتج فعّال؛ أنشئ إصداراً جديداً");
  await assertAccess(ctx, actor, "itineraries", "CREATE", { record: { productId } });
  if (!Number.isInteger(input.dayNumber) || input.dayNumber < 1 || input.dayNumber > Math.max(product.durationDays, 1)) {
    throw appError("VALIDATION", `dayNumber: يجب أن يكون بين 1 و${product.durationDays}`, { field: "dayNumber" });
  }
  if (!input.title?.trim()) throw appError("VALIDATION", "title: إلزامي", { field: "title" });
  if (input.destinationId) await requireRef(ctx, "destinations", input.destinationId, "destinationId");
  if (input.overnightHotelId) await requireRef(ctx, "hotels", input.overnightHotelId, "overnightHotelId");
  for (const a of input.attractionIds ?? []) await requireRef(ctx, "attractions", a, "attractionIds");
  const existing = (await ctx.db.query("itineraries").withIndex("by_product", (q) => q.eq("productId", productId)).take(60)).find((d) => d.dayNumber === input.dayNumber);
  const now = Date.now();
  const fields = {
    title: input.title.trim(),
    description: input.description?.trim() ?? "",
    destinationId: input.destinationId,
    attractionIds: input.attractionIds ?? [],
    meals: input.meals ?? { breakfast: false, lunch: false, dinner: false },
    overnightHotelId: input.overnightHotelId,
    overnightDestinationId: input.overnightDestinationId,
  };
  if (existing) {
    await ctx.db.patch(existing._id, { ...fields, updatedAt: now, updatedBy: actor });
    await appendAudit(ctx, { actor, table: "itineraries", recordId: existing._id, businessId: existing.businessId, event: "UPDATE", newValue: fields, severity: "D2" });
    return existing._id;
  }
  const businessId = await nextBusinessId(ctx, "itineraries");
  const id = await ctx.db.insert("itineraries", { businessId, productId, dayNumber: input.dayNumber, ...fields, createdBy: actor, updatedBy: actor, createdAt: now, updatedAt: now });
  await appendAudit(ctx, { actor, table: "itineraries", recordId: id, businessId, event: "CREATE", newValue: { productId, dayNumber: input.dayNumber, ...fields }, severity: "D2" });
  return id;
}

export async function archiveProductComponent(ctx: MutationCtx, actor: Actor, componentId: Id<"productComponents">) {
  const component = await ctx.db.get(componentId);
  if (!component) throw appError("NOT_FOUND", "المكوّن غير موجود");
  const product = await ctx.db.get(component.productId);
  if (product?.status === "ACTIVE") throw appError("INVALID_TRANSITION", "لا تُعدَّل مكوّنات منتج فعّال؛ أنشئ إصداراً جديداً");
  await assertAccess(ctx, actor, "productComponents", "ARCHIVE", { record: component });
  const now = Date.now();
  await ctx.db.patch(componentId, { archivedAt: now, updatedAt: now, updatedBy: actor });
  await appendAudit(ctx, { actor, table: "productComponents", recordId: componentId, businessId: component.businessId, event: "ARCHIVE", severity: "D2" });
}
