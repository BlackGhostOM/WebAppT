import { describe, expect, it } from "vitest";
import { createResearchRate } from "../../convex/services/commercial";
import { createRecord } from "../../convex/services/records";
import { AGENT, OWNER_ACTOR, setup } from "./helpers";

describe("rates gathered from research", () => {
  it("are always ESTIMATED / E_AI_ESTIMATE with a source URL and retrieval time", async () => {
    const { t, ownerId } = await setup();
    const supplier = await t.run(async (ctx) => createRecord(ctx, OWNER_ACTOR(ownerId), "suppliers", { name: "فندق الاختبار", supplierType: "HOTEL", status: "APPROVED" }));
    const created = await t.run(async (ctx) =>
      createResearchRate(ctx, AGENT("product"), {
        supplierId: supplier.id as never,
        componentType: "HOTEL",
        serviceType: "HOTEL_ROOM",
        serviceDescription: "غرفة ديلوكس",
        rateBasis: "PER_NIGHT",
        amount: 120,
        currency: "USD",
        season: "WINTER",
        sourceUrl: "https://www.example-booking.com/hotel",
      }),
    );
    const rate = await t.run(async (ctx) => ctx.db.get(created.id));
    expect(rate).toMatchObject({
      rateTrust: "ESTIMATED",
      trustLevel: "E_AI_ESTIMATE",
      verificationStatus: "AI_EXTRACTED",
      status: "PROPOSED",
      freshness: "REQUIRES_VERIFICATION",
    });
    expect(rate?.source.kind).toBe("web");
    expect(rate?.source.url).toBe("https://www.example-booking.com/hotel");
    expect(typeof rate?.source.retrievedAt).toBe("number");
    expect(rate?.amount.baseCurrency).toBe("OMR");
    expect(rate?.amount.baseAmount).toBeCloseTo(120 * 0.385, 3);
  });

  it("refuses research rates without a source URL", async () => {
    const { t, ownerId } = await setup();
    const supplier = await t.run(async (ctx) => createRecord(ctx, OWNER_ACTOR(ownerId), "suppliers", { name: "مورد", supplierType: "HOTEL", status: "APPROVED" }));
    await expect(
      t.run(async (ctx) =>
        createResearchRate(ctx, AGENT("product"), { supplierId: supplier.id as never, componentType: "HOTEL", serviceType: "HOTEL_ROOM", serviceDescription: "x", rateBasis: "PER_NIGHT", amount: 10, currency: "OMR", season: "WINTER", sourceUrl: "" }),
      ),
    ).rejects.toThrow(/sourceUrl/);
  });

  it("does not let the product agent write CONTRACTED rates through the generic path", async () => {
    const { t, ownerId } = await setup();
    const supplier = await t.run(async (ctx) => createRecord(ctx, OWNER_ACTOR(ownerId), "suppliers", { name: "مورد", supplierType: "HOTEL", status: "APPROVED" }));
    await expect(
      t.run(async (ctx) =>
        createRecord(ctx, AGENT("product"), "rates", {
          supplierId: supplier.id,
          componentType: "HOTEL",
          serviceType: "HOTEL_ROOM",
          serviceDescription: "غرفة",
          rateBasis: "PER_NIGHT",
          amount: { amount: 50, currency: "OMR" },
          season: "WINTER",
          validFrom: Date.now(),
          validTo: Date.now() + 86400000,
          cancellationTerms: "x",
          rateTrust: "CONTRACTED",
          status: "ACTIVE",
        }),
      ),
    ).rejects.toThrow(/FORBIDDEN|APPROVAL_REQUIRED|خارج نطاق/);
  });
});
