import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Daily freshness engine + expiry alerts (30/7 days) + data gaps. 02:00 UTC = 06:00 Muscat.
crons.daily("freshness engine", { hourUTC: 2, minuteUTC: 0 }, internal.maintenance.recomputeFreshness, {});

// Stuck-task watchdog.
crons.interval("task watchdog", { minutes: 15 }, internal.maintenance.watchdog, {});

// Post-sale follow-ups: plan from confirmed bookings and propose what is due (sent only after approval). 04:00 UTC = 08:00 Muscat.
crons.daily("lifecycle follow-ups", { hourUTC: 4, minuteUTC: 0 }, internal.followUps.daily, {});

export default crons;
