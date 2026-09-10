/**
 * Scheduled jobs API: cron entry point, owner "run now", and last-run status.
 */
import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { appError } from "./lib/errors";
import { runScheduledJob, SCHEDULED_JOBS, scheduledStatus, type ScheduledJob } from "./services/scheduled";

const jobArg = v.union(v.literal("dailyDigest"), v.literal("leadFollowUpReminders"), v.literal("weeklyExecutiveSummary"), v.literal("lifecycleFollowUps"));

export const run = internalMutation({
  args: { job: jobArg },
  handler: async (ctx, { job }) => await runScheduledJob(ctx, job),
});

/** The owner triggers a job immediately; disabled jobs run too (explicit request), and the run is audited as manual. */
export const runNow = mutation({
  args: { job: v.string() },
  handler: async (ctx, { job }) => {
    const user = await requireOwner(ctx);
    if (!(SCHEDULED_JOBS as readonly string[]).includes(job)) throw appError("VALIDATION", "job: مهمة مجدولة غير معروفة", { field: "job" });
    return await runScheduledJob(ctx, job as ScheduledJob, { actor: ownerActor(user), force: true });
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await scheduledStatus(ctx);
  },
});
