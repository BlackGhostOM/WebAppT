import { describe, expect, it } from "vitest";
import { createRecord, getRecord, listRecords } from "../../convex/services/records";
import { AGENT, OWNER_ACTOR, setup } from "./helpers";

describe("access matrix (row- and field-level)", () => {
  it("hides margin and costs from the support agent, and supplier/internal cost from sales", async () => {
    const { t, ownerId } = await setup();
    const owner = OWNER_ACTOR(ownerId);
    const product = await t.run(async (ctx) =>
      createRecord(ctx, owner, "products", {
        name: "كنوز مسقط",
        productType: "PACKAGE",
        status: "DESIGN",
        durationDays: 3,
        durationNights: 2,
        summary: "اختبار",
        supplierCost: { amount: 100, currency: "OMR" },
        internalCost: { amount: 10, currency: "OMR" },
        minSellingPrice: { amount: 130, currency: "OMR" },
        recommendedSellingPrice: { amount: 140, currency: "OMR" },
        customerSellingPrice: { amount: 150, currency: "OMR" },
      }),
    );

    const asOwner = await t.run(async (ctx) => getRecord(ctx, owner, "products", product.id));
    expect(asOwner?.margin).toBeDefined();
    expect((asOwner?.pricing as Record<string, unknown>).supplierCost).toBeDefined();

    const asSupport = await t.run(async (ctx) => getRecord(ctx, AGENT("support"), "products", product.id));
    expect(asSupport).not.toBeNull();
    expect(asSupport?.margin).toBeUndefined();
    const supportPricing = asSupport?.pricing as Record<string, unknown>;
    expect(supportPricing.supplierCost).toBeUndefined();
    expect(supportPricing.internalCost).toBeUndefined();
    expect(supportPricing.minSellingPrice).toBeUndefined();
    expect(supportPricing.customerSellingPrice).toBeDefined();
    expect(asSupport?.targetMarginPercent).toBeUndefined();

    const asSales = await t.run(async (ctx) => listRecords(ctx, AGENT("sales"), "products"));
    const salesRow = asSales.find((r) => r._id === product.id)!;
    const salesPricing = salesRow.pricing as Record<string, unknown>;
    expect(salesPricing.supplierCost).toBeUndefined();
    expect(salesPricing.internalCost).toBeUndefined();
    expect(salesPricing.minSellingPrice).toBeDefined();
    expect(salesPricing.customerSellingPrice).toBeDefined();
    expect(salesRow.margin).toBeUndefined();

    const asProduct = await t.run(async (ctx) => getRecord(ctx, AGENT("product"), "products", product.id));
    expect(asProduct?.margin).toBeDefined();
  });

  it("denies resources outside an agent's matrix and enforces row-level customer scope for support", async () => {
    const { t, ownerId } = await setup();
    const owner = OWNER_ACTOR(ownerId);
    const c1 = await t.run(async (ctx) => createRecord(ctx, owner, "customers", { fullName: "أحمد", customerType: "INDIVIDUAL", preferredLanguage: "ar", consentStatus: "GRANTED", phone: "+968 91111111" }));
    const c2 = await t.run(async (ctx) => createRecord(ctx, owner, "customers", { fullName: "خالد", customerType: "INDIVIDUAL", preferredLanguage: "ar", consentStatus: "GRANTED", phone: "+968 92222222" }));

    // sales may not read supplier rates at all
    await expect(t.run(async (ctx) => listRecords(ctx, AGENT("sales"), "rates"))).rejects.toThrow(/FORBIDDEN/);
    // product agent never sees customer records
    await expect(t.run(async (ctx) => listRecords(ctx, AGENT("product"), "customers"))).rejects.toThrow(/FORBIDDEN/);

    const refs = { customerIds: [c1.id], leadIds: [], productIds: [], bookingIds: [] };
    const visible = await t.run(async (ctx) => listRecords(ctx, AGENT("support"), "customers", { contextRefs: refs }));
    expect(visible.map((r) => r._id)).toEqual([c1.id]);
    await expect(t.run(async (ctx) => getRecord(ctx, AGENT("support"), "customers", c2.id, refs))).rejects.toThrow(/FORBIDDEN|خارج نطاق/);
    const record = await t.run(async (ctx) => getRecord(ctx, AGENT("support"), "customers", c1.id, refs));
    expect(record?.nationality).toBeUndefined();
  });

  it("makes agents ask for approval on D3/D4 changes instead of applying them", async () => {
    const { t, ownerId } = await setup();
    const owner = OWNER_ACTOR(ownerId);
    const supplier = await t.run(async (ctx) => createRecord(ctx, owner, "suppliers", { name: "النهضة", supplierType: "TRANSPORT", status: "APPROVED" }));
    const { updateRecord } = await import("../../convex/services/records");
    const result = await t.run(async (ctx) => updateRecord(ctx, AGENT("product"), "suppliers", supplier.id, { bankAccountRef: "****1234" }));
    expect(result.approvalRequired).toBe(true);
    const doc = await t.run(async (ctx) => ctx.db.get(supplier.id as never));
    expect((doc as { bankAccountRef?: string }).bankAccountRef).toBeUndefined();
    const approval = await t.run(async (ctx) => ctx.db.get(result.approvalId!));
    expect(approval?.severity).toBe("D4");
    expect(approval?.status).toBe("PENDING");
  });
});
