import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily freshness engine + expiry alerts (30/7 days) + data gaps. 02:00 UTC = 06:00 Muscat.
crons.daily("freshness engine", { hourUTC: 2, minuteUTC: 0 }, internal.maintenance.recomputeFreshness, {});

// Stuck-task watchdog.
crons.interval("task watchdog", { minutes: 15 }, internal.maintenance.watchdog, {});

// Owner digest (no model call). 03:00 UTC = 07:00 Muscat.
crons.daily("daily digest", { hourUTC: 3, minuteUTC: 0 }, internal.scheduled.run, { job: "dailyDigest" });

// Weekly executive summary (executive agent task). Sunday 03:30 UTC = 07:30 Muscat (Omani work week starts Sunday).
crons.weekly("weekly executive summary", { dayOfWeek: "sunday", hourUTC: 3, minuteUTC: 30 }, internal.scheduled.run, { job: "weeklyExecutiveSummary" });

// Post-sale follow-ups: plan from confirmed bookings and propose what is due (sent only after approval). 04:00 UTC = 08:00 Muscat.
crons.daily("lifecycle follow-ups", { hourUTC: 4, minuteUTC: 0 }, internal.scheduled.run, { job: "lifecycleFollowUps" });

// Overdue lead follow-ups → capped sales-agent tasks. 05:00 UTC = 09:00 Muscat.
crons.daily("lead follow-up reminders", { hourUTC: 5, minuteUTC: 0 }, internal.scheduled.run, { job: "leadFollowUpReminders" });

export default crons;
