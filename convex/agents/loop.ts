/**
 * The agent loop (section 5), executed as a Convex action.
 *
 * messages = system prompt (cached) + company context (cached) + task context
 * → model call with tools → execute tools (each in its own transaction) →
 * repeat until the model stops, a step/cost limit is hit, or the owner cancels.
 *
 * Cooperative cancellation: the cancel flag is polled before every model call
 * and before every tool execution, and *during* a model call every
 * `cancelPollMs`; an in-flight request is aborted with AbortController.
 */
import { v } from "convex/values";
import { resolveModel } from "../../lib/modelRouting";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { type ActionCtx, internalAction } from "../_generated/server";
import { getLlmProvider } from "../lib/llm";
import { compactTranscript } from "../lib/llm/transcript";
import type { LlmContentBlock, LlmMessage, LlmResponse } from "../lib/llm/types";
import { SEARCH_LIMIT_ERROR, webSearchErrorsOf, webSearchQueriesOf, webSourcesOf } from "../lib/llm/webSources";

/** Told to the model once when it stops after exhausting the per-call search budget. */
function searchLimitNudge(maxUses: number): string {
  return `[ملاحظة النظام] توقفت بعد تجاوز حد عمليات البحث لهذا الاستدعاء (${maxUses}). لديك الآن ${maxUses} عمليات بحث جديدة في هذه الخطوة. أولاً سجّل كل سعر وجدته بالفعل عبر create_research_rate (مع الرابط ووقت الرصد)، ثم ابحث عن العناصر المتبقية باستعلام واحد دقيق لكل عنصر، وسجّل فجوة معرفة (record_knowledge_gap) لكل عنصر لم تجد له سعراً بدلاً من التوقف. أنهِ المهمة بالملخص المطلوب فقط بعد ذلك.`;
}

type RunData = NonNullable<Awaited<ReturnType<typeof loadRunData>>>;

async function loadRunData(ctx: ActionCtx, taskId: Id<"tasks">) {
  return await ctx.runQuery(internal.agents.runtime.loadRun, { taskId });
}

function textOf(blocks: LlmContentBlock[]): string {
  return blocks
    .filter((b) => b.type === "text")
    .map((b) => (b as { text: string }).text)
    .join("\n")
    .trim();
}

/** Runs the model call while polling the cancel flag; aborts the request on cancel. */
async function callModelWithCancelPolling(
  ctx: ActionCtx,
  data: RunData,
  request: Parameters<Awaited<ReturnType<typeof getLlmProvider>>["complete"]>[0],
): Promise<{ response: LlmResponse | null; cancelled: boolean; emergency: boolean }> {
  const provider = await getLlmProvider();
  const controller = new AbortController();
  let cancelled = false;
  let emergency = false;
  let stopPolling = false;
  const poll = (async () => {
    while (!stopPolling) {
      await new Promise((r) => setTimeout(r, data.settings.runtime.cancelPollMs));
      if (stopPolling) break;
      const state = await ctx.runQuery(internal.agents.runtime.pollCancel, { taskId: data.task._id });
      if (state.cancelRequested || state.emergencyStop) {
        cancelled = state.cancelRequested;
        emergency = state.emergencyStop;
        controller.abort();
        break;
      }
    }
  })();
  try {
    const response = await provider.complete({ ...request, signal: controller.signal });
    stopPolling = true;
    await poll;
    return { response, cancelled, emergency };
  } catch (e) {
    stopPolling = true;
    await poll;
    if (cancelled || emergency) return { response: null, cancelled, emergency };
    throw e;
  }
}

