/**
 * Typed settings stored in the `settings` table (editable from the UI without
 * redeploying). Defaults live here; the table only stores overrides.
 */
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { DEFAULT_MODEL_ROUTING, type ModelRoutingSettings } from "../../lib/modelRouting";
import type { Actor } from "./actor";

export interface CompanySettings {
  name: string;
  nameEn: string;
  legalEntity: string;
  country: string;
  timezone: string;
  baseCurrency: "OMR";
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  defaultLanguage: "ar" | "en";
  /** Short, stable description injected into every agent call (prompt-cached). */
  contextSummary: string;
}

export interface BudgetSettings {
  monthlyBudgetUsd: number;
  alertThresholdPercent: number;
}

export interface EmergencyStopSettings {
  active: boolean;
  activatedAt?: number;
  activatedBy?: string;
  reason?: string;
}

export interface AutoApproveSettings {
  /** Approval kinds the owner explicitly allowed to execute without review. */
  kinds: string[];
  faqAutoReply: boolean;
}

export interface IntegrationSettings {
  metaConnected: boolean;
  whatsappConnected: boolean;
  instagramMode: "mock" | "live";
  resendConfigured: boolean;
}

export interface EscalationSettings {
  bookingValueThresholdOmr: number;
  confidenceThreshold: number;
}

export interface AgentRuntimeSettings {
  maxStepsPerTask: number;
  maxSubtaskDepth: number;
  cancelPollMs: number;
}

export interface AllSettings {
  company: CompanySettings;
  modelRouting: ModelRoutingSettings;
  budget: BudgetSettings;
  emergencyStop: EmergencyStopSettings;
  autoApprove: AutoApproveSettings;
  integrations: IntegrationSettings;
  escalation: EscalationSettings;
  agentRuntime: AgentRuntimeSettings;
}

export const DEFAULT_SETTINGS: AllSettings = {
  company: {
    name: "شركة الأفق للسياحة",
    nameEn: "Al Ufuq Tourism",
    legalEntity: "AL_UFUQ_TOURISM_LLC",
    country: "OM",
    timezone: "Asia/Muscat",
    baseCurrency: "OMR",
    defaultLanguage: "ar",
    contextSummary:
      "شركة سياحية عُمانية مقرها مسقط تصمم وتبيع باقات سياحية داخل سلطنة عُمان (مسقط، نزوى، الجبل الأخضر، صور، رمال الشرقية، صلالة) للأفراد والعوائل والمجموعات والشركات. العملة الأساسية الريال العُماني (OMR). المنطقة الزمنية Asia/Muscat.",
  },
  modelRouting: DEFAULT_MODEL_ROUTING,
  budget: { monthlyBudgetUsd: 200, alertThresholdPercent: 80 },
  emergencyStop: { active: false },
  autoApprove: { kinds: [], faqAutoReply: false },
  integrations: { metaConnected: false, whatsappConnected: false, instagramMode: "mock", resendConfigured: false },
  escalation: { bookingValueThresholdOmr: 2000, confidenceThreshold: 0.7 },
  agentRuntime: { maxStepsPerTask: 12, maxSubtaskDepth: 2, cancelPollMs: 750 },
};

export type SettingKey = keyof AllSettings;
export type SettingValue<K extends SettingKey> = AllSettings[K];

export const SETTING_KEYS = Object.keys(DEFAULT_SETTINGS) as SettingKey[];

export async function getSetting<K extends SettingKey>(ctx: QueryCtx | MutationCtx, key: K): Promise<SettingValue<K>> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const defaults = DEFAULT_SETTINGS[key];
  if (!row) return defaults;
  return { ...(defaults as object), ...(row.value as object) } as SettingValue<K>;
}

export async function getAllSettings(ctx: QueryCtx | MutationCtx) {
  const result: Record<string, unknown> = {};
  for (const key of SETTING_KEYS) result[key] = await getSetting(ctx, key);
  return result as { [K in SettingKey]: SettingValue<K> };
}

export async function setSetting<K extends SettingKey>(ctx: MutationCtx, key: K, value: Partial<SettingValue<K>>, actor: Actor) {
  const existing = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const merged = { ...(DEFAULT_SETTINGS[key] as object), ...((existing?.value as object) ?? {}), ...(value as object) };
  if (existing) {
    await ctx.db.patch(existing._id, { value: merged, updatedAt: Date.now(), updatedBy: actor });
  } else {
    await ctx.db.insert("settings", { key, value: merged, updatedAt: Date.now(), updatedBy: actor });
  }
  return { old: existing?.value, merged };
}

export function monthKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
