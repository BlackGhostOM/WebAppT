import { describe, expect, it } from "vitest";
import { DEFAULT_MODEL_ROUTING, isPremiumModel, resolveModel, shouldEscalate, shouldUseBatch } from "./modelRouting";

describe("model routing policy", () => {
  const settings = DEFAULT_MODEL_ROUTING;

  it("routes customer traffic to Haiku and owner/executive work to Sonnet", () => {
    expect(resolveModel({ origin: "customer", agentSlug: "support", settings }).model).toBe("claude-haiku-4-5");
    expect(resolveModel({ origin: "owner", agentSlug: "product", settings }).model).toBe("claude-sonnet-5");
    expect(resolveModel({ origin: "owner", agentSlug: "executive", settings }).model).toBe("claude-sonnet-5");
    expect(resolveModel({ origin: "customer", agentSlug: "executive", settings }).model).toBe("claude-sonnet-5");
  });

  it("never picks a premium model unless the owner enabled it", () => {
    expect(isPremiumModel("claude-opus-5")).toBe(true);
    expect(isPremiumModel("claude-sonnet-5")).toBe(false);
    expect(resolveModel({ origin: "owner", agentSlug: "product", settings, premiumRequested: true }).model).toBe("claude-sonnet-5");
    expect(resolveModel({ origin: "owner", agentSlug: "product", settings, agentDefaultModel: "claude-opus-5" }).model).toBe("claude-sonnet-5");
    expect(resolveModel({ origin: "owner", agentSlug: "product", settings: { ...settings, allowPremiumModels: true }, premiumRequested: true }).model).toBe("claude-opus-5");
  });

  it("honours a non-premium agent override only for owner-originated specialist work", () => {
    expect(resolveModel({ origin: "owner", agentSlug: "sales", settings, agentDefaultModel: "claude-sonnet-4-6" }).model).toBe("claude-sonnet-4-6");
    expect(resolveModel({ origin: "customer", agentSlug: "support", settings, agentDefaultModel: "claude-sonnet-4-6" }).model).toBe("claude-haiku-4-5");
  });

  it("escalates once for complaints, low confidence or large bookings", () => {
    const base = { alreadyEscalated: false, confidenceThreshold: 0.7, bookingValueThresholdOmr: 2000 };
    expect(shouldEscalate({ ...base, classification: "COMPLAINT" }).escalate).toBe(true);
    expect(shouldEscalate({ ...base, confidence: 0.5 }).escalate).toBe(true);
    expect(shouldEscalate({ ...base, bookingValueOmr: 2500 }).escalate).toBe(true);
    expect(shouldEscalate({ ...base, confidence: 0.9, bookingValueOmr: 100 }).escalate).toBe(false);
    expect(shouldEscalate({ ...base, classification: "COMPLAINT", alreadyEscalated: true }).escalate).toBe(false);
    expect(resolveModel({ origin: "customer", agentSlug: "support", settings, escalation: true }).model).toBe(settings.escalationModel);
  });

  it("uses the Batch API for non-urgent work only", () => {
    expect(shouldUseBatch("interactive", settings)).toBe(false);
    expect(shouldUseBatch("nightly_report", settings)).toBe(true);
    expect(shouldUseBatch("survey", { ...settings, batchForNonUrgent: false })).toBe(false);
  });
});
