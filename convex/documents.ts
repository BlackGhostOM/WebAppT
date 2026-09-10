/**
 * Knowledge sources (document upload) API — section 6.10.
 * Upload → register → (pipeline: extract, AI metadata, chunk, index) → REVIEW →
 * owner approval → ACTIVE. Agents never see a document before it is ACTIVE.
 */
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { ownerActor, requireOwner, requireUser } from "./lib/actor";
import { appendAudit } from "./lib/audit";
import { appError } from "./lib/errors";
import { createRecord } from "./services/records";
import { archiveDocument, registerDocument, transitionDocument } from "./services/documents";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    await requireUser(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

export const register = mutation({
  args: {
    title: v.string(),
    documentType: v.string(),
    domain: v.string(),
    language: v.union(v.literal("ar"), v.literal("en")),
    classification: v.string(),
    allowedAgents: v.array(v.string()),
    relatedEntity: v.optional(v.object({ table: v.string(), recordId: v.string() })),
    storageId: v.id("_storage"),
    mimeType: v.optional(v.string()),
    sizeBytes: v.optional(v.number()),
    originalFileName: v.optional(v.string()),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
    supersedesDocumentId: v.optional(v.id("documents")),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const documentId = await registerDocument(ctx, ownerActor(user), {
      ...args,
      documentType: args.documentType as Doc<"documents">["documentType"],
      domain: args.domain as Doc<"documents">["domain"],
      classification: args.classification as Doc<"documents">["classification"],
      allowedAgents: args.allowedAgents as Doc<"documents">["allowedAgents"],
    });
    await ctx.scheduler.runAfter(0, internal.knowledge.pipeline.process, { documentId });
    return documentId;
  },
});

export const list = query({
  args: { lifecycle: v.optional(v.string()) },
  handler: async (ctx, { lifecycle }) => {
    await requireUser(ctx);
    const rows = lifecycle
      ? await ctx.db.query("documents").withIndex("by_lifecycle", (q) => q.eq("lifecycle", lifecycle as Doc<"documents">["lifecycle"])).order("desc").take(200)
      : await ctx.db.query("documents").order("desc").take(200);
    return rows.map((d) => ({
      _id: d._id,
      businessId: d.businessId,
      title: d.title,
      documentType: d.documentType,
      domain: d.domain,
      language: d.language,
      version: d.version,
      lifecycle: d.lifecycle,
      freshness: d.freshness,
      classification: d.classification,
      allowedAgents: d.allowedAgents,
      chunkCount: d.chunkCount,
      citationCount: d.citationCount,
      extractionStatus: d.extractionStatus,
      proposalsPending: d.proposals.filter((p) => p.status === "PENDING").length,
      validTo: d.validTo,
      createdAt: d.createdAt,
      supersededBy: d.supersededBy,
      documentFamilyId: d.documentFamilyId,
    }));
  },
});

export const get = query({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    await requireUser(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;
    const fileUrl = doc.storageId ? await ctx.storage.getUrl(doc.storageId) : null;
    const chunks = await ctx.db.query("knowledgeChunks").withIndex("by_document", (q) => q.eq("documentId", documentId)).take(200);
    const family = await ctx.db.query("documents").withIndex("by_family", (q) => q.eq("documentFamilyId", doc.documentFamilyId)).take(20);
    const audit = await ctx.db.query("auditLog").withIndex("by_table_record", (q) => q.eq("table", "documents").eq("recordId", documentId)).order("desc").take(30);
    return {
      document: doc,
      fileUrl,
      chunks: chunks.map((c) => ({ _id: c._id, chunkIndex: c.chunkIndex, section: c.section, text: c.text.slice(0, 400) })),
      family: family.map((f) => ({ _id: f._id, businessId: f.businessId, version: f.version, lifecycle: f.lifecycle, createdAt: f.createdAt })),
      audit,
    };
  },
});

/** Owner approval: REVIEW → APPROVED → ACTIVE; agents can read it from now on. */
export const approve = mutation({
  args: { documentId: v.id("documents"), reason: v.optional(v.string()) },
  handler: async (ctx, { documentId, reason }) => {
    const user = await requireOwner(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) throw appError("NOT_FOUND", "المستند غير موجود");
    if (doc.extractionStatus !== "EXTRACTED") throw appError("CONFLICT", "لا يُعتمد مستند لم يُستخرج نصه بعد");
    if (doc.lifecycle === "DRAFT") await transitionDocument(ctx, ownerActor(user), documentId, "REVIEW", reason);
    await transitionDocument(ctx, ownerActor(user), documentId, "APPROVED", reason);
    await transitionDocument(ctx, ownerActor(user), documentId, "ACTIVE", reason);
    return null;
  },
});

export const transition = mutation({
  args: { documentId: v.id("documents"), to: v.string(), reason: v.optional(v.string()) },
  handler: async (ctx, { documentId, to, reason }) => {
    const user = await requireUser(ctx);
    await transitionDocument(ctx, ownerActor(user), documentId, to as Doc<"documents">["lifecycle"], reason);
    return null;
  },
});

export const archive = mutation({
  args: { documentId: v.id("documents"), reason: v.string() },
  handler: async (ctx, { documentId, reason }) => {
    const user = await requireUser(ctx);
    await archiveDocument(ctx, ownerActor(user), documentId, reason);
    return null;
  },
});

export const reindex = mutation({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => {
    await requireUser(ctx);
    await ctx.scheduler.runAfter(0, internal.knowledge.pipeline.process, { documentId });
    return null;
  },
});

export const updateMetadata = mutation({
  args: {
    documentId: v.id("documents"),
    patch: v.object({
      title: v.optional(v.string()),
      documentType: v.optional(v.string()),
      domain: v.optional(v.string()),
      allowedAgents: v.optional(v.array(v.string())),
      classification: v.optional(v.string()),
      validFrom: v.optional(v.number()),
      validTo: v.optional(v.number()),
    }),
  },
  handler: async (ctx, { documentId, patch }) => {
    const user = await requireUser(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) throw appError("NOT_FOUND", "المستند غير موجود");
    const clean = Object.fromEntries(Object.entries(patch).filter(([, val]) => val !== undefined));
    await ctx.db.patch(documentId, { ...(clean as Partial<Doc<"documents">>), updatedAt: Date.now(), updatedBy: ownerActor(user) });
    if (clean.allowedAgents || clean.classification) {
      const chunks = await ctx.db.query("knowledgeChunks").withIndex("by_document", (q) => q.eq("documentId", documentId)).take(2000);
      for (const c of chunks) await ctx.db.patch(c._id, { ...(clean.allowedAgents ? { allowedAgents: clean.allowedAgents as Doc<"documents">["allowedAgents"] } : {}), ...(clean.classification ? { classification: clean.classification as Doc<"documents">["classification"] } : {}) });
    }
    await appendAudit(ctx, { actor: ownerActor(user), table: "documents", recordId: documentId, businessId: doc.businessId, event: "UPDATE", newValue: clean, severity: "D2" });
    return null;
  },
});

/** Rates/terms extracted from a file are proposals; accepting one creates the `rates` record as the owner. */
export const decideProposal = mutation({
  args: { documentId: v.id("documents"), proposalId: v.string(), decision: v.union(v.literal("ACCEPTED"), v.literal("REJECTED")), edits: v.optional(v.any()) },
  handler: async (ctx, { documentId, proposalId, decision, edits }) => {
    const user = await requireOwner(ctx);
    const doc = await ctx.db.get(documentId);
    if (!doc) throw appError("NOT_FOUND", "المستند غير موجود");
    const proposal = doc.proposals.find((p) => p.id === proposalId);
    if (!proposal) throw appError("NOT_FOUND", "المقترح غير موجود");
    if (proposal.status !== "PENDING") throw appError("CONFLICT", "المقترح محسوم مسبقاً");
    let createdRecordId: string | undefined;
    if (decision === "ACCEPTED" && proposal.kind === "RATE") {
      const data = { ...(proposal.data as Record<string, unknown>), ...((edits ?? {}) as Record<string, unknown>) };
      const result = await createRecord(ctx, ownerActor(user), "rates", data, { acknowledgeDuplicates: true });
      await ctx.db.patch(result.id as Id<"rates">, { sourceDocumentId: documentId, source: { kind: "document", ref: doc.businessId } });
      createdRecordId = result.id;
    }
    await ctx.db.patch(documentId, {
      proposals: doc.proposals.map((p) => (p.id === proposalId ? { ...p, status: decision, decidedAt: Date.now(), createdRecordId } : p)),
    });
    await appendAudit(ctx, { actor: ownerActor(user), table: "documents", recordId: documentId, businessId: doc.businessId, event: decision === "ACCEPTED" ? "APPROVAL" : "REJECTION", newValue: { proposalId, decision, createdRecordId }, severity: "D3" });
    return { createdRecordId };
  },
});

// ---------------------------------------------------------------------------
// Internal helpers used by the pipeline
// ---------------------------------------------------------------------------
export const getInternal = internalQuery({
  args: { documentId: v.id("documents") },
  handler: async (ctx, { documentId }) => await ctx.db.get(documentId),
});

export const registerInternal = internalMutation({
  args: {
    title: v.string(),
    documentType: v.string(),
    domain: v.string(),
    language: v.union(v.literal("ar"), v.literal("en")),
    classification: v.string(),
    allowedAgents: v.array(v.string()),
    storageId: v.id("_storage"),
    mimeType: v.string(),
    sizeBytes: v.number(),
    originalFileName: v.string(),
    validFrom: v.optional(v.number()),
    validTo: v.optional(v.number()),
  },
  returns: v.id("documents"),
  handler: async (ctx, args) => {
    return await registerDocument(ctx, { type: "system", id: "seed" }, {
      ...args,
      documentType: args.documentType as Doc<"documents">["documentType"],
      domain: args.domain as Doc<"documents">["domain"],
      classification: args.classification as Doc<"documents">["classification"],
      allowedAgents: args.allowedAgents as Doc<"documents">["allowedAgents"],
    });
  },
});

export const activateInternal = internalMutation({
  args: { documentId: v.id("documents"), actorUserId: v.optional(v.id("users")) },
  handler: async (ctx, { documentId, actorUserId }) => {
    const actor = actorUserId ? ownerActor(actorUserId) : ({ type: "owner", id: "seed-owner" } as const);
    const doc = await ctx.db.get(documentId);
    if (!doc) return null;
    if (doc.lifecycle === "DRAFT") await transitionDocument(ctx, actor, documentId, "REVIEW", "seed");
    if (doc.lifecycle === "DRAFT" || doc.lifecycle === "REVIEW") await transitionDocument(ctx, actor, documentId, "APPROVED", "seed");
    await transitionDocument(ctx, actor, documentId, "ACTIVE", "seed");
    return null;
  },
});
