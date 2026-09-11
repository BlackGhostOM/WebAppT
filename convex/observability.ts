/**
 * Error reporting entry points (Sentry via convex/lib/sentry.ts).
 *
 * - `report`: mutations cannot use the network, so they schedule this action
 *   with the serialised error (`ctx.scheduler.runAfter(0, internal.observability.report, …)`).
 *   Remember that a mutation which throws rolls back its scheduled calls too, so
 *   the mutation must catch and return instead of re-throwing when it reports.
 * - `runCron`: wrapper used by convex/crons.ts around job mutations. The mutation
 *   keeps its all-or-nothing semantics; a failure is reported, then re-thrown so
 *   Convex still records the run as failed.
 */
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { captureException } from "./lib/sentry";

const level = v.union(v.literal("fatal"), v.literal("error"), v.literal("warning"));

export const report = internalAction({
  args: {
    message: v.string(),
    name: v.optional(v.string()),
    stack: v.optional(v.string()),
    tags: v.optional(v.record(v.string(), v.string())),
    extra: v.optional(v.any()),
    level: v.optional(level),
  },
  returns: v.boolean(),
  handler: async (_ctx, { message, name, stack, tags, extra, level }) => {
    const err = new Error(message);
    if (name) err.name = name;
    if (stack) err.stack = stack;
    return await captureException(err, { tags, extra: extra as Record<string, unknown> | undefined, level });
  },
});

export const runCron = internalAction({
  args: { fn: v.string(), args: v.optional(v.any()), job: v.string() },
  returns: v.any(),
  handler: async (ctx, { fn, args, job }) => {
    try {
      return await ctx.runMutation(makeFunctionReference<"mutation">(fn), args ?? {});
    } catch (e) {
      await captureException(e, { tags: { area: "cron", job }, extra: { fn } });
      throw e;
    }
  },
});
