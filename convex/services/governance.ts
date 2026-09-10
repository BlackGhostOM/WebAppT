/**
 * Governance services: memory proposals (4.8), data conflicts with the fixed
 * resolution order (4.6) and data gaps (4.7).
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../lib/actor";
import { appendAudit } from "../lib/audit";
import { appError } from "../lib/errors";
import { nextBusinessId } from "../lib/ids";
import type { AgentSlug, TrustLevel } from "../lib/vocab";

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------
export interface ProposeMemoryInput {
  type: Doc<"memories">["type"];
  origin: Doc<"memories">["origin"];
  agentSlug: AgentSlug;
  content: string;
  subject?: { table: string; recordId: string };
  confidence?: number;
  retentionPolicy?: Doc<"memories">["retentionPolicy"];
  taskId?: Id<"tasks">;
}

const RETENTION_MS: Record<Doc<"memories">["retentionPolicy"], number | undefined> = {
  SESSION_ONLY: 24 * 60 * 60 * 1000,
  DAYS_30: 30 * 24 * 60 * 60 * 1000,
  DAYS_90: 90 * 24 * 60 * 60 * 1000,
  DAYS_365: 365 * 24 * 60 * 60 * 1000,
  UNTIL_REVOKED: undefined,
};

/** Agents only ever propose; a memory becomes usable after owner approval (or when STATED by the owner). */
export async function proposeMemory(ctx: MutationCtx, actor: Actor, input: ProposeMemoryInput): Promise<Id<"memories">> {
  if (!input.content.trim()) throw appError("VALIDATION", "content: المحتوى إلزامي", { field: "content" });
  const retention = input.retentionPolicy ?? (input.type === "SESSION" ? "SESSION_ONLY" : "DAYS_90");
  const ttl = RETENTION_MS[retention];
  const now = Date.now();
  const status: Doc<"memories">["status"] = actor.type === "owner" && input.origin !== "INFERRED" && input.origin !== "AI_ASSESSMENT" ? "APPROVED" : "PROPOSED";
  const businessId = await nextBusinessId(ctx, "memories");
  const id = await ctx.db.insert("memories", {
    businessId,
    type: input.type,
    origin: actor.type === "owner" && input.origin === "STATED" ? "HUMAN_VERIFIED" : input.origin,
    status,
    agentSlug: input.agentSlug,
    content: input.content.trim().slice(0, 2000),
    subject: input.subject,
    confidence: input.confidence,
    expiresAt: ttl ? now + ttl : undefined,
    retentionPolicy: retention,
    proposedBy: actor,
    ...(status === "APPROVED" ? { reviewedBy: actor, reviewedAt: now } : {}),
    taskId: input.taskId ?? actor.taskId,
    createdAt: now,
  });
  await appendAudit(ctx, { actor, table: "memories", recordId: id, businessId, event: "CREATE", newValue: { type: input.type, origin: input.origin, status }, severity: "D1" });
  return id;
}

export async function reviewMemory(ctx: MutationCtx, actor: Actor, memoryId: Id<"memories">, decision: "APPROVED" | "REJECTED", reason?: string) {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "مراجعة الذاكرة متاحة للمالك فقط");
  const memory = await ctx.db.get(memoryId);
  if (!memory) throw appError("NOT_FOUND", "الذاكرة غير موجودة");
  await ctx.db.patch(memoryId, { status: decision, reviewedBy: actor, reviewedAt: Date.now(), ...(decision === "APPROVED" ? { origin: "HUMAN_VERIFIED" } : {}) });
  await appendAudit(ctx, { actor, table: "memories", recordId: memoryId, businessId: memory.businessId, event: decision === "APPROVED" ? "APPROVAL" : "REJECTION", oldValue: { status: memory.status }, newValue: { status: decision }, reason, severity: "D2" });
}

