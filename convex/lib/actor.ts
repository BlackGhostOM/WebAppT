/**
 * Actor resolution and server-side authentication guards.
 *
 * Every public Convex function calls one of the `require*` helpers first. The
 * guard lives on the server (`ctx.auth`), never only in the UI.
 */
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./errors";
import type { AgentSlug, UserRole } from "./vocab";

export interface Actor {
  type: "owner" | "agent" | "system";
  id: string;
  taskId?: Id<"tasks">;
}

type AuthCtx = QueryCtx | MutationCtx;

/** Requires a signed-in, non-disabled user. Throws UNAUTHENTICATED otherwise. */
export async function requireUser(ctx: AuthCtx): Promise<Doc<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw appError("UNAUTHENTICATED", "يجب تسجيل الدخول");
  const user = await ctx.db.get(userId);
  if (!user || user.disabled) throw appError("UNAUTHENTICATED", "الحساب غير متاح");
  return user;
}

/** Requires the `owner` role (approvals, settings, user management, D3/D4 changes). */
export async function requireOwner(ctx: AuthCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "owner") throw appError("FORBIDDEN", "هذه العملية متاحة للمالك فقط");
  return user;
}

export function hasRole(user: Doc<"users">, role: UserRole): boolean {
  return user.role === role;
}

/** Actions have no `ctx.db`; they get the user id and let mutations load the document. */
export async function requireUserIdInAction(ctx: ActionCtx): Promise<Id<"users">> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw appError("UNAUTHENTICATED", "يجب تسجيل الدخول");
  return userId;
}

export function ownerActor(user: Doc<"users"> | Id<"users">): Actor {
  return { type: "owner", id: typeof user === "string" ? user : user._id };
}

export function agentActor(slug: AgentSlug, taskId?: Id<"tasks">): Actor {
  return { type: "agent", id: slug, taskId };
}

export function systemActor(job: string): Actor {
  return { type: "system", id: job };
}

export function isAgentActor(actor: Actor): actor is Actor & { type: "agent"; id: AgentSlug } {
  return actor.type === "agent";
}
