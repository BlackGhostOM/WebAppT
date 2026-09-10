/**
 * Support-agent decision logic for a proposed reply (sections 2.1 and 3.4):
 *
 *   classify → escalate once to the stronger model when risky → otherwise park
 *   the reply as an approval → complaints also wake the executive agent →
 *   FAQ answers may go out automatically only when the owner enabled it.
 *
 * The agent never sends anything itself; every path ends in `approvals`.
 */
import { shouldEscalate } from "../../lib/modelRouting";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { agentActor } from "../lib/actor";
import { getSetting } from "../lib/settings";
import * as V from "../lib/vocab";
import { autoApprove, createApproval } from "./approvals";
import { escalateInteraction, escalateToExecutive, replyWindowOpen } from "./inbox";

export interface ProposeReplyInput {
  interactionId: Id<"interactions">;
  kind: string | undefined;
  confidence: number | undefined;
  reply: string;
  /** The model asserts the answer comes entirely from approved knowledge / an ACTIVE product. */
  faq?: boolean;
  /** Estimated value of a booking request, used for the large-booking escalation rule. */
  estimatedBookingValueOmr?: number;
}

export interface ProposeReplyOutcome {
  content: string;
  isError?: boolean;
  approvalId?: Id<"approvals">;
  escalatedTaskId?: Id<"tasks">;
  executiveTaskId?: Id<"tasks">;
  autoApproved?: boolean;
}

/** Amounts with a currency marker: an FAQ auto-reply must never state a price the owner did not see. */
const PRICE_PATTERN = /(\d[\d.,]*\s*(ر\.?\s?ع|ريال|OMR|USD|EUR|GBP|AED|SAR|\$|€|£))|((ر\.?\s?ع|ريال|OMR|USD|EUR|GBP|AED|SAR|\$|€|£)\s*\d)/iu;

export function looksLikePriceStatement(text: string): boolean {
  return PRICE_PATTERN.test(text);
}

