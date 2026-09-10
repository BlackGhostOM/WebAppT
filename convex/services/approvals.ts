/**
 * Approval inbox services. Every external action and every D3/D4 change made
 * by an agent is parked here until the owner approves, edits or rejects it.
 *
 * Auto-approval (Phase 4) is a rule engine the owner configures in settings:
 * kind rules, lifecycle follow-up rules and the FAQ rule, all bounded by a
 * daily cap and quiet hours, and never for D4 / booking confirmations /
 * sensitive changes. Automatic decisions are audited like manual ones.
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

export const AUTO_RULE_ACTOR_ID = "auto_approve_rule";
const AUTO_ACTOR: Actor = { type: "system", id: AUTO_RULE_ACTOR_ID };

/** Kinds that can never be auto-approved regardless of settings (money, bookings, sensitive data). */
export const NEVER_AUTO_APPROVE: readonly ApprovalKind[] = ["CONFIRM_BOOKING", "SENSITIVE_CHANGE", "DATA_MERGE"];

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

// ---------------------------------------------------------------------------
// Auto-approval rule engine
// ---------------------------------------------------------------------------
export interface AutoApprovalInput {
  kind: ApprovalKind;
  severity: SeverityClass;
  payload?: unknown;
  /** The caller established FAQ eligibility (support agent: INQUIRY + faq flag + confidence + no price + reply window). */
  faqEligible?: boolean;
}

export interface AutoApprovalDecision {
  auto: boolean;
  /** Which rule matched (kind_rule | follow_up_rule | faq_rule). */
  rule?: string;
  /** Why a matching rule did not fire (quiet_hours | daily_cap | never_auto). */
  blockedBy?: string;
}

/** Hour of day (0–23) in the company's timezone. */
export function localHour(ts: number, timezone: string): number {
  try {
    const part = new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone: timezone }).formatToParts(new Date(ts)).find((p) => p.type === "hour")?.value;
    return Number(part) % 24;
  } catch {
    return new Date(ts).getUTCHours();
  }
}

/** Quiet window may wrap midnight (22 → 8). Equal hours mean "never quiet". */
export function inQuietHours(hour: number, window: { startHour: number; endHour: number }): boolean {
  if (window.startHour === window.endHour) return false;
  return window.startHour < window.endHour ? hour >= window.startHour && hour < window.endHour : hour >= window.startHour || hour < window.endHour;
}

export async function countAutoApprovalsToday(ctx: QueryCtx | MutationCtx, now: number = Date.now()): Promise<number> {
  const start = Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate());
  const recent = await ctx.db.query("approvals").order("desc").take(500);
  return recent.filter((a) => a.decidedBy?.id === AUTO_RULE_ACTOR_ID && (a.decidedAt ?? 0) >= start).length;
}

export async function evaluateAutoApproval(ctx: QueryCtx | MutationCtx, input: AutoApprovalInput, now: number = Date.now()): Promise<AutoApprovalDecision> {
  if (input.severity === "D4" || NEVER_AUTO_APPROVE.includes(input.kind)) return { auto: false, blockedBy: "never_auto" };
  const settings = await getSetting(ctx, "autoApprove");
  const payload = (input.payload ?? {}) as Record<string, unknown>;
  let rule: string | undefined;
  if (settings.kinds.includes(input.kind)) rule = "kind_rule";
  else if (input.kind === "SEND_CUSTOMER_MESSAGE" && typeof payload.followUpId === "string" && typeof payload.purpose === "string" && settings.followUpKinds.includes(payload.purpose)) rule = "follow_up_rule";
  else if (input.faqEligible && settings.faqAutoReply) rule = "faq_rule";
  if (!rule) return { auto: false };
  const company = await getSetting(ctx, "company");
  if (settings.quietHours?.enabled && inQuietHours(localHour(now, company.timezone), settings.quietHours)) return { auto: false, rule, blockedBy: "quiet_hours" };
  if ((await countAutoApprovalsToday(ctx, now)) >= (settings.maxPerDay ?? 0)) return { auto: false, rule, blockedBy: "daily_cap" };
  return { auto: true, rule };
}

// ---------------------------------------------------------------------------
// Create / decide
// ---------------------------------------------------------------------------
export async function createApproval(ctx: MutationCtx, actor: Actor, input: CreateApprovalInput): Promise<{ approvalId: Id<"approvals">; autoApproved: boolean }> {
  const businessId = await nextBusinessId(ctx, "approvals");
  const decision = await evaluateAutoApproval(ctx, { kind: input.kind, severity: input.severity, payload: input.payload });
  const autoApproved = decision.auto;
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
    ...(autoApproved ? { decidedAt: Date.now(), decidedBy: AUTO_ACTOR, decisionReason: `قاعدة اعتماد تلقائي فعّلها المالك (${decision.rule})` } : {}),
  });
  await appendAudit(ctx, {
    actor,
    table: "approvals",
    recordId: approvalId,
    businessId,
    event: "CREATE",
    newValue: { kind: input.kind, title: input.title, autoApproved, autoRule: decision.rule, autoBlockedBy: decision.blockedBy },
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
 * Rule-based approval of an already pending request (e.g. the support agent's
 * FAQ path). Re-runs the rule engine so the cap and quiet hours always apply.
 */
export async function autoApprove(ctx: MutationCtx, approvalId: Id<"approvals">, reason: string, opts: { faqEligible?: boolean } = {}): Promise<{ approved: boolean; blockedBy?: string }> {
  const approval = await ctx.db.get(approvalId);
  if (!approval || approval.status !== "PENDING") return { approved: false, blockedBy: "not_pending" };
  const decision = await evaluateAutoApproval(ctx, { kind: approval.kind, severity: approval.severity, payload: approval.payload, faqEligible: opts.faqEligible });
  if (!decision.auto) return { approved: false, blockedBy: decision.blockedBy ?? "no_rule" };
  const now = Date.now();
  await ctx.db.patch(approvalId, { status: "APPROVED", decidedAt: now, decidedBy: AUTO_ACTOR, decisionReason: `${reason} (${decision.rule})` });
  await appendAudit(ctx, { actor: AUTO_ACTOR, table: "approvals", recordId: approvalId, businessId: approval.businessId, event: "APPROVAL", oldValue: { status: "PENDING" }, newValue: { status: "APPROVED", auto: true, rule: decision.rule }, reason, severity: approval.severity, approvalId, taskId: approval.taskId });
  await ctx.scheduler.runAfter(0, internal.approvals.execute, { approvalId });
  return { approved: true };
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

/** Recent decisions taken by the auto-approval rule engine (owner transparency). */
export async function listAutoApproved(ctx: QueryCtx | MutationCtx, limit = 50): Promise<Doc<"approvals">[]> {
  const recent = await ctx.db.query("approvals").order("desc").take(1000);
  return recent.filter((a) => a.decidedBy?.id === AUTO_RULE_ACTOR_ID).slice(0, limit);
}
