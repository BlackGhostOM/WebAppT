/**
 * Settings (model routing, budget, company, auto-approval, integrations) and
 * user management (owner adds users; no public sign-up).
 */
import { createAccount, invalidateSessions, modifyAccountCredentials } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { isPremiumModel, type ModelRoutingSettings } from "../lib/modelRouting";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { validatePassword } from "./auth";
import { ownerActor, requireOwner, requireUser, requireUserIdInAction } from "./lib/actor";
import { appendAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { DEFAULT_SETTINGS, getAllSettings, type SettingKey, setSetting, SETTING_KEYS } from "./lib/settings";
import { APPROVAL_KINDS, FOLLOW_UP_KINDS, isOneOf, USER_ROLES } from "./lib/vocab";
import { listAutoApproved, NEVER_AUTO_APPROVE } from "./services/approvals";

export const getAll = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    const all = await getAllSettings(ctx);
    return {
      ...all,
      providerHints: {
        llmProviderConfigured: !!process.env.ANTHROPIC_API_KEY || process.env.LLM_PROVIDER === "openai_compatible",
        llmProvider: process.env.LLM_PROVIDER ?? (process.env.ANTHROPIC_API_KEY ? "anthropic" : "mock"),
        embeddingsConfigured: !!process.env.VOYAGE_API_KEY,
        resendConfigured: !!process.env.AUTH_RESEND_KEY,
      },
    };
  },
});

export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireUser(ctx);
    return { _id: user._id, email: user.email, name: user.name, role: user.role ?? "staff", locale: user.locale ?? "ar", lastLoginAt: user.lastLoginAt };
  },
});

function validateSetting(key: SettingKey, value: Record<string, unknown>) {
  if (key === "modelRouting") {
    const routing = value as Partial<ModelRoutingSettings>;
    for (const field of ["customerModel", "ownerModel", "executiveModel", "escalationModel"] as const) {
      const model = routing[field];
      if (model !== undefined && (typeof model !== "string" || !model.trim())) throw appError("VALIDATION", `${field}: معرّف نموذج غير صالح`, { field });
      if (model && isPremiumModel(model)) throw appError("VALIDATION", `${field}: لا تُستخدم النماذج المتقدمة افتراضياً في أي مسار؛ فعّلها لمهمة محددة فقط`, { field });
    }
  }
  if (key === "budget") {
    const b = value as { monthlyBudgetUsd?: number; alertThresholdPercent?: number };
    if (b.monthlyBudgetUsd !== undefined && (b.monthlyBudgetUsd < 0 || b.monthlyBudgetUsd > 1_000_000)) throw appError("VALIDATION", "monthlyBudgetUsd: خارج المدى", { field: "monthlyBudgetUsd" });
    if (b.alertThresholdPercent !== undefined && (b.alertThresholdPercent < 1 || b.alertThresholdPercent > 100)) throw appError("VALIDATION", "alertThresholdPercent: بين 1 و100", { field: "alertThresholdPercent" });
  }
  if (key === "autoApprove") {
    const a = value as { kinds?: unknown; followUpKinds?: unknown; maxPerDay?: unknown; quietHours?: unknown };
    if (a.kinds !== undefined) {
      if (!Array.isArray(a.kinds) || !a.kinds.every((k) => isOneOf(APPROVAL_KINDS, k))) throw appError("VALIDATION", "kinds: أنواع اعتماد غير معيارية", { field: "kinds" });
      if ((a.kinds as string[]).some((k) => NEVER_AUTO_APPROVE.includes(k as never))) throw appError("VALIDATION", "kinds: تأكيد الحجوزات والتغييرات الحساسة ودمج البيانات لا تقبل الاعتماد التلقائي", { field: "kinds" });
    }
    if (a.followUpKinds !== undefined && (!Array.isArray(a.followUpKinds) || !a.followUpKinds.every((k) => isOneOf(FOLLOW_UP_KINDS, k)))) throw appError("VALIDATION", "followUpKinds: أنواع متابعة غير معيارية", { field: "followUpKinds" });
    if (a.maxPerDay !== undefined && (typeof a.maxPerDay !== "number" || !Number.isInteger(a.maxPerDay) || a.maxPerDay < 0 || a.maxPerDay > 500)) throw appError("VALIDATION", "maxPerDay: عدد صحيح بين 0 و500", { field: "maxPerDay" });
    if (a.quietHours !== undefined) {
      const q = a.quietHours as { enabled?: unknown; startHour?: unknown; endHour?: unknown };
      const hourOk = (h: unknown) => typeof h === "number" && Number.isInteger(h) && h >= 0 && h <= 23;
      if (typeof q?.enabled !== "boolean" || !hourOk(q.startHour) || !hourOk(q.endHour)) throw appError("VALIDATION", "quietHours: ساعات بين 0 و23", { field: "quietHours" });
    }
  }
  if (key === "agentRuntime") {
    const rt = value as { webSearchMaxUses?: unknown; maxStepsPerTask?: unknown };
    if (rt.webSearchMaxUses !== undefined && (typeof rt.webSearchMaxUses !== "number" || !Number.isInteger(rt.webSearchMaxUses) || rt.webSearchMaxUses < 1 || rt.webSearchMaxUses > 20)) throw appError("VALIDATION", "webSearchMaxUses: عدد صحيح بين 1 و20", { field: "webSearchMaxUses" });
    if (rt.maxStepsPerTask !== undefined && (typeof rt.maxStepsPerTask !== "number" || rt.maxStepsPerTask < 1 || rt.maxStepsPerTask > 30)) throw appError("VALIDATION", "maxStepsPerTask: بين 1 و30", { field: "maxStepsPerTask" });
  }
  if (key === "scheduledTasks") {
    const st = value as { leadRemindersPerDay?: unknown };
    if (st.leadRemindersPerDay !== undefined && (typeof st.leadRemindersPerDay !== "number" || !Number.isInteger(st.leadRemindersPerDay) || st.leadRemindersPerDay < 0 || st.leadRemindersPerDay > 50)) throw appError("VALIDATION", "leadRemindersPerDay: عدد صحيح بين 0 و50", { field: "leadRemindersPerDay" });
  }
  if (key === "emergencyStop") throw appError("FORBIDDEN", "الإيقاف الطارئ يُدار من أزرار الإيقاف لا من الإعدادات");
}

