/**
 * Semantic search over approved knowledge. Vector search runs in an action;
 * permission, lifecycle and version checks run in the query that hydrates
 * the hits from the documents (the source of truth).
 */
import { v } from "convex/values";
import { internal } from "../_generated/api";
import type { Doc, Id } from "../_generated/dataModel";
import { action, internalAction, internalQuery } from "../_generated/server";
import type { Actor } from "../lib/actor";
import { requireUserIdInAction } from "../lib/actor";
import { getEmbeddingProvider } from "../lib/llm";
import { hydrate, keywordSearch, type KnowledgeHit, type SearchOptions } from "../services/knowledge";

const actorValidator = v.object({ type: v.union(v.literal("owner"), v.literal("agent"), v.literal("system")), id: v.string(), taskId: v.optional(v.id("tasks")) });

export const hydrateHits = internalQuery({
  args: {
    actor: actorValidator,
    scored: v.array(v.object({ id: v.id("knowledgeChunks"), score: v.number() })),
    query: v.string(),
    limit: v.number(),
    asOf: v.optional(v.number()),
    domain: v.optional(v.string()),
    language: v.optional(v.union(v.literal("ar"), v.literal("en"))),
  },
  handler: async (ctx, { actor, scored, query, limit, asOf, domain, language }): Promise<KnowledgeHit[]> => {
    const opts: SearchOptions = { limit, asOf, domain: domain as Doc<"documents">["domain"] | undefined, language };
    const chunks: { chunk: Doc<"knowledgeChunks">; score: number }[] = [];
    for (const s of scored) {
      const chunk = await ctx.db.get(s.id);
      if (chunk) chunks.push({ chunk, score: s.score });
    }
    const vectorHits = await hydrate(ctx, actor as Actor, chunks, opts, limit);
    if (vectorHits.length >= Math.min(3, limit)) return vectorHits;
    // Keyword fallback (also covers the deterministic mock embeddings).
    const keywordHits = await keywordSearch(ctx, actor as Actor, query, opts);
    const seen = new Set(vectorHits.map((h) => `${h.documentId}:${h.section ?? ""}:${h.text.slice(0, 40)}`));
    return [...vectorHits, ...keywordHits.filter((h) => !seen.has(`${h.documentId}:${h.section ?? ""}:${h.text.slice(0, 40)}`))].slice(0, limit);
  },
});

export const searchForActor = internalAction({
  args: { actor: actorValidator, query: v.string(), limit: v.optional(v.number()), asOf: v.optional(v.number()), domain: v.optional(v.string()), language: v.optional(v.union(v.literal("ar"), v.literal("en"))) },
  handler: async (ctx, { actor, query, limit, asOf, domain, language }): Promise<KnowledgeHit[]> => {
    const embedder = getEmbeddingProvider();
    const [embedding] = await embedder.embed([query]);
    const results = await ctx.vectorSearch("knowledgeChunks", "by_embedding", {
      vector: embedding,
      limit: Math.min((limit ?? 6) * 4, 64),
      filter: (q) => q.eq("lifecycle", "ACTIVE"),
    });
    return await ctx.runQuery(internal.knowledge.search.hydrateHits, {
      actor,
      scored: results.map((r) => ({ id: r._id as Id<"knowledgeChunks">, score: r._score })),
      query,
      limit: limit ?? 6,
      asOf,
      domain,
      language,
    });
  },
});

/** Owner-side search box on the knowledge page. */
export const search = action({
  args: { query: v.string(), limit: v.optional(v.number()), asOf: v.optional(v.number()) },
  handler: async (ctx, { query, limit, asOf }): Promise<KnowledgeHit[]> => {
    const userId = await requireUserIdInAction(ctx);
    return await ctx.runAction(internal.knowledge.search.searchForActor, { actor: { type: "owner", id: userId }, query, limit, asOf });
  },
});
