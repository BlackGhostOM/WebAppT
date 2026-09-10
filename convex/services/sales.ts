/**
 * Sales & marketing services (section 3.3): quotes going out, follow-up
 * messages, campaigns and the content calendar. Anything that reaches a
 * customer or the public is gated by an approval unless the owner does it.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { assertAccess } from "../lib/access";
import type { Actor } from "../lib/actor";
import { appendAudit } from "../lib/audit";
import { appError } from "../lib/errors";
import { nextBusinessId } from "../lib/ids";
import { makeMoney } from "../lib/money";
import { assertTransition, requireRef } from "../lib/validation";
import * as V from "../lib/vocab";
import { createApproval } from "./approvals";
import { loadCurrencyRates, stampBase } from "./common";
import { markFollowUpSent } from "./followUps";

// ---------------------------------------------------------------------------
// Interactions (unified inbox writes)
// ---------------------------------------------------------------------------
export interface LogInteractionInput {
  customerId?: Id<"customers">;
  leadId?: Id<"leads">;
  channel: Doc<"interactions">["channel"];
  direction: Doc<"interactions">["direction"];
  kind?: Doc<"interactions">["kind"];
  subject?: string;
  body: string;
  language?: "ar" | "en";
  approvalId?: Id<"approvals">;
  taskId?: Id<"tasks">;
  externalId?: string;
}

/** Records a message in the unified inbox. Outbound = already sent (or mock-sent). */
export async function logInteraction(ctx: MutationCtx, actor: Actor, input: LogInteractionInput): Promise<Id<"interactions">> {
  if (!input.body?.trim()) throw appError("VALIDATION", "body: نص الرسالة إلزامي", { field: "body" });
  if (!V.isOneOf(V.CHANNELS, input.channel)) throw appError("VALIDATION", "channel: قناة غير معيارية", { field: "channel" });
  if (!V.isOneOf(V.INTERACTION_DIRECTIONS, input.direction)) throw appError("VALIDATION", "direction: قيمة غير معيارية", { field: "direction" });
  if (input.customerId) await requireRef(ctx, "customers", input.customerId, "customerId");
  if (input.leadId) await requireRef(ctx, "leads", input.leadId, "leadId");
  await assertAccess(ctx, actor, "interactions", "CREATE", { record: { customerId: input.customerId } });
  const now = Date.now();
  const businessId = await nextBusinessId(ctx, "interactions");
  const id = await ctx.db.insert("interactions", {
    businessId,
    customerId: input.customerId,
    leadId: input.leadId,
    channel: input.channel,
    direction: input.direction,
    kind: input.kind,
    status: input.direction === "INBOUND" ? "NEW" : input.direction === "OUTBOUND" ? "REPLIED" : "CLOSED",
    externalId: input.externalId,
    subject: input.subject,
    body: input.body.trim(),
    language: input.language,
    classification: "CUSTOMER_CONFIDENTIAL",
    approvalId: input.approvalId,
    taskId: input.taskId ?? actor.taskId,
    receivedAt: now,
    sentAt: input.direction === "OUTBOUND" ? now : undefined,
    createdBy: actor,
    createdAt: now,
    updatedAt: now,
  });
  if (input.leadId) {
    const lead = await ctx.db.get(input.leadId);
    if (lead) await ctx.db.patch(lead._id, { lastContactAt: now, updatedAt: now, updatedBy: actor });
  }
  await appendAudit(ctx, { actor, table: "interactions", recordId: id, businessId, event: "CREATE", newValue: { channel: input.channel, direction: input.direction, leadId: input.leadId, customerId: input.customerId }, severity: "D2", approvalId: input.approvalId });
  return id;
}

// ---------------------------------------------------------------------------
// Quotes going out
// ---------------------------------------------------------------------------
/** Shared by the approval executor and the owner's direct send. */
export async function markQuoteSent(ctx: MutationCtx, actor: Actor, quoteId: Id<"quotes">, channel: Doc<"interactions">["channel"], message: string, approvalId?: Id<"approvals">) {
  const quote = await ctx.db.get(quoteId);
  if (!quote) throw appError("NOT_FOUND", "العرض غير موجود");
  if (!["DRAFT", "APPROVED", "PENDING_APPROVAL"].includes(quote.status)) throw appError("CONFLICT", `العرض في حالة ${quote.status}`);
  const now = Date.now();
  await ctx.db.patch(quoteId, { status: "SENT", sentAt: now, updatedAt: now, updatedBy: actor, approvalId: approvalId ?? quote.approvalId });
  const lead = await ctx.db.get(quote.leadId);
  if (lead && V.LEAD_TRANSITIONS[lead.stage].includes("QUOTE_SENT")) {
    await ctx.db.patch(lead._id, { stage: "QUOTE_SENT", lastContactAt: now, updatedAt: now, updatedBy: actor });
  }
  const interactionId = await logInteraction(ctx, actor, {
    customerId: quote.customerId,
    leadId: quote.leadId,
    channel,
    direction: "OUTBOUND",
    kind: "FOLLOW_UP",
    subject: `عرض سعر ${quote.businessId}`,
    body: message || `عرض السعر ${quote.businessId} (${quote.version})`,
    approvalId,
  });
  await appendAudit(ctx, { actor, table: "quotes", recordId: quoteId, businessId: quote.businessId, event: "UPDATE", oldValue: { status: quote.status }, newValue: { status: "SENT", channel }, severity: "D3", approvalId });
  return { quote, interactionId };
}

