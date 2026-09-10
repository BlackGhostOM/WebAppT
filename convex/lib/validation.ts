/**
 * Validation layer for every write (section 4.2): required fields, format,
 * range, referential integrity, duplicate detection, business rules, then
 * permission. Errors are structured so forms can show them inline.
 */
import type { Id, TableNames } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { appError } from "./errors";
import { isOneOf } from "./vocab";

export class Validator {
  private errors: { field: string; message: string }[] = [];

  constructor(private readonly input: Record<string, unknown>) {}

  requireString(field: string, opts: { min?: number; max?: number } = {}): string {
    const value = this.input[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      this.errors.push({ field, message: "حقل إلزامي" });
      return "";
    }
    const trimmed = value.trim();
    if (opts.min !== undefined && trimmed.length < opts.min) this.errors.push({ field, message: `الحد الأدنى ${opts.min} أحرف` });
    if (opts.max !== undefined && trimmed.length > opts.max) this.errors.push({ field, message: `الحد الأقصى ${opts.max} حرفاً` });
    return trimmed;
  }

  optionalString(field: string, opts: { max?: number } = {}): string | undefined {
    const value = this.input[field];
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "string") {
      this.errors.push({ field, message: "يجب أن يكون نصاً" });
      return undefined;
    }
    const trimmed = value.trim();
    if (opts.max !== undefined && trimmed.length > opts.max) this.errors.push({ field, message: `الحد الأقصى ${opts.max} حرفاً` });
    return trimmed;
  }

  requireEnum<T extends readonly string[]>(field: string, list: T): T[number] {
    const value = this.input[field];
    if (!isOneOf(list, value)) {
      this.errors.push({ field, message: `قيمة غير معيارية. المسموح: ${list.join(", ")}` });
      return list[0];
    }
    return value;
  }

  optionalEnum<T extends readonly string[]>(field: string, list: T): T[number] | undefined {
    const value = this.input[field];
    if (value === undefined || value === null || value === "") return undefined;
    if (!isOneOf(list, value)) {
      this.errors.push({ field, message: `قيمة غير معيارية. المسموح: ${list.join(", ")}` });
      return undefined;
    }
    return value;
  }

  requireNumber(field: string, opts: { min?: number; max?: number; integer?: boolean } = {}): number {
    const raw = this.input[field];
    const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      this.errors.push({ field, message: "رقم إلزامي" });
      return 0;
    }
    if (opts.integer && !Number.isInteger(value)) this.errors.push({ field, message: "يجب أن يكون عدداً صحيحاً" });
    if (opts.min !== undefined && value < opts.min) this.errors.push({ field, message: `الحد الأدنى ${opts.min}` });
    if (opts.max !== undefined && value > opts.max) this.errors.push({ field, message: `الحد الأقصى ${opts.max}` });
    return value;
  }

  optionalNumber(field: string, opts: { min?: number; max?: number; integer?: boolean } = {}): number | undefined {
    const raw = this.input[field];
    if (raw === undefined || raw === null || raw === "") return undefined;
    return this.requireNumber(field, opts);
  }

  optionalBoolean(field: string): boolean | undefined {
    const value = this.input[field];
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value !== "boolean") {
      this.errors.push({ field, message: "قيمة منطقية" });
      return undefined;
    }
    return value;
  }

  optionalStringArray(field: string): string[] {
    const value = this.input[field];
    if (value === undefined || value === null) return [];
    if (!Array.isArray(value) || !value.every((x) => typeof x === "string")) {
      this.errors.push({ field, message: "قائمة نصوص" });
      return [];
    }
    return value.map((s) => s.trim()).filter(Boolean);
  }

  optionalEmail(field: string): string | undefined {
    const value = this.optionalString(field);
    if (value === undefined) return undefined;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) this.errors.push({ field, message: "بريد إلكتروني غير صالح" });
    return value.toLowerCase();
  }

  optionalPhone(field: string): string | undefined {
    const value = this.optionalString(field);
    if (value === undefined) return undefined;
    const digits = value.replace(/[^\d+]/g, "");
    if (digits.replace(/\D/g, "").length < 7) this.errors.push({ field, message: "رقم هاتف غير صالح" });
    return value;
  }

  optionalTimestamp(field: string): number | undefined {
    const raw = this.input[field];
    if (raw === undefined || raw === null || raw === "") return undefined;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
    if (typeof raw === "string") {
      const parsed = Date.parse(raw);
      if (!Number.isNaN(parsed)) return parsed;
    }
    this.errors.push({ field, message: "تاريخ غير صالح" });
    return undefined;
  }

  requireTimestamp(field: string): number {
    const value = this.optionalTimestamp(field);
    if (value === undefined) {
      this.errors.push({ field, message: "تاريخ إلزامي" });
      return 0;
    }
    return value;
  }

  custom(field: string, ok: boolean, message: string) {
    if (!ok) this.errors.push({ field, message });
  }

  /** Throws a structured VALIDATION error when anything failed. */
  throwIfInvalid(): void {
    if (this.errors.length === 0) return;
    const first = this.errors[0];
    throw appError("VALIDATION", `${first.field}: ${first.message}`, {
      field: first.field,
      details: { errors: this.errors },
    });
  }
}

// ---------------------------------------------------------------------------
// Normalisation used for duplicate detection
// ---------------------------------------------------------------------------
const ARABIC_DIACRITICS = /[ً-ٰٟـ]/g;

export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .replace(ARABIC_DIACRITICS, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Digits only with an Omani default country code for local 8-digit numbers. */
export function normalizePhone(phone: string | undefined): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 8) digits = `968${digits}`;
  return digits.length >= 7 ? digits : undefined;
}

