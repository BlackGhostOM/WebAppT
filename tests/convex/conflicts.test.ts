import { describe, expect, it } from "vitest";
import { api } from "../../convex/_generated/api";
import { recordConflict } from "../../convex/services/governance";
import { createRecord } from "../../convex/services/records";
import { AGENT, OWNER_ACTOR, setup } from "./helpers";

describe("escalated data conflicts are reported, linked and decidable", () => {
  it("creates an owner notification and resolves the record behind a business id", async () => {
    const h = await setup();
    const product = await h.t.run(async (ctx) => createRecord(ctx, OWNER_ACTOR(h.ownerId), "products", { name: "كنوز الداخلية", productType: "PACKAGE", status: "DESIGN", durationDays: 3, durationNights: 2, summary: "s" }));
    const now = Date.now();
    // Same trust, same time, no specificity/contract/verification → cannot be auto-resolved.
    const result = await h.t.run(async (ctx) =>
      recordConflict(ctx, AGENT("executive"), {
        table: "products",
        recordId: product.businessId,
        field: "customerSellingPrice",
        candidates: [
          { value: "577.89", source: { kind: "db", ref: "pricing" }, trustLevel: "E_AI_ESTIMATE", observedAt: now },
          { value: "0", source: { kind: "db", ref: "costing" }, trustLevel: "E_AI_ESTIMATE", observedAt: now },
        ],
      }),
    );
    expect(result.resolved).toBe(false);
    const note = await h.t.run(async (ctx) => (await ctx.db.query("notifications").take(10)).find((n) => n.kind === "DATA_CONFLICT"));
    expect(note).toBeTruthy();
    expect(note?.severity).toBe("WARNING");
    expect(note?.body).toContain("577.89");
    expect(note?.relatedRecordId).toBe(result.conflictId);

    const view = await h.asOwner.query(api.dataQuality.conflicts, {});
    expect(view.escalated).toHaveLength(1);
    const c = view.escalated[0];
    expect(c.record.found).toBe(true);
    expect(c.record.href).toBe(`/products/${product.id}`);
    expect(c.record.label).toContain("كنوز الداخلية");
    const attention = await h.asOwner.query(api.settings.attention, {});
    expect(attention.items.find((i) => i.key === "conflicts")).toMatchObject({ count: 1, href: "/settings?tab=governance#conflicts" });

    await h.asOwner.mutation(api.dataQuality.resolveConflict, { conflictId: c._id, value: "577.89", reason: "owner_pick:1" });
    const after = await h.asOwner.query(api.dataQuality.conflicts, {});
    expect(after.escalated).toHaveLength(0);
    expect(after.resolved[0]).toMatchObject({ resolutionRule: "OWNER_DECISION", resolvedValue: "577.89" });
    expect(after.resolved[0].resolvedBy?.type).toBe("owner");
    await expect(h.asStaff.mutation(api.dataQuality.resolveConflict, { conflictId: c._id, value: "x", reason: "r" })).rejects.toThrow(/FORBIDDEN|المالك/);
  });

  it("auto-resolved conflicts stay silent (no notification) and unknown records degrade gracefully", async () => {
    const h = await setup();
    const now = Date.now();
    const auto = await h.t.run(async (ctx) =>
      recordConflict(ctx, AGENT("product"), {
        table: "attractions",
        recordId: "not-a-real-id",
        field: "entryFee",
        candidates: [
          { value: "5 OMR", source: { kind: "web", url: "https://a.example" }, trustLevel: "D_RELIABLE_EXTERNAL", observedAt: now },
          { value: "0.5 OMR", source: { kind: "web", url: "https://b.example" }, trustLevel: "E_AI_ESTIMATE", observedAt: now },
        ],
      }),
    );
    expect(auto).toMatchObject({ resolved: true, rule: "AUTHORITY", value: "5 OMR" });
    expect(await h.t.run(async (ctx) => (await ctx.db.query("notifications").take(10)).filter((n) => n.kind === "DATA_CONFLICT").length)).toBe(0);
    const view = await h.asOwner.query(api.dataQuality.conflicts, {});
    expect(view.resolved[0].record).toEqual({ label: "attractions · not-a-real-id", found: false });
  });
});