/** The owner sends a quote directly (no approval needed: the owner is the approver). */
export async function sendQuoteByOwner(ctx: MutationCtx, actor: Actor, quoteId: Id<"quotes">, channel: Doc<"interactions">["channel"], message: string) {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "الإرسال المباشر متاح للمالك فقط؛ الوكلاء يمرون عبر الاعتماد");
  if (!V.isOneOf(V.CHANNELS, channel)) throw appError("VALIDATION", "channel: قناة غير معيارية", { field: "channel" });
  return await markQuoteSent(ctx, actor, quoteId, channel, message);
}

// ---------------------------------------------------------------------------
// Follow-ups (proposed by agents, sent after approval)
// ---------------------------------------------------------------------------
export interface FollowUpInput {
  leadId: Id<"leads">;
  channel: Doc<"interactions">["channel"];
  message: string;
  purpose: string;
  followUpAt?: number;
}

export async function proposeFollowUp(ctx: MutationCtx, actor: Actor, agentSlug: V.AgentSlug, input: FollowUpInput) {
  const lead = await requireRef(ctx, "leads", input.leadId, "leadId");
  await assertAccess(ctx, actor, "leads", "UPDATE", { record: lead });
  if (!V.isOneOf(V.CHANNELS, input.channel)) throw appError("VALIDATION", "channel: قناة غير معيارية", { field: "channel" });
  if (!input.message?.trim()) throw appError("VALIDATION", "message: نص الرسالة إلزامي", { field: "message" });
  if (lead.customerId) {
    const customer = await ctx.db.get(lead.customerId);
    if (customer && customer.consentStatus !== "GRANTED") throw appError("FORBIDDEN", `لا يمكن مراسلة العميل: حالة الموافقة ${customer.consentStatus}`);
  }
  const now = Date.now();
  const { approvalId, autoApproved } = await createApproval(ctx, actor, {
    kind: "SEND_CUSTOMER_MESSAGE",
    agentSlug,
    title: `متابعة ${lead.contactName} عبر ${input.channel}`,
    summary: `${input.purpose}: ${input.message.slice(0, 200)}`,
    payload: { leadId: lead._id, customerId: lead.customerId, contactName: lead.contactName, contactPhone: lead.contactPhone, contactEmail: lead.contactEmail, channel: input.channel, message: input.message.trim(), purpose: input.purpose },
    toolName: "propose_follow_up",
    targetTable: "leads",
    targetRecordId: lead._id,
    severity: "D3",
  });
  await ctx.db.patch(lead._id, { nextFollowUpAt: input.followUpAt ?? now, updatedAt: now, updatedBy: actor });
  await appendAudit(ctx, { actor, table: "leads", recordId: lead._id, businessId: lead.businessId, event: "UPDATE", newValue: { nextFollowUpAt: input.followUpAt ?? now, proposedFollowUp: true }, severity: "D2", approvalId });
  return { approvalId, autoApproved };
}

/**
 * Executes an approved customer/lead message. Mock mode records the delivery;
 * live mode hands Instagram messages to the Graph API action (other channels
 * stay logged-only until they are connected — the result says so explicitly).
 */