/** Approved, unexpired memories relevant to the agent and (optionally) a subject. */
export async function relevantMemories(ctx: QueryCtx | MutationCtx, agentSlug: AgentSlug, subjects: { table: string; recordId: string }[], limit = 12): Promise<Doc<"memories">[]> {
  const now = Date.now();
  const out: Doc<"memories">[] = [];
  for (const subject of subjects) {
    const rows = await ctx.db.query("memories").withIndex("by_subject", (q) => q.eq("subject.table", subject.table).eq("subject.recordId", subject.recordId)).take(20);
    out.push(...rows.filter((m) => m.status === "APPROVED" && (m.expiresAt === undefined || m.expiresAt > now)));
  }
  const general = await ctx.db.query("memories").withIndex("by_agent_status", (q) => q.eq("agentSlug", agentSlug).eq("status", "APPROVED")).order("desc").take(20);
  out.push(...general.filter((m) => !m.subject && (m.expiresAt === undefined || m.expiresAt > now)));
  const seen = new Set<string>();
  return out.filter((m) => (seen.has(m._id) ? false : (seen.add(m._id), true))).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Data conflicts
// ---------------------------------------------------------------------------
const TRUST_AUTHORITY: Record<TrustLevel, number> = {
  A_COMPANY_VERIFIED: 5,
  B_SUPPLIER_CONFIRMED: 4,
  C_OFFICIAL_SOURCE: 3,
  D_RELIABLE_EXTERNAL: 2,
  E_AI_ESTIMATE: 1,
};

type Candidate = Doc<"dataConflicts">["candidates"][number];

/**
 * Resolution order (section 4.6): authority → recency → specificity →
 * contractual status → verification; otherwise escalate to the owner.
 * Returns the winning candidate and the rule that decided, or null to escalate.
 */
export function resolveCandidates(candidates: Candidate[]): { winner: Candidate; rule: Doc<"dataConflicts">["resolutionRule"] } | null {
  if (candidates.length < 2) return candidates[0] ? { winner: candidates[0], rule: "AUTHORITY" } : null;
  const byAuthority = [...candidates].sort((a, b) => TRUST_AUTHORITY[b.trustLevel] - TRUST_AUTHORITY[a.trustLevel]);
  if (TRUST_AUTHORITY[byAuthority[0].trustLevel] > TRUST_AUTHORITY[byAuthority[1].trustLevel]) return { winner: byAuthority[0], rule: "AUTHORITY" };
  const top = byAuthority.filter((c) => c.trustLevel === byAuthority[0].trustLevel);
  const byRecency = [...top].sort((a, b) => b.observedAt - a.observedAt);
  if (byRecency[0].observedAt - byRecency[1].observedAt > 24 * 60 * 60 * 1000) return { winner: byRecency[0], rule: "RECENCY" };
  const bySpecificity = [...top].sort((a, b) => (b.specificity ?? 0) - (a.specificity ?? 0));
  if ((bySpecificity[0].specificity ?? 0) > (bySpecificity[1].specificity ?? 0)) return { winner: bySpecificity[0], rule: "SPECIFICITY" };
  const contractual = top.filter((c) => c.contractual);
  if (contractual.length === 1) return { winner: contractual[0], rule: "CONTRACT_STATUS" };
  const verified = top.filter((c) => c.verified);
  if (verified.length === 1) return { winner: verified[0], rule: "VERIFICATION" };
  return null;
}

export async function recordConflict(
  ctx: MutationCtx,
  actor: Actor,
  input: { table: string; recordId?: string; field: string; candidates: Candidate[]; taskId?: Id<"tasks"> },
): Promise<{ conflictId: Id<"dataConflicts">; resolved: boolean; rule?: Doc<"dataConflicts">["resolutionRule"]; value?: unknown }> {
  if (input.candidates.length < 2) throw appError("VALIDATION", "candidates: يلزم مرشحان على الأقل", { field: "candidates" });
  const resolution = resolveCandidates(input.candidates);
  const businessId = await nextBusinessId(ctx, "dataConflicts");
  const now = Date.now();
  const conflictId = await ctx.db.insert("dataConflicts", {
    businessId,
    table: input.table,
    recordId: input.recordId,
    field: input.field,
    candidates: input.candidates,
    status: resolution ? "RESOLVED" : "ESCALATED",
    resolutionRule: resolution?.rule,
    resolvedValue: resolution?.winner.value,
    resolvedBy: resolution ? { type: "system", id: "conflict_resolver" } : undefined,
    resolvedAt: resolution ? now : undefined,
    taskId: input.taskId ?? actor.taskId,
    createdBy: actor,
    createdAt: now,
  });
  await appendAudit(ctx, { actor, table: "dataConflicts", recordId: conflictId, businessId, event: "CREATE", newValue: { table: input.table, field: input.field, status: resolution ? "RESOLVED" : "ESCALATED", rule: resolution?.rule }, severity: "D2" });
  return { conflictId, resolved: !!resolution, rule: resolution?.rule, value: resolution?.winner.value };
}

export async function resolveConflictByOwner(ctx: MutationCtx, actor: Actor, conflictId: Id<"dataConflicts">, value: unknown, reason: string) {
  if (actor.type !== "owner") throw appError("FORBIDDEN", "حسم التعارض متاح للمالك فقط");
  const conflict = await ctx.db.get(conflictId);
  if (!conflict) throw appError("NOT_FOUND", "التعارض غير موجود");
  await ctx.db.patch(conflictId, { status: "RESOLVED", resolutionRule: "OWNER_DECISION", resolvedValue: value, resolvedBy: actor, resolvedAt: Date.now() });
  await appendAudit(ctx, { actor, table: "dataConflicts", recordId: conflictId, businessId: conflict.businessId, event: "UPDATE", oldValue: { status: conflict.status }, newValue: { status: "RESOLVED", value }, reason, severity: "D2" });
}

// ---------------------------------------------------------------------------
// Data gaps
// ---------------------------------------------------------------------------
export async function upsertDataGap(
  ctx: MutationCtx,
  input: { table: string; field: string; description: string; affectedCount: number; totalCount: number; severity: Doc<"dataGaps">["severity"] },
) {
  const percent = input.totalCount === 0 ? 0 : Math.round((input.affectedCount / input.totalCount) * 1000) / 10;
  const existing = await ctx.db.query("dataGaps").withIndex("by_table_field", (q) => q.eq("table", input.table).eq("field", input.field)).unique();
  const now = Date.now();
  if (existing) {
    const resolved = input.affectedCount === 0;
    await ctx.db.patch(existing._id, {
      affectedCount: input.affectedCount,
      totalCount: input.totalCount,
      percent,
      updatedAt: now,
      status: resolved ? "RESOLVED" : existing.status === "RESOLVED" ? "OPEN" : existing.status,
      resolvedAt: resolved ? now : undefined,
    });
    return existing._id;
  }
  if (input.affectedCount === 0) return null;
  return await ctx.db.insert("dataGaps", {
    businessId: await nextBusinessId(ctx, "dataGaps"),
    ...input,
    percent,
    status: "OPEN",
    createdAt: now,
    updatedAt: now,
  });
}
