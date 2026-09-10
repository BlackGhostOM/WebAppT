/**
 * Shared field groups added to every master-data / commercial table (section 4.3).
 *
 * Relationships are built on Convex `_id`s; `businessId` is the human-readable,
 * permanent identifier used in the UI and in correspondence.
 */
import { v, type VLiteral, type VUnion } from "convex/values";
import {
  ACTOR_TYPES,
  AGENT_SLUGS,
  CLASSIFICATIONS,
  FRESHNESS,
  SOURCE_KINDS,
  TRUST_LEVELS,
  VERIFICATION_STATUSES,
} from "./vocab";

/** `v.union(v.literal(...))` over a controlled-vocabulary tuple, preserving literal types. */
export function literals<T extends readonly string[]>(values: T): VUnion<T[number], VLiteral<T[number]>[], "required", never> {
  return v.union(...(values.map((value) => v.literal(value)) as unknown as [VLiteral<T[number]>, VLiteral<T[number]>, ...VLiteral<T[number]>[]])) as unknown as VUnion<
    T[number],
    VLiteral<T[number]>[],
    "required",
    never
  >;
}

/** Who performed an action: the owner (a user), an agent, or the system itself. */
export const actorValidator = v.object({
  type: literals(ACTOR_TYPES),
  /** users._id for owners, agent slug for agents, a job name for system. */
  id: v.string(),
  /** Task that the actor was executing, when relevant (traceability). */
  taskId: v.optional(v.id("tasks")),
});

export const sourceValidator = v.object({
  kind: literals(SOURCE_KINDS),
  ref: v.optional(v.string()),
  url: v.optional(v.string()),
  retrievedAt: v.optional(v.number()),
});

/** Money is always stored with its OMR base equivalent (section 4.4). */
export const moneyValidator = v.object({
  amount: v.number(),
  currency: v.string(),
  baseAmount: v.number(),
  baseCurrency: v.literal("OMR"),
  exchangeRate: v.optional(v.number()),
  rateSource: v.optional(v.string()),
  rateTimestamp: v.optional(v.number()),
});

/** A point in time is always stored as a UTC timestamp with an explicit timezone. */
export const zonedTimeValidator = v.object({
  timestamp: v.number(),
  timezone: v.string(),
});

export const citationValidator = v.union(
  v.object({
    kind: v.literal("document"),
    documentId: v.id("documents"),
    section: v.optional(v.string()),
    version: v.string(),
    retrievedAt: v.number(),
  }),
  v.object({
    kind: v.literal("record"),
    table: v.string(),
    recordId: v.string(),
    retrievedAt: v.number(),
  }),
  v.object({
    kind: v.literal("web"),
    url: v.string(),
    title: v.optional(v.string()),
    retrievedAt: v.number(),
  }),
);

/** Identity, trust and provenance fields shared by every master record. */
export const baseFields = {
  businessId: v.string(),
  trustLevel: literals(TRUST_LEVELS),
  verificationStatus: literals(VERIFICATION_STATUSES),
  verifiedBy: v.optional(actorValidator),
  verifiedAt: v.optional(v.number()),
  evidenceRef: v.optional(v.string()),
  source: sourceValidator,
  classification: literals(CLASSIFICATIONS),
  dataOwnerAgent: literals(AGENT_SLUGS),
  legalEntity: v.string(),
  country: v.string(),
  branch: v.optional(v.string()),
  createdBy: actorValidator,
  updatedBy: actorValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
  archivedAt: v.optional(v.number()),
  dataQualityScore: v.optional(v.number()),
  notes: v.optional(v.string()),
};

/** Added to records that have a validity window (rates, contracts, policies…). */
export const validityFields = {
  validFrom: v.optional(v.number()),
  validTo: v.optional(v.number()),
  lastVerifiedAt: v.optional(v.number()),
  freshness: literals(FRESHNESS),
};

/** Added to versioned records; old versions are never deleted. */
export const versionFields = {
  version: v.string(),
  supersededBy: v.optional(v.string()),
  supersedes: v.optional(v.string()),
};

export const DEFAULT_COUNTRY = "OM";
export const DEFAULT_TIMEZONE = "Asia/Muscat";
export const BASE_CURRENCY = "OMR" as const;