export async function proposeReply(ctx: MutationCtx, task: Doc<"tasks">, agent: Doc<"agents">, input: ProposeReplyInput): Promise<ProposeReplyOutcome> {
  const interaction = await ctx.db.get(input.interactionId);
  if (!interaction) return { content: "الرسالة غير موجودة", isError: true };
  if (interaction.direction !== "INBOUND") return { content: "لا يُقترح رد إلا على رسالة واردة", isError: true };
  if (!interaction.customerId) return { content: "الرسالة غير مرتبطة بعميل", isError: true };
  if (agent.slug === "support" && !task.contextRefs.customerIds.includes(interaction.customerId)) return { content: "الرسالة خارج نطاق مهمتك", isError: true };
  if (!V.isOneOf(V.INTERACTION_KINDS, input.kind)) return { content: `kind غير معياري. المسموح: ${V.INTERACTION_KINDS.join(", ")}`, isError: true };
  const kind = input.kind;
  const reply = input.reply?.trim() ?? "";
  if (!reply) return { content: "reply: نص الرد إلزامي", isError: true };
  const confidence = Math.min(1, Math.max(0, Number.isFinite(input.confidence) ? (input.confidence as number) : 0));
  if (interaction.status === "REPLIED" || interaction.status === "CLOSED") return { content: `الرسالة في حالة ${interaction.status}؛ لا يُقترح رد جديد`, isError: true };
  if (interaction.approvalId) {
    const existing = await ctx.db.get(interaction.approvalId);
    if (existing && existing.status === "PENDING") return { content: `يوجد رد مقترح (${existing.businessId}) بانتظار اعتماد المالك؛ لا تقترح رداً آخر`, isError: true };
  }
  const customer = await ctx.db.get(interaction.customerId);
  if (!customer) return { content: "العميل غير موجود", isError: true };

  const actor = agentActor(agent.slug, task._id);
  const now = Date.now();
  const model = task.model ?? "unknown";
  const escalation = await getSetting(ctx, "escalation");
  // A task created by the escalation rule, or an interaction already re-processed, never escalates again.
  const alreadyEscalated = task.escalationReason !== undefined || interaction.aiClassification?.escalated === true;
  const decision = shouldEscalate({
    classification: kind,
    confidence,
    bookingValueOmr: input.estimatedBookingValueOmr,
    alreadyEscalated,
    confidenceThreshold: escalation.confidenceThreshold,
    bookingValueThresholdOmr: escalation.bookingValueThresholdOmr,
  });

  if (decision.escalate) {
    await ctx.db.patch(interaction._id, {
      kind,
      proposedReply: reply,
      aiClassification: { kind, confidence, model, escalated: true, escalationReason: decision.reason },
      taskId: task._id,
      updatedAt: now,
    });
    const escalatedTaskId = await escalateInteraction(ctx, task, interaction, decision.reason ?? "policy");
    let executiveTaskId: Id<"tasks"> | undefined;
    if (kind === "COMPLAINT") {
      executiveTaskId = await escalateToExecutive(ctx, task, interaction, `تصنيف أولي: شكوى (ثقة ${confidence}). مسودة الرد الأولية للمراجعة:\n${reply.slice(0, 400)}`);
    }
    return {
      content:
        `صُنّفت الرسالة ${kind} (ثقة ${confidence}). وفق سياسة التصعيد (${decision.reason}) أُحيلت لإعادة المعالجة بنموذج أدق في مهمة جديدة` +
        `${executiveTaskId ? "، وأُبلغ الوكيل التنفيذي فوراً بالشكوى" : ""}. لا تقترح رداً آخر؛ اختم المهمة بملخص قصير لما فهمته من الرسالة.`,
      escalatedTaskId,
      executiveTaskId,
    };
  }

  await ctx.db.patch(interaction._id, {
    kind,
    status: "REPLY_PROPOSED",
    proposedReply: reply,
    aiClassification: { kind, confidence, model, escalated: alreadyEscalated, escalationReason: task.escalationReason ?? interaction.aiClassification?.escalationReason },
    taskId: task._id,
    updatedAt: now,
  });
  const severity: V.SeverityClass = kind === "COMPLAINT" ? "D4" : "D3";
  const { approvalId, autoApproved: kindAutoApproved } = await createApproval(ctx, actor, {
    kind: "SEND_CUSTOMER_MESSAGE",
    agentSlug: agent.slug,
    taskId: task._id,
    title: `رد على ${customer.fullName} عبر ${interaction.channel}`,
    summary: `تصنيف: ${kind} (ثقة ${confidence})${task.escalationReason ? ` — أُعيدت معالجتها بنموذج أدق (${task.escalationReason})` : ""}.\nرسالة العميل: ${interaction.body.slice(0, 300)}`,
    payload: { interactionId: interaction._id, customerId: customer._id, channel: interaction.channel, message: reply, purpose: "reply", classification: kind, confidence, faq: input.faq === true, language: interaction.language ?? customer.preferredLanguage },
    toolName: "propose_reply",
    targetTable: "interactions",
    targetRecordId: interaction._id,
    severity,
  });
  await ctx.db.patch(interaction._id, { approvalId });

  let executiveTaskId: Id<"tasks"> | undefined;
  if (kind === "COMPLAINT" && task.escalationReason !== "complaint") {
    executiveTaskId = await escalateToExecutive(ctx, task, interaction, `تصنيف: شكوى (ثقة ${confidence}). الرد المقترح بانتظار اعتماد المالك:\n${reply.slice(0, 400)}`);
  }

  // FAQ auto-reply: only when the owner enabled it, the model vouched for the source, confidence is high,
  // no price is stated, the kind is a plain inquiry, and the channel's reply window is open.
  let autoApproved = kindAutoApproved;
  if (!autoApproved) {
    const auto = await getSetting(ctx, "autoApprove");
    const eligible = auto.faqAutoReply && input.faq === true && kind === "INQUIRY" && confidence >= escalation.confidenceThreshold && !looksLikePriceStatement(reply);
    if (eligible) {
      const windowOk = interaction.channel === "INSTAGRAM" || interaction.channel === "WHATSAPP" ? await replyWindowOpen(ctx, customer._id, interaction.channel, now) : true;
      if (windowOk) autoApproved = await autoApprove(ctx, approvalId, "faq_auto_reply: سؤال شائع بإجابة من معرفة معتمدة؛ قاعدة فعّلها المالك");
    }
  }

  return {
    content:
      `صُنّفت الرسالة ${kind} (ثقة ${confidence}) و${autoApproved ? "اعتُمد الرد تلقائياً وفق قاعدة الأسئلة الشائعة وسيُسجَّل إرساله" : "اقتُرح رد بانتظار اعتماد المالك بنقرة"}.` +
      `${executiveTaskId ? " أُبلغ الوكيل التنفيذي بالشكوى فوراً." : ""}`,
    approvalId,
    executiveTaskId,
    autoApproved,
  };
}
