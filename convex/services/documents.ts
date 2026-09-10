/**
 * Document management services (DMS, section 4.7): upload registration,
 * lifecycle transitions, versioning (old versions become SUPERSEDED, never
 * deleted) and owner approval that makes a document visible to agents.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import type { Actor } from "../lib/actor";
import { appendAudit } from "../lib/audit";
import { appError } from "../lib/errors";
import { computeFreshness } from "../lib/freshness";
import { nextBusinessId } from "../lib/ids";
import { assertTransition } from "../lib/validation";
import * as V from "../lib/vocab";
import { stampBase } from "./common";

export interface RegisterDocumentInput {
  title: string;
  documentType: Doc<"documents">["documentType"];
  domain: Doc<"documents">["domain"];
  language: "ar" | "en";
  classification: Doc<"documents">["classification"];
  allowedAgents: V.AgentSlug[];
  relatedEntity?: { table: string; recordId: string };
  storageId?: Id<"_storage">;
  mimeType?: string;
  sizeBytes?: number;
  originalFileName?: string;
  validFrom?: number;
  validTo?: number;
  /** When supplied, this upload is a new version of an existing family. */
  supersedesDocumentId?: Id<"documents">;
  /** Seed documents can carry inline text. */
  inlineText?: string;
}

function bumpVersion(version: string): string {
  const [major, minor] = version.split(".").map((n) => Number(n) || 0);
  return `${major}.${minor + 1}`;
}

export async function registerDocument(ctx: MutationCtx, actor: Actor, input: RegisterDocumentInput): Promise<Id<"documents">> {
  if (!input.title.trim()) throw appError("VALIDATION", "title: العنوان إلزامي", { field: "title" });
  if (!V.isOneOf(V.DOCUMENT_TYPES, input.documentType)) throw appError("VALIDATION", "documentType: نوع غير معياري", { field: "documentType" });
  if (!V.isOneOf(V.DOMAINS, input.domain)) throw appError("VALIDATION", "domain: نطاق غير معياري", { field: "domain" });
  if (!V.isOneOf(V.CLASSIFICATIONS, input.classification)) throw appError("VALIDATION", "classification: تصنيف غير معياري", { field: "classification" });
  for (const a of input.allowedAgents) if (!V.isOneOf(V.AGENT_SLUGS, a)) throw appError("VALIDATION", `allowedAgents: ${a}`, { field: "allowedAgents" });
  if (!input.storageId && !input.inlineText) throw appError("VALIDATION", "storageId: الملف إلزامي", { field: "storageId" });

  let version = "1.0";
  let documentFamilyId: string | undefined;
  let previous: Doc<"documents"> | null = null;
  if (input.supersedesDocumentId) {
    previous = await ctx.db.get(input.supersedesDocumentId);
    if (!previous) throw appError("NOT_FOUND", "المستند السابق غير موجود");
    version = bumpVersion(previous.version);
    documentFamilyId = previous.documentFamilyId;
  }
  const businessId = await nextBusinessId(ctx, "documents");
  const base = await stampBase(ctx, actor, businessId, {
    classification: input.classification,
    dataOwnerAgent: "executive",
    ...(actor.type === "owner" ? {} : { verificationStatus: "AI_EXTRACTED" as const }),
  });
  const now = Date.now();
  const id = await ctx.db.insert("documents", {
    ...base,
    // A freshly uploaded file is not yet verified content: it must pass review.
    verificationStatus: actor.type === "owner" ? "UNVERIFIED" : "AI_EXTRACTED",
    version,
    supersedes: previous?.businessId,
    documentFamilyId: documentFamilyId ?? businessId,
    title: input.title.trim(),
    documentType: input.documentType,
    domain: input.domain,
    language: input.language,
    translationStatus: "CANONICAL",
    relatedEntity: input.relatedEntity,
    storageId: input.storageId,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    originalFileName: input.originalFileName,
    lifecycle: "DRAFT",
    allowedAgents: input.allowedAgents,
    textPreview: input.inlineText?.slice(0, 4000),
    extractedCharCount: input.inlineText?.length,
    extractionStatus: input.inlineText ? "EXTRACTED" : "PENDING",
    proposals: [],
    chunkCount: 0,
    citationCount: 0,
    validFrom: input.validFrom,
    validTo: input.validTo,
    freshness: computeFreshness({ validFrom: input.validFrom, validTo: input.validTo, verificationStatus: "UNVERIFIED" }),
  });
  await appendAudit(ctx, {
    actor,
    table: "documents",
    recordId: id,
    businessId,
    event: "CREATE",
    newValue: { title: input.title, documentType: input.documentType, version, supersedes: previous?.businessId },
    severity: "D2",
  });
  void now;
  return id;
}

