/**
 * Live delivery to Instagram Messaging (Graph API). Used only when the owner
 * switched `integrations.instagramMode` to "live" and META_PAGE_ACCESS_TOKEN is
 * set in the Convex environment; every outcome is written back to the outbound
 * interaction so the inbox shows SENT / FAILED honestly.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, internalMutation } from "../_generated/server";
import { appendAudit } from "../lib/audit";

const GRAPH_VERSION = "v21.0";

export const sendInstagram = internalAction({
  args: { interactionId: v.id("interactions"), recipientId: v.string(), text: v.string() },
  handler: async (ctx, { interactionId, recipientId, text }) => {
    const token = process.env.META_PAGE_ACCESS_TOKEN;
    if (!token) {
      await ctx.runMutation(internal.inbound.delivery.recordDelivery, { interactionId, ok: false, error: "META_PAGE_ACCESS_TOKEN غير مضبوط في بيئة Convex" });
      return;
    }
    try {
      const res = await fetch(`https://graph.instagram.com/${GRAPH_VERSION}/me/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ recipient: { id: recipientId }, message: { text: text.slice(0, 1000) } }),
      });
      const body = (await res.json().catch(() => ({}))) as { message_id?: string; error?: { message?: string; code?: number } };
      if (!res.ok) {
        await ctx.runMutation(internal.inbound.delivery.recordDelivery, { interactionId, ok: false, error: `Graph API ${res.status}: ${body.error?.message ?? "unknown error"}` });
        return;
      }
      await ctx.runMutation(internal.inbound.delivery.recordDelivery, { interactionId, ok: true, externalId: body.message_id });
    } catch (e) {
      await ctx.runMutation(internal.inbound.delivery.recordDelivery, { interactionId, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  },
});

export const recordDelivery = internalMutation({
  args: { interactionId: v.id("interactions"), ok: v.boolean(), externalId: v.optional(v.string()), error: v.optional(v.string()) },
  handler: async (ctx, { interactionId, ok, externalId, error }) => {
    const interaction = await ctx.db.get(interactionId);
    if (!interaction) return;
    await ctx.db.patch(interactionId, { deliveryStatus: ok ? "SENT" : "FAILED", deliveryError: error, ...(externalId ? { externalId } : {}), updatedAt: Date.now() });
    await appendAudit(ctx, {
      actor: { type: "system", id: "instagram_delivery" },
      table: "interactions",
      recordId: interactionId,
      businessId: interaction.businessId,
      event: "UPDATE",
      newValue: { deliveryStatus: ok ? "SENT" : "FAILED", externalId, error },
      severity: ok ? "D1" : "D2",
      approvalId: interaction.approvalId,
    });
    if (!ok) {
      await ctx.db.insert("notifications", {
        kind: "DELIVERY_FAILED",
        title: `تعذّر إرسال رسالة إنستجرام ${interaction.businessId}`,
        body: error ?? "خطأ غير معروف",
        severity: "WARNING",
        relatedTable: "interactions",
        relatedRecordId: interactionId,
        createdAt: Date.now(),
      });
    }
  },
});