export const run = internalAction({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, { taskId }) => {
    const data = await loadRunData(ctx, taskId);
    if (!data) return;
    const { task, agent } = data;
    if (!["QUEUED", "RUNNING", "WAITING_APPROVAL", "WAITING_SUBTASKS"].includes(task.status)) return;
    if (task.cancelRequested) {
      await ctx.runMutation(internal.agents.runtime.cancelFinalize, { taskId, partialResult: task.partialResult });
      return;
    }
    if (data.settings.emergencyStop.active) {
      await ctx.runMutation(internal.agents.runtime.failTask, { taskId, error: "EMERGENCY_STOP: الإيقاف الطارئ مفعّل" });
      return;
    }
    if (!data.budget.allowed) {
      await ctx.runMutation(internal.agents.runtime.failTask, { taskId, error: `BUDGET_EXCEEDED: ${data.budget.reason}` });
      return;
    }
    const started = await ctx.runMutation(internal.agents.runtime.markRunning, { taskId });
    if (!started) return;

    const origin = task.origin === "customer" ? "customer" : agent.slug === "executive" ? "executive" : "owner";
    // A task created by the escalation rule (section 2.1) runs once on the stronger model.
    const escalated = task.escalationReason !== undefined;
    const { model, reason: routeReason } = resolveModel({
      origin,
      agentSlug: agent.slug,
      settings: data.settings.modelRouting,
      agentDefaultModel: agent.defaultModel,
      premiumRequested: task.premiumRequested,
      escalation: escalated,
    });
    const maxSteps = Math.min(agent.maxStepsPerTask || data.settings.runtime.maxStepsPerTask, 30);
    const systemPrompt = `${agent.systemPrompt}\n\n(سياسة النموذج: ${model} — ${routeReason})`;
    const tools = data.tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));

    let transcript: LlmMessage[] = data.transcript ?? [{ role: "user", content: [{ type: "text", text: data.contextPackage }] }];
    let partial = task.partialResult ?? "";
    // The step budget is per task, not per run: resumptions continue the same count.
    let steps = data.modelCallsSoFar;
    const webSearch = agent.slug === "product";
    const webSearchMaxUses = data.settings.runtime.webSearchMaxUses ?? 8;
    let nudgedAfterSearchLimit = false;

    const finishCancelled = async () => {
      await ctx.runMutation(internal.agents.runtime.cancelFinalize, { taskId, partialResult: partial || undefined, transcript });
    };

    while (steps < maxSteps) {
      steps += 1;
      // (a) cancel / emergency before every model call
      const state = await ctx.runQuery(internal.agents.runtime.pollCancel, { taskId });
      if (state.cancelRequested) return await finishCancelled();
      if (state.emergencyStop) {
        await ctx.runMutation(internal.agents.runtime.failTask, { taskId, error: "EMERGENCY_STOP: الإيقاف الطارئ مفعّل", partialResult: partial || undefined, transcript });
        return;
      }
      // (b) budget before every model call
      const budget = await ctx.runQuery(internal.agents.runtime.budgetCheck, { agentSlug: agent.slug });
      if (!budget.allowed) {
        await ctx.runMutation(internal.agents.runtime.failTask, { taskId, error: `BUDGET_EXCEEDED: ${budget.reason}`, partialResult: partial || undefined, transcript });
        return;
      }

      const t0 = Date.now();
      let result: Awaited<ReturnType<typeof callModelWithCancelPolling>>;
      try {
        result = await callModelWithCancelPolling(ctx, data, {
          model,
          systemPrompt,
          companyContext: data.companyContext,
          messages: transcript,
          tools,
          maxTokens: 4096,
          webSearch,
          webSearchMaxUses,
        });
      } catch (e) {
        await ctx.runMutation(internal.agents.runtime.failTask, { taskId, error: `MODEL_ERROR: ${e instanceof Error ? e.message : String(e)}`, partialResult: partial || undefined, transcript });
        return;
      }
      if (!result.response) {
        if (result.cancelled) return await finishCancelled();
        await ctx.runMutation(internal.agents.runtime.failTask, { taskId, error: "EMERGENCY_STOP: الإيقاف الطارئ مفعّل", partialResult: partial || undefined, transcript });
        return;
      }
      const response = result.response;
      await ctx.runMutation(internal.agents.runtime.recordModelCall, {
        taskId,
        model: response.model,
        provider: response.provider,
        origin,
        usage: response.usage,
        durationMs: Date.now() - t0,
        escalated,
        escalationReason: task.escalationReason,
        stopReason: response.stopReason,
      });

      if (response.stopReason === "refusal") {
        await ctx.runMutation(internal.agents.runtime.failTask, { taskId, error: "REFUSAL: رفض النموذج إكمال الطلب", partialResult: partial || undefined, transcript });
        return;
      }

      transcript = compactTranscript([...transcript, { role: "assistant", content: response.content }]);
      const webSources = webSourcesOf(response.content);
      const webQueries = webSearchQueriesOf(response.content);
      if (webSources.length > 0 || webQueries.length > 0) {
        await ctx.runMutation(internal.agents.runtime.addWebCitations, { taskId, sources: webSources.map((s) => ({ url: s.url, title: s.title, retrievedAt: s.retrievedAt })), queries: webQueries });
      }
      const hitSearchLimit = webSearchErrorsOf(response.content).includes(SEARCH_LIMIT_ERROR);
      const text = textOf(response.content);
      if (text) partial = partial ? `${partial}\n\n${text}` : text;
      const toolUses = response.content.filter((b) => b.type === "tool_use") as Extract<LlmContentBlock, { type: "tool_use" }>[];

      if (response.stopReason === "pause_turn" && toolUses.length === 0) {
        await ctx.runMutation(internal.agents.runtime.saveTranscript, { taskId, transcript, partialResult: partial || undefined });
        continue;
      }
      if (toolUses.length === 0 && hitSearchLimit && !nudgedAfterSearchLimit) {
        // The model gave up after the per-call search budget ran out; give it one fresh call to finish properly.
        nudgedAfterSearchLimit = true;
        transcript = compactTranscript([...transcript, { role: "user", content: [{ type: "text", text: searchLimitNudge(webSearchMaxUses) }] }]);
        await ctx.runMutation(internal.agents.runtime.saveTranscript, { taskId, transcript, partialResult: partial || undefined });
        continue;
      }
      if (toolUses.length === 0) {
        await ctx.runMutation(internal.agents.runtime.completeTask, { taskId, result: text || partial || "(لا ناتج نصي)", transcript });
        return;
      }

      // (c) execute tools; each is an atomic transaction; cancel checked before each
      const results: LlmContentBlock[] = [];
      let createdSubtask = false;
      let waitingDecision = false;
      for (const use of toolUses) {
        const before = await ctx.runQuery(internal.agents.runtime.pollCancel, { taskId });
        if (before.cancelRequested) {
          transcript = [...transcript, { role: "user", content: [...results, { type: "tool_result", toolUseId: use.id, content: "أُلغيت المهمة", isError: true }] }];
          return await finishCancelled();
        }
        const outcome = await ctx.runMutation(internal.agents.runtime.runTool, { taskId, toolUseId: use.id, name: use.name, input: use.input });
        if (outcome.cancelled) return await finishCancelled();
        results.push({ type: "tool_result", toolUseId: use.id, content: outcome.content, isError: outcome.isError });
        if (outcome.createdSubtaskId) createdSubtask = true;
        if (outcome.waitingDecision) waitingDecision = true;
      }
      if (hitSearchLimit) {
        results.push({ type: "text", text: `[ملاحظة النظام] تجاوزت حد عمليات البحث في الاستدعاء السابق (${webSearchMaxUses}). لديك ${webSearchMaxUses} عمليات جديدة في هذه الخطوة؛ سجّل ما وجدته أولاً ثم تابع البحث عن المتبقي باستعلام واحد لكل عنصر.` });
      }
      transcript = compactTranscript([...transcript, { role: "user", content: results }]);

      if (createdSubtask) {
        await ctx.runMutation(internal.agents.runtime.waitFor, { taskId, status: "WAITING_SUBTASKS", transcript, partialResult: partial || undefined });
        await ctx.runMutation(internal.agents.runtime.scheduleSubtaskRuns, { parentTaskId: taskId });
        return;
      }
      if (waitingDecision) {
        await ctx.runMutation(internal.agents.runtime.waitFor, { taskId, status: "WAITING_APPROVAL", transcript, partialResult: partial || undefined });
        return;
      }
      await ctx.runMutation(internal.agents.runtime.saveTranscript, { taskId, transcript, partialResult: partial || undefined });
    }

    await ctx.runMutation(internal.agents.runtime.failTask, {
      taskId,
      error: `STEP_LIMIT: بلغت المهمة الحد الأقصى للخطوات (${maxSteps}) دون اكتمال`,
      partialResult: partial || undefined,
      transcript,
    });
  },
});