export const update = mutation({
  args: { key: v.string(), value: v.any() },
  handler: async (ctx, { key, value }) => {
    const user = await requireOwner(ctx);
    if (!SETTING_KEYS.includes(key as SettingKey)) throw appError("VALIDATION", "key: مفتاح إعدادات غير معروف", { field: "key" });
    if (typeof value !== "object" || value === null) throw appError("VALIDATION", "value: يجب أن يكون كائناً", { field: "value" });
    const k = key as SettingKey;
    validateSetting(k, value as Record<string, unknown>);
    const allowed = new Set(Object.keys(DEFAULT_SETTINGS[k]));
    const filtered = Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([f]) => allowed.has(f)));
    const { old, merged } = await setSetting(ctx, k, filtered as never, ownerActor(user));
    await appendAudit(ctx, { actor: ownerActor(user), table: "settings", recordId: k, event: "UPDATE", oldValue: old, newValue: merged, severity: "D3" });
    return null;
  },
});

/** What the rule engine decided on its own (transparency for the owner). */
export const autoApprovals = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, { limit }) => {
    await requireUser(ctx);
    const rows = await listAutoApproved(ctx, limit ?? 50);
    return rows.map((a) => ({ _id: a._id, businessId: a.businessId, kind: a.kind, title: a.title, status: a.status, severity: a.severity, agentSlug: a.agentSlug, decidedAt: a.decidedAt, decisionReason: a.decisionReason, executionError: a.executionError }));
  },
});

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------
export const listUsers = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    const users = await ctx.db.query("users").take(100);
    return users.map((u) => ({ _id: u._id, email: u.email, name: u.name, role: u.role ?? "staff", disabled: u.disabled ?? false, lastLoginAt: u.lastLoginAt, createdAt: u._creationTime }));
  },
});

export const assertOwner = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    if (!user || user.disabled || user.role !== "owner") throw appError("FORBIDDEN", "هذه العملية متاحة للمالك فقط");
    return { _id: user._id, email: user.email };
  },
});

export const findUserByEmail = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    return await ctx.db.query("users").withIndex("email", (q) => q.eq("email", email)).unique();
  },
});

export const finalizeUser = internalMutation({
  args: { userId: v.id("users"), role: v.string(), name: v.optional(v.string()), createdByUserId: v.optional(v.id("users")), event: v.string() },
  handler: async (ctx, { userId, role, name, createdByUserId, event }) => {
    if (!isOneOf(USER_ROLES, role)) throw appError("VALIDATION", "role: دور غير معياري", { field: "role" });
    await ctx.db.patch(userId, { role, name, createdByUserId, disabled: false });
    await appendAudit(ctx, {
      actor: createdByUserId ? { type: "owner", id: createdByUserId } : { type: "system", id: "seedOwner" },
      table: "users",
      recordId: userId,
      event: event === "seed" ? "SEED" : "CREATE",
      newValue: { role, name },
      severity: "D4",
    });
    return null;
  },
});

