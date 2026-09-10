import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { setup } from "./helpers";

describe("server-side authentication guard", () => {
  it("rejects every public function without an identity", async () => {
    const { t } = await setup();
    await expect(t.query(api.records.list, { entity: "customers" })).rejects.toThrow(/UNAUTHENTICATED|يجب تسجيل الدخول/);
    await expect(t.query(api.dashboard.overview, {})).rejects.toThrow(/UNAUTHENTICATED|يجب تسجيل الدخول/);
    await expect(t.query(api.approvals.pending, {})).rejects.toThrow(/UNAUTHENTICATED|يجب تسجيل الدخول/);
    await expect(t.mutation(api.records.create, { entity: "customers", data: { fullName: "x" } })).rejects.toThrow(/UNAUTHENTICATED|يجب تسجيل الدخول/);
    await expect(t.mutation(api.chat.send, { message: "مرحبا" })).rejects.toThrow(/UNAUTHENTICATED|يجب تسجيل الدخول/);
  });

  it("accepts a signed-in user and enforces the owner role for settings", async () => {
    const { asOwner, asStaff } = await setup();
    const rows = await asOwner.query(api.records.list, { entity: "customers" });
    expect(Array.isArray(rows)).toBe(true);
    await expect(asStaff.mutation(api.settings.update, { key: "budget", value: { monthlyBudgetUsd: 100 } })).rejects.toThrow(/FORBIDDEN|المالك/);
    await asOwner.mutation(api.settings.update, { key: "budget", value: { monthlyBudgetUsd: 100 } });
    const all = await asOwner.query(api.settings.getAll, {});
    expect(all.budget.monthlyBudgetUsd).toBe(100);
  });

  it("refuses disabled accounts", async () => {
    const { t, asStaff, staffId } = await setup();
    await t.run(async (ctx) => ctx.db.patch(staffId, { disabled: true }));
    await expect(asStaff.query(api.records.list, { entity: "customers" })).rejects.toThrow(/UNAUTHENTICATED|غير متاح/);
  });
});
