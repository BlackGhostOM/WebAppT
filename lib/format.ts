/** Formatting helpers for the owner UI (Muscat time zone, OMR base currency). */

export const MUSCAT_TZ = "Asia/Muscat";

export function formatDate(ts: number | undefined | null, locale: "ar" | "en" = "ar", withTime = false): string {
  if (ts === undefined || ts === null) return "—";
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-OM" : "en-GB", {
    timeZone: MUSCAT_TZ,
    dateStyle: "medium",
    ...(withTime ? { timeStyle: "short" } : {}),
    numberingSystem: "latn",
  }).format(new Date(ts));
}

export function formatRelative(ts: number | undefined | null, locale: "ar" | "en" = "ar"): string {
  if (ts === undefined || ts === null) return "—";
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "en", { numeric: "auto" });
  if (abs < 60_000) return rtf.format(Math.round(diff / 1000), "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export interface MoneyLike {
  amount: number;
  currency: string;
  baseAmount?: number;
  baseCurrency?: string;
}

export function formatMoney(m: MoneyLike | undefined | null, locale: "ar" | "en" = "ar"): string {
  if (!m) return "—";
  const digits = m.currency === "OMR" ? 3 : 2;
  const main = new Intl.NumberFormat(locale === "ar" ? "ar-OM" : "en-OM", { style: "currency", currency: m.currency, minimumFractionDigits: digits, maximumFractionDigits: digits, numberingSystem: "latn" }).format(m.amount);
  if (m.baseAmount !== undefined && m.currency !== (m.baseCurrency ?? "OMR")) {
    const base = new Intl.NumberFormat(locale === "ar" ? "ar-OM" : "en-OM", { style: "currency", currency: m.baseCurrency ?? "OMR", minimumFractionDigits: 3, numberingSystem: "latn" }).format(m.baseAmount);
    return `${main} (≈ ${base})`;
  }
  return main;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

export function formatPercent(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${formatNumber(n, 1)}%`;
}

export function formatUsd(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `$${formatNumber(n, 2)}`;
}

export function toDateInputValue(ts: number | undefined): string {
  if (!ts) return "";
  return new Date(ts).toISOString().slice(0, 10);
}

export function fromDateInputValue(value: string): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(`${value}T00:00:00+04:00`);
  return Number.isNaN(parsed) ? undefined : parsed;
}
