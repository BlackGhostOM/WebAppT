/**
 * Internal mutations invoked by the auth provider to audit logins.
 * Internal only: never callable from a client.
 */
import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { systemActor } from "./lib/actor";
import { appendAudit } from "./lib/audit";

export const recordLogin = internalMutation({
  args: { userId: v.id("users"), email: v.string() },
  returns: v.null(),
  handler: async (ctx, { userId, email }) => {
    await ctx.db.patch(userId, { lastLoginAt: Date.now() });
    await appendAudit(ctx, {
      actor: { type: "owner", id: userId },
      table: "users",
      recordId: userId,
      event: "LOGIN",
      newValue: { email },
      severity: "D1",
    });
    return null;
  },
});

export const recordFailedLogin = internalMutation({
  args: { email: v.string(), reason: v.string() },
  returns: v.null(),
  handler: async (ctx, { email, reason }) => {
    await appendAudit(ctx, {
      actor: systemActor("auth"),
      table: "users",
      event: "LOGIN_FAILED",
      newValue: { email },
      reason,
      severity: "D2",
    });
    return null;
  },
});

export const recordPasswordReset = internalMutation({
  args: { userId: v.id("users") },
  returns: v.null(),
  handler: async (ctx, { userId }) => {
    await appendAudit(ctx, {
      actor: { type: "owner", id: userId },
      table: "users",
      recordId: userId,
      event: "UPDATE",
      reason: "password_reset",
      severity: "D3",
    });
    return null;
  },
});