export async function deliverApprovedMessage(ctx: MutationCtx, actor: Actor, approval: Doc<"approvals">, payload: Record<string, unknown>, mode: "mock" | "live") {
  const channel = (payload.channel as Doc<"interactions">["channel"]) ?? "OTHER";
  const message = String(payload.message ?? "");
  const customerId = payload.customerId as Id<"customers"> | undefined;
  const leadId = payload.leadId as Id<"leads"> | undefined;
  const interactionId = await logInteraction(ctx, actor, {
    customerId,
    leadId,
    channel,
    direction: "OUTBOUND",
    kind: (payload.classification as Doc<"interactions">["kind"]) ?? "FOLLOW_UP",
    body: message,
    language: payload.language === "en" ? "en" : payload.language === "ar" ? "ar" : undefined,
    approvalId: approval._id,
    taskId: approval.taskId,
  });
  if (payload.interactionId) {
    const original = await ctx.db.get(payload.interactionId as Id<"interactions">);
    if (original) await ctx.db.patch(original._id, { status: "REPLIED", sentAt: Date.now(), updatedAt: Date.now() });
  }
  if (payload.followUpId) await markFollowUpSent(ctx, payload.followUpId as Id<"followUps">, interactionId);
  if (leadId) {
    const lead = await ctx.db.get(leadId);
    if (lead && lead.nextFollowUpAt !== undefined && lead.nextFollowUpAt <= Date.now()) await ctx.db.patch(lead._id, { nextFollowUpAt: undefined });
  }

  let delivery: "mock_logged" | "queued_instagram" | "no_channel_identity" | "channel_not_connected_logged_only" = "mock_logged";
  if (mode === "live") {
    if (channel === "INSTAGRAM" && customerId) {
      const identity = (await ctx.db.query("channelIdentities").withIndex("by_customer", (q) => q.eq("customerId", customerId)).take(10)).find((i) => i.channel === "INSTAGRAM");
      if (identity) {
        delivery = "queued_instagram";
        await ctx.scheduler.runAfter(0, internal.inbound.delivery.sendInstagram, { interactionId, recipientId: identity.externalId, text: message });
      } else {
        delivery = "no_channel_identity";
      }
    } else {
      delivery = "channel_not_connected_logged_only";
    }
  }
  await ctx.db.patch(interactionId, { deliveryStatus: delivery === "mock_logged" ? "MOCK" : delivery === "queued_instagram" ? "QUEUED" : "NOT_CONNECTED" });
  return { delivery, interactionId, channel };
}

// ---------------------------------------------------------------------------
// Campaigns and content calendar
// ---------------------------------------------------------------------------
export interface CampaignInput {
  name: string;
  objective: string;
  platforms: Doc<"campaigns">["platforms"];
  startDate?: number;
  endDate?: number;
  targetAudience?: string;
  budget?: { amount: number; currency: string };
  productIds?: Id<"products">[];
}

export async function createCampaign(ctx: MutationCtx, actor: Actor, input: CampaignInput) {
  if (!input.name?.trim()) throw appError("VALIDATION", "name: إلزامي", { field: "name" });
  if (!input.objective?.trim()) throw appError("VALIDATION", "objective: إلزامي", { field: "objective" });
  if (!input.platforms?.length || !input.platforms.every((p) => V.isOneOf(V.CONTENT_PLATFORMS, p))) throw appError("VALIDATION", "platforms: منصات غير معيارية", { field: "platforms" });
  if (input.startDate && input.endDate && input.endDate < input.startDate) throw appError("VALIDATION", "endDate: قبل تاريخ البداية", { field: "endDate" });
  for (const p of input.productIds ?? []) await requireRef(ctx, "products", p, "productIds");
  await assertAccess(ctx, actor, "campaigns", "CREATE");
  const businessId = await nextBusinessId(ctx, "campaigns");
  const base = await stampBase(ctx, actor, businessId, { classification: "INTERNAL", dataOwnerAgent: "sales" });
  const id = await ctx.db.insert("campaigns", {
    ...base,
    name: input.name.trim(),
    objective: input.objective.trim(),
    platforms: input.platforms,
    startDate: input.startDate,
    endDate: input.endDate,
    status: actor.type === "owner" ? "APPROVED" : "DRAFT",
    targetAudience: input.targetAudience,
    budget: input.budget ? makeMoney(input.budget.amount, input.budget.currency, await loadCurrencyRates(ctx)) : undefined,
    productIds: input.productIds ?? [],
  });
  await appendAudit(ctx, { actor, table: "campaigns", recordId: id, businessId, event: "CREATE", newValue: { name: input.name, platforms: input.platforms }, severity: "D2" });
  return { id, businessId };
}

export async function setCampaignStatus(ctx: MutationCtx, actor: Actor, campaignId: Id<"campaigns">, to: Doc<"campaigns">["status"]) {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "حالة الحملة يديرها المالك");
  const campaign = await ctx.db.get(campaignId);
  if (!campaign) throw appError("NOT_FOUND", "الحملة غير موجودة");
  assertTransition(V.CAMPAIGN_TRANSITIONS, campaign.status, to, "الحملة");
  await ctx.db.patch(campaignId, { status: to, updatedAt: Date.now(), updatedBy: actor });
  await appendAudit(ctx, { actor, table: "campaigns", recordId: campaignId, businessId: campaign.businessId, event: "UPDATE", oldValue: { status: campaign.status }, newValue: { status: to }, severity: "D2" });
}

export interface ContentInput {
  platform: Doc<"contentCalendar">["platform"];
  caption: string;
  captionEn?: string;
  hashtags?: string[];
  visualIdea?: string;
  scheduledAt: number;
  productId?: Id<"products">;
  campaignId?: Id<"campaigns">;
}

/**
 * Agents: item is PENDING_APPROVAL and an approval is created (publishing is external).
 * Owner: item is APPROVED immediately (the owner is the approver).
 */
