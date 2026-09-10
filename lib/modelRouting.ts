/**
 * Model routing policy (section 2.1). Pure functions with no I/O so they can
 * run in Convex, in the browser and in tests. The settings object is read from
 * the `settings` table (`modelRouting` key) by the caller.
 *
 * Rule: cheap for customer-originated traffic, mid-tier for owner tasks and for
 * the executive agent itself. Premium models are never chosen by default.
 */

export type RequestOrigin = "customer" | "owner" | "executive";
export type AgentSlug = "executive" | "product" | "sales" | "support";

export interface ModelRoutingSettings {
  /** Any interaction that starts from a customer. */
  customerModel: string;
  /** Any task requested by the owner via the executive agent. */
  ownerModel: string;
  /** The executive agent itself (understanding, dispatch, summary). */
  executiveModel: string;
  /** One-shot escalation target for low confidence / complaints / large bookings. */
  escalationModel: string;
  /** Owner-controlled switch allowing premium models for a specific task. */
  allowPremiumModels: boolean;
  premiumModel: string;
  /** Batch API is used for non-urgent work (nightly reports, backfills, surveys). */
  batchForNonUrgent: boolean;
}

export const MODEL_IDS = {
  haiku: "claude-haiku-4-5",
  sonnet: "claude-sonnet-5",
  opus: "claude-opus-5",
} as const;

export const DEFAULT_MODEL_ROUTING: ModelRoutingSettings = {
  customerModel: MODEL_IDS.haiku,
  ownerModel: MODEL_IDS.sonnet,
  executiveModel: MODEL_IDS.sonnet,
  escalationModel: MODEL_IDS.sonnet,
  allowPremiumModels: false,
  premiumModel: MODEL_IDS.opus,
  batchForNonUrgent: true,
};

const PREMIUM_PATTERNS = [/opus/i, /fable/i, /mythos/i];

export function isPremiumModel(model: string): boolean {
  return PREMIUM_PATTERNS.some((p) => p.test(model));
}

export interface ResolveModelInput {
  origin: RequestOrigin;
  agentSlug: AgentSlug;
  settings: ModelRoutingSettings;
  /** Optional per-agent override stored on the `agents` record. */
  agentDefaultModel?: string;
  /** The owner explicitly asked for a premium model for this task. */
  premiumRequested?: boolean;
  /** This is the single allowed escalation retry. */
  escalation?: boolean;
}

export interface ResolvedModel {
  model: string;
  reason: string;
}

/** Applies the routing table literally; agent overrides may never introduce a premium model silently. */
export function resolveModel(input: ResolveModelInput): ResolvedModel {
  const { settings } = input;

  if (input.escalation) {
    return { model: settings.escalationModel, reason: "escalation" };
  }

  if (input.premiumRequested) {
    if (settings.allowPremiumModels) return { model: settings.premiumModel, reason: "premium_requested_by_owner" };
    // Fall through: premium not allowed, use the standard route.
  }

  let route: ResolvedModel;
  if (input.agentSlug === "executive") {
    route = { model: settings.executiveModel, reason: "executive_agent" };
  } else if (input.origin === "customer") {
    route = { model: settings.customerModel, reason: "customer_origin" };
  } else {
    route = { model: settings.ownerModel, reason: "owner_origin" };
  }

  if (input.agentDefaultModel && input.agentDefaultModel !== route.model) {
    if (isPremiumModel(input.agentDefaultModel) && !settings.allowPremiumModels) {
      return { model: route.model, reason: `${route.reason}; agent override to premium model ignored` };
    }
    // Agent override is honoured only for non-executive, owner-originated work.
    if (input.origin !== "customer" && input.agentSlug !== "executive") {
      return { model: input.agentDefaultModel, reason: "agent_override" };
    }
  }
  return route;
}

export interface EscalationInput {
  classification?: string;
  confidence?: number;
  bookingValueOmr?: number;
  alreadyEscalated: boolean;
  confidenceThreshold: number;
  bookingValueThresholdOmr: number;
}

export interface EscalationDecision {
  escalate: boolean;
  reason?: string;
}

/** Customer traffic handled by the cheap model is re-run once on the escalation model when risky. */
export function shouldEscalate(input: EscalationInput): EscalationDecision {
  if (input.alreadyEscalated) return { escalate: false };
  if (input.classification === "COMPLAINT") return { escalate: true, reason: "complaint" };
  if (input.confidence !== undefined && input.confidence < input.confidenceThreshold) {
    return { escalate: true, reason: `low_confidence:${input.confidence}` };
  }
  if (input.bookingValueOmr !== undefined && input.bookingValueOmr > input.bookingValueThresholdOmr) {
    return { escalate: true, reason: `booking_value:${input.bookingValueOmr}` };
  }
  return { escalate: false };
}

/** Non-urgent work goes through the Batch API at half price. */
export function shouldUseBatch(kind: "interactive" | "nightly_report" | "backfill" | "survey", settings: ModelRoutingSettings): boolean {
  if (!settings.batchForNonUrgent) return false;
  return kind !== "interactive";
}
