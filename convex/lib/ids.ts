/**
 * Business identifier generator (section 4.3).
 *
 * Identifiers are permanent, human readable and generated from the `counters`
 * table inside the same mutation that inserts the record, so they are unique
 * under Convex's transactional guarantees.
 */
import type { MutationCtx } from "../_generated/server";

export const ID_PREFIXES = {
  customers: "CUS",
  leads: "LED",
  quotes: "QTE",
  interactions: "INT",
  products: "PRD",
  productComponents: "PRC",
  itineraries: "ITN",
  destinations: "DST",
  attractions: "ATR",
  experiences: "EXP",
  suppliers: "SUP",
  hotels: "HOT",
  contracts: "CON",
  rates: "RAT",
  pricingRules: "PRR",
  bookings: "BKG",
  bookingServices: "BKS",
  confirmationEvidence: "EVD",
  policies: "POL",
  sops: "SOP",
  decisionRegister: "DEC",
  tasks: "TSK",
  approvals: "APR",
  campaigns: "CMP",
  contentCalendar: "CNT",
  digitalAssets: "AST",
  documents: "DOC",
  dataConflicts: "CFL",
  dataGaps: "GAP",
  knowledgeGaps: "KGP",
  memories: "MEM",
  followUps: "FUP",
  customSchedules: "SCH",
} as const;

export type IdTable = keyof typeof ID_PREFIXES;

function pad(n: number, width: number) {
  return String(n).padStart(width, "0");
}

/**
 * Formats an id from a prefix and a sequence.
 * Bookings embed the year (BKG-2026-001843); products embed the country (PRD-OMN-0051).
 */
export function formatBusinessId(table: IdTable, seq: number, opts?: { year?: number; country?: string }): string {
  const prefix = ID_PREFIXES[table];
  if (table === "bookings") {
    const year = opts?.year ?? new Date().getUTCFullYear();
    return `${prefix}-${year}-${pad(seq, 6)}`;
  }
  if (table === "products") {
    const country = (opts?.country ?? "OMN").toUpperCase();
    return `${prefix}-${country}-${pad(seq, 4)}`;
  }
  return `${prefix}-${pad(seq, 6)}`;
}

/** Reserves the next sequence for `table` and returns the formatted id. */
export async function nextBusinessId(ctx: MutationCtx, table: IdTable, opts?: { year?: number; country?: string }): Promise<string> {
  const key = table === "bookings" ? `${table}:${opts?.year ?? new Date().getUTCFullYear()}` : table;
  const existing = await ctx.db
    .query("counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const seq = (existing?.value ?? 0) + 1;
  if (existing) {
    await ctx.db.patch(existing._id, { value: seq });
  } else {
    await ctx.db.insert("counters", { key, value: seq });
  }
  return formatBusinessId(table, seq, opts);
}

const COUNTRY_TO_ISO3: Record<string, string> = { OM: "OMN", AE: "ARE", SA: "SAU", QA: "QAT", KW: "KWT", BH: "BHR" };

export function iso3(country: string): string {
  return COUNTRY_TO_ISO3[country.toUpperCase()] ?? country.toUpperCase().slice(0, 3);
}
