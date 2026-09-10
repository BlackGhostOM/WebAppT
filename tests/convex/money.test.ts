import { describe, expect, it } from "vitest";
import { computeFreshness } from "../../convex/lib/freshness";
import { computeMargin, makeMoney, omr } from "../../convex/lib/money";
import { resolveCandidates } from "../../convex/services/governance";

const RATES = [{ code: "USD", rateToBase: 0.385, source: "test", updatedAt: 1 }];

describe("money and margin", () => {
  it("stores every amount with its OMR base equivalent and refuses unknown currencies", () => {
    expect(makeMoney(100, "USD", RATES)).toMatchObject({ amount: 100, currency: "USD", baseAmount: 38.5, baseCurrency: "OMR", exchangeRate: 0.385 });
    expect(makeMoney(12.3456, "OMR", RATES)).toMatchObject({ amount: 12.346, baseAmount: 12.346 });
    expect(() => makeMoney(5, "XYZ", RATES)).toThrow(/MISSING_EXCHANGE_RATE/);
  });

  it("derives margin from the five pricing fields", () => {
    const m = computeMargin({ supplierCost: omr(100), internalCost: omr(20), customerSellingPrice: omr(150) });
    expect(m.totalCostBase).toBe(120);
    expect(m.marginBase).toBe(30);
    expect(m.marginPercent).toBe(20);
    expect(computeMargin({}).marginPercent).toBeNull();
  });
});

describe("freshness", () => {
  const now = Date.UTC(2026, 8, 10);
  const day = 86400000;
  it("flags expired, expiring, unverified and current records", () => {
    expect(computeFreshness({ validTo: now - day }, now)).toBe("EXPIRED");
    expect(computeFreshness({ validTo: now + 10 * day, lastVerifiedAt: now }, now)).toBe("EXPIRING");
    expect(computeFreshness({ validTo: now + 100 * day, lastVerifiedAt: now }, now)).toBe("CURRENT");
    expect(computeFreshness({ verificationStatus: "MIGRATED_UNVERIFIED" }, now)).toBe("REQUIRES_VERIFICATION");
    expect(computeFreshness({ lastVerifiedAt: now - 200 * day }, now)).toBe("REQUIRES_VERIFICATION");
  });
});

describe("data conflict resolution order", () => {
  const src = { kind: "document" as const };
  it("prefers authority, then recency, then specificity, then contract, then verification, else escalates", () => {
    const a = { value: 50, source: src, trustLevel: "A_COMPANY_VERIFIED" as const, observedAt: 1 };
    const e = { value: 55, source: src, trustLevel: "E_AI_ESTIMATE" as const, observedAt: 2 };
    expect(resolveCandidates([e, a])).toMatchObject({ winner: a, rule: "AUTHORITY" });
    const b1 = { value: 1, source: src, trustLevel: "B_SUPPLIER_CONFIRMED" as const, observedAt: 0 };
    const b2 = { value: 2, source: src, trustLevel: "B_SUPPLIER_CONFIRMED" as const, observedAt: 10 * 86400000 };
    expect(resolveCandidates([b1, b2])).toMatchObject({ winner: b2, rule: "RECENCY" });
    const c1 = { ...b1, observedAt: 5, contractual: true };
    const c2 = { ...b2, observedAt: 6, contractual: false };
    expect(resolveCandidates([c1, c2])).toMatchObject({ rule: "CONTRACT_STATUS" });
    expect(resolveCandidates([{ ...b1, observedAt: 5 }, { ...b2, observedAt: 6 }])).toBeNull();
  });
});
