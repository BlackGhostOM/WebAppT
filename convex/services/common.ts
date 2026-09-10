/**
 * Shared helpers for the services layer: base-field stamping, currency rates,
 * derived margin and data-quality scoring.
 */
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../lib/actor";
import { DEFAULT_COUNTRY } from "../lib/baseFields";
import { computeFreshness } from "../lib/freshness";
import { computeMargin, type CurrencyRate, type PricingFields } from "../lib/money";
import { getSetting } from "../lib/settings";
import type { AgentSlug, Classification, TrustLevel, VerificationStatus } from "../lib/vocab";

export interface BaseStamp {
  businessId: string;
  trustLevel: TrustLevel;
  verificationStatus: VerificationStatus;
  verifiedBy?: Actor;
  verifiedAt?: number;
  source: { kind: "db" | "web" | "api" | "document" | "human" | "ai"; ref?: string; url?: string; retrievedAt?: number };
  classification: Classification;
  dataOwnerAgent: AgentSlug;
  legalEntity: string;
  country: string;
  branch?: string;
  createdBy: Actor;
  updatedBy: Actor;
  createdAt: number;
  updatedAt: number;
}

export interface StampOptions {
  classification: Classification;
  dataOwnerAgent: AgentSlug;
  /** Imported rows are never trusted until the owner verifies them. */
  imported?: boolean;
  /** Explicit trust for agent research or seed data. */
  trustLevel?: TrustLevel;
  verificationStatus?: VerificationStatus;
  source?: BaseStamp["source"];
}

/** Provenance fields derived from who is writing (section 6.9 / 4.12). */
export async function stampBase(ctx: QueryCtx | MutationCtx, actor: Actor, businessId: string, opts: StampOptions): Promise<BaseStamp> {
  const company = await getSetting(ctx, "company");
  const now = Date.now();
  let trustLevel: TrustLevel;
  let verificationStatus: VerificationStatus;
  let source: BaseStamp["source"];
  if (opts.imported) {
    trustLevel = "D_RELIABLE_EXTERNAL";
    verificationStatus = "MIGRATED_UNVERIFIED";
    source = opts.source ?? { kind: "document", ref: "import" };
  } else if (actor.type === "owner") {
    trustLevel = "A_COMPANY_VERIFIED";
    verificationStatus = "HUMAN_VERIFIED";
    source = { kind: "human", ref: actor.id };
  } else if (actor.type === "agent") {
    trustLevel = opts.trustLevel ?? "E_AI_ESTIMATE";
    verificationStatus = opts.verificationStatus ?? "AI_EXTRACTED";
    source = opts.source ?? { kind: "ai", ref: actor.id, retrievedAt: now };
  } else {
    trustLevel = opts.trustLevel ?? "A_COMPANY_VERIFIED";
    verificationStatus = opts.verificationStatus ?? "AUTO_VERIFIED";
    source = opts.source ?? { kind: "db", ref: actor.id };
  }
  return {
    businessId,
    trustLevel,
    verificationStatus,
    ...(verificationStatus === "HUMAN_VERIFIED" ? { verifiedBy: actor, verifiedAt: now } : {}),
    source,
    classification: opts.classification,
    dataOwnerAgent: opts.dataOwnerAgent,
    legalEntity: company.legalEntity,
    country: company.country ?? DEFAULT_COUNTRY,
    createdBy: actor,
    updatedBy: actor,
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadCurrencyRates(ctx: QueryCtx | MutationCtx): Promise<CurrencyRate[]> {
  const rows = await ctx.db.query("refCurrencies").take(50);
  return rows.map((r) => ({ code: r.code, rateToBase: r.rateToBase, source: r.rateSource, updatedAt: r.rateUpdatedAt }));
}

/** Attaches derived margin when the caller may see costs; never stored. */
export function withMargin<T extends { pricing?: PricingFields }>(record: T, canSeeCosts: boolean): T & { margin?: ReturnType<typeof computeMargin> } {
  if (!canSeeCosts || !record.pricing) return record;
  return { ...record, margin: computeMargin(record.pricing) };
}

/** Recomputes freshness on read so stale data is never silently shown as current. */
export function withFreshness<T extends { validFrom?: number; validTo?: number; lastVerifiedAt?: number; verificationStatus?: string; freshness?: string }>(record: T): T {
  if (!("freshness" in record)) return record;
  return { ...record, freshness: computeFreshness(record) };
}

const VERIFICATION_BONUS: Record<VerificationStatus, number> = {
  HUMAN_VERIFIED: 40,
  AUTO_VERIFIED: 30,
  AI_EXTRACTED: 15,
  MIGRATED_UNVERIFIED: 10,
  UNVERIFIED: 0,
};

/** 0–100: 60% completeness of the defined fields, 40% verification. */
export function computeDataQualityScore(fields: Record<string, unknown>, fieldNames: string[], verificationStatus: VerificationStatus): number {
  const filled = fieldNames.filter((f) => {
    const v = fields[f];
    if (v === undefined || v === null || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  }).length;
  const completeness = fieldNames.length === 0 ? 1 : filled / fieldNames.length;
  return Math.round(completeness * 60 + VERIFICATION_BONUS[verificationStatus]);
}

export type AnyDoc = Doc<"customers"> | Doc<"suppliers"> | Doc<"hotels"> | Doc<"rates"> | Doc<"products"> | Doc<"bookings">;

export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}
