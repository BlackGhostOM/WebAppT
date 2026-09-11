/**
 * Internal functions used by the agent loop action. Everything that touches
 * the database from the loop goes through these so each step is a transaction.
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { internalMutation, internalQuery, type MutationCtx } from "../_generated/server";
import { agentActor } from "../lib/actor";
import { appendAudit } from "../lib/audit";
import { compactTranscript } from "../lib/llm/transcript";
import type { LlmMessage } from "../lib/llm/types";
import { getSetting } from "../lib/settings";
import { relevantMemories } from "../services/governance";
import { appendRunStep, finalizeCancellation, setTaskStatus } from "../services/tasks";
import { checkBudget, logUsage, maybeNotifyBudgetThreshold } from "../services/usage";
import { executeTool, TOOLS_BY_NAME, toolsForAgent } from "./tools";

const ACTIVE = ["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS"] as const;

/** Builds the purpose-bound AgentContextPackage text (section 4.9). */
async function buildContextPackage(ctx: Parameters<typeof relevantMemories>[0], task: Doc<"tasks">, agent: Doc<"agents">): Promise<string> {
  const lines: string[] = [];
  lines.push(`# المهمة ${task.businessId}`);
  lines.push(`العنوان: ${task.title}`);
  lines.push(`المصدر: ${task.origin} | الأولوية: ${task.priority} | الوكيل: ${agent.slug}`);
  if (task.dueAt) lines.push(`الموعد: ${new Date(task.dueAt).toISOString()}`);
  const refs = task.contextRefs;
  const refLines: string[] = [];
  for (const id of refs.customerIds) {
    const c = await ctx.db.get(id);
    if (c) refLines.push(`- عميل ${c.businessId}: ${c.fullName} (${c.customerType}, لغة ${c.preferredLanguage}, موافقة ${c.consentStatus}) [معرّف ${c._id}]`);
  }
  for (const id of refs.leadIds) {
    const l = await ctx.db.get(id);
    if (l) refLines.push(`- عميل محتمل ${l.businessId}: ${l.contactName} مرحلة ${l.stage} [معرّف ${l._id}]`);
  }
  for (const id of refs.productIds) {
    const p = await ctx.db.get(id);
    if (p) refLines.push(`- منتج ${p.businessId} ${p.version}: ${p.name} حالة ${p.status} [معرّف ${p._id}]`);
  }
  for (const id of refs.bookingIds) {
    const b = await ctx.db.get(id);
    if (b) refLines.push(`- حجز ${b.businessId}: حالة ${b.status} من ${new Date(b.travelDateFrom).toISOString().slice(0, 10)} [معرّف ${b._id}]`);
  }
  if (refLines.length) lines.push("\n## السجلات ذات الصلة (المصرح بها لهذه المهمة)", ...refLines);
  const subjects = [
    ...refs.customerIds.map((id) => ({ table: "customers", recordId: id as string })),
    ...refs.leadIds.map((id) => ({ table: "leads", recordId: id as string })),
    ...refs.productIds.map((id) => ({ table: "products", recordId: id as string })),
  ];
  const memories = await relevantMemories(ctx, agent.slug, subjects, 10);
  if (memories.length) {
    lines.push("\n## ذاكرة معتمدة ذات صلة");
    for (const m of memories) lines.push(`- [${m.type}/${m.origin}] ${m.content}`);
  }
  const policies = (await ctx.db.query("policies").withIndex("by_lifecycle", (q) => q.eq("lifecycle", "ACTIVE")).take(30)).filter((p) => !p.archivedAt && p.appliesToAgents.includes(agent.slug));
  if (policies.length) {
    lines.push("\n## السياسات السارية المنطبقة (ملخصات؛ استخدم search_policies للنص الكامل)");
    for (const p of policies.slice(0, 8)) lines.push(`- ${p.businessId} ${p.version} «${p.title}»: ${p.summary.slice(0, 200)}`);
  }
  if (task.feedback.length) {
    lines.push("\n## ملاحظات المالك على أعمال سابقة (تعلّم منها)");
    for (const f of task.feedback.slice(-8)) lines.push(`- ${f}`);
  }
  lines.push(`\n## الطلب\n${task.request}`);
  lines.push(`\nالتاريخ الآن: ${new Date().toISOString()} (Asia/Muscat = UTC+4).`);
  return lines.join("\n");
}

