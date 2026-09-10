/**
 * Unified inbox API for the owner UI (page 6): list, thread view with the
 * customer record, one-click approval of proposed replies (via approvals.decide),
 * direct owner replies, status changes, and a mock-mode simulator.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { ownerActor, requireOwner, requireUser, systemActor } from "./lib/actor";
import { appendAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { getSetting } from "./lib/settings";
import * as V from "./lib/vocab";
import { createSupportTask, markInteraction, receiveInbound } from "./services/inbox";
import { logInteraction } from "./services/sales";

export const list = query({
  args: { status: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { status, limit }) => {
    await requireUser(ctx);
    const rows = status
      ? await ctx.db.query("interactions").withIndex("by_status", (q) => q.eq("status", status as Doc<"interactions">["status"])).order("desc").take(limit ?? 100)
      : await ctx.db.query("interactions").withIndex("by_receivedAt").order("desc").take(limit ?? 100);
    const out = [];
    for (const r of rows) {
      const customer = r.customerId ? await ctx.db.get(r.customerId) : null;
      const lead = r.leadId ? await ctx.db.get(r.leadId) : null;
      out.push({ ...r, customerName: customer?.fullName ?? lead?.contactName ?? null, customerBusinessId: customer?.businessId ?? null, leadBusinessId: lead?.businessId ?? null });
    }
    return out;
  },
});

export const stats = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const count = async (status: Doc<"interactions">["status"]) => (await ctx.db.query("interactions").withIndex("by_status", (q) => q.eq("status", status)).take(500)).filter((i) => i.direction === "INBOUND").length;
    const integrations = await getSetting(ctx, "integrations");
    return { NEW: await count("NEW"), REPLY_PROPOSED: await count("REPLY_PROPOSED"), ESCALATED: await count("ESCALATED"), instagramMode: integrations.instagramMode };
  },
});

/** Everything the owner needs to decide on one message without leaving the page. */
export const thread = query({
  args: { interactionId: v.id("interactions") },
  handler: async (ctx, { interactionId }) => {
    await requireUser(ctx);
    const interaction = await ctx.db.get(interactionId);
    if (!interaction) return null;
    const customer = interaction.customerId ? await ctx.db.get(interaction.customerId) : null;
    const messages = interaction.customerId ? (await ctx.db.query("interactions").withIndex("by_customer", (q) => q.eq("customerId", interaction.customerId)).order("desc").take(40)).reverse() : [interaction];
    const task = interaction.taskId ? await ctx.db.get(interaction.taskId) : null;
    const escalatedTask = task ? ((await ctx.db.query("tasks").order("desc").take(200)).find((t) => t.escalationOf === task._id) ?? null) : null;
    const approval = interaction.approvalId ? await ctx.db.get(interaction.approvalId) : null;
    const bookings = interaction.customerId ? (await ctx.db.query("bookings").withIndex("by_customer", (q) => q.eq("customerId", interaction.customerId!)).take(10)).filter((b) => !b.archivedAt) : [];
    const leads = interaction.customerId ? (await ctx.db.query("leads").withIndex("by_customer", (q) => q.eq("customerId", interaction.customerId!)).take(10)).filter((l) => !l.archivedAt) : [];
    const identities = interaction.customerId ? await ctx.db.query("channelIdentities").withIndex("by_customer", (q) => q.eq("customerId", interaction.customerId!)).take(10) : [];
    const followUps = interaction.customerId ? await ctx.db.query("followUps").withIndex("by_customer", (q) => q.eq("customerId", interaction.customerId!)).take(20) : [];
    return {
      interaction,
      customer: customer
        ? { _id: customer._id, businessId: customer.businessId, fullName: customer.fullName, customerType: customer.customerType, phone: customer.phone, email: customer.email, preferredLanguage: customer.preferredLanguage, preferredChannel: customer.preferredChannel, consentStatus: customer.consentStatus, tags: customer.tags, notes: customer.notes, verificationStatus: customer.verificationStatus, createdAt: customer.createdAt }
        : null,
      messages,
      task: task ? { _id: task._id, businessId: task.businessId, status: task.status, model: task.model, escalationReason: task.escalationReason, error: task.error, result: task.result } : null,
      escalatedTask: escalatedTask ? { _id: escalatedTask._id, businessId: escalatedTask.businessId, status: escalatedTask.status, model: escalatedTask.model, escalationReason: escalatedTask.escalationReason } : null,
      approval: approval ? { _id: approval._id, businessId: approval.businessId, status: approval.status, severity: approval.severity, payload: approval.payload, decisionReason: approval.decisionReason } : null,
      bookings: bookings.map((b) => ({ _id: b._id, businessId: b.businessId, status: b.status, travelDateFrom: b.travelDateFrom, travelDateTo: b.travelDateTo, paxAdults: b.paxAdults, paxChildren: b.paxChildren })),
      leads: leads.map((l) => ({ _id: l._id, businessId: l.businessId, stage: l.stage, summary: l.summary })),
      identities: identities.map((i) => ({ channel: i.channel, handle: i.handle, lastSeenAt: i.lastSeenAt })),
      followUps: followUps.map((f) => ({ _id: f._id, businessId: f.businessId, kind: f.kind, status: f.status, dueAt: f.dueAt })),
    };
  },
});

