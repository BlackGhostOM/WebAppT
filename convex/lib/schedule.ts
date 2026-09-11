/**
 * Pure scheduling math for owner-defined recurring tasks. Times are expressed
 * in the company timezone (hour/minute, day of week/month) and converted to UTC
 * timestamps with the IANA zone, so DST-free zones like Asia/Muscat and DST
 * zones both work. No I/O, so it runs in Convex, the browser and tests.
 */
import type { ScheduleFrequency } from "./vocab";

export interface ScheduleRule {
  frequency: ScheduleFrequency;
  hour: number;
  minute: number;
  dayOfWeek?: number;
  dayOfMonth?: number;
  runAt?: number;
}

interface LocalParts {
  year: number;
  month: number; // 1–12
  day: number;
  weekday: number; // 0 = Sunday
}

const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function formatter(timezone: string) {
  return new Intl.DateTimeFormat("en-US", { timeZone: timezone, hourCycle: "h23", weekday: "short", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/** Calendar parts of `ts` in the zone. */
export function localParts(ts: number, timezone: string): LocalParts & { hour: number; minute: number } {
  const parts = Object.fromEntries(formatter(timezone).formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), weekday: Math.max(0, WEEKDAYS.indexOf(parts.weekday)), hour: Number(parts.hour) % 24, minute: Number(parts.minute) };
}

/** Zone offset (ms to add to UTC to get local wall-clock) at instant `ts`. */
function zoneOffsetMs(ts: number, timezone: string): number {
  const p = Object.fromEntries(formatter(timezone).formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second));
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/** UTC timestamp of a local wall-clock time in the zone (two passes cover DST edges). */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timezone: string): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const first = guess - zoneOffsetMs(guess, timezone);
  return guess - zoneOffsetMs(first, timezone);
}

/** Days in a month (month 1–12). */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Next run strictly after `now`, or null when the schedule has nothing left
 * (ONCE in the past). The returned instant is the first occurrence > now.
 */
export function nextOccurrence(rule: ScheduleRule, now: number, timezone: string): number | null {
  if (rule.frequency === "ONCE") return rule.runAt !== undefined && rule.runAt > now ? rule.runAt : null;
  const today = localParts(now, timezone);
  const at = (y: number, m: number, d: number) => zonedToUtc(y, m, d, rule.hour, rule.minute, timezone);
  if (rule.frequency === "DAILY") {
    const candidate = at(today.year, today.month, today.day);
    if (candidate > now) return candidate;
    const tomorrow = localParts(now + DAY, timezone);
    return at(tomorrow.year, tomorrow.month, tomorrow.day);
  }
  if (rule.frequency === "WEEKLY") {
    const target = rule.dayOfWeek ?? 0;
    for (let offset = 0; offset <= 7; offset++) {
      const d = localParts(now + offset * DAY, timezone);
      if (d.weekday !== target) continue;
      const candidate = at(d.year, d.month, d.day);
      if (candidate > now) return candidate;
    }
    return null;
  }
  // MONTHLY
  const dom = Math.min(Math.max(rule.dayOfMonth ?? 1, 1), 28);
  for (let i = 0; i < 3; i++) {
    const monthIndex = today.month - 1 + i;
    const year = today.year + Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const candidate = at(year, month, Math.min(dom, daysInMonth(year, month)));
    if (candidate > now) return candidate;
  }
  return null;
}

export function describeRule(rule: ScheduleRule, locale: "ar" | "en" = "ar"): string {
  const time = `${String(rule.hour).padStart(2, "0")}:${String(rule.minute).padStart(2, "0")}`;
  const daysAr = ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"];
  const daysEn = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  switch (rule.frequency) {
    case "ONCE":
      return locale === "ar" ? "مرة واحدة" : "Once";
    case "DAILY":
      return locale === "ar" ? `يومياً ${time}` : `Daily at ${time}`;
    case "WEEKLY":
      return locale === "ar" ? `كل ${daysAr[rule.dayOfWeek ?? 0]} ${time}` : `Every ${daysEn[rule.dayOfWeek ?? 0]} at ${time}`;
    case "MONTHLY":
      return locale === "ar" ? `يوم ${rule.dayOfMonth ?? 1} من كل شهر ${time}` : `Day ${rule.dayOfMonth ?? 1} of every month at ${time}`;
  }
}