export function normalizeEmail(email: string | undefined): string | undefined {
  if (!email) return undefined;
  return email.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Referential integrity and transitions
// ---------------------------------------------------------------------------
export async function requireRef<T extends TableNames>(ctx: QueryCtx | MutationCtx, table: T, id: Id<T>, field: string) {
  const doc = await ctx.db.get(id);
  if (!doc) throw appError("NOT_FOUND", `${field}: السجل المرتبط غير موجود`, { field });
  return doc;
}

export function assertTransition<S extends string>(map: Record<S, readonly S[]>, from: S, to: S, label: string) {
  if (from === to) return;
  const allowed = map[from] ?? [];
  if (!allowed.includes(to)) {
    throw appError("INVALID_TRANSITION", `${label}: لا يمكن الانتقال من ${from} إلى ${to}`, {
      details: { from, to, allowed },
    });
  }
}

// ---------------------------------------------------------------------------
// Duplicate detection (section 4.6): matches are shown to the owner; no auto-merge.
// ---------------------------------------------------------------------------
export type DuplicateCandidate = {
  _id: string;
  businessId: string;
  label: string;
  matchedOn: string[];
};

export async function findCustomerDuplicates(
  ctx: QueryCtx | MutationCtx,
  input: { normalizedPhone?: string; normalizedEmail?: string; normalizedName?: string },
  excludeId?: Id<"customers">,
): Promise<DuplicateCandidate[]> {
  const found = new Map<string, DuplicateCandidate>();
  const add = (doc: { _id: Id<"customers">; businessId: string; fullName: string; archivedAt?: number }, on: string) => {
    if (doc.archivedAt || doc._id === excludeId) return;
    const existing = found.get(doc._id);
    if (existing) existing.matchedOn.push(on);
    else found.set(doc._id, { _id: doc._id, businessId: doc.businessId, label: doc.fullName, matchedOn: [on] });
  };
  const { normalizedPhone, normalizedEmail, normalizedName } = input;
  if (normalizedPhone) {
    const rows = await ctx.db.query("customers").withIndex("by_normalizedPhone", (q) => q.eq("normalizedPhone", normalizedPhone)).take(5);
    rows.forEach((r) => add(r, "phone"));
  }
  if (normalizedEmail) {
    const rows = await ctx.db.query("customers").withIndex("by_normalizedEmail", (q) => q.eq("normalizedEmail", normalizedEmail)).take(5);
    rows.forEach((r) => add(r, "email"));
  }
  if (normalizedName) {
    const rows = await ctx.db.query("customers").withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizedName)).take(5);
    rows.forEach((r) => add(r, "name"));
  }
  return [...found.values()];
}

export async function findSupplierDuplicates(
  ctx: QueryCtx | MutationCtx,
  input: { normalizedPhone?: string; normalizedEmail?: string; normalizedName?: string },
  excludeId?: Id<"suppliers">,
): Promise<DuplicateCandidate[]> {
  const found = new Map<string, DuplicateCandidate>();
  const add = (doc: { _id: Id<"suppliers">; businessId: string; name: string; archivedAt?: number }, on: string) => {
    if (doc.archivedAt || doc._id === excludeId) return;
    const existing = found.get(doc._id);
    if (existing) existing.matchedOn.push(on);
    else found.set(doc._id, { _id: doc._id, businessId: doc.businessId, label: doc.name, matchedOn: [on] });
  };
  const { normalizedPhone, normalizedEmail, normalizedName } = input;
  if (normalizedPhone) {
    (await ctx.db.query("suppliers").withIndex("by_normalizedPhone", (q) => q.eq("normalizedPhone", normalizedPhone)).take(5)).forEach((r) => add(r, "phone"));
  }
  if (normalizedEmail) {
    (await ctx.db.query("suppliers").withIndex("by_normalizedEmail", (q) => q.eq("normalizedEmail", normalizedEmail)).take(5)).forEach((r) => add(r, "email"));
  }
  if (normalizedName) {
    (await ctx.db.query("suppliers").withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizedName)).take(5)).forEach((r) => add(r, "name"));
  }
  return [...found.values()];
}

export async function findHotelDuplicates(ctx: QueryCtx | MutationCtx, normalizedName: string, excludeId?: Id<"hotels">): Promise<DuplicateCandidate[]> {
  const rows = await ctx.db.query("hotels").withIndex("by_normalizedName", (q) => q.eq("normalizedName", normalizedName)).take(5);
  return rows
    .filter((r) => !r.archivedAt && r._id !== excludeId)
    .map((r) => ({ _id: r._id, businessId: r.businessId, label: r.name, matchedOn: ["name"] }));
}

export async function findBookingDuplicates(
  ctx: QueryCtx | MutationCtx,
  input: { customerId: Id<"customers">; travelDateFrom: number },
): Promise<DuplicateCandidate[]> {
  const rows = await ctx.db.query("bookings").withIndex("by_customer", (q) => q.eq("customerId", input.customerId)).take(20);
  return rows
    .filter((r) => !r.archivedAt && Math.abs(r.travelDateFrom - input.travelDateFrom) < 24 * 60 * 60 * 1000 && r.status !== "CANCELLED")
    .map((r) => ({ _id: r._id, businessId: r.businessId, label: `${r.businessId} (${new Date(r.travelDateFrom).toISOString().slice(0, 10)})`, matchedOn: ["customer", "travelDate"] }));
}

export function throwIfDuplicates(candidates: DuplicateCandidate[], acknowledged: boolean | undefined) {
  if (candidates.length > 0 && !acknowledged) {
    throw appError("DUPLICATE", "توجد سجلات مشابهة؛ راجعها قبل الحفظ", { details: { candidates } });
  }
}