export const loadRun = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return null;
    const agent = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", task.agentSlug)).unique();
    if (!agent) return null;
    const [modelRouting, runtime, company, emergencyStop] = await Promise.all([
      getSetting(ctx, "modelRouting"),
      getSetting(ctx, "agentRuntime"),
      getSetting(ctx, "company"),
      getSetting(ctx, "emergencyStop"),
    ]);
    const budget = await checkBudget(ctx, agent.slug);
    const tools = toolsForAgent(agent).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, kind: t.kind }));
    const contextPackage = await buildContextPackage(ctx, task, agent);
    const companyContext = `## سياق الشركة\n${company.contextSummary}\nالاسم: ${company.name} (${company.nameEn}). العملة الأساسية: ${company.baseCurrency}. المنطقة الزمنية: ${company.timezone}.`;
    // Model calls already spent across earlier runs of this task (pauses/resumes share one budget).
    const previousRuns = await ctx.db.query("taskRuns").withIndex("by_task", (q) => q.eq("taskId", task._id)).take(500);
    const modelCallsSoFar = previousRuns.filter((r) => r.kind === "MODEL_CALL").length;
    return {
      modelCallsSoFar,
      task,
      agent,
      settings: { modelRouting, runtime, emergencyStop },
      budget,
      tools,
      contextPackage,
      companyContext,
      transcript: (task.transcript ?? null) as LlmMessage[] | null,
    };
  },
});

export const pollCancel = internalQuery({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    const stop = await getSetting(ctx, "emergencyStop");
    return { cancelRequested: !task || task.cancelRequested || task.status === "CANCELLED" || task.status === "CANCELLING", emergencyStop: stop.active };
  },
});

export const budgetCheck = internalQuery({
  args: { agentSlug: v.string() },
  handler: async (ctx, { agentSlug }) => await checkBudget(ctx, agentSlug as Doc<"agents">["slug"]),
});

export const markRunning = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return false;
    if (!(ACTIVE as readonly string[]).includes(task.status)) return false;
    if (task.status !== "RUNNING") await setTaskStatus(ctx, taskId, "RUNNING");
    return true;
  },
});

export const recordModelCall = internalMutation({
  args: {
    taskId: v.id("tasks"),
    model: v.string(),
    provider: v.string(),
    origin: v.string(),
    usage: v.object({ inputTokens: v.number(), outputTokens: v.number(), cacheReadTokens: v.number(), cacheWriteTokens: v.number(), webSearchRequests: v.optional(v.number()) }),
    durationMs: v.number(),
    escalated: v.boolean(),
    escalationReason: v.optional(v.string()),
    stopReason: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return 0;
    const costUsd = await logUsage(ctx, {
      taskId: args.taskId,
      agentSlug: task.agentSlug,
      model: args.model,
      provider: args.provider as Doc<"usageLog">["provider"],
      origin: args.origin as Doc<"usageLog">["origin"],
      usage: args.usage,
      escalated: args.escalated,
      escalationReason: args.escalationReason,
    });
    await appendRunStep(ctx, args.taskId, {
      kind: "MODEL_CALL",
      model: args.model,
      inputTokens: args.usage.inputTokens,
      outputTokens: args.usage.outputTokens,
      cacheReadTokens: args.usage.cacheReadTokens,
      cacheWriteTokens: args.usage.cacheWriteTokens,
      costUsd,
      durationMs: args.durationMs,
      note: `stop_reason=${args.stopReason}${args.usage.webSearchRequests ? ` web_searches=${args.usage.webSearchRequests}` : ""}${args.escalated ? ` escalated=${args.escalationReason}` : ""}`,
    });
    await maybeNotifyBudgetThreshold(ctx);
    return costUsd;
  },
});

