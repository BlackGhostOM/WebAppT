/**
 * Approval inbox API and the executor that carries out approved actions.
 * External deliveries run in mock mode until integrations are connected.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, mutation, query } from "./_generated/server";
import { resumeAfterDecision } from "./agents/runtime";
import { ownerActor, requireOwner, requireUser, systemActor, type Actor } from "./lib/actor";
import { appendAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { getSetting } from "./lib/settings";
import { decideApproval, listPending, markExecuted } from "./services/approvals";
import { confirmBookingService, type EvidenceInput } from "./services/commercial";
import { updateRecord } from "./services/records";
import { deliverApprovedMessage, markQuoteSent } from "./services/sales";

export const pending = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await listPending(ctx);
  },
});

export const list = query({
  args: { status: v.optional(v.string()), limit: v.optional(v.number()) },
  handler: async (ctx, { status, limit }) => {
    await requireUser(ctx);
    if (status) return await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", status as Doc<"approvals">["status"])).order("desc").take(limit ?? 100);
    return await ctx.db.query("approvals").order("desc").take(limit ?? 100);
  },
});

export const get = query({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => {
    await requireUser(ctx);
    const approval = await ctx.db.get(approvalId);
    if (!approval) return null;
    const task = approval.taskId ? await ctx.db.get(approval.taskId) : null;
    const audit = await ctx.db.query("auditLog").withIndex("by_table_record", (q) => q.eq("table", "approvals").eq("recordId", approvalId)).take(50);
    return { approval, task, audit };
  },
});

export const decide = mutation({
  args: {
    approvalId: v.id("approvals"),
    decision: v.union(v.literal("APPROVED"), v.literal("REJECTED"), v.literal("EDITED_APPROVED")),
    reason: v.optional(v.string()),
    editedPayload: v.optional(v.any()),
  },
  handler: async (ctx, { approvalId, decision, reason, editedPayload }) => {
    const user = await requireOwner(ctx);
    const actor = ownerActor(user);
    const approval = await decideApproval(ctx, actor, approvalId, decision, { reason, editedPayload });
    if (decision === "REJECTED") {
      await applyRejectionSideEffects(ctx, actor, approval);
    } else {
      await ctx.scheduler.runAfter(0, internal.approvals.execute, { approvalId });
    }
    if (approval.kind === "OTHER") await resumeAfterDecision(ctx, approval);
    return null;
  },
});

async function applyRejectionSideEffects(ctx: Parameters<typeof decideApproval>[0], actor: Actor, approval: Doc<"approvals">) {
  const payload = (approval.payload ?? {}) as Record<string, unknown>;
  if (approval.kind === "SEND_QUOTE" && payload.quoteId) {
    const quote = await ctx.db.get(payload.quoteId as Id<"quotes">);
    if (quote && quote.status === "PENDING_APPROVAL") await ctx.db.patch(quote._id, { status: "DRAFT", updatedAt: Date.now(), updatedBy: actor });
  }
  if (approval.kind === "PUBLISH_CONTENT" && payload.contentId) {
    const content = await ctx.db.get(payload.contentId as Id<"contentCalendar">);
    if (content) await ctx.db.patch(content._id, { status: "REJECTED", rejectionReason: approval.decisionReason, updatedAt: Date.now(), updatedBy: actor });
  }
  if (approval.kind === "SEND_CUSTOMER_MESSAGE" && payload.interactionId) {
    const interaction = await ctx.db.get(payload.interactionId as Id<"interactions">);
    if (interaction) await ctx.db.patch(interaction._id, { status: "CLASSIFIED", updatedAt: Date.now() });
  }
}

/** Executes an approved action. Mock mode records the delivery instead of calling Meta/WhatsApp. */
export const execute = internalAction({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }): Promise<unknown> => {
    try {
      const result: unknown = await ctx.runMutation(internal.approvals.applyExecution, { approvalId });
      return result;
    } catch (e) {
      await ctx.runMutation(internal.approvals.recordExecutionFailure, { approvalId, error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },
});

export const recordExecutionFailure = internalMutation({
  args: { approvalId: v.id("approvals"), error: v.string() },
  handler: async (ctx, { approvalId, error }) => {
    await markExecuted(ctx, approvalId, undefined, error);
  },
});

export const applyExecution = internalMutation({
  args: { approvalId: v.id("approvals") },
  handler: async (ctx, { approvalId }) => {
    const approval = await ctx.db.get(approvalId);
    if (!approval) throw appError("NOT_FOUND", "طلب الاعتماد غير موجود");
    if (approval.status !== "APPROVED" && approval.status !== "EDITED_APPROVED") return { skipped: true };
    const payload = { ...((approval.payload ?? {}) as Record<string, unknown>), ...((approval.editedPayload ?? {}) as Record<string, unknown>) };
    const owner: Actor = approval.decidedBy?.type === "owner" ? approval.decidedBy : systemActor("approval_executor");
    const integrations = await getSetting(ctx, "integrations");
    const mode = integrations.instagramMode;
    const now = Date.now();
    let result: Record<string, unknown> = {};

    switch (approval.kind) {
      case "SEND_CUSTOMER_MESSAGE": {
        result = await deliverApprovedMessage(ctx, owner, approval, payload, mode);
        break;
      }
      case "SEND_QUOTE": {
        const quoteId = payload.quoteId as Id<"quotes">;
        const { quote } = await markQuoteSent(ctx, owner, quoteId, (payload.channel as Doc<"interactions">["channel"]) ?? "EMAIL", String(payload.message ?? ""), approvalId);
        result = { delivery: mode === "live" ? "queued_for_channel" : "mock_logged", quote: quote.businessId };
        break;
      }
      case "PUBLISH_CONTENT": {
        const contentId = payload.contentId as Id<"contentCalendar">;
        const content = await ctx.db.get(contentId);
        if (!content) throw appError("NOT_FOUND", "المنشور غير موجود");
        const future = content.scheduledAt.timestamp > now + 60_000;
        if (typeof payload.caption === "string" && payload.caption !== content.caption) await ctx.db.patch(contentId, { caption: payload.caption });
        await ctx.db.patch(contentId, {
          status: future ? "SCHEDULED" : "PUBLISHED",
          ...(future ? {} : { publishedAt: now, externalPostId: mode === "live" ? undefined : `mock-${contentId}` }),
          updatedAt: now,
          updatedBy: owner,
        });
        result = { status: future ? "SCHEDULED" : "PUBLISHED", mode };
        break;
      }
      case "SENSITIVE_CHANGE": {
        const entityKey = payload.entityKey as Parameters<typeof updateRecord>[2] | undefined;
        const recordId = payload.recordId as string;
        const patch = (payload.patch ?? {}) as Record<string, unknown>;
        if (entityKey && recordId) {
          const applied = await updateRecord(ctx, owner, entityKey, recordId, patch, { reason: `approved:${approval.businessId}` });
          result = { applied: applied.businessId };
        }
        break;
      }
      case "CONFIRM_BOOKING": {
        const serviceId = payload.serviceId as Id<"bookingServices">;
        const evidence = payload.evidence as EvidenceInput;
        const outcome = await confirmBookingService(ctx, owner, serviceId, evidence);
        result = { confirmed: !outcome.approvalRequired };
        break;
      }
      case "RATE_PROPOSAL":
      case "MEMORY_PROMOTION":
      case "DATA_MERGE":
      case "OTHER":
      default:
        result = { note: "decision_recorded" };
    }
    await markExecuted(ctx, approvalId, result);
    await appendAudit(ctx, { actor: owner, table: approval.targetTable ?? "approvals", recordId: approval.targetRecordId ?? approvalId, event: "UPDATE", newValue: { executedApproval: approval.businessId, result }, severity: approval.severity, approvalId, taskId: approval.taskId });
    return result;
  },
});
