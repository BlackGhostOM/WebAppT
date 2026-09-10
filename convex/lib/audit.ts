/**
 * Append-only audit log (section 4.6).
 *
 * This module exposes a single write primitive: `appendAudit`, which only ever
 * calls `ctx.db.insert("auditLog", ...)`. No update, patch, replace or delete
 * exists for `auditLog` anywhere in the code base (verified by a test).
 */
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { Actor } from "./actor";
import type { AuditEvent, SeverityClass } from "./vocab";

export interface AuditEntry {
  actor: Actor;
  table: string;
  recordId?: string;
  businessId?: string;
  event: AuditEvent;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  taskId?: Id<"tasks">;
  approvalId?: Id<"approvals">;
  severity: SeverityClass;
}

export async function appendAudit(ctx: MutationCtx, entry: AuditEntry): Promise<Id<"auditLog">> {
  return await ctx.db.insert("auditLog", {
    actor: entry.actor,
    table: entry.table,
    recordId: entry.recordId,
    businessId: entry.businessId,
    event: entry.event,
    oldValue: entry.oldValue,
    newValue: entry.newValue,
    reason: entry.reason,
    taskId: entry.taskId ?? entry.actor.taskId,
    approvalId: entry.approvalId,
    severity: entry.severity,
    at: Date.now(),
  });
}

/** Fields whose modification is always D4 (owner approval required). */
const D4_FIELDS: Record<string, string[]> = {
  suppliers: ["bankAccountRef"],
  users: ["role", "disabled"],
  dataAccessMatrix: ["*"],
  bookingServices: ["status:CONFIRMED"],
  confirmationEvidence: ["*"],
};

/** Fields whose modification is D3. */
const D3_FIELDS: Record<string, string[]> = {
  rates: ["amount", "rateTrust:CONTRACTED", "validTo", "cancellationTerms"],
  contracts: ["*"],
  pricingRules: ["value", "kind", "status"],
  products: ["status:ACTIVE"],
  policies: ["lifecycle:ACTIVE", "body"],
  decisionRegister: ["*"],
  agents: ["systemPrompt", "allowedTools", "defaultModel", "monthlyBudgetUsd"],
  settings: ["*"],
  quotes: ["status:SENT", "totals"],
  bookings: ["status:CONFIRMED", "status:CANCELLED"],
};

const D1_TABLES = new Set(["customerPreferences", "taskRuns", "notifications", "chatMessages", "knowledgeGaps", "memories"]);

function matches(rules: string[] | undefined, changed: Record<string, unknown>): boolean {
  if (!rules) return false;
  if (rules.includes("*")) return true;
  return rules.some((rule) => {
    const [field, value] = rule.split(":");
    if (!(field in changed)) return false;
    if (value === undefined) return true;
    return String(changed[field]) === value;
  });
}

/**
 * Classifies a change D1–D4 from the table and the fields being changed.
 * D3 and D4 require owner approval when performed by an agent.
 */
export function classifySeverity(table: string, changed: Record<string, unknown>): SeverityClass {
  if (matches(D4_FIELDS[table], changed)) return "D4";
  if (matches(D3_FIELDS[table], changed)) return "D3";
  if (D1_TABLES.has(table)) return "D1";
  const keys = Object.keys(changed);
  if (keys.length > 0 && keys.every((k) => ["notes", "tags", "description", "summary"].includes(k))) return "D1";
  return "D2";
}

export function requiresOwnerApproval(severity: SeverityClass): boolean {
  return severity === "D3" || severity === "D4";
}