/** Mock mode: the owner injects a customer message to exercise the whole support flow. */
export const simulate = mutation({
  args: {
    channel: v.string(),
    body: v.string(),
    senderName: v.optional(v.string()),
    handle: v.optional(v.string()),
    phone: v.optional(v.string()),
    email: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    if (!V.isOneOf(V.CHANNELS, args.channel)) throw appError("VALIDATION", "channel: قناة غير معيارية", { field: "channel" });
    const handle = args.handle?.trim().replace(/^@/, "") || undefined;
    const usesContact = !!(args.phone?.trim() || args.email?.trim());
    return await receiveInbound(ctx, {
      channel: args.channel,
      body: args.body,
      senderName: args.senderName?.trim() || undefined,
      handle,
      phone: args.phone?.trim() || undefined,
      email: args.email?.trim() || undefined,
      externalId: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      externalSenderId: usesContact ? undefined : `sim:${(handle ?? args.senderName ?? "anon").toLowerCase().replace(/\s+/g, "-")}`,
      source: "simulation",
    });
  },
});

/** The owner answers directly: logged as outbound, original marked replied, any pending proposal cancelled. */
export const replyByOwner = mutation({
  args: { interactionId: v.id("interactions"), message: v.string(), channel: v.optional(v.string()) },
  handler: async (ctx, { interactionId, message, channel }) => {
    const user = await requireOwner(ctx);
    const actor = ownerActor(user);
    const interaction = await ctx.db.get(interactionId);
    if (!interaction) throw appError("NOT_FOUND", "الرسالة غير موجودة");
    if (!message.trim()) throw appError("VALIDATION", "message: نص الرد إلزامي", { field: "message" });
    const useChannel = (channel ?? interaction.channel) as Doc<"interactions">["channel"];
    if (!V.isOneOf(V.CHANNELS, useChannel)) throw appError("VALIDATION", "channel: قناة غير معيارية", { field: "channel" });
    const integrations = await getSetting(ctx, "integrations");
    const outboundId = await logInteraction(ctx, actor, { customerId: interaction.customerId, leadId: interaction.leadId, channel: useChannel, direction: "OUTBOUND", kind: interaction.kind ?? "FOLLOW_UP", body: message, language: interaction.language, taskId: interaction.taskId });
    let delivery: "mock" | "queued_instagram" | "not_connected" = "mock";
    if (integrations.instagramMode === "live" && useChannel === "INSTAGRAM" && interaction.customerId) {
      const identity = (await ctx.db.query("channelIdentities").withIndex("by_customer", (q) => q.eq("customerId", interaction.customerId!)).take(10)).find((i) => i.channel === "INSTAGRAM");
      if (identity) {
        delivery = "queued_instagram";
        await ctx.scheduler.runAfter(0, internal.inbound.delivery.sendInstagram, { interactionId: outboundId, recipientId: identity.externalId, text: message.trim() });
      } else delivery = "not_connected";
    } else if (integrations.instagramMode === "live") delivery = "not_connected";
    await ctx.db.patch(outboundId, { deliveryStatus: delivery === "mock" ? "MOCK" : delivery === "queued_instagram" ? "QUEUED" : "NOT_CONNECTED" });
    await ctx.db.patch(interactionId, { status: "REPLIED", sentAt: Date.now(), updatedAt: Date.now() });
    if (interaction.approvalId) {
      const approval = await ctx.db.get(interaction.approvalId);
      if (approval && approval.status === "PENDING") {
        await ctx.db.patch(approval._id, { status: "CANCELLED", decidedAt: Date.now(), decidedBy: actor, decisionReason: "رد المالك مباشرة" });
        await appendAudit(ctx, { actor, table: "approvals", recordId: approval._id, businessId: approval.businessId, event: "CANCEL", oldValue: { status: "PENDING" }, newValue: { status: "CANCELLED" }, reason: "owner_replied_directly", severity: "D1", approvalId: approval._id, taskId: approval.taskId });
      }
    }
    await appendAudit(ctx, { actor, table: "interactions", recordId: interactionId, businessId: interaction.businessId, event: "UPDATE", oldValue: { status: interaction.status }, newValue: { status: "REPLIED", outboundId, delivery }, severity: "D2" });
    return { outboundId, delivery };
  },
});

export const setStatus = mutation({
  args: { interactionId: v.id("interactions"), status: v.string(), kind: v.optional(v.string()), reason: v.optional(v.string()) },
  handler: async (ctx, { interactionId, status, kind, reason }) => {
    const user = await requireOwner(ctx);
    await markInteraction(ctx, ownerActor(user), interactionId, status as Doc<"interactions">["status"], kind as Doc<"interactions">["kind"] | undefined, reason);
    return null;
  },
});

/** Re-runs the support agent on a message that has no active task (e.g. received during an emergency stop). */
export const reprocess = mutation({
  args: { interactionId: v.id("interactions") },
  handler: async (ctx, { interactionId }) => {
    const user = await requireOwner(ctx);
    const interaction = await ctx.db.get(interactionId);
    if (!interaction || !interaction.customerId) throw appError("NOT_FOUND", "الرسالة غير موجودة أو غير مرتبطة بعميل");
    if (interaction.direction !== "INBOUND") throw appError("VALIDATION", "تُعالَج الرسائل الواردة فقط");
    if (interaction.taskId) {
      const existing = await ctx.db.get(interaction.taskId);
      if (existing && ["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS"].includes(existing.status)) throw appError("CONFLICT", `توجد مهمة جارية (${existing.businessId}) لهذه الرسالة`);
    }
    const customer = await ctx.db.get(interaction.customerId);
    const taskId: Id<"tasks"> = await createSupportTask(ctx, systemActor(`owner_reprocess:${user._id}`), interactionId, interaction.customerId, { language: interaction.language ?? customer?.preferredLanguage ?? "ar" });
    return { taskId };
  },
});
