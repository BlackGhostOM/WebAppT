import { ConvexError, type Value } from "convex/values";

export type ErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "VALIDATION"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DUPLICATE"
  | "INVALID_TRANSITION"
  | "APPROVAL_REQUIRED"
  | "BUDGET_EXCEEDED"
  | "EMERGENCY_STOP"
  | "CANCELLED"
  | "NOT_CONFIGURED";

export type AppErrorData = {
  code: ErrorCode;
  message: string;
  field?: string;
  details?: Value;
  [key: string]: Value | undefined;
};

/** Structured error so that clients and agents can react programmatically. */
export function appError(code: ErrorCode, message: string, extra?: { field?: string; details?: unknown }): ConvexError<AppErrorData> {
  return new ConvexError<AppErrorData>({
    code,
    message,
    ...(extra?.field !== undefined ? { field: extra.field } : {}),
    ...(extra?.details !== undefined ? { details: extra.details as Value } : {}),
  });
}

export function isAppError(e: unknown, code?: ErrorCode): e is ConvexError<AppErrorData> {
  if (!(e instanceof ConvexError)) return false;
  const data = e.data as AppErrorData | undefined;
  return !!data && typeof data === "object" && (code === undefined || data.code === code);
}

/** Human-readable message for logs and agent tool results. */
export function errorMessage(e: unknown): string {
  if (e instanceof ConvexError) {
    const data = e.data as AppErrorData | string;
    if (typeof data === "string") return data;
    return `${data.code}: ${data.message}`;
  }
  if (e instanceof Error) return e.message;
  return String(e);
}
