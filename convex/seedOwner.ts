/**
 * Creates the first owner account from environment variables and installs the
 * platform defaults. Public sign-up is closed, so this is the only way to
 * bootstrap access:
 *
 *   npx convex env set OWNER_EMAIL=owner@example.com
 *   npx convex env set OWNER_PASSWORD='at-least-12-chars-with-digits-1'
 *   npm run seed:owner
 */
import { createAccount, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { internalAction, internalMutation } from "./_generated/server";
import { validatePassword } from "./auth";
import { ensureDefaultsInternal } from "./bootstrap";

export const run = internalAction({
  args: {},
  returns: v.object({ userId: v.id("users"), created: v.boolean() }),
  handler: async (ctx) => {
    const email = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();
    const password = process.env.OWNER_PASSWORD ?? "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("OWNER_EMAIL is missing or invalid (set it with `npx convex env set OWNER_EMAIL=...`)");
    validatePassword(password);
    await ctx.runMutation(internal.seedOwner.installDefaults, {});
    const existing = await ctx.runQuery(internal.settings.findUserByEmail, { email });
    let userId: Id<"users">;
    let created = false;
    if (existing) {
      userId = existing._id;
      await modifyAccountCredentials(ctx, { provider: "password", account: { id: email, secret: password } });
    } else {
      const { user } = await createAccount(ctx, { provider: "password", account: { id: email, secret: password }, profile: { email } });
      userId = user._id as Id<"users">;
      created = true;
    }
    await ctx.runMutation(internal.settings.finalizeUser, { userId, role: "owner", name: "المالك", event: "seed" });
    console.log(`[seedOwner] owner account ready: ${email} (${created ? "created" : "password reset"}). Remove OWNER_PASSWORD from the deployment env now.`);
    return { userId, created };
  },
});

export const installDefaults = internalMutation({
  args: {},
  handler: async (ctx) => await ensureDefaultsInternal(ctx),
});
