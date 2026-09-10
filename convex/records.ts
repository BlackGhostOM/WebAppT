/**
 * Manual data entry API (owner UI, section 6.9). Forms are generated from
 * `lib/entities.ts`; every write goes through the same services layer the
 * agents use (validation, duplicates, access, audit, D1–D4 severity).
 */
import { v } from "convex/values";
import { ENTITY_KEYS, type EntityKey, entityDef } from "../lib/entities";
import type { TableNames } from "./_generated/dataModel";
import { mutation, query } from "./_generated/server";
import { ownerActor, requireUser } from "./lib/actor";
import { appError, errorMessage } from "./lib/errors";
import { archiveRecord, createRecord, detectDuplicates, getRecord, listRecords, updateRecord, validateEntityInput, verifyRecord } from "./services/records";

function entityArg(entity: string): EntityKey {
  if (!ENTITY_KEYS.includes(entity as EntityKey)) throw appError("VALIDATION", "entity: كيان غير معروف", { field: "entity" });
  return entity as EntityKey;
}

export const list = query({
  args: { entity: v.string(), status: v.optional(v.string()), search: v.optional(v.string()), limit: v.optional(v.number()), includeArchived: v.optional(v.boolean()) },
  handler: async (ctx, { entity, status, search, limit, includeArchived }) => {
    const user = await requireUser(ctx);
    return await listRecords(ctx, ownerActor(user), entityArg(entity), { status, search, limit, includeArchived });
  },
});

export const get = query({
  args: { entity: v.string(), id: v.string() },
  handler: async (ctx, { entity, id }) => {
    const user = await requireUser(ctx);
    const key = entityArg(entity);
    const record = await getRecord(ctx, ownerActor(user), key, id);
    if (!record) return null;
    const def = entityDef(key);
    const audit = await ctx.db.query("auditLog").withIndex("by_table_record", (q) => q.eq("table", def.table).eq("recordId", id)).order("desc").take(30);
    return { record, audit };
  },
});

/** Options for reference pickers: {id,label} lists for every ref table used by the entity. */
export const refOptions = query({
  args: { entity: v.string() },
  handler: async (ctx, { entity }) => {
    await requireUser(ctx);
    const def = entityDef(entityArg(entity));
    const refTables = [...new Set(def.fields.filter((f) => f.refTable).map((f) => f.refTable!))];
    const out: Record<string, { id: string; label: string }[]> = {};
    for (const ref of refTables) {
      const refDef = entityDef(ref);
      const rows = (await ctx.db.query(refDef.table as TableNames).order("desc").take(300)) as unknown as Record<string, unknown>[];
      out[ref] = rows
        .filter((r) => !r.archivedAt)
        .map((r) => ({ id: String(r._id), label: `${String(r[refDef.titleField] ?? "")} (${String(r.businessId ?? "")})` }));
    }
    return out;
  },
});

export const checkDuplicates = query({
  args: { entity: v.string(), data: v.any(), excludeId: v.optional(v.string()) },
  handler: async (ctx, { entity, data, excludeId }) => {
    await requireUser(ctx);
    const def = entityDef(entityArg(entity));
    return await detectDuplicates(ctx, def, (data ?? {}) as Record<string, unknown>, excludeId);
  },
});

/** Dry-run validation for live form feedback. */
export const validate = query({
  args: { entity: v.string(), data: v.any(), partial: v.optional(v.boolean()) },
  handler: async (ctx, { entity, data, partial }) => {
    await requireUser(ctx);
    const def = entityDef(entityArg(entity));
    try {
      await validateEntityInput(ctx, def, (data ?? {}) as Record<string, unknown>, partial ?? false);
      return { ok: true as const, errors: [] as { field: string; message: string }[] };
    } catch (e) {
      const details = (e as { data?: { details?: { errors?: { field: string; message: string }[] } } }).data?.details;
      return { ok: false as const, errors: details?.errors ?? [{ field: "_", message: errorMessage(e) }] };
    }
  },
});

export const create = mutation({
  args: { entity: v.string(), data: v.any(), acknowledgeDuplicates: v.optional(v.boolean()) },
  handler: async (ctx, { entity, data, acknowledgeDuplicates }) => {
    const user = await requireUser(ctx);
    return await createRecord(ctx, ownerActor(user), entityArg(entity), (data ?? {}) as Record<string, unknown>, { acknowledgeDuplicates });
  },
});

export const update = mutation({
  args: { entity: v.string(), id: v.string(), data: v.any(), reason: v.optional(v.string()) },
  handler: async (ctx, { entity, id, data, reason }) => {
    const user = await requireUser(ctx);
    return await updateRecord(ctx, ownerActor(user), entityArg(entity), id, (data ?? {}) as Record<string, unknown>, { reason });
  },
});

export const archive = mutation({
  args: { entity: v.string(), id: v.string(), reason: v.string() },
  handler: async (ctx, { entity, id, reason }) => {
    const user = await requireUser(ctx);
    return await archiveRecord(ctx, ownerActor(user), entityArg(entity), id, reason);
  },
});

export const verify = mutation({
  args: { entity: v.string(), id: v.string() },
  handler: async (ctx, { entity, id }) => {
    const user = await requireUser(ctx);
    return await verifyRecord(ctx, ownerActor(user), entityArg(entity), id);
  },
});

/** Bulk import (CSV/Excel rows mapped client-side). Rows are MIGRATED_UNVERIFIED until the owner verifies them. */
export const importBatch = mutation({
  args: { entity: v.string(), rows: v.array(v.any()) },
  handler: async (ctx, { entity, rows }) => {
    const user = await requireUser(ctx);
    const key = entityArg(entity);
    if (rows.length > 200) throw appError("VALIDATION", "rows: الحد الأقصى 200 صف لكل دفعة", { field: "rows" });
    const results: { index: number; ok: boolean; businessId?: string; error?: string }[] = [];
    for (let i = 0; i < rows.length; i++) {
      try {
        const r = await createRecord(ctx, ownerActor(user), key, (rows[i] ?? {}) as Record<string, unknown>, { imported: true, acknowledgeDuplicates: false });
        results.push({ index: i, ok: true, businessId: r.businessId });
      } catch (e) {
        results.push({ index: i, ok: false, error: errorMessage(e) });
      }
    }
    return results;
  },
});
