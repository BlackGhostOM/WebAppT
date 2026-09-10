/**
 * Shared test harness: in-memory Convex (convex-test) with the platform
 * defaults installed and a signed-in owner identity.
 */
import { convexTest } from "convex-test";
import type { Id } from "../../convex/_generated/dataModel";
import { ensureDefaultsInternal } from "../../convex/bootstrap";
import schema from "../../convex/schema";

export const modules = import.meta.glob("../../convex/**/*.ts");

export async function setup() {
  process.env.LLM_PROVIDER = "mock";
  process.env.EMBEDDING_PROVIDER = "mock";
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    await ensureDefaultsInternal(ctx);
  });
  const ownerId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { email: "owner@test.om", name: "Owner", role: "owner", disabled: false });
  });
  const staffId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { email: "staff@test.om", name: "Staff", role: "staff", disabled: false });
  });
  const asOwner = t.withIdentity({ subject: `${ownerId}|session-owner`, issuer: "test", tokenIdentifier: `test|${ownerId}` });
  const asStaff = t.withIdentity({ subject: `${staffId}|session-staff`, issuer: "test", tokenIdentifier: `test|${staffId}` });
  return { t, ownerId: ownerId as Id<"users">, staffId: staffId as Id<"users">, asOwner, asStaff };
}

export type Harness = Awaited<ReturnType<typeof setup>>;

export const OWNER_ACTOR = (ownerId: Id<"users">) => ({ type: "owner" as const, id: ownerId });
export const AGENT = (slug: "executive" | "product" | "sales" | "support") => ({ type: "agent" as const, id: slug });
