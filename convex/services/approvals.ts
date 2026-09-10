/**
 * Approval inbox services. Every external action and every D3/D4 change made
 * by an agent is parked here until the owner approves, edits or rejects it.
 */
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../lib/actor";
import { appendAudit } from "../lib/audit";
import { appError } from "../lib/errors";
import { nextBusinessId } from "../lib/ids";
import { getSetting } from "../lib/settings";
import type { AgentSlug, ApprovalKind, SeverityClass } from "../lib/vocab";

export interface CreateApprovalInput {
  kind: ApprovalKind;
  agentSlug: AgentSlug;
  taskId?: Id<"tasks">;
  title: string;
  summary: string;
  payload: unknown;
  toolName?: string;
  targetTable?: string;
  targetRecordId?: string;
  severity: SeverityClass;
  expiresAt?: number;
}

export async function createApproval(ctx: MutationCtx, actor: Actor, input: CreateApprovalInput): Promise<{ approvalId: Id<"approvals">; autoApproved: boolean }> {
  const businessId = await nextBusinessId(ctx, "approvals");
  const autoApprove = await getSetting(ctx, "autoApprove");
  const autoApproved = autoApprove.kinds.includes(input.kind) && input.severity !== "D4";
  const approvalId = await ctx.db.insert("approvals", {
    businessId,
    kind: input.kind,
    status: autoApproved ? "APPROVED" : "PENDING",
    taskId: input.taskId ?? actor.taskId,
    agentSlug: input.agentSlug,
    title: input.title.slice(0, 200),
    summary: input.summary.slice(0, 2000),
    payload: input.payload,
    toolName: input.toolName,
    targetTable: input.targetTable,
    targetRecordId: input.targetRecordId,
    severity: input.severity,
    requestedAt: Date.now(),
    expiresAt: input.expiresAt,
    ...(autoApproved ? { decidedAt: Date.now(), decidedBy: { type: "system", id: "auto_approve_rule" }, decisionReason: "قاعدة اعتماد تلقائي فعّلها المالك" } : {}),
  });
  await appendAudit(ctx, {
    actor,
    table: "approvals",
    recordId: approvalId,
    businessId,
    event: "CREATE",
    newValue: { kind: input.kind, title: input.title, autoApproved },
    severity: "D1",
    approvalId,
    taskId: input.taskId ?? actor.taskId,
  });
  // An owner-enabled auto-approval executes like a manual approval: same executor, same audit trail.
  if (autoApproved) await ctx.scheduler.runAfter(0, internal.approvals.execute, { approvalId });
  return { approvalId, autoApproved };
}

export type Decision = "APPROVED" | "REJECTED" | "EDITED_APPROVED";

export async function decideApproval(
  ctx: MutationCtx,
  actor: Actor,
  approvalId: Id<"approvals">,
  decision: Decision,
  opts: { reason?: string; editedPayload?: unknown } = {},
): Promise<Doc<"approvals">> {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "الاعتماد متاح للمالك فقط");
  const approval = await ctx.db.get(approvalId);
  if (!approval) throw appError("NOT_FOUND", "طلب الاعتماد غير موجود");
  if (approval.status !== "PENDING") throw appError("CONFLICT", `طلب الاعتماد في حالة ${approval.status} ولا يمكن تغييره`);
  if (decision === "REJECTED" && !opts.reason?.trim()) throw appError("VALIDATION", "reason: سبب الرفض إلزامي حتى يتعلم الوكيل", { field: "reason" });
  if (decision === "EDITED_APPROVED" && opts.editedPayload === undefined) throw appError("VALIDATION", "editedPayload: التعديل مطلوب", { field: "editedPayload" });

  const now = Date.now();
  await ctx.db.patch(approvalId, {
    status: decision,
    decidedAt: now,
    decidedBy: actor,
    decisionReason: opts.reason,
    ...(decision === "EDITED_APPROVED" ? { editedPayload: opts.editedPayload } : {}),
  });
  await appendAudit(ctx, {
    actor,
    table: "approvals",
    recordId: approvalId,
    businessId: approval.businessId,
    event: decision === "REJECTED" ? "REJECTION" : "APPROVAL",
    oldValue: { status: "PENDING" },
    newValue: { status: decision, editedPayload: opts.editedPayload },
    reason: opts.reason,
    severity: approval.severity,
    approvalId,
    taskId: approval.taskId,
  });

  // Rejection reasons flow back to the agent (task feedback) so it can learn.
  if (approval.taskId) {
    const task = await ctx.db.get(approval.taskId);
    if (task) {
      const note = decision === "REJECTED" ? `رُفض «${approval.title}»: ${opts.reason}` : decision === "EDITED_APPROVED" ? `اعتُمد «${approval.title}» بعد تعديل المالك${opts.reason ? `: ${opts.reason}` : ""}` : `اعتُمد «${approval.title}»`;
      await ctx.db.patch(task._id, { feedback: [...task.feedback, note].slice(-20) });
      await ctx.db.insert("taskRuns", {
        taskId: task._id,
        stepIndex: task.stepCount + 1,
        kind: "NOTE",
        approvalId,
        note,
        createdAt: now,
      });
      await ctx.db.patch(task._id, { stepCount: task.stepCount + 1 });
    }
  }
  return (await ctx.db.get(approvalId))!;
}

/**
 * Rule-based approval without the owner (e.g. FAQ auto-reply the owner enabled).
 * Never used for D4 changes. Execution is scheduled like any approved action.
 */
export async function autoApprove(ctx: MutationCtx, approvalId: Id<"approvals">, reason: string) {
  const approval = await ctx.db.get(approvalId);
  if (!approval || approval.status !== "PENDING") return false;
  if (approval.severity === "D4") return false;
  const now = Date.now();
  const actor = { type: "system" as const, id: "auto_approve_rule" };
  await ctx.db.patch(approvalId, { status: "APPROVED", decidedAt: now, decidedBy: actor, decisionReason: reason });
  await appendAudit(ctx, { actor, table: "approvals", recordId: approvalId, businessId: approval.businessId, event: "APPROVAL", oldValue: { status: "PENDING" }, newValue: { status: "APPROVED", auto: true }, reason, severity: approval.severity, approvalId, taskId: approval.taskId });
  await ctx.scheduler.runAfter(0, internal.approvals.execute, { approvalId });
  return true;
}

export async function markExecuted(ctx: MutationCtx, approvalId: Id<"approvals">, result: unknown, error?: string) {
  const approval = await ctx.db.get(approvalId);
  if (!approval) return;
  await ctx.db.patch(approvalId, {
    status: error ? "EXECUTION_FAILED" : "EXECUTED",
    executedAt: Date.now(),
    executionResult: result,
    executionError: error,
  });
  await appendAudit(ctx, {
    actor: { type: "system", id: "approval_executor" },
    table: "approvals",
    recordId: approvalId,
    businessId: approval.businessId,
    event: "UPDATE",
    newValue: { status: error ? "EXECUTION_FAILED" : "EXECUTED", error },
    severity: approval.severity,
    approvalId,
    taskId: approval.taskId,
  });
}

export async function listPending(ctx: QueryCtx | MutationCtx, limit = 100): Promise<Doc<"approvals">[]> {
  return await ctx.db.query("approvals").withIndex("by_status", (q) => q.eq("status", "PENDING")).order("desc").take(limit);
}
