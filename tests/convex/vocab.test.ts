import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { createRecord, updateRecord } from "../../convex/services/records";
import { OWNER_ACTOR, setup } from "./helpers";

describe("controlled vocabulary", () => {
  it("rejects a non-standard lead stage and a non-standard customer type", async () => {
    const { asOwner, t, ownerId } = await setup();
    await expect(
      asOwner.mutation(api.records.create, { entity: "leads", data: { contactName: "سعيد", channel: "INSTAGRAM", stage: "SOMEWHERE_ELSE" } }),
    ).rejects.toThrow(/VALIDATION|غير معيارية/);
    await expect(
      t.run(async (ctx) => createRecord(ctx, OWNER_ACTOR(ownerId), "customers", { fullName: "مريم", customerType: "ALIEN", preferredLanguage: "ar", consentStatus: "GRANTED" })),
    ).rejects.toThrow(/VALIDATION|غير معيارية/);
  });

  it("requires a standard lost reason when a lead is lost", async () => {
    const { t, ownerId } = await setup();
    const actor = OWNER_ACTOR(ownerId);
    const lead = await t.run(async (ctx) => createRecord(ctx, actor, "leads", { contactName: "سالم", channel: "WHATSAPP", stage: "NEW_LEAD" }));
    await expect(t.run(async (ctx) => updateRecord(ctx, actor, "leads", lead.id, { stage: "LOST" }))).rejects.toThrow(/lostReason/);
    await expect(t.run(async (ctx) => updateRecord(ctx, actor, "leads", lead.id, { stage: "LOST", lostReason: "TOO_EXPENSIVE_LOL" }))).rejects.toThrow(/غير معيارية|VALIDATION/);
    await t.run(async (ctx) => updateRecord(ctx, actor, "leads", lead.id, { stage: "LOST", lostReason: "PRICE" }));
  });

  it("enforces allowed status transitions (product lifecycle)", async () => {
    const { t, ownerId } = await setup();
    const actor = OWNER_ACTOR(ownerId);
    const product = await t.run(async (ctx) =>
      createRecord(ctx, actor, "products", { name: "باقة اختبار", productType: "PACKAGE", status: "IDEA", durationDays: 2, durationNights: 1, summary: "اختبار" }),
    );
    await expect(t.run(async (ctx) => updateRecord(ctx, actor, "products", product.id, { status: "ACTIVE" }))).rejects.toThrow(/INVALID_TRANSITION|لا يمكن الانتقال/);
    await t.run(async (ctx) => updateRecord(ctx, actor, "products", product.id, { status: "CONCEPT" }));
  });

  it("stamps human entries as company-verified with a human source", async () => {
    const { t, ownerId } = await setup();
    const created = await t.run(async (ctx) =>
      createRecord(ctx, OWNER_ACTOR(ownerId), "suppliers", { name: "مورد الاختبار", supplierType: "HOTEL", status: "APPROVED" }),
    );
    const doc = await t.run(async (ctx) => ctx.db.get(created.id as never));
    expect(doc).toMatchObject({ trustLevel: "A_COMPANY_VERIFIED", verificationStatus: "HUMAN_VERIFIED", source: { kind: "human" } });
    expect(created.businessId).toMatch(/^SUP-\d{6}$/);
  });
});
