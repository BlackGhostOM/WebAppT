/**
 * Access matrix enforcement (section 4.9): row-level conditions and
 * field-level redaction for agent actors. Owners and the system are trusted;
 * agents only ever get what `dataAccessMatrix` grants them.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { type Actor, isAgentActor } from "./actor";
import { appError } from "./errors";
import type { AccessAction } from "./vocab";

export interface ContextRefs {
  customerIds: string[];
  leadIds: string[];
  productIds: string[];
  bookingIds: string[];
}

export const EMPTY_CONTEXT: ContextRefs = { customerIds: [], leadIds: [], productIds: [], bookingIds: [] };

export interface AccessOptions {
  /** The record being read or written (row-level checks). */
  record?: Record<string, unknown>;
  /** Purpose-bound identifiers the current task is allowed to touch. */
  contextRefs?: ContextRefs;
}

export type MatrixRow = Doc<"dataAccessMatrix">;

async function loadRow(ctx: QueryCtx | MutationCtx, agentSlug: MatrixRow["agentSlug"], resource: string): Promise<MatrixRow | null> {
  const row = await ctx.db
    .query("dataAccessMatrix")
    .withIndex("by_agent_resource", (q) => q.eq("agentSlug", agentSlug).eq("resource", resource))
    .unique();
  if (!row) return null;
  if (row.validTo !== undefined && row.validTo < Date.now()) return null;
  return row;
}

function recordCustomerId(resource: string, record: Record<string, unknown>): string | undefined {
  if (resource === "customers") return record._id as string | undefined;
  return record.customerId as string | undefined;
}

/** Evaluates row-level conditions declared in the matrix. */
function checkCondition(condition: string, resource: string, action: AccessAction, opts: AccessOptions): boolean {
  const record = opts.record;
  switch (condition) {
    case "customer_in_task_context": {
      // No record yet: creating is allowed, and list reads are filtered row-by-row by the caller.
      if (!record) return action === "CREATE" || action === "READ";
      const customerId = recordCustomerId(resource, record);
      if (!customerId) return action === "CREATE";
      return (opts.contextRefs?.customerIds ?? []).includes(customerId);
    }
    case "not_strictly_confidential":
      return !record || record.classification !== "STRICTLY_CONFIDENTIAL";
    case "estimated_only":
      // Agents may only write research rates; contracted rates are the owner's domain.
      if (action === "READ") return true;
      return !record || record.rateTrust === "ESTIMATED";
    case "active_only":
      return !record || record.lifecycle === "ACTIVE" || record.status === "ACTIVE";
    default:
      return false;
  }
}

/**
 * Throws FORBIDDEN when the actor may not perform `action` on `resource`.
 * Returns the matrix row (for redaction) or null for trusted actors.
 */
export async function assertAccess(
  ctx: QueryCtx | MutationCtx,
  actor: Actor,
  resource: string,
  action: AccessAction,
  opts: AccessOptions = {},
): Promise<MatrixRow | null> {
  if (!isAgentActor(actor)) return null;
  const row = await loadRow(ctx, actor.id, resource);
  if (!row || !row.actions.includes(action)) {
    throw appError("FORBIDDEN", `الوكيل ${actor.id} لا يملك صلاحية ${action} على ${resource}`, {
      details: { agent: actor.id, resource, action },
    });
  }
  if (row.condition && !checkCondition(row.condition, resource, action, opts)) {
    throw appError("FORBIDDEN", `خارج نطاق المهمة: ${resource}`, {
      details: { agent: actor.id, resource, action, condition: row.condition },
    });
  }
  return row;
}

function deletePath(obj: Record<string, unknown>, path: string) {
  const parts = path.split(".");
  let cursor: unknown = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!cursor || typeof cursor !== "object") return;
    cursor = (cursor as Record<string, unknown>)[parts[i]];
  }
  if (cursor && typeof cursor === "object") delete (cursor as Record<string, unknown>)[parts[parts.length - 1]];
}

export interface Redacted<T> {
  record: T;
  redactedFields: string[];
}

/** Removes every field on the matrix deny list. Trusted actors see everything. */
export function redactForActor<T extends Record<string, unknown>>(row: MatrixRow | null, record: T): Redacted<T> {
  if (!row || row.fieldDenyList.length === 0) return { record, redactedFields: [] };
  const copy = JSON.parse(JSON.stringify(record)) as T;
  for (const path of row.fieldDenyList) deletePath(copy as Record<string, unknown>, path);
  return { record: copy, redactedFields: [...row.fieldDenyList] };
}

/** True when the actor may see supplier/internal cost (and therefore the margin). */
export function canSeeCosts(row: MatrixRow | null): boolean {
  if (!row) return true;
  return !row.fieldDenyList.some((f) => f.endsWith("supplierCost") || f.endsWith("internalCost"));
}

export function redactMany<T extends Record<string, unknown>>(row: MatrixRow | null, records: T[]): T[] {
  return records.map((r) => redactForActor(row, r).record);
}
