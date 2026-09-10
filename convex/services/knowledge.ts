/**
 * Knowledge retrieval path (section 4.7):
 *   question → retrieve → permission check (agent, classification, purpose)
 *   → version/freshness check (policy in force at the event date) → context → cited answer.
 * The vector index is never the source of truth; the approved document is.
 */
import type { Doc, Id } from "../_generated/dataModel";
import type { ActionCtx, MutationCtx, QueryCtx } from "../_generated/server";
import type { Actor } from "../lib/actor";
import { nextBusinessId } from "../lib/ids";
import { normalizeName } from "../lib/validation";
import type { AgentSlug } from "../lib/vocab";

export interface KnowledgeHit {
  documentId: Id<"documents">;
  documentBusinessId: string;
  title: string;
  version: string;
  section?: string;
  text: string;
  score: number;
  documentType: Doc<"documents">["documentType"];
  classification: Doc<"documents">["classification"];
  trustLevel: Doc<"documents">["trustLevel"];
  freshness: Doc<"documents">["freshness"];
  validFrom?: number;
  validTo?: number;
  citation: { kind: "document"; documentId: Id<"documents">; section?: string; version: string; retrievedAt: number };
}

const CLASSIFICATION_RANK: Record<Doc<"documents">["classification"], number> = {
  PUBLIC: 0,
  INTERNAL: 1,
  CONFIDENTIAL: 2,
  CUSTOMER_CONFIDENTIAL: 2,
  STRICTLY_CONFIDENTIAL: 3,
};

/** Agents may never read STRICTLY_CONFIDENTIAL knowledge; owners may. */
function classificationAllowed(actor: Actor, classification: Doc<"documents">["classification"]): boolean {
  if (actor.type !== "agent") return true;
  return CLASSIFICATION_RANK[classification] < 3;
}

/**
 * Determines whether a chunk is visible to the actor. Documents are visible only
 * when ACTIVE (or REVIEW_DUE, still in force) and, for agents, when listed in
 * `allowedAgents`. Optionally checks the version in force at `asOf`.
 */
export function chunkVisibleTo(chunk: Doc<"knowledgeChunks">, actor: Actor, asOf?: number): boolean {
  if (chunk.lifecycle !== "ACTIVE" && chunk.lifecycle !== "REVIEW_DUE") return false;
  if (!classificationAllowed(actor, chunk.classification)) return false;
  if (actor.type === "agent" && !chunk.allowedAgents.includes(actor.id as AgentSlug)) return false;
  if (asOf !== undefined) {
    if (chunk.validFrom !== undefined && chunk.validFrom > asOf) return false;
    if (chunk.validTo !== undefined && chunk.validTo < asOf) return false;
  }
  return true;
}

export interface SearchOptions {
  limit?: number;
  /** Date of the event the question refers to (policy in force then, not just the latest). */
  asOf?: number;
  domain?: Doc<"documents">["domain"];
  language?: "ar" | "en";
}

/** Keyword search fallback (works without an embedding provider). */
export async function keywordSearch(ctx: QueryCtx | MutationCtx, actor: Actor, query: string, opts: SearchOptions = {}): Promise<KnowledgeHit[]> {
  const limit = Math.min(opts.limit ?? 6, 20);
  const results = await ctx.db
    .query("knowledgeChunks")
    .withSearchIndex("search_text", (q) => {
      let s = q.search("text", query).eq("lifecycle", "ACTIVE");
      if (opts.language) s = s.eq("language", opts.language);
      if (opts.domain) s = s.eq("domain", opts.domain);
      return s;
    })
    .take(limit * 3);
  return await hydrate(ctx, actor, results.map((c, i) => ({ chunk: c, score: 1 - i / (results.length + 1) })), opts, limit);
}

