/**
 * Freshness engine (sections 4.3 and 4.10).
 * Expired data must never drive a current decision silently.
 */
import type { Freshness } from "./vocab";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const EXPIRING_WINDOW_MS = 30 * DAY_MS;
export const URGENT_WINDOW_MS = 7 * DAY_MS;
/** Records that have not been re-verified in this long need verification. */
export const STALE_VERIFICATION_MS = 180 * DAY_MS;

export interface FreshnessInput {
  validFrom?: number;
  validTo?: number;
  lastVerifiedAt?: number;
  verificationStatus?: string;
}

export function computeFreshness(input: FreshnessInput, now: number = Date.now()): Freshness {
  if (input.validTo !== undefined && input.validTo < now) return "EXPIRED";
  if (input.verificationStatus === "UNVERIFIED" || input.verificationStatus === "MIGRATED_UNVERIFIED") {
    return "REQUIRES_VERIFICATION";
  }
  if (input.lastVerifiedAt !== undefined && now - input.lastVerifiedAt > STALE_VERIFICATION_MS) {
    return "REQUIRES_VERIFICATION";
  }
  if (input.validTo !== undefined && input.validTo - now <= EXPIRING_WINDOW_MS) return "EXPIRING";
  return "CURRENT";
}

/** Days until expiry (negative when already expired), or null when open-ended. */
export function daysUntilExpiry(validTo: number | undefined, now: number = Date.now()): number | null {
  if (validTo === undefined) return null;
  return Math.ceil((validTo - now) / DAY_MS);
}

export function isAlertDay(validTo: number | undefined, now: number = Date.now()): 30 | 7 | null {
  const days = daysUntilExpiry(validTo, now);
  if (days === null) return null;
  if (days === 30) return 30;
  if (days === 7) return 7;
  return null;
}
