import { describe, expect, it } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { registerDocument } from "../../convex/services/documents";
import { keywordSearch } from "../../convex/services/knowledge";
import { AGENT, OWNER_ACTOR, setup } from "./helpers";

const TEXT = `# سياسة الاسترداد التجريبية

رسوم إدارية 15 ريالاً عُمانياً لكل عملية إلغاء بطلب العميل.

الإلغاء قبل 14 يوماً: استرداد كامل عدا الرسوم الإدارية.`;

describe("document lifecycle and agent visibility", () => {
  it("keeps an uploaded document invisible to agents until the owner approves it", async () => {
    const { t, asOwner, ownerId } = await setup();
    const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob([TEXT], { type: "text/markdown" })));
    const documentId = await t.run(async (ctx) =>
      registerDocument(ctx, OWNER_ACTOR(ownerId), {
        title: "سياسة الاسترداد التجريبية",
        documentType: "POLICY",
        domain: "CUSTOMER",
        language: "ar",
        classification: "INTERNAL",
        allowedAgents: ["support", "executive"],
        storageId,
        mimeType: "text/markdown",
        sizeBytes: TEXT.length,
        originalFileName: "refund.md",
      }),
    );
    await t.action(internal.knowledge.pipeline.process, { documentId });

    const afterPipeline = await t.run(async (ctx) => ctx.db.get(documentId));
    expect(afterPipeline?.lifecycle).toBe("REVIEW");
    expect(afterPipeline?.extractionStatus).toBe("EXTRACTED");
    expect(afterPipeline?.chunkCount).toBeGreaterThan(0);
    expect(afterPipeline?.aiMetadata?.status).toBe("AI_EXTRACTED");

    const hiddenFromSupport = await t.run(async (ctx) => keywordSearch(ctx, AGENT("support"), "رسوم إدارية إلغاء"));
    expect(hiddenFromSupport).toHaveLength(0);

    await asOwner.mutation(api.documents.approve, { documentId });
    const active = await t.run(async (ctx) => ctx.db.get(documentId));
    expect(active?.lifecycle).toBe("ACTIVE");
    expect(active?.trustLevel).toBe("A_COMPANY_VERIFIED");

    const visibleToSupport = await t.run(async (ctx) => keywordSearch(ctx, AGENT("support"), "رسوم إدارية إلغاء"));
    expect(visibleToSupport.length).toBeGreaterThan(0);
    expect(visibleToSupport[0].citation).toMatchObject({ kind: "document", documentId, version: "1.0" });

    // sales is not in allowedAgents → still invisible
    const hiddenFromSales = await t.run(async (ctx) => keywordSearch(ctx, AGENT("sales"), "رسوم إدارية إلغاء"));
    expect(hiddenFromSales).toHaveLength(0);
  });

  it("supersedes the previous active version when a new version is activated", async () => {
    const { t, asOwner, ownerId } = await setup();
    const make = async (text: string, supersedes?: Awaited<ReturnType<typeof registerDocument>>) => {
      const storageId = await t.run(async (ctx) => ctx.storage.store(new Blob([text], { type: "text/plain" })));
      const id = await t.run(async (ctx) =>
        registerDocument(ctx, OWNER_ACTOR(ownerId), { title: "دليل", documentType: "DESTINATION_GUIDE", domain: "DESTINATION_EXPERIENCE", language: "ar", classification: "PUBLIC", allowedAgents: ["product"], storageId, mimeType: "text/plain", sizeBytes: text.length, originalFileName: "g.txt", supersedesDocumentId: supersedes }),
      );
      await t.action(internal.knowledge.pipeline.process, { documentId: id });
      await asOwner.mutation(api.documents.approve, { documentId: id });
      return id;
    };
    const v1 = await make("نزوى قلعة تاريخية وسوق قديم.");
    const v2 = await make("نزوى قلعة تاريخية وسوق قديم ومتحف جديد.", v1);
    const [d1, d2] = await t.run(async (ctx) => Promise.all([ctx.db.get(v1), ctx.db.get(v2)]));
    expect(d1?.lifecycle).toBe("SUPERSEDED");
    expect(d1?.supersededBy).toBe(d2?.businessId);
    expect(d2?.version).toBe("1.1");
    expect(d2?.documentFamilyId).toBe(d1?.documentFamilyId);
    const hits = await t.run(async (ctx) => keywordSearch(ctx, AGENT("product"), "نزوى قلعة"));
    expect(hits.every((h) => h.documentId === v2)).toBe(true);
  });
});
