/**
 * Agents are records: the owner edits instructions, model, budget and tools here.
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { isPremiumModel } from "../lib/modelRouting";
import { TOOL_SPECS } from "./agents/tools";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { appendAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { getSetting } from "./lib/settings";

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("agents").take(10);
  },
});

export const toolCatalog = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return TOOL_SPECS.map((t) => ({ name: t.name, kind: t.kind, description: t.description, allowedAgents: t.allowedAgents, severity: t.severity, requiresApproval: t.requiresApproval }));
  },
});

export const update = mutation({
  args: {
    slug: v.string(),
    patch: v.object({
      systemPrompt: v.optional(v.string()),
      defaultModel: v.optional(v.string()),
      escalationModel: v.optional(v.string()),
      monthlyBudgetUsd: v.optional(v.number()),
      maxStepsPerTask: v.optional(v.number()),
      enabled: v.optional(v.boolean()),
      allowedTools: v.optional(v.array(v.string())),
      description: v.optional(v.string()),
    }),
  },
  handler: async (ctx, { slug, patch }) => {
    const user = await requireOwner(ctx);
    const agent = await ctx.db.query("agents").withIndex("by_slug", (q) => q.eq("slug", slug as never)).unique();
    if (!agent) throw appError("NOT_FOUND", "الوكيل غير موجود");
    const routing = await getSetting(ctx, "modelRouting");
    if (patch.defaultModel && isPremiumModel(patch.defaultModel) && !routing.allowPremiumModels) {
      throw appError("VALIDATION", "defaultModel: النماذج المتقدمة غير مفعّلة في الإعدادات", { field: "defaultModel" });
    }
    if (patch.allowedTools) {
      const known = new Set(TOOL_SPECS.filter((t) => t.allowedAgents.includes(agent.slug)).map((t) => t.name));
      const bad = patch.allowedTools.filter((t) => !known.has(t));
      if (bad.length) throw appError("VALIDATION", `allowedTools: أدوات غير مسموحة لهذا الوكيل: ${bad.join(", ")}`, { field: "allowedTools" });
    }
    if (patch.monthlyBudgetUsd !== undefined && (patch.monthlyBudgetUsd < 0 || patch.monthlyBudgetUsd > 100000)) throw appError("VALIDATION", "monthlyBudgetUsd: خارج المدى", { field: "monthlyBudgetUsd" });
    if (patch.maxStepsPerTask !== undefined && (patch.maxStepsPerTask < 1 || patch.maxStepsPerTask > 30)) throw appError("VALIDATION", "maxStepsPerTask: بين 1 و30", { field: "maxStepsPerTask" });
    const changed: Record<string, unknown> = {};
    const old: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val === undefined) continue;
      if (JSON.stringify((agent as Record<string, unknown>)[k]) !== JSON.stringify(val)) {
        changed[k] = val;
        old[k] = (agent as Record<string, unknown>)[k];
      }
    }
    if (Object.keys(changed).length === 0) return null;
    await ctx.db.patch(agent._id, {
      ...changed,
      ...(changed.systemPrompt ? { promptVersion: agent.promptVersion + 1 } : {}),
      updatedAt: Date.now(),
      updatedBy: ownerActor(user),
    });
    await appendAudit(ctx, { actor: ownerActor(user), table: "agents", recordId: agent._id, businessId: agent.slug, event: "UPDATE", oldValue: old, newValue: changed, severity: "D3" });
    return null;
  },
});