/** One tool call = one transaction (atomic write_internal). */
export const runTool = internalMutation({
  args: { taskId: v.id("tasks"), toolUseId: v.string(), name: v.string(), input: v.any() },
  handler: async (ctx, { taskId, toolUseId, name, input }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return { content: "المهمة غير موجودة", isError: true };
    if (task.cancelRequested) return { content: "أُلغيت المهمة قبل تنفيذ الأداة", isError: true, cancelled: true };
    const agent = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", task.agentSlug)).unique();
    if (!agent) return { content: "الوكيل غير موجود", isError: true };
    const started = Date.now();
    const outcome = await executeTool(ctx, task, agent, name, (input ?? {}) as Record<string, unknown>);
    const spec = TOOLS_BY_NAME.get(name);
    await appendRunStep(ctx, taskId, {
      kind: "TOOL_CALL",
      toolName: name,
      toolKind: spec?.kind,
      input,
      output: { content: outcome.content.slice(0, 4000), isError: outcome.isError ?? false, approvalId: outcome.approvalId, subtaskId: outcome.createdSubtaskId },
      durationMs: Date.now() - started,
      approvalId: outcome.approvalId,
      subtaskId: outcome.createdSubtaskId,
      note: toolUseId,
    });
    if (outcome.citations?.length) {
      const fresh = await ctx.db.get(taskId);
      if (fresh) await ctx.db.patch(taskId, { citations: [...fresh.citations, ...outcome.citations].slice(-100) });
    }
    return { content: outcome.content, isError: outcome.isError ?? false, createdSubtaskId: outcome.createdSubtaskId, waitingDecision: outcome.waitingDecision ?? false, approvalId: outcome.approvalId, cancelled: false };
  },
});

/** Web sources surfaced by the model's server-side search become task citations (url + retrieval time). */
export const addWebCitations = internalMutation({
  args: { taskId: v.id("tasks"), sources: v.array(v.object({ url: v.string(), title: v.optional(v.string()), retrievedAt: v.number() })), queries: v.optional(v.array(v.string())) },
  handler: async (ctx, { taskId, sources, queries }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;
    const known = new Set(task.citations.filter((c) => c.kind === "web").map((c) => (c as { url: string }).url));
    const fresh = sources.filter((s) => !known.has(s.url)).map((s) => ({ kind: "web" as const, url: s.url, title: s.title, retrievedAt: s.retrievedAt }));
    if (fresh.length > 0) await ctx.db.patch(taskId, { citations: [...task.citations, ...fresh].slice(-100) });
    if (fresh.length === 0 && !(queries?.length)) return;
    await appendRunStep(ctx, taskId, {
      kind: "NOTE",
      note: `بحث ويب: ${queries?.length ?? 0} استعلام${queries?.length ? ` (${queries.slice(0, 8).join(" | ")})` : ""} · مصادر جديدة: ${fresh.length}`,
      output: { queries: queries?.slice(0, 20) ?? [], sources: fresh.slice(0, 20) },
    });
  },
});

export const saveTranscript = internalMutation({
  args: { taskId: v.id("tasks"), transcript: v.any(), partialResult: v.optional(v.string()) },
  handler: async (ctx, { taskId, transcript, partialResult }) => {
    await ctx.db.patch(taskId, { transcript, ...(partialResult !== undefined ? { partialResult } : {}) });
  },
});

async function syncChatMessage(ctx: MutationCtx, task: Doc<"tasks">, content: string, status: "DONE" | "CANCELLED" | "ERROR", partial: boolean) {
  if (!task.conversationId || task.parentTaskId) return;
  const messages = await ctx.db.query("chatMessages").withIndex("by_conversation", (q) => q.eq("conversationId", task.conversationId!)).take(500);
  const mine = messages.find((m) => m.taskId === task._id && m.role === "assistant");
  if (mine) await ctx.db.patch(mine._id, { content, status, partial });
  else await ctx.db.insert("chatMessages", { conversationId: task.conversationId, role: "assistant", content, taskId: task._id, status, partial, createdAt: Date.now() });
  const conversation = await ctx.db.get(task.conversationId);
  if (conversation && conversation.activeTaskId === task._id) await ctx.db.patch(conversation._id, { activeTaskId: undefined, lastMessageAt: Date.now() });
}

