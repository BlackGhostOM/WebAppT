/**
 * Pure helpers shared by the Next.js and Convex error-reporting integrations
 * (Sentry). Nothing here touches the network or the platform APIs, so it runs
 * in the browser, the Vercel runtimes and the Convex runtime alike.
 *
 * Data minimisation (golden rule 9): an error tracker must never receive
 * customer identifiers or secrets. Every string that leaves the platform goes
 * through `redactPii` first; over-redaction is acceptable, leakage is not.
 */

const SECRET_PATTERN =
  /(sk-ant-[A-Za-z0-9_-]{8,}|re_[A-Za-z0-9_]{8,}|pa-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g;
const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * 7+ digits with optional separators (phones, national ids, card fragments).
 * The look-behind keeps business ids such as `TSK-000008` or `SCH-2026-000012`
 * readable: their digit runs are preceded by a letter or a dash.
 */
const PHONE_PATTERN = /(?<![\w-])\+?\d[\d\s().-]{5,}\d(?![\w-])/g;
const SENSITIVE_KEY = /pass(word|wd)?|secret|token|authorization|cookie|api[-_]?key|private[-_]?key|jwks|dsn/i;

export const REDACTED = "[redacted]";

/** Removes secrets, e-mail addresses and phone-like digit runs from free text. */
export function redactPii(text: string): string {
  return text
    .replace(SECRET_PATTERN, REDACTED)
    .replace(EMAIL_PATTERN, REDACTED)
    .replace(PHONE_PATTERN, (m) => (m.replace(/\D/g, "").length >= 7 ? REDACTED : m));
}

/** Deep copy of `value` with strings redacted and sensitive keys dropped (bounded depth). */
export function redactDeep<T>(value: T, depth = 0): T {
  if (depth > 6) return REDACTED as unknown as T;
  if (typeof value === "string") return redactPii(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEY.test(k) ? REDACTED : redactDeep(v, depth + 1);
    }
    return out as T;
  }
  return value;
}

/**
 * Structured application errors that are part of the normal contract with the
 * UI and the agents (validation, permissions, approvals…). They are handled at
 * the call site and would only be noise in an error tracker.
 */
const EXPECTED_CODES = [
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "VALIDATION",
  "NOT_FOUND",
  "CONFLICT",
  "DUPLICATE",
  "INVALID_TRANSITION",
  "APPROVAL_REQUIRED",
  "BUDGET_EXCEEDED",
  "EMERGENCY_STOP",
  "CANCELLED",
  "NOT_CONFIGURED",
];
const EXPECTED_PATTERN = new RegExp(`(^|[\\s:"])(${EXPECTED_CODES.join("|")})(\\s*:|"\\s*[,}])`);

export function isExpectedErrorText(text: string | undefined): boolean {
  if (!text) return false;
  if (/"code"\s*:\s*"[A-Z_]+"/.test(text)) return new RegExp(`"code"\\s*:\\s*"(${EXPECTED_CODES.join("|")})"`).test(text);
  return EXPECTED_PATTERN.test(text);
}