export async function scheduleContent(ctx: MutationCtx, actor: Actor, agentSlug: V.AgentSlug, input: ContentInput) {
  if (!V.isOneOf(V.CONTENT_PLATFORMS, input.platform)) throw appError("VALIDATION", "platform: منصة غير معيارية", { field: "platform" });
  if (!input.caption?.trim()) throw appError("VALIDATION", "caption: النص إلزامي", { field: "caption" });
  if (!Number.isFinite(input.scheduledAt)) throw appError("VALIDATION", "scheduledAt: وقت غير صالح", { field: "scheduledAt" });
  if (input.productId) {
    const product = await requireRef(ctx, "products", input.productId, "productId");
    if (product.status !== "ACTIVE" && /\d/.test(input.caption)) {
      // Prices in public content may only come from an active product.
      throw appError("VALIDATION", "productId: لا يُذكر سعر في محتوى منتج غير فعّال", { field: "productId" });
    }
  }
  if (input.campaignId) await requireRef(ctx, "campaigns", input.campaignId, "campaignId");
  await assertAccess(ctx, actor, "contentCalendar", "CREATE");
  const businessId = await nextBusinessId(ctx, "contentCalendar");
  const base = await stampBase(ctx, actor, businessId, { classification: "INTERNAL", dataOwnerAgent: "sales" });
  const contentId = await ctx.db.insert("contentCalendar", {
    ...base,
    campaignId: input.campaignId,
    productId: input.productId,
    platform: input.platform,
    scheduledAt: { timestamp: input.scheduledAt, timezone: "Asia/Muscat" },
    status: actor.type === "owner" ? "APPROVED" : "PENDING_APPROVAL",
    caption: input.caption.trim(),
    captionEn: input.captionEn,
    hashtags: (input.hashtags ?? []).map((h) => (h.startsWith("#") ? h : `#${h}`)),
    visualIdea: input.visualIdea,
    assetIds: [],
  });
  let approvalId: Id<"approvals"> | undefined;
  if (actor.type !== "owner") {
    const created = await createApproval(ctx, actor, {
      kind: "PUBLISH_CONTENT",
      agentSlug,
      title: `نشر على ${input.platform}: ${input.caption.slice(0, 50)}`,
      summary: `منشور مقترح على ${input.platform} في ${new Date(input.scheduledAt).toISOString()}`,
      payload: { contentId, platform: input.platform, caption: input.caption.trim(), hashtags: input.hashtags ?? [], visualIdea: input.visualIdea, scheduledAt: input.scheduledAt, productId: input.productId, campaignId: input.campaignId },
      toolName: "schedule_content",
      targetTable: "contentCalendar",
      targetRecordId: contentId,
      severity: "D3",
    });
    approvalId = created.approvalId;
    await ctx.db.patch(contentId, { approvalId });
  }
  await appendAudit(ctx, { actor, table: "contentCalendar", recordId: contentId, businessId, event: "CREATE", newValue: { platform: input.platform, scheduledAt: input.scheduledAt, status: actor.type === "owner" ? "APPROVED" : "PENDING_APPROVAL" }, severity: "D2", approvalId });
  return { contentId, businessId, approvalId };
}

/** Owner-driven content transitions; PUBLISHED is a mock publish until Meta is connected. */
export async function setContentStatus(ctx: MutationCtx, actor: Actor, contentId: Id<"contentCalendar">, to: Doc<"contentCalendar">["status"], opts: { reason?: string; mode?: "mock" | "live"; caption?: string } = {}) {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "حالة المحتوى يديرها المالك");
  const content = await ctx.db.get(contentId);
  if (!content) throw appError("NOT_FOUND", "المنشور غير موجود");
  assertTransition(V.CONTENT_TRANSITIONS, content.status, to, "المنشور");
  if (to === "REJECTED" && !opts.reason?.trim()) throw appError("VALIDATION", "reason: سبب الرفض إلزامي", { field: "reason" });
  const now = Date.now();
  const patch: Partial<Doc<"contentCalendar">> = { status: to, updatedAt: now, updatedBy: actor };
  if (opts.caption && opts.caption !== content.caption) patch.caption = opts.caption;
  if (to === "REJECTED") patch.rejectionReason = opts.reason;
  if (to === "PUBLISHED") {
    patch.publishedAt = now;
    patch.externalPostId = (opts.mode ?? "mock") === "live" ? undefined : `mock-${contentId}`;
  }
  await ctx.db.patch(contentId, patch);
  await appendAudit(ctx, { actor, table: "contentCalendar", recordId: contentId, businessId: content.businessId, event: "UPDATE", oldValue: { status: content.status }, newValue: { status: to }, reason: opts.reason, severity: to === "PUBLISHED" ? "D3" : "D2" });
  return patch;
}