/** When the last active child finishes, the waiting parent gets a summary and resumes. */
async function resumeParentIfReady(ctx: MutationCtx, child: Doc<"tasks">) {
  if (!child.parentTaskId) return;
  const parent = await ctx.db.get(child.parentTaskId);
  if (!parent || parent.status !== "WAITING_SUBTASKS" || parent.cancelRequested) return;
  const children = await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", parent._id)).take(50);
  if (children.some((c) => (ACTIVE as readonly string[]).includes(c.status))) return;
  const summary = children
    .map((c) => `### ${c.businessId} (${c.agentSlug}) — ${c.status}\n${c.result ?? c.partialResult ?? c.error ?? "بلا ناتج"}`)
    .join("\n\n");
  const transcript = compactTranscript(
    ((parent.transcript ?? []) as LlmMessage[]).concat([{ role: "user", content: [{ type: "text", text: `نتائج المهام الفرعية:\n\n${summary.slice(0, 40_000)}\n\nاجمع النتائج وقدّم الملخص التنفيذي للمالك (ما أُنجز، ما ينتظر اعتماده، ما تعذّر، الخطوة التالية). لا تفوّض مهام فرعية جديدة إلا لضرورة واضحة.` }] }]),
  );
  await ctx.db.patch(parent._id, { transcript, status: "QUEUED" });
  await appendRunStep(ctx, parent._id, { kind: "NOTE", note: "اكتملت المهام الفرعية؛ استئناف المهمة" });
  const jobId = await ctx.scheduler.runAfter(0, internal.agents.loop.run, { taskId: parent._id });
  await ctx.db.patch(parent._id, { schedulerJobId: jobId });
}

export const completeTask = internalMutation({
  args: { taskId: v.id("tasks"), result: v.string(), transcript: v.any() },
  handler: async (ctx, { taskId, result, transcript }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;
    if (task.cancelRequested) {
      await finalizeCancellation(ctx, taskId, result);
      return;
    }
    await setTaskStatus(ctx, taskId, "COMPLETED", { result, transcript, partialResult: undefined });
    await appendRunStep(ctx, taskId, { kind: "FINAL", output: { result: result.slice(0, 4000) } });
    await syncChatMessage(ctx, task, result, "DONE", false);
    // Scheduled (cron-created) tasks have no chat; the owner learns about the result through a notification.
    if (task.requestedBy.type === "system" && task.requestedBy.id.startsWith("cron:") && !task.parentTaskId) {
      await ctx.db.insert("notifications", { kind: "SCHEDULED_TASK_DONE", title: `اكتمل: ${task.title}`, body: result.slice(0, 1200), severity: "INFO", relatedTable: "tasks", relatedRecordId: taskId, createdAt: Date.now() });
    }
    await resumeParentIfReady(ctx, task);
  },
});

export const failTask = internalMutation({
  args: { taskId: v.id("tasks"), error: v.string(), partialResult: v.optional(v.string()), transcript: v.optional(v.any()) },
  handler: async (ctx, { taskId, error, partialResult, transcript }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;
    const status = error.startsWith("BUDGET_EXCEEDED") ? "BUDGET_EXCEEDED" : "FAILED";
    if (task.status !== "RUNNING") await ctx.db.patch(taskId, { status: "RUNNING" });
    await setTaskStatus(ctx, taskId, status, { error, partialResult, ...(transcript !== undefined ? { transcript } : {}) });
    await appendRunStep(ctx, taskId, { kind: "ERROR", note: error });
    if (status === "BUDGET_EXCEEDED") {
      await ctx.db.insert("notifications", { kind: "AGENT_BUDGET", title: `توقف الوكيل ${task.agentSlug}`, body: error, severity: "CRITICAL", relatedTable: "tasks", relatedRecordId: taskId, createdAt: Date.now() });
    }
    await syncChatMessage(ctx, task, partialResult ? `${partialResult}\n\n⚠️ ${error}` : `⚠️ تعذّر إكمال المهمة: ${error}`, "ERROR", !!partialResult);
    await resumeParentIfReady(ctx, task);
  },
});

export const cancelFinalize = internalMutation({
  args: { taskId: v.id("tasks"), partialResult: v.optional(v.string()), transcript: v.optional(v.any()) },
  handler: async (ctx, { taskId, partialResult, transcript }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;
    await finalizeCancellation(ctx, taskId, partialResult);
    if (transcript !== undefined) await ctx.db.patch(taskId, { transcript });
    await appendAudit(ctx, {
      actor: task.cancelledBy ?? agentActor(task.agentSlug, taskId),
      table: "tasks",
      recordId: taskId,
      businessId: task.businessId,
      event: "CANCEL",
      oldValue: { status: task.status },
      newValue: { status: "CANCELLED", partialSaved: !!partialResult },
      reason: task.cancelReason,
      severity: "D2",
      taskId,
    });
    await syncChatMessage(ctx, task, partialResult ?? "أُوقفت المهمة قبل إنتاج ناتج.", "CANCELLED", true);
    await resumeParentIfReady(ctx, task);
  },
});