export async function transitionDocument(ctx: MutationCtx, actor: Actor, documentId: Id<"documents">, to: V.DocumentLifecycle, reason?: string) {
  const doc = await ctx.db.get(documentId);
  if (!doc) throw appError("NOT_FOUND", "المستند غير موجود");
  assertTransition(V.DOCUMENT_TRANSITIONS, doc.lifecycle, to, "المستند");
  if ((to === "APPROVED" || to === "ACTIVE") && actor.type !== "owner") throw appError("FORBIDDEN", "اعتماد المستندات متاح للمالك فقط");
  const now = Date.now();
  const patch: Partial<Doc<"documents">> = { lifecycle: to, updatedAt: now, updatedBy: actor };
  if (to === "APPROVED" || to === "ACTIVE") {
    patch.approvedBy = actor;
    patch.approvedAt = now;
    patch.verificationStatus = "HUMAN_VERIFIED";
    patch.trustLevel = "A_COMPANY_VERIFIED";
    patch.verifiedBy = actor;
    patch.verifiedAt = now;
    patch.lastVerifiedAt = now;
    patch.freshness = computeFreshness({ validFrom: doc.validFrom, validTo: doc.validTo, lastVerifiedAt: now });
    patch.reviewDueAt = doc.validTo ?? now + 365 * 24 * 60 * 60 * 1000;
  }
  await ctx.db.patch(documentId, patch);
  // Keep the denormalised lifecycle on chunks in sync so retrieval filters stay correct.
  const chunks = await ctx.db.query("knowledgeChunks").withIndex("by_document", (q) => q.eq("documentId", documentId)).take(2000);
  for (const c of chunks) await ctx.db.patch(c._id, { lifecycle: to });

  // Activating a new version supersedes the previous active version of the family.
  if (to === "ACTIVE") {
    const family = await ctx.db.query("documents").withIndex("by_family", (q) => q.eq("documentFamilyId", doc.documentFamilyId)).take(50);
    for (const other of family) {
      if (other._id === documentId) continue;
      if (other.lifecycle === "ACTIVE" || other.lifecycle === "REVIEW_DUE") {
        await ctx.db.patch(other._id, { lifecycle: "SUPERSEDED", supersededBy: doc.businessId, updatedAt: now, updatedBy: actor });
        const otherChunks = await ctx.db.query("knowledgeChunks").withIndex("by_document", (q) => q.eq("documentId", other._id)).take(2000);
        for (const c of otherChunks) await ctx.db.patch(c._id, { lifecycle: "SUPERSEDED" });
        await appendAudit(ctx, { actor, table: "documents", recordId: other._id, businessId: other.businessId, event: "UPDATE", oldValue: { lifecycle: other.lifecycle }, newValue: { lifecycle: "SUPERSEDED", supersededBy: doc.businessId }, severity: "D2" });
      }
    }
  }
  await appendAudit(ctx, {
    actor,
    table: "documents",
    recordId: documentId,
    businessId: doc.businessId,
    event: "UPDATE",
    oldValue: { lifecycle: doc.lifecycle },
    newValue: { lifecycle: to },
    reason,
    severity: to === "ACTIVE" ? "D3" : "D2",
  });
}

/** Marks a document archived (soft) and hides its chunks. */
export async function archiveDocument(ctx: MutationCtx, actor: Actor, documentId: Id<"documents">, reason: string) {
  const doc = await ctx.db.get(documentId);
  if (!doc) throw appError("NOT_FOUND", "المستند غير موجود");
  const now = Date.now();
  await ctx.db.patch(documentId, { lifecycle: "ARCHIVED", archivedAt: now, updatedAt: now, updatedBy: actor });
  const chunks = await ctx.db.query("knowledgeChunks").withIndex("by_document", (q) => q.eq("documentId", documentId)).take(2000);
  for (const c of chunks) await ctx.db.patch(c._id, { lifecycle: "ARCHIVED" });
  await appendAudit(ctx, { actor, table: "documents", recordId: documentId, businessId: doc.businessId, event: "ARCHIVE", oldValue: { lifecycle: doc.lifecycle }, newValue: { lifecycle: "ARCHIVED" }, reason, severity: "D2" });
}
