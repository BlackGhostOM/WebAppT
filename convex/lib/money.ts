/**
 * Money helpers (section 4.4). Every amount is stored with its OMR base equivalent.
 * Exchange rates are reference data (refCurrencies) maintained by the owner; when
 * a rate is missing the conversion is refused rather than guessed.
 */
import { BASE_CURRENCY } from "./baseFields";

export interface Money {
  amount: number;
  currency: string;
  baseAmount: number;
  baseCurrency: "OMR";
  exchangeRate?: number;
  rateSource?: string;
  rateTimestamp?: number;
}

export interface CurrencyRate {
  code: string;
  /** How many OMR one unit of the currency is worth. */
  rateToBase: number;
  source: string;
  updatedAt: number;
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function makeMoney(amount: number, currency: string, rates: CurrencyRate[]): Money {
  if (!Number.isFinite(amount)) throw new Error("INVALID_AMOUNT");
  const code = currency.toUpperCase();
  if (code === BASE_CURRENCY) {
    return { amount: round3(amount), currency: code, baseAmount: round3(amount), baseCurrency: BASE_CURRENCY };
  }
  const rate = rates.find((r) => r.code === code);
  if (!rate) throw new Error(`MISSING_EXCHANGE_RATE:${code}`);
  return {
    amount: round3(amount),
    currency: code,
    baseAmount: round3(amount * rate.rateToBase),
    baseCurrency: BASE_CURRENCY,
    exchangeRate: rate.rateToBase,
    rateSource: rate.source,
    rateTimestamp: rate.updatedAt,
  };
}

export function omr(amount: number): Money {
  return { amount: round3(amount), currency: BASE_CURRENCY, baseAmount: round3(amount), baseCurrency: BASE_CURRENCY };
}

/** Pricing split (section 4.6): margin is derived, never entered by hand. */
export interface PricingFields {
  supplierCost?: Money;
  internalCost?: Money;
  minSellingPrice?: Money;
  recommendedSellingPrice?: Money;
  customerSellingPrice?: Money;
}

export interface MarginResult {
  totalCostBase: number;
  sellingBase: number;
  marginBase: number;
  marginPercent: number | null;
}

export function computeMargin(p: PricingFields): MarginResult {
  const totalCostBase = round3((p.supplierCost?.baseAmount ?? 0) + (p.internalCost?.baseAmount ?? 0));
  const sellingBase = p.customerSellingPrice?.baseAmount ?? p.recommendedSellingPrice?.baseAmount ?? 0;
  const marginBase = round3(sellingBase - totalCostBase);
  const marginPercent = sellingBase > 0 ? Math.round((marginBase / sellingBase) * 10000) / 100 : null;
  return { totalCostBase, sellingBase, marginBase, marginPercent };
}

/** Fields that only cost-visible actors may see (field-level security, 4.9). */
export const COST_FIELDS = ["supplierCost", "internalCost", "marginBase", "marginPercent", "totalCostBase"] as const;