/** Owner creates a user (public sign-up is closed). */
export const createUser = action({
  args: { email: v.string(), password: v.string(), name: v.optional(v.string()), role: v.string() },
  returns: v.id("users"),
  handler: async (ctx, { email, password, name, role }) => {
    const ownerId = await requireUserIdInAction(ctx);
    await ctx.runQuery(internal.settings.assertOwner, { userId: ownerId });
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw appError("VALIDATION", "email: بريد غير صالح", { field: "email" });
    if (!isOneOf(USER_ROLES, role)) throw appError("VALIDATION", "role: دور غير معياري", { field: "role" });
    validatePassword(password);
    const existing = await ctx.runQuery(internal.settings.findUserByEmail, { email: normalized });
    if (existing) throw appError("DUPLICATE", "يوجد مستخدم بهذا البريد");
    const { user } = await createAccount(ctx, { provider: "password", account: { id: normalized, secret: password }, profile: { email: normalized } });
    await ctx.runMutation(internal.settings.finalizeUser, { userId: user._id as Id<"users">, role, name: name?.trim() || undefined, createdByUserId: ownerId, event: "create" });
    return user._id as Id<"users">;
  },
});

export const setUserAccess = mutation({
  args: { userId: v.id("users"), role: v.optional(v.string()), disabled: v.optional(v.boolean()) },
  handler: async (ctx, { userId, role, disabled }) => {
    const owner = await requireOwner(ctx);
    const target = await ctx.db.get(userId);
    if (!target) throw appError("NOT_FOUND", "المستخدم غير موجود");
    if (target._id === owner._id && (disabled || (role && role !== "owner"))) throw appError("FORBIDDEN", "لا يمكن تعطيل حساب المالك الحالي أو تخفيض دوره");
    if (role !== undefined && !isOneOf(USER_ROLES, role)) throw appError("VALIDATION", "role: دور غير معياري", { field: "role" });
    const patch: Partial<Doc<"users">> = {};
    if (role !== undefined) patch.role = role;
    if (disabled !== undefined) patch.disabled = disabled;
    await ctx.db.patch(userId, patch);
    await appendAudit(ctx, { actor: ownerActor(owner), table: "users", recordId: userId, event: "UPDATE", oldValue: { role: target.role, disabled: target.disabled }, newValue: patch, severity: "D4" });
    return null;
  },
});

/** Owner changes a password (own or another user's); all other sessions are invalidated. */
export const changePassword = action({
  args: { userId: v.id("users"), newPassword: v.string() },
  handler: async (ctx, { userId, newPassword }) => {
    const callerId = await requireUserIdInAction(ctx);
    if (callerId !== userId) await ctx.runQuery(internal.settings.assertOwner, { userId: callerId });
    validatePassword(newPassword);
    const target = await ctx.runQuery(internal.settings.getUserInternal, { userId });
    if (!target?.email) throw appError("NOT_FOUND", "المستخدم غير موجود");
    await modifyAccountCredentials(ctx, { provider: "password", account: { id: target.email, secret: newPassword } });
    await invalidateSessions(ctx, { userId });
    await ctx.runMutation(internal.settings.auditPasswordChange, { callerId, userId });
    return null;
  },
});

export const getUserInternal = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => await ctx.db.get(userId),
});

export const auditPasswordChange = internalMutation({
  args: { callerId: v.id("users"), userId: v.id("users") },
  handler: async (ctx, { callerId, userId }) => {
    await appendAudit(ctx, { actor: { type: "owner", id: callerId }, table: "users", recordId: userId, event: "UPDATE", reason: "password_changed_sessions_invalidated", severity: "D3" });
    return null;
  },
});

/** Ends every session of a user (e.g. lost device). */
export const signOutEverywhere = action({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const callerId = await requireUserIdInAction(ctx);
    if (callerId !== userId) await ctx.runQuery(internal.settings.assertOwner, { userId: callerId });
    await invalidateSessions(ctx, { userId });
    await ctx.runMutation(internal.settings.auditSignOut, { callerId, userId });
    return null;
  },
});

export const auditSignOut = internalMutation({
  args: { callerId: v.id("users"), userId: v.id("users") },
  handler: async (ctx, { callerId, userId }) => {
    await appendAudit(ctx, { actor: { type: "owner", id: callerId }, table: "users", recordId: userId, event: "LOGOUT", reason: "all_sessions_invalidated", severity: "D2" });
    return null;
  },
});

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------
export const notifications = query({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.db.query("notifications").withIndex("by_unread", (q) => q.eq("readAt", undefined)).order("desc").take(50);
  },
});

export const markNotificationRead = mutation({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    await requireUser(ctx);
    await ctx.db.patch(notificationId, { readAt: Date.now() });
    return null;
  },
});