export async function hydrate(
  ctx: QueryCtx | MutationCtx,
  actor: Actor,
  scored: { chunk: Doc<"knowledgeChunks">; score: number }[],
  opts: SearchOptions,
  limit: number,
): Promise<KnowledgeHit[]> {
  const hits: KnowledgeHit[] = [];
  const now = Date.now();
  for (const { chunk, score } of scored) {
    if (!chunkVisibleTo(chunk, actor, opts.asOf)) continue;
    const doc = await ctx.db.get(chunk.documentId);
    if (!doc || doc.archivedAt) continue;
    // Re-check on the source of truth, not the denormalised copy.
    if (doc.lifecycle !== "ACTIVE" && doc.lifecycle !== "REVIEW_DUE") continue;
    if (actor.type === "agent" && !doc.allowedAgents.includes(actor.id as AgentSlug)) continue;
    if (!classificationAllowed(actor, doc.classification)) continue;
    hits.push({
      documentId: doc._id,
      documentBusinessId: doc.businessId,
      title: doc.title,
      version: doc.version,
      section: chunk.section,
      text: chunk.text,
      score,
      documentType: doc.documentType,
      classification: doc.classification,
      trustLevel: doc.trustLevel,
      freshness: doc.freshness,
      validFrom: doc.validFrom,
      validTo: doc.validTo,
      citation: { kind: "document", documentId: doc._id, section: chunk.section, version: doc.version, retrievedAt: now },
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Vector search must run in an action; this helper is used by `knowledge/search.ts`. */
export async function vectorSearchIds(ctx: ActionCtx, embedding: number[], opts: SearchOptions): Promise<{ _id: Id<"knowledgeChunks">; _score: number }[]> {
  return await ctx.vectorSearch("knowledgeChunks", "by_embedding", {
    vector: embedding,
    limit: Math.min((opts.limit ?? 6) * 3, 60),
    filter: (q) => q.eq("lifecycle", "ACTIVE"),
  });
}

/** Counts a citation on the document so the UI can show how often agents rely on it. */
export async function recordCitations(ctx: MutationCtx, documentIds: Id<"documents">[]) {
  const unique = [...new Set(documentIds)];
  for (const id of unique) {
    const doc = await ctx.db.get(id);
    if (doc) await ctx.db.patch(id, { citationCount: doc.citationCount + 1 });
  }
}

/** Repeated unanswered questions become knowledge gaps visible to the owner (4.7). */
export async function recordKnowledgeGap(ctx: MutationCtx, agentSlug: AgentSlug, question: string, taskId?: Id<"tasks">) {
  const normalized = normalizeName(question).slice(0, 200);
  if (!normalized) return;
  const existing = await ctx.db.query("knowledgeGaps").withIndex("by_normalizedQuestion", (q) => q.eq("normalizedQuestion", normalized)).unique();
  const now = Date.now();
  if (existing) {
    await ctx.db.patch(existing._id, {
      occurrences: existing.occurrences + 1,
      lastAskedAt: now,
      taskIds: taskId && !existing.taskIds.includes(taskId) ? [...existing.taskIds, taskId].slice(-20) : existing.taskIds,
      status: existing.status === "DISMISSED" ? "OPEN" : existing.status,
    });
    return;
  }
  await ctx.db.insert("knowledgeGaps", {
    businessId: await nextBusinessId(ctx, "knowledgeGaps"),
    question: question.slice(0, 500),
    normalizedQuestion: normalized,
    askedBy: agentSlug,
    occurrences: 1,
    lastAskedAt: now,
    taskIds: taskId ? [taskId] : [],
    status: "OPEN",
    createdAt: now,
  });
}

/** Splits text into overlapping chunks that respect paragraph boundaries. */
export function chunkText(text: string, opts: { maxChars?: number; overlap?: number } = {}): { text: string; section?: string }[] {
  const maxChars = opts.maxChars ?? 1200;
  const overlap = opts.overlap ?? 150;
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const chunks: { text: string; section?: string }[] = [];
  let current = "";
  let section: string | undefined;
  const flush = () => {
    if (current.trim()) chunks.push({ text: current.trim(), section });
    current = current.length > overlap ? current.slice(-overlap) : "";
  };
  for (const p of paragraphs) {
    const heading = /^(#{1,6}\s+.+|[^\n]{3,80}:)$/.exec(p);
    if (heading) section = p.replace(/^#+\s*/, "").replace(/:$/, "").slice(0, 80);
    if (p.length > maxChars) {
      flush();
      for (let i = 0; i < p.length; i += maxChars - overlap) chunks.push({ text: p.slice(i, i + maxChars), section });
      current = "";
      continue;
    }
    if (current.length + p.length + 1 > maxChars) flush();
    current = current ? `${current}\n${p}` : p;
  }
  if (current.trim()) chunks.push({ text: current.trim(), section });
  return chunks;
}