export const waitFor = internalMutation({
  args: { taskId: v.id("tasks"), status: v.union(v.literal("WAITING_SUBTASKS"), v.literal("WAITING_APPROVAL")), transcript: v.any(), partialResult: v.optional(v.string()) },
  handler: async (ctx, { taskId, status, transcript, partialResult }) => {
    const task = await ctx.db.get(taskId);
    if (!task) return;
    if (task.cancelRequested) {
      await finalizeCancellation(ctx, taskId, partialResult);
      return;
    }
    await setTaskStatus(ctx, taskId, status, { transcript, ...(partialResult !== undefined ? { partialResult } : {}) });
    // A subtask may have finished before we recorded the wait.
    if (status === "WAITING_SUBTASKS") {
      const children = await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", taskId)).take(50);
      const active = children.filter((c) => (ACTIVE as readonly string[]).includes(c.status));
      if (children.length > 0 && active.length === 0 && children[0]) await resumeParentIfReady(ctx, children[0]);
    }
  },
});

/** Called when the owner decides an approval that a task is waiting for. */
export async function resumeAfterDecision(ctx: MutationCtx, approval: Doc<"approvals">) {
  if (!approval.taskId) return;
  const task = await ctx.db.get(approval.taskId);
  if (!task || task.status !== "WAITING_APPROVAL" || task.cancelRequested) return;
  const decision = approval.status === "REJECTED" ? `رفض المالك: ${approval.decisionReason ?? ""}` : approval.status === "EDITED_APPROVED" ? `اعتمد المالك بعد تعديل: ${JSON.stringify(approval.editedPayload)} ${approval.decisionReason ?? ""}` : `اعتمد المالك${approval.decisionReason ? `: ${approval.decisionReason}` : ""}`;
  const transcript = compactTranscript(((task.transcript ?? []) as LlmMessage[]).concat([{ role: "user", content: [{ type: "text", text: `قرار المالك بشأن «${approval.title}»: ${decision}\nاستكمل المهمة بناءً على هذا القرار.` }] }]));
  await ctx.db.patch(task._id, { transcript, status: "QUEUED" });
  await appendRunStep(ctx, task._id, { kind: "NOTE", approvalId: approval._id, note: `استئناف بعد قرار المالك: ${approval.status}` });
  const jobId = await ctx.scheduler.runAfter(0, internal.agents.loop.run, { taskId: task._id });
  await ctx.db.patch(task._id, { schedulerJobId: jobId });
}

/**
 * Safety net for cancellation: if the running loop died (crash, deploy) and never
 * observed the cancel flag, finalise the CANCELLING task a few seconds later.
 */
export const forceCancel = internalMutation({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const task = await ctx.db.get(taskId);
    if (!task || task.status !== "CANCELLING") return;
    await finalizeCancellation(ctx, taskId, task.partialResult);
    await appendRunStep(ctx, taskId, { kind: "CANCELLED", note: "أُنهي الإيقاف قسرياً (لم تستجب الحلقة)" });
    await syncChatMessage(ctx, task, task.partialResult ?? "أُوقفت المهمة قبل إنتاج ناتج.", "CANCELLED", true);
    await resumeParentIfReady(ctx, task);
  },
});

/** Schedules the loop for a freshly created task (used by chat, escalations, retries). */
export async function scheduleRun(ctx: MutationCtx, taskId: Id<"tasks">) {
  const jobId = await ctx.scheduler.runAfter(0, internal.agents.loop.run, { taskId });
  await ctx.db.patch(taskId, { schedulerJobId: jobId });
}

export const scheduleSubtaskRuns = internalMutation({
  args: { parentTaskId: v.id("tasks") },
  handler: async (ctx, { parentTaskId }) => {
    const children = await ctx.db.query("tasks").withIndex("by_parent", (q) => q.eq("parentTaskId", parentTaskId)).take(50);
    for (const child of children) {
      if (child.status === "QUEUED" && !child.schedulerJobId && !child.cancelRequested) await scheduleRun(ctx, child._id);
    }
  },
});
